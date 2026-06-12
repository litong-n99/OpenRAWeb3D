/**
 * ProtectionStates.test.ts — STUB unit tests for protection squad states
 */

import { describe, it, expect } from 'vitest'
import {
  UnitsForProtectionIdleState,
  UnitsForProtectionAttackState,
  UnitsForProtectionFleeState,
} from './ProtectionStates.js'

describe('ProtectionStates', () => {
  describe('UnitsForProtectionIdleState', () => {
    it('returns false from tick', () => {
      const s = new UnitsForProtectionIdleState()
      // Minimal squad duck-type
      const squad = { isValid: true } as Parameters<typeof s.tick>[0]
      expect(s.tick(squad)).toBe(false)
    })

    it('activate and deactivate are safe', () => {
      const s = new UnitsForProtectionIdleState()
      const squad = {} as Parameters<typeof s.activate>[0]
      expect(() => s.activate(squad)).not.toThrow()
      expect(() => s.deactivate(squad)).not.toThrow()
    })
  })

  describe('UnitsForProtectionAttackState', () => {
    it('returns false from tick', () => {
      const s = new UnitsForProtectionAttackState()
      const squad = { isValid: true } as Parameters<typeof s.tick>[0]
      expect(s.tick(squad)).toBe(false)
    })
  })

  describe('UnitsForProtectionFleeState', () => {
    it('returns false from tick', () => {
      const s = new UnitsForProtectionFleeState()
      const squad = { isValid: true } as Parameters<typeof s.tick>[0]
      expect(s.tick(squad)).toBe(false)
    })
  })
})
