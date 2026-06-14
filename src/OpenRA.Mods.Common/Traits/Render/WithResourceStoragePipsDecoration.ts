/**
 * WithResourceStoragePipsDecoration.ts — 在 actor 上以 pip 行显示资源存储填充状态
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithResourceStoragePipsDecoration.cs (79 lines)
 *
 * 核心范式转换:
 * - C# WithDecorationBase<Info>, INotifyOwnerChanged
 *   → TS ConditionalTrait<Info> implements INotifyOwnerChanged
 *   （WithDecorationBase 尚未迁移，直接继承 ConditionalTrait）
 * - C# RenderDecoration() yield return IRenderable
 *   → TS calculateFilledPips() 纯逻辑 + render stub
 * - C# Animation + UISpriteRenderable → TS 存根（无需 WebGL）
 * - 渲染存根: TODO-10.B-Opt.5-RENDER — 通过 SpriteManager/ThinInstances 集成
 *
 * Pip 填充公式（对应 OpenRA RenderDecoration 循环）:
 *   player.Resources * Info.PipCount > i * player.ResourceCapacity
 *   等效于: filledPips = floor(resources * PipCount / capacity)
 *
 * Pips 水平排列，步幅由 PipStride 或 pip 精灵宽度决定。
 * 空心 pip 使用 EmptySequence，实心 pip 使用 FullSequence。
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
// PipStride — 二维 pip 间距
// ---------------------------------------------------------------------------

/** 二维 pip 步幅（对应 OpenRA int2 PipStride）。
 *
 *  OpenRA 对照: OpenRA.int2 (2D integer vector)
 */
export interface PipStride {
  readonly x: number
  readonly y: number
}

/** 零向量常量。 */
export const PIP_STRIDE_ZERO: PipStride = { x: 0, y: 0 }

// ---------------------------------------------------------------------------
// WithResourceStoragePipsDecorationInfo
// ---------------------------------------------------------------------------

/**
 * WithResourceStoragePipsDecoration 特质配置。
 *
 * OpenRA 对照: WithResourceStoragePipsDecorationInfo : WithDecorationBaseInfo
 */
export class WithResourceStoragePipsDecorationInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** 要显示的 pip 数量。
   *
   *  OpenRA 对照: PipCount (default 0, FieldLoader.Require)
   */
  readonly pipCount: number

  /** pip 之间的间距（非零时覆盖默认 pip 宽度步幅）。
   *
   *  OpenRA 对照: PipStride (default int2.Zero)
   */
  readonly pipStride: PipStride

  /** pip 序列图像名称。
   *
   *  OpenRA 对照: Image (default "pips")
   */
  readonly image: string

  /** 空心 pip 的序列名称。
   *
   *  OpenRA 对照: EmptySequence (default "pip-empty")
   */
  readonly emptySequence: string

  /** 实心 pip 的序列名称。
   *
   *  OpenRA 对照: FullSequence (default "pip-green")
   */
  readonly fullSequence: string

  /** 调色板名称。
   *
   *  OpenRA 对照: Palette (default "chrome")
   */
  readonly palette: string

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    pipCount?: number
    pipStride?: PipStride
    image?: string
    emptySequence?: string
    fullSequence?: string
    palette?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.pipCount = params.pipCount ?? 0
    this.pipStride = params.pipStride ?? PIP_STRIDE_ZERO
    this.image = params.image ?? 'pips'
    this.emptySequence = params.emptySequence ?? 'pip-empty'
    this.fullSequence = params.fullSequence ?? 'pip-green'
    this.palette = params.palette ?? 'chrome'
  }
}

// ---------------------------------------------------------------------------
// Pip 数据 — 单个 pip 的逻辑描述（用于测试和渲染）
// ---------------------------------------------------------------------------

/**
 * 描述单个 pip 的填充状态和序列名。
 *
 * OpenRA 对照: RenderDecoration 中每个 pip 的序列选择结果
 */
export interface PipData {
  /** pip 索引（0-based，从左到右）。 */
  readonly index: number
  /** pip 是否已填充。 */
  readonly isFilled: boolean
  /** 用于渲染此 pip 的序列名称。 */
  readonly sequence: string
}

// ---------------------------------------------------------------------------
// Pip 计算 — 静态纯函数（可独立测试）
// ---------------------------------------------------------------------------

/**
 * 计算已填充 pip 的数量。
 *
 * OpenRA 对照: RenderDecoration 中的 for 循环条件:
 *   player.Resources * Info.PipCount > i * player.ResourceCapacity
 *   逐个 pip 判断: 当 resources * pipCount > i * capacity 时，pip i 为填充状态。
 *
 * @param resources — 玩家当前资源数量
 * @param capacity — 玩家资源容量
 * @param pipCount — pip 总数
 * @returns 已填充 pip 数量（0 到 pipCount）
 */
export function calculateFilledPips(
  resources: number,
  capacity: number,
  pipCount: number,
): number {
  if (capacity <= 0 || pipCount <= 0) return 0

  let filled = 0
  for (let i = 0; i < pipCount; i++) {
    if (resources * pipCount > i * capacity) filled++
  }
  return filled
}

