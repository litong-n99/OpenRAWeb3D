/**
 * AttackAircraft.ts -- Aircraft-specific attack variant
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Air/AttackAircraft.cs (69 lines)
 *
 * 核心范式转换:
 * - C# AttackFollow + AircraftInfo → TS extends AttackFollow
 * - C# AirAttackType enum → TS const object
 * - C# AircraftInfo.MinAirborneAltitude → TS duck-typed with fallback
 * - C# FlyAttack activity → TODO-8.E.AIR-MOVE deferral
 * - C# CanAttack override → TS override with altitude + map containment checks
 */

import {
  type IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { AttackFollow, AttackFollowInfo } from '../Attack/AttackFollow.js'

// ---------------------------------------------------------------------------
// AirAttackType enum
// OpenRA 对照: AirAttackType { Default, Hover, Strafe }
// ---------------------------------------------------------------------------

export const AirAttackType = {
  Default: 0,
  Hover: 1,
  Strafe: 2,
} as const
export type AirAttackType =
  (typeof AirAttackType)[keyof typeof AirAttackType]

// ---------------------------------------------------------------------------
// AttackAircraftInfo
// OpenRA 对照: AttackAircraftInfo (AttackFollowInfo, Requires<AircraftInfo>)
// ---------------------------------------------------------------------------

/** Configuration for AttackAircraft trait.
 *
 *  OpenRA 对照: AttackAircraftInfo
 */
export class AttackAircraftInfo extends AttackFollowInfo {
  /** Attack behavior: Default, Hover, or Strafe.
   *
   *  OpenRA 对照: AttackAircraftInfo.AttackType (default AirAttackType.Default)
   */
  readonly attackType: AirAttackType = AirAttackType.Default

  /** Distance the strafing aircraft makes to a target before turning for another pass.
   *  When set to WDist.Zero this defaults to the maximum armament range.
   *
   *  OpenRA 对照: AttackAircraftInfo.StrafeRunLength (default WDist.Zero)
   */
  readonly strafeRunLength: WDist = WDist.Zero

  constructor(params: {
    instanceName?: string
    armaments?: string[]
    opportunityFire?: boolean
    persistentTargeting?: boolean
    rangeMargin?: number
    abortOnResupply?: boolean
    attackType?: AirAttackType
    strafeRunLength?: WDist
    facingTolerance?: WAngle
  } = {}) {
    super(params)
    this.attackType = params.attackType ?? AirAttackType.Default
    this.strafeRunLength = params.strafeRunLength ?? WDist.Zero
  }
}

// ---------------------------------------------------------------------------
// AttackAircraft
// OpenRA 对照: AttackAircraft (AttackFollow)
// ---------------------------------------------------------------------------

/** Aircraft-specific attack variant.
 *
 *  OpenRA 对照: AttackAircraft
 *
 *  Adds altitude check and air-specific attack types (Hover, Strafe).
 *  Movement activities deferred to Chapter 9.
 */
export class AttackAircraft extends AttackFollow {
  /** Strongly-typed info.
   *
   *  OpenRA 对照: AttackAircraft.Info (new readonly)
   */
  declare readonly info: AttackAircraftInfo

  // Duck-typed AircraftInfo (deferred to Chapter 9)
  private aircraftInfo: { minAirborneAltitude: number } | null = null

  constructor(info: AttackAircraftInfo) {
    super(info)
    this.info = info
  }

  /** Set the aircraft info duck-typed reference.
   *
   *  OpenRA 对照: AttackAircraft constructor: aircraftInfo = self.Info.TraitInfo<AircraftInfo>()
   */
  setAircraftInfo(aircraftInfo: { minAirborneAltitude: number } | null): void {
    this.aircraftInfo = aircraftInfo
  }

  // -----------------------------------------------------------------------
  // CanAttack
  // -----------------------------------------------------------------------

  /** Check if this aircraft can attack the given target.
   *
   *  OpenRA 对照: AttackAircraft.CanAttack(Actor self, in Target target)
   *
   *  - Don't fire while landed or when outside the map.
   *  - Delegates to AttackFollow.CanAttack for standard checks.
   *  - Checks TargetInFiringArc for facing tolerance.
   *
   *  @param self — the actor
   *  @param target — the potential target
   *  @returns whether the target can be attacked
   */
  override canAttack(
    self: IGameActor,
    target: Target,
  ): boolean {
    // Don't fire while landed or when outside the map
    const worldMap = (self.world as unknown as {
      map?: {
        distanceAboveTerrain?: (pos: unknown) => { length: number }
        contains?: (pos: unknown) => boolean
      }
    })?.map

    const centerPos = (self as unknown as { centerPosition?: unknown }).centerPosition
    const location = (self as unknown as { location?: unknown }).location

    if (worldMap?.distanceAboveTerrain && centerPos) {
      const altitude = worldMap.distanceAboveTerrain(centerPos).length
      const minAltitude = this.aircraftInfo?.minAirborneAltitude ?? 0
      if (altitude < minAltitude) return false
    }

    if (worldMap?.contains && location) {
      if (!worldMap.contains(location)) return false
    }

    if (!super.canAttack(self, target)) return false

    return this.targetInFiringArc(self, target, this.info.facingTolerance)
  }

  // -----------------------------------------------------------------------
  // getAttackActivity
  // -----------------------------------------------------------------------

  /** Create the FlyAttack activity.
   *
   *  OpenRA 对照: AttackAircraft.GetAttackActivity()
   *
   *  TODO-8.E.AIR-MOVE: Requires Aircraft movement (Chapter 9).
   *    C# returns new FlyAttack(self, source, newTarget, forceAttack, targetLineColor)
   *
   *  @param _self — the actor
   *  @param _source — attack source
   *  @param _newTarget — the target
   *  @param _allowMove — whether movement is allowed
   *  @param _forceAttack — force attack regardless of stance
   *  @param _targetLineColor — color for target line
   *  @throws Error (not yet implemented)
   */
  override getAttackActivity(
    _self: IGameActor,
    _source: unknown,
    _newTarget: Target,
    _allowMove: boolean,
    _forceAttack: boolean,
    _targetLineColor?: string,
  ): unknown {
    // TODO-8.E.AIR-MOVE: Requires Aircraft movement (Chapter 9)
    // C# returns new FlyAttack(self, source, newTarget, forceAttack, targetLineColor)
    throw new Error(
      'AttackAircraft.getAttackActivity requires Chapter 9 movement system',
    )
  }
}
