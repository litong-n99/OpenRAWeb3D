/**
 * FreeActorWithDelivery.ts — 建筑物赠送单位并通过运载工具交付
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/FreeActorWithDelivery.cs (107 lines)
 *
 * 核心范式转换:
 * - C# FreeActorWithDelivery : FreeActor → TS FreeActorWithDelivery
 *   (FreeActor base class not yet migrated — core spawning logic inlined)
 * - C# World.CreateActor → TS duck-typed world.createActor()
 * - C# Carryall.AttachCarryable + Carrier.QueueActivity → TS duck-typed trait calls
 * - C# DeliverUnit + Fly + RemoveSelf activities → TS duck-typed activity creation
 * - C# Map.ChooseClosestEdgeCell → TS duck-typed map method
 * - C# TraitEnabled override → TS public doDelivery() method
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// FreeActorWithDeliveryInfo
// OpenRA 对照: FreeActorWithDeliveryInfo : FreeActorInfo
// ---------------------------------------------------------------------------

/** Configuration for a free actor delivered via carryall.
 *
 * OpenRA 对照: FreeActorWithDeliveryInfo
 */
export class FreeActorWithDeliveryInfo {
  readonly instanceName?: string

  /** Name of the actor to create (e.g., "harvester").
   *
   * OpenRA 对照: FreeActorInfo.Actor
   */
  readonly actor: string

  /** Name of the delivering actor (e.g., "carryall").
   *
   * OpenRA 对照: FreeActorWithDeliveryInfo.DeliveringActor
   */
  readonly deliveringActor: string

  /** Spawn location for the carrier (CPos). If Zero, uses closest edge cell.
   *
   * OpenRA 对照: FreeActorWithDeliveryInfo.SpawnLocation
   */
  readonly spawnLocation: CPos

  /** Offset relative to building top-left for delivery.
   *
   * OpenRA 对照: FreeActorWithDeliveryInfo.DeliveryOffset
   */
  readonly deliveryOffset: CPos

  /** Search range for alternative delivery location.
   *
   * OpenRA 对照: FreeActorWithDeliveryInfo.DeliveryRange
   */
  readonly deliveryRange: number

  /** Whether to allow respawning.
   *
   * OpenRA 对照: FreeActorInfo.AllowRespawn
   */
  readonly allowRespawn: boolean

  constructor(params: {
    instanceName?: string
    actor?: string
    deliveringActor?: string
    spawnLocation?: { X: number; Y: number }
    deliveryOffset?: { X: number; Y: number }
    deliveryRange?: number
    allowRespawn?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.actor = params.actor ?? 'harvester'
    this.deliveringActor = params.deliveringActor ?? 'carryall'
    this.spawnLocation = params.spawnLocation
      ? new CPos(params.spawnLocation.X, params.spawnLocation.Y)
      : CPos.Zero
    this.deliveryOffset = params.deliveryOffset
      ? new CPos(params.deliveryOffset.X, params.deliveryOffset.Y)
      : CPos.Zero
    this.deliveryRange = params.deliveryRange ?? 0
    this.allowRespawn = params.allowRespawn ?? true
  }

  /** Create the runtime trait instance.
   *
   * OpenRA 对照: FreeActorWithDeliveryInfo.Create(ActorInitializer)
   */
  create(init: { self: IGameActor }): FreeActorWithDelivery {
    return new FreeActorWithDelivery(init.self, this)
  }
}

// ---------------------------------------------------------------------------
// FreeActorWithDelivery
// OpenRA 对照: FreeActorWithDelivery : FreeActor
// ---------------------------------------------------------------------------

/** Delivers a free actor to a refinery via carryall.
 *
 * OpenRA 对照: FreeActorWithDelivery (extends FreeActor)
 *
 * Used by HarvesterInsurance: when a harvester is destroyed, this trait
 * spawns a replacement harvester and delivers it via carryall to the
 * refinery's delivery point.
 */
export class FreeActorWithDelivery {
  readonly info: FreeActorWithDeliveryInfo

  /** The building actor that owns this trait. */
  private readonly _self: IGameActor

  /** Whether spawning is currently allowed.
   *
   * OpenRA 对照: FreeActor.allowSpawn
   */
  protected allowSpawn: boolean

  constructor(self: IGameActor, info: FreeActorWithDeliveryInfo) {
    this._self = self
    this.info = info
    this.allowSpawn = true
  }

  // -----------------------------------------------------------------------
  // DoDelivery (对应 OpenRA FreeActorWithDelivery.DoDelivery)
  // -----------------------------------------------------------------------

