/**
 * DensePathGraph.ts — Dense 8-directional pathfinding graph with custom movement layers
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/DensePathGraph.cs
 *
 * 核心范式转换:
 * - C# abstract class + sealed derived → TypeScript abstract class + concrete derived
 * - C# this[CPos] indexer → getInfo()/setInfo() methods (TypeScript has no indexer override)
 * - C# static readonly CVec[][] → static readonly CVec[][] (same pattern)
 * - C# Exts.MultiplyBySqrtTwo → inline Math.SQRT2 multiplication
 * - C# List<GraphConnection> → GraphConnection[] (pre-allocated capacity)
 */

import { CPos } from '../../OpenRA.Game/CPos'
import { CVec } from '../../OpenRA.Game/CVec'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { IGameWorld } from '../../OpenRA.Game/World'
import type { BlockedByActor } from '../Traits/BlockedByActor'
import type { ICustomMovementLayer } from '../Traits/ICustomMovementLayer'
import type { ILocomotor } from '../Traits/World/Locomotor'
import { CellInfo, CellStatus } from './CellInfo'
import { GraphConnection, PathGraph } from './IPathGraph'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cost added by lane bias for smoother flow. */
const LANE_BIAS_COST = 1

// ---------------------------------------------------------------------------
// Directed neighbor sets
// ---------------------------------------------------------------------------

/**
 * Sets of neighbors for each incoming direction. These exclude the neighbors
 * which are guaranteed to be reached more cheaply by a path through our parent
 * cell which does not include the current cell.
 *
 * For horizontal/vertical directions, the set is the three cells 'ahead'.
 * For diagonal directions, the set is the three cells ahead, plus the two
 * cells to the side.
 *
 * OpenRA 对照: DensePathGraph.DirectedNeighbors (static readonly)
 *
 * Index mapping: dy * 3 + dx + 4 where dx,dy in {-1,0,1}
 *   0: TL (-1,-1), 1: T (0,-1), 2: TR (1,-1)
 *   3: L (-1,0),  4: C (0,0),  5: R (1,0)
 *   6: BL (-1,1), 7: B (0,1),  8: BR (1,1)
 */
const DirectedNeighbors: readonly CVec[][] = [
  [new CVec(-1, -1), new CVec(0, -1), new CVec(1, -1), new CVec(-1, 0), new CVec(-1, 1)], // TL: exclude BR, R, B
  [new CVec(-1, -1), new CVec(0, -1), new CVec(1, -1)], // T: exclude BL, L, R, BR, B
  [new CVec(-1, -1), new CVec(0, -1), new CVec(1, -1), new CVec(1, 0), new CVec(1, 1)], // TR: exclude BL, L, B
  [new CVec(-1, -1), new CVec(-1, 0), new CVec(-1, 1)], // L: exclude T, TR, R, BR, B
  [...CVec.Directions], // C: all 8 directions (should not be used as previous)
  [new CVec(1, -1), new CVec(1, 0), new CVec(1, 1)], // R: exclude T, TL, L, BL, B
  [new CVec(-1, -1), new CVec(-1, 0), new CVec(-1, 1), new CVec(0, 1), new CVec(1, 1)], // BL: exclude T, TR, R
  [new CVec(-1, 1), new CVec(0, 1), new CVec(1, 1)], // B: exclude TL, L, R, TR, T
  [new CVec(1, -1), new CVec(1, 0), new CVec(-1, 1), new CVec(0, 1), new CVec(1, 1)], // BR: exclude TL, L, T
]

/**
 * Conservative neighbor sets used when terrain height discontinuities exist.
 * With height discontinuities, we cannot optimize neighbors because a height
 * difference may have prevented the parent from reaching a cell that the
 * current cell can reach.
 *
 * OpenRA 对照: DensePathGraph.DirectedNeighborsConservative (static readonly)
 *
 * Only excludes the parent cell direction from each set.
 */
