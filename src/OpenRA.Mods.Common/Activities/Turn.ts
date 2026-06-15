/**
 * Turn.ts — 旋转朝向活动（Phase B 前置 stub）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Turn.cs
 *
 * 核心范式转换:
 * - C# Turn activity → TypeScript stub (full implementation in Phase B)
 * - This stub exists so Phase A activities (Move, MoveOntoAndTurn, Drag) can import it
 *
 * NOTE: This is a MINIMAL STUB. Full Turn implementation with Util.TickFacing
 * and complete test coverage will be done in Phase B.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { WAngle } from '../../OpenRA.Game/WAngle.js'

// ---------------------------------------------------------------------------
// Turn stub
// ---------------------------------------------------------------------------

/**
 * Turn the actor to face a desired direction.
 *
 * OpenRA 对照: Turn activity
 *
 * STUB: Minimal implementation for Phase A activities to import.
 * Full implementation in Phase B (TODO-14.B.5).
 */
export class Turn extends Activity {
  readonly desiredFacing: WAngle

  constructor(_self: GameActor, desiredFacing: WAngle) {
    super()
    this.desiredFacing = desiredFacing
  }

  /** STUB: Returns true immediately.
   *
   * Full implementation will rotate facing via Util.TickFacing.
   */
  override tick(_self: GameActor): boolean {
    return true
  }
}
