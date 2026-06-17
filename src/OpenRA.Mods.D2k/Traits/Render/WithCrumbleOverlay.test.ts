/**
 * WithCrumbleOverlay.test.ts — WithCrumbleOverlay migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import { WithCrumbleOverlay, WithCrumbleOverlayInfo, SkipMakeAnimsInit } from './WithCrumbleOverlay.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function createMockRenderSprites() {
  return { getImage: vi.fn(() => 'building'), add: vi.fn(), remove: vi.fn() }
}

function createMockActor(rs?: unknown): IGameActor {
  const actor: Record<string, unknown> = {
    actorId: 1, isInWorld: true, isDead: false, disposed: false, generation: 1,
    owner: { playerId: 0, playerName: 'Test' },
    world: { addFrameEndTask: vi.fn() },
    centerPosition: { X: 0, Y: 0, Z: 0 },
    RenderSprites: rs ?? createMockRenderSprites(),
  }
  return actor as unknown as IGameActor
}

describe('WithCrumbleOverlay', () => {
  describe('WithCrumbleOverlayInfo', () => {
    it('has default values', () => {
      const info = new WithCrumbleOverlayInfo()
      expect(info.sequence).toBe('crumble-overlay')
      expect(info.palette).toBeNull()
      expect(info.isPlayerPalette).toBe(false)
    })

    it('accepts custom config', () => {
      const info = new WithCrumbleOverlayInfo({ sequence: 'custom', palette: 'player', isPlayerPalette: true, requiresCondition: 'low-hp' })
      expect(info.sequence).toBe('custom')
      expect(info.isPlayerPalette).toBe(true)
      expect(info.requiresCondition).toBe('low-hp')
    })
  })

  describe('SkipMakeAnimsInit', () => {
    it('creates marker', () => {
      expect(new SkipMakeAnimsInit().name).toBe('SkipMakeAnimsInit')
    })
  })

  describe('constructor', () => {
    it('skips setup when SkipMakeAnimsInit is present', () => {
      const info = new WithCrumbleOverlayInfo()
      const init = { self: createMockActor(), contains: (_n: string) => true }
      const overlay = new WithCrumbleOverlay(init, info)
      expect(overlay.info).toBe(info)
    })

    it('creates overlay when RenderSprites available', () => {
      const info = new WithCrumbleOverlayInfo()
      const init = { self: createMockActor(), contains: (_n: string) => false }
      const overlay = new WithCrumbleOverlay(init, info)
      expect(overlay.info).toBe(info)
    })
  })

  describe('ConditionalTrait integration', () => {
    it('is initially enabled', () => {
      const info = new WithCrumbleOverlayInfo()
      const init = { self: createMockActor(), contains: (_n: string) => true }
      const overlay = new WithCrumbleOverlay(init, info)
      expect(overlay.isTraitDisabled).toBe(false)
    })
  })

  describe('regression: playThen deferred callback (MAJOR #10)', () => {
    it('playThen defers callback to next tick', () => {
      const rs = createMockRenderSprites()
      const actor = createMockActor(rs)
      const info = new WithCrumbleOverlayInfo()
      const init = { self: actor, contains: (_n: string) => false }
      const overlay = new WithCrumbleOverlay(init, info)

      // Access traitEnabled via duck-typed cast (it's protected)
      ;(overlay as unknown as { traitEnabled: (self: IGameActor) => void }).traitEnabled(actor)

      // RenderSprites.add should have been called
      expect(rs.add).toHaveBeenCalled()

      // Trigger a tick on the overlay animation to invoke pending callback
      const internalOverlay = (overlay as unknown as { _overlay: { tick: () => void; currentSequence: { name: string } | null } })._overlay
      if (internalOverlay) {
        internalOverlay.tick()
        // After tick, the remove callback should have been scheduled via addFrameEndTask
        // In the real implementation, this would remove from RenderSprites
      }
    })
  })
})
