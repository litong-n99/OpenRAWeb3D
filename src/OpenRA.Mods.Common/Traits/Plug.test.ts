/**
 * Plug.test.ts — Plug migration unit tests
 *
 * Tests focus on: PlugInfo configuration, Type field semantics,
 * default values, empty marker trait.
 */

import { describe, it, expect } from 'vitest'
import { PlugInfo, Plug } from './Plug.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlugInfo', () => {
  it('has correct default values', () => {
    const info = new PlugInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.type).toBeNull()
  })

  it('accepts type string', () => {
    const info = new PlugInfo({ type: 'turret' })
    expect(info.type).toBe('turret')
  })

  it('accepts instanceName', () => {
    const info = new PlugInfo({ instanceName: 'plug-1', type: 'weapon' })
    expect(info.instanceName).toBe('plug-1')
    expect(info.type).toBe('weapon')
  })

  it('type defaults to null', () => {
    const info = new PlugInfo()
    expect(info.type).toBeNull()
  })

  it('type can be explicit null', () => {
    const info = new PlugInfo({ type: null })
    expect(info.type).toBeNull()
  })

  it('type can be empty string', () => {
    const info = new PlugInfo({ type: '' })
    expect(info.type).toBe('')
  })
})

describe('Plug', () => {
  it('is constructible as empty marker trait', () => {
    const plug = new Plug()
    expect(plug).toBeInstanceOf(Plug)
  })

  it('has no public properties', () => {
    const plug = new Plug()
    const keys = Object.keys(plug)
    expect(keys).toEqual([])
  })
})
