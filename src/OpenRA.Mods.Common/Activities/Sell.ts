/**
 * Sell.ts — 建筑出售活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Sell.cs
 *
 * 核心范式转换:
 * - C# self.GetSellValue() → TypeScript 鸭子类型获取 sellableInfo.cost
 * - C# self.Dispose() → TypeScript world.queueFrameEndAction(() => world.removeActor(self))
 * - C# FloatingText 效果 → TypeScript FloatingText 存根 (延迟到视觉特效章节)
 * - C# TextNotificationsManager.AddTransientLine() → TypeScript 存根
 * - C# IsInterruptible = false → TypeScript this.isInterruptible = false
 * - C# (int) cast truncation → TypeScript Math.floor()
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { IHealth } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import {
  FloatingText,
  TextNotificationsManager,
  type INotifySold,
} from './EconomicActivityInterfaces.js'

// ---------------------------------------------------------------------------
// Sell
// ---------------------------------------------------------------------------

/**
 * 建筑出售活动 — 一次性、不可中断的出售操作。
 *
 * OpenRA 对照: Sell activity
 *
 * 工作流程:
 * 1. 计算出售价值 (基于健康百分比和退款比例)
 * 2. 将退款金额添加到玩家资源
 * 3. 通知 INotifySold 接口
 * 4. 显示浮动文字 (如果启用且与渲染玩家同盟)
 * 5. 播放语音通知
 * 6. 延迟销毁 actor
 *
 * 注意: 此活动不可中断 (isInterruptible = false)。
 */
export class Sell extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** 是否显示浮动金额文字。 */
  readonly showTicks: boolean

  // ---------------------------------------------------------------------------
  // Resolved traits
  // ---------------------------------------------------------------------------

  /** 健康 trait (可能为 null)。 */
  private readonly health: IHealth | null

  /** 可出售配置信息。 */
  private readonly sellableInfo: SellableInfoLike

  /** 玩家资源。 */
  private readonly playerResources: PlayerResourcesLike

  /** 通知接口数组。 */
  private readonly notifySoldTraits: readonly INotifySold[]

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * 创建 Sell 活动。
   *
   * OpenRA 对照: Sell(Actor, bool)
   *
   * @param self — 执行此活动的 actor (被出售的建筑)
   * @param showTicks — 是否显示浮动金额文字
   */
  constructor(self: GameActor, showTicks: boolean) {
    super()
    this.showTicks = showTicks
    this.isInterruptible = false

    this.health = Sell._resolveHealth(self)
    this.sellableInfo = Sell._resolveSellableInfo(self)
    this.playerResources = Sell._resolvePlayerResources(self)
    this.notifySoldTraits = Sell._resolveNotifySoldTraits(self)
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * 执行出售操作。
   *
   * OpenRA 对照: Sell.Tick(Actor)
   *
   * 此 tick 只执行一次，返回 false 后 actor 被延迟销毁。
   *
   * @param self — 执行此活动的 actor
   * @returns false (actor 将在帧末被销毁)
   */
  override tick(self: GameActor): boolean {
    const sellValue = this.sellableInfo.cost

    // 计算退款金额: (int)(sellValue * refundPercent * hp / (100 * maxHP))
    const hp = this.health !== null ? this.health.hp : 1
    const maxHP = this.health !== null ? this.health.maxHP : 1
    const refundPercent = this.sellableInfo.refundPercent

    // 使用 Math.floor 模拟 C# 的 (int) 截断
    const refund = Math.floor(
      (sellValue * refundPercent * hp) / (100 * maxHP),
    )

    // 添加退款到玩家资源
    const actualRefund = this.playerResources.changeCash(refund)

    // 通知 INotifySold 接口
    for (const ns of this.notifySoldTraits) {
      ns.sold(self)
    }

    // 显示浮动文字 (如果启用且与渲染玩家同盟)
    if (this.showTicks && actualRefund > 0 && this._isAlliedWithRenderPlayer(self)) {
      const centerPosition = (self as unknown as { centerPosition: WPos }).centerPosition
      const ownerColor = this._getOwnerColor(self)
      const text = FloatingText.formatCashTick(actualRefund)
      const world = (self as unknown as { world?: WorldLike }).world
      if (world !== undefined) {
        world.queueFrameEndAction(() => {
          world.addEffect(new FloatingText(centerPosition, ownerColor, text, 30))
        })
      }
    }

    // 播放语音通知
    const notification = this.sellableInfo.notification
    if (notification !== null) {
      Sell._playNotification(self, notification)
    }

    // 文字通知
    const textNotification = this.sellableInfo.textNotification
    if (textNotification !== null) {
      TextNotificationsManager.addTransientLine(self.owner ?? null, textNotification)
    }

    // 延迟销毁 actor
    const world = (self as unknown as { world?: WorldLike }).world
    if (world !== undefined) {
      world.queueFrameEndAction(() => {
        world.removeActor(self)
      })
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Sell 活动不渲染目标线。
   *
   * OpenRA 对照: Sell.TargetLineNodes (继承默认空实现)
   */
  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    return []
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** 检查 actor 的所有者是否与渲染玩家同盟。 */
  private _isAlliedWithRenderPlayer(self: GameActor): boolean {
    const world = (self as unknown as { world?: WorldLike }).world
    const owner = self.owner
    const renderPlayer = world?.renderPlayer
    if (owner === undefined || renderPlayer === undefined) return false

    // 鸭子类型: 检查 relationshipWith 方法
    const ownerAny = owner as unknown as { relationshipWith?: (p: unknown) => number }
    if (typeof ownerAny.relationshipWith === 'function') {
      const relationship = ownerAny.relationshipWith(renderPlayer)
      // PlayerRelationship.Ally = 4
      return (relationship & 4) === 4
    }

    // 回退: 直接比较
    return owner === renderPlayer
  }

  /** 获取所有者颜色。 */
  private _getOwnerColor(self: GameActor): ColorStub {
    const owner = self.owner
    if (owner) {
      const ownerAny = owner as unknown as { color?: ColorStub; faction?: { color?: ColorStub } }
      if (ownerAny.color) return ownerAny.color
      if (ownerAny.faction?.color) return ownerAny.faction.color
    }
    return { r: 1, g: 1, b: 1, a: 1 }
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  /** 解析 IHealth。 */
  private static _resolveHealth(self: GameActor): IHealth | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    if (traits?.has('IHealth')) {
      return traits.get('IHealth') as IHealth
    }
    // 鸭子类型查找
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<IHealth>
      if (t.hp !== undefined && t.maxHP !== undefined && t.damageState !== undefined) {
        return t as IHealth
      }
    }
    return null
  }

  /** 解析 SellableInfo。 */
  private static _resolveSellableInfo(self: GameActor): SellableInfoLike {
    // 从 actor info 查找
    const info = (self as unknown as { info?: { sellable?: SellableInfoLike } }).info
    if (info?.sellable) {
      return info.sellable
    }

    // 从 traits 查找
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<SellableInfoLike>
      if (t.refundPercent !== undefined && t.cost !== undefined) {
        return t as SellableInfoLike
      }
    }

    // 回退默认值
    return {
      cost: 0,
      refundPercent: 50,
      notification: null,
      textNotification: null,
    }
  }

  /** 解析 PlayerResources。 */
  private static _resolvePlayerResources(self: GameActor): PlayerResourcesLike {
    const owner = self.owner
    if (owner) {
      const playerActor = (owner as unknown as { playerActor?: unknown }).playerActor
      if (playerActor) {
        const pr = (playerActor as unknown as { playerResources?: PlayerResourcesLike }).playerResources
        if (pr) return pr
      }
    }
    // 回退存根
    return {
      changeCash: (_amount: number) => 0,
    }
  }

  /** 解析 INotifySold traits。 */
  private static _resolveNotifySoldTraits(self: GameActor): INotifySold[] {
    const result: INotifySold[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifySold>
      if (typeof t.sold === 'function') {
        result.push(t as INotifySold)
      }
    }
    return result
  }

  /** 播放语音通知。 */
  private static _playNotification(self: GameActor, notification: string): void {
    const world = (self as unknown as { world?: { playSound?: (type: string, sounds: readonly string[], world: unknown, pos: unknown) => void } }).world
    if (world?.playSound) {
      world.playSound('Speech', [notification], self.world, (self as unknown as { centerPosition: WPos }).centerPosition)
    }
  }
}

