/**
 * Harvester.ts — Central resource-gathering actor trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Harvester.cs (330 lines)
 *
 * 核心范式转换:
 * - C# DockClientBase<HarvesterInfo>, IIssueOrder, IResolveOrder, IOrderVoice,
 *     ISpeedModifier, ISync, INotifyCreated
 *   → TS DockClientBase<HarvesterInfo> implements all same interfaces
 * - C# self.TraitsImplementing<IStoresResources>() → TS duck-typed trait resolution
 * - C# Mobile trait (concrete) → TS IMove interface (duck-typed)
 * - C# ResourceClaimLayer → TS duck-typed resource claim lookup
 * - C# FindAndDeliverResources Activity → TS ActivityStub factory methods
 *   (full Activity implementation deferred to Chapter 14 Phase D)
 * - C# HarvestOrderTargeter inner class → TS stub (deferred to Chapter 15)
 *   inner class → TS stub (deferred to Chapter 15)
 * - C# [Sync] currentUnloadTicks → TS ISync marker interface
 * - C# BitSet<DockType> → TS DockTypeValue (number bitmask)
 * - C# Actor.InvalidConditionToken → TS INVALID_CONDITION_TOKEN (-1)
 */

import type {
  IGameActor,
  ISync,
  IIssueOrder,
  IResolveOrder,
  IOrderVoice,
  ISpeedModifier,
  INotifyCreated,
  IOrderTargeter,
  IResourceLayer,
  IStoresResources,
  IDockHost,
  Order,
  TargetStub,
  ActivityStub,
  PlayerStub,
  ColorStub,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  DockClientBase,
  DockClientBaseInfo,
} from './DockClientBase.js'
import type { DockTypeValue } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Invalid condition token constant.
 *
 * OpenRA 对照: Actor.InvalidConditionToken = -1
 */
const INVALID_CONDITION_TOKEN = -1

// ---------------------------------------------------------------------------
// HarvesterInfo
// OpenRA 对照: HarvesterInfo (extends DockClientBaseInfo, Requires<IStoresResourcesInfo>, IRulesetLoaded)
// ---------------------------------------------------------------------------

/** Configuration for the Harvester trait.
 *
 *  OpenRA 对照: HarvesterInfo
 */
export class HarvesterInfo extends DockClientBaseInfo {
  /** Which resources this harvester can collect.
   *
   *  OpenRA 对照: HarvesterInfo.Resources (ImmutableArray<string>, default: empty)
   */
  readonly resources: readonly string[] = []

  /** Ticks to load one bale of resource while harvesting.
   *
   *  OpenRA 对照: HarvesterInfo.BaleLoadDelay (default 4)
   */
  readonly baleLoadDelay: number = 4

  /** Ticks between unloading each bale at the refinery.
   *
   *  OpenRA 对照: HarvesterInfo.BaleUnloadDelay (default 4)
   */
  readonly baleUnloadDelay: number = 4

  /** How many bales can be unloaded at once per dock tick.
   *
   *  OpenRA 对照: HarvesterInfo.BaleUnloadAmount (default 1)
   */
  readonly baleUnloadAmount: number = 1

  /** Number of facings for harvest animation (0 = any facing).
   *
   *  OpenRA 对照: HarvesterInfo.HarvestFacings (default 0)
   */
  readonly harvestFacings: number = 0

  /** Percentage of maximum speed when fully loaded (85 = 85%).
   *
   *  OpenRA 对照: HarvesterInfo.FullyLoadedSpeed (default 85)
   */
  readonly fullyLoadedSpeed: number = 85

  /** Automatically scan for resources when the harvester is created.
   *
   *  OpenRA 对照: HarvesterInfo.SearchOnCreation (default true)
   */
  readonly searchOnCreation: boolean = true

  /** Initial search radius (in cells) from the refinery that created us.
   *
   *  OpenRA 对照: HarvesterInfo.SearchFromProcRadius (default 24)
   */
  readonly searchFromProcRadius: number = 24

  /** Search radius (in cells) from the last harvest order location to
   *  find more resources.
   *
   *  OpenRA 对照: HarvesterInfo.SearchFromHarvesterRadius (default 12)
   */
  readonly searchFromHarvesterRadius: number = 12

  /** Interval (in ticks) to wait between searches when there are no
   *  resources nearby.
   *
   *  OpenRA 对照: HarvesterInfo.WaitDuration (default 25)
   */
  readonly waitDuration: number = 25

