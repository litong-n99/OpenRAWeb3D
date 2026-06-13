/**
 * EntersTunnels.test.ts -- EntersTunnels unit tests
 *
 * Tests focus on: order targeter behavior, order issuance, order resolution,
 * voice phrase generation, condition variable observation, force-move logic.
 */

import { describe, it, expect, vi } from 'vitest'
import { EntersTunnels, EntersTunnelsInfo, EnterTunnelOrderTargeter } from './EntersTunnels'
import { TunnelEntrance, TunnelEntranceInfo } from './TunnelEntrance'
import { CPos } from '../../OpenRA.Game/CPos'
import { TargetModifiers } from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _makeActor(overrides: Record<string, unknown> = {}) {
  const traits = new Map<string, unknown[]>()
  if (overrides['trait'] !== undefined) {
    traits.set((overrides['traitName'] as string) ?? 'TunnelEntrance', [(overrides['trait'] as unknown)])
  }
  if (overrides['traitMap'] !== undefined) {
    for (const [key, value] of Object.entries(overrides['traitMap'] as Record<string, unknown[]>)) {
      traits.set(key, value)
    }
  }

  return {
    actorId: (overrides['actorId'] as number) ?? 1,
    isInWorld: true,
    isDead: (overrides['isDead'] as boolean) ?? false,
    disposed: false,
    _traits: traits,
    location: overrides['location'] as CPos | undefined,
    queueActivity: vi.fn(),
    cancelActivity: vi.fn(),
    info: overrides['info'] as Record<string, unknown> | undefined,
  } as unknown as Parameters<EntersTunnels['resolveOrder']>[0]
}

function createEntersTunnels(params: {
  enterCursor?: string
  enterBlockedCursor?: string
  voice?: string
  requireForceMoveCondition?: string | null
} = {}): EntersTunnels {
  return new EntersTunnels(new EntersTunnelsInfo(params))
}

// ---------------------------------------------------------------------------
// EntersTunnelsInfo
// ---------------------------------------------------------------------------

describe('EntersTunnelsInfo', () => {
  it('has sensible defaults', () => {
    const info = new EntersTunnelsInfo()
    expect(info.enterCursor).toBe('enter')
    expect(info.enterBlockedCursor).toBe('enter-blocked')
    expect(info.voice).toBe('Action')
    expect(info.targetLineColor).toEqual({ r: 0, g: 1, b: 0, a: 1 })
    expect(info.requireForceMoveCondition).toBeNull()
  })

  it('accepts custom parameters', () => {
    const info = new EntersTunnelsInfo({
      enterCursor: 'tunnel-enter',
      enterBlockedCursor: 'tunnel-blocked',
      voice: 'Move',
      targetLineColor: { r: 1, g: 0, b: 0, a: 1 },
      requireForceMoveCondition: 'deployed',
    })
    expect(info.enterCursor).toBe('tunnel-enter')
    expect(info.enterBlockedCursor).toBe('tunnel-blocked')
    expect(info.voice).toBe('Move')
    expect(info.requireForceMoveCondition).toBe('deployed')
  })
})

// ---------------------------------------------------------------------------
// EnterTunnelOrderTargeter
// ---------------------------------------------------------------------------

