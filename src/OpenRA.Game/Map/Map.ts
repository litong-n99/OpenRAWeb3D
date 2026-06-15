/**
 * Map.ts — Core map container: terrain layers, projection system, coordinate methods
 * OpenRA 对照: OpenRA.Game/Map/Map.cs (1450 lines)
 *
 * 核心范式转换:
 * - C# BinaryDataHeader struct → parseBinaryDataHeader() from MapBinParser
 * - C# Stream.ReadUInt8/16/32 → DataView.getUint8/getUint16/getUint32 (little-endian)
 * - C# CellLayer<byte> with Map-taking constructor → CellLayer<number> with (gridType, size)
 * - C# event Action<CPos> CellProjectionChanged → callback array pattern
 * - C# ModData/Ruleset/SequenceSet/MinYaml → stubs (deferred to Chapter 5+)
 * - C# MersenneTwister → () => number random function
 * - C# CellLayer<PPos[]>/CellLayer<List<MPos>> → CellLayer<PPos[]>/CellLayer<MPos[]>
 * - C# CellLayer<short> cachedTerrainIndexes → CellLayer<number> with -1 sentinel
 *
 * Sub-modules (Architect WR approved split):
 * - TileReference.ts — TerrainTile, ResourceTile value types
 * - MapBinParser.ts — BinaryDataHeader, parse/serialize map.bin
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { CPos } from '../CPos'
import { MPos, PPos } from '../MPos'
import { CVec } from '../CVec'
import { WPos } from '../WPos'
import { WVec } from '../WVec'
import { WDist } from '../WDist'
import { WRot } from '../WRot'
import { WAngle } from '../WAngle'
import { MapGrid } from './MapGrid'
import { MapGridType } from './MapGridType'
import { CellLayer, type CellEntryChangedCallback } from './CellLayer'
import { CellRegion } from './CellRegion'
import { ProjectedCellRegion, type GridConfig } from './ProjectedCellRegion'
import { Rectangle } from '../Primitives/Rectangle'
import type { Size } from '../Primitives/Size'
import type { TerrainTypeInfo, TerrainTileInfo } from './TerrainInfo'
import {
  type TerrainTile,
  type ResourceTile,
  DEFAULT_RESOURCE_TILE,
} from './TileReference'
import {
  parseBinaryDataHeader,
  computeBinaryDataLayout,
  writeBinaryDataHeader,
} from './MapBinParser'

// ---------------------------------------------------------------------------
// Re-exports (backward compatibility for consumers)
// ---------------------------------------------------------------------------

export {
  type TerrainTile,
  type ResourceTile,
  DEFAULT_TERRAIN_TILE,
  DEFAULT_RESOURCE_TILE,
} from './TileReference'
export {
  parseBinaryDataHeader,
  type BinaryDataHeader,
} from './MapBinParser'

// ---------------------------------------------------------------------------
// MapVisibility
// OpenRA 对照: Map.MapVisibility enum
// ---------------------------------------------------------------------------

/** Visibility flags for map listing.
 *
 * OpenRA 对照: Map.MapVisibility ([Flags] enum)
 */
export const MapVisibility = {
  Lobby: 1,
  Shellmap: 2,
  MissionSelector: 4,
} as const

export type MapVisibility = (typeof MapVisibility)[keyof typeof MapVisibility]

// ---------------------------------------------------------------------------
// ITerrainInfo — Phase D subset
// OpenRA 对照: ITerrainInfo interface (TerrainInfo.cs)
// NOTE: Full interface deferred to Phase E.
// ---------------------------------------------------------------------------

/** Subset of ITerrainInfo for Phase D Map construction.
 *
 * OpenRA 对照: ITerrainInfo
 */
export interface ITerrainInfo {
  readonly id: string
  readonly terrainTypes: readonly TerrainTypeInfo[]
  readonly defaultTerrainTile: TerrainTile
  readonly minHeightColorBrightness?: number
  readonly maxHeightColorBrightness?: number

  getTerrainInfo(tile: TerrainTile): TerrainTileInfo
  tryGetTerrainInfo(tile: TerrainTile): TerrainTileInfo | null
  getTerrainIndex(tile: TerrainTile): number
}

// ---------------------------------------------------------------------------
// MapLoaderInput — decomposed constructor params
// ---------------------------------------------------------------------------

/** Parameters for loading a Map from parsed yaml + binary data.
 *
 * OpenRA 对照: Map(ModData, IReadOnlyPackage) constructor parameters
 */
export interface MapLoaderInput {
  grid: MapGrid
  terrainInfo: ITerrainInfo
  mapFormat: number
  title: string
  author: string
  tileset: string
  requiresMod?: string
  lockPreview?: boolean
  bounds?: Rectangle
  visibility?: MapVisibility
  categories?: string[]
  binaryData: ArrayBuffer
}

// ---------------------------------------------------------------------------
// MapCellProjectionChanged callback type
// ---------------------------------------------------------------------------

/** Callback for cell projection changes.
 *
 * OpenRA 对照: Map.CellProjectionChanged (event Action<CPos>)
 */
export type MapCellProjectionChangedCallback = (cell: CPos) => void

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel for uninitialized terrain index cache entries.
 *
 * OpenRA 对照: Map.InvalidCachedTerrainIndex = -1
 */
const INVALID_CACHED_TERRAIN_INDEX = -1

/** Empty array sentinel for cells with no projection.
 *
 * OpenRA 对照: Map.NoProjectedCells
 */
const NO_PROJECTED_CELLS: readonly PPos[] = Object.freeze([])

// ---------------------------------------------------------------------------
// Map
// OpenRA 对照: Map (sealed class, ~1450 lines)
// ---------------------------------------------------------------------------

/**
 * Core map container holding terrain, resource, height, and ramp data.
 *
 * OpenRA 对照: Map
 *
 * Central data structure of the terrain system. Stores per-cell data in
 * CellLayers, provides coordinate conversion between CPos/MPos/PPos/WPos,
 * and manages the cell projection system for maps with terrain height.
 *
 * NOTE: IReadOnlyFileSystem methods deferred to Chapter 5.
 * NOTE: Ruleset/SequenceSet deferred to Phase E.
 */
export class Map {
  // -------------------------------------------------------------------------
  // Static constants
  // -------------------------------------------------------------------------

  static readonly SupportedMapFormat = 11
  static readonly CurrentMapFormat = 12

  // -------------------------------------------------------------------------
  // Format versions
  // -------------------------------------------------------------------------

  mapFormat: number
  readonly tileFormat: number = 2

  // -------------------------------------------------------------------------
  // Standard yaml metadata
  // -------------------------------------------------------------------------

  requiresMod = ''
  title = ''
  author = ''
  tileset = ''
  lockPreview = false
  bounds: Rectangle = Rectangle.Empty
  visibility: MapVisibility = MapVisibility.Lobby
  categories: string[] = ['Conquest']

  // -------------------------------------------------------------------------
  // Map size and grid
  // -------------------------------------------------------------------------

  mapSize: Size
  readonly grid: MapGrid
  readonly terrainInfo: ITerrainInfo

  // -------------------------------------------------------------------------
  // Data layers
  // -------------------------------------------------------------------------

  tiles!: CellLayer<TerrainTile>
  resources!: CellLayer<ResourceTile>
  height!: CellLayer<number>
  ramp!: CellLayer<number>
  customTerrain!: CellLayer<number>

  // -------------------------------------------------------------------------
  // Projected layout
  // -------------------------------------------------------------------------

