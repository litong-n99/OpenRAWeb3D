/**
 * Locomotor.ts — Locomotion system for movement, blocking, and terrain cost
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/Locomotor.cs
 *
 * 核心范式转换:
 * - C# class LocomotorInfo + Locomotor → TypeScript class + interface
 * - C# FrozenDictionary<string, TerrainInfo> → Map<string, TerrainInfo>
 * - C# short return types → number (TypeScript has no short)
 * - C# Flags enum → TypeScript const enum with bitwise helper functions
 * - C# LongBitSet<PlayerBitMask> → LongBitSet<PlayerBitMask>
 * - C# event Action<CPos, short, short> → Set of callbacks (observer pattern)
 * - C# record struct CellCache → readonly TypeScript class
 * - C# HashSet<CPos> dirty cells → Set<number> keyed by CPos.Bits
 * - C# PerfSample → removed (not applicable to TypeScript)
 */

import type { CPos } from '../../../OpenRA.Game/CPos'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import { PlayerRelationship } from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import type { BlockedByActor } from '../BlockedByActor'
import type { SubCell as SubCellType } from '../../../OpenRA.Game/Traits/SubCell'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import type { LongBitSet } from '../../../OpenRA.Game/Primitives/LongBitSet'

// ---------------------------------------------------------------------------
// Forward type tag for PlayerBitMask (avoid circular import from Player.ts)
// ---------------------------------------------------------------------------

/**
 * Marker interface used as the type tag for LongBitSet<PlayerBitMask>.
 *
 * OpenRA 对照: public class PlayerBitMask { }
 *
 * NOTE: This mirrors Player.ts PlayerBitMask. We define a local copy to
 * avoid a circular dependency between Locomotor and Player.
 */
export interface PlayerBitMask {
  // intentionally empty — marker
}

// PLAYER_BITMASK_TYPENAME is used by LongBitSet allocator in Player.ts
// (not directly referenced in this file)

// ---------------------------------------------------------------------------
// CellFlag enum
// ---------------------------------------------------------------------------

/**
 * Flags describing the blocking state of a map cell.
 *
 * OpenRA 对照: CellFlag (Flags enum : byte)
 *
 * Values are powers of 2 for bitwise OR combination.
 *
 * NOTE: Uses const object instead of enum for erasableSyntaxOnly compatibility.
 */
export const CellFlag = {
  HasFreeSpace: 0,
  HasMovingActor: 1,
  HasStationaryActor: 2,
  HasMovableActor: 4,
  HasCrushableActor: 8,
  HasTemporaryBlocker: 16,
  HasTransitOnlyActor: 32,
} as const

/** Type for CellFlag values. */
export type CellFlag = (typeof CellFlag)[keyof typeof CellFlag]

/**
 * Check if a CellFlag value has a specific flag set.
 *
 * OpenRA 对照: LocomoterExts.HasCellFlag(CellFlag, CellFlag)
 *
 * PERF: Enum.HasFlag is slower and requires allocations in C#; bitwise AND
 * is the same in TypeScript.
 */
export function hasCellFlag(c: number, cellFlag: CellFlag): boolean {
  return (c & cellFlag) === cellFlag
}

// ---------------------------------------------------------------------------
// CustomMovementLayerType constants
// ---------------------------------------------------------------------------

/**
 * Constants for custom movement layer types.
 *
 * OpenRA 对照: CustomMovementLayerType static class
 */
export const CustomMovementLayerType = {
  Tunnel: 1,
  Subterranean: 2,
  Jumpjet: 3,
  ElevatedBridge: 4,
} as const

// ---------------------------------------------------------------------------
// MovementType enum
// ---------------------------------------------------------------------------

/**
 * Flags describing the type of movement an actor is currently performing.
 *
 * OpenRA 对照: MovementType (Flags enum)
 *
 * NOTE: Uses const object instead of enum for erasableSyntaxOnly compatibility.
 */
export const MovementType = {
  None: 0,
  Horizontal: 1,
  Vertical: 2,
} as const

/** Type for MovementType values. */
export type MovementType = (typeof MovementType)[keyof typeof MovementType]

/**
 * Check if a MovementType value has a specific movement type flag set.
 *
 * OpenRA 对照: LocomoterExts.HasMovementType(MovementType, MovementType)
 */
export function hasMovementType(m: number, movementType: MovementType): boolean {
  return (m & movementType) === movementType
}

// ---------------------------------------------------------------------------
// Forward interfaces — contracts Locomotor needs from the world/map/actors
// ---------------------------------------------------------------------------

/**
 * Player contract needed by Locomotor for diplomacy checks.
 *
 * OpenRA 对照: Player (subset)
 */
export interface ILocomotorPlayer {
  readonly playerMask: LongBitSet<PlayerBitMask>
  readonly alliedPlayersMask: LongBitSet<PlayerBitMask>
  relationshipWith(other: ILocomotorPlayer): PlayerRelationship
}

/**
 * OccupiesSpace contract — Mobile/Building traits.
 *
 * OpenRA 对照: Mobile (subset for blocking checks)
 */
export interface ILocomotorOccupiesSpace {
  readonly isTraitDisabled: boolean
  readonly isTraitPaused: boolean
  readonly isImmovable: boolean
  readonly currentMovementTypes: MovementType
}

/**
 * Crushable contract for crush checks.
 *
 * OpenRA 对照: ICrushable (subset)
 */
export interface ILocomotorCrushable {
  /**
   * Returns the player mask of players whose actors can crush this crushable.
   *
   * OpenRA 对照: ICrushable.CrushableBy(Actor, BitSet<CrushClass>)
   *
   * @param actor — the crushable actor
   * @param crushClasses — set of crush class names the crusher has
   * @returns LongBitSet of players who can crush this actor
   */
  crushableByPlayerMask(
    actor: ILocomotorActor,
    crushClasses: ReadonlySet<string>,
  ): LongBitSet<PlayerBitMask>
}

/**
 * Actor contract needed by Locomotor for blocking/movement checks.
 *
 * OpenRA 对照: Actor (subset)
 */
export interface ILocomotorActor {
  readonly actorId: number
  readonly owner: ILocomotorPlayer
  readonly occupiesSpace: ILocomotorOccupiesSpace | null
  readonly crushables: readonly ILocomotorCrushable[]

  /**
   * Whether this actor has an ITemporaryBlocker trait.
   *
   * OpenRA 对照: actor.TraitOrDefault<ITemporaryBlocker>() != null
   */
  readonly hasTemporaryBlocker: boolean

  /**
   * If this actor is a temporary blocker, can it be removed by the given actor?
   *
   * OpenRA 对照: ITemporaryBlocker.CanRemoveBlockage(Actor, Actor)
   */
  temporaryBlockerCanRemove(blockingActor: ILocomotorActor, blockedActor: ILocomotorActor): boolean

