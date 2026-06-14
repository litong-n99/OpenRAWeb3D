/**
 * RepairableBuilding.ts — 建筑维修机制：玩家付费随时间维修受损建筑
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/RepairableBuilding.cs (208 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTraitInfo + Requires<IHealthInfo> → TS ConditionalTraitInfo (Requires
 *   通过运行时检查或通过文档约定实现)
 * - C# BitSet<DamageType> → TS Set<string> (DamageType 是字符串标签)
 * - C# ImmutableArray<int> → TS readonly number[]
 * - C# Stack<int> repairTokens → TS number[] (用作栈)
 * - C# Game.Sound.PlayNotification → TS 桩 (TODO-8.F)
 * - C# TextNotificationsManager.AddTransientLine → TS 桩 (TODO-16.X)
 * - C# PlayerResources.TakeCash / PlayerExperience.GiveExperience → TS duck-type 搜索
 * - C# self.AppearsFriendlyTo(player.PlayerActor) → TS appearsFriendlyTo() 辅助函数
 * - C# self.InflictDamage(self, new Damage(-amount, types)) → TS health.inflictDamage()
 *   使用负伤害值实现维修效果
 * - C# self.GetSellValue() → TS getSellValue() 辅助函数（CustomSellValue/Valued fallback）
 */

import {
  ConditionalTrait,
  Damage,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  ITick,
  ISync,
  PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PlayerRelationship } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WinState } from '../../../OpenRA.Game/Player.js'
import { getSellValue } from '../CustomSellValue.js'

// ---------------------------------------------------------------------------
// Helper: AppearsFriendlyTo
// OpenRA 对照: ActorExts.AppearsFriendlyTo(this Actor self, Actor toActor)
// ---------------------------------------------------------------------------

/**
 * 检查一个 actor 对另一个 actor 是否显示为友好。
 *
 * OpenRA 对照: ActorExts.AppearsFriendlyTo(this Actor self, Actor toActor)
 *
 * @param self — 被检查的 actor
 * @param toActor — 观察者 actor
 * @returns 如果 self 的拥有者与 toActor 的拥有者结盟，返回 true
 */
function appearsFriendlyTo(self: IGameActor, toActor: IGameActor): boolean {
  const selfOwner = self.owner
  const toOwner = toActor.owner
  if (!selfOwner || !toOwner) return false

  const toPlayer = toOwner as unknown as {
    relationshipWith?(other: unknown): PlayerRelationship
  }

  if (toPlayer.relationshipWith) {
    const stance = toPlayer.relationshipWith(selfOwner)
    return stance === PlayerRelationship.Ally
  }

  return false
}

// ---------------------------------------------------------------------------
// Helper: isNotActiveAlly predicate
// OpenRA 对照: RepairableBuilding.isNotActiveAlly
// ---------------------------------------------------------------------------

/**
 * 检查玩家是否不再是活跃盟友（已淘汰或关系不是盟友）。
 *
 * OpenRA 对照: player => player.WinState != WinState.Undefined ||
 *   self.Owner.RelationshipWith(player) != PlayerRelationship.Ally
 */
function isNotActiveAlly(
  owner: PlayerStub,
  player: PlayerStub,
): boolean {
  const p = player as unknown as {
    winState?: number
    relationshipWith?(other: unknown): PlayerRelationship
  }

  // WinState != Undefined → player is eliminated
  if (p.winState !== undefined && p.winState !== WinState.Undefined) {
    return true
  }

  const o = owner as unknown as {
    relationshipWith?(other: unknown): PlayerRelationship
  }

  if (o.relationshipWith) {
    return o.relationshipWith(player) !== PlayerRelationship.Ally
  }

  return true
}

// ---------------------------------------------------------------------------
// PlayerResources forward interface (duck-typed)
// OpenRA 对照: PlayerResources (subset used by RepairableBuilding)
// ---------------------------------------------------------------------------

/** Minimal PlayerResources interface for the repair system.
 *
 * OpenRA 对照: PlayerResources.TakeCash(int, bool)
 */
