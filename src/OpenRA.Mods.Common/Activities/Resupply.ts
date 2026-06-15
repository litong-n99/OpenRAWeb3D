/**
 * Resupply.ts — 补给活动（最小化存根）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Resupply.cs
 *
 * 核心范式转换:
 * - C# Resupply activity with repair/rearm logic → TypeScript minimal stub
 * - Full Resupply deferred to Phase D
 *
 * NOTE: This is a minimal stub. Phase D will implement the full Resupply
 * activity with repair ticks, rearm ticks, and cargo unloading.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { WDist } from '../../OpenRA.Game/WDist.js'

// ---------------------------------------------------------------------------
// Resupply
// ---------------------------------------------------------------------------

/**
 * Resupply (repair/rearm) at a designated building.
 *
 * OpenRA 对照: Resupply activity
 *
 * Minimal stub: returns true immediately. Full Resupply (Phase D) will:
 * - Repair the actor over multiple ticks
 * - Rearm ammo pools over multiple ticks
 * - Handle docking animations
 * - Support automatic takeoff after resupply
 *
 * Used by: ReturnToBase (queues Resupply after landing at base).
 */
export class Resupply extends Activity {
  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a Resupply activity.
   *
   * OpenRA 对照: Resupply(Actor self, Actor dest, WDist? dist, bool alwaysLand)
   *
   * @param _self — the actor being resupplied
   * @param _dest — the building providing resupply
   * @param _dist — optional distance parameter (unused in stub)
   * @param _alwaysLand — whether to always land (unused in stub)
   */
  constructor(
    _self: GameActor,
    _dest: GameActor | null = null,
    _dist: WDist | null = null,
    _alwaysLand: boolean = false,
  ) {
    super()
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Complete immediately.
   *
   * OpenRA 对照: Resupply.Tick(Actor)
   *
   * @returns true immediately (stub behavior)
   */
  override tick(): boolean {
    // TODO-14.D.1: Full Resupply implementation with repair/rearm ticks.
    return true
  }
}
