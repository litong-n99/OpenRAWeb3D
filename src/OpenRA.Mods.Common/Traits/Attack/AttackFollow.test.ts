/**
 * AttackFollow.test.ts -- Unit tests for AttackFollow
 */

import { describe, it, expect } from 'vitest'
import { AttackFollow, AttackFollowInfo, AttackFollowActivity } from './AttackFollow.js'
import { AttackSource } from './AttackBase.js'
import { Target, TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { UnitStance } from '../CombatInterfaces.js'

describe('AttackFollow', () => {
  describe('AttackFollowInfo', () => {
    it('has default opportunityFire true', () => {
      const info = new AttackFollowInfo()
      expect(info.opportunityFire).toBe(true)
    })

    it('has default persistentTargeting true', () => {
      const info = new AttackFollowInfo()
      expect(info.persistentTargeting).toBe(true)
    })

    it('has default rangeMargin 1024', () => {
      const info = new AttackFollowInfo()
      expect(info.rangeMargin).toBe(1024)
    })
  })

  describe('AttackFollow trait', () => {
    it('starts with RequestedTarget Invalid', () => {
      const info = new AttackFollowInfo()
      const attack = new AttackFollow(info)
      expect(attack.requestedTarget.type).toBe(TargetType.Invalid)
    })

    it('starts with OpportunityTarget Invalid', () => {
      const info = new AttackFollowInfo()
      const attack = new AttackFollow(info)
      expect(attack.opportunityTarget.type).toBe(TargetType.Invalid)
    })

    it('setRequestedTarget sets target', () => {
      const info = new AttackFollowInfo()
      const attack = new AttackFollow(info)
      const target = Target.fromPos(new WPos(100, 0, 0))
      attack.setRequestedTarget(target, false)
      expect(attack.requestedTarget.type).toBe(TargetType.Terrain)
    })

    it('clearRequestedTarget persists to OpportunityTarget when persistentTargeting', () => {
      const info = new AttackFollowInfo({ persistentTargeting: true })
      const attack = new AttackFollow(info)
      const target = Target.fromPos(new WPos(100, 0, 0))
      attack.setRequestedTarget(target)
      attack.clearRequestedTarget()
      expect(attack.requestedTarget.type).toBe(TargetType.Invalid)
      expect(attack.opportunityTarget.type).toBe(TargetType.Terrain)
    })

    it('tryGetAutoTargetOverride returns RequestedTarget when valid', () => {
      const info = new AttackFollowInfo()
      const attack = new AttackFollow(info)
      const target = Target.fromPos(new WPos(100, 0, 0))
      attack.setRequestedTarget(target)
      const out = { target: Target.Invalid }
      expect(attack.tryGetAutoTargetOverride({} as never, out)).toBe(true)
      expect(out.target.type).toBe(TargetType.Terrain)
    })

    it('tryGetAutoTargetOverride returns false when no targets', () => {
      const info = new AttackFollowInfo()
      const attack = new AttackFollow(info)
      const out = { target: Target.Invalid }
      expect(attack.tryGetAutoTargetOverride({} as never, out)).toBe(false)
    })

    it('stanceChanged does not cancel when switching to less restrictive', () => {
      const info = new AttackFollowInfo()
      const attack = new AttackFollow(info)
      const target = Target.fromPos(new WPos(100, 0, 0))
      attack.opportunityTarget = target
      // Switching to MORE permissive (Defend -> AttackAnything): should NOT cancel
      attack.stanceChanged({} as never, {}, UnitStance.Defend, UnitStance.AttackAnything)
      expect(attack.opportunityTarget.type).toBe(TargetType.Terrain)
    })

    it('tick clears targets when disabled', () => {
      const info = new AttackFollowInfo()
      const attack = new AttackFollow(info)
      const internal = attack as unknown as { _enabled: boolean }
      internal._enabled = false
      const target = Target.fromPos(new WPos(100, 0, 0))
      attack.requestedTarget = target
      attack.opportunityTarget = target
      attack.tick({} as never)
      expect(attack.requestedTarget.type).toBe(TargetType.Invalid)
      expect(attack.opportunityTarget.type).toBe(TargetType.Invalid)
    })

    it('getAttackActivity returns AttackFollowActivity', () => {
      const info = new AttackFollowInfo()
      const attack = new AttackFollow(info)
      const target = Target.fromPos(new WPos(100, 0, 0))
      const activity = attack.getAttackActivity(
        {} as never,
        AttackSource.Default,
        target,
        false,
        false,
      )
      expect(activity).toBeInstanceOf(AttackFollowActivity)
    })
  })
})

describe('AttackFollowActivity', () => {
  it('tick returns true when cancelling', () => {
    const info = new AttackFollowInfo()
    const attack = new AttackFollow(info)
    const activity = new AttackFollowActivity(
      attack,
      {} as never,
      AttackSource.Default,
      Target.Invalid,
      false,
      false,
    )
    activity.cancel()
    expect(activity.tick({} as never)).toBe(true)
  })

  it('onLastRun clears requested target', () => {
    const info = new AttackFollowInfo()
    const attack = new AttackFollow(info)
    attack.setRequestedTarget(Target.fromPos(new WPos(100, 0, 0)))
    const activity = new AttackFollowActivity(
      attack,
      {} as never,
      AttackSource.Default,
      Target.fromPos(new WPos(100, 0, 0)),
      false,
      false,
    )
    activity.onLastRun({} as never)
    expect(attack.requestedTarget.type).toBe(TargetType.Invalid)
  })
})
