/**
 * ResourceValueMultiplier.test.ts — Unit tests for ResourceValueMultiplier
 *
 * Tests focus on: default modifier value, modifier return when enabled vs disabled,
 * info default construction.
 */

import { describe, it, expect } from 'vitest'
import { ResourceValueMultiplier, ResourceValueMultiplierInfo } from './ResourceValueMultiplier.js'

describe('ResourceValueMultiplier', () => {
  // ---------------------------------------------------------------------------
  // ResourceValueMultiplierInfo tests
  // ---------------------------------------------------------------------------

  describe('ResourceValueMultiplierInfo', () => {
    it('has default modifier of 100', () => {
      const info = new ResourceValueMultiplierInfo()
      expect(info.modifier).toBe(100)
    })

    it('accepts custom modifier', () => {
      const info = new ResourceValueMultiplierInfo({ modifier: 200 })
      expect(info.modifier).toBe(200)
    })

    it('has undefined requiresCondition by default', () => {
      const info = new ResourceValueMultiplierInfo()
      expect(info.requiresCondition).toBeUndefined()
    })

    it('accepts requiresCondition', () => {
      const info = new ResourceValueMultiplierInfo({ requiresCondition: '!disabled' })
      expect(info.requiresCondition).toBe('!disabled')
    })

    it('has undefined instanceName by default', () => {
      const info = new ResourceValueMultiplierInfo()
      expect(info.instanceName).toBeUndefined()
    })

    it('accepts instanceName', () => {
      const info = new ResourceValueMultiplierInfo({ instanceName: 'purifier' })
      expect(info.instanceName).toBe('purifier')
    })
  })

  // ---------------------------------------------------------------------------
  // ResourceValueMultiplier trait tests
  // ---------------------------------------------------------------------------

  describe('ResourceValueMultiplier trait', () => {
    it('returns modifier when enabled', () => {
      const info = new ResourceValueMultiplierInfo({ modifier: 200 })
      const trait = new ResourceValueMultiplier(info)
      expect(trait.getResourceValueModifier()).toBe(200)
    })

    it('returns 100 when disabled', () => {
      const info = new ResourceValueMultiplierInfo({ modifier: 200 })
      const trait = new ResourceValueMultiplier(info)
      // Simulate disabled state via internal _enabled flag
      const internal = trait as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(trait.getResourceValueModifier()).toBe(100)
    })

    it('returns default modifier of 100 when enabled with default info', () => {
      const info = new ResourceValueMultiplierInfo()
      const trait = new ResourceValueMultiplier(info)
      expect(trait.getResourceValueModifier()).toBe(100)
    })

    it('returns 100 when disabled even with custom modifier', () => {
      const info = new ResourceValueMultiplierInfo({ modifier: 0 })
      const trait = new ResourceValueMultiplier(info)
      const internal = trait as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(trait.getResourceValueModifier()).toBe(100)
    })

    it('implements IResourceValueModifier interface', () => {
      const info = new ResourceValueMultiplierInfo({ modifier: 150 })
      const trait = new ResourceValueMultiplier(info)
      expect(typeof trait.getResourceValueModifier).toBe('function')
    })

    it('extends ConditionalTrait', () => {
      const info = new ResourceValueMultiplierInfo()
      const trait = new ResourceValueMultiplier(info)
      expect(trait.isTraitDisabled).toBe(false)
      expect(trait.info).toBe(info)
    })
  })
})
