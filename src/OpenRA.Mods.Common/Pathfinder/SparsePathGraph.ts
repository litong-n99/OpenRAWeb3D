/**
 * SparsePathGraph.ts — Sparse pathfinding graph for arbitrary node/edge graphs
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/SparsePathGraph.cs
 *
 * 核心范式转换:
 * - C# Func<CPos, List<GraphConnection>> → TypeScript function type
 * - C# Dictionary<CPos, CellInfo> → TypeScript Map<CPos, CellInfo>
 * - C# this[CPos] indexer → getInfo()/setInfo() methods
 * - C# default(CellInfo) for missing keys → CellInfo.unvisited()
 */

import { CPos } from '../../OpenRA.Game/CPos'
import { CellInfo } from './CellInfo'
import { GraphConnection, type IPathGraph } from './IPathGraph'

// ---------------------------------------------------------------------------
// SparsePathGraph
// ---------------------------------------------------------------------------

/**
 * A sparse pathfinding graph that supports a search over provided cells.
 * This is a classic graph that supports an arbitrary graph of nodes and edges,
 * and does not require a dense grid of cells.
 * Costs and any desired connections to a custom movement layer
 * must be provided as input.
 *
 * OpenRA 对照: SparsePathGraph (sealed class)
 */
export class SparsePathGraph implements IPathGraph {
  /** Edge function: given a position, returns its outgoing connections. */
  private readonly edges: (pos: CPos) => GraphConnection[] | null

  /** Map of cell positions to their pathfinding info. */
  private readonly info: Map<number, CellInfo>

  /**
   * Create a new SparsePathGraph.
   *
   * OpenRA 对照: SparsePathGraph(Func<CPos, List<GraphConnection>>, int)
   *
   * @param edges — function that returns outgoing connections for a given cell
   * @param estimatedSearchSize — estimated number of cells in the search (for Map preallocation)
   */
  constructor(
    edges: (pos: CPos) => GraphConnection[] | null,
    _estimatedSearchSize: number = 0,
  ) {
    this.edges = edges
    this.info = new Map<number, CellInfo>()
  }

  /**
   * Get connections from a given source cell.
   *
   * OpenRA 对照: SparsePathGraph.GetConnections(CPos, Func<CPos, bool>)
   *
   * @param source — the source cell
   * @returns array of GraphConnection (empty if no edges defined)
   */
  getConnections(source: CPos): GraphConnection[] {
    return this.edges(source) ?? []
  }

  /**
   * Get the pathfinding information for a given node.
   *
   * OpenRA 对照: SparsePathGraph.this[CPos] get
   *
   * Returns CellInfo.unvisited() if the node has not been visited.
   *
   * @param pos — the cell position to look up
   * @returns the CellInfo for this node
   */
  getInfo(pos: CPos): CellInfo {
    const info = this.info.get(pos.Bits)
    if (info !== undefined) {
      return info
    }
    return CellInfo.unvisited()
  }

  /**
   * Set the pathfinding information for a given node.
   *
   * OpenRA 对照: SparsePathGraph.this[CPos] set
   *
   * @param pos — the cell position to update
   * @param info — the new CellInfo
   */
  setInfo(pos: CPos, info: CellInfo): void {
    this.info.set(pos.Bits, info)
  }

  /**
   * Dispose of any resources held by this graph.
   *
   * OpenRA 对照: SparsePathGraph.Dispose()
   *
   * No-op for SparsePathGraph (no unmanaged resources).
   */
  dispose(): void {
    // No-op
  }
}
