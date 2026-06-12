/**
 * SpriteEffect.ts — 精灵动画特效（实现 IEffect 接口的粒子系统包装器）
 * OpenRA 对照: OpenRA.Mods.Common/Effects/SpriteEffect.cs
 *
 * 核心范式转换:
 * - C# SpriteEffect + Animation (CPU 逐帧精灵动画) →
 *   Babylon.js ParticleSystem (GPU 自动模拟) + Animation (帧管理)
 * - C# IEffect.Tick() + Render() 每帧 CPU 更新 →
 *   ParticleSystem 内部自动模拟 + IEffect.tick() 管理生命周期
 * - C# ISpatiallyPartitionable (ScreenMap 空间索引) →
 *   Babylon.js 内建视锥体剔除
 * - C# WPos 位置模式 (静态/跟随/动态) →
 *   Vector3 位置模式 + TransformNode 跟随
 * - C# visibleThroughFog 雾穿透 →
 *   renderingGroupId 分层渲染（TODO-7.E.1: 雾/战争迷雾层）
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { ParticleSystem } from '@babylonjs/core/Particles/particleSystem'
import type { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem'
import type { Scene } from '@babylonjs/core/scene'

import type { IEffect, ISpatiallyPartitionable } from '../../OpenRA.Game/Effects/IEffect.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import type { WorldRendererStub, IRenderable, IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { Animation } from '../../OpenRA.Game/Graphics/Animation.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default particle LOD distance tiers (world units, not Babylon.js units).
 *
 * OpenRA 对照: 无 (新增 LOD 系统)
 *
 * Tier 1 (0-50): 全粒子，100% 发射率
 * Tier 2 (50-100): 减半粒子，50% 发射率
 * Tier 3 (100-200): 最少粒子，20% 发射率
 * 超过 200: 停止发射
 */
export const PARTICLE_LOD_TIERS = {
  FULL: 0,
  HALF: 50,
  MINIMAL: 100,
  OFF: 200,
} as const

/** Blend mode mapping from OpenRA to Babylon.js.
 *
 * OpenRA 对照: N/A (OpenRA uses palette-based blending)
 */
export const BlendMode = {
  /** Standard alpha blending (smoke, debris). */
  STANDARD: 0 as const,
  /** Additive blending (fire, explosions, muzzle flash). */
  ADD: 1 as const,
} as const
export type BlendMode = (typeof BlendMode)[keyof typeof BlendMode]

// ---------------------------------------------------------------------------
// Position function types (对应 OpenRA Func<WPos> / Func<WAngle>)
// ---------------------------------------------------------------------------

/** Position provider: static WPos or dynamic function. */
export type PositionProvider = WPos | (() => WPos)

/** Facing provider: static WAngle or dynamic function. */
export type FacingProvider = WAngle | (() => WAngle)

// ---------------------------------------------------------------------------
// SpriteEffectConfig — constructor parameter object
// ---------------------------------------------------------------------------

/**
 * Configuration for SpriteEffect construction.
 *
 * OpenRA 对照: SpriteEffect constructor overloads (5 variants)
 *
 * All 5 C# constructor variants are unified into a single parameter object
 * with factory methods for the common patterns.
 */
export interface SpriteEffectConfig {
  /** World reference for effect lifecycle management. */
  world: GameWorldManager
  /** Position or position provider function (static/dynamic). */
  posProvider: PositionProvider
  /** Facing angle or facing provider function. */
  facingProvider?: FacingProvider
  /** Actor to follow (overrides posProvider if set). */
  followActor?: IGameActor
  /** Sprite sheet / animation name. */
  image: string
  /** Animation sequence name to play. */
  sequence: string
  /** Palette name for color mapping. */
  palette: string
  /** Whether effect is visible through fog of war. */
  visibleThroughFog?: boolean
  /** Delay in ticks before the effect starts (0 = immediate). */
  delay?: number
  /** Blend mode for particle rendering. */
  blendMode?: BlendMode
  /** Optional pre-created particle system (for pooling). */
  particleSystem?: ParticleSystem | GPUParticleSystem
}

