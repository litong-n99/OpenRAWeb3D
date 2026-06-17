/**
 * TmpRALoader.ts — Red Alert 地形 TMP 精灵加载器
 * OpenRA 对照: OpenRA.Mods.Cnc/SpriteLoaders/TmpRALoader.cs
 *
 * 核心范式转换:
 * - C# Stream s → Uint8Array buffer + DataView
 * - C# out ISpriteFrame[] frames → 返回值
 * - RA TMP 格式: 与 TD TMP 类似但头部偏移不同 (header is 8 bytes larger)
 */

import {
  type ISpriteLoader,
  type ISpriteFrame,
  type Size,
  type Float2,
  SpriteFrameType,
} from '../../OpenRA.Game/Graphics/SpriteLoader.js'

// ---------------------------------------------------------------------------
// TmpRAFrame (对应 OpenRA TmpRALoader.TmpRAFrame)
// ---------------------------------------------------------------------------

/**
 * 单个 TMP RA 帧。
 *
 * OpenRA 对照: TmpRALoader.TmpRAFrame
 */
class TmpRAFrame implements ISpriteFrame {
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
// 格式检测 (对应 OpenRA IsTmpRA)
// ---------------------------------------------------------------------------

/** TMP RA 文件格式魔数检测。
 *
 * OpenRA 对照: TmpRALoader.IsTmpRA(Stream)
 */
function isTmpRA(dv: DataView): boolean {
  if (dv.byteLength < 28) return false

  // offset 20: uint32 a == 0
  const a = dv.getUint32(20, true)
  // offset 26: uint16 b == 0x2c73
  const b = dv.getUint16(26, true)
  return a === 0 && b === 0x2c73
}

// ---------------------------------------------------------------------------
// 帧解析 (对应 OpenRA TmpRALoader.ParseFrames)
// ---------------------------------------------------------------------------

/**
 * 解析 TMP RA 文件中的所有瓦片精灵帧。
 *
 * OpenRA 对照: TmpRALoader.ParseFrames(Stream)
 */
function parseFrames(buffer: Uint8Array): ISpriteFrame[] {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const width = dv.getUint16(0, true)
  const height = dv.getUint16(2, true)
  const size: Size = { width, height }

  // C# reads: s.Position += 12 → imgStart (at 16) →
  //   s.Position += 8 → indexEnd (at 28) →
  //   s.Position += 4 → indexStart (at 36)
  const imgStart = dv.getUint32(16, true)
  const indexEnd = dv.getInt32(28, true)
  const indexStart = dv.getInt32(36, true)

  const count = indexEnd - indexStart
  const tiles: ISpriteFrame[] = new Array(count)

  let tilesIndex = 0
  const tileSize = width * height

  for (let i = 0; i < count; i++) {
    const b = buffer[indexStart + i]!

    if (b !== 255) {
      const pixelOffset = imgStart + b * tileSize
      const pixelData = buffer.subarray(pixelOffset, pixelOffset + tileSize)
      tiles[tilesIndex++] = new TmpRAFrame(
        new Uint8Array(pixelData),
        size,
      )
    } else {
      tiles[tilesIndex++] = new TmpRAFrame(null, size)
    }
  }

  return tiles
}

// ---------------------------------------------------------------------------
// TmpRALoader / ISpriteLoader 实现
// ---------------------------------------------------------------------------

/**
 * Red Alert 地形 TMP 精灵加载器。
 *
 * OpenRA 对照: TmpRALoader (class, ISpriteLoader)
 *
 * 解析 Red Alert 的地形瓦片 TMP 格式。
 * 头部比 TD TMP 多 8 字节（额外的 2 个 uint32 字段）。
 *
 * TMP RA 格式:
 * - 头部: width(2) height(2) + 12 字节填充 + imgStart(4) + 8 字节填充
 *   + indexEnd(4) + 4 字节填充 + indexStart(4)
 * - 索引表: 每个字节是一个瓦片索引 (255 = 空白)
 * - 图像数据: 每个瓦片 width*height 字节的像素数据
 */
class TmpRALoaderImpl implements ISpriteLoader {
  tryParseSprite(
    data: Uint8Array,
    _filename: string,
  ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } | null {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (!isTmpRA(dv)) {
      return null
    }

    const frames = parseFrames(data)
    return { frames, metadata: null }
  }
}

export const TmpRALoader: ISpriteLoader = new TmpRALoaderImpl()
