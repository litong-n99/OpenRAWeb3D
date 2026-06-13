/**
 * GivesBounty.test.ts — GivesBounty migration unit tests
 *
 * Tests focus on: GivesBountyInfo defaults, ConditionalTrait behavior,
 * killed() bounty calculation and grant to attacker, DeathTypes filtering,
 * relationship filtering, trait-disabled guard, missing owner/attacker guards,
 * showBounty flag, and _grantCash via duck-typing fallbacks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GivesBounty, GivesBountyInfo } from './GivesBounty.js'
import {
  PlayerRelationship,
  PlayerRelationshipExts,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackInfo, Damage } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
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

/** Make a player with relationshipWith. */
function makeOwnerWithRelationship(relationshipToReturn: number): PlayerStub & Record<string, unknown> {
  return makePlayerStub({
    playerName: 'RelationshipOwner',
    relationshipWith: () => relationshipToReturn,
  })
}

/** Make an AttackInfo for testing. */
function makeAttackInfo(attacker: IGameActor, damageValue: number = 50): AttackInfo {
  return new AttackInfo(
    new Damage(damageValue),
    attacker,
    4, // Medium damage state
    1, // Undamaged before
  )
}

/** Create a mock actor with traitInfos for getSellValue lookup. */
function makeActorWithSellValue(
  sellValue: number,
  overrides: Record<string, unknown> = {},
): IGameActor {
  const traitInfos = new Map<string, Record<string, unknown>>()
  traitInfos.set('ValuedInfo', { cost: sellValue })
  const info = {
    name: 'TestActor',
    traitInfoOrDefault: (name: string) => traitInfos.get(name),
  }
  return makeMockActor({ info, ...overrides })
}

