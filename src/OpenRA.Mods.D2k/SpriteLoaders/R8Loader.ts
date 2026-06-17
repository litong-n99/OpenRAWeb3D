/**
 * R8Loader.ts — Dune 2000 R8 精灵格式加载器
 * OpenRA 对照: OpenRA.Mods.D2k/SpriteLoaders/R8Loader.cs
 *
 * 核心范式转换:
 * - C# Stream s → Uint8Array buffer + DataView
 * - C# uint[] Palette → Uint32Array
 * - C# MemoryMarshal.Cast → Uint32Array/Uint16Array 视图
 * - C# unsafe fixed(byte*) → 直接索引访问
 * - C# PlayerColorRemap → 简化的 240-255 区间重映射
 *
 * R8 格式是 Dune 2000 专用的精灵格式，每帧包含:
 * - 类型标记 (0=nop, 1=含调色板, 2=使用上一个调色板)
 * - 宽度、高度、偏移量
 * - 像素数据 (8-bit 索引色 或 16-bit RGB5551 打包)
 * - 可选的 256 色调色板 (RGB5551 打包 → ARGB8888)
 */

import {
  type ISpriteLoader,
  type ISpriteFrame,
  type Size,
  type Float2,
  SpriteFrameType,
} from '../../OpenRA.Game/Graphics/SpriteLoader.js'

// ---------------------------------------------------------------------------
// 调色板常量
// ---------------------------------------------------------------------------

const PALETTE_SIZE = 256

// ---------------------------------------------------------------------------
// Frame (对应 OpenRA R8Loader.Frame)
// ---------------------------------------------------------------------------

/**
 * 原始 R8 帧 (内部使用)。
 *
 * OpenRA 对照: R8Loader.Frame
 */
class R8Frame implements ISpriteFrame {
  type: SpriteFrameType
  readonly size: Size
  readonly frameSize: Size
  readonly offset: Float2
  readonly data: Uint8Array
  readonly disableExportPadding = true

  /** 调色板 ARGB 值 (256 个 uint32)，如果没有新调色板则为 null。 */
  readonly palette: Uint32Array | null

  constructor(
    buffer: Uint8Array,
    dv: DataView,
    offset: number,
    lastPalette: Uint32Array | null,
  ) {
    // Scan forward until we find some data (skip zero bytes)
    let type = buffer[offset]!
    offset++
    while (type === 0 && offset < buffer.length) {
      type = buffer[offset]!
      offset++
    }

    const width = dv.getInt32(offset, true)
    offset += 4
    const height = dv.getInt32(offset, true)
    offset += 4
    const x = dv.getInt32(offset, true)
    offset += 4
    const y = dv.getInt32(offset, true)
    offset += 4

    this.size = { width, height }
    this.offset = {
      x: width / 2 - x,
      y: height / 2 - y,
    }

    // imageHandle (skip 4 bytes)
    offset += 4
    // paletteHandle
    const paletteHandle = dv.getInt32(offset, true)
    offset += 4

    const bpp = buffer[offset]!
    offset++
    if (bpp !== 8 && bpp !== 16) {
      throw new Error(`R8 Error: ${bpp} bits per pixel are not supported.`)
    }

    const frameHeight = buffer[offset]!
    offset++
    const frameWidth = buffer[offset]!
    offset++
    this.frameSize = { width: frameWidth, height: frameHeight }

    // Skip alignment byte
    offset++

    if (bpp === 16) {
      this.data = new Uint8Array(width * height * 4)
      this.type = SpriteFrameType.Bgra32

      // Read 16-bit packed pixels (2 bytes per pixel)
      // C# reads Data[..(Data.Length / 2)] — first half as packed 16-bit

      // The C# code reads the raw 16-bit packed data into the first half of the byte buffer,
      // then unpacks in reverse order
      const rawBytes = buffer.subarray(offset, offset + width * height * 2)
      offset += width * height * 2

      // Unpack RGB5551 → ARGB8888 (reverse order, matching C#)
      for (let i = width * height - 1; i >= 0; i--) {
        const packed =
          (rawBytes[i * 2 + 1]! << 8) | rawBytes[i * 2]!
        const dstIdx = i * 4
        this.data[dstIdx] = 0xff // A
        this.data[dstIdx + 1] = ((packed & 0x7c00) >> 7) & 0xff // B = bits 10-14
        this.data[dstIdx + 2] = ((packed & 0x03e0) >> 2) & 0xff // G = bits 5-9
        this.data[dstIdx + 3] = ((packed & 0x001f) << 3) & 0xff // R = bits 0-4

        // Actually the C# packing is: (0xFF << 24) | ((packed & 0x7C00) << 9) | ((packed & 0x3E0) << 6) | ((packed & 0x1f) << 3)
        // This gives: A=0xFF, R=(packed>>10)&0x1F<<3, G=(packed>>5)&0x1F<<3, B=packed&0x1F<<3
        // So RGBA layout: R, G, B, A (since it's stored as uint32 LE)
        // In uint32 LE: byte[0]=R, byte[1]=G, byte[2]=B, byte[3]=A
        const r = ((packed >> 10) & 0x1f) << 3
        const g = ((packed >> 5) & 0x1f) << 3
        const b = (packed & 0x1f) << 3
        this.data[dstIdx] = r     // R → byte[0]
        this.data[dstIdx + 1] = g // G → byte[1]
        this.data[dstIdx + 2] = b // B → byte[2]
        this.data[dstIdx + 3] = 0xff // A → byte[3]
      }
    } else {
      // 8-bit indexed
      this.data = new Uint8Array(
        buffer.subarray(offset, offset + width * height),
      )
      offset += width * height
      this.type = SpriteFrameType.Indexed8
    }

    // Read palette
    if (type === 1 && paletteHandle !== 0) {
      // Skip header (2 uint32)
      const palHeader1 = dv.getUint32(offset, true)
      offset += 4
      const palHeader2 = dv.getUint32(offset, true)
      offset += 4

      // NOTE: C# skips these header values. We read them for potential validation.
      void palHeader1
      void palHeader2

      this.palette = new Uint32Array(PALETTE_SIZE)

      // Read palette as 16-bit RGB5551 packed values
      const palRaw = buffer.subarray(offset, offset + PALETTE_SIZE * 2)
      offset += PALETTE_SIZE * 2

      // Unpack RGB5551 → ARGB8888 (reverse order, matching C#)
      for (let i = 255; i >= 0; i--) {
        const packed =
          (palRaw[i * 2 + 1]! << 8) | palRaw[i * 2]!
        const r = ((packed >> 10) & 0x1f) << 3
        const g = ((packed >> 5) & 0x1f) << 3
        const b = (packed & 0x1f) << 3
        // BGRA: B, G, R, A
        this.palette[i] = (0xff << 24) | (b << 16) | (g << 8) | r
      }

      // Remap index 0 to transparent
      this.palette[0] = 0
    } else if (type === 2) {
      this.palette = lastPalette
    } else {
      this.palette = null
    }
  }
}

