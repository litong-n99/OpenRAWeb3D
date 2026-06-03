/**
 * ActionQueue.ts — Deferred action queue for frame-end task execution
 * OpenRA 对照: OpenRA.Game/Primitives/ActionQueue.cs
 *
 * 核心范式转换:
 * - C# thread-safe lock → removed (single-threaded JS)
 * - C# DelayedAction struct + IComparer → array of objects with comparison
 * - Binary search insert for sorted scheduling
 * - PerformActions batches all pending actions for current time
 */

// ---------------------------------------------------------------------------
// DelayedAction
// ---------------------------------------------------------------------------

/** A deferred action with a scheduled time. */
interface DelayedAction {
  /** The action to execute. */
  action: () => void
  /** The game tick or timestamp at which to execute. */
  time: number
}

// ---------------------------------------------------------------------------
// ActionQueue
// ---------------------------------------------------------------------------

/**
 * A deferred action queue for scheduling tasks at specific game ticks.
 *
 * OpenRA 对照: ActionQueue
 *
 * Actions are inserted sorted by desired time. On performActions(), all
 * actions with time <= currentTime are executed in order.
 *
 * NOTE: Unlike OpenRA's thread-safe version, this implementation is
 * single-threaded. No locking is needed.
 */
export class ActionQueue {
  /** Sorted list of pending actions. */
  private readonly actions: DelayedAction[] = []

  /**
   * Add a deferred action to the queue.
   *
   * OpenRA 对照: ActionQueue.Add(Action, long)
   *
   * The action is inserted at the correct position to maintain
   * sorted order by desiredTime.
   *
   * @param action — the function to execute
   * @param desiredTime — the game tick or timestamp for execution
   */
  add(action: () => void, desiredTime: number): void {
    const delayed: DelayedAction = { action, time: desiredTime }
    const insertionIndex = this.indexAfter(delayed)
    this.actions.splice(insertionIndex, 0, delayed)
  }

  /**
   * Execute all pending actions scheduled for time <= currentTime.
   *
   * OpenRA 对照: ActionQueue.PerformActions(long)
   *
   * Actions are removed from the queue before execution, so if an action
   * adds new actions, they will be executed on a subsequent call.
   *
   * @param currentTime — the current game tick or timestamp
   */
  performActions(currentTime: number): void {
    // Find how many actions are ready (time <= currentTime)
    const dummy: DelayedAction = { action: () => void 0, time: currentTime }
    const index = this.indexAfter(dummy)

    if (index <= 0) return

    // Extract pending actions
    const pending = this.actions.splice(0, index)

    // Execute them
    for (const delayed of pending) {
      delayed.action()
    }
  }

  /**
   * Find the index of the first action with time strictly greater than
   * the given action's time.
   *
   * OpenRA 对照: ActionQueue.Index(DelayedAction)
   */
  private indexAfter(action: DelayedAction): number {
    // Binary search for insertion point
    let lo = 0
    let hi = this.actions.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.actions[mid].time <= action.time) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    return lo
  }
}