  /**
   * Whether the given cell is transit-only for this actor (Building pattern).
   *
   * OpenRA 对照: Building.TransitOnlyCells().Contains(cell)
   */
  isTransitOnlyAt(cell: CPos): boolean
}

/**
 * Custom movement layer contract needed by Locomotor.
 *
 * OpenRA 对照: ICustomMovementLayer (subset for Locomotor)
 *
 * Extends the existing ICustomMovementLayer with getTerrainIndex.
 */
export interface ILocomotorCML {
  readonly Index: number
  getTerrainIndex(cell: CPos): number
}

/**
 * Actor map contract needed by Locomotor.
 *
 * OpenRA 对照: IActorMap (subset)
 */
export interface ILocomotorActorMap {
  getActorsAt(cell: CPos): readonly ILocomotorActor[]
  getActorsAt(cell: CPos, subCell: SubCellType): readonly ILocomotorActor[]
  anyActorsAt(cell: CPos, subCell: SubCellType): boolean
  anyActorsAt(
    cell: CPos,
    subCell: SubCellType,
    withCondition: (a: ILocomotorActor) => boolean,
  ): boolean
  hasFreeSubCell(cell: CPos): boolean
  freeSubCell(
    cell: CPos,
    preferredSubCell: SubCellType,
  ): SubCellType
  freeSubCell(
    cell: CPos,
    preferredSubCell: SubCellType,
    checkIfBlocker: (a: ILocomotorActor) => boolean,
  ): SubCellType
  onCellUpdated: ((c: CPos) => void) | null
}

/**
 * Cell entry changed observer source (tiles / custom terrain layers).
 *
 * OpenRA 对照: CellLayer<T>.CellEntryChanged
 */
export interface ICellEntryChangedSource {
  onCellEntryChanged(callback: (cell: CPos) => void): void
}

/**
 * Terrain type info from the map rules.
 *
 * OpenRA 对照: TerrainTypeInfo.Type
 */
export interface ILocomotorTerrainType {
  readonly Type: string
}

/**
 * Terrain info from the map rules.
 *
 * OpenRA 对照: ITerrainInfo.TerrainTypes
 */
export interface ILocomotorTerrainInfo {
  readonly TerrainTypes: readonly ILocomotorTerrainType[]
}

/**
 * Map contract needed by Locomotor.
 *
 * OpenRA 对照: Map (subset)
 */
export interface ILocomotorMap {
  contains(cell: CPos): boolean
  readonly grid: { readonly maximumTerrainHeight: number }
  readonly height: CellLayer<number>
  getTerrainIndex(cell: CPos): number
  readonly tiles: ICellEntryChangedSource
  readonly customTerrain: ICellEntryChangedSource
  readonly rules: { readonly terrainInfo: ILocomotorTerrainInfo }
  readonly mapSize: { readonly width: number; readonly height: number }
  readonly gridType: import('../../../OpenRA.Game/Map/MapGridType').MapGridType
  allCells(): Iterable<CPos>
}

/**
 * World contract needed by Locomotor.
 *
 * OpenRA 对照: World (subset)
 */
export interface ILocomotorWorld {
  readonly map: ILocomotorMap
  readonly actorMap: ILocomotorActorMap
  readonly allPlayersMask: LongBitSet<PlayerBitMask>
  readonly noPlayersMask: LongBitSet<PlayerBitMask>
  readonly rulesContainTemporaryBlocker: boolean
  getCustomMovementLayers(): readonly (ILocomotorCML | null)[]
}

/**
 * Unified actor parameter type for ILocomotor interface methods.
 *
 * Accepts both IGameActor (used by pathfinding code) and ILocomotorActor
 * (used by the real Locomotor class).
 */
export type LocomotorActorParam = ILocomotorActor | IGameActor | null

// ---------------------------------------------------------------------------
// CellCache — per-cell blocking state snapshot
// ---------------------------------------------------------------------------

/**
 * Cached blocking state for a single cell.
 *
 * OpenRA 对照: Locomotor.CellCache (readonly record struct)
 *
 * Immutable. Stores which players have immovable actors, which cell flags
 * are active, and which players can crush actors in this cell.
 */
export class CellCache {
  /** Players whose actors in this cell are immovable. */
  readonly immovable: LongBitSet<PlayerBitMask>

  /** Active cell flags for this cell. */
  readonly cellFlag: number

  /** Players whose actors can crush the actors in this cell. */
  readonly crushable: LongBitSet<PlayerBitMask>

  /**
   * Create a new CellCache.
   *
   * OpenRA 对照: CellCache(LongBitSet<PlayerBitMask>, CellFlag, LongBitSet<PlayerBitMask>)
   */
  constructor(
    immovable: LongBitSet<PlayerBitMask>,
    cellFlag: number,
    crushable: LongBitSet<PlayerBitMask>,
  ) {
    this.immovable = immovable
    this.cellFlag = cellFlag
    this.crushable = crushable
  }
}

// ---------------------------------------------------------------------------
// TerrainInfo — inner class for terrain speed/cost (OpenRA: TerrainInfo)
// ---------------------------------------------------------------------------

/**
 * Terrain speed and cost for a single terrain type.
 *
 * OpenRA 对照: TerrainInfo
 *
 * NOTE: Defined outside LocomotorInfo and attached as static member
 * because `namespace` is not compatible with erasableSyntaxOnly.
 */
export class TerrainInfo {
  /** An impassable terrain info singleton. */
  static readonly Impassable = new TerrainInfo()

  /** Movement speed percentage (0 = impassable). */
  readonly Speed: number

  /** Pathing cost for this terrain. */
  readonly Cost: number

  /**
   * Lowercase alias for Cost (backward-compatible with old pathfinding code).
   *
   * NOTE: DensePathGraph and PathSearch reference entry.cost directly.
   * This getter preserves that API while following the PascalCase convention.
   */
  get cost(): number {
    return this.Cost
  }

  /**
   * Create an impassable TerrainInfo.
   *
   * OpenRA 对照: TerrainInfo() default constructor
   */
  constructor()
  /**
   * Create a TerrainInfo with speed and cost.
   *
   * OpenRA 对照: TerrainInfo(int speed, short cost)
   */
  constructor(speed: number, cost: number)
  constructor(speed?: number, cost?: number) {
    if (speed === undefined || cost === undefined) {
      this.Cost = PathGraph.MovementCostForUnreachableCell
      this.Speed = 0
    } else {
      this.Speed = speed
      this.Cost = cost
    }
  }
}

// ---------------------------------------------------------------------------
// LocomotorInfo — configuration data
// ---------------------------------------------------------------------------