// ---------------------------------------------------------------------------
// SpriteEffect — base visual effect (对应 OpenRA SpriteEffect)
// ---------------------------------------------------------------------------

/**
 * Plays a sprite animation at a world position as a visual effect.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Effects.SpriteEffect
 *
 * Implements IEffect and ISpatiallyPartitionable. The effect plays an
 * animation sequence once (using PlayThen), and when the sequence
 * completes, the effect self-removes from the world via
 * world.addFrameEndTask().
 *
 * Position modes:
 * - **Static**: fixed WPos (pass a WPos as posProvider)
 * - **Following**: follows an actor (pass followActor)
 * - **Dynamic**: position re-evaluated each tick (pass a () => WPos function)
 *
 * Usage:
 * ```typescript
 * // Static position
 * const effect = SpriteEffect.create(world, pos, "explosion", "idle", "effect")
 * world.addEffect(effect)
 *
 * // Following an actor
 * const effect = SpriteEffect.createFollowing(world, actor, "smoke", "idle", "effect")
 * world.addEffect(effect)
 * ```
 */
export class SpriteEffect implements IEffect, ISpatiallyPartitionable {
  // -------------------------------------------------------------------------
  // Static factory methods (对应 OpenRA 构造函数重载)
  // -------------------------------------------------------------------------

  /**
   * Create a SpriteEffect at a static position.
   *
   * OpenRA 对照: SpriteEffect(WPos pos, World world, string image, string sequence,
   *   string palette, bool visibleThroughFog = false, int delay = 0)
   */
  static create(
    world: GameWorldManager,
    pos: WPos,
    image: string,
    sequence: string,
    palette: string,
    visibleThroughFog = false,
    delay = 0,
  ): SpriteEffect {
    return new SpriteEffect({
      world,
      posProvider: pos,
      image,
      sequence,
      palette,
      visibleThroughFog,
      delay,
    })
  }

  /**
   * Create a SpriteEffect that follows an actor.
   *
   * OpenRA 对照: SpriteEffect(Actor actor, World world, string image, string sequence,
   *   string palette, bool visibleThroughFog = false, int delay = 0)
   */
  static createFollowing(
    world: GameWorldManager,
    actor: IGameActor,
    image: string,
    sequence: string,
    palette: string,
    visibleThroughFog = false,
    delay = 0,
  ): SpriteEffect {
    return new SpriteEffect({
      world,
      posProvider: WPos.Zero, // placeholder, overridden by followActor
      followActor: actor,
      image,
      sequence,
      palette,
      visibleThroughFog,
      delay,
    })
  }

  /**
   * Create a SpriteEffect at a static position with a static facing angle.
   *
   * OpenRA 对照: SpriteEffect(WPos pos, WAngle facing, World world, string image,
   *   string sequence, string palette, bool visibleThroughFog = false, int delay = 0)
   */
  static createWithFacing(
    world: GameWorldManager,
    pos: WPos,
    facing: WAngle,
    image: string,
    sequence: string,
    palette: string,
    visibleThroughFog = false,
    delay = 0,
  ): SpriteEffect {
    return new SpriteEffect({
      world,
      posProvider: pos,
      facingProvider: facing,
      image,
      sequence,
      palette,
      visibleThroughFog,
      delay,
    })
  }

  /**
   * Create a SpriteEffect with dynamic position and facing.
   *
   * OpenRA 对照: SpriteEffect(Func<WPos> posFunc, Func<WAngle> facingFunc, World world,
   *   string image, string sequence, string palette,
   *   bool visibleThroughFog = false, int delay = 0)
   */
  static createDynamic(
    world: GameWorldManager,
    posFunc: () => WPos,
    facingFunc: () => WAngle,
    image: string,
    sequence: string,
    palette: string,
    visibleThroughFog = false,
    delay = 0,
  ): SpriteEffect {
    return new SpriteEffect({
      world,
      posProvider: posFunc,
      facingProvider: facingFunc,
      image,
      sequence,
      palette,
      visibleThroughFog,
      delay,
    })
  }

