/**
 * BuildingInfluence.test.ts — BuildingInfluence migration unit tests
 *
 * Tests focus on:
 * - Constructor creates CellLayer with correct grid type and size
 * - addInfluence registers actors at cells (linked list prepend)
 * - removeInfluence removes actors from cells (recursive removal)
 * - getBuildingsAt returns correct actors (linked list iteration)
 * - anyBuildingAt quick null check
 * - Multiple buildings at the same cell
 * - Edge cases: empty cells, out-of-bounds cells, null/undefined
 * - InfluenceNode construction and Next pointer
 * - BuildingInfluenceInfo defaults
 * - INotifyCreated lifecycle (no-op)
 *
 * Since CellLayer is pure TypeScript (no WebGL dependency), no Babylon.js
 * mocking is required. Tests use real CellLayer instances with minimal
 * mock IGameActor objects.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { BuildingInfluence, BuildingInfluenceInfo, InfluenceNode } from './BuildingInfluence'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import { CPos } from '../../../OpenRA.Game/CPos'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock IGameActor for testing.
 *
 * Required properties (Phase B): actorId, isInWorld, isDead, disposed.
 * Optional properties are left undefined for minimal stub actors.
 */
function mockActor(actorId: number): IGameActor {
  return {
    actorId,
    isInWorld: true,
    isDead: false,
    disposed: false,
  }
}

/** Create a BuildingInfluence instance on a 10x10 Rectangular grid. */
function createInfluence(): BuildingInfluence {
  return new BuildingInfluence(MapGridType.Rectangular, { width: 10, height: 10 })
}

/** Create a CPos at (x, y). */
function c(x: number, y: number): CPos {
  return new CPos(x, y)
}

// ---------------------------------------------------------------------------
// InfluenceNode tests
// ---------------------------------------------------------------------------

