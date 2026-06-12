/**
 * BehaviorTree.test.ts — unit tests for BehaviorTree nodes
 *
 * Tests focus on: correct node behavior, state machines, edge cases,
 * reset semantics, and composite/decorator/leaf interactions.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  Sequence,
  Selector,
  Parallel,
  ParallelPolicy,
  Inverter,
  Repeater,
  Limiter,
  Condition,
  Action,
  Wait,
  WeightedSelector,
  NodeStatus,
  sequence,
  select,
  condition,
  action,
  wait,
  limit,
  repeat,
} from './BehaviorTree.js'
import type { WeightedOption } from './BehaviorTree.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestContext {
  counter: number
  flag: boolean
}

function makeCtx(): TestContext {
  return { counter: 0, flag: false }
}

function actionSuccess<T>(name: string): Action<T> {
  return new Action<T>(name, (_ctx) => NodeStatus.Success)
}

function actionFailure<T>(name: string): Action<T> {
  return new Action<T>(name, (_ctx) => NodeStatus.Failure)
}

function actionRunning<T>(name: string): Action<T> {
  return new Action<T>(name, (_ctx) => NodeStatus.Running)
}

// ---------------------------------------------------------------------------
// Action & Condition
// ---------------------------------------------------------------------------

describe('Condition', () => {
  it('returns Success when predicate is true', () => {
    const node = new Condition<TestContext>('test', (ctx) => ctx.flag)
    const ctx = makeCtx()
    ctx.flag = true
    expect(node.tick(ctx)).toBe(NodeStatus.Success)
  })

  it('returns Failure when predicate is false', () => {
    const node = new Condition<TestContext>('test', (ctx) => ctx.flag)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Failure)
  })
})

describe('Action', () => {
  it('returns the result of the action function', () => {
    const node = new Action<TestContext>('test', () => NodeStatus.Success)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('returns Running when action returns Running', () => {
    const node = new Action<TestContext>('test', () => NodeStatus.Running)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
  })
})

describe('Wait', () => {
  it('returns Running until ticks expire, then Success', () => {
    const node = new Wait<TestContext>('wait', 3)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('resets wait timer after completion', () => {
    const node = new Wait<TestContext>('wait', 2)
    node.tick(makeCtx()) // Running
    node.tick(makeCtx()) // Success
    // Next tick: should start fresh
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('reset() restores original tick count', () => {
    const node = new Wait<TestContext>('wait', 5)
    node.tick(makeCtx())
    node.tick(makeCtx())
    node.reset()
    // Should need 5 ticks from fresh
    for (let i = 0; i < 4; i++) node.tick(makeCtx())
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })
})

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

describe('Sequence', () => {
  it('returns Success when all children succeed', () => {
    const node = new Sequence<TestContext>('seq', [
      actionSuccess('a'),
      actionSuccess('b'),
      actionSuccess('c'),
    ])
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('returns Failure at first failing child', () => {
    const executor = vi.fn(() => NodeStatus.Success)
    const node = new Sequence<TestContext>('seq', [
      new Action('a', executor),
      actionFailure('b'),
      new Action('c', executor),
    ])
    expect(node.tick(makeCtx())).toBe(NodeStatus.Failure)
    // 'a' should have been called once; 'c' never
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('returns Running and resumes at current child', () => {
    let count = 0
    const runningAction = new Action<TestContext>('running', () => {
      count++
      if (count < 3) return NodeStatus.Running
      return NodeStatus.Success
    })

    const afterFn = vi.fn(() => NodeStatus.Success)
    const after = new Action<TestContext>('after', afterFn)

    const node = new Sequence<TestContext>('seq', [runningAction, after])

    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
    // 'after' should be called once
    expect(afterFn).toHaveBeenCalledTimes(1)
  })

  it('resets index on reset()', () => {
    const first = vi.fn(() => NodeStatus.Success)
    const node = new Sequence<TestContext>('seq', [
      new Action('a', first),
      actionSuccess('b'),
    ])
    node.tick(makeCtx()) // completes both
    node.reset()
    node.tick(makeCtx()) // should start from first again
    expect(first).toHaveBeenCalledTimes(2)
  })

  it('empty sequence returns Success', () => {
    const node = new Sequence<TestContext>('empty', [])
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })
})

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

describe('Selector', () => {
  it('returns Success at first succeeding child', () => {
    const node = new Selector<TestContext>('sel', [
      actionFailure('a'),
      actionSuccess('b'),
      actionSuccess('c'),
    ])
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('returns Failure when all children fail', () => {
    const node = new Selector<TestContext>('sel', [
      actionFailure('a'),
      actionFailure('b'),
    ])
    expect(node.tick(makeCtx())).toBe(NodeStatus.Failure)
  })

  it('returns Running when current child returns Running', () => {
    let count = 0
    const runningChild = new Action<TestContext>('r', () => {
      count++
      return count >= 2 ? NodeStatus.Success : NodeStatus.Running
    })

    const node = new Selector<TestContext>('sel', [
      actionFailure('a'),
      runningChild,
      actionSuccess('c'),
    ])
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('resets on reset()', () => {
    const node = new Selector<TestContext>('sel', [
      actionSuccess('a'),
      actionSuccess('b'),
    ])
    node.tick(makeCtx())
    node.reset()
    // after reset, should try first child again
    const first = vi.fn(() => NodeStatus.Failure)
    const n2 = new Selector<TestContext>('s2', [
      new Action('a', first),
      actionSuccess('b'),
    ])
    n2.tick(makeCtx()) // first fails, second succeeds
    n2.reset()
    n2.tick(makeCtx()) // first should be tried again
    expect(first).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Parallel
// ---------------------------------------------------------------------------

describe('Parallel', () => {
  it('RequireAll: succeeds when all children succeed', () => {
    const node = new Parallel<TestContext>('par', [
      actionSuccess('a'),
      actionSuccess('b'),
    ], ParallelPolicy.RequireAll)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('RequireAll: short-circuits on first child failure', () => {
    const secondFn = vi.fn(() => NodeStatus.Success)
    const node = new Parallel<TestContext>('par', [
      actionFailure('a'),
      new Action('b', secondFn),
    ], ParallelPolicy.RequireAll)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Failure)
    // Short-circuit: second child is never reached after first failure
    expect(secondFn).not.toHaveBeenCalled()
  })

  it('RequireOne: succeeds on first child success', () => {
    const node = new Parallel<TestContext>('par', [
      actionSuccess('a'),
      actionRunning('b'),
    ], ParallelPolicy.RequireOne)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('RequireOne: fails only when all children fail', () => {
    const node = new Parallel<TestContext>('par', [
      actionFailure('a'),
      actionFailure('b'),
    ], ParallelPolicy.RequireOne)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Failure)
  })

  it('returns Running while children are still executing', () => {
    const node = new Parallel<TestContext>('par', [
      actionSuccess('a'),
      actionRunning('b'),
    ], ParallelPolicy.RequireAll)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
  })
})

// ---------------------------------------------------------------------------
// Inverter
// ---------------------------------------------------------------------------

describe('Inverter', () => {
  it('inverts Success to Failure', () => {
    const node = new Inverter<TestContext>('inv', actionSuccess('a'))
    expect(node.tick(makeCtx())).toBe(NodeStatus.Failure)
  })

  it('inverts Failure to Success', () => {
    const node = new Inverter<TestContext>('inv', actionFailure('a'))
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('passes through Running', () => {
    const node = new Inverter<TestContext>('inv', actionRunning('a'))
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
  })
})

// ---------------------------------------------------------------------------
// Repeater
// ---------------------------------------------------------------------------

describe('Repeater', () => {
  it('repeats child the specified number of times', () => {
    let count = 0
    const child = new Action<TestContext>('inc', () => {
      count++
      return NodeStatus.Success
    })
    const node = new Repeater<TestContext>('rep', child, 3)

    expect(node.tick(makeCtx())).toBe(NodeStatus.Running) // rep 1
    expect(count).toBe(1)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running) // rep 2
    expect(count).toBe(2)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success) // rep 3, done
    expect(count).toBe(3)
  })

  it('returns Running while repeating indefinitely', () => {
    const node = new Repeater<TestContext>('forever', actionSuccess('a'), -1)
    for (let i = 0; i < 100; i++) {
      expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
    }
  })

  it('returns Failure if child fails', () => {
    const node = new Repeater<TestContext>('rep', actionFailure('fail'), 5)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Failure)
  })

  it('resets count on reset()', () => {
    const node = new Repeater<TestContext>('rep', actionSuccess('a'), 3)
    node.tick(makeCtx()) // 1
    node.tick(makeCtx()) // 2
    node.reset()
    // Should need 3 again
    node.tick(makeCtx()) // 1
    node.tick(makeCtx()) // 2
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success) // 3
  })
})

// ---------------------------------------------------------------------------
// Limiter
// ---------------------------------------------------------------------------

describe('Limiter', () => {
  it('skips ticks within the interval (returns Success)', () => {
    let execCount = 0
    const child = new Action<TestContext>('work', () => {
      execCount++
      return NodeStatus.Success
    })
    const node = new Limiter<TestContext>('lim', child, 3)

    // First tick: executes
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
    expect(execCount).toBe(1)

    // Next 3 ticks: skipped
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
    expect(execCount).toBe(1)

    // 4th tick: executes again
    expect(node.tick(makeCtx())).toBe(NodeStatus.Success)
    expect(execCount).toBe(2)
  })

  it('returns Running while child is running', () => {
    const child = new Action<TestContext>('long', () => NodeStatus.Running)
    const node = new Limiter<TestContext>('lim', child, 2)
    expect(node.tick(makeCtx())).toBe(NodeStatus.Running)
  })

  it('forceNext() resets cooldown', () => {
    let execCount = 0
    const child = new Action<TestContext>('work', () => {
      execCount++
      return NodeStatus.Success
    })
    const node = new Limiter<TestContext>('lim', child, 5)
    node.tick(makeCtx()) // executes
    expect(execCount).toBe(1)
    node.forceNext()
    node.tick(makeCtx()) // executes again (forced)
    expect(execCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// WeightedSelector
// ---------------------------------------------------------------------------

describe('WeightedSelector', () => {
  it('selects the highest-scoring option', () => {
    const optA = actionSuccess('a')
    const optB = actionSuccess('b')
    const options: WeightedOption<TestContext>[] = [
      { node: optA, weight: 10 },
      { node: optB, weight: 100 },
    ]
    const scorer = (_ctx: TestContext, idx: number) => options[idx].weight
    const node = new WeightedSelector<TestContext>('ws', options, scorer)
    // Should select option B (weight 100)
    const status = node.tick(makeCtx())
    expect(status).toBe(NodeStatus.Success)
  })

  it('re-evaluates options on each reset', () => {
    let callCount = 0
    const scorer = (_ctx: TestContext, idx: number) => {
      callCount++
      return idx === 0 ? 100 : 1
    }
    const options: WeightedOption<TestContext>[] = [
      { node: actionSuccess('a'), weight: 100 },
      { node: actionSuccess('b'), weight: 1 },
    ]
    const node = new WeightedSelector<TestContext>('ws', options, scorer)
    node.tick(makeCtx())
    expect(callCount).toBe(2) // evaluated both options
    node.reset()
    node.tick(makeCtx())
    expect(callCount).toBe(4) // re-evaluated
  })
})

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

describe('factory helpers', () => {
  it('sequence() creates a Sequence', () => {
    const s = sequence('test', actionSuccess('a'), actionSuccess('b'))
    expect(s).toBeInstanceOf(Sequence)
    expect(s.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('select() creates a Selector', () => {
    const s = select('test', actionFailure('a'), actionSuccess('b'))
    expect(s).toBeInstanceOf(Selector)
    expect(s.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('condition() creates a Condition', () => {
    const c = condition<TestContext>('test', (ctx) => ctx.flag)
    expect(c).toBeInstanceOf(Condition)
    const ctx = makeCtx()
    ctx.flag = true
    expect(c.tick(ctx)).toBe(NodeStatus.Success)
  })

  it('action() creates an Action', () => {
    const a = action<TestContext>('test', () => NodeStatus.Success)
    expect(a).toBeInstanceOf(Action)
    expect(a.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('wait() creates a Wait', () => {
    const w = wait<TestContext>('test', 5)
    expect(w).toBeInstanceOf(Wait)
  })

  it('limit() creates a Limiter', () => {
    const l = limit<TestContext>('test', actionSuccess('a'), 3)
    expect(l).toBeInstanceOf(Limiter)
  })

  it('repeat() creates a Repeater', () => {
    const r = repeat<TestContext>('test', actionSuccess('a'), 3)
    expect(r).toBeInstanceOf(Repeater)
  })
})

// ---------------------------------------------------------------------------
// Integration: complex trees
// ---------------------------------------------------------------------------

describe('complex behavior trees', () => {
  it('Sequence with Selector children', () => {
    // Sequence(
    //   Selector(tryA, tryB),  // one must succeed
    //   Action(doC)            // then do C
    // )
    const tree = new Sequence<TestContext>('root', [
      new Selector<TestContext>('try', [
        actionFailure('A'),
        actionSuccess('B'),
      ]),
      actionSuccess('C'),
    ])
    expect(tree.tick(makeCtx())).toBe(NodeStatus.Success)
  })

  it('Selector with Sequence as last resort', () => {
    // Selector(
    //   Condition(needsPower) -> Action(buildPower),
    //   Condition(needsRefinery) -> Action(buildRefinery),
    //   Action(idlePatrol)  // always succeeds
    // )
    const ctx = makeCtx()

    const tree = new Selector<TestContext>('root', [
      new Sequence<TestContext>('powerBranch', [
        new Condition<TestContext>('needsPower', (c) => c.counter < 0),
        actionSuccess('buildPower'),
      ]),
      new Sequence<TestContext>('refineryBranch', [
        new Condition<TestContext>('needsRefinery', (c) => c.counter >= 0),
        actionSuccess('buildRefinery'),
      ]),
      actionSuccess('idlePatrol'),
    ])

    // ctx.counter = 0 => needsRefinery is true => second branch succeeds
    expect(tree.tick(ctx)).toBe(NodeStatus.Success)
  })

  it('Repeater wrapping a Sequence (periodic reassessment)', () => {
    let evalCount = 0
    const tree = new Repeater<TestContext>('periodic', new Sequence<TestContext>('assess', [
      new Action<TestContext>('eval', () => {
        evalCount++
        return NodeStatus.Success
      }),
    ]), 5)

    // Each tick: repeater → sequence → eval (Success) → count++
    for (let i = 0; i < 4; i++) {
      expect(tree.tick(makeCtx())).toBe(NodeStatus.Running)
    }
    expect(tree.tick(makeCtx())).toBe(NodeStatus.Success)
    expect(evalCount).toBe(5)
  })

  it('Limiter wrapping a Selector (throttled AI decisions)', () => {
    let decisionCount = 0
    const decisionTree = new Selector<TestContext>('decide', [
      new Action<TestContext>('act', () => {
        decisionCount++
        return NodeStatus.Success
      }),
    ])
    const tree = new Limiter<TestContext>('throttle', decisionTree, 10)

    // First tick executes
    tree.tick(makeCtx())
    expect(decisionCount).toBe(1)

    // Next 10 ticks are skipped (return Success, no action)
    for (let i = 0; i < 10; i++) {
      tree.tick(makeCtx())
    }
    expect(decisionCount).toBe(1) // still 1

    // 11th tick executes again
    tree.tick(makeCtx())
    expect(decisionCount).toBe(2)
  })
})
