/**
 * MapPreview.ts -- lightweight map metadata preview and caching
 * OpenRA 对照: OpenRA.Game/Map/MapPreview.cs (781 lines)
 *
 * 核心范式转换:
 * - C# volatile InnerData + lock(syncRoot) 原子更新 → 直接属性赋值
 *   (JavaScript 单线程，无需线程同步)
 * - C# Png + Sprite 小地图缓存 → Uint8Array raw pixel data + 占位符 Sprite
 * - C# MiniYaml 运行时解析 → JSON 适配的 MapMetadata 对象
 * - C# Stream GetStream("map.yaml") → IReadOnlyPackage.open() (异步)
 * - C# File.GetLastWriteTime → Date.now() (浏览器无原生文件系统)
 * - C# HttpClient → fetch() API
 * - C# IReadOnlyFileSystem 显式实现 → MapPreview 上可选存根方法
 * - C# MapVisibility / MapClassification / MapStatus 枚举 → TypeScript
 *   const 对象 (值匹配 1:1)
 */

import type { IReadOnlyPackage, IPackage } from '../FileSystem/IReadOnlyPackage.js'
import type { MapGridType } from './MapGridType.js'
import { MapPlayers } from './MapPlayers.js'
import type { MapGenerationArgs } from './MapGenerationArgs.js'
import { MapVisibility } from './Map.js'
import { parsePngDimensions } from '../Utils/PngHeader.js'

// ---------------------------------------------------------------------------
// Bounds type (avoids importing Rectangle as a value for plain data)
// ---------------------------------------------------------------------------

/** 简单的轴对齐整数矩形（匹配 Rectangle 的形状，但为普通对象）。 */
export interface MapBounds {
  X: number
  Y: number
  Width: number
  Height: number
}

// ---------------------------------------------------------------------------
// MapStatus
// ---------------------------------------------------------------------------

/**
 * 地图预览状态。
 *
 * OpenRA 对照: MapStatus enum (MapPreview.cs line 31)
 */
export const MapStatus = {
  /** 地图可用且已加载。 */
  Available: 0,
  /** 地图不可用（未找到或加载失败）。 */
  Unavailable: 1,
  /** 正在搜索远程地图详情。 */
  Searching: 2,
  /** 远程地图可以下载。 */
  DownloadAvailable: 3,
  /** 正在从资源中心下载地图。 */
  Downloading: 4,
  /** 地图下载失败。 */
  DownloadError: 5,
  /** 地图可以被程序化生成。 */
  Generatable: 6,
  /** 地图正在程序化生成中。 */
  Generating: 7,
} as const

export type MapStatus = (typeof MapStatus)[keyof typeof MapStatus]

// ---------------------------------------------------------------------------
// MapClassification
// ---------------------------------------------------------------------------

/**
 * 地图分类标志。
 *
 * OpenRA 对照: MapClassification [Flags] enum
 *
 * 指示地图的来源和用途。值 1:1 匹配 C#。
 */
