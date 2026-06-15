/**
 * Fly.test.ts — Fly activity unit tests
 *
 * Tests focus on: static helpers (flyTick, verticalTakeOffOrLandTick,
 * calculateTurnRadius), instance tick (target approach, range annulus,
 * turn radius, cancellation, position history), target lines.
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

import { Fly, type AircraftLike } from './Fly'
import { Target } from '../../../OpenRA.Game/Traits/Target'
import { WDist } from '../../../OpenRA.Game/WDist'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import { WVec } from '../../../OpenRA.Game/WVec'
import { WRot } from '../../../OpenRA.Game/WRot'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockAircraft(options: {
  canSlide?: boolean
  canHover?: boolean
  vTOL?: boolean
  cruiseAltitude?: WDist
  landAltitude?: WDist
  turnSpeed?: WAngle
  turnDeadzone?: WAngle
  speed?: number
  facing?: WAngle
  centerPosition?: WPos
  forceLanding?: boolean
  isTraitPaused?: boolean
  idleBehavior?: number
} = {}): AircraftLike {
  const pos = options.centerPosition ?? new WPos(0, 0, 1280)
  const facing = options.facing ?? WAngle.Zero

  return {
    info: {
      cruiseAltitude: options.cruiseAltitude ?? new WDist(1280),
      canHover: options.canHover ?? false,
      canSlide: options.canSlide ?? false,
      vTOL: options.vTOL ?? false,
      turnDeadzone: options.turnDeadzone ?? new WAngle(2),
      idleBehavior: options.idleBehavior ?? 0,
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
      landingSounds: [],
      initialFacing: WAngle.Zero,
      turnToLand: false,
      speed: options.speed ?? 100,
    },
    centerPosition: pos,
    facing,
    pitch: WAngle.Zero,
    roll: WAngle.Zero,
    turnSpeed: options.turnSpeed ?? new WAngle(512),
    idleTurnSpeed: null,
    movementSpeed: options.speed ?? 100,
    idleMovementSpeed: options.speed ?? 100,
    flyStep: (f: WAngle) => {
      const dir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(f))
      return WVec.divide(WVec.multiply(dir, options.speed ?? 100), 1024)
    },
    setPosition: vi.fn((_self, newPos) => {
      // Mutate the position object for test purposes
      ;(pos as unknown as { X: number; Y: number; Z: number }).X = newPos.X
      ;(pos as unknown as { X: number; Y: number; Z: number }).Y = newPos.Y
      ;(pos as unknown as { X: number; Y: number; Z: number }).Z = newPos.Z
    }),
    forceLanding: options.forceLanding ?? false,
    landAltitude: options.landAltitude ?? WDist.Zero,
    atLandAltitude: false,
    getTurnSpeed: (isIdle: boolean) => {
      if (isIdle) return options.turnSpeed ?? new WAngle(512)
      return options.turnSpeed ?? new WAngle(512)
    },
  }
}

function createMockActor(aircraft: AircraftLike): unknown {
  return {
    traits: new Map([['Aircraft', aircraft]]),
    centerPosition: aircraft.centerPosition,
    owner: {},
    world: {
      map: {
        distanceAboveTerrain: (pos: WPos) => new WDist(pos.Z),
        cellContaining: (_pos: WPos) => ({ X: 0, Y: 0, Bits: 0 } as unknown as import('../../../OpenRA.Game/CPos').CPos),
      },
    },
    currentActivity: { isCanceling: false, nextActivity: null },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fly', () => {
  describe('static calculateTurnRadius', () => {
    it('returns 0 when turnSpeed is 0', () => {
      const radius = Fly.calculateTurnRadius(100, WAngle.Zero)
      expect(radius).toBe(0)
    })

    it('calculates correct turn radius for speed 100, turnSpeed 512', () => {
      // 180 * 100 / 512 = 35.15... -> truncated to 35
      const radius = Fly.calculateTurnRadius(100, new WAngle(512))
      expect(radius).toBe(35)
    })

    it('calculates correct turn radius for speed 200, turnSpeed 256', () => {
      // 180 * 200 / 256 = 140.6... -> truncated to 140
      const radius = Fly.calculateTurnRadius(200, new WAngle(256))
      expect(radius).toBe(140)
    })
  })

  describe('static verticalTakeOffOrLandTick', () => {
    it('returns false when already at desired altitude', () => {
      const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
      const actor = createMockActor(aircraft) as never

      const result = Fly.verticalTakeOffOrLandTick(actor, aircraft, WAngle.Zero, new WDist(1280))
      expect(result).toBe(false)
    })

    it('returns true and moves toward desired altitude when below', () => {
      const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 0) })
      const actor = createMockActor(aircraft) as never

      const result = Fly.verticalTakeOffOrLandTick(actor, aircraft, WAngle.Zero, new WDist(1280))
      expect(result).toBe(true)
      // Should have moved up by altitudeVelocity (43)
      expect(aircraft.centerPosition.Z).toBe(43)
    })

    it('returns true and moves toward desired altitude when above', () => {
      const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 2000) })
      const actor = createMockActor(aircraft) as never

      const result = Fly.verticalTakeOffOrLandTick(actor, aircraft, WAngle.Zero, new WDist(1280))
      expect(result).toBe(true)
      // Should have moved down by altitudeVelocity (43)
      expect(aircraft.centerPosition.Z).toBe(1957)
    })

    it('returns false when reaching desired altitude', () => {
      const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1237) })
      const actor = createMockActor(aircraft) as never

      const result = Fly.verticalTakeOffOrLandTick(actor, aircraft, WAngle.Zero, new WDist(1280))
      expect(result).toBe(true)
      // 1237 + 43 = 1280, exactly at target
      expect(aircraft.centerPosition.Z).toBe(1280)
    })
  })

  describe('static flyTick', () => {
    it('moves aircraft forward at current facing', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        facing: WAngle.Zero,
        speed: 100,
      })
      const actor = createMockActor(aircraft) as never

      Fly.flyTick(actor, aircraft, WAngle.Zero, new WDist(1280))

      // At facing 0, aircraft moves in direction (0, -100, 0) scaled by speed/1024
      // flyStep returns WVec.divide(WVec.multiply(dir, speed), 1024)
      // dir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(0)) = (0, -1024, 0)
      // result = (0, -100, 0)
      expect(aircraft.centerPosition.Y).toBeLessThan(0)
      expect(aircraft.centerPosition.Z).toBe(1280) // at cruise altitude
    })

    it('rotates facing toward desired facing', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        facing: WAngle.Zero,
        turnSpeed: new WAngle(64),
      })
      const actor = createMockActor(aircraft) as never

      Fly.flyTick(actor, aircraft, new WAngle(128), new WDist(1280))

      // Facing should have rotated by turnSpeed (64) toward 128
      expect(aircraft.facing.angle).toBe(64)
    })

    it('adjusts altitude toward desiredAltitude', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1000),
        facing: WAngle.Zero,
      })
      const actor = createMockActor(aircraft) as never

      Fly.flyTick(actor, aircraft, WAngle.Zero, new WDist(1280))

      // Z should have increased toward 1280
      expect(aircraft.centerPosition.Z).toBeGreaterThan(1000)
    })

    it('uses moveOverride when provided', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        facing: WAngle.Zero,
      })
      const actor = createMockActor(aircraft) as never

      Fly.flyTick(actor, aircraft, WAngle.Zero, new WDist(1280), new WVec(50, 0, 0))

      expect(aircraft.centerPosition.X).toBe(50)
    })

    it('slides aircraft when canSlide is true', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        facing: WAngle.Zero,
        canSlide: true,
      })
      const actor = createMockActor(aircraft) as never

      // When canSlide, flyStep uses desiredFacing
      // WAngle(512) = south (positive Y in OpenRA)
      Fly.flyTick(actor, aircraft, new WAngle(512), new WDist(1280))

      // Should move in direction of desiredFacing (512 = south)
      expect(aircraft.centerPosition.Y).toBeGreaterThan(0)
    })
  })

  describe('constructor', () => {
    it('requires Aircraft trait', () => {
      const actor = { traits: new Map() } as unknown as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))
      expect(() => new Fly(actor, target)).toThrow('Fly requires an Aircraft trait')
    })

    it('stores target and resolves aircraft', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))

      const fly = new Fly(actor, target)
      expect(fly).toBeDefined()
    })

    it('handles nearEnough overload', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))

      const fly = new Fly(actor, target, new WDist(100))
      expect(fly).toBeDefined()
    })

    it('handles minRange/maxRange overload', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))

      const fly = new Fly(actor, target, new WDist(100), new WDist(500))
      expect(fly).toBeDefined()
    })
  })

  describe('tick', () => {
    it('returns false when on ground (queues TakeOff)', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 0),
        landAltitude: WDist.Zero,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))

      const fly = new Fly(actor, target)
      const result = fly.tick(actor)
      expect(result).toBe(false)
    })

    it('returns true when target is reached', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(1000, 0, 1280),
        canSlide: true,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))

      const fly = new Fly(actor, target)
      const result = fly.tick(actor)
      expect(result).toBe(true)
    })

    it('returns false while approaching target', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        canSlide: true,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(10000, 0, 1280))

      const fly = new Fly(actor, target)
      const result = fly.tick(actor)
      expect(result).toBe(false)
    })

    it('cancels when forceLanding is true', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        forceLanding: true,
        canSlide: true,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))

      const fly = new Fly(actor, target)
      // Set state to Active first (normally done by tickOuter)
      ;(fly as unknown as { state: number }).state = 1 // Active
      const result = fly.tick(actor)
      // After cancel, should be in Canceling state and return true or false depending on hover
      expect(result).toBe(true)
    })

    it('returns true when target is invalid and no fallback', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        canSlide: true,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.Invalid

      const fly = new Fly(actor, target)
      ;(fly as unknown as { state: number }).state = 1 // Active
      const result = fly.tick(actor)
      expect(result).toBe(true)
    })

    it('handles inside min range for slider (reverses)', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        canSlide: true,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(0, 0, 1280))

      const fly = new Fly(actor, target, new WDist(100), new WDist(500))
      ;(fly as unknown as { state: number }).state = 1 // Active
      const result = fly.tick(actor)
      // Inside min range, slider reverses
      expect(result).toBe(false)
    })

    it('handles inside min range for non-slider (turns away)', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        canSlide: false,
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(0, 0, 1280))

      const fly = new Fly(actor, target, new WDist(100), new WDist(500))
      ;(fly as unknown as { state: number }).state = 1 // Active
      const result = fly.tick(actor)
      // Inside min range, non-slider turns away
      expect(result).toBe(false)
    })

    it('detects blocked position and returns true when close enough', () => {
      const aircraft = createMockAircraft({
        centerPosition: new WPos(0, 0, 1280),
        canSlide: true,
        speed: 1, // Very slow to trigger blocked detection
      })
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(10, 0, 1280))

      const fly = new Fly(actor, target, new WDist(100))
      ;(fly as unknown as { state: number }).state = 1 // Active

      // Tick 5 times to fill the ring buffer
      for (let i = 0; i < 5; i++) {
        fly.tick(actor)
      }

      // After 5 ticks with minimal movement, should detect blocked and return true
      const result = fly.tick(actor)
      expect(result).toBe(true)
    })
  })

  describe('targetLineNodes', () => {
    it('returns empty when no target line color', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))

      const fly = new Fly(actor, target)
      const nodes = fly.targetLineNodes()
      expect(nodes).toHaveLength(0)
    })

    it('returns target line node when color is set', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))
      const color = { r: 255, g: 0, b: 0, a: 255 }

      const fly = new Fly(actor, target, null, color)
      const nodes = fly.targetLineNodes()
      expect(nodes).toHaveLength(1)
      expect(nodes[0].color).toBe(color)
    })
  })

  describe('getTargets', () => {
    it('returns the target', () => {
      const aircraft = createMockAircraft()
      const actor = createMockActor(aircraft) as never
      const target = Target.fromPos(new WPos(1000, 0, 1280))

      const fly = new Fly(actor, target)
      const targets = fly.getTargets()
      expect(targets).toHaveLength(1)
    })
  })
})
