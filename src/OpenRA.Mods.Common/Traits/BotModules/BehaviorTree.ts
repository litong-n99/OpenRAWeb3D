/**
 * BehaviorTree.ts — lightweight deterministic behavior tree for AI BotModules
 * OpenRA 对照: N/A (new abstraction replacing imperative C# state machines)
 *
 * 核心范式转换:
 * - C# imperative IBot.Tick() state machine (switch-case, if-else chains)
 *   → declarative Behavior Tree (Composite/Decorator/Leaf nodes)
 * - C# SquadManagerBotModule imperative state flags
 *   → Selector root with Sequence branches for each decision priority level
 * - C# AttackOrFleeFuzzy Mamdani fuzzy logic
 *   → WeightedSelector node with integer threshold parameters
 * - C# StateMachine (Activate/Tick/Deactivate)
 *   → Behavior Tree adapter: state nodes wrap behavior subtrees
 *
 * Design Constraints:
 * - ALL integer arithmetic — no floating point (deterministic across platforms)
 * - NO Math.random() — use supplied PRNG for any stochastic decisions
 * - NO per-frame allocation — nodes are pre-allocated; tick() reuses state
 * - PERF: <1ms per module per tick on 256×256 maps
 */

// ---------------------------------------------------------------------------
// NodeStatus — behavior tree execution result
// ---------------------------------------------------------------------------

/**
 * Result of a behavior tree node tick.
 *
 * OpenRA 对照: N/A (new abstraction)
 */
export const NodeStatus = {
  /** Node completed successfully. */
  Success: 0,
  /** Node failed to complete. */
  Failure: 1,
  /** Node is still executing (will continue next tick). */
  Running: 2,
} as const

export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus]

// ---------------------------------------------------------------------------
// BehaviorTreeNode — abstract base for all BT nodes
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all behavior tree nodes.
 *
 * Each node implements `tick(context)` which returns Success, Failure, or Running.
 * Nodes that return Running will be ticked again next frame.
 * Nodes that return Success/Failure are complete and control returns to the parent.
 */
export abstract class BehaviorTreeNode<TContext = unknown> {
  /** Node name for debugging. */
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  /**
   * Execute one tick of this node.
   *
   * @param context — shared blackboard/data context passed to all nodes
   * @returns Success, Failure, or Running
   */
  abstract tick(context: TContext): NodeStatus

  /**
   * Reset internal state. Called when the parent node restarts.
   * Default: no-op. Override in stateful nodes (Repeater, Wait, Limiter).
   */
  reset(): void {
    // default: no internal state to reset
  }

  /**
   * Get a human-readable status string for debugging.
   */
  getStatus(): string {
    return this.name
  }
}

// ---------------------------------------------------------------------------
// Composite Nodes
// ---------------------------------------------------------------------------

/**
 * Sequencer — executes children in order until one fails or all succeed.
 *
 * OpenRA 对照: N/A (replaces imperative sequential if-else chains)
 *
 * Behavior:
 * - Children are ticked left to right
 * - If a child returns Running, the Sequence returns Running and resumes
 *   at that child next tick
 * - If a child returns Failure, the Sequence returns Failure immediately
 * - If all children return Success, the Sequence returns Success
 *
 * This is the primary node for "check preconditions then perform action" patterns.
 *
 * ```
 * Sequence("BuildBase", [
 *   Condition("hasResources", ctx => ctx.cash >= 500),
 *   Action("placeRefinery", ctx => queueRefinery(ctx)),
 *   Wait("buildTime", 100),
 * ])
 * ```
 */
export class Sequence<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _children: BehaviorTreeNode<TContext>[]
  private _currentIndex: number = 0

  constructor(name: string, children: BehaviorTreeNode<TContext>[]) {
    super(name)
    this._children = children
  }

  tick(context: TContext): NodeStatus {
    while (this._currentIndex < this._children.length) {
      const child = this._children[this._currentIndex]
      const status = child.tick(context)

      if (status === NodeStatus.Running) {
        return NodeStatus.Running
      }

      if (status === NodeStatus.Failure) {
        this._currentIndex = 0
        return NodeStatus.Failure
      }

      // Success — advance to next child
      this._currentIndex++
    }

    this._currentIndex = 0
    return NodeStatus.Success
  }

  override reset(): void {
    this._currentIndex = 0
    for (const child of this._children) {
      child.reset()
    }
  }

  override getStatus(): string {
    return `Sequence(${this.name})[${this._currentIndex}/${this._children.length}]`
  }

  /** The children of this composite node. */
  get children(): readonly BehaviorTreeNode<TContext>[] {
    return this._children
  }
}

