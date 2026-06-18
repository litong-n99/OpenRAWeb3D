/**
 * CallScriptFunc.test.ts — Unit tests for CallScriptFunc activity
 *
 * Tests focus on: construction, tick execution, single-tick guarantee,
 * cancel before/after tick, fatal error handling, and edge cases.
 * No WebGL or Babylon.js dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { CallScriptFunc } from './CallScriptFunc.js'
import type { IScriptContext } from '../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// Mock Activity base class
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Activities/Activity.js', () => ({
  Activity: class {
    state = 0
    isInterruptible = true
    childHasPriority = true
    cancel(..._args: unknown[]) {}
  },
}))

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function stubContext(): IScriptContext {
  return {
    world: {} as never,
    worldRenderer: {} as never,
    fatalErrorOccurred: false,
    errorMessage: null,
    getActorCommands: vi.fn().mockReturnValue([]),
    playerCommands: [],
    registerMapActor: vi.fn(),
    fatalError: vi.fn(),
    logDebug: () => {},
    get namedActors() { return new Map() },
  }
}

function stubSelf(): GameActor {
  return {
    actorId: 1,
    isInWorld: true,
  } as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CallScriptFunc', () => {
  let context: IScriptContext

  beforeEach(() => {
    context = stubContext()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('creates with a function and context', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      expect(activity).toBeDefined()
    })

    it('throws when fn is null', () => {
      expect(() => new CallScriptFunc(null as unknown as (c: IScriptContext) => void, context)).toThrow(
        'fn must not be null',
      )
    })

    it('does not call fn during construction', () => {
      const fn = vi.fn()
      new CallScriptFunc(fn, context)
      expect(fn).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('calls the function with context', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      const self = stubSelf()
      activity.tick(self)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('returns true (activity complete)', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      const result = activity.tick(stubSelf())
      expect(result).toBe(true)
    })

    it('does not call fn twice on second tick', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      const self = stubSelf()
      activity.tick(self)
      activity.tick(self)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('returns true on second tick (already completed)', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      const self = stubSelf()
      activity.tick(self)
      const result = activity.tick(self)
      expect(result).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Fatal error handling
  // -----------------------------------------------------------------------

  describe('fatal error', () => {
    it('calls context.fatalError when fn throws', () => {
      const error = new Error('script error')
      const fn = vi.fn().mockImplementation(() => { throw error })
      const activity = new CallScriptFunc(fn, context)
      activity.tick(stubSelf())
      expect(context.fatalError).toHaveBeenCalledWith(error)
    })

    it('completes even when fn throws', () => {
      const fn = vi.fn().mockImplementation(() => { throw new Error('fail') })
      const activity = new CallScriptFunc(fn, context)
      const result = activity.tick(stubSelf())
      expect(result).toBe(true)
    })

    it('releases fn reference after fatal error', () => {
      const fn = vi.fn().mockImplementation(() => { throw new Error('fail') })
      const activity = new CallScriptFunc(fn, context)
      activity.tick(stubSelf())
      // Second tick should not call fn again
      fn.mockClear()
      activity.tick(stubSelf())
      expect(fn).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  describe('cancel', () => {
    it('releases fn reference so tick is no-op', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      activity.cancel(stubSelf())
      activity.tick(stubSelf())
      expect(fn).not.toHaveBeenCalled()
    })

    it('cancel after tick is safe (fn already nulled)', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      activity.tick(stubSelf())
      expect(() => activity.cancel(stubSelf())).not.toThrow()
    })

    it('double cancel is safe', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      activity.cancel(stubSelf())
      expect(() => activity.cancel(stubSelf())).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles function that returns undefined', () => {
      const fn = vi.fn().mockReturnValue(undefined)
      const activity = new CallScriptFunc(fn, context)
      expect(() => activity.tick(stubSelf())).not.toThrow()
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('handles empty function', () => {
      const fn = vi.fn()
      const activity = new CallScriptFunc(fn, context)
      const result = activity.tick(stubSelf())
      expect(result).toBe(true)
    })
  })
})