// ---------------------------------------------------------------------------
// SellableInfoLike — 可出售配置最小接口
// ---------------------------------------------------------------------------

/** 可出售 trait 配置信息。
 *
 *  OpenRA 对照: SellableInfo
 */
interface SellableInfoLike {
  /** 单位造价。 */
  readonly cost: number

  /** 退款百分比 (0-100)。 */
  readonly refundPercent: number

  /** 出售时的语音通知。 */
  readonly notification: string | null

  /** 出售时的文字通知。 */
  readonly textNotification: string | null
}

// ---------------------------------------------------------------------------
// PlayerResourcesLike — 玩家资源最小接口
// ---------------------------------------------------------------------------

/** 玩家资源最小接口。
 *
 *  OpenRA 对照: PlayerResources
 */
interface PlayerResourcesLike {
  /** 增加现金，返回实际增加的金额。
   *
   *  @param amount — 要增加的金额
   *  @returns 实际增加的金额 (可能被上限截断)
   */
  changeCash(amount: number): number
}

// ---------------------------------------------------------------------------
// WorldLike — 世界最小接口
// ---------------------------------------------------------------------------

/** 世界最小接口 (用于延迟操作)。 */
interface WorldLike {
  /** 渲染玩家。 */
  readonly renderPlayer?: unknown

  /** 在帧末执行操作。 */
  queueFrameEndAction(action: () => void): void

  /** 添加视觉效果。 */
  addEffect(effect: unknown): void

  /** 从世界中移除 actor。 */
  removeActor(actor: GameActor): void
}

// ---------------------------------------------------------------------------
// ColorStub — 颜色最小接口
// ---------------------------------------------------------------------------

/** 颜色最小接口。 */
interface ColorStub {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}
