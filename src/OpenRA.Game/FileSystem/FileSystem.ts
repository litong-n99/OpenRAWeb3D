/**
 * FileSystem.ts — 分层虚拟文件系统 (VFS) 管理器
 * OpenRA 对照: OpenRA.Game/FileSystem/FileSystem.cs
 *
 * 核心范式转换:
 * - C# IReadOnlyFileSystem (同步 Stream) → IReadOnlyFileSystem (异步 ArrayBuffer)
 * - C# Cache<string, List<IReadOnlyPackage>> → Map<string, IReadOnlyPackage[]>
 * - C# Dictionary<IReadOnlyPackage, int> refcount → Map<IReadOnlyPackage, number>
 * - C# Mount(name: string) 本地路径 → mountFromBuffer(name, data) / mountPackage
 * - C# Open(string) 抛出 FileNotFoundException → openAsync 返回 null
 * - C# GetFromCache (单层) → 四级缓存: L1 LRU → L2 IndexedDB → L3 Cache API → L4 fetch
 *   (RESOLVED P1-D.3: L2 IndexedDB + L3 Cache API 已实现，带版本标记和 TTL)
 * - C# explicitMounts "modid|path" → 相同的字符串命名空间
 */

import type { IReadOnlyPackage, IReadOnlyFileSystem, IPackageLoader } from './IPackage.js'
import { ZipFileLoader } from './ZipFile.js'
import { Log, LogLevel } from '../Utils/Log.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** L1 内存缓存默认最大容量（字节）。OpenRA 对照: 无（浏览器端新增） */
const DEFAULT_L1_CACHE_SIZE = 100 * 1024 * 1024 // 100 MB

// ---------------------------------------------------------------------------
// LRU Node (内部使用 — 双向链表节点)
// ---------------------------------------------------------------------------

interface LruNode {
  key: string
  data: ArrayBuffer
  size: number
  prev: LruNode | null
  next: LruNode | null
}

// ---------------------------------------------------------------------------
// Cache Layer Abstraction
// ---------------------------------------------------------------------------

/**
 * 缓存层元数据（用于版本和 TTL 管理）。
 * OpenRA 对照: 无（浏览器端新增缓存管理）
 */
interface CacheEntryMeta {
  /** 包版本标记（用于失效）。 */
  version: string
  /** 缓存创建时间（Unix timestamp，毫秒）。 */
  createdAt: number
  /** TTL（毫秒），超过后缓存过期。0 表示永不过期。 */
  ttl: number
}

/**
 * 缓存层条目。
 */
interface CacheEntry {
  /** 原始包二进制数据。 */
  data: ArrayBuffer
  /** 关联的元数据。 */
  meta: CacheEntryMeta
}

/**
 * 持久化缓存层抽象接口。
 *
 * 每个缓存层可以有不同的存储后端（IndexedDB, Cache API 等），
 * 但共享相同的 get/set/delete/clear 契约。
 */
interface CacheLayer {
  /** 缓存层名称（用于调试和日志）。 */
  readonly name: string

  /**
   * 通过键检索缓存条目。
   * @param key — 缓存键
   * @returns 缓存条目，如果未找到或出错则返回 null
   */
  get(key: string): Promise<CacheEntry | null>

  /**
   * 存储缓存条目。
   * @param key — 缓存键
   * @param entry — 要存储的条目
   */
  set(key: string, entry: CacheEntry): Promise<void>

  /**
   * 删除整个缓存条目。
   * @param key — 缓存键
   */
  delete(key: string): Promise<void>

  /** 清除此缓存层中的所有条目。 */
  clear(): Promise<void>
}

// ---------------------------------------------------------------------------
// Cache Entry Serde
// ---------------------------------------------------------------------------

/**
 * 将 CacheEntry 序列化为 ArrayBuffer（用于 IndexedDB 存储）。
 *
 * 格式：[versionLen:u32][version:utf8][createdAt:f64][ttl:f64][data:...]
 */
function serializeCacheEntry(entry: CacheEntry): ArrayBuffer {
  const versionBytes = new TextEncoder().encode(entry.meta.version)
  // layout: 4 (versionLen) + versionBytes + 8 (createdAt) + 8 (ttl) + data
  const headerSize = 4 + versionBytes.byteLength + 8 + 8
  const totalSize = headerSize + entry.data.byteLength
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const u8 = new Uint8Array(buffer)

  let offset = 0
  view.setUint32(offset, versionBytes.byteLength, true)
  offset += 4
  u8.set(versionBytes, offset)
  offset += versionBytes.byteLength
  view.setFloat64(offset, entry.meta.createdAt, true)
  offset += 8
  view.setFloat64(offset, entry.meta.ttl, true)
  offset += 8
  u8.set(new Uint8Array(entry.data), offset)

  return buffer
}

/**
 * 从 ArrayBuffer 反序列化 CacheEntry。
 * @returns CacheEntry 或 null（如果数据损坏）
 */
