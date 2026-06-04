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
 * - Per migration plan TODO-3.H.2: added isDone property for future auto-cleanup
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
 * Each call to tick() decrements an internal counter. When the counter
 * reaches zero, the action callback is executed once during the frame-end
 * task phase, and the effect self-removes from the world.
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

  /** Whether this effect has completed execution.
   *
   * NOTE: Added per migration plan TODO-3.H.2. Not in original OpenRA.
   */
  private _done = false

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
   *   of the first tick (via frameEndTask).
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
   * Whether this effect has completed and may be removed.
   *
   * NOTE: Added per migration plan TODO-3.H.2. Not in original OpenRA.
   */
  get isDone(): boolean {
    return this._done
  }

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
   * Decrement the delay counter. When it reaches zero, schedule the action
   * for execution via frame-end task and mark as done.
   *
   * OpenRA 对照: DelayedAction.Tick(World)
   *
   * The action is NOT executed immediately during tick() — it is deferred
   * to frameEndAction (via addFrameEndTask). This ensures it runs after all
   * ITick and IEffect ticks have completed, preventing mid-iteration
   * modification of actor/effect collections.
   *
   * @param world — the game world manager
   */
  tick(world: GameWorldManager): void {
    if (--this._delay <= 0) {
      world.addFrameEndTask(() => {
        world.removeEffect(this)
        this._action()
        this._done = true
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
