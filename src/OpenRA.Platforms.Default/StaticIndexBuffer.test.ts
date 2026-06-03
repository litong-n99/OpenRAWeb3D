/**
 * StaticIndexBuffer.test.ts — StaticIndexBuffer 迁移单元测试
 *
 * 此模块不需要 mock @babylonjs/core（仅使用 Uint32Array 和接口类型）。
 * 测试焦点：IIndexBuffer 接口实现、数据存储、bind() no-op、
 * 生命周期管理、错误处理和资源释放。
 */

import { describe, it, expect, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// 导入被测模块
// ---------------------------------------------------------------------------

import { StaticIndexBuffer } from './StaticIndexBuffer'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function createTestIndices(count: number): Uint32Array {
  const data = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    data[i] = i
  }
  return data
}

// ---------------------------------------------------------------------------
// StaticIndexBuffer 测试套件
// ---------------------------------------------------------------------------

describe('StaticIndexBuffer', () => {
  afterEach(() => {
    // 无全局 mock 需重置
  })

  // -----------------------------------------------------------------------
  // 构造函数
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('创建包含初始索引数据的实例', () => {
      const indices = createTestIndices(6)
      const sib = new StaticIndexBuffer(indices)

      expect(sib.count).toBe(6)
      expect(sib.data).toEqual(indices)
    })

    it('存储数据副本（不持有原始引用）', () => {
      const indices = createTestIndices(4)
      const sib = new StaticIndexBuffer(indices)

      // 修改原始数组不应影响内部存储
      indices[0] = 999

      expect(sib.data[0]).toBe(0) // 原始值
    })

    it('data getter 返回副本', () => {
      const indices = createTestIndices(4)
      const sib = new StaticIndexBuffer(indices)

      const copy = sib.data
      copy[0] = 777

      // 修改副本不应影响内部存储
      expect(sib.data[0]).toBe(0)
    })

    it('拒绝空索引', () => {
      expect(() => new StaticIndexBuffer(new Uint32Array(0)))
        .toThrow('must not be empty')
    })

    it('支持大索引数量', () => {
      const indices = createTestIndices(10000)
      const sib = new StaticIndexBuffer(indices)

      expect(sib.count).toBe(10000)
      expect(sib.data.length).toBe(10000)
    })

    it('支持单个索引', () => {
      const sib = new StaticIndexBuffer(new Uint32Array([42]))

      expect(sib.count).toBe(1)
      expect(sib.data[0]).toBe(42)
    })
  })

  // -----------------------------------------------------------------------
  // data getter
  // -----------------------------------------------------------------------

  describe('data', () => {
    it('返回与构造时相等的数据', () => {
      const indices = new Uint32Array([10, 20, 30, 40, 50, 60])
      const sib = new StaticIndexBuffer(indices)

      expect(Array.from(sib.data)).toEqual([10, 20, 30, 40, 50, 60])
    })

    it('返回 Uint32Array 类型', () => {
      const sib = new StaticIndexBuffer(createTestIndices(3))

      expect(sib.data).toBeInstanceOf(Uint32Array)
    })
  })

  // -----------------------------------------------------------------------
  // bind() — no-op
  // -----------------------------------------------------------------------

  describe('bind', () => {
    it('是 no-op（不会抛出异常）', () => {
      const sib = new StaticIndexBuffer(createTestIndices(6))

      expect(() => sib.bind()).not.toThrow()
    })

    it('可多次调用', () => {
      const sib = new StaticIndexBuffer(createTestIndices(6))

      expect(() => {
        sib.bind()
        sib.bind()
        sib.bind()
      }).not.toThrow()
    })

    it('已销毁时抛出异常', () => {
      const sib = new StaticIndexBuffer(createTestIndices(4))
      sib.dispose()

      expect(() => sib.bind()).toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('幂等 — 重复调用不会报错', () => {
      const sib = new StaticIndexBuffer(createTestIndices(4))

      sib.dispose()
      sib.dispose()
      sib.dispose()

      // 不应抛出异常
    })

    it('释放后访问 count 抛出异常', () => {
      const sib = new StaticIndexBuffer(createTestIndices(4))
      sib.dispose()

      expect(() => sib.count).toThrow('has been disposed')
    })

    it('释放后 data getter 抛出异常', () => {
      const sib = new StaticIndexBuffer(createTestIndices(4))
      sib.dispose()

      expect(() => sib.data).toThrow('has been disposed')
    })
  })

  // -----------------------------------------------------------------------
  // 生命周期集成测试
  // -----------------------------------------------------------------------

  describe('生命周期', () => {
    it('创建 → 查询 → 绑定 → 释放', () => {
      const indices = new Uint32Array([0, 1, 2, 1, 3, 2])
      const sib = new StaticIndexBuffer(indices)

      // 查询阶段
      expect(sib.count).toBe(6)
      expect(sib.data).toEqual(indices)

      // 绑定阶段
      expect(() => sib.bind()).not.toThrow()

      // 释放阶段
      sib.dispose()
      expect(() => sib.data).toThrow('has been disposed')
    })

    it('保留静态语义 — 数据构造后不变', () => {
      const indices = createTestIndices(10)
      const sib = new StaticIndexBuffer(indices)

      // 多次读取数据应始终相同
      const d1 = sib.data
      const d2 = sib.data
      expect(d1).toEqual(d2)
      expect(d1).toEqual(indices)
    })
  })
})