  /** Pathfinding cost penalty applied for cells directly away from the
   *  refinery.
   *
   *  OpenRA 对照: HarvesterInfo.ResourceRefineryDirectionPenalty (default 200)
   */
  readonly resourceRefineryDirectionPenalty: number = 200

  /** Whether to queue full harvesting runs instead of individual
   *  harvest actions.
   *
   *  OpenRA 对照: HarvesterInfo.QueueFullLoad (default false)
   */
  readonly queueFullLoad: boolean = false

  /** Condition to grant while the harvester is empty.
   *
   *  OpenRA 对照: HarvesterInfo.EmptyCondition (default null)
   */
  readonly emptyCondition: string | null = null

  /** Voice line to play when ordered to harvest.
   *
   *  OpenRA 对照: HarvesterInfo.HarvestVoice (default "Action")
   */
  readonly harvestVoice: string = 'Action'

  /** Color to use for the target line of harvest orders.
   *
   *  OpenRA 对照: HarvesterInfo.HarvestLineColor (default Color.Crimson)
   */
  readonly harvestLineColor: ColorStub = { r: 0.86, g: 0.08, b: 0.24, a: 1 }

  /** Cursor to display when ordering to harvest resources.
   *
   *  OpenRA 对照: HarvesterInfo.HarvestCursor (default "harvest")
   */
  readonly harvestCursor: string = 'harvest'

  /** Cell to move to when automatically unblocking the delivery building.
   *
   *  OpenRA 对照: HarvesterInfo.UnblockCell (default CVec(0, 4))
   */
  readonly unblockCellX: number = 0
  readonly unblockCellY: number = 4

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    type?: DockTypeValue
    color?: ColorStub
    resources?: string[]
    baleLoadDelay?: number
    baleUnloadDelay?: number
    baleUnloadAmount?: number
    harvestFacings?: number
    fullyLoadedSpeed?: number
    searchOnCreation?: boolean
    searchFromProcRadius?: number
    searchFromHarvesterRadius?: number
    waitDuration?: number
    resourceRefineryDirectionPenalty?: number
    queueFullLoad?: boolean
    emptyCondition?: string | null
    harvestVoice?: string
    harvestLineColor?: ColorStub
    harvestCursor?: string
    unblockCellX?: number
    unblockCellY?: number
  } = {}) {
    super({
      instanceName: params.instanceName,
      requiresCondition: params.requiresCondition,
      type: params.type,
      color: params.color,
    })
    this.resources = params.resources ?? []
    this.baleLoadDelay = params.baleLoadDelay ?? 4
    this.baleUnloadDelay = params.baleUnloadDelay ?? 4
    this.baleUnloadAmount = params.baleUnloadAmount ?? 1
    this.harvestFacings = params.harvestFacings ?? 0
    this.fullyLoadedSpeed = params.fullyLoadedSpeed ?? 85
    this.searchOnCreation = params.searchOnCreation ?? true
    this.searchFromProcRadius = params.searchFromProcRadius ?? 24
    this.searchFromHarvesterRadius = params.searchFromHarvesterRadius ?? 12
    this.waitDuration = params.waitDuration ?? 25
    this.resourceRefineryDirectionPenalty = params.resourceRefineryDirectionPenalty ?? 200
    this.queueFullLoad = params.queueFullLoad ?? false
    this.emptyCondition = params.emptyCondition ?? null
    this.harvestVoice = params.harvestVoice ?? 'Action'
    this.harvestLineColor = params.harvestLineColor ?? { r: 0.86, g: 0.08, b: 0.24, a: 1 }
    this.harvestCursor = params.harvestCursor ?? 'harvest'
    this.unblockCellX = params.unblockCellX ?? 0
    this.unblockCellY = params.unblockCellY ?? 4
  }
}

// ---------------------------------------------------------------------------
// Harvester
// OpenRA 对照: Harvester (DockClientBase<HarvesterInfo>, IIssueOrder, IResolveOrder,
//   IOrderVoice, ISpeedModifier, ISync, INotifyCreated)
// ---------------------------------------------------------------------------

/** Central resource-gathering actor trait.
 *
 *  OpenRA 对照: Harvester
 *
 *  The Harvester combines docking, resource search, cargo management,
 *  speed modification, and order handling into a single trait.
 *  It extends DockClientBase to inherit docking lifecycle management
 *  and implements IIssueOrder/IResolveOrder/IOrderVoice for the Harvest
 *  order type.
 *
 *  Activity factory methods (createHarvestActivity, createDeliverActivity)
 *  return Activity stubs — the actual FindAndDeliverResources Activity
 *  implementation is deferred to Chapter 14 Phase D.
 */
