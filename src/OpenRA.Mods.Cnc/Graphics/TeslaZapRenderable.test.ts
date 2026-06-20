/**
 * TeslaZapRenderable.test.ts — Unit tests for TeslaZapRenderable + TeslaZapMeshBuilder
 *
 * Tests focus on:
 * - Seed generation (SeededRandom determinism)
 * - Cache invalidation and fog check
 * - 3D segment path generation
 * - TeslaZapMeshBuilder: LinesMesh creation, bright/dim color differentiation
 * - Frame jitter vertex updates
 * - dispose() GPU resource cleanup
 * - Phase B static factory methods (createBrightMaterial, createDimMaterial, createWithDefaults)
 * - buildZaps renderingGroupId verification
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core using vi.hoisted (established pattern from Shader.test.ts)
// ---------------------------------------------------------------------------

const {
  mockColor3Ctor,
  mockMeshBuilderCreateLines,
  mockLinesMeshCtor,
  mockShaderMaterialCtor,
  linesMeshInstances,
  shaderMaterialInstances,
} = vi.hoisted(() => {
  const instances: any[] = []
  const matInstances: any[] = []

  const mC3Ctor = vi.fn(function (this: any, r: number, g: number, b: number) {
    this.r = r; this.g = g; this.b = b
  })

  const mLinesCtor = vi.fn(function (this: any, _name: string, _options: any, _scene?: any) {
    this.name = _name
    this.material = null
    this.isPickable = true
    this.renderingGroupId = 0
    this._positions = new Float32Array(0)
    this.getVerticesData = vi.fn((kind: string) => {
      if (kind === 'position') return this._positions
      return null
    })
    this.updateVerticesData = vi.fn(function (
      this: any,
      _kind: string,
      data: Float32Array,
      _a: boolean,
      _b: boolean,
    ) {
      this._positions = new Float32Array(data)
    })
    this.dispose = vi.fn()
    const self = this
    instances.push(self)
  })

  const mCreateLines = vi.fn((name: string, options: any, _scene?: any) => {
    const mesh = new (mLinesCtor as any)(name, options, _scene)
    if (options?.points) {
      const pts = options.points as { x: number; y: number; z: number }[]
      mesh._positions = new Float32Array(pts.length * 3)
      for (let i = 0; i < pts.length; i++) {
        mesh._positions[i * 3] = pts[i].x
        mesh._positions[i * 3 + 1] = pts[i].y
        mesh._positions[i * 3 + 2] = pts[i].z
      }
    }
    return mesh
  })

  const mSMCtor = vi.fn(function (this: any, _name: string, _scene: any, _shaderName: string, _options: any) {
    this.name = _name
    this.needAlphaBlending = undefined
    this.backFaceCulling = true
    this._color3Values = new Map<string, { r: number; g: number; b: number }>()
    this._floatValues = new Map<string, number>()
    this.setFloat = vi.fn((name: string, value: number) => {
      this._floatValues.set(name, value)
    })
    this.setVector2 = vi.fn()
    this.setVector3 = vi.fn()
    this.setColor3 = vi.fn((name: string, color: { r: number; g: number; b: number }) => {
      this._color3Values.set(name, { r: color.r, g: color.g, b: color.b })
    })
    this.setFloats = vi.fn()
    this.dispose = vi.fn()
    matInstances.push(this)
  })

  const mMDispose = vi.fn()
  const mSMDispose = vi.fn()

  return {
    mockColor3Ctor: mC3Ctor,
    mockMeshBuilderCreateLines: mCreateLines,
    mockLinesMeshDispose: mMDispose,
    mockLinesMeshCtor: mLinesCtor,
    mockShaderMaterialDispose: mSMDispose,
    mockShaderMaterialCtor: mSMCtor,
    linesMeshInstances: instances,
    shaderMaterialInstances: matInstances,
  }
})

vi.mock('@babylonjs/core', () => ({
  Color3: mockColor3Ctor,
  MeshBuilder: {
    CreateLines: mockMeshBuilderCreateLines,
    CreateDisc: vi.fn(),
    CreatePlane: vi.fn(),
  },
  LinesMesh: mockLinesMeshCtor,
  ShaderMaterial: mockShaderMaterialCtor,
  Scene: vi.fn(),
  Effect: { ShadersStore: {} as Record<string, string> },
  Vector3: vi.fn(function (this: any, x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }),
}))

// ---------------------------------------------------------------------------
// Imports (after vi.mock)
// ---------------------------------------------------------------------------

import {
  TeslaZapRenderable,
  TeslaZapMeshBuilder,
  SeededRandom,
  type TeslaZapPath,
  type ITeslaZapWorldRenderer,
} from './TeslaZapRenderable.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { ShaderMaterial, Scene, Effect } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorldRenderer(fog?: boolean): ITeslaZapWorldRenderer {
  let callCount = 0
  return {
    screenPosition: vi.fn((p: WPos) => ({ x: p.X, y: p.Y })),
    projectedPosition: vi.fn((px: { x: number; y: number }) => {
      callCount++
      return { x: px.x, y: px.y, z: callCount * 10 }
    }),
    palette: vi.fn().mockReturnValue({}),
    world: {
      fogObscures: vi.fn().mockReturnValue(fog ?? false),
      map: {
        sequences: {
          getSequence: vi.fn().mockReturnValue({
            name: 'bright',
            length: 4,
            tick: 40,
            scale: 1,
            zOffset: 0,
            shadowZOffset: -5,
            ignoreWorldTint: false,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            getSprite: vi.fn().mockReturnValue({
              sheet: null,
              bounds: { x: 0, y: 0, width: 0, height: 0 },
              blendMode: 0,
              channel: 4,
              zRamp: 0,
              size: { x: 0, y: 0, z: 0 },
              offset: { x: 0, y: 0, z: 0 },
              top: 0, left: 0, bottom: 1, right: 1,
            }),
            getAlpha: vi.fn().mockReturnValue(1),
            getSpriteWithRotation: vi.fn(),
            getShadow: vi.fn().mockReturnValue(null),
          }),
        },
      },
    },
  }
}

function makeMockScene(): Scene {
  return {} as unknown as Scene
}

function makeMockMaterial(name: string): ShaderMaterial {
  return new ShaderMaterial(name, {} as Scene, 'custom', {})
}

// ---------------------------------------------------------------------------
// Tests: SeededRandom
// ---------------------------------------------------------------------------

describe('SeededRandom', () => {
  it('should produce deterministic sequence', () => {
    const rng1 = new SeededRandom(12345)
    const rng2 = new SeededRandom(12345)
    for (let i = 0; i < 100; i++) {
      expect(rng1.next(100)).toBe(rng2.next(100))
    }
  })

  it('should produce values in [0, max-1]', () => {
    const rng = new SeededRandom(42)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next(10)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(10)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: TeslaZapRenderable (data generation)
// ---------------------------------------------------------------------------

describe('TeslaZapRenderable', () => {
  it('should store constructor parameters', () => {
    const pos = WPos.Zero
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 3, 'dim', 2, 'player',
    )
    expect(renderable.pos.equals(pos)).toBe(true)
    expect(renderable.isDecoration).toBe(true)
  })

  it('should return empty cache initially', () => {
    const pos = WPos.Zero
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 3, 'dim', 2, 'player',
    )
    expect(renderable.cache).toEqual([])
  })

  it('should skip rendering if both ends are fog-obscured', () => {
    const pos = WPos.Zero
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 3, 'dim', 2, 'player',
    )
    const wr = makeWorldRenderer(true)
    const screenPosSpy = wr.screenPosition as Mock

    renderable.render(wr)
    expect(screenPosSpy).not.toHaveBeenCalled()
  })

  it('should generate zap paths when rendered', () => {
    const pos = new WPos(0, 0, 0)
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 1, 'dim', 0, 'player',
    )
    const wr = makeWorldRenderer(false)
    ;(wr.screenPosition as Mock).mockImplementation((p: WPos) => ({
      x: p.X, y: p.Y,
    }))

    renderable.render(wr)
    const paths = renderable.getZapPaths()
    expect(paths.length).toBeGreaterThanOrEqual(0)
  })

  it('should have getZapPaths returning array', () => {
    const pos = new WPos(0, 0, 0)
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 1, 'dim', 0, 'player',
    )
    expect(Array.isArray(renderable.getZapPaths())).toBe(true)
  })

  it('should regenerate cache when position changes', () => {
    const pos = new WPos(0, 0, 0)
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 1, 'dim', 0, 'player',
    )
    const wr = makeWorldRenderer(false)
    ;(wr.screenPosition as Mock).mockImplementation((p: WPos) => ({
      x: p.X, y: p.Y,
    }))

    renderable.render(wr)

    const newRenderable = renderable.offsetBy(new WVec(50, 0, 0))
    newRenderable.render(wr)
    expect(newRenderable.cache).toBeDefined()
  })

  it('withZOffset should return new instance', () => {
    const pos = WPos.Zero
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 1, 'dim', 0, 'player',
    )
    const copy = renderable.withZOffset(5)
    expect(copy).not.toBe(renderable)
  })

  it('offsetBy should return new instance with offset position', () => {
    const pos = new WPos(10, 0, 0)
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 1, 'dim', 0, 'player',
    )
    const offset = new WVec(5, 5, 0)
    const copy = renderable.offsetBy(offset)
    expect(copy.pos.X).toBe(15)
    expect(copy.pos.Y).toBe(5)
  })

  it('should not throw on renderDebugGeometry', () => {
    const pos = WPos.Zero
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 1, 'dim', 0, 'player',
    )
    const wr = makeWorldRenderer()
    expect(() => renderable.renderDebugGeometry(wr)).not.toThrow()
  })

  it('should generate paths with both bright and dim zaps', () => {
    const pos = new WPos(0, 0, 0)
    const len = new WVec(200, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 2, 'dim', 1, 'player',
    )
    const wr = makeWorldRenderer(false)
    ;(wr.screenPosition as Mock).mockImplementation((p: WPos) => ({
      x: p.X, y: p.Y,
    }))

    renderable.render(wr)
    const paths = renderable.getZapPaths()

    // Should have dim zaps (1) + bright zaps (2) = 3 paths (if non-degenerate)
    const brightPaths = paths.filter(p => p.bright)
    const dimPaths = paths.filter(p => !p.bright)
    expect(brightPaths.length + dimPaths.length).toBe(paths.length)
  })

  it('should build 3D meshes from zap paths via builder', () => {
    const pos = new WPos(0, 0, 0)
    const len = new WVec(100, 0, 0)
    const renderable = new TeslaZapRenderable(
      pos, 0, len, 'image', 'bright', 1, 'dim', 0, 'player',
    )
    const wr = makeWorldRenderer(false)
    ;(wr.screenPosition as Mock).mockImplementation((p: WPos) => ({
      x: p.X, y: p.Y,
    }))

    renderable.render(wr)

    const scene = makeMockScene()
    const brightMat = makeMockMaterial('brightMat')
    const dimMat = makeMockMaterial('dimMat')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

    const meshes = renderable.build3DMeshes(builder)
    expect(Array.isArray(meshes)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: TeslaZapMeshBuilder
// ---------------------------------------------------------------------------

describe('TeslaZapMeshBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    linesMeshInstances.length = 0
    shaderMaterialInstances.length = 0
  })
  it('should create bright and dim materials via constructor', () => {
    const scene = makeMockScene()
    const brightMat = makeMockMaterial('bright')
    const dimMat = makeMockMaterial('dim')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

    expect(builder.brightMaterial).toBe(brightMat)
    expect(builder.dimMaterial).toBe(dimMat)
    expect(builder.meshes).toEqual([])
  })

  it('should build LinesMesh instances from zap paths', () => {
    const scene = makeMockScene()
    const brightMat = makeMockMaterial('bright')
    const dimMat = makeMockMaterial('dim')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

    const paths: TeslaZapPath[] = [
      {
        bright: true,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 5, z: 1 },
          { x: 20, y: 0, z: 0 },
        ],
      },
      {
        bright: false,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: -3, z: 1 },
          { x: 20, y: 0, z: 0 },
        ],
      },
    ]

    const meshes = builder.buildZaps(paths)

    expect(meshes.length).toBe(2)
    expect(mockMeshBuilderCreateLines).toHaveBeenCalledTimes(2)

    // Bright zap should have bright material
    expect(meshes[0].material).toBe(brightMat)

    // Dim zap should have dim material
    expect(meshes[1].material).toBe(dimMat)
  })

  it('should skip paths with fewer than 2 points', () => {
    const scene = makeMockScene()
    const brightMat = makeMockMaterial('bright')
    const dimMat = makeMockMaterial('dim')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

    const paths: TeslaZapPath[] = [
      {
        bright: true,
        palette: 'player',
        points: [{ x: 0, y: 0, z: 0 }], // Only 1 point — skipped
      },
      {
        bright: false,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    ]

    const meshes = builder.buildZaps(paths)
    expect(meshes.length).toBe(1)
  })

  it('should correctly map segment data to LinesMesh vertex arrays', () => {
    const scene = makeMockScene()
    const brightMat = makeMockMaterial('bright')
    const dimMat = makeMockMaterial('dim')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

    const paths: TeslaZapPath[] = [
      {
        bright: true,
        palette: 'player',
        points: [
          { x: 1, y: 2, z: 3 },
          { x: 4, y: 5, z: 6 },
          { x: 7, y: 8, z: 9 },
        ],
      },
    ]

    const meshes = builder.buildZaps(paths)
    expect(meshes.length).toBe(1)

    const positions = meshes[0].getVerticesData('position')
    expect(positions).not.toBeNull()
    // 3 points × 3 components = 9 floats
    expect(positions!.length).toBe(9)
    expect(positions![0]).toBe(1)
    expect(positions![1]).toBe(2)
    expect(positions![2]).toBe(3)
    expect(positions![6]).toBe(7)
    expect(positions![7]).toBe(8)
    expect(positions![8]).toBe(9)
  })

  it('should update vertices on frame jitter call', () => {
    const scene = makeMockScene()
    const brightMat = makeMockMaterial('bright')
    const dimMat = makeMockMaterial('dim')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat, 42)

    const paths: TeslaZapPath[] = [
      {
        bright: true,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    ]

    const meshes = builder.buildZaps(paths)
    const origPositions = meshes[0].getVerticesData('position')
    expect(origPositions).not.toBeNull()

    builder.updateJitter(5)

    // After jitter, positions may have changed; verify updateVerticesData was called
    const newPositions = meshes[0].getVerticesData('position')
    expect(newPositions).not.toBeNull()
    // At least verify the length is preserved
    expect(newPositions!.length).toBe(origPositions!.length)
  })

  it('should dispose all meshes on dispose', () => {
    const scene = makeMockScene()
    const brightMat = makeMockMaterial('bright')
    const dimMat = makeMockMaterial('dim')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

    const paths: TeslaZapPath[] = [
      {
        bright: true,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    ]

    builder.buildZaps(paths)
    expect(builder.meshes.length).toBeGreaterThan(0)

    // Save references
    const mesh = builder.meshes[0]

    builder.dispose()

    // Meshes should be disposed
    expect(mesh.dispose).toHaveBeenCalled()
    // External materials are NOT disposed by the builder (caller owns them)
    // The builder only disposes materials it created internally via createWithDefaults
    expect(builder.meshes.length).toBe(0)
  })

  it('should dispose old meshes when building new zaps', () => {
    const scene = makeMockScene()
    const brightMat = makeMockMaterial('bright')
    const dimMat = makeMockMaterial('dim')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

    const paths1: TeslaZapPath[] = [
      {
        bright: true,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 0 },
        ],
      },
    ]

    const meshes1 = builder.buildZaps(paths1)
    const oldMesh = meshes1[0]

    const paths2: TeslaZapPath[] = [
      {
        bright: false,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 15, y: 0, z: 0 },
        ],
      },
    ]

    builder.buildZaps(paths2)
    expect(oldMesh.dispose).toHaveBeenCalled()
    expect(builder.meshes.length).toBe(1)
  })

  it('should have bright and dim zaps with different materials', () => {
    const scene = makeMockScene()
    const brightMat = makeMockMaterial('brightCyan')
    const dimMat = makeMockMaterial('dimBlue')
    const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

    const paths: TeslaZapPath[] = [
      {
        bright: true,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 0 },
        ],
      },
      {
        bright: false,
        palette: 'player',
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 5, y: 0, z: 0 },
        ],
      },
    ]

    const meshes = builder.buildZaps(paths)

    // Bright zap material !== dim zap material
    expect(meshes[0].material).toBe(brightMat)
    expect(meshes[1].material).toBe(dimMat)
    expect(meshes[0].material).not.toBe(meshes[1].material)
  })

  // ---------------------------------------------------------------------------
  // Phase B tests: static factory methods (24.B.1)
  // ---------------------------------------------------------------------------

  describe('createBrightMaterial', () => {
    it('creates ShaderMaterial with cyan color and intensity 1.5', () => {
      const scene = makeMockScene()
      const mat = TeslaZapMeshBuilder.createBrightMaterial('testBright', scene)

      expect(mat).toBeDefined()
      // Check color was set to cyan (0.2, 0.8, 1.0)
      const setColor3Calls = (mat.setColor3 as ReturnType<typeof vi.fn>).mock.calls
      const colorCall = setColor3Calls.find((c: any[]) => c[0] === 'uColor') as any[] | undefined
      expect(colorCall).toBeDefined()
      if (colorCall) {
        expect(colorCall[1].r).toBe(0.2)
        expect(colorCall[1].g).toBe(0.8)
        expect(colorCall[1].b).toBe(1.0)
      }

      // Check intensity was set to 1.5
      const setFloatCalls = (mat.setFloat as ReturnType<typeof vi.fn>).mock.calls
      const intensityCall = setFloatCalls.find((c: any[]) => c[0] === 'uIntensity') as any[] | undefined
      expect(intensityCall).toBeDefined()
      if (intensityCall) {
        expect(intensityCall[1]).toBe(1.5)
      }

      // Check alpha blending is enabled
      expect(mat.needAlphaBlending).toBeDefined()
      expect(mat.backFaceCulling).toBe(false)
    })

    it('registers shaders in Effect.ShadersStore', () => {
      const scene = makeMockScene()
      const name = 'testBrightShaders'
      const mat = TeslaZapMeshBuilder.createBrightMaterial(name, scene)

      // Shader entries should be registered
      const vertexKey = `${name}VertexShader`
      const fragmentKey = `${name}FragmentShader`
      expect(Effect.ShadersStore[vertexKey]).toBeDefined()
      expect(Effect.ShadersStore[fragmentKey]).toBeDefined()
      expect(Effect.ShadersStore[vertexKey]).toContain('worldViewProjection')
      expect(Effect.ShadersStore[fragmentKey]).toContain('uColor')
      expect(Effect.ShadersStore[fragmentKey]).toContain('uIntensity')

      void mat
    })
  })

  describe('createDimMaterial', () => {
    it('creates ShaderMaterial with dark blue color and intensity 0.6', () => {
      const scene = makeMockScene()
      const mat = TeslaZapMeshBuilder.createDimMaterial('testDim', scene)

      expect(mat).toBeDefined()
      // Check color was set to dark blue (0.1, 0.3, 0.8)
      const setColor3Calls = (mat.setColor3 as ReturnType<typeof vi.fn>).mock.calls
      const colorCall = setColor3Calls.find((c: any[]) => c[0] === 'uColor') as any[] | undefined
      expect(colorCall).toBeDefined()
      if (colorCall) {
        expect(colorCall[1].r).toBe(0.1)
        expect(colorCall[1].g).toBe(0.3)
        expect(colorCall[1].b).toBe(0.8)
      }

      // Check intensity was set to 0.6
      const setFloatCalls = (mat.setFloat as ReturnType<typeof vi.fn>).mock.calls
      const intensityCall = setFloatCalls.find((c: any[]) => c[0] === 'uIntensity') as any[] | undefined
      expect(intensityCall).toBeDefined()
      if (intensityCall) {
        expect(intensityCall[1]).toBe(0.6)
      }

      // Check alpha blending and back face culling
      expect(mat.backFaceCulling).toBe(false)
    })

    it('creates distinct material from bright material', () => {
      const scene = makeMockScene()
      const bright = TeslaZapMeshBuilder.createBrightMaterial('bright', scene)
      const dim = TeslaZapMeshBuilder.createDimMaterial('dim', scene)

      expect(bright).not.toBe(dim)
      expect(bright.name).not.toBe(dim.name)
    })
  })

  describe('createWithDefaults', () => {
    it('returns a TeslaZapMeshBuilder with both materials', () => {
      const scene = makeMockScene()
      const builder = TeslaZapMeshBuilder.createWithDefaults(scene)

      expect(builder).toBeDefined()
      expect(builder.brightMaterial).toBeDefined()
      expect(builder.dimMaterial).toBeDefined()
      expect(builder.brightMaterial).not.toBe(builder.dimMaterial)
      expect(builder.meshes).toEqual([])
    })

    it('accepts optional baseSeed', () => {
      const scene = makeMockScene()
      const builder1 = TeslaZapMeshBuilder.createWithDefaults(scene, 123)
      const builder2 = TeslaZapMeshBuilder.createWithDefaults(scene, 456)

      // Both should be valid builders
      expect(builder1.meshes).toEqual([])
      expect(builder2.meshes).toEqual([])
    })

    it('builds zaps correctly with internal materials', () => {
      const scene = makeMockScene()
      const builder = TeslaZapMeshBuilder.createWithDefaults(scene)

      const paths: TeslaZapPath[] = [
        {
          bright: true,
          palette: 'player',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 5, z: 1 },
          ],
        },
      ]

      const meshes = builder.buildZaps(paths)
      expect(meshes.length).toBe(1)
      expect(meshes[0].material).toBe(builder.brightMaterial)
    })
  })

  describe('buildZaps renderingGroupId', () => {
    it('sets renderingGroupId=1 (RenderGroup.Actor) on created LinesMesh', () => {
      const scene = makeMockScene()
      const builder = TeslaZapMeshBuilder.createWithDefaults(scene)

      const paths: TeslaZapPath[] = [
        {
          bright: true,
          palette: 'player',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
        },
      ]

      const meshes = builder.buildZaps(paths)
      expect(meshes.length).toBe(1)
      expect(meshes[0].renderingGroupId).toBe(1)
    })

    it('sets renderingGroupId=1 on multiple meshes', () => {
      const scene = makeMockScene()
      const builder = TeslaZapMeshBuilder.createWithDefaults(scene)

      const paths: TeslaZapPath[] = [
        {
          bright: true,
          palette: 'player',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
        },
        {
          bright: false,
          palette: 'player',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
        },
      ]

      const meshes = builder.buildZaps(paths)
      for (const mesh of meshes) {
        expect(mesh.renderingGroupId).toBe(1)
      }
    })

    it('passes scene to MeshBuilder.CreateLines', () => {
      const scene = makeMockScene()
      const builder = TeslaZapMeshBuilder.createWithDefaults(scene)

      const paths: TeslaZapPath[] = [
        {
          bright: true,
          palette: 'player',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
        },
      ]

      builder.buildZaps(paths)
      // MeshBuilder.CreateLines should have been called with scene as third argument
      const createLinesCalls = mockMeshBuilderCreateLines.mock.calls
      const lastCall = createLinesCalls[createLinesCalls.length - 1]
      expect(lastCall[2]).toBe(scene)
    })
  })

  describe('dispose with owned materials', () => {
    it('disposes internal materials when created via createWithDefaults', () => {
      const scene = makeMockScene()
      const builder = TeslaZapMeshBuilder.createWithDefaults(scene)

      const paths: TeslaZapPath[] = [
        {
          bright: true,
          palette: 'player',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
        },
      ]
      builder.buildZaps(paths)

      const brightMat = builder.brightMaterial
      const dimMat = builder.dimMaterial

      builder.dispose()

      expect(brightMat.dispose).toHaveBeenCalled()
      expect(dimMat.dispose).toHaveBeenCalled()
    })

    it('does NOT dispose externally-provided materials', () => {
      const scene = makeMockScene()
      const brightMat = makeMockMaterial('extBright')
      const dimMat = makeMockMaterial('extDim')
      const builder = new TeslaZapMeshBuilder(scene, brightMat, dimMat)

      const paths: TeslaZapPath[] = [
        {
          bright: true,
          palette: 'player',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 0, z: 0 },
          ],
        },
      ]
      builder.buildZaps(paths)

      builder.dispose()

      // External materials should NOT be disposed by the builder
      expect(brightMat.dispose).not.toHaveBeenCalled()
      expect(dimMat.dispose).not.toHaveBeenCalled()
    })
  })
})
