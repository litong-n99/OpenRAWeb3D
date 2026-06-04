/**
 * DelayedImpact.ts — Execute a callback when a projectile reaches its target
 * OpenRA 对照: OpenRA.Game/Effects/DelayedImpact.cs
 *
 * 核心范式转换:
 * - OpenRA DelayedImpact: pure tick delay + IWarhead.DoImpact().
 *   TypeScript version: position-advancing effect that moves from origin
 *   to target at a given speed, then fires onImpact callback.
 *   (per migration plan TODO-3.H.3)
 * - C# IWarhead + WarheadArgs → simplified onImpact callback
 *   (IWarhead/WarheadArgs are not yet migrated — TODO-3.H.3)
 * - C# World.AddFrameEndTask(Action<World>) → world.addFrameEndTask(() => void)
 * - OpenRA's DelayedImpact has no position tracking — the migration plan
 *   adds currentPosition for visual interpolation in future sprite effects
 *
 * 使用场景:
 * - Bullet travel time from weapon to target
 * - Missile flight with visual trail
 * - Artillery shell arc (position interpolation feeds visual trajectory)
 *
 * NOTE: This implementation differs from OpenRA's DelayedImpact in two ways:
 *   1. OpenRA takes IWarhead/arguments directly; this takes a simplified
 *      onImpact callback pending IWarhead migration.
 *   2. OpenRA has no position interpolation; this adds origin-to-target
 *      position advancement per migration plan TODO-3.H.3.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { IEffect } from './IEffect.js'
import type { GameWorldManager } from '../World.js'
import type { WorldRendererStub, IRenderable } from '../Traits/TraitsInterfaces.js'
import { WPos } from '../WPos.js'
import { WDist } from '../WDist.js'
import { Target } from '../Traits/Target.js'

// ---------------------------------------------------------------------------
// DelayedImpact
// ---------------------------------------------------------------------------

/**
 * An IEffect that advances a position from origin toward target at a given
 * speed, then fires a callback upon arrival.
 *
 * OpenRA 对照: OpenRA.Effects.DelayedImpact (IEffect implementation)
 *
 * Each tick(), the internal position moves toward the target by the speed
 * distance. When the remaining distance is <= speed, the position snaps to
 * target and the onImpact callback is scheduled via frame-end task.
 *
 * This differs from DelayedAction in that the delay is computed from
 * distance / speed rather than a fixed tick count. This models projectile
 * flight time more naturally.
 *
 * Usage:
 * ```
 * const origin = WPos.Zero
 * const targetPos = new WPos(10240, 0, 0) // 10 cells east
 * const speed = WDist.fromCells(5) // 5 cells per tick (instant)
 * const effect = new DelayedImpact(
 *   origin,
 *   Target.fromPos(targetPos),
 *   speed,
 *   (t) => console.log(`Impact at ${t.centerPosition}`),
 * )
 * world.addEffect(effect)
 * ```
 */
export class DelayedImpact implements IEffect {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** Target being approached.
   *
   * OpenRA 对照: DelayedImpact.target (Target)
   */
  private readonly _target: Target

  /** Speed in world distance units per tick.
   *
   * NOTE: The migration plan specifies `speed: number`. WDist is used here
   * for consistency with the OpenRA codebase convention for distances.
   */
  private readonly _speed: WDist

  /** Callback fired when the position reaches the target.
   *
   * NOTE: OpenRA uses IWarhead.DoImpact(target, args). This simplified
   * callback replaces that pattern pending IWarhead migration.
   */
  private readonly _onImpact: (target: Target) => void

  /** Current position of the traveling projectile.
   *
   * NOTE: Not present in original OpenRA DelayedImpact. Added per
   * migration plan TODO-3.H.3 to support visual interpolation.
   */
  private _currentPos: WPos

  /** Whether this effect has completed.
   *
   * NOTE: Added per migration plan TODO-3.H.3.
   */
  private _done = false

