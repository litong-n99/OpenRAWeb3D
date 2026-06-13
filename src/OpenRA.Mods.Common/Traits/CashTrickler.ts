/**
 * CashTrickler.ts — 周期性现金收入 trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/CashTrickler.cs (113 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<CashTricklerInfo>, ITick, ISync, INotifyCreated,
 *     INotifyOwnerChanged
 *   → TS ConditionalTrait<CashTricklerInfo> implements ITick, INotifyCreated,
 *     INotifyOwnerChanged
 *   (PausableConditionalTrait 的 pause 功能在 TS 的 ConditionalTrait._paused 中实现)
 * - C# Util.ApplyPercentageModifiers() → TS applyPercentageModifiers() helper
 * - C# FloatingText effect → TS 存根 (延迟至 TODO-14/16)
 * - C# ICashTricklerModifier → TS duck-typed 查询
 * - C# PlayerResources.ChangeCash/GiveResources → TS IPlayerResources 前向接口
 */

import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  ITick,
  INotifyCreated,
  INotifyOwnerChanged,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

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
  changeCash(amount: number): number
  giveResources(amount: number): void
  readonly resources: number
}

// ---------------------------------------------------------------------------
// Helper: applyPercentageModifiers
// OpenRA 对照: Util.ApplyPercentageModifiers(int, IEnumerable<int>)
// ---------------------------------------------------------------------------

/**
 * 对基础值应用一系列百分比修正。
 *
 * OpenRA 对照: Util.ApplyPercentageModifiers(int baseValue, IEnumerable<int> modifiers)
 *
 * 每个修正值是一个整数百分比（100 = 100%、200 = 200%），依次相乘并取整。
 *
 * @param baseValue — 基础值
 * @param modifiers — 百分比修正值数组
 * @returns 修正后的值
 */
function applyPercentageModifiers(baseValue: number, modifiers: number[]): number {
  let result = baseValue
  for (const modifier of modifiers) {
    result = Math.floor((result * modifier) / 100)
  }
  return result
}

// ---------------------------------------------------------------------------
// ICashTricklerModifier — Duck-typed interface (not yet migrated)
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs ICashTricklerModifier
// TODO-10.B.4-MODIFIER: Migrate ICashTricklerModifier traits
// ---------------------------------------------------------------------------

/** ICashTricklerModifier 的 duck-typed 接口。
 *
 *  OpenRA 对照: ICashTricklerModifier.GetCashTricklerModifier()
 */
interface ICashTricklerModifier {
  getCashTricklerModifier(): number
}

// ---------------------------------------------------------------------------
// CashTricklerInfo
// OpenRA 对照: CashTricklerInfo : PausableConditionalTraitInfo, IRulesetLoaded
// ---------------------------------------------------------------------------

/** 周期性现金收入的配置。
 *
 *  OpenRA 对照: CashTricklerInfo
 */
export class CashTricklerInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 每次给予的现金数额。
   *
   *  OpenRA 对照: CashTricklerInfo.Amount (default 15)
   */
  readonly amount: number = 15

  /** 两次给予之间的 tick 间隔。
   *
   *  OpenRA 对照: CashTricklerInfo.Interval (default 50)
   */
  readonly interval: number = 50

  /** 首次给予之前的延迟 tick 数。
   *
   *  OpenRA 对照: CashTricklerInfo.InitialDelay (default 0)
   *
   *  当设置为 0 时，第一个 tick 就会触发支付。
   */
  readonly initialDelay: number = 0

  /** 是否显示浮动的现金文字。
   *
   *  OpenRA 对照: CashTricklerInfo.ShowTicks (default true)
   *
   *  TODO-14/16: 使用 Babylon.js GUI TextBlock 实现浮动文字
   */
  readonly showTicks: boolean = true

  /** 浮动文字显示的 tick 持续时间。
   *
   *  OpenRA 对照: CashTricklerInfo.DisplayDuration (default 30)
   */
  readonly displayDuration: number = 30

  /** 是否使用资源存储来容纳现金。
   *
   *  OpenRA 对照: CashTricklerInfo.UseResourceStorage (default false)
   *
   *  当为 true 时，现金以资源形式存入 PlayerResources，
   *  受存储容量限制。否则直接增加现金。
   */
  readonly useResourceStorage: boolean = false

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    amount?: number
    interval?: number
    initialDelay?: number
    showTicks?: boolean
    displayDuration?: number
    useResourceStorage?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.amount = params.amount ?? 15
    this.interval = params.interval ?? 50
    this.initialDelay = params.initialDelay ?? 0
    this.showTicks = params.showTicks ?? true
    this.displayDuration = params.displayDuration ?? 30
    this.useResourceStorage = params.useResourceStorage ?? false
  }
}