describe('EnterTunnelOrderTargeter', () => {
  function createTargeter(
    canTarget?: (target: ReturnType<typeof _makeActor>, modifiers: TargetModifiers) => boolean,
    useEnterCursor?: (target: ReturnType<typeof _makeActor>) => boolean,
  ): EnterTunnelOrderTargeter {
    return new EnterTunnelOrderTargeter(
      'enter',
      'enter-blocked',
      canTarget ?? (() => true),
      useEnterCursor ?? (() => true),
    )
  }

  it('has orderID "EnterTunnel"', () => {
    const targeter = createTargeter()
    expect(targeter.orderID).toBe('EnterTunnel')
  })

  it('has orderPriority 6', () => {
    const targeter = createTargeter()
    expect(targeter.orderPriority).toBe(6)
  })

  it('isQueued reflects ForceQueue modifier', () => {
    const targeter = createTargeter()
    const selfActor = _makeActor()
    const targetStub = { actor: _makeActor() }

    // Call canTarget to update isQueued
    targeter.canTarget(selfActor, targetStub as unknown as Parameters<typeof targeter.canTarget>[1], TargetModifiers.ForceQueue, '')
    expect(targeter.isQueued).toBe(true)

    targeter.canTarget(selfActor, targetStub as unknown as Parameters<typeof targeter.canTarget>[1], TargetModifiers.None, '')
    expect(targeter.isQueued).toBe(false)
  })

  it('canTarget returns false for dead actors', () => {
    const targeter = createTargeter()
    const selfActor = _makeActor()
    const deadTarget = { actor: _makeActor({ isDead: true }) }

    const result = targeter.canTarget(
      selfActor,
      deadTarget as unknown as Parameters<typeof targeter.canTarget>[1],
      TargetModifiers.None,
      '',
    )
    expect(result).toBe(false)
  })

  it('canTargetActor returns false when canTarget callback rejects', () => {
    const targeter = createTargeter(() => false)
    const selfActor = _makeActor()
    const target = _makeActor({
      trait: new TunnelEntrance(new TunnelEntranceInfo()),
      traitName: 'TunnelEntrance',
    })

    const cursorRef = { ref: 'default' }
    const result = targeter.canTargetActor(selfActor, target, TargetModifiers.None, cursorRef)
    expect(result).toBe(false)
  })

  it('canTargetActor returns false when no TunnelEntrance trait', () => {
    const targeter = createTargeter()
    const selfActor = _makeActor()
    const target = _makeActor()

    const cursorRef = { ref: 'default' }
    const result = targeter.canTargetActor(selfActor, target, TargetModifiers.None, cursorRef)
    expect(result).toBe(false)
  })

  it('canTargetActor returns false when tunnel exit is null', () => {
    const tunnelEntrance = new TunnelEntrance(new TunnelEntranceInfo())
    tunnelEntrance.exit = null // No exit

    const targeter = createTargeter()
    const selfActor = _makeActor()
    const target = _makeActor({
      trait: tunnelEntrance,
      traitName: 'TunnelEntrance',
    })

    const cursorRef = { ref: 'default' }
    const result = targeter.canTargetActor(selfActor, target, TargetModifiers.None, cursorRef)
    expect(result).toBe(false)
    expect(cursorRef.ref).toBe('enter-blocked')
  })

  it('canTargetActor returns true with enter cursor when tunnel exit exists', () => {
    const tunnelEntrance = new TunnelEntrance(new TunnelEntranceInfo())
    tunnelEntrance.exit = new CPos(5, 5)

    const targeter = createTargeter()
    const selfActor = _makeActor()
    const target = _makeActor({
      trait: tunnelEntrance,
      traitName: 'TunnelEntrance',
    })

    const cursorRef = { ref: 'default' }
    const result = targeter.canTargetActor(selfActor, target, TargetModifiers.None, cursorRef)
    expect(result).toBe(true)
    expect(cursorRef.ref).toBe('enter')
  })

  it('canTargetActor uses enterBlockedCursor when useEnterCursor returns false', () => {
    const tunnelEntrance = new TunnelEntrance(new TunnelEntranceInfo())
    tunnelEntrance.exit = new CPos(5, 5)

    const targeter = createTargeter(undefined, () => false)
    const selfActor = _makeActor()
    const target = _makeActor({
      trait: tunnelEntrance,
      traitName: 'TunnelEntrance',
    })

    const cursorRef = { ref: 'default' }
    const result = targeter.canTargetActor(selfActor, target, TargetModifiers.None, cursorRef)
    expect(result).toBe(true)
    expect(cursorRef.ref).toBe('enter-blocked')
  })
})

