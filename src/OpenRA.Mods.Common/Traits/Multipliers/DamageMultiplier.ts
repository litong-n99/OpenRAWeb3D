/**
 * DamageMultiplier.ts -- Percentage modifier for incoming damage
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Multipliers/DamageMultiplier.cs (37 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<DamageMultiplierInfo> implementing IDamageModifier
 *   → TS ConditionalTrait<DamageMultiplierInfo> implementing IDamageModifier
 * - C# Modifier field default 100 → TS default 100
 * - When disabled (conditions not met), returns 100 (no modification)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type Damage,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  type IDamageModifier,
  type IDamageModifierInfo,
} from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// DamageMultiplierInfo
// OpenRA 对照: DamageMultiplierInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for DamageMultiplier trait.
 *
 *  OpenRA 对照: DamageMultiplierInfo
 */
export class DamageMultiplierInfo implements ConditionalTraitInfo, IDamageModifierInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Percentage modifier to apply (100 = 100%, no change).
   *
   *  OpenRA 对照: DamageMultiplierInfo.Modifier
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

  /** Get the default damage modifier for ruleset-loaded computation.
   *
   *  OpenRA 对照: IDamageModifierInfo.GetDamageModifierDefault()
   */
  getDamageModifierDefault(): number {
    return this.enabledByDefault ? this.modifier : 100
  }
}

// ---------------------------------------------------------------------------
// DamageMultiplier
// OpenRA 对照: DamageMultiplier
// ---------------------------------------------------------------------------

/** Modifies the damage applied to this actor.
 *
 *  OpenRA 对照: DamageMultiplier (ConditionalTrait<DamageMultiplierInfo>, IDamageModifier)
 *
 *  Use 0 to make actor invulnerable. Returns 100 (no modification) when disabled.
 */
export class DamageMultiplier
  extends ConditionalTrait<DamageMultiplierInfo>
  implements IDamageModifier
{
  constructor(info: DamageMultiplierInfo) {
    super(info)
  }

  /** Get the current damage modifier percentage.
   *
   *  OpenRA 对照: IDamageModifier.GetDamageModifier(Actor attacker, Damage damage)
   *
   *  @param _attacker — the actor that inflicted the damage
   *  @param _damage — the damage being applied
   *  @returns percentage modifier (100 = no change)
   */
  getDamageModifier(_attacker: IGameActor, _damage: Damage): number {
    return this.isTraitDisabled ? 100 : this.info.modifier
  }
}