describe('InfluenceNode', () => {
  it('sets Actor from constructor', () => {
    const actor = mockActor(42)
    const node = new InfluenceNode(actor)
    expect(node.Actor).toBe(actor)
    expect(node.Actor.actorId).toBe(42)
  })

  it('defaults Next to null', () => {
    const node = new InfluenceNode(mockActor(1))
    expect(node.Next).toBeNull()
  })

  it('allows setting Next to another node', () => {
    const a1 = mockActor(1)
    const a2 = mockActor(2)
    const node1 = new InfluenceNode(a1)
    const node2 = new InfluenceNode(a2)
    node1.Next = node2
    expect(node1.Next).toBe(node2)
    expect(node1.Next!.Actor).toBe(a2)
    expect(node1.Next!.Next).toBeNull()
  })

  it('can form a chain of three nodes', () => {
    const a1 = mockActor(1)
    const a2 = mockActor(2)
    const a3 = mockActor(3)
    const head = new InfluenceNode(a1)
    head.Next = new InfluenceNode(a2)
    head.Next.Next = new InfluenceNode(a3)

    expect(head.Actor.actorId).toBe(1)
    expect(head.Next!.Actor.actorId).toBe(2)
    expect(head.Next!.Next!.Actor.actorId).toBe(3)
    expect(head.Next!.Next!.Next).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// BuildingInfluenceInfo tests
// ---------------------------------------------------------------------------

describe('BuildingInfluenceInfo', () => {
  it('creates with default instanceName undefined', () => {
    const info = new BuildingInfluenceInfo()
    expect(info.instanceName).toBeUndefined()
  })

  it('creates with custom instanceName', () => {
    const info = new BuildingInfluenceInfo({ instanceName: 'MyInfluence' })
    expect(info.instanceName).toBe('MyInfluence')
  })

  it('implements ITraitInfo', () => {
    const info = new BuildingInfluenceInfo()
    // ITraitInfo has readonly instanceName?: string
    expect('instanceName' in info).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfluence constructor
// ---------------------------------------------------------------------------

describe('BuildingInfluence constructor', () => {
  it('creates CellLayer with Rectangular grid type', () => {
    const bi = new BuildingInfluence(MapGridType.Rectangular, { width: 8, height: 6 })
    expect(bi.influence.GridType).toBe(MapGridType.Rectangular)
    expect(bi.influence.Size.width).toBe(8)
    expect(bi.influence.Size.height).toBe(6)
  })

  it('creates CellLayer with RectangularIsometric grid type', () => {
    const bi = new BuildingInfluence(MapGridType.RectangularIsometric, { width: 12, height: 10 })
    expect(bi.influence.GridType).toBe(MapGridType.RectangularIsometric)
    expect(bi.influence.Size.width).toBe(12)
    expect(bi.influence.Size.height).toBe(10)
  })

  it('initializes all cells to null', () => {
    const bi = createInfluence()
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        expect(bi.influence.get(c(x, y))).toBeNull()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// INotifyCreated
// ---------------------------------------------------------------------------

describe('INotifyCreated', () => {
  it('created() is a no-op (CellLayer already initialized)', () => {
    const bi = createInfluence()
    const worldActor = mockActor(0)
    // Should not throw
    bi.created(worldActor)
    // State should be unchanged
    expect(bi.influence.get(c(0, 0))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// addInfluence
// ---------------------------------------------------------------------------

describe('addInfluence', () => {
  let bi: BuildingInfluence
  let actor: IGameActor

  beforeEach(() => {
    bi = createInfluence()
    actor = mockActor(100)
  })

  it('adds actor to a single cell', () => {
    bi.addInfluence(actor, [c(3, 4)])

    const node = bi.influence.get(c(3, 4))
    expect(node).not.toBeNull()
    expect(node!.Actor).toBe(actor)
    expect(node!.Next).toBeNull()
  })

  it('adds actor to multiple cells', () => {
    bi.addInfluence(actor, [c(1, 1), c(2, 2), c(3, 3)])

    expect(bi.influence.get(c(1, 1))!.Actor).toBe(actor)
    expect(bi.influence.get(c(2, 2))!.Actor).toBe(actor)
    expect(bi.influence.get(c(3, 3))!.Actor).toBe(actor)
  })

  it('prepends actor to existing linked list', () => {
    const actor1 = mockActor(1)
    const actor2 = mockActor(2)

    bi.addInfluence(actor1, [c(5, 5)])
    bi.addInfluence(actor2, [c(5, 5)])

    // actor2 should be the head (prepended)
    const node = bi.influence.get(c(5, 5))
    expect(node!.Actor).toBe(actor2)
    expect(node!.Next).not.toBeNull()
    expect(node!.Next!.Actor).toBe(actor1)
    expect(node!.Next!.Next).toBeNull()
  })

  it('does not affect cells outside the specified list', () => {
    bi.addInfluence(actor, [c(2, 2)])

    // Nearby cells should remain null
    expect(bi.influence.get(c(2, 3))).toBeNull()
    expect(bi.influence.get(c(3, 2))).toBeNull()
    expect(bi.influence.get(c(1, 2))).toBeNull()
  })

  it('ignores out-of-bounds cells for Rectangular grid', () => {
    // Cells outside 0..9 range should be silently ignored
    // CPos at (-1, 0) is out of bounds for 10x10 Rectangular
    // NOTE: contains() returns false for out-of-bounds, and addInfluence silently skips
    bi.addInfluence(actor, [c(-1, 0), c(0, 10)])
    // Should not throw, and no cells should be affected
    expect(bi.influence.get(c(0, 0))).toBeNull()
  })

  it('allows same actor to be added to a cell multiple times', () => {
    // This could happen in edge cases or repeated addInfluence calls
    bi.addInfluence(actor, [c(4, 4)])
    bi.addInfluence(actor, [c(4, 4)])

    // Both nodes should be in the list
    const node = bi.influence.get(c(4, 4))
    expect(node!.Actor).toBe(actor)
    expect(node!.Next).not.toBeNull()
    expect(node!.Next!.Actor).toBe(actor) // same actor, two nodes
    expect(node!.Next!.Next).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// removeInfluence
// ---------------------------------------------------------------------------

describe('removeInfluence', () => {
  let bi: BuildingInfluence

  beforeEach(() => {
    bi = createInfluence()
  })

  it('removes actor from a single cell', () => {
    const actor = mockActor(100)
    bi.addInfluence(actor, [c(3, 4)])
    expect(bi.influence.get(c(3, 4))).not.toBeNull()

    bi.removeInfluence(actor, [c(3, 4)])
    expect(bi.influence.get(c(3, 4))).toBeNull()
  })

  it('removes actor from multiple cells', () => {
    const actor = mockActor(100)
    bi.addInfluence(actor, [c(1, 1), c(2, 2), c(3, 3)])

    bi.removeInfluence(actor, [c(1, 1), c(2, 2), c(3, 3)])

    expect(bi.influence.get(c(1, 1))).toBeNull()
    expect(bi.influence.get(c(2, 2))).toBeNull()
    expect(bi.influence.get(c(3, 3))).toBeNull()
  })

  it('removes only the specified actor from a shared cell', () => {
    const actor1 = mockActor(1)
    const actor2 = mockActor(2)
    const actor3 = mockActor(3)

    bi.addInfluence(actor1, [c(5, 5)])
    bi.addInfluence(actor2, [c(5, 5)])
    bi.addInfluence(actor3, [c(5, 5)])

    // Remove the middle actor
    bi.removeInfluence(actor2, [c(5, 5)])

    const node = bi.influence.get(c(5, 5))
    expect(node!.Actor).toBe(actor3) // head (prepended last)
    expect(node!.Next!.Actor).toBe(actor1) // tail (prepended first)
    expect(node!.Next!.Next).toBeNull() // actor2 removed
  })

  it('removes actor from head of list', () => {
    const actor1 = mockActor(1)
    const actor2 = mockActor(2)

    bi.addInfluence(actor1, [c(5, 5)])
    bi.addInfluence(actor2, [c(5, 5)])

    // Remove the head (actor2, added last)
    bi.removeInfluence(actor2, [c(5, 5)])

    const node = bi.influence.get(c(5, 5))
    expect(node!.Actor).toBe(actor1)
    expect(node!.Next).toBeNull()
  })

  it('removes actor from tail of list', () => {
    const actor1 = mockActor(1)
    const actor2 = mockActor(2)

    bi.addInfluence(actor1, [c(5, 5)])
    bi.addInfluence(actor2, [c(5, 5)])

    // Remove the tail (actor1, added first)
    bi.removeInfluence(actor1, [c(5, 5)])

    const node = bi.influence.get(c(5, 5))
    expect(node!.Actor).toBe(actor2)
    expect(node!.Next).toBeNull()
  })

  it('removes all occurrences of actor from a cell', () => {
    const actor = mockActor(100)

    // Add same actor twice to same cell
    bi.addInfluence(actor, [c(4, 4)])
    bi.addInfluence(actor, [c(4, 4)])

    // Remove once — the recursive method removes ALL matches
    bi.removeInfluence(actor, [c(4, 4)])

    // Both nodes should be removed
    expect(bi.influence.get(c(4, 4))).toBeNull()
  })

  it('is no-op when removing from empty cell', () => {
    const actor = mockActor(100)
    bi.removeInfluence(actor, [c(0, 0)])
    expect(bi.influence.get(c(0, 0))).toBeNull()
  })

  it('is no-op when removing non-existent actor from occupied cell', () => {
    const actor1 = mockActor(1)
    const actor2 = mockActor(2)

    bi.addInfluence(actor1, [c(3, 3)])

    // Try to remove actor2 from the cell occupied by actor1
    bi.removeInfluence(actor2, [c(3, 3)])

    // actor1 should still be there
    expect(bi.influence.get(c(3, 3))!.Actor).toBe(actor1)
  })

  it('ignores out-of-bounds cells', () => {
    const actor = mockActor(100)
    // Should not throw
    bi.removeInfluence(actor, [c(-1, 0), c(0, 10)])
  })
})

// ---------------------------------------------------------------------------
// getBuildingsAt
// ---------------------------------------------------------------------------

describe('getBuildingsAt', () => {
  let bi: BuildingInfluence

  beforeEach(() => {
    bi = createInfluence()
  })

  it('returns empty array for empty cell', () => {
    const result = bi.getBuildingsAt(c(0, 0))
    expect(result).toEqual([])
  })

  it('returns single actor for cell with one building', () => {
    const actor = mockActor(42)
    bi.addInfluence(actor, [c(3, 3)])

    const result = bi.getBuildingsAt(c(3, 3))
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(actor)
  })

  it('returns all actors at a cell with multiple buildings', () => {
    const a1 = mockActor(1)
    const a2 = mockActor(2)
    const a3 = mockActor(3)

    bi.addInfluence(a1, [c(5, 5)])
    bi.addInfluence(a2, [c(5, 5)])
    bi.addInfluence(a3, [c(5, 5)])

    const result = bi.getBuildingsAt(c(5, 5))
    expect(result).toHaveLength(3)
    // Prepend order: last added = first in list
    expect(result[0]).toBe(a3)
    expect(result[1]).toBe(a2)
    expect(result[2]).toBe(a1)
  })

  it('returns actors in prepend order (most recent first)', () => {
    const a1 = mockActor(1)
    const a2 = mockActor(2)

    bi.addInfluence(a1, [c(0, 0)])
    bi.addInfluence(a2, [c(0, 0)])

    const result = bi.getBuildingsAt(c(0, 0))
    expect(result[0]).toBe(a2) // most recent
    expect(result[1]).toBe(a1) // oldest
  })

  it('returns empty array for out-of-bounds cells', () => {
    const result = bi.getBuildingsAt(c(-1, -1))
    expect(result).toEqual([])
  })

  it('returns correct actor at specific cell when multiple cells are occupied', () => {
    const a1 = mockActor(1)
    const a2 = mockActor(2)

    bi.addInfluence(a1, [c(1, 1)])
    bi.addInfluence(a2, [c(2, 2)])

    expect(bi.getBuildingsAt(c(1, 1))).toEqual([a1])
    expect(bi.getBuildingsAt(c(2, 2))).toEqual([a2])
    expect(bi.getBuildingsAt(c(3, 3))).toEqual([])
  })

  it('does not mutate the influence layer', () => {
    const actor = mockActor(42)
    bi.addInfluence(actor, [c(3, 3)])

    bi.getBuildingsAt(c(3, 3))
    // The cell should still have the actor
    expect(bi.influence.get(c(3, 3))!.Actor).toBe(actor)
  })
})

// ---------------------------------------------------------------------------
// anyBuildingAt
// ---------------------------------------------------------------------------

describe('anyBuildingAt', () => {
  let bi: BuildingInfluence

  beforeEach(() => {
    bi = createInfluence()
  })

  it('returns false for empty cell', () => {
    expect(bi.anyBuildingAt(c(0, 0))).toBe(false)
  })

  it('returns true for cell with one building', () => {
    bi.addInfluence(mockActor(1), [c(3, 3)])
    expect(bi.anyBuildingAt(c(3, 3))).toBe(true)
  })

  it('returns true for cell with multiple buildings', () => {
    bi.addInfluence(mockActor(1), [c(5, 5)])
    bi.addInfluence(mockActor(2), [c(5, 5)])
    expect(bi.anyBuildingAt(c(5, 5))).toBe(true)
  })

  it('returns false for out-of-bounds cells', () => {
    expect(bi.anyBuildingAt(c(-1, -1))).toBe(false)
    expect(bi.anyBuildingAt(c(100, 100))).toBe(false)
  })

  it('returns false after removing the only building', () => {
    const actor = mockActor(1)
    bi.addInfluence(actor, [c(3, 3)])
    expect(bi.anyBuildingAt(c(3, 3))).toBe(true)

    bi.removeInfluence(actor, [c(3, 3)])
    expect(bi.anyBuildingAt(c(3, 3))).toBe(false)
  })

  it('returns true after removing only one of multiple buildings', () => {
    const a1 = mockActor(1)
    const a2 = mockActor(2)

    bi.addInfluence(a1, [c(5, 5)])
    bi.addInfluence(a2, [c(5, 5)])

    bi.removeInfluence(a1, [c(5, 5)])
    expect(bi.anyBuildingAt(c(5, 5))).toBe(true) // a2 still there
  })

  it('does not mutate the influence layer', () => {
    const actor = mockActor(42)
    bi.addInfluence(actor, [c(3, 3)])

    bi.anyBuildingAt(c(3, 3))
    // The cell should still have the actor
    expect(bi.influence.get(c(3, 3))!.Actor).toBe(actor)
  })
})

// ---------------------------------------------------------------------------
// Integration: add + remove + query lifecycle
// ---------------------------------------------------------------------------

describe('BuildingInfluence lifecycle', () => {
  it('add, query, remove, query-empty cycle', () => {
    const bi = createInfluence()
    const building = mockActor(200)
    const cells = [c(2, 2), c(2, 3), c(3, 2), c(3, 3)] // 2x2 footprint

    // Initially empty
    for (const cell of cells) {
      expect(bi.anyBuildingAt(cell)).toBe(false)
      expect(bi.getBuildingsAt(cell)).toEqual([])
    }

    // Add building
    bi.addInfluence(building, cells)
    for (const cell of cells) {
      expect(bi.anyBuildingAt(cell)).toBe(true)
      expect(bi.getBuildingsAt(cell)).toEqual([building])
    }

    // Remove building
    bi.removeInfluence(building, cells)
    for (const cell of cells) {
      expect(bi.anyBuildingAt(cell)).toBe(false)
      expect(bi.getBuildingsAt(cell)).toEqual([])
    }
  })

  it('two overlapping buildings at shared cells', () => {
    const bi = createInfluence()
    const b1 = mockActor(101)
    const b2 = mockActor(102)

    // Building 1: cells (2,2), (3,2), (2,3), (3,3)
    // Building 2: cells (3,2), (4,2), (3,3), (4,3)
    // Overlap: (3,2), (3,3)

    bi.addInfluence(b1, [c(2, 2), c(3, 2), c(2, 3), c(3, 3)])
    bi.addInfluence(b2, [c(3, 2), c(4, 2), c(3, 3), c(4, 3)])

    // Non-overlap cells: only one building each
    expect(bi.getBuildingsAt(c(2, 2))).toEqual([b1])
    expect(bi.getBuildingsAt(c(2, 3))).toEqual([b1])
    expect(bi.getBuildingsAt(c(4, 2))).toEqual([b2])
    expect(bi.getBuildingsAt(c(4, 3))).toEqual([b2])

    // Overlap cells: both buildings (b2 prepended last, so head of list)
    expect(bi.getBuildingsAt(c(3, 2))).toHaveLength(2)
    expect(bi.getBuildingsAt(c(3, 2))[0]).toBe(b2)
    expect(bi.getBuildingsAt(c(3, 2))[1]).toBe(b1)

    expect(bi.getBuildingsAt(c(3, 3))).toHaveLength(2)
    expect(bi.getBuildingsAt(c(3, 3))[0]).toBe(b2)
    expect(bi.getBuildingsAt(c(3, 3))[1]).toBe(b1)

    // anyBuildingAt is true for all occupied cells
    expect(bi.anyBuildingAt(c(2, 2))).toBe(true)
    expect(bi.anyBuildingAt(c(3, 2))).toBe(true)
    expect(bi.anyBuildingAt(c(4, 2))).toBe(true)

    // Remove b1 — overlap cells should still have b2
    bi.removeInfluence(b1, [c(2, 2), c(3, 2), c(2, 3), c(3, 3)])

    // b1-only cells: now empty
    expect(bi.getBuildingsAt(c(2, 2))).toEqual([])
    expect(bi.getBuildingsAt(c(2, 3))).toEqual([])

    // Overlap cells: only b2 remains (head of list)
    expect(bi.getBuildingsAt(c(3, 2))).toEqual([b2])
    expect(bi.getBuildingsAt(c(3, 3))).toEqual([b2])

    // b2-only cells: unchanged
    expect(bi.getBuildingsAt(c(4, 2))).toEqual([b2])
    expect(bi.getBuildingsAt(c(4, 3))).toEqual([b2])
  })

  it('three buildings at same cell', () => {
    const bi = createInfluence()
    const ba = mockActor(1)
    const bb = mockActor(2)
    const bc = mockActor(3)

    bi.addInfluence(ba, [c(0, 0)])
    bi.addInfluence(bb, [c(0, 0)])
    bi.addInfluence(bc, [c(0, 0)])

    // bc was added last, so it's the head
    expect(bi.getBuildingsAt(c(0, 0))).toEqual([bc, bb, ba])

    // Remove bb (middle)
    bi.removeInfluence(bb, [c(0, 0)])
    expect(bi.getBuildingsAt(c(0, 0))).toEqual([bc, ba])

    // Remove bc (head)
    bi.removeInfluence(bc, [c(0, 0)])
    expect(bi.getBuildingsAt(c(0, 0))).toEqual([ba])

    // Remove ba (last)
    bi.removeInfluence(ba, [c(0, 0)])
    expect(bi.getBuildingsAt(c(0, 0))).toEqual([])
    expect(bi.anyBuildingAt(c(0, 0))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RectangularIsometric grid
// ---------------------------------------------------------------------------

describe('BuildingInfluence with RectangularIsometric grid', () => {
  it('adds and retrieves at valid isometric cells', () => {
    const bi = new BuildingInfluence(MapGridType.RectangularIsometric, { width: 10, height: 10 })
    const actor = mockActor(42)

    // Cell (5, 3): X > Y, valid for isometric
    bi.addInfluence(actor, [c(5, 3)])
    expect(bi.getBuildingsAt(c(5, 3))).toEqual([actor])
    expect(bi.anyBuildingAt(c(5, 3))).toBe(true)
  })

  it('ignores cells where X < Y (invalid for isometric)', () => {
    const bi = new BuildingInfluence(MapGridType.RectangularIsometric, { width: 10, height: 10 })
    const actor = mockActor(42)

    // Cell (2, 5): X < Y, invalid for RectangularIsometric
    bi.addInfluence(actor, [c(2, 5)])

    // Should be empty (cell was filtered by contains)
    expect(bi.getBuildingsAt(c(2, 5))).toEqual([])
    expect(bi.anyBuildingAt(c(2, 5))).toBe(false)
  })

  it('getBuildingsAt returns empty for invalid isometric cell', () => {
    const bi = new BuildingInfluence(MapGridType.RectangularIsometric, { width: 10, height: 10 })
    // X < Y is invalid
    expect(bi.getBuildingsAt(c(1, 5))).toEqual([])
    expect(bi.anyBuildingAt(c(1, 5))).toBe(false)
  })
})
