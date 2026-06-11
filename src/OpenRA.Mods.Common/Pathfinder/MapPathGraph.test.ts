/**
 * MapPathGraph.test.ts — MapPathGraph migration unit tests
 *
 * Tests focus on:
 * - Constructor and CellInfoLayerPool integration
 * - CellInfo get/set via CellLayer
 * - dispose() returning layers to pool
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { CellInfo, CellStatus } from './CellInfo'
import { MapPathGraph } from './MapPathGraph'
import { CellInfoLayerPool } from './CellInfoLayerPool'
import { SimpleLocomotor } from '../Traits/World/Locomotor'
import { BlockedByActor } from '../Traits/BlockedByActor'
import type { IGameWorld } from '../../OpenRA.Game/World'
import { MapGridType } from '../../OpenRA.Game/Map/MapGridType'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal IGameWorld stub. */
const stubWorld: IGameWorld = {
  worldTick: 0,
  paused: false,
}

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe('MapPathGraph construction', () => {
  it('constructs with pool and locomotor', () => {
    const pool = new CellInfoLayerPool(
      MapGridType.Rectangular,
      { width: 16, height: 16 },
    )
    const graph = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
    )
    expect(graph).toBeDefined()
    graph.dispose()
  })

  it('constructs with customCost', () => {
    const pool = new CellInfoLayerPool(
      MapGridType.Rectangular,
      { width: 16, height: 16 },
    )
    const graph = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      () => 50,
      null,
      false,
      false,
    )
    expect(graph).toBeDefined()
    graph.dispose()
  })
})

// ---------------------------------------------------------------------------
// CellInfo get/set tests
// ---------------------------------------------------------------------------

describe('MapPathGraph CellInfo', () => {
  it('returns unvisited for unknown cells', () => {
    const pool = new CellInfoLayerPool(
      MapGridType.Rectangular,
      { width: 16, height: 16 },
    )
    const graph = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
    )

    const info = graph.getInfo(new CPos(0, 0))
    expect(info.Status).toBe(CellStatus.Unvisited)
    graph.dispose()
  })

  it('stores and retrieves CellInfo', () => {
    const pool = new CellInfoLayerPool(
      MapGridType.Rectangular,
      { width: 16, height: 16 },
    )
    const graph = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
    )

    const pos = new CPos(5, 5)
    const info = new CellInfo(CellStatus.Open, 10, 20, pos)
    graph.setInfo(pos, info)

    const retrieved = graph.getInfo(pos)
    expect(retrieved.Status).toBe(CellStatus.Open)
    expect(retrieved.CostSoFar).toBe(10)
    expect(retrieved.EstimatedTotalCost).toBe(20)
    expect(retrieved.PreviousNode).toBe(pos)
    graph.dispose()
  })

  it('stores different CellInfo per cell', () => {
    const pool = new CellInfoLayerPool(
      MapGridType.Rectangular,
      { width: 16, height: 16 },
    )
    const graph = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
    )

    const pos1 = new CPos(1, 1)
    const pos2 = new CPos(2, 2)
    graph.setInfo(pos1, new CellInfo(CellStatus.Open, 10, 20, pos1))
    graph.setInfo(pos2, new CellInfo(CellStatus.Closed, 30, 40, pos1))

    const info1 = graph.getInfo(pos1)
    const info2 = graph.getInfo(pos2)
    expect(info1.Status).toBe(CellStatus.Open)
    expect(info2.Status).toBe(CellStatus.Closed)
    expect(info1.CostSoFar).toBe(10)
    expect(info2.CostSoFar).toBe(30)
    graph.dispose()
  })
})

// ---------------------------------------------------------------------------
// getConnections tests
// ---------------------------------------------------------------------------

describe('MapPathGraph getConnections', () => {
  it('returns neighbors for a cell', () => {
    const pool = new CellInfoLayerPool(
      MapGridType.Rectangular,
      { width: 16, height: 16 },
    )
    const graph = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
    )

    const pos = new CPos(5, 5)
    graph.setInfo(pos, new CellInfo(CellStatus.Open, 0, 0, pos))

    const connections = graph.getConnections(pos, () => false)
    expect(connections.length).toBeGreaterThan(0)
    graph.dispose()
  })
})

// ---------------------------------------------------------------------------
// dispose tests
// ---------------------------------------------------------------------------

describe('MapPathGraph dispose', () => {
  it('returns layers to pool without error', () => {
    const pool = new CellInfoLayerPool(
      MapGridType.Rectangular,
      { width: 16, height: 16 },
    )
    const graph = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
    )

    graph.setInfo(new CPos(0, 0), new CellInfo(CellStatus.Open, 0, 0, new CPos(0, 0)))
    expect(() => graph.dispose()).not.toThrow()
  })

  it('pool reuses layers after dispose', () => {
    const pool = new CellInfoLayerPool(
      MapGridType.Rectangular,
      { width: 8, height: 8 },
    )

    // Create and dispose first graph
    const graph1 = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
    )
    graph1.setInfo(new CPos(0, 0), new CellInfo(CellStatus.Closed, 100, 200, new CPos(0, 0)))
    graph1.dispose()

    // Create second graph — should reuse the layer (cleared)
    const graph2 = new MapPathGraph(
      pool,
      new SimpleLocomotor(),
      null,
      stubWorld,
      BlockedByActor.None,
      null,
      null,
      false,
      false,
    )
    const info = graph2.getInfo(new CPos(0, 0))
    // Layer was cleared, so should be unvisited
    expect(info.Status).toBe(CellStatus.Unvisited)
    graph2.dispose()
  })
})
