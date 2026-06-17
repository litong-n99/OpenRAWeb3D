/**
 * DropPodImpact.ts — 空投降落舱地面冲击抛射体
 * OpenRA 对照: OpenRA.Mods.Cnc/Effects/DropPodImpact.cs (77 lines)
 *
 * 核心范式转换:
 * - C# IProjectile (Animation-based pod descent) → TypeScript IProjectile
 * - C# Animation at launchPos → TypeScript animation stub at launch position
 *   (3D: descending Mesh + particle trail, deferred to Phase C rendering)
 * - C# Game.Sound.Play → TypeScript audio stub
 * - C# Weapon.Impact on target → TypeScript weapon stub
 * - C# Animation.PlayThen(sequence, () => Finish(world)) → TypeScript tick counter
 *
 * Key difference from IonCannon: DropPodImpact renders the animation at the
 * launch position (pod descending from sky) but applies weapon impact at the
 * target position (ground impact).
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
// DropPodImpact — projectile implementation
// OpenRA 对照: DropPodImpact : IProjectile
// ---------------------------------------------------------------------------

/**
 * Drop pod ground impact projectile.
 *
 * OpenRA 对照: DropPodImpact
 *
 * The pod entry animation plays at the launch position (sky entry point)
 * while the weapon impacts the target (ground). This creates the visual
 * of a pod descending from orbit and impacting the ground.
 */
export class DropPodImpact implements IProjectile {
  get isDestroyed(): boolean {
    return this._removed
  }

  private readonly _target: { centerPosition: WPos }
  private readonly _entryAnimation: AnimationStub
  private readonly _firedBy: PlayerStub
  private readonly _entryPalette: string
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
    weapon: DropPodImpact['_weapon'],
    world: unknown,
    launchPos: WPos,
    target: { centerPosition: WPos },
    delay: number,
    entryEffect: string,
    entrySequence: string,
    entryPalette: string,
  ) {
    this._firedBy = firedBy
    this._weapon = weapon
    this._target = target
    this._entryPalette = entryPalette
    this._weaponDelay = delay
    this._launchPos = launchPos

    this._entryAnimation = new AnimationStub(world, entryEffect)
    this._entryAnimation.playThen(entrySequence, () =>
      this._finish(world as GameWorldManager),
    )

    // Play sound if available
    if (weapon.report && weapon.report.length > 0) {
      void launchPos // reserved for audio
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: DropPodImpact.Tick(World)
  // ---------------------------------------------------------------------------

  /**
   * Advance the drop pod by one game tick.
   *
   * OpenRA 对照: DropPodImpact.Tick(World)
   *
   * Advances the entry animation and applies weapon impact after the delay.
   */
  tick(world: GameWorldManager): void {
    this._entryAnimation.tick()

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

    void world
  }

  // ---------------------------------------------------------------------------
  // Render
  // OpenRA 对照: DropPodImpact.Render(WorldRenderer)
  // ---------------------------------------------------------------------------

  /**
   * Collect renderables for this frame.
   *
   * OpenRA 对照: DropPodImpact.Render(WorldRenderer)
   *
   * KEY DIFFERENCE from IonCannon: renders at launchPos, not target center.
   * This shows the pod entry animation in the sky while the weapon hits the ground.
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    return this._entryAnimation.render(this._launchPos, this._entryPalette)
  }

  // ---------------------------------------------------------------------------
  // Finish (private)
  // OpenRA 对照: DropPodImpact.Finish(World)
  // ---------------------------------------------------------------------------

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
   * OpenRA 对照: DropPodImpact.impacted
   */
  get impacted(): boolean {
    return this._impacted
  }

  /** Remaining weapon delay ticks.
   *
   * OpenRA 对照: DropPodImpact.weaponDelay
   */
  get weaponDelay(): number {
    return this._weaponDelay
  }

  /** The entry animation instance.
   *
   * OpenRA 对照: DropPodImpact.entryAnimation
   */
  get entryAnimation(): AnimationStub {
    return this._entryAnimation
  }

  /** The launch position where the animation renders.
   *
   * OpenRA 对照: DropPodImpact.launchPos
   */
  get launchPos(): WPos {
    return this._launchPos
  }
}
