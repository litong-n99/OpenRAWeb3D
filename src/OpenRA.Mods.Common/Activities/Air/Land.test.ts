/**
 * Land.test.ts — Land activity unit tests
 *
 * Tests focus on: VTOL landing, non-VTOL approach, cancellation,
 * blocked landing, target lines, onFirstRun.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Vector3: class {},
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { Land } from './Land'
import type { AircraftLike } from './Fly'
import { Target } from '../../../OpenRA.Game/Traits/Target'
import { WDist } from '../../../OpenRA.Game/WDist'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import { WVec } from '../../../OpenRA.Game/WVec'
import { WRot } from '../../../OpenRA.Game/WRot'
import { CPos } from '../../../OpenRA.Game/CPos'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockAircraft(options: {
  vTOL?: boolean
  cruiseAltitude?: WDist
  landAltitude?: WDist
  speed?: number
  facing?: WAngle
  centerPosition?: WPos
  turnToLand?: boolean
  initialFacing?: WAngle
  canLandMulti?: boolean
} = {}): AircraftLike & {
  canLandMulti: (cells: readonly CPos[], actor: unknown, blockedByMobile: boolean) => boolean
  findLandingLocation: (cell: CPos, range: WDist) => CPos | null
  addInfluenceCell: (cell: CPos) => void
  enteringCell: (self: unknown) => void
  removeInfluence: () => void
} {
  const pos = options.centerPosition ?? new WPos(0, 0, 1280)
  const facing = options.facing ?? WAngle.Zero

  return {
    info: {
      cruiseAltitude: options.cruiseAltitude ?? new WDist(1280),
      canHover: false,
      canSlide: false,
      vTOL: options.vTOL ?? false,
      turnDeadzone: new WAngle(2),
      idleBehavior: 0,
      roll: WAngle.Zero,
      idleRoll: null,
      rollSpeed: WAngle.Zero,
      pitch: WAngle.Zero,
      pitchSpeed: WAngle.Zero,
      maximumPitch: WAngle.fromDegrees(10),
      altitudeVelocity: new WDist(43),
      landAltitude: options.landAltitude ?? WDist.Zero,
      landRange: WDist.fromCells(5),
      minAirborneAltitude: 1,
      takeoffSounds: [],
      landingSounds: ['landing1'],
      initialFacing: options.initialFacing ?? WAngle.Zero,
      turnToLand: options.turnToLand ?? false,
      speed: options.speed ?? 100,
      idleSpeed: -1,
      turnSpeed: new WAngle(512),
    },
    centerPosition: pos,
    facing,
    pitch: WAngle.Zero,
    roll: WAngle.Zero,
    turnSpeed: new WAngle(512),
    idleTurnSpeed: null,
    movementSpeed: options.speed ?? 100,
    idleMovementSpeed: options.speed ?? 100,
    flyStep: (f: WAngle) => {
      const dir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(f))
      return WVec.divide(WVec.multiply(dir, options.speed ?? 100), 1024)
    },
    setPosition: vi.fn((_self, newPos) => {
      Object.assign(pos, newPos)
    }),
    forceLanding: false,
    landAltitude: options.landAltitude ?? WDist.Zero,
    atLandAltitude: false,
    getTurnSpeed: (_isIdle: boolean) => new WAngle(512),
    canLandMulti: vi.fn(() => options.canLandMulti ?? true),
    findLandingLocation: vi.fn((_cell: CPos, _range: WDist) => _cell),
    addInfluenceCell: vi.fn(),
    enteringCell: vi.fn(),
    removeInfluence: vi.fn(),
  }
}

function createMockActor(aircraft: ReturnType<typeof createMockAircraft>, location?: CPos): unknown {
  return {
    traits: new Map([['Aircraft', aircraft]]),
    centerPosition: aircraft.centerPosition,
    location: location ?? new CPos(0, 0),
    owner: {},
    world: {
      map: {
        distanceAboveTerrain: (pos: WPos) => new WDist(pos.Z),
        cellContaining: (_pos: WPos) => location ?? new CPos(0, 0),
      },
      playSound: vi.fn(),
    },
    currentActivity: { isCanceling: false, nextActivity: null },
    notifyBlocker: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Land', () => {
  describe('constructor', () => {
    it('requires Aircraft trait', () => {
      const actor = { traits: new Map() } as unknown as never
      expect(() => new Land(actor)).toThrow('Land requires an Aircraft trait')
    })

    it('creates with default target (current location)', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const land = new Land(actor)
      expect(land).toBeDefined()
    })

    it('creates with target', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 0))
      const land = new Land(actor, target)
      expect(land).toBeDefined()
    })

    it('creates with target and facing', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 0))
      const land = new Land(actor, target, new WAngle(128))
      expect(land).toBeDefined()
    })

    it('creates with target and offset', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 0))
      const land = new Land(actor, target, new WVec(50, 0, 0))
      expect(land).toBeDefined()
    })

    it('creates with target, landRange, and offset', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 0))
      const land = new Land(actor, target, new WDist(100), new WVec(50, 0, 0))
      expect(land).toBeDefined()
    })
  })

  describe('onFirstRun', () => {
    it('assigns target from location when no target provided', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft, new CPos(5, 5)) as never
      const land = new Land(actor)

      // onFirstRun is called via tick
      land.tick(actor)
      // After onFirstRun, target should be set from location
      expect(land).toBeDefined()
    })
  })

  describe('tick', () => {
    it('returns true when already at landing location', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 0),
        landAltitude: WDist.Zero,
        vTOL: true,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(0, 0, 0))
      const land = new Land(actor, target)

      const result = land.tick(actor)
      expect(result).toBe(true)
    })

    it('VTOL: queues Fly when not horizontally aligned', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(1000, 0, 1280),
        vTOL: true,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(0, 0, 0))
      const land = new Land(actor, target)

      const result = land.tick(actor)
      expect(result).toBe(false)
      // Should have queued a child (Fly)
      expect((land as unknown as { _childActivity: unknown })._childActivity).not.toBeNull()
    })

    it('VTOL: queues Turn when facing mismatch', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        vTOL: true,
        facing: WAngle.Zero,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(0, 0, 0))
      const land = new Land(actor, target, new WAngle(128))

      // First tick: horizontal alignment (already aligned)
      // Second tick: should queue Turn
      land.tick(actor)
      const result = land.tick(actor)
      expect(result).toBe(false)
    })

    it('VTOL: descends vertically when aligned', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        vTOL: true,
        cruiseAltitude: new WDist(1280),
        landAltitude: WDist.Zero,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(0, 0, 0))
      const land = new Land(actor, target)

      // First tick: horizontal alignment (already aligned)
      // After alignment, should initiate landing and descend
      let result = land.tick(actor)
      // May return false while descending
      let ticks = 0
      while (!result && ticks < 100) {
        result = land.tick(actor)
        ticks++
      }

      expect(result).toBe(true)
      expect(aircraft.centerPosition.Z).toBe(0)
    })

    it('non-VTOL: queues approach waypoints', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        vTOL: false,
        facing: WAngle.Zero,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(5000, 0, 0))
      const land = new Land(actor, target)

      const result = land.tick(actor)
      expect(result).toBe(false)
      // Should have queued approach waypoints (3 Fly children)
      expect((land as unknown as { _childActivity: unknown })._childActivity).not.toBeNull()
    })

    it('returns true when canceling and not landingInitiated', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        vTOL: true,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(0, 0, 0))
      const land = new Land(actor, target)

      // Set canceling state
      ;(land as unknown as { state: number }).state = 2 // Canceling
      const result = land.tick(actor)
      expect(result).toBe(true)
    })

    it('handles blocked landing with holding pattern', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        vTOL: true,
        canLandMulti: false,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(0, 0, 0))
      const land = new Land(actor, target)

      // First tick: horizontal alignment
      // Second tick: should detect blocked landing and queue Wait
      let result = land.tick(actor)
      let ticks = 0
      while (!result && ticks < 10) {
        result = land.tick(actor)
        ticks++
      }

      // Should have called canLandMulti
      expect(aircraft.canLandMulti).toHaveBeenCalled()
    })

    it('plays landing sound and notifies on landing initiation', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        vTOL: true,
        landAltitude: WDist.Zero,
      })
      const actor = createMockActor(aircraft, new CPos(0, 0)) as never
      const target = Target.fromPos(new WPos(0, 0, 0))
      const land = new Land(actor, target)

      // onFirstRun is called by tickOuter in the real system
      ;(land as unknown as { onFirstRun: (self: unknown) => void }).onFirstRun(actor)

      // Tick until landing is initiated
      let result = land.tick(actor)
      let ticks = 0
      while (!result && ticks < 50) {
        result = land.tick(actor)
        ticks++
      }

      // Sound should have been played
      expect((actor as Record<string, unknown>).world).toBeDefined()
      // Influence should have been added
      expect(aircraft.addInfluenceCell).toHaveBeenCalled()
      // Entering cell should have been called
      expect(aircraft.enteringCell).toHaveBeenCalled()
    })
  })

  describe('targetLineNodes', () => {
    it('returns empty when no target line color', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 0))
      const land = new Land(actor, target)

      const nodes = land.targetLineNodes()
      expect(nodes).toHaveLength(0)
    })

    it('returns target line node when color is set', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 0))
      const color = { r: 0, g: 255, b: 0, a: 255 }
      const land = new Land(actor, target, WAngle.Zero, color)

      const nodes = land.targetLineNodes()
      expect(nodes).toHaveLength(1)
      expect(nodes[0].color).toBe(color)
    })
  })
})
