/**
 * BigFile.ts — Electronic Arts BIG 归档格式
 * OpenRA 对照: OpenRA.Mods.Cnc/FileSystem/BigFile.cs
 *
 * 核心范式转换:
 * - C# Stream 读取 → DataView/Uint8Array 基于偏移量的解析
 * - C# 大端序 uint32 / int2.Swap → DataView.getUint32(offset, false)
 * - C# ReadASCIIZ → 手动扫描 null 终止符 + TextDecoder
 * - C# SegmentStream → ArrayBuffer.slice(offset, offset+size)
 * - C# 同步 GetStream → 异步 open(): Promise<ArrayBuffer | null>
 */

import type { IReadOnlyPackage, IReadOnlyFileSystem, IPackageLoader } from '../../OpenRA.Game/FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// 模块级单例
// ---------------------------------------------------------------------------

const asciiDecoder = new TextDecoder('ascii')

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** BIG 文件签名 "BIGF"。OpenRA 对照: BigLoader 魔数检查 */
const BIGF_SIGNATURE = 'BIGF'

/** BIG 文件签名在 ASCII 中的字节表示 */
const BIGF_BYTES = new Uint8Array([0x42, 0x49, 0x47, 0x46]) // 'B', 'I', 'G', 'F'

// ---------------------------------------------------------------------------
// BigEntry — 内部条目结构
// ---------------------------------------------------------------------------

/** BIG 归档中的文件条目。
 *
 * OpenRA 对照: BigFile.Entry (nested class)
 */
interface BigEntry {
  offset: number
  size: number
  path: string
}

// ---------------------------------------------------------------------------
// BigFile — IReadOnlyPackage 实现
// ---------------------------------------------------------------------------

/**
 * 只读 BIG 归档包。
 *
 * OpenRA 对照: BigLoader.BigFile (nested class)
 *
 * BIG 格式由 Electronic Arts 使用，将文件名存储为明文字符串
 * （而非 MIX 格式中的哈希值），且不使用加密。
 * 所有多字节整数均为大端序（big-endian）。
 */
class BigFile implements IReadOnlyPackage {
  readonly name: string

  /** 文件名 → BigEntry 的映射。 */
  private _index: Map<string, BigEntry>

  /** 排序后的文件列表（预计算并缓存）。 */
  private _contents: string[]

  /** 原始数据缓冲区 — 用于按需数据提取。 */
  private _buffer: ArrayBuffer

  /**
   * 从 ArrayBuffer 创建 BigFile。
   *
   * OpenRA 对照: BigFile(Stream s, string filename)
   *
   * @param name — 包名称
   * @param buffer — 原始 BIG 文件数据
   */
  constructor(name: string, buffer: ArrayBuffer) {
    this.name = name
    this._buffer = buffer

    // Initialize fields before parsing — ensures dispose() is always safe
    // even if signature validation throws before populating the index.
    this._index = new Map<string, BigEntry>()
    this._contents = []

    try {
      const dv = new DataView(buffer)
      let pos = 0

      // 读取并验证签名
      const sig = this._readString(buffer, pos, 4)
      pos += 4
      if (sig !== BIGF_SIGNATURE) {
        throw new Error(`Invalid BIG file signature: expected "BIGF", got "${sig}"`)
      }

      // 总归档大小（大端序）
      // dv.getUint32(pos, false); pos += 4; — 已读但未使用

      // 条目数量（大端序）
      pos += 4 // 跳过 totalSize
      const entryCount = dv.getUint32(pos, false)
      pos += 4

      // 首个条目偏移量（大端序）— 在 EA .big 文件中不可靠，已读但未使用
      // dv.getUint32(pos, false);
      pos += 4

      // 解析条目
      for (let i = 0; i < entryCount; i++) {
        const entry = this._parseEntry(dv, pos)
        pos = entry.nextPos
        this._index.set(entry.path, { offset: entry.offset, size: entry.size, path: entry.path })
      }

      // 排序内容
      this._contents = [...this._index.keys()].sort()
    } catch (err) {
      this.dispose()
      throw err
    }
  }

