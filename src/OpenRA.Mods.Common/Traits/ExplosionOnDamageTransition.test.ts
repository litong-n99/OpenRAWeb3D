/**
 * ExplosionOnDamageTransition.test.ts — ExplosionOnDamageTransition unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  ExplosionOnDamageTransition,
  ExplosionOnDamageTransitionInfo,
} from './ExplosionOnDamageTransition.js'
import { AttackInfo, Damage, DamageState } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

function makeMockActor(isInWorld = true) {
  return {
    actorId: 1,
    isInWorld,
    isDead: false,
    disposed: false,
    centerPosition: new WPos(100, 200, 0),
  }
}

function makeMockAttackInfo(
  damageState: typeof DamageState[keyof typeof DamageState],
  previousDamageState: typeof DamageState[keyof typeof DamageState],
  attacker = makeMockActor(),
) {
  return new AttackInfo(
    new Damage(50),
    attacker,
    damageState,
    previousDamageState,
  )
}

describe('ExplosionOnDamageTransitionInfo', () => {
  it('defaults damageState to Heavy', () => {
    const info = new ExplosionOnDamageTransitionInfo()
    expect(info.damageState).toBe(DamageState.Heavy)
  })

  it('triggerOnlyOnce defaults to false', () => {
    const info = new ExplosionOnDamageTransitionInfo()
    expect(info.triggerOnlyOnce).toBe(false)
  })

  it('accepts custom weapon name', () => {
    const info = new ExplosionOnDamageTransitionInfo({ weapon: 'UnitExplode' })
    expect(info.weapon).toBe('UnitExplode')
  })
})

describe('ExplosionOnDamageTransition', () => {
  it('does not trigger when actor not in world', () => {
    const info = new ExplosionOnDamageTransitionInfo({ weapon: 'TestWeapon' })
    const trait = new ExplosionOnDamageTransition(info)
    const mockImpact = vi.fn()
    trait.setWeaponInfo({ impact: mockImpact })

    const self = makeMockActor(false)
    trait.damageStateChanged(self, makeMockAttackInfo(DamageState.Heavy, DamageState.Medium))
    expect(mockImpact).not.toHaveBeenCalled()
  })

  it('does not trigger when already triggered (triggerOnlyOnce)', () => {
    const info = new ExplosionOnDamageTransitionInfo({
      weapon: 'TestWeapon',
      triggerOnlyOnce: true,
    })
    const trait = new ExplosionOnDamageTransition(info)
    const mockImpact = vi.fn()
    trait.setWeaponInfo({ impact: mockImpact })

    // First trigger
    const self = makeMockActor(true)
    trait.damageStateChanged(self, makeMockAttackInfo(DamageState.Heavy, DamageState.Medium))
    expect(mockImpact).toHaveBeenCalledTimes(1)

    // Second attempt
    trait.damageStateChanged(self, makeMockAttackInfo(DamageState.Critical, DamageState.Heavy))
    expect(mockImpact).toHaveBeenCalledTimes(1) // No second trigger
  })

  it('triggers when damage state crosses threshold', () => {
    const info = new ExplosionOnDamageTransitionInfo({ weapon: 'TestWeapon' })
    const trait = new ExplosionOnDamageTransition(info)
    const mockImpact = vi.fn()
    trait.setWeaponInfo({ impact: mockImpact })

    const self = makeMockActor(true)
    trait.damageStateChanged(self, makeMockAttackInfo(DamageState.Heavy, DamageState.Light))
    expect(mockImpact).toHaveBeenCalledTimes(1)
  })

  it('does not trigger when damage state is already above threshold', () => {
    const info = new ExplosionOnDamageTransitionInfo({ weapon: 'TestWeapon' })
    const trait = new ExplosionOnDamageTransition(info)
    const mockImpact = vi.fn()
    trait.setWeaponInfo({ impact: mockImpact })

    const self = makeMockActor(true)
    // Previous state already at Heavy, so no transition across threshold
    trait.damageStateChanged(self, makeMockAttackInfo(DamageState.Critical, DamageState.Heavy))
    expect(mockImpact).not.toHaveBeenCalled()
  })

  it('does not trigger when below threshold', () => {
    const info = new ExplosionOnDamageTransitionInfo({ weapon: 'TestWeapon' })
    const trait = new ExplosionOnDamageTransition(info)
    const mockImpact = vi.fn()
    trait.setWeaponInfo({ impact: mockImpact })

    const self = makeMockActor(true)
    trait.damageStateChanged(self, makeMockAttackInfo(DamageState.Light, DamageState.Undamaged))
    expect(mockImpact).not.toHaveBeenCalled()
  })

  it('does not trigger when trait is disabled', () => {
    const info = new ExplosionOnDamageTransitionInfo({ weapon: 'TestWeapon' })
    const trait = new ExplosionOnDamageTransition(info)
    const mockImpact = vi.fn()
    trait.setWeaponInfo({ impact: mockImpact })
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    const self = makeMockActor(true)
    trait.damageStateChanged(self, makeMockAttackInfo(DamageState.Heavy, DamageState.Light))
    expect(mockImpact).not.toHaveBeenCalled()
  })
})
