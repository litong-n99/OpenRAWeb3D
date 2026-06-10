/**
 * MapDirectoryTracker.ts — 地图目录变更跟踪器
 * OpenRA 对照: OpenRA.Game/Map/MapDirectoryTracker.cs
 *
 * 核心范式转换:
 * - C# FileSystemWatcher → 基于轮询的模型（浏览器无原生文件系统监视器）
 * - C# lock(mapActionQueue) → 不需要（JavaScript 单线程）
 * - C# Dictionary<string, MapAction> → Map<string, MapAction>
 * - C# Path.DirectorySeparatorChar → '/'（浏览器标准化）
 * - C# IDisposable → dispose() 方法
 *
 * NOTE: 实际的轮询循环是 TODO-4.E.1。此实现提供操作队列和
 * updateMaps() 方法，可由显式刷新调用或定时轮询触发。
 */

import type { IReadOnlyPackage } from '../FileSystem/IReadOnlyPackage.js'
import type { MapClassification } from './MapPreview.js'
import { MapStatus } from './MapPreview.js'

// ---------------------------------------------------------------------------
// Forward reference to avoid circular dependency with MapCache
// ---------------------------------------------------------------------------

/** MapCache 的最小接口 — 仅包含 MapDirectoryTracker 所需的方法。 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MapCacheLike {
  loadMap(map: string, package_: IReadOnlyPackage, classification: MapClassification, oldMap: string | null): void
  [Symbol.iterator](): Iterator<import('./MapPreview.js').MapPreview>
}

// ---------------------------------------------------------------------------
// MapAction enum
// ---------------------------------------------------------------------------

/**
 * 地图文件操作类型。
 *
 * OpenRA 对照: MapDirectoryTracker.MapAction（私有枚举）
 */
const MapAction = {
  Add: 0,
  Delete: 1,
  Update: 2,
} as const

type MapAction = (typeof MapAction)[keyof typeof MapAction]

// ---------------------------------------------------------------------------
// MapDirectoryTracker
// ---------------------------------------------------------------------------

/**
 * 监视地图目录中的文件变更并排队操作以供 MapCache 处理。
 *
 * OpenRA 对照: MapDirectoryTracker class
 *
 * 在 OpenRA 中，此类使用 .NET FileSystemWatcher 接收实时文件系统
 * 事件。在浏览器中，没有原生文件系统监视器，因此此类使用基于轮询
 * 的模型：
 * - 操作通过 addMapAction() 排队（可由轮询或显式刷新触发）
 * - updateMaps() 处理队列并更新 MapCache
 *
 * TODO-4.E.1: 实现实际的轮询循环（或基于 Service Worker 的推送通知）。
 */
export class MapDirectoryTracker {
  /** 此跟踪器监视的包。 */
  readonly package: IReadOnlyPackage

  /** 此包中地图的分类。 */
  readonly classification: MapClassification

  /** 操作队列：路径 → 操作类型。 */
  private readonly _mapActionQueue = new Map<string, MapAction>()

  /** 队列是否有待处理的操作。 */
  private _dirty = false

  /** 轮询间隔（毫秒）。默认 5000 毫秒。 */
  readonly pollingInterval: number

  /** 轮询间隔计时器句柄（如果有）。 */
  private _pollTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 构造 MapDirectoryTracker。
   *
   * OpenRA 对照: MapDirectoryTracker(IReadOnlyPackage, MapClassification)
   *
   * @param package_ — 要监视的包
   * @param classification — 此包中地图的分类
   * @param pollingInterval — 轮询间隔（毫秒，默认 5000）
   */
  constructor(
    package_: IReadOnlyPackage,
    classification: MapClassification,
    pollingInterval = 5000,
  ) {
    this.package = package_
    this.classification = classification
    this.pollingInterval = pollingInterval
  }

  /**
   * 开始轮询目录变更。
   *
   * OpenRA 对照: FileSystemWatcher.EnableRaisingEvents = true
   *
   * NOTE: 这是 TODO-4.E.1 的可选轮询机制。在完整的文件系统
   * 监视可用之前，调用方应定期调用 updateMaps() 或启动此轮询。
   */
  startPolling(): void {
    this.stopPolling()
    // NOTE: 实际的轮询需要比较目录内容，这需要完整的文件系统
    // 访问权限。目前，轮询仅是一个占位符。
    // TODO-4.E.1: 实现目录内容比较和自动操作排队。
  }

