/**
 * ShpD2Loader.ts — Dune 2000 SHP 精灵格式加载器
 * OpenRA 对照: OpenRA.Mods.Cnc/SpriteLoaders/ShpD2Loader.cs
 *
 * 核心范式转换:
 * - C# Stream s → Uint8Array buffer + DataView
 * - C# [Flags] enum FormatFlags → TypeScript bitmask 常量
 * - C# LCW + RLEZeros 压缩 → 线对线移植的 Compression.ts
 * - C# out ISpriteFrame[] → 返回值
 *
 * SHP D2 格式:
 * - 头部: imageCount(2) + offsetTable(variable)
 * - 每个帧: flags(2) + 未知(1) + width(2) + height(1) + dataLeft(2) + dataSize(2)
 * - 支持调色板表和 LCW/RLEZeros 压缩
 */

import {
  type ISpriteLoader,
  type ISpriteFrame,
  type Size,
  type Float2,
  SpriteFrameType,
} from '../../OpenRA.Game/Graphics/SpriteLoader.js'
import {
  LCWCompression,
  RLEZerosCompression,
} from '../FileFormats/Compression.js'

// ---------------------------------------------------------------------------
// FormatFlags (对应 OpenRA ShpD2Loader.FormatFlags)
// ---------------------------------------------------------------------------

const FormatFlags = {
  PaletteTable: 1,
  NotLCWCompressed: 2,
  VariableLengthTable: 4,
} as const

// ---------------------------------------------------------------------------
// ShpD2Frame (对应 OpenRA ShpD2Loader.ShpD2Frame)
// ---------------------------------------------------------------------------

/**
 * 单个 SHP D2 帧。
 *
 * OpenRA 对照: ShpD2Loader.ShpD2Frame
 */
class ShpD2Frame implements ISpriteFrame {
  readonly type = SpriteFrameType.Indexed8
  readonly size: Size
  readonly frameSize: Size
  readonly offset: Float2 = { x: 0, y: 0 }
  data: Uint8Array
  readonly disableExportPadding = false

  constructor(dv: DataView, buffer: Uint8Array, offset: number) {
    const flags = dv.getUint16(offset, true)
    offset += 2

    // Skip unknown byte
    offset++
    const width = dv.getUint16(offset, true)
    offset += 2
    const height = buffer[offset++]!
    this.size = { width, height }
    this.frameSize = { width, height }

    // Subtract header size (10 bytes)
    let dataLeft = dv.getUint16(offset, true) - 10
    offset += 2
    const dataSize = dv.getUint16(offset, true)
    offset += 2

    // Read palette table
    let table: Uint8Array
    if ((flags & FormatFlags.PaletteTable) !== 0) {
      const n =
        (flags & FormatFlags.VariableLengthTable) !== 0
          ? buffer[offset++]!
          : 16
      table = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        table[i] = buffer[offset++]!
      }
      dataLeft -= n
    } else {
      // Default table: identity with specific shadow values
      table = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        table[i] = i
      }
      table[1] = 0x7f
      table[2] = 0x7e
      table[3] = 0x7d
      table[4] = 0x7c
    }

    this.data = new Uint8Array(width * height)

    // Decode image data
    let compressed = buffer.subarray(offset, offset + dataLeft)
    offset += dataLeft

    if ((flags & FormatFlags.NotLCWCompressed) === 0) {
      const temp = new Uint8Array(dataSize)
      LCWCompression.decodeInto(compressed, temp, 0)
      compressed = temp
    }

    RLEZerosCompression.decodeInto(compressed, this.data, 0)

    // Lookup values in lookup table
    for (let j = 0; j < this.data.length; j++) {
      this.data[j] = table[this.data[j]!]!
    }
  }
}

// ---------------------------------------------------------------------------
// 格式检测 (对应 OpenRA ShpD2Loader.IsShpD2)
// ---------------------------------------------------------------------------

/**
 * 检测是否为 Dune 2000 SHP 格式。
 *
 * OpenRA 对照: ShpD2Loader.IsShpD2(Stream)
 */
function isShpD2(buffer: Uint8Array): boolean {
  if (buffer.length < 8) return false

  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  // First word is the image count
  const imageCount = dv.getUint16(0, true)
  if (imageCount === 0) return false

  // Test for two vs four byte offset
  const testOffset = dv.getUint32(2, true)
  const offsetSize = (testOffset & 0xff0000) > 0 ? 2 : 4

  // Last offset should point to the end of file
  const finalOffset = 2 + offsetSize * imageCount
  if (finalOffset > buffer.length) return false

  const eof =
    offsetSize === 2
      ? dv.getUint16(finalOffset, true)
      : dv.getUint32(finalOffset, true)
  if (eof + 2 !== buffer.length) return false

  // Check the format flag on the first frame
  // Need to get offset of first frame
  // First offset entry is at position 2
  const firstFrameOffset =
    (offsetSize === 2
      ? dv.getUint16(2, true)
      : dv.getUint32(2, true)) + 2

  if (firstFrameOffset >= buffer.length) return false

  const b = dv.getUint16(firstFrameOffset, true)
  return b === 5 || b <= 3
}

// ---------------------------------------------------------------------------
// 帧解析 (对应 OpenRA ShpD2Loader.ParseFrames)
// ---------------------------------------------------------------------------

/**
 * 解析 SHP D2 文件中的所有帧。
 *
 * OpenRA 对照: ShpD2Loader.ParseFrames(Stream)
 */
function parseFrames(buffer: Uint8Array): ISpriteFrame[] {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const imageCount = dv.getUint16(0, true)

  // If fourth byte in file is non-zero, the offsets are two bytes each.
  const temp = dv.getUint32(2, true)
  const twoByteOffset = (temp & 0xff0000) > 0

  const offsets = new Array<number>(imageCount + 1)
  let readPos = 2
  for (let i = 0; i < imageCount + 1; i++) {
    offsets[i] =
      (twoByteOffset
        ? dv.getUint16(readPos, true)
        : dv.getUint32(readPos, true)) + 2
    readPos += twoByteOffset ? 2 : 4
  }

  const frames = new Array<ISpriteFrame>(imageCount)
  for (let i = 0; i < imageCount; i++) {
    frames[i] = new ShpD2Frame(dv, buffer, offsets[i]!)
  }

  return frames
}

// ---------------------------------------------------------------------------
// ShpD2Loader / ISpriteLoader 实现
// ---------------------------------------------------------------------------

/**
 * Dune 2000 SHP 精灵加载器。
 *
 * OpenRA 对照: ShpD2Loader (class, ISpriteLoader)
 *
 * 解析 Dune 2000 的 SHP 精灵格式变体。与 TD SHP 类似但
 * 使用不同的帧头结构（包括调色板表、LCW/RLEZeros 压缩）。
 */
class ShpD2LoaderImpl implements ISpriteLoader {
  tryParseSprite(
    data: Uint8Array,
    _filename: string,
  ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } | null {
    if (!isShpD2(data)) {
      return null
    }

    const frames = parseFrames(data)
    return { frames, metadata: null }
  }
}

export const ShpD2Loader: ISpriteLoader = new ShpD2LoaderImpl()
