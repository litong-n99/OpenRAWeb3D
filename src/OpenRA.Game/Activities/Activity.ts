/**
 * Activity.ts — 行为状态机基类（Activity 抽象类 + TargetLineNode）
 * OpenRA 对照: OpenRA.Game/Activities/Activity.cs
 *
 * 核心范式转换:
 * - C# abstract Activity class with linked-list chain → TypeScript abstract class
 *   (same pattern, no paradigm change — linked list is universal)
 * - C# IActivityInterface marker → TypeScript IActivityInterface (already defined
 *   in TraitsInterfaces.ts)
 * - C# protected set on ChildActivity/NextActivity → TypeScript private backing
 *   fields with getter/setter + SkipDoneActivities
 * - C# internal static SkipDoneActivities → TypeScript public static method
 * - C# PerfTickLogger in TickOuter path → TypeScript omits (console.timeLog if needed)
 *
 * State Machine (OpenRA 对照: ActivityState enum):
 *   Queued → onFirstRun() → Active → tick() returns true → Done → onLastRun()
 *   Cancel path: Any pre-Active → Canceling (or DONE if still Queued)
 *   Canceling → tick() detects cancel and cleans up → Done
 *
 * Key invariants (from OpenRA source comments):
 * - "return true" at least once somewhere in the tick method
 * - Do NOT reuse activity objects that have already started running
 * - Avoid calling actor.cancelActivity(); call activity.cancel() instead
 * - Do NOT evaluate dynamic state in constructors; use onFirstRun()
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameActor } from '../Actor.js'
import type { Target } from '../Traits/Target.js'
import type { ColorStub } from '../Traits/TraitsInterfaces.js'
import type { Sprite } from '../Graphics/Sprite.js'
import { type IActivityInterface } from '../Traits/TraitsInterfaces.js'
import { runActivity } from '../Traits/ActivityUtils.js'

// ---------------------------------------------------------------------------
// ActivityState enum (对应 OpenRA ActivityState)
// ---------------------------------------------------------------------------

/**
 * The current state of an activity in the state machine.
 *
 * OpenRA 对照: ActivityState { Queued, Active, Canceling, Done }
 *
 * State transitions:
 * - Queued → Active (via onFirstRun in tickOuter)
 * - Active → Done (via tick() returning true)
 * - Active/Canceling → Canceling (via cancel())
 * - Queued → Done (via cancel() — skip never-started activities)
 * - Canceling → Done (via tick() returning true after cleanup)
 *
 * NOTE: OpenRA source has 4 states (no separate "Canceled").
 * Canceling transitions to Done after the tick cleanup completes.
 */
export const ActivityState = {
  Queued: 0,
  Active: 1,
  Canceling: 2,
  Done: 3,
} as const

export type ActivityState = (typeof ActivityState)[keyof typeof ActivityState]

// ---------------------------------------------------------------------------
// TargetLineNode (对应 OpenRA TargetLineNode)
// ---------------------------------------------------------------------------

/**
 * A pairing of a target with a color and optional tile sprite for
 * rendering target lines (attack/move previews) in the UI.
 *
 * OpenRA 对照: Activity.TargetLineNode
 */
export class TargetLineNode {
  /** The target this line node points to.
   *
   * OpenRA 对照: TargetLineNode.Target
   */
  readonly target: Target

  /** The color used for this target line segment.
   *
   * OpenRA 对照: TargetLineNode.Color
   */
  readonly color: ColorStub

  /** Optional tile sprite for this segment.
   *
   * OpenRA 对照: TargetLineNode.Tile (nullable Sprite)
   */
  readonly tile: Sprite | null

  /**
   * Create a target line node.
   *
   * OpenRA 对照: TargetLineNode(Target, Color, Sprite?)
   *
   * @param target — the target this line node points to
   * @param color — the color for this segment
   * @param tile — optional tile sprite (null for none)
   */
  constructor(target: Target, color: ColorStub, tile: Sprite | null = null) {
    this.target = target
    this.color = color
    this.tile = tile
  }
}

