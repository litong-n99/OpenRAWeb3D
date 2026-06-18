/**
 * ChronoVortexRenderable.test.ts — Unit tests for ChronoVortexRenderable + ChronoVortexShaderMaterial
 *
 * Tests focus on:
 * - Frame validation, position tracking, render delegate
 * - ChronoVortexShaderMaterial: uniform creation, time/progress updates
 * - Billboard creation and positioning in 3D mode
 * - ShaderMaterial uniforms set correctly
 * - dispose() GPU resource cleanup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core using vi.hoisted
// ---------------------------------------------------------------------------

const {
  mockSMDispose,
  mockSMCtor,
  mockMeshBuilderCreatePlane,
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
    this.material = null
    this.billboardMode = 0
    this.isPickable = true
    this.isVisible = true
    this.dispose = meshDispose
    this.scaling = { x: 1, y: 1, z: 1 }
    meshInstances.push(this)
  })

  const createPlane = vi.fn((name: string, options: any, _scene: any) => {
    const m = new (meshCtor as any)(name, _scene)
    if (options?.width) m._width = options.width
    if (options?.height) m._height = options.height
    return m
  })

  return {
    mockSMDispose: smDispose,
    mockMeshDispose: meshDispose,
    mockSMCtor: smCtor,
    mockMeshBuilderCreatePlane: createPlane,
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
      CreatePlane: mockMeshBuilderCreatePlane,
      CreateDisc: vi.fn(),
      CreateLines: vi.fn(),
    },
    Mesh: {
      BILLBOARDMODE_ALL: 7,
      BILLBOARDMODE_NONE: 0,
      BILLBOARDMODE_X: 1,
      BILLBOARDMODE_Y: 2,
      BILLBOARDMODE_Z: 4,
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
  ChronoVortexRenderable,
  ChronoVortexShaderMaterial,
  type IChronoVortexRendererAccess,
  type IChronoVortexWorldRenderer,
} from './ChronoVortexRenderable.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { Mesh, Effect, Color3 } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRenderer(): IChronoVortexRendererAccess {
  return { drawVortex: vi.fn() }
}

function makeWorldRenderer(): IChronoVortexWorldRenderer {
  return {
    screen3DPxPosition: vi.fn().mockReturnValue({ x: 100, y: 200, z: 0 }),
    viewport: {
      worldToViewPx: vi.fn().mockReturnValue({ x: 100, y: 200, z: 0 }),
    },
  }
}

function makeMockScene(): import('@babylonjs/core').Scene {
  return {} as unknown as import('@babylonjs/core').Scene
}

// ---------------------------------------------------------------------------
// Tests: ChronoVortexShaderMaterial
// ---------------------------------------------------------------------------

describe('ChronoVortexShaderMaterial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shaderMaterials.length = 0
    meshes.length = 0
  })
  it('should create shader material with correct uniforms', () => {
    const scene = makeMockScene()
    const mat = new ChronoVortexShaderMaterial('testVortex', scene)

    expect(mat.material).toBeDefined()
    expect(mockSMCtor).toHaveBeenCalled()

    // Verify shader was registered
    const shaderName = 'chronoVortex_testVortex'
    expect(Effect.ShadersStore[`${shaderName}VertexShader`]).toBeDefined()
    expect(Effect.ShadersStore[`${shaderName}FragmentShader`]).toBeDefined()

    // Verify initial uniforms
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_time', 0)
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_progress', 0)
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_intensity', 1.0)

    mat.dispose()
  })

  it('should register vertex and fragment shaders in ShadersStore', () => {
    const scene = makeMockScene()
    const mat = new ChronoVortexShaderMaterial('vortex', scene)

    const vertexSrc = Effect.ShadersStore['chronoVortex_vortexVertexShader']
    const fragmentSrc = Effect.ShadersStore['chronoVortex_vortexFragmentShader']

    expect(vertexSrc).toContain('position')
    expect(vertexSrc).toContain('worldViewProjection')
    expect(fragmentSrc).toContain('u_time')
    expect(fragmentSrc).toContain('u_progress')
    expect(fragmentSrc).toContain('u_color')
    expect(fragmentSrc).toContain('atan')

    mat.dispose()
  })

  it('should set time uniform', () => {
    const scene = makeMockScene()
    const mat = new ChronoVortexShaderMaterial('test', scene)

    mat.setTime(2.5)
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_time', 2.5)
    expect(mat.time).toBe(2.5)

    mat.dispose()
  })

  it('should set progress uniform (clamped 0-1)', () => {
    const scene = makeMockScene()
    const mat = new ChronoVortexShaderMaterial('test', scene)

    mat.setProgress(0.75)
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_progress', 0.75)
    expect(mat.progress).toBe(0.75)

    // Clamp to 0-1
    mat.setProgress(1.5)
    expect(mat.progress).toBe(1.0)

    mat.setProgress(-0.5)
    expect(mat.progress).toBe(0.0)

    mat.dispose()
  })

  it('should set intensity uniform', () => {
    const scene = makeMockScene()
    const mat = new ChronoVortexShaderMaterial('test', scene)

    mat.setIntensity(0.5)
    expect(mat.material.setFloat).toHaveBeenCalledWith('u_intensity', 0.5)
    expect(mat.intensity).toBe(0.5)

    mat.dispose()
  })

  it('should set color uniform', () => {
    const scene = makeMockScene()
    const mat = new ChronoVortexShaderMaterial('test', scene)

    const color = new Color3(1, 0, 0)
    mat.setColor(color)
    expect(mat.material.setColor3).toHaveBeenCalledWith('u_color', color)

    mat.dispose()
  })

  it('should dispose shader material', () => {
    const scene = makeMockScene()
    const mat = new ChronoVortexShaderMaterial('test', scene)

    mat.dispose()
    expect(mockSMDispose).toHaveBeenCalled()
  })

  it('should enable alpha blending for transparency', () => {
    const scene = makeMockScene()
    const mat = new ChronoVortexShaderMaterial('test', scene)

    expect(mat.material.needAlphaBlending()).toBe(true)
    expect(mat.material.needAlphaTesting()).toBe(true)
    expect(mat.material.backFaceCulling).toBe(false)

    mat.dispose()
  })
})

// ---------------------------------------------------------------------------
// Tests: ChronoVortexRenderable
// ---------------------------------------------------------------------------

describe('ChronoVortexRenderable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shaderMaterials.length = 0
    meshes.length = 0
  })
  it('should have static None as empty array', () => {
    expect(ChronoVortexRenderable.None).toEqual([])
  })

  it('should store pos, frame', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    expect(renderable.pos.equals(pos)).toBe(true)
  })

  it('should reject frame out of range [0, 47]', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    expect(() => new ChronoVortexRenderable(renderer, pos, -1)).toThrow(RangeError)
    expect(() => new ChronoVortexRenderable(renderer, pos, 48)).toThrow(RangeError)
  })

  it('should accept frame in range [0, 47]', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    expect(() => new ChronoVortexRenderable(renderer, pos, 0)).not.toThrow()
    expect(() => new ChronoVortexRenderable(renderer, pos, 47)).not.toThrow()
  })

  it('should have zOffset = 0 and isDecoration = false', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    expect(renderable.zOffset).toBe(0)
    expect(renderable.isDecoration).toBe(false)
  })

  it('should delegate render to ChronoVortexRenderer in 2D fallback mode', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const renderable = new ChronoVortexRenderable(renderer, pos, 24)
    const wr = makeWorldRenderer()

    renderable.render(wr)
    expect(renderer.drawVortex).toHaveBeenCalledWith(
      { x: 100, y: 200, z: 0 },
      24,
    )
  })

  it('should create Billboard in 3D mode', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const scene = makeMockScene()
    const renderable = new ChronoVortexRenderable(renderer, pos, 0, scene)
    const wr = makeWorldRenderer()

    expect(renderable.billboard).toBeNull()
    expect(renderable.shaderMaterial).toBeNull()

    renderable.render(wr)

    // Billboard should be created
    expect(renderable.billboard).not.toBeNull()
    expect(renderable.shaderMaterial).not.toBeNull()
    expect(mockMeshBuilderCreatePlane).toHaveBeenCalled()
  })

  it('should position Billboard at correct world coordinates', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const scene = makeMockScene()
    const renderable = new ChronoVortexRenderable(renderer, pos, 0, scene)
    const wr = makeWorldRenderer()

    renderable.render(wr)

    const bb = renderable.billboard!
    expect(bb.position.x).toBe(100)
    expect(bb.position.y).toBe(200)
    expect(bb.position.z).toBe(0)
  })

  it('should set Billboard to face camera (BILLBOARDMODE_ALL)', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const scene = makeMockScene()
    const renderable = new ChronoVortexRenderable(renderer, pos, 0, scene)
    const wr = makeWorldRenderer()

    renderable.render(wr)

    expect(renderable.billboard!.billboardMode).toBe(Mesh.BILLBOARDMODE_ALL)
  })

  it('should update progress uniform on each render in 3D mode', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const scene = makeMockScene()
    const frame = 24
    const renderable = new ChronoVortexRenderable(renderer, pos, frame, scene)
    const wr = makeWorldRenderer()

    renderable.render(wr)

    const sm = renderable.shaderMaterial!
    // Progress should be frame / 47
    expect(sm.progress).toBeCloseTo(frame / 47, 2)
  })

  it('should compute screen bounds that are non-negative', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    const wr = makeWorldRenderer()

    const bounds = renderable.screenBounds(wr)
    expect(bounds.width).toBeGreaterThanOrEqual(0)
    expect(bounds.height).toBeGreaterThanOrEqual(0)
  })

  it('should prepareRender returning itself', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    const wr = makeWorldRenderer()
    expect(renderable.prepareRender(wr)).toBe(renderable)
  })

  it('withZOffset, offsetBy, asDecoration return self (immutable)', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    expect(renderable.withZOffset(5)).toBe(renderable)
    expect(renderable.offsetBy({ x: 1, y: 1, z: 0 } as any)).toBe(renderable)
    expect(renderable.asDecoration()).toBe(renderable)
  })

  it('should not throw on renderDebugGeometry', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    const wr = makeWorldRenderer()
    expect(() => renderable.renderDebugGeometry(wr)).not.toThrow()
  })

  it('should dispose billboard and shader material', () => {
    const renderer = makeRenderer()
    const pos = new WPos(100, 200, 0)
    const scene = makeMockScene()
    const renderable = new ChronoVortexRenderable(renderer, pos, 0, scene)
    const wr = makeWorldRenderer()

    renderable.render(wr)

    const bb = renderable.billboard!

    renderable.dispose()

    expect(bb.dispose).toHaveBeenCalled()  // billboard disposed
    expect(renderable.billboard).toBeNull()

    // ShaderMaterial's dispose is called via ChronoVortexShaderMaterial.dispose()
    expect(mockSMDispose).toHaveBeenCalled()
    expect(renderable.shaderMaterial).toBeNull()
  })

  it('should be no-op to dispose when not in 3D mode', () => {
    const renderer = makeRenderer()
    const pos = WPos.Zero
    const renderable = new ChronoVortexRenderable(renderer, pos, 0)
    expect(() => renderable.dispose()).not.toThrow()
  })
})
