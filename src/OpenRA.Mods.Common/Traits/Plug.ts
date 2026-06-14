/**
 * Plug.ts — 插头标记 trait（建筑连接器）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Plug.cs (24 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<Plug> → TS ITraitInfo interface
 * - C# string Type (default null) → TS string | null
 */

import type { ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// PlugInfo
// OpenRA 对照: PlugInfo : TraitInfo<Plug>
// ---------------------------------------------------------------------------

/** Configuration for the Plug trait.
 *
 * OpenRA 对照: PlugInfo
 *
 * Defines the plug type identifier. Pluggable actors match against this
 * type string to determine if a plug can be enabled.
 */
export class PlugInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Plug type (matched against Conditions in Pluggable).
   *
   * OpenRA 对照: PlugInfo.Type
   *
   * [FieldLoader.Require] — must be explicitly configured.
   */
  readonly type: string | null = null

  constructor(params: {
    instanceName?: string
    type?: string | null
  } = {}) {
    this.instanceName = params.instanceName
    this.type = params.type ?? null
  }
}

// ---------------------------------------------------------------------------
// Plug
// OpenRA 对照: Plug (empty marker)
// ---------------------------------------------------------------------------

/** Marker trait indicating this actor can act as a plug connector for
 * Pluggable buildings.
 *
 * OpenRA 对照: Plug
 *
 * All configuration is in PlugInfo. This class has no runtime logic.
 */
export class Plug {
  // intentionally empty — marker trait
}
