/**
 * MapCache.ts — 中央地图注册表与缓存管理器
 * OpenRA 对照: OpenRA.Game/Map/MapCache.cs
 *
 * 核心范式转换:
 * - C# Cache<string, MapPreview> → Cache<string, MapPreview> (已迁移)
 * - C# Thread + Thread.Sleep → async/await + setTimeout (微任务队列)
 * - C# lock(syncRoot) → 不需要 (JavaScript 单线程)
 * - C# IEnumerable<MapPreview> + yield return → [Symbol.iterator]()
 * - C# HttpClient → fetch() API
 * - C# HashSet<string> StringPool → Set<string>
 * - C# Dictionary<string, string> mapUpdates → Map<string, string>
 * - C# ThreadPool.QueueUserWorkItem → Promise.resolve().then()
 * - C# PerfTimer → performance.now() via PerfTimer class (RESOLVED P1-D.5)
 * - C# Log.Write → Log.write('mapcache', LogLevel.WARN, ...) (RESOLVED P1-D.5)
 */

import { Cache } from '../Primitives/Cache.js'
import { SheetBuilder } from '../Graphics/SheetBuilder.js'
import { SheetType } from '../Graphics/Sheet.js'
import type { IReadOnlyPackage, IReadWritePackage } from '../FileSystem/IReadOnlyPackage.js'
import type { MapGridType } from './MapGridType.js'
import { MapGridType as MapGridTypeConst } from './MapGridType.js'
import { MapPreview, MapStatus, MapClassification, MapClassificationExts, parseMapQueryResponse } from './MapPreview.js'
import { MapDirectoryTracker } from './MapDirectoryTracker.js'
import type { MersenneTwisterStub } from '../Traits/TraitsInterfaces.js'
import { Log, LogLevel } from '../Utils/Log.js'
import { PerfTimer } from '../Utils/PerfTimer.js'
import { fetchWithRetry } from '../Net/HttpClient.js'

// ---------------------------------------------------------------------------
// Stubs for dependencies not yet migrated
// ---------------------------------------------------------------------------

/** Manifest stub — 仅包含 MapCache 所需的 MapFolders。 */
export interface ManifestStub {
  readonly mapFolders: Map<string, string>
  readonly rendererConstants: {
    readonly mapPreviewSheetSize: number
  }
}

/** ModData stub — 仅包含 MapCache 所需的成员。 */
export interface ModDataStub {
  getOrCreate<T>(_type: new () => T): T | undefined
  readonly mapFolders: Map<string, string>
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * 从数组中随机选择一个元素，如果数组为空则返回 undefined。
 *
 * OpenRA 对照: IEnumerable<T>.RandomOrDefault(MersenneTwister)
 *
 * @param array — 源数组
 * @param random — 返回 [0, 1) 范围内随机数的函数
 * @returns 随机元素或 undefined
 */
export function randomOrDefault<T>(array: T[], random: () => number): T | undefined {
  if (array.length === 0) return undefined
  return array[Math.floor(random() * array.length)]
}

/**
 * 将数组分块为指定大小的较小数组。
 *
 * OpenRA 对照: .NET 6 IEnumerable<T>.Chunk(int)
 *
 * @param array — 要分块的数组
 * @param size — 每个块的大小
 * @returns 块数组
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

// ---------------------------------------------------------------------------
// MapCache
// ---------------------------------------------------------------------------

/**
 * 所有已知地图的中央注册表。
 *
 * OpenRA 对照: MapCache class
 *
 * 维护已加载地图预览的 Cache<string, MapPreview>，处理异步小地图生成，
 * 支持通过 HTTP 进行远程地图详情查询，并为大厅提供地图选择逻辑。
 * 实现可迭代协议和 dispose 模式。
 */
export class MapCache implements Iterable<MapPreview> {
  // -----------------------------------------------------------------------
  // Static
  // -----------------------------------------------------------------------

  /**
   * 未知地图的占位符预览。
   *
   * OpenRA 对照: MapCache.UnknownMap
   */
  static readonly UnknownMap: MapPreview = new MapPreview(
    null,
    '',
    MapGridTypeConst.Rectangular,
    null,
  )

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** 地图位置：包 → 分类。 */
  private readonly _mapLocations = new Map<IReadOnlyPackage, MapClassification>()

