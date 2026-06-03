/**
 * Sheet.test.ts — Sheet 迁移单元测试
 *
 * 测试重点：缓冲区生命周期管理、GPU 纹理延迟创建、
 * BGRA→RGBA 转换、dirty flag 状态机、ReleaseBufferAndTryTransferTo。
 *
 * 由于 happy-dom 不支持 WebGL，@babylonjs/core 的 RawTexture 被完全 Mock。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — 所有定义必须内联在工厂函数中（vitest hoisting）
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  function createMockRawTexture() {
    let _disposed = false
    let _samplingMode = 1
    const _size = { width: 0, height: 0 }
    return {
      get disposed() { return _disposed },
      set disposed(v: boolean) { _disposed = v },
      get samplingMode() { return _samplingMode },
      set samplingMode(v: number) { _samplingMode = v },
      get width() { return _size.width },
      set width(w: number) { _size.width = w },
      get height() { return _size.height },
      set height(h: number) { _size.height = h },
      dispose: vi.fn(() => { _disposed = true }),
      getSize: vi.fn(() => ({ width: _size.width, height: _size.height })),
      update: vi.fn(),
      updateSamplingMode: vi.fn((mode: number) => {
        _samplingMode = mode
      }),
    }
  }

  const instances: ReturnType<typeof createMockRawTexture>[] = []

  return {
    RawTexture: {
      NEAREST_SAMPLINGMODE: 1,
      BILINEAR_SAMPLINGMODE: 2,
      CreateRGBATexture: vi.fn(
        (_data: Uint8Array, width: number, height: number) => {
          const inst = createMockRawTexture()
          inst.width = width
          inst.height = height
          instances.push(inst)
          return inst
        },
      ),
      // For test introspection
      _instances: instances,
    },
    Scene: class MockScene {},
  }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { Sheet, SheetType } from './Sheet'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('constructs with type and size (no scene)', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 128, height: 128 })
      expect(sheet.type).toBe(SheetType.BGRA)
      expect(sheet.size.width).toBe(128)
      expect(sheet.size.height).toBe(128)
      expect(sheet.currentTexture).toBeNull()
      expect(sheet.buffered).toBe(true)
    })

    it('constructs with type and size (with scene)', () => {
      const sheet = new Sheet(SheetType.Indexed, { width: 256, height: 256 }, {} as any)
      expect(sheet.type).toBe(SheetType.Indexed)
      expect(sheet.buffered).toBe(true)
    })

    it('Type values match OpenRA (Indexed=1, BGRA=4)', () => {
      expect(SheetType.Indexed).toBe(1)
      expect(SheetType.BGRA).toBe(4)
    })
  })

  // -----------------------------------------------------------------------
  // Buffer management
  // -----------------------------------------------------------------------

  describe('buffer management', () => {
    it('createBuffer allocates 4 bytes per pixel', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 10, height: 10 })
      sheet.createBuffer()
      const data = sheet.getData()
      expect(data.length).toBe(400)
      expect(data).toBeInstanceOf(Uint8Array)
    })

    it('createBuffer is idempotent (returns same reference)', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 10, height: 10 })
      sheet.createBuffer()
      const d1 = sheet.getData()
      sheet.createBuffer()
      const d2 = sheet.getData()
      expect(d1).toBe(d2)
    })

    it('getData creates buffer lazily', () => {
      const sheet = new Sheet(SheetType.Indexed, { width: 32, height: 32 })
      const data = sheet.getData()
      expect(data.length).toBe(4096)
      expect(sheet.buffered).toBe(true)
    })

    it('buffered is true when texture is null (new sheet)', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 8, height: 8 })
      expect(sheet.buffered).toBe(true)
    })

    it('Indexed and BGRA buffers are same size (both 4 bytes/pixel)', () => {
      const bg = new Sheet(SheetType.BGRA, { width: 10, height: 10 })
      const idx = new Sheet(SheetType.Indexed, { width: 10, height: 10 })
      expect(bg.getData().length).toBe(idx.getData().length)
    })
  })

  // -----------------------------------------------------------------------
  // Commit / Release
  // -----------------------------------------------------------------------

  describe('commitBufferedData and releaseBuffer', () => {
    it('commitBufferedData on buffered sheet succeeds', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 8, height: 8 })
      sheet.getData()
      expect(() => sheet.commitBufferedData()).not.toThrow()
    })

    it('commitBufferedData on unbuffered sheet throws', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      sheet.getTexture()
      expect(() => sheet.commitBufferedData()).toThrow(
        /unbuffered/,
      )
    })

    it('releaseBuffer on buffered sheet succeeds', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 8, height: 8 })
      sheet.getData()
      expect(() => sheet.releaseBuffer()).not.toThrow()
    })

    it('releaseBuffer on unbuffered sheet is no-op', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      sheet.getTexture()
      expect(() => sheet.releaseBuffer()).not.toThrow()
    })

    it('releaseBuffer creates texture if scene available', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      sheet.getData()
      sheet.releaseBuffer()
      expect(sheet.currentTexture).not.toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Texture creation
  // -----------------------------------------------------------------------

  describe('getTexture', () => {
    it('throws if no scene available', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 })
      expect(() => sheet.getTexture()).toThrow(
        /Cannot create texture without a Scene/,
      )
    })

    it('creates texture when scene is in constructor', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      sheet.getData()
      sheet.commitBufferedData()
      const tex = sheet.getTexture()
      expect(tex).not.toBeNull()
    })

    it('creates texture when scene is passed to getTexture', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 })
      sheet.getData()
      sheet.commitBufferedData()
      const tex = sheet.getTexture({} as any)
      expect(tex).not.toBeNull()
    })

    it('returns same texture on subsequent calls', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      sheet.getData()
      const t1 = sheet.getTexture()
      const t2 = sheet.getTexture()
      expect(t1).toBe(t2)
    })

    it('creates RGBA texture for Indexed type', () => {
      const sheet = new Sheet(SheetType.Indexed, { width: 16, height: 16 }, {} as any)
      sheet.getData()
      const tex = sheet.getTexture()
      expect(tex).not.toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // ReleaseBufferAndTryTransferTo
  // -----------------------------------------------------------------------

  describe('releaseBufferAndTryTransferTo', () => {
    it('throws if destination has different size', () => {
      const s1 = new Sheet(SheetType.BGRA, { width: 4, height: 4 })
      const s2 = new Sheet(SheetType.BGRA, { width: 8, height: 8 })
      expect(() => s1.releaseBufferAndTryTransferTo(s2)).toThrow(
        /does not have the same size/,
      )
    })

    it('transfers buffer to empty destination', () => {
      const s1 = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      const s2 = new Sheet(SheetType.BGRA, { width: 4, height: 4 })

      s1.getData()
      s1.getData()[0] = 99

      const result = s1.releaseBufferAndTryTransferTo(s2)
      expect(result).toBe(true)

      const d2 = s2.getData()
      expect(d2[0]).toBe(0) // zeroed
    })

    it('returns false if destination already has data', () => {
      const s1 = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      const s2 = new Sheet(SheetType.BGRA, { width: 4, height: 4 })

      s1.getData()
      s2.getData()

      const result = s1.releaseBufferAndTryTransferTo(s2)
      expect(result).toBe(false)
    })

    it('returns false if no scene (equivalent to Game.Renderer == null)', () => {
      const s1 = new Sheet(SheetType.BGRA, { width: 4, height: 4 })
      const s2 = new Sheet(SheetType.BGRA, { width: 4, height: 4 })

      s1.getData()
      const result = s1.releaseBufferAndTryTransferTo(s2)
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Pixel art scaling
  // -----------------------------------------------------------------------

  describe('setPixelArtScaling', () => {
    it('updates sampling mode on existing texture', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      sheet.getTexture()
      sheet.setPixelArtScaling(false)

      const tex = sheet.currentTexture as any
      expect(tex.updateSamplingMode).toHaveBeenCalledWith(2)
    })

    it('does not throw when no texture exists', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 })
      expect(() => sheet.setPixelArtScaling(false)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('zero-size sheet creates valid empty buffer', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 0, height: 0 })
      const data = sheet.getData()
      expect(data.length).toBe(0)
    })

    it('writable buffer for Indexed sheets', () => {
      const sheet = new Sheet(SheetType.Indexed, { width: 4, height: 4 })
      const data = sheet.getData()
      data[0] = 42
      data[1] = 128
      expect(data[0]).toBe(42)
    })

    it('writable buffer for BGRA sheets', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 2, height: 2 })
      const data = sheet.getData()
      data[0] = 10
      data[3] = 255
      expect(data[0]).toBe(10)
      expect(data[3]).toBe(255)
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('disposes texture and clears state', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      sheet.getTexture()

      const tex = sheet.currentTexture as any
      sheet.dispose()

      expect(tex.dispose).toHaveBeenCalled()
      expect(sheet.currentTexture).toBeNull()
    })

    it('multiple disposes are safe (idempotent)', () => {
      const sheet = new Sheet(SheetType.BGRA, { width: 4, height: 4 }, {} as any)
      sheet.getTexture()
      sheet.dispose()
      expect(() => sheet.dispose()).not.toThrow()
    })

    it('dispose works on sheet without texture', () => {
      const sheet = new Sheet(SheetType.Indexed, { width: 32, height: 32 })
      expect(() => sheet.dispose()).not.toThrow()
    })
  })
})
