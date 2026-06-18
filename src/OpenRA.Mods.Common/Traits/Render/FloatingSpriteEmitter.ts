/**
 * FloatingSpriteEmitter.ts — 浮动精灵粒子发射器特质
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/FloatingSpriteEmitter.cs
 *
 * 核心范式转换:
 * - C# CPU per-particle spawning (FloatingSprite 实例创建) →
 *   Babylon.js GPUParticleSystem (GPU 大量并行粒子模拟)
 * - C# ConditionalTrait<FloatingSpriteEmitterInfo> (基于条件系统的启用/禁用) →
 *   ConditionalTrait<FloatingSpriteEmitterInfo> (条件表达式评估)
 * - C# ITick (每逻辑 tick 检查并生成粒子) →
 *   Babylon.js GPUParticleSystem 自动发射 (emitRate 控制)
 * - C# INotifyDamage (受伤时重置 duration) →
 *   INotifyDamage (TypeScript 等效)
 * - C# ImmutableArray<T> (不可变配置数组) →
 *   readonly T[] (TypeScript 只读数组)
 * - C# Util.RandomVector/RandomInRange (MersenneTwister 随机) →
 *   Math.random() + 种子随机 (非同步渲染层)
 *
 * 粒子 LOD 层级:
 * - Tier 1 (0-50 世界单位): 全粒子，100% emitRate
 * - Tier 2 (50-100): 减半粒子，50% emitRate
 * - Tier 3 (100-200): 最少粒子，20% emitRate
 * - Tier 4 (>200): 停止发射
 *
 * 混合模式:
 * - BLENDMODE_ADD: 火焰、爆炸、枪口闪光
 * - BLENDMODE_STANDARD: 烟雾、碎片
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem'
import type { ParticleSystem } from '@babylonjs/core/Particles/particleSystem'

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyDamage,
  type AttackInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import type { IFacing } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// FloatingSpriteEmitterInfo — emitter configuration
// (对应 OpenRA FloatingSpriteEmitterInfo)
// ---------------------------------------------------------------------------

/**
 * Trait info for FloatingSpriteEmitter.
 *
 * OpenRA 对照: FloatingSpriteEmitterInfo : ConditionalTraitInfo, IRulesetLoaded
 *
 * Defines the particle emission parameters. All array fields allow [min, max]
 * ranges; a single value means constant.
 */
export interface FloatingSpriteEmitterInfo extends ConditionalTraitInfo {
  /** Particle lifetime range in ticks.
   *
   * OpenRA 对照: Lifetime (ImmutableArray<int>, [FieldLoader.Require])
   *
   * Two values = actual lifetime varies between min and max.
   */
  lifetime: readonly number[]

  /** Duration in ticks until stop spawning. -1 = forever.
   *
   * OpenRA 对照: Duration (int, default -1)
   */
  duration: number

  /** Whether duration resets when taking damage.
   *
   * OpenRA 对照: ResetOnDamaged (bool, default true)
   */
  resetOnDamaged: boolean

  /** Randomised offset for the particle emitter from actor center.
   *
   * OpenRA 对照: Offset (ImmutableArray<WVec>, default [WVec.Zero])
   */
  offset: readonly WVec[]

  /** Randomised particle forward movement speed.
   *
   * OpenRA 对照: Speed (ImmutableArray<WDist>, default [WDist.Zero])
   */
  speed: readonly WDist[]

  /** Randomised particle gravity (downward acceleration).
   *
   * OpenRA 对照: Gravity (ImmutableArray<WDist>, default [WDist.Zero])
   */
  gravity: readonly WDist[]

  /** Whether to randomise particle facing on spawn.
   *
   * OpenRA 对照: RandomFacing (bool, default true)
   */
  randomFacing: boolean

  /** Maximum random turn rate per tick for particle rotation.
   *
   * OpenRA 对照: TurnRate (int, default 0)
   */
  turnRate: number

