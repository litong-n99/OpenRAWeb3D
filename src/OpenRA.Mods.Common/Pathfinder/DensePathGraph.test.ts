/**
 * DensePathGraph.test.ts — DensePathGraph migration unit tests
 *
 * Tests focus on:
 * - 8-direction neighbor generation
 * - Wall blocking (via WallAwareLocomotor)
 * - Diagonal cost (√2 multiplier)
 * - Lane bias
 * - Custom cost
 * - InReverse mode
 * - Terrain height check (stubbed)
 * - CellInfo get/set
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { CellInfo, CellStatus } from './CellInfo'
import { DensePathGraph } from './DensePathGraph'
import { PathGraph } from './IPathGraph'
import {
  SimpleLocomotor,
  WallAwareLocomotor,
} from '../Traits/World/Locomotor'
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

/**
 * Concrete DensePathGraph for testing.
 * Uses a Map<number, CellInfo> for storage.
 */
class TestDensePathGraph extends DensePathGraph {
  private readonly infos: Map<number, CellInfo> = new Map()

  constructor(
    locomotor = new SimpleLocomotor(),
    customCost: ((pos: CPos) => number) | null = null,
    laneBias = false,
    inReverse = false,
  ) {
    super(
      locomotor,
      null,
      stubWorld,
      BlockedByActor.None,
      customCost,
      null,
      laneBias,
      inReverse,
    )
  }

  override getInfo(node: CPos): CellInfo {
    return this.infos.get(node.Bits) ?? CellInfo.unvisited()
  }

  override setInfo(node: CPos, info: CellInfo): void {
    this.infos.set(node.Bits, info)
  }
}

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe('DensePathGraph construction', () => {
  it('constructs with SimpleLocomotor', () => {
    const graph = new TestDensePathGraph()
    expect(graph).toBeDefined()
  })

  it('constructs with WallAwareLocomotor', () => {
    const locomotor = new WallAwareLocomotor([new CPos(1, 0)])
    const graph = new TestDensePathGraph(locomotor)
    expect(graph).toBeDefined()
  })

  it('constructs with customCost', () => {
    const graph = new TestDensePathGraph(new SimpleLocomotor(), () => 50)
    expect(graph).toBeDefined()
  })

  it('constructs with laneBias enabled', () => {
    const graph = new TestDensePathGraph(new SimpleLocomotor(), null, true)
    expect(graph).toBeDefined()
  })

  it('constructs with inReverse enabled', () => {
    const graph = new TestDensePathGraph(
      new SimpleLocomotor(),
      null,
      false,
      true,
    )
    expect(graph).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// CellInfo get/set tests
// ---------------------------------------------------------------------------

describe('DensePathGraph CellInfo', () => {
  it('returns unvisited for unknown cells', () => {
    const graph = new TestDensePathGraph()
    const info = graph.getInfo(new CPos(0, 0))
    expect(info.Status).toBe(CellStatus.Unvisited)
  })

  it('stores and retrieves CellInfo', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    const info = new CellInfo(CellStatus.Open, 10, 20, pos)
    graph.setInfo(pos, info)
    const retrieved = graph.getInfo(pos)
    expect(retrieved.Status).toBe(CellStatus.Open)
    expect(retrieved.CostSoFar).toBe(10)
    expect(retrieved.EstimatedTotalCost).toBe(20)
  })

  it('overwrites existing CellInfo', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 10, 20, pos))
    graph.setInfo(pos, new CellInfo(CellStatus.Closed, 15, 25, pos))
    const retrieved = graph.getInfo(pos)
    expect(retrieved.Status).toBe(CellStatus.Closed)
    expect(retrieved.CostSoFar).toBe(15)
  })
})

// ---------------------------------------------------------------------------
// getConnections — 8-direction neighbor tests
// ---------------------------------------------------------------------------

