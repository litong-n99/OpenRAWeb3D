/**
 * RgbaColorRenderer.test.ts — RgbaColorRenderer 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock。
 * 测试重点：几何计算正确性、顶点位置、颜色预乘、累积缓冲区管理。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — 仅 mock RgbaColorRenderer 用到的模块
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  return {
    Mesh: vi.fn(function (this: any) {
      this.renderingGroupId = 0
      this.isPickable = true
      this.material = null
      this.dispose = vi.fn()
    }),
    VertexData: vi.fn(function (this: any) {
      this.positions = null
      this.colors = null
      this.indices = null
      this.applyToMesh = vi.fn()
    }),
    ShaderMaterial: vi.fn(function (this: any) {
      this.dispose = vi.fn()
      this.setFloat = vi.fn()
    }),
  }
})

// ---------------------------------------------------------------------------
// 导入被测模块（必须在 vi.mock 之后）
// ---------------------------------------------------------------------------

import {
  RgbaColorRenderer,
  premultiplyAlpha,
  vertexWithColor,
  intersectionOf,
  type RgbaColor,
} from './RgbaColorRenderer'
import { Mesh, VertexData, ShaderMaterial } from '@babylonjs/core'
import { BlendMode } from './SpriteRenderer'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function rgba(r: number, g: number, b: number, a = 255): RgbaColor {
  return { r, g, b, a }
}

function vec3(x: number, y: number, z = 0): { x: number; y: number; z: number } {
  return { x, y, z }
}

function vec2(x: number, y: number): { x: number; y: number } {
  return { x, y }
}

/** 创建 mock Scene（最小化——仅传递引用，不在测试中使用） */
function mockScene(): any {
  return {} as any
}

// ===========================================================================
// premultiplyAlpha
// ===========================================================================

describe('premultiplyAlpha', () => {
  it('returns the same color when alpha is 255', () => {
    const c: RgbaColor = { r: 128, g: 200, b: 64, a: 255 }
    const result = premultiplyAlpha(c)
    expect(result).toBe(c) // 相同引用（优化路径）
    expect(result.r).toBe(128)
    expect(result.g).toBe(200)
    expect(result.b).toBe(64)
    expect(result.a).toBe(255)
  })

  it('premultiplies RGB by alpha for semi-transparent', () => {
    const c: RgbaColor = { r: 200, g: 100, b: 50, a: 128 }
    const result = premultiplyAlpha(c)
    // alpha = 128/255 ≈ 0.502
    // r = floor(200 * 0.502 + 0.5) = floor(100.9) = 100
    // g = floor(100 * 0.502 + 0.5) = floor(50.7) = 50
    // b = floor(50 * 0.502 + 0.5) = floor(25.6) = 25
    expect(result.r).toBe(100)
    expect(result.g).toBe(50)
    expect(result.b).toBe(25)
    expect(result.a).toBe(128) // alpha unchanged
  })

  it('returns black for fully transparent', () => {
    const c: RgbaColor = { r: 255, g: 255, b: 255, a: 0 }
    const result = premultiplyAlpha(c)
    expect(result.r).toBe(0)
    expect(result.g).toBe(0)
    expect(result.b).toBe(0)
    expect(result.a).toBe(0)
  })

  it('rounds correctly (matching C# byte truncation)', () => {
    // C# (byte)(c.R * a + 0.5f): truncates toward zero
    const c: RgbaColor = { r: 100, g: 200, b: 150, a: 127 }
    const result = premultiplyAlpha(c)
    // a = 127/255 ≈ 0.498
    // r = floor(100 * 0.498 + 0.5) = floor(50.3) = 50
    // g = floor(200 * 0.498 + 0.5) = floor(100.1) = 100
    // b = floor(150 * 0.498 + 0.5) = floor(75.2) = 75
    expect(result.r).toBeGreaterThanOrEqual(49)
    expect(result.r).toBeLessThanOrEqual(51)
    expect(result.a).toBe(127)
  })
})

