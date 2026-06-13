/**
 * DamageMultiplier.test.ts — DamageMultiplier migration unit tests
 *
 * Tests focus on: modifier value, disabled state, Info defaults
 */

import { describe, it, expect } from 'vitest'
import {
  DamageMultiplier,
  DamageMultiplierInfo,
} from './DamageMultiplier.js'

describe('DamageMultiplierInfo', () => {
  it('has default modifier of 100', () => {
    const info = new DamageMultiplierInfo()
    expect(info.modifier).toBe(100)
  })

  it('accepts custom modifier', () => {
    const info = new DamageMultiplierInfo({ modifier: 50 })
    expect(info.modifier).toBe(50)
  })

  it('getDamageModifierDefault returns modifier when enabledByDefault', () => {
    const info = new DamageMultiplierInfo({ modifier: 75 })
    expect(info.getDamageModifierDefault()).toBe(75)
  })

  it('getDamageModifierDefault returns 100 when not enabledByDefault', () => {
    const info = new DamageMultiplierInfo({ modifier: 50, enabledByDefault: false })
    expect(info.getDamageModifierDefault()).toBe(100)
  })
})

describe('DamageMultiplier', () => {
  it('returns info.modifier when trait is enabled', () => {
    const info = new DamageMultiplierInfo({ modifier: 150 })
    const multiplier = new DamageMultiplier(info)
    const attacker = {} as never
    const damage = {} as never
    expect(multiplier.getDamageModifier(attacker, damage)).toBe(150)
  })

  it('returns 100 when trait is disabled', () => {
    const info = new DamageMultiplierInfo({ modifier: 50 })
    const multiplier = new DamageMultiplier(info)
    // Force trait disabled
    ;(multiplier as unknown as { _enabled: boolean })._enabled = false
    const attacker = {} as never
    const damage = {} as never
    expect(multiplier.getDamageModifier(attacker, damage)).toBe(100)
  })

  it('attacker and damage parameters are accepted', () => {
    const info = new DamageMultiplierInfo({ modifier: 200 })
    const multiplier = new DamageMultiplier(info)
    const attacker = { actorId: 1 } as never
    const damage = { value: 50 } as never
    expect(multiplier.getDamageModifier(attacker, damage)).toBe(200)
  })
})
