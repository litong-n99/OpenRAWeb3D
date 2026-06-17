/**
 * WithTeslaChargeOverlay.test.ts — Unit tests for WithTeslaChargeOverlay
 *
 * Tests focus on: charging state, damage state normalization, selling lifecycle.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  WithTeslaChargeOverlay,
  WithTeslaChargeOverlayInfo,
  DamageState,
  type ITeslaOverlayRenderSprites,
} from './WithTeslaChargeOverlay.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRenderSprites(): ITeslaOverlayRenderSprites {
  return {
    add: vi.fn(),
    getImage: vi.fn().mockReturnValue('test-image'),
  } as unknown as ITeslaOverlayRenderSprites
}

function makeActor(renderSprites: ITeslaOverlayRenderSprites): IGameActor {
  return {
    trait(name: string): unknown {
      if (name === 'RenderSprites') return renderSprites
      return null
    },
    getDamageState(): number {
      return DamageState.Undamaged
    },
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WithTeslaChargeOverlayInfo', () => {
  it('should have default values', () => {
    const info = new WithTeslaChargeOverlayInfo()
    expect(info.sequence).toBe('active')
    expect(info.palette).toBeNull()
    expect(info.isPlayerPalette).toBe(false)
  })

  it('should accept custom values', () => {
    const info = new WithTeslaChargeOverlayInfo({
      sequence: 'charge',
      palette: 'player',
      isPlayerPalette: true,
    })
    expect(info.sequence).toBe('charge')
    expect(info.palette).toBe('player')
    expect(info.isPlayerPalette).toBe(true)
  })

  it('should create trait via factory', () => {
    const info = new WithTeslaChargeOverlayInfo()
    const rs = makeRenderSprites()
    const actor = makeActor(rs)
    const overlay = info.create(actor)
    expect(overlay).toBeInstanceOf(WithTeslaChargeOverlay)
  })
})

describe('WithTeslaChargeOverlay', () => {
  it('should register with RenderSprites on construction', () => {
    const rs = makeRenderSprites()
    const actor = makeActor(rs)
    const info = new WithTeslaChargeOverlayInfo()
    new WithTeslaChargeOverlay(actor, info)
    expect(rs.add).toHaveBeenCalled()
  })

  it('should set charging state on charging event', () => {
    const rs = makeRenderSprites()
    const actor = makeActor(rs)
    const info = new WithTeslaChargeOverlayInfo()
    const overlay = new WithTeslaChargeOverlay(actor, info)

    overlay.charging(actor, null)
    // The duck-typed playThen uses setTimeout(100ms), so it's async.
    // The charging state should be set to true immediately.
    expect(overlay.isCharging).toBe(true)
  })

  it('should start as not charging', () => {
    const rs = makeRenderSprites()
    const actor = makeActor(rs)
    const info = new WithTeslaChargeOverlayInfo()
    const overlay = new WithTeslaChargeOverlay(actor, info)
    expect(overlay.isCharging).toBe(false)
  })

  it('should stop charging on selling', () => {
    const rs = makeRenderSprites()
    const actor = makeActor(rs)
    const info = new WithTeslaChargeOverlayInfo()
    const overlay = new WithTeslaChargeOverlay(actor, info)

    overlay.setCharging(true)
    expect(overlay.isCharging).toBe(true)

    overlay.selling(actor)
    expect(overlay.isCharging).toBe(false)
  })

  it('should handle damage state changes without error', () => {
    const rs = makeRenderSprites()
    const actor = makeActor(rs)
    const info = new WithTeslaChargeOverlayInfo()
    const overlay = new WithTeslaChargeOverlay(actor, info)

    expect(() =>
      overlay.damageStateChanged(actor, { damageState: DamageState.Heavy }),
    ).not.toThrow()
  })

  it('should have sold as no-op', () => {
    const rs = makeRenderSprites()
    const actor = makeActor(rs)
    const info = new WithTeslaChargeOverlayInfo()
    const overlay = new WithTeslaChargeOverlay(actor, info)

    expect(() => overlay.sold(actor)).not.toThrow()
  })

  it('should dispose cleanly', () => {
    const rs = makeRenderSprites()
    const actor = makeActor(rs)
    const info = new WithTeslaChargeOverlayInfo()
    const overlay = new WithTeslaChargeOverlay(actor, info)
    expect(() => overlay.dispose()).not.toThrow()
  })
})
