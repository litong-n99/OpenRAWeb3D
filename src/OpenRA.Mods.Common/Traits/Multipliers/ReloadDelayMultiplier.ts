/**
 * ReloadDelayMultiplier.ts -- Percentage modifier for weapon reload time
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Multipliers/ReloadDelayMultiplier.cs (31 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<ReloadDelayMultiplierInfo> implementing IReloadModifier
 *   → TS ConditionalTrait<ReloadDelayMultiplierInfo> implementing IReloadModifier
 * - C# Modifier field default 100 → TS default 100
 * - When disabled (conditions not met), returns 100 (no modification)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type IReloadModifier,
  type IReloadModifierInfo,
} from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// ReloadDelayMultiplierInfo
// OpenRA 对照: ReloadDelayMultiplierInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for ReloadDelayMultiplier trait.
 *
 *  OpenRA 对照: ReloadDelayMultiplierInfo
 */
export class ReloadDelayMultiplierInfo implements ConditionalTraitInfo, IReloadModifierInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Percentage modifier to apply (100 = 100%, no change).
   *
   *  OpenRA 对照: ReloadDelayMultiplierInfo.Modifier
   */
  readonly modifier: number = 100

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    modifier?: number
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.modifier = params.modifier ?? 100
    this.enabledByDefault = params.enabledByDefault ?? true
  }

  /** Get the default reload modifier for ruleset-loaded computation.
   *
   *  OpenRA 对照: IReloadModifierInfo.GetReloadModifierDefault()
   */
  getReloadModifierDefault(): number {
    return this.enabledByDefault ? this.modifier : 100
  }
}

// ---------------------------------------------------------------------------
// ReloadDelayMultiplier
// OpenRA 对照: ReloadDelayMultiplier
// ---------------------------------------------------------------------------

/** Modifies the reload time of weapons fired by this actor.
 *
 *  OpenRA 对照: ReloadDelayMultiplier (ConditionalTrait<ReloadDelayMultiplierInfo>, IReloadModifier)
 */
export class ReloadDelayMultiplier
  extends ConditionalTrait<ReloadDelayMultiplierInfo>
  implements IReloadModifier
{
  constructor(info: ReloadDelayMultiplierInfo) {
    super(info)
  }

  /** Get the current reload modifier percentage.
   *
   *  OpenRA 对照: IReloadModifier.GetReloadModifier()
   *
   *  @returns percentage modifier (100 = no change)
   */
  getReloadModifier(): number {
    return this.isTraitDisabled ? 100 : this.info.modifier
  }
}
