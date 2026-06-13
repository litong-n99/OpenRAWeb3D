/**
 * SpeedMultiplier.test.ts -- Unit tests for SpeedMultiplier
 *
 * Tests focus on: modifier values, ISpeedModifier compliance,
 * enabled/disabled state transitions.
 */

import { describe, it, expect } from 'vitest'
import { SpeedMultiplier, SpeedMultiplierInfo, type ISpeedModifier } from './SpeedMultiplier.js'

describe('SpeedMultiplier', () => {
  // ---------------------------------------------------------------------------
  // SpeedMultiplierInfo tests
  // ---------------------------------------------------------------------------

  describe('SpeedMultiplierInfo', () => {
    it('has default modifier of 100', () => {
      const info = new SpeedMultiplierInfo()
      expect(info.modifier).toBe(100)
    })

    it('accepts custom modifier value', () => {
      const info = new SpeedMultiplierInfo({ modifier: 150 })
      expect(info.modifier).toBe(150)
    })

    it('accepts zero modifier (stops movement)', () => {
      const info = new SpeedMultiplierInfo({ modifier: 0 })
      expect(info.modifier).toBe(0)
    })

    it('accepts negative modifier', () => {
      const info = new SpeedMultiplierInfo({ modifier: -50 })
      expect(info.modifier).toBe(-50)
    })

    it('accepts requiresCondition', () => {
      const info = new SpeedMultiplierInfo({ requiresCondition: 'powered' })
      expect(info.requiresCondition).toBe('powered')
    })
  })

  // ---------------------------------------------------------------------------
  // SpeedMultiplier trait tests
  // ---------------------------------------------------------------------------

  describe('SpeedMultiplier', () => {
    it('returns modifier from getSpeedModifier when enabled', () => {
      const info = new SpeedMultiplierInfo({ modifier: 150 })
      const sm = new SpeedMultiplier(info)
      expect(sm.getSpeedModifier()).toBe(150)
    })

    it('returns 100 from getSpeedModifier when disabled', () => {
      const info = new SpeedMultiplierInfo({ modifier: 150 })
      const sm = new SpeedMultiplier(info)
      // Manually disable by simulating traitDisabled
      sm['traitDisabled']({} as never)
      expect(sm.getSpeedModifier()).toBe(100)
    })

    it('returns 100 from getSpeedModifier when re-enabled after disabled', () => {
      const info = new SpeedMultiplierInfo({ modifier: 150 })
      const sm = new SpeedMultiplier(info)
      sm['traitDisabled']({} as never)
      expect(sm.getSpeedModifier()).toBe(100)
      sm['traitEnabled']({} as never)
      expect(sm.getSpeedModifier()).toBe(150)
    })

    it('default modifier is 100', () => {
      const info = new SpeedMultiplierInfo()
      const sm = new SpeedMultiplier(info)
      expect(sm.getSpeedModifier()).toBe(100)
    })

    it('implements ISpeedModifier interface', () => {
      const info = new SpeedMultiplierInfo({ modifier: 200 })
      const sm = new SpeedMultiplier(info)
      const modifier: ISpeedModifier = sm
      expect(modifier.getSpeedModifier()).toBe(200)
    })
  })
})
