/**
 * Sellable.ts — 可出售 trait（出售按钮 + 退款逻辑）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Sellable.cs (122 lines)
 *
 * 核心范式转换:
 * - C# Sellable : ConditionalTrait<SellableInfo>, IResolveOrder, IProvideTooltipInfo
 *   → TS Sellable extends ConditionalTrait<SellableInfo> implements IResolveOrder,
 *     IIssueOrder
 *   (IProvideTooltipInfo 延迟至 Chapter 16 UI 系统；
 *    IIssueOrder 添加用于热键出售支持)
 * - C# Sell Activity (内含退款 / 移除逻辑) → TS 直接计算退款并移除 actor
 *   (完整 Activity 实现延迟至 Chapter 14 Phase D)
 * - C# Game.Sound.PlayToPlayer() → TODO-10-SOUND（音频系统集成）
 * - C# SellOrderGenerator / SellOrderTargeter → 延迟至 Chapter 15
 * - C# WithMakeAnimation.Reverse() → TODO-16（UI/动画系统集成）
 * - C# self.TraitsImplementing<INotifySold>() → TS duck-typed trait 迭代
 */

import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  IResolveOrder,
  IIssueOrder,
  IOrderTargeter,
  Order,
  TargetStub,
  PlayerStub,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { getSellValue } from './CustomSellValue.js'

// ---------------------------------------------------------------------------
// IPlayerResources — Forward interface for PlayerResources (Phase B)
// OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlayerResources.cs
// TODO-10.B.3: Replace with full PlayerResources class when migrated.
// ---------------------------------------------------------------------------

/** 最小化的 PlayerResources 前向接口。
 *
 *  OpenRA 对照: PlayerResources 类的关键方法
 */
interface IPlayerResources {
  addCash(amount: number, isRefund?: boolean): void
}

// ---------------------------------------------------------------------------
// IHealth — Forward interface for Health trait (Ch8 Phase D)
// ---------------------------------------------------------------------------

/** 用于健康百分比计算的 IHealth 前向接口。 */
interface IHealthAccess {
  readonly hp: number
  readonly maxHP: number
}

// ---------------------------------------------------------------------------
// INotifySoldAccess — Duck-typed access to INotifySold traits
// ---------------------------------------------------------------------------

/** INotifySold trait 的 duck-typed 接口。 */
interface INotifySoldAccess {
  selling(self: IGameActor): void
  sold(self: IGameActor): void
}

// ---------------------------------------------------------------------------
// SellableInfo
// OpenRA 对照: SellableInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** 可出售的配置。
 *
 *  OpenRA 对照: SellableInfo
 */
export class SellableInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 出售后返还的单位价值百分比。
   *
   *  OpenRA 对照: SellableInfo.RefundPercent (default 50)
   */
  readonly refundPercent: number = 50

  /** 出售时播放的音效列表。
   *
   *  OpenRA 对照: SellableInfo.SellSounds (ImmutableArray<string>)
   *
   *  TODO-10-SOUND: 集成音频系统播放出售音效
   */
  readonly sellSounds: readonly string[] = []

  /** 语音通知标识。
   *
   *  OpenRA 对照: SellableInfo.Notification (default null)
   *
   *  TODO-10-SOUND: 集成语音通知系统
   */
  readonly notification: string | null = null

  /** 文本通知标识。
   *
   *  OpenRA 对照: SellableInfo.TextNotification (default null)
   *
   *  TODO-16-NOTIFICATION: 集成文本通知系统
   */
  readonly textNotification: string | null = null

  /** 是否显示浮动现金文字指示器。
   *
   *  OpenRA 对照: SellableInfo.ShowTicks (default true)
   *
   *  TODO-14/16: 使用 Babylon.js GUI TextBlock 实现浮动文字
   */
  readonly showTicks: boolean = true

  /** 是否在工具提示中显示退款文字。
   *
   *  OpenRA 对照: SellableInfo.ShowTooltipText (default true)
   *
   *  TODO-16: 集成 UI 工具提示系统
   */
  readonly showTooltipText: boolean = true

  /** 是否跳过（逆转的）建造动画。
   *
   *  OpenRA 对照: SellableInfo.SkipMakeAnimation (default false)
   *
   *  TODO-16: 集成 WithMakeAnimation 系统
   */
  readonly skipMakeAnimation: boolean = false

  /** 出售命令的光标样式。
   *
   *  OpenRA 对照: SellableInfo.Cursor (default "sell")
   */
  readonly cursor: string = 'sell'

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    refundPercent?: number
    sellSounds?: readonly string[]
    notification?: string | null
    textNotification?: string | null
    showTicks?: boolean
    showTooltipText?: boolean
    skipMakeAnimation?: boolean
    cursor?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.refundPercent = params.refundPercent ?? 50
    this.sellSounds = params.sellSounds ?? []
    this.notification = params.notification ?? null
    this.textNotification = params.textNotification ?? null
    this.showTicks = params.showTicks ?? true
    this.showTooltipText = params.showTooltipText ?? true
    this.skipMakeAnimation = params.skipMakeAnimation ?? false
    this.cursor = params.cursor ?? 'sell'
  }
}

