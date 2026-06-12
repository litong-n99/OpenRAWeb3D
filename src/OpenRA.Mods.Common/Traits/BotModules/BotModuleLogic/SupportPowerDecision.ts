/**
 * SupportPowerDecision.ts — superweapon and support power targeting decision scoring
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/SupportPowerDecision.cs
 *
 * 核心范式转换:
 * - C# FieldLoader.Load from MiniYaml → TypeScript constructor from plain objects
 * - C# ImmutableArray<Consideration> → TypeScript readonly Consideration[]
 * - C# World.FindActorsInCircle → duck-typed world.findActorsInCircle()
 * - C# FrozenActorLayer.FrozenActorsInRegion → duck-typed frozenActorLayer
 * - C# WPos/WDist/WVec → TypeScript {x,y,z} position objects
 * - C# Relationship enum bitmask → TypeScript PlayerRelationship string comparison
 *
 * SupportPowerDecision evaluates the attractiveness of a position or group
 * of actors for using a support power (airstrike, ion cannon, nuke, etc.).
 * Each decision contains multiple Considerations that score different aspects.
 */

// ---------------------------------------------------------------------------
// Consideration — scoring rule for a single target type (对应 OpenRA Consideration)
// ---------------------------------------------------------------------------

/** Available scoring metrics for target value. */
export const DecisionMetric = {
  Health: 0,
  Value: 1,
  None: 2,
} as const
export type DecisionMetric = (typeof DecisionMetric)[keyof typeof DecisionMetric]

/**
 * A single consideration rule describing how to evaluate a target.
 *
 * OpenRA 对照: SupportPowerDecision.Consideration class
 */
export interface ConsiderationConfig {
  /** Target relationship filter (Enemy, Neutral, Ally). */
  against: string
  /** Targetable types to match (e.g. "Air", "Ground", "Water"). */
  types: ReadonlySet<string>
  /** Base attractiveness score for matching targets. */
  attractiveness: number
  /** How to weight the attractiveness (Health, Value, or None). */
  targetMetric: DecisionMetric
  /** Check radius in 1024ths of a cell (WDist). */
  checkRadius: number
}

/**
 * A single consideration that scores targets for support power usage.
 *
 * OpenRA 对照: SupportPowerDecision.Consideration inner class
 */
export class Consideration {
  readonly against: string
  readonly types: ReadonlySet<string>
  readonly attractiveness: number
  readonly targetMetric: DecisionMetric
  readonly checkRadius: number

  constructor(config: ConsiderationConfig) {
    this.against = config.against
    this.types = config.types
    this.attractiveness = config.attractiveness
    this.targetMetric = config.targetMetric
    this.checkRadius = config.checkRadius
  }

  // ---------------------------------------------------------------------
  // Scoring (对应 OpenRA Consideration.GetAttractiveness overloads)
  // ---------------------------------------------------------------------

  /**
   * Evaluate a single actor's attractiveness for this consideration.
   *
   * OpenRA 对照: Consideration.GetAttractiveness(Actor, PlayerRelationship, Player)
   *
   * @param a — the actor being scrutinized
   * @param stance — relationship between owner and target player
   * @param firedBy — the player using the power
   * @returns attractiveness score (0 if not a valid target)
   */
  getAttractiveness(
    a: ActorLike | null,
    stance: string,
    firedBy: PlayerLike,
  ): number {
    if (!a) return 0
    if (stance !== this.against) return 0
    if (!a.isTargetableBy?.(firedBy.playerActor)) return 0
    if (!a.canBeViewedByPlayer?.(firedBy)) return 0

    const targetTypes = a.getEnabledTargetTypes?.()
    if (!targetTypes || !Consideration.typesOverlap(this.types, targetTypes)) {
      return 0
    }

    switch (this.targetMetric) {
      case DecisionMetric.Value: {
        const valueInfo = a.traitInfo?.('Valued')
        return valueInfo ? (valueInfo as { cost: number }).cost * this.attractiveness : 0
      }
      case DecisionMetric.Health: {
        const health = a.health
        if (!health) return 0
        // Cast to avoid overflow: (HP * attractiveness) / MaxHP
        return ((health.hp * this.attractiveness) / health.maxHP) | 0
      }
      default:
        return this.attractiveness
    }
  }

