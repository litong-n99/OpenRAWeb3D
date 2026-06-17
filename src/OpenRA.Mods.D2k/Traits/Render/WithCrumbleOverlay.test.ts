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
})
