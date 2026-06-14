/**
 * BuildingUtils.ts — 建筑放置验证工具：单格/多格可建造性检查、墙体连线计算
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/BuildingUtils.cs (139 lines)
 *
 * 核心范式转换:
 * - C# static class + extension methods → TS static class (standalone module)
 * - C# yield return (generator) → TS 显式数组返回（避免惰性迭代器复杂性）
 * - C# HashSet<string>.Overlaps → TS set intersection via manual loop
 * - C# HashTraitInfo<ReplacementInfo>() → TS trait query via callback interface
 * - C# TraitsImplementing<Replaceable>() → TS trait iteration via callback
 * - C# Map.Ramp[cell] → TS ramp CellLayer.get(cell)
 * - C# Shroud.IsExplored(c) → TS stub: assumed explored (Shroud = Ch12)
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { BuildingInfo } from './Building.js'

// ---------------------------------------------------------------------------
// Minimal dependency interfaces for easy unit testing
// OpenRA 对照: N/A (C# uses extension methods on World)
// ---------------------------------------------------------------------------

/** Map terrain info for placement validation.
 *
 * OpenRA 对照: Map.GetTerrainInfo(CPos).Type
 */
export interface ITerrainInfoAt {
  /** Terrain type name (e.g. "Clear", "Rough", "Water").
   *
   * OpenRA 对照: TerrainTypeInfo.Type
   */
  readonly type: string
}

/** Minimal map abstraction for building placement checks.
 *
 * OpenRA 对照: Map (subset: Contains, Ramp, GetTerrainInfo)
 */
export interface IBuildingUtilsMap {
  /** Check if a cell is within map bounds.
   *
   * OpenRA 对照: Map.Contains(CPos)
   */
  contains(cell: CPos): boolean

  /** Get terrain information for a cell.
   *
   * OpenRA 对照: Map.GetTerrainInfo(CPos)
   */
  getTerrainInfo(cell: CPos): ITerrainInfoAt

  /** The ramp layer (CellLayer<number>).
   *
   * OpenRA 对照: Map.Ramp
   *
   * Access pattern: ramp.contains(cell) + ramp.get(cell)
   */
  readonly ramp: {
    contains(cell: CPos): boolean
    get(cell: CPos): number
  }
}

/** Minimal actor map abstraction for cell queries.
 *
 * OpenRA 对照: ActorMap (subset: GetActorsAt)
 */
export interface IBuildingUtilsActorMap {
  /** Get all actors at a cell position.
   *
   * OpenRA 对照: ActorMap.GetActorsAt(CPos)
   */
  getActorsAt(cell: CPos): IGameActor[]
}

/** Minimal building influence abstraction.
 *
 * OpenRA 对照: BuildingInfluence (subset: AnyBuildingAt)
 */
export interface IBuildingUtilsInfluence {
  /** Check if any building occupies a cell.
   *
   * OpenRA 对照: BuildingInfluence.AnyBuildingAt(CPos)
   */
  anyBuildingAt(cell: CPos): boolean
}

/** Actor info trait query interface (for checking Replaceable/Replacement types).
 *
 * OpenRA 对照: ActorInfo.HasTraitInfo / TraitInfos
 *
 * NOTE: This is a minimal interface. The full ActorInfo is not yet migrated
 * for all trait queries; BuildingUtils only needs trait info existence checks.
 */
export interface IBuildingUtilsActorInfo {
  /** Unique actor type name.
   *
   * OpenRA 对照: ActorInfo.Name
   */
  readonly name: string

  /** Check if this actor type defines a specific trait info.
   *
   * OpenRA 对照: ActorInfo.HasTraitInfo<T>()
   *
   * @param traitName — the trait class name (e.g., "ReplacementInfo")
   */
  hasTraitInfo(traitName: string): boolean

