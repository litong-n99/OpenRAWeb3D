/**
 * PathSearch.ts — A* pathfinding search implementation
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/PathSearch.cs
 *
 * 核心范式转换:
 * - C# sealed class + IDisposable → TypeScript class with dispose()
 * - C# IPriorityQueue<GraphConnection> → PriorityQueue<GraphConnection> with inline comparer
 * - C# Func<CPos, bool, int> heuristic → TypeScript function type
 * - C# static factory methods (deferred to batch 2, need Locomotor)
 * - C# List<CPos> → CPos[] (TypeScript array)
 */

import { CPos } from '../../OpenRA.Game/CPos'
import { PriorityQueue } from '../../OpenRA.Game/Primitives/PriorityQueue'
import { CellInfo, CellStatus, type CellStatusValue } from './CellInfo'
import { GraphConnection, PathGraph, type IPathGraph } from './IPathGraph'

// ---------------------------------------------------------------------------
// IRecorder interface
// ---------------------------------------------------------------------------

/**
 * Interface for recording nodes explored by path searches.
 *
 * OpenRA 对照: PathSearch.IRecorder
 */
export interface IRecorder {
  /**
   * Record a node that was explored by the search.
   *
   * OpenRA 对照: IRecorder.Add(CPos, CPos, int, int)
   *
   * @param source — the source node
   * @param destination — the destination node
   * @param costSoFar — cost to reach the destination
   * @param estimatedRemainingCost — estimated remaining cost to target
   */
  add(
    source: CPos,
    destination: CPos,
    costSoFar: number,
    estimatedRemainingCost: number,
  ): void
}

// ---------------------------------------------------------------------------
// NoPath sentinel
// ---------------------------------------------------------------------------

/**
 * Sentinel value returned when no path can be found.
 *
 * OpenRA 对照: PathFinder.NoPath
 */
export const NoPath: CPos[] = []

// ---------------------------------------------------------------------------
// PathSearch
// ---------------------------------------------------------------------------

/**
 * A* pathfinding search over an IPathGraph.
 *
 * OpenRA 对照: PathSearch (sealed class)
 *
 * Implements the A* algorithm with configurable heuristic weight.
 * Supports unidirectional and bidirectional search.
 *
 * NOTE: Factory methods (toTargetCell, toTargetCellByPredicate, etc.)
 * are deferred to batch 2 as they require Locomotor.
 */
export class PathSearch {
  /** The graph being searched. */
  readonly Graph: IPathGraph

  /** Predicate that determines if a cell is the target. */
  TargetPredicate: (pos: CPos) => boolean

  /** Heuristic function: estimates cost from a cell to the target. */
  private readonly heuristic: (pos: CPos, isAccessible: boolean) => number

  /** Heuristic weight percentage (100 = optimal, >100 = faster but suboptimal). */
  private readonly heuristicWeightPercentage: number

  /** Optional recorder for explored nodes. */
  private readonly recorder: IRecorder | null

  /** Priority queue of open nodes, ordered by estimated total cost. */
  private readonly openQueue: PriorityQueue<GraphConnection>

  /**
   * Initialize a new search.
   *
   * OpenRA 对照: PathSearch(IPathGraph, Func<CPos, bool, int>, int, Func<CPos, bool>, IRecorder)
   *
   * @param graph — graph over which the search is conducted
   * @param heuristic — provides an estimation of the distance between the given cell and the target.
   *   The Boolean parameter indicates if the cell is known to be accessible.
   *   When true, it is known accessible as it is being explored by the search.
   *   When false, the cell is being considered as a starting location and might not be accessible.
   * @param heuristicWeightPercentage — the search will aim for the shortest path when given a weight of 100%.
   *   We can allow the search to find paths that aren't optimal by changing the weight.
   *   The weight limits the worst case length of the path,
   *   e.g. a weight of 110% will find a path no more than 10% longer than the shortest possible.
   *   The benefit of allowing the search to return suboptimal paths is faster computation time.
   *   The search can skip some areas of the search space, meaning it has less work to do.
   * @param targetPredicate — determines if the given cell is the target
   * @param recorder — if provided, will record all nodes explored by searches performed
   */
  constructor(
    graph: IPathGraph,
    heuristic: (pos: CPos, isAccessible: boolean) => number,
    heuristicWeightPercentage: number,
    targetPredicate: (pos: CPos) => boolean,
    recorder: IRecorder | null = null,
  ) {
    this.Graph = graph
    this.heuristic = heuristic
    this.heuristicWeightPercentage = heuristicWeightPercentage
    this.TargetPredicate = targetPredicate
    this.recorder = recorder
    this.openQueue = new PriorityQueue<GraphConnection>(
      (a, b) => a.Cost - b.Cost,
    )
  }

