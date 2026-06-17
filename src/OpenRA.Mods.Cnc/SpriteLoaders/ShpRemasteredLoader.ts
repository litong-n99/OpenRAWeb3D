/**
 * ShpRemasteredLoader.ts — 重制版 SHP 精灵加载器 (ZIP 容器包装)
 * OpenRA 对照: OpenRA.Mods.Cnc/SpriteLoaders/ShpRemasteredLoader.cs
 *
 * 核心范式转换:
 * - C# ZipFile (SharpZipLib) → 手动解析 ZIP 格式 (本地文件头)
 * - C# TgaSprite.TgaFrame → 简化的 TGA 帧解码器
 * - C# Regex 帧名匹配 → 手动字符串解析
 * - C# meta JSON 裁剪 → 手动 JSON 解析 + 裁剪
 *
 * 重制版 SHP 是一个 ZIP 文件，包含:
 * - 帧图像: {prefix}0000.tga, {prefix}0001.tga, ...
 * - 元数据: {prefix}0000.meta, {prefix}0001.meta, ... (可选)
 * Meta JSON 格式: {"size":[width,height],"crop":[left,top,right,bottom]}
 */

import {
  type ISpriteLoader,
  type ISpriteFrame,
  type Size,
  type Float2,
  SpriteFrameType,
} from '../../OpenRA.Game/Graphics/SpriteLoader.js'

// ---------------------------------------------------------------------------
// 帧名解析 (对应 OpenRA ShpRemasteredSprite 静态 Regex)
// ---------------------------------------------------------------------------

const FRAME_REGEX = /^(.+?[-_])(\d{4})\.tga$/i
const META_REGEX = /\{"size":\[(\d+),(\d+)\],"crop":\[(\d+),(\d+),(\d+),(\d+)\]\}/

// ---------------------------------------------------------------------------
// TGA 帧 (对应 OpenRA TgaSprite.TgaFrame)
// ---------------------------------------------------------------------------

/**
 * 简化的 TGA 图像帧解码器。
 *
 * 支持 32-bit BGRA 未压缩 TGA 和 24-bit BGR 未压缩 TGA。
 *
 * OpenRA 对照: OpenRA.Mods.Common.SpriteLoaders.TgaSprite.TgaFrame
 */
class TgaFrame implements ISpriteFrame {
  readonly type = SpriteFrameType.Bgra32
  readonly size: Size
  readonly frameSize: Size
  readonly offset: Float2 = { x: 0, y: 0 }
  readonly data: Uint8Array
  readonly disableExportPadding = false

  private readonly cropLeft: number
  private readonly cropTop: number
  private readonly cropRight: number
  private readonly cropBottom: number
  private readonly hasRealCrop: boolean

