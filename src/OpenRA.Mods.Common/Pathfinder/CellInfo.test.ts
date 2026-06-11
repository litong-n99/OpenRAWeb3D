/**
 * CellInfo.test.ts — CellStatus enum and CellInfo unit tests
 *
 * Tests focus on: enum values, CellInfo construction, validation, unvisited factory.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { CellInfo, CellStatus } from './CellInfo'

// ---------------------------------------------------------------------------
// CellStatus tests
// ---------------------------------------------------------------------------

describe('CellStatus', () => {
  it('has correct enum values', () => {
    expect(CellStatus.Unvisited).toBe(0)
    expect(CellStatus.Open).toBe(1)
    expect(CellStatus.Closed).toBe(2)
  })

  it('values are unique', () => {
    const values = new Set([
      CellStatus.Unvisited,
      CellStatus.Open,
      CellStatus.Closed,
    ])
    expect(values.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// CellInfo construction tests
// ---------------------------------------------------------------------------

describe('CellInfo', () => {
  it('constructs with Open status', () => {
    const prev = new CPos(0, 0)
    const info = new CellInfo(CellStatus.Open, 5, 15, prev)

    expect(info.Status).toBe(CellStatus.Open)
    expect(info.CostSoFar).toBe(5)
    expect(info.EstimatedTotalCost).toBe(15)
    expect(info.PreviousNode).toBe(prev)
  })

  it('constructs with Closed status', () => {
    const prev = new CPos(1, 1)
    const info = new CellInfo(CellStatus.Closed, 10, 20, prev)

    expect(info.Status).toBe(CellStatus.Closed)
    expect(info.CostSoFar).toBe(10)
    expect(info.EstimatedTotalCost).toBe(20)
    expect(info.PreviousNode).toBe(prev)
  })

  it('throws when constructing Unvisited via constructor', () => {
    expect(
      () => new CellInfo(CellStatus.Unvisited, 0, 0, new CPos(0, 0)),
    ).toThrow(
      'The default CellInfo is the only such CellInfo allowed for representing an Unvisited location',
    )
  })

  it('creates Unvisited via unvisited() factory', () => {
    const info = CellInfo.unvisited()

    expect(info.Status).toBe(CellStatus.Unvisited)
    expect(info.CostSoFar).toBe(0)
    expect(info.EstimatedTotalCost).toBe(0)
    expect(CPos.equals(info.PreviousNode, CPos.Zero)).toBe(true)
  })

  it('unvisited() returns identical values each time', () => {
    const a = CellInfo.unvisited()
    const b = CellInfo.unvisited()

    expect(a.Status).toBe(b.Status)
    expect(a.CostSoFar).toBe(b.CostSoFar)
    expect(a.EstimatedTotalCost).toBe(b.EstimatedTotalCost)
  })

  it('toString returns "Unvisited" for unvisited nodes', () => {
    const info = CellInfo.unvisited()
    expect(info.toString()).toBe('Unvisited')
  })

  it('toString returns detailed info for Open nodes', () => {
    const info = new CellInfo(
      CellStatus.Open,
      5,
      15,
      new CPos(0, 0),
    )
    expect(info.toString()).toBe(
      'Open CostSoFar=5 EstimatedTotalCost=15 PreviousNode=0,0',
    )
  })

  it('toString returns detailed info for Closed nodes', () => {
    const info = new CellInfo(
      CellStatus.Closed,
      10,
      20,
      new CPos(3, 4),
    )
    expect(info.toString()).toBe(
      'Closed CostSoFar=10 EstimatedTotalCost=20 PreviousNode=3,4',
    )
  })

  it('is immutable (fields are readonly)', () => {
    const info = new CellInfo(CellStatus.Open, 5, 15, new CPos(0, 0))
    // TypeScript readonly prevents reassignment at compile time
    // Verify the values are what we set
    expect(info.Status).toBe(CellStatus.Open)
    expect(info.CostSoFar).toBe(5)
  })

  it('handles negative costs (allowed by constructor)', () => {
    // The constructor does not validate cost values — that is the caller's responsibility
    const info = new CellInfo(CellStatus.Open, -5, -10, new CPos(0, 0))
    expect(info.CostSoFar).toBe(-5)
    expect(info.EstimatedTotalCost).toBe(-10)
  })

  it('handles zero costs', () => {
    const info = new CellInfo(CellStatus.Open, 0, 0, new CPos(0, 0))
    expect(info.CostSoFar).toBe(0)
    expect(info.EstimatedTotalCost).toBe(0)
  })
})
