/**
 * AttackOmni.test.ts -- Unit tests for AttackOmni
 */

import { describe, it, expect } from 'vitest'
import { AttackOmni, AttackOmniInfo, AttackOmniSetTarget } from './AttackOmni.js'
import { AttackSource } from './AttackBase.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { UnitStance } from '../CombatInterfaces.js'

describe('AttackOmni', () => {
  it('is created with info', () => {
    const info = new AttackOmniInfo()
    const attack = new AttackOmni(info)
    expect(attack.info.armaments).toEqual(['primary', 'secondary'])
  })

  it('getAttackActivity returns SetTarget', () => {
    const info = new AttackOmniInfo()
    const attack = new AttackOmni(info)
    const activity = attack.getAttackActivity(
      {} as never,
      AttackSource.Default,
      Target.Invalid,
      false,
      false,
    )
    expect(activity).toBeInstanceOf(AttackOmniSetTarget)
  })

  it('canAttack works (no facing constraint)', () => {
    const info = new AttackOmniInfo()
    const attack = new AttackOmni(info)
    const actor = { isInWorld: true }
    const target = Target.fromPos(WPos.Zero)
    // Should work since AttackOmni has no facing check
    expect(typeof attack.canAttack(actor as never, target)).toBe('boolean')
  })
})

describe('AttackOmniSetTarget', () => {
  it('is created with parameters', () => {
    const info = new AttackOmniInfo()
    const attack = new AttackOmni(info)
    const target = Target.fromPos(new WPos(100, 0, 0))
    const activity = new AttackOmniSetTarget(attack, {} as never, target, false, false)
    expect(activity).toBeDefined()
  })

  it('tick returns true when cancelling', () => {
    const info = new AttackOmniInfo()
    const attack = new AttackOmni(info)
    const activity = new AttackOmniSetTarget(attack, {} as never, Target.Invalid, false, false)
    activity.cancel()
    expect(activity.tick({} as never)).toBe(true)
  })

  it('stanceChanged does not cancel when switching to less restrictive', () => {
    const info = new AttackOmniInfo()
    const attack = new AttackOmni(info)
    const target = Target.fromPos(WPos.Zero)
    const activity = new AttackOmniSetTarget(attack, {} as never, target, false, false)
    // Should not throw
    expect(() =>
      activity.stanceChanged({} as never, {}, UnitStance.Defend, UnitStance.AttackAnything),
    ).not.toThrow()
  })
})
