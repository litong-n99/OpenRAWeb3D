/**
 * ShaderBindings.test.ts — ShaderBindings 迁移单元测试
 *
 * 测试着色器源码注册表、ShaderBindings 抽象基类的跨距计算、
 * 着色器源码加载和错误处理。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  registerShaderSource,
  registerShaderSources,
  clearShaderSources,
  getShaderSource,
  ShaderBindings,
} from './ShaderBindings'
import { ShaderVertexAttributeType } from './PlatformInterfaces'
import type { ShaderVertexAttribute } from './PlatformInterfaces'

// ---------------------------------------------------------------------------
// 测试辅助：具体 ShaderBindings 子类
// ---------------------------------------------------------------------------

const TEST_ATTRIBUTES: readonly ShaderVertexAttribute[] = [
  { name: 'aPosition', type: ShaderVertexAttributeType.Float, components: 3, offset: 0 },
  { name: 'aTexCoord', type: ShaderVertexAttributeType.Float, components: 2, offset: 12 },
  { name: 'aColor', type: ShaderVertexAttributeType.Float, components: 4, offset: 20 },
]

class TestShaderBindings extends ShaderBindings {
  constructor(name = 'test') {
    super(name)
  }

  get attributes(): readonly ShaderVertexAttribute[] {
    return TEST_ATTRIBUTES
  }
}

const VERT_SRC = '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }'
const FRAG_SRC = '#version 300 es\nprecision mediump float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }'

// ---------------------------------------------------------------------------
// ShaderSourceRegistry
// ---------------------------------------------------------------------------

describe('ShaderSourceRegistry', () => {
  beforeEach(() => {
    clearShaderSources()
  })

  afterEach(() => {
    clearShaderSources()
  })

  describe('registerShaderSource', () => {
    it('registers a single shader source', () => {
      registerShaderSource('test.vert', VERT_SRC)
      expect(getShaderSource('test.vert')).toBe(VERT_SRC)
    })

    it('overwrites existing registration', () => {
      registerShaderSource('test.vert', 'old')
      registerShaderSource('test.vert', VERT_SRC)
      expect(getShaderSource('test.vert')).toBe(VERT_SRC)
    })
  })

  describe('registerShaderSources', () => {
    it('registers multiple sources at once', () => {
      registerShaderSources({
        'test.vert': VERT_SRC,
        'test.frag': FRAG_SRC,
      })
      expect(getShaderSource('test.vert')).toBe(VERT_SRC)
      expect(getShaderSource('test.frag')).toBe(FRAG_SRC)
    })
  })

  describe('getShaderSource', () => {
    it('throws if source is not registered', () => {
      expect(() => getShaderSource('nonexistent.vert')).toThrow(
        /not registered/,
      )
    })
  })

  describe('clearShaderSources', () => {
    it('clears all registered sources', () => {
      registerShaderSource('test.vert', VERT_SRC)
      clearShaderSources()
      expect(() => getShaderSource('test.vert')).toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// ShaderBindings base class
// ---------------------------------------------------------------------------

describe('ShaderBindings', () => {
  beforeEach(() => {
    clearShaderSources()
    registerShaderSources({
      'test.vert': VERT_SRC,
      'test.frag': FRAG_SRC,
    })
  })

  afterEach(() => {
    clearShaderSources()
  })

  describe('constructor', () => {
    it('loads shader source from registry', () => {
      const bindings = new TestShaderBindings('test')
      expect(bindings.vertexShaderName).toBe('test')
      expect(bindings.fragmentShaderName).toBe('test')
      expect(bindings.vertexShaderCode).toBe(VERT_SRC)
      expect(bindings.fragmentShaderCode).toBe(FRAG_SRC)
    })

    it('throws if vertex shader not registered', () => {
      clearShaderSources()
      registerShaderSource('test.frag', FRAG_SRC)
      expect(() => new TestShaderBindings('test')).toThrow(/not registered/)
    })

    it('throws if fragment shader not registered', () => {
      clearShaderSources()
      registerShaderSource('test.vert', VERT_SRC)
      expect(() => new TestShaderBindings('test')).toThrow(/not registered/)
    })

    it('supports different vertex/fragment names', () => {
      registerShaderSources({
        'vert.vert': VERT_SRC,
        'frag.frag': FRAG_SRC,
      })
      class DualBindings extends ShaderBindings {
        constructor() { super('vert', 'frag') }
        get attributes(): readonly ShaderVertexAttribute[] { return TEST_ATTRIBUTES }
      }
      const bindings = new DualBindings()
      expect(bindings.vertexShaderName).toBe('vert')
      expect(bindings.fragmentShaderName).toBe('frag')
      expect(bindings.vertexShaderCode).toBe(VERT_SRC)
      expect(bindings.fragmentShaderCode).toBe(FRAG_SRC)
    })
  })

  describe('stride', () => {
    it('computes stride from attributes (components * 4 sum)', () => {
      const bindings = new TestShaderBindings()
      // aPosition: 3*4=12 + aTexCoord: 2*4=8 + aColor: 4*4=16 = 36
      expect(bindings.stride).toBe(36)
    })

    it('returns 0 for empty attributes', () => {
      class EmptyBindings extends ShaderBindings {
        constructor() { super('test') }
        get attributes(): readonly ShaderVertexAttribute[] { return [] }
      }
      const bindings = new EmptyBindings()
      expect(bindings.stride).toBe(0)
    })

    it('matches 48-byte vertex for CombinedShaderBindings layout', () => {
      // aVertexPosition(3*4) + aVertexTexCoord(4*4) + aVertexAttributes(1*4) + aVertexTint(4*4)
      // = 12 + 16 + 4 + 16 = 48
      const attrs: readonly ShaderVertexAttribute[] = [
        { name: 'aVertexPosition', type: ShaderVertexAttributeType.Float, components: 3, offset: 0 },
        { name: 'aVertexTexCoord', type: ShaderVertexAttributeType.Float, components: 4, offset: 12 },
        { name: 'aVertexAttributes', type: ShaderVertexAttributeType.UInt, components: 1, offset: 28 },
        { name: 'aVertexTint', type: ShaderVertexAttributeType.Float, components: 4, offset: 32 },
      ]
      class CombinedLike extends ShaderBindings {
        constructor() { super('test') }
        get attributes(): readonly ShaderVertexAttribute[] { return attrs }
      }
      const bindings = new CombinedLike()
      expect(bindings.stride).toBe(48)
    })
  })

  describe('IShaderBindings contract', () => {
    it('exposes all required properties', () => {
      const bindings = new TestShaderBindings()
      expect(bindings.vertexShaderName).toBeDefined()
      expect(bindings.vertexShaderCode).toBeDefined()
      expect(bindings.fragmentShaderName).toBeDefined()
      expect(bindings.fragmentShaderCode).toBeDefined()
      expect(bindings.stride).toBeGreaterThan(0)
      expect(bindings.attributes).toBeDefined()
      expect(bindings.attributes.length).toBeGreaterThan(0)
    })

    it('attributes are readonly', () => {
      const bindings = new TestShaderBindings()
      const attrs = bindings.attributes
      // Should be the same reference on each access
      expect(bindings.attributes).toBe(attrs)
    })
  })
})
