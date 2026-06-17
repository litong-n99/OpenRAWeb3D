/**
 * InfiltrateForExploration.test.ts — unit tests for InfiltrateForExploration
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  InfiltrateForExploration,
  InfiltrateForExplorationInfo,
} from './InfiltrateForExploration.js'
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

describe('InfiltrateForExploration', () => {
  describe('InfiltrateForExplorationInfo', () => {
    it('has correct defaults', () => {
      const info = new InfiltrateForExplorationInfo()
      expect(info.types).toEqual([])
      expect(info.playerExperience).toBe(0)
      expect(info.infiltratedNotification).toBeNull()
    })
  })

  describe('infiltrated', () => {
    it('skips when types do not overlap', () => {
      const info = new InfiltrateForExplorationInfo({ types: ['Building'] })
      const trait = new InfiltrateForExploration(info)

      expect(() =>
        trait.infiltrated(makeActor(), makeActor(), ['Infantry']),
      ).not.toThrow()
    })

    it('steals and resets exploration when types match', () => {
      let exploreCalled = false
      let resetCalled = false
      let exploreTarget: unknown = null

      const selfShroud = {
        explore(other: unknown) { exploreCalled = true; exploreTarget = other },
        resetExploration() { resetCalled = true },
      }
      const infiltratorShroud = {
        explore(_other: unknown) {},
      }

      const info = new InfiltrateForExplorationInfo({
        types: ['Building'],
        playerExperience: 10,
      })

      const trait = new InfiltrateForExploration(info)

      const self = makeActor({
        owner: {
          shroud: selfShroud,
          playerActor: {
            traitsImplementing: () => [],
          },
        },
      })
      const infiltrator = makeActor({
        owner: {
          shroud: infiltratorShroud,
          playerActor: {
            getTrait: () => ({ giveExperience() {} }),
          },
        },
      })

      trait.infiltrated(self, infiltrator, ['Building'])
      expect(exploreCalled).toBe(true)
      expect(exploreTarget).toBe(selfShroud)
      expect(resetCalled).toBe(true)
    })

    it('does not reset exploration when prevented', () => {
      let resetCalled = false

      const selfShroud = {
        explore() {},
        resetExploration() { resetCalled = true },
      }
      const infiltratorShroud = {
        explore() {},
      }

      const info = new InfiltrateForExplorationInfo({ types: ['Building'] })
      const trait = new InfiltrateForExploration(info)

      const self = makeActor({
        owner: {
          shroud: selfShroud,
          playerActor: {
            traitsImplementing: () => [{
              preventShroudReset: () => true,
            }],
          },
        },
      })
      const infiltrator = makeActor({
        owner: {
          shroud: infiltratorShroud,
          playerActor: {
            getTrait: () => ({ giveExperience() {} }),
          },
        },
      })

      trait.infiltrated(self, infiltrator, ['Building'])
      expect(resetCalled).toBe(false)
    })
  })
})