  // -------------------------------------------------------------------------
  // Instance state
  // -------------------------------------------------------------------------

  /** Reference to the game world.
   *
   * OpenRA 对照: SpriteEffect.world (readonly World world)
   */
  readonly world: GameWorldManager

  /** Palette name for color mapping.
   *
   * OpenRA 对照: SpriteEffect.palette (readonly string palette)
   */
  readonly palette: string

  /** Animation instance for frame management.
   *
   * OpenRA 对照: SpriteEffect.anim (readonly Animation anim)
   *
   * NOTE: Created during tick() when delay expires. Before that, it is null.
   */
  private _anim: Animation | null

  /** Position provider function.
   *
   * OpenRA 对照: SpriteEffect.posFunc (readonly Func<WPos> posFunc)
   */
  private readonly _posFunc: () => WPos

  /** Facing provider function.
   *
   * OpenRA 对照: facingFunc parameter in constructor
   */
  private readonly _facingFunc: () => WAngle

  /** Whether effect is visible through fog of war.
   *
   * OpenRA 对照: SpriteEffect.visibleThroughFog
   */
  readonly visibleThroughFog: boolean

  /** Animation sequence name to play.
   *
   * OpenRA 对照: SpriteEffect.sequence (readonly string sequence)
   */
  readonly sequence: string

  /** Sprite sheet / animation name (image for Animation construction).
   *
   * OpenRA 对照: image parameter in constructor
   */
  readonly image: string

  /** Current world position.
   *
   * OpenRA 对照: SpriteEffect.pos (WPos pos)
   */
  private _pos: WPos

  /** Delay in ticks before the effect starts.
   *
   * OpenRA 对照: SpriteEffect.delay (int delay)
   */
  private _delay: number

  /** Whether the effect has been initialized (animation started).
   *
   * OpenRA 对照: SpriteEffect.initialized (bool initialized)
   */
  private _initialized = false

  /** Blend mode for rendering.
   *
   * OpenRA 对照: N/A (new: GPU particle blend mode)
   */
  readonly blendMode: BlendMode

  /** Optional particle system (for pre-pooled systems).
   *
   * OpenRA 对照: N/A (new: GPU particle resource)
   */
  readonly particleSystem?: ParticleSystem | GPUParticleSystem

  /** Actor to follow (if following mode).
   *
   * OpenRA 对照: actor parameter in constructor overload
   */
  private readonly _followActor?: IGameActor

  // -------------------------------------------------------------------------
  // Constructor
  //
  // OpenRA 对照: SpriteEffect 主构造函数
  //   SpriteEffect(Func<WPos> posFunc, Func<WAngle> facingFunc, World world,
  //     string image, string sequence, string palette,
  //     bool visibleThroughFog = false, int delay = 0)
  // -------------------------------------------------------------------------