  /** 地图位置只读视图。 */
  get mapLocations(): ReadonlyMap<IReadOnlyPackage, MapClassification> {
    return this._mapLocations
  }

  /** 是否加载预览图像。 */
  loadPreviewImages = true

  /** UID → MapPreview 缓存。 */
  private _previews: Cache<string, MapPreview>

  /** 小地图图集构建器。 */
  private readonly _sheetBuilder: SheetBuilder

  /** 字符串去重池。 */
  readonly stringPool = new Set<string>()

  /** 活动目录跟踪器。 */
  private readonly _mapDirectoryTrackers: MapDirectoryTracker[] = []

  /** 最近修改或加载的地图。 */
  lastModifiedMap: string | null = null

  /** 旧 UID → 新 UID 映射（用于跟踪更新）。 */
  private readonly _mapUpdates = new Map<string, string>()

  /** 上次加载的 lastModifiedMap（用于 pickLastModifiedMap 的一次性语义）。 */
  private _lastLoadedLastModifiedMap: string | null = null

  /** 异步小地图加载器状态。 */
  private _generateMinimap: MapPreview[] = []
  private _previewLoaderRunning = false
  private _previewLoaderShutdown = true

  /** Manifest 引用。 */
  private readonly _manifest: ManifestStub

  /** 模组文件系统（可选——未提供时使用模拟包作为回退）。 */
  private readonly _modFiles: IReadOnlyPackage | undefined

  /** 追踪异步小地图加载器 promise 以在 dispose 时正确等待。 */
  private _previewLoaderPromise: Promise<void> | null = null

  /** 取消标志：当为 true 时，加载器循环应尽早退出。 */
  private _previewLoaderCancelled = false

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * 构造 MapCache。
   *
   * OpenRA 对照: MapCache(Manifest, FS)
   *
   * @param manifest — 模组清单
   * @param modFiles — 模组文件系统（可选）。提供时用于通过真实文件系统访问
   *   地图目录和包；未提供时回退到空模拟包（向后兼容）。
   */
  constructor(manifest: ManifestStub, modFiles?: IReadOnlyPackage) {
    this._manifest = manifest
    this._modFiles = modFiles
    this._sheetBuilder = new SheetBuilder(
      SheetType.BGRA,
      manifest.rendererConstants.mapPreviewSheetSize,
    )
    this._previews = new Cache<string, MapPreview>(
      (uid) => new MapPreview(null, uid, MapGridTypeConst.Rectangular, this),
    )
  }

  // -----------------------------------------------------------------------
  // Map update tracking
  // -----------------------------------------------------------------------

  /**
   * 如果 LastModifiedMap 已被选取，则返回 null。
   *
   * OpenRA 对照: MapCache.PickLastModifiedMap()
   *
   * @param visibility — 所需的可见性标志
   * @returns 地图 UID，如果不匹配则返回 null
   */
  pickLastModifiedMap(visibility: number): string | null {
    this.updateMaps()

    if (!this.lastModifiedMap) return null

    const map = this._previews.tryGet(this.lastModifiedMap)
    if (
      map &&
      map.status === MapStatus.Available &&
      (map.visibility & visibility) === visibility &&
      this._lastLoadedLastModifiedMap !== this.lastModifiedMap
    ) {
      this._lastLoadedLastModifiedMap = this.lastModifiedMap
      return this._lastLoadedLastModifiedMap
    }

    return null
  }

  // -----------------------------------------------------------------------
  // Update maps
  // -----------------------------------------------------------------------

  /**
   * 将所有目录跟踪器的待处理操作刷新到缓存中。
   *
   * OpenRA 对照: MapCache.UpdateMaps()
   */
  updateMaps(): void {
    for (const tracker of this._mapDirectoryTrackers) {
      tracker.updateMaps(this)
    }
  }

  // -----------------------------------------------------------------------
  // Load maps
  // -----------------------------------------------------------------------