// ---------------------------------------------------------------------------
// Activity abstract class (对应 OpenRA Activity)
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all actor activities.
 *
 * OpenRA 对照: Activities.Activity abstract class
 *
 * Activities form a linked-list chain (via `nextActivity`) with optional
 * sub-activity nesting (via `childActivity`). The activity system ticks
 * through the chain each game tick, advancing when a tick returns true.
 *
 * ## State Machine
 *
 * ```
 * Queued → onFirstRun() → Active → tick() returns true → Done → onLastRun()
 *   │                         │                                       │
 *   │   cancel() while        │   cancel() during                     │
 *   │   still Queued          │   Active/Canceling                    │
 *   └──→ Done                 └──→ Canceling → tick() returns true ──┘
 * ```
 *
 * ## Child Priority (childHasPriority, default true)
 *
 * When a child activity exists:
 * - childHasPriority=true: child ticks first; parent runs only after child
 *   completes (finishing flag allows parent to return true in anticipation)
 * - childHasPriority=false: parent controls whether child gets tick time
 *   by calling tickChild() from its own tick() method
 *
 * ## Usage Notes (from OpenRA source)
 *
 * - Call `"return true"` at least once somewhere in the tick method
 * - Do NOT reuse activity objects that have already started running
 * - Avoid calling `actor.cancelActivity()` — call `activity.cancel()` instead
 * - Do NOT evaluate dynamic state in constructors — use `onFirstRun()` instead
 */
export abstract class Activity implements IActivityInterface {
  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /**
   * Skip past activities in the chain that have already completed.
   *
   * OpenRA 对照: Activity.SkipDoneActivities(Activity)
   *
   * If first.cancel() was called while it was queued (before it first ticked),
   * its state will be Done. An unknown number of ticks may have elapsed,
   * so we cannot assume anything about first.nextActivity.
   * We must walk the queue until we find a valid activity or run out.
   *
   * @param first — the first activity in the chain to scan
   * @returns the first non-Done activity in the chain, or null
   */
  static skipDoneActivities(first: Activity | null): Activity | null {
    while (first !== null && first.state === ActivityState.Done)
      first = first._nextActivity
    return first
  }

  // ---------------------------------------------------------------------------
  // State (OpenRA 对照: Activity.State)
  // ---------------------------------------------------------------------------

  /**
   * The current state of this activity in the state machine.
   *
   * OpenRA 对照: Activity.State { get; private set; }
   *
   * External code should read this to check if the activity is complete.
   * Setting the state directly is allowed for subclasses during
   * cancellation handling.
   */
  state: ActivityState = ActivityState.Queued

  // ---------------------------------------------------------------------------
  // Backing fields for ChildActivity / NextActivity
  // ---------------------------------------------------------------------------

  /** @internal Raw backing field for childActivity. */
  _childActivity: Activity | null = null

  /** @internal Raw backing field for nextActivity. */
  _nextActivity: Activity | null = null

  // ---------------------------------------------------------------------------
  // ChildActivity (OpenRA 对照: Activity.ChildActivity)
  // ---------------------------------------------------------------------------

  /**
   * The current child activity, or null if no child is queued.
   *
   * OpenRA 对照: Activity.ChildActivity
   *
   * The getter runs SkipDoneActivities to skip past completed children.
   * The setter is protected — only subclasses may set the raw backing field.
   * Use queueChild() to add children from external code.
   */
  get childActivity(): Activity | null {
    return Activity.skipDoneActivities(this._childActivity)
  }

  protected set childActivity(value: Activity | null) {
    this._childActivity = value
  }

  // ---------------------------------------------------------------------------
  // NextActivity (OpenRA 对照: Activity.NextActivity)
  // ---------------------------------------------------------------------------