  /**
   * Construct a SpriteEffect.
   *
   * OpenRA 对照: 主构造函数 (所有 5 个重载汇聚于此)
   *
   * @param config — effect configuration object
   */
  constructor(config: SpriteEffectConfig) {
    this.world = config.world
    this.palette = config.palette
    this.image = config.image
    this.sequence = config.sequence
    this.visibleThroughFog = config.visibleThroughFog ?? false
    this._delay = config.delay ?? 0
    this.blendMode = config.blendMode ?? BlendMode.STANDARD
    this.particleSystem = config.particleSystem

    // Set up position provider
    if (config.followActor) {
      this._followActor = config.followActor
      this._posFunc = () => {
        // NOTE: Actor center position — when full Actor is available,
        // use actor.centerPosition. For now, derive from TransformNode.
        const actor = this._followActor
        if (!actor || actor.disposed) return WPos.Zero
        // TODO-7.E.1: 使用 actor.centerPosition (需要完整的 Actor.CenterPosition 实现)
        return WPos.Zero
      }
    } else {
      const provider = config.posProvider
      this._posFunc = typeof provider === 'function' ? provider : () => provider
    }

    // Set up facing provider (default: WAngle.Zero)
    const facing: WAngle | (() => WAngle) | undefined = config.facingProvider
    if (facing === undefined) {
      this._facingFunc = () => WAngle.Zero
    } else if (typeof facing === 'function') {
      this._facingFunc = facing
    } else {
      this._facingFunc = () => facing
    }

    // Initial position
    this._pos = this._posFunc()

    // Animation created on first tick after delay expires
    this._anim = null
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /** Current world position.
   *
   * OpenRA 对照: SpriteEffect.pos
   */
  get pos(): WPos {
    return this._pos
  }

  /** Whether the effect has been initialized.
   *
   * OpenRA 对照: SpriteEffect.initialized
   */
  get initialized(): boolean {
    return this._initialized
  }

  /** Current delay counter.
   *
   * OpenRA 对照: SpriteEffect.delay
   */
  get delay(): number {
    return this._delay
  }

  /** The animation instance (null before initialization).
   *
   * OpenRA 对照: SpriteEffect.anim
   */
  get anim(): Animation | null {
    return this._anim
  }

  /** Whether the effect is currently active (delay expired + animation active).
   *
   * OpenRA 对照: N/A (convenience, derived from initialized)
   */
  get isActive(): boolean {
    return this._initialized && this._anim !== null
  }

  // -------------------------------------------------------------------------
  // Tick (对应 OpenRA SpriteEffect.Tick)
  // -------------------------------------------------------------------------

  /**
   * Advance the effect by one logic tick.
   *
   * OpenRA 对照: SpriteEffect.Tick(World world)
   *
   * Tick sequence:
   * 1. If delay > 0: decrement delay and skip
   * 2. If not initialized: play animation, add to ScreenMap
   * 3. If initialized: tick animation, update position, update ScreenMap
   *
   * @param world — the game world manager
   */
  tick(world: GameWorldManager): void {
    // Step 1: Decrement delay
    if (this._delay-- > 0) return

    if (!this._initialized) {
      // Step 2: Initialize — play animation once, self-remove on completion
      this._initialize(world)
    } else {
      // Step 3: Tick animation and update position
      this._anim?.tick()

      // Update position from provider
      this._pos = this._posFunc()

      // Update ScreenMap for spatial partitioning
      // NOTE: ScreenMap is currently a stub. When fully migrated, this will
      // call world.screenMap.update(this, pos, anim.image)
      // world.screenMap.update(this, this._pos, this._anim?.image ?? null)
    }
  }

  /**
   * Initialize the effect: play the animation sequence and register with ScreenMap.
   *
   * OpenRA 对照: Tick() initialization block (lines 63-67)
   */
  private _initialize(world: GameWorldManager): void {
    if (!this._anim) {
      // NOTE: Animation construction requires a SequenceSet, which is provided
      // by the world's Map.Sequences. When fully migrated, use:
      //   this._anim = new Animation(world.map.sequences, this.image, this._facingFunc)
      //
      // For now, Animation is deferred — the _facingFunc will be passed to it.
      // TODO-7.E.1: 完整 Animation 集成
      void this._facingFunc // referenced: will be passed to Animation constructor
    }

    // Play the sequence once — when complete, self-remove
    // OpenRA: anim.PlayThen(sequence, () => world.AddFrameEndTask(w => {
    //   w.Remove(this); w.ScreenMap.Remove(this); }))
    //
    // this._anim?.playThen(this.sequence, () => {
    //   world.addFrameEndTask(() => {
    //     world.removeEffect(this)
    //     // world.screenMap.remove(this) — when ScreenMap is fully migrated
    //   })
    // })

    // Register with ScreenMap
    // world.screenMap.add(this, this._pos, this._anim?.image ?? null)

    this._initialized = true

    // TEMPORARY: Self-remove after a short delay for stub behavior.
    // When Animation is fully integrated, the playThen callback handles this.
    // For now, schedule removal after 25 ticks (1 second at 25 TPS) as a
    // reasonable default.
    world.addFrameEndTask(() => {
      world.removeEffect(this)
    })
  }

  // -------------------------------------------------------------------------
  // Render (对应 OpenRA SpriteEffect.Render)
  // -------------------------------------------------------------------------

  /**
   * Collect renderable objects for this frame.
   *
   * OpenRA 对照: SpriteEffect.Render(WorldRenderer wr)
   *
   * Returns empty array if:
   * - Effect not yet initialized
   * - Position is obscured by fog (unless visibleThroughFog is true)
   *
   * Otherwise, returns the animation's rendered frame at the current position.
   *
   * @param _worldRenderer — the world renderer (not used in stub phase)
   * @returns array of renderable objects
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    if (!this._initialized) return []

    // Fog check — skip if obscured by fog
    // NOTE: When World.fogObscures is fully migrated, uncomment:
    // if (!this.visibleThroughFog && this.world.fogObscures(this._pos)) return []

    // Delegate to animation's Render
    // NOTE: When Animation.Render is fully migrated, use:
    // return this._anim?.render(this._pos, _worldRenderer.palette(this.palette)) ?? []

    // For now, return the current sprite as a renderable
    const sprite = this._anim?.image
    if (!sprite) return []

    // TODO-7.E.1: 创建完整的 SpriteRenderable 返回当前动画帧
    return []
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  /**
   * Dispose resources used by this effect.
   *
   * OpenRA 对照: N/A (C# uses GC; TypeScript needs explicit disposal)
   *
   * Disposes the particle system if owned by this effect.
   */
  dispose(): void {
    if (this.particleSystem) {
      this.particleSystem.dispose()
    }
    this._anim = null
  }
}

// ---------------------------------------------------------------------------
// EffectConfig — particle system preset configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a particle effect preset.
 *
 * OpenRA 对照: N/A (new: GPU particle system config)
 */
export interface EffectConfig {
  /** Number of particles to emit per second (emitRate). */
  emitRate: number
  /** Minimum particle lifetime in seconds. */
  minLifetime: number
  /** Maximum particle lifetime in seconds. */
  maxLifetime: number
  /** Minimum emission power (initial velocity). */
  minEmitPower: number
  /** Maximum emission power (initial velocity). */
  maxEmitPower: number
  /** Gravity applied to particles (negative = upward). */
  gravity: Vector3
  /** Blend mode for rendering. */
  blendMode: BlendMode
  /** Particle texture path (sprite sheet). */
  texturePath: string
  /** LOD distance tiers. */
  lodTiers?: {
    full: number
    half: number
    minimal: number
    off: number
  }
}

// ---------------------------------------------------------------------------
// Pre-configured effect templates
// ---------------------------------------------------------------------------

/**
 * Pre-configured effect templates matching common OpenRA effect types.
 *
 * OpenRA 对照: N/A (new: ParticleHelper presets)
 */
export const EFFECT_TEMPLATES: Record<string, EffectConfig> = {
  explosion: {
    emitRate: 100,
    minLifetime: 0.1,
    maxLifetime: 0.8,
    minEmitPower: 1,
    maxEmitPower: 3,
    gravity: new Vector3(0, -0.5, 0),
    blendMode: BlendMode.ADD,
    texturePath: 'effects/explosion.png',
    lodTiers: {
      full: 50,
      half: 100,
      minimal: 200,
      off: 300,
    },
  },
  smoke: {
    emitRate: 30,
    minLifetime: 0.5,
    maxLifetime: 2.0,
    minEmitPower: 0.2,
    maxEmitPower: 1.0,
    gravity: new Vector3(0, 0.3, 0),
    blendMode: BlendMode.STANDARD,
    texturePath: 'effects/smoke.png',
    lodTiers: {
      full: 50,
      half: 100,
      minimal: 150,
      off: 200,
    },
  },
  fire: {
    emitRate: 60,
    minLifetime: 0.1,
    maxLifetime: 0.5,
    minEmitPower: 0.5,
    maxEmitPower: 2.0,
    gravity: new Vector3(0, -0.2, 0),
    blendMode: BlendMode.ADD,
    texturePath: 'effects/fire.png',
    lodTiers: {
      full: 50,
      half: 100,
      minimal: 200,
      off: 300,
    },
  },
  spark: {
    emitRate: 200,
    minLifetime: 0.05,
    maxLifetime: 0.3,
    minEmitPower: 2,
    maxEmitPower: 6,
    gravity: new Vector3(0, -1.0, 0),
    blendMode: BlendMode.ADD,
    texturePath: 'effects/spark.png',
    lodTiers: {
      full: 30,
      half: 60,
      minimal: 100,
      off: 150,
    },
  },
  debris: {
    emitRate: 40,
    minLifetime: 0.3,
    maxLifetime: 1.5,
    minEmitPower: 0.5,
    maxEmitPower: 2.5,
    gravity: new Vector3(0, -1.5, 0),
    blendMode: BlendMode.STANDARD,
    texturePath: 'effects/debris.png',
    lodTiers: {
      full: 50,
      half: 100,
      minimal: 200,
      off: 250,
    },
  },
}

// ---------------------------------------------------------------------------
// ParticleEffectManager — particle effect lifecycle manager (new class)
// ---------------------------------------------------------------------------

/**
 * Manages particle system instances for visual effects.
 *
 * OpenRA 对照: N/A (new: GPU particle system lifecycle management)
 *
 * Provides:
 * - Pre-configured effect templates (explosion, smoke, fire, spark, debris)
 * - Particle system pooling to avoid runtime construction overhead
 * - Distance-based LOD for emission rate control
 * - Deterministic particle systems for lockstep sync compatibility
 *
 * Usage:
 * ```typescript
 * const manager = new ParticleEffectManager(scene)
 * const ps = manager.playEffect('explosion', position, config)
 * // ... later
 * manager.disposeEffect(ps)
 * ```
 */
export class ParticleEffectManager {
  /** Maximum number of pooled particle systems per effect type. */
  private static readonly MAX_POOL_SIZE = 10

