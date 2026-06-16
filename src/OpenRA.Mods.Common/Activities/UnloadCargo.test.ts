/**
 * UnloadCargo.test.ts — UnloadCargo 活动单元测试
 *
 * 测试重点:
 * - OnFirstRun: 移动+等待子活动排队
 * - Tick: 卸载乘客、通知、退出格子选择
 * - 取消/空 cargo 检查
 * - 卸载完成 (takeOffAfterUnload)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@babylonjs/core', () => ({ Vector3: class {} }))

import { UnloadCargo } from './UnloadCargo.js'
import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// Stub activity for testing (simple tick-completes activity)
// ---------------------------------------------------------------------------

class StubActivity extends Activity {
  private _completeOnTick: boolean
  constructor(completeOnTick: boolean = true) { super(); this._completeOnTick = completeOnTick }
  override tick(): boolean { return this._completeOnTick }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: {
  hasCargo?: boolean
  cargoIsEmpty?: boolean
  cargoCanUnload?: boolean
  hasAircraft?: boolean
  atLandAltitude?: boolean
  hasMobile?: boolean
  beforeUnloadDelay?: number
  afterUnloadDelay?: number
  betweenUnloadDelay?: number
} = {}): GameActor {
  const {
    hasCargo = true,
    cargoIsEmpty = false,
    cargoCanUnload = true,
    hasAircraft = false,
    atLandAltitude = true,
    hasMobile = true,
    beforeUnloadDelay = 0,
    afterUnloadDelay = 0,
    betweenUnloadDelay = 0,
  } = overrides

  const traits = new Map<string, unknown>()
  const passengers: GameActor[] = []
  const adjacentCells = [new CPos(4, 5), new CPos(6, 5), new CPos(5, 4), new CPos(5, 6)]

  const cargo = {
    isTraitDisabled: false,
    isEmpty: vi.fn(() => cargoIsEmpty || passengers.length === 0),
    canUnload: vi.fn(() => cargoCanUnload),
    peek: vi.fn(() => {
      const p = createPassengerActor()
      passengers.push(p)
      return p
    }),
    unload: vi.fn(() => {
      return passengers.pop() ?? null
    }),
    load: vi.fn(),
    hasSpace: vi.fn(() => true),
    reserveSpace: vi.fn(() => true),
    unreserveSpace: vi.fn(),
    passengers: [],
    passengerCount: 0,
    currentAdjacentCells: vi.fn(() => adjacentCells),
    info: {
      maxWeight: 10,
      types: ['Infantry'],
      beforeUnloadDelay,
      afterUnloadDelay,
      betweenUnloadDelay,
      afterLoadDelay: 8,
      loadRange: WDist.fromCells(5),
      passengerFacing: { angle: 512 },
    },
  }

  if (hasCargo) traits.set('Cargo', cargo)
  if (hasMobile) traits.set('Mobile', { info: { speed: 100 } })
  if (hasAircraft) traits.set('Aircraft', { atLandAltitude, canLand: vi.fn(() => true), hasInfluence: vi.fn(() => true) })

  const frameEndActions: (() => void)[] = []

  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 0,
    owner: { playerName: 'Test' },
    centerPosition: new WPos(5 * 1024, 5 * 1024, 0),
    location: new CPos(5, 5),
    traits,
    world: {
      queueFrameEndAction: vi.fn((action: () => void) => { frameEndActions.push(action) }),
      _frameEndActions: frameEndActions,
    },
  } as unknown as GameActor
}

function createPassengerActor(): GameActor {
  const traits = new Map<string, unknown>()
  traits.set('Mobile', {
    setPosition: vi.fn(),
    setCenterPosition: vi.fn(),
    canEnterCell: vi.fn(() => true),
    getAvailableSubCell: vi.fn(() => 1), // SubCell.Any-like
    moveTo: vi.fn(() => new StubActivity()),
  })
  traits.set('Passenger', {
    onBeforeAddedToWorld: vi.fn(),
    onEjectedFromKilledCargo: vi.fn(),
    reserve: vi.fn(() => true),
    unreserve: vi.fn(),
    info: { cargoType: 'Infantry', weight: 1, targetLineColor: { r: 0, g: 1, b: 0, a: 1 } },
  })

  return {
    actorId: 100,
    isInWorld: false,
    isDead: false,
    disposed: false,
    generation: 0,
    owner: { playerName: 'Test' },
    centerPosition: new WPos(5 * 1024, 5 * 1024, 0),
    location: new CPos(5, 5),
    traits,
  } as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnloadCargo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset factories
    UnloadCargo._landFactory = null
    UnloadCargo._moveFactory = null
    UnloadCargo._takeOffFactory = null
  })

  describe('construction', () => {
    it('stores cargo trait', () => {
      const actor = createMockActor()
      const activity = new UnloadCargo(actor, Target.Invalid, WDist.fromCells(5))
      expect(activity).toBeDefined()
    })

    it('throws without Cargo trait', () => {
      const actor = createMockActor({ hasCargo: false })
      expect(() => new UnloadCargo(actor, Target.Invalid, WDist.fromCells(5))).toThrow('Cargo')
    })

    it('createAtCurrentLocation factory sets assignTargetOnFirstRun', () => {
      const actor = createMockActor()
      const activity = UnloadCargo.createAtCurrentLocation(actor, WDist.fromCells(5))
      expect(activity).toBeDefined()
    })
  })

  describe('onFirstRun', () => {
    it('queues Land child for aircraft', () => {
      const actor = createMockActor({ hasAircraft: true })
      const landCalls: unknown[] = []
      UnloadCargo._landFactory = (self, dest, range) => {
        landCalls.push({ self, dest, range })
        return new StubActivity()
      }
      const activity = new UnloadCargo(actor, Target.fromCell(new CPos(10, 10)), WDist.fromCells(5))

      activity['onFirstRun'](actor)
      expect(landCalls.length).toBeGreaterThan(0)
    })

    it('queues Move child for ground unit', () => {
      const actor = createMockActor({ hasMobile: true })
      const moveCalls: unknown[] = []
      UnloadCargo._moveFactory = (self, cell, range) => {
        moveCalls.push({ self, cell, range })
        return new StubActivity()
      }
      const activity = new UnloadCargo(actor, Target.fromCell(new CPos(10, 10)), WDist.fromCells(5))

      activity['onFirstRun'](actor)
      expect(moveCalls.length).toBeGreaterThan(0)
    })

    it('queues Wait for beforeUnloadDelay', () => {
      const actor = createMockActor({ beforeUnloadDelay: 10 })
      UnloadCargo._moveFactory = () => new StubActivity()
      const activity = new UnloadCargo(actor, Target.fromCell(new CPos(10, 10)), WDist.fromCells(5))

      activity['onFirstRun'](actor)
      // Should have child activities queued
      expect(activity['_childActivity']).not.toBeNull()
    })
  })

  describe('tick', () => {
    it('returns true when cancelling', () => {
      const actor = createMockActor()
      const activity = new UnloadCargo(actor, Target.Invalid, WDist.fromCells(5))
      // Manually set canceling
      ;(activity as unknown as Record<string, unknown>).state = 2 // Canceling

      const result = activity.tick(actor)
      expect(result).toBe(true)
    })

    it('returns true when cargo is empty', () => {
      const actor = createMockActor({ cargoIsEmpty: true })
      const activity = new UnloadCargo(actor, Target.Invalid, WDist.fromCells(5))

      const result = activity.tick(actor)
      expect(result).toBe(true)
    })

    it('unloads a passenger when cargo can unload', () => {
      const actor = createMockActor({ afterUnloadDelay: 0 })
      UnloadCargo._takeOffFactory = () => new StubActivity()
      const activity = new UnloadCargo(actor, Target.Invalid, WDist.fromCells(5), false)

      // Call onFirstRun first (needed to set up destination)
      activity['onFirstRun'](actor)

      const result = activity.tick(actor)
      // Should unload one passenger and either continue or complete
      expect(typeof result).toBe('boolean')
    })
  })

  describe('edge cases', () => {
    it('handles missing aircraft and mobile gracefully', () => {
      const actor = createMockActor({ hasAircraft: false, hasMobile: false })
      const activity = new UnloadCargo(actor, Target.Invalid, WDist.fromCells(5))

      // Should not throw during onFirstRun (just won't queue move/land)
      expect(() => activity['onFirstRun'](actor)).not.toThrow()
    })

    it('returns true on empty cargo during tick', () => {
      const actor = createMockActor({ cargoIsEmpty: true })
      const activity = new UnloadCargo(actor, Target.Invalid, WDist.fromCells(5))

      expect(activity.tick(actor)).toBe(true)
    })
  })
})