function deserializeCacheEntry(buffer: ArrayBuffer): CacheEntry | null {
  try {
    const view = new DataView(buffer)

    let offset = 0
    const versionLen = view.getUint32(offset, true)
    offset += 4
    if (offset + versionLen > buffer.byteLength) return null
    const version = new TextDecoder().decode(buffer.slice(offset, offset + versionLen))
    offset += versionLen
    if (offset + 8 > buffer.byteLength) return null
    const createdAt = view.getFloat64(offset, true)
    offset += 8
    if (offset + 8 > buffer.byteLength) return null
    const ttl = view.getFloat64(offset, true)
    offset += 8
    const data = buffer.slice(offset) as ArrayBuffer

    return {
      data,
      meta: { version, createdAt, ttl },
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// L2: IndexedDB Cache
// ---------------------------------------------------------------------------

/**
 * L2 缓存层 — 使用 IndexedDB 存储已解析的包数据。
 *
 * 浏览器端 IndexedDB 提供持久化、大容量（通常 > 50 MB）的键值存储。
 * 对已解析的包（如 MOD 包、通用存档）使用此层，以避免重新下载/解析。
 *
 * 优雅降级：如果 IndexedDB 不可用或超过配额，get() 返回 null，
 * set() 静默失败（不阻断主流程）。
 */
class IndexedDBCache implements CacheLayer {
  readonly name = 'L2-IndexedDB'

  private readonly _dbName: string
  private _db: IDBDatabase | null = null
  private _dbPromise: Promise<IDBDatabase | null> | null = null
  private readonly _storeName = 'packages'

  constructor(dbName = 'openra-packages') {
    this._dbName = dbName
  }

  /**
   * 打开（或创建）IndexedDB 数据库。懒加载 — 首次访问时打开。
   */
  private async _openDB(): Promise<IDBDatabase | null> {
    if (this._db) return this._db

    if (!this._dbPromise) {
      this._dbPromise = new Promise((resolve) => {
        try {
          const request = indexedDB.open(this._dbName, 1)
          request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(this._storeName)) {
              db.createObjectStore(this._storeName)
            }
          }
          request.onsuccess = () => {
            this._db = request.result
            resolve(this._db)
          }
          request.onerror = () => {
            Log.write('filesystem', LogLevel.WARN,
              `L2 IndexedDB: failed to open "${this._dbName}": ${request.error?.message}`)
            resolve(null)
          }
          request.onblocked = () => {
            Log.write('filesystem', LogLevel.WARN,
              `L2 IndexedDB: blocked opening "${this._dbName}"`)
            resolve(null)
          }
        } catch (e) {
          Log.write('filesystem', LogLevel.WARN,
            `L2 IndexedDB: not available: ${String(e)}`)
          resolve(null)
        }
      })
    }

    return this._dbPromise
  }

  async get(key: string): Promise<CacheEntry | null> {
    try {
      const db = await this._openDB()
      if (!db) return null

      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this._storeName, 'readonly')
          const store = tx.objectStore(this._storeName)
          const request = store.get(key)
          request.onsuccess = () => {
            const raw = request.result as ArrayBuffer | undefined
            if (raw && raw.byteLength > 0) {
              resolve(deserializeCacheEntry(raw))
            } else {
              resolve(null)
            }
          }
          request.onerror = () => {
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      })
    } catch {
      return null
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    try {
      const db = await this._openDB()
      if (!db) return

      const buffer = serializeCacheEntry(entry)

      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this._storeName, 'readwrite')
          const store = tx.objectStore(this._storeName)
          // NOTE: 超过配额时 put 会失败；我们捕获并静默退出
          tx.oncomplete = () => resolve()
          tx.onerror = () => {
            Log.write('filesystem', LogLevel.WARN,
              `L2 IndexedDB: store failed for "${key}": ${tx.error?.message}`)
            resolve()
          }
          tx.onabort = () => {
            Log.write('filesystem', LogLevel.WARN,
              `L2 IndexedDB: transaction aborted for "${key}"`)
            resolve()
          }
          try {
            store.put(buffer, key)
          } catch (err) {
            // 配额超出或序列化失败
            Log.write('filesystem', LogLevel.WARN,
              `L2 IndexedDB: put() failed for "${key}": ${String(err)}`)
            resolve()
          }
        } catch {
          resolve()
        }
      })
    } catch {
      // 静默失败
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const db = await this._openDB()
      if (!db) return

      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this._storeName, 'readwrite')
          const store = tx.objectStore(this._storeName)
          store.delete(key)
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
          tx.onabort = () => resolve()
        } catch {
          resolve()
        }
      })
    } catch {
      // 静默失败
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this._openDB()
      if (!db) return

      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this._storeName, 'readwrite')
          const store = tx.objectStore(this._storeName)
          store.clear()
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
          tx.onabort = () => resolve()
        } catch {
          resolve()
        }
      })
    } catch {
      // 静默失败
    }
  }
}

// ---------------------------------------------------------------------------
// L3: Cache API Cache
// ---------------------------------------------------------------------------

/**
 * L3 缓存层 — 使用浏览器 Cache API 存储原始包二进制数据。
 *
 * Cache API 专为 HTTP 响应缓存设计，但对二进制存储同样有效。
 * 与 IndexedDB 相比，缓存条目大小限制更宽松（通常 >= 100 MB）。
 *
 * 优雅降级：如果 Cache API 不可用，get() 返回 null，set() 静默失败。
 */
class CacheAPICache implements CacheLayer {
  readonly name = 'L3-CacheAPI'

  private readonly _cacheName: string
  private _cachePromise: Promise<Cache | null> | null = null

  constructor(cacheName = 'openra-packages') {
    this._cacheName = cacheName
  }

  private async _open(): Promise<Cache | null> {
    if (typeof caches === 'undefined' || !caches) return null

    if (!this._cachePromise) {
      this._cachePromise = caches.open(this._cacheName).catch((e) => {
        Log.write('filesystem', LogLevel.WARN,
          `L3 CacheAPI: failed to open "${this._cacheName}": ${String(e)}`)
        return null
      })
    }
    return this._cachePromise
  }

  /** 将缓存键转换为有效的请求 URL 路径。 */
  private _toRequest(key: string): Request {
    return new Request(`https://local.openra/${encodeURIComponent(key)}`)
  }

