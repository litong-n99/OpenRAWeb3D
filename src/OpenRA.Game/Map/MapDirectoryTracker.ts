/**
 * MapDirectoryTracker.ts -- 地图目录变更跟踪器
 * OpenRA 对照: OpenRA.Game/Map/MapDirectoryTracker.cs
 *
 * 核心范式转换:
 * - C# FileSystemWatcher → 基于轮询的模型（浏览器无原生文件系统监视器）
 * - C# lock(mapActionQueue) → 不需要（JavaScript 单线程）
 * - C# Dictionary<string, MapAction> → Map<string, MapAction>
 * - C# Path.DirectorySeparatorChar → '/'（浏览器标准化）
 * - C# IDisposable → dispose() 方法
 * - C# 文件变更事件回调 → Map<string, ChangeCallback[]> 事件注册系统
 *
 * TODO-4.E.1: 实现目录内容比较和自动操作排队。
 */

import type { IReadOnlyPackage } from '../FileSystem/IReadOnlyPackage.js'
import type { MapClassification } from './MapPreview.js'
import { MapStatus } from './MapPreview.js'

// ---------------------------------------------------------------------------
// Forward reference to avoid circular dependency with MapCache
// ---------------------------------------------------------------------------

/** MapCache 的最小接口 -- 仅包含 MapDirectoryTracker 所需的方法。 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MapCacheLike {
  loadMap(
    map: string,
    package_: IReadOnlyPackage,
    classification: MapClassification,
    oldMap: string | null,
  ): void
  [Symbol.iterator](): Iterator<import('./MapPreview.js').MapPreview>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * 地图变更事件的类型。
 *
 * OpenRA 对照: 源自 FileSystemWatcher 事件
 */
export type MapChangeType = 'add' | 'delete' | 'update'

/**
 * 地图变更事件数据。
 */
export interface MapChangeEvent {
  /** 变更类型。 */
  type: MapChangeType
  /** 受影响的文件路径。 */
  path: string
  /** 旧路径（仅用于重命名事件）。 */
  oldPath?: string
}

/**
 * 地图变更事件的回调函数签名。
 */
export type MapChangeCallback = (event: MapChangeEvent) => void

// ---------------------------------------------------------------------------
// MapAction enum
// ---------------------------------------------------------------------------

/**
 * 地图文件操作类型（内部使用）。
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
// FileSnapshot -- 轮询比较用的文件快照
// ---------------------------------------------------------------------------

/**
 * 单个文件的快照数据，用于比较轮询之间的变更。
 */
interface FileSnapshot {
  /** 文件路径。 */
  path: string
  /** 内容哈希（如果有；否则为 null）。 */
  hash: string | null
}

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
 * - startPolling() / stopPolling() 管理周期性轮询
 * - 消费者可以注册变更回调来接收实时通知
 */
export class MapDirectoryTracker {
  /** 此跟踪器监视的包。 */
  readonly package: IReadOnlyPackage

  /** 此包中地图的分类。 */
  readonly classification: MapClassification

  /** 操作队列：路径 --> 操作类型。 */
  private readonly _mapActionQueue = new Map<string, MapAction>()

  /** 队列是否有待处理的操作。 */
  private _dirty = false

  /** 轮询间隔（毫秒）。默认 5000 毫秒。 */
  readonly pollingInterval: number

  /** 轮询间隔计时器句柄（如果有）。 */
  private _pollTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 注册的变更回调列表。
   * 每个变更类型可以注册多个回调。
   */
  private readonly _callbacks = new Map<
    MapChangeType | '*',
    MapChangeCallback[]
  >()

  /**
   * 上次轮询的文件快照（用于检测变更）。
   * null 表示尚未进行初始轮询。
   */
  private _lastSnapshot: FileSnapshot[] | null = null

  /**
   * 是否为首次轮询（跳过新增事件的触发）。
   */
  private _isFirstPoll = true

