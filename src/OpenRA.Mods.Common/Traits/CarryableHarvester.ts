/**
 * CarryableHarvester.ts — Allows a harvester to request transport from aircraft
 * OpenRA 对照: OpenRA.Mods.Common/Traits/CarryableHarvester.cs (61 lines)
 *
 * 核心范式转换:
 * - C# INotifyCreated, INotifyHarvestAction, INotifyDockClientMoving → TS forward stubs
 *   (ICallForTransport, INotifyHarvestAction, INotifyDockClientMoving are not yet migrated)
 * - C# self.TraitsImplementing<ICallForTransport>().ToArray() → TS duck-typed trait resolution
 * - C# explicit interface implementation → TS regular methods with TODO markers
 * - C# CPos targetCell → TS CPos (imported)
 *
 * TODO-10.B-Opt.7-TRANSPORT: Requires ICallForTransport, INotifyHarvestAction,
 * INotifyDockClientMoving interfaces (deferred to Ch14/Ch19).
 * When these interfaces are migrated:
 * 1. Replace the forward-declaration stubs with imported interfaces
 * 2. Have CarryableHarvester formally implement INotifyHarvestAction and
 *    INotifyDockClientMoving
 * 3. Wire up the harvester movement events to the transport callback methods
 */

import type {
  ITraitInfo,
  IGameActor,
  INotifyCreated,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Forward-declaration interfaces (not yet migrated)
// OpenRA 对照: ICallForTransport, INotifyHarvestAction, INotifyDockClientMoving
// TODO-10.B-Opt.7-TRANSPORT: Replace with imported interfaces when migrated
// ---------------------------------------------------------------------------

/**
 * Forward-declaration: ICallForTransport
 *
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs ICallForTransport
 *
 * Transport unit interface. Implemented by aircraft (e.g., Carryall) that
 * can pick up and move harvester units.
 *
 * TODO-10.B-Opt.7-TRANSPORT: Replace with real interface when migrated (Ch14/Ch19).
 */
export interface ICallForTransport {
  /** Request transport to a target cell.
   *
   *  OpenRA 对照: ICallForTransport.RequestTransport(Actor self, CPos destination)
   */
  requestTransport(self: IGameActor, destination: CPos): void

  /** Notify that movement was cancelled.
   *
   *  OpenRA 对照: ICallForTransport.MovementCancelled(Actor self)
   */
  movementCancelled(self: IGameActor): void
}

/**
 * Forward-declaration: INotifyHarvestAction
 *
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs INotifyHarvestAction
 *
 * Notifies when a harvester starts moving to resources, cancels movement,
 * or completes harvesting.
 *
 * TODO-10.B-Opt.7-TRANSPORT: Replace with real interface when migrated (Ch14).
 */
export interface INotifyHarvestAction {
  /** Called when the harvester starts moving to resources.
   *
   *  OpenRA 对照: INotifyHarvestAction.MovingToResources(Actor self, CPos targetCell)
   */
  movingToResources(self: IGameActor, targetCell: CPos): void
}

/**
 * Forward-declaration: INotifyDockClientMoving
 *
 * OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs INotifyDockClientMoving
 *
 * Notifies when a dock client (e.g., harvester) starts moving to a dock
 * or cancels its movement.
 *
 * TODO-10.B-Opt.7-TRANSPORT: Replace with real interface when migrated (Ch14).
 */
export interface INotifyDockClientMoving {
  /** Called when the dock client starts moving to a dock.
   *
   *  OpenRA 对照: INotifyDockClientMoving.MovingToDock(Actor self, Actor hostActor, IDockHost host)
   */
  movingToDock(self: IGameActor, hostActor: IGameActor, host: IDockHostStub): void
}

/** Stub for IDockHost — used by INotifyDockClientMoving.
 *
 *  OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs IDockHost
 *
 *  TODO-10.B-Opt.7-TRANSPORT: Replace with real IDockHost when migrated.
 */
export interface IDockHostStub {
  /** The dock position in world coordinates (used to find the target cell).
   *
   *  OpenRA 对照: IDockHost.DockPosition (WPos)
   */
  dockPosition: { X: number; Y: number; Z: number }
}

// ---------------------------------------------------------------------------
// CarryableHarvesterInfo
// OpenRA 对照: CarryableHarvesterInfo (TraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for CarryableHarvester trait.
 *
 *  OpenRA 对照: CarryableHarvesterInfo
 *
 *  This is a marker trait with no additional configuration.
 *  When attached to a harvester, it discovers ICallForTransport traits
 *  and relays harvest/dock movement events to them for air transport.
 */
export class CarryableHarvesterInfo implements ITraitInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }
}

// ---------------------------------------------------------------------------
// CarryableHarvester
// OpenRA 对照: CarryableHarvester (INotifyCreated, INotifyHarvestAction, INotifyDockClientMoving)
// ---------------------------------------------------------------------------

/** Allows a harvester to request transport (e.g., from a Carryall aircraft).
 *
 *  OpenRA 对照: CarryableHarvester
 *
 *  When a harvester starts moving to resources or to a refinery dock,
 *  this trait relays the request to any ICallForTransport traits on the
 *  same actor, which can trigger aircraft pickup.
 *
 *  NOTE: INotifyHarvestAction and INotifyDockClientMoving are not yet
 *  migrated, so the callback methods are declared but not registered
 *  with the notification system. When those interfaces are ready, this
 *  class should formally implement them.
 *
 *  TODO-10.B-Opt.7-TRANSPORT: Implement INotifyHarvestAction and
 *    INotifyDockClientMoving when interfaces are migrated (Ch14/Ch19).
 */
