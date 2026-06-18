/**
 * InfiltrateForCash.test.ts — unit tests for InfiltrateForCash trait
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  InfiltrateForCash,
  InfiltrateForCashInfo,
} from './InfiltrateForCash.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeActor(
  overrides: Partial<{
    owner: {
      playerActor?: {
        getTrait?: <T>(_: string) => T | undefined
      }
    }
    info: unknown
  }> = {},
): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    ...overrides,
  } as unknown as IGameActor
}

describe('InfiltrateForCash', () => {
  describe('InfiltrateForCashInfo', () => {
    it('has correct defaults', () => {
      const info = new InfiltrateForCashInfo()
      expect(info.types).toEqual([])
      expect(info.percentage).toBe(100)
      expect(info.minimum).toBe(-1)
      expect(info.maximum).toBe(Number.MAX_SAFE_INTEGER)
      expect(info.playerExperience).toBe(0)
      expect(info.showTicks).toBe(true)
    })

    it('accepts sound notification fields', () => {
      const info = new InfiltrateForCashInfo({
        infiltratedNotification: 'InfiltratedSound',
        infiltratedTextNotification: 'Your base has been infiltrated!',
        infiltrationNotification: 'InfiltrationSound',
        infiltrationTextNotification: 'Cash stolen successfully.',
      })
      expect(info.infiltratedNotification).toBe('InfiltratedSound')
      expect(info.infiltratedTextNotification).toBe('Your base has been infiltrated!')
      expect(info.infiltrationNotification).toBe('InfiltrationSound')
      expect(info.infiltrationTextNotification).toBe('Cash stolen successfully.')
    })
  })

  describe('infiltrated', () => {
    it('skips when types do not overlap', () => {
      const info = new InfiltrateForCashInfo({ types: ['Building'] })
      const trait = new InfiltrateForCash(info)
      const self = makeActor()
      const infiltrator = makeActor()

      expect(() =>
        trait.infiltrated(self, infiltrator, ['Infantry']),
      ).not.toThrow()
    })

    it('transfers cash between players', () => {
      const info = new InfiltrateForCashInfo({
        types: ['Building'],
        percentage: 50,
        minimum: 0,
      })

      let taken = 0
      let given = 0

      const targetResources = {
        cash: 1000,
        resources: 0,
        takeCash(n: number) { taken = n },
        giveCash(n: number) { given = n },
      }
      const spyResources = {
        cash: 0,
        resources: 0,
        takeCash() {},
        giveCash(n: number) { given = n },
      }
      const playerExp = {
        giveExperience(_xp: number) {},
      }

      const trait = new InfiltrateForCash(info)
      const getTrait = (res: unknown, exp: unknown) => (name: string) => {
        if (name === 'PlayerResources') return res
        if (name === 'PlayerExperience') return exp
        return undefined
      }

      const self = makeActor({
        owner: {
          playerActor: {
            getTrait: getTrait(targetResources, null),
          } as unknown as IGameActor & { getTrait: <T>(_: string) => T | undefined },
        },
      })
      const infiltrator = makeActor({
        owner: {
          playerActor: {
            getTrait: getTrait(spyResources, playerExp),
          } as unknown as IGameActor & { getTrait: <T>(_: string) => T | undefined },
        },
      })

      trait.infiltrated(self, infiltrator, ['Building'])
      expect(taken).toBe(500) // 50% of 1000
      expect(given).toBe(500)
    })

    it('uses minimum payout when percentage-based is lower', () => {
      const info = new InfiltrateForCashInfo({
        types: ['Building'],
        percentage: 10,
        minimum: 200,
      })

      let taken = 0
      let given = 0
      const targetResources = {
        cash: 100, resources: 0,
        takeCash(n: number) { taken = n },
        giveCash(n: number) { given = n },
      }
      const spyResources = {
        cash: 0, resources: 0,
        takeCash() {},
        giveCash(n: number) { given = n },
      }
      const playerExp = { giveExperience(_xp: number) {} }

      const trait = new InfiltrateForCash(info)
      const makeOwner = (res: unknown, exp: unknown) => ({
        playerActor: {
          getTrait: (name: string) => {
            if (name === 'PlayerResources') return res
            if (name === 'PlayerExperience') return exp
            return undefined
          },
        } as unknown as IGameActor & { getTrait: <T>(_: string) => T | undefined },
      })

      const self = makeActor({ owner: makeOwner(targetResources, null) })
      const infiltrator = makeActor({ owner: makeOwner(spyResources, playerExp) })

      trait.infiltrated(self, infiltrator, ['Building'])
      expect(taken).toBe(10)
      expect(given).toBe(200)
    })

    it('grants experience', () => {
      const info = new InfiltrateForCashInfo({
        types: ['Building'],
        playerExperience: 50,
      })
      let xpGiven = 0
      const targetResources = { cash: 0, resources: 0, takeCash() {}, giveCash() {} }
      const spyResources = { cash: 0, resources: 0, takeCash() {}, giveCash() {} }
      const playerExp = { giveExperience(xp: number) { xpGiven = xp } }

      const trait = new InfiltrateForCash(info)
      const makeOwner = (res: unknown, exp: unknown) => ({
        playerActor: {
          getTrait: (name: string) => {
            if (name === 'PlayerResources') return res
            if (name === 'PlayerExperience') return exp
            return undefined
          },
        } as unknown as IGameActor & { getTrait: <T>(_: string) => T | undefined },
      })

      const self = makeActor({ owner: makeOwner(targetResources, null) })
      const infiltrator = makeActor({ owner: makeOwner(spyResources, playerExp) })

      trait.infiltrated(self, infiltrator, ['Building'])
      expect(xpGiven).toBe(50)
    })
  })
})
