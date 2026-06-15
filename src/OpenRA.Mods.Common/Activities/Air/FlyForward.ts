/**
 * FlyForward.ts — 向前直飞活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/FlyForward.cs
 *
 * 核心范式转换:
 * - C# two constructors (ticks / distance) → TypeScript constructor overload
 * - C# Fly.FlyTick static call → TypeScript Fly.flyTick
 * - C# aircraft.FlyStep horizontal length → WVec.horizontalLength
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { Fly } from './Fly.js'
import { type AircraftLike } from './AircraftFlightUtils.js'

// ---------------------------------------------------------------------------
// FlyForward
// ---------------------------------------------------------------------------

/**
 * Fly forward at current facing for a fixed number of ticks or distance.
 *
 * OpenRA 对照: FlyForward activity
 *
 * Used by FlyOffMap and attack runs to make the aircraft continue moving
 * forward without targeting a specific destination.
 */
export class FlyForward extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Aircraft trait reference. */
  private readonly aircraft: AircraftLike

  /** Cruise altitude (cached from info). */
  private readonly cruiseAltitude: WDist

  /** Number of ticks to fly (negative = indefinite). */
  private readonly flyTicks: number

  /** Remaining horizontal distance to travel (distance mode). */
  private remainingDistance: number = 0

  /** Elapsed ticks (tick mode). */
  private ticks: number = 0

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a FlyForward activity.
   *
   * Overloads:
   * - FlyForward(self, ticks = -1)
   * - FlyForward(self, distance)
   *
   * @param self — the actor flying forward
   * @param ticksOrDistance — number of ticks (number) or distance (WDist)
   */
  constructor(self: GameActor, ticksOrDistance: number | WDist = -1) {
    super()
    this.aircraft = FlyForward._resolveAircraft(self)
    this.cruiseAltitude = this.aircraft.info.cruiseAltitude

    if (ticksOrDistance instanceof WDist) {
      this.flyTicks = 0
      this.remainingDistance = ticksOrDistance.length
    } else {
      this.flyTicks = ticksOrDistance
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Fly forward one tick.
   *
   * OpenRA 对照: FlyForward.Tick(Actor)
   *
   * @param self — the actor flying forward
   * @returns true when completed or canceled, false to continue
   */
  override tick(self: GameActor): boolean {
    // Refuse to take off if it would land immediately again.
    if (this.aircraft.forceLanding) {
      this.cancel(self)
      return true
    }

    // Having flyTicks < 0 is valid and means the actor flies until canceled.
    if (
      this.isCanceling ||
      (this.flyTicks > 0 && this.ticks++ >= this.flyTicks) ||
      (this.flyTicks === 0 && this.remainingDistance <= 0)
    ) {
      return true
    }

    // FlyTick moves the aircraft while FlyStep calculates how far we are moving
    if (this.remainingDistance !== 0) {
      this.remainingDistance -= this.aircraft.flyStep(this.aircraft.facing).horizontalLength
    }

    Fly.flyTick(self, this.aircraft, this.aircraft.facing, this.cruiseAltitude)
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
      throw new Error('FlyForward requires an Aircraft trait on the actor')
    }
    return aircraft
  }
}
