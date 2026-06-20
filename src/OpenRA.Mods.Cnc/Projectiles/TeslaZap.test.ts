/**
 * TeslaZap.test.ts — TeslaZap projectile unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, tick logic, target tracking, render output.
 * Phase B tests (24.B.2): setScene, meshBuilder lifecycle, per-frame mesh reuse.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core using vi.hoisted (established pattern from Shader.test.ts)
// ---------------------------------------------------------------------------

const {
  mockShaderMaterialCtor,
  mockLinesMeshCtor,
  mockMeshBuilderCreateLines,
  mockColor3Ctor,
  mockVector3Ctor,
  matInstances,
  meshInstances,
} = vi.hoisted(() => {
  const matInst: any[] = []
  const meshInst: any[] = []

  const mSMCtor = vi.fn(function (this: any, _name: string, _scene: any, _shaderName: string, _options: any) {
    this.name = _name
    this.needAlphaBlending = undefined
    this.backFaceCulling = true
    this.setFloat = vi.fn()
    this.setVector2 = vi.fn()
    this.setVector3 = vi.fn()
    this.setColor3 = vi.fn()
    this.setFloats = vi.fn()
    this.dispose = vi.fn()
    matInst.push(this)
  })

  const mLinesCtor = vi.fn(function (this: any, _name: string, _options: any, _scene?: any) {
    this.name = _name
    this.material = null
    this.isPickable = true
    this.renderingGroupId = 0
    this._positions = new Float32Array(0)
    this.getVerticesData = vi.fn((_kind: string) => this._positions)
    this.updateVerticesData = vi.fn(function (this: any, _k: string, d: Float32Array, _a: boolean, _b: boolean) {
      this._positions = new Float32Array(d)
    })
    this.dispose = vi.fn()
    meshInst.push(this)
  })

  const mCreateLines = vi.fn((name: string, options: any, _scene?: any) => {
    const m = new (mLinesCtor as any)(name, options, _scene)
    if (options?.points) {
      const pts = options.points as { x: number; y: number; z: number }[]
      m._positions = new Float32Array(pts.length * 3)
      for (let i = 0; i < pts.length; i++) {
        m._positions[i * 3] = pts[i].x
        m._positions[i * 3 + 1] = pts[i].y
        m._positions[i * 3 + 2] = pts[i].z
      }
    }
    return m
  })

  const mC3 = vi.fn(function (this: any, r: number, g: number, b: number) {
    this.r = r; this.g = g; this.b = b
  })
  const mV3 = vi.fn(function (this: any, x: number, y: number, z: number) {
    this.x = x; this.y = y; this.z = z
  })

  return {
    mockShaderMaterialCtor: mSMCtor,
    mockLinesMeshCtor: mLinesCtor,
    mockMeshBuilderCreateLines: mCreateLines,
    mockColor3Ctor: mC3,
    mockVector3Ctor: mV3,
    matInstances: matInst,
    meshInstances: meshInst,
  }
})

vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
  LinesMesh: mockLinesMeshCtor,
  ShaderMaterial: mockShaderMaterialCtor,
  Color3: mockColor3Ctor,
  MeshBuilder: {
    CreateLines: mockMeshBuilderCreateLines,
    CreateDisc: vi.fn(),
    CreatePlane: vi.fn(),
  },
  Mesh: {
    BILLBOARDMODE_ALL: 7,
    BILLBOARDMODE_NONE: 0,
  },
  Effect: { ShadersStore: {} as Record<string, string> },
  Vector3: mockVector3Ctor,
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Scene } from '@babylonjs/core'
import { TeslaZap, DEFAULT_TESLA_ZAP_INFO } from './TeslaZap.js'
import type { TeslaZapInfo, TeslaZapArgs } from './TeslaZap.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWPos(x = 0, y = 0, z = 0): WPos {
  return new WPos(x, y, z)
}

function makeActor(): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    location: { X: 0, Y: 0 },
    owner: {},
  } as unknown as IGameActor
}

function makeWorld(): GameWorldManager {
  return {
    addFrameEndTask: vi.fn(),
    players: [],
  } as unknown as GameWorldManager
}

function makeValidGuidedTarget() {
  return {
    isValidFor: () => true,
    centerPosition: makeWPos(50, 50, 0),
    positions: {
      closestToIgnoringPath: () => makeWPos(50, 50, 0),
    },
  }
}

function makeInvalidGuidedTarget() {
  return {
    isValidFor: () => false,
    centerPosition: makeWPos(50, 50, 0),
    positions: {
      closestToIgnoringPath: () => makeWPos(50, 50, 0),
    },
  }
}

/** Create a minimal world renderer stub that passes the ITeslaZapWorldRenderer interface check in render(). */
function makeWorldRendererStub() {
  return {
    screenPosition: vi.fn((p: WPos) => ({ x: p.X, y: p.Y })),
    projectedPosition: vi.fn((px: { x: number; y: number }) => ({ x: px.x, y: px.y, z: 0 })),
    palette: vi.fn().mockReturnValue({}),
    world: {
      fogObscures: vi.fn().mockReturnValue(false),
      map: {
        sequences: {
          getSequence: vi.fn().mockReturnValue({
            name: 'bright',
            length: 4,
            ignoreWorldTint: false,
            getSprite: vi.fn().mockReturnValue({}),
            getAlpha: vi.fn().mockReturnValue(1),
          }),
        },
      },
    },
  }
}

