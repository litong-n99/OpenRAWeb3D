/**
 * ResourceMapBotModule.ts — grid-based resource heatmap and threat awareness
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/ResourceMapBotModule.cs
 *
 * 核心范式转换:
 * - C# ResourceIndice class → TypeScript ResourceIndice interface
 * - C# resourceMapIndices array (allocated once) → TypeScript Array (pre-allocated)
 * - C# FindTilesInAnnulus / FindActorsInCircle → TypeScript duck-typed map methods
 * - C# MersenneTwister → SimplePrng (from Squad.ts, or external)
 * - C# Exts.MakeArray → Array.from with mapper
 * - C# firstTick lazy init → firstTick flag pattern
 *
 * The ResourceMapBotModule maintains a grid of "indices" (regions) covering
 * the map. Each indice tracks:
 * - Resource cell count and center position
 * - Player refinery/harvester counts
 * - Enemy unit/base counts
 * - Friendly base/unit counts
 *
 * Updates are spread across ticks — one indice per interval.
 */

import type { SimplePrng } from './Squads/Squad.js'

// ---------------------------------------------------------------------------
// ResourceIndice (对应 OpenRA ResourceIndice class)
// ---------------------------------------------------------------------------

/**
 * Grid cell representing a region of the map.
 *
 * OpenRA 对照: ResourceIndice class
 */
export interface ResourceIndice {
  /** Grid index (column, row). */
  indiceIndex: { x: number; y: number }
  /** Center cell of this indice. */
  indiceCenter: { x: number; y: number }
  /** Number of resource cells in this indice. */
  resourceCellsCount: number
  /** Center cell of resource concentration. */
  resourceCellsCenter: { x: number; y: number }
  /** Locations of resource creator actors. */
  resourceCreatorLocs: readonly { x: number; y: number }[]
  /** Number of player-owned refineries in this indice. */
  playerRefineryCount: number
  /** Number of player-owned harvesters in this indice. */
  playerHarvesterCount: number
  /** Number of enemy normal units. */
  enemyUnitCount: number
  /** Number of enemy base buildings. */
  enemyBaseCount: number
  /** Number of friendly base buildings. */
  friendlyBaseCount: number
  /** Number of friendly units. */
  friendlyUnitCount: number
}

// ---------------------------------------------------------------------------
// ResourceMapBotModuleInfo (对应 OpenRA ResourceMapBotModuleInfo)
// ---------------------------------------------------------------------------

/**
 * Configuration for ResourceMapBotModule.
 *
 * OpenRA 对照: ResourceMapBotModuleInfo : ConditionalTraitInfo
 */
export interface ResourceMapBotModuleInfo {
  /** Resource types considered valuable for harvesting. */
  readonly valuableResourceTypes: ReadonlySet<string>
  /** Actor types that create resources (e.g., ore derricks). */
  readonly resourceCreatorTypes: ReadonlySet<string>
  /** Actor types that are refineries. */
  readonly refineryTypes: ReadonlySet<string>
  /** Actor types that are harvesters. */
  readonly harvesterTypes: ReadonlySet<string>
  /** Actor types considered enemy base buildings. */
  readonly enemyBaseBuildingTypes: ReadonlySet<string>
  /** Interval (ticks) between updating each indice. */
  readonly updateResourceMapInterval: number
  /** Half side length of each indice (in cells). */
  readonly resourceMapStrideRadius: number
}

// ---------------------------------------------------------------------------
// Map / World duck-type interfaces (avoids circular imports)
// ---------------------------------------------------------------------------

interface CellLike {
  x: number
  y: number
}

interface ResourceLayerLike {
  getResource(cell: CellLike): { type: string | null }
  readonly isEmpty: boolean
}

interface MapLike {
  bounds: { x: number; y: number; width: number; height: number }
  findTilesInAnnulus(center: CellLike, minRadius: number, maxRadius: number): CellLike[]
  centerOfCell(cell: CellLike): { x: number; y: number; z: number }
}

interface ActorLike {
  owner: PlayerLike
  location: CellLike
  info?: { name: string }
}

interface PlayerLike {
  playerName: string
  relationshipWith(other: PlayerLike): string
}

