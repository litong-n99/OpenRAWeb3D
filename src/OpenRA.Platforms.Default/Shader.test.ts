/**
 * Shader.test.ts — Shader 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock。
 * 测试焦点：IShader 接口实现、uniform 设置、纹理绑定、生命周期管理、
 * 错误处理和资源释放。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// 使用 vi.hoisted() 在所有 mock/import 之前创建共享变量
//
// vi.mock() 工厂被 hoist 到文件顶部，因此工厂内部只能引用
// vi.hoisted() 创建的变量（也被 hoist 处理）。
// ---------------------------------------------------------------------------

const {
  mockSetFloat,
  mockSetVector2,
  mockSetVector3,
  mockSetFloats,
  mockSetTexture,
  mockSetMatrix,
  mockDispose,
  // mockBind used internally in ShaderMaterial mock, not asserted in tests
  MockShaderMaterial,
  mockShadersStore,
  MockEffect,
  MockMatrix,
} = vi.hoisted(() => {
  const mSetFloat = vi.fn()
  const mSetVector2 = vi.fn()
  const mSetVector3 = vi.fn()
  const mSetFloats = vi.fn()
  const mSetTexture = vi.fn()
  const mSetMatrix = vi.fn()
  const mDispose = vi.fn()
  const mBind = vi.fn()

  const mShaderMaterial = vi.fn(function (this: any) {
    this.setFloat = mSetFloat
    this.setVector2 = mSetVector2
    this.setVector3 = mSetVector3
    this.setFloats = mSetFloats
    this.setTexture = mSetTexture
    this.setMatrix = mSetMatrix
    this.dispose = mDispose
    this.bind = mBind
  })

  const mShadersStore: Record<string, string> = {}

  const mEffect = {
    ShadersStore: mShadersStore,
  }

  const mMatrix = {
    FromArray: vi.fn((arr: Float32Array) => ({
      m: Array.from(arr),
      toArray: () => Float32Array.from(arr),
    })),
  }

  return {
    mockSetFloat: mSetFloat,
    mockSetVector2: mSetVector2,
    mockSetVector3: mSetVector3,
    mockSetFloats: mSetFloats,
    mockSetTexture: mSetTexture,
    mockSetMatrix: mSetMatrix,
    mockDispose: mDispose,
    mockBind: mBind,
    MockShaderMaterial: mShaderMaterial,
    mockShadersStore: mShadersStore,
    MockEffect: mEffect,
    MockMatrix: mMatrix,
  }
})

vi.mock('@babylonjs/core', () => {
  return {
    ShaderMaterial: MockShaderMaterial,
    Effect: MockEffect,
    Matrix: MockMatrix,
    Vector2: vi.fn(function (this: any, x: number, y: number) { this.x = x; this.y = y }),
    Vector3: vi.fn(function (this: any, x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }),
  }
})

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { Shader } from './Shader'
import { ShaderVertexAttributeType } from '../OpenRA.Game/Graphics/PlatformInterfaces'
import type {
  IShaderBindings,
  ITexture,
  ShaderVertexAttribute,
  Size,
  Rectangle,
  TextureScaleFilter,
} from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VERT_SRC = '#version 300 es\nprecision highp float;\nuniform mat4 worldViewProjection;\nin vec3 aVertexPosition;\nin vec4 aVertexTexCoord;\nin uint aVertexAttributes;\nin vec4 aVertexTint;\nout vec4 vTexCoord;\nvoid main() { gl_Position = worldViewProjection * vec4(aVertexPosition, 1.0); vTexCoord = aVertexTexCoord; }'
const FRAG_SRC = '#version 300 es\nprecision mediump float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }'

const TEST_ATTRIBUTES: readonly ShaderVertexAttribute[] = [
  { name: 'aVertexPosition', type: ShaderVertexAttributeType.Float, components: 3, offset: 0 },
  { name: 'aVertexTexCoord', type: ShaderVertexAttributeType.Float, components: 4, offset: 12 },
  { name: 'aVertexAttributes', type: ShaderVertexAttributeType.UInt, components: 1, offset: 28 },
  { name: 'aVertexTint', type: ShaderVertexAttributeType.Float, components: 4, offset: 32 },
]

function createTestBindings(overrides?: Partial<IShaderBindings>): IShaderBindings {
  return {
    vertexShaderName: 'combined',
    vertexShaderCode: VERT_SRC,
    fragmentShaderName: 'combined',
    fragmentShaderCode: FRAG_SRC,
    stride: 48,
    attributes: TEST_ATTRIBUTES,
    ...overrides,
  }
}

class MockTexture implements ITexture {
  babylonTexture: unknown
  size: Size = { width: 256, height: 256 }
  scaleFilter: TextureScaleFilter = 'Nearest' as TextureScaleFilter

  constructor(babylonTexture?: unknown) {
    this.babylonTexture = babylonTexture ?? { _mockTexture: true }
  }

  setData(_colors: Uint8Array, _width: number, _height: number): void {}
  setFloatData(_data: Float32Array, _width: number, _height: number): void {}
  setDataFromReadBuffer(_rect: Rectangle): void {}
  getData(): Uint8Array { return new Uint8Array() }
  dispose(): void {}
}

/** Simulates a Babylon.js Texture object */
class MockBabylonTexture {
  _isTexture = true
}

