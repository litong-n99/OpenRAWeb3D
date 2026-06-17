/**
 * InfiltrateForDecoration.test.ts — unit tests for InfiltrateForDecoration
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  InfiltrateForDecoration,
  InfiltrateForDecorationInfo,
} from './InfiltrateForDecoration.js'
import { PlayerRelationship } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeActor(
  overrides: Partial<{ owner: unknown }> = {},
): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  } as unknown as IGameActor
}

describe('InfiltrateForDecoration', () => {
  describe('InfiltrateForDecorationInfo', () => {
    it('has correct defaults', () => {
      const info = new InfiltrateForDecorationInfo()
      expect(info.types).toEqual([])
      expect(info.playerExperience).toBe(0)
      expect(info.sequence).toBe('')
      expect(info.palette).toBe('')
    })
  })

  describe('infiltrated', () => {
    it('skips when types do not overlap', () => {
      const info = new InfiltrateForDecorationInfo({ types: ['Building'] })
      const trait = new InfiltrateForDecoration(info)
      const self = makeActor()
      const infiltrator = makeActor()

      expect(() =>
        trait.infiltrated(self, infiltrator, ['Infantry']),
      ).not.toThrow()
      expect(trait.getInfiltratorPlayers().size).toBe(0)
    })

    it('adds infiltrator to set when types overlap', () => {
      const info = new InfiltrateForDecorationInfo({ types: ['Building'] })
      const trait = new InfiltrateForDecoration(info)
      const owner = {}
      const self = makeActor()
      const infiltrator = makeActor({ owner })

      trait.infiltrated(self, infiltrator, ['Building'])
      expect(trait.getInfiltratorPlayers().size).toBe(1)
      expect(trait.getInfiltratorPlayers().has(owner)).toBe(true)
    })

    it('grants experience when configured', () => {
      let xpGiven = 0
      const playerExp = { giveExperience(xp: number) { xpGiven = xp } }
      const owner = {
        playerActor: {
          getTrait: () => playerExp,
        } as unknown as IGameActor & { getTrait: <T>(_: string) => T | undefined },
      }

      const info = new InfiltrateForDecorationInfo({
        types: ['Building'],
        playerExperience: 25,
      })
      const trait = new InfiltrateForDecoration(info)
      const infiltrator = makeActor({ owner })

      trait.infiltrated(makeActor(), infiltrator, ['Building'])
      expect(xpGiven).toBe(25)
    })
  })

  describe('shouldRender', () => {
    it('returns false when no render player', () => {
      const info = new InfiltrateForDecorationInfo({ types: ['Building'] })
      const trait = new InfiltrateForDecoration(info)
      const self = makeActor({ owner: {} })

      // No world.renderPlayer
      expect(trait.shouldRender(self)).toBe(false)
    })

    it('returns true when infiltrator has valid relationship with render player', () => {
      const info = new InfiltrateForDecorationInfo({
        types: ['Building'],
        validRelationships: (PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship,
      })
      const trait = new InfiltrateForDecoration(info)

      const infiltratorOwner = {
        relationshipWith: () => PlayerRelationship.Enemy,
      }

      // First, infiltrate to register the infiltrator in the set
      const self = makeActor()
      const infiltrator = makeActor({ owner: infiltratorOwner })
      trait.infiltrated(self, infiltrator, ['Building'])

      // For shouldRender, the actor must have `world.renderPlayer`
      // (shouldRender accesses self.world, not self.owner.world)
      const worldWithRender = {
        actorId: 2, isInWorld: true, isDead: false, disposed: false,
        world: { renderPlayer: {} },
      } as unknown as IGameActor

      // The infiltrator owner has Enemy relationship with render player
      const result = trait.shouldRender(worldWithRender)
      // Enemy is in validRelationships, so true
      expect(result).toBe(true)
    })
  })
})