  projectedCells: PPos[] = []
  allCells!: CellRegion
  allEdgeCells: CPos[] = []
  readonly replacedInvalidTerrainTiles: globalThis.Map<string, TerrainTile> = new globalThis.Map()
  projectedTopLeft: WPos = WPos.Zero
  projectedBottomRight: WPos = WPos.Zero
  cellProjectionChanged: MapCellProjectionChangedCallback[] = []

  // -------------------------------------------------------------------------
  // Internal projection state
  // -------------------------------------------------------------------------

  private _cellProjection: CellLayer<PPos[]> | null = null
  private _inverseCellProjection: CellLayer<MPos[]> | null = null
  private _projectedHeight: CellLayer<number> | null = null
  private _initializedCellProjection = false
  private _projectionSafeBounds: Rectangle | null = null

  // -------------------------------------------------------------------------
  // Terrain index cache
  // -------------------------------------------------------------------------

  private _cachedTerrainIndexes: CellLayer<number> | null = null

  // -------------------------------------------------------------------------
  // Bound observer callbacks (for cleanup in dispose)
  // -------------------------------------------------------------------------

  private _boundUpdateRamp: CellEntryChangedCallback | null = null
  private _boundUpdateProjection: CellEntryChangedCallback | null = null
  private _boundHeightUpdateProjection: CellEntryChangedCallback | null = null
  private _boundInvalidateTerrainIndex: CellEntryChangedCallback | null = null

  // =========================================================================
  // Constructor (private — use static factories)
  // =========================================================================

  private constructor(grid: MapGrid, mapSize: Size, terrainInfo: ITerrainInfo) {
    this.grid = grid
    this.mapSize = { width: mapSize.width, height: mapSize.height }
    this.terrainInfo = terrainInfo
    this.mapFormat = Map.CurrentMapFormat
  }

  // =========================================================================
  // Static factories
  // =========================================================================

  /**
   * Create a blank map for the editor or importer.
   *
   * OpenRA 对照: Map(ModData, ITerrainInfo, Size)
   *
   * @param grid — grid geometry configuration
   * @param size — map size in cells
   * @param terrainInfo — terrain type information
   */
  static createBlank(
    grid: MapGrid,
    size: Size,
    terrainInfo: ITerrainInfo,
  ): Map {
    const map = new Map(grid, size, terrainInfo)

    map.title = 'Name your map here'
    map.author = 'Your name here'
    map.tileset = terrainInfo.id
    map.bounds = Rectangle.fromLTRB(0, 0, size.width, size.height)

    map.tiles = new CellLayer<TerrainTile>(grid.type, size)
    map.resources = new CellLayer<ResourceTile>(grid.type, size)
    map.height = new CellLayer<number>(grid.type, size)
    map.ramp = new CellLayer<number>(grid.type, size)
    map.tiles.clear(terrainInfo.defaultTerrainTile)
    map.resources.clear(DEFAULT_RESOURCE_TILE)
    map.height.clear(0)
    map.ramp.clear(0)

    if (grid.maximumTerrainHeight > 0) {
      map._wireObservers()
    }

    map._postInit()
    return map
  }

  /**
   * Create a Map from parsed binary data and metadata.
   *
   * OpenRA 对照: Map(ModData, IReadOnlyPackage) constructor
   *
   * @param input — pre-parsed map data including raw map.bin buffer
   */
  static fromLoaderInput(input: MapLoaderInput): Map {
    if (input.mapFormat < Map.SupportedMapFormat) {
      throw new Error(
        `Map format ${input.mapFormat} is not supported. ` +
        `Minimum supported format is ${Map.SupportedMapFormat}.`,
      )
    }

    const dataView = new DataView(input.binaryData)
    const header = parseBinaryDataHeader(
      dataView,
      input.bounds ? input.bounds.Width : 0, // validated by caller
      input.bounds ? input.bounds.Height : 0,
    )

    const size = { width: header.width, height: header.height }
    const map = new Map(input.grid, size, input.terrainInfo)

    // Metadata
    map.mapFormat = input.mapFormat
    map.title = input.title
    map.author = input.author
    map.tileset = input.tileset
    map.requiresMod = input.requiresMod ?? ''
    map.lockPreview = input.lockPreview ?? false
    map.visibility = input.visibility ?? MapVisibility.Lobby
    map.categories = input.categories ?? ['Conquest']
    map.bounds = input.bounds ?? Rectangle.fromLTRB(0, 0, size.width, size.height)

    // Initialize layers
    map.tiles = new CellLayer<TerrainTile>(input.grid.type, size)
    map.resources = new CellLayer<ResourceTile>(input.grid.type, size)
    map.height = new CellLayer<number>(input.grid.type, size)
    map.ramp = new CellLayer<number>(input.grid.type, size)

    // Load tile data
    if (header.tilesOffset > 0) {
      let pos = header.tilesOffset
      for (let i = 0; i < header.width; i++) {
        for (let j = 0; j < header.height; j++) {
          const tileType = dataView.getUint16(pos, true)
          pos += 2
          let tileIndex = dataView.getUint8(pos)
          pos += 1

          // TODO: Remove when rewriting tile variants / PickAny
          if (tileIndex === 0xff) {
            tileIndex = (i % 4 + (j % 4) * 4) & 0xff
          }

          map.tiles.setMPos(new MPos(i, j), { type: tileType, index: tileIndex })
        }
      }
    }

    // Load resource data
    if (header.resourcesOffset > 0) {
      let pos = header.resourcesOffset
      for (let i = 0; i < header.width; i++) {
        for (let j = 0; j < header.height; j++) {
          const rType = dataView.getUint8(pos++)
          const rDensity = dataView.getUint8(pos++)
          map.resources.setMPos(new MPos(i, j), { type: rType, index: rDensity })
        }
      }
    }

    // Load height data
    if (header.heightsOffset > 0) {
      let pos = header.heightsOffset
      const maxH = input.grid.maximumTerrainHeight
      for (let i = 0; i < header.width; i++) {
        for (let j = 0; j < header.height; j++) {
          map.height.setMPos(new MPos(i, j), Math.min(dataView.getUint8(pos++), maxH))
        }
      }
    }

    if (input.grid.maximumTerrainHeight > 0) {
      map._wireObservers()
    }

    map._postInit()
    return map
  }

  // =========================================================================
  // Internal wiring
  // =========================================================================

  /** Wire up CellEntryChanged observers for ramp and projection updates.
   *
   * OpenRA 对照: constructor wiring
   */
  private _wireObservers(): void {
    this._boundUpdateRamp = this._updateRamp.bind(this)
    this._boundUpdateProjection = this._updateProjection.bind(this)
    this._boundHeightUpdateProjection = this._heightUpdateProjection.bind(this)

    this.tiles.onCellEntryChanged(this._boundUpdateRamp)
    this.tiles.onCellEntryChanged(this._boundUpdateProjection)
    this.height.onCellEntryChanged(this._boundHeightUpdateProjection)
  }

  // =========================================================================
  // PostInit
  // OpenRA 对照: Map.PostInit()
  // =========================================================================

