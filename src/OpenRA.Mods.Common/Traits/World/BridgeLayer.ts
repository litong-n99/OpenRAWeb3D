/**
 * BridgeLayer.ts — 桥梁运行时追踪层 (bridge actor registration & blocked check)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/BridgeLayer.cs
 *
 * 核心范式转换:
 * - C# CellLayer<Actor> → TypeScript CellLayer<IBridgeSegmentActor | null>
 * - C# sealed class → TypeScript class with explicit public API
 * - C# this[CPos] indexer → TypeScript getBridge(cell) method
 * - C# BuildingInfo.PathableTiles → forward interface for future migration
 *
 * BridgeLayer tracks all bridge actors on the map, mapping cells to the
 * bridge actor that occupies them. It provides bridge passability checks
 * used by Locomotor for bridge destruction states.
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import type { Size } from '../../../OpenRA.Game/Primitives/Size'

// ---------------------------------------------------------------------------
// Forward interfaces — contracts from not-yet-migrated modules
// ---------------------------------------------------------------------------

/**
 * Interface for a bridge segment actor.
 *
 * OpenRA 对照: IBridgeSegment interface (BridgeLayer.cs)
 *
 * Provides the contract for bridge destruction/repair and damage state
 * queries. Full implementation will be in the Bridge trait.
 */
export interface IBridgeSegment {
  readonly type: string
  readonly damageState: DamageState
  readonly neighbourOffsets: readonly { X: number; Y: number }[]
  readonly isValid: boolean
  readonly location: CPos
  repair(repairer: unknown): void
  demolish(saboteur: unknown, damageTypes: ReadonlySet<string>): void
}

/**
 * Damage states for bridge segments.
 *
 * OpenRA 对照: DamageState enum
 */
export const DamageState = {
  Undamaged: 0,
  Light: 1,
  Medium: 2,
  Heavy: 3,
  Critical: 4,
  Dead: 5,
} as const

export type DamageState = (typeof DamageState)[keyof typeof DamageState]

/**
 * BuildingInfo contract — provides pathable tiles for a building actor.
 *
 * OpenRA 对照: BuildingInfo.PathableTiles(CPos)
 *
* Replace with full BuildingInfo when migrated.
 */
export interface IBuildingInfoStub {
  pathableTiles(location: CPos): readonly CPos[]
}

/**
 * Actor info contract — provides trait info lookup.
 *
 * OpenRA 对照: ActorInfo.TraitInfo<T>()
 *
* Replace with full ActorInfo when trait system fully migrated.
 */
export interface IBridgeActorInfoStub {
  traitInfo(): IBuildingInfoStub
}

/**
 * Bridge actor contract — provides location and type info for bridge tracking.
 *
 * OpenRA 对照: Actor (subset for BridgeLayer)
 */
export interface IBridgeActorStub {
  readonly location: CPos
  readonly info: IBridgeActorInfoStub
}

// ---------------------------------------------------------------------------
// BridgeLayerInfo
// 对应 OpenRA BridgeLayerInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the BridgeLayer.
 *
 * OpenRA 对照: BridgeLayerInfo (sealed class, TraitInfo)
 *
 * Simple trait info — BridgeLayer has no configurable parameters.
 */
export class BridgeLayerInfo {
  /** Optional instance name for trait disambiguation. */
  readonly instanceName?: string

  constructor(opts: { instanceName?: string } = {}) {
    this.instanceName = opts.instanceName
  }

  /**
   * Create a BridgeLayer instance.
   *
   * OpenRA 对照: BridgeLayerInfo.Create(ActorInitializer)
   *
   * @param gridType — the map grid type
   * @param mapSize — the map size
   */
  create(gridType: MapGridType, mapSize: Size): BridgeLayer {
    return new BridgeLayer(gridType, mapSize)
  }
}

// ---------------------------------------------------------------------------
// BridgeLayer
// 对应 OpenRA BridgeLayer
// ---------------------------------------------------------------------------

