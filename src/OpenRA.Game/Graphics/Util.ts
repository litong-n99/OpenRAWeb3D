/**
 * Util.ts — OpenRA 图形工具函数到 TypeScript 的迁移
 * OpenRA 对照: OpenRA.Game/Graphics/Util.cs
 *
 * 核心范式转换:
 * - MemoryMarshal.Cast<byte, uint> 批量复制 → Uint32Array 批量复制
 * - unsafe fixed 指针操作 → TypedArray 直接索引
 * - Vertex 值类型 → Vertex 接口 + 内联属性赋值
 * - PremultiplyAlpha(Color) → PremultiplyAlpha(r,g,b,a) (简化返回 RGBA)
 * - CreateQuadIndices 返回跨度 4 的四边形索引
 */

// ---------------------------------------------------------------------------
// 导出类型（供 SheetBuilder.ts 使用）
// ---------------------------------------------------------------------------

export type { Size, Rect, Vec2, Vec3 } from './SpriteRenderer'

// ---------------------------------------------------------------------------
// SpriteFrameType 枚举（与 OpenRA 完全一致）
//
// OpenRA 对照: SpriteLoader.cs SpriteFrameType enum (SpriteLoader.cs:23-50)
// ---------------------------------------------------------------------------

export const SpriteFrameType = {
  /** 8 位索引（引用外部调色板） */
  Indexed8: 0,
  /** 32 位 BGRA 颜色 */
  Bgra32: 1,
  /** 24 位 BGR 颜色（无 Alpha） */
  Bgr24: 2,
  /** 32 位 RGBA 颜色（大端序，如 PNG） */
  Rgba32: 3,
  /** 24 位 RGB 颜色（大端序，无 Alpha） */
  Rgb24: 4,
} as const
export type SpriteFrameType =
  (typeof SpriteFrameType)[keyof typeof SpriteFrameType]

// ---------------------------------------------------------------------------
// 常量（与 OpenRA 完全一致）
// ---------------------------------------------------------------------------

/**
 * BGRA 通道顺序掩码: 0→B, 1→G, 2→R, 3→A。
 *
 * 对应 OpenRA Util.ChannelMasks = [2, 1, 0, 3]
 * （"yes, our channel order is nuts." — OpenRA Util.cs 注释）
 */
const CHANNEL_MASKS = [2, 1, 0, 3] as const

/**
 * 四边形索引顶点映射: 0-1-2-2-3-0（顺时针排列）。
 *
 * 对应 OpenRA Util.CreateQuadIndices 的 cornerVertexMap。
 */
const CORNER_VERTEX_MAP = [0, 1, 2, 2, 3, 0] as const

// ---------------------------------------------------------------------------
// CreateQuadIndices — 创建四边形索引数组
//
// 对应 OpenRA Util.CreateQuadIndices (Util.cs:24-32)
// ---------------------------------------------------------------------------

/**
 * 创建四边形索引数组。
 *
 * 每个四边形 = 6 个索引（两个三角形），顶点排列为 0-1-2-2-3-0（顺时针）。
 * 第 i 个四边形的基顶点 = 4 * i。
 *
 * 对应 OpenRA:
 *   var indices = new uint[quads * 6];
 *   ReadOnlySpan<uint> cornerVertexMap = [0, 1, 2, 2, 3, 0];
 *   for (var i = 0; i < indices.Length; i++)
 *     indices[i] = cornerVertexMap[i % 6] + (uint)(4 * (i / 6));
 *
 * @param quads — 四边形数量
 * @returns Uint32Array（长度 = quads * 6）
 */
export function createQuadIndices(quads: number): Uint32Array {
  const indices = new Uint32Array(quads * 6)
  for (let i = 0; i < indices.length; i++) {
    indices[i] = CORNER_VERTEX_MAP[i % 6] + 4 * Math.floor(i / 6)
  }
  return indices
}

// ---------------------------------------------------------------------------
// PremultiplyAlpha — 预乘 Alpha
//
// 对应 OpenRA Util.PremultiplyAlpha (Util.cs:320-326)
// ---------------------------------------------------------------------------

/**
 * 对 RGBA 颜色执行预乘 Alpha。
 *
 * 对应 OpenRA:
 *   if (c.A == byte.MaxValue) return c;
 *   var a = c.A / 255f;
 *   return Color.FromArgb(c.A, (byte)(c.R * a + 0.5f), ...);
 *
 * 若 Alpha = 255，直接返回原值（无操作，常见热路径优化）。
 *
 * @param r — 红色分量 (0-255)
 * @param g — 绿色分量 (0-255)
 * @param b — 蓝色分量 (0-255)
 * @param a — Alpha 分量 (0-255)
 * @returns [r', g', b', a] — 预乘后的 RGBA
 */