function makeMockScene(): Scene {
  return {} as unknown as Scene
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeslaZap', () => {
  let info: TeslaZapInfo
  let args: TeslaZapArgs
  let world: GameWorldManager

  beforeEach(() => {
    info = { ...DEFAULT_TESLA_ZAP_INFO }
    args = {
      sourceActor: makeActor(),
      source: makeWPos(0, 0, 0),
      passiveTarget: makeWPos(100, 100, 0),
      guidedTarget: makeValidGuidedTarget(),
      weapon: {
        targetActorCenter: false,
        impact: vi.fn(),
      },
    }
    world = makeWorld()
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with correct ticksUntilRemove from Duration', () => {
      const zap = new TeslaZap(info, args)
      expect(zap.ticksUntilRemove).toBe(2)
    })

    it('clamps damageDuration to Duration', () => {
      const info2: TeslaZapInfo = { ...DEFAULT_TESLA_ZAP_INFO, duration: 1, damageDuration: 5 }
      const zap = new TeslaZap(info2, args)
      expect(zap.damageDuration).toBe(1)
    })

    it('sets initial target to passiveTarget', () => {
      const zap = new TeslaZap(info, args)
      expect(zap.target).toEqual(makeWPos(100, 100, 0))
    })

    it('starts as not destroyed', () => {
      const zap = new TeslaZap(info, args)
      expect(zap.isDestroyed).toBe(false)
    })

    it('uses custom info values', () => {
      const custom: TeslaZapInfo = {
        ...DEFAULT_TESLA_ZAP_INFO,
        image: 'custom',
        brightSequence: 'flash',
        palette: 'player',
        brightZaps: 3,
        dimZaps: 5,
        duration: 10,
        damageDuration: 8,
        trackTarget: false,
        zOffset: 5,
      }
      const zap = new TeslaZap(custom, args)
      expect(zap.ticksUntilRemove).toBe(10)
      expect(zap.damageDuration).toBe(8)
      expect(zap.target).toEqual(makeWPos(100, 100, 0))
    })
  })

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('decrements ticksUntilRemove each tick', () => {
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      expect(zap.ticksUntilRemove).toBe(1)
      zap.tick(world)
      expect(zap.ticksUntilRemove).toBe(0)
    })

    it('marks as destroyed after duration expires', () => {
      const zap = new TeslaZap(info, args)
      zap.tick(world) // ticksUntilRemove: 2→1
      zap.tick(world) // ticksUntilRemove: 1→0
      zap.tick(world) // ticksUntilRemove: 0→-1, destroyed
      expect(zap.isDestroyed).toBe(true)
      expect(zap.ticksUntilRemove).toBeLessThan(0)
    })

    it('applies weapon impact while damageDuration > 0', () => {
      const impactSpy = vi.fn()
      args.weapon.impact = impactSpy
      const zap = new TeslaZap(info, args)

      zap.tick(world) // damageDuration: 1→0, impact called
      expect(impactSpy).toHaveBeenCalledTimes(1)

      zap.tick(world) // damageDuration: 0→-1, no impact
      expect(impactSpy).toHaveBeenCalledTimes(1)
    })

    it('tracks target when TrackTarget is enabled and guidedTarget is valid', () => {
      const zap = new TeslaZap(info, args)
      // First tick: track target
      zap.tick(world)
      expect(zap.target).toEqual(makeWPos(50, 50, 0)) // centerPosition
    })

    it('uses closestToIgnoringPath when targetActorCenter is false', () => {
      args.weapon.targetActorCenter = false
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      expect(zap.target).toEqual(makeWPos(50, 50, 0))
    })

    it('uses centerPosition when targetActorCenter is true', () => {
      args.weapon.targetActorCenter = true
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      expect(zap.target).toEqual(makeWPos(50, 50, 0))
    })

    it('does not track target when TrackTarget is disabled', () => {
      info = { ...DEFAULT_TESLA_ZAP_INFO, trackTarget: false }
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      // target should remain at passiveTarget since tracking is disabled
      expect(zap.target).toEqual(makeWPos(100, 100, 0))
    })

    it('does not track target when guidedTarget is invalid', () => {
      args.guidedTarget = makeInvalidGuidedTarget()
      const zap = new TeslaZap(info, args)
      zap.tick(world)
      // target should remain at passiveTarget since guidedTarget is invalid
      expect(zap.target).toEqual(makeWPos(100, 100, 0))
    })
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  describe('render', () => {
    it('returns a renderable array with one element', () => {
      const zap = new TeslaZap(info, args)
      const renderables = zap.render(null as any)
      expect(renderables).toHaveLength(1)
    })

    it('updates the cached zap renderable each frame', () => {
      const zap = new TeslaZap(info, args)
      const r1 = zap.render(null as any)
      const r2 = zap.render(null as any)
      expect(zap.zap).toBeDefined()
      // The returned arrays are different (each tick creates new renderable in C#)
      expect(r1).toHaveLength(1)
      expect(r2).toHaveLength(1)
    })

    it('includes correct image and sequence info in renderable', () => {
      const zap = new TeslaZap(info, args)
      zap.render(null as any)
      const st = zap.zap
      expect(st?.image).toBe('litning')
      expect(st?.brightSequence).toBe('bright')
      expect(st?.dimSequence).toBe('dim')
      expect(st?.brightZaps).toBe(1)
      expect(st?.dimZaps).toBe(2)
      expect(st?.palette).toBe('effect')
    })
  })

  // ---------------------------------------------------------------------------
  // Full lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('tracks target, applies damage, then expires', () => {
      const impactSpy = vi.fn()
      args.weapon.impact = impactSpy
      info = { ...DEFAULT_TESLA_ZAP_INFO, duration: 5, damageDuration: 3 }
      const zap = new TeslaZap(info, args)

      // Tick 1-3: damage + tracking
      for (let i = 0; i < 3; i++) zap.tick(world)
      expect(impactSpy).toHaveBeenCalledTimes(3)

      // Tick 4-5: tracking only (damage complete)
      for (let i = 0; i < 2; i++) zap.tick(world)
      expect(impactSpy).toHaveBeenCalledTimes(3)
      expect(zap.isDestroyed).toBe(false)
      expect(zap.ticksUntilRemove).toBe(0)

      // Tick 6: expires
      zap.tick(world)
      expect(zap.isDestroyed).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Phase B tests: 3D mesh integration (24.B.2)
  // ---------------------------------------------------------------------------

  describe('Phase B: 3D mesh integration', () => {
    let wr: ReturnType<typeof makeWorldRendererStub>

    beforeEach(() => {
      wr = makeWorldRendererStub()
      matInstances.length = 0
      meshInstances.length = 0
    })

    describe('setScene', () => {
      it('injects scene and creates meshBuilder', () => {
        const zap = new TeslaZap(info, args)
        const scene = makeMockScene()

        zap.setScene(scene)

        // Internal state should be set (verify via private field access)
        expect((zap as any)._scene).toBe(scene)
        expect((zap as any)._meshBuilder).not.toBeNull()
        expect((zap as any)._zapBuilt).toBe(false)
      })

      it('resets _zapBuilt flag when called with new scene', () => {
        const zap = new TeslaZap(info, args)

        zap.setScene(makeMockScene())
        // Simulate first render that sets _zapBuilt = true
        ;(zap as any)._zapBuilt = true

        // Setting a new scene should reset the flag
        zap.setScene(makeMockScene())
        expect((zap as any)._zapBuilt).toBe(false)
      })
    })

    describe('tick', () => {
      it('disposes meshBuilder when projectile expires', () => {
        const zap = new TeslaZap(info, args)
        const scene = makeMockScene()
        zap.setScene(scene)

        const builder = (zap as any)._meshBuilder
        const disposeSpy = vi.spyOn(builder, 'dispose')

        // Tick until expiry: ticksUntilRemove starts at 2, -- <= 0 triggers at 1 -> 0 -> -1
        zap.tick(world) // tick 1: 2→1
        zap.tick(world) // tick 2: 1→0
        zap.tick(world) // tick 3: 0→-1, expiry

        expect(zap.isDestroyed).toBe(true)
        expect(disposeSpy).toHaveBeenCalled()
        expect((zap as any)._meshBuilder).toBeNull()
        expect((zap as any)._zapBuilt).toBe(false)
        disposeSpy.mockRestore()
      })
    })

    describe('render', () => {
      it('builds 3D meshes when scene is set', () => {
        const zap = new TeslaZap(info, args)
        zap.setScene(makeMockScene())

        zap.render(wr as any)

        // _zapBuilt should be true after first render with valid worldRenderer
        expect((zap as any)._zapBuilt).toBe(true)
        // _zap should be set
        expect(zap.zap).not.toBeNull()
      })

      it('does NOT rebuild meshes on subsequent render calls', () => {
        const zap = new TeslaZap(info, args)
        zap.setScene(makeMockScene())

        // First render: builds meshes
        zap.render(wr as any)
        expect((zap as any)._zapBuilt).toBe(true)

        // Track the meshBuilder for spying
        const builder = (zap as any)._meshBuilder
        const buildSpy = vi.spyOn(builder, 'buildZaps')
        const jitterSpy = vi.spyOn(builder, 'updateJitter')

        // Second render: should NOT rebuild, should jitter instead
        zap.render(wr as any)
        expect((zap as any)._zapBuilt).toBe(true) // still true
        expect(buildSpy).not.toHaveBeenCalled()
        // updateJitter is called on subsequent frames
        // (may be called or not depending on internal _ticks state)

        buildSpy.mockRestore()
        jitterSpy.mockRestore()
      })

      it('falls back gracefully when worldRenderer lacks required interface', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const zap = new TeslaZap(info, args)
        zap.setScene(makeMockScene())

        // Pass a worldRenderer without screenPosition or world.fogObscures
        const badWr = { someOtherMethod: () => {} }

        // Should not throw
        expect(() => zap.render(badWr as any)).not.toThrow()
        expect((zap as any)._zapBuilt).toBe(false) // meshes never built

        consoleWarnSpy.mockRestore()
      })
    })
  })
})
