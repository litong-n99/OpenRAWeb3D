/**
 * DelayedImpact.ts — Delay a warhead impact by a specified number of ticks
 * OpenRA 对照: OpenRA.Game/Effects/DelayedImpact.cs
 *
 * 核心范式转换:
 * - C# IWarhead + WarheadArgs → stub interfaces (not yet migrated)
 * - C# World.AddFrameEndTask(Action<World>) → world.addFrameEndTask(() => void)
 * - C# w.Remove(this) + wh.DoImpact(target, args) → world.removeEffect(this)
 *   + warhead.doImpact(target, args) in same frameEndTask
 * - C# yield break (empty render) → return [] (empty array)
 * - Pre-decrement pattern matches C# exactly: --delay <= 0
 *   (delay=5 fires on tick 5, delay=1 fires on tick 1, delay=0 fires on tick 1)
 *
 * NOTE: This is a SIMPLE countdown timer — NOT a position-advancing
 * projectile. The original OpenRA DelayedImpact has no position tracking
 * or interpolation. It merely delays the execution of wh.DoImpact() by
 * a fixed number of ticks.
 *
 * 使用场景:
 * - Delaying a warhead impact for visual effect timing
 * - Coordinating multi-stage weapon effects
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { IEffect } from './IEffect.js'
import type { GameWorldManager } from '../World.js'
import type { WorldRendererStub, IRenderable } from '../Traits/TraitsInterfaces.js'
import type { Target } from '../Traits/Target.js'

// ---------------------------------------------------------------------------
// IWarhead stub — TODO-3.H.3 pending full IWarhead migration
// ---------------------------------------------------------------------------

/**
 * Minimal stub for IWarhead.
 *
 * OpenRA 对照: OpenRA.GameRules/IWarhead.cs
 * TODO-3.H.3: Replace with full IWarhead interface when GameRules is migrated.
 */
export interface IWarhead {
  /** Execute the warhead effect on a target.
   *
   * OpenRA 对照: IWarhead.DoImpact(Target, WarheadArgs)
   */
  doImpact(target: Target, args: WarheadArgs): void
}

// ---------------------------------------------------------------------------
// WarheadArgs stub — TODO-3.H.3 pending full WarheadArgs migration
// ---------------------------------------------------------------------------

/**
 * Minimal stub for WarheadArgs.
 *
 * OpenRA 对照: OpenRA.GameRules/WarheadArgs.cs
 * TODO-3.H.3: Replace with full WarheadArgs struct when GameRules is migrated.
 */
export interface WarheadArgs {
  /** Weapon that fired this warhead (minimal stub). */
  weapon?: unknown
  /** Facing direction of the firer. */
  facing?: number
  /** Damage modifier override. */
  damageModifier?: number[]
  /** Source actor. */
  sourceActor?: unknown
  /** Source weapon info. */
  sourceWeapon?: unknown
  /** Additional arguments (extensible). */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// DelayedImpact
// ---------------------------------------------------------------------------

/**
 * An IEffect that delays a warhead impact by a fixed number of logic ticks.
 *
 * OpenRA 对照: OpenRA.Effects.DelayedImpact (IEffect implementation)
 *
 * Each call to tick() pre-decrements an internal counter. When the counter
 * reaches zero, the warhead's doImpact() is scheduled via frame-end task,
 * and the effect self-removes from the world.
 *
 * This is structurally identical to DelayedAction — the difference is
 * in semantics: DelayedImpact specifically delays warhead impact, while
 * DelayedAction can execute any callback.
 *
 * Pre-decrement behavior (matching C#):
 * - delay=5: fires on tick 5
 * - delay=1: fires on tick 1
 * - delay=0: fires on tick 1
 *
 * Usage:
 * ```
 * const impact = new DelayedImpact(
 *   10,      // delay 10 ticks
 *   warhead, // IWarhead instance
 *   target,  // Target to impact
 *   args,    // WarheadArgs
 * )
 * world.addEffect(impact)
 * ```
 */
export class DelayedImpact implements IEffect {
  // -------------------------------------------------------------------------
  // Private state
  // -------------------------------------------------------------------------

  /** Target to impact when delay expires.
   *
   * OpenRA 对照: DelayedImpact.target (Target)
   */
  readonly target: Target

  /** Warhead whose doImpact() is called.
   *
   * OpenRA 对照: DelayedImpact.wh (IWarhead)
   */
  private readonly _warhead: IWarhead

  /** Arguments passed to doImpact().
   *
   * OpenRA 对照: DelayedImpact.args (WarheadArgs)
   */
  private readonly _args: WarheadArgs

  /** Remaining tick count before impact.
   *
   * OpenRA 对照: DelayedImpact.delay (int)
   */
  private _delay: number

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a delayed impact effect.
   *
   * OpenRA 对照: DelayedImpact(int delay, IWarhead wh, Target target, WarheadArgs args)
   *
   * @param delay — number of game ticks to wait before impacting
   * @param warhead — the warhead whose doImpact() will be called
   * @param target — the target to impact
   * @param args — warhead arguments (damage modifiers, facing, etc.)
   */
  constructor(
    delay: number,
    warhead: IWarhead,
    target: Target,
    args: WarheadArgs,
  ) {
    this._delay = delay
    this._warhead = warhead
    this.target = target
    this._args = args
  }

  // -------------------------------------------------------------------------
  // Public accessors
  // -------------------------------------------------------------------------

  /**
   * Remaining tick count before impact fires.
   */
  get remainingDelay(): number {
    return this._delay
  }

  // -------------------------------------------------------------------------
  // IEffect implementation
  // -------------------------------------------------------------------------

  /**
   * Pre-decrement the delay counter. When it reaches zero, schedule the
   * warhead impact via frame-end task.
   *
   * OpenRA 对照: DelayedImpact.Tick(World)
   *
   * Matches the C# pre-decrement pattern exactly:
   * ```
   * if (--delay <= 0)
   *     world.AddFrameEndTask(w => { w.Remove(this); wh.DoImpact(target, args); });
   * ```
   *
   * @param world — the game world manager
   */
  tick(world: GameWorldManager): void {
    if (--this._delay <= 0) {
      world.addFrameEndTask(() => {
        world.removeEffect(this)
        this._warhead.doImpact(this.target, this._args)
      })
    }
  }

  /**
   * DelayedImpact produces no renderables.
   *
   * OpenRA 对照: DelayedImpact.Render(WorldRenderer) → yield break
   *
   * @returns empty array (equivalent to C# yield break)
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    return []
  }
}