  /**
   * 解析单个 BIG 条目。
   *
   * OpenRA 对照: BigFile.Entry(Stream s)
   *
   * @param dv — 数据视图
   * @param pos — 起始字节位置
   * @returns 条目数据和下一个位置
   */
  private _parseEntry(dv: DataView, pos: number): BigEntry & { nextPos: number } {
    // 偏移量和大小均为大端序
    const offset = dv.getUint32(pos, false)
    pos += 4
    const size = dv.getUint32(pos, false)
    pos += 4

    // 以 null 结尾的 ASCII 字符串
    let strEnd = pos
    while (strEnd < dv.byteLength && dv.getUint8(strEnd) !== 0) {
      strEnd++
    }
    const pathBytes = new Uint8Array(dv.buffer, dv.byteOffset + pos, strEnd - pos)
    const path = asciiDecoder.decode(pathBytes)
    pos = strEnd + 1 // 跳过 null 终止符

    return { offset, size, path, nextPos: pos }
  }

  /**
   * 从缓冲区读取固定长度的 ASCII 字符串。
   */
  private _readString(buffer: ArrayBuffer, offset: number, length: number): string {
    const bytes = new Uint8Array(buffer, offset, length)
    return asciiDecoder.decode(bytes)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Contents
  // -----------------------------------------------------------------------

  /** 包中包含的文件名列表（已排序）。OpenRA 对照: BigFile.Contents */
  get contents(): readonly string[] {
    return this._contents
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Lookup
  // -----------------------------------------------------------------------

  /**
   * O(1) 检查文件是否在归档中。
   *
   * OpenRA 对照: BigFile.Contains(string)
   */
  contains(filename: string): boolean {
    return this._index.has(filename)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Open
  // -----------------------------------------------------------------------

  /**
   * 从归档中提取文件。
   *
   * OpenRA 对照: BigFile.GetStream(string) → SegmentStream
   *
   * 返回一个独立的 ArrayBuffer 副本（符合 IPackage 的缓存安全要求）。
   *
   * @param filename — 文件名
   * @param _files — 文件系统上下文（未使用）
   * @returns 文件内容的 ArrayBuffer，如果未找到则返回 null
   */
  async open(filename: string, _files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null> {
    const entry = this._index.get(filename)
    if (!entry) return null

    return this._buffer.slice(entry.offset, entry.offset + entry.size)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — OpenPackage
  // -----------------------------------------------------------------------

  /**
   * 从归档中打开子包。
   *
   * OpenRA 对照: BigFile.OpenPackage → 返回 null（未实现）
   *
   * @returns 始终返回 null — BIG 归档不支持嵌套包加载
   */
  openPackage(_filename: string, _files?: IReadOnlyFileSystem): IReadOnlyPackage | null {
    return null
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Dispose
  // -----------------------------------------------------------------------

  /**
   * 释放归档持有的所有引用。
   *
   * OpenRA 对照: BigFile.Dispose()
   */
  dispose(): void {
    this._index.clear()
    this._contents = []
    this._buffer = new ArrayBuffer(0)
  }
}

// ---------------------------------------------------------------------------
// BigFileLoader — IPackageLoader 实现
// ---------------------------------------------------------------------------

/**
 * BIG 归档的包加载器。
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileSystem.BigLoader
 *
 * 通过检查前 4 个字节是否匹配 "BIGF" 签名来识别 BIG 归档。
 */
export class BigFileLoader implements IPackageLoader {
  /**
   * 尝试将流解析为 BigFile 包。
   *
   * OpenRA 对照: BigLoader.TryParsePackage(Stream, string, FileSystem, out IReadOnlyPackage)
   *
   * @param filename — 文件名（用于日志）
   * @param stream — 文件内容
   * @param _files — 文件系统上下文（未使用）
   * @returns BigFile 实例（如果签名匹配），否则返回 null
   */
  tryParsePackage(
    filename: string,
    stream: ArrayBuffer,
    _files?: IReadOnlyFileSystem,
  ): IReadOnlyPackage | null {
    // 检查 "BIGF" 签名
    if (stream.byteLength < 4) return null

    const sigBytes = new Uint8Array(stream, 0, 4)
    for (let i = 0; i < 4; i++) {
      if (sigBytes[i] !== BIGF_BYTES[i]) return null
    }

    try {
      return new BigFile(filename, stream)
    } catch (err) {
      console.warn(`BigFileLoader: Failed to parse "${filename}": ${String(err)}`)
      return null
    }
  }
}