  private _postInit(): void {
    const tl = new MPos(0, 0).toCPos(this.grid.type)
    const br = new MPos(
      this.mapSize.width - 1,
      this.mapSize.height - 1,
    ).toCPos(this.grid.type)
    this.allCells = new CellRegion(this.grid.type, tl, br)

    const btl = new PPos(this.bounds.Left, this.bounds.Top)
    const bbr = new PPos(
      this.bounds.Right > 1 ? this.bounds.Right - 1 : this.mapSize.width - 1,
      this.bounds.Bottom > 1 ? this.bounds.Bottom - 1 : this.mapSize.height - 1,
    )
    this._setBounds(btl, bbr)

    this.customTerrain = new CellLayer<number>(this.grid.type, this.mapSize)
    for (const uv of this.allCells.MapCoords) {
      this.customTerrain.setMPos(uv, 0xff)
    }

    // Replace invalid tiles and cache ramp state
    for (const uv of this.allCells.MapCoords) {
      const tile = this.tiles.getMPos(uv)
      let info = this.terrainInfo.tryGetTerrainInfo(tile)
      if (!info) {
        this.replacedInvalidTerrainTiles.set(
          uv.toCPos(this.grid.type).toString(),
          tile,
        )
        this.tiles.setMPos(uv, this.terrainInfo.defaultTerrainTile)
        info = this.terrainInfo.getTerrainInfo(this.terrainInfo.defaultTerrainTile)
      }
      this.ramp.setMPos(uv, info.rampType)
    }

    this.allEdgeCells = this._updateEdgeCells()

    // Terrain index cache invalidation
    this._boundInvalidateTerrainIndex = (c: CPos) => {
      if (this._cachedTerrainIndexes) {
        this._cachedTerrainIndexes.set(c, INVALID_CACHED_TERRAIN_INDEX)
      }
    }
    this.customTerrain.onCellEntryChanged(this._boundInvalidateTerrainIndex)
    this.tiles.onCellEntryChanged(this._boundInvalidateTerrainIndex)
  }

  // =========================================================================
  // UpdateRamp
  // OpenRA 对照: Map.UpdateRamp(CPos)
  // =========================================================================

  private _updateRamp(cell: CPos): void {
    const tile = this.tiles.get(cell)
    this.ramp.set(cell, this.terrainInfo.getTerrainInfo(tile).rampType)
  }

  /** Height change handler → update projection.
   *
   * OpenRA 对照: Height.CellEntryChanged += UpdateProjection
   */
  private _heightUpdateProjection(cell: CPos): void {
    this._updateProjection(cell)
  }

  // =========================================================================
  // InitializeCellProjection
  // OpenRA 对照: Map.InitializeCellProjection()
  // =========================================================================

  private _initializeCellProjection(): void {
    if (this._initializedCellProjection) return
    this._initializedCellProjection = true

    this._cellProjection = new CellLayer<PPos[]>(this.grid.type, this.mapSize)
    this._inverseCellProjection = new CellLayer<MPos[]>(this.grid.type, this.mapSize)
    this._projectedHeight = new CellLayer<number>(this.grid.type, this.mapSize)

    for (const cell of this.allCells) {
      const uv = cell.toMPos(this.grid.type)
      this._cellProjection.setMPos(uv, [])
      this._inverseCellProjection.setMPos(uv, [])
    }

    for (const cell of this.allCells) {
      this._updateProjection(cell)
    }
  }

  // =========================================================================
  // UpdateProjection
  // OpenRA 对照: Map.UpdateProjection(CPos)
  // =========================================================================

  private _updateProjection(cell: CPos): void {
    if (this.grid.maximumTerrainHeight === 0) {
      const uv = cell.toMPos(this.grid.type)
      if (!this._cellProjection) {
        this._fireCellProjectionChanged(cell)
        return
      }
      this._cellProjection.set(cell, [PPos.fromMPos(uv)])
      const inverse = this._inverseCellProjection!.getMPos(uv)
      inverse.length = 0
      inverse.push(uv)
      this._fireCellProjectionChanged(cell)
      return
    }

    if (!this._initializedCellProjection) {
      this._initializeCellProjection()
    }

    const uv = cell.toMPos(this.grid.type)

    // Remove old reverse projection
    const oldProjected = this._cellProjection!.getMPos(uv)
    for (const puv of oldProjected) {
      const temp = puv.toMPos()
      const invList = this._inverseCellProjection!.getMPos(temp)
      const idx = invList.findIndex((m) => MPos.equals(m, uv))
      if (idx >= 0) invList.splice(idx, 1)
      this._projectedHeight!.setMPos(temp, this._projectedCellHeightInner(puv))
    }

    // Compute new forward projection
    const projected = this._projectCellInner(uv)
    this._cellProjection!.setMPos(uv, projected)

    // Add new reverse projection
    for (const puv of projected) {
      let temp = puv.toMPos()
      this._inverseCellProjection!.getMPos(temp).push(uv)

      const height = this._projectedCellHeightInner(puv)
      this._projectedHeight!.setMPos(temp, height)

      // Propagate height up cliff faces
      while (true) {
        temp = new MPos(temp.U, temp.V - 1)
        if (
          !this._inverseCellProjection!.contains(temp) ||
          this._inverseCellProjection!.getMPos(temp).length > 0
        ) {
          break
        }
        this._projectedHeight!.setMPos(temp, height)
      }
    }

    this._fireCellProjectionChanged(cell)
  }

  private _fireCellProjectionChanged(cell: CPos): void {
    for (const cb of this.cellProjectionChanged) {
      cb(cell)
    }
  }

  // =========================================================================
  // ProjectedCellHeightInner
  // OpenRA 对照: Map.ProjectedCellHeightInner(PPos)
  // =========================================================================

  private _projectedCellHeightInner(puv: PPos): number {
    let current: PPos = puv
    while (this._inverseCellProjection!.contains(current.toMPos())) {
      const inverse = this._inverseCellProjection!.getMPos(current.toMPos())
      if (inverse.length > 0) {
        const temp = inverse.reduce((a, b) => (a.V > b.V ? a : b))
        const h = this.height.getMPos(temp)
        const tileInfo = this.terrainInfo.getTerrainInfo(this.tiles.getMPos(temp))
        return Math.min(255, Math.max(0, h - tileInfo.height)) & 0xff
      }
      current = new PPos(current.U, current.V + 1)
    }
    return 0
  }

  // =========================================================================
  // ProjectCellInner
  // OpenRA 对照: Map.ProjectCellInner(MPos)
  // =========================================================================

  private _projectCellInner(uv: MPos): PPos[] {
    if (!this.height.contains(uv)) return []

    let h = this.height.getMPos(uv)
    if (h === 0) return [PPos.fromMPos(uv)]

    // Odd-height ramps get bumped up a level to the next even height layer
    if ((h & 1) === 1 && this.ramp.getMPos(uv) !== 0) {
      h++
    }

    const candidates: PPos[] = []

    // Odd-height level tiles are equally covered by four projected tiles
    if ((h & 1) === 1) {
      if ((uv.V & 1) === 1) {
        candidates.push(new PPos(uv.U + 1, uv.V - h))
      } else {
        candidates.push(new PPos(uv.U - 1, uv.V - h))
      }

      candidates.push(new PPos(uv.U, uv.V - h))
      candidates.push(new PPos(uv.U, uv.V - h + 1))
      candidates.push(new PPos(uv.U, uv.V - h - 1))
    } else {
      candidates.push(new PPos(uv.U, uv.V - h))
    }

    return candidates.filter((c) => this.height.contains(c.toMPos()))
  }

  // =========================================================================
  // ProjectedCellsCovering
  // OpenRA 对照: Map.ProjectedCellsCovering(MPos)
  // =========================================================================

  /**
   * Get the array of projected cells that cover the given map cell.
   *
   * OpenRA 对照: Map.ProjectedCellsCovering(MPos)
   *
   * @param uv — map cell position
   * @returns projected cells covering this map cell (empty if none)
   */
  projectedCellsCovering(uv: MPos): readonly PPos[] {
    if (!this._initializedCellProjection) {
      this._initializeCellProjection()
    }

    if (!this._cellProjection!.contains(uv)) return NO_PROJECTED_CELLS
    return this._cellProjection!.getMPos(uv)
  }

