/**
 * Vertex.ts — OpenRA 48 字节顶点结构与 CombinedShaderBindings 的迁移
 * OpenRA 对照: OpenRA.Game/Graphics/Vertex.cs
 *
 * 核心范式转换:
 * - C# readonly struct Vertex (48 bytes, Sequential layout) → TypeScript Vertex 接口
 * - 紧凑位编码 C 字段 → 独立的位打包/解包工具函数
 * - 手动顶点属性绑定 (glVertexAttribPointer) → VertexBuffer 多属性数组
 * - CombinedShaderBindings 继承 ShaderBindings，定义 4 个顶点属性布局
 */

import { ShaderBindings } from './ShaderBindings'
import {
  ShaderVertexAttributeType,
  type ShaderVertexAttribute,
} from './PlatformInterfaces'

// ---------------------------------------------------------------------------
// 常量：顶点结构内存布局（与 OpenRA 完全一致）
// ---------------------------------------------------------------------------

/** 顶点结构总大小（字节） */
export const VERTEX_SIZE = 48

/** X, Y, Z 偏移（字节） */
export const POSITION_OFFSET = 0

/** S, T, U, V 偏移（字节） */
export const TEXCOORD_OFFSET = 12

/** C (属性位字段) 偏移（字节） */
export const ATTRIBUTES_OFFSET = 28

/** R, G, B, A 偏移（字节） */
export const TINT_OFFSET = 32

// ---------------------------------------------------------------------------
// 位编码常量（对应 OpenRA aVertexAttributes 位布局）
// ---------------------------------------------------------------------------

/** 主通道类型掩码（bits 0-2） */
export const CHANNEL_TYPE_MASK = 0x07

/** 次通道类型掩码（bits 3-5） */
export const DEPTH_TYPE_MASK = 0x38 // 0x07 << 3

/** 主采样器索引掩码（bits 6-8） */
export const SAMPLER_INDEX_MASK = 0x1c0 // 0x07 << 6

/** 次采样器索引掩码（bits 9-11） */
export const DEPTH_SAMPLER_MASK = 0xe00 // 0x07 << 9

/** 调色板行掩码（bits 16-31） */
export const PALETTE_ROW_MASK = 0xffff0000

// ---------------------------------------------------------------------------
// TextureChannel 枚举（顶点属性位编码中的通道类型值）
//
// 与 OpenRA combined.vert 中的 SelectChannelMask 位编码一致：
//   0 = 未使用 / 纯色
//   1 = Red 通道（调色板）
//   2 = RGBA 全通道
//   3 = Green 通道（调色板）
//   5 = Blue 通道（调色板）
//   7 = Alpha 通道（调色板）
// ---------------------------------------------------------------------------

export const TextureChannel = {
  Unused: 0,
  Red: 1,
  RGBA: 2,
  Green: 3,
  Blue: 5,
  Alpha: 7,
} as const
export type TextureChannel = (typeof TextureChannel)[keyof typeof TextureChannel]

// ---------------------------------------------------------------------------
// Vertex 接口（对应 OpenRA readonly struct Vertex）
//
// 字段布局（与 OpenRA 完全一致）：
//   X, Y, Z       — 3D 位置（12 bytes, offset 0）
//   S, T, U, V    — 主/次纹理坐标（16 bytes, offset 12）
//   C              — 打包属性位字段（4 bytes, offset 28）
//   R, G, B, A    — 色调/透明度（16 bytes, offset 32）
// ---------------------------------------------------------------------------

export interface Vertex {
  /** 3D 位置 X */
  readonly x: number
  /** 3D 位置 Y */
  readonly y: number
  /** 3D 位置 Z */
  readonly z: number
  /** 主纹理 U 坐标（归一化） */
  readonly s: number
  /** 主纹理 V 坐标（归一化） */
  readonly t: number
  /** 次纹理 U 坐标（归一化，用于深度等） */
  readonly u: number
  /** 次纹理 V 坐标（归一化） */
  readonly v: number
  /**
   * 打包属性位字段：
   * Bits 0-2:   主纹理通道类型
   * Bits 3-5:   次纹理通道类型（深度）
   * Bits 6-8:   主纹理采样器索引 (0-7)
   * Bits 9-11:  次纹理采样器索引 (0-7)
   * Bits 16-31: 调色板纹理行索引
   */
  readonly c: number
  /** 色调 R */
  readonly r: number
  /** 色调 G */
  readonly g: number
  /** 色调 B */
  readonly b: number
  /** 透明度 A */
  readonly a: number
}

