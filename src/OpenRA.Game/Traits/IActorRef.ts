/**
 * IActorRef.ts — Lightweight Actor reference interface for Target
 * OpenRA 对照: OpenRA.Game/Actor.cs (subset used by Target)
 *
 * 核心范式转换:
 * - C# concrete Actor class → minimal TypeScript interface
 * - Only exposes members needed by Target (IsInWorld, IsDead, Generation,
 *   CenterPosition, IsTargetableBy, GetTargetablePositions)
 * - Full Actor class will implement this interface
 */

import type { WPos } from '../WPos'

// ---------------------------------------------------------------------------
// IActorRef
// ---------------------------------------------------------------------------

/**
 * Lightweight reference to an Actor for use by Target.
 *
 * OpenRA 对照: Actor (subset used by Target)
 *
 * Provides only the members Target needs to validate and query an actor.
 * This avoids a circular dependency: Target → Actor → Target.
 */
export interface IActorRef {
  /** Whether the actor is currently in the world.
   *
   * OpenRA 对照: Actor.IsInWorld
   */
  readonly isInWorld: boolean

  /** Whether the actor is dead.
   *
   * OpenRA 对照: Actor.IsDead
   */
  readonly isDead: boolean

  /** The actor's generation counter (for detecting teleport/capture).
   *
   * OpenRA 对照: Actor.Generation
   */
  readonly generation: number

  /** The actor's center position in world coordinates.
   *
   * OpenRA 对照: Actor.CenterPosition
   */
  readonly centerPosition: WPos

  /**
   * Check whether this actor can be targeted by another actor.
   *
   * OpenRA 对照: Actor.IsTargetableBy(Actor)
   */
  isTargetableBy(targeter: IActorRef): boolean

  /**
   * Get all targetable positions on this actor for range checks.
   *
   * OpenRA 对照: Actor.GetTargetablePositions()
   */
  getTargetablePositions(): WPos[]
}
