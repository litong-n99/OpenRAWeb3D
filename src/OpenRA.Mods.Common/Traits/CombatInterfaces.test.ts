/**
 * CombatInterfaces.test.ts -- Unit tests for combat interfaces and type guards
 */

import { describe, it, expect } from 'vitest'
import {
  UnitStance,
  isIRangeModifier,
  isIFirepowerModifier,
  isIReloadModifier,
  isIInaccuracyModifier,
  isIReloadAmmoModifier,
  isINotifyAttack,
  isINotifyBurstComplete,
  isINotifyAiming,
  isIOverrideAutoTarget,
  isIActivityNotifyStanceChanged,
  isINotifyStanceChanged,
} from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// UnitStance
// ---------------------------------------------------------------------------

describe('UnitStance', () => {
  it('has four stance values', () => {
    expect(UnitStance.HoldFire).toBe(0)
    expect(UnitStance.ReturnFire).toBe(1)
    expect(UnitStance.Defend).toBe(2)
    expect(UnitStance.AttackAnything).toBe(3)
  })

  it('allows numeric comparison for restrictiveness', () => {
    expect(UnitStance.Defend > UnitStance.ReturnFire).toBe(true)
    expect(UnitStance.AttackAnything > UnitStance.Defend).toBe(true)
    expect(UnitStance.ReturnFire > UnitStance.HoldFire).toBe(true)
    expect(UnitStance.HoldFire > UnitStance.AttackAnything).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('Type guards', () => {
  describe('isIRangeModifier', () => {
    it('returns true for objects with getRangeModifier', () => {
      const mod = { getRangeModifier: () => 150 }
      expect(isIRangeModifier(mod)).toBe(true)
    })

    it('returns false for non-matching objects', () => {
      expect(isIRangeModifier({})).toBe(false)
      expect(isIRangeModifier(null)).toBe(false)
      expect(isIRangeModifier('string')).toBe(false)
    })
  })

  describe('isIFirepowerModifier', () => {
    it('returns true for objects with getFirepowerModifier', () => {
      expect(isIFirepowerModifier({ getFirepowerModifier: () => 150 })).toBe(true)
    })

    it('returns false for non-matching objects', () => {
      expect(isIFirepowerModifier({})).toBe(false)
      expect(isIFirepowerModifier(null)).toBe(false)
    })
  })

  describe('isIReloadModifier', () => {
    it('returns true for objects with getReloadModifier', () => {
      expect(isIReloadModifier({ getReloadModifier: () => 80 })).toBe(true)
    })

    it('returns false for non-matching objects', () => {
      expect(isIReloadModifier({})).toBe(false)
    })
  })

  describe('isIInaccuracyModifier', () => {
    it('returns true for objects with getInaccuracyModifier', () => {
      expect(isIInaccuracyModifier({ getInaccuracyModifier: () => 120 })).toBe(true)
    })

    it('returns false for non-matching objects', () => {
      expect(isIInaccuracyModifier({})).toBe(false)
    })
  })

  describe('isIReloadAmmoModifier', () => {
    it('returns true for objects with getReloadAmmoModifier', () => {
      expect(isIReloadAmmoModifier({ getReloadAmmoModifier: () => 90 })).toBe(true)
    })
  })

  describe('isINotifyAttack', () => {
    it('returns true for objects with preparingAttack and attacking', () => {
      const n = { preparingAttack: () => {}, attacking: () => {} }
      expect(isINotifyAttack(n)).toBe(true)
    })

    it('returns false for incomplete objects', () => {
      expect(isINotifyAttack({ attacking: () => {} })).toBe(false)
    })
  })

  describe('isINotifyBurstComplete', () => {
    it('returns true for objects with firedBurst', () => {
      expect(isINotifyBurstComplete({ firedBurst: () => {} })).toBe(true)
    })
  })

  describe('isINotifyAiming', () => {
    it('returns true for objects with startedAiming and stoppedAiming', () => {
      expect(isINotifyAiming({ startedAiming: () => {}, stoppedAiming: () => {} })).toBe(true)
    })
  })

  describe('isIOverrideAutoTarget', () => {
    it('returns true for objects with tryGetAutoTargetOverride', () => {
      expect(isIOverrideAutoTarget({ tryGetAutoTargetOverride: () => false })).toBe(true)
    })
  })

  describe('isIActivityNotifyStanceChanged', () => {
    it('returns true for objects with stanceChanged', () => {
      expect(isIActivityNotifyStanceChanged({ stanceChanged: () => {} })).toBe(true)
    })

    it('returns false for non-matching objects', () => {
      expect(isIActivityNotifyStanceChanged({})).toBe(false)
    })
  })

  describe('isINotifyStanceChanged', () => {
    it('returns true for objects with stanceChanged', () => {
      expect(isINotifyStanceChanged({ stanceChanged: () => {} })).toBe(true)
    })
  })
})
