/**
 * SonicBlastRenderer.test.ts — SonicBlastRenderer migration unit tests
 *
 * Tests focus on: renderer lifecycle (create → draw → drawPass → dispose),
 * position collection, post-process pass type, enabled state.
 */

import { describe, it, expect } from 'vitest'

import {
  SonicBlastRenderer,
  SonicBlastRendererInfo,
  type Float3,
} from './SonicBlastRenderer.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SonicBlastRenderer', () => {
  describe('SonicBlastRendererInfo', () => {
    it('has defaults', () => {
      const info = new SonicBlastRendererInfo()
      expect(info.size).toBe(16)
      expect(info.zoom).toBe(2.5)
    })

    it('accepts custom config', () => {
      const info = new SonicBlastRendererInfo({ size: 32, zoom: 1.5 })
      expect(info.size).toBe(32)
      expect(info.zoom).toBe(1.5)
    })

    it('creates renderer instance', () => {
      const info = new SonicBlastRendererInfo()
      const r = info.create()
      expect(r).toBeInstanceOf(SonicBlastRenderer)
      expect(r.info).toBe(info)
    })
  })

  describe('draw', () => {
    it('collects positions', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)

      r.draw({ x: 100, y: 200, z: 0 })
      r.draw({ x: 300, y: 400, z: 0 })

      expect(r.positionCount).toBe(2)
    })

    it('ignores draw after dispose', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      const actor = createMockActor()

      r.draw({ x: 1, y: 2, z: 3 })
      expect(r.positionCount).toBe(1)

      r.disposing(actor)
      expect(r.positionCount).toBe(0) // disposing clears positions

      r.draw({ x: 4, y: 5, z: 6 }) // ignored after dispose
      expect(r.positionCount).toBe(0)
    })
  })

  describe('postProcessType', () => {
    it('returns AfterWorld', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      expect(r.postProcessType).toBe('AfterWorld')
    })
  })

  describe('enabled', () => {
    it('is true when positions exist', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      r.draw({ x: 0, y: 0, z: 0 })
      expect(r.enabled).toBe(true)
    })

    it('is false when no positions', () => {
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

  describe('drawPass', () => {
    it('clears positions after drawing', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      r.draw({ x: 10, y: 20, z: 0 })
      r.draw({ x: 30, y: 40, z: 0 })

      expect(r.positionCount).toBe(2)
      r.drawPass()
      expect(r.positionCount).toBe(0)
    })

    it('is no-op when no positions', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      expect(() => r.drawPass()).not.toThrow()
    })
  })

  describe('disposing', () => {
    it('clears positions', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      const actor = createMockActor()

      r.draw({ x: 1, y: 2, z: 3 })
      r.disposing(actor)

      expect(r.positionCount).toBe(0)
      expect(r.isDisposed).toBe(true)
    })

    it('is idempotent', () => {
      const info = new SonicBlastRendererInfo()
      const r = new SonicBlastRenderer(info)
      const actor = createMockActor()

      r.disposing(actor)
      r.disposing(actor)

      expect(r.isDisposed).toBe(true)
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
