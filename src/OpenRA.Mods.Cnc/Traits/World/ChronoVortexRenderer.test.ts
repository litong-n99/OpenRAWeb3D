/**
 * ChronoVortexRenderer.test.ts — ChronoVortexRenderer unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  ChronoVortexRenderer,
  ChronoVortexRendererInfo,
} from './ChronoVortexRenderer.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActor(): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    world: {},
    owner: {},
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChronoVortexRenderer', () => {
  // ---------------------------------------------------------------------------
  // ChronoVortexRendererInfo
  // ---------------------------------------------------------------------------

  describe('ChronoVortexRendererInfo', () => {
    it('creates a renderer from actor', () => {
      const info = new ChronoVortexRendererInfo()
      const actor = makeActor()
      const renderer = info.create(actor)
      expect(renderer).toBeInstanceOf(ChronoVortexRenderer)
    })
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes vertex buffer with 48 frames × 6 vertices = 288', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      expect(renderer.vertices).toHaveLength(288) // 48 × 6
    })

    it('starts with empty vortex queue', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      expect(renderer.vortexCount).toBe(0)
    })

    it('starts as not disposed', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      expect(renderer.isDisposed).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // drawVortex
  // ---------------------------------------------------------------------------

  describe('drawVortex', () => {
    it('queues a vortex draw request', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.drawVortex({ X: 100, Y: 200, Z: 0 }, 5)
      expect(renderer.vortexCount).toBe(1)
    })

    it('queues multiple vortices', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.drawVortex({ X: 100, Y: 200, Z: 0 }, 5)
      renderer.drawVortex({ X: 300, Y: 400, Z: 0 }, 12)
      renderer.drawVortex({ X: 500, Y: 600, Z: 0 }, 23)
      expect(renderer.vortexCount).toBe(3)
    })

    it('rejects invalid frame indices (negative)', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.drawVortex({ X: 100, Y: 200, Z: 0 }, -1)
      expect(renderer.vortexCount).toBe(0)
    })

    it('rejects invalid frame indices (>= 48)', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.drawVortex({ X: 100, Y: 200, Z: 0 }, 48)
      expect(renderer.vortexCount).toBe(0)

      renderer.drawVortex({ X: 100, Y: 200, Z: 0 }, 100)
      expect(renderer.vortexCount).toBe(0)
    })

    it('accepts valid frame indices 0-47', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.drawVortex({ X: 0, Y: 0, Z: 0 }, 0)
      renderer.drawVortex({ X: 0, Y: 0, Z: 0 }, 47)
      expect(renderer.vortexCount).toBe(2)
    })

    it('stores correct vortex data', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      const pos = { X: 123, Y: 456, Z: 789 }
      renderer.drawVortex(pos, 15)

      const queued = renderer.queuedVortices
      expect(queued[0].pos).toEqual(pos)
      expect(queued[0].frame).toBe(15)
    })
  })

  // ---------------------------------------------------------------------------
  // passType / enabled
  // ---------------------------------------------------------------------------

  describe('passType', () => {
    it('returns AfterWorld', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      expect(renderer.passType).toBe('AfterWorld')
    })
  })

  describe('enabled', () => {
    it('returns false when no vortices queued', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      expect(renderer.enabled).toBe(false)
    })

    it('returns true when vortices are queued', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.drawVortex({ X: 100, Y: 200, Z: 0 }, 5)
      expect(renderer.enabled).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // draw
  // ---------------------------------------------------------------------------

  describe('draw', () => {
    it('returns empty renderable array', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      const result = renderer.draw(null)
      expect(result).toHaveLength(0)
    })

    it('clears vortex queue after draw', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.drawVortex({ X: 100, Y: 200, Z: 0 }, 5)
      renderer.drawVortex({ X: 300, Y: 400, Z: 0 }, 12)
      expect(renderer.vortexCount).toBe(2)

      renderer.draw(null)
      expect(renderer.vortexCount).toBe(0)
      expect(renderer.enabled).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // disposing
  // ---------------------------------------------------------------------------

  describe('disposing', () => {
    it('marks as disposed', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.disposing(makeActor())
      expect(renderer.isDisposed).toBe(true)
    })

    it('clears pending vortices', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      renderer.drawVortex({ X: 100, Y: 200, Z: 0 }, 5)
      renderer.drawVortex({ X: 300, Y: 400, Z: 0 }, 12)

      renderer.disposing(makeActor())
      expect(renderer.vortexCount).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Vertex buffer correctness
  // ---------------------------------------------------------------------------

  describe('vertex buffer', () => {
    it('has correct UV layout for each frame', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      const vertices = renderer.vertices

      // Check frame 0: should be at UV col=0, row=0
      expect(vertices[0].u).toBe(0 / 8)
      expect(vertices[0].v).toBe(0 / 8)
      expect(vertices[2].u).toBe(1 / 8)
      expect(vertices[2].v).toBe(1 / 8)

      // Check frame 47: should be at UV col=7, row=5
      const baseIdx = 47 * 6
      expect(vertices[baseIdx].u).toBe(7 / 8)
      expect(vertices[baseIdx].v).toBe(5 / 8)
      expect(vertices[baseIdx + 2].u).toBe(8 / 8)
      expect(vertices[baseIdx + 2].v).toBe(6 / 8)
    })

    it('has 2 triangles per frame (6 vertices)', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      const vertices = renderer.vertices
      expect(vertices.length % 6).toBe(0) // 288 / 6 = 48 frames
    })

    it('all quads are 64x64 centered (-32 to 32)', () => {
      const renderer = new ChronoVortexRenderer(makeActor())
      const vertices = renderer.vertices

      for (const v of vertices) {
        expect(v.x >= -32 && v.x <= 32).toBe(true)
        expect(v.y >= -32 && v.y <= 32).toBe(true)
      }
    })
  })
})
