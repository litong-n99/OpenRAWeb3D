/**
 * Wait.ts — 等待活动 (Phase F 完整实现)
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Wait.cs
 *
 * 核心范式转换:
 * - C# Wait + WaitFor classes → TypeScript Wait + WaitFor classes
 * - C# Func<bool> predicate → TypeScript (() => boolean)
 * - C# IsInterruptible property → inherited from Activity base
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, ActivityState } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

/**
 * Wait for a fixed number of ticks before completing.
 *
 * OpenRA 对照: Wait activity
 *
 * Used by: Hunt (wait between searches), DeliverBulkOrder (unload delays),
 * ReturnToBase (holding pattern), Land (holding pattern), UnloadCargo.
 */
export class Wait extends Activity {
  /** Remaining ticks before this activity completes. */
  private remainingTicks: number

  /**
   * Create a Wait activity.
   *
   * OpenRA 对照: Wait(int period) / Wait(int period, bool interruptible)
   *
   * @param ticks — number of ticks to wait (0 or negative completes after 1 tick)
   * @param interruptible — whether this wait can be interrupted (default true)
   */
  constructor(ticks: number, interruptible: boolean = true) {
    super()
    this.remainingTicks = ticks
    this.isInterruptible = interruptible
  }

  override tick(_self: GameActor): boolean {
    if (this.isCanceling || this.state === ActivityState.Done) return true
    if (this.remainingTicks <= 0) return true
    this.remainingTicks--
    return this.remainingTicks <= 0
  }
}

// ---------------------------------------------------------------------------
// WaitFor
// ---------------------------------------------------------------------------

/**
 * Wait until a predicate function returns true.
 *
 * OpenRA 对照: WaitFor activity
 *
 * Used by: Transform (wait forever for make animation),
 * various condition-based wait scenarios.
 */
export class WaitFor extends Activity {
  private readonly predicate: (() => boolean) | null

  /**
   * Create a WaitFor activity.
   *
   * OpenRA 对照: WaitFor(Func<bool> f) / WaitFor(Func<bool> f, bool interruptible)
   *
   * @param predicate — function returning true when wait should complete (null = wait forever)
   * @param interruptible — whether this wait can be interrupted (default true)
   */
  constructor(predicate: (() => boolean) | null, interruptible: boolean = true) {
    super()
    this.predicate = predicate
    this.isInterruptible = interruptible
  }

  override tick(_self: GameActor): boolean {
    if (this.isCanceling || this.state === ActivityState.Done) return true
    return this.predicate === null ? false : this.predicate()
  }
}
