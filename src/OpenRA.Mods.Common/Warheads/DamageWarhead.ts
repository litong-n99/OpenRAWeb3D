/**
 * DamageWarhead.ts -- OpenRA damage calculation framework
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/DamageWarhead.cs
 *
 * 核心范式转换:
 * - C# FrozenDictionary<string, int> Versus → Map<string, number>
 * - C# BitSet<DamageType> DamageTypes → Set<string>
 * - C# Util.ApplyPercentageModifiers → applyPercentageModifiers()
 * - C# actor.TraitsImplementing<Armor>() → duck-typed armor lookup
 * - C# actor.TraitsImplementing<HitShape>() → duck-typed hit shape lookup
 * - C# InflictDamage synchronous → DamageEffect[] deferred (ADR-8.1)
 * - C# HealthInfo trait → duck-typed IHealthInfo / IHealth access
 */

import type { WPos } from '../../OpenRA.Game/WPos.js'
import {
  Warhead,
  applyPercentageModifiers,
  type WarheadArgs,
  type WarheadEffect,
  type WarheadActorLike,
  type HitShapeLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ArmorInfo stub (duck-typed, full implementation in Phase D)
// ---------------------------------------------------------------------------

/**
 * Stub interface for Armor trait info.
 *
 * OpenRA 对照: ArmorInfo / IArmorInfo
 * TODO-8.D.13: Replace with full Armor class from Phase D.
 */
interface ArmorLike {
  type: string | null
  isTraitDisabled?: boolean
}

// ---------------------------------------------------------------------------
// DamageWarhead abstract class (对应 OpenRA DamageWarhead)
// ---------------------------------------------------------------------------

/**
 * Abstract base for damage-dealing warheads.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.DamageWarhead (abstract class)
 *
 * Provides:
 * - Damage amount configuration
 * - Damage type classification (Set<string>)
 * - Versus armor multiplier lookup
 * - Effective damage calculation (base * versus * modifiers)
 * - Hit shape distance-based damage application
 */
export abstract class DamageWarhead extends Warhead {
  /** How much raw damage to deal.
   *
   * OpenRA 对照: DamageWarhead.Damage
   */
  damage: number = 0

  /** Types of damage this warhead causes (e.g., "Explosion", "Bullet").
   *
   * OpenRA 对照: DamageWarhead.DamageTypes (BitSet<DamageType>)
   */
  damageTypes: Set<string> = new Set<string>()

  /** Damage percentage versus each armor type.
   *
   * OpenRA 对照: DamageWarhead.Versus (FrozenDictionary<string, int>)
   */
  versus: Map<string, number> = new Map<string, number>()

  // -----------------------------------------------------------------------
  // Override: loadFromJSON (extends Warhead.loadFromJSON)
  // -----------------------------------------------------------------------

  /**
   * Load damage warhead configuration from JSON.
   *
   * OpenRA 对照: FieldLoader.Load(DamageWarhead fields, MiniYaml)
   */
  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)

    if (json.Damage !== undefined) {
      this.damage = json.Damage as number
    }
    if (json.DamageTypes !== undefined) {
      const arr = json.DamageTypes as string[]
      this.damageTypes = new Set(arr)
    }
    if (json.Versus !== undefined) {
      const vs = json.Versus as Record<string, number>
      this.versus = new Map(Object.entries(vs))
    }
  }

  // -----------------------------------------------------------------------
  // Override: isValidAgainst
  // -----------------------------------------------------------------------

  /**
   * Check if the warhead is valid against the given actor.
   * Adds Health trait requirement check.
   *
   * OpenRA 对照: DamageWarhead.IsValidAgainst(Actor victim, Actor firedBy)
   */
  override isValidAgainst(victim: IGameActor, firedBy: IGameActor): boolean {
    // Cannot be damaged without a Health trait
    if (!this._hasHealth(victim)) return false

    return super.isValidAgainst(victim, firedBy)
  }

  /**
   * Check if an actor has a Health trait (duck-typed).
   *
   * OpenRA 对照: victim.Info.HasTraitInfo<IHealthInfo>()
   */
  private _hasHealth(victim: IGameActor): boolean {
    const v = victim as unknown as Record<string, unknown>
    const info = v['info'] as Record<string, unknown> | undefined
    if (info && typeof info['hasTraitInfo'] === 'function') {
      return (info['hasTraitInfo'] as (name: string) => boolean)('Health')
    }
    // Duck-type check: has hp/maxHP properties
    return typeof v['maxHP'] === 'number' || typeof v['hp'] === 'number'
  }

  // -----------------------------------------------------------------------
  // Damage calculation
  // -----------------------------------------------------------------------

  /**
   * Compute effective damage after versus modifiers and damage modifiers.
   *
   * OpenRA 对照: DamageWarhead.DamageVersus(Actor victim, HitShape shape, WarheadArgs args)
   *
   * Returns damage percentage (100 = normal). This is combined with
   * the base damage and damage modifiers in inflictDamage.
   *
   * @param victim -- the actor taking damage
   * @param shape -- the HitShape that was hit (may be null)
   * @param _args -- warhead arguments with damage modifiers
   * @returns damage percentage modifier (100 = 100% of base damage)
   */
  protected damageVersus(victim: IGameActor, shape: HitShapeLike | null, _args: WarheadArgs): number {
    // No versus values -> 100% damage
    if (this.versus.size === 0) return 100

    const armorTraits = this._getArmorTraits(victim)

    for (const armor of armorTraits) {
      if (armor.isTraitDisabled) continue
      if (armor.type == null) continue

      // Check versus has this armor type
      if (!this.versus.has(armor.type)) continue

      // Check shape filters (if any)
      if (shape?.info?.armorTypes && shape.info.armorTypes.length > 0) {
        if (!shape.info.armorTypes.includes(armor.type)) continue
      }

      return applyPercentageModifiers(100, [this.versus.get(armor.type)!])
    }

    // No matching armor -> 100% damage
    return 100
  }

  /**
   * Get the effective damage for a target.
   *
   * OpenRA 对照: getEffectiveDamage() pattern (conceptual)
   *
   * Computes: base damage * versus multipliers * damage modifiers
   */
  getEffectiveDamage(victim: IGameActor, shape: HitShapeLike | null, args: WarheadArgs): number {
    const versusPct = this.damageVersus(victim, shape, args)
    return applyPercentageModifiers(this.damage, [...args.damageModifiers, versusPct])
  }

  // -----------------------------------------------------------------------
  // Victim damage application (returns deferred effects)
  // -----------------------------------------------------------------------

  /**
   * Apply damage to a victim, returning deferred effects.
   *
   * OpenRA 对照: DamageWarhead.InflictDamage(Actor victim, Actor firedBy, HitShape shape, WarheadArgs args)
   *
   * ADR-8.1: Returns DamageEffect instead of calling victim.InflictDamage() directly.
   *
   * @param victim -- the actor taking damage
   * @param firedBy -- the actor that fired the weapon
   * @param shape -- the HitShape that was hit
   * @param args -- warhead arguments
   * @returns array of deferred damage effects
   */
  protected inflictDamage(
    victim: IGameActor,
    firedBy: IGameActor,
    shape: HitShapeLike | null,
    args: WarheadArgs,
  ): WarheadEffect[] {
    const damage = this.getEffectiveDamage(victim, shape, args)

    if (damage <= 0) return []

    return [{
      type: 'damage' as const,
      target: victim,
      damage,
      damageTypes: new Set(this.damageTypes),
      firedBy,
    }]
  }

  // -----------------------------------------------------------------------
  // HitShape distance calculation
  // -----------------------------------------------------------------------

  /**
   * Find the closest active HitShape for a victim relative to a position.
   *
   * OpenRA 对照: EnabledTargetablePositions iteration with MinBy (DistanceFromEdge)
   *
   * @param victim -- the actor to check
   * @param pos -- the world position to measure from
   * @returns the closest HitShape and its distance, or null if no shapes
   */
  protected findClosestActiveShape(
    victim: WarheadActorLike,
    pos: WPos,
  ): { shape: HitShapeLike; distance: number } | null {
    const positions = victim.enabledTargetablePositions
    if (!positions || positions.length === 0) return null

    let bestShape: HitShapeLike | null = null
    let bestDist = Number.MAX_SAFE_INTEGER

    for (const tp of positions) {
      const shape = tp as HitShapeLike
      if (!shape.distanceFromEdge) continue

      const dist = shape.distanceFromEdge(victim as unknown as IGameActor, pos).length
      if (dist < bestDist) {
        bestDist = dist
        bestShape = shape
      }
    }

    if (!bestShape) return null

    return { shape: bestShape!, distance: bestDist }
  }

  // -----------------------------------------------------------------------
  // Duck-typed trait accessors
  // -----------------------------------------------------------------------

  /**
   * Get armor traits for a victim (duck-typed, to be replaced by
   * full TraitDictionary lookup in Phase D).
   *
   * OpenRA 对照: victim.TraitsImplementing<Armor>()
   */
  private _getArmorTraits(victim: IGameActor): ArmorLike[] {
    // Try duck-typed access
    const v = victim as unknown as Record<string, unknown>
    if (Array.isArray(v['_armor'])) {
      return v['_armor'] as ArmorLike[]
    }

    // Try world traitDict lookup
    const actorLike = victim as unknown as WarheadActorLike
    if (actorLike.world) {
      const worldRec = actorLike.world as unknown as Record<string, unknown>
      if (worldRec['traitDict']) {
        const traitDict = worldRec['traitDict'] as {
          get?: (actor: IGameActor, name: string) => unknown
        }
        if (traitDict.get) {
          const armor = traitDict.get(victim, 'Armor')
          if (armor) return [armor as ArmorLike]
        }
      }
    }

    return []
  }
}
