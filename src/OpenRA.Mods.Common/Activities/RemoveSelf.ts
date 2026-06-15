/**
 * RemoveSelf.ts — 自我移除活动（最小化存根）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/RemoveSelf.cs
 *
 * 核心范式转换:
 * - C# RemoveSelf activity → TypeScript minimal stub
 * - Full RemoveSelf deferred to Phase F
 *
 * NOTE: This is a minimal stub. Phase F will implement the full RemoveSelf
 * with proper world frame-end action queuing.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// RemoveSelf
// ---------------------------------------------------------------------------

/**
 * Remove the actor from the world.
 *
 * OpenRA 对照: RemoveSelf activity
 *
 * Minimal stub: returns true immediately. The actual actor removal is
 * deferred to the world's frame-end actions (which the activity system
 * handles separately). Full RemoveSelf (Phase F) will support:
 * - Delayed removal (wait N ticks before removing)
 * - Entry animation before removal
 *
 * Used by: FlyOffMap (remove after flying off), DeliverBulkOrder (remove
 * transport after delivery), Aircraft idle behavior (LeaveMap).
 */
export class RemoveSelf extends Activity {
  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Mark the actor for removal.
   *
   * OpenRA 对照: RemoveSelf.Tick(Actor)
   *
   * The actual removal is handled by the world via frame-end actions.
   *
   * @returns true immediately (activity completes in one tick)
   */
  override tick(_self: GameActor): boolean {
    // NOTE: Full implementation (Phase F) will queue a frame-end action
    // on the world to remove the actor. For now, returning true signals
    // that the activity is complete; the caller handles cleanup.
    return true
  }
}
