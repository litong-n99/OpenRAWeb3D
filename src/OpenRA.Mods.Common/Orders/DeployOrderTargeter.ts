/**
 * DeployOrderTargeter.ts — IOrderTargeter implementation for Deploy/Transform orders
 * OpenRA 对照: OpenRA.Mods.Common/Orders/DeployOrderTargeter.cs (46 lines)
 *
 * 核心范式转换:
 * - C# Func<string> cursor delegate → TS () => string function
 * - C# ref TargetModifiers modifiers → TS value parameter (simplified)
 * - C# ref string cursor → TS cursor output via getCursor() getter
 *
 * NOTE: The C# DeployOrderTargeter uses `ref` parameters for modifiers and cursor.
 * In TypeScript, ref semantics are not available. The cursor is exposed via a
 * getCursor() method that callers invoke when targeting is valid.
 */

import type { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IGameActor,
  IOrderTargeter,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { TargetType, type Target } from '../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// DeployOrderTargeter
// ---------------------------------------------------------------------------

/**
 * Order targeter that validates deploy/transform orders.
 *
 * OpenRA 对照: DeployOrderTargeter : IOrderTargeter
 *
 * Deployment orders can only target the actor issuing the order.
 * Used by traits that transform/deploy, such as MCV → Construction Yard
 * and various building → deployed form transformations.
 */
export class DeployOrderTargeter implements IOrderTargeter {
  /** Order identifier (e.g., "DeployTransform"). */
  readonly orderID: string

  /** Priority for order conflict resolution (higher = checked first). */
  readonly orderPriority: number

  /** Whether the order should be queued (set during CanTarget). */
  isQueued: boolean = false

  /** Cursor callback — returns the cursor name for this order. */
  private cursorFn: () => string

  /**
   * @param order — the order identifier string
   * @param priority — the order priority
   * @param cursorFn — function that returns the cursor name
   */
  constructor(order: string, priority: number, cursorFn: () => string) {
    this.orderID = order
    this.orderPriority = priority
    this.cursorFn = cursorFn
  }

  /**
   * Get the cursor name for this order.
   *
   * OpenRA 对照: DeployOrderTargeter.cursor delegate invocation
   */
  getCursor(): string {
    return this.cursorFn()
  }

  // ---------------------------------------------------------------------------
  // IOrderTargeter implementation
  // ---------------------------------------------------------------------------

  /**
   * Check whether the target is valid for this order.
   *
   * OpenRA 对照: DeployOrderTargeter.CanTarget(Actor, Target, ref TargetModifiers, ref string)
   *
   * Valid only when targeting the actor itself (self-target).
   *
   * @param self — the actor issuing the order
   * @param target — the target to check
   * @param modifiers — target modifiers (ForceAttack, ForceQueue, etc.)
   * @param _cursor — placeholder for cursor (see getCursor())
   * @returns true if the target is self
   */
  canTarget(
    self: IGameActor,
    target: Target,
    modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    if (target.type !== TargetType.Actor)
      return false

    // NOTE: In the C# version, modifiers.HasModifier(TargetModifiers.ForceQueue)
    // is checked. The TS equivalent uses bitwise AND.
    this.isQueued = (modifiers & 2 /* ForceQueue */) !== 0

    // Deploy can only target self
    // NOTE: target.actor returns IActorRef | null, while self is IGameActor.
    // In the real system, the same actor object implements both interfaces,
    // so reference equality is correct.
    return (target.actor as unknown as IGameActor | null) === self
  }

  /**
   * Whether this targeter should override selection when targeting.
   *
   * OpenRA 对照: DeployOrderTargeter.TargetOverridesSelection(Actor, Target, ...)
   *
   * For deploy orders, always returns true — the deployment takes precedence
   * over any selection targeting.
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
}
