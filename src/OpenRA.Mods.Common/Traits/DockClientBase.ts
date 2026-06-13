/**
 * DockClientBase.ts — Abstract generic base class for docking client units
 * OpenRA 对照: OpenRA.Mods.Common/Traits/DockClientBase.cs
 *
 * 核心范式转换:
 * - C# DockClientBase<InfoType> : ConditionalTrait<InfoType>, IDockClient, INotifyCreated
 *   → TS DockClientBase<T> : ConditionalTrait<T>, IResolveOrder
 * - C# virtual methods with default impl → TS abstract methods (subclass must implement all)
 * - C# self.TraitOrDefault<DockClientManager>() → deferred to Chapter 14 (DockClientManager)
 * - C# Actor concrete type → TS IGameActor forward interface
 * - C# BitSet<DockType> → TS DockTypeValue (number bitmask)
 * - Actual docking Activity (MoveToDock, Dock) deferred to Chapter 14 Phase D
 *
 * DockClientBase is the base class for units that can dock at host buildings:
 * - Harvester (docks at Refinery for Unload)
 * - RepairClient (docks at RepairPad for Repair)
 * - RefuelClient (docks at RefuelPad for Refuel)
 *
 * Subclasses must implement all abstract methods. The docking lifecycle is:
 *   1. canDock / canDockAt — permission checks before issuing dock order
 *   2. createMoveToDockActivity — move to dock position
 *   3. onDockStarted — docking begins
 *   4. onDockTick — per-tick during dock (returns true when complete)
 *   5. onDockCompleted — docking finished
 *
 * TODO-10.A.0: DockClientManager integration deferred to Chapter 14.
 * TODO-14.D: Actual Dock/MoveToDock Activity implementation.
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type IResolveOrder,
  type IDockHost,
  type ActivityStub,
  DockType,
  type DockTypeValue,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// DockClientBaseInfo
// OpenRA 对照: DockClientBaseInfo (abstract, ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration base class for docking client traits.
 *
 *  OpenRA 对照: DockClientBaseInfo : ConditionalTraitInfo, IDockClientInfo
 *
 *  In C#, DockClientBaseInfo is an empty abstract class. Subclasses
 *  (HarvesterInfo, etc.) add their own fields.
 *
 *  The TS version adds `type` and `color` fields that are common to
 *  docking client info classes. Subclasses should extend this and
 *  add their specific configuration fields.
 */
export abstract class DockClientBaseInfo implements ConditionalTraitInfo {
  /** Optional instance name for trait disambiguation.
   *
   *  OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /** Condition expression that must be satisfied for this trait to be active.
   *
   *  OpenRA 对照: ConditionalTraitInfo.RequiresCondition
   */
  readonly requiresCondition?: string

  /** The docking type(s) this client supports — bitmask of DockType values.
   *
   *  OpenRA 对照: HarvesterInfo.Type (BitSet<DockType>, default: Unload)
   *
   *  Multiple types can be combined with bitwise OR.
   *  Example: DockType.Unload | DockType.Repair
   */
  readonly type: DockTypeValue

  /** Color used for docking visualization (e.g., target line, dock indicator).
   *
   *  OpenRA 对照: N/A (TS extension for 3D visualization)
   */
  readonly color: ColorStub

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    type?: DockTypeValue
    color?: ColorStub
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.type = params.type ?? DockType.Unload
    this.color = params.color ?? { r: 0, g: 1, b: 0, a: 1 }
  }
}

// ---------------------------------------------------------------------------
// DockClientBase
// OpenRA 对照: DockClientBase<InfoType> (abstract, ConditionalTrait<InfoType>)
// ---------------------------------------------------------------------------

/** Abstract generic base class for docking client units.
 *
 *  OpenRA 对照: DockClientBase<InfoType> : ConditionalTrait<InfoType>, IDockClient, INotifyCreated
 *
 *  Provides the docking lifecycle contract that subclasses must implement.
 *  The actual docking Activity (MoveToDock, Dock) is deferred to Chapter 14.
 *
 *  Subclasses:
 *  - Harvester (docks at Refinery to unload resources) — TODO-10.A.1
 *  - RepairClient (docks at RepairPad to repair) — deferred
 *  - RefuelClient (docks at RefuelPad) — deferred
 *
 *  @typeParam T — the specific DockClientBaseInfo subclass for this trait
 */