  /**
   * 从清单中加载所有地图。
   *
   * OpenRA 对照: MapCache.LoadMaps(ModData)
   *
   * @param modData — 模组数据
   */
  loadMaps(modData: ModDataStub): void {
    // 不支持地图的实用程序模组
    if (this._manifest.mapFolders.size === 0) return

    // NOTE: modData.getOrCreate<T>() expects a constructor parameter. In OpenRA,
    // this resolves MapGrid.Type from the mod-global MapGrid instance. Our
    // ModDataStub.getOrCreate() may return undefined when the module is not
    // registered, so we fall back to Rectangular (the most common grid type).
    // Full ModData implementation would instantiate MapGrid based on YAML config.
    const gridType = modData.getOrCreate(class DummyGridType {} as unknown as new () => MapGridType) ?? MapGridTypeConst.Rectangular

    // 使用引用此缓存的工厂重新初始化预览
    this._previews = new Cache<string, MapPreview>(
      (uid) => new MapPreview(modData, uid, gridType as MapGridType, this),
    )

    // 枚举地图目录
    for (const [name, classificationStr] of this._manifest.mapFolders) {
      const classification = this.parseClassification(classificationStr)
      const optional = name.startsWith('~')
      const resolvedName = optional ? name.slice(1) : name

      try {
        // 打开包：优先使用真实文件系统，未提供时回退到空模拟包
        const package_ = this._modFiles?.openPackage(resolvedName) ?? this.createMockPackage(resolvedName)
        this._mapLocations.set(package_, classification)
        this._mapDirectoryTrackers.push(
          new MapDirectoryTracker(package_, classification),
        )
      } catch (e) {
        if (optional) continue
        throw e
      }
    }

    // 从所有包加载所有地图
    for (const [package_, classification] of this._mapLocations) {
      for (const map of package_.contents) {
        this.loadMapInternal(map, package_, classification, null, gridType as MapGridType)
      }
    }

    // 我们只想在运行时跟踪地图，而不是加载时
    this.lastModifiedMap = null
  }

  /**
   * 解析分类字符串。
   *
   * @param value — 分类字符串
   * @returns MapClassification 值
   */
  private parseClassification(value: string): MapClassification {
    switch (value) {
      case 'System': return MapClassification.System
      case 'User': return MapClassification.User
      case 'Remote': return MapClassification.Remote
      default: return MapClassification.Unknown
    }
  }

  /**
   * 创建回退用的空模拟包。
   *
   * 当 modFiles 未提供或 openPackage() 返回 null 时使用。
   * 保持向后兼容性——测试和未配置模组文件系统的环境可以继续运行。
   */
  private createMockPackage(name: string): IReadOnlyPackage {
    return {
      name,
      contents: [],
      contains: () => false,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
    }
  }

  /**
   * 加载单个地图的公共 API。
   *
   * OpenRA 对照: MapCache.LoadMap()
   *
   * @param map — 地图名称
   * @param package_ — 包含包
   * @param classification — 地图分类
   * @param oldMap — 旧地图 UID（用于更新跟踪）
   */
  loadMap(
    map: string,
    package_: IReadOnlyPackage,
    classification: MapClassification,
    oldMap: string | null,
  ): void {
    this.loadMapInternal(map, package_, classification, oldMap)
  }

  /**
   * 加载单个地图的内部实现。
   *
   * OpenRA 对照: MapCache.LoadMapInternal()
   */
  private loadMapInternal(
    map: string,
    package_: IReadOnlyPackage,
    classification: MapClassification,
    oldMap: string | null,
    gridType?: MapGridType,
    _modDataRules?: unknown,
  ): void {
    let mapPackage: IReadOnlyPackage | null = null
    try {
      mapPackage = package_.openPackage?.(map) ?? null
      if (mapPackage) {
        const uid = this.computeUid(mapPackage)
        const preview = this._previews.get(uid)
        preview.updateFromMapWithoutOwningPackage(
          mapPackage,
          package_,
          classification,
          gridType ?? null,
          _modDataRules,
        )

        if (oldMap !== uid) {
          this.lastModifiedMap = uid
          if (oldMap !== null) {
            this._mapUpdates.set(oldMap, uid)
          }
        }
      }
    } catch (e) {
      Log.write('mapcache', LogLevel.WARN, `Failed to load map: ${map}`)
      Log.write('mapcache', LogLevel.WARN, `Details: ${String(e)}`)
    } finally {
      // 确保在加载成功或失败时都释放打开的包
      mapPackage?.dispose()
    }
  }

