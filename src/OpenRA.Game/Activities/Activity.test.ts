/**
 * Activity.test.ts — Activity abstract class migration unit tests
 *
 * Since happy-dom does not support WebGL, only logic and state transitions
 * are tested. The Activity class does not import Babylon.js directly, so
 * no Babylon.js mocking is needed.
 *
 * Tests focus on:
 * - State machine transitions (Queued → Active → Done)
 * - Child activity priority (childHasPriority=true/false)
 * - Cancellation (Queued→Done skip, Active→Canceling→Done)
 * - Activity chain advancement (nextActivity)
 * - SkipDoneActivities
 * - onFirstRun / onLastRun lifecycle
 * - onActorDisposeOuter cascading
 * - isInterruptible guard
 * - Debug methods (debugLabelComponents, activitiesImplementing)
 * - Edge cases (double tick after Done, cancel before first tick)
 */

import { describe, it, expect } from 'vitest'
import { Activity, ActivityState, TargetLineNode } from './Activity.js'
import type { GameActor } from '../Actor.js'
import type { Target } from '../Traits/Target.js'
import type { ColorStub } from '../Traits/TraitsInterfaces.js'
import type { Sprite } from '../Graphics/Sprite.js'

// ---------------------------------------------------------------------------
// Minimal mock GameActor for tests
// ---------------------------------------------------------------------------

/**
 * Create a minimal GameActor-like object for Activity tests.
 * Only provides toString() which is used in error messages.
 */
function mockActor(id: number = 1): GameActor {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    toString() { return `Actor ${id}` },
  } as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Concrete test activity subclasses
// ---------------------------------------------------------------------------

/**
 * Simple activity that completes after a configurable number of ticks.
 */
class TickCountActivity extends Activity {
  ticksRemaining: number
  onFirstRunCalled = false
  onLastRunCalled = false
  onDisposeCalled = false

  constructor(ticksToComplete: number = 1) {
    super()
    this.ticksRemaining = ticksToComplete
  }

  override onFirstRun(_self: GameActor): void {
    super.onFirstRun(_self)
    this.onFirstRunCalled = true
  }

  override onLastRun(_self: GameActor): void {
    super.onLastRun(_self)
    this.onLastRunCalled = true
  }

  override onActorDispose(_self: GameActor): void {
    super.onActorDispose(_self)
    this.onDisposeCalled = true
  }

  override tick(_self: GameActor): boolean {
    this.ticksRemaining--
    return this.ticksRemaining <= 0
  }
}

/**
 * An activity that always blocks (never completes).
 */
class BlockingActivity extends Activity {
  override tick(_self: GameActor): boolean {
    return false
  }
}

/**
 * An activity that queues a child during onFirstRun.
 */
class ParentActivity extends Activity {
  childToQueue: Activity | null = null
  parentTickCalls = 0

  constructor(child: Activity | null = null) {
    super()
    this.childToQueue = child
  }

  override onFirstRun(self: GameActor): void {
    super.onFirstRun(self)
    if (this.childToQueue) {
      this.queueChild(this.childToQueue)
    }
  }

  override tick(_self: GameActor): boolean {
    this.parentTickCalls++
    return true // Complete after first parent tick
  }
}

/**
 * An activity that returns true from tick (completes immediately).
 * Implements tick in the simplest way matching the base class default.
 */
class ImmediateActivity extends Activity {
  tickCalled = false

  override tick(_self: GameActor): boolean {
    this.tickCalled = true
    return true
  }
}

/**
 * An activity with childHasPriority = false.
 * Parent and child tick independently.
 */
class ParallelActivity extends Activity {
  childTicked = false
  parentTicked = false

  constructor() {
    super()
    this.childHasPriority = false
  }

  override tick(_self: GameActor): boolean {
    this.parentTicked = true
    // Manually tick child
    if (this.childActivity) {
      this.tickChild(_self)
    }
    return !!this.childActivity // Return true (done) if child still active
  }
}

// ---------------------------------------------------------------------------
// TargetLineNode
// ---------------------------------------------------------------------------

