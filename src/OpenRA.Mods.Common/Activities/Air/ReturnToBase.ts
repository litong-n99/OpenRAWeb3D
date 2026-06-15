/**
 * ReturnToBase.ts — 返回基地补给活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/ReturnToBase.cs
 *
 * 核心范式转换:
 * - C# actor search (ActorsHavingTrait<Reservable>) → scan world.actors array
 * - C# WVec.FromPDF random offset → simple random vector stub
 * - C# dest.NearestExitOrDefault → duck-typed exit lookup
 * - C# Reservable.IsAvailableFor → duck-typed availability check
 * - C# aircraft.MakeReservation / MoveOntoTarget → duck-typed calls
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { DamageState } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Fly } from './Fly.js'
import { FlyIdle } from './FlyIdle.js'
import { Resupply } from '../Resupply.js'
import { type AircraftLike } from './AircraftFlightUtils.js'

// ---------------------------------------------------------------------------
// Stubs / duck types
// ---------------------------------------------------------------------------

/** Default green target-line color for return-to-base movement. */
const ReturnToBaseGreen: import('../../../OpenRA.Game/Traits/TraitsInterfaces.js').ColorStub = {
  r: 0,
  g: 255,
  b: 0,
  a: 255,
}

/** Minimal Rearmable-like interface. */
interface RearmableLike {
  readonly info: { readonly rearmActors: readonly string[] }
  readonly rearmableAmmoPools: { hasFullAmmo: boolean }[]
}

/** Minimal Repairable-like info. */
interface RepairableInfoLike {
  readonly repairActors: readonly string[]
}

// ---------------------------------------------------------------------------
// ReturnToBase
// ---------------------------------------------------------------------------

/**
 * Return to the nearest resupplier (airfield/helipad) for repair/rearm.
 *
 * OpenRA 对照: ReturnToBase activity
 */
