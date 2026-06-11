/**
 * GridPathGraph.ts — Dense pathfinding graph bounded by a Grid region
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/GridPathGraph.cs
 *
 * 核心范式转换:
 * - C# sealed class → TypeScript class
 * - C# CellInfo[] → TypeScript CellInfo[]
 * - C# override this[CPos] → override getInfo()/setInfo()
 * - C# override IsValidNeighbor → override isValidNeighbor()
 * - C# InfoIndex → private infoIndex()
 */

import { CPos } from '../../OpenRA.Game/CPos'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { IGameWorld } from '../../OpenRA.Game/World'
import type { BlockedByActor } from '../Traits/BlockedByActor'
import type { ILocomotor } from '../Traits/World/Locomotor'
import { CellInfo } from './CellInfo'
import { DensePathGraph } from './DensePathGraph'
import { Grid } from './Grid'

// ---------------------------------------------------------------------------
// GridPathGraph
// ---------------------------------------------------------------------------

/**
 * A dense pathfinding graph that supports a search over all cells within a Grid.
 * Cells outside the grid area are deemed unreachable and will not be considered.
 *
 * OpenRA 对照: GridPathGraph (sealed class)
 *
 * Uses a flat CellInfo[] array for storage, which is more memory-efficient
 * than CellLayer for small grid regions.
 */
export class GridPathGraph extends DensePathGraph {
  /** Flat array of CellInfo, indexed by infoIndex(). */
  private readonly infos: CellInfo[]

  /** The grid defining the search bounds. */
  private readonly grid: Grid

  /**
   * Create a new GridPathGraph.
   *
   * OpenRA 对照: GridPathGraph(Locomotor, Actor, World, BlockedByActor, Func, Actor, bool, bool, Grid)
   *
   * @param locomotor — the locomotor defining movement rules
   * @param actor — the actor doing the moving (null for theoretical)
   * @param world — the game world
   * @param check — blocking check level
   * @param customCost — optional custom cost function
   * @param ignoreActor — actor to ignore during blocking
   * @param laneBias — whether to apply lane bias
   * @param inReverse — whether search is in reverse
   * @param grid — the grid defining search bounds
   */
  constructor(
    locomotor: ILocomotor,
    actor: IGameActor | null,
    world: IGameWorld,
    check: BlockedByActor,
    customCost: ((pos: CPos) => number) | null,
    ignoreActor: IGameActor | null,
    laneBias: boolean,
    inReverse: boolean,
    grid: Grid,
  ) {
    super(
      locomotor,
      actor,
      world,
      check,
      customCost,
      ignoreActor,
      laneBias,
      inReverse,
    )

    this.grid = grid
    this.infos = new Array(grid.Width * grid.Height)
    // Initialize with unvisited (default CellInfo)
    for (let i = 0; i < this.infos.length; i++) {
      this.infos[i] = CellInfo.unvisited()
    }
  }

  /**
   * Check if a neighbor is within the grid bounds.
   *
   * OpenRA 对照: GridPathGraph.IsValidNeighbor(CPos)
   *
   * @param neighbor — the candidate cell
   * @returns true if the cell is within the grid
   */
  protected override isValidNeighbor(neighbor: CPos): boolean {
    return this.grid.contains(neighbor)
  }

  /**
   * Compute the array index for a cell position.
   *
   * OpenRA 对照: GridPathGraph.InfoIndex(CPos)
   *
   * @param pos — the cell position
   * @returns the array index
   */
  private infoIndex(pos: CPos): number {
    return (
      (pos.Y - this.grid.TopLeft.Y) * this.grid.Width +
      (pos.X - this.grid.TopLeft.X)
    )
  }

  /**
   * Get the pathfinding information for a given node.
   *
   * OpenRA 对照: GridPathGraph.this[CPos] get
   *
   * @param pos — the cell position
   * @returns the CellInfo for this node
   */
  override getInfo(pos: CPos): CellInfo {
    return this.infos[this.infoIndex(pos)]
  }

  /**
   * Set the pathfinding information for a given node.
   *
   * OpenRA 对照: GridPathGraph.this[CPos] set
   *
   * @param pos — the cell position
   * @param info — the new CellInfo
   */
  override setInfo(pos: CPos, info: CellInfo): void {
    this.infos[this.infoIndex(pos)] = info
  }
}
