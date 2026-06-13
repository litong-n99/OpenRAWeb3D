/**
 * PlayerResources.ts — 玩家经济中枢：管理现金、资源存储与消费
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlayerResources.cs (264 lines)
 *
 * 核心范式转换:
 * - C# plain class + ISync → TS ConditionalTrait<PlayerResourcesInfo> + ISync
 *   (ConditionalTrait 提供 attach/detach 生命周期和条件支持)
 * - C# constructor reads LobbyInfo.GlobalSettings → TS created() 使用
 *   Info.DefaultCash (LobbyInfo 推迟至第16章)
 * - C# Game.RunTime → TS Date.now() (TODO-16.X: 替换为游戏时间)
 * - C# Game.Sound.PlayNotification / TextNotificationsManager → TS 桩 (TODO)
 * - C# checked 溢出保护 → TS Number.isSafeInteger() 钳位
 * - C# public fields (Cash, Resources, ResourceCapacity) → TS public properties
 * - C# [VerifySync] → TS getter (cashSync, resourcesSync, resourceCapacitySync)
 *
 * PlayerResources 是附加到玩家 Actor 上的核心经济 trait。所有与玩家经济
 * 相关的操作（现金、资源存储、消费）都通过此类进行。其他 trait 通过
 * owner.playerActor._playerResources 搜索模式发现此实例。
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  ISync,
  INotifyCreated,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// PlayerResourcesInfo
// OpenRA 对照: PlayerResourcesInfo (TraitInfo, ILobbyOptions)
// ---------------------------------------------------------------------------

/** Configuration for the PlayerResources trait.
 *
 * OpenRA 对照: PlayerResourcesInfo
 *
 * NOTE: ILobbyOptions is deferred to Chapter 16. The lobby-related fields
 * (SelectableCash, DefaultCashDropdownLocked, DefaultCashDropdownVisible,
 * DefaultCashDropdownDisplayOrder, DefaultCashDropdownDescription) are
 * preserved for future lobby integration.
 */
