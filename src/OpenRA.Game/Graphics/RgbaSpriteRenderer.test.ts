/**
 * RgbaSpriteRenderer.test.ts — RgbaSpriteRenderer 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock。
 * 测试重点：通道验证、4 个 DrawSprite 重载的委托正确性、错误处理。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — 仅 mock SpriteRenderer (传递依赖) 用到的模块
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  return {
    Engine: {
      ALPHA_DISABLE: 0,
      ALPHA_COMBINE: 2,
      ALPHA_ADD: 3,
      ALPHA_SUBTRACT: 4,
      ALPHA_MULTIPLY: 5,
      ALPHA_SCREENMODE: 6,
    },
    MeshBuilder: {
      CreatePlane: vi.fn().mockReturnValue({
        billboardMode: 0,
        material: null,
        isVisible: false,
        thinInstanceSetBuffer: vi.fn(),
        refreshBoundingInfo: vi.fn(),
        dispose: vi.fn(),
      }),
    },
    Mesh: {
      BILLBOARDMODE_Y: 2,
    },
    StandardMaterial: vi.fn(function (this: any) {
      this.diffuseTexture = null
      this.useAlphaFromDiffuseTexture = false
      this.backFaceCulling = true
      this.disableLighting = false
      this.alphaMode = 2
      this.dispose = vi.fn()
    }),
    RawTexture: vi.fn(),
    Texture: {
      NEAREST_SAMPLINGMODE: 1,
      BILINEAR_SAMPLINGMODE: 2,
    },
    Matrix: {
      Translation: vi.fn().mockReturnValue({
        m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        multiply: function (this: any, _other: any) {
          return {
            m: [...this.m],
            multiply: this.multiply,
          }
        },
      }),
      Scaling: vi.fn().mockReturnValue({
        m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        multiply: function (this: any, _other: any) {
          return {
            m: [...this.m],
            multiply: this.multiply,
          }
        },
      }),
      RotationZ: vi.fn().mockReturnValue({
        m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        multiply: function (this: any, _other: any) {
          return {
            m: [...this.m],
            multiply: this.multiply,
          }
        },
      }),
    },
  }
})

// ---------------------------------------------------------------------------
// 导入被测模块（必须在 vi.mock 之后）
// ---------------------------------------------------------------------------

import { RgbaSpriteRenderer } from './RgbaSpriteRenderer'
import { TextureChannel } from './SpriteRenderer'
import type { ISprite, Vec3, ISheet } from './SpriteRenderer'

// ---------------------------------------------------------------------------
// 辅助工厂函数
// ---------------------------------------------------------------------------

function vec3(x: number, y: number, z = 0): Vec3 {
  return { x, y, z }
}

function makeSprite(channel: TextureChannel, blendMode = 'Alpha' as const): ISprite {
  return {
    sheet: { size: { width: 512, height: 512 }, texture: {} as any } as ISheet,
    bounds: { x: 0, y: 0, width: 32, height: 32 },
    blendMode,
    channel,
    zRamp: 0,
    offset: vec3(0, 0, 0),
    size: vec3(32, 32, 0),
    top: 0,
    left: 0,
    bottom: 1,
    right: 1,
  }
}

function makeRgbaSprite(): ISprite {
  return makeSprite(TextureChannel.RGBA)
}

function makeNonRgbaSprite(channel: TextureChannel = TextureChannel.Red): ISprite {
  return makeSprite(channel)
}

/** 创建 mock SpriteRenderer */
function mockParent() {
  return {
    drawSprite: vi.fn(),
    drawSpriteSimple: vi.fn(),
    drawSpriteWithPalette: vi.fn(),
    drawSpriteCorners: vi.fn(),
    flush: vi.fn(),
    setPalette: vi.fn(),
    dispose: vi.fn(),
  } as any
}

// ===========================================================================
// RgbaSpriteRenderer
// ===========================================================================

