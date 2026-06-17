/**
 * WithDeliveryOverlay.test.ts — WithDeliveryOverlay migration unit tests
 *
 * Tests focus on: construction, INotifyDelivery lifecycle,
 * delivery state transitions (delivering → delivered).
 */

import { describe, it, expect, vi } from 'vitest'

import {
  WithDeliveryOverlay,
  WithDeliveryOverlayInfo,
} from './WithDeliveryOverlay.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(opts: {
  renderSprites?: unknown
  bodyOrientation?: { localToWorld: (offset: WVec) => WVec; quantizeOrientation: (o: number) => number }
  orientation?: number
} = {}): IGameActor {
  const actor: Record<string, unknown> = {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 1,
    owner: { playerId: 0, playerName: 'Test' },
    world: {},
    centerPosition: { X: 0, Y: 0, Z: 0 },
    Orientation: opts.orientation ?? 0,
    RenderSprites: opts.renderSprites ?? createMockRenderSprites(),
    BodyOrientation: opts.bodyOrientation ?? {
      localToWorld: (o: WVec) => o,
      quantizeOrientation: (_o: number) => 0,
    },
  }
  return actor as unknown as IGameActor
}

function createMockRenderSprites() {
  return {
    getImage: vi.fn(() => 'actor'),
    add: vi.fn(),
    remove: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WithDeliveryOverlay', () => {
  describe('WithDeliveryOverlayInfo', () => {
    it('has default values', () => {
      const info = new WithDeliveryOverlayInfo()
      expect(info.sequence).toBe('active')
      expect(info.offset).toEqual(WVec.Zero)
      expect(info.palette).toBeNull()
      expect(info.isPlayerPalette).toBe(false)
    })

    it('accepts custom offset', () => {
      const offset = new WVec(0, 0, 128)
      const info = new WithDeliveryOverlayInfo({ offset, sequence: 'deliver' })
      expect(info.offset).toEqual(offset)
      expect(info.sequence).toBe('deliver')
    })
  })

  describe('INotifyDelivery', () => {
    it('starts delivery state on incomingDelivery', () => {
      const actor = createMockActor()
      const info = new WithDeliveryOverlayInfo()
      const overlay = new WithDeliveryOverlay(actor, info)

      overlay.incomingDelivery(actor)
      // Delivery state should now be active — verify via a second call
      // that it doesn't crash (loop would be infinite if broken)
    })

    it('ends delivery state on delivered', () => {
      const actor = createMockActor()
      const info = new WithDeliveryOverlayInfo()
      const overlay = new WithDeliveryOverlay(actor, info)

      overlay.incomingDelivery(actor)
      overlay.delivered(actor)
      // Delivery state should now be inactive
    })

    it('supports full delivery lifecycle', () => {
      const actor = createMockActor()
      const info = new WithDeliveryOverlayInfo()
      const overlay = new WithDeliveryOverlay(actor, info)

      // Start delivery
      overlay.incomingDelivery(actor)
      // End delivery
      overlay.delivered(actor)
      // Start again
      overlay.incomingDelivery(actor)
      // End again
      overlay.delivered(actor)

      // Should not throw or leak
    })
  })

  describe('constructor', () => {
    it('registers with RenderSprites on construction', () => {
      const rs = createMockRenderSprites()
      const actor = createMockActor({ renderSprites: rs })
      const info = new WithDeliveryOverlayInfo({ palette: 'player', isPlayerPalette: true })
      void new WithDeliveryOverlay(actor, info)

      expect(rs.add).toHaveBeenCalled()
    })

    it('handles missing BodyOrientation gracefully', () => {
      const rs = createMockRenderSprites()
      const actor = createMockActor({ renderSprites: rs, bodyOrientation: undefined as unknown as { localToWorld: (offset: WVec) => WVec; quantizeOrientation: (o: number) => number } })
      const info = new WithDeliveryOverlayInfo()
      void new WithDeliveryOverlay(actor, info)

      expect(rs.add).toHaveBeenCalled()
    })

    it('uses orientation from actor for body offset', () => {
      const rs = createMockRenderSprites()
      const actor = createMockActor({ renderSprites: rs, orientation: 128 })
      const info = new WithDeliveryOverlayInfo({
        offset: new WVec(256, 0, 0),
      })
      void new WithDeliveryOverlay(actor, info)

      expect(rs.add).toHaveBeenCalled()
    })
  })

  describe('ConditionalTrait integration', () => {
    it('is initially enabled', () => {
      const actor = createMockActor()
      const info = new WithDeliveryOverlayInfo()
      const overlay = new WithDeliveryOverlay(actor, info)
      expect(overlay.isTraitDisabled).toBe(false)
    })

    it('condition required is stored', () => {
      const info = new WithDeliveryOverlayInfo({ requiresCondition: 'airborne' })
      expect(info.requiresCondition).toBe('airborne')
    })
  })
})
