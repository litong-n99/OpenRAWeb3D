/**
 * AttackTesla.test.ts — unit tests for Tesla coil attack
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import { AttackTesla, AttackTeslaInfo } from './AttackTesla.js'
import type { Target as TargetType_ } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

const makeActor = (): IGameActor =>
  ({ actorId: 1, isInWorld: true, isDead: false, disposed: false }) as unknown as IGameActor

describe('AttackTesla', () => {
  describe('AttackTeslaInfo', () => {
    it('has correct defaults', () => {
      const info = new AttackTeslaInfo()
      expect(info.maxCharges).toBe(1)
      expect(info.reloadDelay).toBe(120)
      expect(info.initialChargeDelay).toBe(22)
      expect(info.chargeDelay).toBe(3)
      expect(info.chargeAudio).toBeNull()
    })
  })

  describe('constructor', () => {
    it('initializes with max charges', () => {
      const info = new AttackTeslaInfo({ maxCharges: 3 })
      const trait = new AttackTesla(info)
      expect(trait.getCharges()).toBe(3)
    })
  })

  describe('tick', () => {
    it('recharges when timer expires', () => {
      const info = new AttackTeslaInfo({ maxCharges: 2, reloadDelay: 5 })
      const trait = new AttackTesla(info)

      trait.onAttack()
      expect(trait.getCharges()).toBe(1)

      for (let i = 0; i < 5; i++) {
        trait.tick(makeActor())
      }
      expect(trait.getCharges()).toBe(2)
    })
  })

  describe('onAttack', () => {
    it('decrements charges and sets reload timer', () => {
      const info = new AttackTeslaInfo({ reloadDelay: 120 })
      const trait = new AttackTesla(info)

      trait.onAttack()
      expect(trait.getCharges()).toBe(0)
      expect(trait.getTimeToRecharge()).toBe(120)
    })
  })

  describe('getCharges / getTimeToRecharge', () => {
    it('returns current state', () => {
      const info = new AttackTeslaInfo({ maxCharges: 5 })
      const trait = new AttackTesla(info)
      expect(trait.getCharges()).toBe(5)
      expect(trait.getTimeToRecharge()).toBe(0)
      expect(trait.getChargeDelay()).toBe(3)
    })
  })

  describe('getAttackActivity', () => {
    it('returns ChargeAttack activity', () => {
      const info = new AttackTeslaInfo()
      const trait = new AttackTesla(info)
      const target = { type: 0 } as any

      const activity = trait.getAttackActivity(makeActor(), 0, target, false, false, '') as {
        tick?: () => boolean
        targetLineNodes?: () => unknown[]
      }
      expect(activity).toBeDefined()
      expect(typeof activity.tick).toBe('function')
    })
  })

  describe('canAttack', () => {
    it('returns false for invalid target', () => {
      const info = new AttackTeslaInfo()
      const trait = new AttackTesla(info)
      const target = { type: 0 } as any

      expect(trait.canAttack(makeActor(), target)).toBe(false)
    })
  })

  describe('playChargeAudio', () => {
    it('handles null charge audio gracefully', () => {
      const info = new AttackTeslaInfo({ chargeAudio: null })
      const trait = new AttackTesla(info)

      expect(() => trait.playChargeAudio(makeActor())).not.toThrow()
    })
  })

  describe('ChargeAttackActivity charge delays', () => {
    it('respects initialChargeDelay before first shot', () => {
      const info = new AttackTeslaInfo({
        maxCharges: 2,
        initialChargeDelay: 3,
        chargeDelay: 1,
        reloadDelay: 120,
      })
      const trait = new AttackTesla(info)
      // Force isTraitDisabled to false and hasAnyValidWeapons to true for unit test
      Object.defineProperty(trait, 'isTraitDisabled', { value: false, writable: true })
      ;(trait as any).hasAnyValidWeapons = () => true

      // Track doAttack calls
      let attackCount = 0
      const originalDoAttack = trait.doAttack.bind(trait)
      trait.doAttack = function (self: IGameActor, target: TargetType_) {
        attackCount++
        return originalDoAttack(self, target)
      }

      const self = makeActor()
      const target = { type: 1, isValidFor: () => true } as any // Actor type
      const activity = trait.getAttackActivity(self, 0, target, false, false, '') as {
        tick: (s: IGameActor) => boolean
      }

      // First 2 ticks: initialChargeDelay countdown (3 → 2 → 1)
      expect(activity.tick(self)).toBe(false) // tick 1: chargeTick 3→2 >0, return false
      expect(activity.tick(self)).toBe(false) // tick 2: chargeTick 2→1 >0, return false
      expect(attackCount).toBe(0) // No attack yet

      // Tick 3: chargeTick 1→0, initialChargeDelay expires, first shot fires
      expect(activity.tick(self)).toBe(false)
      expect(attackCount).toBe(1) // First attack fired
    })

    it('respects chargeDelay between shots', () => {
      const info = new AttackTeslaInfo({
        maxCharges: 2,
        initialChargeDelay: 1,
        chargeDelay: 2,
        reloadDelay: 120,
      })
      const trait = new AttackTesla(info)
      Object.defineProperty(trait, 'isTraitDisabled', { value: false, writable: true })
      ;(trait as any).hasAnyValidWeapons = () => true

      let attackCount = 0
      const originalDoAttack = trait.doAttack.bind(trait)
      trait.doAttack = function (self: IGameActor, target: TargetType_) {
        attackCount++
        return originalDoAttack(self, target)
      }

      const self = makeActor()
      const target = { type: 1, isValidFor: () => true } as any
      const activity = trait.getAttackActivity(self, 0, target, false, false, '') as {
        tick: (s: IGameActor) => boolean
      }

      // Tick 1: chargeTick 1→0, initialChargeDelay expires, first shot
      activity.tick(self)
      expect(attackCount).toBe(1)

      // Tick 2: chargeTick 2→1, chargeDelay countdown
      activity.tick(self)
      expect(attackCount).toBe(1) // Still 1

      // Tick 3: chargeTick 1→0, chargeDelay expires, second shot
      activity.tick(self)
      expect(attackCount).toBe(2) // Second attack fired
    })
  })
})
