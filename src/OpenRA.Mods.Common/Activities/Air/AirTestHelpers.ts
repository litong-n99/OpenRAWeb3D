/**
 * AirTestHelpers.ts — Shared test helpers for aircraft activities.
 *
 * Provides a mock AircraftLike factory and a default mock actor factory
 * used by Fly, TakeOff, Land, FlyForward, FlyIdle, FlyOffMap, FlyAttack,
 * FlyFollow, ReturnToBase, FallToEarth, and DeliverBulkOrder tests.
 */

import { vi } from 'vitest'
import type { AircraftLike } from './AircraftFlightUtils.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'

// ---------------------------------------------------------------------------
// Mock aircraft factory
// ---------------------------------------------------------------------------

export interface MockAircraftOptions {
  canSlide?: boolean
  canHover?: boolean
  vTOL?: boolean
  cruiseAltitude?: WDist
  landAltitude?: WDist
  turnSpeed?: WAngle
  idleTurnSpeed?: WAngle | null
  turnDeadzone?: WAngle
  speed?: number
  idleSpeed?: number
  facing?: WAngle
  centerPosition?: WPos
  forceLanding?: boolean
  isTraitPaused?: boolean
  idleBehavior?: number
  waitDistanceFromResupplyBase?: WDist
  numberOfTicksToVerifyAvailableAirport?: number
  targetLineColor?: { r: number; g: number; b: number; a: number }
}

export function createMockAircraft(options: MockAircraftOptions = {}): AircraftLike {
  const pos = options.centerPosition ?? new WPos(0, 0, 1280)
  const facing = options.facing ?? WAngle.Zero
  const speed = options.speed ?? 100

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
      speed,
      idleSpeed: options.idleSpeed ?? -1,
      turnSpeed: options.turnSpeed ?? new WAngle(512),
      waitDistanceFromResupplyBase: options.waitDistanceFromResupplyBase,
      numberOfTicksToVerifyAvailableAirport: options.numberOfTicksToVerifyAvailableAirport,
      targetLineColor: options.targetLineColor,
    },
    centerPosition: pos,
    facing,
    pitch: WAngle.Zero,
    roll: WAngle.Zero,
    turnSpeed: options.turnSpeed ?? new WAngle(512),
    idleTurnSpeed: options.idleTurnSpeed ?? null,
    movementSpeed: speed,
    idleMovementSpeed: options.idleSpeed !== undefined && options.idleSpeed >= 0 ? options.idleSpeed : speed,
    flyStep: (f: WAngle) => {
      const dir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(f))
      return WVec.divide(WVec.multiply(dir, speed), 1024)
    },
    setPosition: vi.fn((_self, newPos) => {
      ;(pos as unknown as { X: number; Y: number; Z: number }).X = newPos.X
      ;(pos as unknown as { X: number; Y: number; Z: number }).Y = newPos.Y
      ;(pos as unknown as { X: number; Y: number; Z: number }).Z = newPos.Z
    }),
    forceLanding: options.forceLanding ?? false,
    landAltitude: options.landAltitude ?? WDist.Zero,
    atLandAltitude: false,
    getTurnSpeed: (isIdle: boolean) => {
      if (isIdle) return options.idleTurnSpeed ?? options.turnSpeed ?? new WAngle(512)
      return options.turnSpeed ?? new WAngle(512)
    },
  }
}

// ---------------------------------------------------------------------------
// Mock actor factory
// ---------------------------------------------------------------------------

export function createMockActor(
  aircraft: AircraftLike,
  extraTraits?: Map<string, unknown>,
  location?: { X: number; Y: number; Bits: number },
): unknown {
  const traits = new Map<string, unknown>([['Aircraft', aircraft]])
  if (extraTraits) {
    for (const [key, value] of extraTraits) {
      traits.set(key, value)
    }
  }

  return {
    traits,
    centerPosition: aircraft.centerPosition,
    location: location ?? { X: 0, Y: 0, Bits: 0 },
    owner: {},
    world: {
      map: {
        distanceAboveTerrain: (pos: WPos) => new WDist(pos.Z),
        cellContaining: (_pos: WPos) => ({ X: 0, Y: 0, Bits: 0 }),
        contains: (_pos: unknown) => true,
        centerOfCell: (_cell: unknown) => new WPos(0, 0, 0),
        chooseClosestEdgeCell: (_cell: unknown) => ({ X: 0, Y: 0, Bits: 0 }),
      },
      actors: [],
      sharedRandom: 42,
      addFrameEndAction: vi.fn((fn: () => void) => fn()),
      playSound: vi.fn(),
    },
    currentActivity: { isCanceling: false, nextActivity: null },
    isDead: false,
    isInWorld: true,
    notifyBlocker: vi.fn(),
  }
}
