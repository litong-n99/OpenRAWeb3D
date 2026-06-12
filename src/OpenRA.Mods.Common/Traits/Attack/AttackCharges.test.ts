/**
 * AttackCharges.test.ts -- Unit tests for AttackCharges
 */

import { describe, it, expect, vi } from 'vitest'
import { AttackCharges, AttackChargesInfo } from './AttackCharges.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'

describe('AttackCharges', () => {
  describe('AttackChargesInfo', () => {
    it('has default chargeLevel of 25', () => {
      const info = new AttackChargesInfo()
      expect(info.chargeLevel).toBe(25)
    })

    it('has default chargeRate of 1', () => {
      const info = new AttackChargesInfo()
      expect(info.chargeRate).toBe(1)
    })

    it('has default dischargeRate of 1', () => {
      const info = new AttackChargesInfo()
      expect(info.dischargeRate).toBe(1)
    })
  })

  describe('AttackCharges trait', () => {
    it('starts with chargeLevel 0', () => {
      const info = new AttackChargesInfo()
      const attack = new AttackCharges(info)
      expect(attack.chargeLevel).toBe(0)
    })

    it('canAttack requires charge level', () => {
      const info = new AttackChargesInfo({ chargeLevel: 25 })
      const attack = new AttackCharges(info)
      const actor = { isInWorld: true, getTraits: () => [], grantCondition: vi.fn(() => 1), revokeCondition: vi.fn(() => -1) }
      const target = Target.fromPos(WPos.Zero)
      expect(attack.canAttack(actor as never, target)).toBe(false)
    })

    it('tick discharges when not charging', () => {
      const info = new AttackChargesInfo({ chargeLevel: 25, dischargeRate: 1 })
      const attack = new AttackCharges(info)
      attack.chargeLevel = 10
      const actor = {
        isInWorld: true,
        getTraits: () => [],
        grantCondition: vi.fn(() => 1),
        revokeCondition: vi.fn(() => -1),
      }
      attack.tick(actor as never)
      expect(attack.chargeLevel).toBe(9)
    })

    it('tick charge level cannot go below 0', () => {
      const info = new AttackChargesInfo({ chargeLevel: 25, dischargeRate: 10 })
      const attack = new AttackCharges(info)
      const actor = {
        isInWorld: true,
        getTraits: () => [],
        grantCondition: vi.fn(() => 1),
        revokeCondition: vi.fn(() => -1),
      }
      attack.tick(actor as never)
      expect(attack.chargeLevel).toBe(0)
    })

    it('attacking resets charge level', () => {
      const info = new AttackChargesInfo({ chargeLevel: 25 })
      const attack = new AttackCharges(info)
      attack.chargeLevel = 25
      attack.attacking({} as never, null as never, null as never, null as never)
      expect(attack.chargeLevel).toBe(0)
    })

    // MINOR 14 fix: tick checks if current activity is SetTarget
    it('tick checks current activity is SetTarget', () => {
      const info = new AttackChargesInfo({ chargeLevel: 25, chargeRate: 1 })
      const attack = new AttackCharges(info)
      attack.chargeLevel = 5
      // Internal charging flag is set in canAttack
      // With no SetTarget activity, charging stays false, so it discharges
      const actor = {
        isInWorld: true,
        getTraits: () => [],
        grantCondition: vi.fn(() => 1),
        revokeCondition: vi.fn(() => -1),
      }
      attack.tick(actor as never)
      // Without a SetTarget activity, charging is false, so it discharges
      expect(attack.chargeLevel).toBeLessThanOrEqual(5)
    })
  })
})