// ---------------------------------------------------------------------------
// Sellable
// OpenRA 对照: Sellable : ConditionalTrait<SellableInfo>, IResolveOrder,
//   IProvideTooltipInfo
// ---------------------------------------------------------------------------

/** 可出售 trait。
 *
 *  OpenRA 对照: Sellable
 *
 *  使 actor 可以通过 "Sell" 命令出售。出售时：
 *  1. 取消当前活动
 *  2. 播放出售音效
 *  3. 通知 INotifySold traits（selling 回调）
 *  4. 计算退款：Valued.Cost × healthPercent × RefundPercent / 100
 *  5. 应用 CustomSellValue 覆盖（如果存在）
 *  6. 通过 PlayerResources.addCash() 授予现金
 *  7. 从 world 移除 actor
 *  8. 通知 INotifySold traits（sold 回调）
 */
export class Sellable
  extends ConditionalTrait<SellableInfo>
  implements IResolveOrder, IIssueOrder
{
  /** 对 actor 本身的引用（构造时传入）。
   *
   *  OpenRA 对照: readonly Actor self (构造参数)
   */
  private _self: IGameActor | null = null

  /** 健康 trait 的延迟解析引用。
   *
   *  OpenRA 对照: Lazy<IHealth> health = Exts.Lazy(self.TraitOrDefault<IHealth>)
   */
  private _health: IHealthAccess | null = null

  constructor(info: SellableInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // Component lifecycle
  // -----------------------------------------------------------------------

  /** 附加到 actor 时缓存 actor 引用并解析 Health trait。 */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    this._self = actor
    this._resolveHealth(actor)
  }

  /** 分离时清理引用。 */
  override detach(actor: IGameActor): void {
    this._self = null
    this._health = null
    super.detach(actor)
  }

  // -----------------------------------------------------------------------
  // IIssueOrder
  // OpenRA 对照: N/A (C# 中 Sell 命令由 SellOrderGenerator UI 部件发行，
  //   TS 中添加 IIssueOrder 用于热键出售支持)
  // -----------------------------------------------------------------------

  /** 该 trait 支持的命令目标选择器列表。
   *
   *  OpenRA 对照: SellOrderTargeter（延迟至 Chapter 15）
   *
   *  返回一个简单的目标选择器，用于自己作为出售目标。
   */
  get orders(): readonly IOrderTargeter[] {
    if (this.isTraitDisabled) return []
    return [{
      orderID: 'Sell',
      orderPriority: 1,
      isQueued: false,
      canTarget: (
        _actor: IGameActor,
        target: TargetStub,
        _modifiers: TargetModifiers,
        _cursor: string,
      ): boolean => {
        // Can only sell self
        const targetActor = target as unknown as IGameActor
        return targetActor.actorId === this._self?.actorId
      },
      targetOverridesSelection: (): boolean => false,
    }]
  }

  /** 发行出售命令。
   *
   *  OpenRA 对照: N/A（TS 添加，用于 IIssueOrder 支持）
   *
   *  仅当 trait 未被禁用且 RequiresCondition 满足时发行 "Sell" 命令。
   *
   *  @param self — 发行命令的 actor
   *  @param order — 目标选择器
   *  @param _target — 目标（应为 self）
   *  @param queued — 是否排队
   *  @returns 创建的 Order 对象
   */
  issueOrder(
    self: IGameActor,
    order: IOrderTargeter,
    _target: TargetStub,
    queued: boolean,
  ): Order {
    void self // mark as used for interface compliance
    if (order.orderID !== 'Sell') {
      return {
        orderName: '',
        targetString: '',
        extraData: 0,
      }
    }

    if (this.isTraitDisabled) {
      return {
        orderName: '',
        targetString: '',
        extraData: 0,
      }
    }

    // C#: SellOrderGenerator issues "Sell" order with self as subject.
    // The queued flag is stored in extraData since OrderStub has no queued field.
    return {
      orderName: 'Sell',
      targetString: '',
      extraData: queued ? 1 : 0,
    }
  }

  // -----------------------------------------------------------------------
  // IResolveOrder
  // OpenRA 对照: IResolveOrder.ResolveOrder(Actor, Order)
  // -----------------------------------------------------------------------

  /** 解析 "Sell" 命令，执行出售流程。
   *
   *  OpenRA 对照: Sellable.ResolveOrder(Actor self, Order order)
   *
   *  @param self — 要被出售的 actor
   *  @param order — 出售命令
   */
  resolveOrder(self: IGameActor, order: Order): void {
    if (order.orderName === 'Sell') {
      this.sell(self)
    }
  }

  // -----------------------------------------------------------------------
  // Sell
  // OpenRA 对照: void Sell(Actor self)
  // -----------------------------------------------------------------------

  /** 执行出售流程。
   *
   *  OpenRA 对照: Sellable.Sell(Actor self)
   *
   *  完整的出售流程：
   *  1. 检查 trait 是否被禁用
   *  2. 取消当前活动
   *  3. 播放出售音效
   *  4. 通知所有 INotifySold traits（selling 回调）
   *  5. 如果 SkipMakeAnimation 为 false 且存在 WithMakeAnimation，
   *     则逆转建造动画并委托后续流程
   *  6. 否则：计算退款、授予现金、从世界移除、通知 sold 回调
   *
   *  TODO-14.D: 完整 Activity 系统迁移后，使用 Sell Activity
   *  TODO-16: 集成 WithMakeAnimation.Reverse() 动画反转
   *
   *  @param self — 要被出售的 actor
   */
  sell(self: IGameActor): void {
    if (this.isTraitDisabled) return

    // Cancel current activity
    if (typeof self.cancelActivity === 'function') {
      self.cancelActivity()
    }

    // Play sell sounds
    // C#: foreach (var s in info.SellSounds)
    //        Game.Sound.PlayToPlayer(SoundType.UI, self.Owner, s, self.CenterPosition);
    // TODO-10-SOUND: 集成音频系统
    const _unused_sellSounds = this.info.sellSounds.length // explicitly mark for future audio integration (TODO-10-SOUND)
    void _unused_sellSounds

    // Notify INotifySold.Selling on all traits
    this._notifySelling(self)

    // WithMakeAnimation check
    // C#: if (!info.SkipMakeAnimation) {
    //   var makeAnimation = self.TraitOrDefault<WithMakeAnimation>();
    //   if (makeAnimation != null) {
    //     makeAnimation.Reverse(self, new Sell(self, info.ShowTicks), false);
    //     return;
    //   }
    // }
    // TODO-16: 集成 WithMakeAnimation 系统
    if (!this.info.skipMakeAnimation) {
      const makeAnimation = this._tryGetMakeAnimation(self)
      if (makeAnimation) {
        // C#: makeAnimation.Reverse(self, new Sell(self, info.ShowTicks), false);
        // WithMakeAnimation.Reverse would eventually queue the Sell activity.
        // Since Activity is deferred, fall through to direct execution.
        // NOTE: This means the reverse animation is skipped for now.
        // Will be properly implemented when WithMakeAnimation is migrated (Ch16).
      }
    }

    // Execute the actual sell (cash refund + remove from world)
    this._executeSell(self)

    // Notify INotifySold.Sold on all traits
    this._notifySold(self)
  }

  // -----------------------------------------------------------------------
  // sellValue
  // OpenRA 对照: Sellable.TooltipText getter logic
  // -----------------------------------------------------------------------

  /** 计算当前出售价值。
   *
   *  OpenRA 对照: Sellable.TooltipText getter
   *
   *  出售价值的计算方式：
   *  1. 获取基础出售价值：getSellValue(self)（优先 CustomSellValue，其次 Valued.Cost）
   *  2. 获取健康百分比：hp / maxHP（如果有 Health trait），否则 1.0
   *  3. 退款 = floor(sellValue × RefundPercent × hp / (100 × maxHP))
   *
   *  @param self — 要计算的 actor
   *  @returns 退款金额
   */
  sellValue(self: IGameActor): number {
    const baseSellValue = getSellValue(self)

    // Cast to avoid overflow when multiplying by the health
    const hp = this._health?.hp ?? 1
    // Use || 1 to guard against both null/undefined AND zero maxHP (divide-by-zero)
    const maxHP = this._health?.maxHP || 1
    const refund = Math.floor(
      (baseSellValue * this.info.refundPercent * hp) / (100 * maxHP),
    )

    return refund
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** 执行实际的出售操作（退款 + 移除 actor）。
   *
   *  OpenRA 对照: Sell Activity 内部的逻辑
   */
  private _executeSell(self: IGameActor): void {
    // Calculate refund
    const refund = this.sellValue(self)

    // Grant cash to player
    if (refund > 0 && self.owner) {
      const pr = this._resolvePlayerResources(self.owner)
      if (pr) {
        pr.addCash(refund, true) // isRefund = true
      }
    }

    // Floating text display
    // TODO-14/16: 使用 Babylon.js GUI TextBlock 实现浮动文字
    void this.info.showTicks // mark as used

    // Remove actor from world
    // C#: self.Dispose() or world.Remove(self) (via Sell Activity)
    if (self.world) {
      const world = self.world as unknown as {
        removeActor?: (actor: IGameActor) => void
      }
      if (typeof world.removeActor === 'function') {
        world.removeActor(self)
      }
    }
  }

  /** 解析 PlayerResources trait。
   */
  private _resolvePlayerResources(
    owner: PlayerStub,
  ): IPlayerResources | null {
    const playerActor = (owner as unknown as {
      playerActor?: { trait?: (name: string) => IPlayerResources | null }
    }).playerActor

    if (playerActor?.trait) {
      return playerActor.trait('PlayerResources')
    }

    return null
  }

  /** 解析 Health trait。
   *
   *  OpenRA 对照: Lazy<IHealth> health = Exts.Lazy(self.TraitOrDefault<IHealth>)
   */
  private _resolveHealth(self: IGameActor): void {
    const healthTrait = (self as unknown as {
      traitOrDefault?: (name: string) => IHealthAccess | null
    }).traitOrDefault?.('Health')

    if (healthTrait) {
      this._health = healthTrait
    } else {
      this._health = null
    }
  }

  /** 尝试获取 WithMakeAnimation trait。
   *
   *  OpenRA 对照: self.TraitOrDefault<WithMakeAnimation>()
   *
   *  TODO-16: 替换为真实的 WithMakeAnimation trait 解析
   */
  private _tryGetMakeAnimation(
    _self: IGameActor,
  ): { reverse: (actor: IGameActor, nextActivity: unknown, skip: boolean) => void } | null {
    // C#: var makeAnimation = self.TraitOrDefault<WithMakeAnimation>();
    //      if (makeAnimation != null) {
    //        makeAnimation.Reverse(self, new Sell(self, info.ShowTicks), false);
    //        return;
    //      }
    //
    // WithMakeAnimation not yet migrated.
    // TODO-16: Replace with real WithMakeAnimation trait resolution.
    return null
  }

  /** 通知所有 INotifySold.Selling traits。
   *
   *  OpenRA 对照: foreach (var ns in self.TraitsImplementing<INotifySold>()) ns.Selling(self);
   */
  private _notifySelling(self: IGameActor): void {
    const traits = (self as unknown as {
      traitsImplementing?: (name: string) => INotifySoldAccess[]
    }).traitsImplementing?.('INotifySold')

    if (traits) {
      for (const ns of traits) {
        ns.selling(self)
      }
    }
  }

  /** 通知所有 INotifySold.Sold traits。
   *
   *  OpenRA 对照: N/A (C# 中由 Sell Activity 在完成时调用)
   */
  private _notifySold(self: IGameActor): void {
    const traits = (self as unknown as {
      traitsImplementing?: (name: string) => INotifySoldAccess[]
    }).traitsImplementing?.('INotifySold')

    if (traits) {
      for (const ns of traits) {
        ns.sold(self)
      }
    }
  }
}