// ---------------------------------------------------------------------------
// createVertex — Vertex 工厂函数
//
// 对应 OpenRA Vertex 构造函数的多个重载。
// ---------------------------------------------------------------------------

/** 创建 Vertex（默认白色色调版，简化的构造器）。
 *
 * 对应 OpenRA Vertex(in float3 xyz, float s, float t, float u, float v, uint c)
 *   → 内部调用 Vertex(xyz.X, xyz.Y, xyz.Z, s, t, u, v, c, float3.Ones, 1f)
 * 即默认色调为白色不透明 (r=1, g=1, b=1, a=1)。
 */
export function createVertexSimple(
  x: number, y: number, z: number,
  s: number, t: number, u: number, v: number,
  c: number,
): Vertex {
  return { x, y, z, s, t, u, v, c, r: 1, g: 1, b: 1, a: 1 }
}

/** 创建 Vertex（完整参数版）。
 *
 * 对应 OpenRA Vertex(float x, float y, float z, float s, float t,
 *                    float u, float v, uint c, float r, float g, float b, float a)。
 */
export function createVertex(
  x: number, y: number, z: number,
  s: number, t: number, u: number, v: number,
  c: number,
  r: number, g: number, b: number, a: number,
): Vertex {
  return { x, y, z, s, t, u, v, c, r, g, b, a }
}

// ---------------------------------------------------------------------------
// 位字段打包/解包工具函数
//
// 对应 OpenRA combined.vert 中的位解码逻辑（C# 侧直接写入打包值）。
// 在 WebGL 2.0 中，打包的 uint 通过 glVertexAttribIPointer 传入着色器。
// ---------------------------------------------------------------------------

/**
 * 打包顶点属性位字段。
 *
 * 将通道类型、采样器索引和调色板行编码为单个 32 位无符号整数。
 * 对应 OpenRA 顶点 C 字段的位布局。
 *
 * @param channelType   — 主纹理通道类型 (0, 1, 2, 3, 5, 7)
 * @param depthType     — 次纹理通道类型 (0, 1, 2, 3, 5, 7)
 * @param samplerIndex  — 主纹理采样器索引 (0-7)
 * @param depthSampler  — 次纹理采样器索引 (0-7)
 * @param paletteRow    — 调色板行索引 (0-65535)
 * @returns 打包的 32 位属性值
 */
export function packVertexAttributes(
  channelType: number,
  depthType: number,
  samplerIndex: number,
  depthSampler: number,
  paletteRow: number,
): number {
  return (
    ((channelType & 0x07))
    | ((depthType & 0x07) << 3)
    | ((samplerIndex & 0x07) << 6)
    | ((depthSampler & 0x07) << 9)
    | ((paletteRow & 0xffff) << 16)
  ) >>> 0 // 确保无符号 32 位
}

/**
 * 从打包属性中提取主通道类型。
 * 对应 combined.vert: vChannelType = aVertexAttributes & 0x07u
 */
export function unpackChannelType(c: number): number {
  return (c & CHANNEL_TYPE_MASK) >>> 0
}

/**
 * 从打包属性中提取次通道类型（深度）。
 * 对应 combined.vert: (aVertexAttributes >> 3) & 0x07u
 */
export function unpackDepthType(c: number): number {
  return ((c & DEPTH_TYPE_MASK) >>> 3)
}

/**
 * 从打包属性中提取主采样器索引。
 * 对应 combined.vert: (aVertexAttributes >> 6) & 0x07u
 */
export function unpackSamplerIndex(c: number): number {
  return ((c & SAMPLER_INDEX_MASK) >>> 6)
}

/**
 * 从打包属性中提取次采样器索引。
 * 对应 combined.vert: (aVertexAttributes >> 9) & 0x07u
 */
