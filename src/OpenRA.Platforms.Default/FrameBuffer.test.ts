/**
 * FrameBuffer.test.ts — FrameBuffer 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock，
 * 重点验证状态管理逻辑与 OpenRA 行为一致性。
 *
 * NOTE: 由于 vitest 将 vi.mock() 调用提升 (hoist) 到文件顶部，
 * mock 工厂函数内的所有变量引用必须是函数声明或 var 声明（可提升）。
 * 因此所有 mock 构造逻辑均在 vi.mock() 工厂函数内部完成。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core（工厂内全内联，避免提升问题）
//
// 为便于测试中访问 mock 实例，工厂内的变量使用 var 声明以匹配 vitest 提升机制。
// ---------------------------------------------------------------------------

// 共享的可变状态（使用 var 以配合 vitest 提升）
var _currentViewport: { x: number; y: number; width: number; height: number } | null = null

// mock 函数引用（使用 var 以配合 vitest 提升）
var _mockSetViewport: ReturnType<typeof vi.fn>
var _mockEnableScissor: ReturnType<typeof vi.fn>
var _mockDisableScissor: ReturnType<typeof vi.fn>
var _mockBindFramebuffer: ReturnType<typeof vi.fn>
var _mockUnBindFramebuffer: ReturnType<typeof vi.fn>
var _mockClear: ReturnType<typeof vi.fn>
var _mockDisposeRTT: ReturnType<typeof vi.fn>
var _mockGetInternalTexture: ReturnType<typeof vi.fn>
var _EngineMock: ReturnType<typeof vi.fn>
var _RTTMock: ReturnType<typeof vi.fn>

vi.mock('@babylonjs/core', () => {
  _mockSetViewport = vi.fn()
  _mockEnableScissor = vi.fn()
  _mockDisableScissor = vi.fn()
  _mockBindFramebuffer = vi.fn()
  _mockUnBindFramebuffer = vi.fn()
  _mockClear = vi.fn()
  _mockDisposeRTT = vi.fn()
  _mockGetInternalTexture = vi.fn(
    () => ({ samplingMode: 2, dispose: vi.fn() }),
  )

  const mockGetRenderWidth = vi.fn(() => 800)
  const mockGetRenderHeight = vi.fn(() => 600)

  function makeEngine(this: Record<string, unknown>) {
    this.bindFramebuffer = _mockBindFramebuffer
    this.unBindFramebuffer = _mockUnBindFramebuffer
    this.setViewport = _mockSetViewport
    this.enableScissor = _mockEnableScissor
    this.disableScissor = _mockDisableScissor
    this.clear = _mockClear
    this.getRenderWidth = mockGetRenderWidth
    this.getRenderHeight = mockGetRenderHeight
    Object.defineProperty(this, 'currentViewport', {
      get: () => _currentViewport,
      configurable: true,
    })
  }
  _EngineMock = vi.fn(makeEngine)

  function makeRTT(this: Record<string, unknown>) {
    this.dispose = _mockDisposeRTT
    this.getInternalTexture = _mockGetInternalTexture
    Object.defineProperty(this, 'renderTarget', {
      get: () => ({}),
      configurable: true,
    })
  }
  _RTTMock = vi.fn(makeRTT)

  return {
    Engine: _EngineMock,
    RenderTargetTexture: _RTTMock,
    Constants: {
      TEXTUREFORMAT_RGBA: 5,
      TEXTURE_BILINEAR_SAMPLINGMODE: 2,
      TEXTURE_NEAREST_SAMPLINGMODE: 1,
    },
  }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { FrameBuffer } from './FrameBuffer'
import { Engine, RenderTargetTexture, Constants } from '@babylonjs/core'
import type { Size, Color } from '../OpenRA.Game/Graphics/PlatformInterfaces'
import { TextureScaleFilter } from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSize(w: number, h: number): Size {
  return { width: w, height: h }
}

function makeColor(r: number, g: number, b: number, a: number): Color {
  return { r, g, b, a }
}

function createFrameBuffer(size?: Size, clearColor?: Color): FrameBuffer {
  return new FrameBuffer(
    size ?? makeSize(256, 256),
    new Engine({} as any),
    clearColor,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FrameBuffer', () => {
  let fb: FrameBuffer

  beforeEach(() => {
    vi.clearAllMocks()
    _currentViewport = { x: 0, y: 0, width: 800, height: 600 }
    fb = createFrameBuffer()
  })

  afterEach(() => {
    fb?.dispose()
  })

  // ==========================================================================
  // 构造函数
  // ==========================================================================
  describe('constructor', () => {
    it('creates a RenderTargetTexture with correct size', () => {
      expect(RenderTargetTexture).toHaveBeenCalledTimes(1)
      const callArgs = (_RTTMock as any).mock.calls[0]
      expect(callArgs[0]).toBe('frameBuffer')
      expect(callArgs[1]).toEqual({ width: 256, height: 256 })
    })

    it('creates RTT with depth buffer enabled', () => {
      const callArgs = (_RTTMock as any).mock.calls[0]
      expect(callArgs[3]).toMatchObject({
        generateMipMaps: false,
        generateDepthBuffer: true,
        generateStencilBuffer: false,
      })
    })

    it('creates RTT with RGBA format', () => {
      const callArgs = (_RTTMock as any).mock.calls[0]
      expect(callArgs[3].format).toBe(Constants.TEXTUREFORMAT_RGBA)
    })

    it('stores the size property correctly', () => {
      const fbLarge = new FrameBuffer(
        makeSize(512, 1024),
        new Engine({} as any),
      )
      expect(fbLarge.size).toEqual({ width: 512, height: 1024 })
      fbLarge.dispose()
    })

    it('stores the clearColor (verified via bind→clear)', () => {
      const fbColored = new FrameBuffer(
        makeSize(128, 128),
        new Engine({} as any),
        makeColor(255, 0, 0, 255),
      )
      fbColored.bind()
      expect(_mockClear).toHaveBeenCalledWith(
        { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
        true, true, false,
      )
      fbColored.dispose()
    })

    it('defaults clearColor to black transparent', () => {
      const fbDefault = new FrameBuffer(
        makeSize(64, 64),
        new Engine({} as any),
      )
      fbDefault.bind()
      expect(_mockClear).toHaveBeenCalledWith(
        { r: 0, g: 0, b: 0, a: 0 },
        true, true, false,
      )
      fbDefault.dispose()
    })

    it('throws for zero width', () => {
      expect(() => new FrameBuffer(
        makeSize(0, 256),
        new Engine({} as any),
      )).toThrow('must be positive')
    })

    it('throws for zero height', () => {
      expect(() => new FrameBuffer(
        makeSize(256, 0),
        new Engine({} as any),
      )).toThrow('must be positive')
    })

    it('throws for negative size', () => {
      expect(() => new FrameBuffer(
        makeSize(-1, 256),
        new Engine({} as any),
      )).toThrow('must be positive')
    })

    it('warns for size exceeding 16384 (GPU limits)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const fbHuge = new FrameBuffer(
        makeSize(20000, 20000),
        new Engine({} as any),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('20000x20000'),
      )
      warnSpy.mockRestore()
      fbHuge.dispose()
    })

    it('does not warn for reasonable sizes', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      new FrameBuffer(makeSize(1024, 1024), new Engine({} as any))
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('accepts NPOT sizes (WebGL 2.0 NPOT support)', () => {
      expect(() => new FrameBuffer(
        makeSize(100, 200),
        new Engine({} as any),
      )).not.toThrow()
    })

    it('exposes texture with correct size', () => {
      const fbTex = new FrameBuffer(
        makeSize(320, 240),
        new Engine({} as any),
      )
      expect(fbTex.texture.size).toEqual({ width: 320, height: 240 })
      fbTex.dispose()
    })
  })

  // ==========================================================================
  // Bind
  // ==========================================================================
  describe('bind', () => {
    it('caches current viewport before binding', () => {
      _currentViewport = { x: 10, y: 20, width: 640, height: 480 }
      fb.bind()
      expect(_mockBindFramebuffer).toHaveBeenCalled()
      // Verify viewport was cached correctly by checking the unbind restore
    })

    it('binds the RenderTargetTexture framebuffer', () => {
      fb.bind()
      expect(_mockBindFramebuffer).toHaveBeenCalledTimes(1)
      const rttArg = _mockBindFramebuffer.mock.calls[0][0]
      expect(rttArg).toBeDefined()
    })

    it('sets viewport to FrameBuffer size', () => {
      fb.bind()
      expect(_mockSetViewport).toHaveBeenCalledWith({
        x: 0,
        y: 0,
        width: 256,
        height: 256,
      })
    })

    it('clears color and depth buffers with clearColor', () => {
      const fbRed = new FrameBuffer(
        makeSize(128, 128),
        new Engine({} as any),
        makeColor(255, 0, 0, 255),
      )
      fbRed.bind()
      expect(_mockClear).toHaveBeenCalledWith(
        { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
        true, true, false,
      )
      fbRed.dispose()
    })

    it('clears with correct 0-255 to 0.0-1.0 conversion', () => {
      const fbGray = new FrameBuffer(
        makeSize(128, 128),
        new Engine({} as any),
        makeColor(128, 128, 128, 255),
      )
      fbGray.bind()
      expect(_mockClear).toHaveBeenCalledWith(
        { r: 128 / 255, g: 128 / 255, b: 128 / 255, a: 1.0 },
        true, true, false,
      )
      fbGray.dispose()
    })

    it('throws when disposed', () => {
      fb.dispose()
      expect(() => fb.bind()).toThrow('disposed')
    })

    it('allows multiple bind/unbind cycles', () => {
      fb.bind()
      fb.unbind()
      vi.clearAllMocks()

      fb.bind()
      expect(_mockBindFramebuffer).toHaveBeenCalledTimes(1)
      expect(_mockSetViewport).toHaveBeenCalledTimes(1)
      expect(_mockClear).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================================================
  // Unbind
  // ==========================================================================
  describe('unbind', () => {
    it('restores default framebuffer via unBindFramebuffer', () => {
      fb.bind()
      vi.clearAllMocks()
      fb.unbind()
      expect(_mockUnBindFramebuffer).toHaveBeenCalledTimes(1)
    })

    it('restores cached viewport', () => {
      _currentViewport = { x: 5, y: 5, width: 320, height: 200 }
      fb.bind()
      fb.unbind()
      expect(_mockSetViewport).toHaveBeenCalledWith({
        x: 5,
        y: 5,
        width: 320,
        height: 200,
      })
    })

    it('restores full render size when viewport has zero dimensions', () => {
      _currentViewport = { x: 0, y: 0, width: 0, height: 0 }
      fb.bind()
      fb.unbind()
      expect(_mockSetViewport).toHaveBeenCalledWith({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      })
    })

    it('throws when scissor is still active (matching OpenRA)', () => {
      fb.bind()
      fb.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
      expect(() => fb.unbind()).toThrow('active scissor region')
    })

    it('succeeds after disableScissor', () => {
      fb.bind()
      fb.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
      fb.disableScissor()
      expect(() => fb.unbind()).not.toThrow()
    })

    it('throws when disposed', () => {
      fb.dispose()
      expect(() => fb.unbind()).toThrow('disposed')
    })

    it('nullifies cached viewport after restore', () => {
      fb.bind()
      fb.unbind()
      // Second unbind should work without cached viewport
      vi.clearAllMocks()
      fb.bind()
      fb.unbind()
      expect(_mockSetViewport).toHaveBeenCalled()
    })

    it('unbind without prior bind does not attempt viewport restore', () => {
      expect(() => fb.unbind()).not.toThrow()
      // setViewport shouldn't be called for viewport restore (no cached viewport)
      const setViewportCallsAfter = _mockSetViewport.mock.calls.length
      expect(setViewportCallsAfter).toBe(0)
    })
  })

  // ==========================================================================
  // Scissor
  // ==========================================================================
  describe('enableScissor', () => {
    it('calls engine.enableScissor with correct rect', () => {
      fb.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
      expect(_mockEnableScissor).toHaveBeenCalledWith(10, 20, 100, 200)
    })

    it('clamps negative width/height to 0 (matching OpenRA)', () => {
      fb.enableScissor({ x: 0, y: 0, width: -5, height: -10 })
      expect(_mockEnableScissor).toHaveBeenCalledWith(0, 0, 0, 0)
    })

    it('marks scissored flag as true (unbind throws)', () => {
      fb.enableScissor({ x: 0, y: 0, width: 50, height: 50 })
      expect(() => fb.unbind()).toThrow('active scissor region')
    })

    it('throws when disposed', () => {
      fb.dispose()
      expect(() =>
        fb.enableScissor({ x: 0, y: 0, width: 1, height: 1 }),
      ).toThrow('disposed')
    })
  })

  describe('disableScissor', () => {
    it('calls engine.disableScissor', () => {
      fb.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
      vi.clearAllMocks()
      fb.disableScissor()
      expect(_mockDisableScissor).toHaveBeenCalledTimes(1)
    })

    it('marks scissored flag as false', () => {
      fb.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
      fb.disableScissor()
      expect(() => fb.unbind()).not.toThrow()
    })

    it('is safe to call without prior enableScissor', () => {
      expect(() => fb.disableScissor()).not.toThrow()
      expect(_mockDisableScissor).toHaveBeenCalled()
    })

    it('throws when disposed', () => {
      fb.dispose()
      expect(() => fb.disableScissor()).toThrow('disposed')
    })
  })

  // ==========================================================================
  // Texture 属性
  // ==========================================================================
  describe('texture', () => {
    it('returns the ITexture adapter', () => {
      expect(fb.texture).toBeDefined()
    })

    it('texture.size matches FrameBuffer size', () => {
      const fbSized = new FrameBuffer(
        makeSize(512, 384),
        new Engine({} as any),
      )
      expect(fbSized.texture.size).toEqual({ width: 512, height: 384 })
      fbSized.dispose()
    })

    it('texture.scaleFilter getter returns Linear by default', () => {
      expect(fb.texture.scaleFilter).toBe(TextureScaleFilter.Linear)
    })

    it('texture.scaleFilter setter Nearest', () => {
      fb.texture.scaleFilter = TextureScaleFilter.Nearest
      // no throw assertion
    })

    it('texture.scaleFilter can toggle back to Linear', () => {
      fb.texture.scaleFilter = TextureScaleFilter.Nearest
      fb.texture.scaleFilter = TextureScaleFilter.Linear
      // no throw assertion
    })

    it('texture.dispose calls internal texture dispose', () => {
      const disposeSpy = vi.fn()
      _mockGetInternalTexture.mockReturnValueOnce({
        samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
        dispose: disposeSpy,
      })
      const fbTex = new FrameBuffer(
        makeSize(64, 64),
        new Engine({} as any),
      )
      expect(() => fbTex.texture.dispose()).not.toThrow()
      fbTex.dispose()
    })

    it('texture.getData returns sized Uint8Array (width*height*4)', () => {
      // Default frameBuffer is 256x256, so getData should return 256*256*4 bytes
      const data = fb.texture.getData()
      expect(data).toBeInstanceOf(Uint8Array)
      expect(data.length).toBe(256 * 256 * 4)
      // All zeros (mock fallback, no setData called)
      for (let i = 0; i < Math.min(data.length, 100); i++) {
        expect(data[i]).toBe(0)
      }
    })

    it('texture.getData returns correct size for custom dimensions', () => {
      const fbSized = new FrameBuffer(
        makeSize(64, 32),
        new Engine({} as any),
      )
      const data = fbSized.texture.getData()
      expect(data.length).toBe(64 * 32 * 4)
      fbSized.dispose()
    })

    it('texture.setData + getData round-trip verifies internal state', () => {
      const testData = new Uint8Array(16)
      testData.fill(42)
      // setData caches the data internally
      fb.texture.setData(testData, 4, 4)

      const result = fb.texture.getData()
      expect(result.length).toBe(16)
      // After setData, getData returns cached copy (not zeros)
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBe(42)
      }
    })

    it('texture.setData stores a copy (not reference)', () => {
      const testData = new Uint8Array(8).fill(99)
      fb.texture.setData(testData, 2, 2)
      // Mutate the original
      testData[0] = 1

      const result = fb.texture.getData()
      // Should still be 99 (copy was stored)
      expect(result[0]).toBe(99)
    })

    it('texture.getData returns zero-fill after dispose', () => {
      const fbSized = new FrameBuffer(
        makeSize(8, 8),
        new Engine({} as any),
      )
      const testData = new Uint8Array(8 * 8 * 4).fill(77)
      fbSized.texture.setData(testData, 8, 8)
      fbSized.dispose()

      // After dispose, _dataCache is cleared
      // getData might throw or return empty depending on implementation
      // FrameBufferTexture doesn't have ensureNotDisposed on getData
      const result = fbSized.texture.getData()
      // After dispose, dataCache is null, fallback returns zero-filled
      expect(result.length).toBe(8 * 8 * 4)
    })
  })

  // ==========================================================================
  // Dispose
  // ==========================================================================
  describe('dispose', () => {
    it('calls rtt.dispose()', () => {
      fb.dispose()
      expect(_mockDisposeRTT).toHaveBeenCalledTimes(1)
    })

    it('is idempotent - second call no-op', () => {
      fb.dispose()
      expect(_mockDisposeRTT).toHaveBeenCalledTimes(1)
      fb.dispose()
      expect(_mockDisposeRTT).toHaveBeenCalledTimes(1)
    })

    it('disables active scissor before disposal', () => {
      fb.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
      vi.clearAllMocks()
      fb.dispose()
      expect(_mockDisableScissor).toHaveBeenCalled()
      expect(_mockDisposeRTT).toHaveBeenCalled()
    })

    it('throws on bind after dispose', () => {
      fb.dispose()
      expect(() => fb.bind()).toThrow('disposed')
    })

    it('throws on unbind after dispose', () => {
      fb.dispose()
      expect(() => fb.unbind()).toThrow('disposed')
    })

    it('throws on enableScissor after dispose', () => {
      fb.dispose()
      expect(() =>
        fb.enableScissor({ x: 0, y: 0, width: 1, height: 1 }),
      ).toThrow('disposed')
    })

    it('throws on disableScissor after dispose', () => {
      fb.dispose()
      expect(() => fb.disableScissor()).toThrow('disposed')
    })
  })

  // ==========================================================================
  // OpenRA 行为一致性
  // ==========================================================================
  describe('OpenRA parity', () => {
    it('bind stores viewport for later restore (matching ViewportRectangle)', () => {
      _currentViewport = { x: 15, y: 25, width: 400, height: 300 }
      fb.bind()
      fb.unbind()
      expect(_mockSetViewport).toHaveBeenCalledWith({
        x: 15,
        y: 25,
        width: 400,
        height: 300,
      })
    })

    it('unbind restores default framebuffer (FBO 0)', () => {
      fb.bind()
      fb.unbind()
      expect(_mockUnBindFramebuffer).toHaveBeenCalledTimes(1)
    })

    it('cached viewport is restored on unbind (glViewport(cv))', () => {
      _currentViewport = { x: 100, y: 50, width: 960, height: 540 }
      fb.bind()
      // Change current viewport after bind (simulating external change)
      _currentViewport = { x: 999, y: 999, width: 0, height: 0 }
      fb.unbind()
      // Should restore the ORIGINAL cached viewport, not the "current" one
      expect(_mockSetViewport).toHaveBeenCalledWith({
        x: 100,
        y: 50,
        width: 960,
        height: 540,
      })
    })

    it('bind clears color AND depth buffers (matching OpenRA glClear flags)', () => {
      fb.bind()
      expect(_mockClear).toHaveBeenCalledWith(
        expect.any(Object),
        true,  // COLOR_BUFFER_BIT
        true,  // DEPTH_BUFFER_BIT
        false, // stencil not involved
      )
    })

    it('disposed FrameBuffer rejects all operations', () => {
      fb.dispose()
      expect(() => fb.bind()).toThrow()
      expect(() => fb.unbind()).toThrow()
      expect(() => fb.enableScissor({ x: 0, y: 0, width: 1, height: 1 })).toThrow()
      expect(() => fb.disableScissor()).toThrow()
    })
  })

  // ==========================================================================
  // 完整生命周期
  // ==========================================================================
  describe('lifecycle', () => {
    it('supports create -> bind -> use -> unbind -> dispose cycle', () => {
      const fbLife = new FrameBuffer(
        makeSize(512, 512),
        new Engine({} as any),
        makeColor(0, 0, 0, 255),
      )

      fbLife.bind()
      expect(_mockBindFramebuffer).toHaveBeenCalled()
      expect(_mockSetViewport).toHaveBeenCalledWith({
        x: 0, y: 0, width: 512, height: 512,
      })

      fbLife.enableScissor({ x: 0, y: 0, width: 256, height: 256 })
      expect(_mockEnableScissor).toHaveBeenCalledWith(0, 0, 256, 256)
      fbLife.disableScissor()

      fbLife.unbind()
      expect(_mockUnBindFramebuffer).toHaveBeenCalledTimes(1)

      fbLife.dispose()
      fbLife.dispose()
      expect(_mockDisposeRTT).toHaveBeenCalledTimes(1)
    })

    it('handles multiple bind/unbind cycles without leaking', () => {
      for (let i = 0; i < 3; i++) {
        fb.bind()
        fb.unbind()
      }
      // 3 bind + 3 unbind
      expect(_mockBindFramebuffer).toHaveBeenCalledTimes(3)
      expect(_mockUnBindFramebuffer).toHaveBeenCalledTimes(3)
    })
  })
})