interface IPlayerResourcesForward {
  takeCash(amount: number, notifyLowFunds: boolean): boolean
}

// ---------------------------------------------------------------------------
// IHealth forward interface (duck-typed)
// OpenRA 对照: IHealth (subset used by RepairableBuilding)
// ---------------------------------------------------------------------------

/** Minimal IHealth interface for the repair system.
 *
 * OpenRA 对照: IHealth
 */
interface IHealthForward {
  hp: number
  maxHP: number
  damageState: number
  inflictDamage(
    actor: IGameActor,
    attacker: IGameActor,
    damage: Damage,
    ignoreModifiers: boolean,
  ): void
}

// ---------------------------------------------------------------------------
// RepairableBuildingInfo
// OpenRA 对照: RepairableBuildingInfo : ConditionalTraitInfo, Requires<IHealthInfo>
// ---------------------------------------------------------------------------

/** Configuration for the RepairableBuilding trait.
 *
 * OpenRA 对照: RepairableBuildingInfo
 *
 * Defines repair cost, interval, step size, bonuses, and notification
 * configuration for the building repair mechanic.
 */
export class RepairableBuildingInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Cost to fully repair the actor as a percent of its value.
   *
   * OpenRA 对照: RepairPercent (default 20)
   */
  readonly repairPercent: number

  /** Number of ticks between each repair step.
   *
   * OpenRA 对照: RepairInterval (default 24)
   */
  readonly repairInterval: number

  /** The maximum amount of HP to repair each step.
   *
   * OpenRA 对照: RepairStep (default 7)
   */
  readonly repairStep: number

  /** Damage types used for the repair.
   *
   * OpenRA 对照: RepairDamageTypes (BitSet<DamageType>, default empty)
   */
  readonly repairDamageTypes: Set<string>

  /** The percentage repair bonus applied with increasing numbers of repairers.
   *
   * OpenRA 对照: RepairBonuses (ImmutableArray<int>,
   *   default [100, 150, 175, 200, 220, 240, 260, 280, 300])
   */
  readonly repairBonuses: readonly number[]

  /** Cancel the repair state when the trait is disabled.
   *
   * OpenRA 对照: CancelWhenDisabled (default false)
   */
  readonly cancelWhenDisabled: boolean

  /** Experience gained by a player for repairing structures of allied players.
   *
   * OpenRA 对照: PlayerExperience (default 0)
   */
  readonly playerExperience: number

  /** The condition to grant to self while being repaired.
   *
   * OpenRA 对照: RepairCondition (default null)
   */
  readonly repairCondition: string | null

  /** Voice line to play when repairs are started.
   *
   * OpenRA 对照: RepairingNotification (default null)
   */
  readonly repairingNotification: string | null

  /** Transient text message to display when repairs are started.
   *
   * OpenRA 对照: RepairingTextNotification (default null)
   */
  readonly repairingTextNotification: string | null

  /** Speech notification to play when the repair process is aborted.
   *
   * OpenRA 对照: RepairingStoppedNotification (default null)
   */
  readonly repairingStoppedNotification: string | null

  /** Text notification to display when the repair process is aborted.
   *
   * OpenRA 对照: RepairingStoppedTextNotification (default null)
   */
  readonly repairingStoppedTextNotification: string | null

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    repairPercent?: number
    repairInterval?: number
    repairStep?: number
    repairDamageTypes?: Set<string>
    repairBonuses?: readonly number[]
    cancelWhenDisabled?: boolean
    playerExperience?: number
    repairCondition?: string | null
    repairingNotification?: string | null
    repairingTextNotification?: string | null
    repairingStoppedNotification?: string | null
    repairingStoppedTextNotification?: string | null
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.repairPercent = params.repairPercent ?? 20
    this.repairInterval = params.repairInterval ?? 24
    this.repairStep = params.repairStep ?? 7
    this.repairDamageTypes = params.repairDamageTypes ?? new Set()
    this.repairBonuses = params.repairBonuses ?? [
      100, 150, 175, 200, 220, 240, 260, 280, 300,
    ]
    this.cancelWhenDisabled = params.cancelWhenDisabled ?? false
    this.playerExperience = params.playerExperience ?? 0
    this.repairCondition = params.repairCondition ?? null
    this.repairingNotification = params.repairingNotification ?? null
    this.repairingStoppedNotification = params.repairingStoppedNotification ?? null
    this.repairingTextNotification = params.repairingTextNotification ?? null
    this.repairingStoppedTextNotification = params.repairingStoppedTextNotification ?? null
  }
}

