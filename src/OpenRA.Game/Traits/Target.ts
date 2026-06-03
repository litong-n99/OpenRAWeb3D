/**
 * Target.ts — Target abstraction representing a "where/what to attack/move to"
 * OpenRA 对照: OpenRA.Game/Traits/Target.cs
 *
 * 核心范式转换:
 * - C# readonly struct with tagged fields → TypeScript discriminated union
 * - C# TargetType validation in Type getter → type getter with live validation
 * - Actor/FrozenActor validation on access (IsInWorld, IsDead, Generation)
 * - FromSerializedActor/SerializableState → omitted (serialization is a
 *   separate concern)
 */

import { WPos } from '../WPos'
import { WDist } from '../WDist'
import { CPos } from '../CPos'
import { SubCell, type SubCell as SubCellEnum } from './SubCell'
import type { IActorRef } from './IActorRef'
import type { IFrozenActorRef } from './IFrozenActorRef'

// ---------------------------------------------------------------------------
// TargetType
// ---------------------------------------------------------------------------

/**
 * The type discriminator for a Target.
 *
 * OpenRA 对照: TargetType enum
 */
export const TargetType = {
  Invalid: 0,
  Actor: 1,
  Terrain: 2,
  FrozenActor: 3,
} as const

export type TargetType = (typeof TargetType)[keyof typeof TargetType]

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

/**
 * Target represents "what/where to attack or move to."
 *
 * OpenRA 对照: Target (readonly struct)
 *
 * A discriminated union with four variants:
 * - Invalid: no valid target
 * - Actor: a living actor (validated on access via type getter)
 * - Terrain: a world position / cell
 * - FrozenActor: a fog-of-war ghost of an actor
 *
 * The `type` getter performs live validation for Actor targets:
 * if the actor is no longer in world, is dead, or its generation changed,
 * the type returns Invalid.
 */
export class Target {
  /** Static empty array, used like OpenRA's Target.None. */
  static readonly None: readonly Target[] = []

  /** An invalid target singleton equivalent. */
  static readonly Invalid = new Target({ discriminator: TargetType.Invalid })

  // -----------------------------------------------------------------------
  // Internal state
  // -----------------------------------------------------------------------

  private readonly data: TargetData

  private constructor(data: TargetData) {
    this.data = data
  }

  // -----------------------------------------------------------------------
  // Factory methods
  // -----------------------------------------------------------------------

  /**
   * Create a terrain target from a world position.
   *
   * OpenRA 对照: Target.FromPos(WPos)
   */
  static fromPos(pos: WPos): Target {
    return new Target({
      discriminator: TargetType.Terrain,
      terrainCenterPosition: pos,
      terrainPositions: [pos],
    })
  }

  /**
   * Create a terrain target from another target's positions.
   *
   * OpenRA 对照: Target.FromTargetPositions(in Target)
   */
  static fromTargetPositions(t: Target): Target {
    const centerPos = t.centerPosition
    const positions = t.positions
    return new Target({
      discriminator: TargetType.Terrain,
      terrainCenterPosition: centerPos,
      terrainPositions: [...positions],
    })
  }

  /**
   * Create a terrain target from a cell position on the map.
   *
   * OpenRA 对照: Target.FromCell(World, CPos, SubCell)
   *
   * NOTE: OpenRA computes terrainCenterPosition from
   * `w.Map.CenterOfSubCell(c, subCell)`. Since Map is not yet migrated,
   * the position is set to WPos.Zero and must be updated later via
   * resolveCellPositions() when Map becomes available.
   *
   * @param cell — the cell position
   * @param subCell — sub-cell position (default FullCell)
   */
  static fromCell(cell: CPos, subCell: SubCellEnum = SubCell.FullCell): Target {
    // NOTE: terrainCenterPosition/terrainPositions will be resolved later
    // when Map.CenterOfSubCell is available (see TODO-3.C.5).
    return new Target({
      discriminator: TargetType.Terrain,
      terrainCenterPosition: WPos.Zero,
      terrainPositions: [WPos.Zero],
      cell,
      subCell,
    })
  }

