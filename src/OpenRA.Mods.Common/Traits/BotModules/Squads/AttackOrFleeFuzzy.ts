/**
 * AttackOrFleeFuzzy.ts — deterministic weighted engagement decision evaluator
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/Squads/AttackOrFleeFuzzy.cs
 *
 * 核心范式转换:
 * - C# MamdaniFuzzySystem (floating-point fuzzy logic library) → deterministic
 *   weighted integer scoring (no floating point, no external library)
 * - C# trapezoid membership functions (0-100 range) → integer threshold bands
 * - C# fuzzy rules (20+ string-parsed rules) → weighted factor tables
 * - C# lock(fuzzyEngine) → single-threaded deterministic evaluation
 * - C# double.NaN check → integer validity guard
 *
 * The evaluator takes 4 integer inputs:
 *   1. OwnHealth: 0-100 (normalized total HP percentage)
 *   2. EnemyHealth: 0-100 (normalized total HP percentage)
 *   3. RelativeAttackPower: 0-1000 (ratio of own DPS / enemy DPS * 100)
 *   4. RelativeSpeed: 0-1000 (ratio of own avg speed / enemy avg speed * 100)
 *
 * And produces a single decision: Attack (return true) or Flee (return false).
 *
 * Design:
 * - Scoring is additive with per-band contributions
 * - Health bands: NearDead (0-20), Injured (20-50), Normal (50-100)
 * - Power bands: Weak (0-85), Equal (85-115), Strong (115+)
 * - Speed bands: Slow (0-85), Equal (85-115), Fast (115+)
 * - Decision threshold: 30 (matching OpenRA's fuzzy output threshold)
 *
 * CRITICAL: ALL arithmetic is integer-based. No Math.random(), no floating point.
 * This ensures deterministic behavior across all platforms and network sync.
 */

// ---------------------------------------------------------------------------
// Input band constants (0-100 or 0-1000 scale)
// ---------------------------------------------------------------------------

/** Health band thresholds (0-100). */
const HEALTH_NEARDEAD_MAX = 20
const HEALTH_INJURED_MIN = 30
const HEALTH_INJURED_MAX = 50
const HEALTH_NORMAL_MIN = 50

/** Relative power/speed band thresholds (0-1000). */
const RELATIVE_WEAK_MAX = 85
const RELATIVE_EQUAL_MAX = 115

// ---------------------------------------------------------------------------
// Decision weights (integer — scaled by 100 for precision)
// ---------------------------------------------------------------------------

/**
 * Scoring table for the "Default" engagement preset.
 *
 * Format: [ownHealthBand][enemyHealthBand][powerBand][speedBand] → attackScore
 * Bands: 0=NearDead, 1=Injured, 2=Normal (health)
 *        0=Weak, 1=Equal, 2=Strong (power/speed)
 *
 * Higher attackScore = more likely to attack.
 * Threshold: attackScore >= 50 means Attack, < 50 means Flee.
 *
 * These values replicate the OpenRA Mamdani fuzzy rules behavior
 * using additive integer scoring instead of fuzzy inference.
 */