export function premultiplyAlpha(
  r: number, g: number, b: number, a: number,
): [number, number, number, number] {
  if (a === 255) return [r, g, b, a]
  const f = a / 255
  return [
    Math.round(r * f),
    Math.round(g * f),
    Math.round(b * f),
    a,
  ]
}

// ---------------------------------------------------------------------------
// 内部辅助类型（用于 FastCreateQuad）
// ---------------------------------------------------------------------------

import type { ISprite } from './SpriteRenderer'

interface Vec3 {
  x: number
  y: number
  z: number
}

interface Int2 {
  x: number
  y: number
}

interface Vertex {
  x: number; y: number; z: number
  s: number; t: number; u: number; v: number
  c: number
  r: number; g: number; b: number; a: number
}

// ---------------------------------------------------------------------------
// FastCreateQuad — 创建精灵四边形顶点
//
// 对应 OpenRA Util.FastCreateQuad (Util.cs:34-105)
//
// 有两个重载：
//   1. FastCreateQuad(vertices, o, r, samplers, palette, nv, size, tint, alpha, rotation)
//   2. FastCreateQuad(vertices, a, b, c, d, r, samplers, palette, tint, alpha, nv)
//
// 将两个重载拆分为两个独立函数。
// ---------------------------------------------------------------------------

/**
 * FastCreateQuad — 旋转版。
 *
 * 计算精灵四边形顶点并写入 vertices 数组的指定位置。
 * 支持 ZRamp（地形高度渐变）和旋转。
 *
 * 对应 OpenRA:
 *   FastCreateQuad(Vertex[] vertices, in float3 o, Sprite r, int2 samplers,
 *                  int paletteTextureIndex, int nv, in float3 size,
 *                  in float3 tint, float alpha, float rotation = 0f)
 *
 * @param vertices — 顶点数组（原地修改）
 * @param origin — 精灵原点世界坐标
 * @param sprite — 精灵引用
 * @param samplers — [主采样器索引, 次采样器索引]
 * @param paletteTextureIndex — 调色板纹理行索引
 * @param nv — 写入起始索引
 * @param size — 精灵大小（含缩放）
 * @param tint — RGB 色调
 * @param alpha — 透明度
 * @param rotation — 旋转角（弧度，默认 0）
 */
export function fastCreateQuad(
  vertices: Vertex[],
  origin: Vec3,
  sprite: ISprite,
  samplers: Int2,
  paletteTextureIndex: number,
  nv: number,
  size: Vec3,
  tint: Vec3,
  alpha: number,
  rotation = 0,
): void {
  let a: Vec3, b: Vec3, c: Vec3, d: Vec3

  if (rotation !== 0) {
    // 旋转四边形（对应 RotateQuad 逻辑）
    const centerX = origin.x + 0.5 * size.x
    const centerY = origin.y + 0.5 * size.y
    const angleSin = Math.sin(-rotation)
    const angleCos = Math.cos(-rotation)

    const raX = 0.5 * (size.x * angleCos - size.y * angleSin)
    const raY = 0.5 * (size.x * angleSin + size.y * angleCos)
    const raZ = 0.5 * (size.x * angleSin + size.y * angleCos) * size.z / size.y

    const rbX = 0.5 * (size.x * angleCos + size.y * angleSin)
    const rbY = 0.5 * (size.x * angleSin - size.y * angleCos)
    const rbZ = 0.5 * (size.x * angleSin - size.y * angleCos) * size.z / size.y

    a = { x: centerX - raX, y: centerY - raY, z: origin.z - raZ }
    b = { x: centerX + rbX, y: centerY + rbY, z: origin.z + rbZ }
    c = { x: centerX + raX, y: centerY + raY, z: origin.z + raZ }
    d = { x: centerX - rbX, y: centerY - rbY, z: origin.z - rbZ }
  } else {
    // 无旋转：简单矩形
    a = { x: origin.x, y: origin.y, z: origin.z }
    b = { x: origin.x + size.x, y: origin.y, z: origin.z }
    c = { x: origin.x + size.x, y: origin.y + size.y, z: origin.z + size.z }
    d = { x: origin.x, y: origin.y + size.y, z: origin.z + size.z }
  }

  fastCreateQuadCorners(vertices, a, b, c, d, sprite, samplers, paletteTextureIndex, tint, alpha, nv)
}

/**
 * FastCreateQuad — 四角点版。
 *
 * 将 4 个角点写入顶点数组。
 *
 * 实现 OpenRA FastCreateQuad 的核心逻辑：
 * - 构建 aVertexAttributes 位字段
 * - 写入 4 个顶点（TL, TR, BR, BL）
 *
 * 对应 OpenRA:
 *   FastCreateQuad(Vertex[] vertices, in float3 a, in float3 b,
 *                  in float3 c, in float3 d, Sprite r, int2 samplers,
 *                  int paletteTextureIndex, in float3 tint,
 *                  float alpha, int nv)
 */
