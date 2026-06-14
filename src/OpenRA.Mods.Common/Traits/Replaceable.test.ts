/**
 * Replaceable.test.ts — Replaceable migration unit tests
 *
 * Tests focus on: ReplaceableInfo configuration, default values,
 * Types Set semantics, ConditionalTrait integration.
 */

import { describe, it, expect } from 'vitest'
import { ReplaceableInfo, Replaceable } from './Replaceable.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReplaceableInfo', () => {
  it('has correct default values', () => {
    const info = new ReplaceableInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.requiresCondition).toBeUndefined()
    expect(info.types).toEqual(new Set())
    expect(info.types.size).toBe(0)
  })

  it('accepts types as string array', () => {
    const info = new ReplaceableInfo({ types: ['Building', 'Defense'] })
    expect(info.types.has('Building')).toBe(true)
    expect(info.types.has('Defense')).toBe(true)
    expect(info.types.has('Infantry')).toBe(false)
    expect(info.types.size).toBe(2)
  })

  it('accepts instanceName and requiresCondition', () => {
    const info = new ReplaceableInfo({
      instanceName: 'replace-me',
      requiresCondition: '!upgraded',
      types: ['Temporary'],
    })
    expect(info.instanceName).toBe('replace-me')
    expect(info.requiresCondition).toBe('!upgraded')
    expect(info.types.has('Temporary')).toBe(true)
  })

  it('empty types when no params', () => {
    const info = new ReplaceableInfo()
    expect(info.types.size).toBe(0)
  })

  it('types is a Set with has() semantics', () => {
    const info = new ReplaceableInfo({ types: ['Wall', 'Gate'] })
    expect(info.types.has('Wall')).toBe(true)
    expect(info.types.has('Gate')).toBe(true)
    expect(info.types.has('Bunker')).toBe(false)
  })
})

describe('Replaceable', () => {
  it('is constructible with info', () => {
    const info = new ReplaceableInfo({ types: ['Building'] })
    const trait = new Replaceable(info)
    expect(trait).toBeInstanceOf(Replaceable)
    expect(trait.info).toBe(info)
  })

  it('extends ConditionalTrait with default enabled state', () => {
    const info = new ReplaceableInfo({ types: ['Building'] })
    const trait = new Replaceable(info)
    // By default, no condition = enabled
    expect(trait.isTraitDisabled).toBe(false)
  })

  it('ConditionalTrait info property is correctly set', () => {
    const info = new ReplaceableInfo({ types: ['test-type'] })
    const trait = new Replaceable(info)
    expect(trait.info.types.has('test-type')).toBe(true)
  })

  it('info.types is read via trait.info', () => {
    const info = new ReplaceableInfo({ types: ['A', 'B'] })
    const trait = new Replaceable(info)
    expect(trait.info.types.size).toBe(2)
    expect(trait.info.types.has('A')).toBe(true)
    expect(trait.info.types.has('B')).toBe(true)
  })
})
