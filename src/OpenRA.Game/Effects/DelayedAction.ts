/**
 * DelayedAction.ts — Execute a callback after a specified number of game ticks
 * OpenRA 对照: OpenRA.Game/Effects/DelayedAction.cs
 *
 * 核心范式转换:
 * - C# Action delegate → TypeScript `() => void` closure
 * - C# World.AddFrameEndTask(Action<World>) → world.addFrameEndTask(() => void)
 *   (GameWorldManager instance captured via closure, no World parameter needed)
 * - C# w.Remove(this) (IEffect self-removal) → world.removeEffect(this)
 * - C# yield break (empty render) → return [] (empty array)
 * - Pre-decrement pattern matches C# exactly: --delay <= 0
 *   (delay=5 fires on tick 5, delay=1 fires on tick 1, delay=0 fires on tick 1)
 *
 * 使用场景:
 * - "Destroy this actor in 10 ticks"
 * - "Play explosion sound after 3 ticks"
 * - Any gameplay action that needs to be deferred by a known tick count
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { IEffect } from './IEffect.js'
import type { GameWorldManager } from '../World.js'
import type { WorldRendererStub, IRenderable } from '../Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// DelayedAction
// ---------------------------------------------------------------------------

/**
 * An IEffect that executes a callback after a specified number of logic ticks.
 *
 * OpenRA 对照: OpenRA.Effects.DelayedAction (IEffect implementation)
 *
 * Each call to tick() pre-decrements an internal counter. When the counter
 * reaches zero or below, the action callback is scheduled for execution
 * during the frame-end task phase via world.addFrameEndTask(). The effect
 * self-removes from the world in the same frame-end task.
 *
 * Pre-decrement behavior (matching C#):
 * - delay=5: fires on tick 5 (--5=4, --4=3, --3=2, --2=1, --1=0)
 * - delay=1: fires on tick 1 (--1=0)
 * - delay=0: fires on tick 1 (--0=-1)
 *
 * Usage:
 * ```
 * // Play an explosion sound after 15 ticks (~0.6 seconds at 25 TPS)
 * world.addEffect(new DelayedAction(15, () => playSound("explosion.wav")))
 * ```
 */
export class DelayedAction implements IEffect {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** The callback to execute when delay expires.
   *
   * OpenRA 对照: DelayedAction.a (Action delegate)
   */
  private readonly _action: () => void

  /** Remaining tick count before execution.
   *
   * OpenRA 对照: DelayedAction.delay (int)
   */
  private _delay: number

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a delayed action effect.
   *
   * OpenRA 对照: DelayedAction(int delay, Action a)
   *
   * @param delay — number of game ticks to wait before executing the action.
   *   Must be >= 0. A value of 0 causes the action to execute at the end
   *   of the first tick (via frameEndTask because --0 = -1 <= 0).
   * @param action — the callback to execute when delay expires. Executed
   *   once, inside a frame-end task.
   */
  constructor(delay: number, action: () => void) {
    this._action = action
    this._delay = delay
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /**
   * Remaining tick count before the action fires.
   *
   * Useful for debugging and testing the delay counter.
   */
  get remainingDelay(): number {
    return this._delay
  }

  // -------------------------------------------------------------------------
  // IEffect implementation
  // -------------------------------------------------------------------------

  /**
   * Pre-decrement the delay counter. When it reaches zero or below, schedule
   * the action for execution via frame-end task.
   *
   * OpenRA 对照: DelayedAction.Tick(World)
   *
   * The action is NOT executed immediately during tick() — it is deferred
   * to frameEndAction (via addFrameEndTask). This ensures it runs after all
   * ITick and IEffect ticks have completed, preventing mid-iteration
   * modification of actor/effect collections.
   *
   * Uses PRE-decrement (matching C# --delay pattern):
   * - delay=5: --delay = 4,3,2,1,0 → fires on tick 5
   * - delay=1: --delay = 0 → fires on tick 1
   * - delay=0: --delay = -1 → fires on tick 1
   *
   * @param world — the game world manager
   */
  tick(world: GameWorldManager): void {
    if (--this._delay <= 0) {
      world.addFrameEndTask(() => {
        world.removeEffect(this)
        this._action()
      })
    }
  }

  /**
   * DelayedAction produces no renderables.
   *
   * OpenRA 对照: DelayedAction.Render(WorldRenderer) → yield break
   *
   * @returns empty array (equivalent to C# yield break)
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    return []
  }
}