const DEFAULT_ATTACK_WEIGHTS: Record<string, number> = {
  // OwnHealth=Normal (band 2): aggressive — attack most combinations
  '2,0,0,0': 60, '2,0,0,1': 60, '2,0,0,2': 65,
  '2,0,1,0': 65, '2,0,1,1': 65, '2,0,1,2': 70,
  '2,0,2,0': 70, '2,0,2,1': 70, '2,0,2,2': 75,
  '2,1,0,0': 55, '2,1,0,1': 55, '2,1,0,2': 60,
  '2,1,1,0': 60, '2,1,1,1': 60, '2,1,1,2': 65,
  '2,1,2,0': 65, '2,1,2,1': 65, '2,1,2,2': 70,
  '2,2,0,0': 50, '2,2,0,1': 50, '2,2,0,2': 55,
  '2,2,1,0': 55, '2,2,1,1': 55, '2,2,1,2': 60,
  '2,2,2,0': 60, '2,2,2,1': 60, '2,2,2,2': 65,

  // OwnHealth=Injured (band 1): cautious — attack favorable, flee unfavorable
  '1,0,0,0': 55, '1,0,0,1': 50, '1,0,0,2': 45,
  '1,0,1,0': 60, '1,0,1,1': 55, '1,0,1,2': 50,
  '1,0,2,0': 65, '1,0,2,1': 60, '1,0,2,2': 55,
  '1,1,0,0': 50, '1,1,0,1': 45, '1,1,0,2': 40,
  '1,1,1,0': 55, '1,1,1,1': 50, '1,1,1,2': 45,
  '1,1,2,0': 60, '1,1,2,1': 55, '1,1,2,2': 50,
  '1,2,0,0': 45, '1,2,0,1': 40, '1,2,0,2': 35,
  '1,2,1,0': 50, '1,2,1,1': 45, '1,2,1,2': 40,
  '1,2,2,0': 55, '1,2,2,1': 50, '1,2,2,2': 45,

  // OwnHealth=NearDead (band 0): very cautious — flee unless clear advantage
  '0,0,0,0': 45, '0,0,0,1': 40, '0,0,0,2': 35,
  '0,0,1,0': 50, '0,0,1,1': 45, '0,0,1,2': 40,
  '0,0,2,0': 55, '0,0,2,1': 50, '0,0,2,2': 45,
  '0,1,0,0': 40, '0,1,0,1': 35, '0,1,0,2': 30,
  '0,1,1,0': 45, '0,1,1,1': 40, '0,1,1,2': 35,
  '0,1,2,0': 50, '0,1,2,1': 45, '0,1,2,2': 40,
  '0,2,0,0': 35, '0,2,0,1': 30, '0,2,0,2': 25,
  '0,2,1,0': 40, '0,2,1,1': 35, '0,2,1,2': 30,
  '0,2,2,0': 45, '0,2,2,1': 40, '0,2,2,2': 35,
}

/**
 * Scoring table for the "Rush" engagement preset.
 * Rush is more aggressive — only attacks when power is Strong.
 */
const RUSH_ATTACK_WEIGHTS: Record<string, number> = {
  // Rush: Attack when Strong, Flee otherwise
  '2,0,0,0': 35, '2,0,0,1': 35, '2,0,0,2': 40,
  '2,0,1,0': 40, '2,0,1,1': 40, '2,0,1,2': 45,
  '2,0,2,0': 55, '2,0,2,1': 55, '2,0,2,2': 60,
  '2,1,0,0': 30, '2,1,0,1': 30, '2,1,0,2': 35,
  '2,1,1,0': 35, '2,1,1,1': 35, '2,1,1,2': 40,
  '2,1,2,0': 50, '2,1,2,1': 50, '2,1,2,2': 55,
  '2,2,0,0': 30, '2,2,0,1': 30, '2,2,0,2': 35,
  '2,2,1,0': 35, '2,2,1,1': 35, '2,2,1,2': 40,
  '2,2,2,0': 50, '2,2,2,1': 50, '2,2,2,2': 55,
  // For injured/near-dead in Rush: same pattern, lower confidence
  '1,0,0,0': 30, '1,0,1,0': 35, '1,0,2,0': 50,
  '1,0,0,1': 30, '1,0,1,1': 35, '1,0,2,1': 50,
  '1,0,0,2': 35, '1,0,1,2': 40, '1,0,2,2': 55,
  '1,1,0,0': 25, '1,1,1,0': 30, '1,1,2,0': 45,
  '1,1,0,1': 25, '1,1,1,1': 30, '1,1,2,1': 45,
  '1,1,0,2': 30, '1,1,1,2': 35, '1,1,2,2': 50,
  '1,2,0,0': 25, '1,2,1,0': 30, '1,2,2,0': 45,
  '1,2,0,1': 25, '1,2,1,1': 30, '1,2,2,1': 45,
  '1,2,0,2': 30, '1,2,1,2': 35, '1,2,2,2': 50,
  '0,0,0,0': 25, '0,0,1,0': 30, '0,0,2,0': 45,
  '0,0,0,1': 25, '0,0,1,1': 30, '0,0,2,1': 45,
  '0,0,0,2': 30, '0,0,1,2': 35, '0,0,2,2': 50,
  '0,1,0,0': 20, '0,1,1,0': 25, '0,1,2,0': 40,
  '0,1,0,1': 20, '0,1,1,1': 25, '0,1,2,1': 40,
  '0,1,0,2': 25, '0,1,1,2': 30, '0,1,2,2': 45,
  '0,2,0,0': 20, '0,2,1,0': 25, '0,2,2,0': 40,
  '0,2,0,1': 20, '0,2,1,1': 25, '0,2,2,1': 40,
  '0,2,0,2': 25, '0,2,1,2': 30, '0,2,2,2': 45,
}

