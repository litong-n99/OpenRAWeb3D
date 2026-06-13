/**
 * InaccuracyMultiplier.ts -- Percentage modifier for weapon inaccuracy
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Multipliers/InaccuracyMultiplier.cs (31 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<InaccuracyMultiplierInfo> implementing IInaccuracyModifier
 *   → TS ConditionalTrait<InaccuracyMultiplierInfo> implementing IInaccuracyModifier
 * - C# Modifier field default 100 → TS default 100
 * - When disabled (conditions not met), returns 100 (no modification)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type IInaccuracyModifier,
  type IInaccuracyModifierInfo,
} from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// InaccuracyMultiplierInfo
// OpenRA 对照: InaccuracyMultiplierInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for InaccuracyMultiplier trait.
 *
 *  OpenRA 对照: InaccuracyMultiplierInfo
 */
export class InaccuracyMultiplierInfo implements ConditionalTraitInfo, IInaccuracyModifierInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Percentage modifier to apply (100 = 100%, no change).
   *
   *  OpenRA 对照: InaccuracyMultiplierInfo.Modifier
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

  /** Get the default inaccuracy modifier for ruleset-loaded computation.
   *
   *  OpenRA 对照: IInaccuracyModifierInfo.GetInaccuracyModifierDefault()
   */
  getInaccuracyModifierDefault(): number {
    return this.enabledByDefault ? this.modifier : 100
  }
}

// ---------------------------------------------------------------------------
// InaccuracyMultiplier
// OpenRA 对照: InaccuracyMultiplier
// ---------------------------------------------------------------------------

/** Modifies the inaccuracy of weapons fired by this actor.
 *
 *  OpenRA 对照: InaccuracyMultiplier (ConditionalTrait<InaccuracyMultiplierInfo>, IInaccuracyModifier)
 */
export class InaccuracyMultiplier
  extends ConditionalTrait<InaccuracyMultiplierInfo>
  implements IInaccuracyModifier
{
  constructor(info: InaccuracyMultiplierInfo) {
    super(info)
  }

  /** Get the current inaccuracy modifier percentage.
   *
   *  OpenRA 对照: IInaccuracyModifier.GetInaccuracyModifier()
   *
   *  @returns percentage modifier (100 = no change)
   */
  getInaccuracyModifier(): number {
    return this.isTraitDisabled ? 100 : this.info.modifier
  }
}
