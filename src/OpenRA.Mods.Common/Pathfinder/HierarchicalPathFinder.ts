/**
 * HierarchicalPathFinder.ts — HPA* (Hierarchical Pathfinding A*) algorithm
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.cs
 *
 * 核心范式转换:
 * - C# sealed class → TypeScript class
 * - C# Dictionary → TypeScript Map
 * - C# HashSet → TypeScript Set
 * - C# event Action → TypeScript callback (deferred)
 * - C# GridIndex struct → inline number calculation
 * - C# readonly struct GridInfo → TypeScript class with readonly fields
 * - C# Func<CPos, CPos, int> → TypeScript function type
 * - C# ValueTuple → TypeScript array / object destructuring
 *
 * STUB: ActorMap blocking and locomotor cell cost change events
 * are simplified due to Chapter 5 dependencies.
 * TODO-5.X: Full ActorMap integration for BlockedByActor.Immovable
 * TODO-5.X: Locomotor.CellCostChanged event handling
 */

import { CPos } from '../../OpenRA.Game/CPos'
import { CVec } from '../../OpenRA.Game/CVec'
import type { IGameWorld } from '../../OpenRA.Game/World'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { BlockedByActor } from '../Traits/BlockedByActor'
import type { ILocomotor } from '../Traits/World/Locomotor'
import type { ICustomMovementLayer } from '../Traits/ICustomMovementLayer'
import { Grid } from './Grid'
import { PathSearch, NoPath } from './PathSearch'
import { GraphConnection, GraphEdge, PathGraph } from './IPathGraph'
import { CellInfo, CellStatus } from './CellInfo'
import { GridPathGraph } from './GridPathGraph'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Grid size for HPA* abstract graph — determined empirically as best trade-off. */
const GRID_SIZE = 10

/** Close grid distance threshold for local pathfinding bypass. */
const CLOSE_GRID_DISTANCE = 2

// ---------------------------------------------------------------------------
// GridInfo — maps local cells to abstract nodes within a grid
// ---------------------------------------------------------------------------

/**
 * Knows about the abstract nodes within a grid. Can map a local cell to its abstract node.
 *
 * OpenRA 对照: HierarchicalPathFinder.GridInfo (readonly struct)
 */
class GridInfo {
  /** Single abstract cell per layer (null if multiple regions exist). */
  readonly singleAbstractCellForLayer: (CPos | null)[]

  /** Map from local cell to abstract cell (only populated when multiple regions exist). */
  readonly localCellToAbstractCell: Map<number, CPos>

  /**
   * Create a new GridInfo.
   *
   * @param singleAbstractCellForLayer — single abstract cell per layer, or null
   * @param localCellToAbstractCell — map from local cells to abstract cells
   */
  constructor(
    singleAbstractCellForLayer: (CPos | null)[],
    localCellToAbstractCell: Map<number, CPos>,
  ) {
    this.singleAbstractCellForLayer = singleAbstractCellForLayer
    this.localCellToAbstractCell = localCellToAbstractCell
  }

  /**
   * Maps a local cell to an abstract node in the graph.
   * Returns null when the local cell is unreachable.
   *
   * OpenRA 对照: GridInfo.AbstractCellForLocalCell(CPos, HierarchicalPathFinder)
   *
   * @param localCell — the local cell position
   * @param hpf — the HierarchicalPathFinder (for accessibility check), or null to skip
   * @returns the abstract cell, or null if unreachable
   */
  abstractCellForLocalCell(
    localCell: CPos,
    hpf: HierarchicalPathFinder | null,
  ): CPos | null {
    const abstractCell = this.singleAbstractCellForLayer[localCell.Layer]
    if (abstractCell !== null) {
      // All reachable cells in the grid are joined together so only a single abstract cell was needed,
      // but there may be unreachable cells in the grid which we must exclude.
      if (hpf !== null && !hpf.cellIsAccessible(localCell)) {
        return null
      }
      return abstractCell
    }

    // Only reachable cells would be populated in the lookup, so no need to check their cost.
    const fromMap = this.localCellToAbstractCell.get(localCell.Bits)
    if (fromMap !== undefined) {
      return fromMap
    }
    return null
  }

  /**
   * Copy all abstract cells into a set.
   *
   * OpenRA 对照: GridInfo.CopyAbstractCellsInto(HashSet<CPos>)
   *
   * NOTE: Uses Set<number> (CPos.Bits) because TypeScript Set uses reference
   * equality, not value equality like C# HashSet<CPos>.
   *
   * @param set — the set to add abstract cell bits to
   */
  copyAbstractCellsInto(set: Set<number>): void {
    for (const single of this.singleAbstractCellForLayer) {
      if (single !== null) {
        set.add(single.Bits)
      }
    }
    for (const cell of this.localCellToAbstractCell.values()) {
      set.add(cell.Bits)
    }
  }
}

// ---------------------------------------------------------------------------
// AbstractGraphWithInsertedEdges
// ---------------------------------------------------------------------------

/**
 * Represents an abstract graph with some extra edges inserted.
 * Instead of building a new dictionary with the edges added, we build a supplemental dictionary of changes.
 * This is to avoid copying the entire abstract graph.
 *
 * OpenRA 对照: HierarchicalPathFinder.AbstractGraphWithInsertedEdges (sealed class)
 */
class AbstractGraphWithInsertedEdges {
  private readonly abstractEdges: Map<number, GraphConnection[]>
  private readonly changedEdges: Map<number, GraphConnection[]>

  /**
   * Create an abstract graph with inserted edges.
   *
   * @param abstractEdges — the base abstract graph
   * @param sourceEdges — edges to insert from source cells
   * @param targetEdge — edge to insert from target cell (optional)
   * @param costEstimator — function to estimate costs
   */
  constructor(
    abstractEdges: Map<number, GraphConnection[]>,
    sourceEdges: GraphEdge[],
    targetEdge: GraphEdge | null,
    costEstimator: (a: CPos, b: CPos) => number,
  ) {
    this.abstractEdges = abstractEdges
    this.changedEdges = new Map<number, GraphConnection[]>()

    for (const sourceEdge of sourceEdges) {
      this.insertEdgeAsBidirectional(sourceEdge, costEstimator)
    }
    if (targetEdge !== null) {
      this.insertEdgeAsBidirectional(targetEdge, costEstimator)
    }
  }

  private insertEdgeAsBidirectional(
    edge: GraphEdge,
    costEstimator: (a: CPos, b: CPos) => number,
  ): void {
    this.insertConnections(edge.Source, edge.Destination, costEstimator)
  }

