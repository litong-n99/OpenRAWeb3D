/**
 * InaccuracyMultiplier.test.ts — InaccuracyMultiplier migration unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  InaccuracyMultiplier,
  InaccuracyMultiplierInfo,
} from './InaccuracyMultiplier.js'

describe('InaccuracyMultiplierInfo', () => {
  it('has default modifier of 100', () => {
    const info = new InaccuracyMultiplierInfo()
    expect(info.modifier).toBe(100)
  })

  it('getInaccuracyModifierDefault returns modifier when enabledByDefault', () => {
    const info = new InaccuracyMultiplierInfo({ modifier: 75 })
    expect(info.getInaccuracyModifierDefault()).toBe(75)
  })

  it('getInaccuracyModifierDefault returns 100 when not enabledByDefault', () => {
    const info = new InaccuracyMultiplierInfo({ modifier: 50, enabledByDefault: false })
    expect(info.getInaccuracyModifierDefault()).toBe(100)
  })
})

describe('InaccuracyMultiplier', () => {
  it('returns info.modifier when trait is enabled', () => {
    const info = new InaccuracyMultiplierInfo({ modifier: 200 })
    const multiplier = new InaccuracyMultiplier(info)
    expect(multiplier.getInaccuracyModifier()).toBe(200)
  })

  it('returns 100 when trait is disabled', () => {
    const info = new InaccuracyMultiplierInfo({ modifier: 50 })
    const multiplier = new InaccuracyMultiplier(info)
    ;(multiplier as unknown as { _enabled: boolean })._enabled = false
    expect(multiplier.getInaccuracyModifier()).toBe(100)
  })
})