export class PlayerResourcesInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  // -----------------------------------------------------------------------
  // Lobby options (ILobbyOptions — deferred to Chapter 16)
  // OpenRA 对照: ILobbyOptions members
  // -----------------------------------------------------------------------

  /** Descriptive label for the starting cash option in the lobby.
   *
   * OpenRA 对照: DefaultCashDropdownLabel
   */
  readonly defaultCashDropdownLabel: string = 'Starting Cash'

  /** Starting cash options that are available in the lobby options.
   * DefaultCash will be included if not specified.
   *
   * OpenRA 对照: SelectableCash (ImmutableArray<int>)
   */
  readonly selectableCash: readonly number[] = [2500, 5000, 10000, 20000]

  /** Default starting cash option: should be one of the SelectableCash options.
   *
   * OpenRA 对照: DefaultCash
   */
  readonly defaultCash: number = 5000

  /** Force the DefaultCash option by disabling changes in the lobby.
   *
   * OpenRA 对照: DefaultCashDropdownLocked
   */
  readonly defaultCashDropdownLocked: boolean = false

  /** Whether to display the DefaultCash option in the lobby.
   *
   * OpenRA 对照: DefaultCashDropdownVisible
   */
  readonly defaultCashDropdownVisible: boolean = true

  // -----------------------------------------------------------------------
  // Notifications
  // OpenRA 对照: InsufficientFundsNotification / InsufficientFundsTextNotification
  // -----------------------------------------------------------------------

  /** Speech notification to play when the player does not have any funds.
   *
   * OpenRA 对照: InsufficientFundsNotification
   *
   * TODO-8.F: Wire up to Sound.PlayNotification when Game context is available.
   */
  readonly insufficientFundsNotification: string | null = null

  /** Text notification to display when the player does not have any funds.
   *
   * OpenRA 对照: InsufficientFundsTextNotification
   *
   * TODO-16.X: Wire up to TextNotificationsManager when UI system is available.
   */
  readonly insufficientFundsTextNotification: string | null = null

  /** Delay (in milliseconds) during which warnings will be muted.
   *
   * OpenRA 对照: InsufficientFundsNotificationInterval
   */
  readonly insufficientFundsNotificationInterval: number = 30000

  /** Sound notification when cash increases ("cash tick up").
   *
   * OpenRA 对照: CashTickUpNotification
   *
   * TODO-8.F: Wire up to Sound.PlayNotification.
   */
  readonly cashTickUpNotification: string | null = null

  /** Sound notification when cash decreases ("cash tick down").
   *
   * OpenRA 对照: CashTickDownNotification
   *
   * TODO-8.F: Wire up to Sound.PlayNotification.
   */
  readonly cashTickDownNotification: string | null = null

  // -----------------------------------------------------------------------
  // Resource values
  // OpenRA 对照: ResourceValues (FrozenDictionary<string, int>)
  // -----------------------------------------------------------------------

  /** Monetary value of each resource type.
   * Dictionary mapping resource type name to value per unit.
   *
   * OpenRA 对照: ResourceValues (FrozenDictionary<string, int>)
   *
   * Example: { "ore": 50, "gems": 100 } means each unit of ore is worth $50.
   */
  readonly resourceValues: ReadonlyMap<string, number> = new Map()

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    defaultCashDropdownLabel?: string
    selectableCash?: readonly number[]
    defaultCash?: number
    defaultCashDropdownLocked?: boolean
    defaultCashDropdownVisible?: boolean
    insufficientFundsNotification?: string | null
    insufficientFundsTextNotification?: string | null
    insufficientFundsNotificationInterval?: number
    cashTickUpNotification?: string | null
    cashTickDownNotification?: string | null
    resourceValues?: ReadonlyMap<string, number>
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    if (params.defaultCashDropdownLabel !== undefined) this.defaultCashDropdownLabel = params.defaultCashDropdownLabel
    if (params.selectableCash !== undefined) this.selectableCash = params.selectableCash
    if (params.defaultCash !== undefined) this.defaultCash = params.defaultCash
    if (params.defaultCashDropdownLocked !== undefined) this.defaultCashDropdownLocked = params.defaultCashDropdownLocked
    if (params.defaultCashDropdownVisible !== undefined) this.defaultCashDropdownVisible = params.defaultCashDropdownVisible
    if (params.insufficientFundsNotification !== undefined) this.insufficientFundsNotification = params.insufficientFundsNotification
    if (params.insufficientFundsTextNotification !== undefined) this.insufficientFundsTextNotification = params.insufficientFundsTextNotification
    if (params.insufficientFundsNotificationInterval !== undefined) this.insufficientFundsNotificationInterval = params.insufficientFundsNotificationInterval
    if (params.cashTickUpNotification !== undefined) this.cashTickUpNotification = params.cashTickUpNotification
    if (params.cashTickDownNotification !== undefined) this.cashTickDownNotification = params.cashTickDownNotification
    if (params.resourceValues !== undefined) this.resourceValues = params.resourceValues
  }
}

// ---------------------------------------------------------------------------
// PlayerResources
// OpenRA 对照: PlayerResources (ISync)
// ---------------------------------------------------------------------------

/** Central player economy manager — manages cash, resource storage, and spending.
 *
 * OpenRA 对照: PlayerResources
 *
 * This trait is attached to the player actor. Other traits discover it via
 * `owner.playerActor._playerResources`. It provides:
 * - Cash management: addCash, takeCash, changeCash
 * - Resource storage: giveResources, takeResources, capacity management
 * - Affordability: canAfford, getCashAndResources
 * - Sync hashes: cashSync, resourcesSync, resourceCapacitySync
 *
 * Key behavior rules:
 * - "Spend ore before cash": takeCash() consumes resources first, then cash
 * - Overflow protection: cash is clamped to Number.MAX_SAFE_INTEGER
 * - Capacity overflow: resources beyond ResourceCapacity are discarded
 * - Insufficient funds notification: rate-limited by interval
 */
