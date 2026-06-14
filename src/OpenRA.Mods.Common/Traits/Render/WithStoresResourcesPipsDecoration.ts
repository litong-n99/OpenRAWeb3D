/**
 * WithStoresResourcesPipsDecoration.ts — 按资源类型分区显示存储 pip
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/WithStoresResourcesPipsDecoration.cs (101 lines)
 *
 * 核心范式转换:
 * - C# WithDecorationBase<Info>, Requires<IStoresResourcesInfo>
 *   → TS ConditionalTrait<Info>, uses IStoresResources from TraitsInterfaces
 * - C# FrozenDictionary<string, string> ResourceSequences
 *   → TS Readonly<Record<string, string>>
 * - C# RenderDecoration() yield return → TS generateResourcePips() 纯逻辑 + render stub
 * - 渲染存根: TODO-10.B-Opt.6-RENDER — 通过 SpriteManager/ThinInstances 集成
 *
 * 每个 pip 属于存储中的某个资源类型，或为空。
 * 资源类型按 contents 迭代顺序分配 pip 位置。
 * 每种资源类型可使用自定义序列（ResourceSequences），未指定则使用 FullSequence。
 *
 * Pip 分配算法（对应 OpenRA GetPipSequence）:
 *   对于 pip i:
 *     threshold = i * totalCapacity / pipCount
 *     // 遍历 contents，找到覆盖 threshold 的资源类型
 *     for each (resourceType, amount) in contents:
 *       if threshold < amount: return resourceType's sequence
 *       threshold -= amount
 *     return emptySequence (阈值超出总存储量)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IStoresResources,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PipStride, PipData } from './WithResourceStoragePipsDecoration.js'
import { PIP_STRIDE_ZERO } from './WithResourceStoragePipsDecoration.js'

// ---------------------------------------------------------------------------
// WithStoresResourcesPipsDecorationInfo
// ---------------------------------------------------------------------------

/**
 * WithStoresResourcesPipsDecoration 特质配置。
 *
 * OpenRA 对照: WithStoresResourcesPipsDecorationInfo : WithDecorationBaseInfo,
 *   Requires<IStoresResourcesInfo>
 */
export class WithStoresResourcesPipsDecorationInfo implements ConditionalTraitInfo {
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

  /** 默认实心 pip 的序列名称（ResourceSequences 中未指定时使用）。
   *
   *  OpenRA 对照: FullSequence (default "pip-green")
   */
  readonly fullSequence: string

  /** 每种资源类型的 pip 序列名称覆盖。
   *
   *  OpenRA 对照: ResourceSequences (FrozenDictionary<string, string>)
   *
   *  键: 资源类型名称（如 "Tiberium"、"Ore"）
   *  值: 该资源类型的 pip 序列名称（如 "pip-blue"、"pip-yellow"）
   */
  readonly resourceSequences: Readonly<Record<string, string>>

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
    resourceSequences?: Readonly<Record<string, string>>
    palette?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.pipCount = params.pipCount ?? 0
    this.pipStride = params.pipStride ?? PIP_STRIDE_ZERO
    this.image = params.image ?? 'pips'
    this.emptySequence = params.emptySequence ?? 'pip-empty'
    this.fullSequence = params.fullSequence ?? 'pip-green'
    this.resourceSequences = params.resourceSequences ?? {}
    this.palette = params.palette ?? 'chrome'
  }
}

// ---------------------------------------------------------------------------
// Resource pip 数据 — 扩展 PipData 包含资源类型信息
// ---------------------------------------------------------------------------

/**
 * 描述单个资源 pip 的填充状态、序列名和资源类型。
 *
 * OpenRA 对照: GetPipSequence(int i) 的返回值 + 上下文
 */
export interface ResourcePipData extends PipData {
  /** 此 pip 对应的资源类型（null 表示空 pip）。 */
  readonly resourceType: string | null
}

// ---------------------------------------------------------------------------
// Pip 计算 — 静态纯函数（可独立测试）
// ---------------------------------------------------------------------------