  // =========================================================================
  // Unproject
  // OpenRA 对照: Map.Unproject(PPos)
  // =========================================================================

  /**
   * Get the list of map cells that cover a given projected cell.
   *
   * OpenRA 对照: Map.Unproject(PPos)
   *
   * @param puv — projected cell position
   * @returns list of map cells covering this projected cell
   */
  unproject(puv: PPos): readonly MPos[] {
    if (!this._initializedCellProjection) {
      this._initializeCellProjection()
    }

    const uv = puv.toMPos()
    if (!this._inverseCellProjection!.contains(uv)) return []
    return this._inverseCellProjection!.getMPos(uv)
  }

  // =========================================================================
  // ProjectedHeight
  // OpenRA 对照: Map.ProjectedHeight(PPos)
  // =========================================================================

  /**
   * Get the projected height at a projected cell position.
   *
   * OpenRA 对照: Map.ProjectedHeight(PPos)
   */
  projectedHeight(puv: PPos): number {
    if (this.grid.maximumTerrainHeight === 0) return 0
    if (!this._initializedCellProjection) {
      this._initializeCellProjection()
    }
    return this._projectedHeight!.getMPos(puv.toMPos())
  }

  // =========================================================================
  // Contains
  // OpenRA 对照: Map.Contains overloads
  // =========================================================================

  /**
   * Check whether a cell position is within the playable map area.
   *
   * OpenRA 对照: Map.Contains(CPos)
   */
  contains(cell: CPos): boolean
  /**
   * Check whether a map position is within the playable map area.
   *
   * OpenRA 对照: Map.Contains(MPos)
   */
  contains(uv: MPos): boolean
  /**
   * Check whether a projected position is within the playable map area.
   *
   * OpenRA 对照: Map.Contains(PPos)
   */
  contains(puv: PPos): boolean
  contains(cellOrUVOrPUV: CPos | MPos | PPos): boolean {
    if (cellOrUVOrPUV instanceof CPos) {
      const cell = cellOrUVOrPUV
      if (this.grid.type === MapGridType.RectangularIsometric) {
        if (cell.X < cell.Y) return false
      } else {
        if (this.grid.maximumTerrainHeight === 0) {
          return this.bounds.contains(cell.X, cell.Y)
        }
      }
      return this.contains(cell.toMPos(this.grid.type))
    }

    if (cellOrUVOrPUV instanceof PPos) {
      const puv = cellOrUVOrPUV
      return this.bounds.contains(puv.U, puv.V)
    }

    const uv = cellOrUVOrPUV as MPos
    // First check ensures within valid map region
    if (!this.customTerrain.contains(uv)) return false
    // Then check the projected containment
    return this._containsAllProjectedCellsCovering(uv)
  }

  /**
   * Check whether all projected cells covering a map cell are in bounds.
   *
   * OpenRA 对照: Map.ContainsAllProjectedCellsCovering(MPos)
   */
  private _containsAllProjectedCellsCovering(uv: MPos): boolean {
    if (this.grid.maximumTerrainHeight === 0) {
      return this.bounds.contains(uv.U, uv.V)
    }

    // Fast path: most cells lie within projectionSafeBounds
    if (this._projectionSafeBounds && this._projectionSafeBounds.contains(uv.U, uv.V)) {
      return true
    }

    // Slow path: check actual projected cells
    const projectedCells = this.projectedCellsCovering(uv)
    if (projectedCells.length === 0) return false

    for (const puv of projectedCells) {
      if (!this.contains(puv)) return false
    }
    return true
  }

  // =========================================================================
  // CenterOfCell
  // OpenRA 对照: Map.CenterOfCell(CPos)
  // =========================================================================

  /**
   * Get the world position of the center of a cell.
   *
   * OpenRA 对照: Map.CenterOfCell(CPos)
   *
   * Rectangular: (1024*X + 512, 1024*Y + 512, 0)
   * Isometric:   (724*(X - Y + 1), 724*(X + Y + 1), z) where
   *              z = 724*height + ramp.CenterHeightOffset
   *
   * @param cell — cell position
   * @returns world position of the cell center
   */
  centerOfCell(cell: CPos): WPos {
    if (this.grid.type === MapGridType.Rectangular) {
      return new WPos(1024 * cell.X + 512, 1024 * cell.Y + 512, 0)
    }

    // Isometric: 512 * sqrt(2) = 724
    const heightVal = this.height.tryGetValue(cell)
    const rampVal = this.ramp.get(cell)
    const z =
      heightVal !== null
        ? 724 * heightVal + this.grid.ramps[rampVal].centerHeightOffset
        : 0
    return new WPos(724 * (cell.X - cell.Y + 1), 724 * (cell.X + cell.Y + 1), z)
  }

  // =========================================================================
  // CenterOfSubCell
  // OpenRA 对照: Map.CenterOfSubCell(CPos, SubCell)
  // =========================================================================

  /**
   * Get the world position of a sub-cell within a cell.
   *
   * OpenRA 对照: Map.CenterOfSubCell(CPos, SubCell)
   */
  centerOfSubCell(cell: CPos, subCell: number): WPos {
    const index = subCell
    if (index >= 0 && index < this.grid.subCellOffsets.length) {
      const center = this.centerOfCell(cell)
      let offset = this.grid.subCellOffsets[index]
      const rampVal = this.ramp.tryGetValue(cell)
      if (rampVal !== null && rampVal !== 0) {
        const r = this.grid.ramps[rampVal]
        offset = new WVec(
          offset.X,
          offset.Y,
          offset.Z + r.heightOffset(offset.X, offset.Y) - r.centerHeightOffset,
        )
      }
      return WPos.add(center, offset)
    }
    return this.centerOfCell(cell)
  }

  // =========================================================================
  // DistanceAboveTerrain
  // OpenRA 对照: Map.DistanceAboveTerrain(WPos)
  // =========================================================================

  /**
   * Compute the distance of a position above the terrain surface.
   *
   * OpenRA 对照: Map.DistanceAboveTerrain(WPos)
   */
  distanceAboveTerrain(pos: WPos): WDist {
    if (this.grid.type === MapGridType.Rectangular) {
      return new WDist(pos.Z)
    }

    const cell = this.cellContaining(pos)
    const offset = WPos.subtract(pos, this.centerOfCell(cell))
    const rampVal = this.ramp.tryGetValue(cell)

    if (rampVal !== null && rampVal !== 0) {
      const r = this.grid.ramps[rampVal]
      return new WDist(
        offset.Z + r.centerHeightOffset - r.heightOffset(offset.X, offset.Y),
      )
    }

    return new WDist(offset.Z)
  }

  // =========================================================================
  // TerrainOrientation
  // OpenRA 对照: Map.TerrainOrientation(CPos)
  // =========================================================================

  /**
   * Get the terrain orientation (ramp rotation) at a cell.
   *
   * OpenRA 对照: Map.TerrainOrientation(CPos)
   */
  terrainOrientation(cell: CPos): WRot {
    const rampVal = this.ramp.tryGetValue(cell)
    if (rampVal !== null) {
      return this.grid.ramps[rampVal].orientation
    }
    return WRot.None
  }

  // =========================================================================
  // Offset
  // OpenRA 对照: Map.Offset(CVec, int)
  // =========================================================================

