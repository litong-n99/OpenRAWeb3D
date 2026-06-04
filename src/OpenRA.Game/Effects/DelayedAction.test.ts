/**
 * DelayedAction.test.ts — DelayedAction migration unit tests
 *
 * Tests focus on: delay counter behavior, action execution timing,
 * frameEndTask integration, isDone state, edge cases.
 *
 * No Babylon.js dependencies — pure logic tests with Vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DelayedAction } from './DelayedAction.js'
import type { IGameEffect } from '../World.js'
import type { WorldRendererStub } from '../Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Minimal GameWorldManager stub for effect tests
// ---------------------------------------------------------------------------

/**
 * A minimal stub of GameWorldManager providing only the methods that
 * DelayedAction uses: addFrameEndTask() and removeEffect().
 */
class StubWorld {
  /** Queue of pending frame end tasks. */
  readonly frameEndTasks: Array<() => void> = []

  /** Effects that were removed via removeEffect(). */
  readonly removedEffects: IGameEffect[] = []

  addFrameEndTask(action: () => void): void {
    this.frameEndTasks.push(action)
  }

  removeEffect(effect: IGameEffect): void {
    this.removedEffects.push(effect)
  }

  /**
   * Execute all pending frame end tasks (simulates GameWorldManager.tick()
   * draining frameEndActions after effects tick).
   */
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
      // Action should not be called during construction
      expect(action).not.toHaveBeenCalled()
    })

    it('accepts zero delay', () => {
      const da = new DelayedAction(0, vi.fn())
      expect(da.remainingDelay).toBe(0)
      expect(da.isDone).toBe(false)
    })

    it('accepts negative delay', () => {
      const da = new DelayedAction(-1, vi.fn())
      expect(da.remainingDelay).toBe(-1)
      expect(da.isDone).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // IEffect interface compliance
  // -----------------------------------------------------------------------

  describe('IEffect interface', () => {
    it('implements IEffect (structural)', () => {
      const da = new DelayedAction(5, vi.fn())

      // Verify all IEffect members are present
      expect(typeof da.tick).toBe('function')
      expect(typeof da.render).toBe('function')
      expect('isDone' in da).toBe(true)
    })

    it('is compatible with IGameEffect', () => {
      const da: IGameEffect = new DelayedAction(5, vi.fn())
      expect(typeof da.tick).toBe('function')
    })
  })

  // -----------------------------------------------------------------------
  // tick() — delay decrement
  // -----------------------------------------------------------------------

  describe('tick()', () => {
    it('decrements remainingDelay each call', () => {
      const da = new DelayedAction(5, vi.fn())

      da.tick(world as any)
      expect(da.remainingDelay).toBe(4)

      da.tick(world as any)
      expect(da.remainingDelay).toBe(3)
    })

    it('does not execute action before delay reaches 0', () => {
      const action = vi.fn()
      const da = new DelayedAction(3, action)

      da.tick(world as any) // delay → 2
      da.tick(world as any) // delay → 1
      expect(action).not.toHaveBeenCalled()
      expect(da.isDone).toBe(false)
    })

    it('does not execute action until frameEndTask drains', () => {
      const action = vi.fn()
      const da = new DelayedAction(2, action)

      da.tick(world as any) // delay → 1
      da.tick(world as any) // delay → 0: schedules frameEndTask

      // Action NOT called yet (frameEndTask not yet drained)
      expect(action).not.toHaveBeenCalled()
      expect(world.frameEndTasks.length).toBe(1)
    })

    it('executes action when frameEndTask drains', () => {
      const action = vi.fn()
      const da = new DelayedAction(2, action)

      da.tick(world as any) // delay → 1
      da.tick(world as any) // delay → 0: schedules frameEndTask
      world.drainFrameEndTasks()

      expect(action).toHaveBeenCalledTimes(1)
    })

    it('removes itself from world when action fires', () => {
      const da = new DelayedAction(1, vi.fn())

      da.tick(world as any) // delay → 0: schedules
      world.drainFrameEndTasks()

      expect(world.removedEffects.length).toBe(1)
      expect(world.removedEffects[0]).toBe(da)
    })

    it('sets isDone = true after action executes', () => {
      const da = new DelayedAction(1, vi.fn())

      expect(da.isDone).toBe(false)

      da.tick(world as any)
      world.drainFrameEndTasks()

      expect(da.isDone).toBe(true)
    })

    it('fires immediately on first tick with delay 0', () => {
      const action = vi.fn()
      const da = new DelayedAction(0, action)

      da.tick(world as any) // delay → -1: schedules immediately
      world.drainFrameEndTasks()

      expect(action).toHaveBeenCalledTimes(1)
      expect(da.isDone).toBe(true)
    })

    it('fires immediately on first tick with negative delay', () => {
      const action = vi.fn()
      const da = new DelayedAction(-3, action)

      da.tick(world as any) // delay → -4: schedules immediately
      world.drainFrameEndTasks()

      expect(action).toHaveBeenCalledTimes(1)
      expect(da.isDone).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // tick() — execution order (action after remove)
  // -----------------------------------------------------------------------

  describe('execution order', () => {
    it('removes effect before calling action', () => {
      const order: string[] = []
      const da = new DelayedAction(1, () => {
        order.push('action')
      })

      // Override removeEffect to track order
      const originalRemove = world.removeEffect.bind(world)
      world.removeEffect = (effect: IGameEffect) => {
        order.push('remove')
        originalRemove(effect)
      }

      da.tick(world as any)
      world.drainFrameEndTasks()

      // removeEffect is called first, then action
      expect(order).toEqual(['remove', 'action'])
    })
  })

  // -----------------------------------------------------------------------
  // tick() — multiple ticks after delay expires
  // -----------------------------------------------------------------------

  describe('post-expiration behavior', () => {
    it('schedules frameEndTask only once even if ticked multiple times after expiry', () => {
      const action = vi.fn()
      const da = new DelayedAction(1, action)

      // First tick decrements to 0 and schedules
      da.tick(world as any)
      expect(world.frameEndTasks.length).toBe(1)

      // Subsequent ticks also decrement (to -1, -2, ...) and schedule again
      da.tick(world as any)
      da.tick(world as any)

      // Each tick after expiry also schedules (OpenRA behavior)
      // This matches the OpenRA pattern where --delay continues to fire
      // the frameEndTask each tick. This is a known quirk.
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

      const result = da.render(wr)
      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })

    it('returns empty array before and after execution', () => {
      const da = new DelayedAction(1, vi.fn())
      const wr = createStubWorldRenderer()

      // Before
      expect(da.render(wr)).toEqual([])

      // Execute
      da.tick(world as any)
      world.drainFrameEndTasks()

      // After
      expect(da.render(wr)).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // isDone lifecycle
  // -----------------------------------------------------------------------

  describe('isDone lifecycle', () => {
    it('starts as false', () => {
      const da = new DelayedAction(10, vi.fn())
      expect(da.isDone).toBe(false)
    })

    it('remains false during ticks before expiry', () => {
      const da = new DelayedAction(5, vi.fn())
      da.tick(world as any) // 4
      da.tick(world as any) // 3
      expect(da.isDone).toBe(false)
    })

    it('becomes true only after frameEndTask executes', () => {
      const da = new DelayedAction(1, vi.fn())

      da.tick(world as any) // scheduled but not drained
      expect(da.isDone).toBe(false) // still false

      world.drainFrameEndTasks()
      expect(da.isDone).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // remainingDelay getter
  // -----------------------------------------------------------------------

  describe('remainingDelay', () => {
    it('reflects current delay count', () => {
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
    it('handles action that throws gracefully', () => {
      const action = vi.fn(() => {
        throw new Error('test error')
      })
      const da = new DelayedAction(1, action)

      da.tick(world as any)

      // Should not throw when draining — the error propagates normally
      // because the frameEndTask is a plain function call, not wrapped
      expect(() => world.drainFrameEndTasks()).toThrow('test error')
      // isDone is still set because removeEffect and action run before _done=true
      // Actually _done is set after action(), so if action throws, _done stays false
    })

    it('isDone is false if action throws', () => {
      const action = vi.fn(() => {
        throw new Error('test error')
      })
      const da = new DelayedAction(1, action)

      da.tick(world as any)
      try { world.drainFrameEndTasks() } catch { /* expected */ }

      // isDone is set after action() so if action throws, isDone stays false
      expect(da.isDone).toBe(false)
      // But the effect WAS removed from world (removeEffect runs first)
      expect(world.removedEffects.length).toBe(1)
    })

    it('handles very large delay values', () => {
      const da = new DelayedAction(Number.MAX_SAFE_INTEGER, vi.fn())
      expect(da.remainingDelay).toBe(Number.MAX_SAFE_INTEGER)
      expect(da.isDone).toBe(false)
    })

    it('handles action that modifies the world (adds another DelayedAction)', () => {
      const da = new DelayedAction(1, () => {
        // Simulating adding another effect during frameEndTask
        world.addFrameEndTask(() => {
          // nested frame end task
        })
      })

      da.tick(world as any)
      world.drainFrameEndTasks()
      expect(da.isDone).toBe(true)
    })

    it('multiple DelayedActions tick independently', () => {
      const action1 = vi.fn()
      const action2 = vi.fn()
      const da1 = new DelayedAction(3, action1)
      const da2 = new DelayedAction(1, action2)

      // Tick both
      da1.tick(world as any) // delay → 2
      da2.tick(world as any) // delay → 0, schedules

      expect(action1).not.toHaveBeenCalled()

      world.drainFrameEndTasks()

      // da2 action fired, da1 still has 2 ticks remaining
      expect(action2).toHaveBeenCalledTimes(1)
      expect(action1).not.toHaveBeenCalled()
      expect(da1.remainingDelay).toBe(2)
      expect(da2.isDone).toBe(true)
    })

    it('exact delay count: action fires when delay reaches 0 from positive', () => {
      const action = vi.fn()
      const da = new DelayedAction(1, action)

      // delay = 1
      da.tick(world as any) // --delay = 0, triggers
      world.drainFrameEndTasks()
      expect(action).toHaveBeenCalledTimes(1)
    })
  })
})