/**
 * 根据存储内容计算 pip 的序列名称。
 *
 * OpenRA 对照: WithStoresResourcesPipsDecoration.GetPipSequence(int i)
 *
 * 算法:
 *   threshold = pipIndex * totalCapacity / pipCount
 *   for each (resourceType, amount) in contents entries:
 *     if threshold < amount: return resourceType's sequence (or fullSequence as fallback)
 *     threshold -= amount
 *   return emptySequence
 *
 * @param pipIndex — pip 索引 (0-based)
 * @param totalCapacity — 总存储容量（contents 中各数量的总和）
 * @param pipCount — pip 总数
 * @param contents — 资源类型 → 存储量的映射（有序，决定分配顺序）
 * @param resourceSequences — 每种资源类型的自定义序列映射
 * @param fullSequence — 默认实心 pip 序列名
 * @param emptySequence — 空心 pip 序列名
 * @returns 此 pip 应显示的序列名称
 */
export function getPipSequence(
  pipIndex: number,
  totalCapacity: number,
  pipCount: number,
  contents: ReadonlyMap<string, number>,
  resourceSequences: Readonly<Record<string, string>>,
  fullSequence: string,
  emptySequence: string,
): string {
  if (pipCount <= 0 || totalCapacity <= 0) return emptySequence

  let threshold = Math.floor(pipIndex * totalCapacity / pipCount)

  for (const [resourceType, amount] of contents) {
    if (threshold < amount) {
      const seq = resourceSequences[resourceType]
      return seq !== undefined ? seq : fullSequence
    }
    threshold -= amount
  }

  return emptySequence
}

/**
 * 是否任何资源类型匹配的阈值检查（对 getPipSequence 的布尔值调用）。
 *
 * OpenRA 对照: threshold < rt.Value 检查
 *
 * @param pipIndex — pip 索引 (0-based)
 * @param totalCapacity — 总存储容量
 * @param pipCount — pip 总数
 * @param contents — 资源类型 → 存储量的映射
 * @returns true 如果此 pip 应该填充（有匹配的资源类型）
 */
export function isPipFilled(
  pipIndex: number,
  totalCapacity: number,
  pipCount: number,
  contents: ReadonlyMap<string, number>,
): boolean {
  if (pipCount <= 0 || totalCapacity <= 0) return false

  let threshold = Math.floor(pipIndex * totalCapacity / pipCount)

  for (const [, amount] of contents) {
    if (threshold < amount) return true
    threshold -= amount
  }

  return false
}

/**
 * 为所有 pip 生成资源 pip 状态数据列表。
 *
 * OpenRA 对照: RenderDecoration() 中的 for 循环 + GetPipSequence(i)
 *
 * @param pipCount — pip 总数
 * @param capacity — 总存储容量
 * @param contents — 资源类型 → 存储量的映射
 * @param resourceSequences — 每种资源类型的自定义序列映射
 * @param fullSequence — 默认实心 pip 序列名
 * @param emptySequence — 空心 pip 序列名
 * @returns ResourcePipData 数组（长度 == pipCount）
 */
export function generateResourcePipsData(
  pipCount: number,
  capacity: number,
  contents: ReadonlyMap<string, number>,
  resourceSequences: Readonly<Record<string, string>>,
  fullSequence: string,
  emptySequence: string,
): readonly ResourcePipData[] {
  // Compute total stored amount
  let totalStored = 0
  for (const amount of contents.values()) {
    totalStored += amount
  }
  // totalCapacity = capacity (max capacity), but the pips are relative to
  // capacity per OpenRA's formula: n = i * storesResources.Capacity / PipCount
  const totalCapacity = capacity

  const result: ResourcePipData[] = []

  for (let i = 0; i < pipCount; i++) {
    const filled = isPipFilled(i, totalCapacity, pipCount, contents)
    const sequence = getPipSequence(
      i,
      totalCapacity,
      pipCount,
      contents,
      resourceSequences,
      fullSequence,
      emptySequence,
    )
    const resourceType = filled ? getResourceTypeForPip(i, totalCapacity, pipCount, contents) : null

    result.push({
      index: i,
      isFilled: filled,
      sequence,
      resourceType,
    })
  }

  return result
}

/**
 * 获取 pip 索引对应的资源类型。
 *
 * OpenRA 对照: GetPipSequence 内部的资源类型匹配
 *
 * @param pipIndex — pip 索引 (0-based)
 * @param totalCapacity — 总存储容量
 * @param pipCount — pip 总数
 * @param contents — 资源类型 → 存储量的映射
 * @returns 资源类型名称，或 null（空 pip）
 */
