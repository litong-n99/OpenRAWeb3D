/**
 * Warhead.ts -- OpenRA warhead base class migration
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/Warhead.cs
 *
 * 核心范式转换:
 * - C# abstract class with synchronous DoImpact → abstract base with doImpact()
 *   returning WarheadEffect[] for deferred application (ADR-8.1)
 * - C# BitSet<TargetableType> validTargets/invalidTargets → Set<string>
 * - C# PlayerRelationship enum & bitwise check → PlayerRelationshipExts
 * - C# WDist AirThreshold → same WDist type
 * - C# reflection-based instantiation → TypeScript registry with factory
 * - C# WarheadArgs record struct → TypeScript interface
 */

import { WDist } from '../../OpenRA.Game/WDist.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'
import {
  TargetType,
  Target,
} from '../../OpenRA.Game/Traits/Target.js'
import {
  PlayerRelationship,
  PlayerRelationshipExts,
  DamageState,
  type IGameActor,
  type PlayerStub,
  type FrozenActorStub,
  type BitSetStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ImpactActorType enum (对应 OpenRA ImpactActorType)
// ---------------------------------------------------------------------------

/**
 * Result of checking what type of actors are at impact position.
 *
 * OpenRA 对照: ImpactActorType enum
 */
export const ImpactActorType = {
  None: 0,
  Invalid: 1,
  Valid: 2,
} as const
export type ImpactActorType = (typeof ImpactActorType)[keyof typeof ImpactActorType]

// ---------------------------------------------------------------------------
// DamageCalculationType enum (对应 OpenRA DamageCalculationType)
// ---------------------------------------------------------------------------

/**
 * Controls how falloff distance is calculated for spread damage.
 *
 * OpenRA 对照: DamageCalculationType enum
 */
export const DamageCalculationType = {
  HitShape: 0,
  ClosestTargetablePosition: 1,
  CenterPosition: 2,
} as const
export type DamageCalculationType =
  (typeof DamageCalculationType)[keyof typeof DamageCalculationType]

// ---------------------------------------------------------------------------
// WarheadArgs (对应 OpenRA WarheadArgs record struct)
// ---------------------------------------------------------------------------

/**
 * Arguments passed to a warhead's doImpact method.
 *
 * OpenRA 对照: WarheadArgs record struct
 */
export interface WarheadArgs {
  /** The actor that fired the weapon. */
  sourceActor: IGameActor

  /** Sequential damage percentage modifiers (e.g., FirepowerMultiplier). */
  damageModifiers: number[]

  /** The orientation of the impact projectile. */
  impactOrientation: WRot

  /** The world-space position of the impact. */
  impactPosition: WPos
}

// ---------------------------------------------------------------------------
// WarheadEffect type union (deferred effects per ADR-8.1)
// ---------------------------------------------------------------------------

/**
 * A damage effect to be applied at frame end.
 *
 * OpenRA 对照: Damage(DamageTypes, damage) of InflictDamage()
 */
export interface DamageEffect {
  type: 'damage'
  target: IGameActor
  damage: number
  damageTypes: Set<string>
  firedBy: IGameActor
}

/**
 * A kill effect to be applied at frame end.
 */
export interface KillEffect {
  type: 'kill'
  target: IGameActor
  firedBy: IGameActor
  damageState: DamageState
}

/**
 * A condition grant effect to be applied at frame end.
 */
export interface ConditionEffect {
  type: 'condition'
  target: IGameActor
  condition: string
  duration: number
  firedBy: IGameActor
}

/**
 * A screen effect (flash or shake) to be applied at frame end.
 */
export interface ScreenEffect {
  type: 'screen'
  effectType: 'flash' | 'shake'
  duration: number
  intensity?: number
  flashType?: string
  multiplier?: { x: number; y: number }
  centerPosition?: WPos
}

/**
 * A resource manipulation effect to be applied at frame end.
 */
export interface ResourceEffect {
  type: 'resource'
  cell: CPos
  resourceType: string
  action: 'destroy' | 'create'
  amount: number
  removeAllTypes: boolean
}

/**
 * An owner change effect to be applied at frame end.
 */
export interface OwnerChangeEffect {
  type: 'ownerChange'
  target: IGameActor
  newOwner: PlayerStub
  duration: number
  /** Whether to cancel the target's current activity. */
  cancelActivity: boolean
}

/**
 * A sprite effect to be spawned at frame end.
 */
export interface SpriteEffectData {
  type: 'sprite'
  pos: WPos
  image: string
  sequence: string
  palette: string
}

/**
 * A sound effect to be played.
 */
export interface SoundEffectData {
  type: 'sound'
  name: string
  pos: WPos
}

/**
 * A projectile spawn effect (for FireClusterWarhead).
 */
export interface ProjectileEffect {
  type: 'projectile'
  weapon: string
  source: WPos
  target: Target
  facing: WAngle
  sourceActor: IGameActor
  damageModifiers: number[]
}

/**
 * A deferred terrain smudge effect (for LeaveSmudgeWarhead).
 */
export interface SmudgeEffect {
  type: 'smudge'
  cell: CPos
  smudgeType: string
}

/**
 * A deferred target flash effect (for FlashTargetsInRadiusWarhead).
 */
export interface TargetFlashEffect {
  type: 'targetFlash'
  target: IGameActor
  overlayColor: { r: number; g: number; b: number; a: number }
  overlayAlpha: number
  flashCount: number
  flashInterval: number
  tintColor: { r: number; g: number; b: number }
}

/** All deferred warhead effect types. */
export type WarheadEffect =
  | DamageEffect
  | KillEffect
  | ConditionEffect
  | ScreenEffect
  | ResourceEffect
  | OwnerChangeEffect
  | SpriteEffectData
  | SoundEffectData
  | ProjectileEffect
  | SmudgeEffect
  | TargetFlashEffect

// ---------------------------------------------------------------------------
// IWarhead interface (for registry / duck-typing)
// ---------------------------------------------------------------------------

/**
 * Interface all warheads must implement.
 *
 * OpenRA 对照: IWarhead
 */
export interface IWarhead {
  readonly delay: number
  /** Checks if the warhead can affect the given actor. */
  isValidAgainst(victim: IGameActor, firedBy: IGameActor): boolean
  /** Checks if the warhead can affect the given frozen actor. */
  isValidAgainstFrozen(victim: FrozenActorStub, firedBy: IGameActor): boolean
  /** Apply warhead effects, returning deferred effects. */
  doImpact(target: Target, args: WarheadArgs): WarheadEffect[]
}

// ---------------------------------------------------------------------------
// Utility functions (ported from OpenRA Util / int2 / Exts)
// ---------------------------------------------------------------------------

/**
 * Apply sequential percentage modifiers to a base value.
 *
 * OpenRA 对照: Util.ApplyPercentageModifiers(int baseValue, int[] percentages)
 *
 * Each percentage is multiplied sequentially: (base * p1/100 * p2/100 * ...)
 * Truncates to integer at each step.
 */
export function applyPercentageModifiers(base: number, percentages: number[]): number {
  let result = base
  for (const p of percentages) {
    result = Math.trunc((result * p) / 100)
  }
  return result
}

/**
 * Linear interpolation between two integers.
 *
 * OpenRA 对照: int2.Lerp(int low, int high, int d, int dl, int dh)
 *
 * Maps d from [dl, dh] to [low, high].
 */
export function int2Lerp(low: number, high: number, d: number, dl: number, dh: number): number {
  if (dh <= dl) return low
  return Math.trunc(low + ((high - low) * (d - dl)) / (dh - dl))
}

/**
 * Get the vertical angle from one world position to another.
 *
 * OpenRA 对照: Util.GetVerticalAngle(WPos from, WPos to)
 *
 * Assumes the Z axis represents height. Returns WAngle where
 * 0 is horizontal, positive is upward.
 */
export function getVerticalAngle(from: WPos, to: WPos): WAngle {
  const dx = to.X - from.X
  const dy = to.Y - from.Y
  const dz = to.Z - from.Z
  const groundDistSq = dx * dx + dy * dy
  if (groundDistSq === 0) return WAngle.Zero
  const groundDist = Math.trunc(Math.sqrt(groundDistSq))
  return WAngle.arcTan(dz, groundDist)
}

// ---------------------------------------------------------------------------
// Target types (standard OpenRA target type identifiers)
// ---------------------------------------------------------------------------

/** Standard target type identifiers used by OpenRA for target validation. */
export const StandardTargetTypes = {
  Ground: 'Ground',
  Water: 'Water',
  Air: 'Air',
} as const

// ---------------------------------------------------------------------------
// Warhead abstract base class (对应 OpenRA abstract class Warhead)
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all warhead effects.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.Warhead (abstract class)
 *
 * Subclasses must implement:
 * - doImpactInWorld(pos, firedBy, args): WarheadEffect[]
 *
 * The base class provides:
 * - Config loading from JSON
 * - Target type validation (validTargets / invalidTargets)
 * - Player relationship validation
 * - Self-damage protection (affectsParent)
 * - Air burst detection (airThreshold)
 *
 * ADR-8.1: All warhead effects are deferred via WarheadEffect[].
 */
export abstract class Warhead implements IWarhead {
  // -----------------------------------------------------------------------
  // Config properties (from OpenRA Warhead fields)
  // -----------------------------------------------------------------------

  /** What types of targets are affected (default: Ground, Water). */
  validTargets: Set<string> = new Set(['Ground', 'Water'])

  /** What types of targets are unaffected (overrules validTargets). */
  invalidTargets: Set<string> = new Set<string>()

  /** What player relationships are affected. */
  validRelationships: PlayerRelationship =
    (PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship

  /** Can this warhead affect the actor that fired it. */
  affectsParent: boolean = false

  /**
   * If impact is above this altitude, warheads that would affect terrain
   * ignore terrain target types.
   */
  airThreshold: WDist = new WDist(128)

  /** Delay in ticks before applying the warhead effect (0 = instant). */
  delay: number = 0

  /** Whether this warhead triggers as an airburst. */
  isAirburst: boolean = false

  // -----------------------------------------------------------------------
  // IWarhead compliance
  // -----------------------------------------------------------------------

  /** IWarhead.delay getter.
   *
   * OpenRA 对照: IWarhead.Delay
   */
  get warheadDelay(): number {
    return this.delay
  }

  /**
   * Check if the warhead is valid against the given actor.
   *
   * OpenRA 对照: Warhead.IsValidAgainst(Actor victim, Actor firedBy)
   *
   * Checks:
   * 1. Self-damage protection (affectsParent)
   * 2. Player relationship (Ally/Neutral/Enemy)
   * 3. Target type filtering (validTargets / invalidTargets)
   *
   * @param victim -- the actor to check
   * @param firedBy -- the actor that fired the weapon
   * @returns true if the warhead can affect the victim
   */
  isValidAgainst(victim: IGameActor, firedBy: IGameActor): boolean {
    if (!this.affectsParent && victim === firedBy) return false

    const relationship = this._relationshipWith(firedBy.owner, victim.owner)
    if (!PlayerRelationshipExts.hasRelationship(this.validRelationships, relationship))
      return false

    // A target type is valid if it is in the valid targets list,
    // and not in the invalid targets list.
    const types = (victim as unknown as WarheadActorLike).getEnabledTargetTypes?.()
    if (!this.isValidTarget(types)) return false

    return true
  }

  /**
   * Check if the warhead is valid against a frozen actor.
   *
   * OpenRA 对照: Warhead.IsValidAgainst(FrozenActor victim, Actor firedBy)
   */
  isValidAgainstFrozen(victim: FrozenActorStub, firedBy: IGameActor): boolean {
    if (!victim.isValid) return false

    const v = victim as unknown as { owner?: PlayerStub; targetTypes?: Set<string> }
    const relationship = this._relationshipWith(firedBy.owner, v.owner)
    if (!PlayerRelationshipExts.hasRelationship(this.validRelationships, relationship))
      return false

    if (!this.isValidTarget(v.targetTypes)) return false

    return true
  }

  /**
   * Main entry point to apply the warhead effect.
   *
   * OpenRA 对照: Warhead.DoImpact(in Target target, WarheadArgs args)
   *
   * ADR-8.1: Returns WarheadEffect[] for deferred application.
   * Subclasses should override doImpactInWorld for position-based logic.
   *
   * @param target -- the target (Actor, Terrain, FrozenActor, or Invalid)
   * @param args -- warhead arguments (source actor, damage modifiers, etc.)
   * @returns array of deferred effects to apply at frame end
   */
  doImpact(target: Target, args: WarheadArgs): WarheadEffect[] {
    if (target.type === TargetType.Invalid) return []

    const firedBy = args.sourceActor

    // Used by traits or warheads that impact a specific actor
    if (target.type === TargetType.Actor) {
      const victim = target.actor as unknown as IGameActor | undefined
      if (!victim) return []
      if (!this.isValidAgainst(victim, firedBy)) return []
      return this.doImpactInWorld(target.centerPosition, firedBy, args)
    }

    // Positional impact
    return this.doImpactInWorld(target.centerPosition, firedBy, args)
  }

  /**
   * Apply warhead effects at a world position.
   *
   * OpenRA 对照: DamageWarhead.DoImpact(WPos pos, Actor firedBy, WarheadArgs args)
   *
   * Each concrete warhead overrides this to apply its specific effects.
   *
   * @param pos -- the world position of the impact
   * @param firedBy -- the actor that fired the weapon
   * @param args -- warhead arguments
   * @returns array of deferred effects
   */
  abstract doImpactInWorld(pos: WPos, firedBy: IGameActor, args: WarheadArgs): WarheadEffect[]

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Check if a target type set is valid against this warhead's filters.
   *
   * OpenRA 对照: Warhead.IsValidTarget(BitSet<TargetableType>)
   */
  protected isValidTarget(targetTypes: Set<string> | { isEmpty?: boolean; overlaps?: (other: unknown) => boolean } | undefined): boolean {
    if (!targetTypes) return false

    // Handle Set<string> directly
    if (targetTypes instanceof Set) {
      const st = targetTypes as Set<string>
      const hasValid = [...st].some(t => this.validTargets.has(t))
      if (!hasValid) return false
      const hasInvalid = [...st].some(t => this.invalidTargets.has(t))
      return !hasInvalid
    }

    // Handle array-like (iterate using symbol.iterator)
    if (Symbol.iterator in targetTypes && typeof targetTypes[Symbol.iterator] === 'function') {
      const iter = (targetTypes as Iterable<string>)[Symbol.iterator]()
      let hasValid = false
      for (;;) {
        const { value, done } = iter.next()
        if (done) break
        if (typeof value === 'string') {
          if (this.validTargets.has(value)) hasValid = true
          if (this.invalidTargets.has(value)) return false
        }
      }
      return hasValid
    }

    // Handle BitSet-like: use overlaps() if available
    if (typeof targetTypes.overlaps === 'function') {
      const hasValid = this._anyOverlap(targetTypes.overlaps, this.validTargets)
      if (!hasValid) return false
      const hasInvalid = this._anyOverlap(targetTypes.overlaps, this.invalidTargets)
      return !hasInvalid
    }

    return false
  }

  /**
   * Check if any valid target type overlaps with the target's type via the
   * target's overlaps() function.
   */
  private _anyOverlap(
    overlapsFn: (other: unknown) => boolean,
    validSet: Set<string>,
  ): boolean {
    for (const t of validSet) {
      if (overlapsFn(t)) return true
    }
    return false
  }

  /**
   * Compute the player relationship between two owners.
   *
   * OpenRA 对照: Player.RelationshipWith(Player)
   */
  private _relationshipWith(
    from: PlayerStub | undefined,
    to: PlayerStub | undefined,
  ): PlayerRelationship {
    if (!from || !to) return PlayerRelationship.None

    // Same player -> Ally
    if (from === to) return PlayerRelationship.Ally

    // Try to call relationshipWith if it exists on the Player
    const fromAny = from as unknown as { relationshipWith?: (o: PlayerStub) => PlayerRelationship }
    if (fromAny.relationshipWith) {
      return fromAny.relationshipWith(to)
    }

    // Default: different player = Enemy (matching OpenRA default warhead behavior)
    return PlayerRelationship.Enemy
  }

  /**
   * Load warhead configuration from a JSON object.
   *
   * OpenRA 对照: FieldLoader.Load(Warhead, MiniYaml)
   *
   * @param json -- the warhead configuration section from weapons.yaml (as JSON)
   */
  loadFromJSON(json: Record<string, unknown>): void {
    if (json.ValidTargets !== undefined) {
      const arr = json.ValidTargets as string[]
      this.validTargets = new Set(arr)
    }
    if (json.InvalidTargets !== undefined) {
      const arr = json.InvalidTargets as string[]
      this.invalidTargets = new Set(arr)
    }
    if (json.ValidRelationships !== undefined) {
      this.validRelationships = this._parseRelationships(json.ValidRelationships as string)
    }
    if (json.AffectsParent !== undefined) {
      this.affectsParent = !!json.AffectsParent
    }
    if (json.AirThreshold !== undefined) {
      if (typeof json.AirThreshold === 'number') {
        this.airThreshold = new WDist(json.AirThreshold as number)
      }
    }
    if (json.Delay !== undefined) {
      this.delay = json.Delay as number
    }
  }

  /**
   * Parse a relationship string into a bitmask.
   *
   * OpenRA 对照: FieldLoader.Load PlayerRelationship from YAML
   */
  private _parseRelationships(str: string): PlayerRelationship {
    let result: PlayerRelationship = 0 as PlayerRelationship
    const parts = str.split(',').map(s => s.trim())
    for (const p of parts) {
      switch (p) {
        case 'Ally': result = (result | PlayerRelationship.Ally) as PlayerRelationship; break
        case 'Neutral': result = (result | PlayerRelationship.Neutral) as PlayerRelationship; break
        case 'Enemy': result = (result | PlayerRelationship.Enemy) as PlayerRelationship; break
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Utility types for tests / duck-typing
// ---------------------------------------------------------------------------

/**
 * Minimal shape-like interface for duck-typed distance calculations.
 * Used by warheads that need HitShape distance-from-edge computations.
 */
export interface HitShapeLike {
  distanceFromEdge?(victim: IGameActor, pos: WPos): WDist
  info?: { armorTypes?: string[] }
}

/**
 * Minimal targetable-position type for the victim's enabled positions.
 */
export interface TargetablePosLike {
  distanceFromEdge?: (victim: IGameActor, pos: WPos) => WDist
}

/**
 * Minimal duck-typed world interface used by warheads.
 * NOT extending IGameActor to avoid WorldStub.actors conflict.
 */
export interface WarheadWorldLike {
  findActorsOnCircle?: (pos: WPos, radius: WDist) => WarheadActorLike[]
  map?: {
    cellContaining: (pos: WPos) => CPos
    distanceAboveTerrain: (pos: WPos) => WDist
    findTilesInAnnulus: (center: CPos, minRange: number, maxRange: number) => CPos[]
    contains: (cell: CPos) => boolean
    centerOfCell: (cell: CPos) => WPos
    getTerrainInfo: (cell: CPos) => { targetTypes?: Set<string> }
  }
}

/**
 * Minimal interface for actors that warheads interact with.
 * This is a duck-typed interface used for accessing extended actor properties
 * not on IGameActor.
 */
export interface WarheadActorLike {
  centerPosition: WPos
  owner?: PlayerStub
  world?: WarheadWorldLike
  getEnabledTargetTypes?: () => Set<string> | { isEmpty: boolean; overlaps?: (o: unknown) => boolean }
  enabledTargetablePositions?: readonly (HitShapeLike | TargetablePosLike)[]
  info?: { name?: string; hasTraitInfo?: (name: string) => boolean }
  inflictDamage?: (attacker: IGameActor, damage: { value: number; damageTypes: Set<string> | BitSetStub<unknown> }) => void
  changeOwner?: (newOwner: PlayerStub) => void
  cancelActivity?: () => void
  kill?: (attacker: IGameActor, damageTypes: Set<string> | BitSetStub<unknown>) => void
  getTargetablePositions?: () => WPos[]
  maxHP?: number
  hp?: number
  isDead: boolean
  isInWorld: boolean
  disposed: boolean
  generation: number
  actorId: number
}

/** Duck-type check: does an actor-like object have a Health trait? */
export function hasHealth(actor: IGameActor | WarheadActorLike): boolean {
  const a = actor as unknown as Record<string, unknown>
  return typeof a['maxHP'] === 'number' || typeof a['hp'] === 'number'
}
