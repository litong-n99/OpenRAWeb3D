/**
 * PakFile.ts — PAK 归档格式（原始拼接 + 链表索引）
 * OpenRA 对照: OpenRA.Mods.Cnc/FileSystem/Pak.cs
 *
 * 核心范式转换:
 * - C# Stream 读取 → DataView/Uint8Array 基于偏移量的解析
 * - C# 小端序 uint32 → DataView.getUint32(offset, true)
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
// PakEntry — 内部条目结构
// ---------------------------------------------------------------------------

/** PAK 归档中的文件条目。
 *
 * OpenRA 对照: PakFileLoader.Entry (struct)
 */
interface PakEntry {
  offset: number
  length: number
  filename: string
}

// ---------------------------------------------------------------------------
// PakFile — IReadOnlyPackage 实现
// ---------------------------------------------------------------------------

/**
 * 只读 PAK 归档包。
 *
 * OpenRA 对照: PakFileLoader.PakFile (nested class)
 *
 * PAK 格式是原始文件数据的简单拼接，带有一个偏移量链表索引。
 * 所有多字节整数均为小端序。
 *
 * 格式:
 * ```
 * [4 bytes: firstFileOffset (uint32 LE)]
 * [variable: filename (ASCIIZ string)]
 * [4 bytes: nextFileOffset (uint32 LE)] — 0 表示最后一个文件
 * ... 重复直到 nextFileOffset == 0
 * [data blocks...]
 * ```
 */
class PakFile implements IReadOnlyPackage {
  readonly name: string

  /** 文件名 → PakEntry 的映射。 */
  private _index: Map<string, PakEntry>

  /** 排序后的文件列表（预计算并缓存）。 */
  private _contents: string[]

  /** 原始数据缓冲区 — 用于按需数据提取。 */
  private _buffer: ArrayBuffer

  /**
   * 从 ArrayBuffer 创建 PakFile。
   *
   * OpenRA 对照: PakFile(Stream stream, string filename)
   *
   * @param name — 包名称
   * @param buffer — 原始 PAK 文件数据
   */
  constructor(name: string, buffer: ArrayBuffer) {
    this.name = name
    this._buffer = buffer

    try {
      const dv = new DataView(buffer)
      this._index = new Map<string, PakEntry>()

      let pos = 0

      // 读取第一个偏移量
      let offset = dv.getUint32(pos, true)
      pos += 4

      // 遍历偏移量链表
      while (offset !== 0) {
        // 读取文件名（以 null 结尾的 ASCII 字符串）
        let strEnd = pos
        while (strEnd < buffer.byteLength && dv.getUint8(strEnd) !== 0) {
          strEnd++
        }
        const nameBytes = new Uint8Array(buffer, pos, strEnd - pos)
        const filename = asciiDecoder.decode(nameBytes)
        pos = strEnd + 1 // 跳过 null 终止符

        // 读取下一个偏移量
        const nextOffset = dv.getUint32(pos, true)
        pos += 4

        // 计算长度
        const streamLength = buffer.byteLength
        const length = (nextOffset === 0 ? streamLength : nextOffset) - offset

        // 忽略重复文件（与 OpenRA 的 TryAdd 一致）
        if (!this._index.has(filename)) {
          this._index.set(filename, { offset, length, filename })
        }

        // NOTE: Unlike OpenRA (which only advances offset on successful TryAdd),
        // we always advance to nextOffset. This correctly follows the linked list
        // even when consecutive duplicate filenames appear in the archive.
        offset = nextOffset
      }

      // 排序内容
      this._contents = [...this._index.keys()].sort()
    } catch (err) {
      this.dispose()
      throw err
    }
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Contents
  // -----------------------------------------------------------------------

  /** 包中包含的文件名列表（已排序）。OpenRA 对照: PakFile.Contents */
  get contents(): readonly string[] {
    return this._contents
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Lookup
  // -----------------------------------------------------------------------

  /**
   * O(1) 检查文件是否在归档中。
   *
   * OpenRA 对照: PakFile.Contains(string)
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
   * OpenRA 对照: PakFile.GetStream(string) → SegmentStream
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

    return this._buffer.slice(entry.offset, entry.offset + entry.length)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — OpenPackage
  // -----------------------------------------------------------------------

  /**
   * 从归档中打开子包。
   *
   * OpenRA 对照: PakFile.OpenPackage → 返回 null（未实现）
   *
   * @returns 始终返回 null — PAK 归档不支持嵌套包加载
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
   * OpenRA 对照: PakFile.Dispose()
   */
  dispose(): void {
    this._index.clear()
    this._contents = []
    this._buffer = new ArrayBuffer(0)
  }
}

// ---------------------------------------------------------------------------
// PakFileLoader — IPackageLoader 实现
// ---------------------------------------------------------------------------

/**
 * PAK 归档的包加载器。
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileSystem.PakFileLoader
 *
 * 通过文件扩展名 (.pak) 识别 PAK 归档。
 * 格式未使用魔数，因此需要扩展名检查。
 */
export class PakFileLoader implements IPackageLoader {
  /**
   * 尝试将流解析为 PakFile 包。
   *
   * OpenRA 对照: PakFileLoader.TryParsePackage(Stream, string, FileSystem, out IReadOnlyPackage)
   *
   * @param filename — 文件名（用于扩展名检查）
   * @param stream — 文件内容
   * @param _files — 文件系统上下文（未使用）
   * @returns PakFile 实例（如果扩展名匹配），否则返回 null
   */
  tryParsePackage(
    filename: string,
    stream: ArrayBuffer,
    _files?: IReadOnlyFileSystem,
  ): IReadOnlyPackage | null {
    // PAK 格式没有魔数 — 仅通过扩展名识别
    if (!filename.toLowerCase().endsWith('.pak')) {
      return null
    }

    // 基本大小检查：至少需要 4 字节（用于 firstFileOffset）。
    // 空 PAK 文件仅包含 4 字节的 uint32(0)。
    if (stream.byteLength < 4) {
      return null
    }

    try {
      return new PakFile(filename, stream)
    } catch (err) {
      console.warn(`PakFileLoader: Failed to parse "${filename}": ${String(err)}`)
      return null
    }
  }
}
