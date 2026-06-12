/**
 * Armor.test.ts -- Unit tests for Armor trait
 */

import { describe, it, expect } from 'vitest'
import { Armor, ArmorInfo } from './Armor.js'

describe('Armor', () => {
  describe('ArmorInfo', () => {
    it('has default type of empty string', () => {
      const info = new ArmorInfo()
      expect(info.type).toBe('')
    })

    it('accepts custom type', () => {
      const info = new ArmorInfo({ type: 'Heavy' })
      expect(info.type).toBe('Heavy')
    })

    it('accepts requiresCondition', () => {
      const info = new ArmorInfo({ type: 'Light', requiresCondition: 'upgraded' })
      expect(info.type).toBe('Light')
      expect(info.requiresCondition).toBe('upgraded')
    })
  })

  describe('Armor trait', () => {
    it('is created with info', () => {
      const info = new ArmorInfo({ type: 'Heavy' })
      const armor = new Armor(info)
      expect(armor.info.type).toBe('Heavy')
      expect(armor.isTraitDisabled).toBe(false)
    })

    it('is a ConditionalTrait', () => {
      const info = new ArmorInfo({ type: 'Light', requiresCondition: '!disabled' })
      const armor = new Armor(info)
      expect(armor.isTraitDisabled).toBe(false)
    })
  })
})