  /**
   * 停止轮询目录变更。
   */
  stopPolling(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  /**
   * 排队地图文件操作。
   *
   * OpenRA 对照: MapDirectoryTracker.AddMapAction()
   *
   * 规范化路径并将操作添加到队列。如果路径在子目录中，
   * 则折叠为顶层地图目录的更新操作。
   *
   * @param action — 操作类型（Add、Delete、Update）
   * @param fullpath — 受影响的文件的完整路径
   * @param oldFullPath — 重命名操作中的旧路径（可选）
   */
  addMapAction(
    action: 'Add' | 'Delete' | 'Update',
    fullpath: string,
    oldFullPath?: string,
  ): void {
    const actionValue =
      action === 'Add'
        ? MapAction.Add
        : action === 'Delete'
          ? MapAction.Delete
          : MapAction.Update

    this._dirty = true

    // 规范化路径：将子目录变更折叠为顶层地图目录更新
    const path = this.removeSubDirs(fullpath)
    if (path !== null) {
      if (fullpath === path) {
        this._mapActionQueue.set(path, actionValue)
      } else {
        // 在子目录中：始终视为更新
        this._mapActionQueue.set(path, MapAction.Update)
      }
    }

    // 处理重命名/移动的旧路径
    if (oldFullPath !== undefined) {
      const oldpath = this.removeSubDirs(oldFullPath)
      if (oldpath !== null) {
        if (oldFullPath === oldpath) {
          this._mapActionQueue.set(oldpath, MapAction.Delete)
        } else {
          this._mapActionQueue.set(oldpath, MapAction.Update)
        }
      }
    }
  }

  /**
   * 处理排队的操作并更新地图缓存。
   *
   * OpenRA 对照: MapDirectoryTracker.UpdateMaps(MapCache)
   *
   * 对于每个排队的操作：
   * - Delete：使匹配的 MapPreview 失效
   * - Update：使匹配的 MapPreview 失效并重新加载
   * - Add（新地图）：加载新地图
   *
   * @param mapCache — 要更新的地图缓存
   */
  updateMaps(mapCache: MapCacheLike): void {
    if (!this._dirty) {
      return
    }

    this._dirty = false

    for (const [path, action] of this._mapActionQueue) {
      // 查找路径和状态匹配的现有地图
      const map = this.findMapByPath(mapCache, path)

      if (map !== null) {
        if (action === MapAction.Delete) {
          console.warn(`${path} was deleted`)
          map.invalidate()
        } else {
          console.warn(`${path} was updated`)
          map.invalidate()
          const mapPath = path.replace(this.package.name + '/', '')
          mapCache.loadMap(mapPath, this.package, this.classification, map.uid)
        }
      } else {
        if (action !== MapAction.Delete) {
          console.warn(`${path} was added`)
          const mapPath = path.replace(this.package.name + '/', '')
          mapCache.loadMap(mapPath, this.package, this.classification, null)
        }
      }
    }

    this._mapActionQueue.clear()
  }

  /**
   * 通过路径在地图缓存中查找地图。
   *
   * OpenRA 对照: mapcache.FirstOrDefault(x => x.Path == mapAction.Key && x.Status == MapStatus.Available)
   *
   * @param mapCache — 要搜索的地图缓存
   * @param path — 要匹配的路径
   * @returns 匹配的 MapPreview，如果未找到则返回 null
   */
  private findMapByPath(mapCache: MapCacheLike, path: string): import('./MapPreview.js').MapPreview | null {
    for (const preview of mapCache) {
      if (preview.path === path && preview.status === MapStatus.Available) {
        return preview
      }
    }
    return null
  }

  /**
   * 从路径中移除子目录，返回相对于包根目录的规范化路径。
   *
   * OpenRA 对照: MapDirectoryTracker.RemoveSubDirs()
   *
   * @param path — 要规范化的路径
   * @returns 规范化路径，如果路径在包外部则返回 null
   */
  removeSubDirs(path: string): string | null {
    const prefix = this.package.name + '/'
    const endPath = path.replace(prefix, '')

    // 如果文件从目录外部移动而来，则忽略
    if (path === endPath) {
      return null
    }

    // 返回包根目录 + 顶层目录名称
    return this.package.name + '/' + endPath.split('/')[0]
  }

  /**
   * 释放此跟踪器持有的资源。
   *
   * OpenRA 对照: IDisposable.Dispose()
   */
  dispose(): void {
    this.stopPolling()
    this._mapActionQueue.clear()
  }
}