/**
 * Selector — executes children in order until one succeeds or all fail.
 *
 * OpenRA 对照: N/A (replaces imperative priority-based decision chains)
 *
 * Behavior:
 * - Children are ticked left to right (higher priority first)
 * - If a child returns Running, the Selector returns Running and resumes
 *   at that child next tick
 * - If a child returns Success, the Selector returns Success immediately
 * - If all children return Failure, the Selector returns Failure
 *
 * This is the primary node for "try each option in priority order" patterns.
 *
 * ```
 * Selector("SquadAssignment", [
 *   Sequence("Attack", [Condition("enemyInRange", ...), Action("assignAttack", ...)]),
 *   Sequence("Guard", [Condition("unprotectedBase", ...), Action("assignGuard", ...)]),
 *   Action("idlePatrol", ...),
 * ])
 * ```
 */
export class Selector<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _children: BehaviorTreeNode<TContext>[]
  private _currentIndex: number = 0

  constructor(name: string, children: BehaviorTreeNode<TContext>[]) {
    super(name)
    this._children = children
  }

  tick(context: TContext): NodeStatus {
    while (this._currentIndex < this._children.length) {
      const child = this._children[this._currentIndex]
      const status = child.tick(context)

      if (status === NodeStatus.Running) {
        return NodeStatus.Running
      }

      if (status === NodeStatus.Success) {
        this._currentIndex = 0
        return NodeStatus.Success
      }

      // Failure — try next child
      this._currentIndex++
    }

    this._currentIndex = 0
    return NodeStatus.Failure
  }

  override reset(): void {
    this._currentIndex = 0
    for (const child of this._children) {
      child.reset()
    }
  }

  override getStatus(): string {
    return `Selector(${this.name})[${this._currentIndex}/${this._children.length}]`
  }

  get children(): readonly BehaviorTreeNode<TContext>[] {
    return this._children
  }
}

/**
 * Parallel policy — determines when a Parallel node succeeds/fails.
 */
export const ParallelPolicy = {
  /** Require ALL children to succeed (any failure → Failure). */
  RequireAll: 0,
  /** Require only ONE child to succeed (all failures → Failure). */
  RequireOne: 1,
} as const

export type ParallelPolicy = (typeof ParallelPolicy)[keyof typeof ParallelPolicy]

/**
 * Parallel — executes all children concurrently with configurable success policy.
 *
 * OpenRA 对照: N/A (replaces parallel resource assignment patterns)
 *
 * Behavior:
 * - ALL children are ticked every time the Parallel node ticks
 * - With RequireAll: returns Success when all children succeed, Failure on first failure
 * - With RequireOne: returns Success on first success, Failure when all fail
 * - Returns Running while children are still executing
 */
export class Parallel<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _children: BehaviorTreeNode<TContext>[]
  private readonly _policy: ParallelPolicy

  constructor(
    name: string,
    children: BehaviorTreeNode<TContext>[],
    policy: ParallelPolicy = ParallelPolicy.RequireAll,
  ) {
    super(name)
    this._children = children
    this._policy = policy
  }

  tick(context: TContext): NodeStatus {
    let allDone = true
    let anySuccess = false
    let anyRunning = false

    for (const child of this._children) {
      const status = child.tick(context)

      if (status === NodeStatus.Running) {
        anyRunning = true
        allDone = false
      } else if (status === NodeStatus.Failure) {
        allDone = false
        if (this._policy === ParallelPolicy.RequireAll) {
          return NodeStatus.Failure
        }
      } else {
        // Success
        anySuccess = true
        if (this._policy === ParallelPolicy.RequireOne) {
          return NodeStatus.Success
        }
      }
    }

    if (anyRunning) return NodeStatus.Running
    if (this._policy === ParallelPolicy.RequireAll && allDone) return NodeStatus.Success
    if (this._policy === ParallelPolicy.RequireOne && anySuccess) return NodeStatus.Success
    return NodeStatus.Failure
  }

  override reset(): void {
    for (const child of this._children) {
      child.reset()
    }
  }

  override getStatus(): string {
    return `Parallel(${this.name})[policy=${this._policy}]`
  }
}

// ---------------------------------------------------------------------------
// Decorator Nodes
// ---------------------------------------------------------------------------

/**
 * Inverter — inverts the result of the child node.
 *
 * Success → Failure, Failure → Success, Running → Running.
 */