  /**
   * Add an initial cell to the search.
   *
   * OpenRA 对照: PathSearch.AddInitialCell(CPos, Func<CPos, int>)
   *
   * @param location — the starting cell
   * @param customCost — optional custom cost for this cell
   */
  addInitialCell(
    location: CPos,
    customCost: ((pos: CPos) => number) | null = null,
  ): void {
    let initialCost = 0
    if (customCost !== null) {
      initialCost = customCost(location)
      if (initialCost === PathGraph.PathCostForInvalidPath) {
        return
      }
    }

    const heuristicCost = this.heuristic(location, false)
    if (heuristicCost === PathGraph.PathCostForInvalidPath) {
      return
    }

    const estimatedCost =
      (heuristicCost * this.heuristicWeightPercentage) / 100
    this.Graph.setInfo(
      location,
      new CellInfo(
        CellStatus.Open,
        initialCost,
        initialCost + estimatedCost,
        location,
      ),
    )
    this.openQueue.add(new GraphConnection(location, estimatedCost))
  }

  /**
   * Determines if there are more reachable cells and the search can be continued.
   * If false, expand() can no longer be called.
   *
   * OpenRA 对照: PathSearch.CanExpand()
   *
   * @returns true if the search can continue expanding
   */
  canExpand(): boolean {
    let status: CellStatusValue

    do {
      if (this.openQueue.empty) {
        return false
      }

      status = this.Graph.getInfo(this.openQueue.peek().Destination).Status
      if (status === CellStatus.Closed) {
        this.openQueue.pop()
      }
    } while (status === CellStatus.Closed)

    return true
  }

  /**
   * This function analyzes the neighbors of the most promising node in the pathfinding graph
   * using the A* algorithm (A-star) and returns that node.
   *
   * OpenRA 对照: PathSearch.Expand()
   *
   * @returns the most promising node of the iteration
   */
  expand(): CPos {
    const currentMinNode = this.openQueue.pop().Destination

    const currentInfo = this.Graph.getInfo(currentMinNode)
    this.Graph.setInfo(
      currentMinNode,
      new CellInfo(
        CellStatus.Closed,
        currentInfo.CostSoFar,
        currentInfo.EstimatedTotalCost,
        currentInfo.PreviousNode,
      ),
    )

    for (const connection of this.Graph.getConnections(
      currentMinNode,
      this.TargetPredicate,
    )) {
      // Calculate the cost up to that point
      const costSoFarToNeighbor = currentInfo.CostSoFar + connection.Cost

      const neighbor = connection.Destination
      const neighborInfo = this.Graph.getInfo(neighbor)

      // Cost is even higher; next direction:
      if (
        neighborInfo.Status === CellStatus.Closed ||
        (neighborInfo.Status === CellStatus.Open &&
          costSoFarToNeighbor >= neighborInfo.CostSoFar)
      ) {
        continue
      }

      // Now we may seriously consider this direction using heuristics.
      let estimatedRemainingCostToTarget: number
      if (neighborInfo.Status === CellStatus.Open) {
        // If the cell has already been processed, we can reuse the result
        // (just the difference between the estimated total and the cost so far)
        estimatedRemainingCostToTarget =
          neighborInfo.EstimatedTotalCost - neighborInfo.CostSoFar
      } else {
        // If the heuristic reports the cell is unreachable, we won't consider it.
        const heuristicCost = this.heuristic(neighbor, true)
        if (heuristicCost === PathGraph.PathCostForInvalidPath) {
          continue
        }
        estimatedRemainingCostToTarget =
          (heuristicCost * this.heuristicWeightPercentage) / 100
      }

      this.recorder?.add(
        currentMinNode,
        neighbor,
        costSoFarToNeighbor,
        estimatedRemainingCostToTarget,
      )

      const estimatedTotalCostToTarget =
        costSoFarToNeighbor + estimatedRemainingCostToTarget
      this.Graph.setInfo(
        neighbor,
        new CellInfo(
          CellStatus.Open,
          costSoFarToNeighbor,
          estimatedTotalCostToTarget,
          currentMinNode,
        ),
      )
      this.openQueue.add(
        new GraphConnection(neighbor, estimatedTotalCostToTarget),
      )
    }

    return currentMinNode
  }

