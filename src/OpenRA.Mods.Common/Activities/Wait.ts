/**
 * Wait.ts — 等待活动（最小化存根）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Wait.cs
 *
 * 核心范式转换:
 * - C# Wait activity with multiple constructors → TypeScript minimal stub
 * - Full Wait with condition callbacks deferred to Phase F
 *
 * NOTE: This is a minimal stub. Phase F will implement the full Wait activity
 * with conditional wait, random wait, and callback support.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

/**
 * Wait for a fixed number of ticks before completing.
 *
 * OpenRA 对照: Wait activity
 *
 * Minimal stub: counts down from the initial tick count and returns true
 * when the counter reaches zero. Full Wait (Phase F) will support:
 * - Conditional wait (wait until predicate is true)
 * - Random wait range
 * - Delayed action callbacks
 *
 * Used by: Hunt (wait between searches), DeliverBulkOrder (unload delays),
 * ReturnToBase (holding pattern), Land (holding pattern).
 */
export class Wait extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Remaining ticks before this activity completes.
   *
   * OpenRA 对照: Wait.remainingTicks
   */
  private remainingTicks: number

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a Wait activity.
   *
   * OpenRA 对照: Wait(Actor self, int ticks)
   *
   * @param ticks — number of ticks to wait (0 or negative completes immediately)
   */
  constructor(ticks: number) {
    super()
    this.remainingTicks = ticks
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Count down remaining ticks.
   *
   * OpenRA 对照: Wait.Tick(Actor)
   *
   * @returns true when countdown reaches zero, false otherwise
   */
  override tick(): boolean {
    if (this.remainingTicks <= 0) return true
    this.remainingTicks--
    return this.remainingTicks <= 0
  }
}