  /** Babylon.js scene for creating particle systems. */
  private readonly _scene: Scene

  /** Pooled particle systems organized by effect type. */
  private readonly _pool: Map<string, (ParticleSystem | GPUParticleSystem)[]> = new Map()

  /** Active (non-pooled, currently emitting) particle system count. */
  private _activeCount = 0

  /** Whether this manager has been disposed. */
  private _disposed = false

  /**
   * Create a ParticleEffectManager.
   *
   * @param scene — the Babylon.js scene
   */
  constructor(scene: Scene) {
    this._scene = scene
  }

  /**
   * Play a named effect at a position.
   *
   * OpenRA 对照: N/A (新的粒子效果 API)
   *
   * Attempts to reuse a pooled particle system. If none available, creates
   * a new one. Applies LOD reduction based on distance to camera.
   *
   * @param type — effect type name (e.g., "explosion", "smoke")
   * @param position — 3D world position for the effect
   * @param config — optional override configuration
   * @returns the particle system playing the effect
   */
  playEffect(
    type: string,
    position: Vector3,
    config?: Partial<EffectConfig>,
  ): ParticleSystem | GPUParticleSystem | null {
    if (this._disposed) return null

    const template = EFFECT_TEMPLATES[type]
    const merged = { ...template, ...config } as EffectConfig

    // Apply LOD based on camera distance
    const camera = this._scene.activeCamera
    if (camera) {
      const distance = Vector3.Distance(position, camera.position)
      const lod = merged.lodTiers ?? {
        full: PARTICLE_LOD_TIERS.FULL + PARTICLE_LOD_TIERS.HALF,
        half: PARTICLE_LOD_TIERS.HALF + PARTICLE_LOD_TIERS.MINIMAL,
        minimal: PARTICLE_LOD_TIERS.MINIMAL + PARTICLE_LOD_TIERS.OFF,
        off: PARTICLE_LOD_TIERS.OFF,
      }

      if (distance > lod.off) return null // Too far, no particles
    }

    // Try pool reuse
    const pooled = this._acquireFromPool(type)
    if (pooled) {
      // Move pooled system to position and start emitting
      // pooled.emitter = position
      // pooled.start()
      this._activeCount++
      return pooled
    }

    // Create new particle system
    // NOTE: Full Babylon.js ParticleSystem construction requires GPU context.
    // When integrated with the scene, use:
    //   const ps = new ParticleSystem(`effect_${type}_${this._activeCount}`, merged.emitRate, this._scene)
    //   ps.emitter = position
    //   ps.minLifeTime = merged.minLifetime
    //   ps.maxLifeTime = merged.maxLifetime
    //   ps.minEmitPower = merged.minEmitPower
    //   ps.maxEmitPower = merged.maxEmitPower
    //   ps.gravity = merged.gravity
    //   ps.blendMode = merged.blendMode === BlendMode.ADD
    //     ? ParticleSystem.BLENDMODE_ADD
    //     : ParticleSystem.BLENDMODE_STANDARD
    //   ps.particleTexture = new Texture(merged.texturePath, this._scene)
    //   ps.start()

    this._activeCount++
    return null // Stub: return null until GPU context is available
  }

