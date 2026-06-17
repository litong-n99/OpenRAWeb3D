/**
 * D2kSoundResources.ts — Dune 2000 声音资源包加载器
 * OpenRA 对照: OpenRA.Mods.D2k/PackageLoaders/D2kSoundResources.cs
 *
 * 核心范式转换:
 * - C# Stream s → ArrayBuffer + DataView
 * - C# SegmentStream → ArrayBuffer.slice(offset, offset+length)
 * - C# ReadASCIIZ → 手动扫描 null 终止符 + TextDecoder
 * - C# IPackageLoader.TryParsePackage → tryParsePackage()
 *
 * D2K .rs 格式:
 * - 头部: headerLength(4 bytes LE uint32)
 * - 文件表: [name(ASCIIZ), offset(4), length(4)]...  直到 headerLength+4
 * - 每个条目指向数据区中的一段音频数据
 */

import type {
  IReadOnlyPackage,
  IReadOnlyFileSystem,
  IPackageLoader,
} from '../../OpenRA.Game/FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// 模块级单例
// ---------------------------------------------------------------------------

const asciiDecoder = new TextDecoder('ascii')

// ---------------------------------------------------------------------------
// Entry (对应 OpenRA D2kSoundResources.Entry record struct)
// ---------------------------------------------------------------------------

interface Entry {
  offset: number
  length: number
}

// ---------------------------------------------------------------------------
// D2kSoundResources (对应 OpenRA D2kSoundResourcesLoader.D2kSoundResources)
// ---------------------------------------------------------------------------

/**
 * D2K 声音资源包 (只读)。
 *
 * OpenRA 对照: D2kSoundResourcesLoader.D2kSoundResources (nested class)
 *
 * D2K .rs 格式包含一个 ASCIIZ 文件名表，后跟每个文件的偏移量和长度。
 * 文件扩展名决定了加载逻辑，数据区直接包含音频数据。
 */
class D2kSoundResources implements IReadOnlyPackage {
  readonly name: string
  readonly contents: readonly string[]

  private readonly buffer: ArrayBuffer
  private readonly index: Map<string, Entry> = new Map()

  constructor(buffer: ArrayBuffer, filename: string) {
    this.name = filename

    try {
      const dv = new DataView(buffer)
      const headerLength = dv.getUint32(0, true)
      let pos = 4

      const contentList: string[] = []

      while (pos < headerLength + 4) {
        // Read ASCIIZ name
        const nameStart = pos
        while (pos < buffer.byteLength && new Uint8Array(buffer)[pos] !== 0) {
          pos++
        }
        const nameBytes = new Uint8Array(
          buffer,
          nameStart,
          pos - nameStart,
        )
        const name = asciiDecoder.decode(nameBytes)
        pos++ // skip null terminator

        if (pos + 8 > buffer.byteLength) break

        const offset = dv.getUint32(pos, true)
        pos += 4
        const length = dv.getUint32(pos, true)
        pos += 4

        this.index.set(name, { offset, length })
        contentList.push(name)
      }

      this.contents = contentList.sort()
      this.buffer = buffer
    } catch (err) {
      this.dispose()
      throw err
    }
  }

  contains(filename: string): boolean {
    return this.index.has(filename)
  }

  open(
    filename: string,
    _files?: IReadOnlyFileSystem,
  ): Promise<ArrayBuffer | null> {
    const entry = this.index.get(filename)
    if (!entry) return Promise.resolve(null)

    // Return a new independent ArrayBuffer slice (adheres to caching safety convention)
    const slice = this.buffer.slice(
      entry.offset,
      entry.offset + entry.length,
    )
    return Promise.resolve(slice)
  }

  openPackage(
    _filename: string,
    _files?: IReadOnlyFileSystem,
  ): IReadOnlyPackage | null {
    // Not implemented — sound resources don't contain sub-packages
    return null
  }

  dispose(): void {
    this.index.clear()
  }
}

// ---------------------------------------------------------------------------
// D2kSoundResourcesLoader / IPackageLoader 实现
// ---------------------------------------------------------------------------

/**
 * Dune 2000 声音资源包加载器。
 *
 * OpenRA 对照: D2kSoundResourcesLoader (class, IPackageLoader)
 *
 * 识别 .rs 扩展名并解析为 D2kSoundResources 包。
 * 包内的文件可以直接通过 name 访问，返回音频数据的 ArrayBuffer。
 */
class D2kSoundResourcesLoader implements IPackageLoader {
  tryParsePackage(
    filename: string,
    stream: ArrayBuffer,
    _files?: IReadOnlyFileSystem,
  ): IReadOnlyPackage | null {
    if (!filename.toLowerCase().endsWith('.rs')) {
      return null
    }

    const buffer =
      stream instanceof ArrayBuffer ? stream : (stream as ArrayBuffer)

    return new D2kSoundResources(buffer, filename)
  }
}

export const d2kSoundResourcesLoader: IPackageLoader =
  new D2kSoundResourcesLoader()