  /**
   * 从 TGA 字节数据创建帧。
   *
   * @param tgaData — TGA 文件的完整字节数据
   * @param frameSize — 可选: meta JSON 指定的帧尺寸
   * @param cropRect — 可选: meta JSON 指定的裁剪矩形 [left, top, right, bottom]
   */
  constructor(
    tgaData: Uint8Array,
    frameSize?: Size,
    cropRect?: [number, number, number, number],
  ) {
    if (tgaData.length === 0) {
      this.size = { width: 0, height: 0 }
      this.frameSize = { width: 0, height: 0 }
      this.data = new Uint8Array(0)
      this.cropLeft = 0
      this.cropTop = 0
      this.cropRight = 0
      this.cropBottom = 0
      this.hasRealCrop = false
      return
    }

    const dv = new DataView(tgaData.buffer, tgaData.byteOffset, tgaData.byteLength)

    // TGA 头部: idLength(1) + colorMapType(1) + imageType(1) + ...
    // offset 12: width(2), offset 14: height(2), offset 16: bpp(1)
    const width = dv.getUint16(12, true)
    const height = dv.getUint16(14, true)
    const bpp = tgaData[16]!
    const imageType = tgaData[2]!

    // TGA 图像数据在头部之后，跳过 ID 字段
    const idLength = tgaData[0]!
    const colorMapType = tgaData[1]!
    let dataOffset = 18 + idLength

    // If color map present, skip it (we only handle truecolor)
    if (colorMapType === 1) {
      const colorMapLength = dv.getUint16(5, true)
      const colorMapEntrySize = tgaData[7]!
      dataOffset += colorMapLength * (colorMapEntrySize / 8)
    }

    this.cropLeft = cropRect?.[0] ?? 0
    this.cropTop = cropRect?.[1] ?? 0
    this.cropRight = cropRect?.[2] ?? width - 1
    this.cropBottom = cropRect?.[3] ?? height - 1
    this.hasRealCrop = cropRect !== undefined

    const cropWidth = this.cropRight - this.cropLeft + 1
    const cropHeight = this.cropBottom - this.cropTop + 1

    this.frameSize = frameSize
      ? { width: frameSize.width, height: frameSize.height }
      : { width, height }
    this.size = { width: cropWidth, height: cropHeight }

    const pixelCount = cropWidth * cropHeight
    this.data = new Uint8Array(pixelCount * 4)

    if (imageType === 2 && bpp === 24) {
      // 24-bit BGR → 32-bit BGRA
      for (let y = 0; y < cropHeight; y++) {
        const srcY = (height - 1 - (y + this.cropTop))
        for (let x = 0; x < cropWidth; x++) {
          const srcX = x + this.cropLeft
          const srcIdx = dataOffset + srcY * width * 3 + srcX * 3
          const dstIdx = (y * cropWidth + x) * 4
          this.data[dstIdx] = tgaData[srcIdx]!     // B
          this.data[dstIdx + 1] = tgaData[srcIdx + 1]! // G
          this.data[dstIdx + 2] = tgaData[srcIdx + 2]! // R
          this.data[dstIdx + 3] = 255                 // A
        }
      }
    } else if ((imageType === 2 || imageType === 10) && bpp === 32) {
      // 32-bit BGRA (uncompressed or RLE)
      if (imageType === 10) {
        // RLE compressed 32-bit
        this.decodeRLE32(tgaData, dataOffset, width, height, cropWidth, cropHeight)
      } else {
        // Uncompressed 32-bit BGRA
        for (let y = 0; y < cropHeight; y++) {
          const srcY = (height - 1 - (y + this.cropTop))
          const srcIdx = dataOffset + srcY * width * 4 + this.cropLeft * 4
          const dstIdx = y * cropWidth * 4
          this.data.set(
            tgaData.subarray(srcIdx, srcIdx + cropWidth * 4),
            dstIdx,
          )
        }
      }
    }
    // If unsupported format, data stays as empty/filled zeroes

    if (this.hasRealCrop) {
      const oX = 0.5 * (this.cropLeft + this.cropRight - this.frameSize.width + 1)
      const oY = 0.5 * (this.cropTop + this.cropBottom - this.frameSize.height + 1)
      ;(this as { offset: Float2 }).offset = { x: oX, y: oY }
    }
  }