  /**
   * Create an actor target.
   *
   * OpenRA 对照: Target.FromActor(Actor)
   *
   * Returns Target.Invalid if the actor is null.
   *
   * @param a — the actor to target
   */
  static fromActor(a: IActorRef | null): Target {
    if (!a) return Target.Invalid
    return new Target({
      discriminator: TargetType.Actor,
      actor: a,
      generation: a.generation,
    })
  }

  /**
   * Create a frozen actor target.
   *
   * OpenRA 对照: Target.FromFrozenActor(FrozenActor)
   */
  static fromFrozenActor(fa: IFrozenActorRef): Target {
    return new Target({
      discriminator: TargetType.FrozenActor,
      frozenActor: fa,
    })
  }

  // -----------------------------------------------------------------------
  // Type (with live validation)
  // -----------------------------------------------------------------------

  /**
   * The effective type of this target, with live Actor validation.
   *
   * OpenRA 对照: Target.Type
   *
   * For Actor targets, validates that the actor is still in the world,
   * is not dead, and its generation has not changed. If validation fails,
   * returns TargetType.Invalid.
   */
  get type(): TargetType {
    if (this.data.discriminator === TargetType.Actor) {
      const actor = this.data.actor!
      // Actor is no longer in the world
      if (!actor.isInWorld || actor.isDead) return TargetType.Invalid
      // Actor generation has changed (teleported or captured)
      if (actor.generation !== this.data.generation) return TargetType.Invalid
    }

    return this.data.discriminator
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  /**
   * Check if this target is valid for a specific targeter.
   *
   * OpenRA 对照: Target.IsValidFor(Actor)
   */
  isValidFor(targeter: IActorRef | null): boolean {
    if (!targeter) return false

    switch (this.type) {
      case TargetType.Actor:
        return this.data.actor!.isTargetableBy(targeter)
      case TargetType.FrozenActor: {
        const fa = this.data.frozenActor!
        return fa.isValid && fa.visible && !fa.hidden
      }
      case TargetType.Invalid:
        return false
      case TargetType.Terrain:
      default:
        return true
    }
  }

  /**
   * Whether this target requires force-fire (attack ground).
   *
   * OpenRA 对照: Target.RequiresForceFire
   *
   * NOTE: Simplified — checks if actor target has any targetable trait
   * requiring force fire. Full implementation requires TraitDictionary.
   * See TODO-3.B.2 in docs/actor_system_migration_plan.md.
   */
  get requiresForceFire(): boolean {
    // NOTE: Full implementation requires Actor.Targetables iteration.
    // For now, returns false — terrain and frozen actors don't require it,
    // and for actor targets the check is trait-dependent.
    return false
  }

  // -----------------------------------------------------------------------
  // Position accessors
  // -----------------------------------------------------------------------

  /**
   * Representative center position of this target.
   *
   * OpenRA 对照: Target.CenterPosition
   *
   * @throws if the target is Invalid
   */
  get centerPosition(): WPos {
    switch (this.type) {
      case TargetType.Actor:
        return this.data.actor!.centerPosition
      case TargetType.FrozenActor:
        return this.data.frozenActor!.centerPosition
      case TargetType.Terrain:
        return this.data.terrainCenterPosition!
      case TargetType.Invalid:
      default:
        throw new Error('Attempting to query the position of an invalid Target')
    }
  }

  /**
   * All positions available to target for range checks.
   *
   * OpenRA 对照: Target.Positions
   */
  get positions(): readonly WPos[] {
    switch (this.type) {
      case TargetType.Actor:
        return this.data.actor!.getTargetablePositions()
      case TargetType.FrozenActor: {
        const fa = this.data.frozenActor!
        return fa.targetablePositions ?? []
      }
      case TargetType.Terrain:
        return this.data.terrainPositions ?? [this.data.terrainCenterPosition!]
      case TargetType.Invalid:
      default:
        return []
    }
  }

  /**
   * The underlying actor reference (if Actor type).
   *
   * OpenRA 对照: Target.Actor
   */
  get actor(): IActorRef | null {
    return this.data.actor ?? null
  }

  /**
   * The underlying frozen actor reference (if FrozenActor type).
   *
   * OpenRA 对照: Target.FrozenActor
   */
  get frozenActor(): IFrozenActorRef | null {
    return this.data.frozenActor ?? null
  }

  // -----------------------------------------------------------------------
  // Range check
  // -----------------------------------------------------------------------

  /**
   * Check if this target is within range of an origin position.
   *
   * OpenRA 对照: Target.IsInRange(WPos, WDist)
   *
   * Target ranges are calculated in 2D, ignoring height differences.
   *
   * @param origin — the origin position
   * @param range — the maximum distance
   */
  isInRange(origin: WPos, range: WDist): boolean {
    if (this.type === TargetType.Invalid) return false

    const rangeLenSq = range.lengthSquared
    for (const t of this.positions) {
      const delta = WPos.subtract(t, origin)
      if (delta.horizontalLengthSquared <= rangeLenSq) return true
    }
    return false
  }

  // -----------------------------------------------------------------------
  // Cell accessors (for terrain targets set via fromCell)
  // -----------------------------------------------------------------------

  /**
   * The cell position (only set if target was created from a cell).
   * undefined otherwise.
   */
  get cell(): CPos | undefined {
    return this.data.cell ?? undefined
  }

  /**
   * The sub-cell position (only set if target was created from a cell).
   * undefined otherwise.
   */
  get subCell(): SubCellEnum | undefined {
    return this.data.subCell
  }

  // -----------------------------------------------------------------------
  // Equality
  // -----------------------------------------------------------------------

  /**
   * Test two targets for equality.
   *
   * OpenRA 对照: Target.operator==
   */
  static equals(a: Target, b: Target): boolean {
    const aType = a.type
    const bType = b.type

    if (aType !== bType) return false

    switch (aType) {
      case TargetType.Terrain:
        return (
          WPos.equals(a.data.terrainCenterPosition!, b.data.terrainCenterPosition!) &&
          a.data.cell === b.data.cell &&
          a.data.subCell === b.data.subCell
        )
      case TargetType.Actor:
        return (
          a.data.actor === b.data.actor &&
          a.data.generation === b.data.generation
        )
      case TargetType.FrozenActor:
        return a.data.frozenActor === b.data.frozenActor
      case TargetType.Invalid:
      default:
        return false
    }
  }

  /**
   * Check equality with another Target.
   *
   * OpenRA 对照: Target.Equals(Target)
   */
  equals(other: Target): boolean {
    return Target.equals(this, other)
  }

  // -----------------------------------------------------------------------
  // Conversion
  // -----------------------------------------------------------------------

  /**
   * String representation.
   *
   * OpenRA 对照: Target.ToString()
   */
  toString(): string {
    switch (this.type) {
      case TargetType.Actor:
        return String(this.data.actor)
      case TargetType.FrozenActor:
        return String(this.data.frozenActor)
      case TargetType.Terrain:
        return this.data.terrainCenterPosition!.toString()
      case TargetType.Invalid:
      default:
        return 'Invalid'
    }
  }
}

// ---------------------------------------------------------------------------
// TargetData (internal)
// ---------------------------------------------------------------------------

interface TargetData {
  discriminator: TargetType
  // Terrain
  terrainCenterPosition?: WPos
  terrainPositions?: WPos[]
  cell?: CPos | null
  subCell?: SubCellEnum
  // Actor
  actor?: IActorRef | null
  generation?: number
  // FrozenActor
  frozenActor?: IFrozenActorRef | null
}
