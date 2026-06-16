/**
 * Wait.test.ts — Wait + WaitFor 单元测试
 */

import { describe, it, expect } from 'vitest'
import { Wait, WaitFor } from './Wait.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

function mockSelf(): GameActor {
  return { actorId: 1, isDead: false, isInWorld: true, disposed: false } as unknown as GameActor
}

describe('Wait', () => {
  const self = mockSelf()

  it('completes immediately for 0 ticks', () => {
    expect(new Wait(0).tick(self)).toBe(true)
  })

  it('completes immediately for negative ticks', () => {
    expect(new Wait(-5).tick(self)).toBe(true)
  })

  it('returns false for remaining ticks', () => {
    const w = new Wait(3)
    expect(w.tick(self)).toBe(false) // 3→2
    expect(w.tick(self)).toBe(false) // 2→1
  })

  it('returns true on the completion tick', () => {
    const w = new Wait(3)
    w.tick(self); w.tick(self)
    expect(w.tick(self)).toBe(true) // 1→0→complete
  })

  it('returns true when cancelled (state becomes Done)', () => {
    const w = new Wait(100)
    w.cancel(self)
    expect(w.tick(self)).toBe(true)
  })

  it('is interruptible by default', () => {
    expect(new Wait(10).isInterruptible).toBe(true)
  })

  it('accepts interruptible parameter', () => {
    expect(new Wait(10, false).isInterruptible).toBe(false)
  })
})

describe('WaitFor', () => {
  const self = mockSelf()

  it('completes immediately when predicate returns true', () => {
    expect(new WaitFor(() => true).tick(self)).toBe(true)
  })

  it('stays active when predicate returns false', () => {
    expect(new WaitFor(() => false).tick(self)).toBe(false)
  })

  it('never completes with null predicate', () => {
    expect(new WaitFor(null).tick(self)).toBe(false)
  })

  it('returns true when cancelled', () => {
    const w = new WaitFor(() => false)
    w.cancel(self)
    expect(w.tick(self)).toBe(true)
  })

  it('accepts interruptible parameter', () => {
    expect(new WaitFor(() => true, false).isInterruptible).toBe(false)
  })
})