  async get(key: string): Promise<CacheEntry | null> {
    try {
      const cache = await this._open()
      if (!cache) return null

      const response = await cache.match(this._toRequest(key))
      if (!response) return null

      // 从响应头提取元数据
      const version = response.headers.get('x-pkg-version') ?? 'unknown'
      const createdAtStr = response.headers.get('x-pkg-created-at')
      const createdAt = createdAtStr ? Number(createdAtStr) : Date.now()
      const ttlStr = response.headers.get('x-pkg-ttl')
      const ttl = ttlStr ? Number(ttlStr) : 0

      const data = await response.arrayBuffer()

      return {
        data,
        meta: { version, createdAt, ttl },
      }
    } catch {
      return null
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    try {
      const cache = await this._open()
      if (!cache) return

      // 将元数据嵌入响应头
      const headers = new Headers({
        'Content-Type': 'application/octet-stream',
        'x-pkg-version': entry.meta.version,
        'x-pkg-created-at': String(entry.meta.createdAt),
        'x-pkg-ttl': String(entry.meta.ttl),
      })
      const response = new Response(entry.data, { headers })
      await cache.put(this._toRequest(key), response)
    } catch {
      // 静默失败 — 不阻断主流程
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const cache = await this._open()
      if (!cache) return
      await cache.delete(this._toRequest(key))
    } catch {
      // 静默失败
    }
  }

  async clear(): Promise<void> {
    try {
      const cache = await this._open()
      if (!cache) return
      // Cache API 没有 clear()；删除并重新创建
      if (typeof caches !== 'undefined' && caches) {
        await caches.delete(this._cacheName)
        this._cachePromise = null
      }
    } catch {
      // 静默失败
    }
  }
}

// ---------------------------------------------------------------------------
// FileSystem
// ---------------------------------------------------------------------------

/**
 * 分层虚拟文件系统 — 多个包的聚合视图，具有优先级覆盖语义。
 *
 * OpenRA 对照: OpenRA.FileSystem.FileSystem
 *
 * "最后挂载的包具有最高优先级" — 如果多个包包含同名文件，
 * 最后挂载的包的文件将被返回。
 *
 * ```
 * 挂载顺序: PackageA → PackageB → PackageC
 * 文件 "example.yaml" 在 PackageA 和 PackageC 中都存在
 * → openAsync("example.yaml") 返回 PackageC 的版本
 * ```
 */
export class FileSystem implements IReadOnlyFileSystem {
  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  /** 已注册的包加载器（按优先级顺序）。OpenRA 对照: packageLoaders */
  private _packageLoaders: IPackageLoader[]

  /** 已挂载包 → 引用计数。OpenRA 对照: mountedPackages */
  private _mountedPackages = new Map<IReadOnlyPackage, number>()

  /** 显式挂载名 → 包。OpenRA 对照: explicitMounts */
  private _explicitMounts = new Map<string, IReadOnlyPackage>()

  /** 文件名 → 包含该文件的包列表（最后一项 = 最高优先级）。OpenRA 对照: fileIndex */
  private _fileIndex = new Map<string, IReadOnlyPackage[]>()

  /** MOD 拥有的包（不应由 FileSystem dispose）。OpenRA 对照: modPackages */
  private _modPackages = new Set<IReadOnlyPackage>()

  /**
   * 已尝试挂载的名称集合（无论成功或失败）。
   * 用于防止重复挂载：名称加入此集合后，后续 mount() 调用将直接返回。
   *
   * 这解决了双重挂载循环问题 — 当 Game.loadMod() 和 ModData.init()
   * 都遍历 manifest.mounts 并调用 mount() 时，第二次调用是无操作。
   */
  private _attemptedMounts = new Set<string>()

  // -----------------------------------------------------------------------
  // L1 LRU Cache
  // -----------------------------------------------------------------------

  /** L1 内存缓存：键 → 链表节点。 */
  private _l1Cache = new Map<string, LruNode>()

  /** LRU 链表头（最近使用）。 */
  private _lruHead: LruNode | null = null

  /** LRU 链表尾（最久未使用）。 */
  private _lruTail: LruNode | null = null

  /** 当前缓存大小（字节）。 */
  private _l1CacheSize = 0

  /** 最大缓存大小（字节）。 */
  private _l1CacheMaxSize: number

  // -----------------------------------------------------------------------
  // L2 / L3 Cache Layers (RESOLVED P1-D.3)
  // -----------------------------------------------------------------------

  /** L2 缓存：IndexedDB（已解析的包）。 */
  private readonly _l2Cache: IndexedDBCache

  /** L3 缓存：Cache API（原始二进制数据）。 */
  private readonly _l3Cache: CacheAPICache

  /** 缓存是否启用（通过 dispose/测试关闭时设为 false）。 */
  private _cachingEnabled = true

  /** 默认包缓存 TTL（毫秒）。默认 7 天。 */
  private readonly _defaultTTL: number

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * 创建一个文件系统实例。
   *
   * OpenRA 对照: FileSystem(string modID, IReadOnlyDictionary installedMods, IPackageLoader[] packageLoaders)
   *
   * @param packageLoaders — 注册的包加载器（可选，默认包含 ZipFileLoader）
   * @param l1CacheMaxSize — L1 内存缓存最大容量（字节），默认 100 MB
   * @param options — 可选的缓存配置
   * @param options.l2DbName — L2 IndexedDB 数据库名，默认 'openra-packages'
   * @param options.l3CacheName — L3 Cache API 缓存名，默认 'openra-packages'
   * @param options.defaultTTL — 默认包缓存 TTL（毫秒），默认 7 天（604800000）
   * @param options.cachingEnabled — 是否启用 L2/L3 缓存，默认 true
   */
  constructor(
    packageLoaders?: IPackageLoader[],
    l1CacheMaxSize: number = DEFAULT_L1_CACHE_SIZE,
    options?: {
      l2DbName?: string
      l3CacheName?: string
      defaultTTL?: number
      cachingEnabled?: boolean
    },
  ) {
    this._packageLoaders = packageLoaders
      ? [...packageLoaders]
      : [new ZipFileLoader()]
    this._l1CacheMaxSize = l1CacheMaxSize
    this._l2Cache = new IndexedDBCache(options?.l2DbName ?? 'openra-packages')
    this._l3Cache = new CacheAPICache(options?.l3CacheName ?? 'openra-packages')
    this._defaultTTL = options?.defaultTTL ?? 7 * 24 * 60 * 60 * 1000 // 7 days
    this._cachingEnabled = options?.cachingEnabled ?? true
  }