  private insertConnections(
    localCell: CPos,
    abstractCell: CPos,
    costEstimator: (a: CPos, b: CPos) => number,
  ): void {
    const edges = this.abstractEdges.get(abstractCell.Bits) ?? []

    // changedEdges[localCell] = edges.Select(e => new GraphConnection(e.Destination, costEstimator(localCell, e.Destination)))
    //   .Append(new GraphConnection(abstractCell, costEstimator(localCell, abstractCell)))
    const localConnections: GraphConnection[] = []
    for (const e of edges) {
      localConnections.push(
        new GraphConnection(e.Destination, costEstimator(localCell, e.Destination)),
      )
    }
    localConnections.push(
      new GraphConnection(abstractCell, costEstimator(localCell, abstractCell)),
    )
    this.changedEdges.set(localCell.Bits, localConnections)

    // changedEdges[abstractCell] = abstractChangedEdges.Append(new GraphConnection(localCell, costEstimator(abstractCell, localCell)))
    let abstractChangedEdges = this.changedEdges.get(abstractCell.Bits)
    if (abstractChangedEdges === undefined) {
      abstractChangedEdges = edges.slice()
    }
    abstractChangedEdges.push(
      new GraphConnection(localCell, costEstimator(abstractCell, localCell)),
    )
    this.changedEdges.set(abstractCell.Bits, abstractChangedEdges)

    // For each connection from abstractCell, add edge to localCell
    for (const conn of edges) {
      let connChangedEdges = this.changedEdges.get(conn.Destination.Bits)
      if (connChangedEdges === undefined) {
        const baseEdges = this.abstractEdges.get(conn.Destination.Bits)
        connChangedEdges = baseEdges ? baseEdges.slice() : []
      }
      connChangedEdges.push(
        new GraphConnection(localCell, costEstimator(conn.Destination, localCell)),
      )
      this.changedEdges.set(conn.Destination.Bits, connChangedEdges)
    }
  }

  /**
   * Get connections from a position in the graph (with inserted edges).
   *
   * @param position — the cell position
   * @returns array of GraphConnection
   */
  getConnections(position: CPos): GraphConnection[] {
    const changed = this.changedEdges.get(position.Bits)
    if (changed !== undefined) {
      return changed
    }
    const base = this.abstractEdges.get(position.Bits)
    if (base !== undefined) {
      return base
    }
    return []
  }
}

// ---------------------------------------------------------------------------
// HierarchicalPathFinder
// ---------------------------------------------------------------------------

/**
 * Provides pathfinding abilities for actors that use a specific Locomotor.
 * Maintains a hierarchy of abstract graphs that provide a more accurate heuristic function during
 * A* pathfinding than the one available from PathSearch.DefaultCostEstimator.
 * This allows for faster pathfinding.
 *
 * OpenRA 对照: HierarchicalPathFinder (sealed class)
 *
 * The HPA* algorithm:
 * 1. Divides the map into 10x10 grids
 * 2. Within each grid, flood fill finds connected regions
 * 3. Each region becomes an abstract node
 * 4. Edges between abstract nodes represent traversable boundaries
 * 5. Pathfinding uses the abstract graph for improved heuristics
 *
 * STUB: ActorMap blocking (BlockedByActor.Immovable) is simplified.
 * Full actor blocking will be implemented when ActorMap is migrated.
 */
export class HierarchicalPathFinder {
  // -------------------------------------------------------------------------
  // Instance fields
  // -------------------------------------------------------------------------

  /** The game world. */
  private readonly world: IGameWorld

  /** The locomotor defining movement rules. */
  private readonly locomotor: ILocomotor

  /** Blocking check level. */
  private readonly check: BlockedByActor

  /** Cost estimator function. */
  private readonly costEstimator: ((a: CPos, b: CPos) => number) | null

  /** Set of grid indexes that need rebuilding. */
  private readonly dirtyGridIndexes: Set<number>

  /** Map bounds in cell coordinates. */
  private mapBounds: Grid

  /** Number of grids in X direction. */
  private gridXs: number

  /** Number of grids in Y direction. */
  private gridYs: number

  /** Grid info for each grid index. */
  private gridInfos: GridInfo[]

  /** Abstract graph: abstract node -> connections to other abstract nodes. */
  private abstractGraph: Map<number, GraphConnection[]> | null

  /** Abstract domains: abstract node -> domain index. Same domain = reachable. */
  private readonly abstractDomains: Map<number, number>