  /**
   * Convert a cell-space delta to a world-space vector.
   *
   * OpenRA 对照: Map.Offset(CVec, int)
   */
  offset(delta: CVec, dz: number): WVec {
    if (this.grid.type === MapGridType.Rectangular) {
      return new WVec(1024 * delta.X, 1024 * delta.Y, 0)
    }
    return new WVec(724 * (delta.X - delta.Y), 724 * (delta.X + delta.Y), 724 * dz)
  }

  /**
   * The size of one map height step in world units.
   *
   * OpenRA 对照: Map.CellHeightStep
   */
  get cellHeightStep(): WDist {
    return new WDist(this.grid.type === MapGridType.RectangularIsometric ? 724 : 512)
  }

  // =========================================================================
  // CellContaining
  // OpenRA 对照: Map.CellContaining(WPos)
  // =========================================================================

  /**
   * Find the cell containing a world position.
   *
   * OpenRA 对照: Map.CellContaining(WPos)
   *
   * Rectangular: CPos(X/1024, Y/1024) — integer division
   * Isometric:   CPos((Y+X-724)/1448, (Y-X+(Y>X?724:-724))/1448)
   */
  cellContaining(pos: WPos): CPos {
    if (this.grid.type === MapGridType.Rectangular) {
      return new CPos((pos.X / 1024) | 0, (pos.Y / 1024) | 0)
    }

    // Isometric: convert world→cell using rotated axes with rounding adjustment
    const u = ((pos.Y + pos.X - 724) / 1448) | 0
    const v = ((pos.Y - pos.X + (pos.Y > pos.X ? 724 : -724)) / 1448) | 0
    return new CPos(u, v)
  }

  // =========================================================================
  // ProjectedCellCovering
  // OpenRA 对照: Map.ProjectedCellCovering(WPos)
  // =========================================================================

  /**
   * Get the projected cell covering a world position.
   *
   * OpenRA 对照: Map.ProjectedCellCovering(WPos)
   */
  projectedCellCovering(pos: WPos): PPos {
    const projectedPos = WPos.subtractVec(pos, new WVec(0, pos.Z, pos.Z))
    return PPos.fromMPos(this.cellContaining(projectedPos).toMPos(this.grid.type))
  }

  // =========================================================================
  // FacingBetween
  // OpenRA 对照: Map.FacingBetween(CPos, CPos, WAngle)
  // =========================================================================

  /**
   * Compute the facing (yaw) from one cell to another.
   *
   * OpenRA 对照: Map.FacingBetween(CPos, CPos, WAngle)
   */
  facingBetween(cell: CPos, towards: CPos, fallbackFacing: WAngle): WAngle {
    const delta = WPos.subtract(this.centerOfCell(towards), this.centerOfCell(cell))
    if (delta.horizontalLengthSquared === 0) return fallbackFacing
    return delta.yaw
  }

  // =========================================================================
  // Resize
  // OpenRA 对照: Map.Resize(int, int)
  // =========================================================================

  /**
   * Resize the map. Preserves existing data in the overlapping region.
   *
   * OpenRA 对照: Map.Resize(int width, int height)
   */
  resize(width: number, height: number): void {
    const oldMapTiles = this.tiles
    const oldMapResources = this.resources
    const oldMapHeight = this.height
    const oldMapRamp = this.ramp

    this.mapSize = { width, height }
    this.tiles = CellLayer.resize(oldMapTiles, this.mapSize, oldMapTiles.getMPos(MPos.Zero))
    this.resources = CellLayer.resize(oldMapResources, this.mapSize, oldMapResources.getMPos(MPos.Zero))
    this.height = CellLayer.resize(oldMapHeight, this.mapSize, oldMapHeight.getMPos(MPos.Zero))
    this.ramp = CellLayer.resize(oldMapRamp, this.mapSize, oldMapRamp.getMPos(MPos.Zero))

    const tl = new MPos(0, 0)
    const br = new MPos(width - 1, height - 1)
    this.allCells = new CellRegion(
      this.grid.type,
      tl.toCPos(this.grid.type),
      br.toCPos(this.grid.type),
    )
    this._setBounds(new PPos(tl.U + 1, tl.V + 1), new PPos(br.U - 1, br.V - 1))
  }

  // =========================================================================
  // SetBounds
  // OpenRA 对照: Map.SetBounds(PPos, PPos)
  // =========================================================================

  /**
   * Set the playable area bounds and compute derived projection data.
   *
   * OpenRA 对照: Map.SetBounds(PPos tl, PPos br)
   *
   * @param tl — inclusive top-left corner in projected coordinates
   * @param br — inclusive bottom-right corner in projected coordinates
   */
  private _setBounds(tl: PPos, br: PPos): void {
    // Bounds are exclusive on the right/bottom edges
    this.bounds = Rectangle.fromLTRB(tl.U, tl.V, br.U + 1, br.V + 1)

    // Compute projectionSafeBounds — fast-path check for most cells
    let maxHeight = this.grid.maximumTerrainHeight
    if ((maxHeight & 1) === 1) maxHeight += 2
    this._projectionSafeBounds = Rectangle.fromLTRB(
      this.bounds.Left + 1,
      this.bounds.Top + maxHeight,
      this.bounds.Right - 1,
      this.bounds.Bottom,
    )

    // Compute projected map corners in world units
    if (this.grid.type === MapGridType.RectangularIsometric) {
      this.projectedTopLeft = new WPos(tl.U * 1448, tl.V * 724, 0)
      this.projectedBottomRight = new WPos(br.U * 1448 - 1, (br.V + 1) * 724 - 1, 0)
    } else {
      this.projectedTopLeft = new WPos(tl.U * 1024, tl.V * 1024, 0)
      this.projectedBottomRight = new WPos(br.U * 1024 - 1, (br.V + 1) * 1024 - 1, 0)
    }

    // PERF: this enumeration won't change during the game
    const gridConfig: GridConfig = {
      gridType: this.grid.type,
      maximumTerrainHeight: this.grid.maximumTerrainHeight,
    }
    this.projectedCells = Array.from(
      new ProjectedCellRegion(gridConfig, this.mapSize, tl, br),
    )
  }

  // =========================================================================
  // GetTerrainIndex
  // OpenRA 对照: Map.GetTerrainIndex(CPos) / Map.GetTerrainIndex(MPos)
  // =========================================================================

  /**
   * Get the terrain type index for a cell (with lazy-on-demand cache).
   *
   * OpenRA 对照: Map.GetTerrainIndex(CPos)
   */
  getTerrainIndex(cell: CPos): number {
    return this._getTerrainIndexMPos(cell.toMPos(this.grid.type))
  }

  /** Get the terrain type index for a map position.
   *
   * OpenRA 对照: Map.GetTerrainIndex(MPos)
   */
  private _getTerrainIndexMPos(uv: MPos): number {
    if (!this._cachedTerrainIndexes) {
      this._cachedTerrainIndexes = new CellLayer<number>(this.grid.type, this.mapSize)
      this._cachedTerrainIndexes.clear(INVALID_CACHED_TERRAIN_INDEX)
    }

    let terrainIndex = this._cachedTerrainIndexes.getMPos(uv)

    if (terrainIndex === INVALID_CACHED_TERRAIN_INDEX) {
      const custom = this.customTerrain.getMPos(uv)
      terrainIndex =
        custom !== 0xff
          ? custom
          : this.terrainInfo.getTerrainIndex(this.tiles.getMPos(uv))
      this._cachedTerrainIndexes.setMPos(uv, terrainIndex)
    }

    return terrainIndex
  }

  // =========================================================================
  // GetTerrainInfo
  // OpenRA 对照: Map.GetTerrainInfo(CPos) / Map.GetTerrainInfo(MPos)
  // =========================================================================

