/**
 * DeliversCash.test.ts — DeliversCash migration unit tests
 *
 * Tests focus on:
 * - DeliversCashInfo defaults (payload=500, playerExperience=0, type=null,
 *   cursor="enter", voice="Action", targetLineColor="Yellow")
 * - DeliversCashOrderTargeter canTarget() logic
 * - IIssueOrder.issueOrder() returns correct order (OrderStub)
 * - IOrderVoice.voicePhraseForOrder() returns voice or empty string
 * - IResolveOrder.resolveOrder() dispatches to cash delivery
 * - INotifyKilled behavior
 * - INotifyAddedToWorld behavior
 */

import { describe, it, expect, vi } from 'vitest'
import { DeliversCash, DeliversCashInfo } from './DeliversCash.js'
import { PlayerRelationship } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  PlayerStub,
  Order,
  TargetStub,
  AttackInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Damage } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

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

function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: makePlayerStub(),
    ...overrides,
  } as IGameActor
}

/** Create a mock AcceptsDeliveredCash trait on a target actor. */
function makeTargetActorWithAccept(
  validTypes: string[] = [],
  relationshipToReturn: number = PlayerRelationship.Ally,
): IGameActor {
  const targetInfo = {
    validTypes: new Set(validTypes),
    validRelationships: relationshipToReturn as PlayerRelationship,
  }
  const owner = makePlayerStub({
    playerName: 'TargetOwner',
    relationshipWith: () => relationshipToReturn,
    playerActor: {
      trait: (_name: string) => ({
        addCash: vi.fn(),
      }),
    },
  })
  return {
    actorId: 2,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner,
    trait: (name: string) => {
      if (name === 'AcceptsDeliveredCash') {
        return {
          info: targetInfo,
          acceptsDelivery: (_type: string, _from: IGameActor) => {
            if (validTypes.length === 0) return true
            return validTypes.includes(_type)
          },
          onAcceptingCash: vi.fn(),
        }
      }
      return null
    },
  } as unknown as IGameActor
}

function makeTargetStubFromActor(actor: IGameActor): TargetStub {
  return actor as unknown as TargetStub
}

