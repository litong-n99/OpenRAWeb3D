/**
 * FlyIdle.ts — 空中盘旋/悬停等待活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/FlyIdle.cs
 *
 * 核心范式转换:
 * - C# INotifyIdle trait implementation → TypeScript interface stub
 * - C# aircraft.FlyStep(speed, facing) → scale flyStep vector by idle/movement speed
 * - C# desiredFacing += WAngle(256) → WAngle.add
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { Fly } from './Fly.js'
import { type AircraftLike } from './AircraftFlightUtils.js'
import type { INotifyIdle } from './AircraftActivityInterfaces.js'

// ---------------------------------------------------------------------------
// FlyIdle
// ---------------------------------------------------------------------------

/**
 * Circle or hover in place for a number of ticks.
 *
 * OpenRA 对照: FlyIdle activity
 *
 * - Non-hover aircraft with default idle speed circle continuously.
 * - Hover aircraft (or aircraft with idle speed 0) stay in place.
 * - Notifies INotifyIdle traits each tick when idleTurn is true.
 */
export class FlyIdle extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Aircraft trait reference. */
  private readonly aircraft: AircraftLike

  /** INotifyIdle traits to tick each update. */
  private readonly tickIdles: INotifyIdle[]

  /** Whether to perform idle turning/circling. */
  private readonly idleTurn: boolean

  /** Remaining ticks (negative = indefinite). */
  private remainingTicks: number

  /** Whether this aircraft should circle while idle. */
  private readonly isIdleTurner: boolean

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a FlyIdle activity.
   *
   * OpenRA 对照: FlyIdle(Actor self, int ticks = -1, bool idleTurn = true)
   *
   * @param self — the actor idling
   * @param ticks — number of ticks to idle (negative = indefinite)
   * @param idleTurn — whether to perform idle turning and notify idle traits
   */
  constructor(self: GameActor, ticks: number = -1, idleTurn: boolean = true) {
    super()
    this.aircraft = FlyIdle._resolveAircraft(self)
    this.idleTurn = idleTurn
    this.remainingTicks = ticks
    this.isIdleTurner =
      this.aircraft.info.idleSpeed > 0 ||
      (!this.aircraft.info.canHover && this.aircraft.info.idleSpeed < 0)

    if (idleTurn) {
      this.tickIdles = FlyIdle._collectNotifyIdleTraits(self)
    } else {
      this.tickIdles = []
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Tick idle behavior: countdown, notify idle traits, circle/hover.
   *
   * OpenRA 对照: FlyIdle.Tick(Actor)
   *
   * @param self — the actor idling
   * @returns true when idle time expires or activity is canceled
   */
  override tick(self: GameActor): boolean {
    if (this.remainingTicks === 0 || (this.nextActivity !== null && this.remainingTicks < 0)) {
      return true
    }

    if (this.aircraft.forceLanding || this.isCanceling) {
      return true
    }

    if (this.remainingTicks > 0) {
      this.remainingTicks--
    }

    for (const tickIdle of this.tickIdles) {
      tickIdle.tickIdle(self)
    }

    if (this.isIdleTurner) {
      // Compute move vector at idle speed by scaling the normal flyStep vector
      const step = this.aircraft.flyStep(this.aircraft.facing)
      let move = step
      if (this.aircraft.movementSpeed !== 0) {
        move = WVec.divide(WVec.multiply(step, this.aircraft.idleMovementSpeed), this.aircraft.movementSpeed)
      }

      // Turn 90° (256 units) per tick for a continuous circle
      const desiredFacing = WAngle.add(this.aircraft.facing, new WAngle(256))
      Fly.flyTick(self, this.aircraft, desiredFacing, this.aircraft.info.cruiseAltitude, move, this.idleTurn)
    }

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
      throw new Error('FlyIdle requires an Aircraft trait on the actor')
    }
    return aircraft
  }

  /** Collect traits implementing INotifyIdle from the actor's trait map. */
  private static _collectNotifyIdleTraits(self: GameActor): INotifyIdle[] {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const result: INotifyIdle[] = []
    if (!actorAny.traits) return result
    for (const [, trait] of actorAny.traits) {
      const notify = trait as Partial<INotifyIdle>
      if (typeof notify.tickIdle === 'function') {
        result.push(notify as INotifyIdle)
      }
    }
    return result
  }
}