export class ReturnToBase extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private readonly aircraft: AircraftLike
  private readonly repairableInfo: RepairableInfoLike | null
  private readonly rearmable: RearmableLike | null
  private readonly alwaysLand: boolean

  private dest: GameActor | null
  private facing: WAngle | null = null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a ReturnToBase activity.
   *
   * OpenRA 对照: ReturnToBase(Actor self, Actor dest = null, bool alwaysLand = false)
   *
   * @param self — the actor returning to base
   * @param dest — optional predetermined destination building
   * @param alwaysLand — whether to always land at the destination
   */
  constructor(self: GameActor, dest: GameActor | null = null, alwaysLand: boolean = false) {
    super()
    this.dest = dest
    this.alwaysLand = alwaysLand
    this.aircraft = ReturnToBase._resolveAircraft(self)

    const actorAny = self as unknown as {
      info?: { traitInfoOrDefault?: <T>(name: string) => T | null }
      traits?: Map<string, unknown>
    }
    const traitInfoOrDefault = actorAny.info?.traitInfoOrDefault
    this.repairableInfo = traitInfoOrDefault
      ? (traitInfoOrDefault<RepairableInfoLike>('Repairable') as RepairableInfoLike | null)
      : null
    this.rearmable = (actorAny.traits?.get('Rearmable') as RearmableLike | undefined) ?? null
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Find a resupplier and move toward it, land if needed.
   *
   * OpenRA 对照: ReturnToBase.Tick(Actor)
   *
   * @param self — the actor returning to base
   * @returns true when done, false to continue
   */
  override tick(self: GameActor): boolean {
    // Refuse to take off if it would land immediately again.
    if (this.aircraft.forceLanding) {
      return true
    }

    if (this.isCanceling || (self as unknown as { isDead?: boolean }).isDead) {
      return true
    }

    if (
      this.dest === null ||
      (this.dest as unknown as { isDead?: boolean }).isDead ||
      !ReturnToBase._isReservableAvailable(this.dest, self)
    ) {
      this.dest = ReturnToBase.chooseResupplier(self, true)
    }

    if (this.dest === null) {
      const nearestResupplier = ReturnToBase.chooseResupplier(self, false)

      if (nearestResupplier !== null) {
        if (this.aircraft.info.canHover) {
          const distanceFromResupplier = WPos.subtract(
            (nearestResupplier as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero,
            (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero,
          ).horizontalLength

          const infoAny = this.aircraft.info as unknown as {
            waitDistanceFromResupplyBase?: WDist
          }
          const waitDistance = infoAny.waitDistanceFromResupplyBase ?? WDist.Zero
          const distanceLength = waitDistance.length

          // If no pad is available, move near one and wait
          if (distanceFromResupplier > distanceLength) {
            const randomPosition = ReturnToBase._randomVector(self, distanceLength)
            const targetPos = WPos.add(
              (nearestResupplier as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero,
              randomPosition,
            )
            const target = Target.fromPos(targetPos)
            this.queueChild(new Fly(self, target, WDist.Zero, waitDistance, targetPos, ReturnToBaseGreen))
          }

          return false
        }

        this.queueChild(
          new Fly(
            self,
            Target.fromActor(nearestResupplier as never),
            WDist.Zero,
            (this.aircraft.info as unknown as { waitDistanceFromResupplyBase?: WDist }).waitDistanceFromResupplyBase ?? WDist.Zero,
            undefined,
            ReturnToBaseGreen,
          ),
        )
        const idleTicks = (this.aircraft.info as unknown as { numberOfTicksToVerifyAvailableAirport?: number }).numberOfTicksToVerifyAvailableAirport ?? 25
        this.queueChild(new FlyIdle(self, idleTicks))
        return false
      }

      // Prevent an infinite loop in case we'd return to the activity that called ReturnToBase in the first place. Go idle instead.
      const idleTicks = (this.aircraft.info as unknown as { numberOfTicksToVerifyAvailableAirport?: number }).numberOfTicksToVerifyAvailableAirport ?? 25
      this.queueChild(new FlyIdle(self, idleTicks))
      return true
    }

    if (this._shouldLandAtBuilding(self, this.dest)) {
      const exit = ReturnToBase._nearestExit(this.dest, self)
      let offset = WVec.Zero
      if (exit !== null) {
        offset = (exit as unknown as { info?: { spawnOffset?: WVec } }).info?.spawnOffset ?? WVec.Zero
        this.facing = (exit as unknown as { info?: { facing?: WAngle } }).info?.facing ?? null
      }

      // Duck-typed reservation
      const makeReservation = (this.aircraft as unknown as { makeReservation?: (dest: GameActor) => void }).makeReservation
      if (makeReservation) makeReservation.call(this.aircraft, this.dest)

      const moveOntoTarget = (this.aircraft as unknown as {
        moveOntoTarget?: (self: GameActor, target: Target, offset: WVec, facing: WAngle | null, color: unknown) => Activity
      }).moveOntoTarget
      if (moveOntoTarget) {
        this.queueChild(moveOntoTarget.call(this.aircraft, self, Target.fromActor(this.dest as never), offset, this.facing, ReturnToBaseGreen))
      }
      this.queueChild(new Resupply(self, this.dest, WDist.Zero, this.alwaysLand))
      return true
    }

    this.queueChild(new Fly(self, Target.fromActor(this.dest as never), undefined, undefined, undefined, ReturnToBaseGreen))
    return true
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Get target line nodes for rendering.
   *
   * OpenRA 对照: ReturnToBase.TargetLineNodes(Actor)
   */
  override targetLineNodes(_self?: GameActor): TargetLineNode[] {
    const targetLineColor = (this.aircraft.info as unknown as { targetLineColor?: import('../../../OpenRA.Game/Traits/TraitsInterfaces.js').ColorStub }).targetLineColor
    if (this.childActivity === null) {
      if (this.dest !== null && targetLineColor) {
        return [new TargetLineNode(Target.fromActor(this.dest as never), targetLineColor)]
      }
      return []
    }
    return this.childActivity.targetLineNodes(_self ?? ({} as GameActor))
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  /**
   * Choose the nearest available resupplier building.
   *
   * OpenRA 对照: ReturnToBase.ChooseResupplier
   *
   * @param self — the actor needing resupply
   * @param unreservedOnly — if true, only consider resuppliers not reserved by another actor
   * @returns nearest valid resupplier actor, or null if none
   */
  static chooseResupplier(self: GameActor, unreservedOnly: boolean): GameActor | null {
    const actorAny = self as unknown as {
      info?: { traitInfoOrDefault?: <T>(name: string) => T | null }
      owner?: unknown
      world?: { actors?: readonly GameActor[] }
    }
    const traitInfoOrDefault = actorAny.info?.traitInfoOrDefault
    const rearmInfo = traitInfoOrDefault
      ? (traitInfoOrDefault<{ rearmActors: readonly string[] }>('Rearmable') as { rearmActors: readonly string[] } | null)
      : null
    if (rearmInfo === null) return null

    const actors = actorAny.world?.actors ?? []
    const owner = actorAny.owner
    const centerPos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero

    let nearest: GameActor | null = null
    let nearestDist = Number.MAX_SAFE_INTEGER

    for (const a of actors) {
      const aAny = a as unknown as {
        isDead?: boolean
        owner?: unknown
        info?: { name?: string }
      }
      if (aAny.isDead || aAny.owner !== owner) continue
      if (!rearmInfo.rearmActors.includes(aAny.info?.name ?? '')) continue
      if (unreservedOnly && !ReturnToBase._isReservableAvailable(a, self)) continue

      const actorCenter = (a as unknown as { centerPosition?: WPos }).centerPosition
      if (!actorCenter) continue
      const dist = WPos.subtract(actorCenter, centerPos).horizontalLengthSquared
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = a
      }
    }

    return nearest
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Decide whether the aircraft needs to land at the destination building. */
  private _shouldLandAtBuilding(self: GameActor, dest: GameActor): boolean {
    if (this.alwaysLand) return true

    if (
      this.repairableInfo !== null &&
      this.repairableInfo.repairActors.includes((dest as unknown as { info?: { name?: string } }).info?.name ?? '') &&
      (self as unknown as { getDamageState?: () => DamageState }).getDamageState?.() !== DamageState.Undamaged
    ) {
      return true
    }

    return (
      this.rearmable !== null &&
      this.rearmable.info.rearmActors.includes((dest as unknown as { info?: { name?: string } }).info?.name ?? '') &&
      this.rearmable.rearmableAmmoPools.some((p) => !p.hasFullAmmo)
    )
  }

  /** Resolve Aircraft trait from actor via duck typing. */
  private static _resolveAircraft(self: GameActor): AircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const aircraft = actorAny.traits?.get('Aircraft') as AircraftLike | undefined
    if (!aircraft) {
      throw new Error('ReturnToBase requires an Aircraft trait on the actor')
    }
    return aircraft
  }

  /** Check whether a resupplier building is available for this actor. */
  private static _isReservableAvailable(dest: GameActor, self: GameActor): boolean {
    const reservable = (dest as unknown as { reservable?: { isAvailableFor?: (actor: GameActor) => boolean } }).reservable
    return reservable?.isAvailableFor?.(self) ?? true
  }

  /** Find the nearest exit on the destination building (stub). */
  private static _nearestExit(_dest: GameActor, _self: GameActor): unknown {
    // TODO-14.C.B4: Full exit lookup deferred until Building/Exit trait migration
    const destAny = _dest as unknown as {
      traits?: Map<string, unknown>
    }
    if (!destAny.traits) return null
    for (const [, trait] of destAny.traits) {
      const exit = trait as unknown as { nearestExitOrDefault?: (pos: WPos) => unknown }
      if (typeof exit.nearestExitOrDefault === 'function') {
        return exit.nearestExitOrDefault((_self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero)
      }
    }
    return null
  }

  /** Generate a random horizontal offset vector of the given length. */
  private static _randomVector(_self: GameActor, length: number): WVec {
    // Use Math.random for a non-deterministic but uniformly distributed offset.
    // OpenRA's replay determinism would require a consumed world RNG; that is
    // deferred until the sync/random system is fully wired.
    const angle = Math.random() * 2 * Math.PI
    const radius = Math.random() * length
    const x = Math.trunc(radius * Math.cos(angle))
    const y = Math.trunc(radius * Math.sin(angle))
    return new WVec(x, y, 0)
  }
}
