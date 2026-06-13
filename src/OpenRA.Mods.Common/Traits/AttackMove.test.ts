/**
 * AttackMove.test.ts -- Unit tests for AttackMove (upgraded from stub)
 *
 * Tests focus on: config defaults, voicePhraseForOrder, resolveOrder,
 * AttackMoveActivity stub, info field access.
 */

import { describe, it, expect } from 'vitest'
import { AttackMove, AttackMoveInfo, AttackMoveActivity } from './AttackMove.js'

// ---------------------------------------------------------------------------
// AttackMoveInfo tests
// ---------------------------------------------------------------------------

describe('AttackMoveInfo', () => {
  it('has default voice "Action"', () => {
    const info = new AttackMoveInfo()
    expect(info.voice).toBe('Action')
  })

  it('has default moveIntoShroud true', () => {
    const info = new AttackMoveInfo()
    expect(info.moveIntoShroud).toBe(true)
  })

  it('has default targetLineColor as OrangeRed', () => {
    const info = new AttackMoveInfo()
    expect(info.targetLineColor.r).toBe(1)
    expect(info.targetLineColor.g).toBeCloseTo(0.27, 1)
    expect(info.targetLineColor.b).toBe(0)
  })

  it('has default cursors', () => {
    const info = new AttackMoveInfo()
    expect(info.attackMoveCursor).toBe('attackmove')
    expect(info.attackMoveBlockedCursor).toBe('attackmove-blocked')
    expect(info.assaultMoveCursor).toBe('assaultmove')
    expect(info.assaultMoveBlockedCursor).toBe('assaultmove-blocked')
  })

  it('accepts custom values', () => {
    const info = new AttackMoveInfo({
      voice: 'Move',
      moveIntoShroud: false,
      attackMoveCondition: 'AttackMoving',
      assaultMoveCondition: 'AssaultMoving',
      targetLineColor: { r: 0, g: 1, b: 0, a: 1 },
      attackMoveCursor: 'custom-attackmove',
    })
    expect(info.voice).toBe('Move')
    expect(info.moveIntoShroud).toBe(false)
    expect(info.attackMoveCondition).toBe('AttackMoving')
    expect(info.assaultMoveCondition).toBe('AssaultMoving')
    expect(info.targetLineColor.r).toBe(0)
    expect(info.targetLineColor.g).toBe(1)
    expect(info.attackMoveCursor).toBe('custom-attackmove')
  })

  it('condition fields default to null', () => {
    const info = new AttackMoveInfo()
    expect(info.attackMoveCondition).toBeNull()
    expect(info.assaultMoveCondition).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AttackMoveActivity tests
// ---------------------------------------------------------------------------

describe('AttackMoveActivity', () => {
  it('creates with isInterruptible true', () => {
    const activity = new AttackMoveActivity(
      {} as never,
      () => null,
      false,
    )
    expect(activity.isInterruptible).toBe(true)
  })

  it('creates with isCanceling false', () => {
    const activity = new AttackMoveActivity(
      {} as never,
      () => null,
      false,
    )
    expect(activity.isCanceling).toBe(false)
  })

  it('cancel sets isCanceling to true', () => {
    const activity = new AttackMoveActivity(
      {} as never,
      () => null,
      false,
    )
    activity.cancel()
    expect(activity.isCanceling).toBe(true)
  })

  it('tick returns true (immediate completion stub)', () => {
    const activity = new AttackMoveActivity(
      {} as never,
      () => null,
      false,
    )
    expect(activity.tick()).toBe(true)
  })

  it('queue and onActorDisposeOuter do not throw', () => {
    const activity = new AttackMoveActivity(
      {} as never,
      () => null,
      false,
    )
    expect(() => activity.queue({})).not.toThrow()
    expect(() => activity.onActorDisposeOuter()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// AttackMove trait tests
// ---------------------------------------------------------------------------

describe('AttackMove', () => {
  describe('voicePhraseForOrder', () => {
    it('returns voice for AttackMove order', () => {
      const info = new AttackMoveInfo({ voice: 'Attack' })
      const am = new AttackMove(info)
      const result = am.voicePhraseForOrder({} as never, {
        orderName: 'AttackMove',
        targetString: '',
      } as never)
      expect(result).toBe('Attack')
    })

    it('returns voice for AssaultMove order', () => {
      const info = new AttackMoveInfo({ voice: 'Assault' })
      const am = new AttackMove(info)
      const result = am.voicePhraseForOrder({} as never, {
        orderName: 'AssaultMove',
        targetString: '',
      } as never)
      expect(result).toBe('Assault')
    })

    it('returns empty string for unknown order', () => {
      const info = new AttackMoveInfo({ voice: 'Attack' })
      const am = new AttackMove(info)
      const result = am.voicePhraseForOrder({} as never, {
        orderName: 'Move',
        targetString: 'test',
      } as never)
      expect(result).toBe('')
    })

    it('returns empty string for Move order', () => {
      const info = new AttackMoveInfo({ voice: 'Attack' })
      const am = new AttackMove(info)
      const result = am.voicePhraseForOrder({} as never, {
        orderName: 'Move',
        targetString: '',
      } as never)
      expect(result).toBe('')
    })
  })

  describe('resolveOrder', () => {
    it('does not throw for AttackMove order with target', () => {
      const info = new AttackMoveInfo()
      const am = new AttackMove(info)
      const actor = {
        queueActivity: () => undefined,
        showTargetLines: () => undefined,
      }

      const order = {
        orderName: 'AttackMove',
        targetString: 'test',
        target: {
          isValidFor: () => true,
          centerPosition: { x: 0, y: 0, z: 0 },
        },
      }

      expect(() =>
        am.resolveOrder(actor as never, order as never),
      ).not.toThrow()
    })

    it('does not throw for AssaultMove order', () => {
      const info = new AttackMoveInfo()
      const am = new AttackMove(info)
      const actor = {
        queueActivity: () => undefined,
      }

      const order = {
        orderName: 'AssaultMove',
        targetString: 'test',
        target: {
          isValidFor: () => true,
          centerPosition: { x: 0, y: 0, z: 0 },
        },
      }

      expect(() =>
        am.resolveOrder(actor as never, order as never),
      ).not.toThrow()
    })

    it('ignores non-AttackMove orders', () => {
      const info = new AttackMoveInfo()
      const am = new AttackMove(info)
      let queueCalled = false

      const actor = {
        queueActivity: () => { queueCalled = true },
      }

      am.resolveOrder(actor as never, {
        orderName: 'Move',
        targetString: '',
      } as never)

      expect(queueCalled).toBe(false)
    })

    it('ignores order with no target', () => {
      const info = new AttackMoveInfo()
      const am = new AttackMove(info)
      let queueCalled = false

      const actor = {
        queueActivity: () => { queueCalled = true },
      }

      am.resolveOrder(actor as never, {
        orderName: 'AttackMove',
        targetString: '',
      } as never)

      // No target property → returns early
      expect(queueCalled).toBe(false)
    })
  })

  describe('info access', () => {
    it('exposes info property', () => {
      const info = new AttackMoveInfo({ voice: 'Test' })
      const am = new AttackMove(info)
      expect(am.info).toBe(info)
      expect(am.info.voice).toBe('Test')
    })
  })
})