const DirectedNeighborsConservative: readonly CVec[][] = [
  CVec.Directions.filter((d) => !(d.X === 1 && d.Y === 1)), // TL: exclude BR
  CVec.Directions.filter((d) => !(d.X === 0 && d.Y === 1)), // T: exclude B
  CVec.Directions.filter((d) => !(d.X === -1 && d.Y === 1)), // TR: exclude BL
  CVec.Directions.filter((d) => !(d.X === 1 && d.Y === 0)), // L: exclude R
  [...CVec.Directions], // C: all directions
  CVec.Directions.filter((d) => !(d.X === -1 && d.Y === 0)), // R: exclude L
  CVec.Directions.filter((d) => !(d.X === 1 && d.Y === -1)), // BL: exclude TR
  CVec.Directions.filter((d) => !(d.X === 0 && d.Y === -1)), // B: exclude T
  CVec.Directions.filter((d) => !(d.X === -1 && d.Y === -1)), // BR: exclude TL
]

// ---------------------------------------------------------------------------
// DensePathGraph
// ---------------------------------------------------------------------------

/**
 * A dense pathfinding graph that implements the ability to cost and get
 * connections for cells, and supports ICustomMovementLayer. Allows searching
 * over a dense grid of cells.
 *
 * OpenRA 对照: DensePathGraph (abstract class)
 *
 * Derived classes are required to provide backing storage for the
 * pathfinding information (CellInfo per cell).
 */
export abstract class DensePathGraph {
  /** Custom movement layers available in the world. */
  protected readonly CustomMovementLayers: readonly (ICustomMovementLayer | null)[]

  /** Number of custom movement layers enabled for this locomotor. */
  protected readonly customMovementLayersEnabledForLocomotor: number

  /** The locomotor defining movement rules. */
  protected readonly locomotor: ILocomotor

  /** The actor doing the moving (null for theoretical checks). */
  protected readonly actor: IGameActor | null

  /** The game world. */
  protected readonly world: IGameWorld

  /** Blocking check level. */
  protected readonly check: BlockedByActor

  /** Optional custom cost function. */
  protected readonly customCost: ((pos: CPos) => number) | null

  /** Actor to ignore during blocking checks. */
  protected readonly ignoreActor: IGameActor | null

  /** Whether to apply lane bias for smoother flow. */
  protected readonly laneBias: boolean

  /** Whether the search is running in reverse (target → source). */
  protected readonly inReverse: boolean

  /** Whether to check terrain height for neighbor optimization. */
  protected readonly checkTerrainHeight: boolean

  /**
   * Create a new DensePathGraph.
   *
   * OpenRA 对照: DensePathGraph(Locomotor, Actor, World, BlockedByActor, Func, Actor, bool, bool)
   *
   * @param locomotor — the locomotor defining movement rules
   * @param actor — the actor doing the moving (null for theoretical)
   * @param world — the game world
   * @param check — blocking check level
   * @param customCost — optional custom cost function
   * @param ignoreActor — actor to ignore during blocking
   * @param laneBias — whether to apply lane bias
   * @param inReverse — whether search is in reverse
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
  ) {
    this.locomotor = locomotor
    this.actor = actor
    this.world = world
    this.check = check
    this.customCost = customCost
    this.ignoreActor = ignoreActor
    this.laneBias = laneBias
    this.inReverse = inReverse

    // STUB: Custom movement layers — get from world when fully implemented
    // TODO-5.X: Replace with world.getCustomMovementLayers() when World has it
    this.CustomMovementLayers = []
    this.customMovementLayersEnabledForLocomotor = 0

    // STUB: Terrain height check — get from world.Map when fully implemented
    // TODO-5.X: Replace with world.Map.Grid.MaximumTerrainHeight > 0
    this.checkTerrainHeight = false
  }

  /**
   * Get the pathfinding information for a given node.
   *
   * OpenRA 对照: DensePathGraph.this[CPos] get
   *
   * @param node — the cell position
   * @returns the CellInfo for this node
   */
  abstract getInfo(node: CPos): CellInfo

  /**
   * Set the pathfinding information for a given node.
   *
   * OpenRA 对照: DensePathGraph.this[CPos] set
   *
   * @param node — the cell position
   * @param info — the new CellInfo
   */
  abstract setInfo(node: CPos, info: CellInfo): void

