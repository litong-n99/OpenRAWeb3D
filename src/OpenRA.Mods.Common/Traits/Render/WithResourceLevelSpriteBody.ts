/**
 * WithResourceLevelSpriteBody.ts — 根据资源存储量切换建筑 body 精灵帧
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithResourceLevelSpriteBody.cs (75 lines)
 *
 * 核心范式转换:
 * - C# WithResourceLevelSpriteBody : WithSpriteBody, INotifyOwnerChanged
 *   → TS ConditionalTrait<Info> implements INotifyOwnerChanged
 *   （WithSpriteBody 尚未迁移，直接继承 ConditionalTrait）
 * - C# ConfigureAnimation() 设置 PlayFetchIndex → TS calculateBodyFrameIndex() 纯逻辑
 * - C# TraitEnabled + CancelCustomAnimation 生命周期
 *   → TS traitEnabled() / cancelCustomAnimationCallback
 * - 渲染存根: TODO-10.B-Opt.4-RENDER — 集成 RenderSprites/WithSpriteBody pipeline
 *
 * WithSpriteBody 替换说明:
 *   C# 中此 trait 继承自 WithSpriteBody，替换默认 body 精灵显示。
 *   TS 中 WithSpriteBody 尚未迁移（TODO-10.B-Opt.4-DEP），因此此 trait
 *   直接实现帧选择逻辑，并将 body 精灵更新存根。
 *
 * 帧选择公式（对应 OpenRA ConfigureAnimation PlayFetchIndex lambda）:
 *   capacity == 0 ? 0 :
 *   floor((Stages * seqLen - 1) * resources / (Stages * capacity))
 *
 * Stages 默认值为 10，提供更细粒度的资源填充等级展示。
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyOwnerChanged,
  type PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IPlayerResourcesStub } from './WithResourceLevelOverlay.js'

// ---------------------------------------------------------------------------
// WithResourceLevelSpriteBodyInfo（对应 OpenRA WithResourceLevelSpriteBodyInfo）
// ---------------------------------------------------------------------------

/**
 * WithResourceLevelSpriteBody 特质配置。
 *
 * OpenRA 对照: WithResourceLevelSpriteBodyInfo : WithSpriteBodyInfo
 *
 * 在 C# 中继承自 WithSpriteBodyInfo，提供 body 精灵显示的 Image、
 * Sequence、Palette 等属性。TS 存根阶段仅包含资源相关配置。
 * 完整 WithSpriteBodyInfo 属性通过 TODO-10.B-Opt.4-DEP 补充。
 */
export class WithResourceLevelSpriteBodyInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 内部资源阶段数量。无需与序列帧数匹配。
   *
   *  OpenRA 对照: Stages (default 10)
   *
   *  更高的 Stages 值提供更细粒度的填充等级展示。
   *  该数字乘以序列长度再乘以资源比率计算帧索引。
   */
  readonly stages: number

  /** 自定义调色板名称。
   *
   *  OpenRA 对照: WithSpriteBodyInfo.Palette
   */
  readonly palette: string | null

  /** 是否为玩家颜色调色板。
   *
   *  OpenRA 对照: WithSpriteBodyInfo.IsPlayerPalette
   */
  readonly isPlayerPalette: boolean

  /** 序列名称。
   *
   *  OpenRA 对照: WithSpriteBodyInfo.Sequence (default "idle")
   */
  readonly sequence: string

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    stages?: number
    palette?: string | null
    isPlayerPalette?: boolean
    sequence?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.stages = params.stages ?? 10
    this.palette = params.palette ?? null
    this.isPlayerPalette = params.isPlayerPalette ?? false
    this.sequence = params.sequence ?? 'idle'
  }
}

// ---------------------------------------------------------------------------
// Frame selection — 静态纯函数（可独立测试）
// ---------------------------------------------------------------------------

