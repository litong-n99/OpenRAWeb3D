/**
 * DelayedImpact.test.ts — DelayedImpact migration unit tests
 *
 * Tests focus on: position advancement, target arrival detection,
 * onImpact callback timing, isDone state, edge cases (invalid target,
 * instant arrival, zero-distance target).
 *
 * No Babylon.js dependencies — pure logic tests with Vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DelayedImpact } from './DelayedImpact.js'
import { WPos } from '../WPos.js'
import { WDist } from '../WDist.js'
import { Target } from '../Traits/Target.js'
import type { IGameEffect } from '../World.js'
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
    it('stores origin, target, speed, and onImpact', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(10240, 0, 0) // 10 cells east
      const target = Target.fromPos(targetPos)
      const speed = WDist.fromCells(2)
      const onImpact = vi.fn()

      const di = new DelayedImpact(origin, target, speed, onImpact)

      // Verify position starts at origin
      expect(WPos.equals(di.currentPosition, origin)).toBe(true)
      expect(di.speed.length).toBe(speed.length)
      expect(di.isDone).toBe(false)
      expect(onImpact).not.toHaveBeenCalled()
    })

    it('accepts WPos.Zero as origin', () => {
      const di = new DelayedImpact(WPos.Zero, Target.Invalid, WDist.Zero, vi.fn())
      expect(WPos.equals(di.currentPosition, WPos.Zero)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // IEffect interface compliance
  // -----------------------------------------------------------------------

  describe('IEffect interface', () => {
    it('implements IEffect (structural)', () => {
      const di = new DelayedImpact(
        WPos.Zero,
        Target.Invalid,
        WDist.Zero,
        vi.fn(),
      )

      expect(typeof di.tick).toBe('function')
      expect(typeof di.render).toBe('function')
      expect('isDone' in di).toBe(true)
    })

    it('is compatible with IGameEffect', () => {
      const effect: IGameEffect = new DelayedImpact(
        WPos.Zero,
        Target.Invalid,
        WDist.Zero,
        vi.fn(),
      )
      expect(typeof effect.tick).toBe('function')
    })
  })

  // -----------------------------------------------------------------------
  // Position advancement (tick)
  // -----------------------------------------------------------------------

  describe('position advancement', () => {
    it('advances position toward target each tick', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(10240, 0, 0) // 10 cells east
      const target = Target.fromPos(targetPos)
      const speed = WDist.fromCells(1) // 1 cell = 1024 units/tick

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      di.tick(world as any)
      // Should have advanced by 1024 east
      const pos1 = di.currentPosition
      expect(pos1.X).toBe(1024)
      expect(pos1.Y).toBe(0)
      expect(pos1.Z).toBe(0)

      di.tick(world as any)
      const pos2 = di.currentPosition
      expect(pos2.X).toBe(2048)
    })

    it('does NOT overshoot target — snaps exactly to target position', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(2048, 0, 0) // 2 cells east
      const target = Target.fromPos(targetPos)
      const speed = WDist.fromCells(3) // speed > distance (3 cells/tick, but only 2 cells away)

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      di.tick(world as any)

      // Should snap to target, not overshoot
      expect(WPos.equals(di.currentPosition, targetPos)).toBe(true)
    })

    it('advances correctly on diagonal trajectory', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 1024, 0) // diagonal
      const target = Target.fromPos(targetPos)
      const speed = new WDist(724) // ~sqrt(2*512^2)/2 ≈ 724 — close enough for one tick

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      di.tick(world as any)

      const pos = di.currentPosition
      // Should be approximately (512, 512, 0) — actually with rounding:
      // dirX = 1024 / 1448 ≈ 0.707
      // dirY = 1024 / 1448 ≈ 0.707
      // advanceX = round(0.707 * 724) = round(512) = 512
      // advanceY = round(0.707 * 724) = round(512) = 512
      expect(pos.X).toBeCloseTo(512, -1) // allow small rounding diff
      expect(pos.Y).toBeCloseTo(512, -1)
    })
  })

  // -----------------------------------------------------------------------
  // Impact triggering
  // -----------------------------------------------------------------------

  describe('impact triggering', () => {
    it('fires onImpact when position reaches target', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0) // 1 cell east
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048) // fast — arrives in 1 tick
      const onImpact = vi.fn()

      const di = new DelayedImpact(origin, target, speed, onImpact)

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(onImpact).toHaveBeenCalledTimes(1)
    })

    it('passes the target to onImpact callback', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048)
      const onImpact = vi.fn()

      const di = new DelayedImpact(origin, target, speed, onImpact)

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(onImpact).toHaveBeenCalledWith(target)
    })

    it('removes itself from world upon impact', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048)

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(world.removedEffects.length).toBe(1)
      expect(world.removedEffects[0]).toBe(di)
    })

    it('sets isDone = true after impact', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048)

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      expect(di.isDone).toBe(false)

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(di.isDone).toBe(true)
    })

    it('does not fire onImpact before reaching target', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(10240, 0, 0) // 10 cells away
      const target = Target.fromPos(targetPos)
      const speed = WDist.fromCells(1) // 1 cell/tick
      const onImpact = vi.fn()

      const di = new DelayedImpact(origin, target, speed, onImpact)

      // 5 ticks — halfway there
      for (let i = 0; i < 5; i++) {
        di.tick(world as any)
        world.drainFrameEndTasks()
      }

      expect(onImpact).not.toHaveBeenCalled()
      expect(di.isDone).toBe(false)
      expect(di.currentPosition.X).toBe(1024 * 5) // 5 cells east
    })

    it('fires onImpact after all ticks needed to reach target', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0) // 1 cell
      const target = Target.fromPos(targetPos)
      const speed = new WDist(256) // slow — 4 ticks to reach 1 cell
      const onImpact = vi.fn()

      const di = new DelayedImpact(origin, target, speed, onImpact)

      di.tick(world as any) // 256
      world.drainFrameEndTasks()
      expect(onImpact).not.toHaveBeenCalled()

      di.tick(world as any) // 512
      world.drainFrameEndTasks()
      expect(onImpact).not.toHaveBeenCalled()

      di.tick(world as any) // 768
      world.drainFrameEndTasks()
      expect(onImpact).not.toHaveBeenCalled()

      di.tick(world as any) // 1024 — arrived
      world.drainFrameEndTasks()
      expect(onImpact).toHaveBeenCalledTimes(1)
      expect(WPos.equals(di.currentPosition, targetPos)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Invalid target handling
  // -----------------------------------------------------------------------

  describe('invalid target handling', () => {
    it('triggers impact immediately when target is invalid', () => {
      const origin = new WPos(0, 0, 0)
      const speed = WDist.fromCells(1)
      const onImpact = vi.fn()

      const di = new DelayedImpact(origin, Target.Invalid, speed, onImpact)

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(onImpact).toHaveBeenCalledTimes(1)
      expect(di.isDone).toBe(true)
    })

    it('currentPosition stays at last position when target is invalid', () => {
      const origin = new WPos(1024, 2048, 512)
      const speed = WDist.fromCells(1)
      const onImpact = vi.fn()

      const di = new DelayedImpact(origin, Target.Invalid, speed, onImpact)

      di.tick(world as any)

      // Position should not have changed (no target to advance toward)
      expect(WPos.equals(di.currentPosition, origin)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Post-impact safety (impactTriggered guard)
  // -----------------------------------------------------------------------

  describe('post-impact safety', () => {
    it('does not fire onImpact again if ticked after impact', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048) // arrives in 1 tick
      const onImpact = vi.fn()

      const di = new DelayedImpact(origin, target, speed, onImpact)

      di.tick(world as any) // arrival, schedules
      world.drainFrameEndTasks()
      expect(onImpact).toHaveBeenCalledTimes(1)

      // Tick again after impact — should NOT fire again
      di.tick(world as any)
      world.drainFrameEndTasks()
      expect(onImpact).toHaveBeenCalledTimes(1)
      // No additional removeEffect calls
      expect(world.removedEffects.length).toBe(1)
    })

    it('does not schedule additional frameEndTasks after impact', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048)

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      di.tick(world as any) // impacts
      const taskCount = world.frameEndTasks.length

      di.tick(world as any) // guard prevents additional scheduling
      expect(world.frameEndTasks.length).toBe(taskCount) // unchanged
    })
  })

  // -----------------------------------------------------------------------
  // render()
  // -----------------------------------------------------------------------

  describe('render()', () => {
    it('returns an empty array (yield break equivalent)', () => {
      const di = new DelayedImpact(
        WPos.Zero,
        Target.Invalid,
        WDist.Zero,
        vi.fn(),
      )
      const wr = createStubWorldRenderer()

      const result = di.render(wr)
      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })

    it('returns empty array before and after impact', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048)
      const wr = createStubWorldRenderer()

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      // Before
      expect(di.render(wr)).toEqual([])

      // Execute impact
      di.tick(world as any)
      world.drainFrameEndTasks()

      // After
      expect(di.render(wr)).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // currentPosition getter
  // -----------------------------------------------------------------------

  describe('currentPosition', () => {
    it('returns a copy of the internal position (immutable by contract)', () => {
      const origin = new WPos(100, 200, 300)
      const targetPos = new WPos(1100, 200, 300)
      const target = Target.fromPos(targetPos)
      const speed = WDist.fromCells(1)

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      // WPos is immutable, so returning the same reference is fine
      const pos1 = di.currentPosition
      expect(WPos.equals(pos1, origin)).toBe(true)

      di.tick(world as any)

      const pos2 = di.currentPosition
      expect(WPos.equals(pos2, origin)).toBe(false)
      expect(pos2.X).toBeGreaterThan(origin.X)
    })
  })

  // -----------------------------------------------------------------------
  // isDone lifecycle
  // -----------------------------------------------------------------------

  describe('isDone lifecycle', () => {
    it('starts as false', () => {
      const di = new DelayedImpact(
        WPos.Zero,
        Target.Invalid,
        WDist.Zero,
        vi.fn(),
      )
      expect(di.isDone).toBe(false)
    })

    it('remains false during travel ticks', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(10240, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = WDist.fromCells(1)

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      di.tick(world as any)
      world.drainFrameEndTasks()
      expect(di.isDone).toBe(false)

      di.tick(world as any)
      world.drainFrameEndTasks()
      expect(di.isDone).toBe(false)
    })

    it('becomes true only after frameEndTask executes', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048)

      const di = new DelayedImpact(origin, target, speed, vi.fn())

      di.tick(world as any) // scheduled but not drained
      expect(di.isDone).toBe(false) // not yet

      world.drainFrameEndTasks()
      expect(di.isDone).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles zero speed (stays at origin unless at target)', () => {
      const origin = new WPos(100, 200, 0)
      const targetPos = new WPos(100, 200, 0) // same position!
      const target = Target.fromPos(targetPos)
      const speed = WDist.Zero

      const onImpact = vi.fn()
      const di = new DelayedImpact(origin, target, speed, onImpact)

      di.tick(world as any) // distance = 0, speed = 0: 0 <= 0 triggers
      world.drainFrameEndTasks()

      expect(onImpact).toHaveBeenCalledTimes(1)
      expect(WPos.equals(di.currentPosition, targetPos)).toBe(true)
    })

    it('handles zero distance to target (immediate impact)', () => {
      const pos = new WPos(512, 512, 0)
      const target = Target.fromPos(pos)
      const speed = WDist.fromCells(5)
      const onImpact = vi.fn()

      const di = new DelayedImpact(pos, target, speed, onImpact)

      di.tick(world as any) // already at target
      world.drainFrameEndTasks()

      expect(onImpact).toHaveBeenCalledTimes(1)
    })

    it('handles very fast speed (instant arrival)', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1, 0, 0) // very close
      const target = Target.fromPos(targetPos)
      const speed = WDist.MaxValue // speed >> distance

      const onImpact = vi.fn()
      const di = new DelayedImpact(origin, target, speed, onImpact)

      di.tick(world as any)
      world.drainFrameEndTasks()

      expect(onImpact).toHaveBeenCalledTimes(1)
      // Position snaps to target
      expect(WPos.equals(di.currentPosition, targetPos)).toBe(true)
    })

    it('handles negative coordinates', () => {
      const origin = new WPos(-1024, -2048, 0)
      const targetPos = new WPos(-512, -1024, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(1024) // 1 cell/tick — should arrive in ~1 tick

      const onImpact = vi.fn()
      const di = new DelayedImpact(origin, target, speed, onImpact)

      di.tick(world as any)
      world.drainFrameEndTasks()

      // Position should move toward less negative values
      // With speed 1024 and delta (512, 1024, 0), distance ≈ 1145
      // 1145 > 1024, so it doesn't arrive in 1 tick
      expect(onImpact).not.toHaveBeenCalled() // not yet

      di.tick(world as any)
      world.drainFrameEndTasks()
      expect(onImpact).toHaveBeenCalledTimes(1)
    })

    it('handles onImpact that throws', () => {
      const origin = new WPos(0, 0, 0)
      const targetPos = new WPos(1024, 0, 0)
      const target = Target.fromPos(targetPos)
      const speed = new WDist(2048)
      const onImpact = vi.fn(() => {
        throw new Error('impact error')
      })

      const di = new DelayedImpact(origin, target, speed, onImpact)

      di.tick(world as any)

      expect(() => world.drainFrameEndTasks()).toThrow('impact error')
      // Effect was removed before onImpact
      expect(world.removedEffects.length).toBe(1)
      // isDone is false because it's set after onImpact and onImpact threw
      expect(di.isDone).toBe(false)
    })

    it('multiple DelayedImpacts tick independently', () => {
      const origin1 = new WPos(0, 0, 0)
      const targetPos1 = new WPos(1024, 0, 0)
      const target1 = Target.fromPos(targetPos1)
      const speed1 = new WDist(2048) // fast: 1 tick

      const origin2 = new WPos(0, 0, 0)
      const targetPos2 = new WPos(10240, 0, 0) // 10 cells away
      const target2 = Target.fromPos(targetPos2)
      const speed2 = WDist.fromCells(1) // slow: 10 ticks

      const onImpact1 = vi.fn()
      const onImpact2 = vi.fn()

      const di1 = new DelayedImpact(origin1, target1, speed1, onImpact1)
      const di2 = new DelayedImpact(origin2, target2, speed2, onImpact2)

      // Tick both
      di1.tick(world as any)
      di2.tick(world as any)
      world.drainFrameEndTasks()

      // di1 should have arrived (1 tick at speed 2048 for 1 cell)
      // di2 should still be traveling
      expect(onImpact1).toHaveBeenCalledTimes(1)
      expect(onImpact2).not.toHaveBeenCalled()
      expect(di1.isDone).toBe(true)
      expect(di2.isDone).toBe(false)
    })
  })
})