  /**
   * The next activity in the chain, or null if this is the last one.
   *
   * OpenRA 对照: Activity.NextActivity
   *
   * The getter runs SkipDoneActivities to skip past completed activities.
   * The setter is private — use queue() to append to the chain.
   */
  get nextActivity(): Activity | null {
    return Activity.skipDoneActivities(this._nextActivity)
  }

  private set nextActivity(value: Activity | null) {
    this._nextActivity = value
  }

  // ---------------------------------------------------------------------------
  // Public configuration properties
  // ---------------------------------------------------------------------------

  /**
   * Whether this activity can be cancelled by an external caller.
   *
   * OpenRA 对照: Activity.IsInterruptible
   *
   * Default: true. Set to false for non-interruptible activities
   * (e.g., Attack with a fired weapon).
   */
  isInterruptible: boolean = true

  /**
   * Whether the child activity should be ticked before this activity.
   *
   * OpenRA 对照: Activity.ChildHasPriority
   *
   * Default: true. When true, the child activity ticks first and the
   * parent's tick() is only called after the child completes.
   * Set to false when the parent needs to run logic in parallel with
   * the child, typically calling tickChild() manually from tick().
   */
  childHasPriority: boolean = true

  /**
   * Whether this activity is in the Canceling state.
   *
   * OpenRA 对照: Activity.IsCanceling
   */
  get isCanceling(): boolean {
    return this.state === ActivityState.Canceling
  }

  // ---------------------------------------------------------------------------
  // Internal tick state (OpenRA 对照: private fields)
  // ---------------------------------------------------------------------------

  /**
   * Tracks whether the activity is in the process of finishing.
   * Used for childHasPriority mode: parent can declare "I'm finishing"
   * while the child is still running, causing the activity to complete
   * as soon as the child finishes.
   *
   * OpenRA 对照: Activity.finishing (bool)
   */
  private finishing: boolean = false

  /**
   * Tracks whether onFirstRun() has been called.
   *
   * OpenRA 对照: Activity.firstRunCompleted (bool)
   */
  private firstRunCompleted: boolean = false

  /**
   * Tracks whether the last tick has run (tick returned true or
   * finishing + child done).
   *
   * OpenRA 对照: Activity.lastRun (bool)
   */
  private lastRun: boolean = false

  // ---------------------------------------------------------------------------
  // TickOuter — main entry point (对应 OpenRA Activity.TickOuter, lines 95-140)
  // ---------------------------------------------------------------------------

  /**
   * The main entry point called by the activity system each tick.
   *
   * OpenRA 对照: Activity.TickOuter(Actor) — matches lines 95-140 EXACTLY
   *
   * State machine logic:
   * 1. If Done: throw (should never be ticked after completion)
   * 2. If Queued: call onFirstRun(), set Active
   * 3. If !firstRunCompleted: throw (invariant violated)
   * 4. If childHasPriority: tick child first; parent tick only after
   *    child completes (finishing flag allows early parent completion)
   * 5. If !childHasPriority: parent tick controls everything
   * 6. Just-queued child optimization: if child was queued this frame
   *    (still in Queued state), tick it immediately to avoid one-frame delay
   * 7. If lastRun: set Done, call onLastRun(), return nextActivity (advance)
   * 8. Else: return this (keep running)
   *
   * @param self — the actor performing this activity
   * @returns the next activity to run, or this if still running
   * @throws if the activity is already Done
   * @throws if tickOuter is called before onFirstRun
   */
  tickOuter(self: GameActor): Activity | null {
    if (this.state === ActivityState.Done)
      throw new Error(
        `Actor ${String(self)} attempted to tick activity ` +
        `${this.constructor.name} after it had already completed.`,
      )

    if (this.state === ActivityState.Queued) {
      this.onFirstRun(self)
      this.firstRunCompleted = true
      this.state = ActivityState.Active
    }

    if (!this.firstRunCompleted)
      throw new Error(
        `Actor ${String(self)} attempted to tick activity ` +
        `${this.constructor.name} before running its onFirstRun method.`,
      )

    // Only run the parent tick when the child is done.
    // We must always let the child finish on its own before continuing.
    if (this.childHasPriority) {
      this.lastRun = this.tickChild(self) && (this.finishing || this.tick(self))
      this.finishing = this.finishing || this.lastRun
    }
    // The parent determines whether the child gets a chance at ticking.
    else {
      this.lastRun = this.tick(self)
    }

    // Avoid a single tick delay if the child activity was just queued.
    const ca = this.childActivity
    if (ca !== null && ca.state === ActivityState.Queued) {
      if (this.childHasPriority)
        this.lastRun = this.tickChild(self) && this.finishing
      else
        this.tickChild(self)
    }

    if (this.lastRun) {
      this.state = ActivityState.Done
      this.onLastRun(self)
      return this.nextActivity
    }

    return this
  }