export abstract class DockClientBase<T extends DockClientBaseInfo>
  extends ConditionalTrait<T>
  implements IResolveOrder
{
  constructor(info: T) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // Abstract docking type accessor
  // -----------------------------------------------------------------------

  /** Get the docking type bitmask for this client.
   *
   *  OpenRA 对照: IDockClient.GetDockType
   *
   *  @returns a bitmask of DockType values this client supports
   */
  abstract getDockType(): DockTypeValue

  // -----------------------------------------------------------------------
  // Abstract docking permission checks
  // -----------------------------------------------------------------------

  /** Check whether this client can dock using the given dock type.
   *
   *  OpenRA 对照: IDockClient.CanDock(BitSet<DockType>, bool)
   *
   *  Does NOT check if DockClientManager is enabled.
   *
   *  @param type — the dock type(s) to check (bitmask)
   *  @param forceEnter — if true, bypass certain restrictions
   *  @returns true if docking is allowed
   */
  abstract canDock(type: DockTypeValue, forceEnter?: boolean): boolean

  /** Check whether this client can dock at a specific host.
   *
   *  OpenRA 对照: IDockClient.CanDockAt(Actor, IDockHost, bool, bool)
   *
   *  Does NOT check if DockClientManager is enabled.
   *
   *  @param host — the host actor to check
   *  @param hostTrait — the host's IDockHost trait
   *  @param forceEnter — if true, bypass certain restrictions
   *  @param ignoreOccupancy — if true, ignore reservation count limits
   *  @returns true if docking at this host is allowed
   */
  abstract canDockAt(
    host: IGameActor,
    hostTrait: IDockHost,
    forceEnter?: boolean,
    ignoreOccupancy?: boolean,
  ): boolean

  /** Check whether this client can queue a dock order for a specific host.
   *
   *  OpenRA 对照: IDockClient.CanQueueDockAt(Actor, IDockHost, bool, bool)
   *
   *  Does NOT check if DockClientManager is enabled.
   *
   *  @param host — the host actor to check
   *  @param hostTrait — the host's IDockHost trait
   *  @param forceEnter — if true, bypass certain restrictions
   *  @param isQueued — whether this order is queued (not immediate)
   *  @returns true if a dock order can be queued for this host
   */
  abstract canQueueDockAt(
    host: IGameActor,
    hostTrait: IDockHost,
    forceEnter?: boolean,
    isQueued?: boolean,
  ): boolean

  // -----------------------------------------------------------------------
  // Abstract docking lifecycle callbacks
  // -----------------------------------------------------------------------

  /** Called when docking begins.
   *
   *  OpenRA 对照: IDockClient.OnDockStarted(Actor, Actor, IDockHost)
   *
   *  @param self — this actor
   *  @param host — the host actor being docked at
   *  @param hostTrait — the host's IDockHost trait
   */
  abstract onDockStarted(
    self: IGameActor,
    host: IGameActor,
    hostTrait: IDockHost,
  ): void

  /** Called every tick during docking.
   *
   *  OpenRA 对照: IDockClient.OnDockTick(Actor, Actor, IDockHost) -> bool
   *
   *  @param self — this actor
   *  @param host — the host actor being docked at
   *  @param hostTrait — the host's IDockHost trait
   *  @returns true when docking is complete, false if still in progress
   */
  abstract onDockTick(
    self: IGameActor,
    host: IGameActor,
    hostTrait: IDockHost,
  ): boolean

  /** Called when docking is complete.
   *
   *  OpenRA 对照: IDockClient.OnDockCompleted(Actor, Actor, IDockHost)
   *
   *  @param self — this actor
   *  @param host — the host actor that was docked at
   *  @param dock — the host's IDockHost trait
   */
  abstract onDockCompleted(
    self: IGameActor,
    host: IGameActor,
    dock: IDockHost,
  ): void

  // -----------------------------------------------------------------------
  // Abstract activity factory methods
  // Activities deferred to Chapter 14 Phase D
  // -----------------------------------------------------------------------

  /** Create the Activity for docking at a host.
   *
   *  OpenRA 对照: N/A (C# uses DockClientManager to manage docking Activity)
   *
   *  The actual Dock Activity is deferred to Chapter 14. Subclasses MUST
   *  return an Activity stub that the order system can queue.
   *
   *  @param self — this actor
   *  @param host — the host actor to dock at
   *  @returns an Activity stub for the docking operation
   *
   *  TODO-14.D: Replace Activity stub with full Dock Activity implementation.
   */
  abstract createDockActivity(
    self: IGameActor,
    host: IGameActor,
  ): ActivityStub

  /** Create the Activity for moving to the dock position.
   *
   *  OpenRA 对照: N/A (C# uses DockClientManager to manage movement Activity)
   *
   *  The actual MoveToDock Activity is deferred to Chapter 14. Subclasses MUST
   *  return an Activity stub that the order system can queue.
   *
   *  @param self — this actor
   *  @param host — the host actor to move toward
   *  @returns an Activity stub for the move-to-dock operation
   *
   *  TODO-14.D: Replace Activity stub with full MoveToDock Activity implementation.
   */
  abstract createMoveToDockActivity(
    self: IGameActor,
    host: IGameActor,
  ): ActivityStub

  // -----------------------------------------------------------------------
  // IResolveOrder — handle Dock orders
  // -----------------------------------------------------------------------

  /** Handle a player-issued order.
   *
   *  OpenRA 对照: N/A (C# Harvester implements IResolveOrder directly;
   *    DockClientBase does not. TS adaptation moves dock order resolution
   *    to the base class for reuse across all docking clients.)
   *
   *  Default implementation handles the "Dock" order. Subclasses can
   *  override to add additional order types (Harvest, Deliver, etc.)
   *  and should call super.resolveOrder() for Dock order handling.
   *
   *  @param self — this actor
   *  @param order — the order to resolve
   */
  resolveOrder(self: IGameActor, order: Order): void {
    if (order.orderName === 'Dock') {
      const host = this.getDockHost(self, order)
      if (host) {
        const hostTrait = this.findDockHostTrait(host)
        if (hostTrait && this.canDockAt(host, hostTrait)) {
          const moveActivity = this.createMoveToDockActivity(self, host)
          const dockActivity = this.createDockActivity(self, host)
          // Queue activities: first move to dock, then dock
          moveActivity.queue(dockActivity)
          self.queueActivity?.(moveActivity)
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Protected helper methods
  // -----------------------------------------------------------------------

  /** Find and validate the dock host actor from a Dock order.
   *
   *  OpenRA 对照: N/A (TS adaptation — combines target resolution and validation)
   *
   *  Default implementation attempts to resolve the host from the order's
   *  target string. Subclasses may override to provide more sophisticated
   *  lookup (e.g., using World.actors).
   *
   *  @param self — this actor
   *  @param order — the dock order
   *  @returns the host IGameActor if found and valid, null otherwise
   *
   *  TODO-10.A.0: Once World/actor lookup is fully available, enhance to
   *  use TraitDictionary for IDockHost validation.
   */
  protected getDockHost(
    _self: IGameActor,
    order: Order,
  ): IGameActor | null {
    // NOTE: OrderStub only has orderName, targetString, extraData.
    // Full actor resolution requires World infrastructure (Ch3).
    // Subclasses should override with proper actor lookup.
    if (!order.targetString || order.targetString === '') return null

    // HACK: extraData may contain the host actor reference.
    // This is a TS adaptation until proper actor resolution is available.
    if (
      order.extraData &&
      typeof order.extraData === 'object' &&
      order.extraData !== null
    ) {
      const data = order.extraData as Record<string, unknown>
      if (data.hostActor && typeof data.hostActor === 'object') {
        return data.hostActor as IGameActor
      }
    }
    return null
  }

  /** Find the IDockHost trait on a host actor.
   *
   *  OpenRA 对照: self.TraitOrDefault<IDockHost>()
   *
   *  NOTE: This is a simplified lookup. Full TraitDictionary-based
   *  lookup will be available when Chapter 3 World is fully wired.
   *
   *  @param host — the host actor to query
   *  @returns the IDockHost trait if found, null otherwise
   *
   *  TODO-10.A.0: Replace with TraitDictionary lookup when available.
   */
  protected findDockHostTrait(host: IGameActor): IDockHost | null {
    // NOTE: In the full implementation, this would use:
    //   host.world?.traitDict.get<IDockHost>(host, 'IDockHost')
    // For now, we check if the host implements IDockHost via duck-typing.
    const h = host as unknown as Record<string, unknown>
    if (
      typeof h.getDockType === 'number' &&
      typeof h.isEnabledAndInWorld === 'boolean' &&
      typeof h.dockPosition === 'object' &&
      typeof h.isDockingPossible === 'function' &&
      typeof h.reserve === 'function'
    ) {
      return host as unknown as IDockHost
    }
    return null
  }
}
