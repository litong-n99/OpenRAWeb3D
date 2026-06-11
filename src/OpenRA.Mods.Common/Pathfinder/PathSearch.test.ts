/**
 * PathSearch.test.ts — A* pathfinding search unit tests
 *
 * Tests focus on: A* algorithm correctness, shortest path, unreachable targets,
 * bidirectional search, expandAll, state transitions.
 */

import { describe, it, expect, vi } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { PathSearch, NoPath, type IRecorder } from './PathSearch'
import { SparsePathGraph } from './SparsePathGraph'
import { GraphConnection, PathGraph } from './IPathGraph'
import { CellStatus } from './CellInfo'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a simple 4-directional grid graph.
 * Each cell connects to its neighbors with cost 10.
 * Cells outside the grid or in the wall set have no connections.
 */
function makeGridGraph(
  width: number,
  height: number,
  walls: Set<number> = new Set(),
): SparsePathGraph {
  return new SparsePathGraph((pos: CPos) => {
    const key = pos.X * 1000 + pos.Y
    if (walls.has(key)) return null

    const connections: GraphConnection[] = []
    const directions = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]

    for (const [dx, dy] of directions) {
      const nx = pos.X + dx
      const ny = pos.Y + dy
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nkey = nx * 1000 + ny
        if (!walls.has(nkey)) {
          connections.push(new GraphConnection(new CPos(nx, ny), 10))
        }
      }
    }

    return connections
  })
}

/**
 * Manhattan distance heuristic.
 */
function manhattanHeuristic(target: CPos) {
  return (pos: CPos, _isAccessible: boolean): number => {
    return (
      Math.abs(pos.X - target.X) + Math.abs(pos.Y - target.Y)
    ) * 10
  }
}

/**
 * Zero heuristic (Dijkstra's algorithm).
 */
function zeroHeuristic(): number {
  return 0
}

// ---------------------------------------------------------------------------
// Construction tests
// ---------------------------------------------------------------------------

describe('PathSearch construction', () => {
  it('constructs with graph, heuristic, and target', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    expect(search.Graph).toBe(graph)
    expect(search.TargetPredicate(target)).toBe(true)
  })

  it('initial cell is added correctly', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const info = graph.getInfo(new CPos(0, 0))
    expect(info.Status).toBe(CellStatus.Open)
  })

  it('initial cell with invalid custom cost is skipped', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(
      new CPos(0, 0),
      () => PathGraph.PathCostForInvalidPath,
    )
    const info = graph.getInfo(new CPos(0, 0))
    expect(info.Status).toBe(CellStatus.Unvisited)
  })

  it('initial cell with invalid heuristic is skipped', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      () => PathGraph.PathCostForInvalidPath,
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const info = graph.getInfo(new CPos(0, 0))
    expect(info.Status).toBe(CellStatus.Unvisited)
  })
})

// ---------------------------------------------------------------------------
// A* shortest path tests
// ---------------------------------------------------------------------------