/**
 * 根据资源填充等级计算 body 精灵序列帧索引。
 *
 * OpenRA 对照: ConfigureAnimation PlayFetchIndex lambda:
 *   playerResources.ResourceCapacity != 0
 *     ? (info.Stages * DefaultAnimation.CurrentSequence.Length - 1)
 *       * playerResources.Resources
 *       / (info.Stages * playerResources.ResourceCapacity)
 *     : 0
 *
 * 公式: capacity == 0 或 seqLen == 0 时返回 0；否则:
 *   floor((stages * sequenceLength - 1) * resources / (stages * capacity))
 *
 * @param resources — 玩家当前资源数量
 * @param capacity — 玩家资源容量
 * @param sequenceLength — 序列帧数（>= 1）
 * @param stages — 内部阶段数（默认 10）
 * @returns 0-based 帧索引（范围 [0, sequenceLength - 1]）
 */
export function calculateBodyFrameIndex(
  resources: number,
  capacity: number,
  sequenceLength: number,
  stages: number,
): number {
  if (capacity <= 0 || sequenceLength <= 0 || stages <= 0) return 0

  const adjustedLen = stages * sequenceLength
  const numerator = (adjustedLen - 1) * resources
  const denominator = stages * capacity
  const index = Math.floor(numerator / denominator)

  return Math.max(0, Math.min(index, sequenceLength - 1))
}

// ---------------------------------------------------------------------------
// WithResourceLevelSpriteBody（对应 OpenRA WithResourceLevelSpriteBody）
// ---------------------------------------------------------------------------

/**
 * 根据资源存储量切换建筑 body 精灵帧。
 *
 * OpenRA 对照: WithResourceLevelSpriteBody : WithSpriteBody, INotifyOwnerChanged
 *
 * 此 trait 替换默认 body 精灵，根据玩家资源填充等级选择不同的序列帧。
 * 资源满时显示最后一帧，资源空时显示第一帧。
 *
 * 渲染存根: TODO-10.B-Opt.4-RENDER：
 *   集成 RenderSprites/WithSpriteBody pipeline。
 *   当前仅计算帧索引，实际的 DefaultAnimation.PlayFetchIndex
 *   调用和精灵更新保持不变。
 *
 * 使用方式:
 * ```
 * const info = new WithResourceLevelSpriteBodyInfo({ stages: 10 })
 * const body = new WithResourceLevelSpriteBody(info)
 * body.setPlayerResolver(() => playerResources)
 * body.configureFrameSelector(sequenceLength)
 * const frameIndex = body.currentFrameIndex
 * ```
 */
