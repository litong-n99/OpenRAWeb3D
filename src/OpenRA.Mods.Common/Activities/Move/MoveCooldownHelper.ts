/**
 * MoveCooldownHelper.ts — 移动冷却辅助类（用于控制移动重试频率）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/MoveCooldownHelper.cs
 *
 * 核心范式转换:
 * - C# sealed class with World/Mobile references → TypeScript class with IGameActor/Mobile references
 * - C# (int, int) tuple for Cooldown → TypeScript [number, number] tuple
 * - C# bool? return type → TypeScript boolean | null (null = continue logic)
 * - C# Random.Next → TypeScript Math.random() (deterministic path uses seeded RNG)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { Mobile } from '../../Traits/Mobile.js'
import { MoveResult } from '../../Traits/Mobile.js'

// ---------------------------------------------------------------------------
// MoveCooldownHelper
// ---------------------------------------------------------------------------

/**
 * Activities that queue move activities via IMove can use this helper to decide
 * when moves with blocked destinations should be retried and to apply a cooldown
 * between repeated moves.
 *
 * OpenRA 对照: MoveCooldownHelper sealed class
 */
export class MoveCooldownHelper {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /**
   * If a move failed because the destination was blocked, indicates if we should try again.
   * When true, tick() will return null when the destination is blocked, after the cooldown has been applied.
   * When false, tick() will return true to indicate the activity should give up and complete.
   * Defaults to false.
   *
   * OpenRA 对照: MoveCooldownHelper.RetryIfDestinationBlocked
   */
  retryIfDestinationBlocked: boolean = false

  /**
   * The cooldown delay in ticks. After a move with a blocked destination, the cooldown will be started.
   * Whilst the cooldown is in effect, tick() will return false.
   * After the cooldown finishes, tick() will return null to allow activity logic to resume.
   * This cooldown is important to avoid lag spikes caused by pathfinding every tick because the destination is unreachable.
   * Defaults to [20, 31).
   *
   * OpenRA 对照: MoveCooldownHelper.Cooldown (ValueTuple<int, int>)
   */
  cooldown: [number, number] = [20, 31]

  // ---------------------------------------------------------------------------
  // Private state
  // ---------------------------------------------------------------------------

  /** Reference to the game world (for tick counting and random access). */
  private readonly world: { sharedRandom?: { next(): number } } | null

  /** Reference to the Mobile trait (for checking move results). */
  private readonly mobile: Mobile | null

  /** Whether we have queued a move activity. */
  private wasMoving: boolean = false

  /** Whether we are currently running the cooldown. */
  private hasRunCooldown: boolean = false

  /** Remaining cooldown ticks. */
  private cooldownTicks: number = 0

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a new MoveCooldownHelper.
   *
   * OpenRA 对照: MoveCooldownHelper(World, Mobile)
   *
   * @param world — the game world (for tick counting and random access)
   * @param mobile — the Mobile trait of the actor (for checking move results)
   */
  constructor(
    world: { sharedRandom?: { next(): number } } | null,
    mobile: Mobile | null,
  ) {
    this.world = world
    this.mobile = mobile
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Call this when queuing a move activity.
   *
   * OpenRA 对照: MoveCooldownHelper.NotifyMoveQueued()
   */
  notifyMoveQueued(): void {
    this.wasMoving = true
  }

  /**
   * Call this method within the Activity.tick() method. It will return a tick result.
   *
   * OpenRA 对照: MoveCooldownHelper.Tick(bool)
   *
   * @param targetIsHiddenActor — if the target is a hidden actor, forces the result to be true once the move has completed
   * @returns A result that should be returned from the calling Tick method.
   *   A non-null result should be returned immediately.
   *   On a null result, the method should continue with its usual logic and perform any desired moves.
   */
  tick(targetIsHiddenActor: boolean): boolean | null {
    // We haven't moved yet, or we did move and we've finished the cooldown, allow the caller to resume with their logic.
    if (!this.wasMoving)
      return null

    if (!this.hasRunCooldown) {
      // The target is hidden, don't continue tracking it.
      if (targetIsHiddenActor)
        return true

      // Movement was cancelled, or we reached our destination, return immediately to allow the caller to perform their next steps.
      if (this.mobile === null || this.mobile.moveResult === MoveResult.CompleteCanceled || this.mobile.moveResult === MoveResult.CompleteDestinationReached) {
        this.wasMoving = false
        return null
      }

      // We couldn't reach the destination, don't try and keep going after the actor.
      if (!this.retryIfDestinationBlocked && this.mobile.moveResult === MoveResult.CompleteDestinationBlocked) {
        return true
      }

      // To avoid excessive pathfinding when the destination is blocked, wait for the cooldown before trying to move again.
      // Applying some jitter to the wait time helps avoid multiple units repathing on the same tick and creating a lag spike.
      this.hasRunCooldown = true
      const [minTicks, maxTicks] = this.cooldown
      if (this.world?.sharedRandom) {
        this.cooldownTicks = minTicks + Math.floor(Math.abs(this.world.sharedRandom.next()) * (maxTicks - minTicks))
      } else {
        this.cooldownTicks = minTicks
      }
      return false
    }
    else {
      if (this.cooldownTicks > 0)
        this.cooldownTicks--

      if (this.cooldownTicks <= 0) {
        this.hasRunCooldown = false
        this.wasMoving = false
      }

      return false
    }
  }

  /**
   * Reset the internal state. Useful for testing or when the activity is cancelled.
   */
  reset(): void {
    this.wasMoving = false
    this.hasRunCooldown = false
    this.cooldownTicks = 0
  }
}