  /**
   * Determines if a candidate neighbouring position is allowable.
   *
   * OpenRA 对照: DensePathGraph.IsValidNeighbor(CPos)
   *
   * @param neighbor — the candidate cell (might not lie within map bounds)
   * @returns true if the neighbor is valid
   */
  protected isValidNeighbor(_neighbor: CPos): boolean {
    return true
  }

  /**
   * Get connections from a given source cell.
   *
   * OpenRA 对照: DensePathGraph.GetConnections(CPos, Func<CPos, bool>)
   *
   * Returns all valid neighbor cells with their path costs.
   * Uses directed neighbor optimization to avoid checking cells that
   * would be reached more cheaply via the parent cell.
   *
   * @param position — the source cell
   * @param targetPredicate — predicate to identify target cells
   * @returns array of GraphConnection (read-only, do not mutate)
   */
  getConnections(
    position: CPos,
    targetPredicate: (pos: CPos) => boolean,
  ): GraphConnection[] {
    const layer = position.Layer
    const info = this.getInfo(position)
    const previousNode = info.PreviousNode

    const dx = position.X - previousNode.X
    const dy = position.Y - previousNode.Y
    const index = dy * 3 + dx + 4

    // Choose neighbor set based on terrain height
    // STUB: Height layer check disabled until world.Map.Height is available
    // TODO-5.X: Enable height check when Map.Height layer is migrated
    const directions =
      (this.checkTerrainHeight &&
        layer === 0 &&
        previousNode.Layer === 0
        ? DirectedNeighborsConservative
        : DirectedNeighbors)[index]

    // Pre-allocate result array with estimated capacity
    const validNeighbors: GraphConnection[] = []

    for (let i = 0; i < directions.length; i++) {
      const dir = directions[i]
      const neighbor = CPos.add(position, dir)
      if (!this.isValidNeighbor(neighbor)) {
        continue
      }

      const pathCost = this.getPathCostToNode(
        position,
        neighbor,
        dir,
        targetPredicate,
      )
      if (
        pathCost !== PathGraph.PathCostForInvalidPath &&
        this.getInfo(neighbor).Status !== CellStatus.Closed
      ) {
        validNeighbors.push(new GraphConnection(neighbor, pathCost))
      }
    }

    // Custom movement layer transitions
    if (layer === 0) {
      if (this.customMovementLayersEnabledForLocomotor > 0) {
        for (const cml of this.CustomMovementLayers) {
          if (cml === null || !cml.enabledForLocomotor(this.locomotor.Info)) {
            continue
          }

          const layerPosition = new CPos(position.X, position.Y, cml.Index)
          if (!this.isValidNeighbor(layerPosition)) {
            continue
          }

          const entryCost = cml.entryMovementCost(
            this.locomotor.Info,
            layerPosition,
          )
          if (
            entryCost !== PathGraph.MovementCostForUnreachableCell &&
            this.canEnterNode(position, layerPosition, targetPredicate) &&
            this.getInfo(layerPosition).Status !== CellStatus.Closed
          ) {
            validNeighbors.push(
              new GraphConnection(layerPosition, entryCost),
            )
          }
        }
      }
    } else {
      const groundPosition = new CPos(position.X, position.Y, 0)
      if (this.isValidNeighbor(groundPosition)) {
        const cml = this.CustomMovementLayers[layer]
        if (cml !== null) {
          const exitCost = cml.exitMovementCost(
            this.locomotor.Info,
            groundPosition,
          )
          if (
            exitCost !== PathGraph.MovementCostForUnreachableCell &&
            this.canEnterNode(position, groundPosition, targetPredicate) &&
            this.getInfo(groundPosition).Status !== CellStatus.Closed
          ) {
            validNeighbors.push(
              new GraphConnection(groundPosition, exitCost),
            )
          }
        }
      }
    }

    return validNeighbors
  }

  /**
   * Check if we can enter a destination node from a source node.
   *
   * OpenRA 对照: DensePathGraph.CanEnterNode(CPos, CPos, Func<CPos, bool>)
   *
   * @param srcNode — source cell
   * @param destNode — destination cell
   * @param targetPredicate — target predicate (for reverse search)
   * @returns true if the node can be entered
   */
  private canEnterNode(
    srcNode: CPos,
    destNode: CPos,
    targetPredicate: (pos: CPos) => boolean,
  ): boolean {
    const cost = this.locomotor.movementCostToEnterCell(
      this.actor,
      srcNode,
      destNode,
      this.check,
      this.ignoreActor,
    ) as number
    return (
      cost !== PathGraph.MovementCostForUnreachableCell ||
      (this.inReverse && targetPredicate(destNode))
    )
  }

