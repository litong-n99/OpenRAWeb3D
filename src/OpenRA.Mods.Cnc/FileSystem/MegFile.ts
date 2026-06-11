/**
 * MegFile.ts — MEG V3 归档格式
 * OpenRA 对照: OpenRA.Mods.Cnc/FileSystem/MegFile.cs
 *
 * 参考文档: https://modtools.petrolution.net/docs/MegFileFormat
 *
 * 核心范式转换:
 * - C# Stream 读取 → DataView/Uint8Array 基于偏移量的解析
 * - C# 小端序 uint32 → DataView.getUint32(offset, true)
 * - C# ReadASCII(length) → Uint8Array 子数组 + TextDecoder
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

/** 未加密的 MEG ID。OpenRA 对照: MegV3Loader.UnencryptedMegID */
const UNENCRYPTED_MEG_ID = 0xFFFFFFFF

/** MEG 版本号（浮点值 0.99，作为整数读取）。OpenRA 对照: MegV3Loader.MegVersion */
const MEG_VERSION = 0x3F7D70A4

// ---------------------------------------------------------------------------
// MegEntry — 内部条目结构
// ---------------------------------------------------------------------------

/** MEG 归档中的文件条目。
 *
 * OpenRA 对照: MegFile 中的 (uint Offset, int Length) 元组
 */
interface MegEntry {
  offset: number
  length: number
}

// ---------------------------------------------------------------------------
// MegFile — IReadOnlyPackage 实现
// ---------------------------------------------------------------------------

/**
 * 只读 MEG V3 归档包。
 *
 * OpenRA 对照: MegV3Loader.MegFile (nested class)
 *
 * MEG 格式是未加密的，具有字符串表索引和文件条目。
 * 所有多字节整数均为小端序。
 */
class MegFile implements IReadOnlyPackage {
  readonly name: string

  /** 文件名 → (offset, length) 的映射。 */
  private _contentsMap: Map<string, MegEntry>

  /** 排序后的文件列表（预计算并缓存）。 */
  private _contents: string[]

  /** 原始数据缓冲区 — 用于按需数据提取。 */
  private _buffer: ArrayBuffer

