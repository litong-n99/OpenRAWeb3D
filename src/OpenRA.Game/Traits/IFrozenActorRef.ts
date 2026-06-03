/**
 * IFrozenActorRef.ts — Lightweight FrozenActor reference interface for Target
 * OpenRA 对照: OpenRA.Game/Traits/FrozenActor.cs (subset used by Target)
 *
 * 核心范式转换:
 * - C# concrete FrozenActor class → minimal TypeScript interface
 * - Only exposes members needed by Target (IsValid, Visible, Hidden,
 *   CenterPosition, TargetablePositions)
 * - Full FrozenActor class will implement this interface
 */

import type { WPos } from '../WPos'

// ---------------------------------------------------------------------------
// IFrozenActorRef
// ---------------------------------------------------------------------------

/**
 * Lightweight reference to a FrozenActor (fog-of-war ghost) for use by Target.
 *
 * OpenRA 对照: FrozenActor (subset used by Target)
 *
 * FrozenActors are the fog-of-war representations of real actors that are
 * no longer visible but whose last-known position is tracked.
 */
export interface IFrozenActorRef {
  /** Whether this frozen actor is still valid (not removed from fog).
   *
   * OpenRA 对照: FrozenActor.IsValid
   */
  readonly isValid: boolean

  /** Whether this frozen actor is currently visible.
   *
   * OpenRA 对照: FrozenActor.Visible
   */
  readonly visible: boolean

  /** Whether this frozen actor is hidden.
   *
   * OpenRA 对照: FrozenActor.Hidden
   */
  readonly hidden: boolean

  /** The frozen actor's center position.
   *
   * OpenRA 对照: FrozenActor.CenterPosition
   */
  readonly centerPosition: WPos

  /** Targetable positions (may be null/empty if invalid).
   *
   * OpenRA 对照: FrozenActor.TargetablePositions
   */
  readonly targetablePositions: WPos[] | null
}
