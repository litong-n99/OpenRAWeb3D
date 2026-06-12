/**
 * DelayedImpact.test.ts — DelayedImpact migration unit tests
 *
 * Tests focus on: pre-decrement delay counter, warhead.doImpact() via
 * frameEndTask, self-removal, edge cases.
 *
 * DelayedImpact is a SIMPLE countdown timer (matching C#), NOT a
 * position-advancing projectile.
 *
 * No Babylon.js dependencies — pure logic tests with Vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DelayedImpact } from './DelayedImpact.js'
import type { IWarhead, WarheadArgs } from '../../OpenRA.Mods.Common/Warheads/Warhead.js'
import { Target } from '../Traits/Target.js'
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

import type { WarheadEffect } from '../../OpenRA.Mods.Common/Warheads/Warhead.js'
import { WPos } from '../WPos.js'
import { WRot } from '../WRot.js'

function createStubWarhead(onImpact?: (target: Target, args: WarheadArgs) => void): IWarhead {
  return {
    delay: 0,
    loadFromJSON: vi.fn(),
    isValidAgainst: vi.fn().mockReturnValue(true),
    isValidAgainstFrozen: vi.fn().mockReturnValue(false),
    doImpact: vi.fn((_target: Target, _args: WarheadArgs): WarheadEffect[] => {
      onImpact?.(_target, _args)
      return []
    }),
  }
}

function createStubArgs(overrides: Partial<WarheadArgs> = {}): WarheadArgs {
  return {
    sourceActor: { actorId: 1, isInWorld: true, isDead: false, disposed: false },
    damageModifiers: [],
    impactOrientation: WRot.None,
    impactPosition: WPos.Zero,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// DelayedImpact tests
// ---------------------------------------------------------------------------

describe('DelayedImpact', () => {
  let world: StubWorld

  beforeEach(() => {
    world = new StubWorld()
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores delay, warhead, target, and args', () => {
      const warhead = createStubWarhead()
      const target = Target.Invalid
      const args = createStubArgs()

      const di = new DelayedImpact(5, warhead, target, args)

      expect(di.remainingDelay).toBe(5)
      expect(di.target).toBe(target)
    })

    it('accepts zero delay', () => {
      const di = new DelayedImpact(0, createStubWarhead(), Target.Invalid, createStubArgs())
      expect(di.remainingDelay).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // IEffect interface compliance
  // -----------------------------------------------------------------------

  describe('IEffect interface', () => {
    it('implements IEffect (structural)', () => {
      const di = new DelayedImpact(5, createStubWarhead(), Target.Invalid, createStubArgs())

      expect(typeof di.tick).toBe('function')
      expect(typeof di.render).toBe('function')
    })

    it('is compatible with IGameEffect', () => {
      const effect: IGameEffect = new DelayedImpact(
        5,
        createStubWarhead(),
        Target.Invalid,
        createStubArgs(),
      )
      expect(typeof effect.tick).toBe('function')
    })
  })

  // -----------------------------------------------------------------------
  // Pre-decrement behavior (BLOCKER 2 — matching C# --delay <= 0)
  // -----------------------------------------------------------------------

  describe('pre-decrement (matching C# --delay <= 0)', () => {
    it('delay=5 fires on tick 5 (pre-decrement: 5→4,4→3,3→2,2→1,1→0)', () => {
      const warhead = createStubWarhead()
      const target = Target.Invalid
      const args = createStubArgs()
      const di = new DelayedImpact(5, warhead, target, args)

      // Ticks 1-4: pre-decrement gives 4,3,2,1 — none <= 0
      di.tick(world as any) // --5 = 4
      world.drainFrameEndTasks()
      expect(warhead.doImpact).not.toHaveBeenCalled()

      di.tick(world as any) // --4 = 3
      world.drainFrameEndTasks()
      expect(warhead.doImpact).not.toHaveBeenCalled()

      di.tick(world as any) // --3 = 2
      world.drainFrameEndTasks()
      expect(warhead.doImpact).not.toHaveBeenCalled()

      di.tick(world as any) // --2 = 1
      world.drainFrameEndTasks()
      expect(warhead.doImpact).not.toHaveBeenCalled()

      // Tick 5: pre-decrement gives 0 — fires!
      di.tick(world as any) // --1 = 0
      world.drainFrameEndTasks()
      expect(warhead.doImpact).toHaveBeenCalledTimes(1)
    })

    it('delay=1 fires on tick 1 (pre-decrement: 1→0)', () => {
      const warhead = createStubWarhead()
      const di = new DelayedImpact(1, warhead, Target.Invalid, createStubArgs())

      di.tick(world as any) // --1 = 0
      world.drainFrameEndTasks()
      expect(warhead.doImpact).toHaveBeenCalledTimes(1)
    })

    it('delay=0 fires on tick 1 (pre-decrement: 0→-1)', () => {
      const warhead = createStubWarhead()
      const di = new DelayedImpact(0, warhead, Target.Invalid, createStubArgs())

      di.tick(world as any) // --0 = -1 <= 0
      world.drainFrameEndTasks()
      expect(warhead.doImpact).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // doImpact called with correct arguments
  // -----------------------------------------------------------------------

  describe('doImpact arguments', () => {
    it('passes target and args to warhead.doImpact()', () => {
      const warhead = createStubWarhead()
      const target = Target.Invalid
      const args = createStubArgs()

      const di = new DelayedImpact(1, warhead, target, args)

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(warhead.doImpact).toHaveBeenCalledWith(target, args)
    })
  })

  // -----------------------------------------------------------------------
  // Self-removal via frameEndTask
  // -----------------------------------------------------------------------

  describe('self-removal', () => {
    it('removes itself from world in the frameEndTask', () => {
      const di = new DelayedImpact(1, createStubWarhead(), Target.Invalid, createStubArgs())

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(world.removedEffects.length).toBe(1)
      expect(world.removedEffects[0]).toBe(di)
    })

    it('removes effect BEFORE calling doImpact (matches OpenRA order)', () => {
      const order: string[] = []
      const warhead: IWarhead = {
        delay: 0,
        loadFromJSON: vi.fn(),
        isValidAgainst: vi.fn().mockReturnValue(true),
        isValidAgainstFrozen: vi.fn().mockReturnValue(false),
        doImpact: vi.fn((): WarheadEffect[] => {
          order.push('doImpact')
          return []
        }),
      }

      const originalRemove = world.removeEffect.bind(world)
      world.removeEffect = (effect: IGameEffect) => {
        order.push('remove')
        originalRemove(effect)
      }

      const di = new DelayedImpact(1, warhead, Target.Invalid, createStubArgs())

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(order).toEqual(['remove', 'doImpact'])
    })
  })

  // -----------------------------------------------------------------------
  // Post-expiration: repeats each subsequent tick (OpenRA behavior)
  // -----------------------------------------------------------------------

  describe('post-expiration behavior', () => {
    it('schedules frameEndTask on every tick after expiry (OpenRA quirk)', () => {
      const warhead = createStubWarhead()
      const di = new DelayedImpact(1, warhead, Target.Invalid, createStubArgs())

      di.tick(world as any) // --1 = 0: schedules
      di.tick(world as any) // --0 = -1: schedules again
      di.tick(world as any) // ---1 = -2: schedules again

      expect(world.frameEndTasks.length).toBe(3)
      world.drainFrameEndTasks()
      expect(warhead.doImpact).toHaveBeenCalledTimes(3)
    })
  })

  // -----------------------------------------------------------------------
  // render()
  // -----------------------------------------------------------------------

  describe('render()', () => {
    it('returns an empty array (yield break equivalent)', () => {
      const di = new DelayedImpact(5, createStubWarhead(), Target.Invalid, createStubArgs())
      const wr = createStubWorldRenderer()
      expect(di.render(wr)).toEqual([])
    })

    it('returns empty array before and after execution', () => {
      const di = new DelayedImpact(1, createStubWarhead(), Target.Invalid, createStubArgs())
      const wr = createStubWorldRenderer()

      expect(di.render(wr)).toEqual([])

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(di.render(wr)).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // remainingDelay getter
  // -----------------------------------------------------------------------

  describe('remainingDelay', () => {
    it('reflects current delay count after each tick', () => {
      const di = new DelayedImpact(3, createStubWarhead(), Target.Invalid, createStubArgs())
      expect(di.remainingDelay).toBe(3)
      di.tick(world as any)
      expect(di.remainingDelay).toBe(2)
      di.tick(world as any)
      expect(di.remainingDelay).toBe(1)
      di.tick(world as any)
      expect(di.remainingDelay).toBe(0)
      di.tick(world as any)
      expect(di.remainingDelay).toBe(-1)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles doImpact that throws — effect was already removed', () => {
      const warhead: IWarhead = {
        delay: 0,
        loadFromJSON: vi.fn(),
        isValidAgainst: vi.fn().mockReturnValue(true),
        isValidAgainstFrozen: vi.fn().mockReturnValue(false),
        doImpact: vi.fn((): WarheadEffect[] => {
          throw new Error('impact error')
        }),
      }
      const di = new DelayedImpact(1, warhead, Target.Invalid, createStubArgs())

      di.tick(world as any)

      expect(() => world.drainFrameEndTasks()).toThrow('impact error')
      // Effect was removed before doImpact ran
      expect(world.removedEffects.length).toBe(1)
    })

    it('handles very large delay values', () => {
      const di = new DelayedImpact(
        Number.MAX_SAFE_INTEGER,
        createStubWarhead(),
        Target.Invalid,
        createStubArgs(),
      )
      expect(di.remainingDelay).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('multiple DelayedImpacts tick independently', () => {
      const w1 = createStubWarhead()
      const w2 = createStubWarhead()
      const di1 = new DelayedImpact(3, w1, Target.Invalid, createStubArgs())
      const di2 = new DelayedImpact(1, w2, Target.Invalid, createStubArgs())

      di1.tick(world as any) // di1: 2
      di2.tick(world as any) // di2: 0 → schedules

      expect(w1.doImpact).not.toHaveBeenCalled()

      world.drainFrameEndTasks()

      expect(w2.doImpact).toHaveBeenCalledTimes(1)
      expect(w1.doImpact).not.toHaveBeenCalled()
      expect(di1.remainingDelay).toBe(2)
    })

    it('IWarhead and WarheadArgs stubs are usable', () => {
      const captured: { target: Target | null; args: WarheadArgs | null } = {
        target: null,
        args: null,
      }
      const warhead: IWarhead = {
        delay: 0,
        loadFromJSON: vi.fn(),
        isValidAgainst: vi.fn().mockReturnValue(true),
        isValidAgainstFrozen: vi.fn().mockReturnValue(false),
        doImpact(target: Target, args: WarheadArgs): WarheadEffect[] {
          captured.target = target
          captured.args = args
          return []
        },
      }
      const target = Target.Invalid
      const args = createStubArgs()

      const di = new DelayedImpact(1, warhead, target, args)
      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(captured.target).toBe(target)
      expect(captured.args).toBe(args)
    })
  })
})
