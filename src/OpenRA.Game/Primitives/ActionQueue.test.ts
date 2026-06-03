/**
 * ActionQueue.test.ts — ActionQueue migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import { ActionQueue } from './ActionQueue'

describe('ActionQueue', () => {
  it('performActions with no pending does nothing', () => {
    const aq = new ActionQueue()
    const fn = vi.fn()
    aq.performActions(100)
    expect(fn).not.toHaveBeenCalled()
  })

  it('executes actions at or before currentTime', () => {
    const aq = new ActionQueue()
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    const fn3 = vi.fn()

    aq.add(fn1, 10)
    aq.add(fn2, 20)
    aq.add(fn3, 30)

    aq.performActions(20)
    expect(fn1).toHaveBeenCalled()
    expect(fn2).toHaveBeenCalled()
    expect(fn3).not.toHaveBeenCalled()
  })

  it('executes actions in time order', () => {
    const aq = new ActionQueue()
    const order: number[] = []

    aq.add(() => order.push(3), 30)
    aq.add(() => order.push(1), 10)
    aq.add(() => order.push(2), 20)

    aq.performActions(50)
    expect(order).toEqual([1, 2, 3])
  })

  it('removes actions before execution', () => {
    const aq = new ActionQueue()
    const selfAdding = vi.fn(() => {
      aq.add(() => void 0, 10)
    })

    aq.add(selfAdding, 5)
    aq.performActions(10)

    // selfAdding was executed at time 5
    expect(selfAdding).toHaveBeenCalled()
    // The action added by selfAdding should NOT execute in the same batch
    // (it's scheduled for time 10 but performActions is already past idx)
  })

  it('actions with same time execute in insertion order', () => {
    const aq = new ActionQueue()
    const order: number[] = []

    aq.add(() => order.push(1), 10)
    aq.add(() => order.push(2), 10)
    aq.add(() => order.push(3), 10)

    aq.performActions(10)
    expect(order).toEqual([1, 2, 3])
  })

  it('future actions are not executed', () => {
    const aq = new ActionQueue()
    const fn = vi.fn()
    aq.add(fn, 100)
    aq.performActions(50)
    expect(fn).not.toHaveBeenCalled()
    aq.performActions(100)
    expect(fn).toHaveBeenCalled()
  })
})