  /** Get all instances of a specific trait info from this actor type.
   *
   * OpenRA 对照: ActorInfo.TraitInfos<T>()
   *
   * @param traitName — the trait class name to query
   * @returns array of trait info objects (or empty)
   */
  getTraitInfos(traitName: string): readonly ITraitInfoForQuery[]

  /** Get the BuildingInfo for this actor type, if available.
   *
   * OpenRA 对照: ActorInfo.TraitInfo<BuildingInfo>()
   *
   * Optional method used by getLineBuildCells to get the segment's own
   * BuildingInfo for placement validation.
   *
   * MAJOR fix (segment building resolution): enables using the segment's
   * actual BuildingInfo instead of always falling back to the parent's.
   *
   * @returns the BuildingInfo, or undefined if this actor has none
   */
  getBuildingInfo?(): BuildingInfo
}

/** A minimal trait info with a name and types property.
 *
 * OpenRA 对照: trait info with Types / ReplaceableTypes sets
 *
 * Used for ReplacementInfo and ReplaceableInfo queries.
 */
export interface ITraitInfoForQuery {
  /** The trait info class name.
   *
   * OpenRA 对照: N/A (C# uses typeof/reflection)
   */
  readonly traitName: string

  /** Type tags from this trait (optional — only some traits have types).
   *
   * OpenRA 对照: ReplacementInfo.ReplaceableTypes / ReplaceableInfo.Types
   */
  readonly types?: ReadonlySet<string>

  /** Replacement-specific type tags (optional).
   *
   * OpenRA 对照: ReplacementInfo.ReplaceableTypes
   */
  readonly replaceableTypes?: ReadonlySet<string>
}

/** Extended game actor with trait iteration and richer actor info.
 *
 * OpenRA 对照: Actor.TraitsImplementing<T>() + Actor.Info
 *
 * NOTE: Overrides IGameActor.info from ActorInfoStub to IBuildingUtilsActorInfo
 * for trait query support. IBuildingUtilsActorInfo is structurally compatible
 * (both have `name: string`), so this narrowing is safe.
 */
export interface IBuildingUtilsActor extends Omit<IGameActor, 'info'> {
  /** Actor type info with trait query support.
   *
   * OpenRA 对照: Actor.Info
   */
  info?: IBuildingUtilsActorInfo

  /** Get all trait instances of a given type from this actor.
   *
   * OpenRA 对照: Actor.TraitsImplementing<T>()
   *
   * @param traitName — the trait class name (e.g., "Replaceable")
   * @returns iterable of trait instances (or empty)
   */
  getTraitsImplementing(traitName: string): Iterable<IBuildingUtilsTrait>
}

/** Minimal trait instance with info and disabled check.
 *
 * OpenRA 对照: Replaceable trait (subset: IsTraitDisabled, Info)
 */
export interface IBuildingUtilsTrait {
  /** Whether this trait is currently disabled by conditions.
   *
   * OpenRA 对照: ConditionalTrait.IsTraitDisabled
   */
  readonly isTraitDisabled: boolean

  /** The trait's configuration info.
   *
   * OpenRA 对照: T.Info
   */
  readonly info: ITraitInfoForQuery
}

/** Complete world abstraction for building placement validation.
 *
 * OpenRA 对照: World (subset for BuildingUtils)
 *
 * Bundles map, actor map, and building influence into a single object
 * for convenience (matching the C# extension method pattern).
 */
export interface IBuildingUtilsWorld {
  map: IBuildingUtilsMap
  actorMap: IBuildingUtilsActorMap
  buildingInfluence: IBuildingUtilsInfluence
}

// ---------------------------------------------------------------------------
// LineBuild minimal interfaces (getLineBuildCells dependencies)
// OpenRA 对照: LineBuildInfo, LineBuildNodeInfo subsets
// ---------------------------------------------------------------------------

/** Minimal LineBuildInfo for getLineBuildCells.
 *
 * OpenRA 对照: LineBuildInfo.Range, NodeTypes, SegmentType
 */