  // ---------------------------------------------------------------------------
  // TickChild (对应 OpenRA Activity.TickChild)
  // ---------------------------------------------------------------------------

  /**
   * Execute one tick of the child activity. If the child completed
   * (runActivity returned null), the childActivity reference is cleared.
   *
   * OpenRA 对照: Activity.TickChild(Actor)
   *
   * @param self — the actor performing this activity
   * @returns true if the child has completed (childActivity is now null)
   */
  protected tickChild(self: GameActor): boolean {
    this.childActivity = runActivity(self, this.childActivity) as Activity | null
    return this.childActivity === null
  }

  // ---------------------------------------------------------------------------
  // Tick (对应 OpenRA Activity.Tick)
  // ---------------------------------------------------------------------------

  /**
   * Called every tick to run activity logic.
   *
   * OpenRA 对照: Activity.Tick(Actor) — virtual, default returns true
   *
   * Returns false if the activity should remain active, or true if it
   * is complete. Cancelled activities must ensure they return the actor
   * to a consistent state before returning true.
   *
   * Child activities can be queued using queueChild(), and these will be
   * ticked instead of the parent while they are active (when
   * childHasPriority is true). Activities that need to run logic in
   * parallel with child activities should set childHasPriority to false
   * and manually call tickChild().
   *
   * Queuing one or more child activities and returning true is valid,
   * and causes the activity to be completed immediately (without ticking
   * again) once the children have completed.
   *
   * @param self — the actor performing this activity
   * @returns true if the activity is complete, false to continue
   */
  tick(_self: GameActor): boolean {
    return true
  }

  // ---------------------------------------------------------------------------
  // Lifecycle callbacks (对应 OpenRA OnFirstRun / OnLastRun / OnActorDispose)
  // ---------------------------------------------------------------------------

  /**
   * Called once immediately before the first tick() execution.
   *
   * OpenRA 对照: Activity.OnFirstRun(Actor)
   *
   * Use this to evaluate dynamic state (actor location, health, conditions)
   * that may have changed between construction and first tick. Do NOT
   * evaluate dynamic state in the constructor.
   *
   * @param self — the actor performing this activity
   */
  protected onFirstRun(_self: GameActor): void {
    // Default: no-op. Subclasses override to perform deferred initialization.
  }

  /**
   * Called once immediately after the last tick() execution.
   *
   * OpenRA 对照: Activity.OnLastRun(Actor)
   *
   * CRITICAL: This method MUST always execute for resource cleanup.
   * It is called even during cancellation (the activity system ensures
   * onLastRun is called when an activity transitions to Done).
   *
   * @param self — the actor performing this activity
   */
  protected onLastRun(_self: GameActor): void {
    // Default: no-op. Subclasses override to clean up resources.
  }

  /**
   * Called once on Actor.dispose() (through onActorDisposeOuter).
   * Can be used to perform activity clean-up on actor death/disposal,
   * for example by force-triggering onLastRun (which would otherwise
   * be skipped if the activity was cancelled mid-execution).
   *
   * OpenRA 对照: Activity.OnActorDispose(Actor)
   *
   * @param self — the actor being disposed
   */
  protected onActorDispose(_self: GameActor): void {
    // Default: no-op. Subclasses override to handle actor disposal cleanup.
  }

