/**
 * DonateCash.test.ts — DonateCash 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DonateCash } from './DonateCash.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { PlayerResourcesLike, INotifyCashTransferLike } from './UtilityActivityInterfaces.js'

function createSelfActor(): GameActor {
  const playerResources = { changeCash: vi.fn(() => 100) } satisfies PlayerResourcesLike
  const playerExp = { giveExperience: vi.fn() }
  const playerActor = {
    actorId: 999,
    isInWorld: true,
    traits: new Map<string, unknown>([['PlayerResources', playerResources], ['PlayerExperience', playerExp]]),
  } as unknown as GameActor

  const cashNotifier = {
    onAcceptingCash: vi.fn(),
    onDeliveringCash: vi.fn(),
  } satisfies INotifyCashTransferLike

  const traits = new Map<string, unknown>()
  traits.set('INotifyCashTransfer', cashNotifier)

  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    dispose: vi.fn(),
    owner: { playerActor, isAlliedWith: vi.fn(() => true) },
    traits,
  } as unknown as GameActor
}

function createTargetActor(): GameActor {
  const playerResources = { changeCash: vi.fn(() => 100) } satisfies PlayerResourcesLike
  const playerActor = {
    actorId: 998,
    isInWorld: true,
    traits: new Map<string, unknown>([['PlayerResources', playerResources]]),
  } as unknown as GameActor

  const cashNotifier = {
    onAcceptingCash: vi.fn(),
    onDeliveringCash: vi.fn(),
  } satisfies INotifyCashTransferLike

  const traits = new Map<string, unknown>()
  traits.set('INotifyCashTransfer', cashNotifier)

  return {
    actorId: 2,
    isInWorld: true,
    isDead: false,
    owner: { playerActor },
    traits,
  } as unknown as GameActor
}

describe('DonateCash', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('constructs with payload and experience', () => {
    const self = createSelfActor()
    const activity = new DonateCash(self, Target.fromCell(new CPos(10, 10)), 500, 50)
    expect(activity).toBeDefined()
  })

  it('transfers cash on onEnterComplete', () => {
    const self = createSelfActor()
    const target = createTargetActor()
    const activity = new DonateCash(self, Target.fromCell(new CPos(10, 10)), 500, 50)

    activity['onEnterComplete'](self, target)

    const pp = (target.owner as unknown as { playerActor: GameActor }).playerActor
    const pr = (pp as unknown as { traits: Map<string, unknown> }).traits.get('PlayerResources') as PlayerResourcesLike
    expect(pr.changeCash).toHaveBeenCalledWith(500)
  })

  it('disposes self after transfer', () => {
    const self = createSelfActor()
    const target = createTargetActor()
    const activity = new DonateCash(self, Target.fromCell(new CPos(10, 10)), 500, 50)

    activity['onEnterComplete'](self, target)
    expect((self as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled()
  })

  it('notifies INotifyCashTransfer on target and self', () => {
    const self = createSelfActor()
    const target = createTargetActor()
    const activity = new DonateCash(self, Target.fromCell(new CPos(10, 10)), 500, 50)

    activity['onEnterComplete'](self, target)

    const targetNotifier = (target as unknown as { traits: Map<string, unknown> }).traits.get('INotifyCashTransfer') as INotifyCashTransferLike
    const selfNotifier = (self as unknown as { traits: Map<string, unknown> }).traits.get('INotifyCashTransfer') as INotifyCashTransferLike
    expect(targetNotifier.onAcceptingCash).toHaveBeenCalled()
    expect(selfNotifier.onDeliveringCash).toHaveBeenCalled()
  })
})
