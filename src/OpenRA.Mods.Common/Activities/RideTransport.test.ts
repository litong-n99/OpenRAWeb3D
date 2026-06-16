/**
 * RideTransport.test.ts — RideTransport 活动单元测试
 *
 * 测试重点:
 * - TryStartEnter: Cargo 可用性检查、Aircraft 高度等待
 * - TickInner: Cargo 禁用时取消
 * - OnEnterComplete: 装入 cargo、移除 actor
 * - OnLastRun/Cancel: 取消 Passenger 预留
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Vector3: class {} }))

import { RideTransport } from './RideTransport.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: {
  isDead?: boolean
  hasPassenger?: boolean
  hasCargo?: boolean
  cargoDisabled?: boolean
  hasAircraft?: boolean
  atLandAltitude?: boolean
} = {}): GameActor {
  const {
    isDead = false,
    hasPassenger = true,
    hasCargo = true,
    cargoDisabled = false,
    hasAircraft = false,
    atLandAltitude = true,
  } = overrides

  const traits = new Map<string, unknown>()

  if (hasPassenger) {
    traits.set('Passenger', {
      reserve: vi.fn(() => true),
      unreserve: vi.fn(),
      info: { cargoType: 'Infantry', weight: 1, targetLineColor: { r: 0, g: 1, b: 0, a: 1 } },
    })
  }

  if (hasCargo) {
    traits.set('Cargo', {
      isTraitDisabled: cargoDisabled,
      canLoad: vi.fn(() => true),
      load: vi.fn(),
      unload: vi.fn(),
      info: { maxWeight: 10, types: ['Infantry'] },
    })
  }

  if (hasAircraft) {
    traits.set('Aircraft', { atLandAltitude, hasInfluence: vi.fn(() => true) })
  }

  // IMove for Enter base
  traits.set('Mobile', {
    moveToTarget: vi.fn(() => ({ tick: () => true })),
    moveIntoTarget: vi.fn(() => ({ tick: () => true })),
    returnToCell: vi.fn(() => ({ tick: () => true })),
    canEnterTargetNow: vi.fn(() => true),
  })

  const frameEndActions: (() => void)[] = []
  const removedActors: unknown[] = []

  return {
    actorId: 1,
    isInWorld: true,
    isDead,
    disposed: false,
    generation: 0,
    owner: { playerName: 'Test', relationshipWith: vi.fn(() => 4) },
    centerPosition: new WPos(0, 0, 0),
    location: new CPos(5, 5),
    traits,
    world: {
      queueFrameEndAction: vi.fn((action: () => void) => { frameEndActions.push(action) }),
      removeActor: vi.fn((a: unknown) => { removedActors.push(a) }),
      sharedRandom: { next: vi.fn(() => 0.5) },
    },
    _frameEndActions: frameEndActions,
    _removedActors: removedActors,
  } as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RideTransport', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('construction', () => {
    it('stores Passenger trait', () => {
      const actor = createMockActor()
      const target = Target.fromCell(new CPos(10, 10))
      const activity = new RideTransport(actor, target)

      expect(activity).toBeDefined()
    })

    it('throws without Passenger trait', () => {
      const actor = createMockActor({ hasPassenger: false })
      const target = Target.fromCell(new CPos(10, 10))

      expect(() => new RideTransport(actor, target)).toThrow('Passenger')
    })
  })

  describe('tryStartEnter', () => {
    it('cancels if target has no Cargo trait', () => {
      const self = createMockActor()
      const targetActor = createMockActor({ hasCargo: false })
      const activity = new RideTransport(self, Target.fromCell(new CPos(10, 10)))

      // Call through the protected method's context
      const cancelSpy = vi.spyOn(activity, 'cancel')
      const result = activity['tryStartEnter'](self, targetActor)

      expect(result).toBe(false)
      expect(cancelSpy).toHaveBeenCalled()
    })

    it('cancels if Cargo is disabled', () => {
      const self = createMockActor()
      const targetActor = createMockActor({ cargoDisabled: true })
      const activity = new RideTransport(self, Target.fromCell(new CPos(10, 10)))

      const cancelSpy = vi.spyOn(activity, 'cancel')
      const result = activity['tryStartEnter'](self, targetActor)

      expect(result).toBe(false)
      expect(cancelSpy).toHaveBeenCalled()
    })

    it('reserves space when Cargo is available', () => {
      const self = createMockActor()
      const targetActor = createMockActor()
      const activity = new RideTransport(self, Target.fromCell(new CPos(10, 10)))

      const result = activity['tryStartEnter'](self, targetActor)

      expect(result).toBe(true)
      const passenger = (self as unknown as { traits: Map<string, unknown> }).traits.get('Passenger') as { reserve: ReturnType<typeof vi.fn> }
      expect(passenger.reserve).toHaveBeenCalled()
    })

    it('returns false if aircraft not at land altitude', () => {
      const self = createMockActor()
      const targetActor = createMockActor({ hasAircraft: true, atLandAltitude: false })
      const activity = new RideTransport(self, Target.fromCell(new CPos(10, 10)))

      const result = activity['tryStartEnter'](self, targetActor)

      expect(result).toBe(false)
    })
  })

  describe('tickInner', () => {
    it('cancels if enterCargo becomes disabled', () => {
      const self = createMockActor()
      const targetActor = createMockActor()
      const activity = new RideTransport(self, Target.fromCell(new CPos(10, 10)))
      // Pre-set enterCargo
      ;(activity as unknown as Record<string, unknown>).enterCargo = (targetActor as unknown as { traits: Map<string, unknown> }).traits.get('Cargo')

      const cancelSpy = vi.spyOn(activity, 'cancel')
      activity['tickInner'](self, Target.fromCell(new CPos(10, 10)), false)

      expect(cancelSpy).toHaveBeenCalledTimes(0) // Cargo is not disabled by default

      // Now disable cargo
      const cargo = (targetActor as unknown as { traits: Map<string, unknown> }).traits.get('Cargo') as { isTraitDisabled: boolean }
      cargo.isTraitDisabled = true
      // Re-set enterCargo to the now-disabled one
      ;(activity as unknown as Record<string, unknown>).enterCargo = cargo

      activity['tickInner'](self, Target.fromCell(new CPos(10, 10)), false)
      expect(cancelSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('onEnterComplete', () => {
    it('loads passenger into cargo via frame end action', () => {
      const self = createMockActor()
      const targetActor = createMockActor()
      const activity = new RideTransport(self, Target.fromCell(new CPos(10, 10)))
      ;(activity as unknown as Record<string, unknown>).enterActor = targetActor
      ;(activity as unknown as Record<string, unknown>).enterCargo = (targetActor as unknown as { traits: Map<string, unknown> }).traits.get('Cargo')
      ;(activity as unknown as Record<string, unknown>).enterAircraft = null

      activity['onEnterComplete'](self, targetActor)

      const world = (self as unknown as { world: { queueFrameEndAction: ReturnType<typeof vi.fn> } }).world
      expect(world.queueFrameEndAction).toHaveBeenCalled()
    })
  })

  describe('onLastRun', () => {
    it('unreserves passenger', () => {
      const self = createMockActor()
      const activity = new RideTransport(self, Target.fromCell(new CPos(10, 10)))

      activity['onLastRun'](self)

      const passenger = (self as unknown as { traits: Map<string, unknown> }).traits.get('Passenger') as { unreserve: ReturnType<typeof vi.fn> }
      expect(passenger.unreserve).toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('unreserves passenger on cancel', () => {
      const self = createMockActor()
      const activity = new RideTransport(self, Target.fromCell(new CPos(10, 10)))

      activity.cancel(self)

      const passenger = (self as unknown as { traits: Map<string, unknown> }).traits.get('Passenger') as { unreserve: ReturnType<typeof vi.fn> }
      expect(passenger.unreserve).toHaveBeenCalled()
    })
  })
})