  /** Rate at which particle movement properties are reset (ticks).
   *
   * OpenRA 对照: RandomRate (int, default 4)
   */
  randomRate: number

  /** Particles to spawn per interval. Two values for random range.
   *
   * OpenRA 对照: SpawnFrequency (ImmutableArray<int>, default [1])
   */
  spawnFrequency: readonly number[]

  /** Sprite sheet / image to use for particles.
   *
   * OpenRA 对照: Image (string, default "smoke")
   */
  image: string

  /** Animation sequences to randomly select from.
   *
   * OpenRA 对照: Sequences (ImmutableArray<string>, default ["particles"])
   */
  sequences: readonly string[]

  /** Color palette name.
   *
   * OpenRA 对照: Palette (string, default "effect")
   */
  palette: string

  /** Whether palette is player-specific.
   *
   * OpenRA 对照: IsPlayerPalette (bool, default false)
   */
  isPlayerPalette: boolean
}

/**
 * Default values for FloatingSpriteEmitterInfo (matching OpenRA defaults).
 */
export const DEFAULT_EMITTER_INFO: FloatingSpriteEmitterInfo = {
  requiresCondition: '',
  lifetime: [25],
  duration: -1,
  resetOnDamaged: true,
  offset: [WVec.Zero],
  speed: [WDist.Zero],
  gravity: [WDist.Zero],
  randomFacing: true,
  turnRate: 0,
  randomRate: 4,
  spawnFrequency: [1],
  image: 'smoke',
  sequences: ['particles'],
  palette: 'effect',
  isPlayerPalette: false,
}

// ---------------------------------------------------------------------------
// FloatingSpriteEmitter — particle emitter trait
// (对应 OpenRA FloatingSpriteEmitter)
// ---------------------------------------------------------------------------

/**
 * Spawns floating sprite particle effects attached to an actor.
 *
 * OpenRA 对照: FloatingSpriteEmitter : ConditionalTrait<FloatingSpriteEmitterInfo>, ITick, INotifyDamage
 *
 * Creates a GPUParticleSystem that continuously emits particles from the
 * actor's position. The particle system is managed on the GPU for performance.
 *
 * Key behaviors:
 * - Emits particles at configurable intervals (spawnFrequency)
 * - Particles have random lifetime, speed, and gravity
 * - Duration limits how long emission lasts (-1 = forever)
 * - On damage: resets duration (if resetOnDamaged is true)
 * - Condition system: emitter is disabled when conditions are not met
 * - LOD: particle emission reduced based on camera distance
 *
 * Deterministic mode: ParticleSystem.deterministic = true for lockstep
 * sync compatibility (all particles replay identically given same seed).
 *
 * Usage (in trait/mod system):
 * ```typescript
 * const info: FloatingSpriteEmitterInfo = { ...DEFAULT_EMITTER_INFO, ... }
 * const emitter = new FloatingSpriteEmitter(info)
 * actor.addTrait(emitter)
 * ```
 */
