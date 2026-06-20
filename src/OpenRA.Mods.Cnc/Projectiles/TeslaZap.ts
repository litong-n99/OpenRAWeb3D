/**
 * TeslaZap.ts — 特斯拉闪电抛射体（即时命中带电弧视觉效果）
 * OpenRA 对照: OpenRA.Mods.Cnc/Projectiles/TeslaZap.cs (99 lines)
 *
 * 核心范式转换:
 * - C# IProjectile (extends IEffect) → TypeScript IProjectile (extends IEffect)
 * - C# TeslaZapRenderable (2D line segments) → TypeScript TeslaZapRenderable
 *   (3D lightning: LinesMesh + ShaderMaterial)
 * - C# ISync (VerifySync) → TypeScript no-op (sync is Chapter 6 concern)
 * - C# WPos integer arithmetic → TypeScript {X,Y,Z} integer structs
 * - C# Target.FromPos / WarheadArgs / Weapon.Impact → TypeScript stubs
 * - C# yield return IEnumerable<IRenderable> → TypeScript render() returns array
 *
 * Phase B 变更 (24.B.2):
 * - 新增 setScene() 方法用于注入 Babylon.js Scene
 * - render() 中在创建 TeslaZapRenderable 后构建 3D LinesMesh
 * - tick() 在过期时 dispose TeslaZapMeshBuilder
 * - 向后兼容: 未设置 Scene 时行为不变（仅返回 renderable 描述符）
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { Scene } from '@babylonjs/core'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { TeslaZapRenderable } from '../Graphics/TeslaZapRenderable.js'
import {
  TeslaZapMeshBuilder,
  type ITeslaZapWorldRenderer,
} from '../Graphics/TeslaZapRenderable.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IProjectile } from '../../OpenRA.Mods.Common/Projectiles/Bullet.js'
import type { WorldRendererStub, IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'

// ---------------------------------------------------------------------------
// TeslaZapInfo — projectile configuration
// OpenRA 对照: TeslaZapInfo : IProjectileInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the TeslaZap instant-hit lightning projectile.
 *
 * OpenRA 对照: TeslaZapInfo class
 */
export interface TeslaZapInfo {
  /** Sprite collection for the lightning effect.
   *
   * OpenRA 对照: TeslaZapInfo.Image
   */
  readonly image: string

  /** Sprite sequence played at the center of the zap.
   *
   * OpenRA 对照: TeslaZapInfo.BrightSequence
   */
  readonly brightSequence: string

  /** Sprite sequence played at the edges of the zap.
   *
   * OpenRA 对照: TeslaZapInfo.DimSequence
   */
  readonly dimSequence: string

  /** Palette used to draw the electric zap.
   *
   * OpenRA 对照: TeslaZapInfo.Palette
   */
  readonly palette: string

  /** How many bright sprite sequences to play at the center.
   *
   * OpenRA 对照: TeslaZapInfo.BrightZaps
   */
  readonly brightZaps: number

  /** How many dim sprite sequences to play at the borders.
   *
   * OpenRA 对照: TeslaZapInfo.DimZaps
   */
  readonly dimZaps: number

  /** How long (in ticks) to play the sprite sequences.
   *
   * OpenRA 对照: TeslaZapInfo.Duration
   */
  readonly duration: number

  /** How long (in ticks) until applying damage. Can't exceed Duration.
   *
   * OpenRA 对照: TeslaZapInfo.DamageDuration
   */
  readonly damageDuration: number

  /** Follow the targeted actor when it moves.
   *
   * OpenRA 对照: TeslaZapInfo.TrackTarget
   */
  readonly trackTarget: boolean

  /** Controls Z sorting.
   *
   * OpenRA 对照: TeslaZapInfo.ZOffset
   */
  readonly zOffset: number
}

/** Default values for TeslaZapInfo.
 *
 * OpenRA 对照: TeslaZapInfo default field values
 */
export const DEFAULT_TESLA_ZAP_INFO: TeslaZapInfo = {
  image: 'litning',
  brightSequence: 'bright',
  dimSequence: 'dim',
  palette: 'effect',
  brightZaps: 1,
  dimZaps: 2,
  duration: 2,
  damageDuration: 1,
  trackTarget: true,
  zOffset: 0,
}

// ---------------------------------------------------------------------------
// ProjectileArgs (simplified for TeslaZap)
// ---------------------------------------------------------------------------

