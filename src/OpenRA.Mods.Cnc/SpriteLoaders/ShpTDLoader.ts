/**
 * ShpTDLoader.ts — Tiberian Dawn SHP 精灵格式加载器
 * OpenRA 对照: OpenRA.Mods.Cnc/SpriteLoaders/ShpTDLoader.cs
 *
 * 核心范式转换:
 * - C# Stream s → Uint8Array buffer + DataView
 * - C# Array.Copy → Uint8Array.set / Uint8Array.subarray
 * - C# float2 → { x, y } 对象
 * - C# Size → { width, height }
 * - C# LCW + XOR Delta 压缩 → 线对线移植的 Compression.ts
 * - TrimmedFrame 裁剪逻辑完整保留
 *
 * SHP TD 格式:
 * - 头部: imageCount(2) + 零(2) + 零(2) + width(2) + height(2) + 零(4)
 * - 每个帧: fileOffset(3bytes) | format(1byte) + refOffset(2) + refFormat(2)
 * - 格式标记: 0x20 = XORPrev, 0x40 = XORLCW, 0x80 = LCW
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
  XORDeltaCompression,
} from '../FileFormats/Compression.js'

// ---------------------------------------------------------------------------
// 格式枚举 (对应 OpenRA ShpTDSprite.Format)
// ---------------------------------------------------------------------------

const Format = {
  XORPrev: 0x20,
  XORLCW: 0x40,
  LCW: 0x80,
} as const

// ---------------------------------------------------------------------------
// ImageHeader (对应 OpenRA ShpTDSprite.ImageHeader)
// ---------------------------------------------------------------------------

/**
 * SHP 帧的头部信息。
 *
 * OpenRA 对照: ShpTDSprite.ImageHeader
 */
class ImageHeader {
  type: SpriteFrameType = SpriteFrameType.Indexed8
  size: Size
  frameSize: Size
  offset: Float2 = { x: 0, y: 0 }
  data: Uint8Array | null = null
  disableExportPadding = false

  fileOffset: number
  format: number

  refOffset: number
  refFormat: number
  refImage: ImageHeader | null = null

  constructor(dv: DataView, offset: number, readerSize: Size) {
    // data = stream.ReadUInt32()
    // FileOffset = data & 0xffffff
    // Format = (Format)(data >> 24)
    const data = dv.getUint32(offset, true)
    this.fileOffset = data & 0xffffff
    this.format = (data >>> 24)

    // RefOffset = stream.ReadUInt16()
    // RefFormat = (Format)stream.ReadUInt16()
    this.refOffset = dv.getUint16(offset + 4, true)
    this.refFormat = dv.getUint16(offset + 6, true)

    this.size = readerSize
    this.frameSize = readerSize
  }
}

// ---------------------------------------------------------------------------
// 格式检测 (对应 OpenRA ShpTDLoader.IsShpTD)
// ---------------------------------------------------------------------------

/**
 * 检测是否为 Tiberian Dawn SHP 格式。
 *
 * OpenRA 对照: ShpTDLoader.IsShpTD(Stream)
 */
function isShpTD(buffer: Uint8Array): boolean {
  if (buffer.length < 25) return false

  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  // First word is the image count
  const imageCount = dv.getUint16(0, true)
  if (imageCount === 0) return false

  // Last offset should point to the end of file
  const finalOffset = 14 + 8 * imageCount
  if (finalOffset > buffer.length) return false

  const eof = dv.getUint32(finalOffset, true)
  if (eof !== buffer.length) return false

  // Check the format flag on the first frame
  const b = buffer[17]!
  return b === 0x20 || b === 0x40 || b === 0x80
}

// ---------------------------------------------------------------------------
// ShpTDSprite (对应 OpenRA ShpTDSprite)
// ---------------------------------------------------------------------------

/**
 * Tiberian Dawn SHP 精灵数据解析器。
 *
 * OpenRA 对照: ShpTDSprite (class)
 */
class ShpTDSprite {
  readonly frames: ISpriteFrame[]
  readonly size: Size
  private readonly imageCount: number
  private readonly shpBytes: Uint8Array
  private readonly shpBytesFileOffset: number
  private recurseDepth = 0

