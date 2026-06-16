/**
 * DonateExperience.test.ts — DonateExperience 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DonateExperience } from './DonateExperience.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { GainsExperienceLike } from './UtilityActivityInterfaces.js'

function createSelfActor(): GameActor {
  const playerExp = { giveExperience: vi.fn() }
  const playerActor = {
    actorId: 999,
    isInWorld: true,
    traits: new Map([['PlayerExperience', playerExp]]),
  } as unknown as GameActor

  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    dispose: vi.fn(),
    owner: { playerActor },
  } as unknown as GameActor
}

function createTargetActor(overrides: { maxLevel?: number; level?: number } = {}): {
  actor: GameActor
  gainsXP: GainsExperienceLike
} {
  const { maxLevel = 10, level = 0 } = overrides
  const gainsXP = {
    level,
    maxLevel,
    giveLevels: vi.fn(),
  } satisfies GainsExperienceLike

  const traits = new Map<string, unknown>()
  traits.set('GainsExperience', gainsXP)

  return {
    actor: {
      actorId: 2,
      isInWorld: true,
      isDead: false,
      owner: { playerName: 'Target' },
      traits,
    } as unknown as GameActor,
    gainsXP,
  }
}

describe('DonateExperience', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('constructs with level and playerExperience', () => {
    const self = createSelfActor()
    const activity = new DonateExperience(self, Target.fromCell(new CPos(10, 10)), 1, 50)
    expect(activity).toBeDefined()
  })

  it('tryStartEnter succeeds when target has GainsExperience below max', () => {
    const self = createSelfActor()
    const { actor: target } = createTargetActor({ level: 3, maxLevel: 10 })
    const activity = new DonateExperience(self, Target.fromCell(new CPos(10, 10)), 1, 50)

    const result = activity['tryStartEnter'](self, target)
    expect(result).toBe(true)
  })

  it('tryStartEnter cancels when target is at max level', () => {
    const self = createSelfActor()
    const { actor: target } = createTargetActor({ level: 10, maxLevel: 10 })
    const activity = new DonateExperience(self, Target.fromCell(new CPos(10, 10)), 1, 50)

    const cancelSpy = vi.spyOn(activity, 'cancel')
    const result = activity['tryStartEnter'](self, target)
    expect(result).toBe(false)
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('onEnterComplete gives levels and disposes self', () => {
    const self = createSelfActor()
    const { actor: target, gainsXP } = createTargetActor({ level: 3, maxLevel: 10 })
    const activity = new DonateExperience(self, Target.fromCell(new CPos(10, 10)), 2, 50)

    // Set up enter state
    ;(activity as unknown as Record<string, unknown>).enterActor = target
    ;(activity as unknown as Record<string, unknown>).enterGainsExperience = gainsXP

    activity['onEnterComplete'](self, target)
    expect(gainsXP.giveLevels).toHaveBeenCalledWith(2)
    expect((self as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled()
  })
})
