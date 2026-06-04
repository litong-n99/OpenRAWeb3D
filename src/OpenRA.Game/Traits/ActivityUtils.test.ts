/**
 * ActivityUtils.test.ts — ActivityUtils.runActivity migration unit tests
 *
 * Tests focus on:
 * - Null input handling
 * - Single activity tick (completes immediately)
 * - Blocking activity (returns same activity)
 * - Chain advancement (multiple activities in sequence)
 * - Mixed chain (some block, some complete)
 */

import { describe, it, expect } from 'vitest'
import { runActivity, type Tickable } from './ActivityUtils.js'
import type { GameActor } from '../Actor.js'

// ---------------------------------------------------------------------------
// Minimal mock GameActor
// ---------------------------------------------------------------------------

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
// Test Tickable implementations
// ---------------------------------------------------------------------------

/**
 * A Tickable that always completes (returns null from tickOuter).
 */
class CompletingActivity implements Tickable {
  name = 'Completing'
  tickOuterCalls = 0

  tickOuter(_self: GameActor): Tickable | null {
    this.tickOuterCalls++
    return null
  }
}

/**
 * A Tickable that always blocks (returns itself from tickOuter).
 */
class BlockingActivity implements Tickable {
  name = 'Blocking'
  tickOuterCalls = 0

  tickOuter(_self: GameActor): Tickable | null {
    this.tickOuterCalls++
    return this
  }
}

/**
 * A Tickable that advances to a specific next activity.
 */
class AdvancingActivity implements Tickable {
  name: string
  next: Tickable | null
  tickOuterCalls = 0

  constructor(name: string, next: Tickable | null) {
    this.name = name
    this.next = next
  }

  tickOuter(_self: GameActor): Tickable | null {
    this.tickOuterCalls++
    return this.next
  }
}

/**
 * A Tickable that completes after N ticks.
 */
class MultiTickActivity implements Tickable {
  name: string
  ticksRemaining: number
  tickOuterCalls = 0

  constructor(name: string, ticksToComplete: number) {
    this.name = name
    this.ticksRemaining = ticksToComplete
  }

  tickOuter(_self: GameActor): Tickable | null {
    this.tickOuterCalls++
    this.ticksRemaining--
    if (this.ticksRemaining <= 0) {
      return null
    }
    return this
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActivityUtils', () => {
  describe('runActivity', () => {
    it('returns null for null input', () => {
      const actor = mockActor()
      const result = runActivity(actor, null)
      expect(result).toBeNull()
    })

    it('runs completing activity once and returns null', () => {
      const actor = mockActor()
      const act = new CompletingActivity()

      const result = runActivity(actor, act)

      expect(act.tickOuterCalls).toBe(1)
      expect(result).toBeNull()
    })

    it('runs blocking activity once and returns same activity', () => {
      const actor = mockActor()
      const act = new BlockingActivity()

      const result = runActivity(actor, act)

      expect(act.tickOuterCalls).toBe(1)
      expect(result).toBe(act) // Blocked, returns itself
    })

    it('advances through chain until blocking activity', () => {
      const actor = mockActor()
      const blocker = new BlockingActivity()
      const completer2 = new AdvancingActivity('c2', blocker)
      const completer1 = new AdvancingActivity('c1', completer2)

      const result = runActivity(actor, completer1)

      // completer1 ticked once → advances to completer2
      expect(completer1.tickOuterCalls).toBe(1)
      // completer2 ticked once → advances to blocker
      expect(completer2.tickOuterCalls).toBe(1)
      // blocker ticked once → returns itself (blocks)
      expect(blocker.tickOuterCalls).toBe(1)
      // Result is the blocker (it blocked)
      expect(result).toBe(blocker)
    })

    it('advances through entire chain when all complete', () => {
      const actor = mockActor()
      const completer3 = new CompletingActivity()
      const completer2 = new AdvancingActivity('c2', completer3)
      const completer1 = new AdvancingActivity('c1', completer2)

      const result = runActivity(actor, completer1)

      // All three ticked once
      expect(completer1.tickOuterCalls).toBe(1)
      expect(completer2.tickOuterCalls).toBe(1)
      expect(completer3.tickOuterCalls).toBe(1)
      // Chain exhausted
      expect(result).toBeNull()
    })

    it('stops at first blocking activity in chain', () => {
      const actor = mockActor()
      const blocker = new BlockingActivity()
      const completer1 = new AdvancingActivity('c1', blocker)

      // Since blocker blocks, the chained activity after blocker is
      // never reached. The result is the blocker itself.

      const result = runActivity(actor, completer1)

      expect(completer1.tickOuterCalls).toBe(1)
      expect(blocker.tickOuterCalls).toBe(1)
      // completer3 should NOT be ticked because blocker blocked
      expect(result).toBe(blocker)
    })

    it('handles multi-tick activity that eventually completes', () => {
      const actor = mockActor()
      const act = new MultiTickActivity('slow', 3)

      // First call: ticks 1 time, activity blocks (remaining: 2)
      const result1 = runActivity(actor, act)
      expect(act.tickOuterCalls).toBe(1)
      expect(result1).toBe(act) // Still running

      // Second call: ticks 1 time, still blocks (remaining: 1)
      const result2 = runActivity(actor, act)
      expect(act.tickOuterCalls).toBe(2)
      expect(result2).toBe(act) // Still running

      // Third call: ticks 1 time, completes (remaining: 0)
      const result3 = runActivity(actor, act)
      expect(act.tickOuterCalls).toBe(3)
      expect(result3).toBeNull() // Complete
    })

    it('returns null immediately for an empty chain', () => {
      const actor = mockActor()
      // A completing activity that returns null
      const act = new CompletingActivity()

      const result = runActivity(actor, act)
      expect(result).toBeNull()
    })
  })
})