  /**
   * Called on Actor.dispose() to cascade disposal through child activities.
   *
   * OpenRA 对照: Activity.OnActorDisposeOuter(Actor) — internal
   *
   * The main purpose is to ensure childActivity.onActorDisposeOuter runs
   * as well (which isn't otherwise accessible due to protection level).
   *
   * @param self — the actor being disposed
   */
  onActorDisposeOuter(self: GameActor): void {
    if (this._childActivity) {
      this._childActivity.onActorDisposeOuter(self)
    }
    this.onActorDispose(self)
  }

  // ---------------------------------------------------------------------------
  // Cancel (对应 OpenRA Activity.Cancel)
  // ---------------------------------------------------------------------------

  /**
   * Cancel this activity.
   *
   * OpenRA 对照: Activity.Cancel(Actor, bool keepQueue)
   *
   * Cancellation behavior:
   * - If not keepQueue: clear the nextActivity chain
   * - If not isInterruptible: return immediately (cancel is ignored)
   * - Cancel child activity (cascading)
   * - If Queued: set Done immediately (activity never started)
   * - If Active/Canceling: set Canceling (activity will clean up in tick)
   * - If already Done: no-op (prevents Done→Canceling on double-cancel)
   *
   * @param self — the actor that owns this activity
   * @param keepQueue — if true, preserve the queued activity chain (default: false)
   */
  cancel(self: GameActor, keepQueue: boolean = false): void {
    if (!keepQueue)
      this.nextActivity = null

    if (!this.isInterruptible)
      return

    if (this._childActivity) {
      this._childActivity.cancel(self)
    }

    // Guard: if already Done, do not change state.
    // Without this guard, a double-cancel would transition Done→Canceling
    // (a latent defect present in the OpenRA C# source).
    if (this.state === ActivityState.Done)
      return

    // Directly mark activities that are queued and therefore didn't run yet
    // as done. Active/Canceling activities must tick to clean up.
    this.state = this.state === ActivityState.Queued
      ? ActivityState.Done
      : ActivityState.Canceling
  }

  // ---------------------------------------------------------------------------
  // Queue / QueueChild (对应 OpenRA Activity.Queue / Activity.QueueChild)
  // ---------------------------------------------------------------------------

  /**
   * Append an activity to the end of the activity chain.
   *
   * OpenRA 对照: Activity.Queue(Activity)
   *
   * Traverses the nextActivity linked list to the end, then sets the
   * new activity as the last element's nextActivity.
   *
   * @param activity — the activity to append to the chain
   */
  queue(activity: Activity): void {
    let it: Activity = this
    while (it._nextActivity !== null)
      it = it._nextActivity
    it._nextActivity = activity
  }

  /**
   * Queue a child activity. If a child already exists, the new child is
   * appended to the existing child's chain.
   *
   * OpenRA 对照: Activity.QueueChild(Activity)
   *
   * @param activity — the child activity to queue
   */
  queueChild(activity: Activity): void {
    if (this._childActivity !== null)
      this._childActivity.queue(activity)
    else
      this._childActivity = activity
  }

  // ---------------------------------------------------------------------------
  // Debug support (对应 OpenRA Activity.PrintActivityTree)
  // ---------------------------------------------------------------------------

