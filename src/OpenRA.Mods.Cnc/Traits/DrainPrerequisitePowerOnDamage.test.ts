/**
 * DrainPrerequisitePowerOnDamage.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import {
  DrainPrerequisitePowerOnDamage,
  DrainPrerequisitePowerOnDamageInfo,
} from './DrainPrerequisitePowerOnDamage.js'

describe('DrainPrerequisitePowerOnDamageInfo', () => {
  it('should have default values', () => {
    const info = new DrainPrerequisitePowerOnDamageInfo()
    expect(info.orderName).toBe('GrantPrerequisiteChargeDrainPowerInfoOrder')
    expect(info.damageMultiplier).toBe(1)
    expect(info.damageDivisor).toBe(600)
  })
})

describe('DrainPrerequisitePowerOnDamage', () => {
  it('should return 100 when trait is disabled', () => {
    const info = new DrainPrerequisitePowerOnDamageInfo()
    const trait = new DrainPrerequisitePowerOnDamage(info)
    // Simulate disabled state via private field access
    ;(trait as any)._isDisabled = true
    expect(trait.getDamageModifier({} as any, { value: 100 })).toBe(100)
  })

  it('should return 100 when damage is null', () => {
    const trait = new DrainPrerequisitePowerOnDamage(new DrainPrerequisitePowerOnDamageInfo())
    expect(trait.getDamageModifier({} as any, null)).toBe(100)
  })

  it('should return 100 when no SPM is available', () => {
    const trait = new DrainPrerequisitePowerOnDamage(new DrainPrerequisitePowerOnDamageInfo())
    expect(trait.getDamageModifier({} as any, { value: 100 })).toBe(100)
  })

  it('should handle owner change', () => {
    const trait = new DrainPrerequisitePowerOnDamage(new DrainPrerequisitePowerOnDamageInfo())
    const actor = { owner: { playerActor: { getSupportPowerManager: () => ({ powers: new Map() }) } } } as any
    expect(() => trait.onOwnerChanged(actor)).not.toThrow()
  })
})
