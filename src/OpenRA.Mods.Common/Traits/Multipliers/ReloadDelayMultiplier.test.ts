/**
 * ReloadDelayMultiplier.test.ts — ReloadDelayMultiplier migration unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  ReloadDelayMultiplier,
  ReloadDelayMultiplierInfo,
} from './ReloadDelayMultiplier.js'

describe('ReloadDelayMultiplierInfo', () => {
  it('has default modifier of 100', () => {
    const info = new ReloadDelayMultiplierInfo()
    expect(info.modifier).toBe(100)
  })

  it('getReloadModifierDefault returns modifier when enabledByDefault', () => {
    const info = new ReloadDelayMultiplierInfo({ modifier: 75 })
    expect(info.getReloadModifierDefault()).toBe(75)
  })

  it('getReloadModifierDefault returns 100 when not enabledByDefault', () => {
    const info = new ReloadDelayMultiplierInfo({ modifier: 50, enabledByDefault: false })
    expect(info.getReloadModifierDefault()).toBe(100)
  })
})

describe('ReloadDelayMultiplier', () => {
  it('returns info.modifier when trait is enabled', () => {
    const info = new ReloadDelayMultiplierInfo({ modifier: 200 })
    const multiplier = new ReloadDelayMultiplier(info)
    expect(multiplier.getReloadModifier()).toBe(200)
  })

  it('returns 100 when trait is disabled', () => {
    const info = new ReloadDelayMultiplierInfo({ modifier: 50 })
    const multiplier = new ReloadDelayMultiplier(info)
    ;(multiplier as unknown as { _enabled: boolean })._enabled = false
    expect(multiplier.getReloadModifier()).toBe(100)
  })
})
