/**
 * AmmoPool.test.ts -- Unit tests for AmmoPool
 */

import { describe, it, expect, vi } from 'vitest'
import { AmmoPool, AmmoPoolInfo } from './AmmoPool.js'

// ---------------------------------------------------------------------------
// Helper: create a mock IGameActor
// ---------------------------------------------------------------------------

function mockActor(): {
  grantCondition?: (c: string) => number
  revokeCondition?: (t: number) => number
} {
  const granted: string[] = []
  let nextToken = 1
  return {
    grantCondition: vi.fn((c: string) => {
      granted.push(c)
      return nextToken++
    }),
    revokeCondition: vi.fn((_t: number) => {
      return -1
    }),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AmmoPool', () => {
  describe('AmmoPoolInfo', () => {
    it('has defaults', () => {
      const info = new AmmoPoolInfo()
      expect(info.name).toBe('primary')
      expect(info.ammo).toBe(1)
      expect(info.initialAmmo).toBe(-1)
      expect(info.armaments).toEqual(['primary', 'secondary'])
    })

    it('accepts custom values', () => {
      const info = new AmmoPoolInfo({ name: 'secondary', ammo: 5, initialAmmo: 3 })
      expect(info.name).toBe('secondary')
      expect(info.ammo).toBe(5)
      expect(info.initialAmmo).toBe(3)
    })
  })

  describe('AmmoPool trait', () => {
    it('starts with full ammo when initialAmmo is -1', () => {
      const info = new AmmoPoolInfo({ ammo: 5 })
      const pool = new AmmoPool(info)
      expect(pool.currentAmmoCount).toBe(5)
      expect(pool.hasAmmo).toBe(true)
      expect(pool.hasFullAmmo).toBe(true)
    })

    it('starts with specified initial ammo', () => {
      const info = new AmmoPoolInfo({ ammo: 5, initialAmmo: 2 })
      const pool = new AmmoPool(info)
      expect(pool.currentAmmoCount).toBe(2)
      expect(pool.hasAmmo).toBe(true)
      expect(pool.hasFullAmmo).toBe(false)
    })

    it('takeAmmo reduces count', () => {
      const info = new AmmoPoolInfo({ ammo: 5 })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      expect(pool.takeAmmo(actor as never, 2)).toBe(true)
      expect(pool.currentAmmoCount).toBe(3)
    })

    it('takeAmmo clamps to 0', () => {
      const info = new AmmoPoolInfo({ ammo: 5 })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      pool.takeAmmo(actor as never, 10)
      expect(pool.currentAmmoCount).toBe(0)
      expect(pool.hasAmmo).toBe(false)
    })

    it('takeAmmo returns false when empty', () => {
      const info = new AmmoPoolInfo({ ammo: 1 })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      pool.takeAmmo(actor as never, 1)
      expect(pool.takeAmmo(actor as never, 1)).toBe(false)
    })

    it('takeAmmo returns false for negative count', () => {
      const info = new AmmoPoolInfo({ ammo: 5 })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      expect(pool.takeAmmo(actor as never, -1)).toBe(false)
    })

    it('giveAmmo increases count', () => {
      const info = new AmmoPoolInfo({ ammo: 5, initialAmmo: 1 })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      expect(pool.giveAmmo(actor as never, 2)).toBe(true)
      expect(pool.currentAmmoCount).toBe(3)
    })

    it('giveAmmo clamps to max', () => {
      const info = new AmmoPoolInfo({ ammo: 5, initialAmmo: 1 })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      pool.giveAmmo(actor as never, 10)
      expect(pool.currentAmmoCount).toBe(5)
      expect(pool.hasFullAmmo).toBe(true)
    })

    it('giveAmmo returns false when full', () => {
      const info = new AmmoPoolInfo({ ammo: 5 })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      expect(pool.giveAmmo(actor as never, 1)).toBe(false)
    })

    it('giveAmmo returns false for negative count', () => {
      const info = new AmmoPoolInfo({ ammo: 5, initialAmmo: 1 })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      expect(pool.giveAmmo(actor as never, -1)).toBe(false)
    })

    it('attacking consumes ammo for matching armament', () => {
      const info = new AmmoPoolInfo({ ammo: 10, armaments: ['primary'] })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      pool.attacking(actor as never, null as never, {
        info: { name: 'primary', ammoUsage: 2 },
      }, null as never)
      expect(pool.currentAmmoCount).toBe(8)
    })

    it('attacking does nothing for non-matching armament', () => {
      const info = new AmmoPoolInfo({ ammo: 10, armaments: ['primary'] })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      pool.attacking(actor as never, null as never, {
        info: { name: 'secondary', ammoUsage: 2 },
      }, null as never)
      expect(pool.currentAmmoCount).toBe(10)
    })

    it('manages condition tokens for ammo points', () => {
      const info = new AmmoPoolInfo({ ammo: 3, initialAmmo: 2, ammoCondition: 'HasAmmo' })
      const pool = new AmmoPool(info)
      const actor = mockActor()
      actor.grantCondition = vi.fn((_c: string) => 1)

      // created() grants 2 tokens
      pool.created(actor as never)
      expect(actor.grantCondition).toHaveBeenCalledTimes(2)

      // taking ammo should revoke a token
      actor.grantCondition = vi.fn((_c: string) => 1)
      pool.takeAmmo(actor as never, 1)
      // Condition tokens tracked internally
      expect(pool.hasAmmo).toBe(true)
      expect(pool.currentAmmoCount).toBe(1)
    })
  })
})
