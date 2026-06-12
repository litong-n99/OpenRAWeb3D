/**
 * FirepowerMultiplier.test.ts -- Unit tests for FirepowerMultiplier
 */

import { describe, it, expect } from 'vitest'
import { FirepowerMultiplier, FirepowerMultiplierInfo } from './FirepowerMultiplier.js'

describe('FirepowerMultiplier', () => {
  describe('FirepowerMultiplierInfo', () => {
    it('has default modifier of 100', () => {
      const info = new FirepowerMultiplierInfo()
      expect(info.modifier).toBe(100)
    })

    it('getFirepowerModifierDefault returns modifier when enabled', () => {
      const info = new FirepowerMultiplierInfo({ modifier: 200 })
      expect(info.getFirepowerModifierDefault()).toBe(200)
    })

    it('getFirepowerModifierDefault returns 100 when disabled', () => {
      const info = new FirepowerMultiplierInfo({ modifier: 200, enabledByDefault: false })
      expect(info.getFirepowerModifierDefault()).toBe(100)
    })
  })

  describe('FirepowerMultiplier trait', () => {
    it('returns modifier when not disabled', () => {
      const info = new FirepowerMultiplierInfo({ modifier: 200 })
      const trait = new FirepowerMultiplier(info)
      expect(trait.getFirepowerModifier()).toBe(200)
    })

    it('returns 100 when disabled', () => {
      const info = new FirepowerMultiplierInfo({ modifier: 200 })
      const trait = new FirepowerMultiplier(info)
      const internal = trait as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(trait.getFirepowerModifier()).toBe(100)
    })
  })
})
