/**
 * RequiresBuildableArea.ts — 标记 trait，该 actor 需要附近存在具有 GivesBuildableArea
 *   的 actor 才能放置
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/RequiresBuildableArea.cs (30 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<RequiresBuildableArea> → TS ITraitInfo 接口实现
 * - C# FrozenSet<string> → TS ReadonlySet<string>
 * - C# [FieldLoader.Require] → JSDoc 文档说明 (JSON Schema 在构建时验证)
 * - C# Requires<BuildingInfo> → JSDoc 依赖说明 (TS 无编译时 trait 约束)
 */

import type { ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// RequiresBuildableAreaInfo
// OpenRA 对照: RequiresBuildableAreaInfo : TraitInfo<RequiresBuildableArea>,
//   Requires<BuildingInfo>
// ---------------------------------------------------------------------------

/** Configuration for the RequiresBuildableArea trait.
 *
 * OpenRA 对照: RequiresBuildableAreaInfo
 *
 * This actor requires another actor with 'GivesBuildableArea' trait nearby
 * to be placed. The intersection of AreaTypes between this trait and the
 * provider's GivesBuildableArea must be non-empty.
 */
export class RequiresBuildableAreaInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Types of buildable area this actor requires.
   *
   * OpenRA 对照: RequiresBuildableAreaInfo.AreaTypes (FrozenSet<string>)
   *
   * [FieldLoader.Require] — this field must be explicitly configured.
   */
  readonly areaTypes: ReadonlySet<string>

  /** Maximum range from the provider with 'GivesBuildableArea' this can be
   * placed at.
   *
   * OpenRA 对照: RequiresBuildableAreaInfo.Adjacent (int, default 2)
   */
  readonly adjacent: number

  constructor(params: {
    instanceName?: string
    areaTypes?: readonly string[]
    adjacent?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.areaTypes = new Set(params.areaTypes ?? [])
    this.adjacent = params.adjacent ?? 2
  }
}

// ---------------------------------------------------------------------------
// RequiresBuildableArea
// OpenRA 对照: RequiresBuildableArea (empty marker)
// ---------------------------------------------------------------------------

/** Marker trait indicating this actor requires a buildable area provider nearby.
 *
 * OpenRA 对照: RequiresBuildableArea
 *
 * This is an empty marker trait. The placement logic checks for this trait
 * and uses the corresponding RequiresBuildableAreaInfo to determine valid
 * placement positions relative to GivesBuildableArea providers.
 */
export class RequiresBuildableArea {
  // intentionally empty — marker trait
}
