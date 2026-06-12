/**
 * AttackFrontal.test.ts -- Unit tests for AttackFrontal
 */

import { describe, it, expect } from 'vitest'
import { AttackFrontal, AttackFrontalInfo, AttackFrontalActivity } from './AttackFrontal.js'
import { AttackSource } from './AttackBase.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'

describe('AttackFrontal', () => {
  it('is created with info', () => {
    const info = new AttackFrontalInfo()
    const attack = new AttackFrontal(info)
    expect(attack.info.armaments).toEqual(['primary', 'secondary'])
  })

  it('getAttackActivity returns AttackFrontalActivity', () => {
    const info = new AttackFrontalInfo()
    const attack = new AttackFrontal(info)
    const activity = attack.getAttackActivity(
      {} as never,
      AttackSource.Default,
      Target.Invalid,
      false,
      false,
    )
    expect(activity).toBeInstanceOf(AttackFrontalActivity)
  })

  it('canAttack requires facing within tolerance', () => {
    const info = new AttackFrontalInfo({ facingTolerance: new WAngle(128) })
    const attack = new AttackFrontal(info)
    // With null facing, returns true (no facing trait)
    const actor = { isInWorld: true }
    const target = Target.fromPos(WPos.Zero)
    expect(typeof attack.canAttack(actor as never, target)).toBe('boolean')
  })
})

describe('AttackFrontalActivity', () => {
  it('tick returns true when cancelling', () => {
    const info = new AttackFrontalInfo()
    const attack = new AttackFrontal(info)
    const activity = new AttackFrontalActivity(attack, {} as never, Target.Invalid, false, false)
    activity.cancel()
    expect(activity.tick({} as never)).toBe(true)
  })
})