export class CarryableHarvester implements INotifyCreated {
  /** Discovered ICallForTransport traits on this actor.
   *
   *  OpenRA 对照: ICallForTransport[] transports
   */
  private _transports: ICallForTransport[] = []

  /** Trait configuration reference.
   *
   *  OpenRA 对照: CarryableHarvesterInfo (stored implicitly via constructor)
   */
  readonly info: CarryableHarvesterInfo

  constructor(info: CarryableHarvesterInfo) {
    this.info = info
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: INotifyCreated.Created(Actor self)
  // ---------------------------------------------------------------------------

  /** Called after the actor is fully created.
   *
   *  Resolves all ICallForTransport traits on this actor.
   *
   *  OpenRA 对照: CarryableHarvester.Created(Actor self)
   */
  created(self: IGameActor): void {
    this._transports = this._resolveTransports(self)
  }

  // ---------------------------------------------------------------------------
  // Transport relays — mirrors INotifyHarvestAction / INotifyDockClientMoving
  // OpenRA 对照: Explicit interface implementations in CarryableHarvester
  //
  // NOTE: These are regular methods, not interface implementations, because
  // INotifyHarvestAction and INotifyDockClientMoving are not yet migrated.
  // When they are migrated, these should become explicit implementations.
  // TODO-10.B-Opt.7-TRANSPORT: Convert to interface implementations.
  // ---------------------------------------------------------------------------

  /** Called when the harvester starts moving to resources.
   *
   *  OpenRA 对照: INotifyHarvestAction.MovingToResources(Actor self, CPos targetCell)
   *
   *  TODO-10.B-Opt.7-TRANSPORT: This should be called by the harvester
   *  trait when it starts moving to resources.
   */
  movingToResources(self: IGameActor, targetCell: CPos): void {
    for (const t of this._transports) {
      t.requestTransport(self, targetCell)
    }
  }

  /** Called when the harvester's movement is cancelled.
   *
   *  OpenRA 对照: INotifyHarvestAction.MovementCancelled(Actor self)
   *
   *  Also called by INotifyDockClientMoving.MovementCancelled.
   *
   *  TODO-10.B-Opt.7-TRANSPORT: This should be called by the harvester
   *  trait when movement is cancelled.
   */
  movementCancelled(self: IGameActor): void {
    for (const t of this._transports) {
      t.movementCancelled(self)
    }
  }

  /** Called when the dock client starts moving to a dock.
   *
   *  OpenRA 对照: INotifyDockClientMoving.MovingToDock(Actor self, Actor hostActor, IDockHost host)
   *
   *  TODO-10.B-Opt.7-TRANSPORT: This should be called by DockClientBase
   *  when the harvester starts moving to a dock.
   */
  movingToDock(self: IGameActor, _hostActor: IGameActor, host: IDockHostStub): void {
    // NOTE: In the full C# implementation, this converts the dock position
    // to a cell: self.World.Map.CellContaining(host.DockPosition)
    // Since Map.CellContaining(WPos) is not yet available in the TS migration
    // for this context, we use a simplified cell coordinate from the dock position.
    // TODO-10.B-Opt.7-TRANSPORT: Use Map.CellContaining(host.dockPosition) when
    //   World/Map reference is accessible from self.
    const targetCell = new CPos(
      Math.round(host.dockPosition.X),
      Math.round(host.dockPosition.Y),
      0, // Layer 0 for ground-level transport
    )

    for (const t of this._transports) {
      t.requestTransport(self, targetCell)
    }
  }

  /** Called when the harvester completes harvesting.
   *
   *  OpenRA 对照: INotifyHarvestAction.Harvested(Actor self, string resourceType)
   *
   *  When harvesting completes, cancels any transport request.
   *
   *  TODO-10.B-Opt.7-TRANSPORT: This should be called by the harvester
   *  trait when it finishes harvesting.
   */
  harvested(_self: IGameActor, _resourceType: string): void {
    for (const t of this._transports) {
      t.movementCancelled(_self)
    }
  }

  // ---------------------------------------------------------------------------
  // Discovery query
  // ---------------------------------------------------------------------------

  /** Get the list of discovered transport callbacks.
   *
   *  Exposed for testing and debugging.
   */
  get transports(): readonly ICallForTransport[] {
    return this._transports
  }

  /** Get the number of discovered transport traits.
   *
   *  OpenRA 对照: N/A (convenience for testing)
   */
  get transportCount(): number {
    return this._transports.length
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolve ICallForTransport traits from the actor.
   *
   *  OpenRA 对照: self.TraitsImplementing<ICallForTransport>().ToArray()
   *
   *  Uses duck-typing to discover traits that match the ICallForTransport
   *  interface. In the full implementation, this would use the TraitDictionary.
   */
  private _resolveTransports(self: IGameActor): ICallForTransport[] {
    const transports: ICallForTransport[] = []

    // Check for traits exposed via duck-typing discovery pattern
    const actorExt = self as unknown as Record<string, unknown>

    // Look for _transports array (common discovery pattern)
    if (Array.isArray(actorExt._transports)) {
      for (const item of actorExt._transports as unknown[]) {
        if (
          item &&
          typeof (item as ICallForTransport).requestTransport === 'function' &&
          typeof (item as ICallForTransport).movementCancelled === 'function'
        ) {
          transports.push(item as ICallForTransport)
        }
      }
    }

    // Also check if the actor itself has requestTransport (singleton pattern)
    if (
      typeof actorExt.requestTransport === 'function' &&
      typeof actorExt.movementCancelled === 'function'
    ) {
      transports.push(actorExt as unknown as ICallForTransport)
    }

    return transports
  }
}