interface WorldLike {
  map: MapLike
  actors: Iterable<ActorLike>
  findActorsInCircle(center: { x: number; y: number; z: number }, radius: { length: number }): ActorLike[]
}

// ---------------------------------------------------------------------------
// ResourceMapBotModule
// ---------------------------------------------------------------------------

/**
 * AI resource heatmap and threat awareness system.
 *
 * OpenRA 对照: ResourceMapBotModule class (implements IBotTick)
 *
 * Maintains a grid of indices covering the map. Each indice tracks
 * resource density, refinery/harvester counts, and enemy presence.
 * Updates are spread across ticks for performance.
 */
export class ResourceMapBotModule {
  readonly info: ResourceMapBotModuleInfo

  private readonly _world: WorldLike
  private readonly _player: PlayerLike
  private _resourceLayer: ResourceLayerLike | null = null

  /** Pre-allocated indice array (one per grid cell). */
  private _resourceMapIndices: ResourceIndice[] | null = null

  /** Side length of each indice (in cells). */
  private readonly _indiceSideLength: number

  /** Scan radius for finding resources within an indice. */
  private readonly _indiceResourceScanRadius: number

  /** Number of columns in the indice grid. */
  private _columnCount: number = 0

  /** Number of rows in the indice grid. */
  private _rowCount: number = 0

  /** Current indice being updated. */
  private _updateIndex: number = 0

  /** Ticks until next update. */
  private _updateInterval: number

  /** Initialization gate. */
  private _firstTick: boolean = true

  /**
   * Create a new ResourceMapBotModule.
   *
   * OpenRA 对照: ResourceMapBotModule(Actor, ResourceMapBotModuleInfo)
   */
  constructor(world: WorldLike, player: PlayerLike, info: ResourceMapBotModuleInfo, random: SimplePrng) {
    this._world = world
    this._player = player
    this.info = info
    this._indiceSideLength = info.resourceMapStrideRadius << 1

    // FindTilesInAnnulus returns cells in a rough circle, indices are square.
    // We need a larger range to cover cells approximately.
    // ≈ strideRadius * 12 / 10 (integer: *12 then /10)
    this._indiceResourceScanRadius = (info.resourceMapStrideRadius * 12 / 10) | 0

    // Randomize initial update interval to desynchronize AI players
    this._updateInterval = random.nextIntRange(
      info.updateResourceMapInterval,
      info.updateResourceMapInterval << 1,
    )
  }

  // -----------------------------------------------------------------------
  // IBotTick
  // -----------------------------------------------------------------------