  /**
   * 解码 32-bit RLE TGA 压缩数据。
   */
  private decodeRLE32(
    tgaData: Uint8Array,
    dataOffset: number,
    width: number,
    height: number,
    cropWidth: number,
    cropHeight: number,
  ): void {
    const pixels = new Uint8Array(width * height * 4)
    const pixelCount = width * height
    let i = 0
    let pos = dataOffset

    while (i < pixelCount) {
      const header = tgaData[pos++]!
      const count = (header & 0x7f) + 1
      const isRLE = (header & 0x80) !== 0

      if (isRLE) {
        const b = tgaData[pos++]!
        const g = tgaData[pos++]!
        const r = tgaData[pos++]!
        const a = tgaData[pos++]!
        for (let j = 0; j < count && i < pixelCount; j++, i++) {
          const idx = i * 4
          pixels[idx] = b
          pixels[idx + 1] = g
          pixels[idx + 2] = r
          pixels[idx + 3] = a
        }
      } else {
        for (let j = 0; j < count && i < pixelCount; j++, i++) {
          const idx = i * 4
          pixels[idx] = tgaData[pos++]!
          pixels[idx + 1] = tgaData[pos++]!
          pixels[idx + 2] = tgaData[pos++]!
          pixels[idx + 3] = tgaData[pos++]!
        }
      }
    }

    // Extract cropped region
    for (let y = 0; y < cropHeight; y++) {
      const srcY = (height - 1 - (y + this.cropTop))
      const srcIdx = srcY * width * 4 + this.cropLeft * 4
      const dstIdx = y * cropWidth * 4
      this.data.set(
        pixels.subarray(srcIdx, srcIdx + cropWidth * 4),
        dstIdx,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// TGA 空白帧 (对应 OpenRA TgaSprite.TgaFrame 默认构造)
// ---------------------------------------------------------------------------

/** 空白 TGA 帧（无图像数据）。
 *
 * OpenRA 对照: new TgaSprite.TgaFrame() (无参构造)
 */
function createBlankTgaFrame(): ISpriteFrame {
  return new TgaFrame(new Uint8Array(0))
}

// ---------------------------------------------------------------------------
// ZIP 解析 (简化的本地文件头解析)
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string
  offset: number
  compressedSize: number
  uncompressedSize: number
  compression: number
}

/**
 * 从 ZIP 缓冲区解析本地文件条目。
 * 这只是一个简化的实现，足以处理重制版 SHP 的 ZIP。
 */
function parseZipEntries(buffer: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = []
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let offset = 0

  while (offset + 30 <= buffer.length) {
    const signature = dv.getUint32(offset, true)
    if (signature !== 0x04034b50) {
      // Stop at central directory or EOF
      if (signature === 0x02014b50 || signature === 0x06054b50) break
      offset++
      continue
    }

    const compression = dv.getUint16(offset + 10, true)
    const compressedSize = dv.getUint32(offset + 18, true)
    const uncompressedSize = dv.getUint32(offset + 22, true)
    const nameLength = dv.getUint16(offset + 26, true)
    const extraLength = dv.getUint16(offset + 28, true)

    const nameBytes = buffer.subarray(
      offset + 30,
      offset + 30 + nameLength,
    )
    const name = new TextDecoder('ascii').decode(nameBytes)

    const dataOffset = offset + 30 + nameLength + extraLength

    entries.push({
      name,
      offset: dataOffset,
      compressedSize,
      uncompressedSize,
      compression,
    })

    offset = dataOffset + compressedSize
  }

  return entries
}

/**
 * 从 ZIP 条目中提取（解压）数据。
 * 支持存储模式 (compression=0) 和紧缩模式 (compression=8)。
 */
function extractEntry(
  buffer: Uint8Array,
  entry: ZipEntry,
): Uint8Array {
  if (entry.compression === 0) {
    // Stored (no compression)
    return new Uint8Array(
      buffer.subarray(entry.offset, entry.offset + entry.compressedSize),
    )
  }
  if (entry.compression === 8) {
    // Deflate — use browser's DecompressionStream
    // For now, we return empty; deflate decompression requires async
    // NOTE: In the browser, use DecompressionStream('deflate-raw')
    // This simplified implementation only handles stored entries.
    // Remastered SHP ZIP files typically use stored mode.
    throw new Error(
      `ZIP entry "${entry.name}" is deflate-compressed, which requires async decompression.`,
    )
  }
  throw new Error(
    `Unsupported ZIP compression method: ${entry.compression}`,
  )
}

// ---------------------------------------------------------------------------
// 格式检测 (对应 OpenRA ShpRemasteredLoader.IsShpRemastered)
// ---------------------------------------------------------------------------

/**
 * 检测是否为重制版 SHP (ZIP 文件)。
 *
 * OpenRA 对照: ShpRemasteredLoader.IsShpRemastered(Stream)
 */
function isShpRemastered(buffer: Uint8Array): boolean {
  if (buffer.length < 4) return false
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  return dv.getUint32(0, true) === 0x04034b50
}

// ---------------------------------------------------------------------------
// ShpRemasteredSprite (对应 OpenRA ShpRemasteredSprite)
// ---------------------------------------------------------------------------

/**
 * 重制版 SHP 精灵数据解析器。
 *
 * OpenRA 对照: ShpRemasteredSprite (class)
 */
class ShpRemasteredSprite {
  readonly frames: ISpriteFrame[]

  constructor(buffer: Uint8Array) {
    const entries = parseZipEntries(buffer)

    // Find TGA frames with matching prefix
    let framePrefix: string | null = null
    let frameCount = 0

    for (const entry of entries) {
      const match = FRAME_REGEX.exec(entry.name)
      if (!match) continue

      const prefix = match[1]!
      if (framePrefix === null) {
        framePrefix = prefix
      } else if (prefix !== framePrefix) {
        throw new Error(
          `Frame prefix mismatch: "${prefix}" != "${framePrefix}"`,
        )
      }

      const frameNum = parseInt(match[2]!, 10)
      frameCount = Math.max(frameCount, frameNum + 1)
    }

    const frames = new Array<ISpriteFrame>(frameCount)

    // Build a map of entry name → entry for quick lookup
    const entryMap = new Map<string, ZipEntry>()
    for (const entry of entries) {
      entryMap.set(entry.name, entry)
    }

    for (let i = 0; i < frameCount; i++) {
      const tgaName = `${framePrefix}${i.toString().padStart(4, '0')}.tga`
      const metaName = `${framePrefix}${i.toString().padStart(4, '0')}.meta`

      const tgaEntry = entryMap.get(tgaName)

      // Blank frame
      if (!tgaEntry) {
        frames[i] = createBlankTgaFrame()
        continue
      }

      const tgaData = extractEntry(buffer, tgaEntry)
      const metaEntry = entryMap.get(metaName)

      if (metaEntry) {
        const metaBytes = extractEntry(buffer, metaEntry)
        const metaText = new TextDecoder('ascii').decode(metaBytes)
        const metaMatch = META_REGEX.exec(metaText)

        if (metaMatch) {
          const left = parseInt(metaMatch[3]!, 10)
          const top = parseInt(metaMatch[4]!, 10)
          const right = parseInt(metaMatch[5]!, 10)
          const bottom = parseInt(metaMatch[6]!, 10)
          const fw = parseInt(metaMatch[1]!, 10)
          const fh = parseInt(metaMatch[2]!, 10)

          frames[i] = new TgaFrame(tgaData, { width: fw, height: fh }, [
            left,
            top,
            right,
            bottom,
          ])
        } else {
          frames[i] = new TgaFrame(tgaData)
        }
      } else {
        frames[i] = new TgaFrame(tgaData)
      }
    }

    this.frames = frames
  }
}

// ---------------------------------------------------------------------------
// ShpRemasteredLoader / ISpriteLoader 实现
// ---------------------------------------------------------------------------

/**
 * 重制版 SHP 精灵加载器（ZIP 容器包装）。
 *
 * OpenRA 对照: ShpRemasteredLoader (class, ISpriteLoader)
 *
 * 解析重制版 SHP 文件，这是一个包含 TGA 帧和 meta JSON 的 ZIP 容器。
 */
class ShpRemasteredLoaderImpl implements ISpriteLoader {
  tryParseSprite(
    data: Uint8Array,
    _filename: string,
  ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } | null {
    if (!isShpRemastered(data)) {
      return null
    }

    const sprite = new ShpRemasteredSprite(data)
    return { frames: sprite.frames, metadata: null }
  }
}

export const ShpRemasteredLoader: ISpriteLoader =
  new ShpRemasteredLoaderImpl()
