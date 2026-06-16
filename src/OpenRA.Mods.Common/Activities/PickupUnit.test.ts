/**
 * PickupUnit.test.ts — PickupUnit 活动单元测试
 *
 * 测试重点:
 * - 构造: 需要 Carryall + Carryable
 * - OnFirstRun: reserve/skip when dead, disabled, or unfriendly
 * - Tick: Intercept→LockCarryable→Pickup 状态转换
 * - Cancel: unreserve during Reserved state
 * - AttachUnit: 帧末从世界移除 cargo 并附加到 carryall
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Vector3: class {} }))

import { PickupUnit } from './PickupUnit.js'
import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import {
  LockResponse,
  CarryallState,
} from './TransportActivityInterfaces.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// Stub activity for testing
// ---------------------------------------------------------------------------

class StubActivity extends Activity {
  override tick(): boolean { return true }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSelfActor(overrides: {
  carryallDisabled?: boolean
  reserveResult?: boolean
  carryingActor?: GameActor | null
} = {}): {
  actor: GameActor
  carryall: {
    isTraitDisabled: boolean
    state: number
    carryable: GameActor | null
    reserveCarryable: ReturnType<typeof vi.fn>
    unreserveCarryable: ReturnType<typeof vi.fn>
    attachCarryable: ReturnType<typeof vi.fn>
    detachCarryable: ReturnType<typeof vi.fn>
    offsetForCarryable: ReturnType<typeof vi.fn>
    info: { beforeLoadDelay: number; beforeUnloadDelay: number; pickUpDelay: number }
  }
} {
  const {
    carryallDisabled = false,
    reserveResult = true,
    carryingActor = null,
  } = overrides

  const carryall = {
    isTraitDisabled: carryallDisabled,
    state: carryingActor !== null ? CarryallState.Carrying : CarryallState.Idle,
    carryable: carryingActor,
    reserveCarryable: vi.fn(() => reserveResult),
    unreserveCarryable: vi.fn(),
    attachCarryable: vi.fn(),
    detachCarryable: vi.fn(),
    offsetForCarryable: vi.fn(() => WVec.Zero),
    info: { beforeLoadDelay: 0, beforeUnloadDelay: 0, pickUpDelay: 0 },
  }

  const traits = new Map<string, unknown>()
  traits.set('Carryall', carryall)
  traits.set('BodyOrientation', { quantizeOrientation: vi.fn((a: WAngle) => a), localToWorld: vi.fn((v: WVec) => v) })

  const frameEndActions: (() => void)[] = []

  return {
    actor: {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      generation: 0,
      orientation: WAngle.Zero,
      centerPosition: new WPos(0, 0, 0),
      location: new CPos(5, 5),
      owner: { playerName: 'Test', relationshipWith: vi.fn(() => 4) }, // Ally
      traits,
      world: {
        queueFrameEndAction: vi.fn((action: () => void) => { frameEndActions.push(action) }),
        removeActor: vi.fn(),
      },
      _frameEndActions: frameEndActions,
    } as unknown as GameActor,
    carryall,
  }
}

function createCargoActor(overrides: {
  isDead?: boolean
  carryableDisabled?: boolean
  lockResponse?: number
} = {}): {
  actor: GameActor
  carryable: {
    isTraitDisabled: boolean
    lockForPickup: ReturnType<typeof vi.fn>
    reserved: ReturnType<typeof vi.fn>
    unreserve: ReturnType<typeof vi.fn>
    attached: ReturnType<typeof vi.fn>
    detached: ReturnType<typeof vi.fn>
  }
} {
  const {
    isDead = false,
    carryableDisabled = false,
    lockResponse = LockResponse.Success,
  } = overrides

  const carryable = {
    isTraitDisabled: carryableDisabled,
    lockForPickup: vi.fn(() => lockResponse),
    reserved: vi.fn(),
    unreserve: vi.fn(),
    attached: vi.fn(),
    detached: vi.fn(),
  }

  const traits = new Map<string, unknown>()
  traits.set('Carryable', carryable)

  return {
    actor: {
      actorId: 100,
      isInWorld: true,
      isDead,
      generation: 0,
      centerPosition: new WPos(5 * 1024, 5 * 1024, 0),
      location: new CPos(5, 5),
      owner: { playerName: 'Ally' },
      traits,
      world: {
        queueFrameEndAction: vi.fn(),
        removeActor: vi.fn(),
      },
    } as unknown as GameActor,
    carryable,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PickupUnit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    PickupUnit._flyFactory = null
    PickupUnit._flyIdleFactory = null
    PickupUnit._landFactory = null
    PickupUnit._waitFactory = null
    PickupUnit._takeOffFactory = null
  })

  describe('construction', () => {
    it('throws without Carryall trait', () => {
      const selfActor = createSelfActor().actor
      // Remove Carryall
      ;(selfActor as unknown as { traits: Map<string, unknown> }).traits.delete('Carryall')
      const cargoActor = createCargoActor().actor

      expect(() => new PickupUnit(selfActor, cargoActor, 0)).toThrow('Carryall')
    })

    it('throws without Carryable trait', () => {
      const selfActor = createSelfActor().actor
      const cargoActor = createCargoActor().actor
      ;(cargoActor as unknown as { traits: Map<string, unknown> }).traits.delete('Carryable')

      expect(() => new PickupUnit(selfActor, cargoActor, 0)).toThrow('Carryable')
    })

    it('constructs successfully with valid traits', () => {
      const self = createSelfActor().actor
      const cargo = createCargoActor().actor

      const activity = new PickupUnit(self, cargo, 0)
      expect(activity).toBeDefined()
    })
  })

  describe('onFirstRun', () => {
    it('sets reserveFailed and returns when cargo is dead', () => {
      const self = createSelfActor().actor
      const { actor: cargo } = createCargoActor({ isDead: true })

      const activity = new PickupUnit(self, cargo, 0)
      activity['onFirstRun'](self)

      expect(activity['reserveFailed']).toBe(true)
    })

    it('sets reserveFailed and returns when carryable is disabled', () => {
      const self = createSelfActor().actor
      const { actor: cargo } = createCargoActor({ carryableDisabled: true })

      const activity = new PickupUnit(self, cargo, 0)
      activity['onFirstRun'](self)

      expect(activity['reserveFailed']).toBe(true)
    })

    it('sets reserveFailed and returns when carryall is disabled', () => {
      const { actor: self } = createSelfActor({ carryallDisabled: true })
      const { actor: cargo } = createCargoActor()

      const activity = new PickupUnit(self, cargo, 0)
      activity['onFirstRun'](self)

      expect(activity['reserveFailed']).toBe(true)
    })

    it('calls reserveCarryable when all valid', () => {
      const { actor: self, carryall } = createSelfActor()
      const { actor: cargo } = createCargoActor()

      PickupUnit._flyFactory = () => new StubActivity()
      PickupUnit._flyIdleFactory = () => new StubActivity()

      const activity = new PickupUnit(self, cargo, 0)
      activity['onFirstRun'](self)

      expect(carryall.reserveCarryable).toHaveBeenCalledWith(self, cargo)
    })

    it('sets reserveFailed when reserveCarryable returns false', () => {
      const { actor: self } = createSelfActor({ reserveResult: false })
      const { actor: cargo } = createCargoActor()

      const activity = new PickupUnit(self, cargo, 0)
      activity['onFirstRun'](self)

      expect(activity['reserveFailed']).toBe(true)
    })

    it('queues fly and flyIdle child activities', () => {
      const { actor: self } = createSelfActor()
      const { actor: cargo } = createCargoActor()

      const flyCalls: unknown[] = []
      const flyIdleCalls: unknown[] = []

      PickupUnit._flyFactory = (s, t) => { flyCalls.push({ s, t }); return new StubActivity() }
      PickupUnit._flyIdleFactory = (s, idle) => { flyIdleCalls.push({ s, idle }); return new StubActivity() }

      const activity = new PickupUnit(self, cargo, 0)
      activity['onFirstRun'](self)

      expect(flyCalls.length).toBe(1)
      expect(flyIdleCalls.length).toBe(1)
    })
  })

  describe('tick', () => {
    it('returns true when reserveFailed', () => {
      const { actor: self } = createSelfActor()
      const { actor: cargo } = createCargoActor()

      const activity = new PickupUnit(self, cargo, 0)
      activity['reserveFailed'] = true

      expect(activity.tick(self)).toBe(true)
    })

    it('returns false when cargo becomes dead during tick', () => {
      const { actor: self } = createSelfActor()
      const { actor: cargo } = createCargoActor()

      const activity = new PickupUnit(self, cargo, 0)
      // Mangle cargo to appear dead
      ;(cargo as unknown as { isDead: boolean }).isDead = true

      const cancelSpy = vi.spyOn(activity, 'cancel')
      const result = activity.tick(self)
      expect(cancelSpy).toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('returns false when carryable becomes disabled during tick', () => {
      const { actor: self } = createSelfActor()
      const { actor: cargo, carryable } = createCargoActor()

      const activity = new PickupUnit(self, cargo, 0)
      carryable.isTraitDisabled = true

      const cancelSpy = vi.spyOn(activity, 'cancel')
      const result = activity.tick(self)
      expect(cancelSpy).toHaveBeenCalled()
      expect(result).toBe(false)
    })
  })

  describe('cancel', () => {
    it('unreserves if in Reserved state', () => {
      const { actor: self, carryall } = createSelfActor()
      const { actor: cargo } = createCargoActor()

      carryall.state = CarryallState.Reserved

      const activity = new PickupUnit(self, cargo, 0)
      activity.cancel(self)

      expect(carryall.unreserveCarryable).toHaveBeenCalledWith(self)
    })

    it('does not unreserve if not in Reserved state', () => {
      const { actor: self, carryall } = createSelfActor()
      const { actor: cargo } = createCargoActor()

      carryall.state = CarryallState.Carrying // 2

      const activity = new PickupUnit(self, cargo, 0)
      activity.cancel(self)

      expect(carryall.unreserveCarryable).not.toHaveBeenCalled()
    })
  })
})
