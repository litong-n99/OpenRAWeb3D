/**
 * RevealsShroudMultiplier.test.ts — RevealsShroudMultiplier migration unit tests
 *
 * Tests focus on: modifier value, disabled state, Info defaults
 */

import { describe, it, expect } from 'vitest'
import {
  RevealsShroudMultiplier,
  RevealsShroudMultiplierInfo,
} from './RevealsShroudMultiplier.js'

// ---------------------------------------------------------------------------
// RevealsShroudMultiplierInfo tests
// ---------------------------------------------------------------------------

describe('RevealsShroudMultiplierInfo', () => {
  it('has default modifier of 100', () => {
    const info = new RevealsShroudMultiplierInfo()
    expect(info.modifier).toBe(100)
  })

  it('accepts custom modifier', () => {
    const info = new RevealsShroudMultiplierInfo({ modifier: 50 })
    expect(info.modifier).toBe(50)
  })

  it('has default enabledByDefault of true', () => {
    const info = new RevealsShroudMultiplierInfo()
    expect(info.enabledByDefault).toBe(true)
  })

  it('accepts custom enabledByDefault', () => {
    const info = new RevealsShroudMultiplierInfo({ enabledByDefault: false })
    expect(info.enabledByDefault).toBe(false)
  })

  it('has undefined instanceName by default', () => {
    const info = new RevealsShroudMultiplierInfo()
    expect(info.instanceName).toBeUndefined()
  })

  it('accepts custom instanceName', () => {
    const info = new RevealsShroudMultiplierInfo({ instanceName: 'test-mod' })
    expect(info.instanceName).toBe('test-mod')
  })

  it('has undefined requiresCondition by default', () => {
    const info = new RevealsShroudMultiplierInfo()
    expect(info.requiresCondition).toBeUndefined()
  })

  it('accepts custom requiresCondition', () => {
    const info = new RevealsShroudMultiplierInfo({ requiresCondition: '!upgraded' })
    expect(info.requiresCondition).toBe('!upgraded')
  })

  it('uses 100 as modifier default when undefined is passed', () => {
    const info = new RevealsShroudMultiplierInfo({ modifier: undefined as unknown as number })
    expect(info.modifier).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// RevealsShroudMultiplier tests
// ---------------------------------------------------------------------------

describe('RevealsShroudMultiplier', () => {
  it('returns info.modifier when trait is enabled', () => {
    const info = new RevealsShroudMultiplierInfo({ modifier: 150 })
    const multiplier = new RevealsShroudMultiplier(info)
    expect(multiplier.getRevealsShroudModifier()).toBe(150)
  })

  it('returns 100 when trait is disabled', () => {
    const info = new RevealsShroudMultiplierInfo({ modifier: 50 })
    const multiplier = new RevealsShroudMultiplier(info)
    // Force trait disabled by setting internal _enabled to false
    ;(multiplier as unknown as { _enabled: boolean })._enabled = false
    expect(multiplier.getRevealsShroudModifier()).toBe(100)
  })

  it('isTraitDisabled reflects enabled state', () => {
    const info = new RevealsShroudMultiplierInfo({ modifier: 200 })
    const multiplier = new RevealsShroudMultiplier(info)
    expect(multiplier.isTraitDisabled).toBe(false)

    ;(multiplier as unknown as { _enabled: boolean })._enabled = false
    expect(multiplier.isTraitDisabled).toBe(true)
  })

  it('returns 100 for any modifier when trait is disabled', () => {
    const info = new RevealsShroudMultiplierInfo({ modifier: 0 })
    const multiplier = new RevealsShroudMultiplier(info)
    ;(multiplier as unknown as { _enabled: boolean })._enabled = false
    expect(multiplier.getRevealsShroudModifier()).toBe(100)
  })

  it('allows modifier of 0 (blind) when enabled', () => {
    const info = new RevealsShroudMultiplierInfo({ modifier: 0 })
    const multiplier = new RevealsShroudMultiplier(info)
    expect(multiplier.getRevealsShroudModifier()).toBe(0)
  })

  it('allows modifier > 100 for extended range', () => {
    const info = new RevealsShroudMultiplierInfo({ modifier: 200 })
    const multiplier = new RevealsShroudMultiplier(info)
    expect(multiplier.getRevealsShroudModifier()).toBe(200)
  })
})
