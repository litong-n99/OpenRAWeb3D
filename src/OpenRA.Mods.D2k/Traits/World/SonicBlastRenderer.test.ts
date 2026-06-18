/**
 * SonicBlastRenderer.test.ts — SonicBlastRenderer migration unit tests
 *
 * Tests focus on: renderer lifecycle (create → draw → update → dispose),
 * 3D blast creation, ring radius advancement, completion cleanup,
 * 2D fallback position collection, postProcessType, enabled state,
 * max concurrent blast limit.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Scene: vi.fn(),
  ShaderMaterial: vi.fn(),
  MeshBuilder: {
    CreateDisc: vi.fn(),
    CreatePlane: vi.fn(),
    CreateLines: vi.fn(),
  },
  Effect: {
    ShadersStore: {},
  },
  Color3: vi.fn(function (this: any, r: number, g: number, b: number) {
    this.r = r; this.g = g; this.b = b
  }),
  Vector3: vi.fn(function (this: any, x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }),
  Mesh: {
    BILLBOARDMODE_ALL: 7,
    BILLBOARDMODE_NONE: 0,
  },
}))

// ---------------------------------------------------------------------------
// Imports (after vi.mock)
// ---------------------------------------------------------------------------

import {
  SonicBlastRenderer,
  SonicBlastRendererInfo,
  type Float3,
} from './SonicBlastRenderer.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { SonicBlastRenderable } from '../../Graphics/SonicBlastRenderable.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 1,
    owner: { playerId: 0, playerName: 'Test' },
    world: {} as unknown as IGameActor['world'],
    centerPosition: { X: 0, Y: 0, Z: 0 },
  } as unknown as IGameActor
}

function createMockScene(): import('@babylonjs/core').Scene {
  return {} as unknown as import('@babylonjs/core').Scene
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SonicBlastRenderer', () => {
  describe('SonicBlastRendererInfo', () => {
    it('has defaults', () => {
      const info = new SonicBlastRendererInfo()
      expect(info.size).toBe(16)
      expect(info.zoom).toBe(2.5)
      expect(info.maxBlasts).toBe(20)
    })

    it('accepts custom config', () => {
      const info = new SonicBlastRendererInfo({ size: 32, zoom: 1.5, maxBlasts: 10 })
      expect(info.size).toBe(32)
      expect(info.zoom).toBe(1.5)
      expect(info.maxBlasts).toBe(10)
    })

    it('creates renderer instance', () => {
      const info = new SonicBlastRendererInfo()
      const r = info.create()
      expect(r).toBeInstanceOf(SonicBlastRenderer)
      expect(r.info).toBe(info)
    })
  })

  // ---------------------------------------------------------------------------
  // 2D fallback tests (no scene)
  // ---------------------------------------------------------------------------

  describe('2D fallback (no scene)', () => {
    it('collects positions in draw()', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)

      r.draw({ x: 100, y: 200, z: 0 })
      r.draw({ x: 300, y: 400, z: 0 })

      expect(r.positionCount).toBe(2)
      expect(r.activeBlastCount).toBe(0)
    })

    it('ignores draw after dispose', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      const actor = createMockActor()

      r.draw({ x: 1, y: 2, z: 3 })
      expect(r.positionCount).toBe(1)

      r.disposing(actor)
      expect(r.positionCount).toBe(0)

      r.draw({ x: 4, y: 5, z: 6 })
      expect(r.positionCount).toBe(0)
    })

    it('drawPass clears positions', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      r.draw({ x: 10, y: 20, z: 0 })
      r.draw({ x: 30, y: 40, z: 0 })

      expect(r.positionCount).toBe(2)
      r.drawPass()
      expect(r.positionCount).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // 3D tests (with scene)
  // ---------------------------------------------------------------------------

  describe('3D mode (with scene)', () => {
    it('creates a SonicBlastRenderable on draw()', () => {
      const info = new SonicBlastRendererInfo({ size: 16 })
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)

      r.draw({ x: 100, y: 200, z: 0 })

      expect(r.activeBlastCount).toBe(1)
      expect(r.positionCount).toBe(0)
      expect(r.activeBlasts[0]).toBeInstanceOf(SonicBlastRenderable)
    })

    it('creates blast with correct maxRadius from info.size', () => {
      const info = new SonicBlastRendererInfo({ size: 10 })
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)

      r.draw({ x: 0, y: 0, z: 0 })

      expect(r.activeBlasts[0].maxRadius).toBe(info.size * 15) // 150
    })

    it('creates blast at correct world position', () => {
      const info = new SonicBlastRendererInfo()
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)

      r.draw({ x: 1234, y: 5678, z: 0 })

      const blast = r.activeBlasts[0]
      expect(blast.pos.X).toBe(1234)
      expect(blast.pos.Y).toBe(5678)
    })

    it('update() advances ring radius for all active blasts', () => {
      const info = new SonicBlastRendererInfo({ size: 16, zoom: 2.0 })
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)

      r.draw({ x: 0, y: 0, z: 0 })
      r.draw({ x: 100, y: 100, z: 0 })

      expect(r.activeBlastCount).toBe(2)

      const initialRadius0 = r.activeBlasts[0].radius
      const initialRadius1 = r.activeBlasts[1].radius

      r.update()

      expect(r.activeBlasts[0].radius).toBeGreaterThan(initialRadius0)
      expect(r.activeBlasts[1].radius).toBeGreaterThan(initialRadius1)
    })

    it('update() removes completed blasts', () => {
      const info = new SonicBlastRendererInfo({ size: 16 })
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)

      r.draw({ x: 0, y: 0, z: 0 })
      expect(r.activeBlastCount).toBe(1)

      // Manually set the blast to complete by ticking past maxRadius
      const blast = r.activeBlasts[0]
      const maxR = blast.maxRadius
      const stepsNeeded = Math.ceil(maxR / (info.zoom * 2)) + 1

      for (let i = 0; i < stepsNeeded; i++) {
        r.update()
        if (r.activeBlastCount === 0) break
      }

      expect(r.activeBlastCount).toBe(0)
    })

    it('enforces max concurrent blasts limit', () => {
      const info = new SonicBlastRendererInfo({ size: 16, maxBlasts: 3 })
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)

      // Create 5 blasts — only 3 should remain (oldest disposed)
      r.draw({ x: 10, y: 10, z: 0 })
      r.draw({ x: 20, y: 20, z: 0 })
      r.draw({ x: 30, y: 30, z: 0 })
      r.draw({ x: 40, y: 40, z: 0 })
      r.draw({ x: 50, y: 50, z: 0 })

      expect(r.activeBlastCount).toBeLessThanOrEqual(3)
    })

    it('disposing cleans up all active blasts', () => {
      const info = new SonicBlastRendererInfo()
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)
      const actor = createMockActor()

      r.draw({ x: 0, y: 0, z: 0 })
      r.draw({ x: 10, y: 10, z: 0 })

      expect(r.activeBlastCount).toBe(2)

      r.disposing(actor)

      expect(r.activeBlastCount).toBe(0)
      expect(r.isDisposed).toBe(true)
    })

    it('is idempotent on dispose', () => {
      const info = new SonicBlastRendererInfo()
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)
      const actor = createMockActor()

      r.draw({ x: 0, y: 0, z: 0 })

      r.disposing(actor)
      r.disposing(actor)

      expect(r.isDisposed).toBe(true)
      expect(r.activeBlastCount).toBe(0)
    })

    it('update is no-op when no scene', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)

      r.draw({ x: 1, y: 2, z: 3 })
      expect(r.positionCount).toBe(1)

      r.update()
      // Position count unchanged (2D mode, update is no-op)
      expect(r.positionCount).toBe(1)
    })

    it('drawPass is no-op in 3D mode', () => {
      const info = new SonicBlastRendererInfo()
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)

      r.draw({ x: 1, y: 2, z: 3 })
      expect(r.activeBlastCount).toBe(1)

      r.drawPass()
      // Blasts remain (3D meshes render automatically)
      expect(r.activeBlastCount).toBe(1)
    })

    it('multiple concurrent blasts have independent radii', () => {
      const info = new SonicBlastRendererInfo({ size: 16 })
      const scene = createMockScene()
      const r = new SonicBlastRenderer(info, scene)

      r.draw({ x: 0, y: 0, z: 0 })
      r.draw({ x: 100, y: 0, z: 0 })

      r.update()
      r.update()
      r.update()

      // Both blasts should have advanced by 3 ticks
      expect(r.activeBlastCount).toBe(2)
      expect(r.activeBlasts[0].radius).toBeGreaterThan(0)
      expect(r.activeBlasts[1].radius).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Common tests (both modes)
  // ---------------------------------------------------------------------------

  describe('postProcessType', () => {
    it('returns AfterWorld', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      expect(r.postProcessType).toBe('AfterWorld')
    })
  })

  describe('enabled', () => {
    it('is true when positions/blasts exist', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      r.draw({ x: 0, y: 0, z: 0 })
      expect(r.enabled).toBe(true)
    })

    it('is false when no positions/blasts', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      expect(r.enabled).toBe(false)
    })

    it('is false when disposed', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      const actor = createMockActor()
      r.draw({ x: 0, y: 0, z: 0 })
      r.disposing(actor)
      expect(r.enabled).toBe(false)
    })
  })

  describe('Float3', () => {
    it('position type has x, y, z', () => {
      const pos: Float3 = { x: 1, y: 2, z: 3 }
      expect(pos.x).toBe(1)
      expect(pos.y).toBe(2)
      expect(pos.z).toBe(3)
    })
  })
})