export class PlayerResources
  extends ConditionalTrait<PlayerResourcesInfo>
  implements ISync, INotifyCreated
{
  // -----------------------------------------------------------------------
  // Cash state
  // OpenRA 对照: Cash, Earned, Spent (public int fields)
  // -----------------------------------------------------------------------

  /** Current cash balance.
   *
   * OpenRA 对照: Cash
   */
  cash: number = 0

  /** Total cash ever earned (not counting refunds).
   *
   * OpenRA 对照: Earned
   */
  earned: number = 0

  /** Total cash ever spent (not counting refunds).
   *
   * OpenRA 对照: Spent
   */
  spent: number = 0

  // -----------------------------------------------------------------------
  // Resource state
  // OpenRA 对照: Resources, ResourceCapacity (public int fields)
  // -----------------------------------------------------------------------

  /** Current amount of resources stored.
   *
   * OpenRA 对照: Resources
   */
  resources: number = 0

  /** Maximum resource storage capacity.
   *
   * OpenRA 对照: ResourceCapacity
   */
  resourceCapacity: number = 0

  // -----------------------------------------------------------------------
  // Sync hashes (对应 OpenRA [VerifySync])
  // -----------------------------------------------------------------------

  /** Sync hash for cash. Simple pass-through of the cash value.
   *
   * OpenRA 对照: [VerifySync] int Cash
   */
  get cashSync(): number {
    return this.cash
  }

  /** Sync hash for resources. Simple pass-through of the resources value.
   *
   * OpenRA 对照: [VerifySync] int Resources
   */
  get resourcesSync(): number {
    return this.resources
  }

  /** Sync hash for resource capacity. Simple pass-through of the capacity value.
   *
   * OpenRA 对照: [VerifySync] int ResourceCapacity
   */
  get resourceCapacitySync(): number {
    return this.resourceCapacity
  }

  // -----------------------------------------------------------------------
  // Notification state
  // -----------------------------------------------------------------------

  /** Timestamp of the last insufficient-funds notification.
   *
   * OpenRA 对照: long lastNotificationTime
   *
   * Initialized to negative interval so the first notification fires immediately
   * when funds are insufficient from the start.
   *
   * TODO-16.X: Replace Date.now() with Game.RunTime when game time is available.
   */
  private _lastNotificationTime: number = -30000

  constructor(info: PlayerResourcesInfo) {
    super(info)
    this._lastNotificationTime = -info.insufficientFundsNotificationInterval
  }

  // -----------------------------------------------------------------------
  // Lifecycle (Component overrides)
  // -----------------------------------------------------------------------

  /** Called when this trait is attached to a player actor.
   *
   * Sets the _playerResources property on the actor so other traits can
   * discover this instance via the discovery pattern:
   *   owner.playerActor._playerResources
   *
   * OpenRA 对照: N/A (C# uses trait resolution via Actor.Trait<T>())
   *
   * @param actor — the player actor this trait is being attached to
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    // Make this instance discoverable by other traits via the
    // _playerResources pattern (used by StoresPlayerResources, Refinery, etc.)
    ;(actor as unknown as Record<string, unknown>)._playerResources = this
  }

  /** Called when this trait is detached from its player actor.
   *
   * Clears the _playerResources reference from the actor.
   *
   * @param actor — the player actor this trait was attached to
   */
  override detach(actor: IGameActor): void {
    const actorExt = actor as unknown as Record<string, unknown>
    if (actorExt._playerResources === this) {
      delete actorExt._playerResources
    }
    super.detach(actor)
  }

  // -----------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: constructor body (reads LobbyInfo → sets Cash)
  // -----------------------------------------------------------------------

  /** Called when the actor is fully created.
   *
   * Sets the initial cash balance. Uses Info.DefaultCash.
   *
   * OpenRA 对照: PlayerResources constructor (reads self.World.LobbyInfo)
   *
   * NOTE: In OpenRA C#, the constructor reads from
   *   self.World.LobbyInfo.GlobalSettings.OptionOrDefault("startingcash", ...)
   * In this TS migration, lobby integration is deferred to Chapter 16.
   * Info.DefaultCash is used as the initial cash amount.
   *
   * TODO-16.X: Read starting cash from lobby settings when LobbyInfo is
   *            migrated.
   */
  created(_actor: IGameActor): void {
    this.cash = this.info.defaultCash
  }

  // -----------------------------------------------------------------------
  // Cash management
  // OpenRA 对照: GiveCash, RefundCash, TakeCash, ChangeCash
  // -----------------------------------------------------------------------

  /** Add cash to the player's balance.
   *
   * OpenRA 对照: GiveCash(int num, bool isRefund = false)
   *
   * Overflow protection: if Cash would exceed Number.MAX_SAFE_INTEGER,
   * it is clamped. Same for Earned (if not a refund) and Spent (if a refund).
   *
   * @param amount — the amount of cash to add (must be non-negative)
   * @param isRefund — if true, this is a refund (reduces Spent instead of
   *   increasing Earned)
   */
  addCash(amount: number, isRefund: boolean = false): void {
    if (amount <= 0) return

    // Protect Cash from exceeding safe integer range
    if (this.cash < Number.MAX_SAFE_INTEGER) {
      const newCash = this.cash + amount
      this.cash = Number.isSafeInteger(newCash) ? newCash : Number.MAX_SAFE_INTEGER
    }

    if (!isRefund) {
      // Normal income: increase Earned
      if (this.earned < Number.MAX_SAFE_INTEGER) {
        const newEarned = this.earned + amount
        this.earned = Number.isSafeInteger(newEarned) ? newEarned : Number.MAX_SAFE_INTEGER
      }
    } else {
      // Refund: decrease Spent
      if (this.spent > Number.MIN_SAFE_INTEGER) {
        const newSpent = this.spent - amount
        this.spent = Number.isSafeInteger(newSpent) ? newSpent : Number.MIN_SAFE_INTEGER
      }
    }
  }

  /** Refund cash to the player (same as addCash with isRefund=true).
   *
   * OpenRA 对照: RefundCash(int num)
   *
   * @param amount — the amount of cash to refund
   */
  refundCash(amount: number): void {
    this.addCash(amount, true)
  }

  /** Take cash from the player.
   *
   * OpenRA 对照: TakeCash(int num, bool notifyLowFunds = false)
   *
   * "Spend ore before cash" rule: Resources are consumed first. If Resources
   * go negative, Cash covers the remainder.
   *
   * If the player cannot afford the total (cash + resources < amount),
   * returns false and optionally triggers a low-funds notification
   * (rate-limited by insufficientFundsNotificationInterval).
   *
   * @param amount — the amount of cash to take
   * @param notifyLowFunds — if true, trigger a notification when funds are
   *   insufficient
   * @returns true if the amount was successfully deducted, false if the
   *   player had insufficient funds
   */
  takeCash(amount: number, notifyLowFunds: boolean = false): boolean {
    if (amount <= 0) return true

    if (this.getCashAndResources() < amount) {
      if (notifyLowFunds) {
        const now = Date.now()
        const interval = this.info.insufficientFundsNotificationInterval
        if (now > this._lastNotificationTime + interval) {
          this._lastNotificationTime = now
          // NOTE: Notification dispatch is stubbed.
          // OpenRA C# does:
          //   Game.Sound.PlayNotification(owner.World.Map.Rules, owner,
          //     "Speech", Info.InsufficientFundsNotification,
          //     owner.Faction.InternalName);
          //   TextNotificationsManager.AddTransientLine(owner,
          //     Info.InsufficientFundsTextNotification);
          //
          // TODO-8.F: Wire up to Sound.PlayNotification.
          // TODO-16.X: Wire up to TextNotificationsManager.
        }
      }
      return false
    }

    // Spend ore before cash
    this.resources -= amount
    this.spent += amount
    if (this.resources < 0) {
      // Resources were insufficient — cover the remainder from cash
      this.cash += this.resources // resources is negative, so cash decreases
      this.resources = 0
    }

    return true
  }

  /** Change the player's cash balance.
   *
   * OpenRA 对照: ChangeCash(int amount)
   *
   * Positive amounts add cash. Negative amounts deduct cash, but will not
   * put the player into negative total funds (cash + resources).
   *
   * @param amount — the amount to change (positive = income, negative = expense)
   * @returns the actual amount changed. For negative amounts, this may be
   *   clamped if the player cannot afford the full deduction.
   */
  changeCash(amount: number): number {
    if (amount >= 0) {
      this.addCash(amount)
      return amount
    }

    // Don't put the player into negative total funds
    const clampedAmount = Math.max(-this.getCashAndResources(), amount)
    this.takeCash(-clampedAmount)
    return clampedAmount
  }

  // -----------------------------------------------------------------------
  // Resource management
  // OpenRA 对照: GiveResources, RefundResources, TakeResources, CanGiveResources
  // -----------------------------------------------------------------------

  /** Check whether the given amount of resources can be stored.
   *
   * OpenRA 对照: CanGiveResources(int amount)
   *
   * @param amount — the amount of resources to check
   * @returns true if Resources + amount <= ResourceCapacity
   */
  canGiveResources(amount: number): boolean {
    return this.resources + amount <= this.resourceCapacity
  }

  /** Add resources to the player's storage.
   *
   * OpenRA 对照: GiveResources(int num, bool isRefund = false)
   *
   * If the addition would exceed ResourceCapacity, the resources are
   * capped at capacity and the overflow is discarded. Earned/Spent
   * tracking is adjusted accordingly.
   *
   * @param num — the number of resource units to add
   * @param isRefund — if true, this is a refund (reduces Spent instead of
   *   increasing Earned)
   */
  giveResources(num: number, isRefund: boolean = false): void {
    if (num <= 0) return

    this.resources += num

    if (!isRefund) {
      this.earned += num
    } else {
      this.spent -= num
    }

    // Cap at capacity
    if (this.resources > this.resourceCapacity) {
      const overflow = this.resources - this.resourceCapacity

      if (!isRefund) {
        this.earned -= overflow
      } else {
        this.spent += overflow
      }

      this.resources = this.resourceCapacity
    }
  }

  /** Refund resources to the player (same as giveResources with isRefund=true).
   *
   * OpenRA 对照: RefundResources(int num)
   *
   * @param num — the number of resource units to refund
   */
  refundResources(num: number): void {
    this.giveResources(num, true)
  }

  /** Remove resources from the player's storage.
   *
   * OpenRA 对照: TakeResources(int num)
   *
   * @param num — the number of resource units to remove
   * @returns true if the resources were successfully removed, false if
   *   there were insufficient resources
   */
  takeResources(num: number): boolean {
    if (num <= 0) return true
    if (this.resources < num) return false

    this.resources -= num
    this.spent += num
    return true
  }

  // -----------------------------------------------------------------------
  // Storage capacity management
  // OpenRA 对照: AddStorageCapacity, RemoveStorageCapacity
  // -----------------------------------------------------------------------

  /** Add storage capacity to the player's resource pool.
   *
   * OpenRA 对照: AddStorageCapacity(int capacity)
   *
   * @param capacity — the amount of capacity to add
   */
  addStorageCapacity(capacity: number): void {
    this.resourceCapacity += capacity
  }

  /** Remove storage capacity from the player's resource pool.
   *
   * OpenRA 对照: RemoveStorageCapacity(int capacity)
   *
   * If the current resources exceed the new (reduced) capacity, they are
   * clamped to the new capacity.
   *
   * @param capacity — the amount of capacity to remove
   */
  removeStorageCapacity(capacity: number): void {
    this.resourceCapacity -= capacity

    if (this.resources > this.resourceCapacity) {
      this.resources = this.resourceCapacity
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // OpenRA 对照: GetCashAndResources
  // -----------------------------------------------------------------------

  /** Get the total liquid assets (cash + stored resources).
   *
   * OpenRA 对照: GetCashAndResources()
   *
   * @returns the sum of cash and stored resources
   */
  getCashAndResources(): number {
    return this.cash + this.resources
  }

  /** Check whether the player can afford a given cost.
   *
   * OpenRA 对照: N/A (convenience method — OpenRA clients call
   *   GetCashAndResources() >= cost directly)
   *
   * @param cost — the cost to check
   * @returns true if the player has sufficient total funds
   */
  canAfford(cost: number): boolean {
    return this.getCashAndResources() >= cost
  }

  // -----------------------------------------------------------------------
  // Helper for bot modules — returns PlayerResources inner state
  // OpenRA 对照: N/A (convenience for BaseBuilderQueueManager pattern)
  // -----------------------------------------------------------------------

  /** Expose resource utilization ratio for bot modules.
   * Returns a value representing how full the storage is as a percentage
   * integer (0-100).
   *
   * Used by BaseBuilderQueueManager for refinery placement decisions:
   *   playerResources.resources * 5 > playerResources.resourceCapacity * 4
   *   (i.e., storage is > 80% full → build more refineries)
   */
  get resourceFillRatio(): number {
    if (this.resourceCapacity === 0) return 0
    return Math.floor((this.resources * 100) / this.resourceCapacity)
  }
}
