/**
 * RequiresBuildableArea.test.ts — RequiresBuildableArea migration unit tests
 *
 * Tests focus on: RequiresBuildableAreaInfo configuration, default values,
 * AreaTypes Set semantics, Adjacent default, RequiresBuildableArea empty
 * marker trait construction.
 */

import { describe, it, expect } from 'vitest'
import {
  RequiresBuildableAreaInfo,
  RequiresBuildableArea,
} from './RequiresBuildableArea.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RequiresBuildableAreaInfo', () => {
  it('has correct default values', () => {
    const info = new RequiresBuildableAreaInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.areaTypes).toEqual(new Set())
    expect(info.areaTypes.size).toBe(0)
    expect(info.adjacent).toBe(2)
  })

  it('accepts areaTypes as string array', () => {
    const info = new RequiresBuildableAreaInfo({
      areaTypes: ['building', 'defense'],
    })
    expect(info.areaTypes).toEqual(new Set(['building', 'defense']))
    expect(info.areaTypes.has('building')).toBe(true)
    expect(info.areaTypes.has('defense')).toBe(true)
    expect(info.areaTypes.has('naval')).toBe(false)
  })

  it('accepts custom adjacent value', () => {
    const info = new RequiresBuildableAreaInfo({ adjacent: 5 })
    expect(info.adjacent).toBe(5)
  })

  it('default adjacent is 2 (matches OpenRA C# default)', () => {
    const info = new RequiresBuildableAreaInfo()
    expect(info.adjacent).toBe(2)
  })

  it('accepts adjacent = 0 (must be adjacent to provider)', () => {
    const info = new RequiresBuildableAreaInfo({ adjacent: 0 })
    expect(info.adjacent).toBe(0)
  })

  it('accepts instanceName', () => {
    const info = new RequiresBuildableAreaInfo({ instanceName: 'power-plant-req' })
    expect(info.instanceName).toBe('power-plant-req')
  })

  it('areaTypes with single entry', () => {
    const info = new RequiresBuildableAreaInfo({ areaTypes: ['building'] })
    expect(info.areaTypes.size).toBe(1)
    expect(info.areaTypes.has('building')).toBe(true)
  })

  it('areaTypes with empty array has size 0', () => {
    const info = new RequiresBuildableAreaInfo({ areaTypes: [] })
    expect(info.areaTypes.size).toBe(0)
  })

  it('areaTypes is a Set supporting iteration', () => {
    const info = new RequiresBuildableAreaInfo({ areaTypes: ['a', 'b', 'c'] })
    const values = Array.from(info.areaTypes).sort()
    expect(values).toEqual(['a', 'b', 'c'])
  })

  it('adjacent accepts negative value (edge case)', () => {
    const info = new RequiresBuildableAreaInfo({ adjacent: -1 })
    expect(info.adjacent).toBe(-1)
  })
})

describe('RequiresBuildableArea', () => {
  it('is constructible as empty marker trait', () => {
    const trait = new RequiresBuildableArea()
    expect(trait).toBeInstanceOf(RequiresBuildableArea)
  })

  it('has no public user-defined properties', () => {
    const trait = new RequiresBuildableArea()
    const keys = Object.keys(trait)
    expect(keys).toEqual([])
  })

  it('multiple instances are independent', () => {
    const trait1 = new RequiresBuildableArea()
    const trait2 = new RequiresBuildableArea()
    expect(trait1).not.toBe(trait2)
    expect(trait1).toBeInstanceOf(RequiresBuildableArea)
    expect(trait2).toBeInstanceOf(RequiresBuildableArea)
  })
})
