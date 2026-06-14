/**
 * Replacement.ts — 替代 actor 的配置标记 trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Replacement.cs (25 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<Replacement> → TS ITraitInfo interface
 * - C# FrozenSet<string> → TS ReadonlySet<string>
 *
 * Replacement 是空标记 trait，其配置信息（Info）定义了该 actor 可以
 * 替代哪些 Replaceable actor 类型。
 */

import type { ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ReplacementInfo
// OpenRA 对照: ReplacementInfo : TraitInfo<Replacement>
// ---------------------------------------------------------------------------

/** Configuration for the Replacement trait.
 *
 * OpenRA 对照: ReplacementInfo
 *
 * Defines which Replaceable types this actor can replace when placed.
 * Match is made against Replaceable.Types via set intersection.
 */
export class ReplacementInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Replacement type tags (matched against Types in Replaceable).
   *
   * OpenRA 对照: ReplacementInfo.ReplaceableTypes
   *
   * [FieldLoader.Require] — must be explicitly configured.
   */
  readonly replaceableTypes: ReadonlySet<string>

  constructor(params: {
    instanceName?: string
    replaceableTypes?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.replaceableTypes = new Set(params.replaceableTypes ?? [])
  }
}

// ---------------------------------------------------------------------------
// Replacement
// OpenRA 对照: Replacement (empty marker)
// ---------------------------------------------------------------------------

/** Marker trait indicating this actor can replace other actors of matching
 * Replaceable types.
 *
 * OpenRA 对照: Replacement
 *
 * All configuration is in ReplacementInfo. This class has no runtime logic.
 */
export class Replacement {
  // intentionally empty — marker trait
}
