/**
 * Replacement.test.ts — Replacement migration unit tests
 *
 * Tests focus on: ReplacementInfo configuration, default values,
 * ReplaceableTypes Set semantics, empty marker trait.
 */

import { describe, it, expect } from 'vitest'
import { ReplacementInfo, Replacement } from './Replacement.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReplacementInfo', () => {
  it('has correct default values', () => {
    const info = new ReplacementInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.replaceableTypes).toEqual(new Set())
    expect(info.replaceableTypes.size).toBe(0)
  })

  it('accepts replaceableTypes as string array', () => {
    const info = new ReplacementInfo({
      replaceableTypes: ['Building', 'Defense'],
    })
    expect(info.replaceableTypes.has('Building')).toBe(true)
    expect(info.replaceableTypes.has('Defense')).toBe(true)
    expect(info.replaceableTypes.has('Infantry')).toBe(false)
    expect(info.replaceableTypes.size).toBe(2)
  })

  it('accepts instanceName', () => {
    const info = new ReplacementInfo({ instanceName: 'replacer-1' })
    expect(info.instanceName).toBe('replacer-1')
  })

  it('empty replaceableTypes when no params', () => {
    const info = new ReplacementInfo()
    expect(info.replaceableTypes.size).toBe(0)
  })

  it('replaceableTypes is a Set with has() semantics', () => {
    const info = new ReplacementInfo({
      replaceableTypes: ['Bunker', 'Turret'],
    })
    expect(info.replaceableTypes.has('Bunker')).toBe(true)
    expect(info.replaceableTypes.has('Turret')).toBe(true)
    expect(info.replaceableTypes.has('Wall')).toBe(false)
  })
})

describe('Replacement', () => {
  it('is constructible as empty marker trait', () => {
    const replacement = new Replacement()
    expect(replacement).toBeInstanceOf(Replacement)
  })

  it('has no public properties', () => {
    const replacement = new Replacement()
    const keys = Object.keys(replacement)
    expect(keys).toEqual([])
  })
})
