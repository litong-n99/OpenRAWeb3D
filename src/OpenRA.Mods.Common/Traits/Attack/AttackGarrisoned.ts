/**
 * AttackGarrisoned.ts -- Garrison-based attack via fire ports (STUB)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Attack/AttackGarrisoned.cs (235 lines)
 *
 * 核心范式转换:
 * - C# AttackGarrisoned : AttackFollow, INotifyPassengerEntered, INotifyPassengerExited, IRender
 *   → TS stub with deferred full implementation
 * - C# FirePort struct → TS FirePort interface
 * - C# Cargo/Passenger integration → deferred (TODO-8.D.DEFER-GARRISONED)
 */

import type { IGameActor, ITick } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { AttackFollow, AttackFollowInfo } from './AttackFollow.js'

// TODO-8.D.DEFER-GARRISONED: Full implementation requires:
// - Cargo/Passenger trait (passenger management)
// - RenderSprites full integration (muzzle flash Animation + AnimationWithOffset)
// - BodyOrientation for port offset calculation
// - Passenger-facing and positioning logic
// Deferred until Ch8 Phase E (Turreted) and Ch11 (Cargo/Passenger).

// ---------------------------------------------------------------------------
// FirePort
// OpenRA 对照: FirePort class
// ---------------------------------------------------------------------------

/** Fire port configuration for garrisoned units.
 *
 *  OpenRA 对照: FirePort (class with WVec Offset, WAngle Yaw, WAngle Cone)
 */
export interface FirePort {
  readonly offset: WVec
  readonly yaw: WAngle
  readonly cone: WAngle
}

// ---------------------------------------------------------------------------
// AttackGarrisonedInfo
// ---------------------------------------------------------------------------

/** Stub configuration for AttackGarrisoned.
 *
 *  OpenRA 对照: AttackGarrisonedInfo : AttackFollowInfo, IRulesetLoaded, Requires<CargoInfo>
 */
export class AttackGarrisonedInfo extends AttackFollowInfo {
  /** Fire port offsets in local coordinates.
   *
   *  OpenRA 对照: AttackGarrisonedInfo.PortOffsets
   */
  readonly portOffsets: readonly WVec[] = [WVec.Zero]

  /** Fire port yaw angles.
   *
   *  OpenRA 对照: AttackGarrisonedInfo.PortYaws
   */
  readonly portYaws: readonly WAngle[] = [WAngle.Zero]

  /** Fire port yaw cone angles.
   *
   *  OpenRA 对照: AttackGarrisonedInfo.PortCones
   */
  readonly portCones: readonly WAngle[] = [WAngle.Zero]

  /** Pre-computed fire ports.
   *
   *  OpenRA 对照: AttackGarrisonedInfo.Ports
   */
  readonly ports: readonly FirePort[] = []

  /** Muzzle flash palette.
   *
   *  OpenRA 对照: AttackGarrisonedInfo.MuzzlePalette
   */
  readonly muzzlePalette: string = 'effect'

  constructor(
    params: {
      portOffsets?: WVec[]
      portYaws?: WAngle[]
      portCones?: WAngle[]
      muzzlePalette?: string
    } & ConstructorParameters<typeof AttackFollowInfo>[0] = {},
  ) {
    super(params)
    this.portOffsets = params.portOffsets ?? [WVec.Zero]
    this.portYaws = params.portYaws ?? [WAngle.Zero]
    this.portCones = params.portCones ?? [WAngle.Zero]
    this.muzzlePalette = params.muzzlePalette ?? 'effect'

    // Build FirePort array
    const ports: FirePort[] = []
    for (let i = 0; i < this.portOffsets.length; i++) {
      ports.push({
        offset: this.portOffsets[i]!,
        yaw: this.portYaws[i] ?? WAngle.Zero,
        cone: this.portCones[i] ?? WAngle.Zero,
      })
    }
    ;(this as { ports: readonly FirePort[] }).ports = ports
  }
}

// ---------------------------------------------------------------------------
// AttackGarrisoned (STUB)
// ---------------------------------------------------------------------------

/** Garrison-based attack: passengers fire through fire ports.
 *
 *  OpenRA 对照: AttackGarrisoned (AttackFollow, INotifyPassengerEntered, INotifyPassengerExited, IRender)
 *
 *  TODO-8.D.DEFER-GARRISONED: Full implementation deferred until Cargo/Passenger
 *  traits are migrated (Ch8 Phase E / Ch11).
 */
export class AttackGarrisoned extends AttackFollow implements ITick {
  /** Override info type for access to fire ports. */
  declare readonly info: AttackGarrisonedInfo

  constructor(info: AttackGarrisonedInfo) {
    super(info)
  }

  // ---------------------------------------------------------------------------
  // ITick
  // ---------------------------------------------------------------------------

  /** Tick stub: throws descriptive error.
   *
   *  OpenRA 对照: AttackGarrisoned.Tick(Actor)
   */
  tick(_self: IGameActor): void {
    // TODO-8.D.DEFER-GARRISONED: Full implementation deferred
    throw new Error(
      'AttackGarrisoned.tick(): Not yet implemented. ' +
      'Cargo/Passenger traits are planned for Ch11 (Production & Building).',
    )
  }

  // ---------------------------------------------------------------------------
  // Attack override (stub)
  // ---------------------------------------------------------------------------

  /** DoAttack stub.
   *
   *  OpenRA 对照: AttackGarrisoned.DoAttack(Actor, Target)
   */
  override doAttack(_self: IGameActor, _target: Target): void {
    // TODO-8.D.DEFER-GARRISONED: Full implementation deferred
    throw new Error(
      'AttackGarrisoned.doAttack(): Not yet implemented. ' +
      'Cargo/Passenger traits are planned for Ch11 (Production & Building).',
    )
  }
}
