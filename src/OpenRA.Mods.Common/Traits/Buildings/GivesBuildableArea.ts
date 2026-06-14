/**
 * GivesBuildableArea.ts — 标记 trait，该 actor 允许在其周围放置需要
 * RequiresBuildableArea 的其他 actor
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/GivesBuildableArea.cs (33 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<GivesBuildableAreaInfo> → TS ConditionalTrait<GivesBuildableAreaInfo>
 * - C# FrozenSet<string> → TS ReadonlySet<string>
 * - C# AreaTypes 属性在 trait 禁用时返回空 Set → 同一语义
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// GivesBuildableAreaInfo
// OpenRA 对照: GivesBuildableAreaInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the GivesBuildableArea trait.
 *
 * OpenRA 对照: GivesBuildableAreaInfo
 *
 * Defines the area types provided by this actor for adjacent building placement.
 */
export class GivesBuildableAreaInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Types of buildable area this actor gives.
   *
   * OpenRA 对照: GivesBuildableAreaInfo.AreaTypes (FrozenSet<string>)
   *
   * [FieldLoader.Require] — this field must be explicitly configured.
   */
  readonly areaTypes: ReadonlySet<string>

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    areaTypes?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.areaTypes = new Set(params.areaTypes ?? [])
  }
}

// ---------------------------------------------------------------------------
// GivesBuildableArea
// OpenRA 对照: GivesBuildableArea : ConditionalTrait<GivesBuildableAreaInfo>
// ---------------------------------------------------------------------------

/** Marker trait indicating this actor provides buildable area for adjacent
 * building placement.
 *
 * OpenRA 对照: GivesBuildableArea
 *
 * Other actors with RequiresBuildableArea must overlap an AreaTypes tag
 * with this actor's AreaTypes to be placed.
 */
export class GivesBuildableArea extends ConditionalTrait<GivesBuildableAreaInfo> {
  constructor(info: GivesBuildableAreaInfo) {
    super(info)
  }

  /** The set of area types provided by this actor.
   *
   * OpenRA 对照: GivesBuildableArea.AreaTypes
   *
   * Returns the configured AreaTypes when the trait is enabled, or an empty
   * Set when disabled (conditions not met).
   */
  get areaTypes(): ReadonlySet<string> {
    return this.isTraitDisabled ? new Set() : this.info.areaTypes
  }
}
