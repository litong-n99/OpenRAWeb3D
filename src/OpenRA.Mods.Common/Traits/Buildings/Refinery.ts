/**
 * Refinery.ts — Resource processing building trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/Refinery.cs (110 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo, IAcceptResources, INotifyCreated, ITick, INotifyOwnerChanged
 *   → TS ConditionalTrait<RefineryInfo> implements all same interfaces
 * - C# IDockHost (separate trait) → TS Refinery implements IDockHost directly
 *   (migration plan Section 3.1.6). See NOTE below.
 * - C# PlayerResources concrete type → TS IPlayerResources forward interface
 *   (PlayerResources.ts is migrated in Phase B — )
 * - C# FloatingText effect → TS floating text stub (deferred to Chapter 14/16)
 * - C# Util.ApplyPercentageModifiers() → TS inline percentage application
 * - C# Requires<WithSpriteBodyInfo>, Requires<IDockHostInfo>
 *   → IDockHost satisfied directly by Refinery; WithSpriteBody deferred
 * - C# Game.AddFrameEndTask() → TS queueActivity/observable pattern
 *
 * NOTE: In C#, Refinery does NOT implement IDockHost. IDockHost is a
 * separate trait (typically provided by the Building's footprint/dock
 * position infrastructure). In the TS migration (per Chapter 10 plan
 * Section 3.1.6), Refinery directly implements IDockHost to simplify
 * the trait composition and avoid a separate DockHost trait.
 *
 * Refinery accepts resources from harvesters and either:
 *   - UseStorage=true:  stores in player resource silos via PlayerResources
 *   - UseStorage=false: converts directly to cash
 *   - DiscardExcessResources=true: discards when storage is full
 *   - ShowTicks: displays floating "+$XXX" text above the refinery
 */

import {
  ConditionalTrait,
  DockType,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  IAcceptResources,
  IDockHost,
  DockTypeValue,
  INotifyCreated,
  ITick,
  INotifyOwnerChanged,
  IResourceValueModifier,
  PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// IPlayerResources — Forward interface for PlayerResources (Phase B)
// OpenRA 对照: PlayerResources trait (Phase B, )
// ---------------------------------------------------------------------------

/**
 * Minimal forward interface for PlayerResources.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlayerResources.cs
 *
 * PlayerResources is the central player economy manager, managing both
 * Cash and stored Resources. Since PlayerResources is migrated in Phase B
 * (), Refinery uses this minimal interface with type assertion.
 * The full PlayerResources interface will replace this stub.
 *
* Replace with full PlayerResources class when migrated.
 */
interface IPlayerResources {
  readonly resourceCapacity: number
  readonly resources: number
  changeCash(amount: number): number
  giveResources(num: number, isRefund?: boolean): void
  takeResources(num: number): boolean
}

/** Extended interface for PlayerResources with resource values lookup.
 *
 *  OpenRA 对照: PlayerResources.Info.ResourceValues (Dictionary<string, int>)
 */
interface IPlayerResourcesExtended extends IPlayerResources {
  info?: {
    resourceValues?: ReadonlyMap<string, number> | Record<string, number>
  }
}

// ---------------------------------------------------------------------------
// RefineryInfo
// OpenRA 对照: RefineryInfo (TraitInfo, Requires<WithSpriteBodyInfo>, Requires<IDockHostInfo>)
// ---------------------------------------------------------------------------

/** Configuration for the Refinery trait.
 *
 *  OpenRA 对照: RefineryInfo
 */
export class RefineryInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Store resources in silos. If false, adds cash directly without
   *  storing.
   *
   *  OpenRA 对照: RefineryInfo.UseStorage (default true)
   */
  readonly useStorage: boolean = true

  /** Discard resources once silo capacity has been reached. When false,
   *  excess resources will be bounced back to the harvester.
   *
   *  OpenRA 对照: RefineryInfo.DiscardExcessResources (default false)
   */
  readonly discardExcessResources: boolean = false

  /** Whether to show floating cash ticks above the refinery.
   *
   *  OpenRA 对照: RefineryInfo.ShowTicks (default true)
   */
  readonly showTicks: boolean = true

  /** Number of game ticks between floating text display updates.
   *
   *  OpenRA 对照: RefineryInfo.TickRate (default 10)
   */
  readonly tickRate: number = 10

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    useStorage?: boolean
    discardExcessResources?: boolean
    showTicks?: boolean
    tickRate?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.useStorage = params.useStorage ?? true
    this.discardExcessResources = params.discardExcessResources ?? false
    this.showTicks = params.showTicks ?? true
    this.tickRate = params.tickRate ?? 10
  }
}