  /** Cells with blocking actors (null if not tracking). */
  private cellsWithBlockingActor: Set<number> | null

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a HierarchicalPathFinder.
   *
   * OpenRA 对照: HierarchicalPathFinder(World, Locomotor, IActorMap, BlockedByActor)
   *
   * @param world — the game world
   * @param locomotor — the locomotor defining movement rules
   * @param actorMap — the actor map (null if not tracking actors)
   * @param check — blocking check level
   */
  constructor(
    world: IGameWorld,
    locomotor: ILocomotor,
    actorMap: unknown | null,
    check: BlockedByActor,
  ) {
    this.world = world
    this.locomotor = locomotor
    this.check = check
    this.dirtyGridIndexes = new Set<number>()
    this.abstractDomains = new Map<number, number>()
    this.cellsWithBlockingActor = null
    this.abstractGraph = null
    this.gridXs = 0
    this.gridYs = 0
    this.mapBounds = new Grid(CPos.Zero, CPos.Zero, false)
    this.gridInfos = []

    // If no terrain speeds defined, pathfinding is disabled
    if (locomotor.Info.TerrainSpeeds.size === 0) {
      this.costEstimator = null
      return
    }

    // STUB: BlockedByActor.Immovable handling simplified
    // TODO-5.X: Full ActorMap integration for immovable actor blocking
    // NOTE: actorMap parameter is intentionally unused in stub — see constructor JSDoc
    void actorMap
    if (check === 1 /* BlockedByActor.Immovable */) {
      // ActorMap blocking would be set up here
      // For now, we treat it as None since ActorMap is not fully migrated
      this.cellsWithBlockingActor = null
    } else if (check !== 0 /* BlockedByActor.None */) {
      throw new Error(
        `HierarchicalPathFinder supports BlockedByActor.None and BlockedByActor.Immovable only for check`,
      )
    }

    this.costEstimator = PathSearch.defaultCostEstimator(locomotor)

    this.buildGrids()
    this.buildCostTable()
    this.rebuildDomains()

    // STUB: Locomotor.CellCostChanged event not available in stub
    // TODO-5.X: Subscribe to locomotor.CellCostChanged

    // STUB: Map.CellProjectionChanged event not available in stub
    // TODO-5.X: Subscribe to world.Map.CellProjectionChanged
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Calculates a path from source to target.
   * Returned path is from source to target (NOT reversed).
   *
   * OpenRA 对照: HierarchicalPathFinder.FindPath(Actor, CPos, CPos, ...)
   *
   * @param source — starting cell position
   * @param target — target cell position
   * @param maxCost — maximum path cost (not used in simplified version)
   * @returns array of CPos from source to target, or NoPath if no path exists
   */
  findPath(source: CPos, target: CPos, maxCost: number = Number.MAX_SAFE_INTEGER): CPos[] {
    if (this.costEstimator === null) {
      return NoPath
    }

    // STUB: maxCost is not used in simplified version
    // TODO-5.X: Use maxCost for early termination
    void maxCost

    // Check if target is in the world
    // STUB: world.Map.Contains check — using bounds check
    if (!this.cellInWorld(target)) {
      return NoPath
    }

    // If source and target are close, try local pathfinding first
    const dx = target.X - source.X
    const dy = target.Y - source.Y
    const distSq = dx * dx + dy * dy
    if (distSq < GRID_SIZE * GRID_SIZE * CLOSE_GRID_DISTANCE * CLOSE_GRID_DISTANCE &&
        source.Layer === target.Layer) {
      const localPath = this.tryLocalPath(source, target)
      if (localPath.length > 0) {
        return localPath
      }
    }

    this.rebuildDirtyGrids()

    // If the target cell is unreachable, there is no path.
    const targetAbstractCell = this.abstractCellForLocalCell(target)
    if (targetAbstractCell === null) {
      return NoPath
    }

    // If the source cell is unreachable, there may still be a path.
    const sourceAbstractCell = this.abstractCellForLocalCell(source)
    if (sourceAbstractCell === null) {
      return this.findPathFromUnreachableSource(source, target)
    }

    // If the source and target belong to different domains, there is no path.
    this.rebuildDomains()
    const targetDomain = this.abstractDomains.get(targetAbstractCell.Bits)
    const sourceDomain = this.abstractDomains.get(sourceAbstractCell.Bits)
    if (targetDomain !== sourceDomain || targetDomain === undefined) {
      return NoPath
    }

    const targetEdge = this.edgeFromLocalToAbstract(target, targetAbstractCell)
    const sourceEdge = this.edgeFromLocalToAbstract(source, sourceAbstractCell)

    // The new edges will be treated as bi-directional.
    const fullGraph = new AbstractGraphWithInsertedEdges(
      this.abstractGraph!,
      sourceEdge !== null ? [sourceEdge] : [],
      targetEdge,
      this.costEstimator,
    )

    // Determine an abstract path in both directions, for use in a bidirectional search.
    const estimatedSearchSize = Math.max(1, (this.abstractGraph!.size + 2) / 8 | 0)

    const forwardAbstractSearch = PathSearch.toTargetCellOverGraph(
      (pos) => fullGraph.getConnections(pos),
      this.locomotor,
      source,
      target,
      estimatedSearchSize,
    )

    if (!forwardAbstractSearch.expandToTarget()) {
      forwardAbstractSearch.dispose()
      return NoPath
    }

    const reverseAbstractSearch = PathSearch.toTargetCellOverGraph(
      (pos) => fullGraph.getConnections(pos),
      this.locomotor,
      target,
      source,
      estimatedSearchSize,
    )
    reverseAbstractSearch.expandToTarget()

    // Build heuristic from reverse abstract search
    const heuristic = this.buildHeuristic(reverseAbstractSearch, estimatedSearchSize)
    const forwardHeuristic = this.buildHeuristic(forwardAbstractSearch, estimatedSearchSize)

    // Perform bidirectional local search with improved heuristic
    const fromSrc = this.getLocalPathSearch(
      [source],
      target,
      null, // customCost
      null, // ignoreActor
      this.check,
      true, // laneBias
      null, // grid
      100, // heuristicWeightPercentage
      heuristic,
      false, // inReverse
    )

    const fromDest = this.getLocalPathSearch(
      [target],
      source,
      null, // customCost
      null, // ignoreActor
      this.check,
      true, // laneBias
      null, // grid
      100, // heuristicWeightPercentage
      forwardHeuristic,
      true, // inReverse
    )

    const path = PathSearch.findBidiPath(fromDest, fromSrc)

    fromSrc.dispose()
    fromDest.dispose()
    forwardAbstractSearch.dispose()
    reverseAbstractSearch.dispose()

    if (path === NoPath || path.length === 0) {
      return NoPath
    }

    // Path is returned target-to-source by findBidiPath, reverse it
    return path.reverse()
  }

  /**
   * Check if a path exists between source and target.
   *
   * OpenRA 对照: HierarchicalPathFinder.PathExists(CPos, CPos)
   *
   * @param source — starting cell position
   * @param target — target cell position
   * @returns true if a path exists
   */
  pathExists(source: CPos, target: CPos): boolean {
    if (this.costEstimator === null) {
      return false
    }

    if (!this.cellInWorld(source) || !this.cellInWorld(target)) {
      return false
    }

    this.rebuildDomains()

    const abstractTarget = this.abstractCellForLocalCell(target)
    if (abstractTarget === null) {
      return false
    }
    const targetDomain = this.abstractDomains.get(abstractTarget.Bits)
    if (targetDomain === undefined) {
      return false
    }

    // The source cell is reachable, we can compare the domains directly.
    const abstractSource = this.abstractCellForLocalCell(source)
    if (abstractSource !== null) {
      const sourceDomain = this.abstractDomains.get(abstractSource.Bits)
      return sourceDomain === targetDomain
    }

    // Unlike the target cell, the source cell is allowed to be an unreachable location.
    // Instead, what matters is whether any cell adjacent to the source cell can be reached.
    for (const dir of CVec.Directions) {
      const adjacentSource = CPos.add(source, dir)
      if (!this.movementAllowedBetweenCells(source, adjacentSource)) {
        continue
      }

      const abstractAdjacentSource = this.abstractCellForLocalCell(adjacentSource)
      if (abstractAdjacentSource === null) {
        continue
      }

      const adjacentSourceDomain = this.abstractDomains.get(abstractAdjacentSource.Bits)
      if (adjacentSourceDomain === targetDomain) {
        return true
      }
    }

    return false
  }

  /**
   * Get overlay data for debugging/visualization.
   *
   * OpenRA 对照: HierarchicalPathFinder.GetOverlayData()
   *
   * @returns the abstract graph and domains
   */
  getOverlayData(): {
    abstractGraph: ReadonlyMap<number, GraphConnection[]>
    abstractDomains: ReadonlyMap<number, number>
  } | null {
    if (this.costEstimator === null) {
      return null
    }

    this.rebuildDirtyGrids()
    this.rebuildDomains()

    return {
      abstractGraph: this.abstractGraph!,
      abstractDomains: this.abstractDomains,
    }
  }

  // -------------------------------------------------------------------------
  // Grid building (BuildGrids)
  // -------------------------------------------------------------------------

  /**
   * Divides the map area up into a series of grids.
   *
   * OpenRA 对照: HierarchicalPathFinder.BuildGrids()
   */
  private buildGrids(): void {
    // STUB: Map bounds calculation simplified
    // For rectangular grids, bounds are (0,0) to (mapSize)
    // TODO-5.X: Support RectangularIsometric maps
    const mapSize = this.getMapSize()
    this.mapBounds = new Grid(
      new CPos(0, 0),
      new CPos(mapSize.width, mapSize.height),
      false,
    )

    this.gridXs = Math.ceil(this.mapBounds.Width / GRID_SIZE)
    this.gridYs = Math.ceil(this.mapBounds.Height / GRID_SIZE)

    const customMovementLayers = this.getCustomMovementLayers()
    this.gridInfos = new Array(this.gridXs * this.gridYs)

    for (let gridX = this.mapBounds.TopLeft.X; gridX < this.mapBounds.BottomRight.X; gridX += GRID_SIZE) {
      for (let gridY = this.mapBounds.TopLeft.Y; gridY < this.mapBounds.BottomRight.Y; gridY += GRID_SIZE) {
        const index = this.gridIndex(new CPos(gridX, gridY))
        this.gridInfos[index] = this.buildGrid(gridX, gridY, customMovementLayers)
      }
    }
  }

  /**
   * Determines the abstract nodes within a single grid.
   *
   * OpenRA 对照: HierarchicalPathFinder.BuildGrid(int, int, ICustomMovementLayer[])
   *
   * @param gridX — top-left X of the grid
   * @param gridY — top-left Y of the grid
   * @param customMovementLayers — custom movement layers
   * @returns GridInfo for this grid
   */
  private buildGrid(
    gridX: number,
    gridY: number,
    customMovementLayers: readonly (ICustomMovementLayer | null)[],
  ): GridInfo {
    // Always allocate at least 1 layer for ground (layer 0)
    const singleAbstractCellForLayer: (CPos | null)[] = new Array(Math.max(1, customMovementLayers.length)).fill(null)
    const localCellToAbstractCell = new Map<number, CPos>()

    // STUB: Custom cost for blocking actors not implemented
    const customCost = this.cellsWithBlockingActor !== null
      ? (c: CPos) => this.cellsWithBlockingActor!.has(c.Bits)
        ? PathGraph.PathCostForInvalidPath
        : 0
      : null

    const accessibleCells = new Set<number>()

    // Always process at least layer 0 (ground)
    const layerCount = Math.max(1, customMovementLayers.length)
    for (let gridLayer = 0; gridLayer < layerCount; gridLayer++) {
      if (gridLayer !== 0 &&
        (customMovementLayers[gridLayer] === null ||
          !customMovementLayers[gridLayer]!.enabledForLocomotor(this.locomotor.Info))) {
        continue
      }

      const grid = this.getGrid(new CPos(gridX, gridY, gridLayer))

      for (let y = gridY; y < grid.BottomRight.Y; y++) {
        for (let x = gridX; x < grid.BottomRight.X; x++) {
          const cell = new CPos(x, y, gridLayer)
          if (this.cellIsAccessible(cell)) {
            accessibleCells.add(cell.Bits)
          }
        }
      }

      // Flood fill the search area from one of the accessible cells.
      // Each region we discover will be represented by an abstract node.
      let hasPopulatedAbstractCellForLayer = false

      while (accessibleCells.size > 0) {
        // Get first accessible cell
        const srcBits = accessibleCells.values().next().value as number
        const src = CPos.fromBits(srcBits)

        // Use GridPathGraph + PathSearch.ExpandAll to find connected region
        const gridPathGraph = this.createGridPathGraph(src, customCost, grid)
        const search = new PathSearch(
          gridPathGraph,
          () => 0,
          0,
          () => false,
        )
        search.addInitialCell(src)
        const localCellsInRegion = search.expandAll()
        search.dispose()

        const abstractCell = this.abstractCellForLocalCells(localCellsInRegion, gridLayer as unknown as number)

        // Remove visited cells from accessible set
        for (const cell of localCellsInRegion) {
          accessibleCells.delete(cell.Bits)
        }

        // PERF: If there is only one distinct region of cells,
        // we can represent this grid with one abstract cell.
        if (!hasPopulatedAbstractCellForLayer && accessibleCells.size === 0) {
          singleAbstractCellForLayer[gridLayer] = abstractCell
        } else {
          // When there is more than one region within the grid
          hasPopulatedAbstractCellForLayer = true
          for (const localCell of localCellsInRegion) {
            localCellToAbstractCell.set(localCell.Bits, abstractCell)
          }
        }
      }
    }

    return new GridInfo(singleAbstractCellForLayer, localCellToAbstractCell)
  }

  /**
   * Compute the abstract cell for a set of local cells.
   * Chooses a cell closest to the center of the bounding box.
   *
   * OpenRA 对照: HierarchicalPathFinder.AbstractCellForLocalCells(List<CPos>, byte)
   *
   * @param cells — the cells in the region
   * @param layer — the layer index
   * @returns the chosen abstract cell
   */
  private abstractCellForLocalCells(cells: CPos[], layer: number): CPos {
    let minX = Number.MAX_SAFE_INTEGER
    let minY = Number.MAX_SAFE_INTEGER
    let maxX = Number.MIN_SAFE_INTEGER
    let maxY = Number.MIN_SAFE_INTEGER

    for (const cell of cells) {
      minX = Math.min(cell.X, minX)
      minY = Math.min(cell.Y, minY)
      maxX = Math.max(cell.X, maxX)
      maxY = Math.max(cell.Y, maxY)
    }

    const regionWidth = maxX - minX
    const regionHeight = maxY - minY
    const desired = new CPos(minX + Math.floor(regionWidth / 2), minY + Math.floor(regionHeight / 2), layer)

    // Make sure the abstract cell is one of the available local cells.
    // We'll choose an abstract node as close to the middle of the region as possible.
    // If there are multiple equally close cells, choose the leftmost/topmost.
    let abstractCell = cells[0]!
    let distance = Number.MAX_SAFE_INTEGER

    for (const cell of cells) {
      const dx = cell.X - desired.X
      const dy = cell.Y - desired.Y
      const newDistance = dx * dx + dy * dy
      if (newDistance < distance ||
        (newDistance === distance && (cell.X < abstractCell.X ||
          (cell.X === abstractCell.X && cell.Y < abstractCell.Y)))) {
        distance = newDistance
        abstractCell = cell
      }
    }

    return abstractCell
  }

  // -------------------------------------------------------------------------
  // Cost table building (BuildCostTable)
  // -------------------------------------------------------------------------

  /**
   * Builds the abstract graph in entirety.
   *
   * OpenRA 对照: HierarchicalPathFinder.BuildCostTable()
   */
  private buildCostTable(): void {
    this.abstractGraph = new Map<number, GraphConnection[]>()
    const customMovementLayers = this.getCustomMovementLayers()

    for (let gridX = this.mapBounds.TopLeft.X; gridX < this.mapBounds.BottomRight.X; gridX += GRID_SIZE) {
      for (let gridY = this.mapBounds.TopLeft.Y; gridY < this.mapBounds.BottomRight.Y; gridY += GRID_SIZE) {
        for (const [key, edges] of this.getAbstractEdgesForGrid(gridX, gridY, customMovementLayers)) {
          this.abstractGraph.set(key, edges)
        }
      }
    }
  }

  /**
   * For a given grid, determines the edges between abstract nodes.
   *
   * OpenRA 对照: HierarchicalPathFinder.GetAbstractEdgesForGrid(int, int, ICustomMovementLayer[])
   *
   * @param gridX — top-left X of the grid
   * @param gridY — top-left Y of the grid
   * @param customMovementLayers — custom movement layers
   * @returns iterable of [abstractCellBits, connections] pairs
   */
  private getAbstractEdgesForGrid(
    gridX: number,
    gridY: number,
    customMovementLayers: readonly (ICustomMovementLayer | null)[],
  ): Iterable<[number, GraphConnection[]]> {
    const abstractEdges = new Map<number, Set<number>>()

    for (let gridLayer = 0; gridLayer < customMovementLayers.length; gridLayer++) {
      if (gridLayer !== 0 &&
        (customMovementLayers[gridLayer] === null ||
          !customMovementLayers[gridLayer]!.enabledForLocomotor(this.locomotor.Info))) {
        continue
      }

      // Check adjacent cells across grid boundaries
      const addEdgesIfMovementAllowed = (cell: CPos, candidateCell: CPos): void => {
        if (!this.movementAllowedBetweenCells(cell, candidateCell)) {
          return
        }

        const abstractCell = this.abstractCellForLocalCellNoAccessibleCheck(cell)
        if (abstractCell === null) {
          return
        }

        const abstractCellAdjacent = this.abstractCellForLocalCellNoAccessibleCheck(candidateCell)
        if (abstractCellAdjacent === null) {
          return
        }

        if (!abstractEdges.has(abstractCell.Bits)) {
          abstractEdges.set(abstractCell.Bits, new Set<number>())
        }
        abstractEdges.get(abstractCell.Bits)!.add(abstractCellAdjacent.Bits)
      }

      // Check edges between this grid and adjacent grids
      // Top edge
      for (let x = gridX; x < gridX + GRID_SIZE; x++) {
        const cell = new CPos(x, gridY, gridLayer)
        if (!this.cellIsAccessible(cell)) {
          continue
        }
        const adjacentCell = new CPos(x, gridY - 1, gridLayer)
        for (let i = -1; i <= 1; i++) {
          const candidateCell = new CPos(adjacentCell.X + i, adjacentCell.Y, gridLayer)
          addEdgesIfMovementAllowed(cell, candidateCell)
        }
      }

      // Left edge
      for (let y = gridY; y < gridY + GRID_SIZE; y++) {
        const cell = new CPos(gridX, y, gridLayer)
        if (!this.cellIsAccessible(cell)) {
          continue
        }
        const adjacentCell = new CPos(gridX - 1, y, gridLayer)
        for (let i = -1; i <= 1; i++) {
          const candidateCell = new CPos(adjacentCell.X, adjacentCell.Y + i, gridLayer)
          addEdgesIfMovementAllowed(cell, candidateCell)
        }
      }

      // Bottom edge
      for (let x = gridX; x < gridX + GRID_SIZE; x++) {
        const cell = new CPos(x, gridY + GRID_SIZE - 1, gridLayer)
        if (!this.cellIsAccessible(cell)) {
          continue
        }
        const adjacentCell = new CPos(x, gridY + GRID_SIZE, gridLayer)
        for (let i = -1; i <= 1; i++) {
          const candidateCell = new CPos(adjacentCell.X + i, adjacentCell.Y, gridLayer)
          addEdgesIfMovementAllowed(cell, candidateCell)
        }
      }

      // Right edge
      for (let y = gridY; y < gridY + GRID_SIZE; y++) {
        const cell = new CPos(gridX + GRID_SIZE - 1, y, gridLayer)
        if (!this.cellIsAccessible(cell)) {
          continue
        }
        const adjacentCell = new CPos(gridX + GRID_SIZE, y, gridLayer)
        for (let i = -1; i <= 1; i++) {
          const candidateCell = new CPos(adjacentCell.X, adjacentCell.Y + i, gridLayer)
          addEdgesIfMovementAllowed(cell, candidateCell)
        }
      }
    }

    // Convert to GraphConnection arrays with costs
    const result = new Map<number, GraphConnection[]>()
    for (const [srcBits, dstSet] of abstractEdges) {
      const src = CPos.fromBits(srcBits)
      const connections: GraphConnection[] = []
      for (const dstBits of dstSet) {
        const dst = CPos.fromBits(dstBits)
        connections.push(new GraphConnection(dst, this.costEstimator!(src, dst)))
      }
      result.set(srcBits, connections)
    }

    return result
  }

  // -------------------------------------------------------------------------
  // Domain computation (RebuildDomains)
  // -------------------------------------------------------------------------

  /**
   * Rebuild the abstract domains when the abstract graph changes.
   *
   * OpenRA 对照: HierarchicalPathFinder.RebuildDomains()
   */
  private rebuildDomains(): void {
    this.rebuildDirtyGrids()

    // Check if our domain cache is empty, if so this indicates it is out-of-date and needs rebuilding.
    if (this.abstractDomains.size !== 0) {
      return
    }

    // As in BuildGrid, flood fill the search graph until all disjoint domains are discovered.
    let domain = 0
    const abstractCells = new Set<number>()
    for (const grid of this.gridInfos) {
      grid.copyAbstractCellsInto(abstractCells)
    }

    while (abstractCells.size > 0) {
      const searchCellBits = abstractCells.values().next().value as number
      const searchCell = CPos.fromBits(searchCellBits)

      const abstractEdge = (abstractCell: CPos): GraphConnection[] | null => {
        return this.abstractGraph!.get(abstractCell.Bits) ?? null
      }

      const search = PathSearch.toTargetCellOverGraph(
        abstractEdge,
        this.locomotor,
        searchCell,
        searchCell,
        Math.max(1, this.abstractGraph!.size / 8 | 0),
      )
      const searched = search.expandAll()
      search.dispose()

      for (const abstractCell of searched) {
        this.abstractDomains.set(abstractCell.Bits, domain)
        abstractCells.delete(abstractCell.Bits)
      }
      domain++
    }
  }

  // -------------------------------------------------------------------------
  // Dirty grid rebuilding
  // -------------------------------------------------------------------------

  /**
   * Rebuild any grids that have become dirty.
   *
   * OpenRA 对照: HierarchicalPathFinder.RebuildDirtyGrids()
   */
  private rebuildDirtyGrids(): void {
    if (this.dirtyGridIndexes.size === 0) {
      return
    }

    // An empty domain indicates it is out of date and will require rebuilding when next accessed.
    this.abstractDomains.clear()

    const customMovementLayers = this.getCustomMovementLayers()
    for (const gridIndex of this.dirtyGridIndexes) {
      const oldGrid = this.gridInfos[gridIndex]
      const gridTopLeft = this.getGridTopLeftByIndex(gridIndex, 0)
      this.gridInfos[gridIndex] = this.buildGrid(gridTopLeft.X, gridTopLeft.Y, customMovementLayers)
      this.rebuildCostTable(gridTopLeft.X, gridTopLeft.Y, oldGrid, customMovementLayers)
    }

    this.dirtyGridIndexes.clear()
  }

  /**
   * Update the abstract graph for a specific grid.
   *
   * OpenRA 对照: HierarchicalPathFinder.RebuildCostTable(int, int, GridInfo, ICustomMovementLayer[])
   */
  private rebuildCostTable(
    gridX: number,
    gridY: number,
    oldGrid: GridInfo,
    customMovementLayers: readonly (ICustomMovementLayer | null)[],
  ): void {
    // Remove old abstract nodes for this grid
    const abstractNodes = new Set<number>()
    oldGrid.copyAbstractCellsInto(abstractNodes)
    for (const oldAbstractNode of abstractNodes) {
      this.abstractGraph!.delete(oldAbstractNode)
    }
    abstractNodes.clear()

    // Add new abstract edges for this grid
    for (const [key, edges] of this.getAbstractEdgesForGrid(gridX, gridY, customMovementLayers)) {
      this.abstractGraph!.set(key, edges)
    }

    // Update adjacent grids
    for (const dir of CVec.Directions) {
      const adjacentGrid = CPos.add(new CPos(gridX, gridY), CVec.multiplyScalar(GRID_SIZE, dir))
      if (!this.mapBounds.contains(adjacentGrid)) {
        continue
      }

      const adjacentGridIndex = this.gridIndex(adjacentGrid)
      this.gridInfos[adjacentGridIndex].copyAbstractCellsInto(abstractNodes)
      for (const [key, edges] of this.getAbstractEdgesForGrid(adjacentGrid.X, adjacentGrid.Y, customMovementLayers)) {
        this.abstractGraph!.set(key, edges)
        abstractNodes.delete(key)
      }

      // Remove unconnected nodes
      for (const unconnectedNode of abstractNodes) {
        this.abstractGraph!.delete(unconnectedNode)
      }
      abstractNodes.clear()
    }
  }

  // -------------------------------------------------------------------------
  // Accessibility checks
  // -------------------------------------------------------------------------

  /**
   * Check if a cell is accessible (not blocked by terrain or actors).
   *
   * OpenRA 对照: HierarchicalPathFinder.CellIsAccessible(CPos)
   *
   * @param cell — the cell to check
   * @returns true if the cell is accessible
   */
  cellIsAccessible(cell: CPos): boolean {
    const cost = this.locomotor.movementCostForCell(cell)
    if (cost === PathGraph.MovementCostForUnreachableCell) {
      return false
    }
    if (this.cellsWithBlockingActor !== null && this.cellsWithBlockingActor.has(cell.Bits)) {
      return false
    }
    return true
  }

  /**
   * Check if movement is allowed between two cells.
   *
   * OpenRA 对照: HierarchicalPathFinder.MovementAllowedBetweenCells(CPos, CPos)
   *
   * @param accessibleSrcCell — the source cell (known accessible)
   * @param destCell — the destination cell
   * @returns true if movement is allowed
   */
  movementAllowedBetweenCells(accessibleSrcCell: CPos, destCell: CPos): boolean {
    // STUB: Using simplified overload without actor
    const cost = this.locomotor.movementCostToEnterCell(
      null,
      accessibleSrcCell,
      destCell,
      0, /* BlockedByActor.None */
      null,
    ) as number
    if (cost === PathGraph.MovementCostForUnreachableCell) {
      return false
    }
    if (this.cellsWithBlockingActor !== null && this.cellsWithBlockingActor.has(destCell.Bits)) {
      return false
    }
    return true
  }

  // -------------------------------------------------------------------------
  // Abstract cell mapping
  // -------------------------------------------------------------------------

  /**
   * Maps a local cell to an abstract node in the graph.
   *
   * OpenRA 对照: HierarchicalPathFinder.AbstractCellForLocalCell(CPos)
   *
   * @param localCell — the local cell position
   * @returns the abstract cell, or null if unreachable
   */
  abstractCellForLocalCell(localCell: CPos): CPos | null {
    if (!this.cellInWorld(localCell)) {
      return null
    }
    const gridIndex = this.gridIndex(localCell)
    if (gridIndex < 0 || gridIndex >= this.gridInfos.length) {
      return null
    }
    return this.gridInfos[gridIndex].abstractCellForLocalCell(localCell, this)
  }

  /**
   * Maps a local cell to an abstract node, skipping the accessibility check.
   *
   * OpenRA 对照: HierarchicalPathFinder.AbstractCellForLocalCellNoAccessibleCheck(CPos)
   *
   * @param localCell — the local cell position
   * @returns the abstract cell, or null if not found
   */
  abstractCellForLocalCellNoAccessibleCheck(localCell: CPos): CPos | null {
    const gridIndex = this.gridIndex(localCell)
    if (gridIndex < 0 || gridIndex >= this.gridInfos.length) {
      return null
    }
    return this.gridInfos[gridIndex].abstractCellForLocalCell(localCell, null)
  }

  // -------------------------------------------------------------------------
  // Edge creation
  // -------------------------------------------------------------------------

  /**
   * Creates a GraphEdge from a local cell to an abstract cell.
   * Returns null when no edge is required (cells match).
   *
   * OpenRA 对照: HierarchicalPathFinder.EdgeFromLocalToAbstract(CPos, CPos)
   *
   * @param localCell — the local cell
   * @param abstractCell — the abstract cell
   * @returns a GraphEdge, or null if cells match
   */
  private edgeFromLocalToAbstract(localCell: CPos, abstractCell: CPos): GraphEdge | null {
    if (CPos.equals(localCell, abstractCell)) {
      return null
    }
    return new GraphEdge(localCell, abstractCell, this.costEstimator!(localCell, abstractCell))
  }

  // -------------------------------------------------------------------------
  // Heuristic building
  // -------------------------------------------------------------------------

  /**
   * Build a heuristic function from an abstract search.
   *
   * OpenRA 对照: HierarchicalPathFinder.Heuristic(PathSearch, int, HashSet, List)
   *
   * @param abstractSearch — the abstract path search
   * @param estimatedSearchSize — estimated number of nodes
   * @returns heuristic function
   */
  private buildHeuristic(
    abstractSearch: PathSearch,
    _estimatedSearchSize: number,
  ): (pos: CPos, isAccessible: boolean) => number {
    // NOTE: _estimatedSearchSize is kept for API parity with OpenRA
    // The Map preallocation optimization is less critical in JS
    const nodeForCostLookup = new Map<number, CPos>()
    const graph = abstractSearch.Graph as unknown as { getInfo: (pos: CPos) => CellInfo }

    return (cell: CPos, _knownAccessible: boolean): number => {
      const maybeAbstractCell = this.abstractCellForLocalCellNoAccessibleCheck(cell)
      if (maybeAbstractCell === null) {
        // Fallback: use cost estimator directly
        return this.costEstimator!(cell, CPos.Zero)
      }

      const abstractCell = maybeAbstractCell
      const info = graph.getInfo(abstractCell)

      // Expand the abstract search if needed
      if (info.Status !== CellStatus.Closed) {
        abstractSearch.TargetPredicate = (c: CPos) => CPos.equals(c, abstractCell)
        abstractSearch.expandToTarget()
      }

      const infoAfter = graph.getInfo(abstractCell)
      if (infoAfter.Status !== CellStatus.Closed) {
        // Abstract cell not reachable
        return PathGraph.PathCostForInvalidPath
      }

      let abstractNode = infoAfter.PreviousNode

      // When transitioning between layers, need the next node along
      if (abstractCell.Layer !== abstractNode.Layer) {
        const nextInfo = graph.getInfo(abstractNode)
        abstractNode = nextInfo.PreviousNode
      }

      // Find a better abstract node further along the path
      let abstractNodeForCost: CPos
      const cached = nodeForCostLookup.get(abstractNode.Bits)
      if (cached !== undefined) {
        abstractNodeForCost = cached
      } else {
        abstractNodeForCost = this.abstractNodeForCost(graph, abstractCell, abstractNode)
        nodeForCostLookup.set(abstractNode.Bits, abstractNodeForCost)
      }

      const nextInfo = graph.getInfo(abstractNodeForCost)
      return nextInfo.CostSoFar + this.costEstimator!(cell, abstractNodeForCost)
    }
  }

  /**
   * Find an abstract node further along the path for better cost estimation.
   *
   * OpenRA 对照: HierarchicalPathFinder.AbstractNodeForCost(SparsePathGraph, CPos, CPos)
   *
   * @param graph — the sparse path graph
   * @param abstractCell — the current abstract cell
   * @param abstractNode — the next abstract node along the path
   * @returns a better abstract node for cost estimation
   */
  private abstractNodeForCost(
    graph: { getInfo: (pos: CPos) => CellInfo },
    abstractCell: CPos,
    abstractNode: CPos,
  ): CPos {
    const abstractNodesAlongPath: CPos[] = []

    while (true) {
      const previousAbstractNode = graph.getInfo(abstractNode).PreviousNode

      // The whole abstract path has been travelled, can't go further.
      if (CPos.equals(previousAbstractNode, abstractNode)) {
        break
      }

      // Check if we can move directly to the new node
      let intersectsAllNodes = true
      abstractNodesAlongPath.push(abstractNode)

      for (const node of abstractNodesAlongPath) {
        const grid = this.getGrid(node)
        if (!grid.intersectsLine(abstractCell, previousAbstractNode)) {
          intersectsAllNodes = false
          break
        }
      }

      if (!intersectsAllNodes) {
        break
      }

      abstractNode = previousAbstractNode
    }

    return abstractNode
  }

  // -------------------------------------------------------------------------
  // Local path search helpers
  // -------------------------------------------------------------------------

  /**
   * Try to find a local path without using the abstract graph.
   * Used when source and target are close.
   *
   * @param source — starting cell
   * @param target — target cell
   * @returns path array, or empty if no local path found
   */
  private tryLocalPath(source: CPos, target: CPos): CPos[] {
    const gridToSearch = new Grid(
      new CPos(
        Math.min(source.X, target.X) - Math.floor(GRID_SIZE / 2),
        Math.min(source.Y, target.Y) - Math.floor(GRID_SIZE / 2),
        source.Layer,
      ),
      new CPos(
        Math.max(source.X, target.X) + Math.ceil(GRID_SIZE / 2),
        Math.max(source.Y, target.Y) + Math.ceil(GRID_SIZE / 2),
        source.Layer,
      ),
      false,
    )

    const search = PathSearch.toTargetCell(
      this.world,
      this.locomotor,
      null, // actor
      [source],
      target,
      this.check,
      100, // heuristicWeightPercentage — force shortest path for short distances
      null, // customCost
      null, // ignoreActor
      true, // laneBias
      false, // inReverse
      null, // heuristic
      gridToSearch,
      null, // recorder
    )

    const localPath = search.findPath()
    search.dispose()

    if (localPath === NoPath || localPath.length === 0) {
      return []
    }

    // Reverse from target-to-source to source-to-target
    return localPath.reverse()
  }

  /**
   * Find path when the source cell itself is unreachable but adjacent cells may be.
   *
   * @param source — the unreachable source cell
   * @param target — the target cell
   * @returns path array, or NoPath
   */
  private findPathFromUnreachableSource(source: CPos, target: CPos): CPos[] {
    // Try each adjacent cell
    for (const dir of CVec.Directions) {
      const adjacentSource = CPos.add(source, dir)
      if (!this.movementAllowedBetweenCells(source, adjacentSource)) {
        continue
      }

      const adjacentAbstractCell = this.abstractCellForLocalCell(adjacentSource)
      if (adjacentAbstractCell === null) {
        continue
      }

      // Check domain
      this.rebuildDomains()
      const targetAbstractCell = this.abstractCellForLocalCell(target)
      if (targetAbstractCell === null) {
        return NoPath
      }

      const targetDomain = this.abstractDomains.get(targetAbstractCell.Bits)
      const adjacentDomain = this.abstractDomains.get(adjacentAbstractCell.Bits)
      if (targetDomain !== adjacentDomain || targetDomain === undefined) {
        continue
      }

      // Found a valid adjacent cell, use it as the actual source
      const path = this.findPath(adjacentSource, target)
      if (path !== NoPath && path.length > 0) {
        // Prepend the original source
        return [source, ...path]
      }
    }

    return NoPath
  }

  /**
   * Create a local path search.
   *
   * OpenRA 对照: HierarchicalPathFinder.GetLocalPathSearch(...)
   */
  private getLocalPathSearch(
    sources: CPos[],
    target: CPos,
    customCost: ((pos: CPos) => number) | null,
    ignoreActor: IGameActor | null,
    check: BlockedByActor,
    laneBias: boolean,
    grid: Grid | null,
    heuristicWeightPercentage: number,
    heuristic: ((pos: CPos, isAccessible: boolean) => number) | null,
    inReverse: boolean,
  ): PathSearch {
    return PathSearch.toTargetCell(
      this.world,
      this.locomotor,
      null, // actor
      sources,
      target,
      check,
      heuristicWeightPercentage,
      customCost,
      ignoreActor,
      laneBias,
      inReverse,
      heuristic,
      grid,
      null, // recorder
    )
  }

  // -------------------------------------------------------------------------
  // Grid helpers
  // -------------------------------------------------------------------------

  /**
   * Get the grid index for a cell position.
   *
   * OpenRA 对照: HierarchicalPathFinder.GridIndex(CPos)
   *
   * @param cellInGrid — a cell within the grid
   * @returns the grid index
   */
  private gridIndex(cellInGrid: CPos): number {
    return (
      Math.floor((cellInGrid.Y - this.mapBounds.TopLeft.Y) / GRID_SIZE) * this.gridXs +
      Math.floor((cellInGrid.X - this.mapBounds.TopLeft.X) / GRID_SIZE)
    )
  }

  /**
   * Get the top-left cell of a grid by index.
   *
   * OpenRA 对照: HierarchicalPathFinder.GetGridTopLeft(int, byte)
   *
   * @param gridIndex — the grid index
   * @param layer — the layer
   * @returns the top-left cell of the grid
   */
  private getGridTopLeftByIndex(gridIndex: number, layer: number): CPos {
    return new CPos(
      (gridIndex % this.gridXs) * GRID_SIZE + this.mapBounds.TopLeft.X,
      Math.floor(gridIndex / this.gridXs) * GRID_SIZE + this.mapBounds.TopLeft.Y,
      layer,
    )
  }

  /**
   * Get the grid containing a cell.
   *
   * OpenRA 对照: HierarchicalPathFinder.GetGrid(CPos)
   *
   * @param cellInGrid — the cell position
   * @returns the Grid containing this cell
   */
  private getGrid(cellInGrid: CPos): Grid {
    const gridTopLeft = this.getGridTopLeft(cellInGrid)
    const width = Math.min(this.mapBounds.BottomRight.X - gridTopLeft.X, GRID_SIZE)
    const height = Math.min(this.mapBounds.BottomRight.Y - gridTopLeft.Y, GRID_SIZE)

    return new Grid(
      gridTopLeft,
      CPos.add(gridTopLeft, new CVec(width, height)),
      true,
    )
  }

  /**
   * Get the grid top-left for a cell (static-like helper).
   *
   * OpenRA 对照: HierarchicalPathFinder.GetGridTopLeft(CPos, Grid)
   */
  private getGridTopLeft(cellInGrid: CPos): CPos {
    return new CPos(
      Math.floor((cellInGrid.X - this.mapBounds.TopLeft.X) / GRID_SIZE) * GRID_SIZE + this.mapBounds.TopLeft.X,
      Math.floor((cellInGrid.Y - this.mapBounds.TopLeft.Y) / GRID_SIZE) * GRID_SIZE + this.mapBounds.TopLeft.Y,
      cellInGrid.Layer,
    )
  }

  // -------------------------------------------------------------------------
  // STUB helpers (to be replaced when World/Map are fully migrated)
  // -------------------------------------------------------------------------

  /**
   * Check if a cell is within the world bounds.
   *
   * STUB: Uses map bounds directly. Will use world.Map.Contains when Map is fully available.
   */
  private cellInWorld(cell: CPos): boolean {
    return (
      cell.X >= this.mapBounds.TopLeft.X &&
      cell.X < this.mapBounds.BottomRight.X &&
      cell.Y >= this.mapBounds.TopLeft.Y &&
      cell.Y < this.mapBounds.BottomRight.Y
    )
  }

  /**
   * Get the map size.
   *
   * STUB: Returns a default size. Will use world.Map.MapSize when Map is fully available.
   */
  private getMapSize(): { width: number; height: number } {
    // STUB: Try to get from world if available
    const w = this.world as unknown as { Map?: { mapSize?: { width: number; height: number } } }
    if (w.Map?.mapSize) {
      return w.Map.mapSize
    }
    return { width: 128, height: 128 }
  }

  /**
   * Get custom movement layers.
   *
   * STUB: Returns empty array. Will use world.GetCustomMovementLayers() when available.
   */
  private getCustomMovementLayers(): readonly (ICustomMovementLayer | null)[] {
    // STUB: Ground layer (index 0) is always present as null.
    // OpenRA's Map.CustomMovementLayers is a 256-element array where
    // layer 0 (ground) is always null. We return [null] so layer 0
    // is always processed in grid loops.
    return [null]
  }

  /**
   * Create a GridPathGraph for flood fill within a grid.
   *
   * STUB: Simplified version that uses a basic graph.
   */
  private createGridPathGraph(
    _src: CPos,
    customCost: ((pos: CPos) => number) | null,
    grid: Grid,
  ): GridPathGraph {
    return new GridPathGraph(
      this.locomotor,
      null, // actor
      this.world,
      0, /* BlockedByActor.None */
      customCost,
      null, // ignoreActor
      false, // laneBias
      false, // inReverse
      grid,
    )
  }
}
