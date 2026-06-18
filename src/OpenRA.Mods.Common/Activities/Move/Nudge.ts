/**
 * Nudge.ts — 微移活动（将阻挡 actor 推开一小段距离）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/Nudge.cs
 *
 * 核心范式转换:
 * - C# Mobile/Aircraft trait casts → TypeScript type assertions
 * - C# Random.Next → Math.random() (deterministic path uses seeded RNG)
 * - C# QueueChild(Mobile.MoveTo) → queueChild with Move activity
 * - C# QueueChild(Fly) → queueChild with Fly (deferred to Phase C)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import type { Mobile } from '../../Traits/Mobile.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Nudge
// ---------------------------------------------------------------------------

/**
 * Nudge an actor out of the way of another actor.
 *
 * OpenRA 对照: Nudge activity
 *
 * On first run, attempts to find an adjacent free cell and queue a move to it.
 * For ground units (Mobile), uses Mobile.getAdjacentCell to find a free cell.
 * For aircraft, queues a short Fly in a random direction (STUB — Phase C).
 */
export class Nudge extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  readonly nudger: GameActor

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a new Nudge activity.
   *
   * OpenRA 对照: Nudge(Actor nudger)
   *
   * @param nudger — the actor that is being blocked (the one to move)
   */
  constructor(nudger: GameActor) {
    super()
    this.nudger = nudger
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * On first run, find an adjacent cell and queue a move.
   *
   * OpenRA 对照: Nudge.OnFirstRun(Actor)
   */
  protected override onFirstRun(self: GameActor): void {
    // Try to get Mobile trait
    const mobile = (self as unknown as { traits: Map<string, unknown> }).traits?.get('Mobile') as Mobile | undefined

    if (mobile) {
      const m = mobile as unknown as {
        isTraitDisabled: boolean
        isTraitPaused: boolean
        isImmovable: boolean
        getAdjacentCell: (c: CPos) => CPos | null
        info: { targetLineColor: { r: number; g: number; b: number; a: number } }
      }
      if (m.isTraitDisabled || m.isTraitPaused || m.isImmovable) {
        return
      }

      const nudgerLoc = (this.nudger as unknown as { location: CPos }).location
      const cell = m.getAdjacentCell(nudgerLoc)
      if (cell !== null) {
        // Replace with real Move activity when available
        // For now, create a stub child that completes immediately
        this.queueChild(new NudgeMoveStub())
      }
      return
    }

    // Aircraft nudge — STUB for Phase C
    // const aircraft = (self as unknown as { traits: Map<string, unknown> }).traits?.get('Aircraft')
    // if (aircraft) { ... queue Fly ... }
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Delegate target line rendering to child activity.
   *
   * OpenRA 对照: Nudge.TargetLineNodes(Actor)
   */
  override targetLineNodes(self: GameActor): TargetLineNode[] {
    const ca = this.childActivity
    if (ca !== null) {
      return ca.targetLineNodes(self)
    }
    return []
  }
}

// ---------------------------------------------------------------------------
// NudgeMoveStub — internal helper that completes immediately
// ---------------------------------------------------------------------------

/** Stub child activity for nudge moves. Completes immediately. */
class NudgeMoveStub extends Activity {
  override tick(_self: GameActor): boolean {
    return true
  }
}