/**
 * Tracks bridge actors on the map for passability checks.
 *
 * OpenRA 对照: BridgeLayer (sealed class)
 *
 * Maintains a CellLayer mapping cells to bridge actors. When a bridge is
 * added, all its pathable tiles are registered. When removed, those tiles
 * are cleared. Used by Locomotor to check if a bridge at a cell is destroyed
 * (i.e., no bridge actor registered at that cell).
 */
export class BridgeLayer {
  /** CellLayer mapping cells to bridge actors.
   *
   * OpenRA 对照: BridgeLayer.bridges (CellLayer<Actor>)
   */
  private readonly bridges: CellLayer<IBridgeActorStub | null>

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Create a BridgeLayer.
   *
   * OpenRA 对照: BridgeLayer(World world)
   *
   * @param gridType — the map grid type
   * @param mapSize — the map size in cells
   */
  constructor(gridType: MapGridType, mapSize: Size) {
    this.bridges = new CellLayer<IBridgeActorStub | null>(gridType, mapSize)
    // Initialize all entries to null (matching C# default for reference types).
    // NOTE: clear() would throw if observers were attached, but during
    // construction no observers exist yet.
    this.bridges.clear(null)
  }

  // -------------------------------------------------------------------------
  // getBridge — cell indexer (matching C# this[CPos])
  // -------------------------------------------------------------------------

  /**
   * Get the bridge actor at a cell position.
   *
   * OpenRA 对照: BridgeLayer.this[CPos] → Actor
   *
   * @param cell — the cell position
   * @returns the bridge actor, or null if no bridge at this cell
   */
  getBridge(cell: CPos): IBridgeActorStub | null {
    return this.bridges.get(cell)
  }

  // -------------------------------------------------------------------------
  // Add — register a bridge actor
  // -------------------------------------------------------------------------

  /**
   * Register a bridge actor on the map.
   *
   * OpenRA 对照: BridgeLayer.Add(Actor b)
   *
   * Finds all pathable tiles of the bridge building and maps them to
   * this bridge actor. The bridge's building info determines which cells
   * it occupies.
   *
   * @param b — the bridge actor to register
   */
  add(b: IBridgeActorStub): void {
    const buildingInfo = b.info.traitInfo()
    for (const c of buildingInfo.pathableTiles(b.location)) {
      this.bridges.set(c, b)
    }
  }

  // -------------------------------------------------------------------------
  // Remove — unregister a bridge actor
  // -------------------------------------------------------------------------

  /**
   * Unregister a bridge actor from the map.
   *
   * OpenRA 对照: BridgeLayer.Remove(Actor b)
   *
   * Clears all cells that were mapped to this bridge actor.
   * Only clears cells that actually point to this bridge (safe
   * against overlapping bridges from other actors).
   *
   * @param b — the bridge actor to unregister
   */
  remove(b: IBridgeActorStub): void {
    const buildingInfo = b.info.traitInfo()
    for (const c of buildingInfo.pathableTiles(b.location)) {
      if (this.bridges.get(c) === b) {
        this.bridges.set(c, null)
      }
    }
  }

  // -------------------------------------------------------------------------
  // isBridgeBlocked — passability check
  // -------------------------------------------------------------------------

  /**
   * Check whether a bridge at the given cell is blocked/destroyed.
   *
   * OpenRA 对照: Locomotor checks BridgeLayer.this[cell] for null
   *
   * A bridge is considered blocked if the cell is within a bridge
   * footprint but no bridge actor exists at that cell (e.g., the
   * bridge was destroyed).
   *
   * NOTE: This is a convenience method. In OpenRA, passability is
   * checked directly via the this[CPos] indexer returning null for
   * destroyed bridge segments.
   *
   * @param cell — the cell position to check
   * @returns true if the bridge at this cell is blocked/destroyed
   */
  isBridgeBlocked(cell: CPos): boolean {
    return this.bridges.get(cell) === null
  }

  /**
   * Check whether a cell has a bridge registered.
   *
   * OpenRA 对照: BridgeLayer.this[CPos] != null
   *
   * @param cell — the cell position
   * @returns true if a bridge actor exists at this cell
   */
  hasBridge(cell: CPos): boolean {
    return this.bridges.get(cell) !== null
  }
}
