/**
 * PlaceBuildingVariants.test.ts — PlaceBuildingVariants migration unit tests
 *
 * Tests focus on: PlaceBuildingVariantsInfo configuration, default values,
 * Actors and Facings arrays, PlaceBuildingVariants empty marker trait
 * construction.
 */

import { describe, it, expect } from 'vitest'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import {
  PlaceBuildingVariantsInfo,
  PlaceBuildingVariants,
} from './PlaceBuildingVariants.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlaceBuildingVariantsInfo', () => {
  it('has correct default values', () => {
    const info = new PlaceBuildingVariantsInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.actors).toEqual([])
    expect(info.facings).toEqual([])
  })

  it('accepts actors array', () => {
    const info = new PlaceBuildingVariantsInfo({
      actors: ['powr', 'apwr'],
    })
    expect(info.actors).toEqual(['powr', 'apwr'])
    expect(info.actors).toHaveLength(2)
  })

  it('accepts facings array with WAngle values', () => {
    const facing0 = new WAngle(0)
    const facing256 = new WAngle(256)
    const info = new PlaceBuildingVariantsInfo({
      facings: [facing0, facing256],
    })
    expect(info.facings).toHaveLength(2)
    expect(info.facings[0]).toEqual(new WAngle(0))
    expect(info.facings[1]).toEqual(new WAngle(256))
  })

  it('accepts instanceName', () => {
    const info = new PlaceBuildingVariantsInfo({
      instanceName: 'variant-group-1',
    })
    expect(info.instanceName).toBe('variant-group-1')
  })

  it('facings length should be actors.length + 1 per OpenRA convention', () => {
    // Per OpenRA C#: Facings[0] = non-variant actor facing,
    // Facings[1..n] = facings for each variant actor
    const info = new PlaceBuildingVariantsInfo({
      actors: ['variant1', 'variant2', 'variant3'],
      facings: [
        new WAngle(0),    // base actor
        new WAngle(256),  // variant1
        new WAngle(512),  // variant2
        new WAngle(768),  // variant3
      ],
    })
    expect(info.facings.length).toBe(info.actors.length + 1)
  })

  it('empty actors and facings when no params provided', () => {
    const info = new PlaceBuildingVariantsInfo()
    expect(info.actors).toHaveLength(0)
    expect(info.facings).toHaveLength(0)
  })

  it('actors is readonly array', () => {
    const info = new PlaceBuildingVariantsInfo({ actors: ['a', 'b'] })
    expect(Array.isArray(info.actors)).toBe(true)
    expect(info.actors[0]).toBe('a')
    expect(info.actors[1]).toBe('b')
  })

  it('supports large actors array (many variants)', () => {
    const manyActors = Array.from({ length: 50 }, (_, i) => `building_v${i}`)
    const info = new PlaceBuildingVariantsInfo({ actors: manyActors })
    expect(info.actors).toHaveLength(50)
    expect(info.actors[0]).toBe('building_v0')
    expect(info.actors[49]).toBe('building_v49')
  })
})

describe('PlaceBuildingVariants', () => {
  it('is constructible as empty marker trait', () => {
    const trait = new PlaceBuildingVariants()
    expect(trait).toBeInstanceOf(PlaceBuildingVariants)
  })

  it('has no public user-defined properties', () => {
    const trait = new PlaceBuildingVariants()
    const keys = Object.keys(trait)
    expect(keys).toEqual([])
  })

  it('multiple instances are independent', () => {
    const trait1 = new PlaceBuildingVariants()
    const trait2 = new PlaceBuildingVariants()
    expect(trait1).not.toBe(trait2)
    expect(trait1).toBeInstanceOf(PlaceBuildingVariants)
    expect(trait2).toBeInstanceOf(PlaceBuildingVariants)
  })
})