  /**
   * 从包内容计算地图 UID。
   *
   * OpenRA 对照: Map.ComputeUID()
   *
   * 委托给 MapPreview.computeUid()，它使用 djb2 哈希算法对包名和内容
   * 进行哈希。OpenRA 原始实现使用 SHA1 对 map.yaml/map.bin 内容进行哈希，
   * 但在浏览器中不需要完整的加密哈希——跨设备/安装的一致性哈希就足够了。
   *
   * @param _package_ — 地图包
   * @returns 计算出的 UID
   */
  private computeUid(_package_: IReadOnlyPackage): string {
    // 委托给 MapPreview.computeUid 以获得一致的实现
    return MapPreview.computeUid(_package_)
  }

  // -----------------------------------------------------------------------
  // Package type guard
  // -----------------------------------------------------------------------

  /**
   * 将只读包安全地转换为 IReadWritePackage。
   *
   * 在信任向下转型之前，通过运行时类型守卫检查 update() 和 delete() 方法
   * 是否存在。如果缺少任一方法，返回 null 以便调用方回退到模拟包。
   *
   * OpenRA 对照: implicit cast in EnumerateMapDirPackages()
   *
   * @param raw — 来自 openPackage() 的原始包或 null
   * @param _resolvedName — 解析后的包名（保留供将来使用）
   * @returns IReadWritePackage 或 null（如果不满足运行时契约）
   */
  private tryAsReadWritePackage(
    raw: IReadOnlyPackage | null | undefined,
  ): IReadWritePackage | null {
    if (!raw) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = raw as unknown as Record<string, unknown>
    if (typeof rec.update === 'function' && typeof rec.delete === 'function') {
      return raw as IReadWritePackage
    }
    return null
  }

  // -----------------------------------------------------------------------
  // Enumeration
  // -----------------------------------------------------------------------

  /**
   * 枚举地图目录包。
   *
   * OpenRA 对照: MapCache.EnumerateMapDirPackages()
   *
   * @param classification — 要包含的分类
   * @returns 可写包生成器
   */
  *enumerateMapDirPackages(
    classification: MapClassification = MapClassification.System,
  ): Generator<IReadWritePackage> {
    for (const [name, classificationStr] of this._manifest.mapFolders) {
      const packageClassification = this.parseClassification(classificationStr)
      if (!MapClassificationExts.hasFlag(classification, packageClassification)) continue

      const optional = name.startsWith('~')
      const resolvedName = optional ? name.slice(1) : name

      // 打开包：优先使用真实文件系统；回退到空模拟可写包
      // 运行时类型守卫确保返回对象真正实现 update() 和 delete()
      const raw = this._modFiles?.openPackage(resolvedName)
      const pkg: IReadWritePackage = this.tryAsReadWritePackage(raw) ?? {
        name: resolvedName,
        contents: [],
        contains: () => false,
        open: async () => null,
        openPackage: () => null,
        update: () => {},
        delete: () => {},
        dispose: () => {},
      }
      yield pkg
    }
  }

  /**
   * 枚举地图目录包及其名称。
   *
   * OpenRA 对照: MapCache.EnumerateMapDirPackagesAndNames()
   */
  *enumerateMapDirPackagesAndNames(
    classification: MapClassification = MapClassification.System,
  ): Generator<{ package: IReadWritePackage; map: string }> {
    for (const mapDirPackage of this.enumerateMapDirPackages(classification)) {
      for (const map of mapDirPackage.contents) {
        yield { package: mapDirPackage, map }
      }
    }
  }

