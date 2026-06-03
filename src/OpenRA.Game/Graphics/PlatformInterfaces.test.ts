/**
 * PlatformInterfaces.test.ts — 平台接口定义的类型级单元测试
 *
 * 验证所有枚举值和接口定义的正确性（编译期类型检查 + 运行时值验证）。
 * 无需 mock Babylon.js，仅测试纯类型/常量定义。
 */

import { describe, it, expect } from 'vitest'

import {
  GLProfile,
  BlendMode,
  TextureScaleFilter,
  PrimitiveType,
  WindowMode,
  ShaderVertexAttributeType,
} from './PlatformInterfaces'

// ---------------------------------------------------------------------------
// GLProfile
// ---------------------------------------------------------------------------

describe('GLProfile', () => {
  it('has 4 profile types matching OpenRA', () => {
    expect(GLProfile.Automatic).toBe('Automatic')
    expect(GLProfile.ANGLE).toBe('ANGLE')
    expect(GLProfile.Modern).toBe('Modern')
    expect(GLProfile.Embedded).toBe('Embedded')
  })

  it('has 4 entries (same count as OpenRA)', () => {
    expect(Object.keys(GLProfile)).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// BlendMode
// ---------------------------------------------------------------------------

describe('BlendMode', () => {
  it('has 10 blend modes matching OpenRA', () => {
    expect(BlendMode.None).toBe(0)
    expect(BlendMode.Alpha).toBe(1)
    expect(BlendMode.Additive).toBe(2)
    expect(BlendMode.Subtractive).toBe(3)
    expect(BlendMode.Multiply).toBe(4)
    expect(BlendMode.Multiplicative).toBe(5)
    expect(BlendMode.DoubleMultiplicative).toBe(6)
    expect(BlendMode.LowAdditive).toBe(7)
    expect(BlendMode.Screen).toBe(8)
    expect(BlendMode.Translucent).toBe(9)
  })

  it('has 10 entries (same count as OpenRA)', () => {
    expect(Object.keys(BlendMode)).toHaveLength(10)
  })

  it('values are sequential 0-9', () => {
    const values = Object.values(BlendMode) as number[]
    for (let i = 0; i < 10; i++) {
      expect(values[i]).toBe(i)
    }
  })
})

// ---------------------------------------------------------------------------
// TextureScaleFilter
// ---------------------------------------------------------------------------

describe('TextureScaleFilter', () => {
  it('has Nearest and Linear', () => {
    expect(TextureScaleFilter.Nearest).toBe('Nearest')
    expect(TextureScaleFilter.Linear).toBe('Linear')
  })
})

// ---------------------------------------------------------------------------
// PrimitiveType
// ---------------------------------------------------------------------------

describe('PrimitiveType', () => {
  it('has 3 primitive types', () => {
    expect(PrimitiveType.PointList).toBe('PointList')
    expect(PrimitiveType.LineList).toBe('LineList')
    expect(PrimitiveType.TriangleList).toBe('TriangleList')
  })
})

// ---------------------------------------------------------------------------
// WindowMode
// ---------------------------------------------------------------------------

describe('WindowMode', () => {
  it('has 3 window modes', () => {
    expect(WindowMode.Windowed).toBe('Windowed')
    expect(WindowMode.Fullscreen).toBe('Fullscreen')
    expect(WindowMode.PseudoFullscreen).toBe('PseudoFullscreen')
  })
})

// ---------------------------------------------------------------------------
// ShaderVertexAttributeType
// ---------------------------------------------------------------------------

describe('ShaderVertexAttributeType', () => {
  it('values match OpenGL enum values', () => {
    // GL_FLOAT = 0x1406 = 5126
    expect(ShaderVertexAttributeType.Float).toBe(0x1406)
    // GL_INT = 0x1404 = 5124
    expect(ShaderVertexAttributeType.Int).toBe(0x1404)
    // GL_UNSIGNED_INT = 0x1405 = 5125
    expect(ShaderVertexAttributeType.UInt).toBe(0x1405)
  })

  it('has 3 attribute types', () => {
    expect(Object.keys(ShaderVertexAttributeType)).toHaveLength(3)
  })
})