// ---------------------------------------------------------------------------
// EntersTunnels
// ---------------------------------------------------------------------------

describe('EntersTunnels', () => {
  describe('orders', () => {
    it('returns array with one EnterTunnelOrderTargeter', () => {
      const entersTunnels = createEntersTunnels()
      const orders = entersTunnels.orders
      expect(orders.length).toBe(1)
      expect(orders[0].orderID).toBe('EnterTunnel')
    })

    it('returns fresh targeters each time', () => {
      const entersTunnels = createEntersTunnels()
      const orders1 = entersTunnels.orders
      const orders2 = entersTunnels.orders
      expect(orders1[0]).not.toBe(orders2[0])
    })
  })

  describe('issueOrder', () => {
    it('returns null for non-EnterTunnel orders', () => {
      const entersTunnels = createEntersTunnels()
      const selfActor = _makeActor()
      const fakeOrder = { orderID: 'Attack', orderPriority: 3, isQueued: false } as unknown as Parameters<EntersTunnels['issueOrder']>[1]

      const result = entersTunnels.issueOrder(
        selfActor,
        fakeOrder,
        {} as Parameters<EntersTunnels['issueOrder']>[2],
        false,
      )
      expect(result).toBeNull()
    })
  })

  describe('voicePhraseForOrder', () => {
    it('returns voice for EnterTunnel orders', () => {
      const entersTunnels = createEntersTunnels({ voice: 'Move' })
      const selfActor = _makeActor()
      const order = { orderName: 'EnterTunnel', targetString: '', extraData: {} }

      const voice = entersTunnels.voicePhraseForOrder(
        selfActor,
        order as unknown as Parameters<EntersTunnels['voicePhraseForOrder']>[1],
      )
      expect(voice).toBe('Move')
    })

    it('returns empty string for other orders', () => {
      const entersTunnels = createEntersTunnels({ voice: 'Move' })
      const selfActor = _makeActor()
      const order = { orderName: 'Attack', targetString: '', extraData: {} }

      const voice = entersTunnels.voicePhraseForOrder(
        selfActor,
        order as unknown as Parameters<EntersTunnels['voicePhraseForOrder']>[1],
      )
      expect(voice).toBe('')
    })
  })

  describe('resolveOrder', () => {
    it('ignores non-EnterTunnel orders', () => {
      const entersTunnels = createEntersTunnels()
      const selfActor = _makeActor()

      const order = {
        orderName: 'Attack',
        targetString: '',
        extraData: {},
      }

      expect(() => {
        entersTunnels.resolveOrder(
          selfActor,
          order as unknown as Parameters<EntersTunnels['resolveOrder']>[1],
        )
      }).not.toThrow()
    })

    it('ignores orders without valid target type', () => {
      const entersTunnels = createEntersTunnels()
      const selfActor = _makeActor()

      const order = {
        orderName: 'EnterTunnel',
        targetString: '',
        extraData: { target: { type: 0 } }, // Invalid type
      }

      expect(() => {
        entersTunnels.resolveOrder(
          selfActor,
          order as unknown as Parameters<EntersTunnels['resolveOrder']>[1],
        )
      }).not.toThrow()
    })

    it('queues activities when tunnel entrance is valid', () => {
      const tunnelEntrance = new TunnelEntrance(new TunnelEntranceInfo())
      tunnelEntrance.exit = new CPos(10, 10)
      // Set entrance manually
      const mockTunnelEntrance = tunnelEntrance as unknown as { entrance: CPos }
      mockTunnelEntrance.entrance = new CPos(5, 5)

      const entersTunnels = createEntersTunnels()
      const selfActor = _makeActor({
        traitMap: {
          IMove: [{}], // empty IMove stub
        },
      })

      // _makeActor always creates a new vi.fn() for queueActivity,
      // ignore the override. Access it from the returned actor.
      const qa = (selfActor as unknown as Record<string, unknown>)['queueActivity'] as ReturnType<typeof vi.fn>

      // Create a target actor with the tunnel entrance
      const targetActor = _makeActor({
        trait: tunnelEntrance,
        traitName: 'TunnelEntrance',
        actorId: 99,
      })

      const order = {
        orderName: 'EnterTunnel',
        targetString: 'actor:99',
        extraData: {
          target: {
            type: 1, // TargetType.Actor
            actor: targetActor,
          },
          queued: false,
        },
      }

      entersTunnels.resolveOrder(
        selfActor,
        order as unknown as Parameters<EntersTunnels['resolveOrder']>[1],
      )

      // queueActivity should have been called twice (entrance + exit)
      expect(qa).toHaveBeenCalledTimes(2)
    })
  })

  describe('getVariableObservers (IObservesVariables)', () => {
    it('returns empty when no requireForceMoveCondition', () => {
      const entersTunnels = createEntersTunnels({ requireForceMoveCondition: null })
      const observers = entersTunnels.getVariableObservers()
      expect(observers.length).toBe(0)
    })

    it('returns single observer for requireForceMoveCondition', () => {
      const entersTunnels = createEntersTunnels({ requireForceMoveCondition: 'deployed' })
      const observers = entersTunnels.getVariableObservers()
      expect(observers.length).toBe(1)
      expect(observers[0].variables).toContain('deployed')
    })

    it('observer notifier updates force-move requirement', () => {
      const entersTunnels = createEntersTunnels({ requireForceMoveCondition: 'deployed' })
      const observers = entersTunnels.getVariableObservers()
      expect(observers.length).toBe(1)

      // Before: force-move not required
      // Can enter tunnel should return true (no condition active yet)

      // Activate condition → force-move required
      const conditions = new Map<string, number>([['deployed', 1]])
      observers[0].notifier(_makeActor(), conditions)

      // Now check that force-move is required by testing canTargetActor
      const tunnelEntrance = new TunnelEntrance(new TunnelEntranceInfo())
      tunnelEntrance.exit = new CPos(5, 5)
      const target = _makeActor({
        trait: tunnelEntrance,
        traitName: 'TunnelEntrance',
      })

      const targeter = entersTunnels.orders[0] as EnterTunnelOrderTargeter
      const cursorRef = { ref: '' }
      const result = targeter.canTargetActor(
        _makeActor(),
        target,
        TargetModifiers.None,
        cursorRef,
      )
      // force-move is required, no ForceMove modifier → should be false
      expect(result).toBe(false)

      // With ForceMove modifier → should be true
      const result2 = targeter.canTargetActor(
        _makeActor(),
        target,
        TargetModifiers.ForceMove,
        cursorRef,
      )
      expect(result2).toBe(true)
    })

    it('observer handles NOT condition (!deployed)', () => {
      const entersTunnels = createEntersTunnels({ requireForceMoveCondition: '!deployed' })
      const observers = entersTunnels.getVariableObservers()
      expect(observers.length).toBe(1)
      expect(observers[0].variables).toContain('deployed')
    })

    it('observer handles AND condition (a && b)', () => {
      const entersTunnels = createEntersTunnels({ requireForceMoveCondition: 'deployed && armed' })
      const observers = entersTunnels.getVariableObservers()
      expect(observers.length).toBe(1)
      expect(observers[0].variables).toContain('deployed')
      expect(observers[0].variables).toContain('armed')
    })

    it('observer handles OR condition (a || b)', () => {
      const entersTunnels = createEntersTunnels({ requireForceMoveCondition: 'deployed || armed' })
      const observers = entersTunnels.getVariableObservers()
      expect(observers.length).toBe(1)
      expect(observers[0].variables).toContain('deployed')
      expect(observers[0].variables).toContain('armed')
    })
  })
})
