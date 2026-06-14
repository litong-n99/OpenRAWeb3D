/**
 * PrimaryBuilding.test.ts — PrimaryBuilding migration unit tests
 *
 * Tests focus on:
 * - PrimaryBuildingInfo defaults and custom constructor params
 * - PrimaryBuilding setPrimaryProducer grants/revokes primary state
 * - PrimaryBuilding traitDisabled auto-unsets primary
 * - PrimaryExts.isPrimaryBuilding returns correct state
 * - Edge cases: null trait, disabled trait, no condition configured
 */

import { describe, it, expect } from 'vitest'
import { PrimaryBuilding, PrimaryBuildingInfo, PrimaryExts } from './PrimaryBuilding'

// ---------------------------------------------------------------------------
// PrimaryBuildingInfo
// ---------------------------------------------------------------------------

describe('PrimaryBuildingInfo', () => {
  it('defaults primaryCondition to null', () => {
    const info = new PrimaryBuildingInfo()
    expect(info.primaryCondition).toBeNull()
  })

  it('defaults selectionNotification to null', () => {
    const info = new PrimaryBuildingInfo()
    expect(info.selectionNotification).toBeNull()
  })

  it('defaults selectionTextNotification to null', () => {
    const info = new PrimaryBuildingInfo()
    expect(info.selectionTextNotification).toBeNull()
  })

  it('defaults productionQueues to empty array', () => {
    const info = new PrimaryBuildingInfo()
    expect(info.productionQueues).toEqual([])
  })

  it('defaults cursor to "deploy"', () => {
    const info = new PrimaryBuildingInfo()
    expect(info.cursor).toBe('deploy')
  })

  it('accepts custom productionQueues', () => {
    const info = new PrimaryBuildingInfo({ productionQueues: ['Vehicle', 'Infantry'] })
    expect(info.productionQueues).toEqual(['Vehicle', 'Infantry'])
  })
})

// ---------------------------------------------------------------------------
// PrimaryBuilding
// ---------------------------------------------------------------------------

describe('PrimaryBuilding', () => {
  it('is not primary by default', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    expect(pb.isPrimary).toBe(false)
  })

  it('is not disabled by default', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    expect(pb.isTraitDisabled).toBe(false)
  })

  it('setPrimaryProducer sets isPrimary to true', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    pb.setPrimaryProducer(true)
    expect(pb.isPrimary).toBe(true)
  })

  it('setPrimaryProducer sets isPrimary to false', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    pb.setPrimaryProducer(true)
    pb.setPrimaryProducer(false)
    expect(pb.isPrimary).toBe(false)
  })

  it('traitDisabled unsets primary if active', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    pb.setPrimaryProducer(true)
    expect(pb.isPrimary).toBe(true)
    pb.traitDisabled()
    expect(pb.isPrimary).toBe(false)
  })

  it('traitDisabled does nothing if not primary', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    pb.traitDisabled()
    expect(pb.isPrimary).toBe(false)
  })

  it('traitEnabled does not change state', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    pb.traitEnabled()
    expect(pb.isPrimary).toBe(false)
  })

  it('stores the info reference', () => {
    const info = new PrimaryBuildingInfo({ cursor: 'custom' })
    const pb = new PrimaryBuilding(info)
    expect(pb.info).toBe(info)
  })
})

// ---------------------------------------------------------------------------
// PrimaryExts
// ---------------------------------------------------------------------------

describe('PrimaryExts', () => {
  it('isPrimaryBuilding returns false for null', () => {
    expect(PrimaryExts.isPrimaryBuilding(null)).toBe(false)
  })

  it('isPrimaryBuilding returns false when not primary', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    expect(PrimaryExts.isPrimaryBuilding(pb)).toBe(false)
  })

  it('isPrimaryBuilding returns true when primary and enabled', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    pb.setPrimaryProducer(true)
    expect(PrimaryExts.isPrimaryBuilding(pb)).toBe(true)
  })

  it('isPrimaryBuilding returns false when primary but disabled', () => {
    const pb = new PrimaryBuilding(new PrimaryBuildingInfo())
    pb.setPrimaryProducer(true)
    pb.isTraitDisabled = true
    expect(PrimaryExts.isPrimaryBuilding(pb)).toBe(false)
  })
})
