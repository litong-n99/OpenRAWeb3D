/**
 * GpsPower.test.ts — unit tests for GPS satellite support power
 *
 * Tests focus on: GpsPowerInfo defaults, power activation lifecycle,
 * owner management, pause/resume ITick logic, and GpsWatcher coordination.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GpsPowerInfo, GpsPower } from './GpsPower.js'
import { GpsWatcher } from '../GpsWatcher.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(name: string = 'gpsBuilding'): IGameActor {
  return {
    actorId: 42,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name },
  }
}

// ---------------------------------------------------------------------------
// GpsPowerInfo
// ---------------------------------------------------------------------------

describe('GpsPowerInfo', () => {
  describe('defaults', () => {
    const info = new GpsPowerInfo()

    it('has default revealDelay of 0', () => {
      expect(info.revealDelay).toBe(0)
    })

    it('has default doorImage of "atek"', () => {
      expect(info.doorImage).toBe('atek')
    })

    it('has default doorSequence of "active"', () => {
      expect(info.doorSequence).toBe('active')
    })

    it('has default doorPalette of "player"', () => {
      expect(info.doorPalette).toBe('player')
    })

    it('has default doorPaletteIsPlayerPalette of true', () => {
      expect(info.doorPaletteIsPlayerPalette).toBe(true)
    })

    it('has default satelliteImage of "sputnik"', () => {
      expect(info.satelliteImage).toBe('sputnik')
    })

    it('has default satelliteSequence of "idle"', () => {
      expect(info.satelliteSequence).toBe('idle')
    })

    it('has default requiresActiveRadar of true', () => {
      expect(info.requiresActiveRadar).toBe(true)
    })

    it('has default orderName from SupportPowerInfo', () => {
      expect(info.orderName).toBeDefined()
    })
  })

  describe('custom params', () => {
    it('accepts custom revealDelay', () => {
      const info = new GpsPowerInfo({ revealDelay: 100 })
      expect(info.revealDelay).toBe(100)
    })

    it('accepts custom doorImage', () => {
      const info = new GpsPowerInfo({ doorImage: 'customDoor' })
      expect(info.doorImage).toBe('customDoor')
    })

    it('accepts custom requiresActiveRadar', () => {
      const info = new GpsPowerInfo({ requiresActiveRadar: false })
      expect(info.requiresActiveRadar).toBe(false)
    })
  })

  describe('create', () => {
    it('creates a GpsPower instance', () => {
      const info = new GpsPowerInfo()
      const actor = makeActor()
      const power = info.create(actor)
      expect(power).toBeInstanceOf(GpsPower)
    })
  })
})

// ---------------------------------------------------------------------------
// GpsPower
// ---------------------------------------------------------------------------

describe('GpsPower', () => {
  let info: GpsPowerInfo
  let power: GpsPower
  let actor: IGameActor
  let watcher: GpsWatcher

  beforeEach(() => {
    info = new GpsPowerInfo({ orderName: 'GpsPower' })
    actor = makeActor()
    power = new GpsPower(actor, info)
    watcher = new GpsWatcher()
  })

  describe('initial state', () => {
    it('stores self reference', () => {
      expect(power.self).toBe(actor)
    })

    it('stores info reference', () => {
      expect(power.info).toBe(info)
    })

    it('has no watcher initially', () => {
      expect(power.gpsOwner).toBeNull()
    })

    it('is not paused initially', () => {
      expect(power.wasPaused).toBe(false)
    })
  })

  describe('setOwner', () => {
    it('sets the GpsWatcher reference', () => {
      power.setGpsOwner(watcher)
      expect(power.gpsOwner).toBe(watcher)
    })

    it('gpsAdd is called when owner is set', () => {
      power.setGpsOwner(watcher)
      // Verify watcher has the GPS power as a provider
      expect(watcher.providerCount).toBe(1)
    })
  })

  describe('killed (INotifyKilled)', () => {
    it('removes GPS from watcher', () => {
      power.setGpsOwner(watcher)
      expect(watcher.providerCount).toBe(1)
      power.killed(actor, {})
      expect(watcher.providerCount).toBe(0)
    })

    it('does not throw when watcher is null', () => {
      expect(() => power.killed(actor, {})).not.toThrow()
    })
  })

  describe('selling/sold (INotifySold)', () => {
    it('selling is a no-op', () => {
      power.setGpsOwner(watcher)
      power.selling(actor)
      expect(watcher.providerCount).toBe(1) // unchanged
    })

    it('sold removes GPS from watcher', () => {
      power.setGpsOwner(watcher)
      power.sold(actor)
      expect(watcher.providerCount).toBe(0)
    })
  })

  describe('onOwnerChanged (INotifyOwnerChanged)', () => {
    it('re-registers GPS with new owner', () => {
      power.setGpsOwner(watcher)
      expect(watcher.providerCount).toBe(1)

      // Manually set new owner (simulating onOwnerChanged dispatch)
      power.setGpsOwner(new GpsWatcher())
      // Old watcher should have GPS removed
      expect(watcher.providerCount).toBe(0)
      // New watcher should have GPS added
      expect(power.gpsOwner).not.toBeNull()
      expect(power.gpsOwner!.providerCount).toBe(1)
    })
  })

  describe('tick() — pause/resume logic', () => {
    it('removes GPS when transitioning from running to paused', () => {
      power.setGpsOwner(watcher)
      expect(watcher.providerCount).toBe(1)

      // Simulate pause
      Object.defineProperty(power, 'isTraitPaused', { value: true, writable: false })
      power.tick(actor)
      expect(watcher.providerCount).toBe(0)
      expect(power.wasPaused).toBe(true)
    })

    it('re-adds GPS when transitioning from paused to running', () => {
      power.setGpsOwner(watcher)
      power.setWasPaused(true)
      // Simulate resume
      Object.defineProperty(power, 'isTraitPaused', { value: false, writable: false })
      power.tick(actor)
      expect(watcher.providerCount).toBe(1)
      expect(power.wasPaused).toBe(false)
    })

    it('does nothing when already paused and still paused', () => {
      power.setGpsOwner(watcher)
      power.setWasPaused(true)
      Object.defineProperty(power, 'isTraitPaused', { value: true, writable: false })
      power.tick(actor)
      expect(power.wasPaused).toBe(true) // no change
    })

    it('does nothing when running and still running', () => {
      power.setGpsOwner(watcher)
      power.setWasPaused(false)
      Object.defineProperty(power, 'isTraitPaused', { value: false, writable: false })
      power.tick(actor)
      expect(power.wasPaused).toBe(false) // no change
    })
  })

  describe('charged()', () => {
    it('calls super.charged()', () => {
      // Verify it does not throw
      expect(() => power.charged(actor, 'GpsPower')).not.toThrow()
    })
  })
})