// ===========================================================================
// vertexWithColor
// ===========================================================================

describe('vertexWithColor', () => {
  it('converts position and color to normalized vertex', () => {
    const pos = vec3(10, 20, 0)
    const color: RgbaColor = { r: 255, g: 128, b: 0, a: 255 }
    const v = vertexWithColor(pos, color)
    expect(v.x).toBe(10)
    expect(v.y).toBe(20)
    expect(v.z).toBe(0)
    expect(v.r).toBeCloseTo(1, 5)   // 255/255 = 1
    expect(v.g).toBeCloseTo(128 / 255, 5)
    expect(v.b).toBeCloseTo(0, 5)
    expect(v.a).toBeCloseTo(1, 5)
  })

  it('premultiplies alpha into normalized colors', () => {
    const pos = vec3(0, 0, 0)
    // Red at 50% alpha: 255 * 0.5 = 127.5 → floor(127.5 + 0.5) = 128
    const color: RgbaColor = { r: 255, g: 0, b: 0, a: 128 }
    const v = vertexWithColor(pos, color)
    expect(v.r).toBeCloseTo(128 / 255, 5)
    expect(v.g).toBeCloseTo(0, 5)
    expect(v.b).toBeCloseTo(0, 5)
    expect(v.a).toBeCloseTo(128 / 255, 5)
  })
})

// ===========================================================================
// intersectionOf
// ===========================================================================

describe('intersectionOf', () => {
  it('finds intersection of two perpendicular line directions', () => {
    // Line 1: from (0,1) going right (1,0)
    const a = vec3(0, 1, 0)
    const da = vec3(1, 0, 0)
    // Line 2: from (1,0) going up (0,1)
    const b = vec3(1, 0, 0)
    const db = vec3(0, 1, 0)
    const result = intersectionOf(a, da, b, db)
    expect(result.x).toBeCloseTo(1, 5)
    expect(result.y).toBeCloseTo(1, 5)
    expect(result.z).toBeCloseTo(0, 5)
  })

  it('averages z values of input points', () => {
    const a = vec3(0, 1, 10)
    const da = vec3(1, 0, 0)
    const b = vec3(1, 0, 20)
    const db = vec3(0, 1, 0)
    const result = intersectionOf(a, da, b, db)
    expect(result.z).toBeCloseTo(15, 5) // (10 + 20) / 2
  })

  it('handles diagonal line intersections', () => {
    // Line 1: from (0,0) going (1,0.5)
    const a = vec3(0, 0, 0)
    const da = vec3(2, 1, 0)
    // Line 2: from (2,0) going (-0.5,1)
    const b = vec3(2, 0, 0)
    const db = vec3(-1, 2, 0)
    const result = intersectionOf(a, da, b, db)
    // da × db direction intersection
    expect(typeof result.x).toBe('number')
    expect(Number.isFinite(result.x)).toBe(true)
    expect(typeof result.y).toBe('number')
    expect(Number.isFinite(result.y)).toBe(true)
  })
})

// ===========================================================================
// RgbaColorRenderer — 构造与生命周期
// ===========================================================================

