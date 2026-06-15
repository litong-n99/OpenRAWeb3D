/**
 * ShroudExts.test.ts — ShroudExts migration unit tests
 *
 * Tests focus on: state management (function correctness), edge cases
 * (empty arrays, early exit), and API contract. Shroud.isExplored/isVisible
 * are mocked since the Shroud constructor requires a full Map + World
 * dependency tree.
 */

import { describe, it, expect, vi } from 'vitest'

import { CPos } from '../OpenRA.Game/CPos.js'
import { PPos } from '../OpenRA.Game/MPos.js'
import type { OccupiedCell } from '../OpenRA.Game/Traits/TraitsInterfaces.js'

import { anyExplored, anyVisible } from './ShroudExts.js'

// The Shroud class is only used as a type annotation for the mock.
import type { Shroud as ShroudType } from '../OpenRA.Game/Traits/Player/Shroud.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a mock OccupiedCell for testing. */
function oc(x: number, y: number, subCell: number = 0): OccupiedCell {
  return { cell: new CPos(x, y), subCell: subCell as OccupiedCell['subCell'] }
}

/** Create a mock PPos for testing. */
function ppos(u: number, v: number): PPos {
  return new PPos(u, v)
}

/**
 * Minimal mock Shroud — only provides isExplored and isVisible as vi.fn() spies.
 *
 * Since Shroud's constructor requires a full Map object and creates multiple
 * TypedArrays, we use a plain object cast to Shroud with only the two methods
 * needed by ShroudExts. This avoids pulling in the entire Map/World dependency
 * tree and allows direct spy inspection via the returned mock functions.
 */
function createMockShroud(
  exploredMap: ReadonlyMap<string, boolean>,
  visibleMap: ReadonlyMap<string, boolean>,
) {
  const isExplored = vi.fn((arg: CPos | PPos): boolean => {
    let key: string
    if (arg instanceof CPos) {
      key = `C${arg.X},${arg.Y}`
    } else {
      key = `P${arg.U},${arg.V}`
    }
    return exploredMap.get(key) ?? false
  })

  const isVisible = vi.fn((arg: CPos | PPos): boolean => {
    let key: string
    if (arg instanceof CPos) {
      key = `C${arg.X},${arg.Y}`
    } else {
      key = `P${arg.U},${arg.V}`
    }
    return visibleMap.get(key) ?? false
  })

  // Cast through unknown: the ShroudExts functions only access isExplored/isVisible
  const shroud = { isExplored, isVisible } as unknown as ShroudType

  return { shroud, isExplored, isVisible }
}

// ---------------------------------------------------------------------------
// anyExplored — OccupiedCell[] overload
// ---------------------------------------------------------------------------

describe('anyExplored (OccupiedCell[])', () => {
  it('returns true when at least one cell is explored', () => {
    const { shroud } = createMockShroud(
      new Map([['C10,20', true]]),
      new Map(),
    )
    const cells = [oc(0, 0), oc(10, 20), oc(30, 40)]
    expect(anyExplored(shroud, cells)).toBe(true)
  })

  it('returns false when no cells are explored', () => {
    const { shroud } = createMockShroud(
      new Map(),
      new Map(),
    )
    const cells = [oc(1, 2), oc(3, 4), oc(5, 6)]
    expect(anyExplored(shroud, cells)).toBe(false)
  })

  it('returns false for an empty array', () => {
    const { shroud } = createMockShroud(
      new Map([['C0,0', true]]),
      new Map(),
    )
    expect(anyExplored(shroud, [])).toBe(false)
  })

  it('early-exits on the first matched cell (does not check remaining)', () => {
    const { shroud, isExplored } = createMockShroud(
      new Map([['C3,4', true], ['C5,6', true]]),
      new Map(),
    )
    const cells = [oc(1, 2), oc(3, 4), oc(5, 6)]
    anyExplored(shroud, cells)
    // After early exit at index 1, index 2 (5,6) should NOT have been checked
    expect(isExplored).toHaveBeenCalledTimes(2)
    expect(isExplored).toHaveBeenNthCalledWith(1, cells[0].cell)
    expect(isExplored).toHaveBeenNthCalledWith(2, cells[1].cell)
  })

  it('passes the cell property (CPos) to shroud.isExplored', () => {
    const { shroud, isExplored } = createMockShroud(
      new Map([['C7,8', true]]),
      new Map(),
    )
    const cells = [oc(7, 8)]
    anyExplored(shroud, cells)
    const passedArg = isExplored.mock.calls[0][0]
    expect(passedArg).toBeInstanceOf(CPos)
    expect((passedArg as CPos).X).toBe(7)
    expect((passedArg as CPos).Y).toBe(8)
  })

  it('checks all cells when none match (no early exit)', () => {
    const { shroud, isExplored } = createMockShroud(
      new Map(),
      new Map(),
    )
    const cells = [oc(1, 2), oc(3, 4), oc(5, 6)]
    anyExplored(shroud, cells)
    expect(isExplored).toHaveBeenCalledTimes(3)
  })
})

