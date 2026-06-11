/**
 * Grid.test.ts — Grid unit tests
 *
 * Tests focus on: construction, Contains, IntersectsLine, Width, Height.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { Grid } from './Grid'

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe('Grid construction', () => {
  it('constructs with valid parameters', () => {
    const tl = new CPos(0, 0)
    const br = new CPos(10, 10)
    const grid = new Grid(tl, br, true)

    expect(grid.TopLeft).toBe(tl)
    expect(grid.BottomRight).toBe(br)
    expect(grid.SingleLayer).toBe(true)
  })

  it('constructs with SingleLayer false', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(5, 5), false)
    expect(grid.SingleLayer).toBe(false)
  })

  it('throws when topLeft and bottomRight have different layers', () => {
    const tl = new CPos(0, 0, 0)
    const br = new CPos(10, 10, 1)
    expect(() => new Grid(tl, br, true)).toThrow(
      'topLeft and bottomRight must have the same Layer',
    )
  })
})

// ---------------------------------------------------------------------------
// Width and Height tests
// ---------------------------------------------------------------------------

describe('Grid dimensions', () => {
  it('calculates Width correctly', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 5), true)
    expect(grid.Width).toBe(10)
  })

  it('calculates Height correctly', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 5), true)
    expect(grid.Height).toBe(5)
  })

  it('calculates Width with offset', () => {
    const grid = new Grid(new CPos(3, 3), new CPos(10, 8), true)
    expect(grid.Width).toBe(7)
  })

  it('calculates Height with offset', () => {
    const grid = new Grid(new CPos(3, 3), new CPos(10, 8), true)
    expect(grid.Height).toBe(5)
  })

  it('handles zero-width grid', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(0, 5), true)
    expect(grid.Width).toBe(0)
    expect(grid.Height).toBe(5)
  })

  it('handles zero-height grid', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(5, 0), true)
    expect(grid.Width).toBe(5)
    expect(grid.Height).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Contains tests
// ---------------------------------------------------------------------------

describe('Grid.contains', () => {
  it('contains cell within bounds', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.contains(new CPos(5, 5))).toBe(true)
  })

  it('contains cell at top-left boundary', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.contains(new CPos(0, 0))).toBe(true)
  })

  it('does not contain cell at bottom-right boundary (exclusive)', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.contains(new CPos(10, 10))).toBe(false)
  })

  it('contains cell just inside bottom-right boundary', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.contains(new CPos(9, 9))).toBe(true)
  })

  it('does not contain cell outside on X', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.contains(new CPos(10, 5))).toBe(false)
    expect(grid.contains(new CPos(-1, 5))).toBe(false)
  })

  it('does not contain cell outside on Y', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.contains(new CPos(5, 10))).toBe(false)
    expect(grid.contains(new CPos(5, -1))).toBe(false)
  })

  it('respects SingleLayer for layer mismatch', () => {
    const grid = new Grid(new CPos(0, 0, 0), new CPos(10, 10, 0), true)
    expect(grid.contains(new CPos(5, 5, 1))).toBe(false)
  })

  it('ignores layer when SingleLayer is false', () => {
    const grid = new Grid(new CPos(0, 0, 0), new CPos(10, 10, 0), false)
    expect(grid.contains(new CPos(5, 5, 1))).toBe(true)
  })

  it('contains cell with matching layer when SingleLayer is true', () => {
    const grid = new Grid(new CPos(0, 0, 0), new CPos(10, 10, 0), true)
    expect(grid.contains(new CPos(5, 5, 0))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// IntersectsLine tests
// ---------------------------------------------------------------------------

describe('Grid.intersectsLine', () => {
  it('detects line crossing top edge', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    // Line from above the grid to inside
    expect(grid.intersectsLine(new CPos(5, -5), new CPos(5, 5))).toBe(
      true,
    )
  })

  it('detects line crossing bottom edge', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.intersectsLine(new CPos(5, 15), new CPos(5, 5))).toBe(
      true,
    )
  })

  it('detects line crossing left edge', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.intersectsLine(new CPos(-5, 5), new CPos(5, 5))).toBe(
      true,
    )
  })

  it('detects line crossing right edge', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.intersectsLine(new CPos(15, 5), new CPos(5, 5))).toBe(
      true,
    )
  })

  it('detects line passing through corner to corner', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    // Diagonal line crossing the grid
    expect(
      grid.intersectsLine(new CPos(-5, -5), new CPos(15, 15)),
    ).toBe(true)
  })

  it('returns false for line entirely inside grid', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    // Line from (2,2) to (8,8) — both inside, doesn't cross boundary
    expect(grid.intersectsLine(new CPos(2, 2), new CPos(8, 8))).toBe(
      false,
    )
  })

  it('returns false for line entirely outside grid', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    // Line from (15,15) to (20,20) — both outside
    expect(
      grid.intersectsLine(new CPos(15, 15), new CPos(20, 20)),
    ).toBe(false)
  })

  // NOTE: OpenRA Exts.LinesIntersect assumes lines are not collinear.
  // Lines along grid edges (collinear with boundary) are undefined behavior.

  it('detects line crossing from outside to outside through grid', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    // Horizontal line passing through
    expect(
      grid.intersectsLine(new CPos(-5, 5), new CPos(15, 5)),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toString tests
// ---------------------------------------------------------------------------

describe('Grid.toString', () => {
  it('produces correct string representation', () => {
    const grid = new Grid(new CPos(0, 0), new CPos(10, 10), true)
    expect(grid.toString()).toBe('0,0->10,10')
  })
})
