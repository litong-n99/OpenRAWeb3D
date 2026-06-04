/**
 * CallFunc.ts — One-shot callback Activity（单次回调活动）
 * OpenRA 对照: OpenRA.Game/Activities/CallFunc.cs
 *
 * 核心范式转换:
 * - C# Action delegate → TypeScript () => void function
 * - C# constructor overloads (Action, Action + bool) → TypeScript overloaded
 *   constructor with optional isInterruptible parameter
 * - C# IsInterruptible property set in constructor → TypeScript property
 *   assigned in constructor body
 *
 * Usage:
 * ```
 * actor.queueActivity(new CallFunc(() => {
 *   console.log('Move complete!')
 * }))
 * ```
 *
 * CallFunc is used for one-shot actions that should happen at a specific
 * point in an activity chain — e.g., "play sound after move completes"
 * or "explode after delay".
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameActor } from '../Actor.js'
import { Activity } from './Activity.js'

// ---------------------------------------------------------------------------
// CallFunc (对应 OpenRA CallFunc)
// ---------------------------------------------------------------------------

/**
 * A simple activity that invokes a callback on its first tick and
 * completes immediately.
 *
 * OpenRA 对照: OpenRA.Activities.CallFunc
 *
 * Useful for inserting one-shot logic into an activity chain:
 * - Play a sound effect after a move completes
 * - Deploy an explosion at the actor's position
 * - Trigger a UI notification
 *
 * The callback is invoked exactly once, during the first tick() call.
 * After invocation, tick() returns true, completing the activity.
 *
 * If the callback should NOT be interrupted (e.g., it performs a
 * critical state change), pass `interruptible: false` to the constructor.
 */
export class CallFunc extends Activity {
  /**
   * The callback to invoke.
   *
   * OpenRA 对照: CallFunc.a (readonly Action)
   */
  private readonly callback: () => void

  /**
   * Create a new CallFunc activity.
   *
   * OpenRA 对照: CallFunc(Action) / CallFunc(Action, bool)
   *
   * @param callback — the function to invoke on the first tick
   * @param interruptible — whether this activity can be cancelled
   *   (default: true, matching OpenRA's Activity base default)
   */
  constructor(callback: () => void, interruptible: boolean = true) {
    super()
    this.callback = callback
    this.isInterruptible = interruptible
  }

  /**
   * Invoke the callback and complete immediately.
   *
   * OpenRA 对照: CallFunc.Tick(Actor)
   *
   * The callback is called exactly once. The activity completes on
   * the same tick (returns true).
   *
   * @param self — the actor performing this activity (not used by CallFunc)
   * @returns true (always completes immediately)
   */
  override tick(_self: GameActor): boolean {
    this.callback()
    return true
  }
}
