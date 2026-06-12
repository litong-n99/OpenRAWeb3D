/**
 * FirepowerMultiplier.ts -- Percentage modifier for weapon damage
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Multipliers/FirepowerMultiplier.cs (31 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<FirepowerMultiplierInfo> implementing IFirepowerModifier
 *   → TS ConditionalTrait<FirepowerMultiplierInfo> implementing IFirepowerModifier
 */

import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { type IFirepowerModifier, type IFirepowerModifierInfo } from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// FirepowerMultiplierInfo
// OpenRA 对照: FirepowerMultiplierInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for FirepowerMultiplier trait.
 *
 *  OpenRA 对照: FirepowerMultiplierInfo
 */
export class FirepowerMultiplierInfo implements IFirepowerModifierInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Percentage modifier to apply (100 = 100%, no change).
   *
   *  OpenRA 对照: FirepowerMultiplierInfo.Modifier
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

  /** Get the default firepower modifier for ruleset-loaded computation.
   *
   *  OpenRA 对照: IFirepowerModifierInfo.GetFirepowerModifierDefault()
   */
  getFirepowerModifierDefault(): number {
    return this.enabledByDefault ? this.modifier : 100
  }
}

// ---------------------------------------------------------------------------
// FirepowerMultiplier
// OpenRA 对照: FirepowerMultiplier
// ---------------------------------------------------------------------------

/** Modifies the damage applied by this actor.
 *
 *  OpenRA 对照: FirepowerMultiplier (ConditionalTrait<FirepowerMultiplierInfo>, IFirepowerModifier)
 */
export class FirepowerMultiplier
  extends ConditionalTrait<FirepowerMultiplierInfo>
  implements IFirepowerModifier
{
  constructor(info: FirepowerMultiplierInfo) {
    super(info)
  }

  /** Get the current firepower modifier percentage.
   *
   *  OpenRA 对照: IFirepowerModifier.GetFirepowerModifier()
   *
   *  Returns 100 (no modification) when trait is disabled.
   */
  getFirepowerModifier(): number {
    return this.isTraitDisabled ? 100 : this.info.modifier
  }
}
