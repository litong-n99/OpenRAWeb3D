/**
 * GivesBounty.ts — 单位击杀赏金 trait（击杀者获得现金奖励）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/GivesBounty.cs (91 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<GivesBountyInfo>, INotifyKilled, INotifyPassengerEntered, INotifyPassengerExited
 *   → TS ConditionalTrait<GivesBountyInfo> implements INotifyKilled
 *   (INotifyPassengerEntered/Exited deferred to TODO-10.B.6-PASSENGER)
 * - C# e.Attacker.Owner.PlayerActor.Trait<PlayerResources>().ChangeCash()
 *   → TS duck-typed playerActor.resources forward interface (PlayerResources TODO-10.B.3)
 * - C# BitSet<DamageType> DeathTypes → TS BitSet<string> with overlaps
 * - C# FloatingText effect → TS floating text stub (TODO-14/16)
 * - C# self.GetSellValue() extension method → TS getSellValue() from CustomSellValue.ts
 * - C# PlayerRelationship.HasRelationship() → TS PlayerRelationshipExts.hasRelationship()
 */

import {
  ConditionalTrait,
  PlayerRelationshipExts,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  INotifyKilled,
  AttackInfo,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PlayerRelationship } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { getSellValue } from './CustomSellValue.js'

// ---------------------------------------------------------------------------
// IPlayerResources — Forward interface for PlayerResources (Phase B)
// OpenRA 对照: PlayerResources trait (Phase B, TODO-10.B.3)
// ---------------------------------------------------------------------------

/**
 * 最小化的 PlayerResources 前向接口。
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlayerResources.cs
 *
 * 由于 PlayerResources 在阶段 B 第 2 波才迁移（TODO-10.B.3），
 * 此处使用最小接口 + duck-typing 解析。
 *
 * TODO-10.B.3: 当 PlayerResources 迁移后，替换为完整类型。
 */
interface IPlayerResources {
  changeCash(amount: number): number
}

// ---------------------------------------------------------------------------
// GivesBountyInfo
// OpenRA 对照: GivesBountyInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** 击杀赏金的配置。
 *
 *  OpenRA 对照: GivesBountyInfo (sealed class)
 */
export class GivesBountyInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 击杀者获得的赏金百分比（基于出售价值）。
   *
   *  OpenRA 对照: GivesBountyInfo.Percentage (default 10)
   */
  readonly percentage: number = 10

  /** 击杀者需要拥有的外交关系才能获得赏金。
   *
   *  OpenRA 对照: GivesBountyInfo.ValidRelationships (PlayerRelationship, default Neutral | Enemy)
   */
  readonly validRelationships: number = 1 | 2 // Neutral | Enemy

  /** 是否显示浮动的赏金文字。
   *
   *  OpenRA 对照: GivesBountyInfo.ShowBounty (default true)
   */
  readonly showBounty: boolean = true

  /** 限定触发赏金的死亡类型。空位集 = 所有死亡类型都触发。
   *
   *  OpenRA 对照: GivesBountyInfo.DeathTypes (BitSet<DamageType>, default empty)
   */
  readonly deathTypes: { isEmpty: boolean; overlaps(other: unknown): boolean } = {
    isEmpty: true,
    overlaps: () => true,
  }

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    percentage?: number
    validRelationships?: number
    showBounty?: boolean
    deathTypes?: { isEmpty: boolean; overlaps(other: unknown): boolean }
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.percentage = params.percentage ?? 10
    this.validRelationships = params.validRelationships ?? (1 | 2)
    this.showBounty = params.showBounty ?? true
    this.deathTypes = params.deathTypes ?? { isEmpty: true, overlaps: () => true }
  }
}

// ---------------------------------------------------------------------------
// GivesBounty
// OpenRA 对照: GivesBounty : ConditionalTrait<GivesBountyInfo>, INotifyKilled, INotifyPassengerEntered, INotifyPassengerExited
// ---------------------------------------------------------------------------

/** 单位击杀赏金 trait。
 *
 *  OpenRA 对照: GivesBounty
 *
 *  当携带此 trait 的 actor 被击杀时，攻击者获得赏金。
 *
 *  赏金计算:
 *    bounty = getSellValue(self) * Percentage / 100
 *
 *  触发条件（全部满足才发赏金）:
 *  1. 攻击者存在且未 disposition
 *  2. 此 trait 未被禁用
 *  3. 攻击者与自己的外交关系匹配 ValidRelationships
 *  4. DeathTypes 匹配（如果指定了具体类型）
 *
 *  INotifyPassengerEntered/Exited 运输单位赏金汇总逻辑延迟至
 *  TODO-10.B.6-PASSENGER（需要完整的运输单位系统）。
 */
