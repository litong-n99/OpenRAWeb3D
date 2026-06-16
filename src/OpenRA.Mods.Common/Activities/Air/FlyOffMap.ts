/**
 * FlyOffMap.ts — 飞离地图活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/FlyOffMap.cs
 *
 * 核心范式转换:
 * - C# ChildHasPriority = false → childHasPriority = false
 * - C# QueueChild(Fly/FlyForward/TakeOff) → queueChild()
 * - C# TickChild → tickChild()
 * - C# self.World.Map.Contains(self.Location) → actor.world.map.contains()
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { Fly } from './Fly.js'
import { FlyForward } from './FlyForward.js'
import { TakeOff } from './TakeOff.js'
import { getDistanceAboveTerrain, type AircraftLike } from './AircraftFlightUtils.js'

// ---------------------------------------------------------------------------
// FlyOffMap
// ---------------------------------------------------------------------------

/**
 * Fly off the edge of the map, optionally via an intermediate target.
 *
 * OpenRA 对照: FlyOffMap activity
 *
 * On first run:
 * - With target: queue Fly to target then FlyForward
 * - Without target: VTOLs take off if needed, then FlyForward
 *
 * On tick:
 * - Once off the map and ending delay expires, cancel the child activity
 * - Delegate to child activity via tickChild
 */
export class FlyOffMap extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Aircraft trait reference. */
  private readonly aircraft: AircraftLike

  /** Optional target to fly toward before leaving the map. */
  private readonly target: Target

  /** Whether a target was provided. */
  private readonly hasTarget: boolean

  /** Delay ticks after leaving the map before canceling the child. */
  private endingDelay: number

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a FlyOffMap activity.
   *
   * Overloads:
   * - FlyOffMap(self, endingDelay = 25)
   * - FlyOffMap(self, target, endingDelay = 25)
   *
   * @param self — the actor leaving the map
   * @param targetOrDelay — either a Target or the ending delay (number)
   * @param endingDelay — ending delay when first argument is a Target
   */
  constructor(self: GameActor, targetOrDelay: Target | number = 25, endingDelay: number = 25) {
    super()
    this.aircraft = FlyOffMap._resolveAircraft(self)
    this.childHasPriority = false

    if (targetOrDelay instanceof Target) {
      this.target = targetOrDelay
      this.hasTarget = true
      this.endingDelay = endingDelay
    } else {
      this.target = Target.Invalid
      this.hasTarget = false
      this.endingDelay = targetOrDelay
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Queue child activities on first run.
   *
   * OpenRA 对照: FlyOffMap.OnFirstRun(Actor)
   */
  protected override onFirstRun(self: GameActor): void {
    if (this.hasTarget) {
      this.queueChild(new Fly(self, this.target))
      this.queueChild(new FlyForward(self))
      return
    }

    // VTOLs must take off first if they're not at cruise altitude
    if (
      this.aircraft.info.vTOL &&
      !WDist.equals(
        getDistanceAboveTerrain(self, this.aircraft.centerPosition),
        this.aircraft.info.cruiseAltitude,
      )
    ) {
      this.queueChild(new TakeOff(self))
    }

    this.queueChild(new FlyForward(self))
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Tick child activity and handle off-map cancellation.
   *
   * OpenRA 对照: FlyOffMap.Tick(Actor)
   *
   * @param self — the actor leaving the map
   * @returns result of tickChild (true when child completes)
   */
  override tick(self: GameActor): boolean {
    // Refuse to take off if it would land immediately again.
    if (this.aircraft.forceLanding) {
      this.cancel(self)
    }

    if (this.isCanceling) {
      return true
    }

    const actorAny = self as unknown as {
      location?: { X: number; Y: number; Bits: number }
      world?: { map?: { contains?: (pos: unknown) => boolean } }
    }
    const location = actorAny.location
    const contains = location !== undefined && actorAny.world?.map?.contains?.(location)
    if (!contains && --this.endingDelay < 0) {
      this._childActivity?.cancel(self)
    }

    return this.tickChild(self)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolve Aircraft trait from actor via duck typing. */
  private static _resolveAircraft(self: GameActor): AircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const aircraft = actorAny.traits?.get('Aircraft') as AircraftLike | undefined
    if (!aircraft) {
      throw new Error('FlyOffMap requires an Aircraft trait on the actor')
    }
    return aircraft
  }
}
