/**
 * TakeOff.test.ts — TakeOff activity unit tests
 *
 * Tests focus on: VTOL vs non-VTOL ascent, force landing, sound notification,
 * influence removal, onFirstRun behavior.
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

import { TakeOff } from './TakeOff'
import type { AircraftLike } from './Fly'
import { WDist } from '../../../OpenRA.Game/WDist'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import { WVec } from '../../../OpenRA.Game/WVec'
import { WRot } from '../../../OpenRA.Game/WRot'

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
  forceLanding?: boolean
  hasInfluence?: boolean
  minAirborneAltitude?: number
} = {}): AircraftLike & { hasInfluence: () => boolean; removeInfluence: () => void; addInfluenceCell: (cell: unknown) => void } {
  const pos = options.centerPosition ?? new WPos(0, 0, 0)
  const facing = options.facing ?? WAngle.Zero
  const hasInfl = options.hasInfluence ?? true

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
      minAirborneAltitude: options.minAirborneAltitude ?? 1,
      takeoffSounds: ['takeoff1'],
      landingSounds: [],
      initialFacing: WAngle.Zero,
      turnToLand: false,
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
    forceLanding: options.forceLanding ?? false,
    landAltitude: options.landAltitude ?? WDist.Zero,
    atLandAltitude: true,
    getTurnSpeed: (_isIdle: boolean) => new WAngle(512),
    hasInfluence: () => hasInfl,
    removeInfluence: vi.fn(),
    addInfluenceCell: vi.fn(),
  }
}

function createMockActor(aircraft: ReturnType<typeof createMockAircraft>): unknown {
  return {
    traits: new Map([['Aircraft', aircraft]]),
    centerPosition: aircraft.centerPosition,
    owner: {},
    world: {
      map: {
        distanceAboveTerrain: (pos: WPos) => new WDist(pos.Z),
      },
      playSound: vi.fn(),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TakeOff', () => {
  describe('constructor', () => {
    it('requires Aircraft trait', () => {
      const actor = { traits: new Map() } as unknown as never
      expect(() => new TakeOff(actor)).toThrow('TakeOff requires an Aircraft trait')
    })

    it('resolves aircraft trait', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)
      expect(takeOff).toBeDefined()
    })
  })

  describe('onFirstRun', () => {
    it('does nothing when forceLanding is true', () => {
      const aircraft = createMockAircraft({ forceLanding: true })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      ;(takeOff as unknown as { onFirstRun: (self: unknown) => void }).onFirstRun(actor)
      expect(aircraft.removeInfluence).not.toHaveBeenCalled()
    })

    it('does nothing when no influence', () => {
      const aircraft = createMockAircraft({ hasInfluence: false })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      ;(takeOff as unknown as { onFirstRun: (self: unknown) => void }).onFirstRun(actor)
      expect(aircraft.removeInfluence).not.toHaveBeenCalled()
    })

    it('removes influence when has influence', () => {
      const aircraft = createMockAircraft({ hasInfluence: true })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      // onFirstRun is called before first tick in the real activity system
      // We need to simulate it here
      ;(takeOff as unknown as { onFirstRun: (self: unknown) => void }).onFirstRun(actor)
      expect(aircraft.removeInfluence).toHaveBeenCalled()
    })
  })

  describe('tick', () => {
    it('returns true when at cruise altitude', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
      })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      const result = takeOff.tick(actor)
      expect(result).toBe(true)
    })

    it('returns true when forceLanding is true', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 0),
        forceLanding: true,
      })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      const result = takeOff.tick(actor)
      expect(result).toBe(true)
    })

    it('VTOL: uses verticalTakeOffOrLandTick and returns false', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 0),
        vTOL: true,
      })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      const result = takeOff.tick(actor)
      expect(result).toBe(false)
      // Should have moved up
      expect(aircraft.centerPosition.Z).toBeGreaterThan(0)
    })

    it('non-VTOL: uses flyTick and returns false', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 0),
        vTOL: false,
      })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      const result = takeOff.tick(actor)
      expect(result).toBe(false)
      // Should have moved (both horizontally and vertically)
      expect(aircraft.centerPosition.Z).toBeGreaterThan(0)
    })

    it('VTOL reaches cruise altitude after multiple ticks', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 0),
        vTOL: true,
        cruiseAltitude: new WDist(128),
      })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      let ticks = 0
      let result = false
      while (!result && ticks < 100) {
        result = takeOff.tick(actor)
        ticks++
      }

      expect(result).toBe(true)
      expect(aircraft.centerPosition.Z).toBe(128)
    })

    it('non-VTOL reaches cruise altitude after multiple ticks', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 0),
        vTOL: false,
        cruiseAltitude: new WDist(128),
      })
      const actor = createMockActor(aircraft) as never
      const takeOff = new TakeOff(actor)

      let ticks = 0
      let result = false
      while (!result && ticks < 100) {
        result = takeOff.tick(actor)
        ticks++
      }

      expect(result).toBe(true)
      expect(aircraft.centerPosition.Z).toBe(128)
    })
  })
})