export class Harvester
  extends DockClientBase<HarvesterInfo>
  implements IIssueOrder, IResolveOrder, IOrderVoice, ISpeedModifier, ISync, INotifyCreated
{
  // ------- OpenRA: Mobile mobile (resolved in Created) -------
  /** Movement trait reference. Resolved in created().
   *
   *  OpenRA 对照: Mobile mobile
   */
  private _mobile: unknown | null = null

  // ------- OpenRA: IResourceLayer resourceLayer -------
  /** Resource layer reference from world actor.
   *
   *  OpenRA 对照: IResourceLayer resourceLayer
   */
  private _resourceLayer: IResourceLayer | null = null

  // ------- OpenRA: ResourceClaimLayer claimLayer -------
  // NOTE: ResourceClaimLayer is resolved in _resolveWorldTraits() but its
  // usage (TryClaimCell) is in the FindAndDeliverResources Activity,
  // deferred to Chapter 14 Phase D. The field is kept for future use.
  // OpenRA 对照: ResourceClaimLayer claimLayer

  // ------- OpenRA: IStoresResources[] storesResources -------
  /** Storage traits on this actor that accept the harvester's resource types.
   *
   *  OpenRA 对照: IStoresResources[] storesResources
   */
  private _storesResources: IStoresResources[] = []

  // ------- OpenRA: Actor self -------
  /** Reference to the owning actor (set in attach()).
   *
   *  OpenRA 对照: readonly Actor self
   */
  private _self: IGameActor | null = null

  // ------- OpenRA: int conditionToken = Actor.InvalidConditionToken -------
  /** Token for the empty condition, or -1 when not granted.
   *
   *  OpenRA 对照: int conditionToken = Actor.InvalidConditionToken
   */
  private _conditionToken: number = INVALID_CONDITION_TOKEN

  // ------- OpenRA: [VerifySync] int currentUnloadTicks -------
  /** Countdown timer until the next bale is ready to unload.
   *
   *  OpenRA 对照: [VerifySync] int currentUnloadTicks
   *
   *  NOTE: Marked with @VerifySync in C#. In TS, Harvester implements
   *  the ISync marker interface. The actual sync hash computation is done
   *  by the build-time sync-hash-generator. For manual sync verification,
   *  this field is public so it can be read from tests.
   */
  currentUnloadTicks: number = 0

  // ------- OpenRA: IAcceptResources acceptResources (set in OnDockStarted) -------
  /** Resolved during docking — the host's IAcceptResources trait.
   *
   *  OpenRA 对照: IAcceptResources acceptResources
   */
  private _acceptResources: {
    acceptResources(self: IGameActor, resourceType: string, count: number): number
  } | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(info: HarvesterInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // Component lifecycle overrides
  // -----------------------------------------------------------------------

  /** Called when this component is attached to an actor.
   *
   *  OpenRA 对照: Harvester constructor body
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    this._self = actor
  }

  /** Called when this component is detached from its actor.
   *
   *  OpenRA 对照: N/A (C# uses IDisposable)
   */
  override detach(actor: IGameActor): void {
    this._revokeEmptyCondition()
    this._self = null
    this._mobile = null
    this._resourceLayer = null
    this._storesResources = []
    this._acceptResources = null
    super.detach(actor)
  }

  // -----------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: override void Created(Actor self)
  // -----------------------------------------------------------------------

  /** Called after all traits are initialized.
   *
   *  OpenRA 对照: Harvester.Created(Actor self)
   *
   *  Resolves dependencies: mobile movement trait, resource layer,
   *  claim layer, and stores resources traits. Updates the empty
   *  condition and optionally starts the initial resource search.
   */
  created(self: IGameActor): void {
    // Resolve Mobile/IMove trait
    this._resolveMobile(self)

    // Resolve IStoresResources traits
    this._resolveStoresResources(self)

    // Resolve world-layer traits
    this._resolveWorldTraits(self)

    // Update the empty condition
    this._updateCondition(self)

    // Auto-search for resources on creation
    if (this.info.searchOnCreation && this._mobile !== null) {
      self.queueActivity?.(this.createHarvestActivity(self))
    }
  }

  // -----------------------------------------------------------------------
  // ISync — marker interface (Sync hash computed by build-time generator)
  // -----------------------------------------------------------------------

  // intentionally empty — ISync marker interface

  // -----------------------------------------------------------------------
  // IDockClient overrides — docking type accessor
  // -----------------------------------------------------------------------

  /** Get the docking type bitmask for this client.
   *
   *  OpenRA 对照: Harvester.GetDockType (override)
   *
   *  @returns the docking type from HarvesterInfo.type
   */
  override getDockType(): DockTypeValue {
    return this.info.type
  }

  // -----------------------------------------------------------------------
  // Docking permission checks — override DockClientBase
  // -----------------------------------------------------------------------

  /** Check whether this harvester can dock using the given dock type.
   *
   *  OpenRA 对照: Harvester.CanDock(BitSet<DockType>, bool)
   *
   *  Only docks when not empty (has resources to unload), unless
   *  forceEnter is true.
   */
  override canDock(_type: DockTypeValue, forceEnter: boolean = false): boolean {
    // NOTE: C# calls base.CanDock(type, forceEnter) which checks
    // IsTraitDisabled. In TS, DockClientBase.canDock is abstract so we
    // replicate the base check inline.
    return (
      !this.isTraitDisabled &&
      (forceEnter || !this.isEmpty)
    )
  }

  /** Check whether this harvester can dock at a specific host.
   *
   *  OpenRA 对照: Harvester.CanDockAt(Actor, IDockHost, bool, bool)
   *
   *  Only docks at hosts owned by the same player, or allied hosts
   *  when ignoring occupancy.
   */
  override canDockAt(
    host: IGameActor,
    _hostTrait: IDockHost,
    _forceEnter: boolean = false,
    ignoreOccupancy: boolean = false,
  ): boolean {
    const self = this._self
    if (!self) return false

    // NOTE: super.canDockAt() is abstract in TS DockClientBase.
    // Replicate the base check (IsTraitDisabled) inline.
    if (this.isTraitDisabled) return false

    // Same owner: always allow
    if (self.owner === host.owner) return true

    // Different owner: only allow if ignoring occupancy and allied
    if (ignoreOccupancy) {
      return this._isAlliedWith(self.owner, host.owner)
    }

    return false
  }

  /** Check whether this harvester can queue a dock order for a host.
   *
   *  OpenRA 对照: Harvester.CanQueueDockAt(Actor, IDockHost, bool, bool)
   *
   *  Only queues dock at allied hosts.
   */
  override canQueueDockAt(
    host: IGameActor,
    _hostTrait: IDockHost,
    _forceEnter: boolean = false,
    _isQueued: boolean = false,
  ): boolean {
    // NOTE: super.canQueueDockAt() is abstract in TS DockClientBase.
    // Replicate the base check (IsTraitDisabled) inline.
    if (this.isTraitDisabled) return false

    const self = this._self
    if (!self) return false

    return this._isAlliedWith(self.owner, host.owner)
  }

  // -----------------------------------------------------------------------
  // Docking lifecycle callbacks — override DockClientBase
  // -----------------------------------------------------------------------

  /** Called when docking begins. Resolves the host's IAcceptResources trait.
   *
   *  OpenRA 对照: Harvester.OnDockStarted(Actor, Actor, IDockHost)
   */
  override onDockStarted(
    _self: IGameActor,
    host: IGameActor,
    hostTrait: IDockHost,
  ): void {
    // NOTE: C# calls base.CanDock() which checks IsTraitDisabled.
    // In TS, we call our own canDock which already includes that check.
    if (this.canDock(hostTrait.getDockType)) {
      this._acceptResources = this._resolveAcceptResources(host)
    }
  }

  /** Called every tick during docking. Unloads one bale per tick.
   *
   *  OpenRA 对照: Harvester.OnDockTick(Actor, Actor, IDockHost) -> bool
   *
   *  @returns true when docking is complete (all resources unloaded),
   *           false if still more to unload
   */
  override onDockTick(
    self: IGameActor,
    host: IGameActor,
    _hostTrait: IDockHost,
  ): boolean {
    if (this._acceptResources === null || this.isTraitDisabled) {
      return true
    }

    // Wait until the next bale is ready
    this.currentUnloadTicks--
    if (this.currentUnloadTicks > 0) {
      return false
    }

    // Iterate through each resource type in cargo and try to unload
    for (const sr of this._storesResources) {
      for (const [resourceType, count] of sr.contents) {
        const baleCount = Math.min(count, this.info.baleUnloadAmount)
        const accepted = this._acceptResources.acceptResources(host, resourceType, baleCount)
        if (accepted === 0) continue

        sr.removeResource(resourceType, accepted)
        this.currentUnloadTicks = this.info.baleUnloadDelay
        this._updateCondition(self)
        return false
      }
    }

    // All resources unloaded
    return this.isEmpty
  }

  /** Called when docking is complete. Queues a new harvest activity if
   *  the dock type matches.
   *
   *  OpenRA 对照: Harvester.OnDockCompleted(Actor, Actor, IDockHost)
   */
  override onDockCompleted(
    self: IGameActor,
    _host: IGameActor,
    dock: IDockHost,
  ): void {
    this._acceptResources = null

    // After docking at a refinery, ensure we continue harvesting
    if ((this.getDockType() & dock.getDockType) !== 0) {
      // NOTE: In C#, this checks if CurrentActivity is not FindAndDeliverResources
      // and queues a new one. In TS, we always queue since the Activity system
      // is not yet fully implemented.
      // TODO-14.D: Add proper Activity chain inspection when Activity system
      //            is fully implemented.
      self.queueActivity?.(this.createHarvestActivity(self))
    }
  }

  // -----------------------------------------------------------------------
  // Activity factory methods — deferred to Chapter 14 Phase D
  // -----------------------------------------------------------------------

  /** Create the harvest activity (FindAndDeliverResources stub).
   *
   *  OpenRA 对照: new FindAndDeliverResources(self)
   *
   *  TODO-14.D: Replace Activity stub with full FindAndDeliverResources
   *             Activity implementation.
   *
   *  @param self — this actor
   *  @returns an Activity stub that the order system can queue
   */
  createHarvestActivity(_self: IGameActor): ActivityStub {
    // NOTE: The real FindAndDeliverResources activity orchestrates:
    // 1. Search for nearby resources
    // 2. Pathfind to the best resource cell
    // 3. Move to the cell
    // 4. Harvest the resource (repeated tick-by-tick)
    // 5. If full, find nearest refinery and deliver
    // 6. Repeat
    //
    // This stub immediately completes, allowing tests to verify
    // that the correct factory method was called without requiring
    // the full Activity implementation.
    return this._createActivityStub('FindAndDeliverResources')
  }

  /** Create the delivery activity (deliver resources to refinery).
   *
   *  OpenRA 对照: new FindAndDeliverResources(self, deliveryLocation)
   *
   *  TODO-14.D: Replace Activity stub with full FindAndDeliverResources
   *             Activity variant (with pre-located delivery target).
   *
   *  @param self — this actor
   *  @returns an Activity stub for resource delivery
   */
  createDeliverActivity(_self: IGameActor): ActivityStub {
    return this._createActivityStub('FindAndDeliverResources')
  }

  /** Override DockClientBase createDockActivity.
   *
   *  OpenRA 对照: N/A (C# uses DockClientManager)
   *
   *  TODO-14.D: Replace with full Dock Activity.
   */
  override createDockActivity(
    _self: IGameActor,
    _host: IGameActor,
  ): ActivityStub {
    return this._createActivityStub('Dock')
  }

  /** Override DockClientBase createMoveToDockActivity.
   *
   *  OpenRA 对照: N/A (C# uses DockClientManager)
   *
   *  TODO-14.D: Replace with full MoveToDock Activity.
   */
  override createMoveToDockActivity(
    _self: IGameActor,
    _host: IGameActor,
  ): ActivityStub {
    return this._createActivityStub('MoveToDock')
  }

  // -----------------------------------------------------------------------
  // Cargo management (public properties — matching OpenRA)
  // OpenRA 对照: IsFull, IsEmpty, Fullness
  // -----------------------------------------------------------------------

  /** Whether all cargo stores are at maximum capacity.
   *
   *  OpenRA 对照: Harvester.IsFull
   */
  get isFull(): boolean {
    if (this._storesResources.length === 0) return true
    return this._storesResources.every(
      (sr) => sr.contentsSum >= sr.capacity,
    )
  }

  /** Whether all cargo stores are completely empty.
   *
   *  OpenRA 对照: Harvester.IsEmpty
   */
  get isEmpty(): boolean {
    if (this._storesResources.length === 0) return true
    return this._storesResources.every(
      (sr) => sr.contentsSum === 0,
    )
  }

  /** Fill percentage of the harvester's cargo (0-100).
   *
   *  OpenRA 对照: Harvester.Fullness
   */
  get fullness(): number {
    if (this._storesResources.length === 0) return 0
    const total = this._storesResources.reduce(
      (sum, sr) => sum + (sr.contentsSum * 100) / sr.capacity,
      0,
    )
    return Math.round(total / this._storesResources.length)
  }

  /** Add one unit of a resource type to the harvester's cargo.
   *
   *  OpenRA 对照: Harvester.AddResource(Actor, string)
   */
  addResource(self: IGameActor, resourceType: string): void {
    for (const sr of this._storesResources) {
      if (sr.hasType(resourceType)) {
        sr.addResource(resourceType, 1)
        break
      }
    }
    this._updateCondition(self)
  }

  // -----------------------------------------------------------------------
  // Speed modification (ISpeedModifier)
  // OpenRA 对照: Harvester.GetSpeedModifier()
  // -----------------------------------------------------------------------

  /** Get the speed modifier percentage based on cargo fullness.
   *
   *  OpenRA 对照: ISpeedModifier.GetSpeedModifier()
   *
   *  Returns 100 when empty, decreasing linearly to FullyLoadedSpeed
   *  when fully loaded.Normal = 100, loaded = FullyLoadedSpeed.
   *
   *  @returns the speed modifier as an integer percentage
   */
  getSpeedModifier(): number {
    return 100 - ((100 - this.info.fullyLoadedSpeed) * this.fullness) / 100
  }

  // -----------------------------------------------------------------------
  // Resource search
  // OpenRA 对照: CanHarvestCell, FindResources pattern
  // -----------------------------------------------------------------------

  /** Check whether a cell contains resources this harvester can collect.
   *
   *  OpenRA 对照: Harvester.CanHarvestCell(CPos)
   *
   *  @param cell — the map cell to check
   *  @returns true if the cell has a harvestable resource
   */
  canHarvestCell(cell: CPos): boolean {
    // Resources only exist in the ground layer (layer 0)
    // CPos layer is tracked via Bits; for ground layer, layer component is 0
    if (
      'layer' in cell &&
      (cell as unknown as { layer: number }).layer !== 0
    ) {
      return false
    }

    if (!this._resourceLayer) return false

    const resource = this._resourceLayer.getResource(cell)
    if (resource.type === '') return false

    // Check if this harvester can collect this resource type
    return this.info.resources.includes(resource.type)
  }

  /** Find the nearest resource field near the harvester.
   *
   *  OpenRA 对照: FindAndDeliverResources.FindResources() (simplified here)
   *
   *  This is a simplified version. The full search with pathfinding
   *  cost evaluation is part of FindAndDeliverResources Activity
   *  (deferred to Chapter 14).
   *
   *  @param self — this actor
   *  @param searchRadius — search radius in cells
   *  @returns the nearest harvestable cell, or null if none found
   *
   *  TODO-14.D: Move full search logic into FindAndDeliverResources Activity.
   */
  findResourceField(
    self: IGameActor,
    searchRadius: number = this.info.searchFromHarvesterRadius,
  ): CPos | null {
    if (!this._resourceLayer) return null

    // Get the actor's current location
    const location = (self as unknown as { location?: CPos }).location
    if (!location) return null

    // NOTE: Full implementation requires:
    // 1. PathFinder to evaluate cells within searchRadius
    // 2. ResourceClaimLayer to check if cell is already claimed
    // 3. Map access to enumerate cells
    // These are deferred to Chapter 14 when the full Activity is implemented.
    void searchRadius // mark as used for future implementation

    return null
  }

  // -----------------------------------------------------------------------
  // IIssueOrder — Harvest order generation
  // OpenRA 对照: IIssueOrder.Orders, IIssueOrder.IssueOrder
  // -----------------------------------------------------------------------

  /** The order targeters provided by this trait.
   *
   *  OpenRA 对照: IIssueOrder.Orders
   *
   *  Returns the HarvestOrderTargeter when the trait is enabled and
   *  the mobile trait is available.
   */
  get orders(): readonly IOrderTargeter[] {
    if (this.isTraitDisabled || this._mobile === null) return []
    return [this._getHarvestOrderTargeter()]
  }

  /** Issue a harvest order.
   *
   *  OpenRA 对照: IIssueOrder.IssueOrder(Actor, IOrderTargeter, Target, bool)
   */
  issueOrder(
    _self: IGameActor,
    order: IOrderTargeter,
    target: TargetStub,
    _queued: boolean,
  ): Order {
    if (order.orderID === 'Harvest') {
      return {
        orderName: 'Harvest',
        targetString: this._targetToString(target),
        extraData: null,
      } as Order
    }

    // Return null-like Order (OpenRA returns null for unhandled orders)
    return {
      orderName: '',
      targetString: '',
      extraData: null,
    } as Order
  }

  // -----------------------------------------------------------------------
  // IOrderVoice — Harvest voice line
  // OpenRA 对照: IOrderVoice.VoicePhraseForOrder
  // -----------------------------------------------------------------------

  /** Get the voice phrase for a harvest order.
   *
   *  OpenRA 对照: IOrderVoice.VoicePhraseForOrder(Actor, Order)
   */
  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    if (order.orderName === 'Harvest' && this._mobile !== null) {
      return this.info.harvestVoice
    }
    return ''
  }

  // -----------------------------------------------------------------------
  // IResolveOrder — Harvest order resolution (overrides DockClientBase)
  // OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
  // -----------------------------------------------------------------------

  /** Handle player-issued orders.
   *
   *  OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
   *
   *  Handles the "Harvest" order. Falls through to DockClientBase
   *  for "Dock" order handling.
   */
  override resolveOrder(self: IGameActor, order: Order): void {
    if (order.orderName === 'Harvest' && this._mobile !== null) {
      // Full C# implementation:
      // 1. If target is valid terrain, find nearest claimable cell
      // 2. If bot order (target invalid), use self.Location
      // 3. Queue FindAndDeliverResources activity
      // 4. Show target lines

      // Simplified TS: queue harvest activity stub
      self.queueActivity?.(this.createHarvestActivity(self))

      // NOTE: ShowTargetLines — deferred to Chapter 14/15
      // NOTE: NearestCell search via Mobile — deferred to Chapter 14
      return
    }

    // Fall through to DockClientBase for "Dock" order handling
    super.resolveOrder(self, order)
  }

  // -----------------------------------------------------------------------
  // TraitDisabled — cleanup when condition disables this trait
  // OpenRA 对照: override void TraitDisabled(Actor self)
  // -----------------------------------------------------------------------

  /** Called when the trait is disabled (condition system).
   *
   *  OpenRA 对照: Harvester.TraitDisabled(Actor self)
   */
  protected override traitDisabled(self: IGameActor): void {
    super.traitDisabled(self)
    this._revokeEmptyCondition()
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Update the empty condition based on current cargo state.
   *
   *  OpenRA 对照: Harvester.UpdateCondition(Actor)
   */
  private _updateCondition(self: IGameActor): void {
    const condition = this.info.emptyCondition
    if (!condition) return

    if (!self.grantCondition || !self.revokeCondition) return

    const isEmpty = this.isEmpty

    if (isEmpty && this._conditionToken === INVALID_CONDITION_TOKEN) {
      this._conditionToken = self.grantCondition(condition)
    } else if (!isEmpty && this._conditionToken !== INVALID_CONDITION_TOKEN) {
      this._conditionToken = self.revokeCondition(this._conditionToken)
    }
  }

  /** Revoke the empty condition if currently granted.
   *
   *  OpenRA 对照: TraitDisabled cleanup
   */
  private _revokeEmptyCondition(): void {
    const self = this._self
    if (
      self &&
      this._conditionToken !== INVALID_CONDITION_TOKEN &&
      self.revokeCondition
    ) {
      this._conditionToken = self.revokeCondition(this._conditionToken)
    }
  }

  /** Resolve the Mobile/IMove trait from the actor.
   *
   *  OpenRA 对照: mobile = self.TraitOrDefault<Mobile>()
   */
  private _resolveMobile(self: IGameActor): void {
    // Duck-type check for IMove interface
    const maybeMobile = (self as unknown as Record<string, unknown>)
    // NOTE: In full implementation, this uses TraitDictionary:
    //   self.world?.traitDict.get<IMove>(self, 'IMove')
    // For now, we check if the actor has movement-related methods
    this._mobile = maybeMobile._mobile ?? null
  }

  /** Resolve IStoresResources traits from the actor.
   *
   *  OpenRA 对照: storesResources = self.TraitsImplementing<IStoresResources>()
   *    .Where(sr => info.Resources.Any(r => sr.HasType(r))).ToArray()
   */
  private _resolveStoresResources(self: IGameActor): void {
    // In full implementation, this queries TraitDictionary.
    // For now, check if the actor exposes storesResources directly.
    const traits = (self as unknown as {
      _storesResources?: IStoresResources[]
    })._storesResources
    if (traits && Array.isArray(traits)) {
      this._storesResources = traits.filter((sr) =>
        this.info.resources.some((r) => sr.hasType(r)),
      )
    }
  }

  /** Resolve world-layer traits (resource layer, claim layer).
   *
   *  OpenRA 对照:
   *    resourceLayer = self.World.WorldActor.Trait<IResourceLayer>();
   *    claimLayer = self.World.WorldActor.Trait<ResourceClaimLayer>();
   */
  private _resolveWorldTraits(self: IGameActor): void {
    if (!self.world) return

    const world = self.world as unknown as {
      worldActor?: IGameActor & {
        _resourceLayer?: IResourceLayer
        // _claimLayer deferred — used by FindAndDeliverResources (Ch14)
      }
    }

    const worldActor = world.worldActor
    if (worldActor) {
      this._resourceLayer = worldActor._resourceLayer ?? null
    }
  }

  /** Resolve the IAcceptResources trait from a host actor.
   *
   *  OpenRA 对照: hostActor.TraitOrDefault<IAcceptResources>()
   */
  private _resolveAcceptResources(host: IGameActor): {
    acceptResources(self: IGameActor, resourceType: string, count: number): number
  } | null {
    const h = host as unknown as Record<string, unknown>
    if (
      typeof h.acceptResources === 'function'
    ) {
      return {
        acceptResources: h.acceptResources as (
          self: IGameActor,
          resourceType: string,
          count: number,
        ) => number,
      }
    }
    return null
  }

  /** Check if two players are allied.
   *
   *  OpenRA 对照: self.Owner.IsAlliedWith(hostActor.Owner)
   *
   *  NOTE: Full Player.IsAlliedWith() uses the diplomacy system.
   *  This is a simplified stub.
   *
   *  TODO-10.A.1: Replace with full Player.IsAlliedWith() when diplomacy
   *               system is available.
   */
  private _isAlliedWith(
    selfOwner: PlayerStub | undefined,
    otherOwner: PlayerStub | undefined,
  ): boolean {
    if (!selfOwner || !otherOwner) return false
    if (selfOwner === otherOwner) return true

    // Check if the player has an isAlliedWith method
    const so = selfOwner as unknown as { isAlliedWith?: (p: PlayerStub) => boolean }
    if (so.isAlliedWith) {
      return so.isAlliedWith(otherOwner)
    }
    return false
  }

  /** Create a minimal Activity stub for the given name.
   *
   *  Used by factory methods until full Activity implementations
   *  are available in Chapter 14.
   */
  private _createActivityStub(name: string): ActivityStub {
    return {
      queue(_activity: ActivityStub): void {
        // Stub: do nothing
      },
      cancel(_actor: IGameActor): void {
        // Stub: do nothing
      },
      onActorDisposeOuter(_actor: IGameActor): void {
        // Stub: do nothing
      },
      toString(): string {
        return `ActivityStub[${name}]`
      },
    } as ActivityStub & { toString(): string }
  }

  /** Convert a target stub to a string representation.
   *
   *  OpenRA 对照: Target serialization for Order
   */
  private _targetToString(_target: TargetStub): string {
    // Stub: return empty string until full Target serialization
    return ''
  }

  /** Get the HarvestOrderTargeter for IIssueOrder.Orders.
   *
   *  OpenRA 对照: yield return new HarvestOrderTargeter()
   *
   *  TODO-15: Replace stub with full HarvestOrderTargeter when
   *           order generators are migrated in Chapter 15.
   */
  private _getHarvestOrderTargeter(): IOrderTargeter {
    return {
      orderID: 'Harvest',
      orderPriority: 10,
      isQueued: false,
      canTarget(
        _actor: IGameActor,
        _target: TargetStub,
        modifiers: TargetModifiers,
        _cursor: string,
      ): boolean {
        // Simplified: always returns true if not force-move
        // Full implementation checks:
        // 1. target.Type == TargetType.Terrain
        // 2. !modifiers.HasModifier(TargetModifiers.ForceMove)
        // 3. Cell is explored (shroud check)
        // 4. Cell has resource type in harvester's Resources list
        const ForceMove = 4 // TargetModifiers.ForceMove
        return (modifiers & ForceMove) === 0
      },
      targetOverridesSelection(
        _actor: IGameActor,
        _target: TargetStub,
        _actorsAt: readonly IGameActor[],
        _xy: CPos,
        _modifiers: TargetModifiers,
      ): boolean {
        return true
      },
    }
  }
}
