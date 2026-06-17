/**
 * InfiltrateForSupportPowerReset.test.ts — unit tests for support power reset
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Engine: vi.fn(), Scene: vi.fn() }))

import {
  InfiltrateForSupportPowerReset,
  InfiltrateForSupportPowerResetInfo,
} from './InfiltrateForSupportPowerReset.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeActor(ownerOverride?: unknown): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    owner: ownerOverride,
  } as unknown as IGameActor
}

describe('InfiltrateForSupportPowerReset', () => {
  it('resets all non-disabled support powers on infiltrated actor', () => {
    const resetCalls: string[] = []
    const manager = {
      getPowersForActor(_actor: IGameActor) {
        return [
          { disabled: false, resetTimer() { resetCalls.push('power1') } },
          { disabled: true, resetTimer() { resetCalls.push('power2-disabled') } },
          { disabled: false, resetTimer() { resetCalls.push('power3') } },
        ]
      },
    }

    const info = new InfiltrateForSupportPowerResetInfo({
      types: ['Building'],
      playerExperience: 0,
    })
    const trait = new InfiltrateForSupportPowerReset(info)

    const owner = {
      playerActor: {
        getTrait: (name: string) => {
          if (name === 'SupportPowerManager') return manager
          if (name === 'PlayerExperience') return { giveExperience() {} }
          return undefined
        },
      },
    }

    const self = makeActor(owner)
    const infiltrator = makeActor({
      playerActor: {
        getTrait: (name: string) => {
          if (name === 'PlayerExperience') return { giveExperience() {} }
          return undefined
        },
      },
    })

    trait.infiltrated(self, infiltrator, ['Building'])
    expect(resetCalls).toEqual(['power1', 'power3'])
  })

  it('skips when types do not overlap', () => {
    const info = new InfiltrateForSupportPowerResetInfo({ types: ['Building'] })
    const trait = new InfiltrateForSupportPowerReset(info)
    expect(() =>
      trait.infiltrated(makeActor(), makeActor(), ['Infantry']),
    ).not.toThrow()
  })
})
