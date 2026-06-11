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
 *   (NOTE: L2-L4 为 TODO-5.A.4，本实现仅完成 L1 LRU)
 * - C# explicitMounts "modid|path" → 相同的字符串命名空间
 */

import type { IReadOnlyPackage, IReadOnlyFileSystem, IPackageLoader } from './IPackage.js'
import { ZipFileLoader } from './ZipFile.js'

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
  // Construction
  // -----------------------------------------------------------------------

  /**
   * 创建一个文件系统实例。
   *
   * OpenRA 对照: FileSystem(string modID, IReadOnlyDictionary installedMods, IPackageLoader[] packageLoaders)
   *
   * @param packageLoaders — 注册的包加载器（可选，默认包含 ZipFileLoader）
   * @param l1CacheMaxSize — L1 内存缓存最大容量（字节），默认 100 MB
   */
  constructor(packageLoaders?: IPackageLoader[], l1CacheMaxSize: number = DEFAULT_L1_CACHE_SIZE) {
    this._packageLoaders = packageLoaders
      ? [...packageLoaders]
      : [new ZipFileLoader()]
    this._l1CacheMaxSize = l1CacheMaxSize
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
   * 从 URL 获取并挂载一个包。自动检测包格式。
   *
   * OpenRA 对照: FileSystem.Mount(string name, string explicitName = null)
   *   原方法从本地文件系统加载；此版本通过 HTTP fetch 获取。
   *
   * 以 '~' 开头的名称被视为可选挂载 — 如果无法获取或解析，
   * 不会抛出异常（静默返回）。
   *
   * @param name — 包的 URL 路径（可选 '~' 前缀表示可选挂载）
   * @param explicitName — 可选的显式挂载名称（"modid|path" 引用用）
   *
   * @throws 如果获取或解析失败且 name 不以 '~' 开头
   *
   * TODO-5.A.4: 扩展 L2-L4 缓存（IndexedDB → Cache API → fetch 回退）
   */
  async mount(name: string, explicitName?: string): Promise<void> {
    // 可选的 '~' 前缀 — 挂载失败时不抛出异常
    const optional = name.startsWith('~')
    if (optional) name = name.slice(1)

    try {
      const response = await fetch(name)
      if (!response.ok) {
        if (optional) return
        throw new Error(`Failed to mount '${name}': HTTP ${response.status}`)
      }
      const data = await response.arrayBuffer()
      const pkg = this.tryParsePackage(data, name)
      if (!pkg) {
        if (optional) return
        throw new Error(
          `Could not open package '${name}', format not recognized.`,
        )
      }
      this.mountPackage(pkg, explicitName)
    } catch (e) {
      if (optional) return
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
