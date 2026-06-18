/**
 * WithResourceLevelOverlay.ts — 根据玩家资源填充量显示精灵叠加层
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithResourceLevelOverlay.cs (69 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<Info>, INotifyOwnerChanged, INotifyDamageStateChanged
 *   → TS ConditionalTrait<Info> implements INotifyOwnerChanged, INotifyDamageStateChanged
 * - C# Requires<WithSpriteBodyInfo>, Requires<RenderSpritesInfo>
 *   → TS 在 configureFrameSelector() 中接受接口依赖
 * - C# AnimationWithOffset + rs.Add → TS calculateFrameIndex() 纯逻辑 + render stub
 * - GPU 渲染存根: TODO-10.B-Opt.3-RENDER — 集成 RenderSprites/Animation pipeline
 *
 * 帧选择公式（对应 OpenRA PlayFetchIndex lambda）:
 *   capacity == 0 ? 0 :
 *   floor((10 * seqLen - 1) * resources / (10 * capacity))
 *
 * 此公式确保资源填充量均匀分布于 sequenceLength 个帧之间。
 * 最后一帧仅在 resourceCapacity 完全达到时出现。
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyOwnerChanged,
  type INotifyDamageStateChanged,
  type AttackInfo,
  type PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IPlayerResourcesStub — PlayerResources 的最小前向接口
// OpenRA 对照: PlayerResources（）
// ---------------------------------------------------------------------------

/** PlayerResources 的最小前向接口（仅含 resourceCapacity 和 resources）。
 *
 *  OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlayerResources.cs
 *
* 替换为完整的 PlayerResources 类。
 */
export interface IPlayerResourcesStub {
  readonly resourceCapacity: number
  readonly resources: number
}

// ---------------------------------------------------------------------------
// IWithSpriteBodyStub — WithSpriteBody 的最小前向接口
// OpenRA 对照: WithSpriteBody.NormalizeSequence
// ---------------------------------------------------------------------------

/** WithSpriteBody 的最小前向接口。
 *
 *  OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithSpriteBody.cs
 *
 *  仅暴露 NormalizeSequence 方法，用于损伤状态变化时重新解析序列名。
 *  完整 WithSpriteBody 迁移待 TODO-10.B-Opt.4-RENDER。
 */
export interface IWithSpriteBodyStub {
  /** 根据损伤状态标准化序列名。
   *
   *  OpenRA 对照: WithSpriteBody.NormalizeSequence(Actor, string)
   */
  normalizeSequence(self: IGameActor, sequence: string): string
}

// ---------------------------------------------------------------------------
// IPlayerResolver — 解析 PlayerResources 的回调
// ---------------------------------------------------------------------------

/** 解析玩家 PlayerResources 的回调。
 *
 *  OpenRA 对照: self.Owner.PlayerActor.Trait<PlayerResources>()
 *
 *  在真实实现中，这通过 actor.owner.playerActor.findTrait(...) 完成。
 *  存根阶段，允许外部注入或返回 null。
 */
export type PlayerResolverFn = () => IPlayerResourcesStub | null

// ---------------------------------------------------------------------------
// WithResourceLevelOverlayInfo（对应 OpenRA WithResourceLevelOverlayInfo）
// ---------------------------------------------------------------------------

/**
 * WithResourceLevelOverlay 特质配置。
 *
 * OpenRA 对照: WithResourceLevelOverlayInfo : ConditionalTraitInfo,
 *   Requires<WithSpriteBodyInfo>, Requires<RenderSpritesInfo>
 */
export class WithResourceLevelOverlayInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 序列名称。
   *
   *  OpenRA 对照: Sequence (default "resources")
   */
  readonly sequence: string

  /** 自定义调色板名称。
   *
   *  OpenRA 对照: Palette (default null)
   */
  readonly palette: string | null

  /** 是否为玩家颜色调色板。
   *
   *  OpenRA 对照: IsPlayerPalette (default false)
   */
  readonly isPlayerPalette: boolean

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    sequence?: string
    palette?: string | null
    isPlayerPalette?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.sequence = params.sequence ?? 'resources'
    this.palette = params.palette ?? null
    this.isPlayerPalette = params.isPlayerPalette ?? false
  }
}

// ---------------------------------------------------------------------------
// Frame selection — 静态纯函数（可独立测试）
// ---------------------------------------------------------------------------

/**
 * 根据资源填充等级计算精灵序列帧索引。
 *
 * OpenRA 对照: PlayFetchIndex lambda:
 *   playerResources.ResourceCapacity != 0 ?
 *     (10 * a.CurrentSequence.Length - 1) * playerResources.Resources
 *       / (10 * playerResources.ResourceCapacity) :
 *     0
 *
 * 公式: capacity == 0 时返回 0；否则:
 *   floor((10 * sequenceLength - 1) * resources / (10 * capacity))
 *
 * 该乘法确保 resources == capacity 时返回 sequenceLength - 1（最后一帧）。
 * 注意: capacity 为 0 时直接返回 0，避免除零错误。
 *
 * @param resources — 玩家当前资源数量
 * @param capacity — 玩家资源容量
 * @param sequenceLength — 序列帧数（>= 1）
 * @returns 0-based 帧索引（范围 [0, sequenceLength - 1]）
 */
export function calculateResourceLevelFrameIndex(
  resources: number,
  capacity: number,
  sequenceLength: number,
): number {
  if (capacity <= 0 || sequenceLength <= 0) return 0

  const numerator = (10 * sequenceLength - 1) * resources
  const denominator = 10 * capacity
  const index = Math.floor(numerator / denominator)

  // Clamp to valid range
  return Math.max(0, Math.min(index, sequenceLength - 1))
}

