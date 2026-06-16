/**
 * InstantRepair.test.ts — InstantRepair 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InstantRepair } from './InstantRepair.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import {
  EnterBehaviour,
  DamageState,
  type IHealthLike,
  type InstantlyRepairableLike,
  type InstantlyRepairsInfoLike,
} from './UtilityActivityInterfaces.js'

function createSelfActor(): GameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    dispose: vi.fn(),
    kill: vi.fn(),
    owner: { relationshipWith: vi.fn(() => 4), playerName: 'Test' },
  } as unknown as GameActor
}

function createTargetActor(damaged: boolean = true, repairableDisabled: boolean = false): {
  actor: GameActor
  health: IHealthLike
} {
  const health = {
    damageState: damaged ? DamageState.Heavy : DamageState.Undamaged,
    hp: damaged ? 50 : 100,
    maxHP: 100,
    isDead: false,
  } satisfies IHealthLike

  const repairable = {
    isTraitDisabled: repairableDisabled,
  } satisfies InstantlyRepairableLike

  const traits = new Map<string, unknown>()
  traits.set('IHealth', health)
  traits.set('InstantlyRepairable', repairable)
  traits.set('inflictDamage', vi.fn())

  return {
    actor: {
      actorId: 2,
      isInWorld: true,
      isDead: false,
      owner: { playerName: 'Target' },
      traits,
      inflictDamage: vi.fn(),
    } as unknown as GameActor,
    health,
  }
}

function createRepairInfo(): InstantlyRepairsInfoLike {
  return {
    validRelationships: { hasRelationship: vi.fn(() => true) },
    repairSound: 'repair.wav',
    enterBehaviour: EnterBehaviour.Dispose,
  }
}

describe('InstantRepair', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('constructs with repair info', () => {
    const self = createSelfActor()
    const info = createRepairInfo()
    const activity = new InstantRepair(self, Target.fromCell(new CPos(10, 10)), info)
    expect(activity).toBeDefined()
  })

  it('tryStartEnter succeeds when target is damaged', () => {
    const self = createSelfActor()
    const { actor: target } = createTargetActor(true, false)
    const info = createRepairInfo()
    const activity = new InstantRepair(self, Target.fromCell(new CPos(10, 10)), info)

    const result = activity['tryStartEnter'](self, target)
    expect(result).toBe(true)
  })

  it('tryStartEnter cancels when target is undamaged', () => {
    const self = createSelfActor()
    const { actor: target } = createTargetActor(false, false)
    const info = createRepairInfo()
    const activity = new InstantRepair(self, Target.fromCell(new CPos(10, 10)), info)

    const cancelSpy = vi.spyOn(activity, 'cancel')
    const result = activity['tryStartEnter'](self, target)
    expect(result).toBe(false)
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('onEnterComplete heals target and disposes self', () => {
    const self = createSelfActor()
    const { actor: target, health } = createTargetActor(true, false)
    const info = createRepairInfo()
    const activity = new InstantRepair(self, Target.fromCell(new CPos(10, 10)), info)

    ;(activity as unknown as Record<string, unknown>).enterActor = target
    ;(activity as unknown as Record<string, unknown>).enterHealth = health
    ;(activity as unknown as Record<string, unknown>).enterInstantlyRepariable = {
      isTraitDisabled: false,
    }

    activity['onEnterComplete'](self, target)

    const inflictFn = (target as unknown as { inflictDamage: ReturnType<typeof vi.fn> }).inflictDamage
    expect(inflictFn).toHaveBeenCalledWith(self, { value: -100 })
    expect((self as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled()
  })
})
