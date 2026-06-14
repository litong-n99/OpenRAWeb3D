/**
 * BaseBuilding.test.ts — BaseBuilding migration unit tests
 *
 * Tests focus on: BaseBuildingInfo configuration, default values,
 * BaseBuilding empty marker trait construction.
 */

import { describe, it, expect } from 'vitest'
import { BaseBuildingInfo, BaseBuilding } from './BaseBuilding.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseBuildingInfo', () => {
  it('has correct default values', () => {
    const info = new BaseBuildingInfo()
    expect(info.instanceName).toBeUndefined()
  })

  it('accepts instanceName', () => {
    const info = new BaseBuildingInfo({ instanceName: 'main-base' })
    expect(info.instanceName).toBe('main-base')
  })

  it('implements ITraitInfo interface', () => {
    const info = new BaseBuildingInfo()
    expect('instanceName' in info).toBe(true)
  })

  it('supports being constructed with empty params', () => {
    const info = new BaseBuildingInfo({})
    expect(info.instanceName).toBeUndefined()
  })

  it('is a marker trait info with no config fields', () => {
    const info = new BaseBuildingInfo()
    const keys = Object.keys(info)
    // Only instanceName should be present as a user-defined property
    expect(keys).toContain('instanceName')
    expect(keys).toHaveLength(1)
  })
})

describe('BaseBuilding', () => {
  it('is constructible as empty marker trait', () => {
    const trait = new BaseBuilding()
    expect(trait).toBeInstanceOf(BaseBuilding)
  })

  it('has no public user-defined properties', () => {
    const trait = new BaseBuilding()
    const keys = Object.keys(trait)
    expect(keys).toEqual([])
  })

  it('multiple instances are independent', () => {
    const trait1 = new BaseBuilding()
    const trait2 = new BaseBuilding()
    expect(trait1).not.toBe(trait2)
    expect(trait1).toBeInstanceOf(BaseBuilding)
    expect(trait2).toBeInstanceOf(BaseBuilding)
  })
})
