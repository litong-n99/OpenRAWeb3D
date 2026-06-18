/**
 * GivesCashOnCapture.ts — 占领建筑时授予现金的 trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/GivesCashOnCapture.cs (62 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<GivesCashOnCaptureInfo>, INotifyCapture
 *   → TS ConditionalTrait<GivesCashOnCaptureInfo> implements INotifyCapture
 * - C# newOwner.PlayerActor.Trait<PlayerResources>() → TS duck-typed playerActor trait resolution
 * - C# BitSet<CaptureType> CaptureTypes → TS overlaps check via duck-typing
 * - C# FloatingText effect → TS floating text stub (TODO-14/16)
 * - C# self.World.AddFrameEndTask() → TS stub pattern
 */

import {
  ConditionalTrait,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  INotifyCapture,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IPlayerResources — Forward interface for PlayerResources (Phase B)
// OpenRA 对照: PlayerResources trait (Phase B, )
// ---------------------------------------------------------------------------

/**
 * 最小化的 PlayerResources 前向接口。
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlayerResources.cs
 *
 * 由于 PlayerResources 在阶段 B 第 2 波才迁移（），
 * 此处使用最小接口 + duck-typing 解析。
 *
* 当 PlayerResources 迁移后，替换为完整类型。
 */
interface IPlayerResources {
  changeCash(amount: number): number
}

// ---------------------------------------------------------------------------
// GivesCashOnCaptureInfo
// OpenRA 对照: GivesCashOnCaptureInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** 占领授予现金的配置。
 *
 *  OpenRA 对照: GivesCashOnCaptureInfo
 */
export class GivesCashOnCaptureInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 是否显示浮动的现金指示器。
   *
   *  OpenRA 对照: GivesCashOnCaptureInfo.ShowTicks (default true)
   */
  readonly showTicks: boolean = true

  /** 浮动现金指示器的显示时长（tick 数）。
   *
   *  OpenRA 对照: GivesCashOnCaptureInfo.DisplayDuration (default 30)
   */
  readonly displayDuration: number = 30

  /** 占领时授予的现金金额。
   *
   *  OpenRA 对照: GivesCashOnCaptureInfo.Amount (default 0)
   */
  readonly amount: number = 0

  /** 限定触发现金授予的占领类型。空位集 = 所有占领类型都触发。
   *
   *  OpenRA 对照: GivesCashOnCaptureInfo.CaptureTypes (BitSet<CaptureType>, default empty)
   */
  readonly captureTypes: { isEmpty: boolean; overlaps(other: unknown): boolean } = {
    isEmpty: true,
    overlaps: () => true,
  }

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    showTicks?: boolean
    displayDuration?: number
    amount?: number
    captureTypes?: { isEmpty: boolean; overlaps(other: unknown): boolean }
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.showTicks = params.showTicks ?? true
    this.displayDuration = params.displayDuration ?? 30
    this.amount = params.amount ?? 0
    this.captureTypes = params.captureTypes ?? { isEmpty: true, overlaps: () => true }
  }
}

// ---------------------------------------------------------------------------
// GivesCashOnCapture
// OpenRA 对照: GivesCashOnCapture : ConditionalTrait<GivesCashOnCaptureInfo>, INotifyCapture
// ---------------------------------------------------------------------------

/** 占领授予现金 trait。
 *
 *  OpenRA 对照: GivesCashOnCapture
 *
 *  当携带此 trait 的 actor 被占领时，新拥有者获得一笔现金奖励。
 *
 *  触发条件（全部满足才授予现金）:
 *  1. trait 未被禁用
 *  2. 占领类型匹配 CaptureTypes（如果指定了具体类型）
 *
 *  现金授予后，如果 ShowTicks 为 true，显示浮动 "+$Amount" 文字。
 */
export class GivesCashOnCapture
  extends ConditionalTrait<GivesCashOnCaptureInfo>
  implements INotifyCapture
{
  constructor(info: GivesCashOnCaptureInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // INotifyCapture
  // OpenRA 对照: void INotifyCapture.OnCapture(Actor self, Actor captor, Player oldOwner, Player newOwner, BitSet<CaptureType> captureTypes)
  // -----------------------------------------------------------------------

  /** 当此 actor 被占领时调用。
   *
   *  OpenRA 对照: INotifyCapture.OnCapture(Actor, Actor, Player, Player, BitSet<CaptureType>)
   *
   *  检查 trait 启用状态和 CaptureTypes 匹配后，将现金授予新拥有者。
   *
   *  @param self — 被占领的 actor
   *  @param captor — 执行占领的 actor
   *  @param oldOwner — 原来的拥有者
   *  @param newOwner — 新的拥有者
   *  @param captureTypes — 占领类型（number bitmask 或 BitSet 对象）
   */
  onCapture(
    self: IGameActor,
    _captor: IGameActor,
    _oldOwner: unknown,
    newOwner: unknown,
    captureTypes: number | { overlaps?: (other: unknown) => boolean },
  ): void {
    // 1. Trait disabled check
    if (this.isTraitDisabled) return

    // 2. CaptureTypes matching
    if (!this.info.captureTypes.isEmpty) {
      // captureTypes can be a number (bitmask) or a BitSet-like object
      if (typeof captureTypes === 'number') {
        // When captureTypes is a number bitmask, we check if the info's
        // capture types overlap with it. Since we don't know the exact
        // bitset values, we skip this check for numeric types unless
        // they are non-zero.
        if (captureTypes === 0) return
      } else if (typeof captureTypes?.overlaps === 'function') {
        if (!captureTypes.overlaps(this.info.captureTypes)) {
          return
        }
      }
    }

    // 3. Grant cash to new owner
    const amount = this.info.amount
    if (amount <= 0) return

    this._grantCash(newOwner as Record<string, unknown>, amount)

    // 4. Floating text (stub until Chapter 14/16)
    if (this.info.showTicks) {
      // C# pattern:
      //   var resources = newOwner.PlayerActor.Trait<PlayerResources>();
      //   var amount = resources.ChangeCash(info.Amount);
      //   if (!info.ShowTicks && amount != 0) return;
      //   self.World.AddFrameEndTask(w => w.Add(
      //     new FloatingText(self.CenterPosition, self.OwnerColor(),
      //       FloatingText.FormatCashTick(amount), info.DisplayDuration)));
      //
      // TODO-10.B.7-FLOATING: Implement floating text display using
      //   Babylon.js GUI TextBlock when FloatingText is available (Chapter 14/16).
      void self // mark as used for center position
      void amount // mark as used for floating text amount
      void this.info.displayDuration // mark as used for display duration
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** 授予现金给新拥有者。
   *
   *  OpenRA 对照: newOwner.PlayerActor.Trait<PlayerResources>().ChangeCash(info.Amount)
   *
   *  @param newOwner — 新的拥有者（Player 或 PlayerStub）
   *  @param amount — 要授予的现金金额
   *
* 当 PlayerResources 迁移后，使用完整的类型系统。
   */
  private _grantCash(newOwner: Record<string, unknown>, amount: number): void {
    // Try to access PlayerResources from the new owner's player actor
    // C#: newOwner.PlayerActor.Trait<PlayerResources>()
    const playerActor = (
      newOwner as {
        playerActor?: {
          trait?: (name: string) => IPlayerResources | null
          changeCash?: (amount: number) => number
        } | null
      }
    ).playerActor

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