/**
 * Arguments passed to the TeslaZap constructor.
 *
 * OpenRA 对照: ProjectileArgs (subset used by TeslaZap)
 */
export interface TeslaZapArgs {
  sourceActor: IGameActor
  source: WPos
  passiveTarget: WPos
  guidedTarget: { isValidFor(actor: IGameActor): boolean; centerPosition: WPos; positions: { closestToIgnoringPath(pos: WPos): WPos } }
  weapon: {
    targetActorCenter: boolean
    impact(target: unknown, warheadArgs: unknown): void
  }
}

// ---------------------------------------------------------------------------
// TeslaZap — projectile implementation
// OpenRA 对照: TeslaZap : IProjectile, ISync
// ---------------------------------------------------------------------------

/**
 * Instant-hit projectile that creates a visible lightning bolt effect.
 *
 * OpenRA 对照: TeslaZap
 *
 * The zap is visible for `duration` ticks and applies weapon damage after
 * `damageDuration` ticks. It tracks the target if TrackTarget is enabled.
 * Uses the real TeslaZapRenderable for 3D lightning (LinesMesh + ShaderMaterial).
 */
export class TeslaZap implements IProjectile {
  /** Whether this projectile has been destroyed.
   *
   * OpenRA 对照: TeslaZap (self-removes via frameEndTask)
   */
  get isDestroyed(): boolean {
    return this._ticksUntilRemove < 0
  }

  private readonly _args: TeslaZapArgs
  private readonly _info: TeslaZapInfo
  private _ticksUntilRemove: number
  private _damageDuration: number

  /** Current target position (may update if TrackTarget is enabled).
   *
   * OpenRA 对照: TeslaZap.target (WPos, [VerifySync])
   */
  private _target: WPos

  /** Cached renderable for this frame.
   *
   * OpenRA 对照: TeslaZap.zap (TeslaZapRenderable)
   */
  private _zap: TeslaZapRenderable | null = null

  /** Optional Babylon.js Scene for 3D mesh rendering (Phase B: 24.B.2).
   *
   * When set, render() builds 3D LinesMesh instances via TeslaZapMeshBuilder.
   * When null, behavior is unchanged (only returns renderable descriptors).
   */
  private _scene: Scene | null = null

  /** TeslaZapMeshBuilder for constructing 3D LinesMesh instances.
   *
   * Created lazily when setScene() is called. Disposed in tick() when
   * the projectile expires.
   */
  private _meshBuilder: TeslaZapMeshBuilder | null = null

  /** Whether 3D meshes have been built for the current zap geometry (Phase B fix).
   *
   * On first render() call after setScene(): build meshes via buildZaps().
   * On subsequent calls: only updateJitter() on existing meshes.
   * Reset to false when setScene() is called with a new scene.
   */
  private _zapBuilt: boolean = false

  /** Running tick counter for jitter seed computation (incremented each tick()). */
  private _ticks: number = 0

  /** Last known target offset (WVec). Used to detect position changes when
   * trackTarget is enabled. When the offset changes, _zapBuilt is reset to
   * force mesh rebuild with updated geometry.
   */
  private _lastTargetOffset: WVec | null = null

  constructor(info: TeslaZapInfo, args: TeslaZapArgs) {
    this._args = args
    this._info = info
    this._ticksUntilRemove = info.duration
    this._damageDuration =
      info.damageDuration > info.duration ? info.duration : info.damageDuration
    this._target = args.passiveTarget
  }

