/**
 * Sellable.test.ts — Sellable migration unit tests
 *
 * Tests focus on:
 * - SellableInfo defaults (refundPercent=50, sellSounds=[], showTicks=true,
 *   showTooltipText=true, skipMakeAnimation=false, cursor="sell")
 * - ConditionalTrait integration (isTraitDisabled gating)
 * - IIssueOrder.issueOrder() returns Sell order only when enabled
 * - IIssueOrder.orders returns order targeter when enabled
 * - IResolveOrder.resolveOrder("Sell") triggers sell()
 * - sellValue() calculation: Valued.Cost * healthPercent * RefundPercent / 100
 * - sellValue() with CustomSellValue override
 * - sellValue() with no Valued trait (returns 0)
 * - sellValue() with no Health trait (uses 1/1 for max)
 * - sell() execution: cancelActivity, addCash, removeActor
 * - sell() does nothing when trait disabled
 * - INotifySold notification (selling/sold callbacks)
 * - attach/detach lifecycle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Sellable, SellableInfo } from './Sellable.js'
import type {
  IGameActor,
  PlayerStub,
  Order,
  TargetStub,
  IOrderTargeter,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayerStub(
  overrides: Record<string, unknown> = {},
): PlayerStub & Record<string, unknown> {
  return {
    playerName: 'TestPlayer',
    ...overrides,
  }
}

function makePlayerActorWithResources(
  addCashSpy?: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  return {
    trait: (_name: string) => ({
      addCash: addCashSpy ?? vi.fn(),
    }),
  }
}

function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: makePlayerStub({
      playerActor: makePlayerActorWithResources(),
    }),
    cancelActivity: vi.fn(),
    ...overrides,
  } as IGameActor
}

function makeActorWithValued(
  cost: number,
  hp: number = 1,
  maxHP: number = 1,
  overrides: Record<string, unknown> = {},
): IGameActor {
  const traitInfos = new Map<string, Record<string, unknown>>()
  traitInfos.set('ValuedInfo', { cost })
  const info = {
    name: 'TestActor',
    traitInfoOrDefault: (name: string) => traitInfos.get(name),
  }
  const healthTrait = { hp, maxHP }
  return makeMockActor({
    info,
    traitOrDefault: (name: string) => {
      if (name === 'Health') return healthTrait
      return null
    },
    ...overrides,
  })
}

function makeActorWithCustomSellValue(
  cost: number,
  customValue: number,
  hp: number = 1,
  maxHP: number = 1,
): IGameActor {
  const traitInfos = new Map<string, Record<string, unknown>>()
  traitInfos.set('ValuedInfo', { cost })
  traitInfos.set('CustomSellValueInfo', { value: customValue })
  const info = {
    name: 'TestActor',
    traitInfoOrDefault: (name: string) => traitInfos.get(name),
  }
  const healthTrait = { hp, maxHP }
  return makeMockActor({
    info,
    traitOrDefault: (name: string) => {
      if (name === 'Health') return healthTrait
      return null
    },
  })
}

/** Create a mock IOrderTargeter for test usage. */
function makeOrderTargeter(orderID: string): IOrderTargeter {
  return {
    orderID,
    orderPriority: 1,
    isQueued: false,
    canTarget: (_actor: IGameActor, _target: TargetStub, _modifiers: TargetModifiers, _cursor: string): boolean => true,
    targetOverridesSelection: (): boolean => false,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sellable', () => {
  describe('SellableInfo', () => {
    it('has default values', () => {
      const info = new SellableInfo()
      expect(info.refundPercent).toBe(50)
      expect(info.sellSounds).toEqual([])
      expect(info.showTicks).toBe(true)
      expect(info.showTooltipText).toBe(true)
      expect(info.skipMakeAnimation).toBe(false)
      expect(info.cursor).toBe('sell')
      expect(info.notification).toBeNull()
      expect(info.textNotification).toBeNull()
      expect(info.requiresCondition).toBeUndefined()
    })

    it('accepts custom values', () => {
      const info = new SellableInfo({
        refundPercent: 75,
        sellSounds: ['sell.aud', 'cha-ching.aud'],
        showTicks: false,
        showTooltipText: false,
        skipMakeAnimation: true,
        cursor: 'sell_custom',
        notification: 'UnitSold',
        textNotification: 'Unit sold for $${refund}',
        requiresCondition: '!dead',
        instanceName: 'test_sellable',
      })
      expect(info.refundPercent).toBe(75)
      expect(info.sellSounds).toEqual(['sell.aud', 'cha-ching.aud'])
      expect(info.showTicks).toBe(false)
      expect(info.showTooltipText).toBe(false)
      expect(info.skipMakeAnimation).toBe(true)
      expect(info.cursor).toBe('sell_custom')
      expect(info.notification).toBe('UnitSold')
      expect(info.textNotification).toBe('Unit sold for $${refund}')
      expect(info.requiresCondition).toBe('!dead')
      expect(info.instanceName).toBe('test_sellable')
    })

    it('implements ConditionalTraitInfo', () => {
      const info = new SellableInfo()
      expect('requiresCondition' in info).toBe(true)
      expect('instanceName' in info).toBe(true)
    })
  })

  describe('Sellable trait', () => {
    let info: SellableInfo
    let trait: Sellable
    let addCashSpy: ReturnType<typeof vi.fn>
    let cancelActivitySpy: ReturnType<typeof vi.fn>
    let removeActorSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      info = new SellableInfo({ refundPercent: 50 })
      trait = new Sellable(info)
      addCashSpy = vi.fn()
      cancelActivitySpy = vi.fn()
      removeActorSpy = vi.fn()
    })

    it('extends ConditionalTrait', () => {
      expect(trait.enabled).toBe(true)
      expect(trait.disposed).toBe(false)
    })

    // -----------------------------------------------------------------------
    // sellValue() tests
    // -----------------------------------------------------------------------

    describe('sellValue()', () => {
      it('calculates refund from Valued.Cost with full health', () => {
        const actor = makeActorWithValued(1000, 100, 100)
        trait.attach(actor)
        expect(trait.sellValue(actor)).toBe(500)
      })

      it('reduces refund by health percentage', () => {
        const actor = makeActorWithValued(1000, 50, 100)
        trait.attach(actor)
        expect(trait.sellValue(actor)).toBe(250)
      })

      it('returns 0 for dead actor (0 HP)', () => {
        const actor = makeActorWithValued(1000, 0, 100)
        trait.attach(actor)
        expect(trait.sellValue(actor)).toBe(0)
      })

      it('uses CustomSellValue override when available', () => {
        const actor = makeActorWithCustomSellValue(1000, 2000, 100, 100)
        trait.attach(actor)
        expect(trait.sellValue(actor)).toBe(1000)
      })

      it('returns 0 when no Valued or CustomSellValue trait', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        expect(trait.sellValue(actor)).toBe(0)
      })

      it('uses 1/1 health when no Health trait', () => {
        const actor = makeActorWithValued(1000)
        // Remove health trait resolution
        ;(actor as unknown as { traitOrDefault?: unknown }).traitOrDefault = undefined
        trait.attach(actor)
        expect(trait.sellValue(actor)).toBe(500)
      })

      it('handles floor rounding correctly', () => {
        const actor = makeActorWithCustomSellValue(0, 99, 33, 100)
        trait.attach(actor)
        // 99 * 50 * 33 / (100 * 100) = 163350 / 10000 = 16.335 → floor → 16
        expect(trait.sellValue(actor)).toBe(16)
      })
    })

    // -----------------------------------------------------------------------
    // sell() tests
    // -----------------------------------------------------------------------

    describe('sell()', () => {
      it('does nothing when trait is disabled', () => {
        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
          cancelActivity: cancelActivitySpy,
        })
        trait.attach(actor)
        trait.onEnabledChanged(false) // disable
        trait.sell(actor)
        expect(cancelActivitySpy).not.toHaveBeenCalled()
        expect(addCashSpy).not.toHaveBeenCalled()
      })

      it('cancels activity, grants cash, and removes actor', () => {
        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
          cancelActivity: cancelActivitySpy,
          world: { removeActor: removeActorSpy },
        })
        trait.attach(actor)

        trait.sell(actor)

        expect(cancelActivitySpy).toHaveBeenCalled()
        expect(addCashSpy).toHaveBeenCalledWith(500, true)
        expect(removeActorSpy).toHaveBeenCalledWith(actor)
      })

      it('does not call addCash when refund is 0', () => {
        const actor = makeActorWithValued(0, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
          cancelActivity: cancelActivitySpy,
          world: { removeActor: removeActorSpy },
        })
        trait.attach(actor)
        trait.sell(actor)
        expect(addCashSpy).not.toHaveBeenCalled()
      })

      it('does not crash when owner has no PlayerResources', () => {
        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: { trait: () => null },
          }),
          cancelActivity: cancelActivitySpy,
          world: { removeActor: removeActorSpy },
        })
        trait.attach(actor)
        expect(() => trait.sell(actor)).not.toThrow()
      })

      it('does not crash when world has no removeActor', () => {
        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
          cancelActivity: cancelActivitySpy,
          world: {},
        })
        trait.attach(actor)
        expect(() => trait.sell(actor)).not.toThrow()
      })

      it('handles missing cancelActivity gracefully', () => {
        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
          cancelActivity: undefined,
          world: { removeActor: removeActorSpy },
        })
        trait.attach(actor)
        expect(() => trait.sell(actor)).not.toThrow()
      })
    })

    // -----------------------------------------------------------------------
    // IIssueOrder tests
    // -----------------------------------------------------------------------

    describe('orders', () => {
      it('returns a Sell order targeter when enabled', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        const orders = trait.orders
        expect(orders.length).toBe(1)
        expect(orders[0].orderID).toBe('Sell')
        expect(orders[0].isQueued).toBe(false)
      })

      it('returns empty array when trait is disabled', () => {
        trait.onEnabledChanged(false)
        expect(trait.orders.length).toBe(0)
      })

      it('canTarget returns true only for self', () => {
        const actor = makeMockActor({ actorId: 42 })
        trait.attach(actor)
        const orderTargeter = trait.orders[0]

        const selfTarget = { actorId: 42 } as unknown as TargetStub
        const otherTarget = { actorId: 99 } as unknown as TargetStub

        expect(orderTargeter.canTarget(actor, selfTarget, 0 as TargetModifiers, '')).toBe(true)
        expect(orderTargeter.canTarget(actor, otherTarget, 0 as TargetModifiers, '')).toBe(false)
      })
    })

    describe('issueOrder()', () => {
      it('returns Sell order when orderID matches and trait is enabled', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        const orderTargeter = makeOrderTargeter('Sell')
        const order = trait.issueOrder(actor, orderTargeter, {} as TargetStub, true)
        expect(order.orderName).toBe('Sell')
        expect(order.extraData).toBe(1) // queued = true
      })

      it('returns empty order when trait is disabled', () => {
        trait.onEnabledChanged(false)
        const actor = makeMockActor()
        const orderTargeter = makeOrderTargeter('Sell')
        const order = trait.issueOrder(actor, orderTargeter, {} as TargetStub, false)
        expect(order.orderName).toBe('')
      })

      it('returns empty order when orderID does not match', () => {
        const actor = makeMockActor()
        const orderTargeter = makeOrderTargeter('SomeOther')
        const order = trait.issueOrder(actor, orderTargeter, {} as TargetStub, false)
        expect(order.orderName).toBe('')
      })
    })

    // -----------------------------------------------------------------------
    // IResolveOrder tests
    // -----------------------------------------------------------------------

    describe('resolveOrder()', () => {
      it('triggers sell() for Sell order', () => {
        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
          cancelActivity: cancelActivitySpy,
          world: { removeActor: removeActorSpy },
        })
        trait.attach(actor)

        const order: Order = {
          orderName: 'Sell',
          targetString: '',
          extraData: 0,
        }
        trait.resolveOrder(actor, order)

        expect(addCashSpy).toHaveBeenCalledWith(500, true)
      })

      it('does nothing for non-Sell order', () => {
        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
        })
        trait.attach(actor)

        const order: Order = {
          orderName: 'Move',
          targetString: '',
          extraData: 0,
        }
        trait.resolveOrder(actor, order)

        expect(addCashSpy).not.toHaveBeenCalled()
      })
    })

    // -----------------------------------------------------------------------
    // INotifySold notification tests
    // -----------------------------------------------------------------------

    describe('INotifySold notification', () => {
      it('calls selling and sold on INotifySold traits', () => {
        const sellingSpy = vi.fn()
        const soldSpy = vi.fn()

        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
          cancelActivity: cancelActivitySpy,
          world: { removeActor: removeActorSpy },
          traitsImplementing: (_name: string) => [
            { selling: sellingSpy, sold: soldSpy },
          ],
        })
        trait.attach(actor)
        trait.sell(actor)

        expect(sellingSpy).toHaveBeenCalledWith(actor)
        expect(soldSpy).toHaveBeenCalledWith(actor)
      })

      it('does not crash when traitsImplementing returns undefined', () => {
        const actor = makeActorWithValued(1000, 100, 100, {
          owner: makePlayerStub({
            playerActor: makePlayerActorWithResources(addCashSpy),
          }),
          cancelActivity: cancelActivitySpy,
          world: { removeActor: removeActorSpy },
          traitsImplementing: undefined,
        })
        trait.attach(actor)
        expect(() => trait.sell(actor)).not.toThrow()
      })
    })

    // -----------------------------------------------------------------------
    // Lifecycle tests
    // -----------------------------------------------------------------------

    describe('lifecycle', () => {
      it('attach resolves health trait', () => {
        const actor = makeActorWithValued(1000, 100, 100)
        trait.attach(actor)
        expect(trait.sellValue(actor)).toBe(500)
      })

      it('attach handles missing health trait', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        expect(trait.sellValue(actor)).toBe(0)
      })

      it('detach clears state', () => {
        const actor = makeActorWithValued(1000)
        trait.attach(actor)
        trait.detach(actor)
        expect(trait.actor).toBeNull()
      })

      it('dispose clears state', () => {
        trait.dispose()
        expect(trait.disposed).toBe(true)
        expect(trait.actor).toBeNull()
      })
    })
  })
})
