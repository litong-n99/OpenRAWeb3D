/**
 * Land.ts — 降落活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Air/Land.cs
 *
 * 核心范式转换:
 * - C# complex landing sequence (VTOL vs non-VTOL) → TypeScript with same logic
 * - C# approach trajectory math (tangent circles, waypoints) → Same math with WVec/WPos
 * - C# QueueChild multiple waypoints → TypeScript queueChild() multiple times
 * - C# OnFirstRun target assignment → onFirstRun override
 * - C# distanceAboveTerrain fallback → shared getDistanceAboveTerrain helper
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
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Turn } from '../Turn.js'
import { Wait } from '../Wait.js'
import { Fly } from './Fly.js'
import { TakeOff } from './TakeOff.js'
import type { INotifyLanding } from './AircraftActivityInterfaces.js'
import {
  type AircraftLike,
  getDistanceAboveTerrain,
  isColorStub,
  isWDist,
  isWVec,
} from './AircraftFlightUtils.js'

// ---------------------------------------------------------------------------
// Land
// ---------------------------------------------------------------------------

/**
 * Land at a target location (terrain or actor).
 *
 * OpenRA 对照: Land activity
 *
 * Complex landing sequence:
 * - VTOL: horizontal alignment → turn to facing → vertical descent
 * - Non-VTOL: approach trajectory (waypoints w1/w2/w3) → final descent
 *
 * Handles:
 * - Target position reevaluation (target may move)
 * - Landing cell search (find alternative if blocked)
 * - Cancellation during landing (continue or take off)
 * - Blocked landing (holding pattern with Wait/FlyIdle)
 * - Influence addition/removal
 * - Sound and notification on landing initiation
 */