// ---------------------------------------------------------------------------
// RemappableFrame (对应 OpenRA R8Loader.RemappableFrame)
// ---------------------------------------------------------------------------

/**
 * 可重映射的 R8 帧 — 将索引色数据转换为 BGRA32 并应用阴影/迷雾/重映射。
 *
 * OpenRA 对照: R8Loader.RemappableFrame
 */
class RemappableFrame implements ISpriteFrame {
  readonly type = SpriteFrameType.Bgra32
  readonly size: Size
  readonly frameSize: Size
  readonly offset: Float2
  readonly disableExportPadding: boolean

  private readonly inner: R8Frame
  private readonly useShadow: boolean
  private readonly convertShroudToFog: boolean
  private readonly remapColor: number // ARGB packed
  private cachedData: Uint8Array | null = null

  constructor(
    inner: R8Frame,
    useShadow: boolean = true,
    convertShroudToFog: boolean = false,
    remapColor: number = 0,
  ) {
    this.inner = inner
    this.size = { width: inner.size.width, height: inner.size.height }
    this.frameSize = {
      width: inner.frameSize.width,
      height: inner.frameSize.height,
    }
    this.offset = { x: inner.offset.x, y: inner.offset.y }
    this.disableExportPadding = inner.disableExportPadding
    this.useShadow = useShadow
    this.convertShroudToFog = convertShroudToFog
    this.remapColor = remapColor
  }

  get data(): Uint8Array {
    if (this.cachedData === null) {
      this.cachedData = this.buildData()
    }
    return this.cachedData
  }

  /**
   * 构建 BGRA32 像素数据，应用调色板和效果。
   *
   * OpenRA 对照: RemappableFrame.Data getter
   */
  private buildData(): Uint8Array {
    const pixelCount = this.inner.size.width * this.inner.size.height
    const data = new Uint8Array(4 * pixelCount)

    const innerPalette = this.inner.palette
    if (!innerPalette) {
      // No palette — already in BGRA32 or blank
      return data
    }

    let palette = new Uint32Array(innerPalette)

    if (this.useShadow || this.convertShroudToFog || this.remapColor !== 0) {
      palette = new Uint32Array(PALETTE_SIZE)
      palette.set(innerPalette)
    }

    // Bit twiddling is equivalent to unpacking RGB channels, dividing them
    // by 2, subtracting from 255, then repacking
    if (this.convertShroudToFog) {
      for (let i = 0; i < PALETTE_SIZE; i++) {
        palette[i] = ~((palette[i]! >> 1) & 0x007f7f7f)
      }
    }

    // Remap index 1 to shadow (alpha only)
    if (this.useShadow) {
      palette[1] = 140 << 24
    }

    // PlayerColorRemap: remap indices 240-255 based on remapColor
    if (this.remapColor !== 0) {
      for (let i = 240; i < 256; i++) {
        palette[i] = R8LoaderImpl.remapColor(palette[i]!)
      }
    }

    // Convert indexed to BGRA
    const data32 = new Uint32Array(data.buffer, data.byteOffset, pixelCount)
    for (let i = 0; i < pixelCount; i++) {
      data32[i] = palette[this.inner.data[i]!]!
    }

    return data
  }

