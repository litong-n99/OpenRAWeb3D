/**
 * SpeedMultiplier.ts -- Percentage modifier for movement speed
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Multipliers/SpeedMultiplier.cs (31 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<SpeedMultiplierInfo> implementing ISpeedModifier
 *   → TS ConditionalTrait<SpeedMultiplierInfo> implementing ISpeedModifier
 * - C# Modifier field default 100 → TS modifier=100 (100% = no change)
 * - When disabled (conditions not met), returns 100 (no modification)
 * - Integration: Mobile.getSpeedModifiers() collects from all ISpeedModifier traits
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ISpeedModifier — interface for speed modifier traits
// OpenRA 对照: ISpeedModifier (OpenRA.Mods.Common/Traits/ISpeedModifier.cs)
// ---------------------------------------------------------------------------

/**
 * Speed modifier trait — modifies movement speed by a percentage.
 *
 * OpenRA 对照: ISpeedModifier
 *
 * Used by Mobile and Aircraft to collect speed modifiers from all traits
 * implementing this interface. Return 100 for no change, higher for faster,
 * lower for slower, 0 to stop (unreachable cost).
 */
export interface ISpeedModifier {
  /** Get the percentage speed modifier.
   *
   *  OpenRA 对照: ISpeedModifier.GetSpeedModifier()
   *
   *  @returns percentage modifier (100 = no change, 200 = 2x speed, 50 = half speed)
   */
  getSpeedModifier(): number
}

// ---------------------------------------------------------------------------
// SpeedMultiplierInfo
// OpenRA 对照: SpeedMultiplierInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for SpeedMultiplier trait.
 *
 *  OpenRA 对照: SpeedMultiplierInfo
 */
export class SpeedMultiplierInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Percentage modifier to apply (100 = 100%, no change).
   *
   *  OpenRA 对照: SpeedMultiplierInfo.Modifier
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
// SpeedMultiplier
// OpenRA 对照: SpeedMultiplier (ConditionalTrait<SpeedMultiplierInfo>, ISpeedModifier)
// ---------------------------------------------------------------------------

/** Modifies the movement speed of this actor.
 *
 *  OpenRA 对照: SpeedMultiplier
 *
 *  Use >100 to increase speed, <100 to decrease speed.
 *  Returns 100 (no modification) when trait is disabled.
 */
export class SpeedMultiplier
  extends ConditionalTrait<SpeedMultiplierInfo>
  implements ISpeedModifier
{
  constructor(info: SpeedMultiplierInfo) {
    super(info)
  }

  /** Get the current speed modifier percentage.
   *
   *  OpenRA 对照: ISpeedModifier.GetSpeedModifier()
   *
   *  @returns percentage modifier (100 = no change)
   */
  getSpeedModifier(): number {
    return this.isTraitDisabled ? 100 : this.info.modifier
  }
}
