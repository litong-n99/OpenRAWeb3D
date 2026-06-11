/**
 * SparsePathGraph.test.ts — SparsePathGraph unit tests
 *
 * Tests focus on: connection retrieval, CellInfo storage, default values, disposal.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { SparsePathGraph } from './SparsePathGraph'
import { GraphConnection } from './IPathGraph'
import { CellInfo, CellStatus } from './CellInfo'

// ---------------------------------------------------------------------------
// Connection retrieval
// ---------------------------------------------------------------------------

describe('SparsePathGraph connections', () => {
  it('returns connections from edge function', () => {
    const edges = (pos: CPos): GraphConnection[] | null => {
      if (pos.X === 0 && pos.Y === 0) {
        return [
          new GraphConnection(new CPos(1, 0), 10),
          new GraphConnection(new CPos(0, 1), 10),
        ]
      }
      return null
    }

    const graph = new SparsePathGraph(edges)
    const connections = graph.getConnections(new CPos(0, 0))

    expect(connections.length).toBe(2)
    expect(CPos.equals(connections[0].Destination, new CPos(1, 0))).toBe(
      true,
    )
    expect(CPos.equals(connections[1].Destination, new CPos(0, 1))).toBe(
      true,
    )
  })

  it('returns empty array for null edge function result', () => {
    const edges = (): GraphConnection[] | null => null
    const graph = new SparsePathGraph(edges)
    const connections = graph.getConnections(new CPos(0, 0))

    expect(connections.length).toBe(0)
  })

  it('returns empty array for undefined connections', () => {
    const edges = (): GraphConnection[] | null => null
    const graph = new SparsePathGraph(edges)
    const connections = graph.getConnections(new CPos(5, 5))

    expect(connections.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// CellInfo storage
// ---------------------------------------------------------------------------

describe('SparsePathGraph CellInfo storage', () => {
  it('returns unvisited for unknown cells', () => {
    const graph = new SparsePathGraph(() => null)
    const info = graph.getInfo(new CPos(0, 0))

    expect(info.Status).toBe(CellStatus.Unvisited)
  })

  it('stores and retrieves CellInfo', () => {
    const graph = new SparsePathGraph(() => null)
    const pos = new CPos(1, 1)
    const info = new CellInfo(CellStatus.Open, 5, 15, new CPos(0, 0))

    graph.setInfo(pos, info)
    const retrieved = graph.getInfo(pos)

    expect(retrieved.Status).toBe(CellStatus.Open)
    expect(retrieved.CostSoFar).toBe(5)
    expect(retrieved.EstimatedTotalCost).toBe(15)
  })

  it('overwrites existing CellInfo', () => {
    const graph = new SparsePathGraph(() => null)
    const pos = new CPos(1, 1)

    graph.setInfo(
      pos,
      new CellInfo(CellStatus.Open, 5, 15, new CPos(0, 0)),
    )
    graph.setInfo(
      pos,
      new CellInfo(CellStatus.Closed, 10, 20, new CPos(0, 1)),
    )

    const retrieved = graph.getInfo(pos)
    expect(retrieved.Status).toBe(CellStatus.Closed)
    expect(retrieved.CostSoFar).toBe(10)
  })

  it('stores different cells independently', () => {
    const graph = new SparsePathGraph(() => null)
    const pos1 = new CPos(1, 1)
    const pos2 = new CPos(2, 2)

    graph.setInfo(
      pos1,
      new CellInfo(CellStatus.Open, 5, 15, new CPos(0, 0)),
    )
    graph.setInfo(
      pos2,
      new CellInfo(CellStatus.Closed, 10, 20, new CPos(0, 1)),
    )

    const info1 = graph.getInfo(pos1)
    const info2 = graph.getInfo(pos2)

    expect(info1.Status).toBe(CellStatus.Open)
    expect(info2.Status).toBe(CellStatus.Closed)
  })
})

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

describe('SparsePathGraph disposal', () => {
  it('dispose is a no-op', () => {
    const graph = new SparsePathGraph(() => null)
    expect(() => graph.dispose()).not.toThrow()
  })

  it('still works after dispose', () => {
    const graph = new SparsePathGraph(() => null)
    graph.dispose()
    const info = graph.getInfo(new CPos(0, 0))
    expect(info.Status).toBe(CellStatus.Unvisited)
  })
})

// ---------------------------------------------------------------------------
// Estimated search size
// ---------------------------------------------------------------------------

describe('SparsePathGraph estimated search size', () => {
  it('constructs with estimated search size', () => {
    const graph = new SparsePathGraph(() => null, 100)
    expect(graph).toBeDefined()
  })
})