// ---------------------------------------------------------------------------
// RepairableBuilding
// OpenRA 对照: RepairableBuilding : ConditionalTrait<RepairableBuildingInfo>,
//   ITick, ISync
// ---------------------------------------------------------------------------

/** Building repair mechanic — players pay to repair damaged buildings over time.
 *
 * OpenRA 对照: RepairableBuilding
 *
 * Players can toggle repair by calling repairBuilding(). Each tick,
 * eligible repairers contribute cash proportional to the HP being
 * repaired. The repair bonus scales with the number of active repairers.
 * When the building reaches full HP, repair stops and contributing allies
 * may earn experience.
 */
export class RepairableBuilding
  extends ConditionalTrait<RepairableBuildingInfo>
  implements ITick, ISync
{
  // -----------------------------------------------------------------------
  // IHealth reference (duck-typed, resolved at construction or first use)
  // OpenRA 对照: readonly IHealth health = self.Trait<IHealth>()
  // -----------------------------------------------------------------------

  /** Duck-typed reference to this actor's IHealth trait. */
  private _health: IHealthForward | null = null

  /** Predicate checking if a player is no longer an active ally.
   *
   * OpenRA 对照: isNotActiveAlly
   */
  private _owner: PlayerStub | null = null

  // -----------------------------------------------------------------------
  // Public state
  // OpenRA 对照: List<Player> Repairers, bool RepairActive
  // -----------------------------------------------------------------------

  /** Players currently repairing this building.
   *
   * OpenRA 对照: Repairers (public List<Player>)
   */
  readonly repairers: PlayerStub[] = []

  /** Whether repair is currently active (at least one paying repairer).
   *
   * OpenRA 对照: RepairActive (public bool)
   */
  get repairActive(): boolean {
    return this._repairActive
  }

  private _repairActive: boolean = false

  // -----------------------------------------------------------------------
  // Internal state
  // OpenRA 对照: Stack<int> repairTokens, int remainingTicks
  // -----------------------------------------------------------------------

  /** Condition tokens for the RepairCondition.
   *
   * OpenRA 对照: repairTokens (Stack<int>)
   */
  private _repairTokens: number[] = []

  /** Ticks remaining until next repair step.
   *
   * OpenRA 对照: remainingTicks
   */
  private _remainingTicks: number = 0

  // -----------------------------------------------------------------------
  // ISync
  // OpenRA 对照: [VerifySync] int RepairersHash
  // -----------------------------------------------------------------------

  /** Sync hash for the current set of repairers.
   *
   * OpenRA 对照: [VerifySync] int RepairersHash
   *
   * Uses XOR of hashPlayer for each repairer.
   */
  get repairersHash(): number {
    let hash = 0
    for (const player of this.repairers) {
      const p = player as unknown as {
        playerActor?: { actorId?: number }
      }
      // Hash from player actor ID
      hash ^= ((p.playerActor?.actorId ?? 0) * 0x9E3779B1) >>> 0
      hash = ((hash << 5) + hash) | 0
    }
    return hash >>> 0
  }

  constructor(info: RepairableBuildingInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // Lifecycle (Component overrides)
  // OpenRA 对照: constructor: health = self.Trait<IHealth>()
  // -----------------------------------------------------------------------

  /** Called when this trait is attached to an actor.
   *
   * OpenRA 对照: constructor body (self.Trait<IHealth>())
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)

    // Resolve IHealth from the actor
    this._health = (actor as unknown as {
      trait?: (name: string) => unknown
    }).trait?.('IHealth') as IHealthForward | null

    if (!this._health) {
      // NOTE: In OpenRA, RepairableBuildingInfo has Requires<IHealthInfo>
      // so IHealth is guaranteed to be present. Log a warning for diagnostics.
      console.warn('RepairableBuilding: actor missing IHealth trait — repair will be unavailable')
    }

    this._owner = actor.owner ?? null
  }

  /** Called when this trait is detached from its actor. */
  override detach(actor: IGameActor): void {
    super.detach(actor)
    this._health = null
    this._owner = null
  }

  // -----------------------------------------------------------------------
  // UpdateCondition — sync condition tokens with repairer count
  // OpenRA 对照: UpdateCondition(Actor self)
  // -----------------------------------------------------------------------

  /**
   * Synchronize the RepairCondition condition tokens with the number of
   * active repairers.
   *
   * OpenRA 对照: UpdateCondition(Actor self)
   *
   * When repairers are added, conditions are granted.
   * When repairers are removed, conditions are revoked.
   *
   * @param self — the actor this trait is attached to
   */
  private _updateCondition(self: IGameActor): void {
    if (!this.info.repairCondition) return

    const grantCond = self.grantCondition
    const revokeCond = self.revokeCondition

    if (!grantCond || !revokeCond) return

    while (this.repairers.length > this._repairTokens.length) {
      const token = grantCond(this.info.repairCondition)
      this._repairTokens.push(token)
    }

    while (
      this.repairers.length < this._repairTokens.length &&
      this._repairTokens.length > 0
    ) {
      const token = this._repairTokens.pop()!
      revokeCond(token)
    }
  }

  // -----------------------------------------------------------------------
  // repairBuilding — toggle player repair
  // OpenRA 对照: RepairBuilding(Actor self, Player player)
  // -----------------------------------------------------------------------

  /**
   * Toggle repair participation for a player.
   *
   * OpenRA 对照: RepairBuilding(Actor self, Player player)
   *
   * If the player is already repairing, they are removed.
   * Otherwise, they are added (up to the RepairBonuses limit).
   * Notifications are played on state changes.
   *
   * @param self — the actor this trait is attached to
   * @param player — the player to toggle repair for
   */
  repairBuilding(self: IGameActor, player: PlayerStub): void {
    if (this.isTraitDisabled) return

    // Check if this building appears friendly to the player's actor
    const playerActor = (player as unknown as {
      playerActor?: IGameActor
    }).playerActor
    if (!playerActor || !appearsFriendlyTo(self, playerActor)) return

    // Remove the player if they are already repairing
    const idx = this.repairers.findIndex((p) => p === player)
    if (idx >= 0) {
      this.repairers.splice(idx, 1)
      this._updateCondition(self)

      if (this.repairers.length === 0) {
        // NOTE: Sound and text notifications are stubbed.
        // OpenRA C# does:
        //   Game.Sound.PlayNotification(self.World.Map.Rules, player,
        //     "Speech", Info.RepairingStoppedNotification,
        //     player.Faction.InternalName);
        //   TextNotificationsManager.AddTransientLine(self.Owner,
        //     Info.RepairingStoppedTextNotification);
        //
        // TODO-8.F: Wire up to Sound.PlayNotification.
        // TODO-16.X: Wire up to TextNotificationsManager.
      }

      return
    }

    // Don't add new players if the limit has already been reached
    if (this.repairers.length >= this.info.repairBonuses.length - 1) return

    this.repairers.push(player)

    // NOTE: Sound and text notifications are stubbed.
    // OpenRA C# does:
    //   Game.Sound.PlayNotification(self.World.Map.Rules, player,
    //     "Speech", Info.RepairingNotification, player.Faction.InternalName);
    //   TextNotificationsManager.AddTransientLine(self.Owner,
    //     Info.RepairingTextNotification);
    //
    // TODO-8.F: Wire up to Sound.PlayNotification.
    // TODO-16.X: Wire up to TextNotificationsManager.

    this._updateCondition(self)
  }

  // -----------------------------------------------------------------------
  // ITick.Tick — main repair loop
  // OpenRA 对照: ITick.Tick(Actor self)
  // -----------------------------------------------------------------------

  /**
   * Execute one tick of the repair mechanic.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   *
   * On each repair interval tick:
   * 1. Remove inactive allies (eliminated or no longer allied)
   * 2. Calculate HP to repair and cost based on RepairPercent
   * 3. Deduct cash from each repairer via PlayerResources.TakeCash
   * 4. Apply repair bonus based on active repairer count
   * 5. Use IHealth.inflictDamage() with negative damage for repair
   * 6. Stop when fully repaired
   *
   * @param self — the actor this trait is attached to
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled) {
      if (this._repairActive && this.info.cancelWhenDisabled) {
        this.repairers.length = 0
        this._updateCondition(self)
      }
      return
    }

    if (this._remainingTicks === 0) {
      // Remove inactive allies
      const owner = this._owner ?? self.owner
      if (owner) {
        for (let i = this.repairers.length - 1; i >= 0; i--) {
          if (isNotActiveAlly(owner, this.repairers[i])) {
            this.repairers.splice(i, 1)
          }
        }
      }
      this._updateCondition(self)

      // If after the previous operation there are no repairers left, stop
      if (this.repairers.length === 0) {
        this._repairActive = false
        return
      }

      // Resolve IHealth if not already resolved
      if (!this._health) {
        this._health = (self as unknown as {
          trait?: (name: string) => unknown
        }).trait?.('IHealth') as IHealthForward | null
      }

      if (!this._health) {
        // Cannot repair without IHealth
        this._repairActive = false
        return
      }

      const health = this._health
      const buildingValue = getSellValue(self)

      // The cost is the same regardless of the amount of people repairing
      const hpToRepair = Math.min(this.info.repairStep, health.maxHP - health.hp)

      // Cast to prevent overflow when multiplying
      // cost = max(1, hpToRepair * repairPercent * buildingValue / (maxHP * 100))
      const cost = Math.max(
        1,
        Math.floor(
          (hpToRepair * this.info.repairPercent * buildingValue) /
            (health.maxHP * 100),
        ),
      )

      // TakeCash will return false if the player can't pay, and will stop
      // them from contributing this tick
      let activePlayers = 0
      for (const repairer of this.repairers) {
        const playerActor = (repairer as unknown as {
          playerActor?: {
            trait?: (name: string) => unknown
          }
        }).playerActor

        const pr = playerActor?.trait?.('PlayerResources') as
          | IPlayerResourcesForward
          | undefined

        if (pr && pr.takeCash(cost, true)) {
          activePlayers++
        }
      }

      this._repairActive = activePlayers > 0

      if (!this._repairActive) {
        this._remainingTicks = 1
        return
      }

      // Bonus is applied after finding players who can pay
      // activePlayers won't cause index out of range because we capped the
      // max amount of players to the length of the array
      const bonus = this.info.repairBonuses[
        Math.min(activePlayers - 1, this.info.repairBonuses.length - 1)
      ]
      const repairAmount = -(hpToRepair * bonus / 100)

      // Construct Damage with negative value for repair
      // Wrap Set<string> as BitSetStub<unknown> adapter
      const damageTypesSet = this.info.repairDamageTypes
      const damage = new Damage(repairAmount, {
        contains: (_v: number) => damageTypesSet.size > 0,
        isEmpty: () => damageTypesSet.size === 0,
      })

      health.inflictDamage(self, self, damage, false)

      if ((health.damageState & 1) !== 0 || health.hp >= health.maxHP) {
        // Building is fully repaired (Undamaged)
        for (const repairer of this.repairers) {
          if (repairer !== self.owner) {
            // Grant experience to allied repairers
            const allyActor = (repairer as unknown as {
              playerActor?: {
                trait?: (name: string) => unknown
              }
            }).playerActor

            const exp = allyActor?.trait?.('PlayerExperience') as
              | { giveExperience?(amount: number): void }
              | undefined

            exp?.giveExperience?.(this.info.playerExperience)
          }
        }

        this.repairers.length = 0
        this._repairActive = false
        this._updateCondition(self)
        return
      }

      this._remainingTicks = this.info.repairInterval
    } else {
      --this._remainingTicks
    }
  }
}
