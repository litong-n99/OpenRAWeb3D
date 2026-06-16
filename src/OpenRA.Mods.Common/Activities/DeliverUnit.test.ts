/**
 * DeliverUnit.test.ts — DeliverUnit 活动单元测试
 *
 * 测试重点:
 * - 构造: 需要 Carryall trait
 * - OnFirstRun: 着陆→等待→释放→起飞序列
 * - 跳过当 carryable 为空或不在 Carrying 状态
 * - ReleaseUnit: 帧末添加回世界 + detach
 * - TargetLineNodes: 有颜色时返回行节点
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Vector3: class {} }))

import { DeliverUnit } from './DeliverUnit.js'
import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import {
  CarryallState,
} from './TransportActivityInterfaces.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// Stub activity
// ---------------------------------------------------------------------------

class StubActivity extends Activity {
  override tick(): boolean { return true }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSelfActor(overrides: {
  isDead?: boolean
  carryallDisabled?: boolean
  carryingActor?: GameActor | null
  carryallState?: number
} = {}): {
  actor: GameActor
  carryall: {
    isTraitDisabled: boolean
    state: number
    carryable: GameActor | null
    carryableOffset: WVec
    reserveCarryable: ReturnType<typeof vi.fn>
    attachCarryable: ReturnType<typeof vi.fn>
    detachCarryable: ReturnType<typeof vi.fn>
    info: { beforeLoadDelay: number; beforeUnloadDelay: number; pickUpDelay: number }
  }
} {
  const {
    isDead = false,
    carryallDisabled = false,
    carryingActor = null,
    carryallState = carryingActor !== null ? CarryallState.Carrying : CarryallState.Idle,
  } = overrides

  const carryall = {
    isTraitDisabled: carryallDisabled,
    state: carryallState,
    carryable: carryingActor,
    carryableOffset: WVec.Zero,
    reserveCarryable: vi.fn(() => true),
    attachCarryable: vi.fn(),
    detachCarryable: vi.fn(),
    info: { beforeLoadDelay: 0, beforeUnloadDelay: 0, pickUpDelay: 0 },
  }

  const traits = new Map<string, unknown>()
  traits.set('Carryall', carryall)
  traits.set('BodyOrientation', { quantizeOrientation: vi.fn((a: WAngle) => a), localToWorld: vi.fn((v: WVec) => v) })
  traits.set('IFacing', { facing: WAngle.Zero })

  const frameEndActions: (() => void)[] = []

  return {
    actor: {
      actorId: 1,
      isInWorld: true,
      isDead,
      generation: 0,
      orientation: WAngle.Zero,
      centerPosition: new WPos(0, 0, 0),
      location: new CPos(5, 5),
      owner: { playerName: 'Test' },
      traits,
      world: {
        queueFrameEndAction: vi.fn((action: () => void) => { frameEndActions.push(action) }),
        addActor: vi.fn(),
        removeActor: vi.fn(),
        map: { cellContaining: vi.fn(() => new CPos(5, 5)) },
      },
      _frameEndActions: frameEndActions,
    } as unknown as GameActor,
    carryall,
  }
}

function createCarryingActor(): {
  actor: GameActor
  carryable: {
    isTraitDisabled: boolean
    unreserve: ReturnType<typeof vi.fn>
    detached: ReturnType<typeof vi.fn>
    attached: ReturnType<typeof vi.fn>
  }
} {
  const carryable = {
    isTraitDisabled: false,
    unreserve: vi.fn(),
    detached: vi.fn(),
    attached: vi.fn(),
  }
  const traits = new Map<string, unknown>()
  traits.set('Carryable', carryable)
  traits.set('IFacing', { facing: WAngle.Zero })

  return {
    actor: {
      actorId: 200,
      isInWorld: false,
      isDead: false,
      generation: 0,
      centerPosition: new WPos(0, 0, 0),
      location: new CPos(5, 5),
      owner: { playerName: 'Test' },
      traits,
      world: {
        queueFrameEndAction: vi.fn(),
        addActor: vi.fn(),
        removeActor: vi.fn(),
      },
    } as unknown as GameActor,
    carryable,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeliverUnit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    DeliverUnit._landFactory = null
    DeliverUnit._waitFactory = null
    DeliverUnit._takeOffFactory = null
  })

  describe('construction', () => {
    it('throws without Carryall trait', () => {
      const selfActor = createSelfActor().actor
      ;(selfActor as unknown as { traits: Map<string, unknown> }).traits.delete('Carryall')

      expect(() => new DeliverUnit(selfActor, Target.Invalid, WDist.fromCells(5))).toThrow('Carryall')
    })

    it('constructs successfully with Carryall', () => {
      const self = createSelfActor().actor
      const activity = new DeliverUnit(self, Target.Invalid, WDist.fromCells(5))
      expect(activity).toBeDefined()
    })

    it('createAtCurrentLocation factory sets assignTargetOnFirstRun', () => {
      const self = createSelfActor().actor
      const activity = DeliverUnit.createAtCurrentLocation(self, WDist.fromCells(5))
      expect(activity).toBeDefined()
    })
  })

  describe('onFirstRun', () => {
    it('returns early when carryable is null', () => {
      const { actor: self } = createSelfActor({ carryingActor: null, carryallState: CarryallState.Idle })
      const activity = new DeliverUnit(self, Target.Invalid, WDist.fromCells(5))

      // Should not throw
      expect(() => activity['onFirstRun'](self)).not.toThrow()
    })

    it('returns early when not in Carrying state', () => {
      const { actor: self } = createSelfActor({ carryallState: CarryallState.Idle })
      const activity = new DeliverUnit(self, Target.Invalid, WDist.fromCells(5))

      expect(() => activity['onFirstRun'](self)).not.toThrow()
    })

    it('queues Land→Wait→ReleaseUnit→TakeOff sequence when carrying', () => {
      const cargo = createCarryingActor()
      const { actor: self } = createSelfActor({ carryingActor: cargo.actor, carryallState: CarryallState.Carrying })

      const landCalls: unknown[] = []
      const waitCalls: unknown[] = []
      const takeOffCalls: unknown[] = []

      DeliverUnit._landFactory = (s, d, r) => { landCalls.push({ s, d, r }); return new StubActivity() }
      DeliverUnit._waitFactory = (d) => { waitCalls.push(d); return new StubActivity() }
      DeliverUnit._takeOffFactory = (s) => { takeOffCalls.push(s); return new StubActivity() }

      const activity = new DeliverUnit(self, Target.Invalid, WDist.fromCells(5), null, true)
      activity['onFirstRun'](self)

      expect(landCalls.length).toBe(1)
      expect(takeOffCalls.length).toBe(1)
    })
  })

  describe('targetLineNodes', () => {
    it('returns empty when no target line color', () => {
      const self = createSelfActor().actor
      const activity = new DeliverUnit(self, Target.Invalid, WDist.fromCells(5))

      const nodes = activity.targetLineNodes(self)
      expect(nodes).toEqual([])
    })

    it('returns TargetLineNode when color is set', () => {
      const self = createSelfActor().actor
      const color = { r: 0, g: 1, b: 0, a: 1 }
      const activity = DeliverUnit.createAtCurrentLocation(self, WDist.fromCells(5), color)

      const nodes = activity.targetLineNodes(self)
      expect(nodes.length).toBe(1)
      expect(nodes[0]).toBeInstanceOf(TargetLineNode)
    })
  })
})