  constructor(buffer: Uint8Array) {
    const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    this.imageCount = dv.getUint16(0, true)
    // skip 4 bytes (zero pad)
    const width = dv.getUint16(6, true)
    const height = dv.getUint16(8, true)
    this.size = { width, height }

    // skip 4 bytes (zero pad)
    // Headers start at offset 14
    const headerStart = 14
    const headerSize = 8
    const headers = new Array<ImageHeader>(this.imageCount)
    for (let i = 0; i < this.imageCount; i++) {
      const hdrOffset = headerStart + i * headerSize
      headers[i] = new ImageHeader(dv, hdrOffset, this.size)
    }

    // Skip eof and zero headers (16 bytes)
    this.shpBytesFileOffset = headerStart + (this.imageCount + 2) * headerSize

    // Build offset lookup and resolve references
    const offsets = new Map<number, ImageHeader>()
    for (let i = 0; i < this.imageCount; i++) {
      const h = headers[i]!
      offsets.set(h.fileOffset, h)
    }

    for (let i = 0; i < this.imageCount; i++) {
      const h = headers[i]!
      if (h.format === Format.XORPrev) {
        h.refImage = headers[i - 1]!
      } else if (h.format === Format.XORLCW) {
        const ref = offsets.get(h.refOffset)
        if (!ref) {
          throw new Error(
            `Reference doesn't point to image data ${h.fileOffset}->${h.refOffset}`,
          )
        }
        h.refImage = ref
      }
    }

    this.shpBytes = buffer.subarray(this.shpBytesFileOffset)

    // Decompress all frames
    for (let i = 0; i < this.imageCount; i++) {
      this.decompress(headers[i]!)
    }

    // Apply trimming
    this.frames = headers.map((h) => new TrimmedFrame(h))
  }

  // -----------------------------------------------------------------------
  // Decompress (对应 OpenRA ShpTDSprite.Decompress)
  // -----------------------------------------------------------------------

  /**
   * 解压单个帧的图像数据。
   *
   * OpenRA 对照: ShpTDSprite.Decompress(ImageHeader)
   */
  private decompress(h: ImageHeader): void {
    // No extra work is required for empty frames
    if (h.size.width === 0 || h.size.height === 0) return

    if (this.recurseDepth > this.imageCount) {
      throw new Error('Format20/40 headers contain infinite loop')
    }

    switch (h.format) {
      case Format.XORPrev:
      case Format.XORLCW: {
        if (h.refImage!.data === null) {
          ++this.recurseDepth
          this.decompress(h.refImage!)
          --this.recurseDepth
        }

        h.data = this.copyImageData(h.refImage!.data!)
        XORDeltaCompression.decodeInto(
          this.shpBytes,
          h.data,
          h.fileOffset - this.shpBytesFileOffset,
        )
        break
      }

      case Format.LCW: {
        const imageBytes = new Uint8Array(this.size.width * this.size.height)
        LCWCompression.decodeInto(
          this.shpBytes,
          imageBytes,
          h.fileOffset - this.shpBytesFileOffset,
        )
        h.data = imageBytes
        break
      }

      default:
        throw new Error(`Unknown SHP format: ${h.format}`)
    }
  }

  /**
   * 复制参考帧的图像数据。
   *
   * OpenRA 对照: ShpTDSprite.CopyImageData(byte[])
   */
  private copyImageData(baseImage: Uint8Array): Uint8Array {
    const imageData = new Uint8Array(this.size.width * this.size.height)
    imageData.set(baseImage.subarray(0, imageData.length))
    return imageData
  }
}

// ---------------------------------------------------------------------------
// TrimmedFrame (对应 OpenRA ShpTDSprite.TrimmedFrame)
// ---------------------------------------------------------------------------

/**
 * 自动裁剪空白边缘的精灵帧。
 *
 * OpenRA 对照: ShpTDSprite.TrimmedFrame
 *
 * 扫描帧的像素数据，找到左、上、右、下边缘的非零像素边界，
 * 然后裁剪掉空白区域并计算新的偏移量。
 * 裁剪确保宽度和高度的变化量为偶数，以避免子像素偏移。
 */