  /**
   * 克隆一个新的 RemappableFrame 并应用不同的标志。
   *
   * OpenRA 对照: RemappableFrame.WithSequenceFlags
   */
  withSequenceFlags(
    useShadow: boolean,
    convertShroudToFog: boolean,
    remapColor: number,
  ): RemappableFrame {
    return new RemappableFrame(
      this.inner,
      useShadow,
      convertShroudToFog,
      remapColor,
    )
  }
}

// ---------------------------------------------------------------------------
// 格式检测 (对应 OpenRA R8Loader.IsR8)
// ---------------------------------------------------------------------------

/**
 * 检测是否为 Dune 2000 R8 精灵格式。
 *
 * OpenRA 对照: R8Loader.IsR8(Stream)
 */
function isR8(buffer: Uint8Array): boolean {
  if (buffer.length < 26) return false

  // First byte is nonzero
  if (buffer[0] === 0) return false

  // Check the format of the first frame (offset 25: bpp byte)
  const d = buffer[25]!
  return d === 8 || d === 16
}

// ---------------------------------------------------------------------------
// R8Loader / ISpriteLoader 实现
// ---------------------------------------------------------------------------

/**
 * Dune 2000 R8 精灵加载器。
 *
 * OpenRA 对照: R8Loader (class, ISpriteLoader)
 *
 * 解析 Dune 2000 的 R8 精灵格式，支持 8-bit 索引色和 16-bit RGB5551。
 * 有调色板的帧包装为 RemappableFrame（支持阴影/迷雾/玩家颜色重映射）。
 */
class R8LoaderImpl implements ISpriteLoader {
  /**
   * 玩家颜色重映射。
   *
   * OpenRA 对照: PlayerColorRemap 逻辑
   *
   * 仅处理 240-255 区间的调色板索引重映射。
   */
  static remapColor(originalArgb: number): number {
    // Simplified PlayerColorRemap — for D2K, remap indices 240-255
    // based on the player's remap color.
    // Full implementation would use the PlayerColorRemap table.
    // For now, we return the original color unmodified.
    return originalArgb
  }

  tryParseSprite(
    data: Uint8Array,
    _filename: string,
  ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } | null {
    if (!isR8(data)) {
      return null
    }

    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)

    const rawFrames: R8Frame[] = []
    let lastPalette: Uint32Array | null = null
    let offset = 0

    while (offset < data.length) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const frame: R8Frame = new R8Frame(data, dv, offset, lastPalette)
      if (frame.palette !== null) {
        lastPalette = frame.palette
      }
      rawFrames.push(frame)
      // Advance to next frame; the R8Frame constructor doesn't tell us exact bytes consumed
      // We need to track position manually
      // Re-read frame to get exact bytes consumed
      offset = R8LoaderImpl.advancePastFrame(data, dv, offset)
    }

    const frames: ISpriteFrame[] = rawFrames.map((f) =>
      f.palette !== null ? new RemappableFrame(f) : f,
    )

    return { frames, metadata: null }
  }

  /**
   * 计算需要跳过多少字节才能到达下一帧。
   * R8 格式没有帧长度字段，需要解析所有可变长度字段。
   */
  private static advancePastFrame(
    buffer: Uint8Array,
    dv: DataView,
    offset: number,
  ): number {
    let pos = offset

    // Scan forward past zero bytes (same as R8Frame constructor)
    let type = buffer[pos]!
    pos++
    while (type === 0 && pos < buffer.length) {
      type = buffer[pos]!
      pos++
    }

    // Layout after type byte: width(4)+height(4)+x(4)+y(4)+imageHandle(4)+paletteHandle(4)
    const width = dv.getInt32(pos, true)
    pos += 4  // past width
    const height = dv.getInt32(pos, true)
    pos += 4  // past height
    pos += 4  // past x
    pos += 4  // past y
    pos += 4  // past imageHandle
    const paletteHandle = dv.getInt32(pos, true)
    pos += 4  // past paletteHandle

    const bpp = buffer[pos]!
    pos++

    // Skip: frameHeight(1) + frameWidth(1) + alignment(1)
    pos += 3

    // Pixel data
    if (bpp === 16) {
      pos += width * height * 2
    } else {
      pos += width * height
    }

    // Palette data (if type==1 and paletteHandle!=0)
    if (type === 1 && paletteHandle !== 0) {
      // Skip: palHeader(4+4) + palette(256*2)
      pos += 8 + PALETTE_SIZE * 2
    }

    return pos
  }
}

export const R8Loader: ISpriteLoader = new R8LoaderImpl()
