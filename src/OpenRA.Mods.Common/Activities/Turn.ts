/**
 * Turn.ts — 旋转朝向活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Turn.cs
 *
 * 核心范式转换:
 * - C# Turn activity with Mobile/IFacing trait access → TypeScript class with duck-typed trait lookup
 * - C# Util.TickFacing() → WAngle.tickFacing() static method (already migrated in WAngle.ts)
 * - C# IsTraitDisabled/IsTraitPaused → TypeScript boolean flags on Mobile trait
 * - Returns true when facing reached, false while still turning
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'

// ---------------------------------------------------------------------------
// Turn
// ---------------------------------------------------------------------------

/**
 * Turn the actor to face a desired direction.
 *
 * OpenRA 对照: Turn activity
 *
 * Rotates the actor's facing toward the desired facing at the actor's
 * turn speed. Returns true when the desired facing is reached.
 * If the Mobile trait is disabled or paused, the activity waits (returns false).
 *
 * Used by Attack (to face target before firing) and Move (to face direction
 * before moving when turnsWhileMoving is false).
 */
export class Turn extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** The desired facing angle to rotate toward.
   *
   * OpenRA 对照: Turn.desiredFacing
   */
  readonly desiredFacing: WAngle

  /** Duck-typed Mobile trait reference (null if actor has no Mobile). */
  private readonly mobile: {
    isTraitDisabled: boolean
    isTraitPaused: boolean
  } | null

  /** Duck-typed IFacing trait reference (required for turning). */
  private readonly facing: {
    facing: WAngle
    turnSpeed: WAngle
  } | null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a Turn activity.
   *
   * OpenRA 对照: Turn(Actor, WAngle)
   *
   * @param self — the actor to turn
   * @param desiredFacing — the target facing angle
   */
  constructor(self: GameActor, desiredFacing: WAngle) {
    super()
    this.desiredFacing = desiredFacing

    // Resolve Mobile trait (optional — only needed for disabled/paused check)
    const actorAny = self as unknown as {
      traits?: Map<string, unknown>
    }
    this.mobile = (actorAny.traits?.get('Mobile') ?? null) as Turn['mobile']

    // Resolve IFacing trait (required)
    this.facing = (actorAny.traits?.get('facing') ?? null) as Turn['facing']
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Rotate the actor toward the desired facing.
   *
   * OpenRA 对照: Turn.Tick(Actor)
   *
   * Returns true immediately if:
   * - The activity is canceling
   * - The desired facing is already reached
   *
   * Returns false (waits) if:
   * - The Mobile trait is disabled or paused
   * - The actor is still rotating toward the target
   *
   * @param self — the actor performing this activity
   * @returns true if complete, false to continue next tick
   */
  override tick(_self: GameActor): boolean {
    // If canceling, finish immediately
    if (this.isCanceling) return true

    // If Mobile is disabled or paused, wait (can't turn)
    if (this.mobile !== null && (this.mobile.isTraitDisabled || this.mobile.isTraitPaused))
      return false

    // If no facing trait, can't turn — finish immediately
    if (this.facing === null) return true

    // Already at desired facing
    if (this.desiredFacing.angle === this.facing.facing.angle) return true

    // Rotate toward desired facing by one turn step
    this.facing.facing = WAngle.tickFacing(
      this.facing.facing,
      this.desiredFacing,
      this.facing.turnSpeed,
    )

    // Check if we reached the target facing after this tick
    return this.facing.facing.angle === this.desiredFacing.angle
  }
}
