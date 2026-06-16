/**
 * RemoveSelf.ts — 自我移除活动 (Phase F 完整实现)
 * OpenRA 对照: OpenRA.Mods.Common/Activities/RemoveSelf.cs
 *
 * 核心范式转换:
 * - C# self.Dispose() + Cancel(self) → TypeScript self.dispose()
 * - Actor removal is handled via self.dispose()
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, ActivityState } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// RemoveSelf
// ---------------------------------------------------------------------------

/**
 * Remove the actor from the world and dispose it.
 *
 * OpenRA 对照: RemoveSelf activity
 *
 * Calls self.dispose() and cancels this activity, returning true
 * to signal completion. The actor is removed from the world
 * immediately.
 *
 * Used by: FlyOffMap (remove after flying off), DeliverBulkOrder
 * (remove transport after delivery), Aircraft idle behavior.
 */
export class RemoveSelf extends Activity {
  override tick(self: GameActor): boolean {
    if (this.isCanceling || this.state === ActivityState.Done) return true

    self.dispose()
    this.cancel(self)
    return true
  }
}