/**
 * Configuration data for a Locomotor.
 *
 * OpenRA 对照: LocomotorInfo (TraitInfo subclass)
 *
 * Each LocomotorInfo defines a movement type (e.g., "infantry", "vehicle").
 * Multiple LocomotorInfos with @suffixes can be attached to the world actor.
 */
export class LocomotorInfo {
  /** TerrainInfo inner class (attached statically for erasableSyntaxOnly compatibility). */
  static readonly TerrainInfo = TerrainInfo

  /** Locomotor ID/name. */
  readonly Name: string

  /** Average wait time (in ticks) when blocked. */
  readonly WaitAverage: number

  /** Spread of wait time (in ticks) around the average. */
  readonly WaitSpread: number

  /** Allow multiple (infantry) units in one cell. */
  readonly SharesCell: boolean

  /** Can the actor be ordered to move into shroud? */
  readonly MoveIntoShroud: boolean

  /** Crush class names that this locomotor can crush. */
  readonly Crushes: ReadonlySet<string>

  /** Damage types caused while crushing. */
  readonly CrushDamageTypes: ReadonlySet<string>

  /**
   * Terrain speed/cost lookup.
   * Maps terrain type string to TerrainInfo.
   *
   * OpenRA 对照: FrozenDictionary<string, TerrainInfo>
   */
  readonly TerrainSpeeds: ReadonlyMap<string, TerrainInfo>

  /** Whether domain passability checks are disabled. */
  readonly DisableDomainPassabilityCheck: boolean

  /**
   * Create a new LocomotorInfo.
   *
   * OpenRA 对照: LocomotorInfo constructor (from YAML FieldLoader)
   *
   * Three calling conventions (backward-compatible with old test code):
   * 1. New API: `new LocomotorInfo({ name, terrainSpeeds, ... })`
   * 2. Default: `new LocomotorInfo()` — name='default', empty terrain speeds
   * 3. Legacy: `new LocomotorInfo('name')` — just a name
   * 4. Legacy: `new LocomotorInfo('name', terrainSpeedsMap)`
   *
   * @param optsOrName — configuration options object, or name string (legacy)
   * @param legacyTerrainSpeeds — terrain speeds map (legacy, only with name string)
   */
  constructor()
  constructor(opts: {
    name?: string
    waitAverage?: number
    waitSpread?: number
    sharesCell?: boolean
    moveIntoShroud?: boolean
    crushes?: ReadonlySet<string>
    crushDamageTypes?: ReadonlySet<string>
    terrainSpeeds?: ReadonlyMap<string, TerrainInfo>
    disableDomainPassabilityCheck?: boolean
  })
  constructor(name: string)
  constructor(name: string, terrainSpeeds: Map<string, { speed: number; cost: number }>)
  constructor(
    optsOrName?: string | {
      name?: string
      waitAverage?: number
      waitSpread?: number
      sharesCell?: boolean
      moveIntoShroud?: boolean
      crushes?: ReadonlySet<string>
      crushDamageTypes?: ReadonlySet<string>
      terrainSpeeds?: ReadonlyMap<string, TerrainInfo>
      disableDomainPassabilityCheck?: boolean
    },
    legacyTerrainSpeeds?: Map<string, { speed: number; cost: number }>,
  ) {
    if (typeof optsOrName === 'string') {
      // Legacy constructor signature: (name) or (name, terrainSpeeds)
      this.Name = optsOrName
      this.WaitAverage = 40
      this.WaitSpread = 10
      this.SharesCell = false
      this.MoveIntoShroud = true
      this.Crushes = new Set()
      this.CrushDamageTypes = new Set()
      this.TerrainSpeeds = legacyTerrainSpeeds
        ? new Map(
            Array.from(legacyTerrainSpeeds.entries()).map(
              ([k, v]) => [k, new TerrainInfo(v.speed, v.cost)] as const,
            ),
          )
        : new Map()
      this.DisableDomainPassabilityCheck = false
    } else if (optsOrName === undefined) {
      // Default constructor
      this.Name = 'default'
      this.WaitAverage = 40
      this.WaitSpread = 10
      this.SharesCell = false
      this.MoveIntoShroud = true
      this.Crushes = new Set()
      this.CrushDamageTypes = new Set()
      this.TerrainSpeeds = new Map()
      this.DisableDomainPassabilityCheck = false
    } else {
      const opts = optsOrName
      this.Name = opts?.name ?? 'default'
      this.WaitAverage = opts?.waitAverage ?? 40
      this.WaitSpread = opts?.waitSpread ?? 10
      this.SharesCell = opts?.sharesCell ?? false
      this.MoveIntoShroud = opts?.moveIntoShroud ?? true
      this.Crushes = opts?.crushes ?? new Set()
      this.CrushDamageTypes = opts?.crushDamageTypes ?? new Set()
      this.TerrainSpeeds = opts?.terrainSpeeds ?? new Map()
      this.DisableDomainPassabilityCheck = opts?.disableDomainPassabilityCheck ?? false
    }
  }
}

// ---------------------------------------------------------------------------
// ILocomotor — full interface for locomotion
// ---------------------------------------------------------------------------

/**
 * Locomotor interface exposing movement cost, blocking, and cell cache operations.
 *
 * OpenRA 对照: Locomotor class (public API surface)
 *
 * NOTE: TypeScript does not support method overloads in interfaces.
 * movementCostToEnterCell uses a discriminating argument pattern.
 */
export interface ILocomotor {
  /** Locomotor configuration. */
  readonly Info: LocomotorInfo

  /** Whether multiple actors can share a cell. */
  readonly sharesCell: boolean

  /**
   * Get the movement cost to enter a destination cell (no src node check).
   *
   * OpenRA 对照: Locomotor.MovementCostForCell(CPos)
   */
  movementCostForCell(cell: CPos): number

  /**
   * Get the movement cost to enter a destination cell (with height
   * discontinuity check from a source cell).
   *
   * OpenRA 对照: Locomotor.MovementCostForCell(CPos, CPos?)
   *
   * @param cell — the cell to check
   * @param fromCell — the source cell (null to skip height check)
   */
  movementCostForCell(cell: CPos, fromCell: CPos | null): number

  /**
   * Get the movement speed percentage for a cell.
   *
   * OpenRA 对照: Locomotor.MovementSpeedForCell(CPos)
   */
  movementSpeedForCell(cell: CPos): number

