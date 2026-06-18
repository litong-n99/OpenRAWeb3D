/**
 * ZipFile.ts — ZIP 压缩包实现（通过 fflate 库）
 * OpenRA 对照: OpenRA.Game/FileSystem/ZipFile.cs
 *
 * 核心范式转换:
 * - C# ICSharpCode.SharpZipLib.ZipFile → fflate unzipSync / unzip
 * - C# 同步 Stream GetStream → 异步 open()
 * - C# ZipFile 构造函数接受 Stream → 接受 ArrayBuffer（浏览器 fetch 结果）
 * - C# ReadWriteZipFile（写入支持）→ 仅 JSON 可写的浏览器方案
 *   (NOTE: 浏览器端 ZIP 只读。写入功能通过 IPackage 接口的 Uint8Array 参数
 *    保留，但 ZipFile 本身不实现 update()/delete())
 * - C# ZipFolder（目录条目子包）→ 基于文件名截取的轻量级子包
 * - C# StaticStreamDataSource → 不需要 (fflate 原生支持 Uint8Array)
 */

import type { IReadOnlyPackage, IReadOnlyFileSystem, IPackageLoader } from './IPackage.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { unzipSync, unzip } from 'fflate'
import { ZIP_WORKER_CODE } from './ZipWorker.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PK ZIP 文件签名魔数 (0x04034b50，小端序)。OpenRA 对照: ZipFileLoader.ZipSignature */
const ZIP_SIGNATURE = 0x04034b50

/**
 * ZIP 大小阈值（字节），超过后使用异步 Worker 解压。
 * 对于小于此阈值的归档，使用同步 unzipSync 以避免 Worker 开销。
 */
const ZIP_SIZE_THRESHOLD = 5 * 1024 * 1024 // 5 MB

// ---------------------------------------------------------------------------
// ZipFolder — ZIP 内的虚拟目录子包
// ---------------------------------------------------------------------------

/**
 * ZIP 归档中的虚拟目录包。
 *
 * OpenRA 对照: ZipFileLoader.ZipFolder
 *
 * 当 ZIP 条目名称以 '/' 结尾时，表示一个目录。
 * ZipFolder 允许将该目录作为子包遍历。
 */
class ZipFolder implements IReadOnlyPackage {
  readonly name: string
  private _parent: ZipFile
  private _prefix: string
  private _contentsCache: readonly string[] | null = null

  /**
   * 创建一个 ZipFolder。
   *
   * OpenRA 对照: ZipFileLoader.ZipFolder(ReadOnlyZipFile parent, string path)
   *
   * @param parent — 父 ZipFile
   * @param path — 目录路径（末尾可能带 '/'）
   */
  constructor(parent: ZipFile, path: string) {
    // 去除末尾的 '/'
    this._prefix = path.endsWith('/') ? path.slice(0, -1) : path
    this.name = this._prefix
    this._parent = parent
  }

  get contents(): readonly string[] {
    if (!this._contentsCache) {
      const prefixLen = this._prefix.length + 1 // +1 for the '/'
      const result: string[] = []
      for (const entry of this._parent.contents) {
        if (entry.startsWith(this._prefix + '/') && entry !== this._prefix) {
          const filename = entry.slice(prefixLen)
          // 只包含单层深度的条目（不包括子目录中的文件）
          const dirLevels = filename.split('/').filter(c => c.length > 0).length
          if (dirLevels === 1) {
            result.push(filename)
          }
        }
      }
      result.sort()
      this._contentsCache = result
    }
    return this._contentsCache
  }

  contains(filename: string): boolean {
    return this._parent.contains(this._prefix + '/' + filename)
  }

  async open(filename: string, files: IReadOnlyFileSystem): Promise<ArrayBuffer | null> {
    return this._parent.open(this._prefix + '/' + filename, files)
  }

  openPackage(filename: string, _files: IReadOnlyFileSystem): IReadOnlyPackage | null {
    return this._parent.openPackage(this._prefix + '/' + filename, _files)
  }

  dispose(): void {
    this._contentsCache = null
    // 不清理 _parent — 生命周期由外部管理
  }
}

// ---------------------------------------------------------------------------
// ZipFile
// ---------------------------------------------------------------------------

