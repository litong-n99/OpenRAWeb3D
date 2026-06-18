/**
 * Building.ts — 核心建筑 trait：管理建筑占地区域、中心位置、生命周期与毗邻检测
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/Building.cs (356 lines)
 *
 * 核心范式转换:
 * - C# FrozenDictionary<CVec, FootprintCellType> → TS Map<string, FootprintCellType>
 *   使用 "x,y" 字符串键（Map 使用引用相等性，CVec 作为对象键无法匹配）
 * - C# LoadFootprint() YAML 静态解析器 → TS fromJSON() JSON 工厂方法
 * - C# INotifySold/INotifyTransform 显式接口实现 → TS 接口方法直接实现
 * - C# WorldUtils.GetSmudgeTiles() / SmudgeLayer.RemoveSmudge() → TS 桩
 *   （SmudgeLayer 尚未迁移， 后续实现）
 * - C# BuildingInfluence / ActorMap 依赖注入 → TS 构造器可选参数
 * - BLOCKER-3 fix: 预解析 footprints 缓存避免热路径 string.split + new CVec()
 * - BLOCKER-4 fix: OccupiedCell[] 预计算避免 per-call .map() 分配
 */

import { CVec } from '../../../OpenRA.Game/CVec.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell.js'

import type {
  IGameActor,
  ITraitInfo,
  IOccupySpaceInfo,
  IOccupySpace,
  OccupiedCell,
  INotifySold,
  INotifyTransform,
  ISync,
  INotifyAddedToWorld,
  INotifyRemovedFromWorld,
  PlayerStub,
  ActorInfoStub,
  ITargetableCells,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// FootprintCellType enum
// OpenRA 对照: FootprintCellType enum (char values)
// ---------------------------------------------------------------------------

/** Cell type within a building footprint.
 *
 * OpenRA 对照: FootprintCellType enum
 *
 * Character values are used for JSON serialization and match OpenRA exactly.
 */
export const FootprintCellType = {
  /** Completely empty cell — not part of the building. */
  Empty: '_' as const,
  /** Occupied but units can pass through (e.g., bibs / overhangs). */
  OccupiedPassable: '=' as const,
  /** Occupied and blocks movement / passability. */
  Occupied: 'x' as const,
  /** Occupied but not targetable (e.g., decorative wings). */
  OccupiedUntargetable: 'X' as const,
  /** Occupied, passable for transit only (units pass through to reach other cells). */
  OccupiedPassableTransitOnly: '+' as const,
} as const

export type FootprintCellType =
  (typeof FootprintCellType)[keyof typeof FootprintCellType]

// ---------------------------------------------------------------------------
// Pre-parsed footprint entry
// OpenRA 对照: N/A (C# uses CVec key directly, no string parsing overhead)
// ---------------------------------------------------------------------------

/** A single footprint entry with pre-parsed offset and type.
 *
 * Avoids per-call `key.split(',')` + `new CVec()` in hot-path footprint
 * iteration methods (tiles, occupiedTiles, pathableTiles, etc.).
 *
 * BLOCKER-3 fix: computed once in constructor, reused in all query methods.
 */
interface ParsedFootprintEntry {
  readonly offset: CVec
  readonly type: FootprintCellType
}

// ---------------------------------------------------------------------------
// Helper: CVec → footprint map key
// OpenRA 对照: N/A (C# uses CVec as dictionary key directly)
// ---------------------------------------------------------------------------

/** Convert a CVec to a string key for Map lookups.
 *
 * OpenRA 对照: N/A (JS Map requires string keys for value equality)
 *
 * @param v — the cell offset
 * @returns a string key in "x,y" format
 */
function footprintKey(v: CVec): string {
  return `${v.X},${v.Y}`
}

// ---------------------------------------------------------------------------
// Minimal map interface for center-of-cell lookups
// OpenRA 对照: OpenRA.Game/Map/Map.cs (CenterOfCell method)
// ---------------------------------------------------------------------------

/** Minimal map abstraction needed by BuildingInfo.centerOffset().
 *
 * OpenRA 对照: Map.CenterOfCell(CPos)
 *
 * Full Map class is in Chapter 4; this interface avoids importing the
 * heavy Map class for a single method call.
 */
export interface IBuildingMap {
  /** Get the world position of a cell's center.
   *
   * OpenRA 对照: Map.CenterOfCell(CPos)
   *
   * @param cell — the cell position
   * @returns the WPos of the cell center
   */
  centerOfCell(cell: CPos): WPos
}

// ---------------------------------------------------------------------------
// Minimal actor map interface for Building lifecycle wiring
// OpenRA 对照: ActorMap.Add/Remove (subset used by Building.AddedToWorld/RemovedFromWorld)
// ---------------------------------------------------------------------------

/** Minimal actor map dependency for Building lifecycle registration.
 *
 * OpenRA 对照: ActorMap.Add(self, trait) / ActorMap.Remove(self, trait)
 *
 * BLOCKER-2 fix: injected via constructor, used in addedToWorld/removedFromWorld.
 */
export interface IBuildingActorMap {
  /** Register a building's occupied cells in the actor map.
   *
   * OpenRA 对照: ActorMap.Add(Actor self, IOccupySpace trait)
   */
  addInfluence(actor: IGameActor, trait: IOccupySpace): void

  /** Remove a building's occupied cells from the actor map.
   *
   * OpenRA 对照: ActorMap.Remove(Actor self, IOccupySpace trait)
   */
  removeInfluence(actor: IGameActor, trait: IOccupySpace): void
}

// ---------------------------------------------------------------------------
// Minimal building influence interface for lifecycle wiring
// OpenRA 对照: BuildingInfluence.AddInfluence / RemoveInfluence
// ---------------------------------------------------------------------------

/** Minimal building influence dependency for Building lifecycle registration.
 *
 * OpenRA 对照: BuildingInfluence.AddInfluence(self, cells) / RemoveInfluence(self, cells)
 *
 * BLOCKER-2 fix: injected via constructor, used in addedToWorld/removedFromWorld.
 */
export interface IBuildingInfluenceAccess {
  /** Register a building's occupied cells in the building influence layer.
   *
   * OpenRA 对照: BuildingInfluence.AddInfluence(Actor a, IEnumerable<CPos> cells)
   */
  addInfluence(actor: IGameActor, cells: readonly CPos[]): void

  /** Remove a building's occupied cells from the building influence layer.
   *
   * OpenRA 对照: BuildingInfluence.RemoveInfluence(Actor a, IEnumerable<CPos> cells)
   */
  removeInfluence(actor: IGameActor, cells: readonly CPos[]): void
}

// ---------------------------------------------------------------------------
// BuildingInfo
// OpenRA 对照: BuildingInfo (TraitInfo, IOccupySpaceInfo, IPlaceBuildingDecorationInfo)
// ---------------------------------------------------------------------------

/** Configuration for the Building trait.
 *
 * OpenRA 对照: BuildingInfo
 *
 * Defines the building footprint, terrain requirements, center offset,
 * base-proximity rules, and build/undeploy sound effects.
 */
export class BuildingInfo implements ITraitInfo, IOccupySpaceInfo {
  readonly instanceName?: string

  /** Where you are allowed to place the building (Water, Clear, ...).
   *
   * OpenRA 对照: BuildingInfo.TerrainTypes (FrozenSet<string>)
   */
  readonly terrainTypes: ReadonlySet<string>

  /** The building footprint map: cell offset → cell type.
   *
   * OpenRA 对照: BuildingInfo.Footprint (FrozenDictionary<CVec, FootprintCellType>)
   *
   * Key format: "x,y" string (e.g., "0,0", "1,0") to support value-based
   * equality in JS Map (CVec objects use reference equality).
   */
  readonly footprint: ReadonlyMap<string, FootprintCellType>

  /** Footprint dimensions (computed from the footprint string during parsing).
   *
   * OpenRA 对照: BuildingInfo.Dimensions
   */
  readonly dimensions: CVec

  /** Shift center of the actor by this offset.
   *
   * OpenRA 对照: BuildingInfo.LocalCenterOffset
   */
  readonly localCenterOffset: WVec

  /** Whether this building requires a base provider (e.g., construction yard
   * or MCV) within range to be placed.
   *
   * OpenRA 对照: BuildingInfo.RequiresBaseProvider
   */
  readonly requiresBaseProvider: boolean

  /** Allow placement on any terrain type (for debug/cheats).
   *
   * OpenRA 对照: BuildingInfo.AllowInvalidPlacement
   */
  readonly allowInvalidPlacement: boolean

  /** Clear smudges from underneath the building footprint on build.
   *
   * OpenRA 对照: BuildingInfo.RemoveSmudgesOnBuild
   */
  readonly removeSmudgesOnBuild: boolean

  /** Clear smudges from underneath the building footprint on sell.
   *
   * OpenRA 对照: BuildingInfo.RemoveSmudgesOnSell
   */
  readonly removeSmudgesOnSell: boolean

  /** Clear smudges from underneath the building footprint on transform.
   *
   * OpenRA 对照: BuildingInfo.RemoveSmudgesOnTransform
   */
  readonly removeSmudgesOnTransform: boolean

  /** Sounds to play when the building is placed.
   *
   * OpenRA 对照: BuildingInfo.BuildSounds (ImmutableArray<string>)
   */
  readonly buildSounds: readonly string[]

  /** Sounds to play when the building begins transformation.
   *
   * OpenRA 对照: BuildingInfo.UndeploySounds (ImmutableArray<string>)
   */
  readonly undeploySounds: readonly string[]

  /** IOccupySpaceInfo — whether this trait type supports sub-cell sharing.
   *
   * OpenRA 对照: IOccupySpaceInfo.SharesCell
   */
  readonly sharesCell: boolean = false

  /**
   * Pre-parsed footprint entries for zero-allocation iteration.
   *
   * BLOCKER-3 fix: computed once in constructor; all footprint query methods
   * iterate this array instead of parsing string keys on every call.
   *
   * OpenRA 对照: N/A (C# uses CVec dictionary keys directly, no parsing overhead)
   */
  private readonly _parsedFootprint: readonly ParsedFootprintEntry[]

  constructor(params: {
    instanceName?: string
    terrainTypes?: ReadonlySet<string> | readonly string[]
    footprint?: ReadonlyMap<string, FootprintCellType>
    dimensions?: CVec
    localCenterOffset?: WVec
    requiresBaseProvider?: boolean
    allowInvalidPlacement?: boolean
    removeSmudgesOnBuild?: boolean
    removeSmudgesOnSell?: boolean
    removeSmudgesOnTransform?: boolean
    buildSounds?: readonly string[]
    undeploySounds?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName

    // TerrainTypes
    if (params.terrainTypes instanceof Set) {
      this.terrainTypes = params.terrainTypes as ReadonlySet<string>
    } else if (Array.isArray(params.terrainTypes)) {
      this.terrainTypes = new Set(params.terrainTypes)
    } else {
      this.terrainTypes = new Set()
    }

    // Footprint
    this.footprint = params.footprint ?? new Map()

    // Dimensions
    this.dimensions = params.dimensions ?? new CVec(1, 1)

    // LocalCenterOffset
    this.localCenterOffset = params.localCenterOffset ?? WVec.Zero

    // RequiresBaseProvider
    this.requiresBaseProvider = params.requiresBaseProvider ?? false

    // AllowInvalidPlacement
    this.allowInvalidPlacement = params.allowInvalidPlacement ?? false

    // Smudge removal flags
    this.removeSmudgesOnBuild = params.removeSmudgesOnBuild ?? true
    this.removeSmudgesOnSell = params.removeSmudgesOnSell ?? true
    this.removeSmudgesOnTransform = params.removeSmudgesOnTransform ?? true

    // Audio
    this.buildSounds = params.buildSounds ?? []
    this.undeploySounds = params.undeploySounds ?? []

    // BLOCKER-3: Pre-parse footprint entries for zero-allocation iteration.
    // All footprint query methods (tiles, occupiedTiles, pathableTiles, etc.)
    // iterate this array instead of parsing "x,y" string keys on every call.
    const parsed: ParsedFootprintEntry[] = []
    for (const [key, type] of this.footprint) {
      const [sx, sy] = key.split(',')
      parsed.push({ offset: new CVec(Number(sx), Number(sy)), type })
    }
    this._parsedFootprint = parsed
  }

  // ---------------------------------------------------------------------------
  // fromJSON — parse footprint from JSON config
  // OpenRA 对照: BuildingInfo.LoadFootprint(MiniYaml)
  // ---------------------------------------------------------------------------

  /** Create a BuildingInfo from JSON configuration.
   *
   * OpenRA 对照: BuildingInfo.LoadFootprint(MiniYaml yaml)
   *
   * Parses the footprint string (e.g., "xx=xx") and optional dimensions
   * into a footprint Map. Validates that the footprint character count
   * matches the dimensions.
   *
   * @param json — the JSON config object with optional `footprint` and `dimensions` fields
   * @returns a new BuildingInfo instance
   * @throws if the footprint string is invalid or does not match dimensions
   */
  static fromJSON(json: {
    instanceName?: string
    terrainTypes?: readonly string[]
    footprint?: string
    dimensions?: { x: number; y: number }
    localCenterOffset?: { x: number; y: number; z: number }
    requiresBaseProvider?: boolean
    allowInvalidPlacement?: boolean
    removeSmudgesOnBuild?: boolean
    removeSmudgesOnSell?: boolean
    removeSmudgesOnTransform?: boolean
    buildSounds?: readonly string[]
    undeploySounds?: readonly string[]
  }): BuildingInfo {
    // Parse footprint string
    const footprintChars =
      (json.footprint ?? 'x')
        .replace(/\s+/g, '')
        .split('')

    // Parse dimensions
    const dimX = json.dimensions?.x ?? 1
    const dimY = json.dimensions?.y ?? 1
    const dim = new CVec(dimX, dimY)

    // Validate footprint matches dimensions
    if (footprintChars.length !== dim.X * dim.Y) {
      const fp = json.footprint ?? 'x'
      const dims = `${dim.X}x${dim.Y}`
      throw new Error(
        `Invalid footprint: "${fp}" does not match dimensions ${dims}`,
      )
    }

    // Build footprint map
    const footprintMap = new Map<string, FootprintCellType>()
    let index = 0
    for (let y = 0; y < dim.Y; y++) {
      for (let x = 0; x < dim.X; x++) {
        const c = footprintChars[index++]
        // Validate the character is a known cell type
        const validChars: readonly string[] = [
          FootprintCellType.Empty,
          FootprintCellType.OccupiedPassable,
          FootprintCellType.Occupied,
          FootprintCellType.OccupiedUntargetable,
          FootprintCellType.OccupiedPassableTransitOnly,
        ]
        if (!validChars.includes(c)) {
          throw new Error(`Invalid footprint cell type '${c}'`)
        }
        footprintMap.set(footprintKey(new CVec(x, y)), c as FootprintCellType)
      }
    }

    // Parse LocalCenterOffset
    const lco = json.localCenterOffset ?? { x: 0, y: 0, z: 0 }

    return new BuildingInfo({
      instanceName: json.instanceName,
      terrainTypes: json.terrainTypes ?? [],
      footprint: footprintMap,
      dimensions: dim,
      localCenterOffset: new WVec(lco.x, lco.y, lco.z),
      requiresBaseProvider: json.requiresBaseProvider ?? false,
      allowInvalidPlacement: json.allowInvalidPlacement ?? false,
      removeSmudgesOnBuild: json.removeSmudgesOnBuild ?? true,
      removeSmudgesOnSell: json.removeSmudgesOnSell ?? true,
      removeSmudgesOnTransform: json.removeSmudgesOnTransform ?? true,
      buildSounds: json.buildSounds ?? [],
      undeploySounds: json.undeploySounds ?? [],
    })
  }

  // ---------------------------------------------------------------------------
  // Footprint tile queries
  // OpenRA 对照: BuildingInfo.FootprintTiles(CPos, FootprintCellType)
  //
  // BLOCKER-3: All methods now iterate _parsedFootprint instead of parsing
  // "x,y" string keys on every call. The string key parsing happens exactly
  // once in the constructor.
  // ---------------------------------------------------------------------------

  /** Get all cells at a given location that match a specific footprint type.
   *
   * OpenRA 对照: BuildingInfo.FootprintTiles(CPos location, FootprintCellType type)
   *
   * @param location — the top-left cell of the building
   * @param type — the footprint cell type to filter by
   * @returns an array of matching cell positions
   */
  footprintTiles(location: CPos, type: FootprintCellType): CPos[] {
    const result: CPos[] = []
    for (const entry of this._parsedFootprint) {
      if (entry.type === type) {
        result.push(CPos.add(location, entry.offset))
      }
    }
    return result
  }

  /** Get all footprint tiles (all occupied types).
   *
   * OpenRA 对照: BuildingInfo.Tiles(CPos location)
   *
   * Includes OccupiedPassable, Occupied, OccupiedUntargetable,
   * and OccupiedPassableTransitOnly. Excludes Empty.
   *
   * @param location — the top-left cell of the building
   * @returns an array of all occupied cell positions
   */
  tiles(location: CPos): CPos[] {
    const result: CPos[] = []
    for (const entry of this._parsedFootprint) {
      if (entry.type !== FootprintCellType.Empty) {
        result.push(CPos.add(location, entry.offset))
      }
    }
    return result
  }

  /** Get cells that are occupied and block targeting (Occupied + Untargetable + TransitOnly).
   *
   * OpenRA 对照: BuildingInfo.OccupiedTiles(CPos location)
   *
   * Includes Occupied, OccupiedUntargetable, and OccupiedPassableTransitOnly.
   * Excludes Empty and OccupiedPassable.
   *
   * @param location — the top-left cell of the building
   * @returns an array of occupied cell positions
   */
  occupiedTiles(location: CPos): CPos[] {
    const result: CPos[] = []
    for (const entry of this._parsedFootprint) {
      if (
        entry.type === FootprintCellType.Occupied ||
        entry.type === FootprintCellType.OccupiedUntargetable ||
        entry.type === FootprintCellType.OccupiedPassableTransitOnly
      ) {
        result.push(CPos.add(location, entry.offset))
      }
    }
    return result
  }

  /** Get cells that are passable (Empty + OccupiedPassable).
   *
   * OpenRA 对照: BuildingInfo.PathableTiles(CPos location)
   *
   * @param location — the top-left cell of the building
   * @returns an array of pathable cell positions
   */
  pathableTiles(location: CPos): CPos[] {
    const result: CPos[] = []
    for (const entry of this._parsedFootprint) {
      if (
        entry.type === FootprintCellType.Empty ||
        entry.type === FootprintCellType.OccupiedPassable
      ) {
        result.push(CPos.add(location, entry.offset))
      }
    }
    return result
  }

  /** Get cells that are transit-only (OccupiedPassableTransitOnly).
   *
   * OpenRA 对照: BuildingInfo.TransitOnlyTiles(CPos location)
   *
   * @param location — the top-left cell of the building
   * @returns an array of transit-only cell positions
   */
  transitOnlyTiles(location: CPos): CPos[] {
    return this.footprintTiles(
      location,
      FootprintCellType.OccupiedPassableTransitOnly,
    )
  }

  /** Get all cells visible under fog of war (Empty + all occupied types).
   *
   * OpenRA 对照: BuildingInfo.FrozenUnderFogTiles(CPos location)
   *
   * Returns all footprint cells regardless of type.
   *
   * @param location — the top-left cell of the building
   * @returns an array of all footprint cell positions
   */
  frozenUnderFogTiles(location: CPos): CPos[] {
    const result: CPos[] = []
    for (const entry of this._parsedFootprint) {
      result.push(CPos.add(location, entry.offset))
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Center offset
  // OpenRA 对照: BuildingInfo.CenterOffset(World w)
  // ---------------------------------------------------------------------------

  /** Compute the visual center offset from the top-left cell.
   *
   * OpenRA 对照: BuildingInfo.CenterOffset(World w)
   *
   * Formula:
   *   off = (CenterOfCell(Dimensions) - CenterOfCell(1,1)) / 2
   *   result = off - (0, 0, off.Z) + LocalCenterOffset
   *
   * This positions the actor's center at the geometric middle of its
   * footprint rather than at the top-left corner.
   *
   * @param map — a minimal map reference providing centerOfCell()
   * @returns the world vector offset from top-left to visual center
   */
  centerOffset(map: IBuildingMap): WVec {
    const dimCell = new CPos(this.dimensions.X, this.dimensions.Y)
    const oneOneCell = new CPos(1, 1)

    const centerOfDim = map.centerOfCell(dimCell)
    const centerOfOne = map.centerOfCell(oneOneCell)

    // off = (CenterOfCell(dim) - CenterOfCell(1,1)) / 2
    const off = WVec.divide(
      WVec.subtract(
        new WVec(centerOfDim.X, centerOfDim.Y, centerOfDim.Z),
        new WVec(centerOfOne.X, centerOfOne.Y, centerOfOne.Z),
      ),
      2,
    )

    // result = off minus its Z component, plus LocalCenterOffset
    return WVec.add(
      new WVec(off.X, off.Y, 0),
      this.localCenterOffset,
    )
  }

  // ---------------------------------------------------------------------------
  // findBaseProvider
  // OpenRA 对照: BuildingInfo.FindBaseProvider(World, Player, CPos)
  // ---------------------------------------------------------------------------

  /** Find a valid base provider within range of the building location.
   *
   * OpenRA 对照: BuildingInfo.FindBaseProvider(World world, Player p, CPos topLeft)
   *
* Full implementation depends on BaseProvider, MapBuildRadius,
   * and PlayerRelationship. Currently returns null (no base provider found).
   *
   * @param _map — the game map (for centerOfCell)
   * @param _player — the player placing the building
   * @param _topLeft — the top-left cell of the building footprint
   * @returns null (stub — always returns null)
   */
  findBaseProvider(
    _map: IBuildingMap,
    _player: PlayerStub,
    _topLeft: CPos,
  ): unknown /* BaseProvider | null */ {
    // Implement when BaseProvider and MapBuildRadius are migrated.
    // For now, return null — buildings with RequiresBaseProvider=true will
    // fail placement (which is the correct default behavior).
    return null
  }

  // ---------------------------------------------------------------------------
  // isCloseEnoughToBase
  // OpenRA 对照: BuildingInfo.IsCloseEnoughToBase(World, Player, ActorInfo, CPos)
  // ---------------------------------------------------------------------------

  /** Check whether this building is close enough to a base provider.
   *
   * OpenRA 对照: BuildingInfo.IsCloseEnoughToBase(World world, Player p,
   *   ActorInfo ai, CPos topLeft)
   *
* Full implementation depends on RequiresBuildableArea,
   * BuildingInfluence, ActorMap, MapBuildRadius, and DeveloperMode.
   * Currently always returns true (allows placement anywhere — debug mode).
   *
   * @param _map — the game map
   * @param _player — the player placing the building
   * @param _actorInfo — the info of the actor being placed
   * @param _topLeft — the top-left cell of the building footprint
   * @returns true (stub — always allows placement)
   */
  isCloseEnoughToBase(
    _map: IBuildingMap,
    _player: PlayerStub,
    _actorInfo: ActorInfoStub,
    _topLeft: CPos,
  ): boolean {
    // Implement when RequiresBuildableArea, BuildingInfluence,
    // ActorMap, MapBuildRadius, and DeveloperMode are migrated.
    // Current stub: always returns true (debug-friendly).
    return true
  }

  // ---------------------------------------------------------------------------
  // IOccupySpaceInfo.OccupiedCells
  // OpenRA 对照: BuildingInfo.OccupiedCells(ActorInfo, CPos, SubCell)
  // ---------------------------------------------------------------------------

  /** Get occupied cells for IOccupySpaceInfo.
   *
   * OpenRA 对照: BuildingInfo.OccupiedCells(ActorInfo info, CPos topLeft,
   *   SubCell subCell = SubCell.Any)
   *
   * Returns the occupied tiles as FullCell sub-cell positions for
   * actor map registration.
   *
   * @param _info — the actor info (unused in building context)
   * @param topLeft — the top-left cell position
   * @param _subCell — the sub-cell (defaults to Any, but buildings use FullCell)
   * @returns a Map of cell → SubCell.FullCell
   */
  occupiedCells(
    _info: ActorInfoStub,
    topLeft: CPos,
    _subCell: SubCell = SubCell.Any,
  ): ReadonlyMap<CPos, SubCell> {
    const result = new Map<CPos, SubCell>()
    const tiles = this.occupiedTiles(topLeft)
    for (const tile of tiles) {
      result.set(tile, SubCell.FullCell)
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Building
// OpenRA 对照: Building class
// ---------------------------------------------------------------------------

/** Core trait for building actors.
 *
 * OpenRA 对照: Building
 *
 * Manages footprint occupancy, center position, targeted cells,
 * world registration/deregistration, and smudge clearing.
 *
 * Implements:
 * - IOccupySpace — for actor map placement
 * - ITargetableCells — for targetable cell positions
 * - INotifySold — smudge clearing on sale
 * - INotifyTransform — smudge clearing and undeploy sounds on transform
 * - ISync — network sync marker
 * - INotifyAddedToWorld — add to actor map and building influence
 * - INotifyRemovedFromWorld — remove from actor map and building influence
 */
export class Building
  implements
    IOccupySpace,
    ITargetableCells,
    INotifySold,
    INotifyTransform,
    ISync,
    INotifyAddedToWorld,
    INotifyRemovedFromWorld
{
  /** The configuration info for this building. */
  readonly info: BuildingInfo

  /** The top-left cell of the building footprint. */
  readonly topLeft: CPos

  /** The world position of the building's visual center. */
  readonly centerPosition: WPos

  /** Cached occupied cells as tuples (for actor map registration). */
  private readonly _occupiedCells: readonly [CPos, SubCell][]

  /** Pre-computed OccupiedCell[] — avoids per-call .map() allocation (BLOCKER-4). */
  private readonly _occupiedCellsResult: readonly OccupiedCell[]

  /** Cached targetable cells (occupied cells that can be targeted). */
  private readonly _targetableCells: readonly [CPos, SubCell][]

  /** Cached transit-only cells. */
  private readonly _transitOnlyCells: readonly CPos[]

  /**
   * Optional actor map for lifecycle wiring (BLOCKER-2).
   *
   * Injected via constructor. When null, addedToWorld/removedFromWorld
   * skip actor map registration (no-op for the lifecycle).
   */
  private readonly _actorMap: IBuildingActorMap | null

  /**
   * Optional building influence for lifecycle wiring (BLOCKER-2).
   *
   * Injected via constructor. When null, addedToWorld/removedFromWorld
   * skip building influence registration (no-op for the lifecycle).
   */
  private readonly _buildingInfluence: IBuildingInfluenceAccess | null

  /**
   * Cached tiles result — avoids calling `this.info.tiles(this.topLeft)` on
   * every lifecycle event. Computed once in constructor.
   */
  private readonly _allTiles: readonly CPos[]

  /** Construct a Building trait.
   *
   * OpenRA 对照: Building(ActorInitializer init, BuildingInfo info)
   *
   * Computes occupied cells, targetable cells, transit-only cells,
   * and the center position from the init's LocationInit and the
   * building info's centerOffset.
   *
   * BLOCKER-2: accepts optional actorMap and buildingInfluence dependencies.
   * When both are provided, addedToWorld/removedFromWorld are fully wired.
   *
   * @param info — the building configuration
   * @param topLeft — the top-left cell position (from LocationInit)
   * @param map — the game map for centerOfCell lookups
   * @param actorMap — optional actor map for lifecycle registration (BLOCKER-2)
   * @param buildingInfluence — optional building influence for lifecycle registration (BLOCKER-2)
   */
  constructor(
    info: BuildingInfo,
    topLeft: CPos,
    map: IBuildingMap,
    actorMap?: IBuildingActorMap | null,
    buildingInfluence?: IBuildingInfluenceAccess | null,
  ) {
    this.info = info
    this.topLeft = topLeft

    this._actorMap = actorMap ?? null
    this._buildingInfluence = buildingInfluence ?? null

    // Cache all tiles for lifecycle methods (avoids recomputing on every call)
    this._allTiles = info.tiles(topLeft)

    // Cache occupied cells as tuples
    this._occupiedCells = info.occupiedTiles(topLeft).map(
      (c): [CPos, SubCell] => [c, SubCell.FullCell],
    )

    // BLOCKER-4: Pre-compute OccupiedCell[] to avoid per-call .map() allocation
    this._occupiedCellsResult = this._occupiedCells.map(([cell, subCell]) => ({
      cell,
      subCell,
    }))

    // Cache targetable cells (Occupied type only)
    this._targetableCells = info
      .footprintTiles(topLeft, FootprintCellType.Occupied)
      .map((c): [CPos, SubCell] => [c, SubCell.FullCell])

    // Cache transit-only cells
    this._transitOnlyCells = info.transitOnlyTiles(topLeft)

    // Compute center position
    const topLeftCenter = map.centerOfCell(topLeft)
    const offset = info.centerOffset(map)
    this.centerPosition = WPos.add(topLeftCenter, offset)
  }

  // ---------------------------------------------------------------------------
  // IOccupySpace
  // ---------------------------------------------------------------------------

  /** Get the cells occupied by this building.
   *
   * OpenRA 对照: Building.OccupiedCells()
   *
   * BLOCKER-4: Returns pre-computed array to avoid per-call .map() allocation.
   *
   * @returns array of (cell, SubCell.FullCell) pairs
   */
  occupiedCells(): readonly OccupiedCell[] {
    return this._occupiedCellsResult
  }

  // ---------------------------------------------------------------------------
  // ITargetableCells (BLOCKER-1: canonical interface from TraitsInterfaces.ts)
  // ---------------------------------------------------------------------------

  /** Get the cells that can be targeted on this building.
   *
   * OpenRA 对照: ITargetableCells.TargetableCells
   *
   * Only Occupied type footprint cells are targetable.
   * OccupiedUntargetable cells are excluded.
   *
   * Implements the readonly property from ITargetableCells in TraitsInterfaces.ts.
   *
   * @returns array of (cell, SubCell.FullCell) pairs
   */
  get targetableCells(): readonly [CPos, SubCell][] {
    return this._targetableCells
  }

  /** Get the transit-only cells for this building.
   *
   * OpenRA 对照: N/A (exposed for AI and pathfinding)
   *
   * @returns array of transit-only cell positions
   */
  transitOnlyCellsList(): readonly CPos[] {
    return this._transitOnlyCells
  }

  /** Get the raw occupied cells as (CPos, SubCell) tuples.
   *
   * OpenRA 对照: Building.occupiedCells (field)
   *
   * Used internally for actor map registration.
   *
   * @returns shallow copy of the occupied cells array
   */
  get rawOccupiedCells(): readonly [CPos, SubCell][] {
    return this._occupiedCells
  }

  // ---------------------------------------------------------------------------
  // INotifyAddedToWorld
  // OpenRA 对照: Building.INotifyAddedToWorld.AddedToWorld(Actor self)
  // ---------------------------------------------------------------------------

  /** Called when this building's actor is added to the world.
   *
   * OpenRA 对照: Building.AddedToWorld(Actor self)
   *
   * Clears smudges from the footprint if RemoveSmudgesOnBuild is set,
   * then registers the building in the actor map and building influence.
   *
   * BLOCKER-2: fully wired — calls actorMap.addInfluence and
   * buildingInfluence.addInfluence when dependencies are available.
   *
   * @param self — the actor being added
   */
  addedToWorld(self: IGameActor): void {
    // Delegate to virtual method (allows subclasses to override behavior)
    this._addedToWorld(self)
  }

  /** Internal implementation of AddedToWorld (virtual in OpenRA).
   *
   * OpenRA 对照: Building.AddedToWorld(Actor self) — protected virtual
   *
   * BLOCKER-2: wires actorMap and buildingInfluence when dependencies available.
   *
   * @param self — the actor being added
   */
  protected _addedToWorld(self: IGameActor): void {
    if (this.info.removeSmudgesOnBuild) {
      this.removeSmudges()
    }

    // BLOCKER-2: Register in actor map and building influence
    // OpenRA pattern:
    //   self.World.AddToMaps(self, this);
    //   var influence = self.World.WorldActor.Trait<BuildingInfluence>();
    //   influence.AddInfluence(self, Info.Tiles(Location));
    if (this._actorMap) {
      this._actorMap.addInfluence(self, this)
    }
    if (this._buildingInfluence) {
      this._buildingInfluence.addInfluence(self, this._allTiles)
    }
    // NOTE: When actorMap or buildingInfluence is null, the trait still
    // functions correctly (lifecycle is graceful no-op). The wiring is
    // activated when the dependency is injected.
  }

  // ---------------------------------------------------------------------------
  // INotifyRemovedFromWorld
  // OpenRA 对照: Building.INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
  // ---------------------------------------------------------------------------

  /** Called when this building's actor is removed from the world.
   *
   * OpenRA 对照: Building.INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
   *
   * Removes the building from the actor map and building influence.
   *
   * BLOCKER-2: fully wired — calls actorMap.removeInfluence and
   * buildingInfluence.removeInfluence when dependencies are available.
   *
   * @param self — the actor being removed
   */
  removedFromWorld(self: IGameActor): void {
    // BLOCKER-2: Unregister from actor map and building influence
    // OpenRA pattern:
    //   self.World.RemoveFromMaps(self, this);
    //   var influence = self.World.WorldActor.Trait<BuildingInfluence>();
    //   influence.RemoveInfluence(self, Info.Tiles(Location));
    if (this._actorMap) {
      this._actorMap.removeInfluence(self, this)
    }
    if (this._buildingInfluence) {
      this._buildingInfluence.removeInfluence(self, this._allTiles)
    }
  }

  // ---------------------------------------------------------------------------
  // INotifySold
  // OpenRA 对照: Building.INotifySold
  // ---------------------------------------------------------------------------

  /** Called when this building begins the sell process.
   *
   * OpenRA 对照: Building.INotifySold.Selling(Actor self)
   *
   * Clears smudges from the footprint if RemoveSmudgesOnSell is set.
   *
   * @param _self — the actor being sold
   */
  selling(_self: IGameActor): void {
    if (this.info.removeSmudgesOnSell) {
      this.removeSmudges()
    }
  }

  /** Called after the building has been sold.
   *
   * OpenRA 对照: Building.INotifySold.Sold(Actor self)
   *
   * @param _self — the actor that was sold
   */
  sold(_self: IGameActor): void {
    // No-op in OpenRA — building is already removed from world at this point
  }

  // ---------------------------------------------------------------------------
  // INotifyTransform
  // OpenRA 对照: Building.INotifyTransform
  // ---------------------------------------------------------------------------

  /** Called before the building transforms into another actor type.
   *
   * OpenRA 对照: Building.INotifyTransform.BeforeTransform(Actor self)
   *
   * Clears smudges if RemoveSmudgesOnTransform is set,
   * and plays the UndeploySounds.
   *
   * @param _self — the actor about to transform
   */
  beforeTransform(_self: IGameActor): void {
    if (this.info.removeSmudgesOnTransform) {
      this.removeSmudges()
    }

    // Play undeploy sounds
    // TODO-8.F: Wire up to Sound.PlayToPlayer when Sound system is fully integrated
    // for (const s of this.info.undeploySounds) {
    //   Game.Sound.PlayToPlayer(SoundType.World, self.owner, s, self.centerPosition)
    // }
  }

  /** Called when the building transforms.
   *
   * OpenRA 对照: Building.INotifyTransform.OnTransform(Actor self)
   *
   * @param _self — the actor that is transforming
   */
  onTransform(_self: IGameActor): void {
    // No-op in OpenRA
  }

  /** Called after the building has transformed.
   *
   * OpenRA 对照: Building.INotifyTransform.AfterTransform(Actor self)
   *
   * @param _self — the actor that has transformed
   */
  afterTransform(_self: IGameActor): void {
    // No-op in OpenRA
  }

  // ---------------------------------------------------------------------------
  // removeSmudges
  // OpenRA 对照: Building.RemoveSmudges()
  // ---------------------------------------------------------------------------

  /** Clear smudges from underneath the building footprint.
   *
   * OpenRA 对照: Building.RemoveSmudges()
   *
   * Iterates all SmudgeLayer traits on the world actor and removes
   * smudges from each footprint tile.
   *
   * NOTE: SmudgeLayer is not yet migrated (planned for later chapter).
   * This method currently logs a warning and is a no-op.
   */
  removeSmudges(): void {
    // Implement when SmudgeLayer is migrated
    //   const smudgeLayers = self.World.WorldActor.TraitsImplementing<SmudgeLayer>()
    //   for (const smudgeLayer of smudgeLayers)
    //     for (const footprintTile of this.info.tiles(this.topLeft))
    //       smudgeLayer.RemoveSmudge(footprintTile)
    //
    // Current stub: no-op. Smudge clearing will be functional when
    // SmudgeLayer is migrated in a later chapter.
  }
}