  /**
   * Get the movement cost to enter a destination cell, accounting for blocking.
   *
   * OpenRA 对照: Locomotor.MovementCostToEnterCell (two overloads)
   *
   * Calling conventions:
   * 1. With srcNode: movementCostToEnterCell(actor, srcNode, destNode, check, ignoreActor)
   * 2. Without srcNode: movementCostToEnterCell(actor, destNode, check, ignoreActor, ignoreSelf)
   *
   * @param actor — the moving actor (ILocomotorActor or IGameActor, null for theoretical)
   */
  movementCostToEnterCell(
    actor: LocomotorActorParam,
    ...args:
      | [CPos, CPos, BlockedByActor, LocomotorActorParam]
      | [CPos, BlockedByActor, LocomotorActorParam, boolean?]
  ): number

  /**
   * Check if an actor can freely move into a cell.
   *
   * OpenRA 对照: Locomotor.CanMoveFreelyInto(Actor, CPos, SubCell, BlockedByActor, Actor, bool)
   *
   * @param actor — the moving actor (ILocomotorActor or IGameActor, null for theoretical)
   */
  canMoveFreelyInto(
    actor: LocomotorActorParam,
    destNode: CPos,
    subCell: SubCellType,
    check: BlockedByActor,
    ignoreActor: LocomotorActorParam,
    ignoreSelf?: boolean,
  ): boolean

  /**
   * Check if an actor can stay in a cell (not transit-only).
   *
   * OpenRA 对照: Locomotor.CanStayInCell(CPos)
   */
  canStayInCell(cell: CPos): boolean

  /**
   * Find an available sub-cell position in a cell.
   *
   * OpenRA 对照: Locomotor.GetAvailableSubCell(Actor, CPos, BlockedByActor, SubCell, Actor)
   *
   * @param self — the actor seeking a sub-cell (ILocomotorActor or IGameActor)
   */
  getAvailableSubCell(
    self: LocomotorActorParam,
    cell: CPos,
    check: BlockedByActor,
    preferredSubCell?: SubCellType,
    ignoreActor?: LocomotorActorParam,
  ): SubCellType

  /**
   * Check whether one actor is blocked by another.
   *
   * OpenRA 对照: Locomotor.IsBlockedBy(Actor, Actor, Actor, CPos, BlockedByActor, CellFlag)
   *
   * @param actor — the moving actor (ILocomotorActor or IGameActor)
   * @param otherActor — the potential blocking actor (ILocomotorActor or IGameActor)
   */
  isBlockedBy(
    actor: LocomotorActorParam,
    otherActor: LocomotorActorParam,
    ignoreActor: LocomotorActorParam,
    cell: CPos,
    check: BlockedByActor,
    cellFlag: number,
  ): boolean

  /**
   * Rebuild the blocking cache for a cell.
   *
   * OpenRA 对照: Locomotor.UpdateCellBlocking(CPos)
   */
  updateCellBlocking(cell: CPos): void

  /**
   * Fires when the movement cost for a cell changes.
   *
   * OpenRA 对照: Locomotor.CellCostChanged event
   */
  cellCostChanged?: Set<(cell: CPos, oldCost: number, newCost: number) => void>
}

// ---------------------------------------------------------------------------
// Locomotor — full locomotion implementation
// ---------------------------------------------------------------------------

/**
 * Locomotion system for pathfinding, movement blocking, and terrain costs.
 *
 * OpenRA 对照: Locomotor (class, IWorldLoaded)
 *
 * Each Locomotor instance manages terrain speed/cost lookup, actor blocking
 * state caching, and dirty cell tracking. Created by LocomotorInfo.Create()
 * and attached to the world actor.
 */
export class Locomotor implements ILocomotor {
  /** Locomotor configuration. */
  readonly Info: LocomotorInfo

  /** Raised when the movement cost for a cell changes, providing old/new costs. */
  cellCostChanged?: Set<(cell: CPos, oldCost: number, newCost: number) => void>

  /** Whether multiple actors can share a cell. */
  readonly sharesCell: boolean

  /** Terrain infos indexed by terrain type index. */
  private readonly terrainInfos: TerrainInfo[]

  /** Reference to the game world. */
  private readonly world: ILocomotorWorld

  /** Dirty cell tracking — Bits keys of cells whose blocking cache is stale. */
  private readonly dirtyCells: Set<number> = new Set()

  /** Movement cost layers, one per custom movement layer. */
  private cellsCost!: CellLayer<number>[]

  /** Blocking cache layers, one per custom movement layer. */
  private blockingCache!: CellLayer<CellCache>[]

  /** Reference to the actor map. */
  private actorMap!: ILocomotorActorMap

  /**
   * Create a new Locomotor.
   *
   * OpenRA 对照: Locomotor(Actor self, LocomotorInfo info)
   *
   * Resolves terrain infos from the world map's terrain types.
   *
   * @param world — the game world
   * @param info — locomotor configuration
   */
  constructor(world: ILocomotorWorld, info: LocomotorInfo) {
    this.Info = info
    this.sharesCell = info.SharesCell
    this.world = world

    // Resolve terrain infos from map terrain types
    const terrainInfo = world.map.rules.terrainInfo
    this.terrainInfos = new Array<TerrainInfo>(terrainInfo.TerrainTypes.length)
    for (let i = 0; i < this.terrainInfos.length; i++) {
      const typeName = terrainInfo.TerrainTypes[i].Type
      const speed = info.TerrainSpeeds.get(typeName)
      this.terrainInfos[i] = speed ?? TerrainInfo.Impassable
    }
  }

  // -------------------------------------------------------------------------
  // IWorldLoaded equivalent
  // -------------------------------------------------------------------------

  /**
   * Called when the world finishes loading.
   *
   * OpenRA 对照: Locomotor.WorldLoaded(World, WorldRenderer)
   *
   * Initializes CellLayers for blocking cache and cells cost, wires up
   * terrain change events and actor map events.
   *
   * @param world — the game world
   * @param _wr — world renderer (unused by Locomotor)
   */
  worldLoaded(world: ILocomotorWorld, _wr: unknown): void {
    const map = world.map
    this.actorMap = world.actorMap

    // Subscribe to terrain change events
    map.customTerrain.onCellEntryChanged(this._boundUpdateCellCost)
    map.tiles.onCellEntryChanged(this._boundUpdateCellCost)
    this.actorMap.onCellUpdated = this._boundCellUpdated

    // Create CellLayers for layer 0 (ground)
    this.cellsCost = [this._createCellLayer<number>(map)]
    this.blockingCache = [this._createCellLayer<CellCache>(map)]

    // Initialize all cells
    for (const cell of map.allCells()) {
      this.updateCellCost(cell)
      this.updateCellBlocking(cell)
    }

    // Set up custom movement layers
    const customMovementLayers = world.getCustomMovementLayers()
    for (const cml of customMovementLayers) {
      if (cml === null) continue

      const costLayer = this._createCellLayer<number>(map)
      this.cellsCost[cml.Index] = costLayer
      this.blockingCache[cml.Index] = this._createCellLayer<CellCache>(map)

      for (const cell of map.allCells()) {
        const index = cml.getTerrainIndex(cell)

        let cost: number = PathGraph.MovementCostForUnreachableCell
        if (index !== 255 /** byte.MaxValue */) {
          cost = this.terrainInfos[index].Cost
        }

        costLayer.set(cell, cost)
      }
    }
  }