  /** Inject a Babylon.js Scene for 3D lightning rendering.
   *
   * Creates a TeslaZapMeshBuilder with default bright/dim materials.
   * Must be called before the first render() call for 3D meshes to appear.
   * Backward compatible: omitting this call preserves the original 2D
   * renderable-only behavior.
   *
   * // TODO-Ch24.B: Material pooling — share one TeslaZapMeshBuilder across all
   * // TeslaZap instances to reduce GPU state changes (same shader, different uniforms)
   *
   * @param scene — the Babylon.js scene to add LinesMesh instances to
   */
  setScene(scene: Scene): void {
    this._scene = scene
    this._meshBuilder = TeslaZapMeshBuilder.createWithDefaults(scene)
    this._zapBuilt = false
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: TeslaZap.Tick(World)
  // ---------------------------------------------------------------------------

  /**
   * Advance the projectile by one game tick.
   *
   * OpenRA 对照: TeslaZap.Tick(World)
   *
   * Decrements the duration counter, tracks the target if enabled,
   * and applies weapon impact while damageDuration is active.
   */
  tick(world: GameWorldManager): void {
    this._ticks++
    if (this._ticksUntilRemove-- <= 0) {
      // OpenRA: world.AddFrameEndTask(w => w.Remove(this))
      world.addFrameEndTask?.(() => {
        world.removeEffect?.(this)
      })
      // Dispose 3D mesh builder when projectile expires (Phase B: 24.B.2)
      if (this._meshBuilder) {
        this._meshBuilder.dispose()
        this._meshBuilder = null
        this._zapBuilt = false
      }
    }

    // Track target
    if (
      this._info.trackTarget &&
      this._args.guidedTarget.isValidFor(this._args.sourceActor)
    ) {
      this._target = this._args.weapon.targetActorCenter
        ? this._args.guidedTarget.centerPosition
        : this._args.guidedTarget.positions.closestToIgnoringPath(
            this._args.source,
          )
    }

    if (this._damageDuration-- > 0) {
      // OpenRA: args.Weapon.Impact(Target.FromPos(target), new WarheadArgs(args))
      const targetStub = { type: 'Terrain', centerPosition: this._target }
      const warheadArgsStub = {
        weapon: this._args.weapon,
        source: this._target,
        sourceActor: this._args.sourceActor,
        weaponTarget: targetStub,
      }
      this._args.weapon.impact(targetStub, warheadArgsStub)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // OpenRA 对照: TeslaZap.Render(WorldRenderer)
  // ---------------------------------------------------------------------------

  /**
   * Collect renderables for this frame.
   *
   * OpenRA 对照: TeslaZap.Render(WorldRenderer)
   *
   * Creates a real TeslaZapRenderable each frame for 3D lightning rendering
   * (LinesMesh + ShaderMaterial with emissive-only glow effect).
   */
  render(worldRenderer: WorldRendererStub): readonly IRenderable[] {
    const targetOffset = WPos.subtract(this._target, this._args.source)

    this._zap = new TeslaZapRenderable(
      this._args.source,
      this._info.zOffset,
      targetOffset,
      this._info.image,
      this._info.brightSequence,
      this._info.brightZaps,
      this._info.dimSequence,
      this._info.dimZaps,
      this._info.palette,
    )

    // Wire 3D mesh rendering if Scene is available (Phase B: 24.B.2)
    if (this._scene && this._meshBuilder) {
      const wr = worldRenderer as unknown as ITeslaZapWorldRenderer
      // Validate that worldRenderer provides the required interface
      if (
        wr &&
        typeof (wr as any).screenPosition === 'function' &&
        wr.world &&
        typeof wr.world.fogObscures === 'function'
      ) {
        try {
          // Reset zap when source/target position changes significantly
          // (e.g., when trackTarget is enabled and target moves)
          if (
            this._zapBuilt &&
            this._lastTargetOffset &&
            !WVec.equals(this._lastTargetOffset, targetOffset)
          ) {
            this._zapBuilt = false
          }
          this._lastTargetOffset = targetOffset

          if (!this._zapBuilt) {
            // First frame or zap geometry changed: build new LinesMesh instances
            this._zap.render(wr)
            this._zap.build3DMeshes(this._meshBuilder)
            this._zapBuilt = true
          } else {
            // Subsequent frames: only update jitter on existing meshes
            // (avoids per-frame mesh disposal/recreation per MAJOR #1 fix)
            this._meshBuilder.updateJitter(this._ticks)
          }
        } catch (err) {
          console.warn(
            'TeslaZap: 3D mesh build failed, falling back to renderable-only mode',
            err,
          )
        }
      }
    }

    return [this._zap as unknown as IRenderable]
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  /** Current target position.
   *
   * OpenRA 对照: TeslaZap.target
   */
  get target(): WPos {
    return this._target
  }

  /** Remaining ticks before removal.
   *
   * OpenRA 对照: TeslaZap.ticksUntilRemove
   */
  get ticksUntilRemove(): number {
    return this._ticksUntilRemove
  }

  /** Damage duration counter.
   *
   * OpenRA 对照: TeslaZap.damageDuration
   */
  get damageDuration(): number {
    return this._damageDuration
  }

  /** The current zap renderable (for testing).
   *
   * OpenRA 对照: TeslaZap.zap
   */
  get zap(): TeslaZapRenderable | null {
    return this._zap
  }
}
