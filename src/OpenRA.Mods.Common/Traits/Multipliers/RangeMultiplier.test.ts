/**
 * RangeMultiplier.test.ts -- Unit tests for RangeMultiplier
 */

import { describe, it, expect } from 'vitest'
import { RangeMultiplier, RangeMultiplierInfo } from './RangeMultiplier.js'

describe('RangeMultiplier', () => {
  describe('RangeMultiplierInfo', () => {
    it('has default modifier of 100', () => {
      const info = new RangeMultiplierInfo()
      expect(info.modifier).toBe(100)
    })

    it('getRangeModifierDefault returns modifier when enabled', () => {
      const info = new RangeMultiplierInfo({ modifier: 150 })
      expect(info.getRangeModifierDefault()).toBe(150)
    })

    it('getRangeModifierDefault returns 100 when disabled', () => {
      const info = new RangeMultiplierInfo({ modifier: 150, enabledByDefault: false })
      expect(info.getRangeModifierDefault()).toBe(100)
    })
  })

  describe('RangeMultiplier trait', () => {
    it('returns modifier when not disabled', () => {
      const info = new RangeMultiplierInfo({ modifier: 150 })
      const trait = new RangeMultiplier(info)
      expect(trait.getRangeModifier()).toBe(150)
    })

    it('returns 100 when disabled', () => {
      const info = new RangeMultiplierInfo({ modifier: 150 })
      const trait = new RangeMultiplier(info)
      // Simulate disabled state via internal _enabled flag
      const internal = trait as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(trait.getRangeModifier()).toBe(100)
    })
  })
})