  /**
   * 构造 MapDirectoryTracker。
   *
   * OpenRA 对照: MapDirectoryTracker(IReadOnlyPackage, MapClassification)
   *
   * @param package_ -- 要监视的包
   * @param classification -- 此包中地图的分类
   * @param pollingInterval -- 轮询间隔（毫秒，默认 5000）
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

  // ---------------------------------------------------------------------------
  // Callback registration
  // ---------------------------------------------------------------------------

  /**
   * 注册地图变更事件的回调。
   *
   * 监听指定变更类型的事件。使用 `'*'` 监听所有事件类型。
   * 回调在每次轮询检测到变更时调用，以及在显式调用
   * addMapAction() 时调用。
   *
   * @param eventType -- 要监听的事件类型，或 '*' 表示所有类型
   * @param callback -- 事件回调函数
   * @returns 调用以取消注册的函数
   */
  on(
    eventType: MapChangeType | '*',
    callback: MapChangeCallback,
  ): () => void {
    const list = this._callbacks.get(eventType)
    if (list) {
      list.push(callback)
    } else {
      this._callbacks.set(eventType, [callback])
    }

    // 返回取消注册函数
    return () => {
      const currentList = this._callbacks.get(eventType)
      if (currentList) {
        const idx = currentList.indexOf(callback)
        if (idx >= 0) currentList.splice(idx, 1)
      }
    }
  }