class TrimmedFrame implements ISpriteFrame {
  readonly type = SpriteFrameType.Indexed8
  readonly size: Size
  readonly frameSize: Size
  readonly offset: Float2
  readonly data: Uint8Array
  readonly disableExportPadding = false

  constructor(header: ImageHeader) {
    const origSize = header.size

    // Handle empty frames (no data)
    if (header.data === null) {
      this.size = { width: 0, height: 0 }
      this.frameSize = { width: origSize.width, height: origSize.height }
      this.offset = { x: 0, y: 0 }
      this.data = new Uint8Array(0)
      return
    }

    const origData = header.data
    let top = origSize.height - 1
    let bottom = 0
    let left = origSize.width - 1
    let right = 0

    // Scan frame data to find non-zero pixel boundaries
    let idx = 0
    for (let y = 0; y < origSize.height; y++) {
      for (let x = 0; x < origSize.width; x++, idx++) {
        if (origData[idx] !== 0) {
          if (y < top) top = y
          if (y > bottom) bottom = y
          if (x < left) left = x
          if (x > right) right = x
        }
      }
    }

    let trimmedWidth = right - left + 1
    let trimmedHeight = bottom - top + 1

    // We must be careful to subtract an even number
    // of rows/columns to avoid sub-pixel offsets.
    if ((trimmedWidth - origSize.width) % 2 !== 0) {
      if (left > 0) {
        left--
      } else {
        right++
      }
      trimmedWidth++
    }

    if ((trimmedHeight - origSize.height) % 2 !== 0) {
      if (top > 0) {
        top--
      } else {
        bottom++
      }
      trimmedHeight++
    }

    if (
      trimmedWidth === origSize.width &&
      trimmedHeight === origSize.height
    ) {
      // Nothing to trim, so copy old data directly.
      this.size = { width: origSize.width, height: origSize.height }
      this.frameSize = { width: origSize.width, height: origSize.height }
      this.offset = { x: 0, y: 0 }
      this.data = origData
      return
    }

    // We must have valid trimmed dimensions at this point
    const finalTrimWidth = trimmedWidth > 0 ? trimmedWidth : 1
    const finalTrimHeight = trimmedHeight > 0 ? trimmedHeight : 1

    // Trim frame.
    const data = new Uint8Array(finalTrimWidth * finalTrimHeight)
    for (let y = 0; y < finalTrimHeight; y++) {
      const srcStart = (y + top) * origSize.width + left
      const dstStart = y * finalTrimWidth
      data.set(
        origData.subarray(srcStart, srcStart + finalTrimWidth),
        dstStart,
      )
    }

    this.size = { width: finalTrimWidth, height: finalTrimHeight }
    this.frameSize = {
      width: origSize.width,
      height: origSize.height,
    }
    this.offset = {
      x: 0.5 * (left + right - origSize.width + 1),
      y: 0.5 * (top + bottom - origSize.height + 1),
    }

    if (this.offset.x % 1 !== 0 || this.offset.y % 1 !== 0) {
      throw new Error('Trimmed frame has non-integer offset.')
    }
    this.data = data
  }
}

// ---------------------------------------------------------------------------
// ShpTDLoader / ISpriteLoader 实现
// ---------------------------------------------------------------------------

/**
 * Tiberian Dawn SHP 精灵加载器。
 *
 * OpenRA 对照: ShpTDLoader (class, ISpriteLoader)
 *
 * 解析 Tiberian Dawn 的 SHP 精灵格式，支持 LCW 压缩帧、
 * XOR Delta 帧间差分、以及自动空白边缘裁剪。
 */
class ShpTDLoaderImpl implements ISpriteLoader {
  tryParseSprite(
    data: Uint8Array,
    _filename: string,
  ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } | null {
    if (!isShpTD(data)) {
      return null
    }

    const sprite = new ShpTDSprite(data)
    return { frames: sprite.frames, metadata: null }
  }
}

export const ShpTDLoader: ISpriteLoader = new ShpTDLoaderImpl()
