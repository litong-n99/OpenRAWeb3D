/**
 * SonicBlastRenderable.test.ts — Unit tests for SonicBlastRenderable + SonicBlastShaderMaterial
 *
 * Tests focus on:
 * - SonicBlastShaderMaterial: uniform creation, radius updates, completeness check
 * - SonicBlastRenderable: disc Mesh creation, positioning, radius expansion
 * - Multiple concurrent blasts with independent radii
 * - dispose() GPU resource cleanup
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core using vi.hoisted
// ---------------------------------------------------------------------------

const {
  mockSMDispose,
  mockSMCtor,
  mockMeshBuilderCreateDisc,
  shaderMaterials,
  meshes,
} = vi.hoisted(() => {
  const smInstances: any[] = []
  const meshInstances: any[] = []

  const smDispose = vi.fn()
  const meshDispose = vi.fn()

  const smCtor = vi.fn(function (this: any, name: string, _scene: any, _shaderName: string, _options: any) {
    this.name = name
    this.setFloat = vi.fn()
    this.setVector2 = vi.fn()
    this.setVector3 = vi.fn()
    this.setColor3 = vi.fn()
    this.setFloats = vi.fn()
    this.setTexture = vi.fn()
    this.setMatrix = vi.fn()
    this.dispose = smDispose
    this.needAlphaBlending = vi.fn(() => true)
    this.needAlphaTesting = vi.fn(() => true)
    this.backFaceCulling = true
    smInstances.push(this)
  })

  const meshCtor = vi.fn(function (this: any, name: string, _scene: any) {
    this.name = name
    this.position = { x: 0, y: 0, z: 0, set: vi.fn(function (this: any, x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }) }
    this.rotation = { x: 0, y: 0, z: 0 }
    this.material = null
    this.billboardMode = 0
    this.isPickable = true
    this.isVisible = true
    this.dispose = meshDispose
    this.scaling = { x: 1, y: 1, z: 1 }
    meshInstances.push(this)
  })

  const createDisc = vi.fn((name: string, options: any, _scene: any) => {
    const m = new (meshCtor as any)(name, _scene)
    if (options?.radius) m._radius = options.radius
    if (options?.tessellation) m._tessellation = options.tessellation
    return m
  })

  return {
    mockSMDispose: smDispose,
    mockMeshDispose: meshDispose,
    mockSMCtor: smCtor,
    mockMeshBuilderCreateDisc: createDisc,
    mockMeshCtor: meshCtor,
    shaderMaterials: smInstances,
    meshes: meshInstances,
  }
})

vi.mock('@babylonjs/core', () => {
  const shadersStore: Record<string, string> = {}
  return {
    Scene: vi.fn(),
    ShaderMaterial: mockSMCtor,
    MeshBuilder: {
      CreateDisc: mockMeshBuilderCreateDisc,
      CreatePlane: vi.fn(),
      CreateLines: vi.fn(),
    },
    Effect: {
      ShadersStore: shadersStore,
    },
    Color3: vi.fn(function (this: any, r: number, g: number, b: number) {
      this.r = r; this.g = g; this.b = b
    }),
    Vector3: vi.fn(function (this: any, x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }),
  }
})

// ---------------------------------------------------------------------------
// Imports (after vi.mock)
// ---------------------------------------------------------------------------

import {
  SonicBlastRenderable,
  SonicBlastShaderMaterial,
  type ISonicBlastRendererAccess,
  type ISonicBlastWorldRenderer,
} from './SonicBlastRenderable.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { Effect, Color3 } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRenderer(size: number = 16): ISonicBlastRendererAccess {
  return {
    info: { size },
    draw: vi.fn(),
  }
}

function createMockWorldRenderer(): ISonicBlastWorldRenderer {
  return {
    screen3DPxPosition: vi.fn((pos: WPos) => ({ x: pos.X / 1024, y: pos.Y / 1024, z: pos.Z / 1024 })),
    viewport: {
      worldToViewPx: vi.fn((pos: { x: number; y: number; z: number }) => pos),
    },
  }
}

function makeMockScene(): import('@babylonjs/core').Scene {
  return {} as unknown as import('@babylonjs/core').Scene
}

// ---------------------------------------------------------------------------
// Tests: SonicBlastShaderMaterial
// ---------------------------------------------------------------------------

describe('SonicBlastShaderMaterial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shaderMaterials.length = 0
    meshes.length = 0
  })
  it('should create shader material with correct uniforms', () => {
    const scene = makeMockScene()
    const mat = new SonicBlastShaderMaterial('testBlast', scene)

    expect(mat.material).toBeDefined()
    expect(mockSMCtor).toHaveBeenCalled()

    // Verify shader was registered
    const shaderName = 'sonicBlast_testBlast'
    expect(Effect.ShadersStore[`${shaderName}VertexShader`]).toBeDefined()
    expect(Effect.ShadersStore[`${shaderName}FragmentShader`]).toBeDefined()

    // Verify initial uniforms
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_radius', 0)
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_maxRadius', 100)
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_intensity', 1.0)

    mat.dispose()
  })

  it('should register vertex and fragment shaders in ShadersStore', () => {
    const scene = makeMockScene()
    const mat = new SonicBlastShaderMaterial('blast', scene)

    const vertexSrc = Effect.ShadersStore['sonicBlast_blastVertexShader']
    const fragmentSrc = Effect.ShadersStore['sonicBlast_blastFragmentShader']

    expect(vertexSrc).toContain('position')
    expect(vertexSrc).toContain('worldViewProjection')
    expect(fragmentSrc).toContain('u_radius')
    expect(fragmentSrc).toContain('u_maxRadius')
    expect(fragmentSrc).toContain('u_color')

    mat.dispose()
  })

  it('should expand radius linearly', () => {
    const scene = makeMockScene()
    const mat = new SonicBlastShaderMaterial('test', scene)

    expect(mat.radius).toBe(0)

    mat.setRadius(10)
    expect(mat.radius).toBe(10)
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_radius', 10)

    mat.setRadius(50)
    expect(mat.radius).toBe(50)

    mat.dispose()
  })

  it('should report isComplete when radius >= maxRadius', () => {
    const scene = makeMockScene()
    const mat = new SonicBlastShaderMaterial('test', scene, new Color3(1, 1, 1), 100)

    expect(mat.isComplete).toBe(false)

    mat.setRadius(50)
    expect(mat.isComplete).toBe(false)

    mat.setRadius(100)
    expect(mat.isComplete).toBe(true)

    mat.setRadius(150)
    expect(mat.isComplete).toBe(true)

    mat.dispose()
  })

  it('should enable alpha blending for transparency', () => {
    const scene = makeMockScene()
    const mat = new SonicBlastShaderMaterial('test', scene)

    expect(mat.material.needAlphaBlending()).toBe(true)
    expect(mat.material.needAlphaTesting()).toBe(true)
    expect(mat.material.backFaceCulling).toBe(false)

    mat.dispose()
  })

  it('should dispose shader material', () => {
    const scene = makeMockScene()
    const mat = new SonicBlastShaderMaterial('test', scene)

    mat.dispose()
    expect(mockSMDispose).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests: SonicBlastRenderable
// ---------------------------------------------------------------------------

describe('SonicBlastRenderable', () => {
  let renderer: ISonicBlastRendererAccess
  let wr: ISonicBlastWorldRenderer
  let pos: WPos

  beforeEach(() => {
    vi.clearAllMocks()
    shaderMaterials.length = 0
    meshes.length = 0
    renderer = createMockRenderer()
    wr = createMockWorldRenderer()
    pos = new WPos(5120, 10240, 0)
  })

  // Remove the original beforeEach that just sets renderer/wr/pos
  // (handled above)

  describe('None', () => {
    it('is an empty readonly array', () => {
      expect(SonicBlastRenderable.None).toHaveLength(0)
    })
  })

  describe('constructor', () => {
    it('stores pos and renderer, default values', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(r.pos).toBe(pos)
      expect(r.zOffset).toBe(0)
      expect(r.isDecoration).toBe(false)
      expect(r.radius).toBe(0)
      expect(r.disc).toBeNull()
      expect(r.shaderMaterial).toBeNull()
    })
  })

  describe('withZOffset', () => {
    it('returns this', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(r.withZOffset(10)).toBe(r)
    })
  })

  describe('offsetBy', () => {
    it('returns this', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(r.offsetBy({ X: 100, Y: 200, Z: 0 } as any)).toBe(r)
    })
  })

  describe('asDecoration', () => {
    it('returns this', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(r.asDecoration()).toBe(r)
    })
  })

  describe('prepareRender', () => {
    it('returns this', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(r.prepareRender(wr)).toBe(r)
    })
  })

  describe('render (2D fallback)', () => {
    it('calls renderer.draw with screen position', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      r.render(wr)

      expect(wr.screen3DPxPosition).toHaveBeenCalledWith(pos)
      expect(renderer.draw).toHaveBeenCalledWith(
        expect.objectContaining({ x: pos.X / 1024, y: pos.Y / 1024 }),
      )
    })
  })

  describe('3D rendering', () => {
    it('should create disc Mesh on first render in 3D mode', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene)

      expect(r.disc).toBeNull()
      expect(r.shaderMaterial).toBeNull()

      r.render(wr)

      expect(r.disc).not.toBeNull()
      expect(r.shaderMaterial).not.toBeNull()
      expect(mockMeshBuilderCreateDisc).toHaveBeenCalled()
    })

    it('should position disc at correct world coordinates', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene)

      r.render(wr)

      const disc = r.disc!
      // Billboard is now positioned at world-space coordinates (not screen pixels)
      expect(disc.position.x).toBe(pos.X)
      expect(disc.position.z).toBe(pos.Z)
    })

    it('should place disc flat on terrain (rotation.x = -PI/2)', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene)

      r.render(wr)

      expect(r.disc!.rotation.x).toBeCloseTo(-Math.PI / 2)
    })

    it('should set terrain height for disc Y position', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene)
      r.setTerrainHeight(42)

      r.render(wr)

      expect(r.disc!.position.y).toBe(42)
    })

    it('should expand ring radius linearly with tick count', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene)
      r.setExpansionRate(5)

      expect(r.radius).toBe(0)
      expect(r.isComplete).toBe(false)

      r.tickRadius()
      expect(r.radius).toBe(5)

      r.tickRadius()
      expect(r.radius).toBe(10)

      r.tickRadius()
      expect(r.radius).toBe(15)
    })

    it('should report complete when radius reaches maxRadius', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene, 50)
      r.setExpansionRate(10)

      expect(r.isComplete).toBe(false)
      expect(r.maxRadius).toBe(50)

      r.tickRadius() // radius = 10
      r.tickRadius() // radius = 20
      r.tickRadius() // radius = 30
      r.tickRadius() // radius = 40
      expect(r.isComplete).toBe(false)

      r.tickRadius() // radius = 50
      expect(r.isComplete).toBe(true)
    })

    it('should update shader material radius when setRadius called', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene)

      r.render(wr) // creates disc + shader material
      const sm = r.shaderMaterial!
      expect(sm.radius).toBe(0)

      r.setRadius(25)
      expect(sm.radius).toBe(25)
      expect(sm.material.setFloat).toHaveBeenCalledWith('u_radius', 25)
    })

    it('should dispose disc and shader material', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene)

      r.render(wr)
      const disc = r.disc!

      r.dispose()

      expect(disc.dispose).toHaveBeenCalled()
      expect(r.disc).toBeNull()
      expect(r.shaderMaterial).toBeNull()
      expect(mockSMDispose).toHaveBeenCalled()
    })

    it('should be no-op to dispose when not in 3D mode', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(() => r.dispose()).not.toThrow()
    })

    it('multiple concurrent blasts have independent radii', () => {
      const scene = makeMockScene()
      const blast1 = new SonicBlastRenderable(renderer, pos, scene, 100)
      blast1.setExpansionRate(3)

      const pos2 = new WPos(10000, 20000, 0)
      const blast2 = new SonicBlastRenderable(renderer, pos2, scene, 80)
      blast2.setExpansionRate(5)

      blast1.tickRadius()
      blast1.tickRadius()
      blast2.tickRadius()

      expect(blast1.radius).toBe(6)  // 2 ticks × 3
      expect(blast2.radius).toBe(5)  // 1 tick × 5

      // Radii are independent
      expect(blast1.radius).not.toBe(blast2.radius)
    })

    it('should not tick radius past completion', () => {
      const scene = makeMockScene()
      const r = new SonicBlastRenderable(renderer, pos, scene, 20)
      r.setExpansionRate(10)

      r.tickRadius() // 10
      r.tickRadius() // 20 — complete
      expect(r.isComplete).toBe(true)

      r.tickRadius() // still 20 (no-op because complete)
      expect(r.radius).toBe(20)
    })
  })

  describe('screenBounds', () => {
    it('returns a bounding rectangle', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      const bounds = r.screenBounds(wr)

      expect(bounds).toHaveProperty('x')
      expect(bounds).toHaveProperty('y')
      expect(bounds).toHaveProperty('width')
      expect(bounds).toHaveProperty('height')
      expect(typeof bounds.width).toBe('number')
      expect(typeof bounds.height).toBe('number')
    })
  })

  describe('renderDebugGeometry', () => {
    it('does not throw', () => {
      const r = new SonicBlastRenderable(renderer, pos)
      expect(() => r.renderDebugGeometry(wr)).not.toThrow()
    })
  })
})