  /**
   * Get the terrain type info for a cell.
   *
   * OpenRA 对照: Map.GetTerrainInfo(CPos)
   */
  getTerrainInfo(cell: CPos): TerrainTypeInfo {
    return this._getTerrainInfoMPos(cell.toMPos(this.grid.type))
  }

  /** Get the terrain type info for a map position.
   *
   * OpenRA 对照: Map.GetTerrainInfo(MPos)
   */
  private _getTerrainInfoMPos(uv: MPos): TerrainTypeInfo {
    return this.terrainInfo.terrainTypes[this._getTerrainIndexMPos(uv)]
  }

  // =========================================================================
  // Clamp
  // OpenRA 对照: Map.Clamp(CPos) / Map.Clamp(MPos) / Map.Clamp(PPos)
  // =========================================================================

  /**
   * Clamp a cell position to within the playable map area.
   *
   * OpenRA 对照: Map.Clamp(CPos)
   */
  clamp(cell: CPos): CPos {
    return this._clampMPos(cell.toMPos(this.grid.type)).toCPos(this.grid.type)
  }

  /**
   * Clamp a map position to within the playable map area.
   *
   * OpenRA 对照: Map.Clamp(MPos)
   */
  private _clampMPos(uv: MPos): MPos {
    if (this.grid.maximumTerrainHeight === 0) {
      return this._clampPPos(PPos.fromMPos(uv)).toMPos()
    }

    // Already in bounds
    if (this._containsAllProjectedCellsCovering(uv)) return uv

    // Three nasty cases handled:
    // 1. Cell well outside map region
    // 2. Cell near top edge inside map but outside projected layer
    // 3. Clamped projected cell lands on cliff face with no associated map cell

    if (!this._cellProjection) {
      this._initializeCellProjection()
    }

    // Clamp U coordinate and ensure point is inside the map
    const clampedU = Math.min(
      this.bounds.Right,
      Math.max(uv.U, this.bounds.Left),
    )
    const guess = this._cellProjection!.clampMPos(new MPos(clampedU, uv.V))

    // Project and get first available cell
    const allProjected = this.projectedCellsCovering(guess)
    let projected: PPos
    if (allProjected.length > 0) {
      projected = allProjected[0]
    } else {
      projected = new PPos(
        guess.U,
        Math.min(this.bounds.Bottom, Math.max(guess.V, this.bounds.Top)),
      )
    }

    projected = this._clampPPos(projected)

    // Unproject back to map coordinates
    let unProjected = this.unproject(projected)
    if (unProjected.length === 0) {
      // V-search: oscillating pattern around projected.V
      for (let x = 2; x <= 2 * this.grid.maximumTerrainHeight; x++) {
        const dv = ((x & 1) === 1 ? 1 : -1) * Math.trunc(x / 2)
        const test = new PPos(projected.U, projected.V + dv)
        if (!this.contains(test)) continue

        unProjected = this.unproject(test)
        if (unProjected.length > 0) break
      }

      if (unProjected.length === 0) {
        // Shouldn't happen — return original value
        console.debug(`Failed to clamp map cell ${uv.toString()} to map bounds`)
        return uv
      }
    }

    return projected.V === this.bounds.Bottom
      ? unProjected.reduce((a, b) => (a.V > b.V ? a : b))
      : unProjected.reduce((a, b) => (a.V < b.V ? a : b))
  }

  /**
   * Clamp a projected position to the map bounds.
   *
   * OpenRA 对照: Map.Clamp(PPos)
   */
  private _clampPPos(puv: PPos): PPos {
    const clampRect = new Rectangle(
      this.bounds.X,
      this.bounds.Y,
      this.bounds.Width - 1,
      this.bounds.Height - 1,
    )
    return puv.clamp(clampRect)
  }

  // =========================================================================
  // ChooseRandomCell
  // OpenRA 对照: Map.ChooseRandomCell(MersenneTwister)
  // =========================================================================

  /**
   * Choose a random cell within the playable area via rejection sampling.
   *
   * OpenRA 对照: Map.ChooseRandomCell(MersenneTwister)
   *
   * @param randInt — random integer generator: (min, max) => int in [min, max)
   * @param randSelect — random array selector: (arr) => random element
   */
  chooseRandomCell(
    randInt: (min: number, max: number) => number,
    randSelect: <T>(arr: readonly T[]) => T,
  ): CPos {
    let cells: readonly MPos[]
    do {
      const u = randInt(this.bounds.Left, this.bounds.Right)
      const v = randInt(this.bounds.Top, this.bounds.Bottom)
      cells = this.unproject(new PPos(u, v))
    } while (cells.length === 0)

    return randSelect(cells).toCPos(this.grid.type)
  }

  // =========================================================================
  // ChooseClosestEdgeCell
  // OpenRA 对照: Map.ChooseClosestEdgeCell(CPos) / Map.ChooseClosestEdgeCell(MPos)
  // =========================================================================

  /**
   * Choose the closest edge cell to the given cell.
   *
   * OpenRA 对照: Map.ChooseClosestEdgeCell(CPos)
   */
  chooseClosestEdgeCell(cell: CPos): CPos {
    return this._chooseClosestEdgeCellMPos(cell.toMPos(this.grid.type)).toCPos(
      this.grid.type,
    )
  }

  private _chooseClosestEdgeCellMPos(uv: MPos): MPos {
    // For flat maps, pick closest edge directly from the playable bounds
    if (this.grid.maximumTerrainHeight === 0) {
      const horizontalBound =
        uv.U - this.bounds.Left < this.bounds.Width / 2
          ? this.bounds.Left
          : this.bounds.Right - 1
      const verticalBound =
        uv.V - this.bounds.Top < this.bounds.Height / 2
          ? this.bounds.Top
          : this.bounds.Bottom - 1

      const du = Math.abs(horizontalBound - uv.U)
      const dv = Math.abs(verticalBound - uv.V)

      if (du < dv) {
        return new MPos(horizontalBound, uv.V)
      }
      return new MPos(uv.U, verticalBound)
    }

    const allProjected = this.projectedCellsCovering(uv)

    let edge: PPos
    if (allProjected.length > 0) {
      const puv = allProjected[0]
      const horizontalBound =
        puv.U - this.bounds.Left < this.bounds.Width / 2
          ? this.bounds.Left
          : this.bounds.Right
      const verticalBound =
        puv.V - this.bounds.Top < this.bounds.Height / 2
          ? this.bounds.Top
          : this.bounds.Bottom

      const du = Math.abs(horizontalBound - puv.U)
      const dv = Math.abs(verticalBound - puv.V)

      edge =
        du < dv
          ? new PPos(horizontalBound, puv.V)
          : new PPos(puv.U, verticalBound)
    } else {
      edge = new PPos(this.bounds.Left, this.bounds.Top)
    }

    let unProjected = this.unproject(edge)
    if (unProjected.length === 0) {
      for (let x = 2; x <= 2 * this.grid.maximumTerrainHeight; x++) {
        const dv = ((x & 1) === 1 ? 1 : -1) * Math.trunc(x / 2)
        const test = new PPos(edge.U, edge.V + dv)
        if (!this.contains(test)) continue

        unProjected = this.unproject(test)
        if (unProjected.length > 0) break
      }

      if (unProjected.length === 0) {
        console.debug(
          `Failed to find closest edge for map cell ${uv.toString()}`,
        )
        return uv
      }
    }

    return edge.V === this.bounds.Bottom
      ? unProjected.reduce((a, b) => (a.V > b.V ? a : b))
      : unProjected.reduce((a, b) => (a.V < b.V ? a : b))
  }

