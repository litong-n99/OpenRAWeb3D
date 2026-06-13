/**
 * ElevatedBridgePlaceholder.test.ts — unit tests for ElevatedBridgePlaceholder
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: configuration, bridge cell computation, end cell computation,
 * orientation handling, and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'
import {
  ElevatedBridgePlaceholderInfo,
  ElevatedBridgePlaceholder,
  ElevatedBridgePlaceholderOrientation,
} from './ElevatedBridgePlaceholder'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ElevatedBridgePlaceholderInfo', () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  it('constructs with required fields', () => {
    const info = new ElevatedBridgePlaceholderInfo({
      location: new CPos(10, 20),
      orientation: ElevatedBridgePlaceholderOrientation.X,
      length: 5,
      height: 3,
    })

    expect(info.Location.equals(new CPos(10, 20))).toBe(true)
    expect(info.Orientation).toBe(ElevatedBridgePlaceholderOrientation.X)
    expect(info.Length).toBe(5)
    expect(info.Height).toBe(3)
  })

  it('defaults TerrainType to "Road"', () => {
    const info = new ElevatedBridgePlaceholderInfo({
      location: new CPos(0, 0),
      orientation: ElevatedBridgePlaceholderOrientation.X,
      length: 1,
      height: 1,
    })

    expect(info.TerrainType).toBe('Road')
  })

  it('allows custom TerrainType', () => {
    const info = new ElevatedBridgePlaceholderInfo({
      location: new CPos(0, 0),
      orientation: ElevatedBridgePlaceholderOrientation.X,
      length: 1,
      height: 1,
      terrainType: 'Bridge',
    })

    expect(info.TerrainType).toBe('Bridge')
  })

  // -------------------------------------------------------------------------
  // BridgeCells — X orientation
  // -------------------------------------------------------------------------

  it('bridgeCells X orientation computes correct footprint', () => {
    const info = new ElevatedBridgePlaceholderInfo({
      location: new CPos(5, 5),
      orientation: ElevatedBridgePlaceholderOrientation.X,
      length: 3, // 4 cells long (Length+1), 3 cells wide
      height: 2,
    })

    const cells = info.bridgeCells()

    // Should be (Length+1) * 3 = 4 * 3 = 12 cells
    expect(cells.length).toBe(12)

    // First cell at location
    expect(cells[0].equals(new CPos(5, 5))).toBe(true)
    // Last cell at location + (Length, 2)
    expect(cells[11].equals(CPos.add(new CPos(5, 5), new CVec(3, 2)))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // BridgeCells — Y orientation
  // -------------------------------------------------------------------------

  it('bridgeCells Y orientation computes correct footprint', () => {
    const info = new ElevatedBridgePlaceholderInfo({
      location: new CPos(5, 5),
      orientation: ElevatedBridgePlaceholderOrientation.Y,
      length: 3, // 3 cells wide, 4 cells long (Length+1)
      height: 2,
    })

    const cells = info.bridgeCells()

    // Should be 3 * (Length+1) = 3 * 4 = 12 cells
    expect(cells.length).toBe(12)

    // First cell at location
    expect(cells[0].equals(new CPos(5, 5))).toBe(true)
    // Last cell at location + (2, Length)
    expect(cells[11].equals(CPos.add(new CPos(5, 5), new CVec(2, 3)))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // EndCells — X orientation
  // -------------------------------------------------------------------------

  it('endCells X orientation returns 6 cells (2 ends * 3 wide)', () => {
    const info = new ElevatedBridgePlaceholderInfo({
      location: new CPos(10, 10),
      orientation: ElevatedBridgePlaceholderOrientation.X,
      length: 4,
      height: 1,
    })

    const ends = info.endCells()

    // 2 ends * 3 cells = 6 end cells
    expect(ends.length).toBe(6)

    // Left end: (10, 10), (10, 11), (10, 12)
    expect(ends.some((c) => c.equals(new CPos(10, 10)))).toBe(true)
    expect(ends.some((c) => c.equals(new CPos(10, 11)))).toBe(true)
    expect(ends.some((c) => c.equals(new CPos(10, 12)))).toBe(true)

    // Right end: (14, 10), (14, 11), (14, 12)  -- Location + (Length, y)
    expect(ends.some((c) => c.equals(new CPos(14, 10)))).toBe(true)
    expect(ends.some((c) => c.equals(new CPos(14, 11)))).toBe(true)
    expect(ends.some((c) => c.equals(new CPos(14, 12)))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // EndCells — Y orientation
  // -------------------------------------------------------------------------

  it('endCells Y orientation returns 6 cells (2 ends * 3 wide)', () => {
    const info = new ElevatedBridgePlaceholderInfo({
      location: new CPos(10, 10),
      orientation: ElevatedBridgePlaceholderOrientation.Y,
      length: 4,
      height: 1,
    })

    const ends = info.endCells()

    expect(ends.length).toBe(6)

    // Top end: (10, 10), (11, 10), (12, 10)
    expect(ends.some((c) => c.equals(new CPos(10, 10)))).toBe(true)
    expect(ends.some((c) => c.equals(new CPos(11, 10)))).toBe(true)
    expect(ends.some((c) => c.equals(new CPos(12, 10)))).toBe(true)

    // Bottom end: (10, 14), (11, 14), (12, 14)
    expect(ends.some((c) => c.equals(new CPos(10, 14)))).toBe(true)
    expect(ends.some((c) => c.equals(new CPos(11, 14)))).toBe(true)
    expect(ends.some((c) => c.equals(new CPos(12, 14)))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('bridgeCells with length 0 returns 3 cells (1x3 footprint)', () => {
    const info = new ElevatedBridgePlaceholderInfo({
      location: new CPos(0, 0),
      orientation: ElevatedBridgePlaceholderOrientation.X,
      length: 0,
      height: 1,
    })

    const cells = info.bridgeCells()

    // Length 0: 1 cell long * 3 cells wide = 3 cells
    expect(cells.length).toBe(3)
    expect(cells[0].equals(new CPos(0, 0))).toBe(true)
    expect(cells[2].equals(new CPos(0, 2))).toBe(true)
  })

  it('instanceName is optional', () => {
    const infoWithout = new ElevatedBridgePlaceholderInfo({
      location: new CPos(0, 0),
      orientation: ElevatedBridgePlaceholderOrientation.X,
      length: 1,
      height: 1,
    })
    expect(infoWithout.instanceName).toBeUndefined()

    const infoWith = new ElevatedBridgePlaceholderInfo({
      location: new CPos(0, 0),
      orientation: ElevatedBridgePlaceholderOrientation.X,
      length: 1,
      height: 1,
      instanceName: 'bridge1',
    })
    expect(infoWith.instanceName).toBe('bridge1')
  })
})

describe('ElevatedBridgePlaceholder', () => {
  it('is an empty class (data lives in Info)', () => {
    const placeholder = new ElevatedBridgePlaceholder()
    expect(placeholder).toBeDefined()

    // Should have no own properties of significance
    const keys = Object.keys(placeholder)
    // No public members defined — verify there are no own enumerable properties
    expect(keys.length).toBe(0)
  })
})

describe('ElevatedBridgePlaceholderOrientation', () => {
  it('has X and Y values', () => {
    expect(ElevatedBridgePlaceholderOrientation.X).toBe(0)
    expect(ElevatedBridgePlaceholderOrientation.Y).toBe(1)
  })

  it('X and Y are distinct', () => {
    expect(ElevatedBridgePlaceholderOrientation.X).not.toBe(
      ElevatedBridgePlaceholderOrientation.Y,
    )
  })
})
