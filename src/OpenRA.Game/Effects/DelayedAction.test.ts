/**
 * DelayedAction.test.ts — DelayedAction migration unit tests
 *
 * Tests focus on: pre-decrement delay counter, action execution via
 * frameEndTask, self-removal, edge cases.
 *
 * No Babylon.js dependencies — pure logic tests with Vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DelayedAction } from './DelayedAction.js'
import type { IGameEffect } from './IEffect.js'
import type { WorldRendererStub } from '../Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Minimal GameWorldManager stub for effect tests
// ---------------------------------------------------------------------------

class StubWorld {
  readonly frameEndTasks: Array<() => void> = []
  readonly removedEffects: IGameEffect[] = []

  addFrameEndTask(action: () => void): void {
    this.frameEndTasks.push(action)
  }

  removeEffect(effect: IGameEffect): void {
    this.removedEffects.push(effect)
  }

  drainFrameEndTasks(): void {
    while (this.frameEndTasks.length > 0) {
      const task = this.frameEndTasks.shift()!
      task()
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStubWorldRenderer(): WorldRendererStub {
  return {}
}

// ---------------------------------------------------------------------------
// DelayedAction tests
// ---------------------------------------------------------------------------

describe('DelayedAction', () => {
  let world: StubWorld

  beforeEach(() => {
    world = new StubWorld()
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores delay and action', () => {
      const action = vi.fn()
      const da = new DelayedAction(5, action)

      expect(da.remainingDelay).toBe(5)
      expect(action).not.toHaveBeenCalled()
    })

    it('accepts zero delay', () => {
      const da = new DelayedAction(0, vi.fn())
      expect(da.remainingDelay).toBe(0)
    })

    it('accepts negative delay', () => {
      const da = new DelayedAction(-1, vi.fn())
      expect(da.remainingDelay).toBe(-1)
    })
  })

  // -----------------------------------------------------------------------
  // IEffect interface compliance
  // -----------------------------------------------------------------------

  describe('IEffect interface', () => {
    it('implements IEffect (structural)', () => {
      const da = new DelayedAction(5, vi.fn())
      expect(typeof da.tick).toBe('function')
      expect(typeof da.render).toBe('function')
    })

    it('is compatible with IGameEffect', () => {
      const da: IGameEffect = new DelayedAction(5, vi.fn())
      expect(typeof da.tick).toBe('function')
    })
  })

  // -----------------------------------------------------------------------
  // Pre-decrement behavior (BLOCKER 1 — matching C# --delay <= 0)
  // -----------------------------------------------------------------------

  describe('pre-decrement (matching C# --delay <= 0)', () => {
    it('delay=5 fires on tick 5 (pre-decrement: 5→4,4→3,3→2,2→1,1→0)', () => {
      const action = vi.fn()
      const da = new DelayedAction(5, action)

      // Ticks 1-4: pre-decrement gives 4,3,2,1 — none <= 0
      da.tick(world as any) // --5 = 4
      world.drainFrameEndTasks()
      expect(action).not.toHaveBeenCalled()

      da.tick(world as any) // --4 = 3
      world.drainFrameEndTasks()
      expect(action).not.toHaveBeenCalled()

      da.tick(world as any) // --3 = 2
      world.drainFrameEndTasks()
      expect(action).not.toHaveBeenCalled()

      da.tick(world as any) // --2 = 1
      world.drainFrameEndTasks()
      expect(action).not.toHaveBeenCalled()

      // Tick 5: pre-decrement gives 0 — fires!
      da.tick(world as any) // --1 = 0
      world.drainFrameEndTasks()
      expect(action).toHaveBeenCalledTimes(1)
    })

    it('delay=1 fires on tick 1 (pre-decrement: 1→0)', () => {
      const action = vi.fn()
      const da = new DelayedAction(1, action)

      da.tick(world as any) // --1 = 0
      world.drainFrameEndTasks()
      expect(action).toHaveBeenCalledTimes(1)
    })

    it('delay=0 fires on tick 1 (pre-decrement: 0→-1)', () => {
      const action = vi.fn()
      const da = new DelayedAction(0, action)

      da.tick(world as any) // --0 = -1 <= 0
      world.drainFrameEndTasks()
      expect(action).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // tick() — action not called until frameEndTask drains
  // -----------------------------------------------------------------------

  describe('frameEndTask deferral', () => {
    it('does not execute action during tick — only after frameEndTask drain', () => {
      const action = vi.fn()
      const da = new DelayedAction(2, action)

      da.tick(world as any) // delay → 1
      da.tick(world as any) // delay → 0: schedules frameEndTask

      expect(action).not.toHaveBeenCalled()
      expect(world.frameEndTasks.length).toBe(1)

      world.drainFrameEndTasks()
      expect(action).toHaveBeenCalledTimes(1)
    })

    it('removes itself from world in the frameEndTask', () => {
      const da = new DelayedAction(1, vi.fn())

      da.tick(world as any)
      world.drainFrameEndTasks()

      expect(world.removedEffects.length).toBe(1)
      expect(world.removedEffects[0]).toBe(da)
    })
  })

  // -----------------------------------------------------------------------
  // Execution order
  // -----------------------------------------------------------------------

  describe('execution order', () => {
    it('removes effect before calling action (matches OpenRA order)', () => {
      const order: string[] = []
      const da = new DelayedAction(1, () => {
        order.push('action')
      })

      const originalRemove = world.removeEffect.bind(world)
      world.removeEffect = (effect: IGameEffect) => {
        order.push('remove')
        originalRemove(effect)
      }

      da.tick(world as any)
      world.drainFrameEndTasks()

      expect(order).toEqual(['remove', 'action'])
    })
  })

  // -----------------------------------------------------------------------
  // Post-expiration: repeats each subsequent tick (OpenRA behavior)
  // -----------------------------------------------------------------------

  describe('post-expiration behavior', () => {
    it('schedules frameEndTask on every tick after expiry (OpenRA quirk)', () => {
      const action = vi.fn()
      const da = new DelayedAction(1, action)

      da.tick(world as any) // --1 = 0: schedules
      da.tick(world as any) // --0 = -1: schedules again
      da.tick(world as any) // ---1 = -2: schedules again

      expect(world.frameEndTasks.length).toBe(3)
      world.drainFrameEndTasks()
      expect(action).toHaveBeenCalledTimes(3)
    })
  })

  // -----------------------------------------------------------------------
  // render()
  // -----------------------------------------------------------------------

  describe('render()', () => {
    it('returns an empty array (yield break equivalent)', () => {
      const da = new DelayedAction(5, vi.fn())
      const wr = createStubWorldRenderer()
      expect(da.render(wr)).toEqual([])
    })

    it('returns empty array before and after execution', () => {
      const da = new DelayedAction(1, vi.fn())
      const wr = createStubWorldRenderer()

      expect(da.render(wr)).toEqual([])

      da.tick(world as any)
      world.drainFrameEndTasks()

      expect(da.render(wr)).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // remainingDelay getter
  // -----------------------------------------------------------------------

  describe('remainingDelay', () => {
    it('reflects current delay count after each tick', () => {
      const da = new DelayedAction(3, vi.fn())
      expect(da.remainingDelay).toBe(3)
      da.tick(world as any)
      expect(da.remainingDelay).toBe(2)
      da.tick(world as any)
      expect(da.remainingDelay).toBe(1)
      da.tick(world as any)
      expect(da.remainingDelay).toBe(0)
      da.tick(world as any)
      expect(da.remainingDelay).toBe(-1)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles action that throws — effect was already removed', () => {
      const action = vi.fn(() => {
        throw new Error('test error')
      })
      const da = new DelayedAction(1, action)

      da.tick(world as any)

      expect(() => world.drainFrameEndTasks()).toThrow('test error')
      // Effect was removed before action ran (removeEffect runs first)
      expect(world.removedEffects.length).toBe(1)
    })

    it('handles very large delay values', () => {
      const da = new DelayedAction(Number.MAX_SAFE_INTEGER, vi.fn())
      expect(da.remainingDelay).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('multiple DelayedActions tick independently', () => {
      const action1 = vi.fn()
      const action2 = vi.fn()
      const da1 = new DelayedAction(3, action1)
      const da2 = new DelayedAction(1, action2)

      da1.tick(world as any) // da1: 2
      da2.tick(world as any) // da2: 0 → schedules

      expect(action1).not.toHaveBeenCalled()

      world.drainFrameEndTasks()

      expect(action2).toHaveBeenCalledTimes(1)
      expect(action1).not.toHaveBeenCalled()
      expect(da1.remainingDelay).toBe(2)
    })

    it('action that schedules another DelayedAction via frameEndTask', () => {
      const da = new DelayedAction(1, () => {
        world.addFrameEndTask(() => {
          // nested frame end task from within action
        })
      })

      da.tick(world as any)
      world.drainFrameEndTasks()
      // FrameEndTask from inside action is queued in the drain loop
      // Stub drains until empty, so nested tasks also execute
      expect(world.frameEndTasks.length).toBe(0)
    })
  })
})