  // -----------------------------------------------------------------------
  // Package Loader Management
  // -----------------------------------------------------------------------

  /**
   * 注册额外的包加载器。新加载器追加到末尾（优先级最低）。
   *
   * @param loader — 包加载器实例
   */
  registerLoader(loader: IPackageLoader): void {
    this._packageLoaders.push(loader)
  }

  /**
   * 获取已注册的加载器列表（只读）。
   */
  get packageLoaders(): readonly IPackageLoader[] {
    return this._packageLoaders
  }

  // -----------------------------------------------------------------------
  // Package Parsing
  // -----------------------------------------------------------------------

  /**
   * 尝试使用已注册的加载器将二进制流解析为包。
   *
   * OpenRA 对照: FileSystem.TryParsePackage(Stream, string, out IReadOnlyPackage)
   *
   * 按注册顺序尝试每个加载器。第一个匹配的加载器获胜。
   *
   * @param stream — 二进制包数据
   * @param filename — 文件名（用于扩展名检查）
   * @returns 解析的包，如果没有加载器识别格式则返回 null
   */
  tryParsePackage(stream: ArrayBuffer, filename: string): IReadOnlyPackage | null {
    for (const loader of this._packageLoaders) {
      const pkg = loader.tryParsePackage(filename, stream, this)
      if (pkg) return pkg
    }
    return null
  }

  // -----------------------------------------------------------------------
  // Mounting — Buffer
  // -----------------------------------------------------------------------

  /**
   * 从原始缓冲区数据挂载包。
   *
   * OpenRA 对照: 组合了 FileSystem.OpenPackage + Mount
   *
   * 首先尝试将缓冲区解析为包，然后挂载解析后的包。
   *
   * @param name — 包的逻辑名称
   * @param data — 原始包数据
   * @param explicitName — 可选的显式挂载名称（用于 "modid|path" 路径解析）
   * @returns 挂载的包，如果解析失败则返回 null
   */
  mountFromBuffer(
    name: string,
    data: ArrayBuffer,
    explicitName?: string,
  ): IReadOnlyPackage | null {
    const pkg = this.tryParsePackage(data, name)
    if (!pkg) return null

    this.mountPackage(pkg, explicitName)
    return pkg
  }

  // -----------------------------------------------------------------------
  // Mounting — Package
  // -----------------------------------------------------------------------