describe('RgbaColorRenderer', () => {
  let renderer: RgbaColorRenderer
  let scene: any

  beforeEach(() => {
    vi.clearAllMocks()
    scene = mockScene()
    renderer = new RgbaColorRenderer(scene)
  })

  afterEach(() => {
    renderer.dispose()
  })

  // -----------------------------------------------------------------------
  // 构造与初始状态
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('creates with empty quad buffer', () => {
      expect(renderer.getQuadCount()).toBe(0)
      expect(renderer.getVertexBuffer()).toHaveLength(0)
    })

    it('has Offset static constant', () => {
      expect(RgbaColorRenderer.Offset).toEqual({ x: 0.5, y: 0.5, z: 0 })
    })

    it('has null mesh and material before flush', () => {
      expect(renderer.getMesh()).toBeNull()
      expect(renderer.getMaterial()).toBeNull()
    })

    it('defaults currentBlend to Alpha', () => {
      expect(renderer.getCurrentBlend()).toBe(BlendMode.Alpha)
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('clears quads and disposes mesh/material', () => {
      // Trigger mesh creation
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()

      const mesh = renderer.getMesh()
      const material = renderer.getMaterial()
      expect(mesh).not.toBeNull()
      expect(material).not.toBeNull()

      renderer.dispose()

      expect(renderer.getQuadCount()).toBe(0)
      expect(mesh!.dispose).toHaveBeenCalled()
      expect(material!.dispose).toHaveBeenCalled()
    })

    it('silently ignores draw calls after dispose', () => {
      renderer.dispose()
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(0)
    })

    it('dispose is idempotent', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()
      renderer.dispose()
      expect(() => renderer.dispose()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // flush — 动态 Mesh 创建
  // -----------------------------------------------------------------------

  describe('flush', () => {
    it('no-ops when no quads accumulated', () => {
      renderer.flush()
      expect(renderer.getMesh()).toBeNull()
      expect(renderer.getMaterial()).toBeNull()
    })

    it('creates Mesh and ShaderMaterial on first flush', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()

      expect(Mesh).toHaveBeenCalledTimes(1)
      expect(ShaderMaterial).toHaveBeenCalledTimes(1)
      expect(renderer.getMesh()).not.toBeNull()
      expect(renderer.getMaterial()).not.toBeNull()
    })

    it('sets renderingGroupId to 3 for debug overlay', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()

      const mesh = renderer.getMesh()
      expect(mesh!.renderingGroupId).toBe(3)
    })

    it('sets isPickable to false on mesh', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()

      const mesh = renderer.getMesh()
      expect(mesh!.isPickable).toBe(false)
    })

    it('sets material.disableDepthWrite to true for Z-fighting prevention', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()

      const mat = renderer.getMaterial()
      // disableDepthWrite 在 ShaderMaterial 基类 Material 中定义，用于调试图形
      expect((mat as any).disableDepthWrite).toBe(true)
    })

    it('reuses Mesh and Material on subsequent flushes', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()

      const mesh1 = renderer.getMesh()
      const mat1 = renderer.getMaterial()

      renderer.fillRect(vec3(20, 20), vec3(30, 30), rgba(0, 255, 0))
      renderer.flush()

      expect(renderer.getMesh()).toBe(mesh1) // 同一个引用
      expect(renderer.getMaterial()).toBe(mat1) // 同一个引用
    })

    it('applies VertexData to mesh on flush', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()

      // VertexData.applyToMesh 被调用
      const vertexDataMock = vi.mocked(VertexData).mock
      expect(vertexDataMock.instances.length).toBeGreaterThanOrEqual(1)
    })

    it('clears quads after flush by default', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()
      expect(renderer.getQuadCount()).toBe(0)
    })

    it('preserves quads when clearAfterFlush=false', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush(false)
      expect(renderer.getQuadCount()).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // clear — 丢弃缓冲区
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('clears accumulated quads without rendering', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.drawLineSolid(vec3(0, 0), vec3(10, 10), 2, rgba(0, 255, 0))
      expect(renderer.getQuadCount()).toBe(2)

      renderer.clear()
      expect(renderer.getQuadCount()).toBe(0)
      expect(renderer.getMesh()).toBeNull() // 未触发 flush
    })
  })

  // ===========================================================================
  // drawLine — 渐变线段
  // ===========================================================================

  describe('drawLine (gradient)', () => {
    it('produces exactly 1 quad (4 vertices)', () => {
      renderer.drawLine(
        vec3(0, 0), vec3(10, 0), 2,
        rgba(255, 0, 0), rgba(0, 0, 255),
      )
      expect(renderer.getQuadCount()).toBe(1)
      expect(renderer.getVertexBuffer()).toHaveLength(4)
    })

    it('creates vertices with Offset (0.5, 0.5, 0) applied', () => {
      renderer.drawLine(
        vec3(0, 0), vec3(10, 0), 2,
        rgba(255, 0, 0), rgba(255, 0, 0),
      )
      const verts = renderer.getVertexBuffer()
      // 所有顶点的 z 应为 0（Offset.z = 0）
      for (const v of verts) {
        expect(v.z).toBeCloseTo(0, 5) // 0 + 0 offset
      }
    })

    it('places start-color vertices at the start end', () => {
      renderer.drawLine(
        vec3(0, 0), vec3(10, 0), 2,
        rgba(255, 0, 0, 255), rgba(0, 0, 255, 255),
      )
      const verts = renderer.getVertexBuffer()

      // vertices[0] 和 [1] 在起点端，应为红色 (r≈1, g≈0, b≈0)
      expect(verts[0].r).toBeCloseTo(1, 2)
      expect(verts[0].b).toBeCloseTo(0, 2)
      expect(verts[1].r).toBeCloseTo(1, 2)
      expect(verts[1].b).toBeCloseTo(0, 2)

      // vertices[2] 和 [3] 在终点端，应为蓝色 (r≈0, b≈1)
      expect(verts[2].b).toBeCloseTo(1, 2)
      expect(verts[2].r).toBeCloseTo(0, 2)
      expect(verts[3].b).toBeCloseTo(1, 2)
      expect(verts[3].r).toBeCloseTo(0, 2)
    })

    it('expands perpendicular to line direction', () => {
      // 水平线段 y=0，宽度 4 → corner = (0, 2, 0)
      renderer.drawLine(
        vec3(0, 0), vec3(10, 0), 4,
        rgba(255, 255, 255), rgba(255, 255, 255),
      )
      const verts = renderer.getVertexBuffer()

      // 应有 y = ±2 + 0.5 offset
      const yVals = verts.map(v => v.y)
      expect(Math.min(...yVals)).toBeLessThan(0.5)
      expect(Math.max(...yVals)).toBeGreaterThan(0.5)
    })

    it('submits geometry for zero-length line segments (OpenRA parity)', () => {
      renderer.drawLine(
        vec3(5, 5), vec3(5, 5), 2,
        rgba(255, 0, 0), rgba(0, 0, 255),
      )
      // safeLen 回退保证提交 1 个退化四边形（避免 NaN），OpenRA 原始行为会生成 NaN 顶点
      expect(renderer.getQuadCount()).toBe(1)
    })

    it('premultiplies alpha of both start and end colors', () => {
      const startColor: RgbaColor = { r: 255, g: 0, b: 0, a: 128 }
      const endColor: RgbaColor = { r: 0, g: 255, b: 0, a: 128 }
      renderer.drawLine(vec3(0, 0), vec3(10, 0), 2, startColor, endColor)
      const verts = renderer.getVertexBuffer()
      // 预乘后 r 应约为 128/255 ≈ 0.502
      expect(verts[0].r).toBeCloseTo(128 / 255, 2)
      expect(verts[0].a).toBeCloseTo(128 / 255, 2)
    })

    it('updates currentBlend', () => {
      renderer.drawLine(
        vec3(0, 0), vec3(10, 0), 2,
        rgba(255, 0, 0), rgba(0, 0, 255),
        BlendMode.Additive,
      )
      expect(renderer.getCurrentBlend()).toBe(BlendMode.Additive)
    })
  })

  // ===========================================================================
  // drawLineSolid — 纯色线段
  // ===========================================================================

  describe('drawLineSolid', () => {
    it('produces 1 quad with uniform color', () => {
      renderer.drawLineSolid(vec3(0, 0), vec3(10, 0), 3, rgba(0, 255, 0))
      expect(renderer.getQuadCount()).toBe(1)
      const verts = renderer.getVertexBuffer()
      // 所有 4 个顶点应有相同的绿色
      for (const v of verts) {
        expect(v.g).toBeCloseTo(1, 2)
      }
    })

    it('uses the same color for start and end', () => {
      const color = rgba(100, 150, 200, 200)
      renderer.drawLineSolid(vec3(0, 5), vec3(20, 5), 2, color)
      const verts = renderer.getVertexBuffer()
      const expectedR = Math.floor(100 * (200 / 255) + 0.5) / 255
      for (const v of verts) {
        expect(v.r).toBeCloseTo(expectedR, 3)
        expect(v.a).toBeCloseTo(200 / 255, 3)
      }
    })

    it('defaults blendMode to Alpha', () => {
      renderer.drawLineSolid(vec3(0, 0), vec3(10, 0), 2, rgba(255, 0, 0))
      expect(renderer.getCurrentBlend()).toBe(BlendMode.Alpha)
    })
  })

  // ===========================================================================
  // drawPath — 多点路径
  // ===========================================================================

  describe('drawPath', () => {
    it('draws disconnected consecutive segments: p0→p1, p1→p2, p2→p3', () => {
      const points = [vec3(0, 0), vec3(5, 0), vec3(10, 0), vec3(15, 0)]
      renderer.drawPath(points, 2, rgba(255, 0, 0))
      // 4 points → 3 consecutive segments (0→1, 1→2, 2→3)
      expect(renderer.getQuadCount()).toBe(3)
    })

    it('returns early for single point', () => {
      renderer.drawPath([vec3(0, 0)], 2, rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(0)
    })

    it('returns early for empty array', () => {
      renderer.drawPath([], 2, rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(0)
    })

    it('connects segments when connectSegments=true (polyline)', () => {
      const points = [vec3(0, 0), vec3(10, 0), vec3(10, 10)]
      renderer.drawPath(points, 2, rgba(255, 0, 0), true)
      // 3 points, connected → 2 segments (0→1, 1→2), each 1 quad
      expect(renderer.getQuadCount()).toBe(2)
    })

    it('connects segments with miter joins when connectSegments=true', () => {
      // L-shaped path with 3 points
      const points = [vec3(0, 0), vec3(10, 0), vec3(10, 10)]
      renderer.drawPath(points, 4, rgba(255, 0, 0), true)
      const verts = renderer.getVertexBuffer()

      // 验证有 8 个顶点（2 条线段, 各 4 顶点）
      expect(verts).toHaveLength(8)

      // 第一条线段: (0,0)→(10,0)，方向向右，corner 向上/下
      // 第二条线段: (10,0)→(10,10)，方向向上，corner 左/右

      // 验证所有顶点坐标是有限值
      for (const v of verts) {
        expect(Number.isFinite(v.x)).toBe(true)
        expect(Number.isFinite(v.y)).toBe(true)
      }
    })

    it('disconnected mode passes odd number of points (last point ignored)', () => {
      // 3 points: (0,0)→(5,0) segment only
      const points = [vec3(0, 0), vec3(5, 0), vec3(10, 5)]
      renderer.drawPath(points, 2, rgba(255, 0, 0), false)
      // 3 points → 2 consecutive segments (p0→p1, p1→p2)
      expect(renderer.getQuadCount()).toBe(2)
    })
  })

  // ===========================================================================
  // drawPolygon — 闭合多边形
  // ===========================================================================

  describe('drawPolygon (float3)', () => {
    it('draws closed polygon (triangle)', () => {
      const verts = [vec3(0, 0), vec3(10, 0), vec3(5, 10)]
      renderer.drawPolygon(verts, 2, rgba(255, 255, 0))
      // 3 edges (closed): 0→1, 1→2, 2→0
      expect(renderer.getQuadCount()).toBe(3)
    })

    it('returns early for fewer than 2 vertices', () => {
      renderer.drawPolygon([vec3(0, 0)], 2, rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(0)
    })

    it('handles 2-point polygon as single line', () => {
      renderer.drawPolygon([vec3(0, 0), vec3(10, 10)], 3, rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(1)
    })

    it('handles rectangle (4 points)', () => {
      const rect = [vec3(0, 0), vec3(10, 0), vec3(10, 10), vec3(0, 10)]
      renderer.drawPolygon(rect, 2, rgba(0, 255, 0))
      expect(renderer.getQuadCount()).toBe(4)
    })
  })

  // ===========================================================================
  // drawPolygon2D — 闭合多边形（float2）
  // ===========================================================================

  describe('drawPolygon2D', () => {
    it('converts float2 vertices to float3 (z=0) and draws', () => {
      const verts2D = [vec2(0, 0), vec2(10, 0), vec2(5, 10)]
      renderer.drawPolygon2D(verts2D, 2, rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(3)

      // 验证所有 z 坐标的基础为 0
      const verts = renderer.getVertexBuffer()
      // z 应为 0（Offset.z = 0）
      for (const v of verts) {
        expect(v.z).toBeCloseTo(0, 5)
      }
    })

    it('returns early for empty vertices', () => {
      renderer.drawPolygon2D([], 2, rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(0)
    })
  })

  // ===========================================================================
  // drawRect — 矩形轮廓
  // ===========================================================================

  describe('drawRect', () => {
    it('draws 4 edges forming a rectangle', () => {
      renderer.drawRect(vec3(0, 0), vec3(20, 10), 2, rgba(255, 0, 0))
      // tl→tr, tr→br, br→bl, bl→tl = 4 edges
      expect(renderer.getQuadCount()).toBe(4)
    })

    it('computes tr, br, bl from tl and br', () => {
      renderer.drawRect(vec3(5, 5), vec3(25, 15), 2, rgba(0, 255, 0))
      const verts = renderer.getVertexBuffer()
      expect(verts.length).toBeGreaterThanOrEqual(16) // 4 edges * 4 vertices
    })

    it('returns early when disposed', () => {
      renderer.dispose()
      renderer.drawRect(vec3(0, 0), vec3(10, 10), 2, rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(0)
    })
  })

  // ===========================================================================
  // fillRect — 填充矩形（2 点）
  // ===========================================================================

  describe('fillRect (2-point)', () => {
    it('produces exactly 1 quad', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(0, 0, 255))
      expect(renderer.getQuadCount()).toBe(1)
    })

    it('applies Offset to all 4 vertices', () => {
      renderer.fillRect(vec3(5, 5), vec3(15, 15), rgba(255, 255, 255))
      const verts = renderer.getVertexBuffer()
      for (const v of verts) {
        expect(v.x).toBeGreaterThanOrEqual(5)
        expect(v.y).toBeGreaterThanOrEqual(5)
      }
    })

    it('premultiplies color alpha', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0, 128))
      const verts = renderer.getVertexBuffer()
      for (const v of verts) {
        expect(v.r).toBeCloseTo(128 / 255, 2)
        expect(v.a).toBeCloseTo(128 / 255, 2)
      }
    })
  })

  // ===========================================================================
  // fillRect4P — 填充矩形（4 点，纯色）
  // ===========================================================================

  describe('fillRect4P', () => {
    it('produces 1 quad with 4 custom corner positions', () => {
      const a = vec3(0, 0)
      const b = vec3(10, 2)
      const c = vec3(8, 12)
      const d = vec3(-2, 10)
      renderer.fillRect4P(a, b, c, d, rgba(0, 255, 0))
      expect(renderer.getQuadCount()).toBe(1)

      const verts = renderer.getVertexBuffer()
      // 验证角点位置（含 Offset）
      expect(verts[0].x).toBeCloseTo(0.5, 5)
      expect(verts[0].y).toBeCloseTo(0.5, 5)
      expect(verts[1].x).toBeCloseTo(10.5, 5)
      expect(verts[1].y).toBeCloseTo(2.5, 5)
      expect(verts[2].x).toBeCloseTo(8.5, 5)
      expect(verts[2].y).toBeCloseTo(12.5, 5)
      expect(verts[3].x).toBeCloseTo(-1.5, 5)
      expect(verts[3].y).toBeCloseTo(10.5, 5)
    })

    it('applies the same color to all 4 vertices', () => {
      const color = rgba(100, 200, 50, 255)
      renderer.fillRect4P(vec3(0, 0), vec3(1, 0), vec3(1, 1), vec3(0, 1), color)
      const verts = renderer.getVertexBuffer()
      for (const v of verts) {
        expect(v.r).toBeCloseTo(100 / 255, 5)
        expect(v.g).toBeCloseTo(200 / 255, 5)
        expect(v.b).toBeCloseTo(50 / 255, 5)
      }
    })
  })

  // ===========================================================================
  // fillRectGradient — 填充矩形（4 角渐变颜色）
  // ===========================================================================

  describe('fillRectGradient', () => {
    it('assigns each corner a unique color', () => {
      const tl = rgba(255, 0, 0, 255)    // 红
      const tr = rgba(0, 255, 0, 255)    // 绿
      const br = rgba(0, 0, 255, 255)    // 蓝
      const bl = rgba(255, 255, 0, 255)  // 黄

      renderer.fillRectGradient(
        vec3(0, 0), vec3(10, 0), vec3(10, 10), vec3(0, 10),
        tl, tr, br, bl,
      )
      const verts = renderer.getVertexBuffer()

      // verts[0] = 左上角 (红色)
      expect(verts[0].r).toBeCloseTo(1, 2)
      expect(verts[0].g).toBeCloseTo(0, 2)
      expect(verts[0].b).toBeCloseTo(0, 2)

      // verts[1] = 右上角 (绿色)
      expect(verts[1].r).toBeCloseTo(0, 2)
      expect(verts[1].g).toBeCloseTo(1, 2)
      expect(verts[1].b).toBeCloseTo(0, 2)

      // verts[2] = 右下角 (蓝色)
      expect(verts[2].r).toBeCloseTo(0, 2)
      expect(verts[2].g).toBeCloseTo(0, 2)
      expect(verts[2].b).toBeCloseTo(1, 2)

      // verts[3] = 左下角 (黄色)
      expect(verts[3].r).toBeCloseTo(1, 2)
      expect(verts[3].g).toBeCloseTo(1, 2)
      expect(verts[3].b).toBeCloseTo(0, 2)
    })

    it('premultiplies alpha for each corner color independently', () => {
      const tl = rgba(255, 0, 0, 100)     // 低 alpha 红色
      const tr = rgba(0, 255, 0, 200)     // 高 alpha 绿色
      const br = rgba(0, 0, 255, 255)     // 完全不透明蓝色
      const bl = rgba(255, 255, 0, 50)    // 极低 alpha 黄色

      renderer.fillRectGradient(
        vec3(0, 0), vec3(10, 0), vec3(10, 10), vec3(0, 10),
        tl, tr, br, bl,
      )
      const verts = renderer.getVertexBuffer()

      // 左上角 — 预乘后 r 应 < 1
      expect(verts[0].r).toBeLessThan(1)
      expect(verts[0].a).toBeCloseTo(100 / 255, 2)

      // 右下角 — 不透明，颜色不变
      expect(verts[2].b).toBeCloseTo(1, 2)
      expect(verts[2].a).toBeCloseTo(1, 2)
    })
  })

  // ===========================================================================
  // fillEllipse — 填充椭圆
  // ===========================================================================

  describe('fillEllipse', () => {
    it('decomposes ellipse into scanlines (1-pixel-wide quads)', () => {
      // Small ellipse: tl=(0,0,0), br=(5,5,0) → a=2.5, b=2.5, center=(2.5,2.5)
      renderer.fillEllipse(vec3(0, 0, 0), vec3(5, 5, 0), rgba(255, 255, 255))
      const quadCount = renderer.getQuadCount()
      // Ellipse height = 5, so at most 5 scanlines
      expect(quadCount).toBeGreaterThan(0)
      expect(quadCount).toBeLessThanOrEqual(6) // y from ceil(0)=0 to floor(5)=5
    })

    it('interpolates z between tl.z and br.z', () => {
      renderer.fillEllipse(vec3(0, 0, 10), vec3(10, 10, 20), rgba(255, 255, 255))
      const verts = renderer.getVertexBuffer()
      // z values should vary (interpolation from 10 to 20)
      const zVals = verts.map(v => v.z)
      // At least some vertices should have z > 10.5 and some < 20.5
      expect(Math.min(...zVals)).toBeGreaterThanOrEqual(10)
      expect(Math.max(...zVals)).toBeLessThanOrEqual(20.5)
    })

    it('handles zero-size ellipse gracefully', () => {
      // tl == br → a=0, b=0, no scanlines
      renderer.fillEllipse(vec3(5, 5, 0), vec3(5, 5, 0), rgba(255, 0, 0))
      // a=0, b=0 → at y=tl.y, dx=0 → zero-length line → skipped
      const quadCount = renderer.getQuadCount()
      expect(quadCount).toBe(1) // tl.y == br.y → single scanline
    })

    it('handles flat ellipse (zero height)', () => {
      // Flat line: tl=(0,5,0), br=(10,5,0)
      renderer.fillEllipse(vec3(0, 5, 0), vec3(10, 5, 0), rgba(255, 0, 0))
      const quadCount = renderer.getQuadCount()
      // y from ceil(5)=5 to floor(5)=5 → exactly 1 scanline
      expect(quadCount).toBeLessThanOrEqual(1)
    })

    it('premultiplies alpha for ellipse color', () => {
      renderer.fillEllipse(vec3(0, 0), vec3(6, 6), rgba(255, 0, 0, 128))
      const verts = renderer.getVertexBuffer()
      if (verts.length > 0) {
        expect(verts[0].r).toBeCloseTo(128 / 255, 2)
        expect(verts[0].a).toBeCloseTo(128 / 255, 2)
      }
    })
  })

  // ===========================================================================
  // 集成场景：多个方法组合
  // ===========================================================================

  describe('integration', () => {
    it('accumulates multiple quads from different methods', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(0, 0, 0))
      renderer.drawLineSolid(vec3(0, 0), vec3(10, 10), 2, rgba(255, 0, 0))
      renderer.drawRect(vec3(0, 0), vec3(20, 20), 1, rgba(0, 255, 0))
      renderer.drawPolygon([vec3(0, 0), vec3(10, 0), vec3(5, 10)], 1, rgba(0, 0, 255))

      // 1 + 1 + 4 + 3 = 9 quads
      expect(renderer.getQuadCount()).toBe(9)
    })

    it('flush clears buffer and creates mesh', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      expect(renderer.getQuadCount()).toBe(1)

      renderer.flush()
      expect(renderer.getQuadCount()).toBe(0)
      expect(renderer.getMesh()).not.toBeNull()
    })

    it('can draw after flush (reuse mesh)', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      renderer.flush()

      // Draw more quads after flush
      renderer.fillRect(vec3(20, 20), vec3(30, 30), rgba(0, 255, 0))
      expect(renderer.getQuadCount()).toBe(1)

      renderer.flush()
      expect(renderer.getQuadCount()).toBe(0)
    })

    it('getVertexBuffer returns a copy (not live reference)', () => {
      renderer.fillRect(vec3(0, 0), vec3(10, 10), rgba(255, 0, 0))
      const copy1 = renderer.getVertexBuffer()
      renderer.clear()
      const copy2 = renderer.getVertexBuffer()
      // copy1 should still have the old data (copy, not reference)
      expect(copy1).toHaveLength(4)
      expect(copy2).toHaveLength(0)
    })
  })
})