/**
 * 只读 ZIP 归档包。
 *
 * OpenRA 对照: ZipFileLoader.ReadOnlyZipFile
 *
 * 对于小于 5 MB 的归档，在构造时使用 fflate 的 unzipSync 解压。
 * 所有文件条目都存储在内存中的 Map<string, Uint8Array> 中。
 *
 * 对于 >= 5 MB 的归档，构造时进行延迟初始化。
 * 通过 Web Worker 执行异步解压以避免阻塞主线程 (RESOLVED P1-D.4)。
 * 文件通过 get() 方法获取，该方法内部触发 Worker 解压。
 */
export class ZipFile implements IReadOnlyPackage {
  readonly name: string

  /** 文件名 → 已解压数据的映射。仅包含文件条目（目录被排除）。 */
  private _entries: Map<string, Uint8Array> = new Map()

  /** 排序后的文件列表（预计算并缓存）。 */
  private _contents: string[] = []

  /** 原始 ZIP 数据（仅用于延迟/异步解压）。 */
  private _rawData: ArrayBuffer | null = null

  /** 异步解压是否正在进行中。 */
  private _decompressPromise: Promise<void> | null = null

  /** 是否使用异步解压路径。 */
  private _isAsync = false

  /** 异步解压是否已完成。 */
  private _decompressed = false

  /** Worker 实例（仅在异步路径中创建）。 */
  private _worker: Worker | null = null

  /**
   * 通过解压原始 ZIP 数据创建 ZipFile。
   *
   * OpenRA 对照: ReadOnlyZipFile(Stream s, string filename)
   *
   * 对于 < 5 MB 的归档，同步解压（unzipSync）。
   * 对于 >= 5 MB 的归档，在构造时进行延迟初始化。
   * 使用 createAsync() 创建并等待解压的实例。
   *
   * @param name — 包名称（通常是文件名或 URL）
   * @param data — 原始 ZIP 数据（来自 fetch 或内联资源）
   * @param options — 可选配置
   * @param options.sizeThreshold — 覆盖异步解压阈值（字节），默认 5 MB
   *
   * @throws 如果数据不是有效的 ZIP 归档且处于同步路径中
   */
  constructor(name: string, data: ArrayBuffer, options?: { sizeThreshold?: number }) {
    this.name = name

    const threshold = options?.sizeThreshold ?? ZIP_SIZE_THRESHOLD

    if (data.byteLength >= threshold) {
      // 延迟解压路径 — 存储原始数据，标记为异步
      this._rawData = data.slice(0) as ArrayBuffer
      this._isAsync = true
    } else {
      // 同步解压路径（原始行为）
      this._decompressSync(data)
      this._decompressed = true
    }
  }

  /**
   * 异步创建 ZipFile 并等待解压完成。
   *
   * 对于大型归档（>= 5 MB），在 Worker 中解压以避免阻塞主线程。
   * 对于较小归档（< 5 MB），行为与同步构造函数相同。
   *
   * @param name — 包名称
   * @param data — 原始 ZIP 数据
   * @returns 解压后的 ZipFile 实例
   */
  static async createAsync(name: string, data: ArrayBuffer): Promise<ZipFile> {
    const zf = new ZipFile(name, data)
    if (zf.isAsync) {
      await zf._ensureDecompressed()
    }
    return zf
  }

  /**
   * 同步解压 ZIP 数据并填充内部映射。
   *
   * @param data — 原始 ZIP 数据
   * @throws 如果数据不是有效的 ZIP 归档
   */
  private _decompressSync(data: ArrayBuffer): void {
    let unzipped: Record<string, Uint8Array>
    try {
      unzipped = unzipSync(new Uint8Array(data))
    } catch (err) {
      throw new Error(`Failed to decompress ZIP "${this.name}": ${String(err)}`)
    }

    this._buildEntries(unzipped)
  }

  /**
   * 确保异步解压已完成。应在访问 _entries 之前调用。
   */
  private async _ensureDecompressed(): Promise<void> {
    if (this._decompressed) return

    if (this._decompressPromise) {
      await this._decompressPromise
      return
    }

    if (!this._rawData) {
      throw new Error(`ZIP "${this.name}": no raw data available for decompression`)
    }

    this._decompressPromise = this._decompressAsync()
    await this._decompressPromise
  }

