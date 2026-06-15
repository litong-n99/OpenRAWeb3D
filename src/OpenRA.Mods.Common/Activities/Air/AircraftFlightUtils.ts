/**
 * AircraftFlightUtils.ts — 共享飞机飞行物理辅助方法
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/Fly.cs 中的静态 helpers
 *
 * 核心范式转换:
 * - C# Fly 类上的 static helpers → TypeScript 独立工具模块
 * - 避免 Fly.ts 与 TakeOff.ts / Land.ts 之间的循环依赖
 * - Fly.ts / TakeOff.ts / Land.ts 都从此模块导入静态 helpers 和 AircraftLike 类型
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Duck-typed Aircraft trait reference. */
export interface AircraftLike {
  readonly info: AircraftInfoLike
  readonly centerPosition: WPos
  facing: WAngle
  pitch: WAngle
  roll: WAngle
  turnSpeed: WAngle
  idleTurnSpeed: WAngle | null
  movementSpeed: number
  idleMovementSpeed: number
  flyStep(facing: WAngle): WVec
  setPosition(self: GameActor, pos: WPos): void
  forceLanding: boolean
  landAltitude: WDist
  atLandAltitude: boolean
  getTurnSpeed(isIdleTurn: boolean): WAngle
}

/** Duck-typed AircraftInfo config. */
export interface AircraftInfoLike {
  readonly cruiseAltitude: WDist
  readonly canHover: boolean
  readonly canSlide: boolean
  readonly vTOL: boolean
  readonly turnDeadzone: WAngle
  readonly idleBehavior: number
  readonly roll: WAngle
  readonly idleRoll: WAngle | null
  readonly rollSpeed: WAngle
  readonly pitch: WAngle
  readonly pitchSpeed: WAngle
  readonly maximumPitch: WAngle
  readonly altitudeVelocity: WDist
  readonly landAltitude: WDist
  readonly landRange: WDist
  readonly minAirborneAltitude: number
  readonly takeoffSounds: readonly string[]
  readonly landingSounds: readonly string[]
  readonly initialFacing: WAngle
  readonly turnToLand: boolean
  readonly speed: number
  readonly idleSpeed: number
  readonly turnSpeed: WAngle
  readonly waitDistanceFromResupplyBase?: WDist
  readonly numberOfTicksToVerifyAvailableAirport?: number
  readonly targetLineColor?: ColorStub
}

// ---------------------------------------------------------------------------
// Runtime type guards
// ---------------------------------------------------------------------------

/**
 * Check whether a value is a WPos-like object.
 *
 * Distinguishes WPos from WVec by the presence of `toWVec()` (WPos has it,
 * WVec does not).
 */
export function isWPos(v: unknown): v is WPos {
  return v !== null && v !== undefined && typeof v === 'object' &&
    'X' in v && 'Y' in v && 'Z' in v && 'toWVec' in v
}

/**
 * Check whether a value is a WDist-like object.
 */
export function isWDist(v: unknown): v is WDist {
  return v !== null && v !== undefined && typeof v === 'object' &&
    'length' in v && !('X' in v)
}

/**
 * Check whether a value is a WVec-like object.
 *
 * Distinguishes WVec from WPos by the presence of `length` (WVec has it,
 * WPos does not).
 */
export function isWVec(v: unknown): v is WVec {
  return v !== null && v !== undefined && typeof v === 'object' &&
    'X' in v && 'Y' in v && 'Z' in v && 'length' in v
}

/**
 * Check whether a value is a ColorStub (has r/g/b/a number fields).
 */