  /**
   * Get the path cost to move from source to destination.
   *
   * OpenRA 对照: DensePathGraph.GetPathCostToNode(CPos, CPos, CVec, Func<CPos, bool>)
   *
   * @param srcNode — source cell
   * @param destNode — destination cell
   * @param direction — direction vector
   * @param targetPredicate — target predicate (for reverse search)
   * @returns path cost, or PathCostForInvalidPath if unreachable
   */
  private getPathCostToNode(
    srcNode: CPos,
    destNode: CPos,
    direction: CVec,
    targetPredicate: (pos: CPos) => boolean,
  ): number {
    let movementCost = this.locomotor.movementCostToEnterCell(
      this.actor,
      srcNode,
      destNode,
      this.check,
      this.ignoreActor,
    ) as number

    // When doing searches in reverse, allow movement onto an inaccessible
    // target location (because when reversed this is actually the source).
    if (
      movementCost === PathGraph.MovementCostForUnreachableCell &&
      this.inReverse &&
      targetPredicate(destNode)
    ) {
      movementCost = 0
    }

    if (movementCost !== PathGraph.MovementCostForUnreachableCell) {
      return this.calculateCellPathCost(destNode, direction, movementCost)
    }

    return PathGraph.PathCostForInvalidPath
  }

  /**
   * Calculate the final path cost for a cell, including diagonal multiplier,
   * custom cost, and lane bias.
   *
   * OpenRA 对照: DensePathGraph.CalculateCellPathCost(CPos, CVec, short)
   *
   * @param neighborCPos — the neighbor cell position
   * @param direction — direction vector from current to neighbor
   * @param movementCost — base movement cost
   * @returns final path cost
   */
  private calculateCellPathCost(
    neighborCPos: CPos,
    direction: CVec,
    movementCost: number,
  ): number {
    // Diagonal movement costs sqrt(2) times more than straight
    const cellCost =
      direction.X * direction.Y !== 0
        ? Math.round(movementCost * Math.SQRT2)
        : movementCost

    // Apply custom cost if provided
    if (this.customCost !== null) {
      const customCellCost = this.customCost(neighborCPos)
      if (customCellCost === PathGraph.PathCostForInvalidPath) {
        return PathGraph.PathCostForInvalidPath
      }
      return cellCost + customCellCost
    }

    // Apply lane bias for smoother flow
    if (this.laneBias) {
      return this.applyLaneBias(cellCost, neighborCPos, direction)
    }

    return cellCost
  }

  /**
   * Apply lane bias to the cell cost for smoother movement flow.
   *
   * OpenRA 对照: DensePathGraph.CalculateCellPathCost (lane bias section)
   *
   * Lane bias adds small directional costs to encourage units to align
   * on specific lanes, reducing congestion and creating smoother flows.
   *
   * @param cellCost — base cell cost
   * @param neighborCPos — the neighbor cell position
   * @param direction — direction vector
   * @returns cost with lane bias applied
   */
  private applyLaneBias(
    cellCost: number,
    neighborCPos: CPos,
    direction: CVec,
  ): number {
    let result = cellCost
    const ux = (neighborCPos.X + (this.inReverse ? 1 : 0)) & 1
    const uy = (neighborCPos.Y + (this.inReverse ? 1 : 0)) & 1

    if (
      (ux === 0 && direction.Y < 0) ||
      (ux === 1 && direction.Y > 0)
    ) {
      result += LANE_BIAS_COST
    }

    if (
      (uy === 0 && direction.X < 0) ||
      (uy === 1 && direction.X > 0)
    ) {
      result += LANE_BIAS_COST
    }

    return result
  }

  /**
   * Dispose of any resources held by this graph.
   *
   * OpenRA 对照: DensePathGraph.Dispose()
   *
   * Base implementation is a no-op. Derived classes may override.
   */
  dispose(): void {
    // No-op in base class
  }
}
