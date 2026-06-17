/**
 * InfiltrateForTransform.test.ts — unit tests for InfiltrateForTransform
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  InfiltrateForTransform,
  InfiltrateForTransformInfo,
} from './InfiltrateForTransform.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

describe('InfiltrateForTransform', () => {
  describe('InfiltrateForTransformInfo', () => {
    it('has correct defaults', () => {
      const info = new InfiltrateForTransformInfo()
      expect(info.intoActor).toBe('')
      expect(info.forceHealthPercentage).toBe(0)
      expect(info.skipMakeAnims).toBe(true)
      expect(info.types).toEqual([])
      expect(info.playerExperience).toBe(0)
    })
  })

  describe('infiltrated', () => {
    it('skips when types do not overlap', () => {
      const info = new InfiltrateForTransformInfo({
        intoActor: 'newBuilding',
        types: ['Building'],
      })
      const trait = new InfiltrateForTransform({}, info)
      const self = {
        actorId: 1, isInWorld: true, isDead: false, disposed: false,
      } as IGameActor

      expect(() =>
        trait.infiltrated(self, self, ['Infantry']),
      ).not.toThrow()
    })

    it('queues transform activity when types match', () => {
      let queued = false
      let queuedActivity: unknown = null

      const self = {
        actorId: 1, isInWorld: true, isDead: false, disposed: false,
        queueActivity(q: boolean, act: unknown) {
          queued = q
          queuedActivity = act
        },
        getTrait: () => undefined,
      } as unknown as IGameActor

      const info = new InfiltrateForTransformInfo({
        intoActor: 'tank',
        types: ['Building'],
        forceHealthPercentage: 50,
        playerExperience: 5,
      })

      const init = {
        getValue: (_k: string, _d: string) => 'gdi',
      }

      const trait = new InfiltrateForTransform(init, info)
      const infiltrator = {
        actorId: 2, isInWorld: true, isDead: false, disposed: false,
        owner: {
          playerActor: {
            getTrait: () => ({ giveExperience() {} }),
          },
        },
      } as unknown as IGameActor

      trait.infiltrated(self, infiltrator, ['Building'])
      expect(queued).toBe(false) // not queued
      const activity = queuedActivity as Record<string, unknown>
      expect(activity?.__type).toBe('Transform')
      expect(activity?.intoActor).toBe('tank')
      expect(activity?.forceHealthPercentage).toBe(50)
      expect(activity?.faction).toBe('gdi')
    })

    it('grants experience to infiltrating player', () => {
      let xpGiven = 0
      const playerExp = { giveExperience(xp: number) { xpGiven = xp } }

      const info = new InfiltrateForTransformInfo({
        intoActor: 'tank',
        types: ['Building'],
        playerExperience: 15,
      })
      const trait = new InfiltrateForTransform({}, info)

      const self = {
        actorId: 1, isInWorld: true, isDead: false, disposed: false,
        queueActivity() {},
      } as unknown as IGameActor
      const infiltrator = {
        actorId: 2, isInWorld: true, isDead: false, disposed: false,
        owner: {
          playerActor: { getTrait: () => playerExp },
        },
      } as unknown as IGameActor

      trait.infiltrated(self, infiltrator, ['Building'])
      expect(xpGiven).toBe(15)
    })
  })
})
