/**
 * Texture.test.ts — Texture 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock。
 * 测试焦点：ITexture 接口实现、数据上传、scaleFilter 管理、
 * 生命周期管理、错误处理、尺寸变化重建和资源释放。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RawTexture } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 使用 vi.hoisted() 在所有 mock/import 之前创建共享变量
// ---------------------------------------------------------------------------

const {
  mockRawTextureDispose,
  mockRawTextureUpdate,
  mockRawTextureUpdateSamplingMode,
  MockRawTexture,
} = vi.hoisted(() => {
  const mDispose = vi.fn()
  const mUpdate = vi.fn()
  const mUpdateSamplingMode = vi.fn()

  const mRT = vi.fn(function (
    this: {
      dispose: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      updateSamplingMode: ReturnType<typeof vi.fn>
      uniqueId: number
      type: number
    },
    _data: unknown,
    _width: number,
    _height: number,
    _format: number,
    _engine: unknown,
    _mipmaps?: boolean,
    _invertY?: boolean,
    _samplingMode?: number,
    _texType?: number,
  ) {
    this.dispose = mDispose
    this.update = mUpdate
    this.updateSamplingMode = mUpdateSamplingMode
    this.uniqueId = 42
    this.type = _texType ?? 0
  })

  return {
    mockRawTextureDispose: mDispose,
    mockRawTextureUpdate: mUpdate,
    mockRawTextureUpdateSamplingMode: mUpdateSamplingMode,
    MockRawTexture: mRT,
  }
})

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  return {
    RawTexture: MockRawTexture,
    Engine: vi.fn(),
    Constants: {
      TEXTUREFORMAT_RGBA: 5,
      TEXTURETYPE_UNSIGNED_BYTE: 0,
      TEXTURETYPE_FLOAT: 1,
      TEXTURE_NEAREST_SAMPLINGMODE: 1,
      TEXTURE_BILINEAR_SAMPLINGMODE: 2,
    },
  }
})

// ---------------------------------------------------------------------------
// 导入被测模块（必须在 vi.mock 之后）
// ---------------------------------------------------------------------------

import { Texture } from './Texture'
import { TextureScaleFilter } from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// 辅助：创建 mock Engine
// ---------------------------------------------------------------------------

function createMockEngine() {
  return {} as import('@babylonjs/core').Engine
}

// ---------------------------------------------------------------------------
// 辅助：创建 RGBA 测试数据
// ---------------------------------------------------------------------------

function createTestData(width: number, height: number, fill: number = 128): Uint8Array {
  const size = width * height * 4
  const data = new Uint8Array(size)
  data.fill(fill)
  return data
}

// ---------------------------------------------------------------------------
// Texture 测试套件
// ---------------------------------------------------------------------------

describe('Texture', () => {
  let engine: import('@babylonjs/core').Engine

  beforeEach(() => {
    engine = createMockEngine()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // 构造函数
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('创建具有指定宽度、高度和 scaleFilter 的纹理', () => {
      const tex = new Texture(256, 128, TextureScaleFilter.Linear, engine)

      expect(tex.size).toEqual({ width: 256, height: 128 })
      expect(tex.scaleFilter).toBe(TextureScaleFilter.Linear)
      expect(tex.id).toBe(42)
      expect(tex.babylonTexture).toBeDefined()
      expect(MockRawTexture).toHaveBeenCalledTimes(1)
    })

    it('创建 Nearest 过滤纹理', () => {
      const tex = new Texture(64, 64, TextureScaleFilter.Nearest, engine)

      expect(tex.scaleFilter).toBe(TextureScaleFilter.Nearest)
      expect(MockRawTexture).toHaveBeenCalledWith(
        null, 64, 64, 5, engine, false, false, 1, 0,
      )
    })

    it('创建 Linear 过滤纹理', () => {
      const tex = new Texture(64, 64, TextureScaleFilter.Linear, engine)

      expect(tex.scaleFilter).toBe(TextureScaleFilter.Linear)
      expect(MockRawTexture).toHaveBeenCalledWith(
        null, 64, 64, 5, engine, false, false, 2, 0,
      )
    })

    it('拒绝无效宽度（<= 0）', () => {
      expect(() => new Texture(0, 100, TextureScaleFilter.Linear, engine))
        .toThrow('must be positive')
      expect(() => new Texture(-1, 100, TextureScaleFilter.Linear, engine))
        .toThrow('must be positive')
    })

    it('拒绝无效高度（<= 0）', () => {
      expect(() => new Texture(100, 0, TextureScaleFilter.Linear, engine))
        .toThrow('must be positive')
      expect(() => new Texture(100, -5, TextureScaleFilter.Linear, engine))
        .toThrow('must be positive')
    })

    it('支持包装已存在的 babylonTexture', () => {
      const existingRT = new MockRawTexture(
        null, 512, 512, 5, engine, false, false, 2, 0,
      ) as unknown as RawTexture
      // 清除构造函数的调用记录
      MockRawTexture.mockClear()

      const tex = new Texture(
        512, 512, TextureScaleFilter.Linear, engine, existingRT,
      )

      // 不应创建新的 RawTexture
      expect(MockRawTexture).not.toHaveBeenCalled()
      expect(tex.babylonTexture).toBe(existingRT)
      expect(tex.size).toEqual({ width: 512, height: 512 })
    })
  })

  // -----------------------------------------------------------------------
  // scaleFilter 属性
  // -----------------------------------------------------------------------

  describe('scaleFilter', () => {
    it('getter 返回当前 scaleFilter', () => {
      const tex = new Texture(128, 128, TextureScaleFilter.Nearest, engine)
      expect(tex.scaleFilter).toBe(TextureScaleFilter.Nearest)
    })

    it('setter 更新 samplingMode', () => {
      const tex = new Texture(128, 128, TextureScaleFilter.Nearest, engine)
      mockRawTextureUpdateSamplingMode.mockClear()

      tex.scaleFilter = TextureScaleFilter.Linear

      expect(tex.scaleFilter).toBe(TextureScaleFilter.Linear)
      expect(mockRawTextureUpdateSamplingMode).toHaveBeenCalledWith(2) // BILINEAR
    })

    it('值相同时跳过更新（与 OpenRA 行为一致）', () => {
      const tex = new Texture(128, 128, TextureScaleFilter.Nearest, engine)
      mockRawTextureUpdateSamplingMode.mockClear()

      tex.scaleFilter = TextureScaleFilter.Nearest

      expect(mockRawTextureUpdateSamplingMode).not.toHaveBeenCalled()
    })

    it('已销毁时 setter 为 no-op', () => {
      const tex = new Texture(128, 128, TextureScaleFilter.Nearest, engine)
      tex.dispose()
      mockRawTextureUpdateSamplingMode.mockClear()

      tex.scaleFilter = TextureScaleFilter.Linear

      expect(tex.scaleFilter).toBe(TextureScaleFilter.Nearest) // 未更改
      expect(mockRawTextureUpdateSamplingMode).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // babylonTexture getter
  // -----------------------------------------------------------------------

  describe('babylonTexture', () => {
    it('返回底层 RawTexture 实例', () => {
      const tex = new Texture(64, 64, TextureScaleFilter.Linear, engine)
      expect(tex.babylonTexture).toBeDefined()
      expect(typeof tex.babylonTexture.dispose).toBe('function')
    })

    it('是 Shader.ts getBabylonTexture 所需的负载关键属性', () => {
      // Shader.ts 通过鸭子类型访问此属性:
      //   const maybeTex = tex as unknown as { babylonTexture?: BaseTexture }
      //   if (maybeTex.babylonTexture) { ... }
      const tex = new Texture(64, 64, TextureScaleFilter.Linear, engine)
      const duck = tex as unknown as { babylonTexture?: unknown }
      expect(duck.babylonTexture).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // id getter
  // -----------------------------------------------------------------------

  describe('id', () => {
    it('返回底层纹理的 uniqueId（对应 OpenRA ITextureInternal.ID）', () => {
      const tex = new Texture(32, 32, TextureScaleFilter.Linear, engine)
      expect(tex.id).toBe(42)
    })
  })

  // -----------------------------------------------------------------------
  // setData
  // -----------------------------------------------------------------------

  describe('setData', () => {
    it('上传 RGBA 颜色数据到纹理', () => {
      const tex = new Texture(2, 2, TextureScaleFilter.Linear, engine)
      const data = createTestData(2, 2, 255)

      tex.setData(data, 2, 2)

      expect(mockRawTextureUpdate).toHaveBeenCalledWith(data)
    })

    it('数据尺寸不匹配时抛出异常', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      const data = createTestData(2, 2) // 16 bytes, 需要 64

      expect(() => tex.setData(data, 4, 4))
        .toThrow('Data size mismatch')
    })

    it('尺寸变化时重建纹理', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      MockRawTexture.mockClear()
      const data = createTestData(8, 8, 128)

      tex.setData(data, 8, 8)

      // 重建纹理（创建新 RawTexture）
      expect(MockRawTexture).toHaveBeenCalledTimes(1)
      // 旧纹理被销毁
      expect(mockRawTextureDispose).toHaveBeenCalledTimes(1)
      // 新纹理被更新
      expect(mockRawTextureUpdate).toHaveBeenCalledWith(data)
      // 尺寸已更新
      expect(tex.size).toEqual({ width: 8, height: 8 })
    })

    it('拒绝无效尺寸', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      expect(() => tex.setData(new Uint8Array(4), 0, 4))
        .toThrow('must be positive')
    })

    it('已销毁时抛出异常', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      tex.dispose()
      expect(() => tex.setData(createTestData(4, 4), 4, 4))
        .toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // setFloatData
  // -----------------------------------------------------------------------

  describe('setFloatData', () => {
    it('上传浮点数据到纹理', () => {
      const tex = new Texture(2, 2, TextureScaleFilter.Linear, engine)
      const data = new Float32Array(16) // 2*2*4

      tex.setFloatData(data, 2, 2)

      expect(mockRawTextureUpdate).toHaveBeenCalledWith(data)
    })

    it('数据尺寸不匹配时抛出异常', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      const data = new Float32Array(4) // too small

      expect(() => tex.setFloatData(data, 4, 4))
        .toThrow('Float data size mismatch')
    })

    it('尺寸变化或类型不匹配时重建纹理', () => {
      const tex = new Texture(2, 2, TextureScaleFilter.Linear, engine)
      MockRawTexture.mockClear()
      const data = new Float32Array(4 * 4 * 4) // 4x4

      tex.setFloatData(data, 4, 4)

      // 重建纹理
      expect(MockRawTexture).toHaveBeenCalledTimes(1)
      expect(mockRawTextureDispose).toHaveBeenCalledTimes(1)
      expect(tex.size).toEqual({ width: 4, height: 4 })
    })

    it('已销毁时抛出异常', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      tex.dispose()
      expect(() => tex.setFloatData(new Float32Array(64), 4, 4))
        .toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // setDataFromReadBuffer
  // -----------------------------------------------------------------------

  describe('setDataFromReadBuffer', () => {
    it('发出警告（当前未实现）', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)

      tex.setDataFromReadBuffer({ x: 0, y: 0, width: 4, height: 4 })

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not implemented'),
      )
      warnSpy.mockRestore()
    })

    it('已销毁时抛出异常', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      tex.dispose()
      expect(() =>
        tex.setDataFromReadBuffer({ x: 0, y: 0, width: 2, height: 2 }),
      ).toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // getData
  // -----------------------------------------------------------------------

  describe('getData', () => {
    it('返回空 Uint8Array（当前未实现）', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)

      const result = tex.getData()

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not implemented'),
      )
      warnSpy.mockRestore()
    })

    it('已销毁时抛出异常', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      tex.dispose()
      expect(() => tex.getData()).toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // setEmpty
  // -----------------------------------------------------------------------

  describe('setEmpty', () => {
    it('分配空纹理存储', () => {
      const tex = new Texture(2, 2, TextureScaleFilter.Linear, engine)
      MockRawTexture.mockClear()

      tex.setEmpty(8, 8)

      // 创建新的空 RawTexture
      expect(MockRawTexture).toHaveBeenCalledTimes(1)
      expect(MockRawTexture).toHaveBeenCalledWith(
        null, 8, 8, 5, engine, false, false, 2, 0,
      )
      // 旧纹理被销毁
      expect(mockRawTextureDispose).toHaveBeenCalledTimes(1)
      expect(tex.size).toEqual({ width: 8, height: 8 })
    })

    it('拒绝无效尺寸', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      expect(() => tex.setEmpty(0, 10)).toThrow('must be positive')
    })

    it('已销毁时抛出异常', () => {
      const tex = new Texture(4, 4, TextureScaleFilter.Linear, engine)
      tex.dispose()
      expect(() => tex.setEmpty(8, 8)).toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('释放底层 RawTexture', () => {
      const tex = new Texture(64, 64, TextureScaleFilter.Linear, engine)

      tex.dispose()

      expect(mockRawTextureDispose).toHaveBeenCalledTimes(1)
    })

    it('幂等 — 重复调用不会报错', () => {
      const tex = new Texture(64, 64, TextureScaleFilter.Linear, engine)

      tex.dispose()
      tex.dispose()
      tex.dispose()

      // 仅释放一次
      expect(mockRawTextureDispose).toHaveBeenCalledTimes(1)
    })

    it('释放后所有操作抛出异常', () => {
      const tex = new Texture(64, 64, TextureScaleFilter.Linear, engine)
      tex.dispose()

      expect(() => tex.setData(createTestData(4, 4), 4, 4))
        .toThrow('has been disposed')
      expect(() => tex.setFloatData(new Float32Array(64), 4, 4))
        .toThrow('has been disposed')
      expect(() => tex.setEmpty(8, 8)).toThrow('has been disposed')
      expect(() => tex.getData()).toThrow('has been disposed')
    })

    it('释放包装的纹理时也释放底层（场景: FrameBuffer 提供 babylonTexture）', () => {
      const sharedRT = new MockRawTexture(
        null, 512, 512, 5, engine,
      ) as unknown as RawTexture
      mockRawTextureDispose.mockClear()

      const tex = new Texture(
        512, 512, TextureScaleFilter.Linear, engine, sharedRT,
      )

      tex.dispose()

      expect(mockRawTextureDispose).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // 生命周期集成测试
  // -----------------------------------------------------------------------

  describe('生命周期', () => {
    it('创建 → 上传数据 → 查询 → 释放', () => {
      const tex = new Texture(128, 128, TextureScaleFilter.Linear, engine)
      expect(tex.size).toEqual({ width: 128, height: 128 })
      expect(tex.scaleFilter).toBe(TextureScaleFilter.Linear)

      const data = createTestData(128, 128, 200)
      tex.setData(data, 128, 128)
      expect(mockRawTextureUpdate).toHaveBeenCalledWith(data)

      tex.scaleFilter = TextureScaleFilter.Nearest
      expect(tex.scaleFilter).toBe(TextureScaleFilter.Nearest)

      tex.dispose()
      expect(mockRawTextureDispose).toHaveBeenCalled()
    })

    it('尺寸变化 → 重建纹理 → 保持 scaleFilter', () => {
      const tex = new Texture(64, 64, TextureScaleFilter.Nearest, engine)

      // 上传更大尺寸的数据
      MockRawTexture.mockClear()
      const data = createTestData(128, 128)
      tex.setData(data, 128, 128)

      // 应有新纹理创建并保持 Nearest 采样模式
      const lastCall = MockRawTexture.mock.calls[
        MockRawTexture.mock.calls.length - 1
      ]
      expect(lastCall[1]).toBe(128) // width
      expect(lastCall[2]).toBe(128) // height
      expect(lastCall[6]).toBe(1)   // samplingMode: NEAREST
    })
  })
})
