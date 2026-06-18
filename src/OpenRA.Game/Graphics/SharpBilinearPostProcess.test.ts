/**
 * SharpBilinearPostProcess.test.ts — Sharp Bilinear 后处理单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock。
 * 测试焦点: 构造参数、sharpness 配置、资源生命周期、dispose 行为。
 * GPU shader 效果需通过视觉验收测试验证。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

const {
  mockSetFloat2,
  mockSetFloat,
  mockPostProcessDispose,
  mockGetEffect,
} = vi.hoisted(() => {
  const mSetFloat2 = vi.fn()
  const mSetFloat = vi.fn()
  const mDispose = vi.fn()
  const mockEffect = {
    setFloat2: mSetFloat2,
    setFloat: mSetFloat,
  }
  const mGetEffect = vi.fn(() => mockEffect)

  return {
    mockSetFloat2: mSetFloat2,
    mockSetFloat: mSetFloat,
    mockPostProcessDispose: mDispose,
    mockGetEffect: mGetEffect,
  }
})

vi.mock('@babylonjs/core', () => {
  // Mock Engine
  const MockEngine = vi.fn(function (this: Record<string, unknown>) {
    // minimal engine
  })

  // Mock PostProcess
  const MockPostProcess = vi.fn(function (
    this: Record<string, unknown>,
    _name: string,
    _fragmentShader: string,
    _uniforms: string[],
    _samplers: unknown,
    _options: number,
    _camera: unknown,
    _samplingMode: number,
    _engine: unknown,
  ) {
    this.dispose = mockPostProcessDispose
    this.getEffect = mockGetEffect
    this.onApply = null
    // Store constructor args for verification
    ;(this as any)._ctorArgs = {
      name: _name,
      shader: _fragmentShader,
      uniforms: _uniforms,
      samplingMode: _samplingMode,
    }
  })

  return {
    PostProcess: MockPostProcess,
    Engine: MockEngine,
  }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { SharpBilinearPostProcess } from './SharpBilinearPostProcess'
import { PostProcess, Engine } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEngine(): Engine {
  return new Engine({} as HTMLCanvasElement)
}

function createMockScene() {
  const engine = createMockEngine()
  return {
    getEngine: () => engine,
  } as unknown as import('@babylonjs/core').Scene
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SharpBilinearPostProcess', () => {
  let engine: Engine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = createMockEngine()
  })

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates a PostProcess with the correct shader', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 1024, height: 768 },
      )

      expect(PostProcess).toHaveBeenCalledTimes(1)
      const ctorArgs = (PostProcess as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as string[]

      // Check shader contains key GLSL patterns
      expect(ctorArgs[1]).toMatch(/#version 300 es/)
      expect(ctorArgs[1]).toMatch(/sharpness/)
      expect(ctorArgs[1]).toMatch(/texelSize/)
      expect(ctorArgs[1]).toMatch(/Unsharp mask/)

      sp.dispose()
    })

    it('registers texelSize and sharpness uniforms', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 512, height: 256 },
      )

      const ctorArgs = (PostProcess as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
      const uniforms = (ctorArgs[2] as string[])
      expect(uniforms).toContain('texelSize')
      expect(uniforms).toContain('sharpness')

      sp.dispose()
    })

    it('uses BILINEAR sampling mode by default', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 800, height: 600 },
      )

      const ctorArgs = (PostProcess as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
      expect(ctorArgs[6]).toBe(2) // TEXTURE_BILINEAR_SAMPLINGMODE

      sp.dispose()
    })

    it('accepts custom sampling mode', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 800, height: 600 },
        1, // TEXTURE_NEAREST_SAMPLINGMODE
      )

      const ctorArgs = (PostProcess as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
      expect(ctorArgs[6]).toBe(1)

      sp.dispose()
    })

    it('sets initial texelSize uniform on construction', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 200, height: 100 },
      )

      expect(mockSetFloat2).toHaveBeenCalledWith('texelSize', 1.0 / 200, 1.0 / 100)

      sp.dispose()
    })

    it('sets initial sharpness uniform (default 0.5)', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )

      expect(mockSetFloat).toHaveBeenCalledWith('sharpness', 0.5)

      sp.dispose()
    })

    it('accepts a Scene instead of Engine (auto-extracts engine)', () => {
      const scene = createMockScene()

      const sp = new SharpBilinearPostProcess(
        'testSharp',
        scene,
        { width: 320, height: 240 },
      )

      // Should not throw
      expect(PostProcess).toHaveBeenCalledTimes(1)
      sp.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // sharpness property
  // -------------------------------------------------------------------------

  describe('sharpness', () => {
    it('getter returns default 0.5', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )

      expect(sp.sharpness).toBe(0.5)
      sp.dispose()
    })

    it('setter updates the uniform', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )

      mockSetFloat.mockClear()
      mockSetFloat2.mockClear()

      sp.sharpness = 0.75

      expect(sp.sharpness).toBe(0.75)
      expect(mockSetFloat).toHaveBeenCalledWith('sharpness', 0.75)
      sp.dispose()
    })

    it('clamps sharpness to [0, 1] range', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )

      sp.sharpness = 2.5
      expect(sp.sharpness).toBe(1.0)

      sp.sharpness = -0.5
      expect(sp.sharpness).toBe(0.0)

      sp.dispose()
    })

    it('setter is no-op when disposed', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )
      sp.dispose()
      mockSetFloat.mockClear()

      sp.sharpness = 0.9

      expect(sp.sharpness).toBe(0.5) // unchanged
      expect(mockSetFloat).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // textureSize property
  // -------------------------------------------------------------------------

  describe('textureSize', () => {
    it('getter returns initial texture size', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 1920, height: 1080 },
      )

      expect(sp.textureSize).toEqual({ width: 1920, height: 1080 })
      sp.dispose()
    })

    it('setter updates texelSize uniform', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 100, height: 100 },
      )

      mockSetFloat2.mockClear()
      sp.textureSize = { width: 200, height: 50 }

      expect(mockSetFloat2).toHaveBeenCalledWith('texelSize', 1.0 / 200, 1.0 / 50)
      expect(sp.textureSize).toEqual({ width: 200, height: 50 })
      sp.dispose()
    })

    it('setter is no-op when disposed', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 100, height: 100 },
      )
      sp.dispose()
      mockSetFloat2.mockClear()

      sp.textureSize = { width: 999, height: 999 }

      expect(sp.textureSize).toEqual({ width: 100, height: 100 }) // unchanged
      expect(mockSetFloat2).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  describe('dispose', () => {
    it('calls postProcess.dispose()', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )

      sp.dispose()

      expect(mockPostProcessDispose).toHaveBeenCalledTimes(1)
    })

    it('is idempotent', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )

      sp.dispose()
      sp.dispose()
      sp.dispose()

      expect(mockPostProcessDispose).toHaveBeenCalledTimes(1)
    })

    it('disposed instance rejects sharpness setter', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )
      sp.dispose()

      sp.sharpness = 0.8
      expect(sp.sharpness).toBe(0.5) // unchanged
    })

    it('disposed instance rejects textureSize setter', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )
      sp.dispose()

      sp.textureSize = { width: 512, height: 512 }
      expect(sp.textureSize).toEqual({ width: 64, height: 64 }) // unchanged
    })
  })

  // -------------------------------------------------------------------------
  // postProcess property
  // -------------------------------------------------------------------------

  describe('postProcess', () => {
    it('exposes the underlying PostProcess instance', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )

      expect(sp.postProcess).toBeDefined()
      expect(typeof sp.postProcess.dispose).toBe('function')
      expect(typeof sp.postProcess.getEffect).toBe('function')
      sp.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // onApply callback
  // -------------------------------------------------------------------------

  describe('onApply', () => {
    it('sets onApply callback on PostProcess', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 64, height: 64 },
      )

      expect(sp.postProcess.onApply).toBeDefined()
      expect(typeof sp.postProcess.onApply).toBe('function')
      sp.dispose()
    })

    it('onApply updates both uniforms', () => {
      const sp = new SharpBilinearPostProcess(
        'testSharp',
        engine,
        { width: 100, height: 200 },
      )

      // Clear calls from constructor
      mockSetFloat2.mockClear()
      mockSetFloat.mockClear()

      // Simulate onApply being called (by the engine each frame)
      const onApply = sp.postProcess.onApply as (effect: unknown) => void
      onApply({})

      expect(mockSetFloat2).toHaveBeenCalledWith('texelSize', 1.0 / 100, 1.0 / 200)
      expect(mockSetFloat).toHaveBeenCalledWith('sharpness', 0.5)
      sp.dispose()
    })
  })
})
