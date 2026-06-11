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
import { unzipSync } from 'fflate'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PK ZIP 文件签名魔数 (0x04034b50，小端序)。OpenRA 对照: ZipFileLoader.ZipSignature */
const ZIP_SIGNATURE = 0x04034b50

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
 * 在构造时使用 fflate 的 unzipSync 解压整个 ZIP 归档。
 * 所有文件条目都存储在内存中的 Map<string, Uint8Array> 中。
 *
 * NOTE: 对于 > 5MB 的归档，应考虑使用 fflate.unzip() + Web Worker
 * 以避免阻塞主线程 (TODO-5.A.3)。
 */
export class ZipFile implements IReadOnlyPackage {
  readonly name: string

  /** 文件名 → 已解压数据的映射。仅包含文件条目（目录被排除）。 */
  private _entries: Map<string, Uint8Array>

  /** 排序后的文件列表（预计算并缓存）。 */
  private _contents: string[]

  /**
   * 通过解压原始 ZIP 数据创建 ZipFile。
   *
   * OpenRA 对照: ReadOnlyZipFile(Stream s, string filename)
   *
   * @param name — 包名称（通常是文件名或 URL）
   * @param data — 原始 ZIP 数据（来自 fetch 或内联资源）
   *
   * @throws 如果数据不是有效的 ZIP 归档
   */
  constructor(name: string, data: ArrayBuffer) {
    this.name = name

    let unzipped: Record<string, Uint8Array>
    try {
      unzipped = unzipSync(new Uint8Array(data))
    } catch (err) {
      throw new Error(`Failed to decompress ZIP "${name}": ${String(err)}`)
    }

    // 构建条目映射：过滤掉目录条目（以 '/' 结尾的键）
    this._entries = new Map<string, Uint8Array>()
    const fileNames: string[] = []

    for (const [key, value] of Object.entries(unzipped)) {
      // fflate 的 unzipSync 使用键名作为文件名
      // 目录条目以 '/' 结尾；跳过它们
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

  /** 包中包含的文件名列表（已排序）。OpenRA 对照: ReadOnlyZipFile.Contents */
  get contents(): readonly string[] {
    return this._contents
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Lookup
  // -----------------------------------------------------------------------

  /**
   * O(1) 检查文件是否在 ZIP 中。
   *
   * OpenRA 对照: ReadOnlyZipFile.Contains(string)
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
   * @param filename — ZIP 条目文件名
   * @param _files — 文件系统上下文（未使用）
   * @returns 文件内容的 ArrayBuffer，如果未找到则返回 null
   */
  async open(filename: string, _files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null> {
    const entry = this._entries.get(filename)
    if (!entry) return null

    // 复制缓冲区以返回 ArrayBuffer（Uint8Array.buffer 可能共享底层存储）
    return entry.buffer.slice(
      entry.byteOffset,
      entry.byteOffset + entry.byteLength,
    ) as ArrayBuffer
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
      // 注意：我们直接将原始数据传递给 FileSystem 进行递归解析
      // 这可以处理嵌套的 .oramap → .zip 的情况
      // 由于 FileSystem 需要 IReadOnlyFileSystem 上下文，我们无法在此递归
      // 此功能需要 FileSystem.tryParsePackage 的支持
      // 简单的递归尝试：尝试作为 ZipFile 加载
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
   */
  dispose(): void {
    this._entries.clear()
    this._contents = []
  }

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  /** 获取条目数量。 */
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