  /**
   * 使用 fflate.unzip 在主线程上异步解压。
   *
   * Web Worker 方法 (ZipWorker) 是首选，因为它在单独线程中运行，
   * 避免阻塞主线程。但是，Worker 设置增加了开销（Blob URL 创建、
   * 序列化、反序列化）。对于大型归档，这种开销值得避免 UI 卡顿。
   *
   * NOTE: Web Worker 路径需要通过 postMessage 传输 ArrayBuffer
   * 进行浏览器序列化。faltlate unzip 是迭代式的，足够快，
   * 即使在主线程上，对于高达 ~50 MB 的归档也能避免 UI 卡顿。
   */
  private async _decompressAsync(): Promise<void> {
    const data = this._rawData!
    try {
      const result = await this._decompressViaWorker(new Uint8Array(data))
      this._buildEntries(result)
    } catch {
      // Worker 解压失败 — 回退到主线程异步解压
      try {
        const result = await this._decompressOnMainThread(new Uint8Array(data))
        this._buildEntries(result)
      } catch (err) {
        throw new Error(
          `Failed to decompress ZIP "${this.name}": ${String(err)}`,
        )
      }
    } finally {
      this._rawData = null // 释放原始数据
      this._decompressed = true
    }
  }

  /**
   * 通过 Web Worker 解压 ZIP 数据。
   *
   * @param data — 原始 ZIP 数据
   * @returns 文件名 → 解压数据的映射
   */
  private async _decompressViaWorker(data: Uint8Array): Promise<Record<string, Uint8Array>> {
    // 创建 worker blob URL
    const blob = new Blob([ZIP_WORKER_CODE], { type: 'application/javascript' })
    const workerUrl = URL.createObjectURL(blob)
    this._worker = new Worker(workerUrl)
    URL.revokeObjectURL(workerUrl)

    return new Promise((resolve, reject) => {
      if (!this._worker) {
        reject(new Error('Worker creation failed'))
        return
      }

      this._worker.onmessage = (e: MessageEvent) => {
        const msg = e.data

        if (msg.type === 'error') {
          reject(new Error(msg.message))
          return
        }

        if (msg.type === 'result') {
          const files: Record<string, Uint8Array> = {}
          if (msg.files) {
            for (const [name, arr] of Object.entries(msg.files)) {
              files[name] = new Uint8Array(arr as ArrayBuffer)
            }
          }
          resolve(files)
        }
      }

      this._worker.onerror = (err) => {
        reject(new Error(`Worker error: ${String(err)}`))
      }

      // 通过 transfer 传输缓冲区以实现零拷贝
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      this._worker.postMessage(buffer, [buffer])
    })
  }

  /**
   * 在主线程上使用 fflate.unzip 异步解压 ZIP 数据。
   *
   * @param data — 原始 ZIP 数据
   * @returns 文件名 → 解压数据的映射
   */
  /**
   * 在主线程上使用 fflate.unzip 异步解压 ZIP 数据。
   *
   * fflate 的 unzip 使用错误优先的回调风格：(err, data) => void。
   * 返回类型 AsyncTerminable 是一个用于取消的函数（我们忽略它）。
   *
   * @param data — 原始 ZIP 数据
   * @returns 文件名 → 解压数据的映射
   */
  private async _decompressOnMainThread(data: Uint8Array): Promise<Record<string, Uint8Array>> {
    return new Promise((resolve, reject) => {
      unzip(data, (err, result) => {
        if (err) {
          reject(err)
          return
        }
        if (!result) {
          resolve({})
          return
        }
        // Convert Unzipped to plain Record<string, Uint8Array>
        const files: Record<string, Uint8Array> = {}
        for (const [name, value] of Object.entries(result)) {
          if (name.endsWith('/')) continue
          files[name] = value as Uint8Array
        }
        resolve(files)
      })
    })
  }