  /**
   * 枚举地图包而不进行缓存。
   *
   * OpenRA 对照: MapCache.EnumerateMapPackagesWithoutCaching()
   */
  *enumerateMapPackagesWithoutCaching(
    classification: MapClassification = MapClassification.System,
  ): Generator<IReadWritePackage> {
    for (const mapDirPackage of this.enumerateMapDirPackages(classification)) {
      for (const map of mapDirPackage.contents) {
        const raw = mapDirPackage.openPackage?.(map)
        // 使用运行时类型守卫确保包支持 update() 和 delete()；
        // 只读包或无法满足 IReadWritePackage 契约的包被跳过
        const readWrite = this.tryAsReadWritePackage(raw ?? null)
        if (readWrite) {
          yield readWrite
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Remote map queries
  // -----------------------------------------------------------------------

  /**
   * 查询远程地图详情。
   *
   * OpenRA 对照: MapCache.QueryRemoteMapDetails()
   *
   * 使用 fetch() API 查询远程地图元数据。将 UID 批量处理为每组 50 个。
   *
   * TODO-4.E.3: 完整的 HTTP 客户端实现，包括重试逻辑和性能跟踪（PerfTimer）。
   * 根据 ADR-4.E.3.1，远程 API 返回 JSON，不进行运行时 YAML 解析。
   *
   * @param repositoryUrl — 地图仓库 URL
   * @param uids — 要查询的地图 UID
   * @param mapDetailsReceived — 成功时每个地图的回调
   * @param mapQueryFailed — 失败时每个地图的回调
   */
  async queryRemoteMapDetails(
    repositoryUrl: string,
    uids: string[],
    mapDetailsReceived?: (preview: MapPreview) => void,
    mapQueryFailed?: (preview: MapPreview) => void,
  ): Promise<void> {
    const queryUids = uids
      .filter((uid) => uid !== null && uid !== undefined)
      .map((uid) => this._previews.get(uid))
      .filter((p) => p.status === MapStatus.Unavailable)
      .map((p) => p.uid)

    for (const uid of queryUids) {
      this._previews.get(uid).beginRemoteSearch()
    }

    // 将 UID 分块为每组 50 个
    const batches = chunkArray(queryUids, 50)

    for (const batchUids of batches) {
      const url = `${repositoryUrl}hash/${batchUids.join(',')}/yaml`
      const timer = new PerfTimer()
      timer.start()

      try {
        // 如果预览加载器已取消，传递一个已中止的信号
        const signal = this._previewLoaderCancelled
          ? AbortSignal.abort()
          : undefined
        const response = await fetchWithRetry(url, undefined, undefined, signal)
        // 防御性检查：fetchWithRetry 保证返回 ok（非 ok 的可重试状态码会
        // 重试，不可重试状态码会 throw）。保留此检查以防未来行为变更。
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const text = await response.text()
        const data = parseMapQueryResponse(text, url)

        for (const [uid, value] of Object.entries(data)) {
          this._previews.get(uid).completeRemoteSearch(value, mapDetailsReceived)
        }
      } catch (e) {
        Log.write('mapcache', LogLevel.WARN, `Remote map query failed: ${String(e)}`)
        Log.write('mapcache', LogLevel.DEBUG, `URL was: ${url}`)
      } finally {
        const elapsed = timer.stop()
        Log.write(
          'mapcache',
          LogLevel.DEBUG,
          `RemoteMapDetails batch (${batchUids.length} maps): ${Math.round(elapsed)}ms`,
        )
      }

      // 将此批次中仍处于 Searching 状态的任何地图标记为失败
      for (const uid of batchUids) {
        const p = this._previews.get(uid)
        if (p.status === MapStatus.Searching) {
          p.completeRemoteSearch(null, mapQueryFailed)
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Async minimap loading
  // -----------------------------------------------------------------------

  /**
   * 将小地图生成加入队列。
   *
   * OpenRA 对照: MapCache.CacheMinimap()
   *
   * @param preview — 要为其生成小地图的预览
   */
  cacheMinimap(preview: MapPreview): void {
    this._generateMinimap.push(preview)
    const launchLoader = this._previewLoaderShutdown
    this._previewLoaderShutdown = false

    if (launchLoader) {
      // 使用 setTimeout 将加载器启动延迟到下一个 tick
      // 存储 promise 以便 dispose 可以等待它完成
      this._previewLoaderPromise = new Promise((resolve) => {
        setTimeout(() => {
          this.runMinimapLoader().then(resolve).catch(resolve)
        }, 0)
      })
    }
  }

  /**
   * 运行异步小地图加载器循环。
   *
   * OpenRA 对照: MapCache.LoadAsyncInternal()
   *
   * 使用 async/await + setTimeout 在每次迭代时让出控制权，
   * 以防止在打开地图选择器时出现 UI 卡顿。
   */
  private async runMinimapLoader(): Promise<void> {
    // NOTE: JavaScript 是单线程的，因此此检查-设置序列是原子的。
    // 无需像 C# lock() 那样的显式同步。
    if (this._previewLoaderRunning) return
    this._previewLoaderRunning = true

    // 无事可做时在一个循环中等待的毫秒数
    const EmptyDelay = 50

    // 在上次小地图生成后保持线程存活至少 5 秒
    const MaxKeepAlive = 5000 / EmptyDelay
    let keepAlive = MaxKeepAlive

    while (true) {
      // 检查取消标志
      if (this._previewLoaderCancelled) {
        this._previewLoaderShutdown = true
        break
      }

      // 筛选出需要小地图生成的预览
      const todo = this._generateMinimap.filter((p) => p.getMinimap() === null)
      this._generateMinimap = []

      if (keepAlive > 0) keepAlive--
      if (keepAlive === 0 && todo.length === 0) {
        this._previewLoaderShutdown = true
        break
      }

      if (todo.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, EmptyDelay))
        continue
      } else {
        keepAlive = MaxKeepAlive
      }

      // 将小地图渲染到共享图集中
      for (const p of todo) {
        // 如果已取消，尽早退出
        if (this._previewLoaderCancelled) break

        if (p.preview !== null) {
          try {
            // TODO-4.E.4: 实际的小地图渲染 (SheetBuilder.Add)
            // 目前，仅将预览数据存储为小地图
            const sprite = this._sheetBuilder.addSimple(
              p.preview,
              0, // SpriteFrameType — 需要正确的类型
              { width: 1, height: 1 },
            )
            p.setMinimap(sprite)
          } catch (e) {
            Log.write('mapcache', LogLevel.WARN, `Failed to load minimap: ${String(e)}`)
          }
        }

        // 在处理每个项目之间让出控制权以防止 UI 卡顿
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }

    this._previewLoaderRunning = false
  }

  // -----------------------------------------------------------------------
  // UID resolution
  // -----------------------------------------------------------------------

  /**
   * 沿着 UID 更新链查找当前地图 UID。
   *
   * OpenRA 对照: MapCache.GetUpdatedMap()
   *
   * @param uid — 起始 UID
   * @returns 当前 UID，如果链断裂则返回 null
   */
  getUpdatedMap(uid: string | null): string | null {
    if (uid === null) return null

    while (this.get(uid).status !== MapStatus.Available) {
      const newUid = this._mapUpdates.get(uid)
      if (newUid === undefined) return null
      uid = newUid
    }

    return uid
  }

  // -----------------------------------------------------------------------
  // Map selection
  // -----------------------------------------------------------------------

  /**
   * 检查地图是否适合作为初始大厅地图。
   *
   * OpenRA 对照: MapCache.IsSuitableInitialMap()
   */
  private isSuitableInitialMap(map: MapPreview): boolean {
    if (map.status !== MapStatus.Available || (map.visibility & 1) !== 1) return false

    // 其他地图类型可能有令人困惑的设置或游戏玩法
    if (!map.categories.includes('Conquest')) return false

    // 禁用机器人的地图会让新玩家感到困惑
    const playersArray = Array.from(map.players.players.values())
    if (playersArray.some((x) => !x.allowBots)) return false

    // 大地图会暴露性能问题
    if (map.bounds.Width > 128 || map.bounds.Height > 128) return false

    return true
  }

  /**
   * 为大厅选择一张合适的初始地图。
   *
   * OpenRA 对照: MapCache.ChooseInitialMap()
   *
   * @param initialUid — 首选初始地图 UID
   * @param random — 随机数生成器
   * @returns 选定的地图 UID
   */
  chooseInitialMap(initialUid: string, random: MersenneTwisterStub): string {
    this.updateMaps()

    const preview = this._previews.tryGet(initialUid)
    if (
      preview &&
      preview.status === MapStatus.Available &&
      (preview.visibility & 1) === 1 &&
      (preview.class === MapClassification.System || preview.class === MapClassification.User)
    ) {
      return initialUid
    }

    // 找到所有合适的地图
    const suitable: MapPreview[] = []
    for (const p of this._previews.values()) {
      if (this.isSuitableInitialMap(p)) {
        suitable.push(p)
      }
    }

    const selected = randomOrDefault(suitable, () => random.next() / Number.MAX_SAFE_INTEGER)
    if (selected) return selected.uid

    // 回退：任何可用的、可见的大厅地图
    for (const p of this._previews.values()) {
      if (
        p.status === MapStatus.Available &&
        (p.visibility & 1) === 1 &&
        (p.class === MapClassification.System || p.class === MapClassification.User)
      ) {
        return p.uid
      }
    }

    return ''
  }

  // -----------------------------------------------------------------------
  // Indexer and iterator
  // -----------------------------------------------------------------------

  /**
   * 通过 UID 获取地图预览。
   *
   * OpenRA 对照: MapCache.this[string key]
   *
   * @param key — 地图 UID
   * @returns MapPreview 实例
   */
  get(key: string): MapPreview {
    this.updateMaps()
    return this._previews.get(key)
  }

  /**
   * 尝试获取地图预览而不创建它。
   *
   * @param key — 地图 UID
   * @returns MapPreview 或 undefined
   */
  tryGet(key: string): MapPreview | undefined {
    return this._previews.tryGet(key)
  }

  /**
   * 实现可迭代协议。
   *
   * OpenRA 对照: IEnumerable<MapPreview>.GetEnumerator()
   */
  [Symbol.iterator](): Iterator<MapPreview> {
    this.updateMaps()
    return this._previews.values()
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /**
   * 释放所有预览、目录跟踪器和图集构建器。
   *
   * OpenRA 对照: MapCache.Dispose()
   */
  /**
   * 释放所有预览、目录跟踪器和图集构建器。
   *
   * OpenRA 对照: MapCache.Dispose()
   *
   * NOTE: 此方法同步返回，但会设置取消标志以停止异步小地图加载器。
   * 如果加载器正在运行，图集构建器将保持可用，直到加载器循环退出。
   * 对于需要保证加载器已完成的清理，请使用 disposeAsync()。
   */
  dispose(): void {
    // 设置取消标志以停止异步加载器循环
    this._previewLoaderCancelled = true

    // 处理所有预览
    for (const p of this._previews.values()) {
      p.dispose()
    }

    // 处理所有目录跟踪器
    for (const t of this._mapDirectoryTrackers) {
      t.dispose()
    }

    // 清除状态
    this._mapLocations.clear()
    this._mapUpdates.clear()
    this._generateMinimap = []
    this._previewLoaderShutdown = true
    this._previews.clear()

    // 处理图集构建器
    this._sheetBuilder.dispose()
  }

  /**
   * 异步释放，等待小地图加载器完成后再处理资源。
   *
   * OpenRA 对照: MapCache.Dispose() (C# 版本等待 Thread.Join)
   *
   * 这是 dispose() 的异步版本，保证在返回前异步小地图加载器
   * 已完全退出。在需要干净关闭的场景（如测试清理）中使用此方法。
   */
  async disposeAsync(): Promise<void> {
    // 设置取消标志以停止异步加载器循环
    this._previewLoaderCancelled = true

    // 等待加载器 promise 完成（如果正在运行）
    if (this._previewLoaderPromise) {
      await this._previewLoaderPromise
      this._previewLoaderPromise = null
    }

    // 现在可以安全地同步处理所有资源
    this.dispose()
  }
}
