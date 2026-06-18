/**
 * UnitOrderTargeter.ts — abstract IOrderTargeter for unit-targeted orders
 * OpenRA 对照: OpenRA.Mods.Common/Orders/UnitOrderTargeter.cs (89 lines)
 *
 * 核心范式转换:
 * - C# abstract class + virtual CanTarget → TS abstract class with defaults
 * - C# FrozenActor target validation → TS FrozenActorStub-based check
 * - C# Actor.Owner.RelationshipWith(owner) → TS simplified owner comparison
 * - C# targetTypes.Overlaps(BitSet) → TS simplified Set intersection check
 * - C# ref string cursor → TS cursor string parameter (input only)
 *
 * NOTE: The CanTarget method performs relationship checks (enemy/ally filtering)
 * based on the owner relationship between the issuing actor and the target.
 * Subclasses override CanTargetActor/CanTargetFrozenActor for type-specific
 * validation (e.g., checking target types via BitSet overlap).
 */

import type { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IGameActor,
  IOrderTargeter,
  FrozenActorStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  TargetModifiers,
  PlayerRelationship,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { TargetType, type Target } from '../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// UnitOrderTargeter
// ---------------------------------------------------------------------------

/**
 * Abstract base for order targeters that target units (actors).
 *
 * OpenRA 对照: UnitOrderTargeter : IOrderTargeter
 *
 * Performs relationship filtering (enemy/ally checks) and dispatches
 * to type-specific CanTargetActor or CanTargetFrozenActor methods.
 *
 * Subclasses override CanTargetActor and CanTargetFrozenActor to provide
 * type-specific validation (e.g., checking if the target has the correct
 * target types).
 *
 * Example subclasses in OpenRA: DemolitionOrderTargeter, RepairOrderTargeter,
 * CaptureOrderTargeter, etc.
 */
export abstract class UnitOrderTargeter implements IOrderTargeter {
  /** Order identifier string. */
  readonly orderID: string

  /** Priority for order conflict resolution. */
  readonly orderPriority: number

  /** Whether the order should be queued (set during CanTarget). */
  isQueued: boolean = false

  /** Cursor name for this order. */
  protected readonly cursor: string

  /** Whether this order can target enemy units. */
  protected readonly targetEnemyUnits: boolean

  /** Whether this order can target allied units. */
  protected readonly targetAllyUnits: boolean

  /**
   * If set, overrides the ForceAttack modifier check.
   * null means accept either state.
   * true means ForceAttack MUST be active.
   * false means ForceAttack must NOT be active.
   *
   * OpenRA 对照: UnitOrderTargeter.ForceAttack
   */
  forceAttack: boolean | null = null

  /**
   * @param order — the order identifier string
   * @param priority — the order priority (higher = checked first)
   * @param cursor — the cursor name for this order
   * @param targetEnemyUnits — whether enemy units can be targeted
   * @param targetAllyUnits — whether allied units can be targeted
   */
  constructor(
    order: string,
    priority: number,
    cursor: string,
    targetEnemyUnits: boolean,
    targetAllyUnits: boolean,
  ) {
    this.orderID = order
    this.orderPriority = priority
    this.cursor = cursor
    this.targetEnemyUnits = targetEnemyUnits
    this.targetAllyUnits = targetAllyUnits
  }

  // ---------------------------------------------------------------------------
  // Abstract methods — subclasses override for type-specific validation
  // ---------------------------------------------------------------------------

  /**
   * Check whether a specific actor can be targeted by this order.
   *
   * OpenRA 对照: UnitOrderTargeter.CanTargetActor(Actor, Actor, TargetModifiers, ref string)
   *
   * Called AFTER relationship checks pass.
   *
   * @param self — the actor issuing the order
   * @param target — the actor being targeted
   * @param modifiers — target modifiers
   * @param cursor — output: receives the cursor name
   * @returns true if the target actor is valid for this order
   */
  abstract canTargetActor(
    self: IGameActor,
    target: IGameActor,
    modifiers: TargetModifiers,
    cursor: string,
  ): boolean

  /**
   * Check whether a specific frozen actor can be targeted by this order.
   *
   * OpenRA 对照: UnitOrderTargeter.CanTargetFrozenActor(Actor, FrozenActor, TargetModifiers, ref string)
   *
   * @param self — the actor issuing the order
   * @param target — the frozen actor being targeted
   * @param modifiers — target modifiers
   * @param cursor — output: receives the cursor name
   * @returns true if the frozen actor is valid for this order
   */
  abstract canTargetFrozenActor(
    self: IGameActor,
    target: FrozenActorStub,
    modifiers: TargetModifiers,
    cursor: string,
  ): boolean

  // ---------------------------------------------------------------------------
  // IOrderTargeter implementation
  // ---------------------------------------------------------------------------

  /**
   * Check whether a target is valid for this order.
   *
   * OpenRA 对照: UnitOrderTargeter.CanTarget(Actor, Target, ref TargetModifiers, ref string)
   *
   * Performs relationship filtering (enemy/ally checks) and dispatches
   * to CanTargetActor or CanTargetFrozenActor.
   */
  canTarget(
    self: IGameActor,
    target: Target,
    modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    const type = target.type
    if (type !== TargetType.Actor && type !== TargetType.FrozenActor)
      return false

    // Check ForceAttack modifier constraint
    if (this.forceAttack !== null) {
      const isForceAttack = (modifiers & TargetModifiers.ForceAttack) !== 0
      if (isForceAttack !== this.forceAttack)
        return false
    }

    // Relationship checks using actual diplomacy lookup
    const isForceAttack = (modifiers & TargetModifiers.ForceAttack) !== 0
    if (!isForceAttack) {
      // Get owner of target and check relationship with self's owner
      const selfOwner = self.owner
      if (selfOwner) {
        let targetOwner: { readonly playerName: string } | undefined

        if (type === TargetType.FrozenActor) {
          // NOTE: FrozenActorStub has no owner — skip relationship check
          // for frozen actors. Full implementation will add owner to
          // FrozenActorStub when fog-of-war is migrated (Chapter 12).
          // Add owner to FrozenActorStub for relationship checks.
        } else {
          // Actor target — use IGameActor.owner
          const targetActor = target.actor
          if (targetActor && 'owner' in targetActor) {
            // Use unknown intermediate cast to bridge IActorRef → IGameActor
            targetOwner = (targetActor as unknown as IGameActor).owner
          }
        }

        if (targetOwner) {
          // OpenRA 对照: target.Owner.RelationshipWith(self.Owner)
          const targetOwnerRel = targetOwner as unknown as {
            relationshipWith?(other: unknown): PlayerRelationship
          }
          const relationship = targetOwnerRel.relationshipWith
            ? targetOwnerRel.relationshipWith(selfOwner)
            : (targetOwner === selfOwner
              ? PlayerRelationship.Ally
              : PlayerRelationship.Enemy)

          if (relationship === PlayerRelationship.Ally && !this.targetAllyUnits)
            return false
          if (relationship === PlayerRelationship.Enemy && !this.targetEnemyUnits)
            return false
          // Neutral relationship: target neither enemy nor ally
          if (relationship === PlayerRelationship.Neutral)
            return false
        }
      }
    }

    // Set isQueued based on ForceQueue modifier
    this.isQueued = (modifiers & TargetModifiers.ForceQueue) !== 0

    // Dispatch to type-specific validation
    if (type === TargetType.FrozenActor) {
      const frozenTarget = target.frozenActor
      if (!frozenTarget) return false
      // Convert IFrozenActorRef to FrozenActorStub
      const frozenStub: FrozenActorStub = {
        isValid: frozenTarget.isValid,
        visible: frozenTarget.visible,
        hidden: frozenTarget.hidden,
        centerPosition: frozenTarget.centerPosition,
      }
      return this.canTargetFrozenActor(self, frozenStub, modifiers, this.cursor)
    }

    // Actor target
    const actorTarget = target.actor
    if (!actorTarget) return false
    // IActorRef doesn't have owner, but IGameActor does.
    // In the real system, all actors implement both interfaces.
    // Use explicit unknown cast to break type incompatibility.
    const gameActor: IGameActor = actorTarget as unknown as IGameActor
    return this.canTargetActor(self, gameActor, modifiers, this.cursor)
  }

  /**
   * Whether this targeter should override selection when targeting.
   *
   * OpenRA 对照: UnitOrderTargeter.TargetOverridesSelection(...)
   *
   * For unit orders, always returns true — the order takes precedence
   * over selection.
   */
  targetOverridesSelection(
    _self: IGameActor,
    _target: Target,
    _actorsAt: readonly IGameActor[],
    _xy: CPos,
    _modifiers: TargetModifiers,
  ): boolean {
    return true
  }

  /**
   * Get the cursor name for this order.
   *
   * Exposed so callers can retrieve the cursor when CanTarget returns true,
   * mirroring the C# ref cursor pattern.
   */
  getCursor(): string {
    return this.cursor
  }
}

// ---------------------------------------------------------------------------
// TargetTypeOrderTargeter — concrete subclass that filters by target types
// OpenRA 对照: TargetTypeOrderTargeter : UnitOrderTargeter
// ---------------------------------------------------------------------------

/**
 * Unit order targeter that filters targets by their target types.
 *
 * OpenRA 对照: TargetTypeOrderTargeter
 *
 * Most unit orders (Demolish, Capture, Repair, etc.) use this pattern:
 * the target must have specific target types (e.g., "Building", "Vehicle").
 */
export class TargetTypeOrderTargeter extends UnitOrderTargeter {
  /** Set of target type strings that are valid for this order. */
  private readonly targetTypes: ReadonlySet<string>

  /**
   * @param targetTypes — set of valid target type strings
   * @param order — the order identifier string
   * @param priority — the order priority
   * @param cursor — the cursor name
   * @param targetEnemyUnits — whether enemy units can be targeted
   * @param targetAllyUnits — whether allied units can be targeted
   */
  constructor(
    targetTypes: ReadonlySet<string>,
    order: string,
    priority: number,
    cursor: string,
    targetEnemyUnits: boolean,
    targetAllyUnits: boolean,
  ) {
    super(order, priority, cursor, targetEnemyUnits, targetAllyUnits)
    this.targetTypes = targetTypes
  }

  /**
   * Check if the target actor has any of the required target types.
   *
   * OpenRA 对照: TargetTypeOrderTargeter.CanTargetActor()
   *
   * Uses a simplified Set-based check instead of BitSet.Overlaps.
   * Full implementation will use BitSet<TargetableType> when trait
   * system supports it.
   *
   * @param _self — the actor issuing the order
   * @param target — the actor being targeted
   * @param _modifiers — target modifiers
   * @param cursor — cursor name (passed through from CanTarget)
   */
  canTargetActor(
    _self: IGameActor,
    target: IGameActor,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    // NOTE: Full implementation needs Actor.GetEnabledTargetTypes()
    // which returns a BitSet<TargetableType>. For now, we use a simplified
    // check: if the target info has a name that matches one of the target types.
    // Implement target type lookup via ActorInfo.TraitInfos<ITargetableInfo>
    const targetTypeStr = target.info?.name ?? ''
    if (this.targetTypes.has(targetTypeStr)) {
      return true
    }
    return false
  }

  /**
   * Check if the frozen actor has any of the required target types.
   *
   * OpenRA 对照: TargetTypeOrderTargeter.CanTargetFrozenActor()
   */
  canTargetFrozenActor(
    _self: IGameActor,
    _target: FrozenActorStub,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    // NOTE: FrozenActor target types are not available without the full
    // FrozenActor class (Chapter 12). For Phase B, frozen actor targeting
    // always returns false (cannot target through fog).
    return false
  }
}
