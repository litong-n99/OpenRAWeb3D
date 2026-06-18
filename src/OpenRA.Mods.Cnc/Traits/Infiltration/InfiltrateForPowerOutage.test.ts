/**
 * InfiltrateForPowerOutage.test.ts — unit tests for InfiltrateForPowerOutage
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  InfiltrateForPowerOutage,
  InfiltrateForPowerOutageInfo,
} from './InfiltrateForPowerOutage.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeActor(
  overrides: Partial<{ owner: unknown }> = {},
): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    ...overrides,
  } as unknown as IGameActor
}

describe('InfiltrateForPowerOutage', () => {
  describe('InfiltrateForPowerOutageInfo', () => {
    it('has correct defaults', () => {
      const info = new InfiltrateForPowerOutageInfo()
      expect(info.duration).toBe(500)
      expect(info.types).toEqual([])
      expect(info.playerExperience).toBe(0)
    })

    it('accepts sound notification fields', () => {
      const info = new InfiltrateForPowerOutageInfo({
        infiltratedNotification: 'PowerOutageSound',
        infiltratedTextNotification: 'Power outage detected!',
        infiltrationNotification: 'InfiltrationSound',
        infiltrationTextNotification: 'Power sabotaged successfully.',
      })
      expect(info.infiltratedNotification).toBe('PowerOutageSound')
      expect(info.infiltratedTextNotification).toBe('Power outage detected!')
      expect(info.infiltrationNotification).toBe('InfiltrationSound')
      expect(info.infiltrationTextNotification).toBe('Power sabotaged successfully.')
    })
  })

  describe('init', () => {
    it('caches PowerManager from owner player actor', () => {
      let triggered = false
      let triggerDuration = 0
      const powerManager = {
        triggerPowerOutage(d: number) { triggered = true; triggerDuration = d },
      }

      const info = new InfiltrateForPowerOutageInfo({ types: ['Building'] })
      const trait = new InfiltrateForPowerOutage(info)
      const self = makeActor({
        owner: {
          playerActor: {
            getTrait: () => powerManager,
          },
        },
      })

      trait.init(self)
      trait.infiltrated(self, makeActor({
        owner: {
          playerActor: { getTrait: () => ({ giveExperience() {} }) },
        },
      }), ['Building'])

      expect(triggered).toBe(true)
      expect(triggerDuration).toBe(500)
    })
  })

  describe('onOwnerChanged', () => {
    it('refreshes PowerManager reference', () => {
      const info = new InfiltrateForPowerOutageInfo()
      const trait = new InfiltrateForPowerOutage(info)

      const pm1 = { triggerPowerOutage() {} }
      trait.init(makeActor({
        owner: { playerActor: { getTrait: () => pm1 } },
      }))

      expect(() => trait.onOwnerChanged(makeActor({
        owner: { playerActor: { getTrait: () => pm1 } },
      }))).not.toThrow()
    })
  })

  describe('infiltrated', () => {
    it('skips when types do not overlap', () => {
      const info = new InfiltrateForPowerOutageInfo({ types: ['Building'] })
      const trait = new InfiltrateForPowerOutage(info)

      expect(() =>
        trait.infiltrated(makeActor(), makeActor(), ['Infantry']),
      ).not.toThrow()
    })
  })
})
