/**
 * EnterAlliedActorTargeter.ts — order targeter for entering allied actors (transport/garrion)
 * OpenRA 对照: OpenRA.Mods.Common/Orders/EnterAlliedActorTargeter.cs (49 lines)
 *
 * 核心范式转换:
 * - C# generic EnterAlliedActorTargeter<T> where T : ITraitInfoInterface →
 *   TS traitKey: string 参数（运行时 trait 名称代替编译时泛型）
 * - C# Actor.Owner.IsAlliedWith(Actor.Owner) → TS self.owner / target.owner
 *   简化关系检查（目标玩家必须有 isAlliedWith 方法）
 * - C# target.Info.HasTraitInfo<T>() → TS target.info.hasTraitInfo(traitKey)
 * - C# ref string cursor → TS 可变 _currentCursor + 覆盖 getCursor() 模拟
 *   ref 输出语义（base.cursor 是 readonly，子类使用独立可变字段）
 *
 * NOTE: canTargetFrozenActor() 始终返回 false — allied actors are never
 * frozen (fog-of-war only applies to enemy units).
 */

import type {
  IGameActor,
  FrozenActorStub,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PlayerRelationship } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { UnitOrderTargeter } from './UnitOrderTargeter.js'

// ---------------------------------------------------------------------------
// Callback types
// ---------------------------------------------------------------------------

/**
 * Delegate that validates whether an actor can be targeted.
 *
 * OpenRA 对照: Func<Actor, TargetModifiers, bool> canTarget
 *
 * Additional filters beyond the mandatory allied + trait checks.
 */
export type EnterAlliedCanTargetFn = (
  target: IGameActor,
  modifiers: TargetModifiers,
) => boolean

/**
 * Delegate that selects which cursor to show for a valid target.
 *
 * OpenRA 对照: Func<Actor, bool> useEnterCursor
 *
 * Returns true to show enterCursor, false to show enterBlockedCursor.
 */
export type EnterAlliedUseEnterCursorFn = (target: IGameActor) => boolean

// ---------------------------------------------------------------------------
// Owner interface with diplomacy
// ---------------------------------------------------------------------------

/**
 * Minimal player owner interface with allied check.
 *
 * OpenRA 对照: Player.RelationshipWith(Player) — Stance bitmask check
 */
interface IOwnerWithAllied {
  readonly playerName: string
  isAlliedWith?(other: IOwnerWithAllied): boolean
  relationshipWith?(other: IOwnerWithAllied): PlayerRelationship
}

/** ActorInfo subset needed for trait existence checks. */
interface IActorInfoWithTraits {
  readonly name: string
  hasTraitInfo(traitKey: string): boolean
}

/**
 * IGameActor with guaranteed owner and info for trait lookup.
 *
 * Used via `as unknown as IActorWithOwner` cast from IGameActor.
 * Does NOT extend IGameActor to avoid optional-property conflicts.
 */
interface IActorWithOwner {
  owner: IOwnerWithAllied
  info: IActorInfoWithTraits
}

// ---------------------------------------------------------------------------
// EnterAlliedActorTargeter
// ---------------------------------------------------------------------------

/**
 * Targets allied actors that can be entered (transports, garrisons).
 *
 * OpenRA 对照: EnterAlliedActorTargeter<T> : UnitOrderTargeter
 *
 * Used by order targeters like EnterTransportTargeter and
 * EnterGarrisonTargeter. Validates that:
 * 1. The target is allied (friendly)
 * 2. The target has the required trait (e.g., "Cargo" for transports)
 * 3. The custom canTarget delegate passes
 * 4. Cursor is selected based on useEnterCursor(target)
 *
 * @param traitKey — the trait info key string (e.g., "Cargo", "Passenger")
 *                   replacing C# generic type parameter `<T>`
 */
export class EnterAlliedActorTargeter extends UnitOrderTargeter {
  /** Trait info key that the target must have (replaces C# generic `<T>`). */
  private readonly _traitKey: string

  /** Cursor string shown when target is enterable. */
  private readonly _enterCursor: string

  /** Cursor string shown when target is blocked for entry. */
  private readonly _enterBlockedCursor: string

  /** Custom validity delegate (beyond allied + trait checks). */
  private readonly _canTargetFn: EnterAlliedCanTargetFn

  /** Cursor selection delegate (enterCursor vs enterBlockedCursor). */
  private readonly _useEnterCursorFn: EnterAlliedUseEnterCursorFn

  /**
   * Current resolved cursor, updated by canTargetActor.
   * OpenRA 对照: ref string cursor (set after all validation passes)
   *
   * NOTE: base.cursor is readonly (set at construction). This subclass
   * uses _currentCursor as a mutable field to emulate C# ref semantics.
   * getCursor() is overridden to return this field.
   */
  private _currentCursor: string