describe('TargetLineNode', () => {
  it('stores target, color, and tile', () => {
    const target = { type: 0 } as unknown as Target
    const color: ColorStub = { r: 255, g: 0, b: 0, a: 255 }
    const tile = { bounds: {} } as unknown as Sprite

    const node = new TargetLineNode(target, color, tile)
    expect(node.target).toBe(target)
    expect(node.color).toBe(color)
    expect(node.tile).toBe(tile)
  })

  it('defaults tile to null', () => {
    const target = { type: 0 } as unknown as Target
    const color: ColorStub = { r: 0, g: 255, b: 0, a: 255 }

    const node = new TargetLineNode(target, color)
    expect(node.tile).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ActivityState enum
// ---------------------------------------------------------------------------

describe('ActivityState', () => {
  it('has 4 states matching OpenRA', () => {
    expect(ActivityState.Queued).toBe(0)
    expect(ActivityState.Active).toBe(1)
    expect(ActivityState.Canceling).toBe(2)
    expect(ActivityState.Done).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Activity — Construction & defaults
// ---------------------------------------------------------------------------

describe('Activity', () => {
  describe('Construction & defaults', () => {
    it('starts in Queued state', () => {
      const act = new ImmediateActivity()
      expect(act.state).toBe(ActivityState.Queued)
    })

    it('defaults isInterruptible to true', () => {
      const act = new ImmediateActivity()
      expect(act.isInterruptible).toBe(true)
    })

    it('defaults childHasPriority to true', () => {
      const act = new ImmediateActivity()
      expect(act.childHasPriority).toBe(true)
    })

    it('isCanceling is false initially', () => {
      const act = new ImmediateActivity()
      expect(act.isCanceling).toBe(false)
    })

    it('childActivity is null initially', () => {
      const act = new ImmediateActivity()
      expect(act.childActivity).toBeNull()
    })

    it('nextActivity is null initially', () => {
      const act = new ImmediateActivity()
      expect(act.nextActivity).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // State machine — basic transitions
  // -------------------------------------------------------------------------

  describe('State machine', () => {
    it('transitions Queued → Active on first tickOuter', () => {
      const actor = mockActor()
      const act = new BlockingActivity()

      expect(act.state).toBe(ActivityState.Queued)
      act.tickOuter(actor)
      expect(act.state).toBe(ActivityState.Active)
    })

    it('calls onFirstRun exactly once during Queued→Active transition', () => {
      const actor = mockActor()
      const act = new TickCountActivity(2)

      expect(act.onFirstRunCalled).toBe(false)
      act.tickOuter(actor) // First tick: Queued → Active
      expect(act.onFirstRunCalled).toBe(true)
      expect(act.state).toBe(ActivityState.Active)

      act.tickOuter(actor) // Second tick: stay Active (ticksRemaining: 1→0)
      expect(act.onFirstRunCalled).toBe(true) // Still called only once
    })

    it('transitions Active → Done when tick returns true', () => {
      const actor = mockActor()
      const act = new ImmediateActivity()

      const result = act.tickOuter(actor) // Queued→Active, tick→true → Done
      expect(act.state).toBe(ActivityState.Done)
      expect(act.tickCalled).toBe(true)
      expect(result).toBeNull() // No next activity
    })

    it('stays Active when tick returns false', () => {
      const actor = mockActor()
      const act = new BlockingActivity()

      const result = act.tickOuter(actor) // Queued→Active, tick→false → stays Active
      expect(act.state).toBe(ActivityState.Active)
      expect(result).toBe(act) // Returns itself
    })

    it('calls onLastRun when transitioning to Done', () => {
      const actor = mockActor()
      const act = new TickCountActivity(1)

      expect(act.onLastRunCalled).toBe(false)
      act.tickOuter(actor) // Queued→Active→Done
      expect(act.onLastRunCalled).toBe(true)
    })

    it('does NOT call onLastRun if still Active', () => {
      const actor = mockActor()
      const act = new TickCountActivity(2)

      act.tickOuter(actor) // Queued→Active, tick returns false (ticksRemaining: 1→0? No: 2→1)
      expect(act.onLastRunCalled).toBe(false)
    })

    it('throws if tickOuter called after Done', () => {
      const actor = mockActor()
      const act = new ImmediateActivity()

      act.tickOuter(actor) // Completes
      expect(() => act.tickOuter(actor)).toThrow(/after it had already completed/)
    })

    it('throws if tickOuter somehow skips onFirstRun', () => {
      const actor = mockActor()
      const act = new ImmediateActivity()

      // Manually set to Active without calling onFirstRun (should not happen normally)
      act.state = ActivityState.Active
      // firstRunCompleted is still false
      expect(() => act.tickOuter(actor)).toThrow(/before running its onFirstRun/)
    })
  })

  // -------------------------------------------------------------------------
  // Child activity priority (childHasPriority = true, default)
  // -------------------------------------------------------------------------

  describe('Child activity priority', () => {
    it('child ticks before parent when childHasPriority=true', () => {
      const actor = mockActor()
      const child = new TickCountActivity(1)
      const parent = new ParentActivity(child)

      // First tick: Queued→Active for parent, queues child
      // Child queued check: child.state is Queued → immediately tick child
      // child ticks: Queued→Active→Done (1 tick complete)
      // parent.lastRun = tickChild(true) && (false || tick()→true) = true
      // parent → Done
      parent.tickOuter(actor)

      expect(parent.state).toBe(ActivityState.Done)
      expect(child.state).toBe(ActivityState.Done)
      expect(child.onFirstRunCalled).toBe(true)
      expect(child.onLastRunCalled).toBe(true)
      expect(parent.parentTickCalls).toBe(1)
    })

    it('parent waits for multi-tick child to complete', () => {
      const actor = mockActor()
      const child = new TickCountActivity(2)
      const parent = new ParentActivity(child)

      // First tick: parent Queued→Active, queues child, child ticks 1→0 (not done)
      parent.tickOuter(actor)
      expect(parent.state).toBe(ActivityState.Active)
      expect(child.state).toBe(ActivityState.Active)

      // Second tick: child is still active, child ticks 0→-1 (done)
      parent.tickOuter(actor)
      expect(child.state).toBe(ActivityState.Done)
      expect(parent.state).toBe(ActivityState.Done)
    })

    it('finishing flag allows parent to return true before child finishes', () => {
      const actor = mockActor()

      // Create a parent that returns true from tick (wants to finish)
      // but has a multi-tick child. The parent's tick() is only called
      // AFTER the child completes (childHasPriority=true).
      // The finishing flag is set when parent.tick() returns true,
      // which only happens after the child is done (in the first tick).
      // In a multi-tick child scenario, the parent waits.
      const child = new TickCountActivity(2)
      const parent = new ParentActivity(child)

      // First tickOuter: parent Queued→Active, queues child
      // child ticks (2→1, not done), tickChild returns false
      // childHasPriority=true: lastRun = false && (... ) = false (short-circuit)
      // Just-queued child check: child state is Active (just ticked), not Queued → skip
      // parent stays Active
      const result1 = parent.tickOuter(actor)

      expect(parent.state).toBe(ActivityState.Active)
      // Parent's tick() was NOT called yet — child is still running
      expect(parent.parentTickCalls).toBe(0)
      // Child is Active
      expect(child.state).toBe(ActivityState.Active)
      expect(result1).toBe(parent) // parent keeps running

      // Second tickOuter: child ticks (1→0, done now!)
      // tickChild returns true (child is done)
      // lastRun = true && (finishing=false || tick(self)=true) = true
      // finishing = finishing || lastRun = true
      // parent → Done
      const result2 = parent.tickOuter(actor)

      expect(parent.state).toBe(ActivityState.Done)
      expect(parent.parentTickCalls).toBe(1) // Called after child done
      expect(child.state).toBe(ActivityState.Done)
      expect(result2).toBeNull() // Chain complete
    })

    it('childHasPriority=false allows parallel execution', () => {
      const actor = mockActor()
      const child = new TickCountActivity(2)
      const parent = new ParallelActivity()

      parent.queueChild(child)

      // First tick: parent Queued→Active
      // childHasPriority=false → lastRun = parent.tick()
      // parent.tick: parentTicked=true, tickChild(child) → child becomes Active, returns false (child active)
      // parent.tick returns !!childActivity = true → lastRun=true
      // But then just-queued child check: child.state == Active (not Queued) → skip
      parent.tickOuter(actor)

      // parent returns true, but let me check... child is still Active.
      // Wait, parent.tick returned true, so lastRun=true, parent→Done
      // But parent.tick returned true because !!childActivity is true
      // parent's tick: tickChild(self) — no, it checks:
      // this.tickChild(_self) but the return value isn't checked in the parent.tick
      // Actually looking at ParallelActivity.tick:
      //   this.parentTicked = true
      //   if (this.childActivity) { this.tickChild(_self) }
      //   return !!this.childActivity
      // tickChild runs child's tickOuter, child stays Active
      // !!this.childActivity → true → parent tick returns true
      // parent → Done, onLastRun called
      expect(parent.parentTicked).toBe(true)
      expect(parent.state).toBe(ActivityState.Done)
      // Child is still Active (needs more ticks)
      expect(child.state).toBe(ActivityState.Active)
    })
  })

  // -------------------------------------------------------------------------
  // Chain advancement (nextActivity)
  // -------------------------------------------------------------------------

  describe('Chain advancement', () => {
    it('advances to nextActivity when current completes', () => {
      const actor = mockActor()
      const act1 = new ImmediateActivity()
      const act2 = new ImmediateActivity()

      act1.queue(act2)
      expect(act1.nextActivity).toBe(act2)

      const result = act1.tickOuter(actor)
      // act1 completes (tick→true), returns nextActivity (act2)
      expect(result).toBe(act2)
      expect(act1.state).toBe(ActivityState.Done)
    })

    it('queue appends to the end of the chain', () => {
      const act1 = new ImmediateActivity()
      const act2 = new ImmediateActivity()
      const act3 = new ImmediateActivity()

      act1.queue(act2)
      act1.queue(act3)

      // act1 → act2 → act3
      expect(act1.nextActivity).toBe(act2)
      expect(act2.nextActivity).toBe(act3)
      expect(act3.nextActivity).toBeNull()
    })

    it('multiple activities execute in sequence', () => {
      const actor = mockActor()
      const act1 = new TickCountActivity(1)
      const act2 = new TickCountActivity(1)
      const act3 = new TickCountActivity(1)

      act1.queue(act2)
      act2.queue(act3)

      // Tick 1: act1 completes, advances to act2
      let current: Activity | null = act1
      current = current.tickOuter(actor)
      expect(current).toBe(act2)
      expect(act1.state).toBe(ActivityState.Done)

      // Tick 2: act2 completes, advances to act3
      current = current!.tickOuter(actor)
      expect(current).toBe(act3)
      expect(act2.state).toBe(ActivityState.Done)

      // Tick 3: act3 completes, chain exhausted
      current = current!.tickOuter(actor)
      expect(current).toBeNull()
      expect(act3.state).toBe(ActivityState.Done)
    })
  })

  // -------------------------------------------------------------------------
  // SkipDoneActivities
  // -------------------------------------------------------------------------

  describe('SkipDoneActivities', () => {
    it('skips single Done activity', () => {
      const act1 = new ImmediateActivity()
      act1.state = ActivityState.Done
      const act2 = new ImmediateActivity()
      act1._nextActivity = act2

      const result = Activity.skipDoneActivities(act1)
      expect(result).toBe(act2)
    })

    it('skips multiple consecutive Done activities', () => {
      const act1 = new ImmediateActivity()
      act1.state = ActivityState.Done
      const act2 = new ImmediateActivity()
      act2.state = ActivityState.Done
      const act3 = new ImmediateActivity()
      act3.state = ActivityState.Active

      act1._nextActivity = act2
      act2._nextActivity = act3

      const result = Activity.skipDoneActivities(act1)
      expect(result).toBe(act3)
    })

    it('returns null if entire chain is Done', () => {
      const act1 = new ImmediateActivity()
      act1.state = ActivityState.Done

      const result = Activity.skipDoneActivities(act1)
      expect(result).toBeNull()
    })

    it('returns null for null input', () => {
      const result = Activity.skipDoneActivities(null)
      expect(result).toBeNull()
    })

    it('returns first activity if not Done', () => {
      const act1 = new ImmediateActivity()
      act1.state = ActivityState.Queued

      const result = Activity.skipDoneActivities(act1)
      expect(result).toBe(act1)
    })
  })

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------

  describe('Cancel', () => {
    it('marks Queued activity as Done immediately', () => {
      const actor = mockActor()
      const act = new TickCountActivity(3)

      expect(act.state).toBe(ActivityState.Queued)
      act.cancel(actor)
      expect(act.state).toBe(ActivityState.Done)
    })

    it('marks Active activity as Canceling', () => {
      const actor = mockActor()
      const act = new BlockingActivity()

      act.tickOuter(actor) // Queued → Active
      expect(act.state).toBe(ActivityState.Active)

      act.cancel(actor)
      expect(act.state).toBe(ActivityState.Canceling)
    })

    it('cancels child activities recursively', () => {
      const actor = mockActor()
      const child = new TickCountActivity(3)
      const parent = new ParentActivity(child)

      // Activate both parent and child
      parent.tickOuter(actor)
      // child should be Active now
      expect(child.state).toBe(ActivityState.Active)

      parent.cancel(actor)
      // Both should be affected
      expect(child.state).toBe(ActivityState.Canceling)
      expect(parent.state).toBe(ActivityState.Canceling)
    })

    it('keepQueue=true preserves nextActivity chain', () => {
      const actor = mockActor()
      const act1 = new ImmediateActivity()
      const act2 = new ImmediateActivity()

      act1._nextActivity = act2
      act1.cancel(actor, true) // keepQueue=true

      expect(act1.nextActivity).toBe(act2) // Chain preserved
    })

    it('keepQueue=false clears nextActivity chain', () => {
      const actor = mockActor()
      const act1 = new ImmediateActivity()
      const act2 = new ImmediateActivity()

      act1._nextActivity = act2
      act1.cancel(actor) // keepQueue=false (default)

      expect(act1.nextActivity).toBeNull() // Chain cleared
    })

    it('isInterruptible=false prevents cancellation', () => {
      const actor = mockActor()
      const act = new BlockingActivity()
      act.isInterruptible = false

      act.tickOuter(actor) // Queued → Active
      expect(act.state).toBe(ActivityState.Active)

      act.cancel(actor)
      // Should NOT change state because not interruptible
      expect(act.state).toBe(ActivityState.Active)
    })

    it('Canceling activity transitions to Done with onLastRun after cleanup tick', () => {
      const actor = mockActor()

      // Create an activity that detects cancellation and cleans up
      class CancellingActivity extends Activity {
        cleanedUp = false
        onLastRunCalled = false

        override tick(_self: GameActor): boolean {
          if (this.isCanceling) {
            this.cleanedUp = true
            return true // Cleanup complete
          }
          return false // Keep running normally
        }

        override onLastRun(_self: GameActor): void {
          super.onLastRun(_self)
          this.onLastRunCalled = true
        }
      }

      const act = new CancellingActivity()

      // Queued → Active
      act.tickOuter(actor)
      expect(act.state).toBe(ActivityState.Active)

      // Cancel: Active → Canceling
      act.cancel(actor)
      expect(act.state).toBe(ActivityState.Canceling)

      // Tick: detects Canceling, cleans up, returns true → Done
      const result = act.tickOuter(actor)
      expect(act.cleanedUp).toBe(true)
      expect(act.state).toBe(ActivityState.Done)
      expect(act.onLastRunCalled).toBe(true)
      expect(result).toBeNull() // No next activity
    })

    it('double-cancel on Done activity is a safe no-op', () => {
      const actor = mockActor()
      const act = new ImmediateActivity()

      // Complete the activity normally
      act.tickOuter(actor)
      expect(act.state).toBe(ActivityState.Done)

      // Double-cancel: should stay Done, not transition to Canceling
      act.cancel(actor)
      expect(act.state).toBe(ActivityState.Done)
    })

    it('cancel on Queued activity transitions directly to Done', () => {
      const actor = mockActor()
      const act = new TickCountActivity(3)

      expect(act.state).toBe(ActivityState.Queued)
      act.cancel(actor)
      expect(act.state).toBe(ActivityState.Done)

      // Double-cancel on Done (from Queued→Done via cancel) is also safe
      act.cancel(actor)
      expect(act.state).toBe(ActivityState.Done)
    })
  })

  // -------------------------------------------------------------------------
  // queueChild
  // -------------------------------------------------------------------------

  describe('queueChild', () => {
    it('sets child when no existing child', () => {
      const parent = new ImmediateActivity()
      const child = new ImmediateActivity()

      parent.queueChild(child)
      expect(parent._childActivity).toBe(child)
    })

    it('appends to existing child chain', () => {
      const parent = new ImmediateActivity()
      const child1 = new ImmediateActivity()
      const child2 = new ImmediateActivity()

      parent.queueChild(child1)
      parent.queueChild(child2)

      // child2 should be appended after child1
      expect(parent._childActivity).toBe(child1)
      expect(child1._nextActivity).toBe(child2)
    })
  })

  // -------------------------------------------------------------------------
  // onActorDisposeOuter
  // -------------------------------------------------------------------------

  describe('onActorDisposeOuter', () => {
    it('cascades to child activity', () => {
      const actor = mockActor()
      const child = new TickCountActivity(1)
      // Use two TickCountActivity instances — both have onDisposeCalled
      const parent = new TickCountActivity(1)
      parent.queueChild(child)

      parent.onActorDisposeOuter(actor)

      expect(parent.onDisposeCalled).toBe(true)
      expect(child.onDisposeCalled).toBe(true)
    })

    it('does not throw when child is null', () => {
      const actor = mockActor()
      const parent = new ImmediateActivity()

      expect(() => parent.onActorDisposeOuter(actor)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Debug methods
  // -------------------------------------------------------------------------

  describe('Debug methods', () => {
    it('debugLabelComponents returns type names from this downward', () => {
      const child = new ImmediateActivity()
      // Set the constructor name to a predictable value
      Object.defineProperty(child, 'constructor', { value: { name: 'ChildAct' } })

      const parent = new ImmediateActivity()
      Object.defineProperty(parent, 'constructor', { value: { name: 'ParentAct' } })

      parent._childActivity = child

      const labels = parent.debugLabelComponents()
      expect(labels.length).toBeGreaterThanOrEqual(1)
      // First label should be the parent's type
      expect(labels[0]).toMatch(/Act/)
    })

    it('getTargets returns empty array by default', () => {
      const actor = mockActor()
      const act = new ImmediateActivity()
      expect(act.getTargets(actor)).toEqual([])
    })

    it('targetLineNodes returns empty array by default', () => {
      const actor = mockActor()
      const act = new ImmediateActivity()
      expect(act.targetLineNodes(actor)).toEqual([])
    })

    it('printActivityTree does not throw', () => {
      const actor = mockActor()
      const act = new ImmediateActivity()

      // Access protected method via a cast for testing
      expect(() => (act as unknown as { printActivityTree: (a: GameActor) => void }).printActivityTree(actor)).not.toThrow()
    })

    it('activitiesImplementing finds matching activities by constructor', () => {
      const act1 = new ImmediateActivity()
      const act2 = new TickCountActivity(1)

      act1._nextActivity = act2

      // act1 is ImmediateActivity — should match
      const results = act1.activitiesImplementing(ImmediateActivity)
      expect(results.length).toBe(1)
      expect(results[0]).toBe(act1)

      // act2 is TickCountActivity — should match different constructor
      const results2 = act2.activitiesImplementing(TickCountActivity)
      expect(results2.length).toBe(1)
      expect(results2[0]).toBe(act2)

      // act1 is NOT a TickCountActivity, but act2 (in the chain) IS.
      // activitiesImplementing searches the entire chain including nextActivity.
      const results3 = act1.activitiesImplementing(TickCountActivity)
      expect(results3.length).toBe(1)
      expect(results3[0]).toBe(act2)
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('Edge cases', () => {
    it('activity with state=Done is skipped by SkipDoneActivities getters', () => {
      const act1 = new ImmediateActivity()
      act1.state = ActivityState.Done
      const act2 = new ImmediateActivity()
      act1._nextActivity = act2

      // nextActivity getter uses SkipDoneActivities
      expect(act1.nextActivity).toBe(act2)
    })

    it('just-queued child optimization avoids one-frame delay', () => {
      const actor = mockActor()

      // Create a parent that queues a child during tick
      class LateChildActivity extends Activity {
        queued = false
        override tick(_self: GameActor): boolean {
          if (!this.queued) {
            this.queueChild(new ImmediateActivity())
            this.queued = true
          }
          return !!this.childActivity // Done when child done
        }
      }

      const parent = new LateChildActivity()
      parent.tickOuter(actor)

      // Child should have been ticked in the same tickOuter call
      // because of the just-queued child optimization
      expect(parent.childActivity).toBeNull() // Child completed
    })

    it('handles deeply nested child activities', () => {
      const actor = mockActor()
      const level3 = new ImmediateActivity()
      const level2 = new ParentActivity(level3)
      const level1 = new ParentActivity(level2)

      // All three should complete in one tickOuter since each completes immediately
      level1.tickOuter(actor)

      expect(level1.state).toBe(ActivityState.Done)
      expect(level2.state).toBe(ActivityState.Done)
      expect(level3.state).toBe(ActivityState.Done)
    })
  })
})