function getResourceTypeForPip(
  pipIndex: number,
  totalCapacity: number,
  pipCount: number,
  contents: ReadonlyMap<string, number>,
): string | null {
  if (pipCount <= 0 || totalCapacity <= 0) return null

  let threshold = Math.floor(pipIndex * totalCapacity / pipCount)

  for (const [resourceType, amount] of contents) {
    if (threshold < amount) return resourceType
    threshold -= amount
  }

  return null
}

// ---------------------------------------------------------------------------
// WithStoresResourcesPipsDecoration（对应 OpenRA WithStoresResourcesPipsDecoration）
// ---------------------------------------------------------------------------

/**
 * 按资源类型分区显示存储 pip。
 *
 * OpenRA 对照: WithStoresResourcesPipsDecoration : WithDecorationBase<Info>
 *
 * 显示一行水平排列的 pip，每种资源类型按存储量比例占据连续的 pip 段。
 * 每种资源类型可以使用唯一的 pip 颜色（通过 ResourceSequences 配置）。
 *
 * 渲染存根: TODO-10.B-Opt.6-RENDER：
 *   集成到 render pipeline，在每个 pip 的屏幕位置创建带序列的 Sprite 实例。
 *   使用 Babylon.js SpriteManager 或 ThinInstances 渲染。
 *
 * 使用方式:
 * ```
 * const info = new WithStoresResourcesPipsDecorationInfo({
 *   pipCount: 10,
 *   resourceSequences: { Tiberium: 'pip-green', Gems: 'pip-blue' },
 * })
 * const deco = new WithStoresResourcesPipsDecoration(info)
 * deco.setStoresResources(storesResourcesTrait)
 * const pips = deco.pipData
 * ```
 */
export class WithStoresResourcesPipsDecoration
  extends ConditionalTrait<WithStoresResourcesPipsDecorationInfo>
{
  /** 静态接口注册（供 TypeDictionary 使用）。 */
  static readonly interfaces = [
    'WithStoresResourcesPipsDecoration',
    'component',
  ]

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** 存储资源特质引用。
   *
   *  OpenRA 对照: storesResources = self.TraitsImplementing<IStoresResources>().First()
   */
  private _storesResources: IStoresResources | null = null

  /** 最新计算的 pip 数据（缓存）。 */
  private _pipData: readonly ResourcePipData[] = []

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  /**
   * 构造 WithStoresResourcesPipsDecoration。
   *
   * OpenRA 对照: WithStoresResourcesPipsDecoration(Actor, Info)
   *
   * @param info — 特质配置
   */
  constructor(info: WithStoresResourcesPipsDecorationInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // 依赖注入
  // -----------------------------------------------------------------------

  /**
   * 设置 IStoresResources 特质引用。
   *
   * OpenRA 对照: storesResources = self.TraitsImplementing<IStoresResources>().First()
   *
   * @param storesResources — 存储资源特质
   */
  setStoresResources(storesResources: IStoresResources): void {
    this._storesResources = storesResources
  }

  // -----------------------------------------------------------------------
  // Pip 数据访问
  // -----------------------------------------------------------------------

  /**
   * 获取当前 pip 状态数据。
   *
   * OpenRA 对照: RenderDecoration() 的循环结果
   *
   * @returns 每个 pip 的 ResourcePipData 数组
   */
  get pipData(): readonly ResourcePipData[] {
    return this._pipData
  }

  /**
   * 根据当前存储状态更新 pip 数据。
   *
   * OpenRA 对照: RenderDecoration() 中每帧的序列选择
   *
   * 应在存储内容变化时或每帧渲染前调用。
   */
  updatePipData(): void {
    if (!this._storesResources) {
      this._pipData = []
      return
    }

    this._pipData = generateResourcePipsData(
      this.info.pipCount,
      this._storesResources.capacity,
      this._storesResources.contents,
      this.info.resourceSequences,
      this.info.fullSequence,
      this.info.emptySequence,
    )
  }

  /**
   * 获取已填充 pip 的数量。
   *
   * OpenRA 对照: 等效于计算有多少 pip 的 threshold 小于累积存储量
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
}