  /**
   * @param order — the order identifier string (e.g., "EnterTransport")
   * @param priority — the order priority (higher = checked first)
   * @param enterCursor — cursor name when target can be entered
   * @param enterBlockedCursor — cursor name when target is blocked
   * @param canTargetFn — additional target validity check
   * @param useEnterCursorFn — selects enterCursor or enterBlockedCursor
   * @param traitKey — the trait info key required on the target
   */
  constructor(
    order: string,
    priority: number,
    enterCursor: string,
    enterBlockedCursor: string,
    canTargetFn: EnterAlliedCanTargetFn,
    useEnterCursorFn: EnterAlliedUseEnterCursorFn,
    traitKey: string,
  ) {
    // OpenRA 对照: base(order, priority, enterCursor, false, true)
    //   — targets ally units only (targetEnemyUnits = false, targetAllyUnits = true)
    super(order, priority, enterCursor, false, true)
    this._traitKey = traitKey
    this._enterCursor = enterCursor
    this._enterBlockedCursor = enterBlockedCursor
    this._canTargetFn = canTargetFn
    this._useEnterCursorFn = useEnterCursorFn
    this._currentCursor = enterCursor // default cursor
  }

  // ---------------------------------------------------------------------------
  // UnitOrderTargeter abstract overrides
  // ---------------------------------------------------------------------------

  /**
   * Check if a specific actor can be targeted for entry.
   *
   * OpenRA 对照: EnterAlliedActorTargeter.CanTargetActor(Actor, Actor, TargetModifiers, ref string)
   *
   * Validation chain:
   * 1. Allied check — self and target must be allied
   * 2. Trait check — target must have `_traitKey` in its ActorInfo
   * 3. Custom canTarget check — delegate filters (e.g., transport not full)
   * 4. Cursor selection — enterCursor or enterBlockedCursor via `_useEnterCursorFn`
   *
   * @param self — the actor issuing the enter order
   * @param target — the actor being targeted for entry
   * @param modifiers — target modifiers (ForceAttack, ForceQueue, etc.)
   * @param _cursor — cursor name from base class (unused — we set _currentCursor)
   * @returns true if the target can be entered
   */
  canTargetActor(
    self: IGameActor,
    target: IGameActor,
    modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    // Cast to narrow types for owner/trait access
    const selfActor = self as unknown as IActorWithOwner
    const targetActor = target as unknown as IActorWithOwner

    // 1. Allied check
    // OpenRA 对照: !self.Owner.IsAlliedWith(target.Owner)
    if (!this.isAllied(selfActor.owner, targetActor.owner)) {
      return false
    }

    // 2. Trait check
    // OpenRA 对照: !target.Info.HasTraitInfo<T>()
    if (!targetActor.info?.hasTraitInfo(this._traitKey)) {
      return false
    }

    // 3. Custom canTarget delegate
    // OpenRA 对照: !canTarget(target, modifiers)
    if (!this._canTargetFn(target, modifiers)) {
      return false
    }

    // 4. Select cursor (matching C# ref cursor = useEnterCursor(...) ? enterCursor : enterBlockedCursor)
    this._currentCursor = this._useEnterCursorFn(target)
      ? this._enterCursor
      : this._enterBlockedCursor

    return true
  }

  /**
   * Check if a frozen actor can be targeted for entry.
   *
   * OpenRA 对照: EnterAlliedActorTargeter.CanTargetFrozenActor(...)
   *
   * Always returns false: allied actors are never frozen.
   * Fog-of-war only applies to enemy/neutral units.
   *
   * @returns always false
   */
  canTargetFrozenActor(
    _self: IGameActor,
    _target: FrozenActorStub,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    // Allied actors are never frozen
    return false
  }

  // ---------------------------------------------------------------------------
  // Cursor — override getCursor to return dynamic cursor
  // ---------------------------------------------------------------------------

  /**
   * Get the current resolved cursor for this targeter.
   *
   * OpenRA 对照: cursor variable after CanTargetActor sets it via ref
   *
   * Overrides UnitOrderTargeter.getCursor() to return the dynamic cursor
   * set by the last successful canTargetActor() call, instead of the
   * fixed construction-time cursor.
   */
  override getCursor(): string {
    return this._currentCursor
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if two owners are allied.
   *
   * OpenRA 对照: self.Owner.IsAlliedWith(target.Owner)
   *
   * Tries multiple strategies:
   * 1. `isAlliedWith()` method (if available)
   * 2. `relationshipWith()` method returning PlayerRelationship.Ally
   * 3. Fallback: same playerName === same owner
   */
  private isAllied(selfOwner: IOwnerWithAllied, targetOwner: IOwnerWithAllied): boolean {
    // Strategy 1: direct isAlliedWith method
    if (selfOwner.isAlliedWith) {
      return selfOwner.isAlliedWith(targetOwner)
    }

    // Strategy 2: relationshipWith
    if (selfOwner.relationshipWith) {
      const rel = selfOwner.relationshipWith(targetOwner)
      return rel === PlayerRelationship.Ally
    }

    // Strategy 3: fallback — same owner
    return selfOwner.playerName === targetOwner.playerName
  }
}
