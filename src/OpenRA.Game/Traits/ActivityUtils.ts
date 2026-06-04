/**
 * ActivityUtils.ts — Activity chain execution runner
 * OpenRA 对照: OpenRA.Game/Traits/ActivityUtils.cs
 *
 * 核心范式转换:
 * - C# static class ActivityUtils with RunActivity → TypeScript module with
 *   exported runActivity() function
 * - C# PerfTickLogger for performance monitoring → TypeScript omits
 *   (monitoring done via browser DevTools performance API if needed)
 * - C# concrete Activity type parameter → TypeScript structural interface
 *   (Tickable) to avoid circular import between Activity.ts and this file
 *
 * NOTE: This is a HOT PATH. The function must run with minimal overhead.
 * Zero heap allocation per call. The do-while loop matches OpenRA exactly.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameActor } from '../Actor.js'

// ---------------------------------------------------------------------------
// Tickable — structural interface for tickOuter
// ---------------------------------------------------------------------------

/**
 * Structural interface for any object with a tickOuter method.
 *
 * This avoids importing the concrete Activity class (which would create a
 * circular dependency since Activity.tickChild calls runActivity).
 *
 * OpenRA 对照: Activity (the type accepted by ActivityUtils.RunActivity)
 */
export interface Tickable {
  /**
   * Execute one outer tick.
   *
   * OpenRA 对照: Activity.TickOuter(Actor)
   *
   * @param self — the actor performing the activity
   * @returns the next activity to run, or the same activity if blocking
   */
  tickOuter(self: GameActor): Tickable | null
}

// ---------------------------------------------------------------------------
// runActivity (对应 OpenRA ActivityUtils.RunActivity)
// ---------------------------------------------------------------------------

/**
 * Execute the activity chain for an actor.
 *
 * OpenRA 对照: ActivityUtils.RunActivity(Actor, Activity)
 *
 * PERF: This is a hot path and must run with minimal added overhead.
 *
 * The loop advances through the activity chain:
 * - Calls tickOuter() on the current activity
 * - If tickOuter returns a different activity, advance to it
 * - If tickOuter returns null, the chain is complete
 * - If tickOuter returns the same activity (this), the activity blocked
 *   and wants to keep running — exit the loop
 *
 * @param self — the actor whose activities are being run
 * @param act — the current root activity (may be null)
 * @returns the next activity to run, or null if the chain is exhausted
 */
export function runActivity(
  self: GameActor,
  act: Tickable | null,
): Tickable | null {
  // PERF: This is a hot path and must run with minimal added overhead.
  if (act === null)
    return null

  let current: Tickable | null = act
  // do { prev = current; current = prev.tickOuter(self); if same, break; } while (current != null);
  // Unrolled slightly for clarity:
  while (current !== null) {
    const prev: Tickable = current
    current = prev.tickOuter(self)
    if (current === prev)
      break
  }
  return current
}