  /**
   * Create a CellLayer with default values matching the map.
   *
   * NOTE: OpenRA uses `new CellLayer<T>(map)`. Our CellLayer requires
   * gridType and size. We compose from the map contract.
   */
  private _createCellLayer<T>(map: ILocomotorMap): CellLayer<T> {
    const sz = { width: map.mapSize.width, height: map.mapSize.height }
    return new CellLayer<T>(map.gridType, sz)
  }

  /** Bound callback for CellEntryChanged events. */
  private readonly _boundUpdateCellCost = (cell: CPos) => {
    this.updateCellCost(cell)
  }

  /** Bound callback for actor map CellUpdated events. */
  private readonly _boundCellUpdated = (cell: CPos) => {
    this.dirtyCells.add(cell.Bits)
  }

  // -------------------------------------------------------------------------
  // Movement cost queries
  // -------------------------------------------------------------------------

  /**
   * Get the terrain movement cost for a cell.
   *
   * OpenRA 对照: Locomotor.MovementCostForCell(CPos) / MovementCostForCell(CPos, CPos?)
   *
   * @param cell — the cell to check
   * @param fromCell — optional source cell for height discontinuity check
   * @returns terrain movement cost, or MovementCostForUnreachableCell
   */
  movementCostForCell(cell: CPos, fromCell?: CPos | null): number {
    if (!this.world.map.contains(cell))
      return PathGraph.MovementCostForUnreachableCell

    // Prevent units from jumping over height discontinuities
    if (
      fromCell !== undefined &&
      fromCell !== null &&
      cell.Layer === 0 &&
      fromCell.Layer === 0 &&
      this.world.map.grid.maximumTerrainHeight > 0
    ) {
      const heightLayer = this.world.map.height
      if (Math.abs(heightLayer.get(cell) - heightLayer.get(fromCell)) > 1)
        return PathGraph.MovementCostForUnreachableCell
    }

    return this.cellsCost[cell.Layer].get(cell)
  }

  /**
   * Get the movement speed percentage for a cell.
   *
   * OpenRA 对照: Locomotor.MovementSpeedForCell(CPos)
   *
   * @param cell — the cell to check
   * @returns movement speed percentage (0 = impassable)
   */
  movementSpeedForCell(cell: CPos): number {
    const index =
      cell.Layer === 0
        ? this.world.map.getTerrainIndex(cell)
        : this.world.getCustomMovementLayers()[cell.Layer]!.getTerrainIndex(cell)

    return this.terrainInfos[index].Speed
  }

  // -------------------------------------------------------------------------
  // Type narrowing helper
  // -------------------------------------------------------------------------

  /**
   * Narrow a LocomotorActorParam to ILocomotorActor for accessing
   * blocking/movement properties.
   *
   * When the actor doesn't have ILocomotorActor properties (e.g., it's a
   * plain IGameActor from pathfinding code), conservative defaults are used.
   */
  private static narrowActor(a: NonNullable<LocomotorActorParam>): ILocomotorActor | null {
    if (typeof a === 'object' && a !== null && 'occupiesSpace' in a) {
      return a as unknown as ILocomotorActor
    }
    return null
  }

  // -------------------------------------------------------------------------
  // MovementCostToEnterCell (two overloads matching C#)
  // -------------------------------------------------------------------------

  /**
   * Get the movement cost to enter a destination cell, accounting for blocking.
   *
   * OpenRA 对照: Locomotor.MovementCostToEnterCell (both overloads)
   *
   * Two calling conventions (discriminated by arg count and types):
   * 1. overload with srcNode:
   *    movementCostToEnterCell(actor, srcNode, destNode, check, ignoreActor)
   * 2. overload without srcNode:
   *    movementCostToEnterCell(actor, destNode, check, ignoreActor, ignoreSelf)
   *
   * Discriminator: if args[3] is boolean, it's overload 2 (ignoreSelf).
   * BlockedByActor is always a number (0-3), never boolean.
   */
  movementCostToEnterCell(
    actor: LocomotorActorParam,
    ...args:
      | [CPos, CPos, BlockedByActor, LocomotorActorParam]
      | [CPos, BlockedByActor, LocomotorActorParam, boolean?]
  ): number {
    // SubCell already imported statically at top of file

    // Detect overload 2 (without srcNode): 4th argument is boolean (ignoreSelf)
    const isOverload2 = args.length >= 4 && typeof args[3] === 'boolean'

    if (isOverload2) {
      // Overload 2: (actor, destNode, check, ignoreActor, ignoreSelf?)
      const destNode = args[0] as CPos
      const check = args[1] as BlockedByActor
      const ignoreActor = (args[2] ?? null) as LocomotorActorParam
      const ignoreSelf = (args[3] as boolean | undefined) ?? false

      const cellCost = this.movementCostForCell(destNode)

      if (
        cellCost === PathGraph.MovementCostForUnreachableCell ||
        !this.canMoveFreelyInto(
          actor,
          destNode,
          SubCell.FullCell as SubCellType,
          check,
          ignoreActor,
          ignoreSelf,
        )
      )
        return PathGraph.MovementCostForUnreachableCell

      return cellCost
    }

    // Overload 1: (actor, srcNode, destNode, check, ignoreActor)
    const srcNode = args[0] as CPos
    const destNode = args[1] as CPos
    const check = args[2] as BlockedByActor
    const ignoreActor = (args[3] ?? null) as LocomotorActorParam

    const cellCost = this.movementCostForCell(destNode, srcNode)

    if (
      cellCost === PathGraph.MovementCostForUnreachableCell ||
      !this.canMoveFreelyInto(
        actor,
        destNode,
        SubCell.FullCell as SubCellType,
        check,
        ignoreActor,
        false,
      )
    )
      return PathGraph.MovementCostForUnreachableCell

    return cellCost
  }

  // -------------------------------------------------------------------------
  // CanMoveFreelyInto
  // -------------------------------------------------------------------------