export function unpackDepthSamplerIndex(c: number): number {
  return ((c & DEPTH_SAMPLER_MASK) >>> 9)
}

/**
 * 从打包属性中提取调色板行索引。
 * 对应 combined.vert: aVertexAttributes >> 16
 */
export function unpackPaletteRow(c: number): number {
  return ((c & PALETTE_ROW_MASK) >>> 16)
}

// ---------------------------------------------------------------------------
// 顶点数据拆分工具 —— 将 Vertex 数组转换为多属性数组
//
// 对应 OpenRA 的 Vertex[] 顶点缓冲，但拆分为 4 个独立数组，
// 分别对应 CombinedShaderBindings 的 4 个顶点属性：
//   aVertexPosition (vec3) + aVertexTexCoord (vec4) +
//   aVertexAttributes (uint) + aVertexTint (vec4)
//
// Babylon.js VertexBuffer 使用独立属性流，无需交织存储。
// ---------------------------------------------------------------------------

/**
 * 将一组 Vertex 转换为 Babylon.js 兼容的多属性数组。
 *
 * @param vertices — 顶点数组
 * @returns 包含 4 个独立属性数组的对象
 */
export function verticesToArrays(vertices: readonly Vertex[]): {
  positions: Float32Array
  texCoords: Float32Array
  attributes: Uint32Array
  tints: Float32Array
} {
  const n = vertices.length
  const positions = new Float32Array(n * 3)
  const texCoords = new Float32Array(n * 4)
  const attrs = new Uint32Array(n)
  const tints = new Float32Array(n * 4)

  for (let i = 0; i < n; i++) {
    const v = vertices[i]
    positions[i * 3] = v.x
    positions[i * 3 + 1] = v.y
    positions[i * 3 + 2] = v.z

    texCoords[i * 4] = v.s
    texCoords[i * 4 + 1] = v.t
    texCoords[i * 4 + 2] = v.u
    texCoords[i * 4 + 3] = v.v

    attrs[i] = v.c >>> 0

    tints[i * 4] = v.r
    tints[i * 4 + 1] = v.g
    tints[i * 4 + 2] = v.b
    tints[i * 4 + 3] = v.a
  }

  return { positions, texCoords, attributes: attrs, tints }
}

// ---------------------------------------------------------------------------
// CombinedShaderBindings — 组合着色器属性绑定
//
// 对应 OpenRA sealed class CombinedShaderBindings : ShaderBindings
//
// 定义 4 个顶点属性的内存布局：
//   aVertexPosition   — vec3 (Float32 × 3), offset 0
//   aVertexTexCoord   — vec4 (Float32 × 4), offset 12
//   aVertexAttributes — uint (Uint32 × 1),   offset 28
//   aVertexTint       — vec4 (Float32 × 4), offset 32
//
// Stride = 12 + 16 + 4 + 16 = 48 bytes
//
// OpenRA 对照: CombinedShaderBindings (Vertex.cs:50-63)
// ---------------------------------------------------------------------------

const COMBINED_ATTRIBUTES: readonly ShaderVertexAttribute[] = [
  {
    name: 'aVertexPosition',
    type: ShaderVertexAttributeType.Float,
    components: 3,
    offset: POSITION_OFFSET,
  },
  {
    name: 'aVertexTexCoord',
    type: ShaderVertexAttributeType.Float,
    components: 4,
    offset: TEXCOORD_OFFSET,
  },
  {
    name: 'aVertexAttributes',
    type: ShaderVertexAttributeType.UInt,
    components: 1,
    offset: ATTRIBUTES_OFFSET,
  },
  {
    name: 'aVertexTint',
    type: ShaderVertexAttributeType.Float,
    components: 4,
    offset: TINT_OFFSET,
  },
]

/**
 * 组合着色器的顶点属性绑定定义。
 *
 * 对应 OpenRA CombinedShaderBindings 类。
 * 构造函数调用 `super('combined')`，加载 `combined.vert` 和 `combined.frag`。
 */
export class CombinedShaderBindings extends ShaderBindings {
  constructor() {
    super('combined')
  }

  get attributes(): readonly ShaderVertexAttribute[] {
    return COMBINED_ATTRIBUTES
  }
}
