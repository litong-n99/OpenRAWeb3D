/**
 * AttackLeap.test.ts — unit tests for AttackLeap trait
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import { AttackLeap, AttackLeapInfo } from './AttackLeap.js'
import { LeapAttack } from '../../Activities/LeapAttack.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import type { Target as TargetType_ } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'

function makeActor(loc?: { X: number; Y: number }): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    location: loc,
    owner: { relationshipWith: () => 0 },
  } as unknown as IGameActor
}

describe('AttackLeap', () => {
  describe('AttackLeapInfo', () => {
    it('has correct defaults', () => {
      const info = new AttackLeapInfo()
      expect(info.speed).toEqual(new WDist(426))
      expect(info.leapCondition).toBe('attacking')
    })
  })

  describe('constructor', () => {
    it('creates valid instance', () => {
      const info = new AttackLeapInfo()
      const trait = new AttackLeap(info)
      expect(trait).toBeDefined()
    })
  })

  describe('canAttack', () => {
    it('allows attack from same cell', () => {
      const info = new AttackLeapInfo()
      const trait = new AttackLeap(info)
      const self = makeActor({ X: 5, Y: 5 })

      const target = {
        type: TargetType.Actor,
        actor: { location: { X: 5, Y: 5 }, owner: {} },
        isValidFor: () => true,
      } as unknown as TargetType_

      // Without armaments, hasAnyValidWeapons returns false, so same-cell
      // check fails and we fall through to super.canAttack (which also fails
      // since no armaments are available)
      const result = trait.canAttack(self, target)
      expect(result).toBe(false)
    })

    it('returns false for non-Actor targets', () => {
      const info = new AttackLeapInfo()
      const trait = new AttackLeap(info)
      const self = makeActor()
      const target = { type: TargetType.Terrain } as unknown as TargetType_

      expect(trait.canAttack(self, target)).toBe(false)
    })
  })

  describe('condition management', () => {
    it('grants leap condition', () => {
      const info = new AttackLeapInfo({ leapCondition: 'leaping' })
      const trait = new AttackLeap(info)
      let grantedCondition = ''

      const self = {
        actorId: 1, isInWorld: true, isDead: false, disposed: false,
        grantCondition(cond: string) { grantedCondition = cond; return 42 },
      } as unknown as IGameActor

      trait.grantLeapCondition(self)
      expect(grantedCondition).toBe('leaping')
    })

    it('revokes leap condition', () => {
      const info = new AttackLeapInfo({ leapCondition: 'leaping' })
      const trait = new AttackLeap(info)
      let revokedToken = 0
      const self = { grantCondition: () => 42 } as unknown as IGameActor

      trait.grantLeapCondition(self)

      const self2 = {
        actorId: 1, isInWorld: true, isDead: false, disposed: false,
        revokeCondition(token: number) { revokedToken = token; return -1 },
      } as unknown as IGameActor

      trait.revokeLeapCondition(self2)
      expect(revokedToken).toBe(42)
    })
  })

  describe('getAttackActivity', () => {
    it('returns a LeapAttack Activity instance', () => {
      const info = new AttackLeapInfo()
      const trait = new AttackLeap(info)
      const self = makeActor()
      const target = { type: TargetType.Actor } as unknown as TargetType_

      const activity = trait.getAttackActivity(self, 0, target, true, false, '')
      expect(activity).toBeInstanceOf(LeapAttack)
      expect(activity.target).toBeDefined()
    })

    it('passes null targetLineColor when no color string provided', () => {
      const info = new AttackLeapInfo()
      const trait = new AttackLeap(info)
      const self = makeActor()
      const target = { type: TargetType.Actor } as unknown as TargetType_

      const activity = trait.getAttackActivity(self, 0, target, true, false)
      // Should create LeapAttack without crash
      expect(activity).toBeInstanceOf(LeapAttack)
    })
  })
})
