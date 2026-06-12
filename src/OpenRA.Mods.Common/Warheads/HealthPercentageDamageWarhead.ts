/**
 * HealthPercentageDamageWarhead.ts -- Percentage-based damage warhead
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/HealthPercentageDamageWarhead.cs
 *
 * 核心范式转换:
 * - C# HealthInfo.HP (max health) → duck-typed healthInfo.maxHP / health.maxHP
 * - C# Util.ApplyPercentageModifiers → applyPercentageModifiers()
 * - C# synchronous InflictDamage → deferred DamageEffect (ADR-8.1)
 */

import { TargetDamageWarhead } from './TargetDamageWarhead.js'
import {
  applyPercentageModifiers,
  type WarheadArgs,
  type WarheadEffect,
  type HitShapeLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// HealthPercentageDamageWarhead (对应 OpenRA HealthPercentageDamageWarhead)
// ---------------------------------------------------------------------------

/**
 * Apply damage based on the target's max health percentage.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.HealthPercentageDamageWarhead
 *
 * Overrides InflictDamage to compute damage as:
 *   damage = maxHealth * Damage% / 100% * DamageVersus% / 100%
 *
 * Used for weapons like Tiberium gas that deal %-based damage.
 */
export class HealthPercentageDamageWarhead extends TargetDamageWarhead {
  /**
   * Override inflictDamage to compute percentage-based damage.
   *
   * OpenRA 对照: HealthPercentageDamageWarhead.InflictDamage()
   *
   * Computes: maxHP * (Damage / 100) * (DamageModifiers / 100) * (Versus / 100)
   */
  protected override inflictDamage(
    victim: IGameActor,
    firedBy: IGameActor,
    shape: HitShapeLike | null,
    args: WarheadArgs,
  ): WarheadEffect[] {
    const maxHP = this._getMaxHP(victim)
    if (maxHP <= 0) return []

    const versusPct = this.damageVersus(victim, shape, args)
    const damage = applyPercentageModifiers(maxHP, [
      ...args.damageModifiers,
      this.damage,
      versusPct,
    ])

    if (damage <= 0) return []

    return [{
      type: 'damage' as const,
      target: victim,
      damage,
      damageTypes: new Set(this.damageTypes),
      firedBy,
    }]
  }

  /**
   * Get the max HP of a victim using duck-typed access.
   *
   * OpenRA 对照: victim.Info.TraitInfo<HealthInfo>().HP
   */
  private _getMaxHP(victim: IGameActor): number {
    // Try Health trait duck-typing
    const v = victim as unknown as Record<string, unknown>
    if (typeof v['maxHP'] === 'number') return v['maxHP'] as number
    if (typeof v['hp'] === 'number') return v['hp'] as number

    // Try info.hasTraitInfo path
    const info = v['info'] as Record<string, unknown> | undefined
    if (info && typeof info['maxHP'] === 'number') {
      return info['maxHP'] as number
    }

    return 0
  }
}