  // =========================================================================
  // ChooseClosestMatchingEdgeCell
  // OpenRA 对照: Map.ChooseClosestMatchingEdgeCell(CPos, Func<CPos, bool>)
  // =========================================================================

  /**
   * Choose the closest edge cell matching a predicate.
   *
   * OpenRA 对照: Map.ChooseClosestMatchingEdgeCell
   */
  chooseClosestMatchingEdgeCell(
    cell: CPos,
    match: (c: CPos) => boolean,
  ): CPos | undefined {
    const sorted = this.allEdgeCells
      .map((c) => ({ cell: c, dist: CPos.subtract(cell, c).lengthSquared }))
      .sort((a, b) => a.dist - b.dist)

    for (const { cell: c } of sorted) {
      if (match(c)) return c
    }
    return undefined
  }

  // =========================================================================
  // UpdateEdgeCells
  // OpenRA 对照: Map.UpdateEdgeCells()
  // =========================================================================

  private _updateEdgeCells(): CPos[] {
    const edgeCells: CPos[] = []
    const bottom = this.bounds.Bottom - 1

    // Top and bottom edges
    for (let u = this.bounds.Left; u < this.bounds.Right; u++) {
      let unProjected = this.unproject(new PPos(u, this.bounds.Top))
      if (unProjected.length > 0) {
        edgeCells.push(
          unProjected.reduce((a, b) => (a.V < b.V ? a : b)).toCPos(this.grid.type),
        )
      }

      unProjected = this.unproject(new PPos(u, bottom))
      if (unProjected.length > 0) {
        edgeCells.push(
          unProjected.reduce((a, b) => (a.V > b.V ? a : b)).toCPos(this.grid.type),
        )
      }
    }

    // Left and right edges
    for (let v = this.bounds.Top; v < this.bounds.Bottom; v++) {
      let unProjected = this.unproject(new PPos(this.bounds.Left, v))
      if (unProjected.length > 0) {
        const best =
          v === bottom
            ? unProjected.reduce((a, b) => (a.V > b.V ? a : b))
            : unProjected.reduce((a, b) => (a.V < b.V ? a : b))
        edgeCells.push(best.toCPos(this.grid.type))
      }

      unProjected = this.unproject(new PPos(this.bounds.Right - 1, v))
      if (unProjected.length > 0) {
        const best =
          v === bottom
            ? unProjected.reduce((a, b) => (a.V > b.V ? a : b))
            : unProjected.reduce((a, b) => (a.V < b.V ? a : b))
        edgeCells.push(best.toCPos(this.grid.type))
      }
    }

    return edgeCells
  }

  // =========================================================================
  // ChooseRandomEdgeCell
  // OpenRA 对照: Map.ChooseRandomEdgeCell(MersenneTwister)
  // =========================================================================

  /**
   * Choose a random cell from the map edges.
   *
   * OpenRA 对照: Map.ChooseRandomEdgeCell
   *
   * @param randSelect — random array selector: (arr) => random element
   */
  chooseRandomEdgeCell(randSelect: <T>(arr: readonly T[]) => T): CPos {
    return randSelect(this.allEdgeCells)
  }

  // =========================================================================
  // DistanceToEdge
  // OpenRA 对照: Map.DistanceToEdge(WPos, WVec)
  // =========================================================================

  /**
   * Compute the distance from a position to the map edge in a given direction.
   *
   * OpenRA 对照: Map.DistanceToEdge(WPos, in WVec)
   */
  distanceToEdge(pos: WPos, dir: WVec): WDist {
    const projectedPos = WPos.subtractVec(pos, new WVec(0, pos.Z, pos.Z))
    const x =
      dir.X === 0
        ? Number.MAX_SAFE_INTEGER
        : Math.trunc(
            ((dir.X < 0
              ? this.projectedTopLeft.X
              : this.projectedBottomRight.X) -
              projectedPos.X) /
              dir.X,
          )
    const y =
      dir.Y === 0
        ? Number.MAX_SAFE_INTEGER
        : Math.trunc(
            ((dir.Y < 0
              ? this.projectedTopLeft.Y
              : this.projectedBottomRight.Y) -
              projectedPos.Y) /
              dir.Y,
          )
    return new WDist(Math.min(x, y) * dir.length)
  }

  // =========================================================================
  // FindTilesInAnnulus / FindTilesInCircle
  // OpenRA 对照: Map.FindTilesInAnnulus / Map.FindTilesInCircle
  // =========================================================================

  /**
   * Find all cells within an annular (ring) region around a center.
   *
   * OpenRA 对照: Map.FindTilesInAnnulus(CPos, int, int, bool)
   *
   * Both ranges are inclusive. Results sorted by distance from center.
   *
   * @param center — center cell
   * @param minRange — minimum distance (inclusive)
   * @param maxRange — maximum distance (inclusive)
   * @param allowOutsideBounds — include cells outside map bounds
   */
  findTilesInAnnulus(
    center: CPos,
    minRange: number,
    maxRange: number,
    allowOutsideBounds = false,
  ): CPos[] {
    if (maxRange < minRange) {
      throw new Error('Maximum range is less than the minimum range.')
    }

    if (maxRange >= this.grid.tilesByDistance.length) {
      throw new Error(
        `The requested range (${maxRange}) cannot exceed the value of ` +
          `MaximumTileSearchRange (${this.grid.maximumTileSearchRange})`,
      )
    }

    const result: CPos[] = []
    for (let i = minRange; i <= maxRange; i++) {
      for (const offset of this.grid.tilesByDistance[i]) {
        const t = CPos.add(center, offset)
        if (allowOutsideBounds ? this.tiles.contains(t) : this.contains(t)) {
          result.push(t)
        }
      }
    }
    return result
  }

  /**
   * Find all cells within a circular region around a center.
   *
   * OpenRA 对照: Map.FindTilesInCircle(CPos, int, bool)
   */
  findTilesInCircle(
    center: CPos,
    maxRange: number,
    allowOutsideBounds = false,
  ): CPos[] {
    return this.findTilesInAnnulus(center, 0, maxRange, allowOutsideBounds)
  }

  // =========================================================================
  // GetCellSpaceBounds
  // OpenRA 对照: Map.GetCellSpaceBounds()
  // =========================================================================

  /**
   * Get the top/bottom V coordinates of the map bounds in cell space.
   *
   * OpenRA 对照: Map.GetCellSpaceBounds()
   *
   * Used for minimap rendering. Unprojects PPos bounds to find MPos boundaries.
   */
  getCellSpaceBounds(): { top: number; bottom: number } {
    let top = Number.MAX_SAFE_INTEGER
    let bottom = Number.MIN_SAFE_INTEGER

    for (let x = this.bounds.Left; x < this.bounds.Right; x++) {
      const allTop = this.unproject(new PPos(x, this.bounds.Top))
      if (allTop.length > 0) {
        top = Math.min(top, allTop.reduce((a, b) => (a.V < b.V ? a : b)).V)
      }

      const allBottom = this.unproject(new PPos(x, this.bounds.Bottom))
      if (allBottom.length > 0) {
        bottom = Math.max(
          bottom,
          allBottom.reduce((a, b) => (a.V > b.V ? a : b)).V,
        )
      }
    }

    return { top, bottom }
  }

  // =========================================================================
  // SaveBinaryData
  // OpenRA 对照: Map.SaveBinaryData()
  // =========================================================================