  /**
   * 挂载一个已解析的包到文件系统。
   *
   * OpenRA 对照: FileSystem.Mount(IReadOnlyPackage, string)
   *
   * 如果包已经挂载，则递增引用计数并提升其所有文件的优先级
   * （将其在 fileIndex 列表中的位置移到最后）。
   *
   * @param pkg — 要挂载的包
   * @param explicitName — 可选的显式挂载名称
   */
  mountPackage(pkg: IReadOnlyPackage, explicitName?: string): void {
    const existingCount = this._mountedPackages.get(pkg)
    if (existingCount !== undefined) {
      // 包已挂载 — 递增引用计数并提升优先级
      this._mountedPackages.set(pkg, existingCount + 1)
      // 使缓存失效 — 优先级变化可能导致不同包提供文件
      for (const filename of pkg.contents) {
        this._removeFromCache(filename)
        const packages = this._fileIndex.get(filename)
        if (packages) {
          // 从当前位置移除并追加到末尾（最高优先级）
          const idx = packages.indexOf(pkg)
          if (idx >= 0) {
            packages.splice(idx, 1)
          }
          packages.push(pkg)
        }
      }
    } else {
      // 首次挂载
      this._mountedPackages.set(pkg, 1)

      if (explicitName !== undefined) {
        this._explicitMounts.set(explicitName, pkg)
      }

      for (const filename of pkg.contents) {
        let packages = this._fileIndex.get(filename)
        if (!packages) {
          packages = []
          this._fileIndex.set(filename, packages)
        }
        packages.push(pkg)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Mounting — URL (fetch-based)
  // -----------------------------------------------------------------------

  /**
   * 从 URL 获取并挂载一个包。使用四级缓存流水线。
   *
   * OpenRA 对照: FileSystem.Mount(string name, string explicitName = null)
   *   原方法从本地文件系统加载；此版本使用缓存感知的 fetch 流水线。
   *
   * 缓存流水线（L1 → L2 → L3 → L4）：
   * 1. L1: 内存 LRU 缓存（通过 _isInL1Cache 检查）
   * 2. L2: IndexedDB（已解析的包数据 — 跳过解析）
   * 3. L3: Cache API（原始二进制数据 — 跳过下载）
   * 4. L4: HTTP fetch（网络回退）
   *
   * 缓存命中时，数据向上层提升（write-back 策略）。
   * 版本标记用于缓存失效；TTL 用于过期检查。
   *
   * 以 '~' 开头的名称被视为可选挂载 — 如果无法获取或解析，
   * 不会抛出异常（静默返回）。
   *
   * @param name — 包的 URL 路径（可选 '~' 前缀表示可选挂载）
   * @param explicitName — 可选的显式挂载名称（"modid|path" 引用用）
   * @param options — 可选的缓存元数据
   * @param options.version — 包版本标记（用于缓存失效）
   * @param options.ttl — 覆盖默认 TTL（毫秒）
   *
   * @throws 如果获取或解析失败且 name 不以 '~' 开头
   */
  async mount(name: string, explicitName?: string, options?: {
    version?: string
    ttl?: number
  }): Promise<void> {
    // 可选的 '~' 前缀 — 挂载失败时不抛出异常
    const optional = name.startsWith('~')
    if (optional) name = name.slice(1)

    // 幂等性守卫：如果此名称已经尝试过挂载（成功或失败），直接返回。
    // 这防止了双重挂载循环（例如 Game.loadMod() 和 ModData.init()
    // 都遍历 manifest.mounts 时）。如果调用方需要强制重新挂载，
    // 应使用 mountPackage() 或 mountFromBuffer() 代替。
    if (this._attemptedMounts.has(name)) {
      // 如果之前是可选的且失败了，再次也应该是可选的（静默返回）
      return
    }
    this._attemptedMounts.add(name)

    const cacheKey = this._buildCacheKey(name, options?.version ?? 'unknown')

    try {
      // 1. L1 检查 — 如果包已经挂载在内存中，跳过
      const l1Data = this._checkL1Cache(cacheKey)
      if (l1Data) {
        const pkg = this.tryParsePackage(l1Data, name)
        if (pkg) {
          this.mountPackage(pkg, explicitName)
          this._addToCache(cacheKey, l1Data)
          return
        }
      }

      // 2. L2 检查 — IndexedDB（已解析的包）
      if (this._cachingEnabled) {
        const l2Data = await this._resolveCacheLayer(this._l2Cache, cacheKey, options?.ttl)
        if (l2Data) {
          // 缓存命中 — 提升到 L1
          Log.write('filesystem', LogLevel.DEBUG,
            `L2 cache hit for "${name}"`)
          const pkg = this.tryParsePackage(l2Data, name)
          if (pkg) {
            this._addToCache(cacheKey, l2Data)
            this.mountPackage(pkg, explicitName)
            return
          }
          // 无效的缓存数据 — 清除
          await this._l2Cache.delete(cacheKey)
        }
      }

      // 3. L3 检查 — Cache API（原始二进制）
      if (this._cachingEnabled) {
        const l3Data = await this._resolveCacheLayer(this._l3Cache, cacheKey, options?.ttl)
        if (l3Data) {
          Log.write('filesystem', LogLevel.DEBUG,
            `L3 cache hit for "${name}"`)
          // 提升到 L2 和 L1
          const pkg = this.tryParsePackage(l3Data, name)
          if (pkg) {
            const ttl = options?.ttl ?? this._defaultTTL
            this._addToCache(cacheKey, l3Data)
            this._promoteToCacheLayer(this._l2Cache, cacheKey, l3Data, options?.version ?? 'unknown', ttl)
            this.mountPackage(pkg, explicitName)
            return
          }
          await this._l3Cache.delete(cacheKey)
        }
      }

      // 4. L4 — 网络获取
      Log.write('filesystem', LogLevel.DEBUG,
        `L4 fetch for "${name}"`)
      const response = await fetch(name)
      if (!response.ok) {
        if (optional) {
          Log.write('filesystem', LogLevel.WARN,
            `Optional mount '${name}' not found (HTTP ${response.status}), skipping.`)
          return
        }
        throw new Error(`Failed to mount '${name}': HTTP ${response.status}`)
      }

      // 检测 SPA 回退响应（Vite dev server 对未知路径返回 HTML 首页）
      // 而非有效的二进制包数据。
      // 防御性访问 — response.headers 在 mock/测试中可能为 undefined。
      const contentType: string =
        (typeof response.headers?.get === 'function'
          ? response.headers.get('Content-Type') ?? ''
          : '')
      if (contentType.includes('text/html')) {
        Log.write('filesystem', LogLevel.WARN,
          `Mount '${name}': received HTML response instead of binary package data. ` +
          `This typically means the asset does not exist in the web build. ` +
          `(Hint: run 'npx tsx scripts/build-mods.ts' to rebuild mod assets.)`)
        if (optional) return
        // NOTE: 非可选挂载收到 HTML 时抛出明确的错误信息，
        // 但如果此路径已被标记为可选（以 '~' 开头），则静默跳过。
        throw new Error(
          `Could not open package '${name}': received HTML instead of package data. ` +
          `The file may not exist in the web build.`,
        )
      }

      const data = await response.arrayBuffer()

      // 额外的启发式检测：如果响应数据以 HTML 标记开头（即使
      // Content-Type 未正确设置），同样视为非包响应。
      if (data.byteLength > 0 && this._looksLikeHtml(data)) {
        Log.write('filesystem', LogLevel.WARN,
          `Mount '${name}': response data looks like HTML (SPA fallback), not a package.`)
        if (optional) return
        throw new Error(
          `Could not open package '${name}': response appears to be HTML, not a package.`,
        )
      }

      const pkg = this.tryParsePackage(data, name)
      if (!pkg) {
        if (optional) {
          Log.write('filesystem', LogLevel.WARN,
            `Optional mount '${name}': format not recognized, skipping.`)
          return
        }
        throw new Error(
          `Could not open package '${name}', format not recognized.`,
        )
      }

      // 提升到所有缓存层
      this._addToCache(cacheKey, data)
      if (this._cachingEnabled) {
        const ttl = options?.ttl ?? this._defaultTTL
        const version = options?.version ?? 'unknown'
        this._promoteToCacheLayer(this._l3Cache, cacheKey, data, version, ttl)
        this._promoteToCacheLayer(this._l2Cache, cacheKey, data, version, ttl)
      }

      this.mountPackage(pkg, explicitName)
    } catch (e) {
      if (optional) {
        Log.write('filesystem', LogLevel.WARN,
          `Optional mount '${name}' failed: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
      throw e
    }
  }

  /**
   * 将包标记为 MOD 拥有的包（unmount 时不 dispose）。
   *
   * OpenRA 对照: FileSystem 中的 modPackages 列表
   *
   * @param pkg — MOD 包
   */
  markAsModPackage(pkg: IReadOnlyPackage): void {
    this._modPackages.add(pkg)
  }

  // -----------------------------------------------------------------------
  // Unmounting
  // -----------------------------------------------------------------------

  /**
   * 卸载一个包。
   *
   * OpenRA 对照: FileSystem.Unmount(IReadOnlyPackage)
   *
   * 递减引用计数。当计数降为 0 时，从所有索引中完全移除包
   * 并调用 dispose()（除非该包是 MOD 包）。
   *
   * @param pkg — 要卸载的包
   * @returns 如果包已挂载并成功卸载则返回 true
   */
  unmount(pkg: IReadOnlyPackage): boolean {
    const mountCount = this._mountedPackages.get(pkg)
    if (mountCount === undefined) return false

    if (mountCount <= 1) {
      // 使 L1 缓存中与该包相关的文件失效，并从 fileIndex 中移除
      for (const filename of pkg.contents) {
        this._removeFromCache(filename)
        // 同时清除显式挂载键的缓存条目
        for (const prefix of this._explicitMounts.keys()) {
          if (this._explicitMounts.get(prefix) === pkg) {
            this._removeFromCache(prefix + '|' + filename)
          }
        }
        // 从 fileIndex 中定向移除（O(1) per file，避免全表扫描）
        const packages = this._fileIndex.get(filename)
        if (packages) {
          const idx = packages.indexOf(pkg)
          if (idx >= 0) packages.splice(idx, 1)
          if (packages.length === 0) this._fileIndex.delete(filename)
        }
      }

      // 从 mountedPackages 中移除
      this._mountedPackages.delete(pkg)

      // 从 explicitMounts 中移除
      for (const [key, value] of this._explicitMounts) {
        if (value === pkg) {
          this._explicitMounts.delete(key)
        }
      }

      // MOD 包不是我们创建的，不应 dispose
      if (!this._modPackages.delete(pkg)) {
        pkg.dispose()
      }
    } else {
      this._mountedPackages.set(pkg, mountCount - 1)
    }

    return true
  }

  /**
   * 卸载所有已挂载的包并释放资源。
   *
   * OpenRA 对照: FileSystem.UnmountAll()
   */
  unmountAll(): void {
    for (const pkg of this._mountedPackages.keys()) {
      if (!this._modPackages.has(pkg)) {
        pkg.dispose()
      }
    }
    this._mountedPackages.clear()
    this._explicitMounts.clear()
    this._modPackages.clear()
    this._fileIndex.clear()
    this._attemptedMounts.clear()
    this._clearCache()
  }

  // -----------------------------------------------------------------------
  // IReadOnlyFileSystem — openAsync
  // -----------------------------------------------------------------------

  /**
   * 异步打开文件，返回其内容。
   *
   * OpenRA 对照: IReadOnlyFileSystem.Open(string) + TryOpen(string, out Stream)
   *
   * 查询顺序：
   * 1. L1 内存缓存
   * 2. 显式挂载（"modid|path" 语法）
   * 3. fileIndex 中的最后挂载的包（最高优先级）
   *
   * 命中时更新 L1 缓存，未命中时填充。
   *
   * @param filename — 文件名（可能包含 "package|path" 前缀）
   * @returns 文件内容的 ArrayBuffer，如果未找到则返回 null
   */
  async openAsync(filename: string): Promise<ArrayBuffer | null> {
    // L1 缓存检查
    const cached = this._l1Cache.get(filename)
    if (cached) {
      this._touchLru(cached)
      return cached.data.slice(0) as ArrayBuffer
    }

    let result: ArrayBuffer | null = null

    // 1. 检查显式挂载 ("prefix|path" 语法)
    const pipeIdx = filename.indexOf('|')
    if (pipeIdx > 0) {
      const prefix = filename.slice(0, pipeIdx)
      const subPath = filename.slice(pipeIdx + 1)
      const explicitPkg = this._explicitMounts.get(prefix)
      if (explicitPkg) {
        result = await explicitPkg.open(subPath, this)
      }
      // 显式挂载失败 — 不回退到 fileIndex（避免使用无效的 '|' 字符）
      if (result) {
        this._addToCache(filename, result)
      }
      return result
    }

    // 2. 通过 fileIndex 查找（最后挂载的 = 最高优先级）
    const packages = this._fileIndex.get(filename)
    if (packages && packages.length > 0) {
      // 从最高优先级开始反向迭代
      for (let i = packages.length - 1; i >= 0; i--) {
        const pkg = packages[i]
        if (pkg.contains(filename)) {
          result = await pkg.open(filename, this)
          if (result) {
            this._addToCache(filename, result)
            return result
          }
        }
      }
    }

    return null
  }

  // -----------------------------------------------------------------------
  // IReadOnlyFileSystem — exists
  // -----------------------------------------------------------------------

  /**
   * 检查文件是否存在于任何已挂载的包中。
   *
   * OpenRA 对照: IReadOnlyFileSystem.Exists(string)
   *
   * @param filename — 文件名
   * @returns 如果文件存在则返回 true
   */
  exists(filename: string): boolean {
    // 检查显式挂载
    const pipeIdx = filename.indexOf('|')
    if (pipeIdx > 0) {
      const prefix = filename.slice(0, pipeIdx)
      const subPath = filename.slice(pipeIdx + 1)
      const explicitPkg = this._explicitMounts.get(prefix)
      if (explicitPkg) {
        return explicitPkg.contains(subPath)
      }
    }

    // 检查 fileIndex
    const packages = this._fileIndex.get(filename)
    if (!packages || packages.length === 0) return false

    // 任一包含该文件的包即可
    for (const pkg of packages) {
      if (pkg.contains(filename)) return true
    }
    return false
  }

  // -----------------------------------------------------------------------
  // IReadOnlyFileSystem — isMounted
  // -----------------------------------------------------------------------

  /**
   * 检查指定名称/路径是否有已挂载的包。
   *
   * OpenRA 对照: IReadOnlyFileSystem.IsExternalFile(string)
   *
   * 检查文件名是否存在于 explicitMounts 中（作为前缀）
   * 或 fileIndex 中。
   *
   * @param filename — 要检查的路径
   * @returns 如果路径对应已挂载内容则返回 true
   */
  isMounted(filename: string): boolean {
    // 检查显式挂载前缀
    const pipeIdx = filename.indexOf('|')
    if (pipeIdx > 0) {
      const prefix = filename.slice(0, pipeIdx)
      if (this._explicitMounts.has(prefix)) return true
    }

    return this._fileIndex.has(filename)
  }

  // -----------------------------------------------------------------------
  // L1 LRU Cache
  // -----------------------------------------------------------------------

  /**
   * 将条目添加到 L1 缓存。如果超过容量，驱逐 LRU 条目。
   *
   * @param key — 缓存键（通常是文件名）
   * @param data — 要缓存的数据
   */
  private _addToCache(key: string, data: ArrayBuffer): void {
    const size = data.byteLength

    // 如果单个条目大于最大缓存大小，不缓存
    if (size > this._l1CacheMaxSize) return

    // 驱逐条目直到有足够空间
    while (this._l1CacheSize + size > this._l1CacheMaxSize && this._lruTail) {
      this._evictLru()
    }

    // 创建新节点
    const node: LruNode = {
      key,
      data,
      size,
      prev: null,
      next: null,
    }

    // 插入到链表头部（最近使用）
    node.next = this._lruHead
    if (this._lruHead) {
      this._lruHead.prev = node
    }
    this._lruHead = node
    if (!this._lruTail) {
      this._lruTail = node
    }

    this._l1Cache.set(key, node)
    this._l1CacheSize += size
  }

  /**
   * 将缓存条目移到 LRU 链表头部（标记为最近使用）。
   */
  private _touchLru(node: LruNode): void {
    if (node === this._lruHead) return // 已在头部

    // 从当前位置移除
    if (node.prev) node.prev.next = node.next
    if (node.next) node.next.prev = node.prev
    if (node === this._lruTail) {
      this._lruTail = node.prev
    }

    // 插入到头部
    node.prev = null
    node.next = this._lruHead
    if (this._lruHead) {
      this._lruHead.prev = node
    }
    this._lruHead = node
    if (!this._lruTail) {
      this._lruTail = node
    }
  }

  /**
   * 驱逐最久未使用的缓存条目。
   */
  private _evictLru(): void {
    if (!this._lruTail) return

    const tail = this._lruTail

    // 从链表中移除尾部
    if (tail.prev) {
      tail.prev.next = null
    }
    this._lruTail = tail.prev
    if (this._lruHead === tail) {
      this._lruHead = null
    }

    // 从 Map 中移除
    this._l1Cache.delete(tail.key)
    this._l1CacheSize -= tail.size
  }

  /**
   * 从 L1 缓存中移除特定条目。
   */
  private _removeFromCache(key: string): void {
    const node = this._l1Cache.get(key)
    if (!node) return

    // 从链表中移除
    if (node.prev) node.prev.next = node.next
    if (node.next) node.next.prev = node.prev
    if (node === this._lruHead) this._lruHead = node.next
    if (node === this._lruTail) this._lruTail = node.prev

    // 从 Map 中移除
    this._l1Cache.delete(key)
    this._l1CacheSize -= node.size
  }

  /**
   * 清除 L1 缓存中的所有条目。
   */
  private _clearCache(): void {
    this._l1Cache.clear()
    this._lruHead = null
    this._lruTail = null
    this._l1CacheSize = 0
  }

  // -----------------------------------------------------------------------
  // Multi-Tier Cache Pipeline Helpers (RESOLVED P1-D.3)
  // -----------------------------------------------------------------------

  /**
   * 构建缓存键（URL + 版本标记）。
   *
   * 版本标记用于缓存失效：版本更改会导致不同的键，
   * 因此旧的缓存条目永远不会被访问。
   *
   * @param name — 包 URL
   * @param version — 版本标记
   * @returns 规范化的缓存键
   */
  private _buildCacheKey(name: string, version: string): string {
    return `pkg:${name}#v=${version}`
  }

  /**
   * 启发式检测 ArrayBuffer 是否包含 HTML 内容（SPA 回退响应）。
   *
   * Vite dev server 对未匹配任何路由的路径返回 index.html。
   * 如果 fetch 请求的是 .mix / .pak 等二进制包文件但收到 HTML，
   * 说明该资产在 web 构建中不存在。
   *
   * 检测方式：查看前 256 字节中是否包含 HTML 特征标记。
   *
   * @param data — 响应数据
   * @returns 如果数据看起来像 HTML 则返回 true
   */
  private _looksLikeHtml(data: ArrayBuffer): boolean {
    // 仅检查前 256 字节（足够包含 <!DOCTYPE html> 或 <html 等标记）
    const slice = data.byteLength > 256
      ? new Uint8Array(data, 0, 256)
      : new Uint8Array(data)
    // 转换为字符串进行检查
    const text = new TextDecoder().decode(slice).trim().toLowerCase()
    return text.startsWith('<!doctype') || text.startsWith('<html')
  }

  /**
   * 检查 L1 LRU 缓存中是否存在指定键的数据。
   *
   * @param key — 缓存键
   * @returns 缓存的数据，如果不存在则返回 null
   */
  private _checkL1Cache(key: string): ArrayBuffer | null {
    const node = this._l1Cache.get(key)
    if (node) {
      this._touchLru(node)
      return node.data.slice(0) as ArrayBuffer
    }
    return null
  }

  /**
   * 解析缓存层条目并检查 TTL 过期。
   *
   * @param layer — 要查询的缓存层
   * @param key — 缓存键
   * @param customTTL — 覆盖默认 TTL 检查（null 表示使用条目的 TTL）
   * @returns 有效的缓存数据，如果未命中或过期则返回 null
   */
  private async _resolveCacheLayer(
    layer: CacheLayer,
    key: string,
    customTTL?: number,
  ): Promise<ArrayBuffer | null> {
    try {
      const entry = await layer.get(key)
      if (!entry) return null

      // TTL 检查
      if (this._isEntryExpired(entry, customTTL)) {
        Log.write('filesystem', LogLevel.DEBUG,
          `Cache entry expired: "${key}" in ${layer.name}`)
        await layer.delete(key).catch(() => {})
        return null
      }

      return entry.data
    } catch {
      return null
    }
  }

  /**
   * 检查缓存条目是否已过期。
   *
   * @param entry — 缓存条目
   * @param customTTL — 覆盖使用的 TTL（如果提供）
   * @returns 如果条目已过期则返回 true
   */
  private _isEntryExpired(entry: CacheEntry, customTTL?: number): boolean {
    const ttl = customTTL ?? entry.meta.ttl
    if (ttl <= 0) return false // 永不过期
    const age = Date.now() - entry.meta.createdAt
    return age > ttl
  }

  /**
   * 将数据提升到缓存层（异步，fire-and-forget 错误处理）。
   *
   * @param layer — 目标缓存层
   * @param key — 缓存键
   * @param data — 要缓存的数据
   * @param version — 包版本标记
   * @param ttl — TTL（毫秒）
   */
  private _promoteToCacheLayer(
    layer: CacheLayer,
    key: string,
    data: ArrayBuffer,
    version: string,
    ttl: number,
  ): void {
    // Fire-and-forget — 缓存写入不应阻塞挂载流程
    layer.set(key, {
      data: data.slice(0) as ArrayBuffer,
      meta: {
        version,
        createdAt: Date.now(),
        ttl,
      },
    }).catch(() => {
      // 静默失败 — 已在 set() 内部记录
    })
  }

  /**
   * 清除所有缓存层（L1 + L2 + L3）。
   *
   * 公共 API — 可用于强制刷新所有缓存的内容。
   */
  async clearAllCaches(): Promise<void> {
    this._clearCache()
    if (this._cachingEnabled) {
      await Promise.all([
        this._l2Cache.clear(),
        this._l3Cache.clear(),
      ]).catch(() => {})
    }
  }

  /**
   * 禁用或启用 L2/L3 持久化缓存。对测试和调试有用。
   * 不影响 L1 内存缓存。
   */
  setCachingEnabled(enabled: boolean): void {
    this._cachingEnabled = enabled
  }

  /**
   * 返回 L2/L3 缓存是否启用。
   */
  get cachingEnabled(): boolean {
    return this._cachingEnabled
  }

  /**
   * 清除 L1 缓存（公共 API）。
   */
  clearCache(): void {
    this._clearCache()
  }

  /**
   * 获取当前 L1 缓存统计信息。
   */
  get cacheStats(): { size: number; entryCount: number; maxSize: number } {
    return {
      size: this._l1CacheSize,
      entryCount: this._l1Cache.size,
      maxSize: this._l1CacheMaxSize,
    }
  }

  // -----------------------------------------------------------------------
  // Query Helpers
  // -----------------------------------------------------------------------

  /**
   * 获取已挂载包的只读视图。
   */
  get mountedPackages(): ReadonlyMap<IReadOnlyPackage, number> {
    return this._mountedPackages
  }

  /**
   * 获取显式挂载的只读视图。
   */
  get explicitMounts(): ReadonlyMap<string, IReadOnlyPackage> {
    return this._explicitMounts
  }

  /**
   * 获取包含指定文件的包列表（用于调试）。
   *
   * @param filename — 文件名
   * @returns 包含该文件的包列表（最后一项 = 最高优先级）
   */
  getPackagesForFile(filename: string): readonly IReadOnlyPackage[] {
    return this._fileIndex.get(filename) ?? []
  }

  // -----------------------------------------------------------------------
  // IReadOnlyFileSystem — dispose
  // -----------------------------------------------------------------------

  /**
   * 释放文件系统及其所有挂载的包。
   *
   * OpenRA 对照: 组合了 FileSystem.UnmountAll + IDisposable.Dispose
   */
  dispose(): void {
    this.unmountAll()
  }
}