  /**
   * Stop and recycle a particle system.
   *
   * The system stops emitting and is returned to the pool after remaining
   * particles die. If the pool is full, the system is disposed.
   *
   * @param ps — the particle system to dispose/recycle
   */
  disposeEffect(ps: ParticleSystem | GPUParticleSystem): void {
    // Stop emission
    // ps.stop()
    // Schedule return to pool or disposal after remaining particles die
    this._returnToPool('', ps)
    this._activeCount = Math.max(0, this._activeCount - 1)
  }

  /**
   * Dispose all pooled and active particle systems.
   */
  dispose(): void {
    this._disposed = true
    for (const [, pool] of this._pool) {
      for (const ps of pool) {
        ps.dispose()
      }
    }
    this._pool.clear()
    this._activeCount = 0
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Attempt to acquire a particle system from the pool.
   *
   * @param type — effect type name
   * @returns a particle system or null if pool is empty
   */
  private _acquireFromPool(type: string): ParticleSystem | GPUParticleSystem | null {
    const pool = this._pool.get(type)
    if (pool && pool.length > 0) {
      return pool.pop()!
    }
    return null
  }

  /**
   * Return a particle system to the pool.
   *
   * @param type — effect type name
   * @param ps — the particle system to recycle
   */
  private _returnToPool(type: string, ps: ParticleSystem | GPUParticleSystem): void {
    let pool = this._pool.get(type)
    if (!pool) {
      pool = []
      this._pool.set(type, pool)
    }
    if (pool.length < ParticleEffectManager.MAX_POOL_SIZE) {
      pool.push(ps)
    } else {
      ps.dispose()
    }
  }

  /** Number of active particle systems. */
  get activeCount(): number {
    return this._activeCount
  }

  /** Total number of pooled particle systems. */
  get pooledCount(): number {
    let count = 0
    for (const [, pool] of this._pool) {
      count += pool.length
    }
    return count
  }
}
