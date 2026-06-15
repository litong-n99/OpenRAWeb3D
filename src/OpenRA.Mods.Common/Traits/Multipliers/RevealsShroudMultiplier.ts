/**
 * RevealsShroudMultiplier.ts -- Percentage modifier for shroud revelation range
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Multipliers/RevealsShroudMultiplier.cs (34 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<RevealsShroudMultiplierInfo> implementing IRevealsShroudModifier
 *   → TS ConditionalTrait<RevealsShroudMultiplierInfo> implementing IRevealsShroudModifier
 * - C# Modifier field default 100 → TS default 100
 * - When disabled (conditions not met), returns 100 (no modification)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IRevealsShroudModifier,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// RevealsShroudMultiplierInfo
// OpenRA 对照: RevealsShroudMultiplierInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for RevealsShroudMultiplier trait.
 *
 *  OpenRA 对照: RevealsShroudMultiplierInfo
 */
export class RevealsShroudMultiplierInfo implements ConditionalTraitInfo {
  readonly instanceName?: string

  /** Condition expression that controls whether this trait is active.
   *
   *  OpenRA 对照: ConditionalTraitInfo.RequiresCondition
   */
  readonly requiresCondition?: string

  /** Percentage modifier to apply (100 = 100%, no change).
   *
   *  OpenRA 对照: RevealsShroudMultiplierInfo.Modifier (FieldLoader.Require)
   */
  readonly modifier: number = 100

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    modifier?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.modifier = params.modifier ?? 100
  }
}

// ---------------------------------------------------------------------------
// RevealsShroudMultiplier
// OpenRA 对照: RevealsShroudMultiplier
// ---------------------------------------------------------------------------

/** Modifies the shroud range revealed by this actor.
 *
 *  OpenRA 对照: RevealsShroudMultiplier (ConditionalTrait<RevealsShroudMultiplierInfo>, IRevealsShroudModifier)
 *
 *  Returns 100 (no modification) when trait is disabled by conditions.
 *  Multiple multipliers stack multiplicatively when applied to a RevealsShroud range.
 */
export class RevealsShroudMultiplier
  extends ConditionalTrait<RevealsShroudMultiplierInfo>
  implements IRevealsShroudModifier
{
  static readonly interfaces: string[] = [
    'IRevealsShroudModifier',
    'ConditionalTrait',
    'component',
  ]

  constructor(info: RevealsShroudMultiplierInfo) {
    super(info)
  }

  /** Get the current shroud revelation modifier percentage.
   *
   *  OpenRA 对照: IRevealsShroudModifier.GetRevealsShroudModifier()
   *
   *  @returns percentage modifier (100 = no change, 200 = double range,
   *           50 = half range). Returns 100 when trait is disabled.
   */
  getRevealsShroudModifier(): number {
    return this.isTraitDisabled ? 100 : this.info.modifier
  }
}