export class Inverter<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _child: BehaviorTreeNode<TContext>

  constructor(name: string, child: BehaviorTreeNode<TContext>) {
    super(name)
    this._child = child
  }

  tick(context: TContext): NodeStatus {
    const status = this._child.tick(context)
    if (status === NodeStatus.Success) return NodeStatus.Failure
    if (status === NodeStatus.Failure) return NodeStatus.Success
    return NodeStatus.Running
  }

  override reset(): void {
    this._child.reset()
  }
}

/**
 * Repeater — repeats the child node N times, or indefinitely (N = -1).
 *
 * Returns Running while repeating. Returns Success after N repetitions or when
 * child fails. If N = -1, repeats forever (always returns Running).
 */
export class Repeater<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _child: BehaviorTreeNode<TContext>
  private readonly _maxRepetitions: number
  private _repetitionCount: number = 0

  /**
   * @param name — node name
   * @param child — the node to repeat
   * @param maxRepetitions — maximum repetitions, or -1 for infinite
   */
  constructor(name: string, child: BehaviorTreeNode<TContext>, maxRepetitions: number = -1) {
    super(name)
    this._child = child
    this._maxRepetitions = maxRepetitions
  }

  tick(context: TContext): NodeStatus {
    const status = this._child.tick(context)

    if (status === NodeStatus.Running) {
      return NodeStatus.Running
    }

    if (status === NodeStatus.Failure) {
      this._repetitionCount = 0
      return NodeStatus.Failure
    }

    this._repetitionCount++

    if (this._maxRepetitions >= 0 && this._repetitionCount >= this._maxRepetitions) {
      this._repetitionCount = 0
      return NodeStatus.Success
    }

    this._child.reset()
    return NodeStatus.Running
  }

  override reset(): void {
    this._repetitionCount = 0
    this._child.reset()
  }
}

/**
 * Limiter — limits child execution to once per N ticks.
 *
 * Useful for spreading expensive scans across multiple ticks.
 * Returns the child's status when allowed to execute.
 * Returns Success (skipping) on cooldown ticks.
 */
export class Limiter<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _child: BehaviorTreeNode<TContext>
  private readonly _intervalTicks: number
  private _ticksUntilNext: number = 0

  /**
   * @param name — node name
   * @param child — the node to throttle
   * @param intervalTicks — minimum ticks between executions
   */
  constructor(name: string, child: BehaviorTreeNode<TContext>, intervalTicks: number) {
    super(name)
    this._child = child
    this._intervalTicks = intervalTicks
  }

  tick(context: TContext): NodeStatus {
    if (this._ticksUntilNext > 0) {
      this._ticksUntilNext--
      return NodeStatus.Success // skip — not a failure
    }

    const status = this._child.tick(context)
    if (status !== NodeStatus.Running) {
      this._ticksUntilNext = this._intervalTicks
    }
    return status
  }

  override reset(): void {
    this._ticksUntilNext = 0
    this._child.reset()
  }

  /** Force the next tick to execute (reset cooldown). */
  forceNext(): void {
    this._ticksUntilNext = 0
  }
}

// ---------------------------------------------------------------------------
// Leaf Nodes
// ---------------------------------------------------------------------------

/**
 * Condition — checks a boolean predicate against the context.
 *
 * Returns Success if predicate returns true, Failure otherwise.
 * Never returns Running.
 *
 * @typeParam TContext — the shared context type (typically the BotModule)
 */
export class Condition<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _predicate: (context: TContext) => boolean

  /**
   * @param name — descriptive condition name
   * @param predicate — function returning true/false
   */
  constructor(name: string, predicate: (context: TContext) => boolean) {
    super(name)
    this._predicate = predicate
  }

  tick(context: TContext): NodeStatus {
    return this._predicate(context) ? NodeStatus.Success : NodeStatus.Failure
  }
}

/**
 * Action — performs a game action against the context.
 *
 * Returns the result of the action function (Success/Failure/Running).
 * Actions that complete synchronously return Success or Failure.
 * Actions that start an async operation (e.g., building placement) return Running
 * and will be ticked again until they complete.
 *
 * @typeParam TContext — the shared context type (typically the BotModule)
 */
export class Action<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _action: (context: TContext) => NodeStatus

  /**
   * @param name — descriptive action name
   * @param action — function performing the action, returns Success/Failure/Running
   */
  constructor(name: string, action: (context: TContext) => NodeStatus) {
    super(name)
    this._action = action
  }

  tick(context: TContext): NodeStatus {
    return this._action(context)
  }
}

/**
 * Wait — suspends execution for N ticks.
 *
 * Returns Running until the wait timer expires, then Success.
 * This is the primary node for delaying between actions (e.g., wait for building completion).
 */