  /** Spawn a cargo actor and deliver it via carrier to the location.
   *
   * OpenRA 对照: FreeActorWithDelivery.DoDelivery(CPos, string, string)
   *
   * Creates both the cargo (e.g., harvester) and carrier (e.g., carryall),
   * attaches them, then queues the delivery flight path on the carrier.
   *
   * @param location — delivery destination cell
   * @param actorName — the cargo actor type to spawn
   * @param carrierActorName — the carrier actor type to spawn
   */
  doDelivery(
    location: CPos,
    actorName: string,
    carrierActorName: string,
  ): void {
    const world = this._self.world as unknown as {
      createActor?: (addToWorld: boolean, actorName: string, init: unknown[]) => IGameActor
      map?: {
        centerOfCell?: (cell: CPos) => WPos
        chooseClosestEdgeCell?: (loc: CPos) => CPos
        facingBetween?: (from: CPos, to: CPos, defaultFacing: unknown) => unknown
        rules?: {
          actors?: Map<string, { traitInfoOrDefault?: <T>(name: string) => T | null }>
        }
      }
      addFrameEndTask?: (fn: (w: unknown) => void) => void
      add?: (actor: IGameActor) => void
    }

    if (!world.createActor || !world.map) return

    // Determine spawn location
    let spawnLoc = this.info.spawnLocation
    if (CPos.equals(spawnLoc, CPos.Zero) && world.map.chooseClosestEdgeCell) {
      const selfLoc = (this._self as unknown as { location?: CPos }).location ?? CPos.Zero
      spawnLoc = world.map.chooseClosestEdgeCell(selfLoc)
    }

    const owner = (this._self as unknown as { owner?: unknown }).owner
    const spawnPos = world.map.centerOfCell
      ? world.map.centerOfCell(spawnLoc)
      : new WPos(spawnLoc.X * 1024 + 512, spawnLoc.Y * 1024 + 512, 0)

    const selfLoc = (this._self as unknown as { location?: CPos }).location ?? CPos.Zero
    const initialFacing = world.map.facingBetween
      ? world.map.facingBetween(spawnLoc, selfLoc, 0)
      : 0

    // Check for AircraftInfo to adjust spawn altitude
    let spawnPosZ = spawnPos.Z
    if (world.map.rules?.actors) {
      const carrierInfo = world.map.rules.actors.get(carrierActorName.toLowerCase())
      const aircraftInfo = carrierInfo?.traitInfoOrDefault?.<{ cruiseAltitude?: { length: number } }>('AircraftInfo')
      if (aircraftInfo?.cruiseAltitude) {
        spawnPosZ += aircraftInfo.cruiseAltitude.length
      }
    }
    const adjustedSpawnPos = new WPos(spawnPos.X, spawnPos.Y, spawnPosZ)

    // Create carrier actor
    const carrier = world.createActor(false, carrierActorName, [
      { name: 'LocationInit', value: spawnLoc },
      { name: 'CenterPositionInit', value: adjustedSpawnPos },
      { name: 'OwnerInit', value: owner },
      { name: 'FacingInit', value: initialFacing },
    ])

    // Create cargo actor
    const cargo = world.createActor(false, actorName, [
      { name: 'OwnerInit', value: owner },
    ])

    // Attach cargo to carrier
    this._attachCargoToCarrier(cargo, carrier)

    // Queue delivery activities on carrier
    const deliveryRange = this.info.deliveryRange
    this._queueDeliveryActivities(carrier, location, deliveryRange)

    // Add carrier to world
    world.addFrameEndTask?.(w => {
      ;(w as unknown as { add?: (a: IGameActor) => void }).add?.(carrier)
    })
  }

  // -----------------------------------------------------------------------
  // Private: attach cargo to carrier via Carryable + Carryall traits
  // -----------------------------------------------------------------------

  /** Reserve cargo with carrier and attach.
   *
   * OpenRA 对照: carryable.Reserve + carryall.AttachCarryable
   */
  private _attachCargoToCarrier(cargo: IGameActor, carrier: IGameActor): void {
    const cargoAny = cargo as unknown as Record<string, unknown>
    const carrierAny = carrier as unknown as Record<string, unknown>

    // Get Carryable trait from cargo
    const carryable = typeof cargoAny['trait'] === 'function'
      ? (cargoAny['trait'] as (name: string) => unknown)('Carryable')
      : null
    const carryableObj = carryable as { reserve?: (cargo: IGameActor, carrier: IGameActor) => void } | null

    // Get Carryall trait from carrier
    const carryall = typeof carrierAny['trait'] === 'function'
      ? (carrierAny['trait'] as (name: string) => unknown)('Carryall')
      : null
    const carryallObj = carryall as {
      attachCarryable?: (carrier: IGameActor, cargo: IGameActor) => void
      info?: { targetLineColor?: unknown }
    } | null

    carryableObj?.reserve?.(cargo, carrier)
    carryallObj?.attachCarryable?.(carrier, cargo)
  }

  // -----------------------------------------------------------------------
  // Private: queue delivery flight activities on carrier
  // -----------------------------------------------------------------------

  /** Queue DeliverUnit → Fly(edge) → RemoveSelf activities.
   *
   * OpenRA 对照: DeliverUnit + Fly(edge) + RemoveSelf
   */
  private _queueDeliveryActivities(
    carrier: IGameActor,
    deliveryLocation: CPos,
    deliveryRange: number,
  ): void {
    const carrierAny = carrier as unknown as Record<string, unknown>
    const queueActivity = carrierAny['queueActivity'] as
      | ((activity: unknown) => void)
      | undefined

    if (!queueActivity) return

    const world = this._self.world as unknown as {
      map?: {
        centerOfCell?: (cell: CPos) => WPos
        chooseRandomEdgeCell?: (random: unknown) => CPos
      }
    }

    // DeliverUnit activity
    const deliveryTarget = Target.fromCell(deliveryLocation)
    queueActivity({
      type: 'DeliverUnit',
      target: deliveryTarget,
      deliveryRange,
      tick: () => true, // simplified: completes immediately in stub
    })

    // Fly to random edge cell
    if (world.map?.chooseRandomEdgeCell) {
      const random = (this._self.world as unknown as Record<string, unknown>).sharedRandom
      const edgeCell = world.map.chooseRandomEdgeCell(random ?? Math)
      const edgeTarget = Target.fromCell(edgeCell)
      queueActivity({
        type: 'Fly',
        target: edgeTarget,
        tick: () => true,
      })
    }

    // RemoveSelf activity
    queueActivity({
      type: 'RemoveSelf',
      tick: () => {
        ;(carrier as unknown as { dispose?: () => void }).dispose?.()
        return true
      },
    })
  }
}
