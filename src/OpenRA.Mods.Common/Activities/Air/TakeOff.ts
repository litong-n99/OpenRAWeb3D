/**
 * TakeOff.ts — 垂直起飞活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/TakeOff.cs
 *
 * 核心范式转换:
 * - C# TakeOff activity → TypeScript class with static Fly helpers
 * - C# OnFirstRun (sound, influence removal, notifications) → onFirstRun override
 * - C# Tick (VTOL vs non-VTOL ascent) → tick override
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import type { INotifyTakeOff } from './AircraftActivityInterfaces.js'
import type { AircraftLike } from './AircraftFlightUtils.js'
import { flyTick, verticalTakeOffOrLandTick } from './AircraftFlightUtils.js'

// ---------------------------------------------------------------------------
// TakeOff
// ---------------------------------------------------------------------------

/**
 * Take off from the ground, ascending to cruise altitude.
 *
 * OpenRA 对照: TakeOff activity
 *
 * On first run:
 * - Removes ground cell influence
 * - Plays takeoff sound (if below min airborne altitude)
 * - Notifies INotifyTakeOff traits
 *
 * On each tick:
 * - VTOL: rises vertically using VerticalTakeOffOrLandTick
 * - Non-VTOL: flies forward while ascending using FlyTick
 *
 * Returns true when cruise altitude is reached.
 */
export class TakeOff extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Aircraft trait reference. */
  private readonly aircraft: AircraftLike

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a TakeOff activity.
   *
   * OpenRA 对照: TakeOff(Actor)
   *
   * @param self — the actor taking off
   */
  constructor(self: GameActor) {
    super()
    this.aircraft = TakeOff._resolveAircraft(self)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Called once before first tick.
   *
   * OpenRA 对照: TakeOff.OnFirstRun(Actor)
   *
   * Removes influence, plays sound, notifies takeoff traits.
   */
  protected override onFirstRun(self: GameActor): void {
    if (this.aircraft.forceLanding) return

    // Check if has influence (duck-typed hasInfluence)
    const hasInfluence = (this.aircraft as unknown as { hasInfluence?: () => boolean }).hasInfluence?.()
    if (!hasInfluence) return

    // Remove influence in ground cells
    const removeInfluence = (this.aircraft as unknown as { removeInfluence?: () => void }).removeInfluence
    if (removeInfluence) removeInfluence.call(this.aircraft)

    // Check if already above min airborne altitude
    const actorAny = self as unknown as {
      world?: { map?: { distanceAboveTerrain: (pos: { X: number; Y: number; Z: number }) => WDist } }
    }
    const dat = actorAny.world?.map?.distanceAboveTerrain(
      this.aircraft.centerPosition,
    ) ?? WDist.Zero

    if (dat.length > (this.aircraft as unknown as { info: { minAirborneAltitude: number } }).info.minAirborneAltitude)
      return

    // Play takeoff sound
    const sounds = this.aircraft.info as unknown as { takeoffSounds?: readonly string[] }
    if (sounds.takeoffSounds && sounds.takeoffSounds.length > 0) {
      const playSound = (self as unknown as { world?: { playSound?: (type: string, sounds: readonly string[], world: unknown, pos: unknown) => void } }).world?.playSound
      if (playSound) {
        playSound('World', sounds.takeoffSounds, self.world, this.aircraft.centerPosition)
      }
    }

    // Notify INotifyTakeOff traits
    const actorAny2 = self as unknown as { traits?: Map<string, unknown> }
    if (actorAny2.traits) {
      for (const [, trait] of actorAny2.traits) {
        const notify = trait as Partial<INotifyTakeOff>
        if (typeof notify.takeOff === 'function') {
          notify.takeOff(self)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Ascend to cruise altitude.
   *
   * OpenRA 对照: TakeOff.Tick(Actor)
   *
   * @param self — the actor taking off
   * @returns true when cruise altitude reached, false to continue
   */
  override tick(self: GameActor): boolean {
    // Refuse to take off if it would land immediately again
    if (this.aircraft.forceLanding) {
      this.cancel(self)
      return true
    }

    const actorAny = self as unknown as {
      world?: { map?: { distanceAboveTerrain: (pos: { X: number; Y: number; Z: number }) => WDist } }
    }
    const dat = actorAny.world?.map?.distanceAboveTerrain(
      this.aircraft.centerPosition,
    ) ?? WDist.Zero

    if (WDist.lessThan(dat, this.aircraft.info.cruiseAltitude)) {
      // If we're a VTOL, rise before flying forward
      if (this.aircraft.info.vTOL) {
        verticalTakeOffOrLandTick(
          self,
          this.aircraft,
          this.aircraft.facing,
          this.aircraft.info.cruiseAltitude,
        )
        return false
      }

      flyTick(self, this.aircraft, this.aircraft.facing, this.aircraft.info.cruiseAltitude)
      return false
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolve Aircraft trait from actor via duck typing. */
  private static _resolveAircraft(self: GameActor): AircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const aircraft = actorAny.traits?.get('Aircraft') as AircraftLike | undefined
    if (!aircraft) {
      throw new Error('TakeOff requires an Aircraft trait on the actor')
    }
    return aircraft
  }
}