const mockScene = { id: 'test-scene' } as any

// ---------------------------------------------------------------------------
// Reset mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Clear Effect.ShadersStore
  for (const key of Object.keys(mockShadersStore)) {
    delete mockShadersStore[key]
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Shader construction
// ---------------------------------------------------------------------------

describe('Shader construction', () => {
  it('registers shader sources in Effect.ShadersStore', () => {
    const bindings = createTestBindings()

    // ShaderStore should be empty before
    expect(mockShadersStore['combinedVertexShader']).toBeUndefined()
    expect(mockShadersStore['combinedFragmentShader']).toBeUndefined()

    new Shader(bindings, mockScene)

    // After construction, sources should be registered
    expect(mockShadersStore['combinedVertexShader']).toBe(VERT_SRC)
    expect(mockShadersStore['combinedFragmentShader']).toBe(FRAG_SRC)
  })

  it('creates ShaderMaterial with correct name', () => {
    new Shader(createTestBindings(), mockScene)
    expect(MockShaderMaterial).toHaveBeenCalledTimes(1)

    // vitest types mock.calls as never[][]; cast to access
    const calls = (MockShaderMaterial as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls[0][0]).toBe('shader_combined_combined')
  })

  it('creates ShaderMaterial with correct shader path', () => {
    new Shader(createTestBindings(), mockScene)
    const calls = (MockShaderMaterial as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls[0][2]).toEqual({ vertex: 'combined', fragment: 'combined' })
  })

  it('creates ShaderMaterial with correct options', () => {
    new Shader(createTestBindings(), mockScene)
    const calls = (MockShaderMaterial as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const options = calls[0][3] as Record<string, unknown>
    expect(options.attributes).toContain('aVertexPosition')
    expect(options.attributes).toContain('aVertexTexCoord')
    expect(options.attributes).toContain('aVertexAttributes')
    expect(options.attributes).toContain('aVertexTint')
    expect(options.samplers).toContain('Texture0')
    expect(options.samplers).toContain('Palette')
    expect(options.samplers).toContain('ColorShifts')
    expect(options.needAlphaBlending).toBe(true)
    expect(options.needAlphaTesting).toBe(true)
  })

  it('does not overwrite existing ShadersStore entries', () => {
    // Pre-register
    mockShadersStore['combinedVertexShader'] = 'existing'
    mockShadersStore['combinedFragmentShader'] = 'existing'

    new Shader(createTestBindings(), mockScene)
    expect(mockShadersStore['combinedVertexShader']).toBe('existing')
  })

  it('stores bindings reference', () => {
    const bindings = createTestBindings()
    const shader = new Shader(bindings, mockScene)
    expect(shader.bindings).toBe(bindings)
  })

  it('exposes material property', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    expect(shader.material).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// setBool
// ---------------------------------------------------------------------------

describe('Shader.setBool', () => {
  it('calls setFloat with 1.0 for true', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    shader.setBool('EnableDepthPreview', true)
    expect(mockSetFloat).toHaveBeenCalledWith('EnableDepthPreview', 1.0)
  })

  it('calls setFloat with 0.0 for false', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    shader.setBool('EnablePixelArtScaling', false)
    expect(mockSetFloat).toHaveBeenCalledWith('EnablePixelArtScaling', 0.0)
  })
})

// ---------------------------------------------------------------------------
// setVec — 4 overloads
// ---------------------------------------------------------------------------

describe('Shader.setVec', () => {
  let shader: Shader

  beforeEach(() => {
    shader = new Shader(createTestBindings(), mockScene)
    vi.clearAllMocks()
  })

  describe('1-component (float)', () => {
    it('calls setFloat', () => {
      shader.setVec('PaletteRows', 16.0)
      expect(mockSetFloat).toHaveBeenCalledWith('PaletteRows', 16.0)
    })

    it('handles zero', () => {
      shader.setVec('someFloat', 0)
      expect(mockSetFloat).toHaveBeenCalledWith('someFloat', 0)
    })

    it('handles negative', () => {
      shader.setVec('someFloat', -1.5)
      expect(mockSetFloat).toHaveBeenCalledWith('someFloat', -1.5)
    })
  })

  describe('2-component (vec2)', () => {
    it('calls setVector2 with Vector2 object', () => {
      shader.setVec('DepthPreviewParams', 0.5, 0.8)
      expect(mockSetVector2).toHaveBeenCalledTimes(1)
      // Vector2 is created with (x, y)
      const callArg = mockSetVector2.mock.calls[0]
      expect(callArg[0]).toBe('DepthPreviewParams')
    })
  })

  describe('3-component (vec3)', () => {
    it('calls setVector3 with Vector3 object', () => {
      shader.setVec('someVec3', 1, 2, 3)
      expect(mockSetVector3).toHaveBeenCalledTimes(1)
      const callArg = mockSetVector3.mock.calls[0]
      expect(callArg[0]).toBe('someVec3')
    })
  })

  describe('array overload (N-component)', () => {
    it('calls setFloats with converted Float32Array', () => {
      const vec = new Float32Array([1, 2, 3, 4])
      shader.setVec('someArray', vec, 4)
      expect(mockSetFloats).toHaveBeenCalledWith('someArray', [1, 2, 3, 4])
    })

    it('throws for length > 4', () => {
      const vec = new Float32Array([1, 2, 3, 4, 5])
      expect(() => shader.setVec('bad', vec, 5)).toThrow(/Invalid vector length/)
    })

    it('throws for length < 1', () => {
      const vec = new Float32Array([])
      expect(() => shader.setVec('bad', vec, 0)).toThrow(/Invalid vector length/)
    })

    it('handles length 1 array', () => {
      const vec = new Float32Array([42])
      shader.setVec('single', vec, 1)
      expect(mockSetFloats).toHaveBeenCalledWith('single', [42])
    })
  })
})

// ---------------------------------------------------------------------------
// setTexture
// ---------------------------------------------------------------------------

describe('Shader.setTexture', () => {
  let shader: Shader

  beforeEach(() => {
    shader = new Shader(createTestBindings(), mockScene)
    vi.clearAllMocks()
  })

  it('calls material.setTexture with babylonTexture', () => {
    const babylonTex = new MockBabylonTexture()
    const tex = new MockTexture(babylonTex)
    shader.setTexture('Texture0', tex)
    expect(mockSetTexture).toHaveBeenCalledWith('Texture0', babylonTex)
  })

  it('skips null or undefined texture (matches OpenRA)', () => {
    // @ts-expect-error testing null handling like OpenRA
    shader.setTexture('Texture0', null)
    expect(mockSetTexture).not.toHaveBeenCalled()
  })

  it('handles Palette texture', () => {
    const babylonTex = new MockBabylonTexture()
    const tex = new MockTexture(babylonTex)
    shader.setTexture('Palette', tex)
    expect(mockSetTexture).toHaveBeenCalledWith('Palette', babylonTex)
  })

  it('throws for texture without babylonTexture property', () => {
    const badTex = { size: { width: 256, height: 256 } } as unknown as ITexture
    expect(() => shader.setTexture('Texture0', badTex)).toThrow(
      /Cannot extract Babylon/,
    )
  })
})

// ---------------------------------------------------------------------------
// setMatrix
// ---------------------------------------------------------------------------

describe('Shader.setMatrix', () => {
  let shader: Shader

  beforeEach(() => {
    shader = new Shader(createTestBindings(), mockScene)
    vi.clearAllMocks()
  })

  it('calls material.setMatrix with Babylon.js Matrix', () => {
    const mtx = new Float32Array(16)
    mtx[0] = 1 // identity matrix
    shader.setMatrix('someMatrix', mtx)
    expect(MockMatrix.FromArray).toHaveBeenCalledWith(mtx)
    expect(mockSetMatrix).toHaveBeenCalledTimes(1)
  })

  it('throws for non-16-length array', () => {
    const mtx = new Float32Array(9) // 3x3 instead of 4x4
    expect(() => shader.setMatrix('bad', mtx)).toThrow(/Invalid 4x4 matrix/)
  })

  it('throws for empty array', () => {
    const mtx = new Float32Array(0)
    expect(() => shader.setMatrix('bad', mtx)).toThrow(/Invalid 4x4 matrix/)
  })

  it('handles exact 16-length array', () => {
    const mtx = new Float32Array(16)
    // Fill with arbitrary values
    for (let i = 0; i < 16; i++) mtx[i] = i * 0.1
    shader.setMatrix('valid', mtx)
    expect(MockMatrix.FromArray).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// prepareRender
// ---------------------------------------------------------------------------

describe('Shader.prepareRender', () => {
  it('is a no-op (does not throw)', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    expect(() => shader.prepareRender()).not.toThrow()
  })

  it('can be called multiple times', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    expect(() => {
      shader.prepareRender()
      shader.prepareRender()
      shader.prepareRender()
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// bind
// ---------------------------------------------------------------------------

describe('Shader.bind', () => {
  it('is a no-op (does not throw)', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    expect(() => shader.bind()).not.toThrow()
  })

  it('can be called after setVec', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    shader.setVec('PaletteRows', 16)
    expect(() => shader.bind()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Lifecycle: dispose
// ---------------------------------------------------------------------------

describe('Shader.dispose', () => {
  it('calls material.dispose', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    shader.dispose()
    expect(mockDispose).toHaveBeenCalledTimes(1)
  })

  it('does not dispose material twice', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    shader.dispose()
    shader.dispose()
    expect(mockDispose).toHaveBeenCalledTimes(1)
  })

  it('throws on any operation after dispose', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    shader.dispose()

    expect(() => shader.setBool('test', true)).toThrow(/disposed/)
    expect(() => shader.setVec('test', 1.0)).toThrow(/disposed/)
    expect(() => shader.setVec('test', 1.0, 2.0)).toThrow(/disposed/)
    expect(() => shader.setVec('test', 1.0, 2.0, 3.0)).toThrow(/disposed/)
    expect(() => shader.setVec('test', new Float32Array([1]), 1)).toThrow(/disposed/)
    expect(() => shader.setTexture('test', new MockTexture())).toThrow(/disposed/)
    expect(() => shader.setMatrix('test', new Float32Array(16))).toThrow(/disposed/)
    expect(() => shader.prepareRender()).toThrow(/disposed/)
    expect(() => shader.bind()).toThrow(/disposed/)
  })

  it('dispose is idempotent', () => {
    const shader = new Shader(createTestBindings(), mockScene)
    expect(() => {
      shader.dispose()
      shader.dispose()
      shader.dispose()
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Full lifecycle: create → use → dispose
// ---------------------------------------------------------------------------

describe('Shader full lifecycle', () => {
  it('completes create → set uniforms → set texture → set matrix → bind → prepareRender → dispose', () => {
    const shader = new Shader(createTestBindings(), mockScene)

    // Set various uniforms
    shader.setBool('EnableDepthPreview', true)
    shader.setVec('PaletteRows', 16)
    shader.setVec('DepthPreviewParams', 0.5, 0.8)
    shader.setVec('DepthTextureScale', 128)
    shader.setVec('someFloats', new Float32Array([1, 2, 3, 4]), 4)

    // Set texture
    const tex = new MockTexture(new MockBabylonTexture())
    shader.setTexture('Texture0', tex)
    shader.setTexture('Palette', tex)

    // Set matrix
    const mtx = new Float32Array(16)
    mtx[0] = 1
    shader.setMatrix('someMatrix', mtx)

    // Prepare and bind
    shader.prepareRender()
    shader.bind()

    // Dispose
    shader.dispose()
  })
})

// ---------------------------------------------------------------------------
// Effect.ShadersStore integration
// ---------------------------------------------------------------------------

describe('Effect.ShadersStore integration', () => {
  it('uses correct Babylon.js naming convention', () => {
    const bindings = createTestBindings({
      vertexShaderName: 'customShader',
      fragmentShaderName: 'customShader',
    })

    new Shader(bindings, mockScene)

    expect(mockShadersStore['customShaderVertexShader']).toBe(VERT_SRC)
    expect(mockShadersStore['customShaderFragmentShader']).toBe(FRAG_SRC)
  })

  it('handles different vertex/fragment names', () => {
    const bindings = createTestBindings({
      vertexShaderName: 'vertShader',
      fragmentShaderName: 'fragShader',
    })

    new Shader(bindings, mockScene)

    expect(mockShadersStore['vertShaderVertexShader']).toBe(VERT_SRC)
    expect(mockShadersStore['fragShaderFragmentShader']).toBe(FRAG_SRC)
  })
})
