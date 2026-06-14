/**
 * Replaceable.ts — 可被替代的 actor 标记 trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Replaceable.cs (30 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<ReplaceableInfo> → TS ConditionalTrait<ReplaceableInfo>
 * - C# FrozenSet<string> → TS ReadonlySet<string>
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ReplaceableInfo
// OpenRA 对照: ReplaceableInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the Replaceable trait.
 *
 * OpenRA 对照: ReplaceableInfo
 *
 * Defines the replacement type tags this actor accepts. When a Replacement
 * actor is placed whose ReplaceableTypes intersect with this actor's Types,
 * this actor can be replaced.
 */
export class ReplaceableInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Replacement type tags this Replaceable actor accepts.
   *
   * OpenRA 对照: ReplaceableInfo.Types
   *
   * [FieldLoader.Require] — must be explicitly configured.
   */
  readonly types: ReadonlySet<string>

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    types?: readonly string[]
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.types = new Set(params.types ?? [])
  }
}

// ---------------------------------------------------------------------------
// Replaceable
// OpenRA 对照: Replaceable : ConditionalTrait<ReplaceableInfo>
// ---------------------------------------------------------------------------

/** Marker trait indicating this actor can be replaced by a Replacement actor.
 *
 * OpenRA 对照: Replaceable
 *
 * All configuration is in ReplaceableInfo. This trait extends ConditionalTrait
 * so replacement eligibility can be controlled via conditions.
 */
export class Replaceable extends ConditionalTrait<ReplaceableInfo> {
  constructor(info: ReplaceableInfo) {
    super(info)
  }
}
