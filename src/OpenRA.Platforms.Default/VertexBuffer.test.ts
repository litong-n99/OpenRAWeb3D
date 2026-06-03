/**
 * VertexBuffer.test.ts — VertexBuffer 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock。
 * 测试焦点：IVertexBuffer 接口实现、数据上传、bind() no-op、
 * 生命周期管理、错误处理和资源释放。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// 使用 vi.hoisted() 在所有 mock/import 之前创建共享变量
// ---------------------------------------------------------------------------

const {
  mockBufferDispose,
  mockBufferUpdateDirectly,
  MockBuffer,
} = vi.hoisted(() => {
  const mDispose = vi.fn()
  const mUpdateDirectly = vi.fn()

  const mBuf = vi.fn(function (
    this: {
      dispose: ReturnType<typeof vi.fn>
      updateDirectly: ReturnType<typeof vi.fn>
    },
  ) {
    this.dispose = mDispose
    this.updateDirectly = mUpdateDirectly
  })

  return {
    mockBufferDispose: mDispose,
    mockBufferUpdateDirectly: mUpdateDirectly,
    MockBuffer: mBuf,
  }
})

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  return {
    Buffer: MockBuffer,
    Engine: vi.fn(),
  }
})

// ---------------------------------------------------------------------------
// 导入被测模块（必须在 vi.mock 之后）
// ---------------------------------------------------------------------------

import { VertexBuffer } from './VertexBuffer'
import {
  ShaderVertexAttributeType,
  type ShaderVertexAttribute,
} from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function createMockEngine() {
  return {} as import('@babylonjs/core').Engine
}

function createTestAttributes(): readonly ShaderVertexAttribute[] {
  return [
    {
      name: 'aVertexPosition',
      type: ShaderVertexAttributeType.Float,
      components: 3,
      offset: 0,
    },
    {
      name: 'aVertexTexCoord',
      type: ShaderVertexAttributeType.Float,
      components: 2,
      offset: 12,
    },
  ]
}

function createTestData(numVertices: number, stride: number): Float32Array {
  // 每顶点 stride 字节 = stride/4 个 float
  const floatsPerVertex = stride / 4
  const data = new Float32Array(numVertices * floatsPerVertex)
  for (let i = 0; i < data.length; i++) {
    data[i] = i * 0.1
  }
  return data
}

// ---------------------------------------------------------------------------
// VertexBuffer 测试套件
// ---------------------------------------------------------------------------

describe('VertexBuffer', () => {
  let engine: import('@babylonjs/core').Engine
  const stride = 20 // 5 floats per vertex: 3 (pos) + 2 (uv) = 5 * 4 bytes = 20
  let attrs: readonly ShaderVertexAttribute[]

  beforeEach(() => {
    engine = createMockEngine()
    attrs = createTestAttributes()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // 构造函数
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('创建包含初始数据的 VertexBuffer', () => {
      const data = createTestData(4, stride) // 4 vertices * 5 floats = 20
      const vb = new VertexBuffer(data, stride, attrs, engine, true)

      expect(vb.stride).toBe(stride)
      expect(vb.attributes).toEqual(attrs)
      expect(vb.vertexCount).toBe(4)
      expect(vb.isDynamic).toBe(true)
      expect(MockBuffer).toHaveBeenCalledTimes(1)
      expect(MockBuffer).toHaveBeenCalledWith(
        engine, data, true, stride, false, false, true,
      )
    })

    it('dynamic=false 创建静态缓冲区', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine, false)

      expect(vb.isDynamic).toBe(false)
      expect(MockBuffer).toHaveBeenCalledWith(
        engine, data, false, stride, false, false, true,
      )
    })

    it('dynamic 默认为 true（对应 OpenRA GL_DYNAMIC_DRAW）', () => {
      const data = createTestData(1, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)

      expect(vb.isDynamic).toBe(true)
    })

    it('拒绝无效 stride（<= 0）', () => {
      const data = new Float32Array(10)
      expect(() => new VertexBuffer(data, 0, attrs, engine))
        .toThrow('must be positive')
      expect(() => new VertexBuffer(data, -4, attrs, engine))
        .toThrow('must be positive')
    })

    it('拒绝非 4 字节对齐的 stride（WebGL 要求）', () => {
      const data = new Float32Array(10)
      // stride 必须是 4 的倍数
      expect(() => new VertexBuffer(data, 6, attrs, engine))
        .toThrow('must be a multiple of 4')
      expect(() => new VertexBuffer(data, 18, attrs, engine))
        .toThrow('must be a multiple of 4')
      // 但 4 的倍数应该没问题
      expect(() => new VertexBuffer(data, 16, attrs, engine))
        .not.toThrow()
    })

    it('拒绝空数据', () => {
      expect(() => new VertexBuffer(new Float32Array(0), stride, attrs, engine))
        .toThrow('must not be empty')
    })

    it('数据长度不是顶点跨距整数倍时发出警告', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // 5 floats per vertex, 18 floats = 3 full vertices + 3 trailing floats
      const data = new Float32Array(18)

      const vb = new VertexBuffer(data, stride, attrs, engine)
      expect(vb.vertexCount).toBe(3) // 只计算完整顶点
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not a multiple'),
      )
      warnSpy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // bind() — no-op
  // -----------------------------------------------------------------------

  describe('bind', () => {
    it('是 no-op（不会抛出异常）', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)

      expect(() => vb.bind()).not.toThrow()
    })

    it('已销毁时抛出异常', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)
      vb.dispose()

      expect(() => vb.bind()).toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // setData（全部更新重载）
  // -----------------------------------------------------------------------

  describe('setData (2 参数重载)', () => {
    it('更新缓冲区中的前 N 个 float', () => {
      const data = createTestData(4, stride) // 20 floats
      const vb = new VertexBuffer(data, stride, attrs, engine)
      mockBufferUpdateDirectly.mockClear()

      const newData = new Float32Array(10)
      newData.fill(0.5)
      vb.setData(newData, 10)

      // 验证内部数据副本
      const stored = vb.getData()
      expect(stored[0]).toBe(0.5)
      expect(stored[4]).toBe(0.5)

      // 验证 GPU 上传
      expect(mockBufferUpdateDirectly).toHaveBeenCalled()
    })

    it('源范围超出时抛出异常', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)
      const newData = new Float32Array(5)

      expect(() => vb.setData(newData, 20))
        .toThrow('source range')
    })

    it('length <= 0 时抛出异常', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)

      expect(() => vb.setData(new Float32Array(4), 0))
        .toThrow('length must be > 0')
    })

    it('已销毁时抛出异常', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)
      vb.dispose()

      expect(() => vb.setData(new Float32Array(4), 4))
        .toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // setData（局部更新重载）
  // -----------------------------------------------------------------------

  describe('setData (4 参数重载)', () => {
    it('更新缓冲区的指定范围（对应 OpenRA SetData(offset, start, length)）', () => {
      const data = createTestData(6, stride) // 6 * 5 = 30 floats
      const vb = new VertexBuffer(data, stride, attrs, engine)
      mockBufferUpdateDirectly.mockClear()

      // 用 Float32Array 更新: 从源 offset=0 复制到缓冲区 start=5, length=5
      const newData = new Float32Array(5)
      newData.fill(0.8)
      vb.setData(newData, 0, 5, 5)

      const stored = vb.getData()
      expect(stored[5]).toBeCloseTo(0.8, 5)  // 缓冲区位置 5 已更新
      expect(stored[0]).toBe(0)              // 缓冲区位置 0 未更改（原始数据 0*0.1=0）

      expect(mockBufferUpdateDirectly).toHaveBeenCalled()
    })

    it('支持 number[] 源数据', () => {
      const data = createTestData(4, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)
      mockBufferUpdateDirectly.mockClear()

      const newData = [1, 2, 3, 4, 5]
      vb.setData(newData, 0, 0, 5)

      const stored = vb.getData()
      expect(stored[0]).toBe(1)
      expect(stored[4]).toBe(5)
    })

    it('目标范围超出缓冲区时抛出异常', () => {
      const data = createTestData(2, stride) // 10 floats
      const vb = new VertexBuffer(data, stride, attrs, engine)

      expect(() => vb.setData(new Float32Array(10), 0, 8, 5))
        .toThrow('target range')
    })

    it('负 offset/start 时抛出异常', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)

      expect(() => vb.setData(new Float32Array(4), -1, 0, 4))
        .toThrow('offset must be >= 0')
      expect(() => vb.setData(new Float32Array(4), 0, -1, 4))
        .toThrow('start must be >= 0')
    })
  })

  // -----------------------------------------------------------------------
  // getData
  // -----------------------------------------------------------------------

  describe('getData', () => {
    it('返回内部数据的副本（不是原始引用）', () => {
      const data = createTestData(3, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)

      const copy = vb.getData()
      expect(copy).toEqual(data)
      expect(copy.buffer).not.toBe(data.buffer) // 不同缓冲区
    })

    it('修改副本不影响内部数据', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)

      const copy = vb.getData()
      copy[0] = 999

      const copy2 = vb.getData()
      expect(copy2[0]).toBe(0) // 原始值不变
    })
  })

  // -----------------------------------------------------------------------
  // vertexCount
  // -----------------------------------------------------------------------

  describe('vertexCount', () => {
    it('正确计算顶点数量', () => {
      // stride=12: 3 floats per vertex (e.g., position only)
      const attrs3f: ShaderVertexAttribute[] = [{
        name: 'aPosition',
        type: ShaderVertexAttributeType.Float,
        components: 3,
        offset: 0,
      }]
      const data = new Float32Array(15) // 5 vertices * 3 floats
      const vb = new VertexBuffer(data, 12, [attrs3f[0]], engine)

      expect(vb.vertexCount).toBe(5)
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('释放底层 Buffer', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)

      vb.dispose()

      expect(mockBufferDispose).toHaveBeenCalledTimes(1)
    })

    it('幂等 — 重复调用不会报错', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)

      vb.dispose()
      vb.dispose()
      vb.dispose()

      expect(mockBufferDispose).toHaveBeenCalledTimes(1)
    })

    it('释放后所有操作抛出异常', () => {
      const data = createTestData(2, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine)
      vb.dispose()

      expect(() => vb.bind()).toThrow('has been disposed')
      expect(() => vb.setData(new Float32Array(4), 4))
        .toThrow('has been disposed')
      expect(() => vb.setData(new Float32Array(4), 0, 0, 4))
        .toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // 生命周期集成测试
  // -----------------------------------------------------------------------

  describe('生命周期', () => {
    it('创建 → 更新 → 查询 → 释放', () => {
      const data = createTestData(3, stride)
      const vb = new VertexBuffer(data, stride, attrs, engine, true)

      expect(vb.vertexCount).toBe(3)
      expect(vb.isDynamic).toBe(true)
      expect(vb.stride).toBe(stride)
      expect(vb.attributes).toEqual(attrs)

      // 更新部分数据
      const update = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])
      vb.setData(update, 0, 5, 5)
      const stored = vb.getData()
      expect(stored[5]).toBeCloseTo(0.1, 5)

      // bind 为 no-op
      expect(() => vb.bind()).not.toThrow()

      vb.dispose()
      expect(mockBufferDispose).toHaveBeenCalled()
    })
  })
})
