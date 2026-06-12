/**
 * RangeMultiplier.ts -- Percentage modifier for weapon range
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Multipliers/RangeMultiplier.cs (33 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<RangeMultiplierInfo> implementing IRangeModifier
 *   → TS ConditionalTrait<RangeMultiplierInfo> implementing IRangeModifier
 * - C# Modifier field default 100 → TS default 100
 * - When disabled (conditions not met), returns 100 (no modification)
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type IRangeModifier, type IRangeModifierInfo } from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// RangeMultiplierInfo
// OpenRA 对照: RangeMultiplierInfo (ConditionalTraitInfo, IRangeModifierInfo)
// ---------------------------------------------------------------------------

/** Configuration for RangeMultiplier trait.
 *
 *  OpenRA 对照: RangeMultiplierInfo
 */
export class RangeMultiplierInfo implements IRangeModifierInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Percentage modifier to apply (100 = 100%, no change).
   *
   *  OpenRA 对照: RangeMultiplierInfo.Modifier
   */
  readonly modifier: number = 100

  /** Whether this trait is enabled by default.
   *
   *  OpenRA 对照: (computed from EnabledByDefault logic)
   */
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

  /** Get the default range modifier for ruleset-loaded computation.
   *
   *  OpenRA 对照: IRangeModifierInfo.GetRangeModifierDefault()
   */
  getRangeModifierDefault(): number {
    return this.enabledByDefault ? this.modifier : 100
  }
}

// ---------------------------------------------------------------------------
// RangeMultiplier
// OpenRA 对照: RangeMultiplier
// ---------------------------------------------------------------------------

/** Modifies the range of weapons fired by this actor.
 *
 *  OpenRA 对照: RangeMultiplier (ConditionalTrait<RangeMultiplierInfo>, IRangeModifier)
 */
export class RangeMultiplier
  extends ConditionalTrait<RangeMultiplierInfo>
  implements IRangeModifier
{
  constructor(info: RangeMultiplierInfo) {
    super(info)
  }

  /** Get the current range modifier percentage.
   *
   *  OpenRA 对照: IRangeModifier.GetRangeModifier()
   *
   *  Returns 100 (no modification) when trait is disabled.
   */
  getRangeModifier(): number {
    return this.isTraitDisabled ? 100 : this.info.modifier
  }
}