// Make a BitSet stub for death types
function makeBitSetStub(overlapsResult: boolean, isEmpty = false): { isEmpty: boolean; overlaps(_other: unknown): boolean } {
  return {
    isEmpty,
    overlaps: vi.fn().mockReturnValue(overlapsResult),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GivesBounty', () => {
  describe('GivesBountyInfo', () => {
    it('has Percentage default of 10', () => {
      const info = new GivesBountyInfo()
      expect(info.percentage).toBe(10)
    })

    it('has ValidRelationships default of Neutral | Enemy (3)', () => {
      const info = new GivesBountyInfo()
      expect(info.validRelationships).toBe(PlayerRelationship.Neutral | PlayerRelationship.Enemy)
    })

    it('has ShowBounty default of true', () => {
      const info = new GivesBountyInfo()
      expect(info.showBounty).toBe(true)
    })

    it('has DeathTypes default empty', () => {
      const info = new GivesBountyInfo()
      expect(info.deathTypes.isEmpty).toBe(true)
    })

    it('implements ConditionalTraitInfo', () => {
      const info = new GivesBountyInfo({ requiresCondition: '!disabled' })
      expect(info.requiresCondition).toBe('!disabled')
      expect('instanceName' in info).toBe(true)
    })

    it('accepts custom percentage', () => {
      const info = new GivesBountyInfo({ percentage: 25 })
      expect(info.percentage).toBe(25)
    })

    it('accepts custom validRelationships', () => {
      const info = new GivesBountyInfo({ validRelationships: PlayerRelationship.Enemy })
      expect(info.validRelationships).toBe(PlayerRelationship.Enemy)
    })

    it('accepts custom showBounty', () => {
      const info = new GivesBountyInfo({ showBounty: false })
      expect(info.showBounty).toBe(false)
    })

    it('accepts custom deathTypes', () => {
      const customDeathTypes = makeBitSetStub(true, false)
      const info = new GivesBountyInfo({ deathTypes: customDeathTypes })
      expect(info.deathTypes.isEmpty).toBe(false)
    })
  })

  describe('GivesBounty trait', () => {
    let info: GivesBountyInfo
    let trait: GivesBounty

    beforeEach(() => {
      info = new GivesBountyInfo({ percentage: 50 })
      trait = new GivesBounty(info)
    })

    it('is a ConditionalTrait', () => {
      expect(trait.isTraitDisabled).toBe(false)
      expect(trait.info).toBe(info)
    })

    it('is created with info', () => {
      expect(trait.info.percentage).toBe(50)
    })

    describe('killed() — basic flow', () => {
      it('grants bounty to attacker when all conditions met', () => {
        const changeCash = vi.fn().mockReturnValue(100)

        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }

        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({
          actorId: 2,
          owner: attackerOwner,
        })

        const selfOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        const self = makeActorWithSellValue(200, {
          actorId: 1,
          owner: selfOwner,
        })

        const attackInfo = makeAttackInfo(attacker, 50)
        trait.killed(self, attackInfo)

        // Bounty = sellValue(200) * percentage(50) / 100 = 100
        expect(changeCash).toHaveBeenCalledWith(100)
      })

      it('grants bounty with Ally relationship when validRelationships includes Ally', () => {
        const allyInfo = new GivesBountyInfo({
          percentage: 100,
          validRelationships: PlayerRelationship.Ally | PlayerRelationship.Enemy,
        })
        const allyTrait = new GivesBounty(allyInfo)
        const changeCash = vi.fn().mockReturnValue(100)

        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }

        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Ally)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({
          actorId: 2,
          owner: attackerOwner,
        })

        const selfOwner = makeOwnerWithRelationship(PlayerRelationship.Ally)
        const self = makeActorWithSellValue(100, {
          actorId: 1,
          owner: selfOwner,
        })

        const attackInfo = makeAttackInfo(attacker, 50)
        allyTrait.killed(self, attackInfo)

        expect(changeCash).toHaveBeenCalledWith(100)
      })
    })

    describe('killed() — guard conditions', () => {
      it('does nothing when trait is disabled', () => {
        const changeCash = vi.fn()
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        // Disable trait
        trait['_enabled'] = false
        trait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()

        trait['_enabled'] = true // restore
      })

      it('does nothing when attacker is null', () => {
        const changeCash = vi.fn()
        const self = makeActorWithSellValue(200)
        const attackInfo = makeAttackInfo(null as unknown as IGameActor, 50)
        trait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('does nothing when attacker is disposed', () => {
        const changeCash = vi.fn()
        const attacker = makeMockActor({ actorId: 2, disposed: true })
        const self = makeActorWithSellValue(200)
        const attackInfo = makeAttackInfo(attacker, 50)
        trait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('does nothing when self has no owner', () => {
        const changeCash = vi.fn()
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1, owner: undefined })
        const attackInfo = makeAttackInfo(attacker, 50)
        trait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('does nothing when attacker has no owner', () => {
        const changeCash = vi.fn()
        const attacker = makeMockActor({ actorId: 2, owner: undefined })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)
        trait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()
      })
    })

    describe('killed() — relationship filtering', () => {
      it('does not grant bounty when relationship is Ally (against default Neutral|Enemy)', () => {
        const changeCash = vi.fn()
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        // Self owner relation to attacker owner is Ally (4), but validRelationships is Neutral|Enemy (3)
        // (3 & 4) === 4 → 0 === 4 → false → correctly rejects
        const selfOwner = makeOwnerWithRelationship(PlayerRelationship.Ally)
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Ally)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1, owner: selfOwner })
        const attackInfo = makeAttackInfo(attacker, 50)
        trait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('does not grant bounty when relationship is Ally (default is Neutral | Enemy)', () => {
        const changeCash = vi.fn()
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Ally)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)
        trait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('grants bounty when owner has no relationshipWith (falls back to None=0, matches any)', () => {
        // NOTE: When relationshipWith is absent, we fall back to 0 (None).
        // hasRelationship(Neutral|Enemy, None) → (3 & 0) === 0 → true.
        // This matches C# behavior: without explicit relationship, bounty IS granted.
        const changeCash = vi.fn().mockReturnValue(100)
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makePlayerStub({ playerName: 'NoRel' })
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)
        trait.killed(self, attackInfo)
        expect(changeCash).toHaveBeenCalledWith(100)
      })
    })

    describe('killed() — DeathTypes filtering', () => {
      it('skips when deathTypes do not overlap', () => {
        const changeCash = vi.fn()
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const nonOverlappingDeathTypes = makeBitSetStub(false, false)
        const deathTypeInfo = new GivesBountyInfo({
          percentage: 50,
          deathTypes: nonOverlappingDeathTypes,
        })
        const deathTypeTrait = new GivesBounty(deathTypeInfo)

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        // Mock damage.damageTypes to have overlaps that returns false
        ;(attackInfo.damage.damageTypes as unknown as Record<string, unknown>).overlaps =
          vi.fn().mockReturnValue(false)

        deathTypeTrait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('grants bounty when deathTypes overlap', () => {
        const changeCash = vi.fn().mockReturnValue(100)

        const overlappingDeathTypes = makeBitSetStub(true, false)
        const deathTypeInfo = new GivesBountyInfo({
          percentage: 50,
          deathTypes: overlappingDeathTypes,
        })
        const deathTypeTrait = new GivesBounty(deathTypeInfo)

        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })

        const attackInfo = makeAttackInfo(attacker, 50)
        ;(attackInfo.damage.damageTypes as unknown as Record<string, unknown>).overlaps =
          vi.fn().mockReturnValue(true)

        deathTypeTrait.killed(self, attackInfo)
        expect(changeCash).toHaveBeenCalledWith(100)
      })

      it('always grants when deathTypes is empty', () => {
        const changeCash = vi.fn().mockReturnValue(100)
        const emptyDeathTypeInfo = new GivesBountyInfo({ percentage: 50 })
        const emptyDeathTypeTrait = new GivesBounty(emptyDeathTypeInfo)

        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        emptyDeathTypeTrait.killed(self, attackInfo)
        expect(changeCash).toHaveBeenCalledWith(100)
      })
    })

    describe('killed() — bounty calculation', () => {
      it('calculates bounty = sellValue * percentage / 100', () => {
        const changeCash = vi.fn().mockReturnValue(50)
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(500, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        trait.killed(self, attackInfo)
        // 500 * 50 / 100 = 250
        expect(changeCash).toHaveBeenCalledWith(250)
      })

      it('calculates floor for fractional bounty', () => {
        const changeCash = vi.fn().mockReturnValue(33)
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(67, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        trait.killed(self, attackInfo)
        // 67 * 50 / 100 = 33.5 → floor → 33
        expect(changeCash).toHaveBeenCalledWith(33)
      })

      it('returns early when sellValue is 0', () => {
        const changeCash = vi.fn()
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(0, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        trait.killed(self, attackInfo)
        expect(changeCash).not.toHaveBeenCalled()
      })
    })

    describe('killed() — _grantCash fallbacks', () => {
      it('uses trait() method on playerActor to find PlayerResources', () => {
        const changeCash = vi.fn().mockReturnValue(100)
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        trait.killed(self, attackInfo)
        expect(playerActor.trait).toHaveBeenCalledWith('PlayerResources')
        expect(changeCash).toHaveBeenCalledWith(100)
      })

      it('uses changeCash directly on playerActor if trait() is not available', () => {
        const changeCash = vi.fn().mockReturnValue(100)
        const playerActor = {
          changeCash,
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        trait.killed(self, attackInfo)
        expect(changeCash).toHaveBeenCalledWith(100)
      })

      it('does nothing when no playerActor', () => {
        const attackerOwner = makePlayerStub({ playerName: 'NoPlayerActor' })
        // No playerActor property
        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        // Should not throw
        expect(() => trait.killed(self, attackInfo)).not.toThrow()
      })
    })

    describe('showBounty flag', () => {
      it('does not throw when showBounty is true (floating text stubbed)', () => {
        const showInfo = new GivesBountyInfo({ percentage: 50, showBounty: true })
        const showTrait = new GivesBounty(showInfo)
        const changeCash = vi.fn().mockReturnValue(100)
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, {
          actorId: 1,
          isInWorld: true,
        })
        const attackInfo = makeAttackInfo(attacker, 50)

        expect(() => showTrait.killed(self, attackInfo)).not.toThrow()
        expect(changeCash).toHaveBeenCalledWith(100)
      })

      it('still grants cash when showBounty is false', () => {
        const noShowInfo = new GivesBountyInfo({ percentage: 50, showBounty: false })
        const noShowTrait = new GivesBounty(noShowInfo)
        const changeCash = vi.fn().mockReturnValue(100)
        const playerActor = {
          trait: vi.fn().mockReturnValue({ changeCash } as unknown),
        }
        const attackerOwner = makeOwnerWithRelationship(PlayerRelationship.Enemy)
        ;(attackerOwner as Record<string, unknown>).playerActor = playerActor

        const attacker = makeMockActor({ actorId: 2, owner: attackerOwner })
        const self = makeActorWithSellValue(200, { actorId: 1 })
        const attackInfo = makeAttackInfo(attacker, 50)

        noShowTrait.killed(self, attackInfo)
        expect(changeCash).toHaveBeenCalledWith(100)
      })
    })

    describe('Component lifecycle', () => {
      it('dispose clears state', () => {
        trait.dispose()
        expect(trait.disposed).toBe(true)
        expect(trait.actor).toBeNull()
      })

      it('isTraitDisabled reflects enabled state', () => {
        expect(trait.isTraitDisabled).toBe(false)
        trait['_enabled'] = false
        expect(trait.isTraitDisabled).toBe(true)
        trait['_enabled'] = true
      })
    })
  })

  describe('PlayerRelationshipExts.hasRelationship', () => {
    it('matches single flag', () => {
      expect(PlayerRelationshipExts.hasRelationship(
        PlayerRelationship.Enemy,
        PlayerRelationship.Enemy,
      )).toBe(true)
    })

    it('matches combined flags', () => {
      const combined = (PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship
      expect(PlayerRelationshipExts.hasRelationship(combined, PlayerRelationship.Enemy)).toBe(true)
      expect(PlayerRelationshipExts.hasRelationship(combined, PlayerRelationship.Neutral)).toBe(true)
      expect(PlayerRelationshipExts.hasRelationship(combined, PlayerRelationship.Ally)).toBe(false)
    })
  })
})