  /**
   * Called each logic tick by the bot controller.
   *
   * OpenRA 对照: IBotTick.BotTick(IBot)
   *
   * On first tick: initializes the indice grid and performs first full update.
   * Subsequent ticks: updates one indice per interval.
   */
  botTick(): void {
    if (this._firstTick) {
      this._firstTick = false
      this._resourceLayer = this.getResourceLayer()

      if (!this._resourceMapIndices && this._resourceLayer) {
        this.initializeIndices()
      }
    }

    if (--this._updateInterval <= 0) {
      this._updateInterval = this.info.updateResourceMapInterval
      if (this._resourceMapIndices && this._resourceMapIndices.length > 0) {
        this.updateResourceMap(this._updateIndex)
        this._updateIndex = (this._updateIndex + 1) % this._resourceMapIndices.length
      }
    }
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  private getResourceLayer(): ResourceLayerLike | null {
    // Duck-type: try to get from world's worldActor
    const w = this._world as unknown as {
      worldActor?: { traitOrDefault?: (name: string) => unknown }
    }
    return w.worldActor?.traitOrDefault?.('IResourceLayer') as ResourceLayerLike | null ?? null
  }

  private initializeIndices(): void {
    const map = this._world.map
    const xoffset = map.bounds.x
    const yoffset = map.bounds.y
    const width = map.bounds.width
    const height = map.bounds.height

    this._columnCount = ((width + this._indiceSideLength - 1) / this._indiceSideLength) | 0
    this._rowCount = ((height + this._indiceSideLength - 1) / this._indiceSideLength) | 0

    const overallWidth = this._columnCount * this._indiceSideLength
    const overallHeight = this._rowCount * this._indiceSideLength

    const startX = xoffset - ((overallWidth - width) >> 1)
    const startY = yoffset - ((overallHeight - height) >> 1)

    const totalIndices = this._columnCount * this._rowCount
    this._resourceMapIndices = new Array(totalIndices)

    for (let i = 0; i < totalIndices; i++) {
      const col = i % this._columnCount
      const row = (i / this._columnCount) | 0

      const centerX = startX + col * this._indiceSideLength + (this._indiceSideLength >> 1)
      const centerY = startY + row * this._indiceSideLength + (this._indiceSideLength >> 1)

      this._resourceMapIndices[i] = {
        indiceIndex: { x: col, y: row },
        indiceCenter: { x: centerX, y: centerY },
        resourceCellsCount: 0,
        resourceCellsCenter: { x: 0, y: 0 },
        resourceCreatorLocs: [],
        playerRefineryCount: 0,
        playerHarvesterCount: 0,
        enemyUnitCount: 0,
        enemyBaseCount: 0,
        friendlyBaseCount: 0,
        friendlyUnitCount: 0,
      }

      // First full update
      this.updateResourceMap(i)
    }
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  /**
   * Update a single indice's resource and threat data.
   *
   * OpenRA 对照: ResourceMapBotModule.UpdateResourceMap(int)
   */
  private updateResourceMap(index: number): void {
    if (!this._resourceLayer || !this._resourceMapIndices) return

    const indice = this._resourceMapIndices[index]
    const map = this._world.map

    // Scan for resource cells
    let sumCellsX = 0
    let sumCellsY = 0
    const resTiles: CellLike[] = []

    const tiles = map.findTilesInAnnulus(
      indice.indiceCenter,
      0,
      this._indiceResourceScanRadius,
    )

    for (const c of tiles) {
      const resource = this._resourceLayer.getResource(c)
      if (resource.type && this.info.valuableResourceTypes.has(resource.type)) {
        sumCellsX += c.x
        sumCellsY += c.y
        resTiles.push(c)
      }
    }

    const resCount = resTiles.length
    let bestCell: CellLike = { x: 0, y: 0 }

    if (resCount > 0) {
      const avgX = (sumCellsX / resCount) | 0
      const avgY = (sumCellsY / resCount) | 0

      bestCell = resTiles[0]
      let bestDist = (bestCell.x - avgX) * (bestCell.x - avgX) +
        (bestCell.y - avgY) * (bestCell.y - avgY)

      for (let i = 1; i < resTiles.length; i++) {
        const c = resTiles[i]
        const dist = (c.x - avgX) * (c.x - avgX) + (c.y - avgY) * (c.y - avgY)
        if (dist < bestDist) {
          bestDist = dist
          bestCell = c
        }
      }
    }

    // Scan for actors in the indice
    let refineryCount = 0
    let harvesterCount = 0
    let normalEnemyCount = 0
    let highThreatEnemyCount = 0

    const center = map.centerOfCell(indice.indiceCenter)
    const scanWDist = { length: this._indiceResourceScanRadius * 1024 }

    const actors = this._world.findActorsInCircle(center, scanWDist)
    const resourceCreatorLocs: CellLike[] = []

    for (const a of actors) {
      const rel = this._player.relationshipWith(a.owner)
      const relStr = String(rel)

      if (relStr === 'Enemy') {
        if (a.info && this.info.enemyBaseBuildingTypes.has(a.info.name)) {
          highThreatEnemyCount++
        } else {
          normalEnemyCount++
        }
      } else if (relStr === 'Ally') {
        if (a.info && this.info.enemyBaseBuildingTypes.has(a.info.name)) {
          indice.friendlyBaseCount++
        } else {
          indice.friendlyUnitCount++
        }

        if (a.owner === this._player) {
          if (a.info && this.info.refineryTypes.has(a.info.name)) {
            refineryCount++
          }
          if (a.info && this.info.harvesterTypes.has(a.info.name)) {
            harvesterCount++
          }
        }
      }

      if (a.info && this.info.resourceCreatorTypes.has(a.info.name)) {
        resourceCreatorLocs.push(a.location)
      }
    }

    // Update indice
    indice.resourceCellsCount = resCount
    indice.resourceCellsCenter = bestCell
    indice.resourceCreatorLocs = resourceCreatorLocs
    indice.playerRefineryCount = refineryCount
    indice.playerHarvesterCount = harvesterCount
    indice.enemyUnitCount = normalEnemyCount
    indice.enemyBaseCount = highThreatEnemyCount
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get the total number of indices.
   *
   * OpenRA 对照: ResourceMapBotModule.GetIndicesLength()
   */
  getIndicesLength(): number {
    return this._resourceMapIndices?.length ?? 0
  }

  /**
   * Get the side length of each indice (in cells).
   *
   * OpenRA 对照: ResourceMapBotModule.GetIndiceSideLength()
   */
  getIndiceSideLength(): number {
    return this._indiceSideLength
  }

  /**
   * Get the number of indice columns.
   */
  getIndiceColumnCount(): number {
    return this._columnCount
  }

  /**
   * Get the number of indice rows.
   */
  getIndiceRowCount(): number {
    return this._rowCount
  }

  /**
   * Get the scan radius for finding resources within an indice.
   */
  getIndiceScanRadius(): number {
    return this._indiceResourceScanRadius
  }

  /**
   * Get threat information for nearby indices.
   *
   * OpenRA 对照: ResourceMapBotModule.GetNearbyIndicesThreat(int)
   *
   * Checks the 8 neighboring indices (3x3 grid, excluding center).
   * Returns total indice count, nearby enemy unit count (minus friendly units),
   * and nearby enemy base count (minus friendly bases).
   */
  getNearbyIndicesThreat(index: number): {
    indiceCount: number
    enemyUnitCount: number
    enemyBaseCount: number
  } {
    const indices = this._resourceMapIndices
    if (!indices) return { indiceCount: 0, enemyUnitCount: 0, enemyBaseCount: 0 }

    const baseIndice = indices[index]
    if (!baseIndice) return { indiceCount: 0, enemyUnitCount: 0, enemyBaseCount: 0 }

    const x = baseIndice.indiceIndex.x
    const y = baseIndice.indiceIndex.y
    const offsets = [-1, 0, 1]

    let indiceCount = 0
    let nearbyEnemyBase = 0
    let nearbyEnemyUnit = 0

    for (const dx of offsets) {
      for (const dy of offsets) {
        const offsetIndex = x + dx + (y + dy) * this._columnCount
        if (offsetIndex === index) continue
        if (offsetIndex < 0 || offsetIndex >= indices.length) continue

        const neighbor = indices[offsetIndex]
        nearbyEnemyBase += neighbor.enemyBaseCount - neighbor.friendlyBaseCount
        nearbyEnemyUnit += neighbor.enemyUnitCount - neighbor.friendlyUnitCount
        indiceCount++
      }
    }

    return {
      indiceCount,
      enemyUnitCount: nearbyEnemyUnit > 0 ? nearbyEnemyUnit : 0,
      enemyBaseCount: nearbyEnemyBase > 0 ? nearbyEnemyBase : 0,
    }
  }

  /**
   * Get a specific indice by index.
   *
   * OpenRA 对照: ResourceMapBotModule.GetIndice(int)
   */
  getIndice(i: number): ResourceIndice | null {
    if (!this._resourceMapIndices || i >= this._resourceMapIndices.length) return null
    return this._resourceMapIndices[i]
  }

  /**
   * Find the indice closest to a given cell position.
   *
   * OpenRA 对照: ResourceMapBotModule.FindClosestIndiceFromCPos(CPos)
   */
  findClosestIndiceFromCPos(cpos: CellLike): ResourceIndice | null {
    if (!this._resourceMapIndices) return null

    let maxDist = 2147483647 // INT32_MAX
    let best = 0

    for (let i = 0; i < this._resourceMapIndices.length; i++) {
      const idx = this._resourceMapIndices[i]
      const dx = idx.indiceCenter.x - cpos.x
      const dy = idx.indiceCenter.y - cpos.y
      const dist = dx * dx + dy * dy
      if (dist < maxDist) {
        maxDist = dist
        best = i
      }
    }

    return this.getIndice(best)
  }
}