  /**
   * Determine whether the actor is blocked by other actors in a cell.
   *
   * OpenRA 对照: Locomotor.CanMoveFreelyInto(Actor, CPos, SubCell, BlockedByActor, Actor, bool)
   */
  canMoveFreelyInto(
    actor: LocomotorActorParam,
    cell: CPos,
    subCell: SubCellType,
    check: BlockedByActor,
    ignoreActor: LocomotorActorParam,
    ignoreSelf?: boolean,
  ): boolean {
    // If the check allows: We are not blocked by other actors.
    if (check === 0 /* BlockedByActor.None */) return true

    const cellCache = this.getCache(cell)
    const cellFlag = cellCache.cellFlag

    // No actor in the cell or free SubCell.
    if (cellFlag === CellFlag.HasFreeSpace) return true

    // If actor is null we're just checking what would happen theoretically.
    // In such a scenario — we'll just assume any other actor in the cell
    // will block us by default.
    if (actor === null) return false

    // Narrow to ILocomotorActor for owner/blocking properties.
    // If we can't narrow (plain IGameActor), fall back to conservative behavior.
    const locoActor = Locomotor.narrowActor(actor)
    if (locoActor === null) return false

    // All actors that may be in the cell can be crushed.
    if (cellCache.crushable.overlaps(locoActor.owner.playerMask)) return true

    // If the check allows: We are not blocked by moving units.
    if (check <= 2 /* BlockedByActor.Stationary */ && !hasCellFlag(cellFlag, CellFlag.HasStationaryActor))
      return true

    // If the check allows: We are not blocked by units that we can force to move.
    if (check <= 1 /* BlockedByActor.Immovable */ && !cellCache.immovable.overlaps(locoActor.owner.playerMask))
      return true

    // Cache doesn't account for ignored actors, subcells, temporary blockers
    // or transit only actors. These must use the slow path.
    if (
      ignoreActor === null &&
      !ignoreSelf &&
      subCell === 0 /* SubCell.FullCell */ &&
      !hasCellFlag(cellFlag, CellFlag.HasTemporaryBlocker) &&
      !hasCellFlag(cellFlag, CellFlag.HasTransitOnlyActor)
    ) {
      // We already know there are uncrushable actors in the cell so we are always blocked.
      if (check === 3 /* BlockedByActor.All */) return false

      // We already know there are either immovable or stationary actors which the check does not allow.
      if (!hasCellFlag(cellFlag, CellFlag.HasCrushableActor)) return false

      // All actors in the cell are immovable and some cannot be crushed.
      if (!hasCellFlag(cellFlag, CellFlag.HasMovableActor)) return false

      // All actors in the cell are stationary and some cannot be crushed.
      if (check === 2 /* BlockedByActor.Stationary */ && !hasCellFlag(cellFlag, CellFlag.HasMovingActor))
        return false
    }

    const otherActors =
      subCell === 0 /* SubCell.FullCell */
        ? this.actorMap.getActorsAt(cell)
        : this.actorMap.getActorsAt(cell, subCell)

    if (ignoreSelf) {
      // Any actor blocking us will prevent our movement, *unless* we are one of those actors.
      let isBlocked = false
      for (const otherActor of otherActors) {
        if (locoActor.actorId === otherActor.actorId) return true
        isBlocked = isBlocked || this.isBlockedBy(locoActor, otherActor, ignoreActor, cell, check, cellFlag)
      }
      return !isBlocked
    }

    // Any actor blocking us will prevent our movement.
    for (const otherActor of otherActors) {
      if (this.isBlockedBy(locoActor, otherActor, ignoreActor, cell, check, cellFlag)) return false
    }

    return true
  }

  // -------------------------------------------------------------------------
  // CanStayInCell
  // -------------------------------------------------------------------------

  /**
   * Check if an actor can remain in a cell (must not be transit-only).
   *
   * OpenRA 对照: Locomotor.CanStayInCell(CPos)
   */
  canStayInCell(cell: CPos): boolean {
    if (!this.world.map.contains(cell)) return false
    return !hasCellFlag(this.getCache(cell).cellFlag, CellFlag.HasTransitOnlyActor)
  }

  // -------------------------------------------------------------------------
  // GetAvailableSubCell
  // -------------------------------------------------------------------------

  /**
   * Find an available sub-cell position within a cell.
   *
   * OpenRA 对照: Locomotor.GetAvailableSubCell(Actor, CPos, BlockedByActor, SubCell, Actor)
   */
  getAvailableSubCell(
    self: LocomotorActorParam,
    cell: CPos,
    check: BlockedByActor,
    preferredSubCell: SubCellType = 254 /* SubCell.Any */,
    ignoreActor: LocomotorActorParam = null,
  ): SubCellType {
    // SubCell already imported statically at top of file

    if (this.movementCostForCell(cell) === PathGraph.MovementCostForUnreachableCell)
      return SubCell.Invalid as SubCellType

    // Narrow self to ILocomotorActor for blocking checks
    const locoSelf = self !== null ? Locomotor.narrowActor(self) : null

    if (check > 0 /* BlockedByActor.None */) {
      const checkTransient = (otherActor: ILocomotorActor) =>
        this.isBlockedBy(locoSelf ?? otherActor, otherActor, ignoreActor, cell, check, this.getCache(cell).cellFlag)

      if (!this.sharesCell)
        return this.actorMap.anyActorsAt(cell, SubCell.FullCell as SubCellType, checkTransient)
          ? (SubCell.Invalid as SubCellType)
          : (SubCell.FullCell as SubCellType)

      return this.actorMap.freeSubCell(cell, preferredSubCell, checkTransient)
    }

    if (!this.sharesCell)
      return this.actorMap.anyActorsAt(cell, SubCell.FullCell as SubCellType)
        ? (SubCell.Invalid as SubCellType)
        : (SubCell.FullCell as SubCellType)

    return this.actorMap.freeSubCell(cell, preferredSubCell)
  }

  // -------------------------------------------------------------------------
  // IsBlockedBy
  // -------------------------------------------------------------------------

