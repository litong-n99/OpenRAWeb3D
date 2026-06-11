/**
 * IPathGraph.ts — Pathfinding graph interface and edge types
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/IPathGraph.cs
 *
 * 核心范式转换:
 * - C# IDisposable interface → TypeScript dispose() method
 * - C# readonly struct → immutable TypeScript class with readonly fields
 * - C# indexer (this[CPos]) → getInfo()/setInfo() methods (TypeScript has no indexer override)
 * - C# static class PathGraph → namespace-level constants
 */

import { CPos } from '../../OpenRA.Game/CPos'
import type { CellInfo } from './CellInfo'

// ---------------------------------------------------------------------------
// PathGraph constants
// ---------------------------------------------------------------------------

/**
 * Constants for pathfinding graph operations.
 *
 * OpenRA 对照: PathGraph (static class)
 */
export const PathGraph = {
  /** Cost value indicating an invalid/unreachable path. */
  PathCostForInvalidPath: Number.MAX_SAFE_INTEGER,
  /** Cost value indicating a cell is unreachable by movement. */
  MovementCostForUnreachableCell: 32767,
} as const

// ---------------------------------------------------------------------------
// GraphEdge
// ---------------------------------------------------------------------------

/**
 * Represents a full edge in a graph, giving the cost to traverse between two nodes.
 *
 * OpenRA 对照: GraphEdge (readonly struct)
 *
 * Immutable. All fields are readonly.
 */
export class GraphEdge {
  /** Source node of the edge. */
  readonly Source: CPos
  /** Destination node of the edge. */
  readonly Destination: CPos
  /** Cost to traverse this edge. */
  readonly Cost: number

  /**
   * Create a new graph edge.
   *
   * OpenRA 对照: GraphEdge(CPos, CPos, int)
   *
   * @param source — source cell position
   * @param destination — destination cell position
   * @param cost — cost to traverse (must be non-negative and not PathCostForInvalidPath)
   * @throws if source equals destination, cost is negative, or cost equals PathCostForInvalidPath
   */
  constructor(source: CPos, destination: CPos, cost: number) {
    if (CPos.equals(source, destination)) {
      throw new Error(
        `source and destination must refer to different cells (both are ${source.toString()})`,
      )
    }
    if (cost < 0) {
      throw new RangeError(`cost cannot be negative (got ${cost})`)
    }
    if (cost === PathGraph.PathCostForInvalidPath) {
      throw new RangeError(
        `cost cannot be PathCostForInvalidPath (${PathGraph.PathCostForInvalidPath})`,
      )
    }

    this.Source = source
    this.Destination = destination
    this.Cost = cost
  }

  /**
   * Convert this full edge to a partial connection (drops the source).
   *
   * OpenRA 对照: GraphEdge.ToConnection()
   *
   * @returns a GraphConnection with the same destination and cost
   */
  toConnection(): GraphConnection {
    return new GraphConnection(this.Destination, this.Cost)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: GraphEdge.ToString()
   */
  toString(): string {
    return `${this.Source.toString()} -> ${this.Destination.toString()} = ${this.Cost}`
  }
}

// ---------------------------------------------------------------------------
// GraphConnection
// ---------------------------------------------------------------------------

/**
 * Represents part of an edge in a graph, giving the cost to traverse to a node.
 *
 * OpenRA 对照: GraphConnection (readonly struct)
 *
 * Immutable. Used within priority queues; only stores destination and cost.
 */
export class GraphConnection {
  /** Destination node of the connection. */
  readonly Destination: CPos
  /** Cost to reach the destination. */
  readonly Cost: number

  /**
   * Create a new graph connection.
   *
   * OpenRA 对照: GraphConnection(CPos, int)
   *
   * @param destination — destination cell position
   * @param cost — cost to traverse (must be non-negative and not PathCostForInvalidPath)
   * @throws if cost is negative or equals PathCostForInvalidPath
   */
  constructor(destination: CPos, cost: number) {
    if (cost < 0) {
      throw new RangeError(`cost cannot be negative (got ${cost})`)
    }
    if (cost === PathGraph.PathCostForInvalidPath) {
      throw new RangeError(
        `cost cannot be PathCostForInvalidPath (${PathGraph.PathCostForInvalidPath})`,
      )
    }

    this.Destination = destination
    this.Cost = cost
  }

  /**
   * Convert this partial connection to a full edge by adding a source.
   *
   * OpenRA 对照: GraphConnection.ToEdge(CPos)
   *
   * @param source — the source cell position
   * @returns a GraphEdge with the given source
   */
  toEdge(source: CPos): GraphEdge {
    return new GraphEdge(source, this.Destination, this.Cost)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: GraphConnection.ToString()
   */
  toString(): string {
    return `-> ${this.Destination.toString()} = ${this.Cost}`
  }
}

// ---------------------------------------------------------------------------
// IPathGraph interface
// ---------------------------------------------------------------------------

/**
 * Represents a pathfinding graph with nodes and edges.
 * Nodes are represented as cells, and pathfinding information
 * in the form of CellInfo is attached to each one.
 *
 * OpenRA 对照: IPathGraph (interface + IDisposable)
 */
export interface IPathGraph {
  /**
   * Given a source node, returns connections to all reachable destination nodes with their cost.
   *
   * OpenRA 对照: IPathGraph.GetConnections(CPos, Func<CPos, bool>)
   *
   * PERF: Returns an array rather than an iterable as enumerating
   * this efficiently is important for pathfinding performance.
   * Callers should treat the result as read-only.
   *
   * @param source — the source cell to find connections from
   * @param targetPredicate — predicate to identify target cells
   * @returns array of GraphConnection (read-only, do not mutate)
   */
  getConnections(source: CPos, targetPredicate: (pos: CPos) => boolean): GraphConnection[]

  /**
   * Get the pathfinding information for a given node.
   *
   * OpenRA 对照: IPathGraph.this[CPos] get
   *
   * @param node — the cell position to look up
   * @returns the CellInfo for this node
   */
  getInfo(node: CPos): CellInfo

  /**
   * Set the pathfinding information for a given node.
   *
   * OpenRA 对照: IPathGraph.this[CPos] set
   *
   * @param node — the cell position to update
   * @param info — the new CellInfo
   */
  setInfo(node: CPos, info: CellInfo): void

  /**
   * Dispose of any resources held by this graph.
   *
   * OpenRA 对照: IDisposable.Dispose()
   */
  dispose(): void
}