  /**
   * Expands the path search until a path is found, and returns whether a path is found successfully.
   *
   * OpenRA 对照: PathSearch.ExpandToTarget()
   *
   * If the path search has previously been expanded it will only return true if a path can be found during
   * this expansion of the search. If the search was expanded previously and the target is already
   * Closed then this method will return false.
   *
   * @returns true if a path to the target was found
   */
  expandToTarget(): boolean {
    while (this.canExpand()) {
      if (this.TargetPredicate(this.expand())) {
        return true
      }
    }

    return false
  }

  /**
   * Expands the path search over the whole search space.
   * Returns the cells that were visited during the search.
   *
   * OpenRA 对照: PathSearch.ExpandAll()
   *
   * @returns array of cells that were visited during the search
   */
  expandAll(): CPos[] {
    const consideredCells: CPos[] = []
    while (this.canExpand()) {
      consideredCells.push(this.expand())
    }
    return consideredCells
  }

  /**
   * Expands the path search until a path is found, and returns that path.
   * Returned path is reversed and given target to source.
   *
   * OpenRA 对照: PathSearch.FindPath()
   *
   * @returns array of CPos from target to source, or NoPath if no path exists
   */
  findPath(): CPos[] {
    while (this.canExpand()) {
      const p = this.expand()
      if (this.TargetPredicate(p)) {
        return PathSearch.makePath(this.Graph, p)
      }
    }

    return NoPath
  }

  /**
   * Expands both path searches until they intersect, and returns the path.
   * Returned path is from the source of the first search to the source of the second search.
   *
   * OpenRA 对照: PathSearch.FindBidiPath(PathSearch, PathSearch)
   *
   * @param first — the first path search
   * @param second — the second path search
   * @returns array of CPos from first source to second source, or NoPath
   */
  static findBidiPath(first: PathSearch, second: PathSearch): CPos[] {
    while (first.canExpand() && second.canExpand()) {
      // make some progress on the first search
      const p = first.expand()
      const pInfo = second.Graph.getInfo(p)
      if (
        pInfo.Status === CellStatus.Closed &&
        pInfo.CostSoFar !== PathGraph.PathCostForInvalidPath
      ) {
        return PathSearch.makeBidiPath(first, second, p)
      }

      // make some progress on the second search
      const q = second.expand()
      const qInfo = first.Graph.getInfo(q)
      if (
        qInfo.Status === CellStatus.Closed &&
        qInfo.CostSoFar !== PathGraph.PathCostForInvalidPath
      ) {
        return PathSearch.makeBidiPath(first, second, q)
      }
    }

    return NoPath
  }

  /**
   * Dispose of the graph held by this search.
   *
   * OpenRA 对照: PathSearch.Dispose()
   */
  dispose(): void {
    this.Graph.dispose()
  }

  // -------------------------------------------------------------------------
  // Private static helpers
  // -------------------------------------------------------------------------

  /**
   * Build the path from the destination.
   * When we find a node that has the same previous position as itself, that node is the source node.
   *
   * OpenRA 对照: PathSearch.MakePath(IPathGraph, CPos)
   *
   * @param graph — the path graph
   * @param destination — the destination cell
   * @returns array of CPos from destination back to source
   */
  private static makePath(graph: IPathGraph, destination: CPos): CPos[] {
    const ret: CPos[] = []
    let currentNode = destination

    while (
      !CPos.equals(graph.getInfo(currentNode).PreviousNode, currentNode)
    ) {
      ret.push(currentNode)
      currentNode = graph.getInfo(currentNode).PreviousNode
    }

    ret.push(currentNode)
    return ret
  }

  /**
   * Build the path from the destination of each search.
   * When we find a node that has the same previous position as itself, that is the source of that search.
   *
   * OpenRA 对照: PathSearch.MakeBidiPath(PathSearch, PathSearch, CPos)
   *
   * @param first — the first path search
   * @param second — the second path search
   * @param confluenceNode — the node where the two searches meet
   * @returns array of CPos from first source to second source
   */
  private static makeBidiPath(
    first: PathSearch,
    second: PathSearch,
    confluenceNode: CPos,
  ): CPos[] {
    const ca = first.Graph
    const cb = second.Graph

    const ret: CPos[] = []

    // Walk backward from confluence to first source
    let q = confluenceNode
    let previous = ca.getInfo(q).PreviousNode
    while (!CPos.equals(previous, q)) {
      ret.push(q)
      q = previous
      previous = ca.getInfo(q).PreviousNode
    }

    ret.push(q)

    // Reverse to get first source -> confluence
    ret.reverse()

    // Walk from confluence to second source
    q = confluenceNode
    previous = cb.getInfo(q).PreviousNode
    while (!CPos.equals(previous, q)) {
      q = previous
      previous = cb.getInfo(q).PreviousNode
      ret.push(q)
    }

    return ret
  }
}