describe('PathSearch A* shortest path', () => {
  it('finds path on 3x3 grid from (0,0) to (2,2)', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path.length).toBeGreaterThan(0)
    // Path is reversed: target to source
    expect(CPos.equals(path[0], target)).toBe(true)
    expect(CPos.equals(path[path.length - 1], new CPos(0, 0))).toBe(
      true,
    )
  })

  it('finds shortest path around a wall', () => {
    // 3x3 grid with wall at (1,0) — forces path around
    const walls = new Set([1000]) // (1,0)
    const graph = makeGridGraph(3, 3, walls)
    const target = new CPos(2, 0)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path.length).toBeGreaterThan(0)
    expect(CPos.equals(path[0], target)).toBe(true)
    expect(CPos.equals(path[path.length - 1], new CPos(0, 0))).toBe(
      true,
    )
    // Path should go (0,0) -> (0,1) -> (1,1) -> (2,1) -> (2,0) or similar
    // Not through (1,0) which is a wall
    for (const pos of path) {
      expect(pos.X === 1 && pos.Y === 0).toBe(false)
    }
  })

  it('returns NoPath for completely blocked target', () => {
    // 3x3 grid with target (2,2) surrounded by walls
    const walls = new Set([2001, 1002]) // (2,1), (1,2)
    const graph = makeGridGraph(3, 3, walls)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path).toBe(NoPath)
    expect(path.length).toBe(0)
  })

  it('returns NoPath when source is isolated', () => {
    // Source (0,0) surrounded by walls
    const walls = new Set([1000, 1]) // (1,0), (0,1)
    const graph = makeGridGraph(3, 3, walls)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path).toBe(NoPath)
  })

  it('finds path on larger grid', () => {
    const graph = makeGridGraph(10, 10)
    const target = new CPos(9, 9)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path.length).toBeGreaterThan(0)
    expect(CPos.equals(path[0], target)).toBe(true)
    expect(CPos.equals(path[path.length - 1], new CPos(0, 0))).toBe(
      true,
    )
  })

  it('finds direct path for adjacent cells', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(1, 0)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path.length).toBe(2)
    expect(CPos.equals(path[0], target)).toBe(true)
    expect(CPos.equals(path[1], new CPos(0, 0))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// expandToTarget tests
// ---------------------------------------------------------------------------

describe('PathSearch expandToTarget', () => {
  it('returns true when target is found', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    expect(search.expandToTarget()).toBe(true)
  })

  it('returns false when target is unreachable', () => {
    const walls = new Set([2001, 1002])
    const graph = makeGridGraph(3, 3, walls)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    expect(search.expandToTarget()).toBe(false)
  })

  it('returns false on second call after target already found', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    expect(search.expandToTarget()).toBe(true)
    // Second call: target is already Closed, so expandToTarget returns false
    expect(search.expandToTarget()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// expandAll tests
// ---------------------------------------------------------------------------

describe('PathSearch expandAll', () => {
  it('visits all reachable nodes on small grid', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const visited = search.expandAll()

    // All 9 cells should be visited
    expect(visited.length).toBe(9)
  })

  it('visits only reachable nodes with walls', () => {
    const walls = new Set([1000, 1]) // (1,0), (0,1)
    const graph = makeGridGraph(3, 3, walls)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const visited = search.expandAll()

    // Only (0,0) is reachable
    expect(visited.length).toBe(1)
    expect(CPos.equals(visited[0], new CPos(0, 0))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// canExpand tests
// ---------------------------------------------------------------------------

describe('PathSearch canExpand', () => {
  it('returns true when there are open nodes', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    expect(search.canExpand()).toBe(true)
  })

  it('returns false when queue is empty', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    // No initial cell added
    expect(search.canExpand()).toBe(false)
  })

  it('returns false after expanding all nodes', () => {
    const graph = makeGridGraph(2, 2)
    const target = new CPos(1, 1)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    search.expandAll()
    expect(search.canExpand()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// expand tests
// ---------------------------------------------------------------------------

describe('PathSearch expand', () => {
  it('expands the most promising node', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const expanded = search.expand()

    // Should expand the initial cell (0,0) since it's the only open node
    expect(CPos.equals(expanded, new CPos(0, 0))).toBe(true)

    // (0,0) should now be Closed
    const info = graph.getInfo(new CPos(0, 0))
    expect(info.Status).toBe(CellStatus.Closed)
  })

  it('marks neighbors as Open after expansion', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    search.expand()

    // Neighbors of (0,0) should be Open
    const right = graph.getInfo(new CPos(1, 0))
    const down = graph.getInfo(new CPos(0, 1))
    expect(right.Status).toBe(CellStatus.Open)
    expect(down.Status).toBe(CellStatus.Open)
  })
})

// ---------------------------------------------------------------------------
// Bidirectional search tests
// ---------------------------------------------------------------------------

describe('PathSearch bidirectional search', () => {
  it('finds path between two points', () => {
    // Bidirectional search requires separate graphs for each direction
    const graph1 = makeGridGraph(5, 5)
    const graph2 = makeGridGraph(5, 5)
    const target1 = new CPos(4, 4)
    const target2 = new CPos(0, 0)

    const search1 = new PathSearch(
      graph1,
      manhattanHeuristic(target1),
      100,
      (pos) => CPos.equals(pos, target1),
    )
    const search2 = new PathSearch(
      graph2,
      manhattanHeuristic(target2),
      100,
      (pos) => CPos.equals(pos, target2),
    )

    search1.addInitialCell(new CPos(0, 0))
    search2.addInitialCell(new CPos(4, 4))

    const path = PathSearch.findBidiPath(search1, search2)

    expect(path.length).toBeGreaterThan(0)
    // Path goes from first source (0,0) to second source (4,4)
    expect(CPos.equals(path[0], new CPos(0, 0))).toBe(true)
    expect(CPos.equals(path[path.length - 1], new CPos(4, 4))).toBe(
      true,
    )
  })

  it('returns NoPath when no connection exists', () => {
    // Two isolated regions
    const walls = new Set<number>()
    // Wall across the middle
    for (let y = 0; y < 5; y++) {
      walls.add(2 * 1000 + y) // (2, y) for all y
    }
    const graph1 = makeGridGraph(5, 5, walls)
    const graph2 = makeGridGraph(5, 5, walls)

    const search1 = new PathSearch(
      graph1,
      zeroHeuristic,
      100,
      () => false,
    )
    const search2 = new PathSearch(
      graph2,
      zeroHeuristic,
      100,
      () => false,
    )

    search1.addInitialCell(new CPos(0, 0))
    search2.addInitialCell(new CPos(4, 4))

    const path = PathSearch.findBidiPath(search1, search2)
    expect(path).toBe(NoPath)
  })

  it('finds path for adjacent cells', () => {
    const graph1 = makeGridGraph(3, 3)
    const graph2 = makeGridGraph(3, 3)

    const search1 = new PathSearch(
      graph1,
      zeroHeuristic,
      100,
      (pos) => CPos.equals(pos, new CPos(1, 0)),
    )
    const search2 = new PathSearch(
      graph2,
      zeroHeuristic,
      100,
      (pos) => CPos.equals(pos, new CPos(0, 0)),
    )

    search1.addInitialCell(new CPos(0, 0))
    search2.addInitialCell(new CPos(1, 0))

    const path = PathSearch.findBidiPath(search1, search2)

    expect(path.length).toBe(2)
    expect(CPos.equals(path[0], new CPos(0, 0))).toBe(true)
    expect(CPos.equals(path[1], new CPos(1, 0))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Heuristic weight tests
// ---------------------------------------------------------------------------

describe('PathSearch heuristic weight', () => {
  it('finds path with weight 100 (optimal)', () => {
    const graph = makeGridGraph(5, 5)
    const target = new CPos(4, 4)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path.length).toBeGreaterThan(0)
    // With Manhattan heuristic and uniform costs, optimal path has 9 cells
    expect(path.length).toBe(9)
  })

  it('finds path with weight 150 (suboptimal allowed)', () => {
    const graph = makeGridGraph(5, 5)
    const target = new CPos(4, 4)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      150,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path.length).toBeGreaterThan(0)
    // Suboptimal path may be longer
    expect(path.length).toBeGreaterThanOrEqual(9)
  })
})

// ---------------------------------------------------------------------------
// Recorder tests
// ---------------------------------------------------------------------------

describe('PathSearch recorder', () => {
  it('records explored nodes', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const recorder: IRecorder = {
      add: vi.fn(),
    }

    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
      recorder,
    )

    search.addInitialCell(new CPos(0, 0))
    search.findPath()

    expect(recorder.add).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Disposal tests
// ---------------------------------------------------------------------------

describe('PathSearch disposal', () => {
  it('disposes the graph', () => {
    const graph = makeGridGraph(3, 3)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    expect(() => search.dispose()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Edge case tests
// ---------------------------------------------------------------------------

describe('PathSearch edge cases', () => {
  it('handles single-cell graph', () => {
    const graph = makeGridGraph(1, 1)
    const target = new CPos(0, 0)
    const search = new PathSearch(
      graph,
      zeroHeuristic,
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path.length).toBe(1)
    expect(CPos.equals(path[0], new CPos(0, 0))).toBe(true)
  })

  it('handles empty graph (no initial cell)', () => {
    const graph = makeGridGraph(1, 1)
    const target = new CPos(0, 0)
    const search = new PathSearch(
      graph,
      zeroHeuristic,
      100,
      (pos) => CPos.equals(pos, target),
    )

    // No initial cell added
    const path = search.findPath()
    expect(path).toBe(NoPath)
  })

  it('handles target unreachable from all directions', () => {
    // 3x3 with target surrounded by walls
    const walls2 = new Set([1002, 2001]) // (1,2), (2,1) — block access to (2,2)
    const graph = makeGridGraph(3, 3, walls2)
    const target = new CPos(2, 2)
    const search = new PathSearch(
      graph,
      manhattanHeuristic(target),
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()
    expect(path).toBe(NoPath)
  })

  it('handles zero-cost edges', () => {
    const graph = new SparsePathGraph((pos: CPos) => {
      if (pos.X === 0 && pos.Y === 0) {
        return [new GraphConnection(new CPos(1, 0), 0)]
      }
      if (pos.X === 1 && pos.Y === 0) {
        return [new GraphConnection(new CPos(2, 0), 0)]
      }
      return null
    })

    const target = new CPos(2, 0)
    const search = new PathSearch(
      graph,
      zeroHeuristic,
      100,
      (pos) => CPos.equals(pos, target),
    )

    search.addInitialCell(new CPos(0, 0))
    const path = search.findPath()

    expect(path.length).toBe(3)
    expect(CPos.equals(path[0], target)).toBe(true)
    expect(CPos.equals(path[2], new CPos(0, 0))).toBe(true)
  })
})
