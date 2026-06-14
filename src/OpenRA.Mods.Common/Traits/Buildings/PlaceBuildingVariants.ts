/**
 * PlaceBuildingVariants.ts — 建筑放置变体切换：在放置建筑时通过热键在不同变体
 *   建筑之间循环切换
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/PlaceBuildingVariants.cs (32 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<PlaceBuildingVariants> → TS ITraitInfo 接口实现
 * - C# ImmutableArray<string> → TS readonly string[]
 * - C# ImmutableArray<WAngle> → TS readonly WAngle[]
 * - C# [FieldLoader.Require] → JSDoc 文档说明 (JSON Schema 在构建时验证)
 * - C# Requires<BuildingInfo>, Requires<BuildableInfo> → JSDoc 依赖说明
 * - C# Create(ActorInitializer) → TS constructor (直接构造，无需工厂方法)
 */

import type { ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WAngle } from '../../../OpenRA.Game/WAngle.js'

// ---------------------------------------------------------------------------
// PlaceBuildingVariantsInfo
// OpenRA 对照: PlaceBuildingVariantsInfo : TraitInfo<PlaceBuildingVariants>,
//   Requires<BuildingInfo>, Requires<BuildableInfo>
// ---------------------------------------------------------------------------

/** Configuration for the PlaceBuildingVariants trait.
 *
 * OpenRA 对照: PlaceBuildingVariantsInfo
 *
 * When PlaceBuilding's ToggleVariantKey hotkey is pressed while the
 * PlaceBuildingOrderGenerator is active, cycles to a different building
 * variant as defined by the Actors list. Each variant can have a
 * different facing.
 */
export class PlaceBuildingVariantsInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Variant actor names that can be cycled between when placing a structure.
   *
   * OpenRA 对照: PlaceBuildingVariantsInfo.Actors (ImmutableArray<string>)
   *
   * [FieldLoader.Require] — this field must be explicitly configured.
   * [ActorReference(typeof(BuildingInfo))] — each string references a
   *   building actor type.
   */
  readonly actors: readonly string[]

  /** Facing of the non-variant actor, followed by facings for each variant
   * actor. The length equals the length of Actors + 1.
   *
   * OpenRA 对照: PlaceBuildingVariantsInfo.Facings (ImmutableArray<WAngle>)
   *
   * [FieldLoader.Require] — this field must be explicitly configured.
   * Index 0 is the facing for the base actor; indices 1..n are the facings
   * for each corresponding variant in the Actors array.
   */
  readonly facings: readonly WAngle[]

  constructor(params: {
    instanceName?: string
    actors?: readonly string[]
    facings?: readonly WAngle[]
  } = {}) {
    this.instanceName = params.instanceName
    this.actors = params.actors ?? []
    this.facings = params.facings ?? []
  }
}

// ---------------------------------------------------------------------------
// PlaceBuildingVariants
// OpenRA 对照: PlaceBuildingVariants (empty marker)
// ---------------------------------------------------------------------------

/** Marker trait enabling building variant cycling during placement.
 *
 * OpenRA 对照: PlaceBuildingVariants
 *
 * This is an empty marker trait. The placement logic (PlaceBuildingOrderGenerator)
 * checks for this trait and uses the corresponding PlaceBuildingVariantsInfo
 * to determine which variant actors to cycle through and their facings.
 */
export class PlaceBuildingVariants {
  // intentionally empty — marker trait
}