// ---------------------------------------------------------------------------
// CashTrickler
// OpenRA 对照: CashTrickler : PausableConditionalTrait<CashTricklerInfo>,
//   ITick, ISync, INotifyCreated, INotifyOwnerChanged
// ---------------------------------------------------------------------------

/** 周期性现金收入 trait。
 *
 *  OpenRA 对照: CashTrickler
 *
 *  每个 Interval tick 向拥有者球员添加 Amount 现金。
 *  支持通过 PausableConditionalTrait 暂停和禁用，
 *  以及通过外部 ICashTricklerModifier traits 修改收入。
 *
 *  典型用户：油井（Oil Derrick）、科技建筑等被动收入来源。
 */
export class CashTrickler
  extends ConditionalTrait<CashTricklerInfo>
  implements ITick, INotifyCreated, INotifyOwnerChanged
{
  /** 当前 tick 倒计时。
   *
   *  OpenRA 对照: CashTrickler.Ticks [Sync]
   */
  ticks: number

  /** 对拥有者玩家 PlayerResources 的引用。 */
  private _playerResources: IPlayerResources | null = null

  /** 缓存的 ICashTricklerModifier traits 列表（用于性能）。 */
  private _modifiers: ICashTricklerModifier[] = []

  /** Cloak traits 缓存 — 用于可见性检查。
   *
   *  OpenRA 对照: cloaks = self.TraitsImplementing<Cloak>().ToArray()
   *
   *  TODO-12.CLOAK: 当 Cloak trait 迁移后，替换为真实类型。
   */
  private _cloaks: { isVisible: (self: IGameActor, viewer: IGameActor | null) => boolean }[] = []

  constructor(info: CashTricklerInfo) {
    super(info)
    this.ticks = info.initialDelay
  }

  // -----------------------------------------------------------------------
  // Component lifecycle
  // -----------------------------------------------------------------------

  /** 附加到 actor 时初始化。
   *
   *  OpenRA 对照: CashTrickler.Created(Actor self)
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    this._resolveReferences(actor)
  }

  /** 分离时清理引用。 */
  override detach(actor: IGameActor): void {
    this._playerResources = null
    this._modifiers = []
    this._cloaks = []
    super.detach(actor)
  }

  // -----------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: override void Created(Actor self)
  // -----------------------------------------------------------------------

  /** 当 actor 完全创建后调用，解析 PlayerResources 引用。
   *
   *  OpenRA 对照: CashTrickler.Created(Actor self)
   */
  created(self: IGameActor): void {
    this._resolveReferences(self)
  }

  // -----------------------------------------------------------------------
  // INotifyOwnerChanged
  // OpenRA 对照: void INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
  // -----------------------------------------------------------------------

  /** 当 actor 所有权变更时，重新解析 PlayerResources 引用。
   *
   *  OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   */
  onOwnerChanged(
    self: IGameActor,
    _oldOwner: PlayerStub,
    newOwner: PlayerStub,
  ): void {
    this._resolvePlayerResources(newOwner)
    void self // mark unused param as intentionally present for interface compliance
  }

  // -----------------------------------------------------------------------
  // ITick
  // OpenRA 对照: void ITick.Tick(Actor self)
  // -----------------------------------------------------------------------

  /** 每个游戏 tick 调用。
   *
   *  OpenRA 对照: ITick.Tick(Actor self)
   *
   *  tick 逻辑：
   *  1. 如果 trait 被禁用，重置 ticks 为 interval（重新启用时从头开始计数）
   *  2. 如果 trait 被暂停或禁用，直接返回
   *  3. 递减 ticks；如果 ticks < 0，则支付现金并重置 ticks 为 interval
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled) {
      this.ticks = this.info.interval
    }

    if (this.isTraitPaused || this.isTraitDisabled) {
      return
    }

    if (--this.ticks < 0) {
      // Collect cash trickler modifiers
      const modifierValues = this._modifiers.map(m => m.getCashTricklerModifier())
      this.ticks = this.info.interval
      this._modifyCash(self, applyPercentageModifiers(this.info.amount, modifierValues))
    }
  }

  // -----------------------------------------------------------------------
  // ModifyCash
  // OpenRA 对照: virtual void ModifyCash(Actor self, int amount)
  // -----------------------------------------------------------------------

  /** 修改拥有者的现金/资源。
   *
   *  OpenRA 对照: CashTrickler.ModifyCash(Actor self, int amount)
   *
   *  如果 UseResourceStorage 为 true，以资源形式存入（受存储容量限制）；
   *  否则直接增加现金。
   *
   *  可见性检查：如果 actor 有 Cloak traits 且对当前渲染玩家不可见，
   *  则跳过浮动文字显示。
   *
   *  @param self — 产生现金的 actor
   *  @param amount — 现金数额
   */
  protected modifyCash(self: IGameActor, amount: number): void {
    const pr = this._playerResources
    if (!pr) return

    let effectiveAmount: number

    if (this.info.useResourceStorage) {
      const initialAmount = pr.resources
      pr.giveResources(amount)
      effectiveAmount = pr.resources - initialAmount
    } else {
      effectiveAmount = pr.changeCash(amount)
    }

    // Cloak visibility check: skip floating text if cloaked
    if (this._cloaks.length !== 0) {
      const renderPlayer = (self.world as unknown as { renderPlayer?: IGameActor | null })?.renderPlayer ?? null
      if (!this._cloaks.some(c => c.isVisible(self, renderPlayer))) {
        return
      }
    }

    // Floating text display
    // TODO-14/16: Implement floating text using Babylon.js GUI TextBlock
    // C# pattern:
    //   if (info.ShowTicks && amount != 0)
    //     self.World.AddFrameEndTask(w =>
    //       w.Add(new FloatingText(self.CenterPosition, self.OwnerColor(),
    //         FloatingText.FormatCashTick(amount), info.DisplayDuration)));
    void effectiveAmount // mark as used
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** 为 _modifyCash 的内部实现 — 暴露以便子类注入行为。 */
  private _modifyCash(self: IGameActor, amount: number): void {
    this.modifyCash(self, amount)
  }

  /** 解析所有需要的引用（PlayerResources、modifiers、cloaks）。
   *
   *  OpenRA 对照: Created() 中的解析逻辑
   */
  private _resolveReferences(self: IGameActor): void {
    // Resolve PlayerResources from owner
    if (self.owner) {
      this._resolvePlayerResources(self.owner)
    }

    // Cache ICashTricklerModifier traits
    // C#: self.TraitsImplementing<ICashTricklerModifier>()
    // TODO-10.B.4-MODIFIER: Replace duck-typing with real trait resolution
    const traits = (self as unknown as {
      traitsImplementing?: (name: string) => ICashTricklerModifier[]
    }).traitsImplementing
    if (typeof traits === 'function') {
      this._modifiers = traits('ICashTricklerModifier')
    }

    // Cache Cloak traits
    // C#: self.TraitsImplementing<Cloak>().ToArray()
    // TODO-12.CLOAK: Replace duck-typing with real Cloak trait resolution
    const cloaks = traits?.('Cloak')
    if (cloaks) {
      this._cloaks = cloaks as unknown as typeof this._cloaks
    }
  }

  /** 解析 PlayerResources 引用。
   */
  private _resolvePlayerResources(owner: PlayerStub): void {
    const playerActor = (owner as unknown as {
      playerActor?: {
        trait?: (name: string) => IPlayerResources | null
      }
    }).playerActor

    if (playerActor?.trait) {
      this._playerResources = playerActor.trait('PlayerResources')
    }
  }
}