  /**
   * 向所有已注册的监听器触发变更事件。
   *
   * @param event -- 要触发的变更事件
   */
  private emit(event: MapChangeEvent): void {
    const typeListeners = this._callbacks.get(event.type)
    if (typeListeners) {
      for (const cb of typeListeners) cb(event)
    }

    const wildcardListeners = this._callbacks.get('*')
    if (wildcardListeners) {
      for (const cb of wildcardListeners) cb(event)
    }
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  /**
   * 开始轮询目录变更。
   *
   * OpenRA 对照: FileSystemWatcher.EnableRaisingEvents = true
   *
   * 按 {@link pollingInterval} 毫秒的间隔设置周期性计时器。
   * 每个间隔：
   * 1. 获取当前目录列表（包内容的快照）
   * 2. 与上一快照比较以检测新增、删除和更新
   * 3. 将检测到的变更作为操作排队
   * 4. 触发已注册的回调
   *
   * 首次轮询建立基线（不触发新增事件）。
   * 如果轮询已在运行，调用此方法是无害的（先停止再重启）。
   *
   * @param intervalMs -- 可选，覆盖默认轮询间隔
   */
  startPolling(intervalMs?: number): void {
    this.stopPolling()

    const interval = intervalMs ?? this.pollingInterval

    this._pollTimer = setInterval(() => {
      this.pollOnce().catch((err: unknown) => {
        // 优雅地处理错误 -- 单个轮询失败不应使定时器崩溃
        // 网络/CORS 问题被静默记录
        const message =
          err instanceof Error ? err.message : String(err)
        console.warn(
          `[MapDirectoryTracker] Poll failed for "${this.package.name}": ${message}`,
        )
      })
    }, interval)
  }

  /**
   * 停止轮询目录变更。
   *
   * 如果未在轮询，调用此方法是安全的（无操作）。
   */
  stopPolling(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer)
      this._pollTimer = null
    }
  }

  /**
   * 是否正在轮询。
   */
  get isPolling(): boolean {
    return this._pollTimer !== null
  }

  /**
   * 执行单次轮询周期。
   *
   * 获取当前目录列表，与上次快照比较，检测变更，并对操作排队。
   *
   * @returns 解析为 void 的 Promise
   */
  async pollOnce(): Promise<void> {
    // 获取当前目录列表
    const currentFiles = this.getCurrentListing()

    // 首次轮询：记录基线，不触发事件
    if (this._isFirstPoll) {
      this._lastSnapshot = currentFiles
      this._isFirstPoll = false
      return
    }

    const previous = this._lastSnapshot ?? []
    this._lastSnapshot = currentFiles

    const prevPaths = new Set(previous.map((f) => f.path))
    const currPaths = new Set(currentFiles.map((f) => f.path))

    // 检测新增的文件
    for (const file of currentFiles) {
      if (!prevPaths.has(file.path)) {
        if (this.isMapFile(file.path)) {
          this.addMapAction('Add', this.package.name + '/' + file.path)
          this.emit({
            type: 'add',
            path: this.package.name + '/' + file.path,
          })
        }
      }
    }

    // 检测删除的文件
    for (const file of previous) {
      if (!currPaths.has(file.path)) {
        if (this.isMapFile(file.path)) {
          this.addMapAction('Delete', this.package.name + '/' + file.path)
          this.emit({
            type: 'delete',
            path: this.package.name + '/' + file.path,
          })
        }
      }
    }

    // 检测更新的文件（存在于两者中，但哈希发生了变化）
    for (const file of currentFiles) {
      if (prevPaths.has(file.path)) {
        const prevFile = previous.find((f) => f.path === file.path)
        if (prevFile && file.hash !== null && file.hash !== prevFile.hash) {
          if (this.isMapFile(file.path)) {
            this.addMapAction('Update', this.package.name + '/' + file.path)
            this.emit({
              type: 'update',
              path: this.package.name + '/' + file.path,
            })
          }
        }
      }
    }
  }

  /**
   * 获取包的当前文件列表作为快照数组。
   *
   * 遍历包的可访问内容并为每个文件创建 FileSnapshot 条目。
   * 哈希基于文件名 + 索引（一种简单的指纹方案；
   * 当底层包暴露文件大小/mtime 元数据时可以增强）。
   *
   * @returns FileSnapshot 条目的数组
   */
  private getCurrentListing(): FileSnapshot[] {
    const contents = this.package.contents
    const result: FileSnapshot[] = []
    for (let i = 0; i < contents.length; i++) {
      // 使用文件名 + 索引作为简单的哈希指纹
      // 如果平台暴露文件大小/mtime，这可以增强
      const hash = this.computeSimpleHash(contents[i] + ':' + i)
      result.push({ path: contents[i], hash })
    }
    return result
  }

  /**
   * 计算给定输入的简单确定性哈希。
   *
   * 使用 djb2 算法（与 MapPreview.computeUid 一致）。
   *
   * @param input -- 要哈希的字符串
   * @returns 十六进制哈希字符串
   */
  private computeSimpleHash(input: string): string {
    let hash = 5381
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
  }

  /**
   * 检查文件是否为地图文件（基于扩展名）。
   *
   * 支持 .oramap 和基于目录的地图。
   * 用于过滤轮询过程中检测到的文件。
   *
   * @param filename -- 要检查的文件名
   * @returns 如果文件看起来像地图文件则返回 true
   */
  private isMapFile(filename: string): boolean {
    // 基于目录的地图 -- 检查文件名是否像是地图标识符
    // .oramap 文件是压缩地图
    // 没有常见扩展名的目录可能是旧格式/未压缩的地图
    // NOTE: Matches all files without dots (.oramap files and directories).
    // Non-map extensionless files in map dirs would be incorrectly matched.
    return (
      filename.endsWith('.oramap') ||
      !filename.includes('.')
    )
  }

  // ---------------------------------------------------------------------------
  // Action queuing
  // ---------------------------------------------------------------------------

  /**
   * 排队地图文件操作。
   *
   * OpenRA 对照: MapDirectoryTracker.AddMapAction()
   *
   * 规范化路径并将操作添加到队列。如果路径在子目录中，
   * 则折叠为顶层地图目录的更新操作。
   *
   * @param action -- 操作类型（Add、Delete、Update）
   * @param fullpath -- 受影响的文件的完整路径
   * @param oldFullPath -- 重命名操作中的旧路径（可选）
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
   * @param mapCache -- 要更新的地图缓存
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
          mapCache.loadMap(
            mapPath,
            this.package,
            this.classification,
            map.uid,
          )
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

  // ---------------------------------------------------------------------------
  // Path utilities
  // ---------------------------------------------------------------------------

  /**
   * 通过路径在地图缓存中查找地图。
   *
   * OpenRA 对照: mapcache.FirstOrDefault(x => x.Path == mapAction.Key && x.Status == MapStatus.Available)
   *
   * @param mapCache -- 要搜索的地图缓存
   * @param path -- 要匹配的路径
   * @returns 匹配的 MapPreview，如果未找到则返回 null
   */
  private findMapByPath(
    mapCache: MapCacheLike,
    path: string,
  ): import('./MapPreview.js').MapPreview | null {
    for (const preview of mapCache) {
      if (
        preview.path === path &&
        preview.status === MapStatus.Available
      ) {
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
   * @param path -- 要规范化的路径
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

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * 释放此跟踪器持有的资源。
   *
   * OpenRA 对照: IDisposable.Dispose()
   *
   * 停止轮询（如果正在运行），清除操作队列，移除所有注册的回调。
   */
  dispose(): void {
    this.stopPolling()
    this._mapActionQueue.clear()
    this._callbacks.clear()
    this._lastSnapshot = null
    this._isFirstPoll = true
  }
}
