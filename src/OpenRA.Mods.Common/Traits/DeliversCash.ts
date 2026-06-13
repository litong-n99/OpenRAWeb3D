/**
 * DeliversCash.ts — 可携带现金交付 trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/DeliversCash.cs (128 lines)
 *
 * 核心范式转换:
 * - C# sealed class DeliversCash : IIssueOrder, IResolveOrder, IOrderVoice,
 *     INotifyCashTransfer
 *   → TS DeliversCash implements IIssueOrder, IResolveOrder, IOrderVoice,
 *     INotifyKilled, INotifyAddedToWorld
 *   (INotifyCashTransfer.OnDeliveringCash → 直接查询 AcceptsDeliveredCash 的音效；
 *    OnAcceptingCash 由 AcceptsDeliveredCash.onAcceptingCash() 处理)
 * - C# DonateCash Activity → TS 直接执行 cash transfer
 *   (完整 Activity 实现延迟至 Chapter 14 Phase D)
 * - C# DeliversCashOrderTargeter : UnitOrderTargeter → TS IOrderTargeter 实现
 * - C# Color.Yellow → TS 字符串 "Yellow"（后续由 Babylon.js Color3 解析）
 * - C# Game.Sound.Play() → TODO-10-SOUND（音频系统集成）
 * - C# Order 对象 → TS OrderStub (orderName/targetString/extraData)
 */

import type {
  ITraitInfo,
  IGameActor,
  IIssueOrder,
  IResolveOrder,
  IOrderVoice,
  INotifyKilled,
  INotifyAddedToWorld,
  IOrderTargeter,
  Order,
  TargetStub,
  TargetModifiers,
  AttackInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PlayerRelationship } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PlayerRelationshipExts } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// DeliversCashInfo
// OpenRA 对照: DeliversCashInfo : TraitInfo
// ---------------------------------------------------------------------------

/** 可携带现金交付的配置。
 *
 *  OpenRA 对照: DeliversCashInfo (sealed class)
 */
export class DeliversCashInfo implements ITraitInfo {
  readonly instanceName?: string

  /** 交付的现金数额。
   *
   *  OpenRA 对照: DeliversCashInfo.Payload (default 500)
   */
  readonly payload: number = 500

  /** 交付时授予捐献玩家的经验值。
   *
   *  OpenRA 对照: DeliversCashInfo.PlayerExperience (default 0)
   */
  readonly playerExperience: number = 0

  /** 交付类型标识（匹配 AcceptsDeliveredCash.ValidTypes）。
   *
   *  OpenRA 对照: DeliversCashInfo.Type (default null)
   *
   *  当为 null 或空字符串时，仅能交付给 ValidTypes 为空的接收者。
   */
  readonly type: string | null = null

  /** 交付时播放的音效列表。
   *
   *  OpenRA 对照: DeliversCashInfo.Sounds (ImmutableArray<string>)
   *
   *  TODO-10-SOUND: 集成音频系统播放音效
   */
  readonly sounds: readonly string[] = []

  /** 鼠标悬浮在有效交付目标上时显示的光标。
   *
   *  OpenRA 对照: DeliversCashInfo.Cursor (default "enter")
   *
   *  TODO-15.CURSOR: 与完整的光标系统集成
   */
  readonly cursor: string = 'enter'

  /** 执行交付时的语音短语标识。
   *
   *  OpenRA 对照: DeliversCashInfo.Voice (default "Action")
   */
  readonly voice: string = 'Action'

  /** 目标线的颜色。
   *
   *  OpenRA 对照: DeliversCashInfo.TargetLineColor = Color.Yellow
   */
  readonly targetLineColor: string = 'Yellow'

  constructor(params: {
    instanceName?: string
    payload?: number
    playerExperience?: number
    type?: string | null
    sounds?: readonly string[]
    cursor?: string
    voice?: string
    targetLineColor?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.payload = params.payload ?? 500
    this.playerExperience = params.playerExperience ?? 0
    this.type = params.type ?? null
    this.sounds = params.sounds ?? []
    this.cursor = params.cursor ?? 'enter'
    this.voice = params.voice ?? 'Action'
    this.targetLineColor = params.targetLineColor ?? 'Yellow'
  }
}

// ---------------------------------------------------------------------------
// IAcceptsDeliveredCashAccess — Duck-typed access to AcceptsDeliveredCash
// ---------------------------------------------------------------------------

/** AcceptsDeliveredCash trait 的 duck-typed 接口。
 *
 *  用于查询目标 actor 是否接受现金交付。
 */
interface IAcceptsDeliveredCashAccess {
  info: {
    validTypes: ReadonlySet<string>
    validRelationships: PlayerRelationship
  }
  acceptsDelivery(type: string, fromActor: IGameActor): boolean
}

// ---------------------------------------------------------------------------
// DeliversCashOrderTargeter
// OpenRA 对照: DeliversCash.DeliversCashOrderTargeter : UnitOrderTargeter
// ---------------------------------------------------------------------------

/** 现金交付命令的目标选择器。
 *
 *  OpenRA 对照: DeliversCash.DeliversCashOrderTargeter
 *
 *  检查目标 actor 是否有 AcceptsDeliveredCash trait，
 *  并根据类型和外交关系判断是否可以作为交付目标。
 */
class DeliversCashOrderTargeter implements IOrderTargeter {
  readonly orderID = 'DeliverCash'
  readonly orderPriority: number = 5
  readonly isQueued: boolean = false