describe('DensePathGraph getConnections — 8 directions', () => {
  it('returns all 8 neighbors from center with no previous node', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    // Set PreviousNode to self (so dx=0, dy=0, index=4 = all directions)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    expect(connections.length).toBe(8)
  })

  it('returns 5 neighbors when coming from top-left', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    const prev = new CPos(4, 4) // came from TL
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, prev))

    const connections = graph.getConnections(pos, () => false)
    // From TL, exclude BR, R, B (already reachable cheaper via parent)
    expect(connections.length).toBe(5)
  })

  it('returns 3 neighbors when coming from top', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    const prev = new CPos(5, 4) // came from T
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, prev))

    const connections = graph.getConnections(pos, () => false)
    // From T, exclude BL, L, R, BR, B
    expect(connections.length).toBe(3)
  })

  it('returns 5 neighbors when coming from bottom-right', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    const prev = new CPos(6, 6) // came from BR
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, prev))

    const connections = graph.getConnections(pos, () => false)
    // From BR, exclude TL, L, T
    expect(connections.length).toBe(5)
  })

  it('does not include closed neighbors', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    // Mark (6,5) as closed
    const right = new CPos(6, 5)
    graph.setInfo(right, new CellInfo(CellStatus.Closed, 0, 0, right))

    const connections = graph.getConnections(pos, () => false)
    const hasRight = connections.some((c) =>
      CPos.equals(c.Destination, right),
    )
    expect(hasRight).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Wall blocking tests
// ---------------------------------------------------------------------------

describe('DensePathGraph getConnections — wall blocking', () => {
  it('excludes blocked cells from connections', () => {
    const blocked = [new CPos(6, 5), new CPos(5, 6)]
    const locomotor = new WallAwareLocomotor(blocked)
    const graph = new TestDensePathGraph(locomotor)
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    const hasRight = connections.some((c) =>
      CPos.equals(c.Destination, blocked[0]),
    )
    const hasDown = connections.some((c) =>
      CPos.equals(c.Destination, blocked[1]),
    )
    expect(hasRight).toBe(false)
    expect(hasDown).toBe(false)
  })

  it('returns connections for passable cells only', () => {
    const blocked = [new CPos(6, 5), new CPos(6, 6), new CPos(5, 6)]
    const locomotor = new WallAwareLocomotor(blocked)
    const graph = new TestDensePathGraph(locomotor)
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    // 8 total - 3 blocked = 5
    expect(connections.length).toBe(5)
    for (const conn of connections) {
      expect(
        blocked.some((b) => CPos.equals(b, conn.Destination)),
      ).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Diagonal cost tests
// ---------------------------------------------------------------------------

describe('DensePathGraph getConnections — diagonal costs', () => {
  it('straight movement has base cost', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    const right = connections.find((c) =>
      CPos.equals(c.Destination, new CPos(6, 5)),
    )
    expect(right).toBeDefined()
    expect(right!.Cost).toBe(100) // base cost
  })

  it('diagonal movement costs ~1.414x base', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    const diag = connections.find((c) =>
      CPos.equals(c.Destination, new CPos(6, 6)),
    )
    expect(diag).toBeDefined()
    expect(diag!.Cost).toBe(Math.round(100 * Math.SQRT2))
  })

  it('all 4 diagonal costs are equal', () => {
    const graph = new TestDensePathGraph()
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    const diagonals = connections.filter((c) => {
      const dx = Math.abs(c.Destination.X - pos.X)
      const dy = Math.abs(c.Destination.Y - pos.Y)
      return dx === 1 && dy === 1
    })
    expect(diagonals.length).toBe(4)
    const expectedCost = Math.round(100 * Math.SQRT2)
    for (const d of diagonals) {
      expect(d.Cost).toBe(expectedCost)
    }
  })
})

// ---------------------------------------------------------------------------
// Lane bias tests
// ---------------------------------------------------------------------------

describe('DensePathGraph getConnections — lane bias', () => {
  it('adds lane bias cost when enabled', () => {
    const graph = new TestDensePathGraph(
      new SimpleLocomotor(),
      null,
      true,
    )
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    // Some connections should have lane bias added
    const biased = connections.filter((c) => c.Cost > 100 && c.Cost < 200)
    expect(biased.length).toBeGreaterThan(0)
  })

  it('does not add lane bias when disabled', () => {
    const graph = new TestDensePathGraph(
      new SimpleLocomotor(),
      null,
      false,
    )
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    // All straight costs should be exactly 100
    const straights = connections.filter((c) => {
      const dx = Math.abs(c.Destination.X - pos.X)
      const dy = Math.abs(c.Destination.Y - pos.Y)
      return (dx === 1 && dy === 0) || (dx === 0 && dy === 1)
    })
    for (const s of straights) {
      expect(s.Cost).toBe(100)
    }
  })
})

// ---------------------------------------------------------------------------
// Custom cost tests
// ---------------------------------------------------------------------------

describe('DensePathGraph getConnections — custom cost', () => {
  it('adds custom cost to movement', () => {
    const customCost = (pos: CPos): number => {
      // Add 50 to cells with X > 5
      return pos.X > 5 ? 50 : 0
    }
    const graph = new TestDensePathGraph(
      new SimpleLocomotor(),
      customCost,
    )
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    const right = connections.find((c) =>
      CPos.equals(c.Destination, new CPos(6, 5)),
    )
    expect(right).toBeDefined()
    expect(right!.Cost).toBe(150) // 100 base + 50 custom
  })

  it('excludes cells with invalid custom cost', () => {
    const customCost = (pos: CPos): number => {
      // Block cells with X > 5
      return pos.X > 5 ? PathGraph.PathCostForInvalidPath : 0
    }
    const graph = new TestDensePathGraph(
      new SimpleLocomotor(),
      customCost,
    )
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    const hasRight = connections.some((c) =>
      CPos.equals(c.Destination, new CPos(6, 5)),
    )
    expect(hasRight).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// InReverse tests
// ---------------------------------------------------------------------------

describe('DensePathGraph getConnections — inReverse', () => {
  it('allows movement onto target when inReverse', () => {
    // Block cell (6,5) but make it the target
    const blocked = [new CPos(6, 5)]
    const locomotor = new WallAwareLocomotor(blocked)
    const graph = new TestDensePathGraph(locomotor, null, false, true)
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const target = new CPos(6, 5)
    const connections = graph.getConnections(pos, (p) =>
      CPos.equals(p, target),
    )
    const hasTarget = connections.some((c) => CPos.equals(c.Destination, target))
    expect(hasTarget).toBe(true)
  })

  it('does not allow movement onto non-target blocked cell inReverse', () => {
    const blocked = [new CPos(6, 5), new CPos(6, 6)]
    const locomotor = new WallAwareLocomotor(blocked)
    const graph = new TestDensePathGraph(locomotor, null, false, true)
    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    // Target is (6,6), not (6,5)
    const target = new CPos(6, 6)
    const connections = graph.getConnections(pos, (p) =>
      CPos.equals(p, target),
    )
    const hasBlockedNonTarget = connections.some((c) => CPos.equals(c.Destination, new CPos(6, 5)),
    )
    expect(hasBlockedNonTarget).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidNeighbor tests
// ---------------------------------------------------------------------------

describe('DensePathGraph isValidNeighbor', () => {
  it('accepts all neighbors by default', () => {
    const graph = new TestDensePathGraph()
    expect(graph['isValidNeighbor'](new CPos(-100, -100))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// dispose tests
// ---------------------------------------------------------------------------

describe('DensePathGraph dispose', () => {
  it('does not throw', () => {
    const graph = new TestDensePathGraph()
    expect(() => graph.dispose()).not.toThrow()
  })
})