export function fastCreateQuadCorners(
  vertices: Vertex[],
  a: Vec3, b: Vec3, c: Vec3, d: Vec3,
  sprite: ISprite,
  samplers: Int2,
  paletteTextureIndex: number,
  tint: Vec3,
  alpha: number,
  nv: number,
): void {
  // 辅助 UV
  let sl = 0
  let st = 0
  let sr = 0
  let sb = 0

  // 构建 aVertexAttributes 位字段
  // 对应 OpenRA:
  //   var attribC = r.Channel == TextureChannel.RGBA ? 0x02 : ((byte)r.Channel) << 1 | 0x01;
  //   attribC |= samplers.X << 6;
  const channel = sprite.channel as number
  let attribC = channel === 4 /* RGBA */ ? 0x02 : ((channel << 1) | 0x01)
  attribC |= samplers.x << 6

  // 次纹理（SpriteWithSecondaryData）
  // NOTE: 当前 ISprite 接口不包含 SecondarySheet 等字段。
  // 若需要次纹理支持，请扩展 ISprite 接口或使用 instanceof 检查。
  // 对应 OpenRA:
  //   if (r is SpriteWithSecondaryData ss) { ... }

  // 调色板行索引（bits 16-31）
  attribC |= (paletteTextureIndex & 0xffff) << 16

  // 写入 4 个顶点（TL, TR, BR, BL）
  // 对应 OpenRA:
  //   vertices[nv]     = new Vertex(a, r.Left, r.Top, sl, st, uAttribC, tint, alpha);
  //   vertices[nv + 1] = new Vertex(b, r.Right, r.Top, sr, st, uAttribC, tint, alpha);
  //   vertices[nv + 2] = new Vertex(c, r.Right, r.Bottom, sr, sb, uAttribC, tint, alpha);
  //   vertices[nv + 3] = new Vertex(d, r.Left, r.Bottom, sl, sb, uAttribC, tint, alpha);
  vertices[nv] = {
    x: a.x, y: a.y, z: a.z,
    s: sprite.left, t: sprite.top,
    u: sl, v: st,
    c: attribC >>> 0,  // 确保无符号 32 位
    r: tint.x, g: tint.y, b: tint.z, a: alpha,
  }
  vertices[nv + 1] = {
    x: b.x, y: b.y, z: b.z,
    s: sprite.right, t: sprite.top,
    u: sr, v: st,
    c: attribC >>> 0,
    r: tint.x, g: tint.y, b: tint.z, a: alpha,
  }
  vertices[nv + 2] = {
    x: c.x, y: c.y, z: c.z,
    s: sprite.right, t: sprite.bottom,
    u: sr, v: sb,
    c: attribC >>> 0,
    r: tint.x, g: tint.y, b: tint.z, a: alpha,
  }
  vertices[nv + 3] = {
    x: d.x, y: d.y, z: d.z,
    s: sprite.left, t: sprite.bottom,
    u: sl, v: sb,
    c: attribC >>> 0,
    r: tint.x, g: tint.y, b: tint.z, a: alpha,
  }
}

// ---------------------------------------------------------------------------
// FastCopyIntoChannel — 将精灵像素数据复制到图集的指定通道
//
// 对应 OpenRA Util.FastCopyIntoChannel (Util.cs:107-139)
//
// 对于 RGBA 通道: 完整复制颜色数据（支持 BGRA→内部 BGRA 格式转换）。
// 对于单通道 (R/G/B/A): 仅复制源数据到目标的指定通道偏移。
// ---------------------------------------------------------------------------

/**
 * 将源像素数据复制到目标图集缓冲区的指定精灵区域。
 *
 * RGBA 精灵: 复制全部 4 通道（执行格式转换和预乘 Alpha）。
 * Indexed 精灵: 仅复制 1 字节到目标通道（通过 CHANNEL_MASKS 映射）。
 *
 * 对应 OpenRA FastCopyIntoChannel (Util.cs:107-139)。
 *
 * @param destData — 目标图集缓冲区（BGRA 格式，4 字节/像素）
 * @param stride — 目标图集宽度（像素）
 * @param x — 目标区域左上角 X
 * @param y — 目标区域左上角 Y
 * @param width — 精灵宽度（像素）
 * @param height — 精灵高度（像素）
 * @param src — 源像素数据
 * @param srcType — 源数据格式
 * @param destChannel — 目标通道（仅 Indexed 精灵使用）
 * @param premultiplied — 源数据是否已预乘 Alpha
 */