// ---------------------------------------------------------------------------
// anyExplored — PPos[] overload
// ---------------------------------------------------------------------------

describe('anyExplored (PPos[])', () => {
  it('returns true when at least one projected cell is explored', () => {
    const { shroud } = createMockShroud(
      new Map([['P2,3', true]]),
      new Map(),
    )
    const puvs = [ppos(1, 1), ppos(2, 3), ppos(4, 5)]
    expect(anyExplored(shroud, puvs)).toBe(true)
  })

  it('returns false when no projected cells are explored', () => {
    const { shroud } = createMockShroud(
      new Map(),
      new Map(),
    )
    const puvs = [ppos(1, 2), ppos(3, 4)]
    expect(anyExplored(shroud, puvs)).toBe(false)
  })

  it('returns false for an empty PPos array', () => {
    const { shroud } = createMockShroud(
      new Map([['P0,0', true]]),
      new Map(),
    )
    expect(anyExplored(shroud, [])).toBe(false)
  })

  it('early-exits on the first matched PPos', () => {
    const { shroud, isExplored } = createMockShroud(
      new Map([['P3,4', true], ['P5,6', true]]),
      new Map(),
    )
    const puvs = [ppos(1, 2), ppos(3, 4), ppos(5, 6)]
    anyExplored(shroud, puvs)
    expect(isExplored).toHaveBeenCalledTimes(2)
  })

  it('passes PPos directly to shroud.isExplored', () => {
    const { shroud, isExplored } = createMockShroud(
      new Map([['P7,8', true]]),
      new Map(),
    )
    const puvs = [ppos(7, 8)]
    anyExplored(shroud, puvs)
    const passedArg = isExplored.mock.calls[0][0]
    expect(passedArg).toBeInstanceOf(PPos)
    expect((passedArg as PPos).U).toBe(7)
    expect((passedArg as PPos).V).toBe(8)
  })

  it('distinguishes PPos[] from OccupiedCell[] via first element shape', () => {
    // Verify that when we pass a single-element PPos array to anyExplored,
    // it correctly takes the PPos path (not the OccupiedCell path).
    const { shroud, isExplored } = createMockShroud(
      new Map([['P4,4', true]]),
      new Map(),
    )
    const puvs = [ppos(4, 4)]
    const result = anyExplored(shroud, puvs)
    expect(result).toBe(true)
    // The PPos path passes the PPos directly, not .cell property
    const passedArg = isExplored.mock.calls[0][0]
    expect(passedArg).toBeInstanceOf(PPos)
  })
})

// ---------------------------------------------------------------------------
// anyVisible
// ---------------------------------------------------------------------------

describe('anyVisible', () => {
  it('returns true when at least one cell is visible', () => {
    const { shroud } = createMockShroud(
      new Map(),
      new Map([['C10,20', true]]),
    )
    const cells = [oc(0, 0), oc(10, 20), oc(30, 40)]
    expect(anyVisible(shroud, cells)).toBe(true)
  })

  it('returns false when no cells are visible', () => {
    const { shroud } = createMockShroud(
      new Map(),
      new Map(),
    )
    const cells = [oc(1, 2), oc(3, 4), oc(5, 6)]
    expect(anyVisible(shroud, cells)).toBe(false)
  })

  it('returns false for an empty array', () => {
    const { shroud } = createMockShroud(
      new Map(),
      new Map([['C0,0', true]]),
    )
    expect(anyVisible(shroud, [])).toBe(false)
  })

  it('early-exits on the first visible cell', () => {
    const { shroud, isVisible } = createMockShroud(
      new Map(),
      new Map([['C3,4', true], ['C5,6', true]]),
    )
    const cells = [oc(1, 2), oc(3, 4), oc(5, 6)]
    anyVisible(shroud, cells)
    expect(isVisible).toHaveBeenCalledTimes(2)
    expect(isVisible).toHaveBeenNthCalledWith(1, cells[0].cell)
    expect(isVisible).toHaveBeenNthCalledWith(2, cells[1].cell)
  })

  it('uses isVisible, not isExplored', () => {
    // Cell is explored but not visible — anyVisible should return false
    const { shroud } = createMockShroud(
      new Map([['C7,8', true]]),
      new Map(), // visible is always false
    )
    const cells = [oc(7, 8)]
    expect(anyVisible(shroud, cells)).toBe(false)
  })

  it('checks all cells when none are visible', () => {
    const { shroud, isVisible } = createMockShroud(
      new Map(),
      new Map(),
    )
    const cells = [oc(1, 2), oc(3, 4), oc(5, 6)]
    anyVisible(shroud, cells)
    expect(isVisible).toHaveBeenCalledTimes(3)
  })
})
