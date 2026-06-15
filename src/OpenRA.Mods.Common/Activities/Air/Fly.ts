/**
 * Fly.ts — 核心飞行活动（含静态飞行物理辅助方法）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/Fly.cs
 *
 * 核心范式转换:
 * - C# RingBuffer<WPos> → TypeScript 固定大小循环数组（inline, capacity 5）
 * - C# static FlyTick() → TypeScript static flyTick()
 * - C# static VerticalTakeOffOrLandTick() → TypeScript static verticalTakeOffOrLandTick()
 * - C# static CalculateTurnRadius() → TypeScript static calculateTurnRadius()
 * - C# yield return → TypeScript 数组返回
 * - C# Util.TickFacing / Util.GetTurnDirection → WAngle.tickFacing / internal _getTurnDirection
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
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
}

// ---------------------------------------------------------------------------
// Fly
// ---------------------------------------------------------------------------

/**
 * Core flight activity: fly toward a target, handling altitude, facing,
 * turn radius, range annulus, and cancellation landing.
 *
 * OpenRA 对照: Fly activity
 *
 * This is the foundational aircraft activity. All other aircraft activities
 * (TakeOff, Land, FlyForward, FlyIdle, FlyOffMap, FlyAttack, FlyFollow,
 * ReturnToBase) depend on its static helpers (flyTick, verticalTakeOffOrLandTick,
 * calculateTurnRadius).
 *
 * Key behaviors:
 * - Flies toward target at cruise altitude
 * - Handles min/max range annulus (slide inside min range, stop inside max)
 * - Turn radius avoidance for non-sliding aircraft
 * - Position history ring buffer to detect being blocked
 * - Cancellation handling: returns to sensible height (TakeOff or vertical tick)
 */