  /**
   * Whether the impact has been triggered. Guards against double-firing
   * if tick() is called after completion.
   */
  private _impactTriggered = false

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a delayed impact effect.
   *
   * OpenRA 对照: DelayedImpact(int delay, IWarhead wh, Target target, WarheadArgs args)
   *
   * Migration adaptation:
   * - `origin: WPos` replaces the implicit launch position
   * - `speed: WDist` replaces the fixed tick delay; travel time =
   *   distance / speed
   * - `onImpact` replaces IWarhead.DoImpact(target, args)
   *
   * @param origin — starting world position of the projectile
   * @param target — target to approach and impact
   * @param speed — distance traveled per logic tick (WDist units)
   * @param onImpact — callback invoked when projectile reaches target.
   *   Receives the target as it was at construction time (targets may
   *   have become invalid by impact time — callers should validate).
   */
  constructor(
    origin: WPos,
    target: Target,
    speed: WDist,
    onImpact: (target: Target) => void,
  ) {
    this._target = target
    this._speed = speed
    this._onImpact = onImpact
    this._currentPos = origin
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /**
   * Whether this effect has completed and may be removed.
   *
   * NOTE: Added per migration plan TODO-3.H.3.
   */
  get isDone(): boolean {
    return this._done
  }

  /**
   * The current interpolated position of the traveling projectile.
   *
   * Useful for visual effects that need to render the projectile at
   * its current position each frame (e.g., bullet mesh, missile trail).
   *
   * NOTE: Not present in original OpenRA DelayedImpact.
   */
  get currentPosition(): WPos {
    return this._currentPos
  }

  /**
   * The target being approached.
   */
  get target(): Target {
    return this._target
  }

  /**
   * Speed in WDist units per tick.
   */
  get speed(): WDist {
    return this._speed
  }

  // -------------------------------------------------------------------------
  // IEffect implementation
  // -------------------------------------------------------------------------

  /**
   * Advance position toward target. When within range, fire onImpact
   * callback via frame-end task.
   *
   * OpenRA 对照: DelayedImpact.Tick(World)
   *
   * Position advancement:
   * - Computes the vector from currentPos to target centerPosition
   * - If distance <= speed: snap to target, schedule onImpact via
   *   frameEndTask, and mark as done
   * - Otherwise: advance currentPos by speed units along the direction
   *   vector
   *
   * Target validation: The target's centerPosition is queried each tick.
   * If the target is invalid (actor died, etc.), the impact fires
   * immediately at the current position.
   *
   * @param world — the game world manager
   */
  tick(world: GameWorldManager): void {
    // Guard: don't tick after impact already triggered
    if (this._impactTriggered) return

    let targetPos: WPos
    try {
      targetPos = this._target.centerPosition
    } catch {
      // Target is invalid (e.g., actor died). Fire impact immediately
      // at current position.
      this._triggerImpact(world)
      return
    }

    const delta = WPos.subtract(targetPos, this._currentPos)
    const distToTarget = delta.length

    if (distToTarget <= this._speed.length) {
      // Reached target — snap to target position before impact
      this._currentPos = targetPos
      this._triggerImpact(world)
    } else {
      // Advance toward target
      const dirX = delta.X / distToTarget
      const dirY = delta.Y / distToTarget
      const dirZ = delta.Z / distToTarget
      const speedLen = this._speed.length

      this._currentPos = new WPos(
        this._currentPos.X + Math.round(dirX * speedLen),
        this._currentPos.Y + Math.round(dirY * speedLen),
        this._currentPos.Z + Math.round(dirZ * speedLen),
      )
    }
  }

  /**
   * DelayedImpact produces no renderables directly.
   *
   * NOTE: Visual representation (bullet mesh, missile trail) is the
   * responsibility of external rendering code that reads currentPosition
   * each frame via tickRender or onBeforeRenderObservable.
   *
   * OpenRA 对照: DelayedImpact.Render(WorldRenderer) → yield break
   *
   * @returns empty array (equivalent to C# yield break)
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    return []
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Schedule the onImpact callback via frame-end task, remove self from
   * world, and mark as done.
   *
   * The callback is deferred to frameEndTask to avoid modifying collections
   * during tick iteration.
   */
  private _triggerImpact(world: GameWorldManager): void {
    this._impactTriggered = true

    world.addFrameEndTask(() => {
      world.removeEffect(this)
      this._onImpact(this._target)
      this._done = true
    })
  }
}
