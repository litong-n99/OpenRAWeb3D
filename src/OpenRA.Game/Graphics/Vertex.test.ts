/**
 * Vertex.test.ts — Vertex 结构和 CombinedShaderBindings 迁移单元测试
 *
 * 测试顶点创建、属性位编码打包/解包、
 * 顶点数组到多属性数组转换、CombinedShaderBindings 属性布局。
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  VERTEX_SIZE,
  POSITION_OFFSET,
  TEXCOORD_OFFSET,
  ATTRIBUTES_OFFSET,
  TINT_OFFSET,
  TextureChannel,
  CombinedShaderBindings,
  createVertex,
  packVertexAttributes,
  unpackChannelType,
  unpackDepthType,
  unpackSamplerIndex,
  unpackDepthSamplerIndex,
  unpackPaletteRow,
  verticesToArrays,
} from './Vertex'

import { ShaderVertexAttributeType } from './PlatformInterfaces'

import {
  registerShaderSource,
  clearShaderSources,
} from './ShaderBindings'

// ---------------------------------------------------------------------------
// Setup — 注册测试着色器源码
// ---------------------------------------------------------------------------

const VERT_SRC = '#version 300 es\nprecision highp float;\nuniform mat4 worldViewProjection;\nin vec3 aVertexPosition;\nin vec4 aVertexTexCoord;\nin uint aVertexAttributes;\nin vec4 aVertexTint;\nout vec4 vTexCoord;\nvoid main() { gl_Position = worldViewProjection * vec4(aVertexPosition, 1.0); }'
const FRAG_SRC = '#version 300 es\nprecision mediump float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }'

beforeEach(() => {
  clearShaderSources()
  registerShaderSource('combined.vert', VERT_SRC)
  registerShaderSource('combined.frag', FRAG_SRC)
})

// ---------------------------------------------------------------------------
// 常量验证
// ---------------------------------------------------------------------------

describe('Vertex constants', () => {
  it('VERTEX_SIZE is 48 bytes', () => {
    expect(VERTEX_SIZE).toBe(48)
  })

  it('offsets match OpenRA Vertex layout', () => {
    expect(POSITION_OFFSET).toBe(0)   // X, Y, Z = 3 * 4 = 12 bytes
    expect(TEXCOORD_OFFSET).toBe(12)  // S, T, U, V = 4 * 4 = 16 bytes
    expect(ATTRIBUTES_OFFSET).toBe(28) // C = 1 * 4 = 4 bytes
    expect(TINT_OFFSET).toBe(32)      // R, G, B, A = 4 * 4 = 16 bytes
  })

  it('sum of fields equals VERTEX_SIZE', () => {
    // 3 + 4 + 1 + 4 = 12 components * 4 bytes = 48
    expect(12 + 16 + 4 + 16).toBe(VERTEX_SIZE)
  })
})

// ---------------------------------------------------------------------------
// TextureChannel
// ---------------------------------------------------------------------------

describe('TextureChannel', () => {
  it('has correct values matching combined.vert SelectChannelMask', () => {
    expect(TextureChannel.Unused).toBe(0)
    expect(TextureChannel.Red).toBe(1)
    expect(TextureChannel.RGBA).toBe(2)
    expect(TextureChannel.Green).toBe(3)
    expect(TextureChannel.Blue).toBe(5)
    expect(TextureChannel.Alpha).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// createVertex
// ---------------------------------------------------------------------------

describe('createVertex', () => {
  it('creates a vertex with all fields set', () => {
    const v = createVertex(1, 2, 3, 0.1, 0.2, 0.3, 0.4, 0x00010002, 1, 1, 1, 0.5)
    expect(v.x).toBe(1)
    expect(v.y).toBe(2)
    expect(v.z).toBe(3)
    expect(v.s).toBe(0.1)
    expect(v.t).toBe(0.2)
    expect(v.u).toBe(0.3)
    expect(v.v).toBe(0.4)
    expect(v.c).toBe(0x00010002)
    expect(v.r).toBe(1)
    expect(v.g).toBe(1)
    expect(v.b).toBe(1)
    expect(v.a).toBe(0.5)
  })

  it('creates vertices with negative and zero values', () => {
    const v = createVertex(-1, 0, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    expect(v.x).toBe(-1)
    expect(v.y).toBe(0)
    expect(v.z).toBe(-2)
    expect(v.a).toBe(0)
  })

  it('vertex is readonly (immutable interface)', () => {
    const v = createVertex(1, 2, 3, 0, 0, 0, 0, 0, 1, 1, 1, 1)
    // Values are stored and accessible
    expect(v.x).toBe(1)
    expect(v.r).toBe(1)
    expect(v.a).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Attribute bitfield pack/unpack
// ---------------------------------------------------------------------------

describe('packVertexAttributes', () => {
  it('packs channel type in bits 0-2', () => {
    // channelType=5 (Blue), others=0
    const c = packVertexAttributes(5, 0, 0, 0, 0)
    expect(unpackChannelType(c)).toBe(5)
    expect(unpackDepthType(c)).toBe(0)
    expect(unpackSamplerIndex(c)).toBe(0)
    expect(unpackPaletteRow(c)).toBe(0)
  })

  it('packs depth type in bits 3-5', () => {
    const c = packVertexAttributes(0, 3, 0, 0, 0) // depth=3 (Green)
    expect(unpackChannelType(c)).toBe(0)
    expect(unpackDepthType(c)).toBe(3)
  })

  it('packs sampler index in bits 6-8', () => {
    const c = packVertexAttributes(0, 0, 5, 0, 0)
    expect(unpackSamplerIndex(c)).toBe(5)
  })

  it('packs depth sampler index in bits 9-11', () => {
    const c = packVertexAttributes(0, 0, 0, 7, 0)
    expect(unpackDepthSamplerIndex(c)).toBe(7)
  })

  it('packs palette row in bits 16-31', () => {
    const c = packVertexAttributes(0, 0, 0, 0, 42)
    expect(unpackPaletteRow(c)).toBe(42)
  })

  it('packs all fields simultaneously', () => {
    const c = packVertexAttributes(
      7,   // Alpha channel
      1,   // Red depth
      3,   // sampler 3
      6,   // depth sampler 6
      100, // palette row 100
    )
    expect(unpackChannelType(c)).toBe(7)
    expect(unpackDepthType(c)).toBe(1)
    expect(unpackSamplerIndex(c)).toBe(3)
    expect(unpackDepthSamplerIndex(c)).toBe(6)
    expect(unpackPaletteRow(c)).toBe(100)
  })

  it('handles maximum palette row (65535)', () => {
    const c = packVertexAttributes(0, 0, 0, 0, 0xffff)
    expect(unpackPaletteRow(c)).toBe(0xffff)
  })

  it('handles sampler index 0', () => {
    const c = packVertexAttributes(1, 0, 0, 0, 0)
    expect(unpackSamplerIndex(c)).toBe(0)
    expect(unpackChannelType(c)).toBe(1)
  })

  it('returns unsigned 32-bit value >>> 0', () => {
    const c = packVertexAttributes(7, 7, 7, 7, 0xffff)
    expect(c).toBeGreaterThanOrEqual(0)
    expect(c).toBeLessThan(2 ** 32)
  })

  it('masks values beyond bit width', () => {
    // channelType > 7 should be masked to 3 bits
    const c = packVertexAttributes(99, 99, 99, 99, 0x1ffff)
    expect(unpackChannelType(c)).toBe(99 & 0x07) // 3
    expect(unpackSamplerIndex(c)).toBe(99 & 0x07) // 3
    expect(unpackPaletteRow(c)).toBe(0x1ffff & 0xffff) // truncated to 16 bits
  })
})

describe('unpack functions', () => {
  it('unpackChannelType extracts bits 0-2', () => {
    expect(unpackChannelType(0b111)).toBe(7)
    expect(unpackChannelType(0)).toBe(0)
    expect(unpackChannelType(0xffff_ffff)).toBe(7) // only 3 bits
  })

  it('unpackDepthType extracts bits 3-5', () => {
    expect(unpackDepthType(0b111_000)).toBe(7)
    expect(unpackDepthType(0)).toBe(0)
  })

  it('unpackSamplerIndex extracts bits 6-8', () => {
    expect(unpackSamplerIndex(0b111_000_000)).toBe(7)
    expect(unpackSamplerIndex(0)).toBe(0)
  })

  it('unpackDepthSamplerIndex extracts bits 9-11', () => {
    expect(unpackDepthSamplerIndex(0b111_000_000_000)).toBe(7)
    expect(unpackDepthSamplerIndex(0)).toBe(0)
  })

  it('unpackPaletteRow extracts bits 16-31', () => {
    expect(unpackPaletteRow(0x0042_0000)).toBe(0x42)
    expect(unpackPaletteRow(0xffff_0000)).toBe(0xffff)
    expect(unpackPaletteRow(0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// verticesToArrays
// ---------------------------------------------------------------------------

describe('verticesToArrays', () => {
  it('converts single vertex to arrays', () => {
    const v = createVertex(1, 2, 3, 0.1, 0.2, 0.3, 0.4, 0x00010042, 1, 0, 0, 0.5)
    const result = verticesToArrays([v])

    expect(result.positions).toBeInstanceOf(Float32Array)
    expect(result.positions).toHaveLength(3)
    expect(result.positions[0]).toBe(1)
    expect(result.positions[1]).toBe(2)
    expect(result.positions[2]).toBe(3)

    expect(result.texCoords).toHaveLength(4)
    expect(result.texCoords[0]).toBeCloseTo(0.1, 5)
    expect(result.texCoords[1]).toBeCloseTo(0.2, 5)
    expect(result.texCoords[2]).toBeCloseTo(0.3, 5)
    expect(result.texCoords[3]).toBeCloseTo(0.4, 5)

    expect(result.attributes).toBeInstanceOf(Uint32Array)
    expect(result.attributes).toHaveLength(1)
    expect(result.attributes[0]).toBe(0x00010042 >>> 0)

    expect(result.tints).toHaveLength(4)
    expect(result.tints[0]).toBe(1)
    expect(result.tints[1]).toBe(0)
    expect(result.tints[2]).toBe(0)
    expect(result.tints[3]).toBeCloseTo(0.5, 5)
  })

  it('converts multiple vertices', () => {
    const vertices = [
      createVertex(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1),
      createVertex(1, 2, 3, 0.5, 0.5, 0, 0, 0x42, 0, 1, 0, 0.5),
      createVertex(-1, -2, 5, 1, 1, 0, 0, 0xffff_ffff, 0.5, 0.5, 0.5, 1),
    ]
    const result = verticesToArrays(vertices)

    expect(result.positions).toHaveLength(9)  // 3 * 3
    expect(result.texCoords).toHaveLength(12)  // 3 * 4
    expect(result.attributes).toHaveLength(3)  // 3 * 1
    expect(result.tints).toHaveLength(12)     // 3 * 4

    // Check last vertex
    expect(result.positions[6]).toBe(-1)
    expect(result.positions[7]).toBe(-2)
    expect(result.positions[8]).toBe(5)
  })

  it('returns empty arrays for empty input', () => {
    const result = verticesToArrays([])
    expect(result.positions).toHaveLength(0)
    expect(result.texCoords).toHaveLength(0)
    expect(result.attributes).toHaveLength(0)
    expect(result.tints).toHaveLength(0)
  })

  it('handles negative coordinates and zero values', () => {
    const v = createVertex(-100, -200, -50, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    const result = verticesToArrays([v])
    expect(result.positions[0]).toBe(-100)
    expect(result.positions[1]).toBe(-200)
    expect(result.positions[2]).toBe(-50)
    expect(result.tints[3]).toBe(0)
  })

  it('uses Uint32Array for attributes (unsigned)', () => {
    const v = createVertex(0, 0, 0, 0, 0, 0, 0, 0x8000_0000, 0, 0, 0, 0)
    const result = verticesToArrays([v])
    // Uint32Array stores as unsigned
    expect(result.attributes[0]).toBe(0x8000_0000)
  })
})

// ---------------------------------------------------------------------------
// CombinedShaderBindings
// ---------------------------------------------------------------------------

describe('CombinedShaderBindings', () => {
  it('creates with combined vertex/fragment names', () => {
    const bindings = new CombinedShaderBindings()
    expect(bindings.vertexShaderName).toBe('combined')
    expect(bindings.fragmentShaderName).toBe('combined')
  })

  it('loads shader code from registry', () => {
    const bindings = new CombinedShaderBindings()
    expect(bindings.vertexShaderCode).toBe(VERT_SRC)
    expect(bindings.fragmentShaderCode).toBe(FRAG_SRC)
  })

  it('stride matches 48-byte Vertex layout', () => {
    const bindings = new CombinedShaderBindings()
    expect(bindings.stride).toBe(48)
  })

  it('has 4 attributes', () => {
    const bindings = new CombinedShaderBindings()
    expect(bindings.attributes).toHaveLength(4)
  })

  it('aVertexPosition: float3 at offset 0', () => {
    const bindings = new CombinedShaderBindings()
    const attr = bindings.attributes[0]
    expect(attr.name).toBe('aVertexPosition')
    expect(attr.type).toBe(ShaderVertexAttributeType.Float)
    expect(attr.components).toBe(3)
    expect(attr.offset).toBe(0)
  })

  it('aVertexTexCoord: float4 at offset 12', () => {
    const bindings = new CombinedShaderBindings()
    const attr = bindings.attributes[1]
    expect(attr.name).toBe('aVertexTexCoord')
    expect(attr.type).toBe(ShaderVertexAttributeType.Float)
    expect(attr.components).toBe(4)
    expect(attr.offset).toBe(12)
  })

  it('aVertexAttributes: uint at offset 28', () => {
    const bindings = new CombinedShaderBindings()
    const attr = bindings.attributes[2]
    expect(attr.name).toBe('aVertexAttributes')
    expect(attr.type).toBe(ShaderVertexAttributeType.UInt)
    expect(attr.components).toBe(1)
    expect(attr.offset).toBe(28)
  })

  it('aVertexTint: float4 at offset 32', () => {
    const bindings = new CombinedShaderBindings()
    const attr = bindings.attributes[3]
    expect(attr.name).toBe('aVertexTint')
    expect(attr.type).toBe(ShaderVertexAttributeType.Float)
    expect(attr.components).toBe(4)
    expect(attr.offset).toBe(32)
  })

  it('attributes are readonly (same reference each access)', () => {
    const bindings = new CombinedShaderBindings()
    expect(bindings.attributes).toBe(bindings.attributes)
  })
})