export interface ILineBuildInfoQuery {
  /** Maximum search range from the placement point.
   *
   * OpenRA 对照: LineBuildInfo.Range
   */
  readonly range: number

  /** Node types to attach to.
   *
   * OpenRA 对照: LineBuildInfo.NodeTypes
   */
  readonly nodeTypes: ReadonlySet<string>

  /** Optional segment actor type name (defaults to null for same type).
   *
   * OpenRA 对照: LineBuildInfo.SegmentType
   */
  readonly segmentType: string | null
}

/** Minimal rules access for segment type lookup.
 *
 * OpenRA 对照: Map.Rules.Actors[name]
 */
export interface IBuildingUtilsRules {
  /** Look up an actor info by name.
   *
   * OpenRA 对照: Ruleset.Actors indexer
   */
  getActorInfo(name: string): IBuildingUtilsActorInfo | undefined
}

/** Minimal shroud abstraction for visibility checks.
 *
 * OpenRA 对照: Shroud.IsExplored(CPos)
 *
 * NOTE: Full Shroud implementation is Chapter 12.
 * This interface allows the shroud check to be stubbed.
 */
export interface IBuildingUtilsShroud {
  /** Check if a cell has been explored (visible or previously seen).
   *
   * OpenRA 对照: Shroud.IsExplored(CPos)
   */
  isExplored(cell: CPos): boolean
}

// ---------------------------------------------------------------------------
// LineBuild result types
// OpenRA 对照: IEnumerable<(CPos Cell, Actor Actor)>
// ---------------------------------------------------------------------------

/** A single result from getLineBuildCells.
 *
 * OpenRA 对照: (CPos Cell, Actor Actor) value tuple
 */
export interface LineBuildCellResult {
  /** The cell position for this line segment. */
  cell: CPos

  /** The connector actor, or null for the initial placement cell.
   *
   * OpenRA 对照: Actor field in value tuple (nullable for initial cell)
   */
  connector: IGameActor | null
}

// ---------------------------------------------------------------------------
// BuildingUtils — static placement validation and line-building logic
// OpenRA 对照: public static class BuildingUtils
// ---------------------------------------------------------------------------

/**
 * Static utility class providing building placement validation
 * and wall line-building logic.
 *
 * OpenRA 对照: public static class BuildingUtils
 *
 * All methods are stateless and operate on the provided world interface,
 * enabling easy unit testing without needing a full Game runtime.
 */
export class BuildingUtils {
  // ---------------------------------------------------------------------------
  // isCellBuildable
  // OpenRA 对照: IsCellBuildable(this World, CPos, ActorInfo, BuildingInfo, Actor)
  // ---------------------------------------------------------------------------

