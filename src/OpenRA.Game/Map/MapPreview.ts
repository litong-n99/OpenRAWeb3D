/**
 * MapPreview.ts — 地图预览存根（MapCache 所需的最小子集）
 * OpenRA 对照: OpenRA.Game/Map/MapPreview.cs
 *
 * 核心范式转换:
 * - C# MapPreview 完整类（781 行）→ 仅包含 MapCache/MapDirectoryTracker
 *   引用的字段和方法的存根
 * - C# MapStatus 枚举 → TypeScript const 对象
 * - C# MapClassification [Flags] 枚举 → TypeScript const 对象
 *
 * NOTE: 这是 TODO-4.E.2 的存根。完整的 MapPreview 实现（781 行 C#）
 * 将在 Phase F 或 Chapter 5 中提供。
 */

import type { IReadOnlyPackage } from '../FileSystem/IReadOnlyPackage.js'
import type { MapGridType } from './MapGridType.js'
import { MapPlayers } from './MapPlayers.js'
import type { Rectangle } from '../Primitives/Rectangle.js'

// ---------------------------------------------------------------------------
// MapStatus
// ---------------------------------------------------------------------------

/**
 * 地图预览状态。
 *
 * OpenRA 对照: MapStatus 枚举（MapPreview.cs 第 31 行内联定义）
 */
export const MapStatus = {
  /** 地图不可用（未找到或加载失败）。 */
  Unavailable: 0,
  /** 正在搜索远程地图详情。 */
  Searching: 1,
  /** 地图可用且已加载。 */
  Available: 2,
} as const

export type MapStatus = (typeof MapStatus)[keyof typeof MapStatus]

// ---------------------------------------------------------------------------
// MapClassification
// ---------------------------------------------------------------------------

/**
 * 地图分类标志。
 *
 * OpenRA 对照: MapClassification [Flags] 枚举
 *
 * 指示地图的来源和用途。
 */
export const MapClassification = {
  /** 未知来源。 */
  Unknown: 0,
  /** 系统地图（与 mod 一起提供）。 */
  System: 1,
  /** 用户地图（由玩家创建）。 */
  User: 2,
  /** 数据库地图（从资源中心下载）。 */
  Database: 4,
} as const

export type MapClassification = (typeof MapClassification)[keyof typeof MapClassification]

/** MapClassification 扩展辅助函数。 */
export const MapClassificationExts = {
  /** 检查分类值是否包含特定标志。 */
  hasFlag(classification: MapClassification, flag: MapClassification): boolean {
    return (classification & flag) === flag
  },
} as const

// ---------------------------------------------------------------------------
// Forward reference for MapCache (avoids circular import)
// ---------------------------------------------------------------------------

/** MapCache 的前向引用类型（避免循环导入）。 */
export type MapCacheRef = {
  loadMap(map: string, package_: IReadOnlyPackage, classification: MapClassification, oldMap: string | null): void
}

// ---------------------------------------------------------------------------
// MapPreview stub
// ---------------------------------------------------------------------------

/**
 * 地图预览（最小存根）。
 *
 * OpenRA 对照: MapPreview 类（MapPreview.cs，781 行）
 *
 * 此存根仅包含 MapCache 和 MapDirectoryTracker 实际引用的字段和方法。
 * 完整实现将在 Phase F 或 Chapter 5 中提供。
 *
 * TODO-4.E.2: 替换为完整的 MapPreview 实现。
 */
export class MapPreview {
  /** 地图唯一标识符。 */
  uid: string

  /** 地图文件系统路径。 */
  path: string

  /** 当前加载状态。 */
  status: MapStatus

  /** 地图可见性标志。 */
  visibility: number

  /** 地图分类。 */
  class: MapClassification

  /** 玩家配置（解析自地图 YAML）。 */
  players: MapPlayers

  /** 地图边界（以单元格为单位）。 */
  bounds: Rectangle

  /** 地图类别标签（如 "Conquest"）。 */
  categories: string[]

  /** 预览图像数据（用于小地图生成）。 */
  preview: Uint8Array | null

  /** 此预览关联的地图缓存（保留供将来使用）。 */
  // NOTE: _cache 目前未使用，但完整实现需要它。参见 TODO-4.E.2。
  // @ts-expect-error — 保留字段供 TODO-4.E.2 完整实现使用
  private readonly _cache: MapCacheRef | null

  /**
   * 构造 MapPreview 存根。
   *
   * OpenRA 对照: MapPreview(ModData, string, MapGridType, MapCache)
   */
  constructor(
    _modData: unknown,
    uid: string,
    _gridType: MapGridType,
    cache: MapCacheRef | null,
  ) {
    this.uid = uid
    this.path = ''
    this.status = MapStatus.Unavailable
    this.visibility = 0
    this.class = MapClassification.Unknown
    this.players = new MapPlayers()
    this.bounds = { X: 0, Y: 0, Width: 0, Height: 0 } as Rectangle
    this.categories = []
    this.preview = null
    this._cache = cache
  }

  /**
   * 使此地图预览失效（标记为需要重新加载）。
   *
   * OpenRA 对照: MapPreview.Invalidate()
   */
  invalidate(): void {
    this.status = MapStatus.Unavailable
  }

  /**
   * 从地图包更新此预览（不拥有该包）。
   *
   * OpenRA 对照: MapPreview.UpdateFromMapWithoutOwningPackage()
   *
   * @param _mapPackage — 地图包
   * @param _parentPackage — 父包
   * @param classification — 地图分类
   * @param _gridType — 网格类型
   * @param _modDataRules — 模组数据规则
   */
  updateFromMapWithoutOwningPackage(
    _mapPackage: IReadOnlyPackage,
    _parentPackage: IReadOnlyPackage,
    classification: MapClassification,
    _gridType?: MapGridType | null,
    _modDataRules?: unknown,
  ): void {
    this.class = classification
    this.status = MapStatus.Available
  }

  /**
   * 开始远程搜索此地图。
   *
   * OpenRA 对照: MapPreview.BeginRemoteSearch()
   */
  beginRemoteSearch(): void {
    this.status = MapStatus.Searching
  }

  /**
   * 完成远程搜索，应用获取的数据。
   *
   * OpenRA 对照: MapPreview.CompleteRemoteSearch()
   *
   * @param data — 远程数据（JSON 适配的 MiniYaml）
   * @param callback — 成功时调用的回调
   */
  completeRemoteSearch(
    data: unknown,
    callback?: ((preview: MapPreview) => void) | null,
  ): void {
    if (data) {
      this.status = MapStatus.Available
      callback?.(this)
    } else {
      this.status = MapStatus.Unavailable
    }
  }

  /**
   * 获取小地图精灵。
   *
   * OpenRA 对照: MapPreview.GetMinimap()
   *
   * @returns 如果已缓存则返回小地图数据，否则返回 null
   */
  getMinimap(): unknown | null {
    return null
  }

  /**
   * 设置小地图精灵。
   *
   * OpenRA 对照: MapPreview.SetMinimap()
   *
   * @param _minimap — 小地图精灵数据
   */
  setMinimap(_minimap: unknown): void {
    // Stub: no-op
  }

  /**
   * 释放此预览持有的资源。
   *
   * OpenRA 对照: MapPreview.Dispose()
   */
  dispose(): void {
    // Stub: no-op
  }
}
