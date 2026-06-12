/**
 * ReloadAmmoPool.test.ts -- Unit tests for ReloadAmmoPool
 */

import { describe, it, expect } from 'vitest'
import { ReloadAmmoPool, ReloadAmmoPoolInfo } from './ReloadAmmoPool.js'
import { AmmoPool, AmmoPoolInfo } from './AmmoPool.js'

function mockActor() {
  return {}
}

describe('ReloadAmmoPool', () => {
  describe('ReloadAmmoPoolInfo', () => {
    it('has defaults', () => {
      const info = new ReloadAmmoPoolInfo()
      expect(info.ammoPool).toBe('primary')
      expect(info.delay).toBe(50)
      expect(info.count).toBe(1)
      expect(info.resetOnFire).toBe(false)
    })

    it('accepts custom values', () => {
      const info = new ReloadAmmoPoolInfo({ delay: 100, count: 2, resetOnFire: true })
      expect(info.delay).toBe(100)
      expect(info.count).toBe(2)
      expect(info.resetOnFire).toBe(true)
    })
  })

  describe('ReloadAmmoPool trait', () => {
    it('is created with info', () => {
      const info = new ReloadAmmoPoolInfo({ delay: 50, count: 1 })
      const trait = new ReloadAmmoPool(info)
      expect(trait.info.delay).toBe(50)
      expect(trait.isTraitDisabled).toBe(false)
    })

    it('reload does nothing without linked ammoPool', () => {
      const info = new ReloadAmmoPoolInfo({ delay: 50 })
      const trait = new ReloadAmmoPool(info)
      const actor = mockActor()
      // Should not throw
      expect(() => trait.reload(actor as never)).not.toThrow()
    })

    it('reload gives ammo when timer reaches 0', () => {
      const ammoInfo = new AmmoPoolInfo({ ammo: 5, initialAmmo: 1, name: 'primary' })
      const ammoPool = new AmmoPool(ammoInfo)
      const info = new ReloadAmmoPoolInfo({ delay: 50, count: 1, ammoPool: 'primary' })
      const trait = new ReloadAmmoPool(info)
      trait.ammoPool = ammoPool
      trait.remainingTicks = 0

      const actor = mockActor()
      trait.reload(actor as never)
      expect(ammoPool.currentAmmoCount).toBe(2)
    })

    it('reload does not give ammo when full', () => {
      const ammoInfo = new AmmoPoolInfo({ ammo: 5, name: 'primary' })
      const ammoPool = new AmmoPool(ammoInfo)
      const info = new ReloadAmmoPoolInfo({ delay: 50, count: 1, ammoPool: 'primary' })
      const trait = new ReloadAmmoPool(info)
      trait.ammoPool = ammoPool
      trait.remainingTicks = 0

      const actor = mockActor()
      trait.reload(actor as never)
      expect(ammoPool.currentAmmoCount).toBe(5) // Already full
    })

    it('tick does nothing when disabled', () => {
      const info = new ReloadAmmoPoolInfo({ delay: 50 })
      const trait = new ReloadAmmoPool(info)
      const internal = trait as unknown as { _enabled: boolean }
      internal._enabled = false
      const actor = mockActor()
      // Should not throw
      expect(() => trait.tick(actor as never)).not.toThrow()
    })

    it('attacking resets timer when resetOnFire is true', () => {
      const info = new ReloadAmmoPoolInfo({ delay: 100, resetOnFire: true })
      const trait = new ReloadAmmoPool(info)
      trait.remainingTicks = 50
      const actor = mockActor()
      trait.attacking(actor as never, null as never, null as never, null as never)
      expect(trait.remainingTicks).not.toBe(50)
    })

    it('attacking does not reset timer when resetOnFire is false', () => {
      const info = new ReloadAmmoPoolInfo({ delay: 100, resetOnFire: false })
      const trait = new ReloadAmmoPool(info)
      trait.remainingTicks = 50
      const actor = mockActor()
      trait.attacking(actor as never, null as never, null as never, null as never)
      expect(trait.remainingTicks).toBe(50)
    })

    // MAJOR 7 fix: tick skips reload when paused
    it('tick skips reload when trait is paused', () => {
      const ammoInfo = new AmmoPoolInfo({ ammo: 5, initialAmmo: 1, name: 'primary' })
      const ammoPool = new AmmoPool(ammoInfo)
      const info = new ReloadAmmoPoolInfo({ delay: 50, count: 1, ammoPool: 'primary' })
      const trait = new ReloadAmmoPool(info)
      trait.ammoPool = ammoPool
      trait.remainingTicks = 0
      const internal = trait as unknown as { _paused: boolean }
      internal._paused = true
      const actor = mockActor()
      trait.tick(actor as never)
      // Ammo should NOT increase because trait is paused
      expect(ammoPool.currentAmmoCount).toBe(1)
    })
  })
})