  /**
   * Serialize the map data to binary format (map.bin).
   *
   * OpenRA 对照: Map.SaveBinaryData()
   *
   * Format 2 (17-byte header):
   *   uint8 format, uint16 width, uint16 height,
   *   uint32 tilesOffset, uint32 heightsOffset, uint32 resourcesOffset
   * Then: tile data (w*h*3 bytes), height data (w*h*1 byte), resource data (w*h*2 bytes)
   *
   * @returns ArrayBuffer containing the binary map data
   */
  saveBinaryData(): ArrayBuffer {
    const w = this.mapSize.width
    const h = this.mapSize.height
    const hasHeight = this.grid.maximumTerrainHeight > 0

    const layout = computeBinaryDataLayout(w, h, hasHeight)
    const buffer = new ArrayBuffer(layout.totalSize)
    const data = new DataView(buffer)
    let pos = writeBinaryDataHeader(data, 0, this.tileFormat, w, h, layout)

    // Tile data (column-major)
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        const tile = this.tiles.getMPos(new MPos(i, j))
        data.setUint16(pos, tile.type, true); pos += 2
        data.setUint8(pos++, tile.index)
      }
    }

    // Height data (column-major, only if hasHeight)
    if (hasHeight) {
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
          data.setUint8(pos++, this.height.getMPos(new MPos(i, j)))
        }
      }
    }

    // Resource data (column-major)
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        const res = this.resources.getMPos(new MPos(i, j))
        data.setUint8(pos++, res.type)
        data.setUint8(pos++, res.index)
      }
    }

    return buffer
  }

  // =========================================================================
  // toJSON
  // OpenRA 对照: Map.Save(IReadWritePackage) — JSON adaptation
  // =========================================================================

  /**
   * Serialize the map to a JSON-serializable object.
   *
   * OpenRA 对照: Map.Save(IReadWritePackage) + map.yaml serialization
   *
   * Binary data (tiles, resources, height) is base64-encoded for JSON embedding.
   */
  toJSON(): Record<string, unknown> {
    // Serialize binary data as base64
    const binaryBuffer = this.saveBinaryData()
    const binaryBase64 = this._arrayBufferToBase64(binaryBuffer)

    return {
      mapFormat: this.mapFormat,
      requiresMod: this.requiresMod,
      title: this.title,
      author: this.author,
      tileset: this.tileset,
      lockPreview: this.lockPreview,
      bounds: {
        left: this.bounds.Left,
        top: this.bounds.Top,
        right: this.bounds.Right,
        bottom: this.bounds.Bottom,
      },
      visibility: this.visibility,
      categories: this.categories,
      mapSize: { width: this.mapSize.width, height: this.mapSize.height },
      binaryData: binaryBase64,
      gridType: this.grid.type,
      maximumTerrainHeight: this.grid.maximumTerrainHeight,
    }
  }

  /**
   * Convert an ArrayBuffer to a base64 string.
   */
  private _arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!)
    }
    // Use btoa (browser) or Node/Bun fallback
    if (typeof btoa !== 'undefined') {
      return btoa(binary)
    }
    // Node/Bun: import { Buffer } from 'buffer' not available at top-level.
    // Fall back to manual base64 encoding.
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let result = ''
    for (let i = 0; i < bytes.length; i += 3) {
      const b1 = bytes[i]!
      const b2 = bytes[i + 1] ?? 0
      const b3 = bytes[i + 2] ?? 0
      result += chars.charAt(b1 >> 2)
      result += chars.charAt(((b1 & 3) << 4) | (b2 >> 4))
      result += i + 1 < bytes.length ? chars.charAt(((b2 & 15) << 2) | (b3 >> 6)) : '='
      result += i + 2 < bytes.length ? chars.charAt(b3 & 63) : '='
    }
    return result
  }

  // =========================================================================
  // GetTerrainColorPair
  // OpenRA 对照: Map.GetTerrainColorPair(MPos)
  // =========================================================================

  /**
   * Get a randomised terrain color pair for a map cell, used by the radar
   * minimap for terrain coloring.
   *
   * OpenRA 对照: Map.GetTerrainColorPair(MPos)
   *
   * Each cell generates two slightly different colours (left and right) via
   * the terrain type's colour range. Height-based brightness scaling is
   * applied when min/max brightness differ from 1.0.
   *
   * @param uv — map cell position
   * @returns [leftColor, rightColor] as ARGB uint32 values
   */
  getTerrainColorPair(uv: MPos): [number, number] {
    const tile = this.tiles.getMPos(uv)
    const info = this.terrainInfo.getTerrainInfo(tile)
    let left = info.getColor(Math.random())   // CosmeticRandom = non-sync visual RNG
    let right = info.getColor(Math.random())

    const minBright = this.terrainInfo.minHeightColorBrightness ?? 1.0
    const maxBright = this.terrainInfo.maxHeightColorBrightness ?? 1.0
    if (minBright !== 1.0 || maxBright !== 1.0) {
      const maxH = this.grid.maximumTerrainHeight
      const t = maxH > 0 ? this.height.getMPos(uv) / maxH : 0
      const scale = minBright + (maxBright - minBright) * t
      left = scaleColorArgb(left, scale)
      right = scaleColorArgb(right, scale)
    }
    return [left, right]
  }

  // =========================================================================
  // Dispose
  // OpenRA 对照: Map.Dispose()
  // =========================================================================

  /**
   * Clean up resources held by this map.
   *
   * OpenRA 对照: Map.Dispose()
   *
   * Unregisters all CellEntryChanged observers.
   * CellLayer data is garbage collected automatically (no GPU resources).
   */
  dispose(): void {
    // Unregister observers from tiles
    if (this._boundUpdateRamp) {
      this.tiles.offCellEntryChanged(this._boundUpdateRamp)
      this._boundUpdateRamp = null
    }
    if (this._boundUpdateProjection) {
      this.tiles.offCellEntryChanged(this._boundUpdateProjection)
      this._boundUpdateProjection = null
    }
    if (this._boundHeightUpdateProjection) {
      this.height.offCellEntryChanged(this._boundHeightUpdateProjection)
      this._boundHeightUpdateProjection = null
    }
    if (this._boundInvalidateTerrainIndex) {
      this.customTerrain.offCellEntryChanged(this._boundInvalidateTerrainIndex)
      this.tiles.offCellEntryChanged(this._boundInvalidateTerrainIndex)
      this._boundInvalidateTerrainIndex = null
    }

    // Clear callback arrays
    this.cellProjectionChanged.length = 0
    this.replacedInvalidTerrainTiles.clear()

    // Null out internal projection layers
    this._cellProjection = null
    this._inverseCellProjection = null
    this._projectedHeight = null
    this._cachedTerrainIndexes = null
    this._initializedCellProjection = false
    this._projectionSafeBounds = null
  }
}

// ---------------------------------------------------------------------------
// scaleColorArgb — helper for GetTerrainColorPair
// ---------------------------------------------------------------------------

/**
 * Scale the RGB components of an ARGB uint32 colour by a brightness factor.
 *
 * OpenRA 对照: Color.FromArgb((int)(scale * left.R).Clamp(0, 255), ...)
 *
 * Alpha is left unchanged. The clamped result is clamped to 0-255 per channel.
 *
 * @param argb — ARGB uint32 colour
 * @param scale — brightness scale factor (1.0 = unchanged)
 * @returns scaled ARGB uint32
 */
function scaleColorArgb(argb: number, scale: number): number {
  const r = Math.min(255, Math.trunc(((argb >> 16) & 0xff) * scale))
  const g = Math.min(255, Math.trunc(((argb >> 8) & 0xff) * scale))
  const b = Math.min(255, Math.trunc((argb & 0xff) * scale))
  const a = (argb >> 24) & 0xff
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0
}