export function isColorStub(v: unknown): v is ColorStub {
  if (v === null || v === undefined || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return typeof c.r === 'number' &&
    typeof c.g === 'number' &&
    typeof c.b === 'number' &&
    typeof c.a === 'number'
}

/**
 * Get the actor's distance above terrain, with a safe fallback to WDist.Zero
 * when the world/map/distanceAboveTerrain API is unavailable.
 */
export function getDistanceAboveTerrain(self: GameActor, pos: WPos): WDist {
  const actorAny = self as unknown as {
    world?: { map?: { distanceAboveTerrain?: (p: WPos) => WDist } }
  }
  const fn = actorAny.world?.map?.distanceAboveTerrain
  if (typeof fn === 'function') {
    return fn(pos)
  }
  return WDist.Zero
}

// ---------------------------------------------------------------------------
// Static flyTick — core flight physics
// ---------------------------------------------------------------------------

/**
 * Core flight physics tick: move the aircraft one step.
 *
 * OpenRA 对照: Fly.FlyTick(Actor, Aircraft, WAngle, WDist, WVec?, bool?)
 *
 * Handles:
 * - Facing rotation toward desired facing
 * - Roll animation when turning
 * - Pitch animation
 * - Altitude adjustment toward desiredAltitude (or moveOverride.Z)
 * - Position update
 *
 * @param self — the actor
 * @param aircraft — the aircraft trait
 * @param desiredFacing — the facing to rotate toward
 * @param desiredAltitude — the altitude to reach
 * @param moveOverride — override movement vector (WVec.Zero = use flyStep). Default: WVec.Zero
 * @param idleTurn — whether this is an idle turn (affects roll and turn speed). Default: false
 */
export function flyTick(
  self: GameActor,
  aircraft: AircraftLike,
  desiredFacing: WAngle,
  desiredAltitude: WDist,
  moveOverride: WVec = WVec.Zero,
  idleTurn: boolean = false,
): void {
  const dat = getDistanceAboveTerrain(self, aircraft.centerPosition)

  const move =
    !WVec.equals(moveOverride, WVec.Zero)
      ? moveOverride
      : aircraft.info.canSlide
        ? aircraft.flyStep(desiredFacing)
        : aircraft.flyStep(aircraft.facing)

  const oldFacing = aircraft.facing
  aircraft.facing = WAngle.tickFacing(
    aircraft.facing,
    desiredFacing,
    aircraft.getTurnSpeed(idleTurn),
  )

  // Roll
  const roll = idleTurn
    ? (aircraft.info.idleRoll ?? aircraft.info.roll)
    : aircraft.info.roll
  if (!WAngle.equals(roll, WAngle.Zero)) {
    const desiredRoll = WAngle.equals(aircraft.facing, desiredFacing)
      ? WAngle.Zero
      : new WAngle(roll.angle * _getTurnDirection(aircraft.facing, oldFacing))
    aircraft.roll = WAngle.tickFacing(
      aircraft.roll,
      desiredRoll,
      aircraft.info.rollSpeed,
    )
  }

  // Pitch
  if (!WAngle.equals(aircraft.info.pitch, WAngle.Zero)) {
    aircraft.pitch = WAngle.tickFacing(
      aircraft.pitch,
      aircraft.info.pitch,
      aircraft.info.pitchSpeed,
    )
  }

  // Altitude adjustment
  // Note: if move.Z is not zero, it's intentional and we want to move in that
  // vertical direction instead of towards desiredAltitude.
  if (!WDist.equals(dat, desiredAltitude) || move.Z !== 0) {
    const maxDelta = Math.trunc((move.horizontalLength * aircraft.info.maximumPitch.tan()) / 1024)
    const moveZ = move.Z !== 0 ? move.Z : (desiredAltitude.length - dat.length)
    const deltaZ = _clamp(moveZ, -maxDelta, maxDelta)
    const adjustedMove = new WVec(move.X, move.Y, deltaZ)
    aircraft.setPosition(self, WPos.add(aircraft.centerPosition, adjustedMove))
  } else {
    aircraft.setPosition(self, WPos.add(aircraft.centerPosition, move))
  }
}

// ---------------------------------------------------------------------------
// Static verticalTakeOffOrLandTick
// ---------------------------------------------------------------------------

/**
 * Vertical-only altitude change (for VTOL take-off/landing).
 *
 * OpenRA 对照: Fly.VerticalTakeOffOrLandTick(Actor, Aircraft, WAngle, WDist, bool)
 *
 * Should only be used for vertical-only movement. Terrain-induced altitude
 * changes should always be handled by flyTick.
 *
 * @returns true if still moving (not at desired altitude yet), false if done
 */
export function verticalTakeOffOrLandTick(
  self: GameActor,
  aircraft: AircraftLike,
  desiredFacing: WAngle,
  desiredAltitude: WDist,
  idleTurn: boolean = false,
): boolean {
  const turnSpeed = idleTurn
    ? (aircraft.idleTurnSpeed ?? aircraft.turnSpeed)
    : aircraft.turnSpeed
  aircraft.facing = WAngle.tickFacing(aircraft.facing, desiredFacing, turnSpeed)

  const dat = getDistanceAboveTerrain(self, aircraft.centerPosition)

  if (WDist.equals(dat, desiredAltitude)) return false

  const maxDelta = aircraft.info.altitudeVelocity.length
  const deltaZ = _clamp(desiredAltitude.length - dat.length, -maxDelta, maxDelta)
  aircraft.setPosition(
    self,
    WPos.add(aircraft.centerPosition, new WVec(0, 0, deltaZ)),
  )
  return true
}

// ---------------------------------------------------------------------------
// Static calculateTurnRadius
// ---------------------------------------------------------------------------

/**
 * Calculate the turn radius from speed and turn rate.
 *
 * OpenRA 对照: Fly.CalculateTurnRadius(int, WAngle)
 *
 * Formula: turnSpeed -> divide into 256 to get ticks per complete rotation
 *          speed -> multiply to get distance per rotation (circumference)
 *          180 -> divide by 2*pi to get turn radius (180 == 1024/(2*pi))
 *
 * @param speed — movement speed
 * @param turnSpeed — turn speed (WAngle)
 * @returns turn radius in world units
 */
export function calculateTurnRadius(speed: number, turnSpeed: WAngle): number {
  return turnSpeed.angle > 0 ? Math.trunc((180 * speed) / turnSpeed.angle) : 0
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Get the turn direction: +1 for clockwise, -1 for counter-clockwise.
 *
 * OpenRA 对照: Util.GetTurnDirection(WAngle, WAngle)
 */
function _getTurnDirection(current: WAngle, desired: WAngle): number {
  const diff = WAngle.subtract(desired, current).angle
  return diff <= 512 ? 1 : -1
}

/**
 * Clamp a value to [min, max].
 */
function _clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