  /**
   * Evaluate a frozen actor's attractiveness.
   *
   * OpenRA 对照: Consideration.GetAttractiveness(FrozenActor, PlayerRelationship)
   */
  getAttractivenessFrozen(fa: FrozenActorLike, stance: string): number {
    if (stance !== this.against) return 0
    if (!fa || !fa.isValid || !fa.visible) return 0

    if (!Consideration.typesOverlap(this.types, fa.targetTypes)) {
      return 0
    }

    switch (this.targetMetric) {
      case DecisionMetric.Value: {
        const valueInfo = fa.traitInfo?.('Valued')
        return valueInfo ? (valueInfo as { cost: number }).cost * this.attractiveness : 0
      }
      case DecisionMetric.Health: {
        const healthInfo = fa.traitInfo?.('Health')
        if (!healthInfo) return 0
        const hi = healthInfo as { maxHP: number }
        return hi.maxHP > 0 ? ((fa.hp * this.attractiveness) / hi.maxHP) | 0 : 0
      }
      default:
        return this.attractiveness
    }
  }

  // PERF: Avoid LINQ — manual overlap check
  private static typesOverlap(ourTypes: ReadonlySet<string>, theirTypes: { isEmpty: boolean; overlaps?: (other: unknown) => boolean; values?: () => Iterable<string> }): boolean {
    if (theirTypes.isEmpty) return false
    if (theirTypes.overlaps) {
      return theirTypes.overlaps(ourTypes)
    }
    // Fallback: manual check
    if (theirTypes.values) {
      for (const t of theirTypes.values()) {
        if (ourTypes.has(t as string)) return true
      }
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// SupportPowerDecision (对应 OpenRA SupportPowerDecision class)
// ---------------------------------------------------------------------------

/**
 * Configuration for a support power decision.
 *
 * OpenRA 对照: SupportPowerDecision constructor params
 */
export interface SupportPowerDecisionConfig {
  /** Minimum attractiveness to trigger power usage. */
  minimumAttractiveness: number
  /** Name of the support power order (e.g. "AirstrikePowerInfoOrder"). */
  orderName: string
  /** Coarse scan radius (WDist). */
  coarseScanRadius: number
  /** Fine scan radius (WDist). */
  fineScanRadius: number
  /** The weighted considerations for scoring targets. */
  considerations: readonly Consideration[]
  /** Minimum interval between scans (ticks). */
  minimumScanTimeInterval: number
  /** Maximum interval between scans (ticks). */
  maximumScanTimeInterval: number
}

/**
 * Metadata and scoring logic for AI support power usage decisions.
 *
 * OpenRA 对照: SupportPowerDecision class
 *
 * Evaluates the attractiveness of positions or groups of actors as targets
 * for support powers. Combines multiple Considerations into a single score.
 */
export class SupportPowerDecision {
  /** Minimum attractiveness to trigger power usage. */
  readonly minimumAttractiveness: number
  /** Name of the support power order. */
  readonly orderName: string
  /** Coarse scan radius. */
  readonly coarseScanRadius: number
  /** Fine scan radius. */
  readonly fineScanRadius: number
  /** The weighted considerations. */
  readonly considerations: readonly Consideration[]
  /** Min interval between scan ticks. */
  readonly minimumScanTimeInterval: number
  /** Max interval between scan ticks. */
  readonly maximumScanTimeInterval: number

  constructor(config: SupportPowerDecisionConfig) {
    this.minimumAttractiveness = config.minimumAttractiveness
    this.orderName = config.orderName
    this.coarseScanRadius = config.coarseScanRadius
    this.fineScanRadius = config.fineScanRadius
    this.considerations = config.considerations
    this.minimumScanTimeInterval = config.minimumScanTimeInterval
    this.maximumScanTimeInterval = config.maximumScanTimeInterval
  }

  // ---------------------------------------------------------------------------
  // Attractiveness evaluation (对应 OpenRA SupportPowerDecision.GetAttractiveness)
  // ---------------------------------------------------------------------------

  /**
   * Evaluate the attractiveness of a position for support power usage.
   *
   * OpenRA 对照: SupportPowerDecision.GetAttractiveness(WPos, Player)
   *
   * Scans actors in a circle around the position, scores each via considerations.
   *
   * @param pos — center position to evaluate
   * @param firedBy — player deploying the power
   * @param world — game world for actor lookups
   * @returns total attractiveness score
   */
  getAttractiveness(
    pos: { x: number; y: number; z: number },
    firedBy: PlayerLike,
    world: WorldLike,
  ): number {
    let answer = 0

    // Convert WPos to cell for map containment check
    const cellSize = 1024
    const targetTile = {
      x: (pos.x / cellSize) | 0,
      y: (pos.y / cellSize) | 0,
    }
    if (!world.mapContains?.(targetTile)) return 0

    for (const consideration of this.considerations) {
      const radiusWDist = consideration.checkRadius
      const actors = world.findActorsInCircle?.(pos, radiusWDist) ?? []

      for (const scrutinized of actors) {
        const stance = firedBy.relationshipWith(scrutinized.owner)
        answer += consideration.getAttractiveness(scrutinized, stance as string, firedBy)
      }

      // Frozen actors in region
      const delta = { x: radiusWDist, y: radiusWDist, z: 0 }
      const tl = {
        x: ((pos.x - delta.x) / cellSize) | 0,
        y: ((pos.y - delta.y) / cellSize) | 0,
      }
      const br = {
        x: ((pos.x + delta.x) / cellSize) | 0,
        y: ((pos.y + delta.y) / cellSize) | 0,
      }
      const frozenActors = world.frozenActorsInRegion?.(tl, br, firedBy) ?? []
      for (const scrutinized of frozenActors) {
        if (!scrutinized.isValid) continue
        const stance = firedBy.relationshipWith(scrutinized.owner)
        answer += consideration.getAttractivenessFrozen(scrutinized, stance as string)
      }
    }

    return answer
  }

  /**
   * Evaluate the attractiveness of a group of live actors.
   *
   * OpenRA 对照: SupportPowerDecision.GetAttractiveness(IEnumerable<Actor>, Player)
   */
  getAttractivenessForActors(
    actors: readonly ActorLike[],
    firedBy: PlayerLike,
  ): number {
    let answer = 0
    for (const consideration of this.considerations) {
      for (const scrutinized of actors) {
        const stance = firedBy.relationshipWith(scrutinized.owner)
        answer += consideration.getAttractiveness(scrutinized, stance as string, firedBy)
      }
    }
    return answer
  }

  /**
   * Evaluate the attractiveness of frozen actors.
   *
   * OpenRA 对照: SupportPowerDecision.GetAttractiveness(IEnumerable<FrozenActor>, Player)
   */
  getAttractivenessForFrozen(
    frozenActors: readonly FrozenActorLike[],
    firedBy: PlayerLike,
  ): number {
    let answer = 0
    for (const consideration of this.considerations) {
      for (const scrutinized of frozenActors) {
        if (!scrutinized.isValid || !scrutinized.visible) continue
        const stance = firedBy.relationshipWith(scrutinized.owner)
        answer += consideration.getAttractivenessFrozen(scrutinized, stance as string)
      }
    }
    return answer
  }

  // ---------------------------------------------------------------------------
  // Timing (对应 OpenRA SupportPowerDecision.GetNextScanTime)
  // ---------------------------------------------------------------------------

  /**
   * Get a randomized delay before the next scan.
   *
   * OpenRA 对照: SupportPowerDecision.GetNextScanTime(World)
   *
   * NOTE: In OpenRA this uses world.LocalRandom. Here we accept a PRNG instead.
   */
  getNextScanTime(random: SimplePrngLike): number {
    return random.nextIntRange(
      this.minimumScanTimeInterval,
      this.maximumScanTimeInterval,
    )
  }
}

// ---------------------------------------------------------------------------
// Duck-type interfaces
// ---------------------------------------------------------------------------

/** Minimal PRNG for scan timing. */
interface SimplePrngLike {
  nextIntRange(min: number, max: number): number
}

/** Minimal actor for consideration scoring. */
interface ActorLike {
  owner: PlayerLike
  isTargetableBy?: (actor: unknown) => boolean
  canBeViewedByPlayer?: (player: PlayerLike) => boolean
  getEnabledTargetTypes?: () => { isEmpty: boolean; overlaps?: (other: unknown) => boolean; values?: () => Iterable<string> }
  traitInfo?: (name: string) => unknown
  health?: { hp: number; maxHP: number }
}

/** Minimal frozen actor for consideration scoring. */
interface FrozenActorLike {
  readonly isValid: boolean
  readonly visible: boolean
  readonly owner: PlayerLike
  readonly hp: number
  readonly targetTypes: { isEmpty: boolean; overlaps?: (other: unknown) => boolean }
  traitInfo?: (name: string) => unknown
}

/** Minimal player for stance checks. */
interface PlayerLike {
  readonly playerActor: unknown
  relationshipWith(other: PlayerLike): unknown
}

/** Minimal world for actor lookups. */
interface WorldLike {
  mapContains?: (cell: { x: number; y: number }) => boolean
  findActorsInCircle?: (pos: { x: number; y: number; z: number }, radius: number) => ActorLike[]
  frozenActorsInRegion?: (tl: { x: number; y: number }, br: { x: number; y: number }, player: PlayerLike) => FrozenActorLike[]
}