  /**
   * 从解压条目构建内部 _entries 和 _contents。
   *
   * @param unzipped — 文件名 → 数据的映射
   */
  private _buildEntries(unzipped: Record<string, Uint8Array>): void {
    this._entries = new Map()
    const fileNames: string[] = []

    for (const [key, value] of Object.entries(unzipped)) {
      if (key.endsWith('/')) continue
      fileNames.push(key)
      this._entries.set(key, value)
    }

    fileNames.sort()
    this._contents = fileNames
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Contents
  // -----------------------------------------------------------------------

  /**
   * 包中包含的文件名列表（已排序）。
   *
   * OpenRA 对照: ReadOnlyZipFile.Contents
   *
   * NOTE: 在异步路径中，如果解压尚未完成，此方法返回空列表。
   * 在读取 contents 之前使用 createAsync() 或 _ensureDecompressed()。
   */
  get contents(): readonly string[] {
    return this._contents
  }

  /**
   * 此实例是否使用异步解压路径。
   */
  get isAsync(): boolean {
    return this._isAsync
  }

  /**
   * 异步解压是否已完成。
   */
  get decompressed(): boolean {
    return this._decompressed
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Lookup
  // -----------------------------------------------------------------------

  /**
   * O(1) 检查文件是否在 ZIP 中。
   *
   * OpenRA 对照: ReadOnlyZipFile.Contains(string)
   *
   * NOTE: 在异步路径中，如果解压尚未完成，此方法返回 false。
   * 使用 createAsync() 获取完全解压的实例。
   */
  contains(filename: string): boolean {
    return this._entries.has(filename)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Open
  // -----------------------------------------------------------------------

  /**
   * 从 ZIP 中打开文件，返回其原始数据。
   *
   * OpenRA 对照: ReadOnlyZipFile.GetStream(string)
   *
   * 在异步路径中，在从 _entries 查找之前确保解压已完成。
   *
   * @param filename — ZIP 条目文件名
   * @param _files — 文件系统上下文（未使用）
   * @returns 文件内容的 ArrayBuffer，如果未找到则返回 null
   */
  async open(filename: string, _files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null> {
    if (this._isAsync) {
      await this._ensureDecompressed()
    }
    const entry = this._entries.get(filename)
    if (!entry) return null

    // 复制缓冲区以返回 ArrayBuffer（Uint8Array.buffer 可能共享底层存储）
    return entry.buffer.slice(
      entry.byteOffset,
      entry.byteOffset + entry.byteLength,
    ) as ArrayBuffer
  }

  // -----------------------------------------------------------------------
  // Async API — get()
  // -----------------------------------------------------------------------

  /**
   * 获取单个文件的解压数据。
   *
   * 对于同步路径 (< 5 MB)，立即返回 Uint8Array（副本）。
   * 对于异步路径 (>= 5 MB)，返回 Promise<Uint8Array>。
   *
   * @param filename — ZIP 条目文件名
   * @returns 文件数据，如果未找到则返回 null
   */
  async get(filename: string): Promise<Uint8Array | null> {
    if (this._isAsync) {
      await this._ensureDecompressed()
    }
    const entry = this._entries.get(filename)
    if (!entry) return null
    // 返回副本 — 内部数据通过 dispose() 管理
    return entry.slice()
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — OpenPackage
  // -----------------------------------------------------------------------

  /**
   * 从 ZIP 中打开子包。
   *
   * OpenRA 对照: ReadOnlyZipFile.OpenPackage(string, FileSystem)
   *
   * 处理三种情况：
   * 1. 目录条目 → 返回 ZipFolder
   * 2. 已知归档扩展名 (.zip, .oramap) → 通过 IReadOnlyFileSystem 递归解析
   * 3. 其他文件 → 返回 null
   *
   * @param filename — 子包文件名
   * @param files — 文件系统上下文
   * @returns 子包，如果无法打开则返回 null
   */
  openPackage(filename: string, _files: IReadOnlyFileSystem): IReadOnlyPackage | null {
    // NOTE: 对于异步解压实例，如果解压尚未完成，_entries 可能为空。
    // 在访问 openPackage 之前使用 createAsync() 或通过 get()/open() 触发解压。
    if (this._isAsync && !this._decompressed) {
      return null // 解压尚未完成 — 表现得如同文件未找到
    }

    // 检查是否作为目录存在（目录条目在构造时已从 _entries 中排除，
    // 因此仅通过 _hasDirectoryPrefix 检查是否存在以此目录为前缀的文件）
    if (this._hasDirectoryPrefix(filename + '/')) {
      return new ZipFolder(this, filename)
    }

    // 检查文件条目
    if (!this._entries.has(filename)) return null

    // 检查是否是已知的归档格式
    const lower = filename.toLowerCase()
    if (lower.endsWith('.zip') || lower.endsWith('.oramap')) {
      const entry = this._entries.get(filename)!
      try {
        const buf = entry.buffer.slice(
          entry.byteOffset,
          entry.byteOffset + entry.byteLength,
        )
        return new ZipFile(filename, buf as ArrayBuffer)
      } catch {
        return null
      }
    }

    return null
  }

  /**
   * 检查是否存在以给定前缀开头的目录条目。
   *
   * @param dirPrefix — 目录前缀（必须以 '/' 结尾）
   */
  private _hasDirectoryPrefix(dirPrefix: string): boolean {
    if (!dirPrefix.endsWith('/')) dirPrefix += '/'
    for (const key of this._entries.keys()) {
      if (key.startsWith(dirPrefix)) return true
    }
    return false
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Dispose
  // -----------------------------------------------------------------------

  /**
   * 释放 ZIP 归档持有的所有内存。
   *
   * OpenRA 对照: ReadOnlyZipFile.Dispose()
   *
   * 终止任何活动的 Worker 并清除原始数据和已解压数据。
   */
  dispose(): void {
    // 终止 Worker（如果存在）
    if (this._worker) {
      this._worker.terminate()
      this._worker = null
    }
    this._entries.clear()
    this._contents = []
    this._rawData = null
    this._decompressPromise = null
    this._decompressed = false
  }

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  /** 获取条目数量。对于异步实例，如果解压尚未完成，返回 0。 */
  get entryCount(): number {
    return this._entries.size
  }

  /**
   * 获取总解压大小（字节）。
   */
  get totalSize(): number {
    let size = 0
    for (const entry of this._entries.values()) {
      size += entry.byteLength
    }
    return size
  }

  /**
   * 原始 ZIP 数据的大小（字节）。
   * 对于同步路径（数据已被解压并丢弃），返回 0。
   */
  get rawSize(): number {
    return this._rawData?.byteLength ?? 0
  }
}

// ---------------------------------------------------------------------------
// ZipFileLoader
// ---------------------------------------------------------------------------

/**
 * ZIP / ORAMAP 归档的包加载器。
 *
 * OpenRA 对照: OpenRA.FileSystem.ZipFileLoader
 *
 * 通过两个条件识别 ZIP 归档：
 * 1. 文件扩展名 (.zip, .oramap)
 * 2. 文件魔数（前 4 字节 = PK\x03\x04，即 0x04034b50）
 */
export class ZipFileLoader implements IPackageLoader {
  /**
   * 尝试将流解析为 ZipFile 包。
   *
   * OpenRA 对照: ZipFileLoader.TryParsePackage(Stream, string, FileSystem, out IReadOnlyPackage)
   *
   * @param filename — 文件名（用于扩展名检查）
   * @param stream — 文件内容
   * @param _files — 文件系统上下文（未使用）
   * @returns ZipFile 实例（如果格式匹配），否则返回 null
   */
  tryParsePackage(
    filename: string,
    stream: ArrayBuffer,
    _files?: IReadOnlyFileSystem,
  ): IReadOnlyPackage | null {
    // 检查 1: 文件扩展名
    const lower = filename.toLowerCase()
    const hasArchiveExtension = lower.endsWith('.zip') || lower.endsWith('.oramap')

    // 检查 2: 魔数 (PK\x03\x04，小端序 0x04034b50)
    const hasZipSignature = stream.byteLength >= 4 && this._checkSignature(stream)

    // 如果两个检查都失败，这不是 ZIP 文件
    if (!hasArchiveExtension && !hasZipSignature) {
      return null
    }

    // 如果魔数不匹配但有正确的扩展名，警告但继续尝试
    if (!hasZipSignature) {
      console.warn(
        `ZipFileLoader: ${filename} has archive extension but invalid PK signature. Attempting to parse anyway.`,
      )
    }

    try {
      return new ZipFile(filename, stream)
    } catch (err) {
      // 解析失败 — 不是有效的 ZIP 归档
      console.warn(`ZipFileLoader: Failed to parse ${filename} as ZIP: ${String(err)}`)
      return null
    }
  }

  /**
   * 检查 ArrayBuffer 的前 4 字节是否匹配 ZIP 魔数。
   *
   * OpenRA 对照: ZipFileLoader.ZipSignature (0x04034b50)
   */
  private _checkSignature(buffer: ArrayBuffer): boolean {
    const view = new DataView(buffer)
    // ZIP 签名是小端序的 0x04034b50
    return view.getUint32(0, true) === ZIP_SIGNATURE
  }
}