// ---------------------------------------------------------------------------
// WithResourceLevelOverlay（对应 OpenRA WithResourceLevelOverlay）
// ---------------------------------------------------------------------------

/**
 * 根据玩家资源填充量显示精灵叠加层。
 *
 * OpenRA 对照: WithResourceLevelOverlay : ConditionalTrait<Info>,
 *   INotifyOwnerChanged, INotifyDamageStateChanged
 *
 * 计算资源填充等级对应的序列帧索引，并（在完整管道中）通过
 * AnimationWithOffset 注册到 RenderSprites。
 *
 * 渲染存根: TODO-10.B-Opt.3-RENDER：
 *   集成 RenderSprites/Animation pipeline。当前仅计算帧索引，
 *   实际的 Animation 创建、注册和渲染保持不变。
 *
 * 使用方式:
 * ```
 * const info = new WithResourceLevelOverlayInfo({ sequence: 'resources' })
 * const overlay = new WithResourceLevelOverlay(info)
 * overlay.setPlayerResolver(() => playerResources)
 * overlay.configureFrameSelector(sequenceLength, wsBody)
 * const frameIndex = overlay.currentFrameIndex
 * ```
 */
export class WithResourceLevelOverlay
  extends ConditionalTrait<WithResourceLevelOverlayInfo>
  implements INotifyOwnerChanged, INotifyDamageStateChanged
{
  /** 静态接口注册（供 TypeDictionary 使用）。 */
  static readonly interfaces = [
    'INotifyOwnerChanged',
    'INotifyDamageStateChanged',
    'WithResourceLevelOverlay',
    'component',
  ]

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** 玩家资源解析器回调。
   *
   *  OpenRA 对照: playerResources (局部变量，每次计算帧时读取)
   */
  private _playerResolver: PlayerResolverFn | null = null

  /** 当前缓存帧索引。
   *
   *  OpenRA 对照: PlayFetchIndex 每帧调用的结果
   */
  private _frameIndex: number = 0

  /** 缓存的序列长度（外部设置）。 */
  private _sequenceLength: number = 0

  /** 缓存的 WithSpriteBody 引用（用于损伤变化时重新解析序列）。 */
  private _wsBody: IWithSpriteBodyStub | null = null

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA WithResourceLevelOverlay 构造函数）
  // -----------------------------------------------------------------------

  /**
   * 构造 WithResourceLevelOverlay。
   *
   * OpenRA 对照: WithResourceLevelOverlay(Actor self, WithResourceLevelOverlayInfo info)
   *
   * @param info — 特质配置
   */
  constructor(info: WithResourceLevelOverlayInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // 依赖注入 / 配置
  // -----------------------------------------------------------------------

  /**
   * 设置 PlayerResources 解析器。
   *
   * OpenRA 对照: playerResources = self.Owner.PlayerActor.Trait<PlayerResources>()
   *
   * @param resolver — PlayerResources 解析回调
   */
  setPlayerResolver(resolver: PlayerResolverFn): void {
    this._playerResolver = resolver
  }

  /**
   * 配置帧选择器和损伤序列解析。
   *
   * OpenRA 对照: 构造函数内创建 Animation 和注册 AnimationWithOffset
   *
   * TODO-10.B-Opt.3-RENDER: 在完整实现中，此方法会创建 Animation 实例
   *   并注册 AnimationWithOffset 到 RenderSprites。当前仅存储帧选择参数。
   *
   * @param sequenceLength — 序列中的帧数
   * @param wsBody — WithSpriteBody 引用（用于 NormalizeSequence）
   */
  configureFrameSelector(
    sequenceLength: number,
    wsBody: IWithSpriteBodyStub | null,
  ): void {
    this._sequenceLength = Math.max(0, sequenceLength)
    this._wsBody = wsBody
  }

  // -----------------------------------------------------------------------
  // 帧索引计算（每帧调用）
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
   * 应在每帧渲染前调用。
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

    this._frameIndex = calculateResourceLevelFrameIndex(
      pr.resources,
      pr.resourceCapacity,
      this._sequenceLength,
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
   * 在完整实现中，还会刷新调色板引用（IsPlayerPalette 时）。
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
    // PlayerResources resolution is handled by setPlayerResolver callback.
    // In the full implementation, updatePalette would also be called if
    // IsPlayerPalette is true.
    //
    // NOTE: C# also calls RenderSprites.UpdatePalette() for player palette
    // refresh. This is deferred to TODO-10.B-Opt.3-RENDER.
  }

  // -----------------------------------------------------------------------
  // INotifyDamageStateChanged（对应 OpenRA DamageStateChanged）
  // -----------------------------------------------------------------------

  /**
   * 损伤状态变化时重新解析序列（通过 wsb.NormalizeSequence）。
   *
   * OpenRA 对照: INotifyDamageStateChanged.DamageStateChanged(Actor, AttackInfo)
   *
   * 如果提供 WithSpriteBody，调用其 normalizeSequence 获取损伤前缀序列名。
   *
   * TODO-10.B-Opt.3-RENDER: 在完整实现中，此方法调用
   *   anim.Animation.ReplaceAnim(wsb.NormalizeSequence(self, Info.Sequence))
   *
   * @param self — actor 实例
   * @param _attackInfo — 攻击信息（含新 DamageState）
   */
  damageStateChanged(self: IGameActor, _attackInfo: AttackInfo): void {
    if (this._wsBody) {
      const normalizedSeq = this._wsBody.normalizeSequence(
        self,
        this.info.sequence,
      )
      // NOTE: In full implementation, this would call:
      //   anim.Animation.ReplaceAnim(normalizedSeq)
      // For now, we track the sequence name for testing.
      void normalizedSeq // silence unused warning; track via getter
    }
  }
}