  private readonly _info: DeliversCashInfo

  constructor(info: DeliversCashInfo) {
    this._info = info
  }

  canTarget(
    self: IGameActor,
    target: TargetStub,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    // Check if target has AcceptsDeliveredCash trait
    const targetTrait = (target as unknown as {
      trait?: (name: string) => IAcceptsDeliveredCashAccess | null
    }).trait

    if (typeof targetTrait !== 'function') return false

    const accepts = targetTrait('AcceptsDeliveredCash')
    if (!accepts) return false

    // Check valid relationships
    if (!self.owner || !(target as unknown as { owner?: unknown }).owner) return false

    const targetOwner = (target as unknown as {
      owner: { relationshipWith?: (other: unknown) => PlayerRelationship }
    }).owner

    if (!targetOwner?.relationshipWith) return false

    const relationship = targetOwner.relationshipWith(self.owner)
    if (!PlayerRelationshipExts.hasRelationship(
      accepts.info.validRelationships,
      relationship,
    )) {
      return false
    }

    // Check valid types
    if (accepts.info.validTypes.size === 0) {
      return true
    }

    const type = this._info.type
    return type !== null && type !== '' && accepts.info.validTypes.has(type)
  }

  targetOverridesSelection(
    self: IGameActor,
    target: TargetStub,
    _actorsAt: readonly IGameActor[],
    _xy: unknown,
    _modifiers: TargetModifiers,
  ): boolean {
    return this.canTarget(self, target, 0 as TargetModifiers, '')
  }
}

// ---------------------------------------------------------------------------
// DeliversCash
// OpenRA 对照: DeliversCash : IIssueOrder, IResolveOrder, IOrderVoice,
//   INotifyCashTransfer
// ---------------------------------------------------------------------------

/** 可携带现金交付 trait。
 *
 *  OpenRA 对照: DeliversCash
 *
 *  携带此 trait 的 actor 可以向有 AcceptsDeliveredCash trait
 *  的目标 actor 交付现金。通过命令系统发行 "DeliverCash" 命令，
 *  解析时直接执行现金交付（完整 Activity 延迟至 Chapter 14）。
 *
 *  现金在 actor 死亡时丢失。
 */
export class DeliversCash
  implements IIssueOrder, IResolveOrder, IOrderVoice, INotifyKilled, INotifyAddedToWorld
{
  readonly info: DeliversCashInfo

  /** 缓存的目标选择器。 */
  private readonly _orderTargeter: DeliversCashOrderTargeter

  constructor(info: DeliversCashInfo) {
    this.info = info
    this._orderTargeter = new DeliversCashOrderTargeter(info)
  }

  // -----------------------------------------------------------------------
  // IIssueOrder
  // OpenRA 对照: IIssueOrder.Orders + IssueOrder(Actor, IOrderTargeter, Target, bool)
  // -----------------------------------------------------------------------

  /** 该 trait 支持的命令目标选择器列表。
   *
   *  OpenRA 对照: DeliversCash.Orders (yield return)
   */
  get orders(): readonly IOrderTargeter[] {
    return [this._orderTargeter]
  }

  /** 发行现金交付命令。
   *
   *  OpenRA 对照: IIssueOrder.IssueOrder(Actor, IOrderTargeter, in Target, bool)
   *
   *  仅当 order.OrderID 为 "DeliverCash" 时才发行命令。
   *
   *  @param self — 发行命令的 actor
   *  @param order — 目标选择器
   *  @param target — 目标
   *  @param queued — 是否排队
   *  @returns 创建的 OrderStub 对象
   */
  issueOrder(
    self: IGameActor,
    order: IOrderTargeter,
    _target: TargetStub,
    _queued: boolean,
  ): Order {
    void self // mark as used for interface compliance
    if (order.orderID !== 'DeliverCash') {
      // C# returns null for non-matching orders.
      // TS returns an empty OrderStub (caller checks orderName).
      return {
        orderName: '',
        targetString: '',
        extraData: 0,
      }
    }

    // C#: return new Order(order.OrderID, self, target, queued);
    // In TS, we attach extra data to carry payload info through the stub.
    return {
      orderName: 'DeliverCash',
      targetString: '',
      extraData: this.info.payload,
    } as Order
  }

  // -----------------------------------------------------------------------
  // IOrderVoice
  // OpenRA 对照: IOrderVoice.VoicePhraseForOrder(Actor, Order)
  // -----------------------------------------------------------------------

  /** 返回发行此命令时的语音短语。
   *
   *  OpenRA 对照: IOrderVoice.VoicePhraseForOrder(Actor, Order)
   *
   *  @param _self — 发行命令的 actor
   *  @param order — 要执行的命令
   *  @returns 语音短语名称，不匹配时返回空字符串
   */
  voicePhraseForOrder(_self: IGameActor, order: Order): string {
    if (order.orderName !== 'DeliverCash') return ''
    return this.info.voice
  }

  // -----------------------------------------------------------------------
  // IResolveOrder
  // OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
  // -----------------------------------------------------------------------

  /** 解析 "DeliverCash" 命令。
   *
   *  OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
   *
   *  直接执行现金交付（完整 DonateCash Activity 延迟至 Chapter 14 Phase D）。
   *
   *  @param self — 执行命令的 actor
   *  @param order — 要解析的命令
   */
  resolveOrder(self: IGameActor, order: Order): void {
    if (order.orderName !== 'DeliverCash') return

    // NOTE: DonateCash Activity implementation deferred to Chapter 14 Phase D.
    // For now, we directly execute the cash transfer.
    // TODO-14.D: Replace with full DonateCash Activity

    // Grant cash to target actor's owner
    const target = (order as unknown as { target?: TargetStub }).target
    if (target) {
      this._deliverCashToTarget(self, target)
    }

    // Play delivery sounds
    this._playDeliverySounds(self)

    // Show target lines (visual feedback)
    // TODO-14/15: self.ShowTargetLines()
  }

  // -----------------------------------------------------------------------
  // INotifyAddedToWorld
  // OpenRA 对照: N/A (C# does not use this; TS adds for registration)
  // -----------------------------------------------------------------------

  /** 当 actor 添加到世界时调用。
   *
   *  OpenRA 对照: N/A（TS 添加，用于 delivery 跟踪注册）
   */
  addedToWorld(_self: IGameActor): void {
    // Registration stub — full implementation when world delivery
    // tracking system is available.
  }

  // -----------------------------------------------------------------------
  // INotifyKilled
  // OpenRA 对照: N/A (C# does not use this; TS adds for cash-loss-on-death)
  // -----------------------------------------------------------------------

  /** 当 actor 被击杀时，现金丢失。
   *
   *  OpenRA 对照: N/A（TS 添加，用于死亡时现金丢失逻辑）
   *
   *  在 C# 中，此逻辑由 DonateCash 活动内部处理。
   *  在 TS 迁移中，由于活动延迟，在 trait 层显式处理。
   *
   *  @param _self — 被击杀的 actor
   *  @param _attackInfo — 攻击信息（未使用）
   */
  killed(_self: IGameActor, _attackInfo: AttackInfo): void {
    // Cash carried by this actor is lost on death.
    // In C#, this is handled inside the DonateCash Activity itself.
    // No resource grant or refund — the payload simply disappears.
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** 向目标 actor 的拥有者交付现金。
   *
   *  OpenRA 对照: DonateCash Activity 内部的 PlayerResources 操作
   */
  private _deliverCashToTarget(self: IGameActor, target: TargetStub): void {
    const targetActor = (target as unknown as {
      owner?: { playerActor?: { trait?: (name: string) => unknown } }
      trait?: (name: string) => { onAcceptingCash?: (actor: IGameActor, donor: IGameActor) => void } | null
    })

    // Notify acceptor that cash is arriving (plays accept sounds)
    const accepts = targetActor?.trait?.('AcceptsDeliveredCash')
    if (accepts?.onAcceptingCash) {
      const targetAsActor = target as unknown as IGameActor
      accepts.onAcceptingCash(targetAsActor, self)
    }

    // Grant cash to target owner
    const owner = targetActor?.owner
    if (!owner) return

    const playerActor = owner.playerActor
    if (!playerActor) return

    const pr = playerActor.trait?.('PlayerResources') as {
      addCash?: (amount: number) => void
      changeCash?: (amount: number) => number
    } | null

    if (pr?.addCash) {
      pr.addCash(this.info.payload)
    } else if (pr?.changeCash) {
      pr.changeCash(this.info.payload)
    }

    // Grant player experience to the donor
    if (this.info.playerExperience > 0 && self.owner) {
      const donorPr = (self.owner as unknown as {
        playerActor?: { trait?: (name: string) => { giveExperience?: (amount: number) => void } | null }
      }).playerActor?.trait?.('PlayerExperience')
      if (donorPr?.giveExperience) {
        donorPr.giveExperience(this.info.playerExperience)
      }
    }
  }

  /** 播放交付音效。
   *
   *  OpenRA 对照: INotifyCashTransfer.OnDeliveringCash(Actor, Actor)
   *
   *  TODO-10-SOUND: 集成音频系统
   */
  private _playDeliverySounds(_self: IGameActor): void {
    if (this.info.sounds.length > 0) {
      // C#: Game.Sound.Play(SoundType.World, info.Sounds, self.World, self.CenterPosition);
      //
      // Sound playback deferred to audio system integration.
      // The sound files are available in this.info.sounds.
    }
  }
}