export class WithResourceLevelSpriteBody
  extends ConditionalTrait<WithResourceLevelSpriteBodyInfo>
  implements INotifyOwnerChanged
{
  /** 静态接口注册（供 TypeDictionary 使用）。 */
  static readonly interfaces = [
    'INotifyOwnerChanged',
    'WithResourceLevelSpriteBody',
    'component',
  ]

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** 玩家资源解析器回调。 */
  private _playerResolver: (() => IPlayerResourcesStub | null) | null = null

  /** 当前缓存帧索引。 */
  private _frameIndex: number = 0

  /** 缓存的序列长度（外部设置）。 */
  private _sequenceLength: number = 0

  /** 取消自定义动画的回调（由外部动画系统设置）。 */
  private _cancelCustomAnimationCallback: (() => void) | null = null

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  /**
   * 构造 WithResourceLevelSpriteBody。
   *
   * OpenRA 对照: WithResourceLevelSpriteBody(ActorInitializer, Info)
   *
   * @param info — 特质配置
   */
  constructor(info: WithResourceLevelSpriteBodyInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // 依赖注入 / 配置
  // -----------------------------------------------------------------------

  /**
   * 设置 PlayerResources 解析器。
   *
   * OpenRA 对照: playerResources = init.Self.Owner.PlayerActor.Trait<PlayerResources>()
   *
   * @param resolver — PlayerResources 解析回调
   */
  setPlayerResolver(resolver: () => IPlayerResourcesStub | null): void {
    this._playerResolver = resolver
  }

  /**
   * 配置帧选择器。
   *
   * OpenRA 对照: ConfigureAnimation() 方法内的逻辑参数
   *
   * @param sequenceLength — 序列中的帧数
   */
  configureFrameSelector(sequenceLength: number): void {
    this._sequenceLength = Math.max(0, sequenceLength)
  }

  /**
   * 设置取消自定义动画回调。
   *
   * OpenRA 对照: CancelCustomAnimation() 中调用 ConfigureAnimation()
   *
   * 当外部系统取消自定义动画时，此回调被触发以重新配置动画。
   * 在完整实现中，这会重置 DefaultAnimation.PlayFetchIndex()。
   *
   * @param callback — 取消自定义动画时调用的回调
   */
  setCancelCustomAnimationCallback(callback: () => void): void {
    this._cancelCustomAnimationCallback = callback
  }

  // -----------------------------------------------------------------------
  // 帧索引计算
  // -----------------------------------------------------------------------

  /**
   * 获取当前资源填充等级对应的帧索引。
   *
   * OpenRA 对照: PlayFetchIndex lambda 的计算结果
   *
   * @returns 0-based 帧索引
   */
  get currentFrameIndex(): number {
    return this._frameIndex
  }

  /**
   * 根据当前 PlayerResources 状态更新帧索引。
   *
   * OpenRA 对照: 每帧 Animation.Tick() 时 PlayFetchIndex lambda 被调用
   *
   * 应在每帧渲染前或资源变化时调用。
   */
  updateFrameIndex(): void {
    if (!this._playerResolver) {
      this._frameIndex = 0
      return
    }

    const pr = this._playerResolver()
    if (!pr) {
      this._frameIndex = 0
      return
    }

    this._frameIndex = calculateBodyFrameIndex(
      pr.resources,
      pr.resourceCapacity,
      this._sequenceLength,
      this.info.stages,
    )
  }

  // -----------------------------------------------------------------------
  // INotifyOwnerChanged（对应 OpenRA OnOwnerChanged）
  // -----------------------------------------------------------------------

  /**
   * 属主变更时重新解析 PlayerResources。
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   *
   * @param _actor — actor 实例
   * @param _oldOwner — 旧属主
   * @param _newOwner — 新属主
   */
  onOwnerChanged(
    _actor: IGameActor,
    _oldOwner: PlayerStub,
    _newOwner: PlayerStub,
  ): void {
    // PlayerResources resolution is handled externally via setPlayerResolver
    // In full implementation, this would re-resolve from the new owner.
  }

  // -----------------------------------------------------------------------
  // 生命周期 (对应 OpenRA 的 TraitEnabled + CancelCustomAnimation)
  // -----------------------------------------------------------------------

  /**
   * 当 trait 被启用时调用。配置动画以使用资源填充等级帧选择器。
   *
   * OpenRA 对照: TraitEnabled(Actor self) override
   *
   * 在完整实现中，此方法调用 ConfigureAnimation() 设置 PlayFetchIndex。
   *
   * TODO-10.B-Opt.4-RENDER: 在此处触发 DefaultAnimation.PlayFetchIndex 重新配置
   */
  protected override traitEnabled(_actor: IGameActor): void {
    // NOTE: In C#, base.TraitEnabled(self) is called first.
    // TS base class sets _enabled = true in traitEnabled().
    super.traitEnabled(_actor)
    this.updateFrameIndex()
  }

  /**
   * 取消自定义动画并恢复默认帧选择器。
   *
   * OpenRA 对照: CancelCustomAnimation(Actor self) override
   *
   * 在完整实现中，调用 ConfigureAnimation() 重新设置 PlayFetchIndex。
   * 当前存根: 如果设置了回调则调用之。
   *
   * TODO-10.B-Opt.4-RENDER: 重新配置 DefaultAnimation.PlayFetchIndex
   */
  cancelCustomAnimation(): void {
    if (this._cancelCustomAnimationCallback) {
      this._cancelCustomAnimationCallback()
    }
    this.updateFrameIndex()
  }
}