// ---------------------------------------------------------------------------
// AttackOrFleeFuzzy
// ---------------------------------------------------------------------------

/**
 * Engagement decision evaluator using deterministic weighted scoring.
 *
 * OpenRA 对照: AttackOrFleeFuzzy sealed class
 *
 * Two presets:
 * - `Default`: balanced engagement rules for most squad types
 * - `Rush`: aggressive — only engages when attack power is clearly superior
 *
 * Usage:
 * ```
 * const evaluator = AttackOrFleeFuzzy.default
 * const shouldAttack = evaluator.canAttack(ownUnits, enemyUnits)
 * ```
 */
export class AttackOrFleeFuzzy {
  /** Singleton default preset. */
  static readonly default = new AttackOrFleeFuzzy(DEFAULT_ATTACK_WEIGHTS)

  /** Singleton rush preset. */
  static readonly rush = new AttackOrFleeFuzzy(RUSH_ATTACK_WEIGHTS)

  /** Decision threshold: attackScore >= ATTACK_THRESHOLD means Attack. */
  private static readonly ATTACK_THRESHOLD = 50

  /** Weight lookup table. */
  private readonly _weights: Record<string, number>

  private constructor(weights: Record<string, number>) {
    this._weights = weights
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Determine whether to attack given the unit composition.
   *
   * OpenRA 对照: AttackOrFleeFuzzy.CanAttack(List<Actor>, List<Actor>)
   *
   * @param ownUnits — friendly units in the engagement
   * @param enemyUnits — enemy units in the engagement
   * @returns true if the decision is Attack, false if Flee
   */
  canAttack(
    ownUnits: readonly ActorLike[],
    enemyUnits: readonly ActorLike[],
  ): boolean {
    const ownHealth = AttackOrFleeFuzzy.normalizedHealth(ownUnits, 100)
    const enemyHealth = AttackOrFleeFuzzy.normalizedHealth(enemyUnits, 100)
    const relativePower = AttackOrFleeFuzzy.relativePower(ownUnits, enemyUnits)
    const relativeSpeed = AttackOrFleeFuzzy.relativeSpeed(ownUnits, enemyUnits)

    // Categorize inputs into bands
    const ownHealthBand = this.healthBand(ownHealth)
    const enemyHealthBand = this.healthBand(enemyHealth)
    const powerBand = this.relativeBand(relativePower)
    const speedBand = this.relativeBand(relativeSpeed)

    // Look up attack score
    const key = `${ownHealthBand},${enemyHealthBand},${powerBand},${speedBand}`
    const attackScore = this._weights[key] ?? 40 // Default: cautious

    return attackScore >= AttackOrFleeFuzzy.ATTACK_THRESHOLD
  }

  // -----------------------------------------------------------------------
  // Band classifiers (integer, no floating point)
  // -----------------------------------------------------------------------

  /**
   * Classify health (0-100) into band 0 (NearDead), 1 (Injured), 2 (Normal).
   */
  private healthBand(health: number): number {
    if (health <= HEALTH_NEARDEAD_MAX) return 0
    if (health < HEALTH_INJURED_MIN) {
      // Overlap zone: 21-29 → interpolate? Nearest wins.
      // Fuzzy: NearDead trapezoid ends at 40, Injured starts at 30.
      // Simplified: midpoint at 30
      return health < 30 ? 0 : 1
    }
    if (health <= HEALTH_INJURED_MAX) return 1
    if (health < HEALTH_NORMAL_MIN) {
      // Overlap zone: 51-? → Nearest.
      return health < 65 ? 1 : 2
    }
    return 2
  }

  /**
   * Classify relative value (0-1000) into band 0 (Weak), 1 (Equal), 2 (Strong).
   */
  private relativeBand(value: number): number {
    if (value <= RELATIVE_WEAK_MAX) return 0
    if (value <= RELATIVE_EQUAL_MAX) return 1
    return 2
  }

  // -----------------------------------------------------------------------
  // Input calculators (static, integer arithmetic)
  // -----------------------------------------------------------------------

  /**
   * Calculate normalized health percentage for a group of actors.
   *
   * OpenRA 对照: AttackOrFleeFuzzy.NormalizedHealth(List<Actor>, int)
   *
   * Returns (sumHP / sumMaxHP) * normalizeByValue.
   * Returns 0 if no actors have health.
   *
   * @param actors — the actors to evaluate
   * @param normalizeByValue — scale factor (typically 100)
   * @returns integer health percentage
   */
  static normalizedHealth(actors: readonly ActorLike[], normalizeByValue: number): number {
    let sumMaxHp = 0
    let sumHp = 0

    for (const a of actors) {
      const health = a.health
      if (health) {
        sumMaxHp += health.maxHP
        sumHp += health.hp
      }
    }

    if (sumMaxHp === 0) return 0

    // (sumHp * normalizeByValue) / sumMaxHp — integer division
    // Use multiplication first to minimize precision loss
    return ((sumHp * normalizeByValue) / sumMaxHp) | 0
  }

  /**
   * Calculate relative attack power ratio.
   *
   * OpenRA 对照: AttackOrFleeFuzzy.RelativePower(List<Actor>, List<Actor>)
   *
   * ownPower / enemyPower * 100, clamped to 0-999.
   */
  static relativePower(
    ownUnits: readonly ActorLike[],
    enemyUnits: readonly ActorLike[],
  ): number {
    return this.relativeValue(
      ownUnits,
      enemyUnits,
      100,
      (actors) => this.sumOfAttackPower(actors),
    )
  }

  /**
   * Calculate relative speed ratio.
   *
   * OpenRA 对照: AttackOrFleeFuzzy.RelativeSpeed(List<Actor>, List<Actor>)
   *
   * ownAvgSpeed / enemyAvgSpeed * 100, clamped to 0-999.
   */
  static relativeSpeed(
    ownUnits: readonly ActorLike[],
    enemyUnits: readonly ActorLike[],
  ): number {
    return this.relativeValue(
      ownUnits,
      enemyUnits,
      100,
      (actors) => this.averageSpeed(actors),
    )
  }

  /**
   * Generic relative value calculator.
   *
   * OpenRA 对照: AttackOrFleeFuzzy.RelativeValue(...)
   *
   * (ownVal / enemyVal) * normalizeByValue, clamped to 0-999.
   */
  private static relativeValue(
    own: readonly ActorLike[],
    enemy: readonly ActorLike[],
    normalizeByValue: number,
    valueFunc: (actors: readonly ActorLike[]) => number,
  ): number {
    if (enemy.length === 0) return 999
    if (own.length === 0) return 0

    const ownVal = valueFunc(own)
    const enemyVal = valueFunc(enemy)

    if (enemyVal === 0) return 999

    const ratio = ((ownVal * normalizeByValue) / enemyVal) | 0
    return ratio < 0 ? 0 : ratio > 999 ? 999 : ratio
  }

  /**
   * Calculate sum of DPS (damage * burst / reloadDelay) for a group.
   *
   * OpenRA 对照: SumOfValues<AttackBaseInfo> inline lambda
   *
   * Uses integer arithmetic only. For each actor with attack capability,
   * sums up: SUM(damage * burst * 100 / totalReloadDelay) across all armaments.
   */
  private static sumOfAttackPower(actors: readonly ActorLike[]): number {
    let sum = 0

    for (const a of actors) {
      const arms = a.attackPower ?? []
      for (const arm of arms) {
        // damage * burst * 100 / reloadDelay (integer)
        const dps = ((arm.damage * arm.burst * 100) / arm.totalReloadDelay) | 0
        sum += dps
      }
    }

    return sum
  }

  /**
   * Calculate average movement speed for a group.
   *
   * Only counts actors with Mobile trait.
   */
  private static averageSpeed(actors: readonly ActorLike[]): number {
    let sum = 0
    let count = 0

    for (const a of actors) {
      if (a.speed !== undefined) {
        sum += a.speed
        count++
      }
    }

    if (count === 0) return 0
    return (sum / count) | 0
  }
}

// ---------------------------------------------------------------------------
// ActorLike — minimal interface for attack/flee evaluation
// ---------------------------------------------------------------------------

/**
 * Minimal actor interface for AttackOrFleeFuzzy calculations.
 */
export interface ActorLike {
  /** Health trait (duck-typed). */
  health?: {
    maxHP: number
    hp: number
  }
  /** Attack power contributions (duck-typed from armaments). */
  attackPower?: readonly ArmamentLike[]
  /** Movement speed (from Mobile trait). */
  speed?: number
  /** Whether the actor has attack capability. */
  hasAttackBase?: boolean
}

/**
 * Minimal armament interface for DPS calculation.
 */
export interface ArmamentLike {
  /** Damage per shot. */
  damage: number
  /** Shots per burst. */
  burst: number
  /** Total reload time (reloadDelay + burstDelays). */
  totalReloadDelay: number
}