// ---------------------------------------------------------------------------
// Refinery
// OpenRA 对照: Refinery (IAcceptResources, INotifyCreated, ITick, INotifyOwnerChanged)
// ---------------------------------------------------------------------------

/** Resource processing building that accepts deliveries from harvesters.
 *
 *  OpenRA 对照: Refinery
 *
 *  The Refinery trait handles resource-to-cash conversion with two modes:
 *  - **UseStorage**: Resources are stored in the player's silos via
 *    PlayerResources. If storage is full and DiscardExcessResources is
 *    true, excess is discarded. Otherwise, the harvester is bounced.
 *  - **!UseStorage**: Resources are directly converted to cash.
 *
 *  Floating text display ("+$XXX") appears periodically above the refinery
 *  when ShowTicks is enabled.
 */
export class Refinery
  extends ConditionalTrait<RefineryInfo>
  implements IDockHost, IAcceptResources, INotifyCreated, ITick, INotifyOwnerChanged
{
  // ------- OpenRA: PlayerResources playerResources -------
  /** Reference to the owning player's PlayerResources trait.
   *
   *  OpenRA 对照: PlayerResources playerResources
   *
   *  NOTE: Typed as unknown due to PlayerResources being migrated in
   *  Phase B (). Cast to IPlayerResourcesExtended when used.
   */
  private _playerResources: unknown = null

  // ------- OpenRA: IEnumerable<int> resourceValueModifiers -------
  /** Cached resource value modifier percentages from IResourceValueModifier
   *  traits on this actor.
   *
   *  OpenRA 对照: IEnumerable<int> resourceValueModifiers
   */
  private _resourceValueModifiers: number[] = []

  // ------- OpenRA: int currentDisplayTick, int currentDisplayValue -------
  /** Countdown timer for floating text display (counts down from TickRate).
   *
   *  OpenRA 对照: int currentDisplayTick
   */
  private _currentDisplayTick: number = 0

  /** Accumulated cash value to display when the tick counter reaches 0.
   *
   *  OpenRA 对照: int currentDisplayValue
   */
  private _currentDisplayValue: number = 0

  // ------- IDockHost private state -------
  /** Tracked count of active dock slot reservations.
   *
   *  OpenRA 对照: Managed via DockHostManager reservation list
   *
   *  NOTE: In C#, reservation tracking is managed externally by
   *  DockHostManager. In TS, Refinery tracks reservations directly
   *  since it directly implements IDockHost.
   */
  private _reservationCount: number = 0

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(info: RefineryInfo) {
    super(info)
    this._currentDisplayTick = info.tickRate
  }

  // -----------------------------------------------------------------------
  // Component lifecycle overrides
  // -----------------------------------------------------------------------

  /** Called when this component is attached to an actor.
   *
   *  OpenRA 对照: Refinery constructor body
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    // Resolve PlayerResources from the owning player
    this._resolvePlayerResources(actor)
    this._currentDisplayTick = this.info.tickRate
  }

  /** Called when this component is detached from its actor. */
  override detach(actor: IGameActor): void {
    this._playerResources = null
    this._resourceValueModifiers = []
    super.detach(actor)
  }

  // -----------------------------------------------------------------------
  // IDockHost — allow harvesters to dock at this refinery
  // OpenRA 对照: IDockHost (lines 250-278 in TraitsInterfaces.cs)
  //
  // NOTE: In C#, IDockHost is implemented by a separate trait (typically
  // tied to the building's footprint). In the TS migration per Chapter 10
  // plan Section 3.1.6, Refinery directly implements IDockHost to simplify
  // trait composition. The full reservation tracking via DockHostManager
  // is deferred to Chapter 14.
  // -----------------------------------------------------------------------

  /** The docking types supported by this host (bitmask of DockType values).
   *
   *  OpenRA 对照: IDockHost.GetDockType
   *
   *  Refinery only accepts DockType.Unload clients (harvesters delivering
   *  resources). Repair and Refuel are not supported by Refinery.
   */
  get getDockType(): DockTypeValue {
    return DockType.Unload
  }

  /** Whether this host is currently operational and in the game world.
   *
   *  OpenRA 对照: IDockHost.IsEnabledAndInWorld
   */
  get isEnabledAndInWorld(): boolean {
    return !this.isTraitDisabled && (this.actor?.isInWorld === true)
  }

  /** Current count of active dock slot reservations.
   *
   *  OpenRA 对照: IDockHost.ReservationCount
   */
  get reservationCount(): number {
    return this._reservationCount
  }

  /** Whether this host can accept new reservations.
   *
   *  OpenRA 对照: IDockHost.CanBeReserved
   */
  get canBeReserved(): boolean {
    return this.isEnabledAndInWorld
  }

  /** World position where docking clients should approach.
   *
   *  OpenRA 对照: IDockHost.DockPosition
   *
   *  Returns the refinery actor's center position, which docking clients
   *  navigate toward. Falls back to WPos.Zero when the actor reference
   *  is not available (e.g., in unit tests with minimal actor stubs).
   *
* Refine to return a cell adjacent to the refinery
   *               building footprint once Building trait is migrated.
   */
  get dockPosition(): WPos {
    const center = (this.actor as unknown as { centerPosition?: WPos }).centerPosition
    return center ?? WPos.Zero
  }

  /** Check whether a docking client can dock at this host.
   *
   *  OpenRA 对照: IDockHost.IsDockingPossible(Actor, IDockClient, bool)
   *
   *  Does NOT check DockType or whether the client is enabled.
   *  Those checks are performed by the client's canDock() method.
   *
   *  Basic checks performed:
   *  - Host is enabled and in world
   *  - Client is owned by the same player as the host
   *
   *  @param clientActor — the actor that wants to dock
   *  @param _client — the docking client trait (unknown until Ch14)
   *  @param _ignoreReservations — if true, skip reservation checks
   *  @returns true if docking is possible at this host
   */
  isDockingPossible(
    clientActor: IGameActor,
    _client: unknown,
    _ignoreReservations?: boolean,
  ): boolean {
    if (!this.isEnabledAndInWorld) return false
    if (clientActor.owner !== this.actor?.owner) return false
    return true
  }

  /** Reserve a dock slot for a client.
   *
   *  OpenRA 对照: IDockHost.Reserve(Actor, DockClientManager)
   *
   *  @param _self — the host actor
   *  @param _client — the docking client manager (unknown until Ch14)
   *  @returns true if the reservation was successful
   */
  reserve(_self: IGameActor, _client: unknown): boolean {
    if (!this.isEnabledAndInWorld) return false
    this._reservationCount++
    return true
  }

  /** Release all dock reservations.
   *
   *  OpenRA 对照: IDockHost.UnreserveAll()
   */
  unreserveAll(): void {
    this._reservationCount = 0
  }

  // -----------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: void INotifyCreated.Created(Actor self)
  // -----------------------------------------------------------------------

  /** Called after all traits are initialized. Resolves resource value
   *  modifiers from other traits on this actor.
   *
   *  OpenRA 对照: INotifyCreated.Created(Actor self)
   */
  created(self: IGameActor): void {
    this._resolveResourceValueModifiers(self)
  }

  // -----------------------------------------------------------------------
  // IAcceptResources — process resource deliveries from harvesters
  // OpenRA 对照: int IAcceptResources.AcceptResources(Actor self, string resourceType, int count)
  // -----------------------------------------------------------------------

  /** Accept resources delivered by a harvester.
   *
   *  OpenRA 对照: IAcceptResources.AcceptResources(Actor, string, int)
   *
   *  Processing flow:
   *  1. Look up the resource value from PlayerResources.Info.ResourceValues
   *  2. Apply resource value modifiers (IResourceValueModifier traits)
   *  3. If UseStorage: store in PlayerResources silos, respecting capacity
   *  4. If !UseStorage: convert directly to cash
   *  5. Notify INotifyResourceAccepted observers
   *  6. Accumulate display value if ShowTicks
   *
   *  @param self — the refinery actor
   *  @param resourceType — the type of resource being delivered
   *  @param count — the amount of resource to accept (default 1)
   *  @returns the amount actually accepted (may be less than count if
   *           storage is full and excess is discarded)
   */
  acceptResources(
    self: IGameActor,
    resourceType: string,
    count: number = 1,
  ): number {
    const pr = this._playerResources as IPlayerResourcesExtended | null
    if (!pr) return 0

    // 1. Look up resource value
    const resourceValues = pr.info?.resourceValues
    const resourceValue = this._getResourceValue(
      resourceValues ?? null,
      resourceType,
    )
    if (resourceValue === undefined) return 0

    // 2. Calculate total value
    let value = count * resourceValue
    value = this._applyPercentageModifiers(value, this._resourceValueModifiers)
    let acceptedCount = count

    // 3. Process based on mode
    if (this.info.useStorage) {
      // Store in silos — check capacity
      const storageLimit = Math.max(
        (pr.resourceCapacity ?? 0) - (pr.resources ?? 0),
        0,
      )

      if (!this.info.discardExcessResources) {
        // Reduce amount if value exceeds available storage.
        // Scale down accepted count proportionally to fit storage limit.
        // This avoids the per-iteration recalculation of the C# while loop
        // and produces an equivalent result.
        if (value > storageLimit) {
          acceptedCount = Math.floor(count * storageLimit / value)
          value = this._applyPercentageModifiers(
            acceptedCount * resourceValue,
            this._resourceValueModifiers,
          )
        }
      } else {
        // Discard excess — cap at available storage
        value = Math.min(value, storageLimit)
      }

      // Store in player resources
      if (typeof pr.giveResources === 'function') {
        pr.giveResources(value)
      }
    } else {
      // Direct cash conversion
      if (typeof pr.changeCash === 'function') {
        value = pr.changeCash(value)
      }
    }

    // 4. Notify INotifyResourceAccepted observers
    this._notifyResourceAccepted(self, resourceType, acceptedCount, value)

    // 5. Accumulate display value for floating text
    if (this.info.showTicks) {
      this._currentDisplayValue += value
    }

    return acceptedCount
  }

  // -----------------------------------------------------------------------
  // ITick — floating text display management
  // OpenRA 对照: void ITick.Tick(Actor self)
  // -----------------------------------------------------------------------

  /** Per-tick update: manage floating cash text display.
   *
   *  OpenRA 对照: ITick.Tick(Actor self)
   *
   *  When ShowTicks is enabled, accumulates resource values and periodically
   *  displays them as floating text above the refinery. The display interval
   *  is controlled by TickRate.
   */
  tick(_self: IGameActor): void {
    if (
      this.info.showTicks &&
      this._currentDisplayValue > 0
    ) {
      this._currentDisplayTick--
      if (this._currentDisplayTick <= 0) {
        // Floating text display: C# renders using:
        //   FloatingText(self.CenterPosition, this._currentDisplayValue, ...)
        // Requires FloatingText effect and World.AddFrameEndTask,
        // both deferred to Chapters 14/16.
        //
        // TODO-10.A.6-FLOATING: Implement floating text display using
        //   Babylon.js GUI TextBlock or FullScreenUI when World.AddFrameEndTask
        //   and FloatingText are available (Chapter 14/16).
        // The cash value to display is accumulated in _currentDisplayValue
        // across acceptResources() calls.

        // Reset for next cycle
        this._currentDisplayTick = this.info.tickRate
        this._currentDisplayValue = 0
      }
    }
  }

  // -----------------------------------------------------------------------
  // INotifyOwnerChanged — re-resolve PlayerResources on owner change
  // OpenRA 对照: void INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
  // -----------------------------------------------------------------------

  /** Called when the refinery's owner changes (e.g., capture).
   *
   *  OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   *
   *  Re-resolves the PlayerResources reference from the new owning player.
   */
  onOwnerChanged(
    self: IGameActor,
    _oldOwner: PlayerStub,
    _newOwner: PlayerStub,
  ): void {
    this._resolvePlayerResources(self)
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Resolve the PlayerResources trait for the refinery's owning player.
   *
   *  OpenRA 对照: playerResources = self.Owner.PlayerActor.Trait<PlayerResources>()
   *
* Replace duck-typing with full PlayerResources class
   *               when migrated in Phase B.
   */
  private _resolvePlayerResources(self: IGameActor): void {
    const owner = self.owner
    if (!owner) {
      this._playerResources = null
      return
    }

    // Try to access PlayerResources from the owner's player actor
    // In full implementation: owner.PlayerActor.Trait<PlayerResources>()
    const playerActor = (owner as unknown as {
      playerActor?: IGameActor & {
        _playerResources?: unknown
      }
    }).playerActor

    if (playerActor && playerActor._playerResources !== undefined) {
      this._playerResources = playerActor._playerResources
    } else {
      // Fallback: stub PlayerResources for Phase A testing
      this._playerResources = this._createStubPlayerResources()
    }
  }

  /** Resolve IResourceValueModifier traits from the actor.
   *
   *  OpenRA 对照:
   *    resourceValueModifiers = self.TraitsImplementing<IResourceValueModifier>()
   *      .ToArray().Select(m => m.GetResourceValueModifier())
   */
  private _resolveResourceValueModifiers(self: IGameActor): void {
    const modifiers: number[] = []

    // Duck-type check: look for IResourceValueModifier on the actor
    const actor = self as unknown as {
      _resourceValueModifiers?: (IResourceValueModifier | { getResourceValueModifier(): number })[]
      traits?: Iterable<unknown>
    }

    if (actor._resourceValueModifiers && Array.isArray(actor._resourceValueModifiers)) {
      for (const m of actor._resourceValueModifiers) {
        if (typeof (m as IResourceValueModifier).getResourceValueModifier === 'function') {
          modifiers.push((m as IResourceValueModifier).getResourceValueModifier())
        }
      }
    }

    this._resourceValueModifiers = modifiers
  }

  /** Look up the cash value of a resource type.
   *
   *  OpenRA 对照: playerResources.Info.ResourceValues.TryGetValue(resourceType, out resourceValue)
   *
   *  @returns the resource value (cash per unit), or undefined if not found
   */
  private _getResourceValue(
    resourceValues: ReadonlyMap<string, number> | Record<string, number> | null,
    resourceType: string,
  ): number | undefined {
    if (!resourceValues) return undefined

    if (resourceValues instanceof Map) {
      const val = resourceValues.get(resourceType)
      return val !== undefined ? val : undefined
    }

    // Record<string, number>
    const val = (resourceValues as Record<string, number>)[resourceType]
    return val !== undefined ? val : undefined
  }

  /** Apply a list of percentage modifiers to a value.
   *
   *  OpenRA 对照: Util.ApplyPercentageModifiers(int value, IEnumerable<int> percentages)
   *
   *  Each modifier is applied multiplicatively:
   *    result = value * (p1/100) * (p2/100) * ... * (pN/100)
   *
   *  @param value — the base value
   *  @param modifiers — list of percentage modifiers (100 = normal)
   *  @returns the modified value
   */
  private _applyPercentageModifiers(
    value: number,
    modifiers: readonly number[],
  ): number {
    let result = value
    for (const modifier of modifiers) {
      result = (result * modifier) / 100
    }
    return Math.round(result)
  }

  /** Notify all INotifyResourceAccepted observers on actors in the world.
   *
   *  OpenRA 对照: foreach notify in self.World.ActorsWithTrait<INotifyResourceAccepted>()
   *
   *  NOTE: Full world actor iteration requires World infrastructure from Ch3.
   *  This implementation checks for observers directly on known actors.
   *  Expanded implementation depends on World.actors iteration.
   *
   *  @param self — the refinery actor
   *  @param resourceType — the resource type accepted
   *  @param count — the amount of resource accepted
   *  @param value — the cash value
   *
* Enhance to iterate all world actors when
   *    World.actors iteration is available (requires full World from Ch3).
   */
  private _notifyResourceAccepted(
    self: IGameActor,
    resourceType: string,
    count: number,
    value: number,
  ): void {
    // Try to iterate actors from the world
    const world = self.world as unknown as {
      actors?: Iterable<unknown> | unknown[]
    } | undefined
    if (!world || !world.actors) return

    const owner = self.owner
    if (!owner) return

    // Check each actor for INotifyResourceAccepted trait
    const actorsIterable = world.actors as Iterable<unknown>
    for (const actor of actorsIterable) {
      const a = actor as IGameActor & {
        onResourceAccepted?: (
          selfActor: IGameActor,
          refinery: IGameActor,
          resourceTypeStr: string,
          countNum: number,
          valueNum: number,
        ) => void
      }

      // Only notify actors owned by the same player
      if (a.owner !== owner) continue

      if (typeof a.onResourceAccepted === 'function') {
        a.onResourceAccepted(a, self, resourceType, count, value)
      }
    }
  }

  /** Create a stub PlayerResources for testing when the real trait is
   *  not yet available.
   *
* Remove this stub when PlayerResources is migrated.
   */
  private _createStubPlayerResources(): IPlayerResourcesExtended {
    let cash = 5000
    let storedResources = 0
    const resourceCapacity = 5000

    return {
      get resourceCapacity(): number {
        return resourceCapacity
      },
      get resources(): number {
        return storedResources
      },
      changeCash(amount: number): number {
        cash += amount
        return amount
      },
      giveResources(num: number): void {
        storedResources += num
      },
      takeResources(num: number): boolean {
        if (storedResources >= num) {
          storedResources -= num
          return true
        }
        return false
      },
      info: {
        resourceValues: new Map<string, number>([
          ['Tiberium', 100],
          ['Ore', 75],
          ['Spice', 150],
          ['Gems', 300],
        ]),
      },
    }
  }
}
