/**
 * GridPathGraph.test.ts — GridPathGraph migration unit tests
 *
 * Tests focus on:
 * - Grid boundary enforcement
 * - CellInfo get/set within bounds
 * - InfoIndex mapping
 * - isValidNeighbor override
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { CellInfo, CellStatus } from './CellInfo'
import { GridPathGraph } from './GridPathGraph'
import { Grid } from './Grid'
import { SimpleLocomotor, WallAwareLocomotor } from '../Traits/World/Locomotor'
import { BlockedByActor } from '../Traits/BlockedByActor'
import type { IGameWorld } from '../../OpenRA.Game/World'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal IGameWorld stub. */
const stubWorld: IGameWorld = {
  worldTick: 0,
  paused: false,
}

/** Create a 10x10 grid at origin (0,0). */
function createTestGrid(): Grid {
  return new Grid(
    new CPos(0, 0),
    new CPos(10, 10),
    true,
  )
}

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe('GridPathGraph construction', () => {
  it('constructs with grid', () => {
    const grid = createTestGrid()
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )
    expect(graph).toBeDefined()
  })

  it('constructs with custom parameters', () => {
    const grid = createTestGrid()
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.All,
      () => 50,
      null,
      true,
      true,
      grid,
    )
    expect(graph).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// CellInfo get/set tests
// ---------------------------------------------------------------------------

describe('GridPathGraph CellInfo', () => {
  it('returns unvisited for cells within grid', () => {
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      createTestGrid(),
    )

    const info = graph.getInfo(new CPos(5, 5))
    expect(info.Status).toBe(CellStatus.Unvisited)
  })

  it('stores and retrieves CellInfo', () => {
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      createTestGrid(),
    )

    const pos = new CPos(3, 4)
    const info = new CellInfo(CellStatus.Open, 10, 20, pos)
    graph.setInfo(pos, info)

    const retrieved = graph.getInfo(pos)
    expect(retrieved.Status).toBe(CellStatus.Open)
    expect(retrieved.CostSoFar).toBe(10)
    expect(retrieved.EstimatedTotalCost).toBe(20)
  })

  it('stores different info per cell', () => {
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      createTestGrid(),
    )

    const pos1 = new CPos(1, 1)
    const pos2 = new CPos(2, 2)
    graph.setInfo(pos1, new CellInfo(CellStatus.Open, 10, 20, pos1))
    graph.setInfo(pos2, new CellInfo(CellStatus.Closed, 30, 40, pos1))

    expect(graph.getInfo(pos1).Status).toBe(CellStatus.Open)
    expect(graph.getInfo(pos2).Status).toBe(CellStatus.Closed)
  })
})

// ---------------------------------------------------------------------------
// Grid boundary tests
// ---------------------------------------------------------------------------

describe('GridPathGraph grid boundaries', () => {
  it('excludes cells outside grid from connections', () => {
    const grid = new Grid(
      new CPos(2, 2),
      new CPos(6, 6),
      true,
    )
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )

    // Cell at edge (2,2) — neighbors at (1,2), (2,1), (1,1) are outside
    const pos = new CPos(2, 2)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    // Should only have neighbors inside [2,6) x [2,6)
    for (const conn of connections) {
      expect(conn.Destination.X).toBeGreaterThanOrEqual(2)
      expect(conn.Destination.X).toBeLessThan(6)
      expect(conn.Destination.Y).toBeGreaterThanOrEqual(2)
      expect(conn.Destination.Y).toBeLessThan(6)
    }
  })

  it('includes cells at grid boundary', () => {
    const grid = new Grid(
      new CPos(0, 0),
      new CPos(3, 3),
      true,
    )
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )

    // Center cell (1,1) should have all 8 neighbors inside 3x3
    const pos = new CPos(1, 1)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    expect(connections.length).toBe(8)
  })

  it('excludes negative coordinates when grid starts at origin', () => {
    const grid = new Grid(
      new CPos(0, 0),
      new CPos(5, 5),
      true,
    )
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )

    const pos = new CPos(0, 0)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    // Only positive neighbors: (1,0), (0,1), (1,1)
    expect(connections.length).toBe(3)
  })

  it('respects grid top-left offset', () => {
    const grid = new Grid(
      new CPos(5, 5),
      new CPos(8, 8),
      true,
    )
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )

    // Cell at (5,5) — only neighbors inside [5,8) are valid
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    for (const conn of connections) {
      expect(conn.Destination.X).toBeGreaterThanOrEqual(5)
      expect(conn.Destination.Y).toBeGreaterThanOrEqual(5)
    }
  })
})

// ---------------------------------------------------------------------------
// isValidNeighbor tests
// ---------------------------------------------------------------------------

describe('GridPathGraph isValidNeighbor', () => {
  it('accepts cells inside grid', () => {
    const grid = createTestGrid()
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )

    // Access protected method via type assertion
    const isValid = (graph as unknown as { isValidNeighbor(pos: CPos): boolean }).isValidNeighbor(new CPos(5, 5))
    expect(isValid).toBe(true)
  })

  it('rejects cells outside grid', () => {
    const grid = createTestGrid()
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )

    const isValid = (graph as unknown as { isValidNeighbor(pos: CPos): boolean }).isValidNeighbor(new CPos(15, 15))
    expect(isValid).toBe(false)
  })

  it('rejects cells at negative coordinates', () => {
    const grid = createTestGrid()
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )

    const isValid = (graph as unknown as { isValidNeighbor(pos: CPos): boolean }).isValidNeighbor(new CPos(-1, 5))
    expect(isValid).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Wall blocking + grid boundary tests
// ---------------------------------------------------------------------------

describe('GridPathGraph walls + boundaries', () => {
  it('combines wall blocking and grid boundaries', () => {
    const grid = new Grid(
      new CPos(0, 0),
      new CPos(5, 5),
      true,
    )
    const blocked = [new CPos(1, 0), new CPos(0, 1)]
    const locomotor = new WallAwareLocomotor(blocked)
    const graph = new GridPathGraph(
      locomotor,
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      grid,
    )

    const pos = new CPos(0, 0)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    // Grid excludes negative, walls exclude (1,0) and (0,1)
    // Valid: (1,1) only
    expect(connections.length).toBe(1)
    expect(CPos.equals(connections[0].Destination, new CPos(1, 1))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// dispose tests
// ---------------------------------------------------------------------------

describe('GridPathGraph dispose', () => {
  it('does not throw', () => {
    const graph = new GridPathGraph(
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
      createTestGrid(),
    )
    expect(() => graph.dispose()).not.toThrow()
  })
})