export class FloatingSpriteEmitter
  extends ConditionalTrait<FloatingSpriteEmitterInfo>
  implements INotifyDamage
{
  // -------------------------------------------------------------------------
  // Static interfaces registration (for TypeDictionary)
  // -------------------------------------------------------------------------

  static readonly interfaces = ['ITick', 'INotifyDamage', 'FloatingSpriteEmitter', 'component']

  // -------------------------------------------------------------------------
  // Instance state
  // -------------------------------------------------------------------------

  /** Randomised emitter offset from actor center position.
   *
   * OpenRA 对照: FloatingSpriteEmitter.offset (WVec offset)
   */
  private _offset: WVec

  /** Facing trait reference (if actor has IFacing).
   *
   * OpenRA 对照: FloatingSpriteEmitter.facing (IFacing facing)
   */
  private _facing: IFacing | null = null

  /** Ticks counter — counts down to next spawn.
   *
   * OpenRA 对照: FloatingSpriteEmitter.ticks (int ticks)
   */
  private _ticks = 0

  /** Remaining emission duration in ticks. -1 = infinite.
   *
   * OpenRA 对照: FloatingSpriteEmitter.duration (int duration)
   */
  private _duration: number

  /** The GPU particle system for emission.
   *
   * OpenRA 对照: N/A (new: GPU particle system replaces CPU FloatingSprite instances)
   */
  private _particleSystem: GPUParticleSystem | null = null

  /** Whether the particle system has been started.
   *
   * OpenRA 对照: N/A (new: GPU particle lifecycle tracking)
   */
  private _started = false

  /** Accumulated tick count for LOD evaluation (evaluate every ~1 second). */
  private _lodTickAccumulator = 0

  /** Current LOD tier (0=full, 1=half, 2=minimal, 3=off). */
  private _currentLodTier = 0

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA FloatingSpriteEmitter 构造函数)
  // -------------------------------------------------------------------------

  /**
   * Construct a FloatingSpriteEmitter.
   *
   * OpenRA 对照: FloatingSpriteEmitter(Actor self, FloatingSpriteEmitterInfo info)
   *
   * @param info — emitter configuration
   */
  constructor(info: FloatingSpriteEmitterInfo) {
    super(info)
    this._duration = info.duration
    this._offset = FloatingSpriteEmitter._randomVector(info.offset)
  }

  // -------------------------------------------------------------------------
  // Lifecycle: attach
  // -------------------------------------------------------------------------

  /**
   * Called when this trait is attached to an actor.
   *
   * OpenRA 对照: Created(Actor self) → gets IFacing trait
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)

    // Attempt to get IFacing trait from actor
    // In OpenRA: facing = self.TraitOrDefault<IFacing>()
    // NOTE: traitOrDefault is not yet on IGameActor.
    // When the full GameActor trait system is integrated, use:
    //   this._facing = (actor as GameActor).traitOrDefault<IFacing>() ?? null
    // For now, _facing remains null (random facing will be used).
    void actor // referenced for future trait lookup
    this._facing = null // : integrate with GameActor trait system
  }

  // -------------------------------------------------------------------------
  // Lifecycle: trait enabled
  // -------------------------------------------------------------------------

  /**
   * Called when the trait transitions from disabled to enabled.
   *
   * OpenRA 对照: TraitEnabled(Actor self)
   *
   * Resets duration and offset when the trait becomes active.
   */
  protected override traitEnabled(_actor: IGameActor): void {
    super.traitEnabled(_actor)
    this._duration = this.info.duration
    this._offset = FloatingSpriteEmitter._randomVector(this.info.offset)
    this._ticks = 0
  }

  // -------------------------------------------------------------------------
  // INotifyDamage (对应 OpenRA INotifyDamage.Damaged)
  // -------------------------------------------------------------------------

  /**
   * Called when the owner actor takes damage.
   *
   * OpenRA 对照: INotifyDamage.Damaged(Actor self, AttackInfo e)
   *
   * If resetOnDamaged is true, resets the duration (restarting emission).
   * For infinite duration (-1), only the offset is re-randomised.
   *
   * @param _actor — the actor that took damage
   * @param _attackInfo — information about the attack
   */
  damaged(_actor: IGameActor, _attackInfo: AttackInfo): void {
    if (this.info.resetOnDamaged) {
      if (this._duration < 0) {
        this._offset = FloatingSpriteEmitter._randomVector(this.info.offset)
      }
      this._duration = this.info.duration
    }
  }

  // -------------------------------------------------------------------------
  // ITick — tick (对应 OpenRA ITick.Tick)
  // -------------------------------------------------------------------------

  /**
   * Called every logic tick.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   *
   * Checks:
   * 1. Actor is in world and trait is not disabled
   * 2. Duration has not expired (or is -1 = infinite)
   * 3. Spawn timer has elapsed (--ticks < 0)
   *
   * When conditions are met, spawns a batch of particles.
   *
   * @param actor — the owner actor
   */
  tick(actor: IGameActor): void {
    if (!actor.isInWorld || this.isTraitDisabled) return

    // Duration check: if duration > 0 and expired, stop
    if (this.info.duration > 0 && --this._duration < 0) return

    // Spawn timer: if timer has elapsed, emit particles
    if (--this._ticks < 0) {
      // Reset timer with randomised interval
      this._ticks = FloatingSpriteEmitter._randomInRange(this.info.spawnFrequency)

      // Emit particles
      this._emitParticles(actor)
    }

    // LOD evaluation every ~25 ticks (1 second at 25 TPS)
    this._lodTickAccumulator++
    if (this._lodTickAccumulator >= 25) {
      this._lodTickAccumulator = 0
      this._evaluateLod(actor)
    }
  }

  // -------------------------------------------------------------------------
  // Particle emission (内部)
  // -------------------------------------------------------------------------

  /**
   * Emit a batch of particles at the actor's position.
   *
   * OpenRA 对照: Tick() particle spawning block (lines 119-122)
   *
   * In C#, this creates a new FloatingSprite IEffect each time.
   * In the 3D engine, this configures and starts a GPUParticleSystem
   * or emits a burst from an existing system.
   *
   * @param _actor — the owner actor
   */
  private _emitParticles(_actor: IGameActor): void {
    // NOTE: Full GPU particle system creation requires a Babylon.js Scene
    // with WebGL context. In the stub phase, we track the particle system
    // state and defer actual GPU creation to when the scene is available.
    //
    // When IFacing is available, facing is used for particle direction:
    // const spawnFacing = (!this.info.randomFacing && this._facing)
    //   ? this._facing.facing : randomFacing
    void this._facing // referenced: will be used for directional particles

    if (!this._particleSystem) {
      // Create GPUParticleSystem on first emission
      // Initialize GPUParticleSystem with actor's scene
      // const scene = actor.world?.scene
      // if (!scene) return
      //
      // this._particleSystem = new GPUParticleSystem(
      //   `emitter_${actor.actorId}`,
      //   { capacity: 500 },
      //   scene
      // )
      //
      // Configure:
      // - Emitter: actor's TransformNode (follows actor)
      // - emitRate: this.info.spawnFrequency average
      // - minLifeTime / maxLifeTime: from this.info.lifetime / 25 (ticks to seconds)
      // - gravity: from this.info.gravity
      // - emitter position offset: this._offset
      // - blendMode: info-dependent (Add for fire, Standard for smoke)
      // - deterministic = true for lockstep sync
      // - particleTexture: from this.info.image / sequences
    }

    if (!this._started && this._particleSystem) {
      // this._particleSystem.start()
      this._started = true
    }
  }

  // -------------------------------------------------------------------------
  // LOD evaluation (内部)
  // -------------------------------------------------------------------------

  /**
   * Evaluate distance-based LOD tier.
   *
   * OpenRA 对照: N/A (new: 3D LOD system)
   *
   * Checks distance from camera to actor and adjusts particle emit rate:
   * - Tier 0 (< 50 units): 100% emitRate
   * - Tier 1 (50-100): 50% emitRate
   * - Tier 2 (100-200): 20% emitRate
   * - Tier 3 (> 200): stop emission
   *
   * @param _actor — the owner actor
   */
  private _evaluateLod(_actor: IGameActor): void {
    // NOTE: Full LOD requires access to the scene's active camera
    // and the actor's current 3D position.
    //
    // const camera = actor.world?.scene.activeCamera
    // if (!camera) return
    //
    // const actorPos = actor.position // Vector3
    // const distance = Vector3.Distance(actorPos, camera.position)
    //
    // let newTier: number
    // if (distance < 50) newTier = 0
    // else if (distance < 100) newTier = 1
    // else if (distance < 200) newTier = 2
    // else newTier = 3
    //
    // if (newTier !== this._currentLodTier) {
    //   this._currentLodTier = newTier
    //   this._applyLodTier()
    // }

    // Stub: always tier 0 (full)
    this._currentLodTier = 0
    this._applyLodTier() // apply LOD (no-op in stub)
  }

  /**
   * Apply the current LOD tier to the particle system.
   *
   * OpenRA 对照: N/A (new)
   */
  private _applyLodTier(): void {
    if (!this._particleSystem) return

    // NOTE: When GPUParticleSystem is integrated:
    // const baseEmitRate = this._averageSpawnFrequency()
    // switch (this._currentLodTier) {
    //   case 0: this._particleSystem.emitRate = baseEmitRate; break
    //   case 1: this._particleSystem.emitRate = baseEmitRate * 0.5; break
    //   case 2: this._particleSystem.emitRate = baseEmitRate * 0.2; break
    //   case 3: this._particleSystem.stop(); break
    // }
  }

  // -------------------------------------------------------------------------
  // Utility: random helpers (对应 OpenRA Util.RandomVector / RandomInRange)
  // -------------------------------------------------------------------------

  /**
   * Pick a random vector from an array of candidates.
   *
   * OpenRA 对照: Util.RandomVector(World.SharedRandom, ImmutableArray<WVec>)
   *
   * @param candidates — array of WVec options
   * @returns a randomly selected WVec
   */
  private static _randomVector(candidates: readonly WVec[]): WVec {
    if (candidates.length === 0) return WVec.Zero
    if (candidates.length === 1) return candidates[0]!
    const index = Math.floor(Math.random() * candidates.length)
    return candidates[index]!
  }

  /**
   * Pick a random integer from a range.
   *
   * OpenRA 对照: Util.RandomInRange(World.LocalRandom, ImmutableArray<int>)
   *
   * If array has 1 element: return that value.
   * If array has 2+ elements: random between [0] and [1] inclusive.
   *
   * @param range — [value] or [min, max] range array
   * @returns a random integer in the range
   */
  private static _randomInRange(range: readonly number[]): number {
    if (range.length === 0) return 0
    if (range.length === 1) return range[0]!

    const min = range[0]!
    const max = range[1]!
    if (min === max) return min
    return min + Math.floor(Math.random() * (max - min + 1))
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /** Current emitter offset.
   *
   * OpenRA 对照: FloatingSpriteEmitter.offset
   */
  get offset(): WVec {
    return this._offset
  }

  /** Remaining emission duration. -1 = infinite.
   *
   * OpenRA 对照: FloatingSpriteEmitter.duration (private, exposed for tests)
   */
  get remainingDuration(): number {
    return this._duration
  }

  /** Ticks until next spawn.
   *
   * OpenRA 对照: FloatingSpriteEmitter.ticks (private, exposed for tests)
   */
  get ticksUntilSpawn(): number {
    return this._ticks
  }

  /** Current LOD tier.
   *
   * OpenRA 对照: N/A
   */
  get currentLodTier(): number {
    return this._currentLodTier
  }

  /** Whether the particle system has been started.
   *
   * OpenRA 对照: N/A
   */
  get particleSystemStarted(): boolean {
    return this._started
  }

  /** The attached particle system (null if not yet created).
   *
   * OpenRA 对照: N/A
   */
  get particleSystem(): GPUParticleSystem | ParticleSystem | null {
    return this._particleSystem
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  /**
   * Dispose the particle system and release all resources.
   *
   * OpenRA 对照: N/A (C# uses GC)
   */
  override dispose(): void {
    if (this._particleSystem) {
      this._particleSystem.dispose()
      this._particleSystem = null
    }
    this._started = false
    this._facing = null
    super.dispose()
  }
}