export const MapClassification = {
  /** 未知来源。 */
  Unknown: 0,
  /** 系统地图（与 mod 一起提供）。 */
  System: 1,
  /** 用户地图（由玩家创建/下载）。 */
  User: 2,
  /** 远程地图（来自资源中心）。曾用名 Database。 */
  Remote: 4,
  /** 程序化生成的地图。 */
  Generated: 8,
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
// RemoteMapData -- 从地图资源中心 API 返回的数据结构
// ---------------------------------------------------------------------------

/**
 * 远程地图数据，字段名映射到远程 API 响应。
 *
 * OpenRA 对照: RemoteMapData class (MapPreview.cs line 50)
 *
 * 字段名故意使用 snake_case 以匹配远程 API JSON 响应。
 * TypeScript 属性的命名约定被放宽以保持 API 保真度。
 */
export interface RemoteMapData {
  readonly title: string
  readonly author: string
  readonly categories: string[]
  readonly players: number
  readonly bounds: MapBounds
  readonly spawnpoints: number[]
  readonly map_grid_type: MapGridType
  /** Base64 编码的 PNG 小地图图像。 */
  readonly minimap: string
  readonly downloading: boolean
  readonly tileset: string
  /** Base64 编码的规则 MiniYaml。 */
  readonly rules: string
  /** Base64 编码的玩家块 MiniYaml。 */
  readonly players_block: string
  readonly mapformat: number
  readonly game_mod: string
}

// ---------------------------------------------------------------------------
// MapMetadata -- map.yaml 解析后的结构化数据
// ---------------------------------------------------------------------------

/**
 * 从 map.yaml 解析出的地图元数据。
 *
 * OpenRA 对照: InnerData 字段子集 (MapPreview.cs line 73)
 *
 * 调用方异步读取并解析 map.yaml，然后通过 {@link MapPreview.updateFromMetadata}
 * 应用结果。这避免了在同步代码路径中进行异步文件 I/O。
 */
export interface MapMetadata {
  /** 地图格式版本（MapFormat 键）。 */
  mapFormat?: number
  /** 地图标题（Title 键）。 */
  title?: string
  /** 地图类别（Categories 键）。 */
  categories?: string[]
  /** 地图作者（Author 键）。 */
  author?: string
  /** 地形集 ID（Tileset 键）。 */
  tileset?: string
  /** 所需 mod 标识符（RequiresMod 键）。 */
  requiresMod?: string
  /** 地图边界（Bounds 键），接受普通对象（YAML/JSON 解析样式）。 */
  bounds?: { X: number; Y: number; Width: number; Height: number }
  /** 地图可见性（Visibility 键）。 */
  visibility?: number
  /** 是否锁定预览（LockPreview 键）。 */
  lockPreview?: boolean
  /** 出生点位置数组。 */
  spawnPoints?: { X: number; Y: number }[]
  /** 玩家定义节点。 */
  playerDefinitions?: { name: string; properties?: Record<string, unknown> }[]
  /** 原始规则 YAML 节点。 */
  ruleDefinitions?: unknown
  /** 原始武器 YAML 节点。 */
  weaponDefinitions?: unknown
}

// ---------------------------------------------------------------------------
// Forward reference for MapCache (avoids circular import)
// ---------------------------------------------------------------------------

/** MapCache 的前向引用类型（避免循环导入）。 */
export interface MapCacheRef {
  loadMap(map: string, package_: IReadOnlyPackage, classification: MapClassification, oldMap: string | null): void
  /** 请求缓存此预览的小地图精灵。 */
  cacheMinimap?(preview: import('./MapPreview.js').MapPreview): void
}

// ---------------------------------------------------------------------------
// MapPreview
// ---------------------------------------------------------------------------

/**
 * 地图预览 -- 在完整加载之前表示地图元数据的轻量级对象。
 *
 * OpenRA 对照: MapPreview class (MapPreview.cs, 781 lines)
 *
 * 存储解析自 map.yaml 的元数据（标题、作者、玩家数等），管理异步
 * 小地图生成和远程地图数据获取，并支持无效化/更新生命周期。
 *
 * 与 C# 版本的关键区别:
 * - 无 InnerData 嵌套类 -- 属性直接存储在实例上（JS 单线程）
 * - IReadOnlyFileSystem 存根方法提供（非 IReadOnlyFileSystem 显式实现）
 * - 小地图存储为 Uint8Array | null（而非 Png 对象），在设置时触发缓存
 */
export class MapPreview {
  // -------------------------------------------------------------------------
  // Public immutable identity
  // -------------------------------------------------------------------------

  /** 地图唯一标识符（哈希值）。OpenRA 对照: MapPreview.Uid */
  readonly uid: string

  // -------------------------------------------------------------------------
  // Public metadata properties (OpenRA 对照: InnerData 字段)
  // -------------------------------------------------------------------------

  /** 地图文件系统路径。OpenRA 对照: MapPreview.Path */
  path: string

  /** 当前加载状态。OpenRA 对照: MapPreview.Status */
  status: MapStatus

  /** 地图可见性级别。OpenRA 对照: MapPreview.Visibility */
  visibility: number

  /** 地图分类标志。OpenRA 对照: MapPreview.Class */
  class: MapClassification

  /** 地图格式版本。OpenRA 对照: MapPreview.MapFormat */
  mapFormat: number

  /** 地图标题。OpenRA 对照: MapPreview.Title */
  title: string

  /** 地图类别标签（如 "Conquest"）。OpenRA 对照: MapPreview.Categories */
  categories: string[]

  /** 地图作者。OpenRA 对照: MapPreview.Author */
  author: string

  /** 地形集标识符。OpenRA 对照: MapPreview.TileSet */
  tileset: string

  /** 玩家配置。OpenRA 对照: MapPreview.Players */
  players: MapPlayers

  /** 可玩玩家数量。OpenRA 对照: MapPreview.PlayerCount */
  playerCount: number

  /** 出生点位置数组。OpenRA 对照: MapPreview.SpawnPoints */
  spawnPoints: { X: number; Y: number }[]

  /** 网格类型。OpenRA 对照: MapPreview.GridType */
  gridType: MapGridType

  /** 地图边界（以单元格为单位）。OpenRA 对照: MapPreview.Bounds */
  bounds: MapBounds

  /** 上次修改时间（Date）。OpenRA 对照: MapPreview.ModifiedDate */
  modifiedDate: Date

  /** 程序化生成参数（仅 Generated 分类地图）。OpenRA 对照: MapPreview.GenerationArgs */
  generationArgs: MapGenerationArgs | null

  /** 下载总字节数。OpenRA 对照: MapPreview.DownloadBytes */
  downloadBytes: number

  /** 下载进度百分比（0-100）。OpenRA 对照: MapPreview.DownloadPercentage */
  downloadPercentage: number

  // -------------------------------------------------------------------------
  // Minimap
  // -------------------------------------------------------------------------

  /** 小地图 PNG 原始像素数据。OpenRA 对照: InnerData.Preview (Png) */
  preview: Uint8Array | null

  /** 小地图图像尺寸。OpenRA 对照: Png.Width / Png.Height */
  previewSize: { width: number; height: number } | null

  /** 小地图是否正在生成中。OpenRA 对照: MapPreview.generatingMinimap */
  private _generatingMinimap: boolean

  // -------------------------------------------------------------------------
  // Package references
  // -------------------------------------------------------------------------

  /** 拥有的地图包（如果由 UpdateFromMap 设置）。OpenRA 对照: MapPreview.package */
  private _package: IReadOnlyPackage | null

  /** 父包（由 UpdateFromMapWithoutOwningPackage 设置）。OpenRA 对照: MapPreview.parentPackage */
  private _parentPackage: IReadOnlyPackage | null

  // -------------------------------------------------------------------------
  // Private references
  // -------------------------------------------------------------------------

  /** 关联的地图缓存（用于小地图缓存回调等）。 */
  private readonly _cache: MapCacheRef | null

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * 构造 MapPreview。
   *
   * OpenRA 对照: MapPreview(ModData, string, MapGridType, MapCache)
   *
   * 所有字段初始化为合理的默认值。OpenRA 在构造后调用
   * UpdateFromMap() 或 UpdateFromMapWithoutOwningPackage() 来填充。
   *
   * @param _modData -- 模组数据（保留供将来使用）
   * @param uid -- 地图唯一标识符
   * @param gridType -- 地图网格类型
   * @param cache -- 关联的地图缓存（可选）
   */
  constructor(
    _modData: unknown,
    uid: string,
    gridType: MapGridType,
    cache: MapCacheRef | null,
  ) {
    this.uid = uid
    this.path = ''
    this.status = MapStatus.Unavailable
    this.visibility = MapVisibility.Lobby
    this.class = MapClassification.Unknown
    this.mapFormat = 0
    this.title = 'Unknown Map'
    this.categories = ['Unknown']
    this.author = 'Unknown Author'
    this.tileset = 'unknown'
    this.players = new MapPlayers()
    this.playerCount = 0
    this.spawnPoints = []
    this.gridType = gridType
    this.bounds = { X: 0, Y: 0, Width: 0, Height: 0 }
    this.modifiedDate = new Date()
    this.generationArgs = null
    this.downloadBytes = 0
    this.downloadPercentage = 0
    this.preview = null
    this.previewSize = null
    this._generatingMinimap = false
    this._package = null
    this._parentPackage = null
    this._cache = cache
  }

  // NOTE: loadPackage() is omitted from the TypeScript migration -- it is only
  // needed by the IReadOnlyFileSystem explicit interface implementation (stubbed
  // below). Re-add when TODO-4.E.2 (full IReadOnlyFileSystem integration) is
  // implemented.

  // TODO-4.E.2-DEFERRED: The following C# MapPreview methods are deferred:
  //   - Generate(): terrain rendering pipeline integration needed
  //   - Install(): remote map repository integration needed
  //   - ToMap(): full Map binary integration needed
  //   - DefinesUnsafeCustomRules() / LoadRuleset(): Ruleset system needed
  //   - GetMessage() / TryGetMessage(): FluentBundle l10n integration needed

  // -------------------------------------------------------------------------
  // UpdateFromMap / UpdateFromMapWithoutOwningPackage
  // -------------------------------------------------------------------------

  /**
   * 从地图包更新内部状态并取得包所有权。
   *
   * OpenRA 对照: MapPreview.UpdateFromMap()
   *
   * 包保留在内存中且不得被外部释放。
   * 从包中解析 map.yaml 元数据并存储在属性中。
   *
   * @param p -- 地图包（取得所有权）
   * @param classification -- 地图分类
   * @param gridType -- 网格类型（可选，默认已设置）
   * @param metadata -- 预解析的地图元数据（可选；如果提供则直接使用）
   */
  updateFromMap(
    p: IReadOnlyPackage,
    classification: MapClassification,
    gridType?: MapGridType | null,
    metadata?: MapMetadata | null,
  ): void {
    this.path = p.name
    this._package = p
    this._parentPackage = null
    this.class = classification

    if (gridType != null) {
      this.gridType = gridType
    }

    if (metadata) {
      this.applyMetadata(metadata)
    }

    this.modifiedDate = new Date()
    this.status = MapStatus.Available
  }

  /**
   * 从地图包更新内部状态但不取得包所有权。
   *
   * OpenRA 对照: MapPreview.UpdateFromMapWithoutOwningPackage()
   *
   * 需要时会延迟打开包的新副本。当调用方管理包生命周期时使用
   * （例如，MapCache 拥有父包但预览需要延迟访问单个地图）。
   *
   * @param p -- 地图包（不取得所有权）
   * @param parent -- 父包（用于延迟打开）
   * @param classification -- 地图分类
   * @param gridType -- 网格类型（可选）
   * @param _modDataRules -- 模组数据规则（保留供将来使用）
   * @param metadata -- 预解析的地图元数据（可选）
   */
  updateFromMapWithoutOwningPackage(
    p: IReadOnlyPackage,
    parent: IReadOnlyPackage,
    classification: MapClassification,
    gridType?: MapGridType | null,
    _modDataRules?: unknown,
    metadata?: MapMetadata | null,
  ): void {
    this.path = p.name
    this._parentPackage = parent
    this._package = null
    this.class = classification

    if (gridType != null) {
      this.gridType = gridType
    }

    if (metadata) {
      this.applyMetadata(metadata)
    }

    this.modifiedDate = new Date()
    this.status = MapStatus.Available
  }

  /**
   * 从预解析的元数据应用所有字段。
   *
   * 将 MapMetadata 结构体中的值复制到相应的 MapPreview 属性。
   * 仅覆盖 MapMetadata 中定义的键。
   *
   * @param meta -- 预解析的地图元数据
   */
  applyMetadata(meta: MapMetadata): void {
    if (meta.mapFormat !== undefined) this.mapFormat = meta.mapFormat
    if (meta.title !== undefined) this.title = meta.title
    if (meta.categories !== undefined) this.categories = [...meta.categories]
    if (meta.author !== undefined) this.author = meta.author
    if (meta.tileset !== undefined) this.tileset = meta.tileset
    if (meta.bounds !== undefined) this.bounds = meta.bounds
    if (meta.visibility !== undefined) this.visibility = meta.visibility
    if (meta.spawnPoints !== undefined) this.spawnPoints = [...meta.spawnPoints]
    if (meta.playerDefinitions !== undefined) {
      this.players = new MapPlayers(
        meta.playerDefinitions.map((def) => ({
          name: def.name,
          properties: def.properties as Record<string, unknown>,
        })),
      )
      this.playerCount = Array.from(this.players.players.values()).filter(
        (pr) => pr.playable,
      ).length
    }
  }

  // -------------------------------------------------------------------------
  // Generation args
  // -------------------------------------------------------------------------

  /**
   * 从生成参数更新状态（程序化地图）。
   *
   * OpenRA 对照: MapPreview.UpdateFromGenerationArgs()
   *
   * 将此预览设置为 Generated 分类和 Generatable 状态。
   *
   * @param args -- 程序化地图生成参数
   */
  updateFromGenerationArgs(args: MapGenerationArgs): void {
    this.class = MapClassification.Generated
    this.status = MapStatus.Generatable
    this.title = args.title
    this.author = args.author
    this.tileset = args.tileset
    this.generationArgs = args
    this.mapFormat = 12 // CurrentMapFormat placeholder -- matches OpenRA ~12
  }

  // -------------------------------------------------------------------------
  // Remote search
  // -------------------------------------------------------------------------

  /**
   * 开始远程搜索此地图（从资源中心）。
   *
   * OpenRA 对照: MapPreview.BeginRemoteSearch()
   *
   * 仅当分类为 Unknown 或 Remote 时才设置状态为 Searching。
   */
  beginRemoteSearch(): void {
    if (
      this.class === MapClassification.Unknown ||
      this.class === MapClassification.Remote
    ) {
      this.class = MapClassification.Remote
      this.status = MapStatus.Searching
    }
  }

  /**
   * 使用从远程 API 获取的数据完成远程搜索。
   *
   * OpenRA 对照: MapPreview.CompleteRemoteSearch()
   *
   * 处理远程 API 响应数据（RemoteMapData 形状）。
   * 内部进行类型窄化；格式错误的数据会静默将状态设置为 Unavailable。
   *
   * @param data -- 远程 API 响应数据或 null
   * @param callback -- 成功时调用的回调
   */
  completeRemoteSearch(
    data: RemoteMapData | null | unknown,
    callback?: ((preview: MapPreview) => void) | null,
  ): void {
    if (
      this.class !== MapClassification.Remote &&
      this.class !== MapClassification.Unknown
    ) {
      // 另一个异步任务可能已将预览解析为本地/生成的地图。
      // 不要覆盖该状态。
      return
    }

    this.class = MapClassification.Remote

    // Type-narrow: use validateRemoteMapData for thorough validation
    const remoteData: RemoteMapData | null = validateRemoteMapData(data)

    if (remoteData) {
      try {
        this.status = remoteData.downloading
          ? MapStatus.DownloadAvailable
          : MapStatus.Unavailable
        this.title = remoteData.title
        this.categories = [...remoteData.categories]
        this.author = remoteData.author
        this.playerCount = remoteData.players
        this.bounds = remoteData.bounds
        this.tileset = remoteData.tileset
        this.mapFormat = remoteData.mapformat
        this.gridType = remoteData.map_grid_type

        // 解码出生点: [x1, y1, x2, y2, ...]
        // 仅处理完整配对；跳过未配对末尾元素（与 C# 的整数除法一致）
        if (remoteData.spawnpoints && remoteData.spawnpoints.length >= 2) {
          const spawns: { X: number; Y: number }[] = []
          const pairCount = (remoteData.spawnpoints.length / 2) | 0
          for (let j = 0; j < pairCount * 2; j += 2) {
            spawns.push({
              X: remoteData.spawnpoints[j],
              Y: remoteData.spawnpoints[j + 1],
            })
          }
          this.spawnPoints = spawns
        }

        // 解码 base64 小地图图像
        if (remoteData.minimap) {
          try {
            const decoded = this.base64ToUint8Array(remoteData.minimap)
            this.preview = decoded
            // 从解码后的 PNG 头中提取小地图尺寸
            const dims = parsePngDimensions(decoded)
            if (dims) {
              this.previewSize = dims
            }
            if (this._cache?.cacheMinimap) {
              this._cache.cacheMinimap(this)
            }
          } catch {
            // 小地图解码失败 -- 将预览保留为 null
            this.preview = null
            this.previewSize = null
          }
        }
      } catch {
        this.status = MapStatus.Unavailable
      }
    } else {
      this.status = MapStatus.Unavailable
    }

    // 始终调用回调（匹配 C#: parseMetadata?.Invoke(this) 在
    // MapClassification.Remote 时无条件调用）
    callback?.(this)
  }

  /**
   * 从远程地图资源中心 API 获取地图信息。
   *
   * OpenRA 对照: 与 CompleteRemoteSearch 交互的 HTTP API 调用
   *
   * @param url -- 资源中心 API 的完整 URL
   * @returns 如果成功则返回 RemoteMapData，否则返回 null
   */
  async fetchRemoteInfo(url: string): Promise<RemoteMapData | null> {
    try {
      const response = await fetch(url)
      if (!response.ok) return null
      const data = (await response.json()) as RemoteMapData
      return data
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Minimap
  // -------------------------------------------------------------------------

  /**
   * 获取小地图精灵。
   *
   * OpenRA 对照: MapPreview.GetMinimap()
   *
   * 如果小地图尚未生成且地图可用，则请求 MapCache 异步缓存它。
   *
   * @returns 如果已缓存则返回小地图精灵，否则返回 null
   */
  getMinimap(): unknown | null {
    // NOTE: 小地图精灵缓存需要完整的 Sprite/Sheet 基础设施。
    // 在 Web 环境中，preview (Uint8Array) 通过 Canvas API 渲染为小地图。
    // 返回 null 表示"尚未缓存"。
    if (this.preview !== null) {
      return this.preview
    }

    if (!this._generatingMinimap && this.status === MapStatus.Available) {
      this._generatingMinimap = true
      if (this._cache?.cacheMinimap) {
        this._cache.cacheMinimap(this)
      }
    }

    return null
  }

  /**
   * 设置小地图精灵（供 MapCache 缓存回调使用）。
   *
   * OpenRA 对照: MapPreview.SetMinimap()
   *
   * @param minimap -- 小地图精灵数据
   */
  /**
   * 设置小地图精灵（供 MapCache 缓存回调使用）。
   *
   * OpenRA 对照: MapPreview.SetMinimap()
   *
   * @param minimap — 小地图精灵数据
   * @param size — 可选的小地图尺寸（如果调用方已知图像尺寸）
   */
  setMinimap(minimap: unknown, size?: { width: number; height: number }): void {
    // NOTE: TypeScript 中，小地图存储为预览像素数据。
    // 当完整的 Sprite 基础设施集成后，此方法将存储实际的 Sprite 引用。
    if (minimap instanceof Uint8Array) {
      this.preview = minimap
    }
    if (size) {
      this.previewSize = size
    }
    this._generatingMinimap = false
  }

  /**
   * 从地图地形数据生成预览像素。
   *
   * OpenRA 对照: MapCache.CacheMinimap() + Png 编码
   *
   * 基于地形瓦片高度/类型数据生成简化的等距小地图。
   * 使用 Canvas API 进行像素渲染。
   *
   * @param terrainData -- 2D 网格中的地形瓦片类型索引
   * @param mapWidth -- 地图宽度（以单元格为单位）
   * @param mapHeight -- 地图高度（以单元格为单位）
   * @returns 小地图 RGBA 像素数据，如果生成失败则返回 null
   */
  generatePreviewPixels(
    terrainData: number[],
    mapWidth: number,
    mapHeight: number,
  ): Uint8Array | null {
    // 小地图尺寸：与 OpenRA 类似按比例缩放
    const previewWidth = Math.max(1, Math.min(256, mapWidth))
    const previewHeight = Math.max(1, Math.min(256, mapHeight))
    const pixels = new Uint8Array(previewWidth * previewHeight * 4)

    const scaleX = mapWidth / previewWidth
    const scaleY = mapHeight / previewHeight

    for (let py = 0; py < previewHeight; py++) {
      for (let px = 0; px < previewWidth; px++) {
        const mapX = Math.floor(px * scaleX)
        const mapY = Math.floor(py * scaleY)
        const idx = mapY * mapWidth + mapX
        const terrainType = idx < terrainData.length ? terrainData[idx] : 0

        // 简单调色板映射：将地形类型索引映射到颜色
        const color = this.terrainTypeToColor(terrainType)
        const pi = (py * previewWidth + px) * 4
        pixels[pi] = (color >> 24) & 0xff // R
        pixels[pi + 1] = (color >> 16) & 0xff // G
        pixels[pi + 2] = (color >> 8) & 0xff // B
        pixels[pi + 3] = color & 0xff // A
      }
    }

    this.preview = pixels
    this.previewSize = { width: previewWidth, height: previewHeight }
    return pixels
  }

  /**
   * 将地形类型索引映射到 ARGB 颜色。
   *
   * 默认调色板使用基本的 C&C 地形颜色。
   * 可由模组特定实现覆盖或替换。
   *
   * @param terrainType -- 地形类型索引（0-255）
   * @returns ARGB 颜色值
   */
  private terrainTypeToColor(terrainType: number): number {
    // 基本 C&C 地形调色板（硬编码回退）
    switch (terrainType) {
      case 0: // Clear
        return 0xc0b080ff
      case 1: // Road
        return 0x808080ff
      case 2: // Water
        return 0x4040c0ff
      case 3: // Rock
        return 0x606060ff
      case 4: // Tree / Wall
        return 0x408040ff
      case 5: // Beach
        return 0xd0c090ff
      default:
        // 确定性但多样的回退颜色
        const hue = (terrainType * 67) % 256
        const r = ((hue * 3) % 256)
        const g = ((hue * 5 + 85) % 256)
        const b = ((hue * 7 + 170) % 256)
        return (r << 24) | (g << 16) | (b << 8) | 0xff
    }
  }

  // -------------------------------------------------------------------------
  // Author parsing
  // -------------------------------------------------------------------------

  /**
   * 从地图描述字符串中提取作者名称。
   *
   * OpenRA 对照: 字段解析逻辑（无直接等效，实用工具方法）
   *
   * 以 "by " 开头的常见模式或 "author:" 标签。
   * 回退为字符串按空格分割的首个 token。
   *
   * @param description -- 地图描述字符串
   * @returns 提取的作者名称，如果无法解析则返回 "Unknown Author"
   */
  parseAuthor(description: string): string {
    if (!description || description.trim().length === 0) {
      return 'Unknown Author'
    }

    const trimmed = description.trim()

    // 匹配已知模式:
    // "by AuthorName" / "by: AuthorName"
    const byMatch = trimmed.match(/^by[:]?\s+(.+)$/i)
    if (byMatch) return byMatch[1].trim()

    // "author: AuthorName"
    const authorMatch = trimmed.match(/^author[:]?\s+(.+)$/i)
    if (authorMatch) return authorMatch[1].trim()

    // "created by AuthorName"
    const createdMatch = trimmed.match(/^created\s+by[:]?\s+(.+)$/i)
    if (createdMatch) return createdMatch[1].trim()

    // 回退：返回第一个单词
    const firstWord = trimmed.split(/\s+/)[0]
    return firstWord || 'Unknown Author'
  }

  // -------------------------------------------------------------------------
  // UID computation (hash-based map identity)
  // -------------------------------------------------------------------------

  /**
   * 从地图包内容的哈希计算 UID。
   *
   * OpenRA 对照: Map.ComputeUID() (使用 SHA1)
   *
   * 使用 djb2 哈希算法对包名和内容进行哈希。OpenRA 原始实现基于
   * 读取 map.yaml 和 map.bin 并对其内容计算 SHA1 哈希。但在浏览器环境
   * 中，文件读取是异步的（open() 返回 Promise），而 UID 计算在同步路径
   * （loadMaps）中执行。因此，使用基于包名和内容名列表的确定性哈希——
   * 对于相同的包名+内容，跨设备和安装产生一致的标识符。
   *
   * 对于多人游戏兼容性，这由 MapCache 和远程仓库查询在更高层处理。
   *
   * @param package_ — 要计算哈希的地图包
   * @returns 十六进制哈希字符串
   */
  static computeUid(package_: IReadOnlyPackage): string {
    // djb2 哈希 — 在浏览器中快速且一致
    // 对包名和内容条目名进行哈希以确保确定性
    let hash = 5381
    const name = package_.name
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0
    }
    // 混入内容列表以确保唯一性
    const contents = package_.contents
    for (const c of contents) {
      for (let i = 0; i < c.length; i++) {
        hash = ((hash << 5) + hash + c.charCodeAt(i)) | 0
      }
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }

  // -------------------------------------------------------------------------
  // Lifecycle: invalidate, dispose, delete
  // -------------------------------------------------------------------------

  /**
   * 使此地图预览失效（标记为需要重新加载）。
   *
   * OpenRA 对照: MapPreview.Invalidate()
   */
  invalidate(): void {
    this.class = MapClassification.Unknown
    this.status = MapStatus.Unavailable
  }

  /**
   * 释放此预览持有的资源。
   *
   * OpenRA 对照: MapPreview.Dispose()
   *
   * 释放拥有的包。无效化预览状态。
   */
  dispose(): void {
    if (this._package) {
      this._package.dispose()
    }
    this._package = null
    this._parentPackage = null
    this.preview = null
    this.previewSize = null
  }

  /**
   * 删除底层地图文件并无效化预览。
   *
   * OpenRA 对照: MapPreview.Delete()
   *
   * 尝试从父包（IReadWritePackage）中删除地图文件。
   */
  delete(): void {
    this.invalidate()
    // 尝试从父包中删除（如果父包支持写入）
    const parent = this._parentPackage as IPackage | null
    if (parent && typeof parent.delete === 'function') {
      parent.delete(this.path)
    }
  }

  // -------------------------------------------------------------------------
  // IReadOnlyFileSystem stubs (OpenRA 对照: 显式接口实现)
  // -------------------------------------------------------------------------

  /**
   * 从此地图预览的文件系统打开文件。
   *
   * OpenRA 对照: IReadOnlyFileSystem.Open()
   *
   * NOTE: 这是 IReadOnlyFileSystem 接口的存根。完整实现需要
   * ModData.DefaultFileSystem 引用。参见 TODO-4.E.2。
   */
  openFile(_filename: string): Promise<ArrayBuffer | null> {
    return Promise.resolve(null)
  }

  /**
   * 检查此地图预览的文件系统中是否存在文件。
   *
   * OpenRA 对照: IReadOnlyFileSystem.Exists()
   *
   * NOTE: IReadOnlyFileSystem 存根。参见 TODO-4.E.2。
   */
  fileExists(_filename: string): boolean {
    return false
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  /**
   * 将 base64 字符串解码为 Uint8Array。
   *
   * 用于解码来自远程 API 响应的 base64 编码数据（小地图、规则等）。
   *
   * @param base64 -- base64 编码的字符串
   * @returns 解码后的字节数组
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes
  }
}

// ---------------------------------------------------------------------------
// RemoteMapData validation
// ---------------------------------------------------------------------------

/**
 * 验证一个未知对象是否符合 RemoteMapData 接口。
 * 返回类型窄化后的 RemoteMapData，如果验证失败则返回 null。
 *
 * OpenRA 对照: 无直接等效（OpenRA 使用 MiniYaml 解析 + 字段访问，
 *   类型安全由 C# 编译器在编译时保证）
 *
 * @param data — 待验证的未知数据
 * @returns 有效的 RemoteMapData 或 null
 */
export function validateRemoteMapData(data: unknown): RemoteMapData | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.title !== 'string') return null
  if (typeof d.author !== 'string') return null
  if (!Array.isArray(d.categories)) return null
  if (typeof d.players !== 'number') return null
  if (!d.bounds || typeof d.bounds !== 'object') return null
  const bounds = d.bounds as Record<string, unknown>
  if (
    typeof bounds.X !== 'number' ||
    typeof bounds.Y !== 'number' ||
    typeof bounds.Width !== 'number' ||
    typeof bounds.Height !== 'number'
  )
    return null
  if (!Array.isArray(d.spawnpoints)) return null
  if (typeof d.minimap !== 'string') return null
  if (typeof d.tileset !== 'string') return null
  if (typeof d.mapformat !== 'number') return null
  // Optional fields (downloading, rules, players_block, game_mod, map_grid_type)
  // are not required for basic validation — they will be accessed conditionally
  return data as RemoteMapData
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * 解析远程地图查询响应，自动检测 JSON vs YAML 格式。
 *
 * OpenRA 对照: MiniYaml.FromStream() / MiniYamlLoader
 *
 * OpenRA 原始实现使用 MiniYaml.FromStream() 进行 YAML 解析。
 * Web 适配：先尝试 JSON（现代 API），如果失败则抛出错误。
 * YAML 回退路径（运行时 MiniYaml）延后至后续阶段。
 *
 * @param text — 原始响应正文
 * @param url — 源 URL（用于错误消息）
 * @returns 解析后的键值映射 (uid => RemoteMapData 或原始对象)
 * @throws Error 如果无法解析响应
 */
export function parseMapQueryResponse(
  text: string,
  url: string,
): Record<string, unknown> {
  // 先尝试 JSON（大多数 Web API 使用 JSON）
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 非 JSON，回退至 YAML（延后至 TODO-4.E.3-YAML）
    // NOTE: YAML 回退路径是故意的未来增强功能，不属于本任务范围。
    // 根据 ADR-4.E.3.1，当前所有远程 API 端点均返回 JSON。
    // 运行时 YAML 解析需要 MiniYaml 基础设施集成（延后评估）。
  }

  // 回退：YAML 解析（延后）
  // NOTE: 如果未来引入返回 YAML 的 API 端点，需实现 MiniYaml 运行时解析。
  // 对于仅返回 JSON 的 API，此回退是存根。
  throw new Error(
    `Unable to parse response from ${url}: response is not valid JSON`,
  )
}