function makeAttackInfo(): AttackInfo {
  return {
    damage: new Damage(100),
    attacker: makeMockActor({ actorId: 99 }),
    damageState: 4,
    previousDamageState: 1,
  } as AttackInfo
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeliversCash', () => {
  describe('DeliversCashInfo', () => {
    it('has default values', () => {
      const info = new DeliversCashInfo()
      expect(info.payload).toBe(500)
      expect(info.playerExperience).toBe(0)
      expect(info.type).toBeNull()
      expect(info.sounds).toEqual([])
      expect(info.cursor).toBe('enter')
      expect(info.voice).toBe('Action')
      expect(info.targetLineColor).toBe('Yellow')
    })

    it('accepts custom values', () => {
      const info = new DeliversCashInfo({
        payload: 1000,
        playerExperience: 50,
        type: 'SpyIntel',
        sounds: ['money.aud'],
        cursor: 'cash',
        voice: 'DeliverFunds',
        targetLineColor: 'Green',
      })
      expect(info.payload).toBe(1000)
      expect(info.playerExperience).toBe(50)
      expect(info.type).toBe('SpyIntel')
      expect(info.sounds).toEqual(['money.aud'])
      expect(info.cursor).toBe('cash')
      expect(info.voice).toBe('DeliverFunds')
      expect(info.targetLineColor).toBe('Green')
    })

    it('implements ITraitInfo', () => {
      const info = new DeliversCashInfo()
      expect('instanceName' in info).toBe(true)
    })
  })

  describe('DeliversCash trait', () => {
    it('constructs with info', () => {
      const info = new DeliversCashInfo()
      const trait = new DeliversCash(info)
      expect(trait.info).toBe(info)
    })

    // -----------------------------------------------------------------------
    // IIssueOrder tests
    // -----------------------------------------------------------------------

    describe('orders', () => {
      it('returns a single DeliversCashOrderTargeter', () => {
        const info = new DeliversCashInfo()
        const trait = new DeliversCash(info)
        const orders = trait.orders
        expect(orders.length).toBe(1)
        expect(orders[0].orderID).toBe('DeliverCash')
        expect(orders[0].orderPriority).toBe(5)
        expect(orders[0].isQueued).toBe(false)
      })
    })

    describe('issueOrder()', () => {
      it('returns DeliverCash order when orderID matches', () => {
        const info = new DeliversCashInfo({ payload: 500 })
        const trait = new DeliversCash(info)
        const self = makeMockActor()
        const target = makeTargetStubFromActor(
          makeTargetActorWithAccept()
        )
        const orderTargeter = trait.orders[0]
        const order = trait.issueOrder(self, orderTargeter, target, true)
        expect(order.orderName).toBe('DeliverCash')
        expect(order.extraData).toBe(500)
      })

      it('returns empty order when orderID does not match', () => {
        const info = new DeliversCashInfo()
        const trait = new DeliversCash(info)
        const self = makeMockActor()
        const target = makeTargetStubFromActor(
          makeTargetActorWithAccept()
        )
        const fakeOrderTargeter = {
          orderID: 'SomeOtherOrder',
          orderPriority: 1,
          isQueued: false,
          canTarget: () => false,
          targetOverridesSelection: () => false,
        }
        const order = trait.issueOrder(self, fakeOrderTargeter, target, false)
        expect(order.orderName).toBe('')
      })
    })

    // -----------------------------------------------------------------------
    // DeliversCashOrderTargeter tests
    // -----------------------------------------------------------------------

    describe('DeliversCashOrderTargeter.canTarget()', () => {
      it('returns true when target has AcceptsDeliveredCash with empty validTypes', () => {
        const info = new DeliversCashInfo({ type: 'Cash' })
        const trait = new DeliversCash(info)
        const orderTargeter = trait.orders[0]
        const self = makeMockActor({
          owner: makePlayerStub({ playerName: 'Donor' }),
        })
        const target = makeTargetStubFromActor(
          makeTargetActorWithAccept([])
        )
        expect(orderTargeter.canTarget(self, target, 0, '')).toBe(true)
      })

      it('returns true when type matches validTypes', () => {
        const info = new DeliversCashInfo({ type: 'SpyIntel' })
        const trait = new DeliversCash(info)
        const orderTargeter = trait.orders[0]
        const self = makeMockActor({
          owner: makePlayerStub({ playerName: 'Donor' }),
        })
        const target = makeTargetStubFromActor(
          makeTargetActorWithAccept(['SpyIntel'])
        )
        expect(orderTargeter.canTarget(self, target, 0, '')).toBe(true)
      })

      it('returns false when type does not match validTypes', () => {
        const info = new DeliversCashInfo({ type: 'Cash' })
        const trait = new DeliversCash(info)
        const orderTargeter = trait.orders[0]
        const self = makeMockActor({
          owner: makePlayerStub({ playerName: 'Donor' }),
        })
        const target = makeTargetStubFromActor(
          makeTargetActorWithAccept(['SpyIntel'])
        )
        expect(orderTargeter.canTarget(self, target, 0, '')).toBe(false)
      })

      it('returns false when target has no AcceptsDeliveredCash trait', () => {
        const info = new DeliversCashInfo()
        const trait = new DeliversCash(info)
        const orderTargeter = trait.orders[0]
        const self = makeMockActor()
        const target = makeTargetStubFromActor(makeMockActor())
        expect(orderTargeter.canTarget(self, target, 0, '')).toBe(false)
      })

      it('returns false when relationship does not match', () => {
        const info = new DeliversCashInfo({ type: 'Cash' })
        const trait = new DeliversCash(info)
        const orderTargeter = trait.orders[0]
        const self = makeMockActor({
          owner: makePlayerStub({ playerName: 'Donor' }),
        })
        // Target requires Ally, but target's relationshipWith returns Enemy
        const targetActor = makeTargetActorWithAccept([], PlayerRelationship.Ally)
        // Override relationshipWith to return Enemy for this test
        ;(targetActor.owner as unknown as { relationshipWith?: () => number }).relationshipWith =
          () => PlayerRelationship.Enemy
        const target = makeTargetStubFromActor(targetActor)
        expect(orderTargeter.canTarget(self, target, 0, '')).toBe(false)
      })

      it('returns false when self has no owner', () => {
        const info = new DeliversCashInfo()
        const trait = new DeliversCash(info)
        const orderTargeter = trait.orders[0]
        const self = makeMockActor({ owner: undefined })
        const target = makeTargetStubFromActor(
          makeTargetActorWithAccept()
        )
        expect(orderTargeter.canTarget(self, target, 0, '')).toBe(false)
      })
    })

    // -----------------------------------------------------------------------
    // IOrderVoice tests
    // -----------------------------------------------------------------------

    describe('voicePhraseForOrder()', () => {
      it('returns voice string for DeliverCash order', () => {
        const info = new DeliversCashInfo({ voice: 'CustomVoice' })
        const trait = new DeliversCash(info)
        const order: Order = {
          orderName: 'DeliverCash',
          targetString: '',
          extraData: 0,
        }
        expect(trait.voicePhraseForOrder(makeMockActor(), order)).toBe('CustomVoice')
      })

      it('returns empty string for non-DeliverCash order', () => {
        const info = new DeliversCashInfo()
        const trait = new DeliversCash(info)
        const order: Order = {
          orderName: 'Move',
          targetString: '',
          extraData: 0,
        }
        expect(trait.voicePhraseForOrder(makeMockActor(), order)).toBe('')
      })
    })

    // -----------------------------------------------------------------------
    // IResolveOrder tests
    // -----------------------------------------------------------------------

    describe('resolveOrder()', () => {
      it('does nothing for non-DeliverCash order', () => {
        const info = new DeliversCashInfo()
        const trait = new DeliversCash(info)
        const order: Order = {
          orderName: 'Move',
          targetString: '',
          extraData: 0,
        }
        expect(() => trait.resolveOrder(makeMockActor(), order)).not.toThrow()
      })

      it('triggers cash delivery for DeliverCash order', () => {
        const info = new DeliversCashInfo({ payload: 500 })
        const trait = new DeliversCash(info)
        const self = makeMockActor({ owner: makePlayerStub({ playerName: 'Donor' }) })

        const acceptSpy = vi.fn()
        const addCashSpy = vi.fn()
        const targetActor = {
          actorId: 2,
          owner: {
            playerName: 'TargetOwner',
            playerActor: {
              trait: (_name: string) => ({
                addCash: addCashSpy,
              }),
            },
          },
          trait: (name: string) => {
            if (name === 'AcceptsDeliveredCash') {
              return { onAcceptingCash: acceptSpy }
            }
            return null
          },
        } as unknown as IGameActor

        const order: Order = {
          orderName: 'DeliverCash',
          targetString: '',
          extraData: 500,
          target: targetActor as unknown as TargetStub,
        } as unknown as Order

        trait.resolveOrder(self, order)
        expect(acceptSpy).toHaveBeenCalled()
        expect(addCashSpy).toHaveBeenCalledWith(500)
      })

      it('handles missing target gracefully', () => {
        const info = new DeliversCashInfo()
        const trait = new DeliversCash(info)
        const order: Order = {
          orderName: 'DeliverCash',
          targetString: '',
          extraData: 0,
        } as Order
        expect(() => trait.resolveOrder(makeMockActor(), order)).not.toThrow()
      })
    })

    // -----------------------------------------------------------------------
    // INotifyKilled tests
    // -----------------------------------------------------------------------

    describe('killed()', () => {
      it('does not throw (cash lost on death)', () => {
        const info = new DeliversCashInfo({ payload: 1000 })
        const trait = new DeliversCash(info)
        const self = makeMockActor()
        expect(() => trait.killed(self, makeAttackInfo())).not.toThrow()
      })
    })

    // -----------------------------------------------------------------------
    // INotifyAddedToWorld tests
    // -----------------------------------------------------------------------

    describe('addedToWorld()', () => {
      it('does not throw (registration stub)', () => {
        const info = new DeliversCashInfo()
        const trait = new DeliversCash(info)
        expect(() => trait.addedToWorld(makeMockActor())).not.toThrow()
      })
    })

    // -----------------------------------------------------------------------
    // Sound tests
    // -----------------------------------------------------------------------

    describe('sound playback', () => {
      it('does not throw when sounds array is populated (stub)', () => {
        const info = new DeliversCashInfo({ sounds: ['money.aud'] })
        const trait = new DeliversCash(info)
        const self = makeMockActor()
        const target = {
          actorId: 2,
          owner: {
            playerActor: { trait: () => ({ addCash: vi.fn() }) },
          },
          trait: () => null,
        } as unknown as IGameActor
        const order: Order = {
          orderName: 'DeliverCash',
          targetString: '',
          extraData: 0,
          target: target as unknown as TargetStub,
        } as unknown as Order
        expect(() => trait.resolveOrder(self, order)).not.toThrow()
      })
    })
  })
})