describe('RgbaSpriteRenderer', () => {
  let parent: ReturnType<typeof mockParent>
  let renderer: RgbaSpriteRenderer

  beforeEach(() => {
    parent = mockParent()
    renderer = new RgbaSpriteRenderer(parent)
  })

  // -----------------------------------------------------------------------
  // 构造函数
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores the parent SpriteRenderer', () => {
      // 通过间接验证：调用 drawSprite 会委托给 parent
      const sprite = makeRgbaSprite()
      renderer.drawSprite(sprite, vec3(10, 20), 1.0)
      expect(parent.drawSprite).toHaveBeenCalledTimes(1)
    })

    it('accepts a fresh mock parent without error', () => {
      const p = mockParent()
      const r = new RgbaSpriteRenderer(p)
      expect(r).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // ERROR_NOT_RGBA 静态常量
  // -----------------------------------------------------------------------

  describe('ERROR_NOT_RGBA', () => {
    it('matches the OpenRA error message exactly', () => {
      expect(RgbaSpriteRenderer.ERROR_NOT_RGBA).toBe(
        'DrawRGBASprite requires a RGBA sprite.',
      )
    })
  })

  // -----------------------------------------------------------------------
  // validateRGBA（通过 drawSprite 间接测试）
  // -----------------------------------------------------------------------

  describe('RGBA channel validation', () => {
    it('throws when sprite channel is Red', () => {
      const sprite = makeNonRgbaSprite(TextureChannel.Red)
      expect(() => renderer.drawSprite(sprite, vec3(0, 0), 1.0)).toThrow(
        RgbaSpriteRenderer.ERROR_NOT_RGBA,
      )
    })

    it('throws when sprite channel is Green', () => {
      const sprite = makeNonRgbaSprite(TextureChannel.Green)
      expect(() => renderer.drawSprite(sprite, vec3(0, 0), 1.0)).toThrow(
        RgbaSpriteRenderer.ERROR_NOT_RGBA,
      )
    })

    it('throws when sprite channel is Blue', () => {
      const sprite = makeNonRgbaSprite(TextureChannel.Blue)
      expect(() => renderer.drawSprite(sprite, vec3(0, 0), 1.0)).toThrow(
        RgbaSpriteRenderer.ERROR_NOT_RGBA,
      )
    })

    it('throws when sprite channel is Alpha', () => {
      const sprite = makeNonRgbaSprite(TextureChannel.Alpha)
      expect(() => renderer.drawSprite(sprite, vec3(0, 0), 1.0)).toThrow(
        RgbaSpriteRenderer.ERROR_NOT_RGBA,
      )
    })

    it('does NOT throw when sprite channel is RGBA', () => {
      const sprite = makeRgbaSprite()
      expect(() => renderer.drawSprite(sprite, vec3(0, 0), 1.0)).not.toThrow()
    })

    it('throws for all overloads on non-RGBA sprite', () => {
      const sprite = makeNonRgbaSprite(TextureChannel.Red)

      // Overload 1: Vec3 scale
      expect(() => renderer.drawSprite(sprite, vec3(10, 20), vec3(1, 1, 1)))
        .toThrow(RgbaSpriteRenderer.ERROR_NOT_RGBA)

      // Overload 2: number scale
      expect(() => renderer.drawSprite(sprite, vec3(10, 20), 1.0))
        .toThrow(RgbaSpriteRenderer.ERROR_NOT_RGBA)

      // Overload 3: with tint
      expect(() =>
        renderer.drawSprite(sprite, vec3(10, 20), 1.0, vec3(1, 0, 0), 0.5),
      ).toThrow(RgbaSpriteRenderer.ERROR_NOT_RGBA)

      // Overload 4: corners
      expect(() =>
        renderer.drawSprite(
          sprite,
          vec3(0, 0), vec3(1, 0), vec3(1, 1), vec3(0, 1),
          vec3(1, 1, 1), 1.0,
        ),
      ).toThrow(RgbaSpriteRenderer.ERROR_NOT_RGBA)
    })
  })

  // -----------------------------------------------------------------------
  // DrawSprite — 简单重载 (float3 scale, 非均匀缩放)
  // -----------------------------------------------------------------------

  describe('drawSprite(sprite, location, scale: Vec3, rotation?)', () => {
    it('delegates to parent.drawSprite with paletteIndex=0 and Vec3 scale', () => {
      const sprite = makeRgbaSprite()
      const location = vec3(100, 200, 0)
      const scale = vec3(2, 3, 1)

      renderer.drawSprite(sprite, location, scale)

      expect(parent.drawSprite).toHaveBeenCalledTimes(1)
      expect(parent.drawSprite).toHaveBeenCalledWith(sprite, 0, location, scale, 0)
    })

    it('delegates with rotation when provided', () => {
      const sprite = makeRgbaSprite()
      const location = vec3(100, 200)
      const scale = vec3(1, 2, 1)
      const rotation = 0.785 // 45 degrees

      renderer.drawSprite(sprite, location, scale, rotation)

      expect(parent.drawSprite).toHaveBeenCalledWith(sprite, 0, location, scale, rotation)
    })

    it('always passes paletteIndex === 0', () => {
      const sprite = makeRgbaSprite()
      renderer.drawSprite(sprite, vec3(0, 0), vec3(1, 1, 1))
      expect(parent.drawSprite.mock.calls[0][1]).toBe(0)
    })

    it('uses default rotation of 0 when omitted', () => {
      const sprite = makeRgbaSprite()
      renderer.drawSprite(sprite, vec3(0, 0), vec3(1, 1, 1))
      expect(parent.drawSprite.mock.calls[0][4]).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // DrawSprite — 简单重载 (float 均匀缩放)
  // -----------------------------------------------------------------------

  describe('drawSprite(sprite, location, scale: number, rotation?)', () => {
    it('delegates to parent.drawSprite with number scale', () => {
      const sprite = makeRgbaSprite()
      const location = vec3(50, 75)

      renderer.drawSprite(sprite, location, 2.5)

      expect(parent.drawSprite).toHaveBeenCalledTimes(1)
      expect(parent.drawSprite).toHaveBeenCalledWith(sprite, 0, location, 2.5, 0)
    })

    it('uses default scale of 1 (handled by SpriteRenderer)', () => {
      const sprite = makeRgbaSprite()
      renderer.drawSprite(sprite, vec3(0, 0))
      // With default scale not passed, arg3 will be undefined.
      // The implementation still calls parent.drawSprite with undefined scale,
      // which SpriteRenderer treats as default=1.
      expect(parent.drawSprite).toHaveBeenCalled()
    })

    it('passes rotation when provided', () => {
      const sprite = makeRgbaSprite()
      const rotation = 1.57

      renderer.drawSprite(sprite, vec3(10, 10), 2.0, rotation)

      expect(parent.drawSprite).toHaveBeenCalledWith(sprite, 0, vec3(10, 10), 2.0, rotation)
    })

    it('always passes paletteIndex === 0', () => {
      const sprite = makeRgbaSprite()
      renderer.drawSprite(sprite, vec3(0, 0), 1.5, 0.3)
      expect(parent.drawSprite.mock.calls[0][1]).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // DrawSprite — 色调重载 (float scale + tint + alpha)
  // -----------------------------------------------------------------------

  describe('drawSprite(sprite, location, scale, tint, alpha, rotation?)', () => {
    it('delegates to parent.drawSprite with tint and alpha', () => {
      const sprite = makeRgbaSprite()
      const location = vec3(10, 20)
      const tint = vec3(1, 0.5, 0)
      const alpha = 0.8

      renderer.drawSprite(sprite, location, 2.0, tint, alpha)

      expect(parent.drawSprite).toHaveBeenCalledTimes(1)
      // parent.drawSprite(sprite, paletteIndex, location, scale, rotation, tint, alpha)
      expect(parent.drawSprite).toHaveBeenCalledWith(
        sprite, 0, location, 2.0, 0, tint, alpha,
      )
    })

    it('passes rotation when provided', () => {
      const sprite = makeRgbaSprite()
      const tint = vec3(0.5, 0.5, 1)
      const rotation = 0.5

      renderer.drawSprite(sprite, vec3(0, 0), 1.5, tint, 0.9, rotation)

      expect(parent.drawSprite).toHaveBeenCalledWith(
        sprite, 0, vec3(0, 0), 1.5, rotation, tint, 0.9,
      )
    })

    it('uses default rotation of 0 when omitted', () => {
      const sprite = makeRgbaSprite()
      const tint = vec3(1, 1, 1)

      renderer.drawSprite(sprite, vec3(0, 0), 1.0, tint, 1.0)

      // Rotation should default to 0
      expect(parent.drawSprite.mock.calls[0][4]).toBe(0)
    })

    it('always passes paletteIndex === 0', () => {
      const sprite = makeRgbaSprite()
      renderer.drawSprite(sprite, vec3(0, 0), 1.0, vec3(1, 1, 1), 1.0)
      expect(parent.drawSprite.mock.calls[0][1]).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // DrawSprite — 4 角点重载
  // -----------------------------------------------------------------------

  describe('drawSprite(sprite, a, b, c, d, tint, alpha)', () => {
    it('delegates to parent.drawSpriteCorners with paletteIndex=0', () => {
      const sprite = makeRgbaSprite()
      const a = vec3(0, 0)
      const b = vec3(10, 0)
      const c = vec3(10, 10)
      const d = vec3(0, 10)
      const tint = vec3(1, 0, 0)
      const alpha = 0.7

      renderer.drawSprite(sprite, a, b, c, d, tint, alpha)

      expect(parent.drawSpriteCorners).toHaveBeenCalledTimes(1)
      expect(parent.drawSpriteCorners).toHaveBeenCalledWith(
        sprite, 0, a, b, c, d, tint, alpha,
      )
    })

    it('always passes paletteIndex === 0 as second argument', () => {
      const sprite = makeRgbaSprite()
      renderer.drawSprite(
        sprite,
        vec3(1, 1), vec3(2, 1), vec3(2, 2), vec3(1, 2),
        vec3(1, 1, 1), 1.0,
      )
      expect(parent.drawSpriteCorners.mock.calls[0][1]).toBe(0)
    })

    it('handles arbitrary quadrilateral shapes', () => {
      const sprite = makeRgbaSprite()
      const a = vec3(-5, -5)
      const b = vec3(15, -3)
      const c = vec3(12, 14)
      const d = vec3(-4, 13)
      const tint = vec3(0, 1, 0.5)
      const alpha = 0.45

      renderer.drawSprite(sprite, a, b, c, d, tint, alpha)

      expect(parent.drawSpriteCorners).toHaveBeenCalledWith(
        sprite, 0, a, b, c, d, tint, alpha,
      )
    })
  })

  // -----------------------------------------------------------------------
  // 委托完整性（确保方法未被绕过）
  // -----------------------------------------------------------------------

  describe('delegation integrity', () => {
    it('only calls drawSprite (not drawSpriteSimple or drawSpriteWithPalette)', () => {
      const sprite = makeRgbaSprite()

      renderer.drawSprite(sprite, vec3(0, 0), 1.0)

      expect(parent.drawSprite).toHaveBeenCalled()
      expect(parent.drawSpriteSimple).not.toHaveBeenCalled()
      expect(parent.drawSpriteWithPalette).not.toHaveBeenCalled()
    })

    it('does not call flush() on the parent', () => {
      const sprite = makeRgbaSprite()
      renderer.drawSprite(sprite, vec3(0, 0), 1.0)
      expect(parent.flush).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // 无资源泄漏（RgbaSpriteRenderer 不创建 GPU 资源）
  // -----------------------------------------------------------------------

  describe('resource ownership', () => {
    it('does not have a dispose() method (resources owned by parent)', () => {
      // RgbaSpriteRenderer 不应暴露 dispose —— 它不持有 GPU 资源
      expect(typeof (renderer as any).dispose).toBe('undefined')
    })

    it('does not call parent.dispose()', () => {
      // 确保没有意外触发父级 dispose
      expect(parent.dispose).not.toHaveBeenCalled()
      // 销毁 renderer (通过赋值为 null 或其他方式) 不应影响 parent
      renderer = null as any
      expect(parent.dispose).not.toHaveBeenCalled()
    })
  })
})
