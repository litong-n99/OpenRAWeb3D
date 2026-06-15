/**
 * Fly.ts — 核心飞行活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/Fly.cs
 *
 * 核心范式转换:
 * - C# RingBuffer<WPos> → TypeScript 固定大小循环数组（inline, capacity 5）
 * - C# static FlyTick() / VerticalTakeOffOrLandTick() / CalculateTurnRadius()
 *   → 共享工具模块 `AircraftFlightUtils.ts`
 * - C# yield return → TypeScript 数组返回
 * - C# Util.TickFacing / Util.GetTurnDirection → WAngle.tickFacing / _getTurnDirection
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
import { TakeOff } from './TakeOff.js'
import {
  type AircraftLike,
  type AircraftInfoLike,
  flyTick,
  verticalTakeOffOrLandTick,
  calculateTurnRadius,
  getDistanceAboveTerrain,
  isColorStub,
  isWDist,
  isWPos,
} from './AircraftFlightUtils.js'

// Re-export types for backward-compatible imports
export type { AircraftLike, AircraftInfoLike }

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
 * ReturnToBase) depend on the static helpers in `AircraftFlightUtils.ts`.
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
    if (arg3 !== undefined && arg3 !== null && isWDist(arg3)) {
      // Could be nearEnough or minRange
      if (arg4 !== undefined && arg4 !== null && isWDist(arg4)) {
        // Overload: minRange, maxRange
        this.minRange = arg3
        this.maxRange = arg4
        this.nearEnough = WDist.Zero
        this.targetLineColor = arg6 !== undefined && arg6 !== null && isColorStub(arg6) ? arg6 : null
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
        const colorCandidate = arg5 !== undefined ? arg5 : arg4
        this.targetLineColor = colorCandidate !== undefined && colorCandidate !== null && isColorStub(colorCandidate) ? colorCandidate : null
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
      const colorCandidate = arg4 !== undefined ? arg4 : arg3
      this.targetLineColor = colorCandidate !== undefined && colorCandidate !== null && isColorStub(colorCandidate) ? colorCandidate : null
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
      currentActivity?: { isCanceling: boolean; nextActivity: Activity | null }
    }
    const dat = getDistanceAboveTerrain(self, this.aircraft.centerPosition)
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
          this.queueChild(new TakeOff(self))
        } else {
          verticalTakeOffOrLandTick(
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
      this.queueChild(new TakeOff(self))
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
        flyTick(
          self,
          this.aircraft,
          desiredFacing,
          this.aircraft.info.cruiseAltitude,
          WVec.negate(move),
        )
      } else {
        flyTick(
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
          flyTick(self, this.aircraft, desiredFacing, dat, deltaMove)
        }

        // Move to CruiseAltitude, if not already there
        if (!WDist.equals(dat, this.aircraft.info.cruiseAltitude)) {
          verticalTakeOffOrLandTick(
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
      const turnRadius = calculateTurnRadius(
        this.aircraft.movementSpeed,
        this.aircraft.turnSpeed,
      )

      // The current facing is a tangent of the minimal turn circle.
      // Make a perpendicular vector, and use it to locate the turn's center.
      const turnDir = getTurnDirection(this.aircraft.facing, desiredFacing)
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
    flyTick(self, this.aircraft, desiredFacing, this.aircraft.info.cruiseAltitude)

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

  // ---------------------------------------------------------------------------
  // Static helper shims — delegated to AircraftFlightUtils for reuse and to
  // avoid circular imports with TakeOff / Land.
  // ---------------------------------------------------------------------------

  /**
   * Core flight physics tick.
   *
   * OpenRA 对照: Fly.FlyTick(Actor, Aircraft, WAngle, WDist, WVec?, bool?)
   */
  public static flyTick(
    self: GameActor,
    aircraft: AircraftLike,
    desiredFacing: WAngle,
    desiredAltitude: WDist,
    moveOverride: WVec = WVec.Zero,
    idleTurn: boolean = false,
  ): void {
    return flyTick(self, aircraft, desiredFacing, desiredAltitude, moveOverride, idleTurn)
  }

  /**
   * Vertical-only altitude change.
   *
   * OpenRA 对照: Fly.VerticalTakeOffOrLandTick(Actor, Aircraft, WAngle, WDist, bool)
   */
  public static verticalTakeOffOrLandTick(
    self: GameActor,
    aircraft: AircraftLike,
    desiredFacing: WAngle,
    desiredAltitude: WDist,
    idleTurn: boolean = false,
  ): boolean {
    return verticalTakeOffOrLandTick(self, aircraft, desiredFacing, desiredAltitude, idleTurn)
  }

  /**
   * Calculate the turn radius from speed and turn rate.
   *
   * OpenRA 对照: Fly.CalculateTurnRadius(int, WAngle)
   */
  public static calculateTurnRadius(speed: number, turnSpeed: WAngle): number {
    return calculateTurnRadius(speed, turnSpeed)
  }
}

// ---------------------------------------------------------------------------
// Re-exported static helpers (backward-compatible shims)
// ---------------------------------------------------------------------------

/**
 * Get the turn direction: +1 for clockwise, -1 for counter-clockwise.
 *
 * Re-exported from AircraftFlightUtils for test compatibility.
 */
function getTurnDirection(current: WAngle, desired: WAngle): number {
  const diff = WAngle.subtract(desired, current).angle
  return diff <= 512 ? 1 : -1
}