  /**
   * 从 ArrayBuffer 创建 MegFile。
   *
   * OpenRA 对照: MegFile(Stream s, string filename)
   *
   * @param name — 包名称
   * @param buffer — 原始 MEG 文件数据
   */
  constructor(name: string, buffer: ArrayBuffer) {
    this.name = name
    this._buffer = buffer

    // Initialize fields before parsing — ensures dispose() is always safe
    // even if signature validation throws before populating the index.
    this._contentsMap = new Map<string, MegEntry>()
    this._contents = []

    try {
      const dv = new DataView(buffer)
      let pos = 0

      // 验证 id 和 version
      const id = dv.getUint32(pos, true)
      pos += 4
      const version = dv.getUint32(pos, true)
      pos += 4

      if (id !== UNENCRYPTED_MEG_ID || version !== MEG_VERSION) {
        throw new Error(
          `Invalid MEG file signature: id=0x${id.toString(16).padStart(8, '0')}, ` +
          `version=0x${version.toString(16).padStart(8, '0')}`,
        )
      }

      // 读取头部字段
      const headerSize = dv.getUint32(pos, true)
      pos += 4
      const numStrings = dv.getUint32(pos, true)
      pos += 4
      const numFiles = dv.getUint32(pos, true)
      pos += 4
      const stringsSize = dv.getUint32(pos, true)
      pos += 4

      const stringsStart = pos

      // 解析字符串表
      const filenames: string[] = []
      for (let i = 0; i < numStrings; i++) {
        const strLen = dv.getUint16(pos, true)
        pos += 2
        const strBytes = new Uint8Array(buffer, pos, strLen)
        filenames.push(asciiDecoder.decode(strBytes))
        pos += strLen
      }

      // 验证字符串表大小与声明的 stringsSize 一致
      if (pos !== stringsSize + stringsStart) {
        throw new Error('File name table in .meg file inconsistent')
      }

      // 解析文件条目
      for (let i = 0; i < numFiles; i++) {
        // 跳过标志、crc、索引（10 字节）
        pos += 10
        const size = dv.getUint32(pos, true)
        pos += 4
        const offset = dv.getUint32(pos, true)
        pos += 4
        const nameIndex = dv.getUint16(pos, true)
        pos += 2

        const filename = filenames[nameIndex]
        if (filename !== undefined) {
          this._contentsMap.set(filename, { offset, length: size })
        } else {
          console.warn(
            `MegFile: file entry ${i} references invalid string index ${nameIndex} ` +
            `(max ${filenames.length - 1})`,
          )
        }
      }

      // 验证是否已到达数据起始偏移量
      if (pos !== headerSize) {
        throw new Error(
          `Expected to be at data start offset ${headerSize}, but at ${pos}`,
        )
      }

      // 排序内容
      this._contents = [...this._contentsMap.keys()].sort()
    } catch (err) {
      this.dispose()
      throw err
    }
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Contents
  // -----------------------------------------------------------------------

  /** 包中包含的文件名列表（已排序）。OpenRA 对照: MegFile.Contents */
  get contents(): readonly string[] {
    return this._contents
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Lookup
  // -----------------------------------------------------------------------

  /**
   * O(1) 检查文件是否在归档中。
   *
   * OpenRA 对照: MegFile.Contains(string)
   */
  contains(filename: string): boolean {
    return this._contentsMap.has(filename)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Open
  // -----------------------------------------------------------------------

  /**
   * 从归档中提取文件。
   *
   * OpenRA 对照: MegFile.GetStream(string) → SegmentStream
   *
   * 返回一个独立的 ArrayBuffer 副本（符合 IPackage 的缓存安全要求）。
   *
   * @param filename — 文件名
   * @param _files — 文件系统上下文（未使用）
   * @returns 文件内容的 ArrayBuffer，如果未找到则返回 null
   */
  async open(filename: string, _files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null> {
    const entry = this._contentsMap.get(filename)
    if (!entry) return null

    return this._buffer.slice(entry.offset, entry.offset + entry.length)
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — OpenPackage
  // -----------------------------------------------------------------------

  /**
   * 从归档中打开子包。
   *
   * OpenRA 对照: MegFile.OpenPackage(string, FileSystem)
   *
   * 尝试将提取的子流作为嵌套包打开。
   * 在浏览器环境中，委派给 FileSystem 的加载器链。
   *
   * @param filename — 子包文件名
   * @param _files — 文件系统上下文（用于递归解析）
   * @returns 子包，如果无法打开则返回 null
   */
  openPackage(filename: string, _files?: IReadOnlyFileSystem): IReadOnlyPackage | null {
    // TODO-5.B.4: Delegate to FileSystem.tryParsePackage when Phase C context
    // is available. Currently returns null because browser-side MegFile does
    // not have access to the FileSystem's registered package loaders.
    void _files
    void filename
    return null
  }

  // -----------------------------------------------------------------------
  // IReadOnlyPackage — Dispose
  // -----------------------------------------------------------------------

  /**
   * 释放归档持有的所有引用。
   *
   * OpenRA 对照: MegFile.Dispose()
   */
  dispose(): void {
    this._contentsMap.clear()
    this._contents = []
    this._buffer = new ArrayBuffer(0)
  }
}

// ---------------------------------------------------------------------------
// MegV3Loader — IPackageLoader 实现
// ---------------------------------------------------------------------------

/**
 * MEG V3 归档的包加载器。
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileSystem.MegV3Loader
 *
 * 通过检查前 8 个字节的 id (0xFFFFFFFF) 和 version (0x3F7D70A4) 来识别 MEG V3 归档。
 */
export class MegV3Loader implements IPackageLoader {
  /**
   * 尝试将流解析为 MegFile 包。
   *
   * OpenRA 对照: MegV3Loader.TryParsePackage(Stream, string, FileSystem, out IReadOnlyPackage)
   *
   * @param filename — 文件名（用于日志）
   * @param stream — 文件内容
   * @param _files — 文件系统上下文（未使用）
   * @returns MegFile 实例（如果格式匹配），否则返回 null
   */
  tryParsePackage(
    filename: string,
    stream: ArrayBuffer,
    _files?: IReadOnlyFileSystem,
  ): IReadOnlyPackage | null {
    // 需要至少 8 字节用于 id + version
    if (stream.byteLength < 8) return null

    const dv = new DataView(stream)
    const id = dv.getUint32(0, true)
    const version = dv.getUint32(4, true)

    if (id !== UNENCRYPTED_MEG_ID || version !== MEG_VERSION) {
      return null
    }

    try {
      return new MegFile(filename, stream)
    } catch (err) {
      console.warn(`MegV3Loader: Failed to parse "${filename}": ${String(err)}`)
      return null
    }
  }
}
