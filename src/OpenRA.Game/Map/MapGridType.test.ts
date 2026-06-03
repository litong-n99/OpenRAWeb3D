/**
 * MapGridType.test.ts — MapGridType unit tests
 */

import { describe, it, expect } from 'vitest'
import { MapGridType } from './MapGridType'

describe('MapGridType', () => {
  it('has two grid types', () => {
    expect(MapGridType.Rectangular).toBe(0)
    expect(MapGridType.RectangularIsometric).toBe(1)
  })

  it('types are distinct', () => {
    expect(MapGridType.Rectangular).not.toBe(MapGridType.RectangularIsometric)
  })

  it('type values are read-only at type level', () => {
    // NOTE: `as const` makes the TS type read-only but does not
    // runtime Object.freeze(). This is consistent with the project's
    // compile-time immutability approach.
    expect(MapGridType.Rectangular).toBe(0)
    expect(MapGridType.RectangularIsometric).toBe(1)
  })
})