/**
 * 为所有 pip 生成 pip 状态数据列表。
 *
 * OpenRA 对照: RenderDecoration 中 for 循环内每个 pip 的序列选择
 *
 * @param resources — 玩家当前资源数量
 * @param capacity — 玩家资源容量
 * @param pipCount — pip 总数
 * @param fullSequence — 实心 pip 序列名
 * @param emptySequence — 空心 pip 序列名
 * @returns PipData 数组（长度 == pipCount）
 */
export function generatePipData(
  resources: number,
  capacity: number,
  pipCount: number,
  fullSequence: string,
  emptySequence: string,
): readonly PipData[] {
  const filled = calculateFilledPips(resources, capacity, pipCount)
  const result: PipData[] = []

  for (let i = 0; i < pipCount; i++) {
    const isFilled = i < filled
    result.push({
      index: i,
      isFilled,
      sequence: isFilled ? fullSequence : emptySequence,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// WithResourceStoragePipsDecoration（对应 OpenRA WithResourceStoragePipsDecoration）
// ---------------------------------------------------------------------------

/**
 * 在 actor 上以 pip 行显示资源存储填充状态。
 *
 * OpenRA 对照: WithResourceStoragePipsDecoration : WithDecorationBase<Info>,
 *   INotifyOwnerChanged
 *
 * 显示一行水平排列的 pip，每个 pip 可以是空或满。
 * 如 PlayerResources 不可用（null），所有 pip 显示为空。
 *
 * 渲染存根: TODO-10.B-Opt.5-RENDER：
 *   集成到 render pipeline，在每个 pip 的屏幕位置创建 Sprite 实例。
 *   方向: 使用 Babylon.js SpriteManager 或 ThinInstances 渲染 pip。
 *
 * 使用方式:
 * ```
 * const info = new WithResourceStoragePipsDecorationInfo({ pipCount: 5 })
 * const deco = new WithResourceStoragePipsDecoration(info)
 * deco.setPlayerResolver(() => playerResources)
 * const pips = deco.getPipData()
 * ```
 */
export class WithResourceStoragePipsDecoration
  extends ConditionalTrait<WithResourceStoragePipsDecorationInfo>
  implements INotifyOwnerChanged
{
  /** 静态接口注册（供 TypeDictionary 使用）。 */
  static readonly interfaces = [
    'INotifyOwnerChanged',
    'WithResourceStoragePipsDecoration',
    'component',
  ]

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** 玩家资源解析器回调。
   *
   *  OpenRA 对照: player = self.Owner.PlayerActor.Trait<PlayerResources>()
   */
  private _playerResolver: (() => IPlayerResourcesStub | null) | null = null

  /** 最新计算的 pip 数据（缓存）。 */
  private _pipData: readonly PipData[] = []

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  /**
   * 构造 WithResourceStoragePipsDecoration。
   *
   * OpenRA 对照: WithResourceStoragePipsDecoration(Actor, Info)
   *
   * @param info — 特质配置
   */
  constructor(info: WithResourceStoragePipsDecorationInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // 依赖注入
  // -----------------------------------------------------------------------

  /**
   * 设置 PlayerResources 解析器。
   *
   * OpenRA 对照: player = self.Owner.PlayerActor.Trait<PlayerResources>()
   *
   * @param resolver — PlayerResources 解析回调
   */
  setPlayerResolver(resolver: () => IPlayerResourcesStub | null): void {
    this._playerResolver = resolver
  }

  // -----------------------------------------------------------------------
  // Pip 数据访问
  // -----------------------------------------------------------------------

  /**
   * 获取当前 pip 状态数据。
   *
   * OpenRA 对照: RenderDecoration() 的循环结果
   *
   * @returns 每个 pip 的 PipData 数组
   */
  get pipData(): readonly PipData[] {
    return this._pipData
  }

  /**
   * 根据当前 PlayerResources 状态更新 pip 数据。
   *
   * OpenRA 对照: RenderDecoration() 中每帧的序列选择
   *
   * 应在资源变化时或每帧渲染前调用。
   */
  updatePipData(): void {
    let resources = 0
    let capacity = 0

    if (this._playerResolver) {
      const pr = this._playerResolver()
      if (pr) {
        resources = pr.resources
        capacity = pr.resourceCapacity
      }
    }

    this._pipData = generatePipData(
      resources,
      capacity,
      this.info.pipCount,
      this.info.fullSequence,
      this.info.emptySequence,
    )
  }

  /**
   * 获取已填充 pip 的数量。
   *
   * OpenRA 对照: RenderDecoration 中满足 resources * PipCount > i * capacity 的 pip 数量
   *
   * @returns 已填充 pip 的数量
   */
  get filledPipCount(): number {
    let count = 0
    for (const p of this._pipData) {
      if (p.isFilled) count++
    }
    return count
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
    // In full implementation, this would re-resolve from the new owner's
    // PlayerActor.
  }
}