export function fastCopyIntoChannel(
  destData: Uint8Array,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number,
  src: Uint8Array,
  srcType: SpriteFrameType,
  destChannel: number,
  premultiplied = false,
): void {
  if (destChannel === 4 /* RGBA */) {
    copyIntoRgba(destData, stride, x, y, width, height, src, srcType, premultiplied)
  } else {
    // 单通道复制（Indexed 精灵）
    // 对应 OpenRA:
    //   var destStride = stride * 4;
    //   var destOffset = destStride * y + x * 4 + ChannelMasks[(int)dest.Channel];
    //   var destSkip = destStride - 4 * width;
    const destStride = stride * 4
    const channelOffset = CHANNEL_MASKS[destChannel]
    let destOffset = destStride * y + x * 4 + channelOffset
    const destSkip = destStride - 4 * width

    let srcOffset = 0
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++, srcOffset++) {
        destData[destOffset] = src[srcOffset]
        destOffset += 4
      }
      destOffset += destSkip
    }
  }
}

/**
 * 将 RGBA/BGRA 源数据复制到目标的完整颜色区域。
 *
 * 对应 OpenRA Util.CopyIntoRgba (Util.cs:141-210)。
 *
 * 快速路径: 若源类型为 Bgra32（最常见格式），使用 Uint32Array 批量复制。
 * 慢速路径: 逐像素转换（BGR24, Rgba32, Rgb24）。
 *
 * NOTE: 目标缓冲区存储 BGRA 格式（与 OpenRA 一致）。
 *       在 RGB↔BGR 转换时已处理字节序。
 */
function copyIntoRgba(
  dest: Uint8Array,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number,
  src: Uint8Array,
  srcType: SpriteFrameType,
  premultiplied: boolean,
): void {
  // 快速路径: Bgra32 → 目标（格式完全匹配，使用 Uint32Array 批量复制）
  // 对应 OpenRA: if (srcType == SpriteFrameType.Bgra32) { ... fast path ... }
  if (srcType === SpriteFrameType.Bgra32) {
    const dest32 = new Uint32Array(dest.buffer, dest.byteOffset, dest.byteLength / 4)
    const src32 = new Uint32Array(src.buffer, src.byteOffset, src.byteLength / 4)
    let si = 0
    let di = y * stride + x

    for (let h = 0; h < height; h++) {
      // 批量复制整行（对应 Span.CopyTo）
      for (let w = 0; w < width; w++) {
        dest32[di] = src32[si]
        si++
        di++
      }
      di += stride - width
    }

    // 若未预乘，对复制后的数据执行预乘 Alpha
    if (!premultiplied) {
      di = y * stride + x
      for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
          const pixel = dest32[di]
          const a = (pixel >>> 24) & 0xff
          if (a !== 255) {
            const b = (pixel) & 0xff
            const g = (pixel >>> 8) & 0xff
            const r = (pixel >>> 16) & 0xff
            const f = a / 255
            dest32[di] =
              (a << 24) |
              ((Math.round(r * f) & 0xff) << 16) |
              ((Math.round(g * f) & 0xff) << 8) |
              (Math.round(b * f) & 0xff)
          }
          di++
        }
        di += stride - width
      }
    }

    return
  }

  // 慢速路径: 逐像素转换（对应 OpenRA switch 分支）
  let si = 0
  let di = y * stride + x
  const dest32 = new Uint32Array(dest.buffer, dest.byteOffset, dest.byteLength / 4)

  for (let h = 0; h < height; h++) {
    for (let w = 0; w < width; w++) {
      let r: number, g: number, b: number, a: number

      switch (srcType) {
        case SpriteFrameType.Bgr24:
          b = src[si++]
          g = src[si++]
          r = src[si++]
          a = 255
          break

        case SpriteFrameType.Rgba32:
          r = src[si++]
          g = src[si++]
          b = src[si++]
          a = src[si++]
          break

        case SpriteFrameType.Rgb24:
          r = src[si++]
          g = src[si++]
          b = src[si++]
          a = 255
          break

        default:
          throw new Error(`Unknown SpriteFrameType ${srcType}`)
      }

      // 预乘 Alpha（若需要）
      if (!premultiplied && a !== 255) {
        const f = a / 255
        r = Math.round(r * f)
        g = Math.round(g * f)
        b = Math.round(b * f)
      }

      // 存储为 BGRA 格式（目标缓冲区格式）
      // 对应 OpenRA d[di++] = c.ToArgb()（Color.ToArgb 返回 BGRA uint）
      dest32[di++] =
        ((a & 0xff) << 24) |
        ((r & 0xff) << 16) |
        ((g & 0xff) << 8) |
        (b & 0xff)
    }
    di += stride - width
  }
}
