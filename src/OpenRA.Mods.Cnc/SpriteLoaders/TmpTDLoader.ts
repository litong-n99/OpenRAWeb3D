/**
 * TmpTDLoader.ts — Tiberian Dawn 地形 TMP 精灵加载器
 * OpenRA 对照: OpenRA.Mods.Cnc/SpriteLoaders/TmpTDLoader.cs
 *
 * 核心范式转换:
 * - C# Stream s → Uint8Array buffer + 手动偏移游标
 * - C# out ISpriteFrame[] frames → 返回值
 * - C# ReadUInt16/ReadUInt32 → DataView 小端读取
 * - C# ReadBytes → Uint8Array.subarray()
 * - TD TMP 格式: 固定 24x24 像素瓦片，通过索引表引用图像数据
 */

import {
  type ISpriteLoader,
  type ISpriteFrame,
  type Size,
  type Float2,
  SpriteFrameType,
} from '../../OpenRA.Game/Graphics/SpriteLoader.js'

// ---------------------------------------------------------------------------
// TmpTDFrame (对应 OpenRA TmpTDLoader.TmpTDFrame)
// ---------------------------------------------------------------------------

/**
 * 单个 TMP TD 帧。
 *
 * OpenRA 对照: TmpTDLoader.TmpTDFrame
 */
class TmpTDFrame implements ISpriteFrame {
  readonly type = SpriteFrameType.Indexed8
  readonly size: Size
  readonly frameSize: Size
  readonly offset: Float2 = { x: 0, y: 0 }
  readonly data: Uint8Array
  readonly disableExportPadding = false

  constructor(pixelData: Uint8Array | null, frameSize: Size) {
    this.frameSize = frameSize

    if (pixelData === null) {
      this.data = new Uint8Array(0)
      this.size = { width: 0, height: 0 }
    } else {
      this.data = pixelData
      this.size = { width: frameSize.width, height: frameSize.height }
    }
  }
}

// ---------------------------------------------------------------------------
// 格式检测 (对应 OpenRA IsTmpTD)
// ---------------------------------------------------------------------------

/** TMP TD 文件格式魔数检测。
 *
 * OpenRA 对照: TmpTDLoader.IsTmpTD(Stream)
 */
function isTmpTD(dv: DataView): boolean {
  if (dv.byteLength < 24) return false

  // offset 16: uint32 a, offset 20: uint32 b
  // a == 0 && b == 0x0D1AFFFF
  const a = dv.getUint32(16, true)
  const b = dv.getUint32(20, true)
  return a === 0 && b === 0x0d1affff
}

// ---------------------------------------------------------------------------
// 帧解析 (对应 OpenRA TmpTDLoader.ParseFrames)
// ---------------------------------------------------------------------------

/**
 * 解析 TMP TD 文件中的所有瓦片精灵帧。
 *
 * OpenRA 对照: TmpTDLoader.ParseFrames(Stream)
 */
function parseFrames(buffer: Uint8Array): ISpriteFrame[] {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const width = dv.getUint16(0, true)
  const height = dv.getUint16(2, true)
  const size: Size = { width, height }

  // C# reads: s.Position += 8 → imgStart (at 12) →
  //   s.Position += 8 → indexEnd (at 24) → indexStart (at 28)
  const imgStart = dv.getUint32(12, true)
  const indexEnd = dv.getInt32(24, true)
  const indexStart = dv.getInt32(28, true)

  const count = indexEnd - indexStart
  const tiles: ISpriteFrame[] = new Array(count)

  let tilesIndex = 0
  const tileSize = width * height

  for (let i = 0; i < count; i++) {
    const b = buffer[indexStart + i]!

    if (b !== 255) {
      const pixelOffset = imgStart + b * tileSize
      const pixelData = buffer.subarray(pixelOffset, pixelOffset + tileSize)
      tiles[tilesIndex++] = new TmpTDFrame(
        new Uint8Array(pixelData),
        size,
      )
    } else {
      tiles[tilesIndex++] = new TmpTDFrame(null, size)
    }
  }

  return tiles
}

// ---------------------------------------------------------------------------
// ShpTDLoader / ISpriteLoader 实现
// ---------------------------------------------------------------------------

/**
 * Tiberian Dawn 地形 TMP 精灵加载器。
 *
 * OpenRA 对照: TmpTDLoader (class, ISpriteLoader)
 *
 * 解析 Tiberian Dawn 的地形瓦片 TMP 格式。
 * 瓦片为 24x24 像素，索引色 (8-bit)。
 *
 * TMP 格式:
 * - 头部: width(2) height(2) ... imgStart(4) ... indexEnd(4) indexStart(4)
 * - 索引表: 每个字节是一个瓦片索引 (255 = 空白)
 * - 图像数据: 每个瓦片 width*height 字节的像素数据
 */
class TmpTDLoaderImpl implements ISpriteLoader {
  tryParseSprite(
    data: Uint8Array,
    _filename: string,
  ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } | null {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (!isTmpTD(dv)) {
      return null
    }

    const frames = parseFrames(data)
    return { frames, metadata: null }
  }
}

export const TmpTDLoader: ISpriteLoader = new TmpTDLoaderImpl()
