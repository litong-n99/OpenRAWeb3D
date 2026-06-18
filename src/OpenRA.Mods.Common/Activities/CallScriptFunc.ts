/**
 * CallScriptFunc.ts — Activity that invokes a script callback in the actor's queue
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/CallLuaFunc.cs (60 lines)
 *
 * 核心范式转换:
 * - C# CallLuaFunc : Activity, IDisposable (holds LuaFunction with CopyReference/Dispose)
 *   → TypeScript CallScriptFunc extends Activity (holds TriggerCallback, GC-managed)
 * - C# manually disposes LuaFunction in Tick + Cancel + Dispose
 *   → TS nulls the function reference in tick() + cancel(); GC handles cleanup
 * - C# separate IDisposable interface implementation
 *   → TS lifecycle entirely within Activity.tick()/cancel()
 *
 * This is a SINGLE-TICK activity: tick() calls the function then returns true
 * immediately. Used by GeneralProperties.CallFunc() (Phase D) and other API
 * methods that need activity-queue synchronization.
 */

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { IScriptContext } from '../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'

// ---------------------------------------------------------------------------
// CallScriptFunc
// ---------------------------------------------------------------------------

/**
 * Activity that executes a script callback within the actor's activity queue.
 *
 * OpenRA 对照: CallLuaFunc (CallLuaFunc.cs:19-60)
 *
 * ## Lifecycle
 *
 * 1. **Created**: `new CallScriptFunc(fn, context)` — stores fn and context.
 * 2. **Queued**: Added to actor's activity queue via `actor.queueActivity()`.
 * 3. **Ticked**: When it reaches the front of the queue, `tick()` calls the
 *    function, catches exceptions via context.fatalError(), then returns true
 *    to signal completion.
 * 4. **Canceled**: If canceled before execution, `cancel()` releases the
 *    function reference so it can be GC'd.
 *
 * ## Single-Tick Guarantee
 *
 * This activity ALWAYS completes in one tick. It never yields or queues
 * child activities. This matches OpenRA's behavior where CallLuaFunc.Call()
 * is immediately disposed after the Lua function returns.
 */
export class CallScriptFunc extends Activity {
  // ---------------------------------------------------------------------------
  // Private state
  // ---------------------------------------------------------------------------

  /** The owning script context (for fatalError reporting). */
  private readonly _context: IScriptContext

  /** The callback function. Null after execution or cancellation. */
  private _fn: ((context: IScriptContext) => void) | null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a script function call activity.
   *
   * OpenRA 对照: CallLuaFunc(LuaFunction, ScriptContext) (lines 24-28)
   *
   * @param fn — the script callback to invoke
   * @param context — the owning script context for error reporting
   */
  constructor(fn: (context: IScriptContext) => void, context: IScriptContext) {
    super()
    if (!fn) throw new Error('CallScriptFunc: fn must not be null')
    this._fn = fn
    this._context = context
  }

  // ---------------------------------------------------------------------------
  // Tick (对应 lines 30-43)
  // ---------------------------------------------------------------------------

  /**
   * Execute the script callback and complete the activity.
   *
   * OpenRA 对照: CallLuaFunc.Tick(Actor self) (lines 30-43)
   *
   * Calls the stored function, catches any exception via context.fatalError(),
   * releases the function reference, and returns true to signal completion.
   *
   * @param self — the actor running this activity (unused)
   * @returns true — always completes in one tick
   */
  override tick(_self: GameActor): boolean {
    if (!this._fn) return true // Already executed or canceled

    try {
      this._fn.call(null, this._context)
    } catch (ex) {
      this._context.fatalError(ex as Error)
      // Still complete the activity even on error (matching OpenRA behavior)
    }

    this._fn = null // Release reference for GC
    return true // Activity complete
  }

  // ---------------------------------------------------------------------------
  // Cancel (对应 lines 45-48)
  // ---------------------------------------------------------------------------

  /**
   * Cancel this activity before execution.
   *
   * OpenRA 对照: CallLuaFunc.Cancel(Actor, bool) (lines 45-48)
   *
   * Releases the function reference so it can be garbage collected.
   * Safe to call after tick() (fn is already nulled).
   *
   * @param self — the actor running this activity
   * @param keepQueue — if false, clears the next activity chain
   */
  override cancel(self: GameActor, keepQueue = false): void {
    super.cancel(self, keepQueue)
    this._fn = null // Release reference for GC
  }
}