export class Land extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Aircraft trait reference. */
  private readonly aircraft: AircraftLike

  /** Offset from target position. */
  private readonly offset: WVec

  /** Desired facing after landing (null = no preference). */
  private desiredFacing: WAngle | null

  /** Whether to assign target from self.Location on first run. */
  private readonly assignTargetOnFirstRun: boolean

  /** Cells that must be clear for landing. */
  private readonly clearCells: readonly CPos[]

  /** Range to search for alternative landing location. */
  private readonly landRange: WDist

  /** Target line color. */
  private readonly targetLineColor: ColorStub | null

  /** Current target. */
  private target: Target

  /** Target position (including offset). */
  private targetPosition: WPos = WPos.Zero

  /** Landing cell. */
  private landingCell: CPos = CPos.Zero

  /** Whether landing has been initiated (influence added, notifications sent). */
  private landingInitiated: boolean = false

  /** Whether approach waypoints have been queued (non-VTOL only). */
  private finishedApproach: boolean = false

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a Land activity.
   *
   * Supports multiple overloads:
   * - Land(self, facing?, color?)
   * - Land(self, target, facing?, color?)
   * - Land(self, target, landRange, facing?, color?)
   * - Land(self, target, offset, facing?, color?)
   * - Land(self, target, landRange, offset, facing?, clearCells?, color?)
   *
   * @param self — the actor performing this activity
   * @param arg2 — Target, WAngle (facing), or undefined/null
   * @param arg3 — WDist (landRange), WVec (offset), WAngle (facing), Color, or undefined/null
   * @param arg4 — WAngle (facing), WVec (offset), Color, or undefined/null
   * @param arg5 — WAngle (facing), Color, or undefined/null
   * @param arg6 — CPos[] (clearCells) or undefined/null
   * @param arg7 — Color or undefined/null
   */
  constructor(
    self: GameActor,
    arg2?: Target | WAngle | null,
    arg3?: WDist | WVec | WAngle | ColorStub | null,
    arg4?: WVec | WAngle | ColorStub | null,
    arg5?: WAngle | ColorStub | null,
    arg6?: readonly CPos[] | null,
    arg7?: ColorStub | null,
  ) {
    super()

    // Resolve Aircraft trait
    this.aircraft = Land._resolveAircraft(self)

    // Parse constructor overloads
    const isTarget = (v: unknown): v is Target =>
      v !== null && v !== undefined && v instanceof Target
    const isWAngle = (v: unknown): v is WAngle =>
      v !== null && v !== undefined && v instanceof WAngle

    if (arg2 === undefined || arg2 === null || isWAngle(arg2)) {
      // Overload: Land(self, facing?, color?)
      this.target = Target.Invalid
      this.assignTargetOnFirstRun = true
      this.offset = WVec.Zero
      this.desiredFacing = isWAngle(arg2) ? arg2 : null
      this.clearCells = []
      this.landRange = this.aircraft.info.landRange
      this.targetLineColor = Land._extractColor(arg3)
    } else if (isTarget(arg2)) {
      this.target = arg2
      this.assignTargetOnFirstRun = false

      if (arg3 === undefined || arg3 === null || isWAngle(arg3)) {
        // Overload: Land(self, target, facing?, color?)
        this.offset = WVec.Zero
        this.desiredFacing = isWAngle(arg3) ? arg3 : null
        this.clearCells = []
        this.landRange = this.aircraft.info.landRange
        this.targetLineColor = Land._extractColor(arg4)
      } else if (isWDist(arg3)) {
        // Could be Land(self, target, landRange, facing?, color?)
        // OR Land(self, target, landRange, offset, facing?, clearCells?, color?)
        if (arg4 !== undefined && arg4 !== null && isWVec(arg4)) {
          // Full overload: target, landRange, offset, facing?, clearCells?, color?
          this.landRange = arg3
          this.offset = arg4
          this.desiredFacing = isWAngle(arg5) ? arg5 : null
          this.clearCells = arg6 ?? []
          this.targetLineColor = Land._extractColor(arg7)
        } else {
          // Overload: target, landRange, facing?, color?
          this.offset = WVec.Zero
          this.landRange = arg3.length >= 0 ? arg3 : this.aircraft.info.landRange
          this.desiredFacing = isWAngle(arg4) ? arg4 : null
          this.clearCells = []
          this.targetLineColor = Land._extractColor(arg5)
        }
      } else if (isWVec(arg3)) {
        // Overload: Land(self, target, offset, facing?, color?)
        this.offset = arg3
        this.landRange = this.aircraft.info.landRange
        this.desiredFacing = isWAngle(arg4) ? arg4 : null
        this.clearCells = []
        this.targetLineColor = Land._extractColor(arg5)
      } else {
        // Fallback
        this.offset = WVec.Zero
        this.landRange = this.aircraft.info.landRange
        this.desiredFacing = null
        this.clearCells = []
        this.targetLineColor = null
      }
    } else {
      throw new Error('Land constructor received an invalid target argument')
    }

    // If no facing provided and TurnToLand is set, use InitialFacing
    if (this.desiredFacing === null && this.aircraft.info.turnToLand) {
      this.desiredFacing = this.aircraft.info.initialFacing
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Called once before first tick.
   *
   * OpenRA 对照: Land.OnFirstRun(Actor)
   *
   * When no target is provided, assign target from self.Location.
   */
  protected override onFirstRun(self: GameActor): void {
    if (this.assignTargetOnFirstRun) {
      const location = (self as unknown as { location?: CPos }).location
      if (location) {
        this.target = Target.fromCell(location)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Complex landing sequence tick.
   *
   * OpenRA 对照: Land.Tick(Actor)
   *
   * @param self — the actor landing
   * @returns true if landing complete, false to continue
   */
  override tick(self: GameActor): boolean {
    // Cancellation or invalid target
    if (this.isCanceling || this.target.type === TargetType.Invalid) {
      if (this.landingInitiated) {
        // We must return the actor to a sensible height before continuing
        const shouldLand = this.aircraft.info.idleBehavior === 1 // IdleBehaviorType.Land = 1
        const currentActivity = (self as unknown as { currentActivity?: { isCanceling: boolean; nextActivity: Activity | null } }).currentActivity
        const continueLanding =
          shouldLand &&
          currentActivity?.isCanceling &&
          currentActivity?.nextActivity === null

        if (!continueLanding) {
          const dat = getDistanceAboveTerrain(self, this.aircraft.centerPosition)
          if (
            WDist.greaterThan(dat, this.aircraft.landAltitude) &&
            WDist.lessThan(dat, this.aircraft.info.cruiseAltitude)
          ) {
            // Queue TakeOff to climb back to cruise altitude
            this.queueChild(new TakeOff(self))
            return false
          }

          // Remove influence
          const removeInfluence = (this.aircraft as unknown as { removeInfluence?: () => void }).removeInfluence
          if (removeInfluence) removeInfluence.call(this.aircraft)
          return true
        }
      } else {
        return true
      }
    }

    const pos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero

    // Reevaluate target position in case the target has moved
    this.targetPosition = WPos.add(this.target.centerPosition, this.offset)
    const actorAny = self as unknown as { world?: { map?: { cellContaining: (pos: WPos) => CPos } } }
    this.landingCell = actorAny.world?.map?.cellContaining(this.targetPosition) ?? CPos.Zero

    // We are already at the landing location
    const delta = WPos.subtract(pos, this.targetPosition)
    if (delta.horizontalLengthSquared === 0 && delta.Z === this.aircraft.landAltitude.length) {
      return true
    }

    // Look for free landing cell
    if (this.target.type === TargetType.Terrain && !this.landingInitiated) {
      const findLanding = (this.aircraft as unknown as { findLandingLocation?: (cell: CPos, range: WDist) => CPos | null }).findLandingLocation
      const newLocation = findLanding?.call(this.aircraft, this.landingCell, this.landRange)

      if (newLocation === null || newLocation === undefined) {
        // Cannot land so fly towards the last target location instead
        const moveTo = (this.aircraft as unknown as { moveToCell?: (cell: CPos, nearEnough: number) => Activity }).moveToCell
        if (moveTo) {
          this.queueChild(moveTo.call(this.aircraft, this.landingCell, 0))
        }
        return true
      }

      if (!CPos.equals(newLocation, this.landingCell)) {
        this.target = Target.fromCell(newLocation)
        this.targetPosition = WPos.add(this.target.centerPosition, this.offset)
        this.landingCell = actorAny.world?.map?.cellContaining(this.targetPosition) ?? CPos.Zero

        const delta2 = WPos.subtract(pos, this.targetPosition)
        if (delta2.horizontalLengthSquared === 0 && delta2.Z === this.aircraft.landAltitude.length) {
          return true
        }
      }
    }

    // Move towards landing location/facing
    if (this.aircraft.info.vTOL) {
      const horizontalDelta = WPos.subtract(pos, this.targetPosition)
      if (horizontalDelta.horizontalLengthSquared !== 0) {
        this.queueChild(new Fly(self, Target.fromPos(this.targetPosition)))
        return false
      }

      if (this.desiredFacing !== null && !WAngle.equals(this.desiredFacing, this.aircraft.facing)) {
        this.queueChild(new Turn(self, this.desiredFacing))
        return false
      }
    }

    // Non-VTOL approach trajectory
    if (!this.aircraft.info.vTOL && !this.finishedApproach) {
      // Calculate approach trajectory
      const altitude = this.aircraft.info.cruiseAltitude.length

      // Distance required for descent
      const landDistance = Math.trunc((altitude * 1024) / this.aircraft.info.maximumPitch.tan())

      // Approach landing from the opposite direction of the desired facing
      const rotation = this.desiredFacing !== null ? WRot.fromYaw(this.desiredFacing) : WRot.None
      const approachStart = WPos.add(
        this.targetPosition,
        new WVec(0, landDistance, altitude).rotate(rotation),
      )

      // Add 10% to the turning radius to ensure we have enough room
      const speed = Math.trunc((this.aircraft.movementSpeed * 32) / 35)
      const turnRadius = Fly.calculateTurnRadius(speed, this.aircraft.turnSpeed)

      // Find the center of the turning circles for clockwise and counterclockwise turns
      const angle = this.aircraft.facing
      const fwd = new WVec(-angle.sin(), -angle.cos(), 0)

      // Work out whether we should turn clockwise or counter-clockwise for approach
      const side = new WVec(-fwd.Y, fwd.X, fwd.Z)
      const approachDelta = WPos.subtract(pos, approachStart)
      const sideTowardBase = WVec.dot(side, approachDelta) <= WVec.dot(WVec.negate(side), approachDelta)
        ? side
        : WVec.negate(side)

      // Calculate the tangent line that joins the turning circles
      const cp = WPos.add(pos, WVec.divide(WVec.multiply(sideTowardBase, turnRadius), 1024))
      const posCenter = new WPos(cp.X, cp.Y, altitude)
      const approachCenter = WPos.add(
        approachStart,
        new WVec(0, Math.sign(WPos.subtract(pos, approachStart).Y) * turnRadius, 0),
      )
      const tangentDirection = WPos.subtract(approachCenter, posCenter)
      const tangentLength = tangentDirection.length
      let tangentOffset = WVec.Zero
      if (tangentLength !== 0) {
        tangentOffset = WVec.divide(
          WVec.multiply(new WVec(-tangentDirection.Y, tangentDirection.X, 0), turnRadius),
          tangentLength,
        )
      }

      // TODO: correctly handle CCW <-> CW turns
      if (tangentOffset.X > 0) {
        tangentOffset = WVec.negate(tangentOffset)
      }

      const w1 = WPos.add(posCenter, tangentOffset)
      const w2 = WPos.add(approachCenter, tangentOffset)
      const w3 = approachStart

      const finalTurnRadius = Fly.calculateTurnRadius(
        this.aircraft.info.speed,
        this.aircraft.turnSpeed,
      )

      // Move along approach trajectory
      this.queueChild(new Fly(self, Target.fromPos(w1), WDist.Zero, new WDist(finalTurnRadius * 3)))
      this.queueChild(new Fly(self, Target.fromPos(w2)))

      // Fix a problem when the airplane is sent to land near the landing cell
      this.queueChild(new Fly(self, Target.fromPos(w3), WDist.Zero, new WDist(Math.trunc(finalTurnRadius / 2))))
      this.finishedApproach = true
      return false
    }

    // Landing initiation
    if (!this.landingInitiated) {
      const blockingCells = [...this.clearCells, this.landingCell]

      const canLand = (this.aircraft as unknown as { canLandMulti?: (cells: readonly CPos[], actor: unknown, blockedByMobile: boolean) => boolean }).canLandMulti
      if (canLand && !canLand.call(this.aircraft, blockingCells, this.target.actor, true)) {
        // Maintain holding pattern
        // NOTE: Using Wait as a placeholder for FlyIdle (implemented in Batch 2)
        // Replace with FlyIdle when Batch 2 is implemented
        this.queueChild(new Wait(25))

        // Notify blockers
        const notifyBlocker = (self as unknown as { notifyBlocker?: (cells: CPos[]) => void }).notifyBlocker
        if (notifyBlocker) notifyBlocker(blockingCells)

        this.finishedApproach = false
        return false
      }

      // Play landing sound
      const sounds = this.aircraft.info as unknown as { landingSounds?: readonly string[] }
      if (sounds.landingSounds && sounds.landingSounds.length > 0) {
        const playSound = (self as unknown as { world?: { playSound?: (type: string, sounds: readonly string[], world: unknown, pos: unknown) => void } }).world?.playSound
        if (playSound) {
          playSound('World', sounds.landingSounds, self.world, this.aircraft.centerPosition)
        }
      }

      // Notify INotifyLanding traits
      const actorTraits = self as unknown as { traits?: Map<string, unknown> }
      if (actorTraits.traits) {
        for (const [, trait] of actorTraits.traits) {
          const notify = trait as Partial<INotifyLanding>
          if (typeof notify.landing === 'function') {
            notify.landing(self)
          }
        }
      }

      // Add influence
      const addInfluenceCell = (this.aircraft as unknown as { addInfluenceCell?: (cell: CPos) => void }).addInfluenceCell
      if (addInfluenceCell) addInfluenceCell.call(this.aircraft, this.landingCell)

      // Entering cell
      const enteringCell = (this.aircraft as unknown as { enteringCell?: (self: GameActor) => void }).enteringCell
      if (enteringCell) enteringCell.call(this.aircraft, self)

      this.landingInitiated = true
    }

    // Final descent
    if (this.aircraft.info.vTOL) {
      const terrainAlt = getDistanceAboveTerrain(self, this.targetPosition)
      const landAltitude = WDist.add(terrainAlt, this.aircraft.landAltitude)
      if (Fly.verticalTakeOffOrLandTick(self, this.aircraft, this.aircraft.facing, landAltitude)) {
        return false
      }
      return true
    }

    const d = WPos.subtract(this.targetPosition, pos)

    // The next move would overshoot, so just set the final position
    const move = this.aircraft.flyStep(this.aircraft.facing)
    if (d.horizontalLengthSquared < move.horizontalLengthSquared) {
      const landingAltVec = new WVec(0, 0, this.aircraft.landAltitude.length)
      this.aircraft.setPosition(self, WPos.add(this.targetPosition, landingAltVec))
      return true
    }

    const landingAlt = WDist.add(
      getDistanceAboveTerrain(self, this.targetPosition),
      this.aircraft.landAltitude,
    )
    Fly.flyTick(self, this.aircraft, d.yaw, landingAlt)

    return false
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Get target line nodes for rendering.
   *
   * OpenRA 对照: Land.TargetLineNodes(Actor)
   */
  override targetLineNodes(): TargetLineNode[] {
    if (this.targetLineColor !== null && this.targetLineColor !== undefined) {
      return [new TargetLineNode(this.target, this.targetLineColor)]
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolve Aircraft trait from actor via duck typing. */
  private static _resolveAircraft(self: GameActor): AircraftLike {
    const actorAny = self as unknown as { traits?: Map<string, unknown> }
    const aircraft = actorAny.traits?.get('Aircraft') as AircraftLike | undefined
    if (!aircraft) {
      throw new Error('Land requires an Aircraft trait on the actor')
    }
    return aircraft
  }

  /**
   * Extract a ColorStub from an unknown argument, returning null if not a valid
   * color object.
   */
  private static _extractColor(v: unknown): ColorStub | null {
    return isColorStub(v) ? v : null
  }
}