  /**
   * Check whether one actor is blocked by another specific actor.
   *
   * OpenRA 对照: Locomotor.IsBlockedBy(Actor, Actor, Actor, CPos, BlockedByActor, CellFlag)
   *
   * NOTE: This logic is replicated in HierarchicalPathFinder.ActorIsBlocking
   * and HierarchicalPathFinder.ActorCellIsBlocking. If this method is updated,
   * please update those as well.
   */
  isBlockedBy(
    actor: LocomotorActorParam,
    otherActor: LocomotorActorParam,
    ignoreActor: LocomotorActorParam,
    _cell: CPos,
    check: BlockedByActor,
    cellFlag: number,
  ): boolean {
    // Narrow both actors — if narrowing fails, assume blocked by default
    const locoActor = actor !== null ? Locomotor.narrowActor(actor) : null
    const locoOther = otherActor !== null ? Locomotor.narrowActor(otherActor) : null

    if (locoActor === null || locoOther === null) return true

    const ignoreId = ignoreActor !== null && ignoreActor !== undefined
      ? Locomotor.narrowActor(ignoreActor)?.actorId
      : undefined
    if (locoOther.actorId === ignoreId) return false

    const otherMobile = locoOther.occupiesSpace
    const otherIsMovable =
      otherMobile !== null &&
      !otherMobile.isTraitDisabled &&
      !otherMobile.isTraitPaused &&
      !otherMobile.isImmovable
    const otherIsMoving =
      otherIsMovable && hasMovementType(otherMobile.currentMovementTypes, MovementType.Horizontal)

    // If the check allows: We are not blocked by allied units that we can force to move.
    if (
      check <= 1 /* BlockedByActor.Immovable */ &&
      hasCellFlag(cellFlag, CellFlag.HasMovableActor) &&
      otherIsMovable &&
      locoActor.owner.relationshipWith(locoOther.owner) === PlayerRelationship.Ally
    )
      return false

    // If the check allows: we are not blocked by moving units.
    if (
      check <= 2 /* BlockedByActor.Stationary */ &&
      hasCellFlag(cellFlag, CellFlag.HasMovingActor) &&
      otherIsMoving
    )
      return false

    if (hasCellFlag(cellFlag, CellFlag.HasTemporaryBlocker)) {
      // If there is a temporary blocker in our path, but we can remove it, we are not blocked.
      if (locoOther.hasTemporaryBlocker && locoOther.temporaryBlockerCanRemove(locoOther, locoActor))
        return false
    }

    if (hasCellFlag(cellFlag, CellFlag.HasTransitOnlyActor)) {
      // Transit only tiles should not block movement
      if (locoOther.isTransitOnlyAt(_cell)) return false
    }

    // If we cannot crush the other actor in our way, we are blocked.
    if (!hasCellFlag(cellFlag, CellFlag.HasCrushableActor) || this.Info.Crushes.size === 0)
      return true

    // If the other actor in our way cannot be crushed, we are blocked.
    // PERF: Avoid LINQ — iterate crushables directly.
    const crushables = locoOther.crushables
    for (const crushable of crushables) {
      if (crushable.crushableByPlayerMask(locoOther, this.Info.Crushes).overlaps(locoActor.owner.playerMask))
        return false
    }

    return true
  }

  // -------------------------------------------------------------------------
  // UpdateCellBlocking
  // -------------------------------------------------------------------------

  /**
   * Rebuild the blocking cache for a single cell.
   *
   * OpenRA 对照: Locomotor.UpdateCellBlocking(CPos)
   *
   * Iterates over all actors in the cell and computes the combined
   * CellFlag, immovable player mask, and crushable player mask.
   *
   * NOTE: This logic is replicated in HierarchicalPathFinder.ActorIsBlocking
   * and HierarchicalPathFinder.ActorCellIsBlocking. If this method is updated,
   * please update those as well.
   */
  updateCellBlocking(cell: CPos): void {
    const cache = this.blockingCache[cell.Layer]
    let cellFlag = CellFlag.HasFreeSpace
    let cellImmovablePlayers = this.world.noPlayersMask
    let cellCrushablePlayers = this.world.allPlayersMask

    if (this.sharesCell && this.actorMap.hasFreeSubCell(cell)) {
      cache.set(cell, new CellCache(cellImmovablePlayers, cellFlag, cellCrushablePlayers))
      return
    }

    for (const actor of this.actorMap.getActorsAt(cell)) {
      let actorImmovablePlayers = this.world.allPlayersMask
      let actorCrushablePlayers = this.world.noPlayersMask

      const crushables = actor.crushables
      const mobile = actor.occupiesSpace
      const isMovable =
        mobile !== null &&
        !mobile.isTraitDisabled &&
        !mobile.isTraitPaused &&
        !mobile.isImmovable
      const isMoving =
        isMovable && hasMovementType(mobile.currentMovementTypes, MovementType.Horizontal)

      const isTransitOnly = actor.isTransitOnlyAt(cell)

      if (isTransitOnly) cellFlag |= CellFlag.HasTransitOnlyActor

      for (const crushable of crushables) {
        cellFlag |= CellFlag.HasCrushableActor
        actorCrushablePlayers = actorCrushablePlayers.union(
          crushable.crushableByPlayerMask(actor, this.Info.Crushes),
        )
      }

      if (isMoving) cellFlag |= CellFlag.HasMovingActor
      else cellFlag |= CellFlag.HasStationaryActor

      if (isMovable) {
        cellFlag |= CellFlag.HasMovableActor
        actorImmovablePlayers = actorImmovablePlayers.except(actor.owner.alliedPlayersMask)
      }

      // PERF: Only perform temporary blocker check if the world has them
      if (this.world.rulesContainTemporaryBlocker) {
        if (actor.hasTemporaryBlocker) cellFlag |= CellFlag.HasTemporaryBlocker
      }

      cellCrushablePlayers = cellCrushablePlayers.intersect(actorCrushablePlayers)
      cellImmovablePlayers = cellImmovablePlayers.union(actorImmovablePlayers)
    }

    cache.set(cell, new CellCache(cellImmovablePlayers, cellFlag, cellCrushablePlayers))
  }

  // -------------------------------------------------------------------------
  // UpdateCellCost
  // -------------------------------------------------------------------------

  /**
   * Update the movement cost for a cell from terrain data.
   *
   * OpenRA 对照: Locomotor.UpdateCellCost(CPos)
   *
   * Fires CellCostChanged event if any callbacks are registered.
   */
  updateCellCost(cell: CPos): void {
    const index =
      cell.Layer === 0
        ? this.world.map.getTerrainIndex(cell)
        : this.world.getCustomMovementLayers()[cell.Layer]!.getTerrainIndex(cell)

    let cost: number = PathGraph.MovementCostForUnreachableCell
    if (index !== 255 /** byte.MaxValue */) {
      cost = this.terrainInfos[index].Cost
    }

    const cache = this.cellsCost[cell.Layer]
    if (!this.cellCostChanged || this.cellCostChanged.size === 0) {
      cache.set(cell, cost)
    } else {
      const oldCost = cache.get(cell)
      cache.set(cell, cost)
      for (const cb of this.cellCostChanged) {
        cb(cell, oldCost, cost)
      }
    }
  }

  // -------------------------------------------------------------------------
  // GetCache — lazy cache refresh
  // -------------------------------------------------------------------------

  /**
   * Get the blocking cache for a cell, refreshing if dirty.
   *
   * OpenRA 对照: Locomotor.GetCache(CPos)
   */
  private getCache(cell: CPos): CellCache {
    if (this.dirtyCells.delete(cell.Bits)) {
      this.updateCellBlocking(cell)
    }
    return this.blockingCache[cell.Layer].get(cell)
  }
}