  /**
   * Check whether a single map cell is valid for building placement.
   *
   * OpenRA 对照: BuildingUtils.IsCellBuildable(World, CPos, ActorInfo, BuildingInfo, Actor)
   *
   * Validation checks (in order):
   * 1. Map bounds: cell must be within the playable map area
   * 2. Actor occupancy: no blocking actors at the cell (with replacement exceptions)
   * 3. Building influence: no existing building at the cell
   * 4. Terrain type: cell terrain must match allowed terrain types (if set)
   * 5. Ramp: no buildings on ramp cells
   *
   * ## Replacement mechanic
   *
   * If `actorInfo` has a `ReplacementInfo` trait, actors with a `Replaceable`
   * trait at the cell may be skipped if the `Replacement.ReplaceableTypes`
   * overlap with the `Replaceable.Types` of the occupying actor.
   *
   * This allows support structures to be replaced by concrete slabs,
   * fortifications to replace weaker walls, etc.
   *
   * @param world — the world object providing map, actor map, and influence
   * @param cell — the cell position to check
   * @param actorInfo — the info of the actor being placed (may be null for
   *                    simple checks without replacement logic)
   * @param buildingInfo — the building's placement configuration
   * @param toIgnore — an actor to skip during occupancy checks (e.g., the
   *                   building under construction itself)
   * @returns true if the cell can be built on
   */
  static isCellBuildable(
    world: IBuildingUtilsWorld,
    cell: CPos,
    actorInfo: IBuildingUtilsActorInfo | null,
    buildingInfo: BuildingInfo,
    toIgnore: IGameActor | null = null,
  ): boolean {
    // 1. Map bounds check
    if (!world.map.contains(cell)) return false

    // 2. Actor occupancy check (with replacement logic)
    if (!buildingInfo.allowInvalidPlacement) {
      // Check if replacement logic is needed (avoid work if not applicable)
      const checkReplacements =
        actorInfo !== null && actorInfo.hasTraitInfo('ReplacementInfo')

      let acceptedReplacements: Set<string> | null = null
      let foundActors = false

      for (const a of world.actorMap.getActorsAt(cell)) {
        if (a === toIgnore) continue

        // If this is potentially a replacement actor, we must check *all*
        // cell occupants before deciding placement is invalid.
        // Otherwise, bail immediately.
        if (!checkReplacements) return false

        foundActors = true
        const buildingActor = a as IBuildingUtilsActor
        if (typeof buildingActor.getTraitsImplementing !== 'function') {
          // Actor without trait iteration capability — fail safe
          return false
        }

        for (const r of buildingActor.getTraitsImplementing('Replaceable')) {
          if (r.isTraitDisabled) continue

          if (!acceptedReplacements) {
            acceptedReplacements = new Set()
          }

          if (r.info.types) {
            for (const t of r.info.types) {
              acceptedReplacements.add(t)
            }
          }
        }
      }

      // Check building influence (bib occupancy)
      const foundBuilding = world.buildingInfluence.anyBuildingAt(cell)
      if (foundActors || foundBuilding) {
        // The cell contains at least one actor/building, and none were replaceable
        if (acceptedReplacements === null) return false

        // The cell contains at least one replaceable actor, but not of the
        // accepted types for this Replacement
        if (!actorInfo) return false
        const replacementInfos = actorInfo.getTraitInfos('ReplacementInfo')
        let foundReplacement = false
        for (const ri of replacementInfos) {
          if (ri.replaceableTypes && acceptedReplacements.size > 0) {
            // Check for overlap between Replacement.replaceableTypes and
            // the set of accepted Replaceable types
            for (const rt of ri.replaceableTypes) {
              if (acceptedReplacements.has(rt)) {
                foundReplacement = true
                break
              }
            }
          }
          if (foundReplacement) break
        }

        if (!foundReplacement) return false
      }
    } else {
      // HACK: To preserve legacy behaviour, AllowInvalidPlacement should
      // display red placement indicators if (and only if) there is a
      // building or bib in the cell.
      // OpenRA 对照: AllowInvalidPlacement check — buildingAt → red indicator
      if (world.buildingInfluence.anyBuildingAt(cell)) return false
    }

    // 3. Terrain type check
    // Buildings can never be placed on ramps
    const rampValue =
      world.map.ramp.contains(cell) ? world.map.ramp.get(cell) : 0
    if (rampValue !== 0) return false

    const terrainType = world.map.getTerrainInfo(cell).type
    if (buildingInfo.terrainTypes.size > 0) {
      if (!buildingInfo.terrainTypes.has(terrainType)) return false
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // canPlaceBuilding
  // OpenRA 对照: CanPlaceBuilding(this World, CPos, ActorInfo, BuildingInfo, Actor)
  // ---------------------------------------------------------------------------

  /**
   * Check if a full building footprint can be placed at the given position.
   *
   * OpenRA 对照: BuildingUtils.CanPlaceBuilding(World, CPos, ActorInfo, BuildingInfo, Actor)
   *
   * If `allowInvalidPlacement` is true, this always returns true
   * (placement is allowed anywhere regardless of occupancy/terrain).
   *
   * Otherwise, iterates all footprint tiles and validates each one
   * via `isCellBuildable()`.
   *
   * @param world — the world object providing map, actor map, and influence
   * @param topLeft — the top-left cell of the building footprint
   * @param actorInfo — the info of the actor being placed
   * @param buildingInfo — the building's placement configuration
   * @param toIgnore — an actor to skip during occupancy checks
   * @returns true if all footprint cells are buildable
   */
  static canPlaceBuilding(
    world: IBuildingUtilsWorld,
    topLeft: CPos,
    actorInfo: IBuildingUtilsActorInfo,
    buildingInfo: BuildingInfo,
    toIgnore: IGameActor | null = null,
  ): boolean {
    if (buildingInfo.allowInvalidPlacement) return true

    return buildingInfo
      .tiles(topLeft)
      .every(
        (t) =>
          world.map.contains(t) &&
          BuildingUtils.isCellBuildable(world, t, actorInfo, buildingInfo, toIgnore),
      )
  }

  // ---------------------------------------------------------------------------
  // getLineBuildCells
  // OpenRA 对照: GetLineBuildCells(World, CPos, ActorInfo, BuildingInfo, Player)
  // ---------------------------------------------------------------------------

  /**
   * Find cells and connector actors for wall line-building.
   *
   * OpenRA 对照: BuildingUtils.GetLineBuildCells(World, CPos, ActorInfo, BuildingInfo, Player)
   *
   * Searches in four cardinal directions from the placement point to find
   * existing `LineBuildNode` connectors. Returns intermediate cells for
   * line segments and the connector actors found at the ends of each direction.
   *
   * ## Algorithm
   * 1. Yield the placement cell if it is buildable
   * 2. For each cardinal direction (right, down, left, up):
   *    a. Step outward up to `lineBuildInfo.range`
   *    b. If cell is buildable or unexplored, continue searching
   *    c. If cell contains an actor with matching `LineBuildNodeInfo`, record it
   *    d. Yield all intermediate cells with the found connector
   *
   * ## Limitations (Phase B)
   * - Shroud visibility check uses the provided `shroud` interface; if null,
   *   unexplored cells are treated as buildable (conservative default)
   * - Segment type lookup uses the provided `rules` interface
   * - Only searches ground layer (layer 0)
   *
   * @param world — the world object with map, actor map, and influence
   * @param topLeft — the initial placement cell (1x1 assumption)
   * @param actorInfo — the info of the actor being placed
   * @param buildingInfo — the building's placement configuration
   * @param lineBuildInfo — the LineBuild trait info (range, node types, segment type)
   * @param rules — ruleset for actor type lookup (may be null if no segment type)
   * @param shroud — shroud for visibility checks (may be null — treats all as explored)
   * @returns array of (cell, connector) results for line segments
   */
  static getLineBuildCells(
    world: IBuildingUtilsWorld,
    topLeft: CPos,
    actorInfo: IBuildingUtilsActorInfo,
    buildingInfo: BuildingInfo,
    lineBuildInfo: ILineBuildInfoQuery,
    rules: IBuildingUtilsRules | null = null,
    shroud: IBuildingUtilsShroud | null = null,
  ): LineBuildCellResult[] {
    const results: LineBuildCellResult[] = []

    // Yield the placement cell if buildable (always yield as initial cell)
    if (BuildingUtils.isCellBuildable(world, topLeft, actorInfo, buildingInfo)) {
      results.push({ cell: topLeft, connector: null })
    }

    // Search in four cardinal directions
    // OpenRA 对照: vecs = [new CVec(1,0), new CVec(0,1), new CVec(-1,0), new CVec(0,-1)]
    const vecs: readonly CVec[] = [
      new CVec(1, 0),
      new CVec(0, 1),
      new CVec(-1, 0),
      new CVec(0, -1),
    ]
    const dirs: (number | undefined)[] = [undefined, undefined, undefined, undefined]
    const connectors: (IGameActor | null)[] = [null, null, null, null]

    for (let d = 0; d < 4; d++) {
      for (let i = 1; i < lineBuildInfo.range; i++) {
        if (dirs[d] !== undefined && dirs[d] !== 0) continue

        // Resolve segment actor info (different type, or same as parent)
        let segmentAi = actorInfo
        let segmentBi = buildingInfo
        if (lineBuildInfo.segmentType && lineBuildInfo.segmentType !== '') {
          if (!rules) {
            // Cannot resolve segment type without rules — skip direction
            break
          }
          const segmentInfo = rules.getActorInfo(lineBuildInfo.segmentType)
          if (!segmentInfo) break

          segmentAi = segmentInfo
          // Get BuildingInfo from segment type
          const segBuildingInfos = segmentInfo.getTraitInfos('BuildingInfo')
          if (segBuildingInfos.length === 0) break

          // MAJOR fix: use the segment's own BuildingInfo for placement
          // validation (terrain types, allowInvalidPlacement, etc.) when
          // available via getBuildingInfo(). Only fall back to the parent's
          // buildingInfo if the segment actor genuinely has no concrete
          // BuildingInfo instance.
          segmentBi = typeof segmentInfo.getBuildingInfo === 'function'
            ? segmentInfo.getBuildingInfo()
            : buildingInfo
        }

        const c = CPos.add(topLeft, new CVec(i * vecs[d].X, i * vecs[d].Y))

        // Continue searching if cell is buildable or not visible
        if (
          BuildingUtils.isCellBuildable(world, c, segmentAi, segmentBi) ||
          (shroud ? !shroud.isExplored(c) : false)
        ) {
          continue
        }

        // Cell contains an actor — check if it has a matching LineBuildNode
        const actorsAtCell = world.actorMap.getActorsAt(c)
        for (const a of actorsAtCell) {
          const actor = a as IBuildingUtilsActor
          if (!actor.info) continue

          const nodeInfos = actor.info.getTraitInfos('LineBuildNodeInfo')
          for (const ni of nodeInfos) {
            // Check if node types overlap with line build types
            const nodeTypes = ni.types
            if (nodeTypes) {
              let typeMatches = false
              for (const nt of nodeTypes) {
                if (lineBuildInfo.nodeTypes.has(nt)) {
                  typeMatches = true
                  break
                }
              }
              if (!typeMatches) continue
            }

            // Check if the connection direction is valid for this node
            // NOTE: Connections on LineBuildNodeInfo is `connections: readonly CVec[]`.
            // We need to check if `vecs[d]` (the direction we searched) is in
            // the node's connection list.
            // The `connections` field is a concrete property of
            // LineBuildNodeInfo, which implements ITraitInfoForQuery.
            // We access it via a narrow interface cast.
            const nodeConnections = (
              ni as ITraitInfoForQuery & { connections?: readonly CVec[] }
            ).connections
            if (nodeConnections && nodeConnections.length > 0) {
              let connectionFound = false
              for (const conn of nodeConnections) {
                if (conn.X === vecs[d].X && conn.Y === vecs[d].Y) {
                  connectionFound = true
                  break
                }
              }
              if (!connectionFound) continue
            }

            // Found a matching connector
            connectors[d] = a
            break
          }
          if (connectors[d] !== null) break
        }

        dirs[d] = connectors[d] !== null ? i : -1
      }

      // Place intermediate line sections
      if (dirs[d] !== undefined && dirs[d] !== -1 && dirs[d] !== 0) {
        for (let i = 1; i < (dirs[d] as number); i++) {
          const cell = CPos.add(
            topLeft,
            new CVec(i * vecs[d].X, i * vecs[d].Y),
          )
          results.push({ cell, connector: connectors[d] })
        }
      }
    }

    return results
  }
}
