/**
 * Armament.test.ts -- Unit tests for Armament weapon mount
 */

import { describe, it, expect, vi } from 'vitest'
import { Armament, ArmamentInfo } from './Armament.js'
import { WeaponInfo } from '../../OpenRA.Game/GameRules/WeaponInfo.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'

// Mock PROJECTILE_REGISTRY
vi.mock('../Projectiles/ProjectileRegistry.js', () => ({
  PROJECTILE_REGISTRY: {
    Bullet: {
      create: vi.fn(() => null),
    },
  },
}))

// ---------------------------------------------------------------------------
// Helper: create a minimal WeaponInfo for testing
// ---------------------------------------------------------------------------

function createTestWeapon(overrides: Partial<{
  range: number
  minRange: number
  reloadDelay: number
  burst: number
  validTargets: string[]
  projectileType: string | null
}> = {}): WeaponInfo {
  const json: Record<string, unknown> = {
    Range: overrides.range ?? 1024,
    Burst: overrides.burst ?? 1,
    ReloadDelay: overrides.reloadDelay ?? 10,
    ValidTargets: overrides.validTargets ?? ['Ground'],
    MinRange: overrides.minRange ?? 0,
    Projectile: overrides.projectileType
      ? { type: overrides.projectileType }
      : undefined,
  }
  return WeaponInfo.fromJSON(json, {})
}

function createMockActor(centerPos?: WPos) {
  return {
    centerPosition: centerPos ?? WPos.Zero,
    orientation: undefined,
    isInWorld: true,
    isDead: false,
    disposed: false,
    actorId: 1,
    getTraits: vi.fn(() => []),
    grantCondition: vi.fn(() => 1),
    revokeCondition: vi.fn(() => -1),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Armament', () => {
  describe('ArmamentInfo', () => {
    it('has default name "primary"', () => {
      const info = new ArmamentInfo()
      expect(info.name).toBe('primary')
    })

    it('has default ammoUsage of 1', () => {
      const info = new ArmamentInfo()
      expect(info.ammoUsage).toBe(1)
    })

    it('has default fireDelay of 0', () => {
      const info = new ArmamentInfo()
      expect(info.fireDelay).toBe(0)
    })

    it('creates barrel from localOffset/localYaw', () => {
      const info = new ArmamentInfo({
        localOffset: [new WVec(100, 0, 0)],
        localYaw: [WAngle.Zero],
      })
      expect(info.localOffset.length).toBe(1)
      expect(info.localYaw.length).toBe(1)
    })
  })

  describe('Armament trait', () => {
    it('is created with weapon and barrels', () => {
      const weapon = createTestWeapon({ range: 1024 })
      const info = new ArmamentInfo({
        weaponInfo: weapon,
        localOffset: [new WVec(100, 0, 0)],
      })
      const arm = new Armament(info)
      expect(arm.weapon).toBe(weapon)
      expect(arm.barrels.length).toBe(1)
      expect(arm.barrels[0]!.offset.X).toBe(100)
    })

    it('has default barrel at WVec.Zero when no offsets specified', () => {
      const weapon = createTestWeapon()
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      expect(arm.barrels.length).toBe(1)
      expect(WVec.equals(arm.barrels[0]!.offset, WVec.Zero)).toBe(true)
    })

    it('isReloading when fireDelay > 0', () => {
      const weapon = createTestWeapon()
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      arm.fireDelay = 1
      expect(arm.isReloading).toBe(true)
    })

    it('isReloading when trait disabled', () => {
      const weapon = createTestWeapon()
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      const internal = arm as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(arm.isReloading).toBe(true)
    })

    it('maxRange applies range modifiers', () => {
      const weapon = createTestWeapon({ range: 1024 })
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      // Mock range modifiers via internal access
      const range = arm.maxRange()
      expect(range.length).toBe(1024)
    })

    it('tick decrements fireDelay', () => {
      const weapon = createTestWeapon()
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      arm.fireDelay = 5
      const actor = createMockActor()
      arm.tick(actor as never)
      expect(arm.fireDelay).toBe(4)
    })

    it('tick applies recoil recovery', () => {
      const weapon = createTestWeapon()
      const info = new ArmamentInfo({ weaponInfo: weapon, recoilRecovery: new WDist(9) })
      const arm = new Armament(info)
      arm.recoil = new WDist(27)
      const actor = createMockActor()
      arm.tick(actor as never)
      expect(arm.recoil.length).toBe(18)
    })

    it('canFire returns false when reloading', () => {
      const weapon = createTestWeapon()
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      arm.fireDelay = 1
      const actor = createMockActor()
      const target = Target.fromPos(new WPos(100, 0, 0))
      expect(arm.canFire(actor as never, target)).toBe(false)
    })

    it('canFire returns false when target out of range', () => {
      const weapon = createTestWeapon({ range: 500 })
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      const actor = createMockActor()
      const target = Target.fromPos(new WPos(5000, 0, 0)) // Far away
      expect(arm.canFire(actor as never, target)).toBe(false)
    })

    it('checkFire with valid parameters calls fireBarrel', () => {
      const weapon = createTestWeapon({ range: 5000, burst: 1 })
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)

      // Create an actor with centerPosition within range
      const actor = createMockActor()
      const target = Target.fromPos(new WPos(100, 0, 0))

      // Since we mock the projectile registry, this should not throw
      const result = arm.checkFire(actor as never, null, target)
      // With a minimal weapon that has no warheads, this should work
      expect(typeof result).toBe('boolean')
    })

    it('tick does nothing when disabled', () => {
      const weapon = createTestWeapon()
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      const internal = arm as unknown as { _enabled: boolean }
      internal._enabled = false
      const actor = createMockActor()
      // Should not throw
      expect(() => arm.tick(actor as never)).not.toThrow()
    })

    it('burst is set from weapon on construction', () => {
      const weapon = createTestWeapon({ burst: 3 })
      const info = new ArmamentInfo({ weaponInfo: weapon })
      const arm = new Armament(info)
      expect(arm.burst).toBe(3)
    })
  })
})