export class Fly extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Aircraft trait reference. */
  private readonly aircraft: AircraftLike

  /** Maximum range for target annulus (0 = no max range). */
  private readonly maxRange: WDist

  /** Minimum range for target annulus (0 = no min range). */
  private readonly minRange: WDist

  /** Target line color (null = no target line). */
  private readonly targetLineColor: ColorStub | null

  /** "Near enough" distance for blocked detection. */
  private readonly nearEnough: WDist

  /** Current target. */
  protected target: Target

  /** Last known visible target position (fallback when target hidden). */
  private lastVisibleTarget: Target

  /** Whether to use lastVisibleTarget instead of target. */
  private useLastVisibleTarget: boolean = false

  /** Position history ring buffer (capacity 5) for blocked detection. */
  private readonly previousPositions: WPos[] = new Array(5)
  private posIndex: number = 0
  private posCount: number = 0

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a Fly activity.
   *
   * Supports multiple overloads through parameter analysis:
   * - Fly(self, target, nearEnough, initialPos?, color?)
   * - Fly(self, target, initialPos?, color?)
   * - Fly(self, target, minRange, maxRange, initialPos?, color?)
   *
   * @param self — the actor performing this activity
   * @param target — the target to fly toward
   * @param arg3 — WDist (nearEnough or minRange), WPos (initialPos), or null/undefined
   * @param arg4 — WDist (maxRange), WPos (initialPos), ColorStub, or null/undefined
   * @param arg5 — WPos (initialPos), ColorStub, or null/undefined
   * @param arg6 — ColorStub or null/undefined
   */
  constructor(
    self: GameActor,
    target: Target,
    arg3?: WDist | WPos | null,
    arg4?: WDist | WPos | ColorStub | null,
    arg5?: WPos | ColorStub | null,
    arg6?: ColorStub | null,
  ) {
    super()
    this.target = target

    // Resolve Aircraft trait
    this.aircraft = Fly._resolveAircraft(self)

    // Parse constructor overloads
    // We need to distinguish WDist from WPos. WDist has .length, WPos has .X/.Y/.Z
    const isWDist = (v: unknown): v is WDist =>
      v !== null && v !== undefined && typeof v === 'object' && 'length' in v && !('X' in v)
    const isWPos = (v: unknown): v is WPos =>
      v !== null && v !== undefined && typeof v === 'object' && 'X' in v && 'Y' in v && 'Z' in v

    if (arg3 !== undefined && arg3 !== null && isWDist(arg3)) {
      // Could be nearEnough or minRange
      if (arg4 !== undefined && arg4 !== null && isWDist(arg4)) {
        // Overload: minRange, maxRange
        this.minRange = arg3
        this.maxRange = arg4
        this.nearEnough = WDist.Zero
        this.targetLineColor = (arg6 as ColorStub | null) ?? null
        this.lastVisibleTarget = Fly._initializeLastVisibleTarget(
          self,
          target,
          isWPos(arg5) ? arg5 : null,
        )
      } else {
        // Overload: nearEnough
        this.nearEnough = arg3
        this.minRange = WDist.Zero
        this.maxRange = WDist.Zero
        this.targetLineColor = arg5 !== undefined ? (arg5 as ColorStub | null) : (arg4 as ColorStub | null)
        this.lastVisibleTarget = Fly._initializeLastVisibleTarget(
          self,
          target,
          isWPos(arg4) ? arg4 : null,
        )
      }
    } else {
      // Overload: no WDist as arg3
      this.nearEnough = WDist.Zero
      this.minRange = WDist.Zero
      this.maxRange = WDist.Zero
      this.targetLineColor = arg4 !== undefined ? (arg4 as ColorStub | null) : (arg3 as ColorStub | null)
      this.lastVisibleTarget = Fly._initializeLastVisibleTarget(
        self,
        target,
        isWPos(arg3) ? arg3 : null,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Static helpers — resolve aircraft / initialize last visible target
  // ---------------------------------------------------------------------------

  /** Resolve Aircraft trait from actor via duck typing. */
  private static _resolveAircraft(self: GameActor): AircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const aircraft = actorAny.traits?.get('Aircraft') as AircraftLike | undefined
    if (!aircraft) {
      throw new Error('Fly requires an Aircraft trait on the actor')
    }
    return aircraft
  }

  /** Initialize lastVisibleTarget from constructor parameters. */
  private static _initializeLastVisibleTarget(
    self: GameActor,
    target: Target,
    initialTargetPosition: WPos | null,
  ): Target {
    const actorAny = self as unknown as { owner?: unknown }

    // The target may become hidden between the initial order request and the first tick
    // Moving to any position (even if quite stale) is still better than immediately giving up
    if (
      (target.type === TargetType.Actor &&
        (target.actor as unknown as { canBeViewedByPlayer?: (p: unknown) => boolean })?.canBeViewedByPlayer?.(
          actorAny.owner,
        )) ||
      target.type === TargetType.FrozenActor ||
      target.type === TargetType.Terrain
    ) {
      return Target.fromPos(target.centerPosition)
    } else if (initialTargetPosition !== null) {
      return Target.fromPos(initialTargetPosition)
    }
    return Target.Invalid
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
  static flyTick(
    self: GameActor,
    aircraft: AircraftLike,
    desiredFacing: WAngle,
    desiredAltitude: WDist,
    moveOverride: WVec = WVec.Zero,
    idleTurn: boolean = false,
  ): void {
    const actorAny = self as unknown as { world?: { map?: { distanceAboveTerrain: (pos: WPos) => WDist } } }
    const dat =
      actorAny.world?.map?.distanceAboveTerrain(aircraft.centerPosition) ??
      WDist.Zero

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
        : new WAngle(roll.angle * Fly._getTurnDirection(aircraft.facing, oldFacing))
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
      const deltaZ = Fly._clamp(moveZ, -maxDelta, maxDelta)
      const adjustedMove = new WVec(move.X, move.Y, deltaZ)
      aircraft.setPosition(self, WPos.add(aircraft.centerPosition, adjustedMove))
    } else {
      aircraft.setPosition(self, WPos.add(aircraft.centerPosition, move))
    }
  }

  // ---------------------------------------------------------------------------
  // Static verticalTakeOffOrLandTick — vertical-only altitude change
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
  static verticalTakeOffOrLandTick(
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

    const actorAny = self as unknown as {
      world?: { map?: { distanceAboveTerrain: (pos: WPos) => WDist } }
    }
    const dat =
      actorAny.world?.map?.distanceAboveTerrain(aircraft.centerPosition) ??
      WDist.Zero

    if (WDist.equals(dat, desiredAltitude)) return false

    const maxDelta = aircraft.info.altitudeVelocity.length
    const deltaZ = Fly._clamp(desiredAltitude.length - dat.length, -maxDelta, maxDelta)
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
  static calculateTurnRadius(speed: number, turnSpeed: WAngle): number {
    return turnSpeed.angle > 0 ? Math.trunc((180 * speed) / turnSpeed.angle) : 0
  }

  // ---------------------------------------------------------------------------
  // Instance tick — target tracking and approach logic
  // ---------------------------------------------------------------------------

  /**
   * Tick the Fly activity: track target, adjust facing, handle range annulus.
   *
   * OpenRA 对照: Fly.Tick(Actor)
   *
   * @param self — the actor performing this activity
   * @returns true if complete (reached target or target invalid), false to continue
   */
  override tick(self: GameActor): boolean {
    // Refuse to take off if it would land immediately again
    if (this.aircraft.forceLanding) {
      this.cancel(self)
    }

    const actorAny = self as unknown as {
      world?: { map?: { distanceAboveTerrain: (pos: WPos) => WDist } }
      currentActivity?: { isCanceling: boolean; nextActivity: Activity | null }
    }
    const dat =
      actorAny.world?.map?.distanceAboveTerrain(this.aircraft.centerPosition) ??
      WDist.Zero
    const isLanded = WDist.lessThanOrEqual(dat, this.aircraft.landAltitude)

    // HACK: Prevent paused (for example, EMP'd) aircraft from taking off
    if (isLanded && (this.aircraft as unknown as { isTraitPaused?: boolean }).isTraitPaused) {
      return false
    }

    if (this.isCanceling) {
      // We must return the actor to a sensible height before continuing
      const landWhenIdle = this.aircraft.info.idleBehavior === 1 // IdleBehaviorType.Land = 1
      const skipHeightAdjustment =
        landWhenIdle &&
        actorAny.currentActivity?.isCanceling &&
        actorAny.currentActivity?.nextActivity === null

      if (this.aircraft.info.canHover && !skipHeightAdjustment && !WDist.equals(dat, this.aircraft.info.cruiseAltitude)) {
        if (isLanded) {
          // Queue TakeOff to manage influence reservation and takeoff sounds
          // NOTE: Using dynamic import to avoid circular dependency with TakeOff.ts
          // which imports Fly.ts for its static helpers.
          void import('./TakeOff.js').then(({ TakeOff }) => {
            this.queueChild(new TakeOff(self))
          })
        } else {
          Fly.verticalTakeOffOrLandTick(
            self,
            this.aircraft,
            this.aircraft.facing,
            this.aircraft.info.cruiseAltitude,
          )
        }
        return false
      }
      return true
    } else if (isLanded) {
      // Not canceling but on the ground — take off first
      void import('./TakeOff.js').then(({ TakeOff }) => {
        this.queueChild(new TakeOff(self))
      })
      return false
    }

    // Recalculate target (handle visibility changes)
    const [recalculatedTarget, targetIsHiddenActor] = this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
    this.target = recalculatedTarget

    if (!targetIsHiddenActor && this.target.type === TargetType.Actor) {
      this.lastVisibleTarget = Target.fromTargetPositions(this.target)
    }

    this.useLastVisibleTarget =
      targetIsHiddenActor || !this.target.isValidFor(self as unknown as never)

    // Target is hidden or dead, and we don't have a fallback position
    if (this.useLastVisibleTarget && !this.lastVisibleTarget.isValidFor(self as unknown as never)) {
      return true
    }

    const checkTarget = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
    const pos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const delta = WPos.subtract(checkTarget.centerPosition, pos)

    // Inside the target annulus, so we're done
    const insideMaxRange =
      this.maxRange.length > 0 && checkTarget.isInRange(pos, this.maxRange)
    const insideMinRange =
      this.minRange.length > 0 && checkTarget.isInRange(pos, this.minRange)
    if (insideMaxRange && !insideMinRange) return true

    const isSlider = this.aircraft.info.canSlide

    // Determine desired facing
    let desiredFacing = this.aircraft.facing
    if (delta.horizontalLengthSquared !== 0) {
      const facing = delta.yaw
      // Prevent jittering
      const diff = Math.abs(facing.angle - desiredFacing.angle)
      const deadzone = this.aircraft.info.turnDeadzone.angle
      if (diff > deadzone && diff < 1024 - deadzone) {
        desiredFacing = facing
      }
    }

    const move = isSlider
      ? this.aircraft.flyStep(desiredFacing)
      : this.aircraft.flyStep(this.aircraft.facing)

    // Inside the minimum range, so reverse if we can slide, otherwise face away
    if (insideMinRange) {
      if (isSlider) {
        Fly.flyTick(
          self,
          this.aircraft,
          desiredFacing,
          this.aircraft.info.cruiseAltitude,
          WVec.negate(move),
        )
      } else {
        Fly.flyTick(
          self,
          this.aircraft,
          WAngle.add(desiredFacing, new WAngle(512)),
          this.aircraft.info.cruiseAltitude,
          move,
        )
      }
      return false
    }

    // HACK: Consider ourselves blocked if we have moved by less than 64 WDist
    // in the last five ticks. Stop if we are blocked and close enough.
    if (
      this.posCount === 5 &&
      WPos.subtract(this.previousPositions[this.posIndex], this.previousPositions[(this.posIndex + 4) % 5]).lengthSquared < 4096 &&
      delta.horizontalLengthSquared <= this.nearEnough.lengthSquared
    ) {
      return true
    }

    // The next move would overshoot, so consider it close enough or set final position
    if (delta.horizontalLengthSquared < move.horizontalLengthSquared) {
      // For VTOL landing to succeed, it must reach the exact target position,
      // so for the final move it needs to behave as if it had CanSlide.
      if (isSlider || this.aircraft.info.vTOL) {
        // Set final (horizontal) position
        if (delta.horizontalLengthSquared !== 0) {
          const deltaMove = new WVec(delta.X, delta.Y, 0)
          Fly.flyTick(self, this.aircraft, desiredFacing, dat, deltaMove)
        }

        // Move to CruiseAltitude, if not already there
        if (!WDist.equals(dat, this.aircraft.info.cruiseAltitude)) {
          Fly.verticalTakeOffOrLandTick(
            self,
            this.aircraft,
            this.aircraft.facing,
            this.aircraft.info.cruiseAltitude,
          )
          return false
        }
      }
      return true
    }

    // Turn radius check for non-sliders
    if (!isSlider) {
      const turnRadius = Fly.calculateTurnRadius(
        this.aircraft.movementSpeed,
        this.aircraft.turnSpeed,
      )

      // The current facing is a tangent of the minimal turn circle.
      // Make a perpendicular vector, and use it to locate the turn's center.
      const turnDir = Fly._getTurnDirection(this.aircraft.facing, desiredFacing)
      const turnCenterFacing = WAngle.add(this.aircraft.facing, new WAngle(turnDir * 256))

      const turnCenterDir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(turnCenterFacing))
      const scaledCenterDir = WVec.divide(WVec.multiply(turnCenterDir, turnRadius), 1024)

      const turnCenter = WPos.add(this.aircraft.centerPosition, scaledCenterDir)
      const distToCenterSq = WPos.subtract(checkTarget.centerPosition, turnCenter).horizontalLengthSquared
      if (distToCenterSq < turnRadius * turnRadius) {
        // Target is inside the turn circle — keep flying away
        desiredFacing = this.aircraft.facing
      }
    }

    // Record position and fly
    this._addPosition(pos)
    Fly.flyTick(self, this.aircraft, desiredFacing, this.aircraft.info.cruiseAltitude)

    return false
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Get targets for target line rendering.
   *
   * OpenRA 对照: Fly.GetTargets(Actor)
   */
  override getTargets(): Target[] {
    return [this.target]
  }

  /**
   * Get target line nodes for rendering.
   *
   * OpenRA 对照: Fly.TargetLineNodes(Actor)
   */
  override targetLineNodes(): TargetLineNode[] {
    if (this.targetLineColor !== null && this.targetLineColor !== undefined) {
      const t = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
      return [new TargetLineNode(t, this.targetLineColor)]
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Add a position to the ring buffer. */
  private _addPosition(pos: WPos): void {
    this.previousPositions[this.posIndex] = pos
    this.posIndex = (this.posIndex + 1) % 5
    if (this.posCount < 5) this.posCount++
  }

  /** Get the turn direction: +1 for clockwise, -1 for counter-clockwise. */
  private static _getTurnDirection(current: WAngle, desired: WAngle): number {
    const diff = WAngle.subtract(desired, current).angle
    return diff <= 512 ? 1 : -1
  }

  /** Clamp a value to [min, max]. */
  private static _clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }
}