export class GivesBounty
  extends ConditionalTrait<GivesBountyInfo>
  implements INotifyKilled
{
  constructor(info: GivesBountyInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // INotifyKilled
  // OpenRA 对照: void INotifyKilled.Killed(Actor self, AttackInfo e)
  // -----------------------------------------------------------------------

  /** 当此 actor 被击杀时调用。
   *
   *  OpenRA 对照: INotifyKilled.Killed(Actor self, AttackInfo e)
   *
   *  检查攻击者有效性、trait 启用状态、外交关系、DeathTypes 匹配后，
   *  计算赏金并授予攻击者。
   *
   *  @param self — 被击杀的 actor
   *  @param e — 攻击信息（包含攻击者和伤害数据）
   */
  killed(self: IGameActor, e: AttackInfo): void {
    // 1. Attacker checks
    if (!e.attacker || e.attacker.disposed || this.isTraitDisabled) {
      return
    }

    // 2. Relationship check
    if (!self.owner || !e.attacker.owner) return

    const relFn = (e.attacker.owner as { relationshipWith?: (other: unknown) => number }).relationshipWith
    const ownerRel: PlayerRelationship = relFn
      ? (relFn(self.owner) as PlayerRelationship)
      : 0 // None — no relationship → no bounty

    if (!PlayerRelationshipExts.hasRelationship(
      this.info.validRelationships as PlayerRelationship,
      ownerRel,
    )) {
      return
    }

    // 3. DeathTypes matching
    if (!this.info.deathTypes.isEmpty) {
      const damageTypes = e.damage.damageTypes as unknown as {
        isEmpty?: boolean
        overlaps?: (other: unknown) => boolean
      }
      if (
        typeof damageTypes.overlaps === 'function' &&
        !damageTypes.overlaps(this.info.deathTypes)
      ) {
        return
      }
    }

    // 4. Calculate bounty
    const bounty = this._getBountyValue(self)
    if (bounty <= 0) return

    // 5. Floating text (stub until Chapter 14/16)
    if (this.info.showBounty && self.isInWorld && e.attacker.owner) {
      // C# pattern:
      //   var displayedBounty = GetDisplayedBountyValue(self);
      //   if (Info.ShowBounty && self.IsInWorld && displayedBounty != 0
      //       && e.Attacker.Owner.IsAlliedWith(self.World.RenderPlayer))
      //     e.Attacker.World.AddFrameEndTask(w => w.Add(
      //       new FloatingText(self.CenterPosition, e.Attacker.OwnerColor(),
      //         FloatingText.FormatCashTick(displayedBounty), 30)));
      //
      // TODO-10.B.6-FLOATING: Implement floating text display using
      //   Babylon.js GUI TextBlock when FloatingText and World.AddFrameEndTask
      //   are available (Chapter 14/16).
      void bounty // mark as used for floating text display
    }

    // 6. Grant cash to attacker
    this._grantCash(e.attacker.owner, bounty)
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** 计算赏金金额。
   *
   *  OpenRA 对照: GetBountyValue(Actor self)
   *
   *  bounty = getSellValue(self) * Percentage / 100
   *
   *  @param self — 被击杀的 actor
   *  @returns 赏金金额（整数）
   */
  private _getBountyValue(self: IGameActor): number {
    const sellValue = getSellValue(self)
    if (sellValue <= 0) return 0
    return Math.floor((sellValue * this.info.percentage) / 100)
  }

  /** 授予现金给指定的玩家。
   *
   *  OpenRA 对照: e.Attacker.Owner.PlayerActor.Trait<PlayerResources>().ChangeCash(bounty)
   *
   *  通过 duck-typing 解析 PlayerResources trait。
   *
   *  @param owner — 攻击者的拥有者
   *  @param amount — 要授予的现金金额
   *
   *  TODO-10.B.3: 当 PlayerResources 迁移后，使用完整的类型系统。
   */
  private _grantCash(owner: PlayerStub, amount: number): void {
    // Try to access PlayerResources from the owner's player actor
    // C#: owner.PlayerActor.Trait<PlayerResources>()
    const playerActor = (owner as unknown as {
      playerActor?: {
        trait?: (name: string) => IPlayerResources | null
        changeCash?: (amount: number) => number
      } | null
    }).playerActor

    if (!playerActor) return

    // Try trait resolution first
    if (typeof playerActor.trait === 'function') {
      const resources = playerActor.trait('PlayerResources')
      if (resources && typeof resources.changeCash === 'function') {
        resources.changeCash(amount)
        return
      }
    }

    // Fallback: direct method on playerActor
    if (typeof playerActor.changeCash === 'function') {
      playerActor.changeCash(amount)
    }
  }
}