export class Wait<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _ticks: number
  private _remaining: number

  /**
   * @param name — descriptive name
   * @param ticks — number of ticks to wait
   */
  constructor(name: string, ticks: number) {
    super(name)
    this._ticks = ticks
    this._remaining = ticks
  }

  tick(_context: TContext): NodeStatus {
    this._remaining--
    if (this._remaining <= 0) {
      this._remaining = this._ticks
      return NodeStatus.Success
    }
    return NodeStatus.Running
  }

  override reset(): void {
    this._remaining = this._ticks
  }
}

// ---------------------------------------------------------------------------
// WeightedSelector — deterministic multi-factor decision node
// ---------------------------------------------------------------------------

/**
 * Option for WeightedSelector with its relative weight.
 */
export interface WeightedOption<TContext = unknown> {
  /** The behavior subtree for this option. */
  node: BehaviorTreeNode<TContext>
  /** Integer weight (higher = more likely to be selected). */
  weight: number
}

/**
 * WeightedSelector — evaluates weighted options and selects one deterministically.
 *
 * OpenRA 对照: AttackOrFleeFuzzy Mamdani fuzzy engine → deterministic weighted sum
 *
 * Behavior:
 * - Each tick: calculates scores for all options using the scorer function
 * - Selects the option with the highest score
 * - Ticks that option's subtree
 * - If the subtree completes (Success/Failure), WeightedSelector completes
 * - Returns Running while the selected subtree is executing
 *
 * Determinism: all scoring is integer-based. No randomization.
 * The `scorer` function receives (context, optionIndex) and returns an integer weight.
 */
export class WeightedSelector<TContext = unknown> extends BehaviorTreeNode<TContext> {
  private readonly _options: WeightedOption<TContext>[]
  private readonly _scorer: (context: TContext, optionIndex: number) => number
  private _selectedIndex: number = -1

  constructor(
    name: string,
    options: WeightedOption<TContext>[],
    scorer: (context: TContext, optionIndex: number) => number,
  ) {
    super(name)
    this._options = options
    this._scorer = scorer
  }

  tick(context: TContext): NodeStatus {
    if (this._selectedIndex < 0) {
      // Select the best option
      let bestScore = -2147483648 // INT32_MIN
      let bestIndex = 0

      for (let i = 0; i < this._options.length; i++) {
        const score = this._scorer(context, i)
        if (score > bestScore) {
          bestScore = score
          bestIndex = i
        }
      }

      this._selectedIndex = bestIndex
    }

    const selected = this._options[this._selectedIndex]
    if (!selected) {
      this._selectedIndex = -1
      return NodeStatus.Failure
    }

    const status = selected.node.tick(context)

    if (status !== NodeStatus.Running) {
      this._selectedIndex = -1
    }

    return status
  }

  override reset(): void {
    this._selectedIndex = -1
    for (const option of this._options) {
      option.node.reset()
    }
  }

  override getStatus(): string {
    if (this._selectedIndex >= 0 && this._selectedIndex < this._options.length) {
      return `WeightedSelector(${this.name})[selected=${this._selectedIndex}]`
    }
    return `WeightedSelector(${this.name})[unselected]`
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a Sequence node (fluent-style).
 */
export function sequence<T>(name: string, ...children: BehaviorTreeNode<T>[]): Sequence<T> {
  return new Sequence<T>(name, children)
}

/**
 * Create a Selector node (fluent-style).
 */
export function select<T>(name: string, ...children: BehaviorTreeNode<T>[]): Selector<T> {
  return new Selector<T>(name, children)
}

/**
 * Create a Condition node.
 */
export function condition<T>(name: string, pred: (ctx: T) => boolean): Condition<T> {
  return new Condition<T>(name, pred)
}

/**
 * Create an Action node.
 */
export function action<T>(name: string, fn: (ctx: T) => NodeStatus): Action<T> {
  return new Action<T>(name, fn)
}

/**
 * Create a Wait node.
 */
export function wait<T>(name: string, ticks: number): Wait<T> {
  return new Wait<T>(name, ticks)
}

/**
 * Create a Limiter-wrapped node.
 */
export function limit<T>(name: string, child: BehaviorTreeNode<T>, interval: number): Limiter<T> {
  return new Limiter<T>(name, child, interval)
}

/**
 * Create a Repeater-wrapped node.
 */
export function repeat<T>(name: string, child: BehaviorTreeNode<T>, max?: number): Repeater<T> {
  return new Repeater<T>(name, child, max)
}
