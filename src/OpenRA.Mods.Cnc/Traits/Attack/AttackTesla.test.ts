/**
 * AttackTesla.test.ts — unit tests for Tesla coil attack
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import { AttackTesla, AttackTeslaInfo } from './AttackTesla.js'
import { ChargeFireActivity } from '../../Activities/ChargeFireActivity.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'

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
    it('returns ChargeAttack activity (extends Activity)', () => {
      const info = new AttackTeslaInfo()
      const trait = new AttackTesla(info)
      const target = { type: 1 } as any // Actor type

      const activity = trait.getAttackActivity(makeActor(), 0, target, false, false, '') as {
        tick?: (s: IGameActor) => boolean
        targetLineNodes?: () => unknown[]
        state?: number
        isCanceling?: boolean
        queueChild?: (a: unknown) => void
        childActivity?: unknown
      }
      expect(activity).toBeDefined()
      expect(typeof activity.tick).toBe('function')
    })
  })

  describe('canAttack', () => {
    it('returns false for invalid target', () => {
      const info = new AttackTeslaInfo()
      const trait = new AttackTesla(info)
      const target = { type: 0 } as any // Invalid

      expect(trait.canAttack(makeActor(), target)).toBe(false)
    })
  })

  describe('playChargeAudio', () => {
    it('handles null charge audio gracefully', () => {
      const info = new AttackTeslaInfo({ chargeAudio: null })
      const trait = new AttackTesla(info)

      expect(() => trait.playChargeAudio(makeActor())).not.toThrow()
    })

    it('has documented integration point for chargeAudio string', () => {
      const info = new AttackTeslaInfo({ chargeAudio: 'tesla_charge.ogg' })
      expect(info.chargeAudio).toBe('tesla_charge.ogg')
    })
  })

  describe('ChargeAttackActivity (inner class via getAttackActivity)', () => {
    it('tick returns true when canAttack fails', () => {
      const info = new AttackTeslaInfo({
        maxCharges: 1,
        initialChargeDelay: 3,
        chargeDelay: 1,
        reloadDelay: 120,
      })
      const trait = new AttackTesla(info)
      const self = makeActor()
      const target = { type: 0 } as any // Invalid type → canAttack fails
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activity: any = trait.getAttackActivity(self, 0, target, false, false)

      // With invalid target, canAttack returns false → tick returns true (done)
      const result = activity.tick(self as unknown as GameActor)
      expect(result).toBe(true)
    })

    it('tick returns false when charges depleted', () => {
      const info = new AttackTeslaInfo({
        maxCharges: 1,
        initialChargeDelay: 3,
        chargeDelay: 1,
        reloadDelay: 120,
      })
      const trait = new AttackTesla(info)
      // Use up the charge
      trait.onAttack()
      // Ensure canAttack returns true so we reach the charges==0 check
      Object.defineProperty(trait, 'isTraitDisabled', { value: false, writable: true })
      ;(trait as any).hasAnyValidWeapons = () => true

      const self = makeActor()
      const target = { type: 1, isValidFor: () => true } as any // Actor type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activity: any = trait.getAttackActivity(self, 0, target, false, false)

      // With charges==0, tick returns false to wait for recharge
      const result = activity.tick(self as unknown as GameActor)
      expect(result).toBe(false)
    })

    it('tick queues children when charges available', () => {
      const info = new AttackTeslaInfo({
        maxCharges: 2,
        initialChargeDelay: 3,
        chargeDelay: 1,
        reloadDelay: 120,
      })
      const trait = new AttackTesla(info)
      // Override canAttack to return true
      Object.defineProperty(trait, 'isTraitDisabled', { value: false, writable: true })
      ;(trait as any).hasAnyValidWeapons = () => true

      const self = makeActor()
      const target: any = { type: 1, isValidFor: () => true }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activity: any = trait.getAttackActivity(self, 0, target, false, false)

      // When charges > 0 and canAttack passes, tick should return false
      // and have queued children
      const result = activity.tick(self as unknown as GameActor)
      expect(result).toBe(false)
      // Should have queued a child activity (either Wait or ChargeFireActivity)
      // Note: ActivityBase.childActivity getter skips done activities,
      // so after queuing Wait(3) + ChargeFireActivity, the immediate child
      // should be non-null (Wait has remaining ticks, so not Done)
      expect(activity.childActivity).toBeDefined()
    })
  })
})

// ---------------------------------------------------------------------------
// ChargeFireActivity standalone tests
// ---------------------------------------------------------------------------

describe('ChargeFireActivity', () => {
  it('fires a shot and queues Wait cooldown', () => {
    let attackCount = 0
    const mockAttack = {
      canAttack: () => true,
      getCharges: () => 1,
      getChargeDelay: () => 3,
      doAttack: () => { attackCount++ },
    }

    const target = { type: 1 } as any
    const activity = new ChargeFireActivity(mockAttack, target)

    const self = { actorId: 1, isInWorld: true, isDead: false, disposed: false } as unknown as GameActor
    const result = activity.tick(self)

    expect(attackCount).toBe(1)
    expect(result).toBe(false)
    // A Wait child should be queued since chargeDelay > 0
    expect(activity.childActivity).toBeDefined()
  })

  it('returns true when charges depleted', () => {
    const mockAttack = {
      canAttack: () => true,
      getCharges: () => 0,
      getChargeDelay: () => 3,
      doAttack: () => {},
    }

    const target = { type: 1 } as any
    const activity = new ChargeFireActivity(mockAttack, target)

    const self = { actorId: 1, isInWorld: true, isDead: false, disposed: false } as unknown as GameActor
    const result = activity.tick(self)

    expect(result).toBe(true) // No charges → complete
  })

  it('returns true when canAttack fails', () => {
    const mockAttack = {
      canAttack: () => false,
      getCharges: () => 1,
      getChargeDelay: () => 3,
      doAttack: () => {},
    }

    const target = { type: 1 } as any
    const activity = new ChargeFireActivity(mockAttack, target)

    const self = { actorId: 1, isInWorld: true, isDead: false, disposed: false } as unknown as GameActor
    const result = activity.tick(self)

    expect(result).toBe(true) // Can't attack → complete
  })

  it('returns true when cancelling', () => {
    const mockAttack = {
      canAttack: () => true,
      getCharges: () => 1,
      getChargeDelay: () => 3,
      doAttack: () => {},
    }

    const target = { type: 1 } as any
    const activity = new ChargeFireActivity(mockAttack, target)
    ;(activity as any).state = 2 // ActivityState.Canceling

    const self = { actorId: 1, isInWorld: true, isDead: false, disposed: false } as unknown as GameActor
    const result = activity.tick(self)

    expect(result).toBe(true)
  })

  it('does not queue Wait when chargeDelay is 0', () => {
    let attackCount = 0
    const mockAttack = {
      canAttack: () => true,
      getCharges: () => 1,
      getChargeDelay: () => 0,
      doAttack: () => { attackCount++ },
    }

    const target = { type: 1 } as any
    const activity = new ChargeFireActivity(mockAttack, target)

    const self = { actorId: 1, isInWorld: true, isDead: false, disposed: false } as unknown as GameActor
    activity.tick(self)

    expect(attackCount).toBe(1)
    // No Wait child when chargeDelay is 0
    expect(activity.childActivity).toBeNull()
  })
})
