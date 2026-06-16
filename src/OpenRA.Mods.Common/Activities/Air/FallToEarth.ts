/**
 * FallToEarth.ts — 坠机活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/FallToEarth.cs
 *
 * 核心范式转换:
 * - C# FallsToEarthInfo → TypeScript FallsToEarthInfo (already migrated in Ch9)
 * - C# self.World.SharedRandom.Next → Math.random() (or world.sharedRandom)
 * - C# info.ExplosionWeapon.Impact → duck-typed weapon.impact()
 * - C# self.Kill(self) → actor.kill(self)
 * - C# IsInterruptible = false → isInterruptible = false
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { FallsToEarthInfo } from '../../Traits/Air/FallsToEarth.js'
import { getDistanceAboveTerrain, type AircraftLike } from './AircraftFlightUtils.js'

// ---------------------------------------------------------------------------
// FallToEarth
// ---------------------------------------------------------------------------

/**
 * Crash a destroyed aircraft to the ground, optionally spinning and moving forward.
 *
 * OpenRA 对照: FallToEarth activity
 *
 * - Non-interruptible.
 * - On ground contact: triggers explosion weapon and kills the actor.
 */
export class FallToEarth extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private readonly aircraft: AircraftLike
  private readonly info: FallsToEarthInfo
  private readonly acceleration: number
  private spin: number = 0

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a FallToEarth activity.
   *
   * OpenRA 对照: FallToEarth(Actor self, FallsToEarthInfo info)
   *
   * @param self — the crashing actor
   * @param info — falls-to-earth configuration
   */
  constructor(self: GameActor, info: FallsToEarthInfo) {
    super()
    this.info = info
    this.isInterruptible = false
    this.aircraft = FallToEarth._resolveAircraft(self)

    const maxSpin = this.info.maximumSpinSpeed
    if (maxSpin === null || !WAngle.equals(maxSpin, WAngle.Zero)) {
      // Random acceleration: -1 or +1. Use Math.random; deterministic replay
      // RNG integration is deferred until the sync/random system is wired.
      this.acceleration = Math.random() < 0.5 ? -1 : 1
    } else {
      this.acceleration = 0
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Fall/spin toward the ground.
   *
   * OpenRA 对照: FallToEarth.Tick(Actor)
   *
   * @param self — the crashing actor
   * @returns true when ground contact is made
   */
  override tick(self: GameActor): boolean {
    const dat = getDistanceAboveTerrain(self, this.aircraft.centerPosition)
    if (dat.length <= 0) {
      // Use FromPos since this actor is killed. Cannot use Target.FromActor
      const weapon = this.info.explosionWeapon as { impact?: (target: Target, actor: GameActor) => void } | null
      if (weapon?.impact) {
        weapon.impact(Target.fromPos(this.aircraft.centerPosition), self)
      }

      const kill = (self as unknown as { kill?: (source: GameActor) => void }).kill
      if (kill) kill.call(self, self)

      this.cancel(self)
      return true
    }

    if (this.acceleration !== 0) {
      const maxSpin = this.info.maximumSpinSpeed
      if (maxSpin === null || Math.abs(this.spin) < maxSpin.angle) {
        this.spin += 4 * this.acceleration
      }

      // Allow for negative spin values and convert from facing to angle units
      this.aircraft.facing = new WAngle(this.aircraft.facing.angle + this.spin)
    }

    const move = this.info.moves
      ? this.aircraft.flyStep(this.aircraft.facing)
      : WVec.Zero
    const fallMove = new WVec(move.X, move.Y, -this.info.velocity.length)
    this.aircraft.setPosition(self, WPos.add(this.aircraft.centerPosition, fallMove))

    return false
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolve Aircraft trait from actor via duck typing. */
  private static _resolveAircraft(self: GameActor): AircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const aircraft = actorAny.traits?.get('Aircraft') as AircraftLike | undefined
    if (!aircraft) {
      throw new Error('FallToEarth requires an Aircraft trait on the actor')
    }
    return aircraft
  }
}
