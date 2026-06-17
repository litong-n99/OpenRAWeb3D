/**
 * InfiltrateForSupportPower.test.ts — unit tests for InfiltrateForSupportPower
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  InfiltrateForSupportPower,
  InfiltrateForSupportPowerInfo,
} from './InfiltrateForSupportPower.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeActor(
  overrides: Partial<{ owner: unknown; world: unknown }> = {},
): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  } as unknown as IGameActor
}

describe('InfiltrateForSupportPower', () => {
  describe('InfiltrateForSupportPowerInfo', () => {
    it('has correct defaults', () => {
      const info = new InfiltrateForSupportPowerInfo()
      expect(info.proxy).toBe('')
      expect(info.types).toEqual([])
      expect(info.playerExperience).toBe(0)
    })
  })

  describe('infiltrated', () => {
    it('skips when types do not overlap', () => {
      const info = new InfiltrateForSupportPowerInfo({
        proxy: 'powerProxy',
        types: ['Building'],
      })
      const trait = new InfiltrateForSupportPower(info)

      expect(() =>
        trait.infiltrated(makeActor(), makeActor(), ['Infantry']),
      ).not.toThrow()
    })

    it('queues proxy actor creation on frame end when types match', () => {
      let createdActor = ''
      let createdOwner: unknown = null

      const world = {
        addFrameEndTask(task: (w: unknown) => void) {
          task({
            createActor(name: string, init: unknown[]) {
              createdActor = name
              createdOwner = (init[0] as { owner: unknown }).owner
            },
          })
        },
      }

      const info = new InfiltrateForSupportPowerInfo({
        proxy: 'spyPlane',
        types: ['Building'],
      })
      const trait = new InfiltrateForSupportPower(info)

      const owner = {}
      const infiltrator = makeActor({
        owner,
        world,
      })

      trait.infiltrated(makeActor(), infiltrator, ['Building'])
      expect(createdActor).toBe('spyPlane')
      expect(createdOwner).toBe(owner)
    })

    it('grants experience to infiltrating player', () => {
      let xpGiven = 0
      const playerExp = { giveExperience(xp: number) { xpGiven = xp } }
      const owner = {
        playerActor: {
          getTrait: () => playerExp,
        },
      }
      const world = {
        addFrameEndTask(fn: (w: unknown) => void) { fn({ createActor() {} }) },
      }

      const info = new InfiltrateForSupportPowerInfo({
        proxy: 'power',
        types: ['Building'],
        playerExperience: 30,
      })
      const trait = new InfiltrateForSupportPower(info)
      const infiltrator = makeActor({ owner, world })

      trait.infiltrated(makeActor(), infiltrator, ['Building'])
      expect(xpGiven).toBe(30)
    })
  })
})
