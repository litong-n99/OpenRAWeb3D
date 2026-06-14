/**
 * BaseBuilding.ts — 标记 trait，用于识别建筑工厂（construction yard / MCV）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/BaseBuilding.cs (19 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<BaseBuilding> → TS ITraitInfo 接口实现
 * - C# 空类标记 trait → TS 空类标记 trait
 *
 * BaseBuilding 是一个纯标记 trait。被 "cycle bases" 快捷键用于识别
 * 建筑工厂（construction yard）和 MCV（移动基地车）。
 */

import type { ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// BaseBuildingInfo
// OpenRA 对照: BaseBuildingInfo : TraitInfo<BaseBuilding>
// ---------------------------------------------------------------------------

/** Configuration for the BaseBuilding trait.
 *
 * OpenRA 对照: BaseBuildingInfo
 *
 * Tag trait for construction yard and MCVs. Used by the cycle bases hotkey
 * to identify base-providing actors.
 */
export class BaseBuildingInfo implements ITraitInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }
}

// ---------------------------------------------------------------------------
// BaseBuilding
// OpenRA 对照: BaseBuilding (empty marker)
// ---------------------------------------------------------------------------

/** Marker trait identifying this actor as a base (construction yard / MCV).
 *
 * OpenRA 对照: BaseBuilding
 *
 * This is an empty marker trait. All semantics are in the hotkey handler
 * that queries for actors with BaseBuilding.
 */
export class BaseBuilding {
  // intentionally empty — marker trait
}