  /**
   * Print the activity tree for debugging purposes.
   *
   * OpenRA 对照: Activity.PrintActivityTree(Actor, Activity?, int)
   *
   * Call this method from any place that's called during a tick, such as
   * the tick() method itself or onFirstRun/onLastRun. The origin activity
   * will be marked with "*" in the output.
   *
   * @param self — the actor performing this activity
   * @param origin — activity from which to start traversing, and which to mark.
   *   If null, start traversal from the top-level activity.
   * @param level — initial indentation level (default: 0)
   */
  protected printActivityTree(
    _self: GameActor,
    origin: Activity | null = null,
    level: number = 0,
  ): void {
    if (origin === null) {
      // Start traversal from this activity (the caller), marking it with "*".
      // NOTE: OpenRA starts from self.CurrentActivity (the root of the
      // actor's activity chain). Since _currentActivity is private on
      // GameActor, we start from `this` instead. This means parent
      // activities above the caller won't be printed. For full tree
      // visibility, call from within the root activity's tick() method.
      this.printActivityTree(_self, this)
    } else {
      const indent = ' '.repeat(level * 2)
      const marker = origin === this ? '*' : ''
      console.log(`${indent}${marker}${this.constructor.name}`)

      if (this._childActivity) {
        this._childActivity.printActivityTree(_self, origin, level + 1)
      }

      if (this._nextActivity) {
        this._nextActivity.printActivityTree(_self, origin, level)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Target lines (对应 OpenRA Activity.GetTargets / TargetLineNodes)
  // ---------------------------------------------------------------------------

  /**
   * Get the targets associated with this activity for target line rendering.
   *
   * OpenRA 对照: Activity.GetTargets(Actor) — virtual, yield break (empty)
   *
   * Override in subclasses to provide target visualization.
   *
   * @param self — the actor performing this activity
   * @returns an array of targets (empty by default)
   */
  getTargets(_self: GameActor): Target[] {
    return []
  }

  /**
   * Get target line nodes for rendering target lines in the UI.
   *
   * OpenRA 对照: Activity.TargetLineNodes(Actor) — virtual, yield break
   *
   * Override in subclasses to provide target line visualization.
   *
   * @param self — the actor performing this activity
   * @returns an array of target line nodes (empty by default)
   */
  targetLineNodes(_self: GameActor): TargetLineNode[] {
    return []
  }

  // ---------------------------------------------------------------------------
  // Debug label components (对应 OpenRA Activity.DebugLabelComponents)
  // ---------------------------------------------------------------------------

  /**
   * Enumerate the type names of this activity and all child activities.
   *
   * OpenRA 对照: Activity.DebugLabelComponents()
   *
   * Used for debug display — shows the activity chain type hierarchy.
   *
   * @returns array of type name strings from this activity downward
   */
  debugLabelComponents(): string[] {
    const result: string[] = []
    let act: Activity | null = this
    while (act !== null) {
      result.push(act.constructor.name)
      act = act._childActivity
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // ActivitiesImplementing (对应 OpenRA Activity.ActivitiesImplementing<T>)
  // ---------------------------------------------------------------------------

  /**
   * Find all activities in the chain (including children) that are
   * instances of a given Activity subclass.
   *
   * OpenRA 对照: Activity.ActivitiesImplementing<T>(bool includeChildren)
   *
   * C# uses `this is T` (runtime generic type check). TypeScript erases
   * generic type parameters at runtime, so we use `instanceof` with a
   * constructor reference instead:
   *
   * ```
   * // C#: act.ActivitiesImplementing<Move>()
   * // TS:  act.activitiesImplementing(Move)
   * ```
   *
   * @param ctor — the Activity subclass constructor to match against
   * @param includeChildren — whether to include child activities (default: true)
   * @returns array of matching activities, typed as the subclass
   */
  activitiesImplementing<T extends Activity>(
    ctor: new (...args: any[]) => T,
    includeChildren: boolean = true,
  ): T[] {
    const result: T[] = []

    // Skips Done child and next activities (via childActivity/nextActivity
    // getters which use SkipDoneActivities)
    if (includeChildren) {
      const ca = this.childActivity
      if (ca !== null) {
        for (const a of ca.activitiesImplementing(ctor, true))
          result.push(a)
      }
    }

    if (this instanceof ctor) {
      result.push(this)
    }

    const na = this.nextActivity
    if (na !== null) {
      for (const a of na.activitiesImplementing(ctor, true))
        result.push(a)
    }

    return result
  }
}
