/**
 * ProductionQueue.ts — 生产队列管理器：管理建造/生产队列、建造时间、成本扣除与前提条件
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/ProductionQueue.cs (813 lines)
 *
 * 核心范式转换:
 * - C# List<ProductionItem> → TS ProductionItem[] (显式数组操作，无 LINQ)
 * - C# Dictionary<ActorInfo, ProductionState> → TS Map<string, ProductionState> (以 actor 名称作键)
 * - C# ProductionItem.Tick() + PlayerResources.TakeCash() → TS tick() + takeCash()
 * - C# [VerifySync] 字段 → TS getter (enabled, isValidFaction)
 * - C# Game.Sound.PlayNotification → TS 桩 (TODO-8.F)
 * - C# TextNotificationsManager → TS 桩 (TODO-16.X)
 * - C# LINQ (Any, First, FirstOrDefault, Where) → TS 显式循环
 *
 * ProductionQueue 是玩家级别的 trait，附加到生产建筑（或玩家 Actor，对于
 * ClassicProductionQueue）。它管理一个生产队列，处理建造时间、成本扣除、
 * 前提条件检查、低电力减速、无限建造循环等。
 */

import type {
  IGameActor,
  PlayerStub,
  ITick,
  IResolveOrder,
  INotifyOwnerChanged,
  INotifyKilled,
  INotifySold,
  INotifyTransform,
  ISync,
  AttackInfo,
  Order,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { BuildableInfo } from '../Buildable.js'
import type { TechTree, ITechTreeElement } from './TechTree.js'
import type { PlayerResources } from './PlayerResources.js'
import type { PowerManager } from './PowerManager.js'
import type { DeveloperMode } from './DeveloperMode.js'
import type { Production } from '../Production.js'
import type { ActorInfoStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ProductionQueueInfo
// OpenRA 对照: ProductionQueueInfo (TraitInfo, IRulesetLoaded)
// ---------------------------------------------------------------------------

/** Configuration for the ProductionQueue trait.
 *
 * OpenRA 对照: ProductionQueueInfo
 */
export class ProductionQueueInfo {
  readonly instanceName?: string

  /** What kind of production will be added (e.g. "Building", "Infantry", "Vehicle"). */
  readonly type: string = ''

  /** The value used when ordering this for display (e.g. in the Spectator UI). */
  readonly displayOrder: number = 0

  /** Group queues from separate buildings together into the same tab. */
  readonly group: string | null = null

  /** Only enable this queue for certain factions. */
  readonly factions: ReadonlySet<string> = new Set()

  /** Should the prerequisite remain enabled if the owner changes? */
  readonly sticky: boolean = true

  /** Player must pay for item upfront. */
  readonly payUpFront: boolean = false

  /** Should right clicking on the icon instantly cancel the production instead of putting it on hold? */
  readonly disallowPaused: boolean = false

  /** This percentage value is multiplied with actor cost to translate into build time. */
  readonly buildDurationModifier: number = 100

  /** Maximum number of a single actor type that can be queued (0 = infinite). */
  readonly itemLimit: number = 999

  /** Maximum number of items that can be queued across all actor types (0 = infinite). */
  readonly queueLimit: number = 0

  /** The build time is multiplied with this percentage on low power. */
  readonly lowPowerModifier: number = 100

  /** Production items that have more than this many items in the queue will be produced in a loop. */
  readonly infiniteBuildLimit: number = -1

  /** Notification played when production is complete. */
  readonly readyAudio: string | null = null

  /** Notification displayed when production is complete. */
  readonly readyTextNotification: string | null = null

  /** Notification played when you can't train another actor. */
  readonly blockedAudio: string | null = null

  /** Notification displayed when you can't train another actor. */
  readonly blockedTextNotification: string | null = null

  /** Notification played when you can't queue another actor. */
  readonly limitedAudio: string | null = null

  /** Notification displayed when you can't queue another actor. */
  readonly limitedTextNotification: string | null = null

  /** Notification played when you can't place a building. */
  readonly cannotPlaceAudio: string | null = null

  /** Notification played when user clicks on the build palette icon. */
  readonly queuedAudio: string | null = null

  /** Notification displayed when user clicks on the build palette icon. */
  readonly queuedTextNotification: string | null = null

  /** Notification played when player right-clicks on the build palette icon. */
  readonly onHoldAudio: string | null = null

  /** Notification displayed when player right-clicks on the build palette icon. */
  readonly onHoldTextNotification: string | null = null

  /** Notification played when player right-clicks on a build palette icon that is already on hold. */
  readonly cancelledAudio: string | null = null

  /** Notification displayed when player right-clicks on a build palette icon that is already on hold. */
  readonly cancelledTextNotification: string | null = null

  constructor(params: {
    instanceName?: string
    type?: string
    displayOrder?: number
    group?: string | null
    factions?: ReadonlySet<string> | readonly string[]
    sticky?: boolean
    payUpFront?: boolean
    disallowPaused?: boolean
    buildDurationModifier?: number
    itemLimit?: number
    queueLimit?: number
    lowPowerModifier?: number
    infiniteBuildLimit?: number
    readyAudio?: string | null
    readyTextNotification?: string | null
    blockedAudio?: string | null
    blockedTextNotification?: string | null
    limitedAudio?: string | null
    limitedTextNotification?: string | null
    cannotPlaceAudio?: string | null
    queuedAudio?: string | null
    queuedTextNotification?: string | null
    onHoldAudio?: string | null
    onHoldTextNotification?: string | null
    cancelledAudio?: string | null
    cancelledTextNotification?: string | null
  } = {}) {
    this.instanceName = params.instanceName
    if (params.type !== undefined) this.type = params.type
    if (params.displayOrder !== undefined) this.displayOrder = params.displayOrder
    if (params.group !== undefined) this.group = params.group ?? null
    if (params.factions !== undefined) {
      if (params.factions instanceof Set) {
        this.factions = params.factions as ReadonlySet<string>
      } else if (Array.isArray(params.factions)) {
        this.factions = new Set(params.factions)
      }
    }
    if (params.sticky !== undefined) this.sticky = params.sticky
    if (params.payUpFront !== undefined) this.payUpFront = params.payUpFront
    if (params.disallowPaused !== undefined) this.disallowPaused = params.disallowPaused
    if (params.buildDurationModifier !== undefined) this.buildDurationModifier = params.buildDurationModifier
    if (params.itemLimit !== undefined) this.itemLimit = params.itemLimit
    if (params.queueLimit !== undefined) this.queueLimit = params.queueLimit
    if (params.lowPowerModifier !== undefined) this.lowPowerModifier = params.lowPowerModifier
    if (params.infiniteBuildLimit !== undefined) this.infiniteBuildLimit = params.infiniteBuildLimit
    if (params.readyAudio !== undefined) this.readyAudio = params.readyAudio
    if (params.readyTextNotification !== undefined) this.readyTextNotification = params.readyTextNotification
    if (params.blockedAudio !== undefined) this.blockedAudio = params.blockedAudio
    if (params.blockedTextNotification !== undefined) this.blockedTextNotification = params.blockedTextNotification
    if (params.limitedAudio !== undefined) this.limitedAudio = params.limitedAudio
    if (params.limitedTextNotification !== undefined) this.limitedTextNotification = params.limitedTextNotification
    if (params.cannotPlaceAudio !== undefined) this.cannotPlaceAudio = params.cannotPlaceAudio
    if (params.queuedAudio !== undefined) this.queuedAudio = params.queuedAudio
    if (params.queuedTextNotification !== undefined) this.queuedTextNotification = params.queuedTextNotification
    if (params.onHoldAudio !== undefined) this.onHoldAudio = params.onHoldAudio
    if (params.onHoldTextNotification !== undefined) this.onHoldTextNotification = params.onHoldTextNotification
    if (params.cancelledAudio !== undefined) this.cancelledAudio = params.cancelledAudio
    if (params.cancelledTextNotification !== undefined) this.cancelledTextNotification = params.cancelledTextNotification
  }
}

// ---------------------------------------------------------------------------
// ProductionState
// OpenRA 对照: ProductionState
// ---------------------------------------------------------------------------

/** Tracks whether an actor type is visible and/or buildable in the production queue.
 *
 * OpenRA 对照: ProductionState
 */
export class ProductionState {
  /** Whether this item is visible in the production palette. */
  visible: boolean = true

  /** Whether this item can currently be built (prerequisites met). */
  buildable: boolean = false
}

// ---------------------------------------------------------------------------
// ProductionItem
// OpenRA 对照: ProductionItem
// ---------------------------------------------------------------------------

/** Represents a single item in a production queue.
 *
 * OpenRA 对照: ProductionItem
 *
 * Tracks build progress, cost, time, and completion state. The `tick()` method
 * advances build progress each game tick.
 */
export class ProductionItem {
  /** The actor name being built. */
  readonly item: string

  /** The parent queue reference. */
  readonly queue: ProductionQueue

  /** Total cost of this item. */
  readonly totalCost: number

  /** Callback invoked when the item completes production. */
  readonly onComplete: (() => void) | null

  /** Total build time in ticks. */
  totalTime: number = 1

  /** Remaining build time in ticks. */
  remainingTime: number = 1

  /** Remaining cost to be paid (for non-pay-up-front queues). */
  remainingCost: number

  /** Resources paid toward this item (for pay-up-front queues with resource splitting). */
  resourcesPaid: number = 0

  /** Whether this item is paused. */
  private _paused: boolean = false

  /** Whether this item has completed production. */
  private _done: boolean = false

  /** Whether this item has started (first tick processed). */
  private _started: boolean = false

  /** Whether this item is set to infinite build loop. */
  infinite: boolean = false

  /** Build palette sort order (from BuildableInfo). */
  readonly buildPaletteOrder: number

  /** Slowdown accumulator for low-power build time extension. */
  private _slowdown: number = 0

  /** The PowerManager reference for low-power detection. */
  private readonly _pm: PowerManager | null

  /** Access internal actor info for clone operations. */
  get _actorInfo(): ActorInfoStub { return this._actorInfoInternal }

  /** Access internal buildable info for clone operations. */
  get _buildableInfo(): BuildableInfo { return this._buildableInfoInternal }

  private readonly _actorInfoInternal: ActorInfoStub
  private readonly _buildableInfoInternal: BuildableInfo

  constructor(
    queue: ProductionQueue,
    item: string,
    cost: number,
    pm: PowerManager | null,
    onComplete: (() => void) | null,
    actorInfo: ActorInfoStub,
    buildableInfo: BuildableInfo,
  ) {
    this.queue = queue
    this.item = item
    this.remainingTime = this.totalTime = 1
    this.remainingCost = this.totalCost = cost
    this.resourcesPaid = 0
    this.onComplete = onComplete
    this._pm = pm
    this._actorInfoInternal = actorInfo
    this._buildableInfoInternal = buildableInfo
    this.buildPaletteOrder = buildableInfo.buildPaletteOrder
    this.infinite = false
  }

  /** Whether this item is paused. */
  get paused(): boolean {
    return this._paused
  }

  /** Whether this item has completed production. */
  get done(): boolean {
    return this._done
  }

  /** Whether this item has started (first tick processed). */
  get started(): boolean {
    return this._started
  }

  /** Remaining time adjusted for low power. */
  get remainingTimeActual(): number {
    if (this._pm === null || this._pm.powerState === 0) {
      // PowerState.Normal = 0
      return this.remainingTime
    }
    return Math.floor((this.remainingTime * this.queue.info.lowPowerModifier) / 100)
  }

  /** Advance build progress by one tick.
   *
   * OpenRA 对照: ProductionItem.Tick(PlayerResources)
   *
   * @param playerResources — the player's resources for cost deduction
   */
  tick(playerResources: PlayerResources): void {
    if (!this._started) {
      const time = this.queue.getBuildTime(this._actorInfo, this._buildableInfo)
      if (time > 0) {
        this.remainingTime = this.totalTime = time
      }
      this._started = true
    }

    if (this._done) {
      this.onComplete?.()
      return
    }

    if (this._paused) {
      return
    }

    // Low power slowdown
    if (this._pm !== null && this._pm.powerState !== 0) {
      // PowerState.Normal = 0
      this._slowdown -= 100
      if (this._slowdown < 0) {
        this._slowdown = this.queue.info.lowPowerModifier + this._slowdown
      } else {
        return
      }
    }

    // Per-tick cost deduction (only when not PayUpFront)
    if (!this.queue.info.payUpFront) {
      const expectedRemainingCost =
        this.remainingTime === 1
          ? 0
          : Math.floor((this.totalCost * this.remainingTime) / Math.max(1, this.totalTime))
      const costThisFrame = this.remainingCost - expectedRemainingCost

      if (playerResources.resources > 0 && playerResources.resources <= costThisFrame) {
        this.resourcesPaid += playerResources.resources
      } else if (playerResources.resources > costThisFrame) {
        this.resourcesPaid += costThisFrame
      }

      if (costThisFrame !== 0 && !playerResources.takeCash(costThisFrame, true)) {
        this.resourcesPaid -= playerResources.resources
        return
      }

      this.remainingCost -= costThisFrame
    }

    this.remainingTime--
    if (this.remainingTime > 0) {
      return
    }

    this._done = true
  }

  /** Set the pause state of this item.
   *
   * OpenRA 对照: ProductionItem.Pause(bool)
   *
   * @param paused — whether to pause
   */
  pause(paused: boolean): void {
    this._paused = paused
  }
}

// ---------------------------------------------------------------------------
// ProductionQueue
// OpenRA 对照: ProductionQueue class
// ---------------------------------------------------------------------------

/** Manages a production queue for a player.
 *
 * OpenRA 对照: ProductionQueue
 *
 * Implements IResolveOrder, ITick, ITechTreeElement, INotifyOwnerChanged,
 * INotifyKilled, INotifySold, ISync, INotifyTransform, INotifyCreated.
 *
 * This is the central hub of the production system. It manages queue state,
 * build time calculation, cost deduction, prerequisite validation, low-power
 * slowdown, and item cancellation.
 */
export class ProductionQueue
  implements
    ITick,
    IResolveOrder,
    ITechTreeElement,
    INotifyOwnerChanged,
    INotifyKilled,
    INotifySold,
    INotifyTransform,
    ISync {
  /** The configuration info for this queue. */
  readonly info: ProductionQueueInfo

  /** The actor this queue is attached to. */
  readonly actor: IGameActor

  /** Map of actor name -> buildable/visible state. */
  readonly producible: Map<string, ProductionState> = new Map()

  /** The actual production queue (ordered list). */
  readonly queue: ProductionItem[] = []

  /** Linked Production traits on this actor. */
  protected productionTraits: Production[] = []

  /** PowerManager for low-power detection. */
  protected playerPower: PowerManager | null = null

  /** PlayerResources for cost deduction. */
  protected playerResources: PlayerResources | null = null

  /** DeveloperMode for cheat detection. */
  protected developerMode: DeveloperMode | null = null

  /** TechTree for prerequisite tracking. */
  protected techTree: TechTree | null = null

  /** Whether this queue is currently enabled. */
  private _enabled: boolean = false

  /** Current faction of the queue owner. */
  private _faction: string = ''

  /** Whether the current faction is valid for this queue. */
  private _isValidFaction: boolean = false

  /** All actor infos that are producible (visible or buildable). */
  private _allProducibles: ActorInfoStub[] = []

  /** All actor infos that are buildable (prerequisites met). */
  private _buildableProducibles: ActorInfoStub[] = []

  /** Ruleset actors for looking up by name. */
  private _rulesActors: Map<string, ActorInfoStub> = new Map()

  constructor(
    actor: IGameActor,
    info: ProductionQueueInfo,
    faction: string = '',
    rulesActors: Map<string, ActorInfoStub> = new Map(),
  ) {
    this.actor = actor
    this.info = info
    this._faction = faction
    this._isValidFaction = info.factions.size === 0 || info.factions.has(faction)
    this._enabled = this._isValidFaction
    this._rulesActors = rulesActors
  }

  // ---------------------------------------------------------------------------
  // ISync — marker interface (no methods)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Whether this queue is currently enabled. */
  get enabled(): boolean {
    return this._enabled
  }

  /** Current faction. */
  get faction(): string {
    return this._faction
  }

  /** Whether the current faction is valid for this queue. */
  get isValidFaction(): boolean {
    return this._isValidFaction
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated
  // ---------------------------------------------------------------------------

  /** Called when the actor is fully created.
   *
   * OpenRA 对照: INotifyCreated.Created(Actor)
   *
   * Discovers dependent traits and caches producible items.
   */
  created(_self: IGameActor): void {
    // In the stub pattern, dependencies are injected via setters or constructor
    // for testing. In a full implementation, these would be discovered from
    // the actor's trait dictionary.
    this._cacheProducibles()
  }

  /** Set the PowerManager reference.
   *
   * Used for dependency injection in tests and initialization.
   */
  setPowerManager(pm: PowerManager | null): void {
    this.playerPower = pm
  }

  /** Set the PlayerResources reference.
   *
   * Used for dependency injection in tests and initialization.
   */
  setPlayerResources(pr: PlayerResources | null): void {
    this.playerResources = pr
  }

  /** Set the DeveloperMode reference.
   *
   * Used for dependency injection in tests and initialization.
   */
  setDeveloperMode(dm: DeveloperMode | null): void {
    this.developerMode = dm
  }

  /** Set the TechTree reference.
   *
   * Used for dependency injection in tests and initialization.
   */
  setTechTree(tt: TechTree | null): void {
    this.techTree = tt
  }

  /** Set the Production traits linked to this queue.
   *
   * Used for dependency injection in tests and initialization.
   */
  setProductionTraits(traits: Production[]): void {
    this.productionTraits = traits
  }

  /** Set the ruleset actors map.
   *
   * Used for dependency injection in tests and initialization.
   */
  setRulesActors(actors: Map<string, ActorInfoStub>): void {
    this._rulesActors = actors
  }

  // ---------------------------------------------------------------------------
  // Queue management
  // ---------------------------------------------------------------------------

  /** Clear the queue and refund all costs.
   *
   * OpenRA 对照: ProductionQueue.ClearQueue()
   */
  protected clearQueue(): void {
    for (const item of this.queue) {
      if (item.resourcesPaid > 0) {
        this.playerResources?.refundResources(item.resourcesPaid)
        item.remainingCost += item.resourcesPaid
      }
      this.playerResources?.refundCash(item.totalCost - item.remainingCost)
    }
    this.queue.length = 0
  }

  // ---------------------------------------------------------------------------
  // INotifyOwnerChanged
  // ---------------------------------------------------------------------------

  /** Called when the actor's owner changes.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   */
  onOwnerChanged(_self: IGameActor, _oldOwner: PlayerStub, _newOwner: PlayerStub): void {
    this.clearQueue()

    // In a full implementation, these would be re-discovered from the new owner
    // For now, we keep the existing references (tests will set them explicitly)

    if (!this.info.sticky) {
      // In a full implementation, Faction would come from newOwner
      // this._faction = newOwner.factionInternalName
      this._isValidFaction = this.info.factions.size === 0 || this.info.factions.has(this._faction)
    }

    // Regenerate producibles and tech tree state
    this.techTree?.removeByElement(this)
    this._cacheProducibles()
    this.techTree?.update()
  }

  // ---------------------------------------------------------------------------
  // INotifyKilled / INotifySold / INotifyTransform
  // ---------------------------------------------------------------------------

  /** Called when the actor is killed. */
  killed(killed: IGameActor, _attackInfo: AttackInfo): void {
    if (killed === this.actor) {
      this.clearQueue()
      this._enabled = false
    }
  }

  /** Called when the actor is being sold. */
  selling(_self: IGameActor): void {
    this.clearQueue()
    this._enabled = false
  }

  /** Called after the actor is sold. */
  sold(_self: IGameActor): void {
    // no-op
  }

  /** Called before the actor transforms. */
  beforeTransform(_self: IGameActor): void {
    this.clearQueue()
    this._enabled = false
  }

  /** Called when the actor transforms. */
  onTransform(_self: IGameActor): void {
    // no-op
  }

  /** Called after the actor transforms. */
  afterTransform(_self: IGameActor): void {
    // no-op
  }

  // ---------------------------------------------------------------------------
  // TechTree element callbacks (ITechTreeElement)
  // ---------------------------------------------------------------------------

  /** Called when all prerequisites for this item are now satisfied.
   *
   * OpenRA 对照: ITechTreeElement.PrerequisitesAvailable(string)
   */
  prerequisitesAvailable(key: string): void {
    const state = this.producible.get(key)
    if (state) {
      state.buildable = true
    }
  }

  /** Called when prerequisites for this item are no longer satisfied.
   *
   * OpenRA 对照: ITechTreeElement.PrerequisitesUnavailable(string)
   */
  prerequisitesUnavailable(key: string): void {
    const state = this.producible.get(key)
    if (state) {
      state.buildable = false
    }
  }

  /** Called when this item should be hidden from the production palette.
   *
   * OpenRA 对照: ITechTreeElement.PrerequisitesItemHidden(string)
   */
  prerequisitesItemHidden(key: string): void {
    const state = this.producible.get(key)
    if (state) {
      state.visible = false
    }
  }

  /** Called when this item should be shown in the production palette.
   *
   * OpenRA 对照: ITechTreeElement.PrerequisitesItemVisible(string)
   */
  prerequisitesItemVisible(key: string): void {
    const state = this.producible.get(key)
    if (state) {
      state.visible = true
    }
  }

  // ---------------------------------------------------------------------------
  // Producible caching
  // ---------------------------------------------------------------------------

  /** Populate Producible from ruleset actors with BuildableInfo.
   *
   * OpenRA 对照: ProductionQueue.CacheProducibles()
   */
  protected _cacheProducibles(): void {
    this.producible.clear()
    if (!this._enabled) {
      this._allProducibles = []
      this._buildableProducibles = []
      return
    }

    const buildables = this._allBuildables(this.info.type)
    for (const a of buildables) {
      const bi = this._getBuildableInfo(a)
      if (!bi) continue

      this.producible.set(a.name, new ProductionState())
      this.techTree?.add(a.name, bi.prerequisites, bi.buildLimit, this)
    }

    this._updateProducibleLists()
  }

  /** Get all buildable actors for a given category.
   *
   * OpenRA 对照: ProductionQueue.AllBuildables(string)
   *
   * @param category — the queue type to filter by
   * @returns array of ActorInfo stubs that can be built in this queue
   */
  protected _allBuildables(category: string): ActorInfoStub[] {
    const result: ActorInfoStub[] = []
    for (const [, actorInfo] of this._rulesActors) {
      if (actorInfo.name.startsWith('^')) continue
      const bi = this._getBuildableInfo(actorInfo)
      if (!bi) continue
      if (bi.queue.has(category)) {
        result.push(actorInfo)
      }
    }
    return result
  }

  /** Extract BuildableInfo from an ActorInfo stub.
   *
   * In the full implementation, ActorInfo would have a trait dictionary.
   * For now, we use a helper that tests can override.
   */
  protected _getBuildableInfo(actorInfo: ActorInfoStub): BuildableInfo | null {
    // In a full implementation, this would look up the BuildableInfo from
    // the actor's trait configuration. For the stub pattern, we rely on
    // the test setup to provide BuildableInfo via the actor's info field
    // or through a side channel.
    //
    // For testing, we use a type assertion to access the _buildableInfo
    // property that tests attach to the actor info stub.
    const extended = actorInfo as unknown as Record<string, unknown>
    const bi = extended._buildableInfo as BuildableInfo | undefined
    return bi ?? null
  }

  /** Update the cached producible lists. */
  private _updateProducibleLists(): void {
    this._allProducibles = []
    this._buildableProducibles = []
    for (const [name, state] of this.producible) {
      const actorInfo = this._rulesActors.get(name)
      if (!actorInfo) continue
      if (state.buildable || state.visible) {
        this._allProducibles.push(actorInfo)
      }
      if (state.buildable) {
        this._buildableProducibles.push(actorInfo)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------------------

  /** Check if the given item is currently being produced (first in queue).
   *
   * OpenRA 对照: ProductionQueue.IsProducing(ProductionItem)
   *
   * @param item — the item to check
   * @returns true if this item is at the front of the queue
   */
  isProducing(item: ProductionItem): boolean {
    return this.queue.length > 0 && this.queue[0] === item
  }

  /** Check if an actor is already in the queue.
   *
   * OpenRA 对照: ProductionQueue.IsInQueue(ActorInfo)
   *
   * @param actor — the actor info to check
   * @returns true if any item in the queue builds this actor
   */
  isInQueue(actor: ActorInfoStub): boolean {
    for (const item of this.queue) {
      if (item.item === actor.name) {
        return true
      }
    }
    return false
  }

  /** Get the current item being produced (first in queue).
   *
   * OpenRA 对照: ProductionQueue.CurrentItem()
   *
   * @returns the first item, or null if queue is empty
   */
  currentItem(): ProductionItem | null {
    return this.queue.length > 0 ? this.queue[0] : null
  }

  /** Get all queued items.
   *
   * OpenRA 对照: ProductionQueue.AllQueued()
   *
   * @returns array of all queued items
   */
  allQueued(): ProductionItem[] {
    return [...this.queue]
  }

  /** Get all items that could be produced (visible or buildable).
   *
   * OpenRA 对照: ProductionQueue.AllItems()
   *
   * @returns array of actor infos
   */
  allItems(): ActorInfoStub[] {
    if (this.productionTraits.length > 0 && this._allProductionTraitsDisabled()) {
      return []
    }
    if (this.developerMode?.allTech) {
      return Array.from(this.producible.keys())
        .map((name) => this._rulesActors.get(name))
        .filter((a): a is ActorInfoStub => a !== undefined)
    }
    return this._allProducibles
  }

  /** Get all items that are currently buildable.
   *
   * OpenRA 对照: ProductionQueue.BuildableItems()
   *
   * @returns array of buildable actor infos
   */
  buildableItems(): ActorInfoStub[] {
    if (this.productionTraits.length > 0 && this._allProductionTraitsDisabled()) {
      return []
    }
    if (!this._enabled) {
      return []
    }
    if (!this.info.payUpFront && this.developerMode?.allTech) {
      return Array.from(this.producible.keys())
        .map((name) => this._rulesActors.get(name))
        .filter((a): a is ActorInfoStub => a !== undefined)
    }
    if (this.info.payUpFront && this.developerMode?.allTech) {
      return Array.from(this.producible.keys())
        .map((name) => this._rulesActors.get(name))
        .filter((a): a is ActorInfoStub => a !== undefined)
        .filter((a) => this._getProductionCost(a) <= (this.playerResources?.getCashAndResources() ?? 0) || this.isInQueue(a))
    }
    if (this.info.payUpFront) {
      return this._buildableProducibles.filter(
        (a) => this._getProductionCost(a) <= (this.playerResources?.getCashAndResources() ?? 0) || this.isInQueue(a),
      )
    }
    return this._buildableProducibles
  }

  /** Check if there are any items that can be built.
   *
   * OpenRA 对照: ProductionQueue.AnyItemsToBuild()
   *
   * @returns true if there are buildable items
   */
  anyItemsToBuild(): boolean {
    if (!this._enabled) {
      return false
    }
    if (this.productionTraits.length > 0 && this._allProductionTraitsDisabled()) {
      return false
    }
    if (this.developerMode?.allTech && this.producible.size > 0) {
      return true
    }
    return this._buildableProducibles.length > 0
  }

  /** Check if a specific actor can be built.
   *
   * OpenRA 对照: ProductionQueue.CanBuild(ActorInfo)
   *
   * @param actor — the actor info to check
   * @returns true if the actor is buildable (or allTech is enabled)
   */
  canBuild(actor: ActorInfoStub): boolean {
    const state = this.producible.get(actor.name)
    if (!state) {
      return false
    }
    return state.buildable || (this.developerMode?.allTech ?? false)
  }

  /** Check if all production traits are disabled.
   *
   * PERF: Avoid LINQ — explicit loop.
   */
  private _allProductionTraitsDisabled(): boolean {
    for (const p of this.productionTraits) {
      if (!p.isTraitDisabled) {
        return false
      }
    }
    return true
  }

  /** Check if any production trait is not disabled.
   *
   * PERF: Avoid LINQ — explicit loop.
   * @deprecated Currently unused; kept for API parity with OpenRA.
   */
  // @ts-expect-error: kept for API parity, not yet used
  private _anyProductionTraitEnabled(): boolean {
    for (const p of this.productionTraits) {
      if (!p.isTraitDisabled) {
        return true
      }
    }
    return false
  }

  /** Check if any production trait is not paused.
   *
   * PERF: Avoid LINQ — explicit loop.
   * @deprecated Currently unused; kept for API parity with OpenRA.
   */
  // @ts-expect-error: kept for API parity, not yet used
  private _anyProductionTraitUnpaused(): boolean {
    for (const p of this.productionTraits) {
      if (!p.isTraitPaused) {
        return true
      }
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Tick logic
  // ---------------------------------------------------------------------------

  /** Called every game tick.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   */
  tick(self: IGameActor): void {
    this._tick(self)
  }

  /** Main tick logic.
   *
   * OpenRA 对照: ProductionQueue.Tick(Actor)
   */
  protected _tick(self: IGameActor): void {
    // PERF: Avoid LINQ when checking whether all production traits are disabled/paused
    let anyEnabledProduction = false
    let anyUnpausedProduction = false
    for (const p of this.productionTraits) {
      anyEnabledProduction ||= !p.isTraitDisabled
      anyUnpausedProduction ||= !p.isTraitPaused
    }

    if (!anyEnabledProduction) {
      this.clearQueue()
    }

    this._enabled = this._isValidFaction && anyEnabledProduction
    this._tickInner(self, !anyUnpausedProduction)
  }

  /** Inner tick logic — advances queue progress.
   *
   * OpenRA 对照: ProductionQueue.TickInner(Actor, bool)
   */
  protected _tickInner(_self: IGameActor, allProductionPaused: boolean): void {
    this._cancelUnbuildableItems()

    if (this.queue.length > 0 && !allProductionPaused && this.playerResources) {
      this.queue[0].tick(this.playerResources)
    }
  }

  /** Cancel items that are no longer buildable and refund costs.
   *
   * OpenRA 对照: ProductionQueue.CancelUnbuildableItems()
   */
  protected _cancelUnbuildableItems(): void {
    if (this.queue.length === 0) {
      return
    }

    const buildableNames = new Set<string>()
    for (const b of this.buildableItems()) {
      buildableNames.add(b.name)
    }

    // EndProduction removes the item from the queue, so we enumerate
    // by index in reverse to avoid issues with index reassignment
    let cancelledAnItem = false
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (buildableNames.has(this.queue[i].item)) {
        continue
      }

      // Refund spent resources
      if (this.queue[i].resourcesPaid > 0) {
        this.playerResources?.refundResources(this.queue[i].resourcesPaid)
        this.queue[i].remainingCost += this.queue[i].resourcesPaid
      }

      // Refund what's been paid so far
      this.playerResources?.refundCash(this.queue[i].totalCost - this.queue[i].remainingCost)
      this._endProduction(this.queue[i])
      cancelledAnItem = true
    }

    if (cancelledAnItem) {
      // TODO-8.F: Wire up to Sound.PlayNotification
      // TODO-16.X: Wire up to TextNotificationsManager
    }
  }

  // ---------------------------------------------------------------------------
  // CanQueue — validation before adding to queue
  // ---------------------------------------------------------------------------

  /** Check if an actor can be added to the queue.
   *
   * OpenRA 对照: ProductionQueue.CanQueue(ActorInfo, out string, out string)
   *
   * @param actor — the actor to check
   * @returns object with success flag and notification strings
   */
  canQueue(actor: ActorInfoStub): {
    canQueue: boolean
    notificationAudio: string | null
    notificationText: string | null
  } {
    let notificationAudio = this.info.blockedAudio
    let notificationText = this.info.blockedTextNotification

    const bi = this._getBuildableInfo(actor)
    if (!bi) {
      return { canQueue: false, notificationAudio, notificationText }
    }

    if (!(this.developerMode?.allTech ?? false)) {
      // Check affordability for pay-up-front queues
      if (this.info.payUpFront) {
        const cost = this._getProductionCost(actor)
        if (cost > (this.playerResources?.getCashAndResources() ?? 0)) {
          return { canQueue: false, notificationAudio, notificationText }
        }
      }

      // Check queue limit
      if (this.info.queueLimit > 0 && this.queue.length >= this.info.queueLimit) {
        notificationAudio = this.info.limitedAudio
        notificationText = this.info.limitedTextNotification
        return { canQueue: false, notificationAudio, notificationText }
      }

      // Check item limit
      let queueCount = 0
      for (const item of this.queue) {
        if (item.item === actor.name) {
          queueCount++
        }
      }
      if (this.info.itemLimit > 0 && queueCount >= this.info.itemLimit) {
        notificationAudio = this.info.limitedAudio
        notificationText = this.info.limitedTextNotification
        return { canQueue: false, notificationAudio, notificationText }
      }

      // Check build limit
      if (bi.buildLimit > 0) {
        // In full implementation: count owned actors of this type
        // For now, we just check queue count against build limit
        if (queueCount >= bi.buildLimit) {
          return { canQueue: false, notificationAudio, notificationText }
        }
      }
    }

    notificationAudio = this.info.queuedAudio
    notificationText = this.info.queuedTextNotification
    return { canQueue: true, notificationAudio, notificationText }
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // ---------------------------------------------------------------------------

  /** Handle player-issued orders.
   *
   * OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
   *
   * Handles "StartProduction", "PauseProduction", "CancelProduction" orders.
   */
  resolveOrder(_self: IGameActor, order: Order): void {
    if (!this._enabled) {
      return
    }

    const orderName = order.orderName
    const targetString = order.targetString as string
    const extraData = order.extraData as number | boolean

    switch (orderName) {
      case 'StartProduction': {
        const unit = this._rulesActors.get(targetString)
        if (!unit) {
          return
        }
        const bi = this._getBuildableInfo(unit)
        if (!bi) {
          return
        }

        // Not built by this queue
        if (!bi.queue.has(this.info.type)) {
          return
        }

        // You can't build that
        if (!this._buildableItemsContains(targetString)) {
          return
        }

        // Check if the player is trying to build more units than they are allowed
        let fromLimit = Number.MAX_SAFE_INTEGER
        if (!(this.developerMode?.allTech ?? false)) {
          if (this.info.queueLimit > 0) {
            fromLimit = this.info.queueLimit - this.queue.length
          }

          if (this.info.itemLimit > 0) {
            const inQueue = this._countInQueue(targetString)
            fromLimit = Math.min(fromLimit, this.info.itemLimit - inQueue)
          }

          if (bi.buildLimit > 0) {
            const inQueue = this._countInQueue(targetString)
            // In full implementation: count owned actors
            const owned = 0
            fromLimit = Math.min(fromLimit, bi.buildLimit - (inQueue + owned))
          }

          if (fromLimit <= 0) {
            return
          }
        }

        const cost = this._getProductionCost(unit)
        const amountToBuild = Math.min(fromLimit, typeof extraData === 'number' ? extraData : 1)

        for (let n = 0; n < amountToBuild; n++) {
          if (this.info.payUpFront && cost > (this.playerResources?.getCashAndResources() ?? 0)) {
            return
          }

          const newItem = new ProductionItem(
            this,
            targetString,
            cost,
            this.playerPower,
            () => {
              // On complete callback
              // In full implementation: checks if item still done, plays notification,
              // calls BuildUnit for non-buildings
            },
            unit,
            bi,
          )
          this._beginProduction(newItem, !(extraData as boolean))
        }
        break
      }

      case 'PauseProduction': {
        this._pauseProduction(targetString, !!extraData)
        break
      }

      case 'CancelProduction': {
        this._cancelProduction(targetString, typeof extraData === 'number' ? extraData : 1)
        break
      }
    }
  }

  /** Check if buildableItems contains an actor with the given name.
   *
   * PERF: Avoid LINQ — explicit loop.
   */
  private _buildableItemsContains(name: string): boolean {
    for (const b of this.buildableItems()) {
      if (b.name === name) {
        return true
      }
    }
    return false
  }

  /** Count how many items of a given name are in the queue.
   *
   * PERF: Avoid LINQ — explicit loop.
   */
  private _countInQueue(name: string): number {
    let count = 0
    for (const item of this.queue) {
      if (item.item === name) {
        count++
      }
    }
    return count
  }

  // ---------------------------------------------------------------------------
  // Build time and cost calculation
  // ---------------------------------------------------------------------------

  /** Calculate the build time for a unit.
   *
   * OpenRA 对照: ProductionQueue.GetBuildTime(ActorInfo, BuildableInfo)
   *
   * @param unit — the actor info
   * @param bi — the buildable info
   * @returns build time in ticks
   */
  getBuildTime(unit: ActorInfoStub, bi: BuildableInfo): number {
    if (this.developerMode?.fastBuild ?? false) {
      return 0
    }

    var time = bi.buildDuration;
    if (time == -1)
      time = this._getProductionCost(unit);

    // Apply modifiers
    // In full implementation: IProductionTimeModifierInfo modifiers
    // For now: apply BuildableInfo.BuildDurationModifier and Info.BuildDurationModifier
    time = Math.floor((time * bi.buildDurationModifier) / 100);
    time = Math.floor((time * this.info.buildDurationModifier) / 100);

    return time;
  }

  /** Calculate the production cost for a unit.
   *
   * OpenRA 对照: ProductionQueue.GetProductionCost(ActorInfo)
   *
   * @param unit — the actor info
   * @returns the production cost
   */
  protected _getProductionCost(unit: ActorInfoStub): number {
    // In full implementation: lookup ValuedInfo.Cost
    // For now, use a type assertion to access the _cost property
    const extended = unit as unknown as Record<string, unknown>
    const cost = extended._cost as number | undefined
    return cost ?? 0
  }

  // ---------------------------------------------------------------------------
  // Queue manipulation
  // ---------------------------------------------------------------------------

  /** Pause or unpause production of a named item.
   *
   * OpenRA 对照: ProductionQueue.PauseProduction(string, bool)
   *
   * @param itemName — the actor name to pause/unpause
   * @param paused — whether to pause
   */
  protected _pauseProduction(itemName: string, paused: boolean): void {
    for (const item of this.queue) {
      if (item.item === itemName) {
        item.pause(paused)
        return
      }
    }
  }

  /** Cancel production of N items of a given type.
   *
   * OpenRA 对照: ProductionQueue.CancelProduction(string, uint)
   *
   * @param itemName — the actor name to cancel
   * @param numberToCancel — how many to cancel
   */
  protected _cancelProduction(itemName: string, numberToCancel: number): void {
    for (let i = 0; i < numberToCancel; i++) {
      if (!this._cancelProductionInner(itemName)) {
        break
      }
    }
  }

  /** Cancel the last item of a given type.
   *
   * OpenRA 对照: ProductionQueue.CancelProductionInner(string)
   *
   * @param itemName — the actor name to cancel
   * @returns true if an item was cancelled
   */
  protected _cancelProductionInner(itemName: string): boolean {
    // Find the last item of this type
    let item: ProductionItem | null = null
    let itemIndex = -1
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].item === itemName) {
        item = this.queue[i]
        itemIndex = i
        break
      }
    }

    if (item !== null && itemIndex >= 0) {
      if (item.infinite) {
        item.infinite = false
        for (let i = 1; i < this.info.infiniteBuildLimit; i++) {
          const newItem = new ProductionItem(
            this,
            item.item,
            item.totalCost,
            this.playerPower,
            item.onComplete,
            item._actorInfo,
            item._buildableInfo,
          )
          this.queue.push(newItem)
        }
      } else {
        // Refund what has been paid
        if (item.resourcesPaid > 0) {
          this.playerResources?.refundResources(item.resourcesPaid)
          item.remainingCost += item.resourcesPaid
        }
        this.playerResources?.refundCash(item.totalCost - item.remainingCost)
        this._endProduction(item)
      }
      return true
    }

    return false
  }

  /** Remove an item from the queue.
   *
   * OpenRA 对照: ProductionQueue.EndProduction(ProductionItem)
   *
   * @param item — the item to remove
   */
  protected _endProduction(item: ProductionItem): void {
    const index = this.queue.indexOf(item)
    if (index >= 0) {
      this.queue.splice(index, 1)
    }

    if (item.infinite) {
      const newItem = new ProductionItem(
        this,
        item.item,
        item.totalCost,
        this.playerPower,
        item.onComplete,
        item._actorInfo,
        item._buildableInfo,
      )
      newItem.infinite = true
      this.queue.push(newItem)
    }
  }

  /** Add an item to the queue.
   *
   * OpenRA 对照: ProductionQueue.BeginProduction(ProductionItem, bool)
   *
   * @param item — the item to add
   * @param hasPriority — whether to insert at position 1 (after current)
   */
  protected _beginProduction(item: ProductionItem, hasPriority: boolean): void {
    if (this.info.payUpFront && this.playerResources) {
      if (this.playerResources.resources > 0 && this.playerResources.resources <= item.totalCost) {
        item.resourcesPaid = this.playerResources.resources
      } else if (this.playerResources.resources > item.totalCost) {
        item.resourcesPaid = item.totalCost
      }
      this.playerResources.takeCash(item.totalCost)
      item.remainingCost = 0
    }

    // Check if there's already an infinite item of this type
    for (const q of this.queue) {
      if (q.item === item.item && q.infinite) {
        return
      }
    }

    if (hasPriority && this.queue.length > 1) {
      this.queue.splice(1, 0, item)
    } else {
      this.queue.push(item)
    }

    if (this.info.infiniteBuildLimit < 0) {
      return
    }

    // Count items of this type
    const queued: ProductionItem[] = []
    for (const q of this.queue) {
      if (q.item === item.item) {
        queued.push(q)
      }
    }

    if (queued.length <= this.info.infiniteBuildLimit) {
      return
    }

    // Mark first as infinite, cancel the rest
    queued[0].infinite = true
    for (let i = 1; i < queued.length; i++) {
      if (queued[i].resourcesPaid > 0) {
        this.playerResources?.refundResources(queued[i].resourcesPaid)
        queued[i].remainingCost += queued[i].resourcesPaid
      }
      this.playerResources?.refundCash(queued[i].totalCost - queued[i].remainingCost)
      this._endProduction(queued[i])
    }
  }

  /** Get the actual remaining time for an item, accounting for low power.
   *
   * OpenRA 对照: ProductionQueue.RemainingTimeActual(ProductionItem)
   *
   * @param item — the item to check
   * @returns remaining time in ticks
   */
  remainingTimeActual(item: ProductionItem): number {
    return item.remainingTimeActual
  }

  // ---------------------------------------------------------------------------
  // Producer selection
  // ---------------------------------------------------------------------------

  /** Find the most likely production trait to use.
   *
   * OpenRA 对照: ProductionQueue.MostLikelyProducer()
   *
   * @returns the best Production trait for this queue
   */
  mostLikelyProducer(): Production | null {
    let bestTrait: Production | null = null
    for (const p of this.productionTraits) {
      if (p.isTraitDisabled) {
        continue
      }
      if (!p.info.produces.has(this.info.type)) {
        continue
      }
      if (bestTrait === null || (!p.isTraitPaused && bestTrait.isTraitPaused)) {
        bestTrait = p
      }
    }
    return bestTrait
  }

  /** Attempt to build a unit from the queue.
   *
   * OpenRA 对照: ProductionQueue.BuildUnit(ActorInfo)
   *
   * @param unit — the actor info to build
   * @returns true if production succeeded
   */
  protected _buildUnit(unit: ActorInfoStub): boolean {
    const mostLikelyProducerTrait = this.mostLikelyProducer()

    // Cannot produce if actor is dead or trait is disabled
    if (!this.actor.isInWorld || this.actor.isDead || mostLikelyProducerTrait === null) {
      this._cancelProduction(unit.name, 1)
      return false
    }

    // Find the first done item for this unit
    let item: ProductionItem | null = null
    for (const q of this.queue) {
      if (q.done && q.item === unit.name) {
        item = q
        break
      }
    }

    if (item === null) {
      return false
    }

    // In full implementation: build inits, call producer.Produce()
    // For now, this is a simplified version
    if (!mostLikelyProducerTrait.isTraitPaused) {
      // Production succeeded
      this._endProduction(item)
      return true
    }

    return false
  }
}
