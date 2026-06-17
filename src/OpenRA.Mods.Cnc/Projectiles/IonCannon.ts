/**
 * IonCannon.ts — 离子炮轨道打击抛射体（从天而降的光束）
 * OpenRA 对照: OpenRA.Mods.Cnc/Effects/IonCannon.cs (73 lines)
 *
 * 核心范式转换:
 * - C# IProjectile (Animation-based beam) → TypeScript IProjectile
 * - C# Animation (2D sprite sequence) → TypeScript animation stub
 *   (3D: descending CylinderMesh + emissive ShaderMaterial, deferred to Phase C)
 * - C# Game.Sound.Play(SoundType.World, ...) → TypeScript audio stub
 * - C# Animation.PlayThen(sequence, callback) → TypeScript tick counter + callback
 * - C# Weapon.Impact(Target, WarheadArgs) → TypeScript weapon stub
 * - C# world.AddFrameEndTask(w => w.Remove(this)) → TypeScript world API
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import type { WorldRendererStub, IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IProjectile } from '../../OpenRA.Mods.Common/Projectiles/Bullet.js'
import type { PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// Animation stub (deferred to Phase C rendering)
// ---------------------------------------------------------------------------

/** Minimal animation stub for the ion cannon beam.
 *
 * OpenRA 对照: Animation (OpenRA.Graphics.Animation)
 *
 * Tracks frame progression and invokes a completion callback.
 * Actual sprite rendering is deferred to Phase C rendering.
 */
class AnimationStub {
  private _ticks: number = 0
  private _length: number = 0
  private _onComplete: (() => void) | null = null
  private _started: boolean = false

  /** The image/sequence name this animation uses.
   *
   * OpenRA 对照: Animation.Image
   */
  readonly image: string

  constructor(_world: unknown, image: string) {
    this.image = image
  }

  /** Start playing a sequence, then call onComplete.
   *
   * OpenRA 对照: Animation.PlayThen(sequence, callback)
   *
   * NOTE: In OpenRA, this plays the animation and automatically calls
   * the callback after the last frame. We approximate with a frame counter
   * based on typical animation lengths (12 frames).
   */
  playThen(sequence: string, onComplete: () => void): void {
    this._started = true
    this._length = 12 // Approximate: most C&C animations are 12 frames
    this._onComplete = onComplete
    void sequence // reserved for rendering pass
  }

  /** Advance the animation by one frame.
   *
   * OpenRA 对照: Animation.Tick()
   */
  tick(): void {
    if (!this._started) return
    this._ticks++
    if (this._ticks >= this._length && this._onComplete) {
      const cb = this._onComplete
      this._onComplete = null
      cb()
    }
  }

  /** Whether the animation has finished playing.
   *
   * OpenRA 对照: Animation.PlayThen → callback invoked
   */
  get isComplete(): boolean {
    return this._ticks >= this._length
  }

  /** Total ticks elapsed since start.
   *
   * OpenRA 对照: Animation.tick counter
   */
  get currentTick(): number {
    return this._ticks
  }

  /** Get renderables for this animation at the given position.
   *
   * OpenRA 对照: Animation.Render(WPos, PaletteReference)
   */
  render(_pos: WPos, _palette: unknown): readonly IRenderable[] {
    // NOTE: Visual rendering deferred to Phase C
    return []
  }
}

// ---------------------------------------------------------------------------
// IonCannon — projectile implementation
// OpenRA 对照: IonCannon : IProjectile
// ---------------------------------------------------------------------------

/**
 * Orbital ion cannon beam projectile.
 *
 * OpenRA 对照: IonCannon
 *
 * A descending beam from the sky to the ground. Plays a sprite animation,
 * fires the weapon on impact after the specified delay, and plays a sound
 * on creation.
 */
export class IonCannon implements IProjectile {
  get isDestroyed(): boolean {
    return this._removed
  }

  private readonly _target: { centerPosition: WPos }
  private readonly _anim: AnimationStub
  private readonly _firedBy: PlayerStub
  private readonly _palette: string
  private readonly _weapon: {
    report?: string | null
    impact(target: unknown, warheadArgs: unknown): void
  }
  private readonly _launchPos: WPos

  private _weaponDelay: number
  private _impacted: boolean = false
  private _removed: boolean = false

  constructor(
    firedBy: PlayerStub,
    weapon: IonCannon['_weapon'],
    world: unknown,
    launchPos: WPos,
    target: { centerPosition: WPos },
    effect: string,
    sequence: string,
    palette: string,
    delay: number,
  ) {
    this._firedBy = firedBy
    this._weapon = weapon
    this._target = target
    this._palette = palette
    this._weaponDelay = delay
    this._launchPos = launchPos

    this._anim = new AnimationStub(world, effect)
    this._anim.playThen(sequence, () => this._finish(world as GameWorldManager))

    // Play sound if available
    // OpenRA: Game.Sound.Play(SoundType.World, weapon.Report, world, launchPos)
    // NOTE: Audio system deferred — stub records the intent for testing
    if (weapon.report && weapon.report.length > 0) {
      void launchPos // reserved
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: IonCannon.Tick(World)
  // ---------------------------------------------------------------------------

  /**
   * Advance the ion cannon by one game tick.
   *
   * OpenRA 对照: IonCannon.Tick(World)
   *
   * Advances the beam animation and applies weapon impact after the delay.
   */
  tick(world: GameWorldManager): void {
    this._anim.tick()

    if (!this._impacted && this._weaponDelay-- <= 0) {
      const warheadArgs = {
        weapon: this._weapon,
        source: this._target.centerPosition,
        sourceActor: this._firedBy.playerActor,
        weaponTarget: this._target,
      }

      this._weapon.impact(this._target, warheadArgs)
      this._impacted = true
    }

    void world // reserved for future frameEndTask integration
  }

  // ---------------------------------------------------------------------------
  // Render
  // OpenRA 对照: IonCannon.Render(WorldRenderer)
  // ---------------------------------------------------------------------------

  /**
   * Collect renderables for this frame.
   *
   * OpenRA 对照: IonCannon.Render(WorldRenderer)
   *
   * Returns animation renderables at the target position.
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    return this._anim.render(this._target.centerPosition, this._palette)
  }

  // ---------------------------------------------------------------------------
  // Finish (private)
  // OpenRA 对照: IonCannon.Finish(World)
  // ---------------------------------------------------------------------------

  /** Called when the animation completes to remove this effect from the world.
   *
   * OpenRA 对照: IonCannon.Finish(World)
   */
  private _finish(world: GameWorldManager): void {
    this._removed = true
    // OpenRA: world.AddFrameEndTask(w => w.Remove(this))
    void world
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  /** Whether the weapon has impacted.
   *
   * OpenRA 对照: IonCannon.impacted
   */
  get impacted(): boolean {
    return this._impacted
  }

  /** Remaining weapon delay ticks.
   *
   * OpenRA 对照: IonCannon.weaponDelay
   */
  get weaponDelay(): number {
    return this._weaponDelay
  }

  /** The animation instance.
   *
   * OpenRA 对照: IonCannon.anim
   */
  get anim(): AnimationStub {
    return this._anim
  }
}
