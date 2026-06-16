/**
 * RepairBridge.test.ts — RepairBridge 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RepairBridge } from './RepairBridge.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import {
  EnterBehaviour,
  DamageState,
  type BridgeHutLike,
} from './UtilityActivityInterfaces.js'

function createSelfActor(): GameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    dispose: vi.fn(),
    kill: vi.fn(),
    owner: { playerName: 'Test' },
    traits: new Map(),
  } as unknown as GameActor
}

function createBridgeHutActor(damaged: boolean = true, isRepairing: boolean = false): {
  actor: GameActor
  hut: BridgeHutLike
} {
  const hut = {
    bridgeDamageState: damaged ? DamageState.Heavy : DamageState.Undamaged,
    repairing: isRepairing,
    repair: vi.fn(),
  } satisfies BridgeHutLike

  const traits = new Map<string, unknown>()
  traits.set('BridgeHut', hut)

  return {
    actor: {
      actorId: 2,
      isInWorld: true,
      isDead: false,
      traits,
    } as unknown as GameActor,
    hut,
  }
}

describe('RepairBridge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('constructs with valid params', () => {
    const self = createSelfActor()
    const activity = new RepairBridge(
      self, Target.fromCell(new CPos(10, 10)),
      EnterBehaviour.Dispose, 'Speech', 'Text', { r: 1, g: 0, b: 0, a: 1 },
    )
    expect(activity).toBeDefined()
  })

  it('tryStartEnter succeeds when bridge hut is damaged', () => {
    const self = createSelfActor()
    const { actor: target } = createBridgeHutActor(true, false)
    const activity = new RepairBridge(
      self, Target.fromCell(new CPos(10, 10)),
      EnterBehaviour.Dispose, '', '', { r: 1, g: 0, b: 0, a: 1 },
    )

    const result = activity['tryStartEnter'](self, target)
    expect(result).toBe(true)
  })

  it('tryStartEnter cancels when bridge is undamaged', () => {
    const self = createSelfActor()
    const { actor: target } = createBridgeHutActor(false, false)
    const activity = new RepairBridge(
      self, Target.fromCell(new CPos(10, 10)),
      EnterBehaviour.Dispose, '', '', { r: 1, g: 0, b: 0, a: 1 },
    )

    const cancelSpy = vi.spyOn(activity, 'cancel')
    const result = activity['tryStartEnter'](self, target)
    expect(result).toBe(false)
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('onEnterComplete repairs and disposes', () => {
    const self = createSelfActor()
    const { actor: target, hut } = createBridgeHutActor(true, false)
    const activity = new RepairBridge(
      self, Target.fromCell(new CPos(10, 10)),
      EnterBehaviour.Dispose, '', '', { r: 1, g: 0, b: 0, a: 1 },
    )

    // Set up enter state
    ;(activity as unknown as Record<string, unknown>).enterActor = target
    ;(activity as unknown as Record<string, unknown>).enterHut = hut
    ;(activity as unknown as Record<string, unknown>).enterLegacyHut = null

    activity['onEnterComplete'](self, target)
    expect(hut.repair).toHaveBeenCalledWith(self)
    expect((self as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled()
  })

  it('onEnterComplete kills self when Suicide behaviour', () => {
    const self = createSelfActor()
    const { actor: target, hut } = createBridgeHutActor(true, false)
    const activity = new RepairBridge(
      self, Target.fromCell(new CPos(10, 10)),
      EnterBehaviour.Suicide, '', '', { r: 1, g: 0, b: 0, a: 1 },
    )

    ;(activity as unknown as Record<string, unknown>).enterActor = target
    ;(activity as unknown as Record<string, unknown>).enterHut = hut
    ;(activity as unknown as Record<string, unknown>).enterLegacyHut = null

    activity['onEnterComplete'](self, target)
    expect((self as unknown as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalled()
  })
})
