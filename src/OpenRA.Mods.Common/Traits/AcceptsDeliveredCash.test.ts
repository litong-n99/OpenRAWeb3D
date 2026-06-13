/**
 * AcceptsDeliveredCash.test.ts — AcceptsDeliveredCash migration unit tests
 *
 * Tests focus on: AcceptsDeliveredCashInfo defaults, acceptsDelivery() type filter,
 * relationship validation, onAcceptingCash() sound stub, Component lifecycle,
 * and edge cases (no owner, no actor, empty/missing types).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  AcceptsDeliveredCash,
  AcceptsDeliveredCashInfo,
} from './AcceptsDeliveredCash.js'
import {
  PlayerRelationship,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  PlayerStub,
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

/** Make a player with a relationshipWith method that returns a specific value. */
function makeOwnerWithRelationship(relationshipToReturn: number): PlayerStub & Record<string, unknown> {
  return makePlayerStub({
    playerName: 'OwnerWithRel',
    relationshipWith: () => relationshipToReturn,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AcceptsDeliveredCash', () => {
  describe('AcceptsDeliveredCashInfo', () => {
    it('has default empty validTypes', () => {
      const info = new AcceptsDeliveredCashInfo()
      expect(info.validTypes.size).toBe(0)
    })

    it('has default validRelationships of Ally', () => {
      const info = new AcceptsDeliveredCashInfo()
      expect(info.validRelationships).toBe(PlayerRelationship.Ally)
    })

    it('has default empty sounds', () => {
      const info = new AcceptsDeliveredCashInfo()
      expect(info.sounds).toEqual([])
    })

    it('accepts custom validTypes', () => {
      const info = new AcceptsDeliveredCashInfo({
        validTypes: new Set(['Cash', 'SpyIntel']),
      })
      expect(info.validTypes.has('Cash')).toBe(true)
      expect(info.validTypes.has('SpyIntel')).toBe(true)
      expect(info.validTypes.has('Unknown')).toBe(false)
    })

    it('accepts custom validRelationships', () => {
      const info = new AcceptsDeliveredCashInfo({
        validRelationships: PlayerRelationship.Enemy,
      })
      expect(info.validRelationships).toBe(PlayerRelationship.Enemy)
    })

    it('accepts custom sounds', () => {
      const info = new AcceptsDeliveredCashInfo({
        sounds: ['cha-ching.aud', 'money.aud'],
      })
      expect(info.sounds).toEqual(['cha-ching.aud', 'money.aud'])
    })

    it('implements ITraitInfo', () => {
      const info = new AcceptsDeliveredCashInfo()
      expect('instanceName' in info).toBe(true)
    })
  })

  describe('AcceptsDeliveredCash trait', () => {
    let info: AcceptsDeliveredCashInfo
    let trait: AcceptsDeliveredCash

    beforeEach(() => {
      info = new AcceptsDeliveredCashInfo()
      trait = new AcceptsDeliveredCash(info)
    })

    it('is created with info', () => {
      expect(trait.info).toBe(info)
    })

    it('is a Component', () => {
      expect(trait.enabled).toBe(true)
      expect(trait.disposed).toBe(false)
    })

    describe('acceptsDelivery()', () => {
      it('accepts any type when validTypes is empty', () => {
        const self = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        trait.attach(self)
        const donor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        expect(trait.acceptsDelivery('Cash', donor)).toBe(true)
        expect(trait.acceptsDelivery('SpyIntel', donor)).toBe(true)
        expect(trait.acceptsDelivery('Anything', donor)).toBe(true)
      })

      it('filters by validTypes when set', () => {
        const typedInfo = new AcceptsDeliveredCashInfo({
          validTypes: new Set(['Cash']),
        })
        const typedTrait = new AcceptsDeliveredCash(typedInfo)
        const self = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        typedTrait.attach(self)
        const donor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })

        expect(typedTrait.acceptsDelivery('Cash', donor)).toBe(true)
        expect(typedTrait.acceptsDelivery('SpyIntel', donor)).toBe(false)
      })

      it('accepts when donor has Ally relationship (default)', () => {
        const self = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        trait.attach(self)
        const donor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })

        expect(trait.acceptsDelivery('Cash', donor)).toBe(true)
      })

      it('rejects when donor has Enemy relationship (with default Ally requirement)', () => {
        const self = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Enemy),
        })
        trait.attach(self)
        const donor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Enemy),
        })

        expect(trait.acceptsDelivery('Cash', donor)).toBe(false)
      })

      it('accepts Enemy if validRelationships is set to Enemy', () => {
        const enemyInfo = new AcceptsDeliveredCashInfo({
          validRelationships: PlayerRelationship.Enemy,
        })
        const enemyTrait = new AcceptsDeliveredCash(enemyInfo)
        const self = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        enemyTrait.attach(self)
        const donor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Enemy),
        })

        expect(enemyTrait.acceptsDelivery('Cash', donor)).toBe(true)
      })

      it('accepts Neutral | Enemy when validRelationships is Neutral | Enemy', () => {
        const neutralEnemyInfo = new AcceptsDeliveredCashInfo({
          validRelationships: (PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship,
        })
        const multiTrait = new AcceptsDeliveredCash(neutralEnemyInfo)
        const self = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        multiTrait.attach(self)

        const neutralDonor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Neutral),
        })
        const enemyDonor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Enemy),
        })
        const allyDonor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })

        expect(multiTrait.acceptsDelivery('Cash', neutralDonor)).toBe(true)
        expect(multiTrait.acceptsDelivery('Cash', enemyDonor)).toBe(true)
        expect(multiTrait.acceptsDelivery('Cash', allyDonor)).toBe(false)
      })

      it('returns false when self has no owner', () => {
        const self = makeMockActor({ owner: undefined })
        trait.attach(self)
        const donor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        expect(trait.acceptsDelivery('Cash', donor)).toBe(false)
      })

      it('returns false when donor has no owner', () => {
        const self = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        trait.attach(self)
        const donor = makeMockActor({ owner: undefined })
        expect(trait.acceptsDelivery('Cash', donor)).toBe(false)
      })

      it('returns false when trait has no actor attached', () => {
        // No attach call — _actor is null
        const donor = makeMockActor({
          owner: makeOwnerWithRelationship(PlayerRelationship.Ally),
        })
        expect(trait.acceptsDelivery('Cash', donor)).toBe(false)
      })

      it('returns Neutral (fails Ally check) when donor has no relationshipWith method', () => {
        const self = makeMockActor({
          owner: makePlayerStub({ playerName: 'NoRel' }),
        })
        trait.attach(self)
        const donor = makeMockActor({
          owner: makePlayerStub({ playerName: 'NoRelDonor' }),
        })
        // No relationshipWith on either → defaults to Neutral → fails Ally check
        expect(trait.acceptsDelivery('Cash', donor)).toBe(false)
      })
    })

    describe('onAcceptingCash()', () => {
      it('is a no-op when sounds is empty', () => {
        const self = makeMockActor()
        const donor = makeMockActor()
        // Should not throw
        expect(() => trait.onAcceptingCash(self, donor)).not.toThrow()
      })

      it('does not throw when sounds array is populated (stub)', () => {
        const soundInfo = new AcceptsDeliveredCashInfo({
          sounds: ['cha-ching.aud'],
        })
        const soundTrait = new AcceptsDeliveredCash(soundInfo)
        const self = makeMockActor()
        const donor = makeMockActor()
        expect(() => soundTrait.onAcceptingCash(self, donor)).not.toThrow()
      })
    })

    describe('Component lifecycle', () => {
      it('attach/detach work correctly', () => {
        const actor = makeMockActor()
        trait.attach(actor)
        expect(trait.actor).toBe(actor)
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