// ---------------------------------------------------------------------------
// SimpleLocomotor — basic stub implementation for testing
// ---------------------------------------------------------------------------

/**
 * Simple stub Locomotor implementation for testing pathfinding.
 *
 * Returns uniform terrain costs (all passable with cost 100).
 * Does not implement actor blocking.
 *
 * STUB: This is a test-only stub. Real Locomotor will query the
 * world map for terrain types and the actor map for blocking actors.
 */
export class SimpleLocomotor implements ILocomotor {
  readonly Info: LocomotorInfo
  readonly sharesCell: boolean

  /** Event for cell cost changes (test stub). */
  cellCostChanged?: Set<(cell: CPos, oldCost: number, newCost: number) => void>

  /**
   * Create a SimpleLocomotor.
   *
   * @param info — optional LocomotorInfo (default: empty)
   */
  constructor(info?: LocomotorInfo) {
    this.Info = info ?? new LocomotorInfo()
    this.sharesCell = this.Info.SharesCell
  }

  /** @inheritdoc */
  movementCostToEnterCell(
    _actor: LocomotorActorParam,
    ..._args:
      | [CPos, CPos, BlockedByActor, LocomotorActorParam]
      | [CPos, BlockedByActor, LocomotorActorParam, boolean?]
  ): number {
    // STUB: All cells are passable with cost 100
    return 100
  }

  /** @inheritdoc */
  canMoveFreelyInto(
    _actor: LocomotorActorParam,
    _destNode: CPos,
    _subCell: SubCellType,
    _check: BlockedByActor,
    _ignoreActor: LocomotorActorParam,
    _ignoreSelf?: boolean,
  ): boolean {
    // STUB: All cells are freely enterable
    return true
  }

  /** @inheritdoc */
  movementCostForCell(_cell: CPos, _fromCell?: CPos | null): number {
    // STUB: All cells have cost 100
    return 100
  }

  /** @inheritdoc */
  movementSpeedForCell(_cell: CPos): number {
    // STUB: All cells have speed 100
    return 100
  }

  /** @inheritdoc */
  canStayInCell(_cell: CPos): boolean {
    // STUB: All cells are stayable
    return true
  }

  /** @inheritdoc */
  getAvailableSubCell(
    _self: LocomotorActorParam,
    _cell: CPos,
    _check: BlockedByActor,
    _preferredSubCell?: SubCellType,
    _ignoreActor?: LocomotorActorParam,
  ): SubCellType {
    // STUB: Always returns FullCell
    return 0 /* SubCell.FullCell */
  }

  /** @inheritdoc */
  isBlockedBy(
    _actor: LocomotorActorParam,
    _otherActor: LocomotorActorParam,
    _ignoreActor: LocomotorActorParam,
    _cell: CPos,
    _check: BlockedByActor,
    _cellFlag: number,
  ): boolean {
    // STUB: No actor is blocked
    return false
  }

  /** @inheritdoc */
  updateCellBlocking(_cell: CPos): void {
    // STUB: No-op
  }
}

// ---------------------------------------------------------------------------
// WallAwareLocomotor — test stub that blocks specific cells
// ---------------------------------------------------------------------------

/**
 * Test Locomotor that treats certain cells as walls (unreachable).
 *
 * Used for testing pathfinding around obstacles.
 */
export class WallAwareLocomotor implements ILocomotor {
  readonly Info: LocomotorInfo
  readonly sharesCell: boolean

  /** Event for cell cost changes (test stub). */
  cellCostChanged?: Set<(cell: CPos, oldCost: number, newCost: number) => void>

  /** Set of blocked cell keys (Bits value). */
  private readonly blockedCells: Set<number>

  /**
   * Create a WallAwareLocomotor.
   *
   * @param blockedCells — set of blocked cell positions (as CPos)
   * @param info — optional LocomotorInfo
   */
  constructor(blockedCells: CPos[] = [], info?: LocomotorInfo) {
    this.Info =
      info ??
      new LocomotorInfo({
        name: 'default',
        terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
      })
    this.sharesCell = this.Info.SharesCell
    this.blockedCells = new Set(blockedCells.map((c) => c.Bits))
  }

  /** Check if a cell is blocked. */
  private isBlocked(cell: CPos): boolean {
    return this.blockedCells.has(cell.Bits)
  }

  /** @inheritdoc */
  movementCostToEnterCell(
    _actor: LocomotorActorParam,
    ...args:
      | [CPos, CPos, BlockedByActor, LocomotorActorParam]
      | [CPos, BlockedByActor, LocomotorActorParam, boolean?]
  ): number {
    // Discriminate overload: if args[3] is boolean, it's overload 2 (ignoreSelf)
    const isOverload2 = args.length >= 4 && typeof args[3] === 'boolean'
    const destNode = isOverload2 ? (args[0] as CPos) : (args[1] as CPos)
    if (this.isBlocked(destNode)) {
      return PathGraph.MovementCostForUnreachableCell
    }
    return 100
  }

  /** @inheritdoc */
  canMoveFreelyInto(
    _actor: LocomotorActorParam,
    destNode: CPos,
    _subCell: SubCellType,
    _check: BlockedByActor,
    _ignoreActor: LocomotorActorParam,
    _ignoreSelf?: boolean,
  ): boolean {
    return !this.isBlocked(destNode)
  }

  /** @inheritdoc */
  movementCostForCell(cell: CPos, _fromCell?: CPos | null): number {
    if (this.isBlocked(cell)) {
      return PathGraph.MovementCostForUnreachableCell
    }
    return 100
  }

  /** @inheritdoc */
  movementSpeedForCell(cell: CPos): number {
    if (this.isBlocked(cell)) return 0
    return 100
  }

  /** @inheritdoc */
  canStayInCell(cell: CPos): boolean {
    return !this.isBlocked(cell)
  }

  /** @inheritdoc */
  getAvailableSubCell(
    _self: LocomotorActorParam,
    cell: CPos,
    _check: BlockedByActor,
    _preferredSubCell?: SubCellType,
    _ignoreActor?: LocomotorActorParam,
  ): SubCellType {
    if (this.isBlocked(cell)) return 255 /* SubCell.Invalid */
    return 0 /* SubCell.FullCell */
  }

  /** @inheritdoc */
  isBlockedBy(
    _actor: LocomotorActorParam,
    _otherActor: LocomotorActorParam,
    _ignoreActor: LocomotorActorParam,
    _cell: CPos,
    _check: BlockedByActor,
    _cellFlag: number,
  ): boolean {
    // STUB: Default — check if cell is in blocked list
    return this.isBlocked(_cell)
  }

  /** @inheritdoc */
  updateCellBlocking(_cell: CPos): void {
    // STUB: No-op
  }
}
