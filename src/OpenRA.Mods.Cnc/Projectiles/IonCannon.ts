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
import { AnimationStub } from '../Effects/AnimationStub.js'

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
  private _weaponDelay: number
  private _impacted: boolean = false
  private _removed: boolean = false

  constructor(
    firedBy: PlayerStub,
    weapon: IonCannon['_weapon'],
    world: unknown,
    _launchPos: WPos,
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

    this._anim = new AnimationStub(world, effect)
    this._anim.playThen(sequence, () => this._finish(world as GameWorldManager))

    // Play sound if available
    // OpenRA: Game.Sound.Play(SoundType.World, weapon.Report, world, launchPos)
    // NOTE: Audio system deferred — stub records the intent for testing
    if (weapon.report && weapon.report.length > 0) {
      void _launchPos // reserved for audio
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
        sourceActor: (this._firedBy as unknown as { playerActor?: unknown }).playerActor,
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
    world.addFrameEndTask?.(() => {
      world.removeEffect?.(this)
    })
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
