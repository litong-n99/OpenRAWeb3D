/**
 * AttackCharges.ts -- Charge-limited attack (must charge before firing)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Attack/AttackCharges.cs (77 lines)
 *
 * 核心范式转换:
 * - C# AttackCharges : AttackOmni → TS AttackCharges extends AttackOmni
 * - C# INotifyAttack, INotifySold → TS interfaces
 * - C# ChargingCondition → TS condition token management
 */

import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackOmni, AttackOmniInfo } from './AttackOmni.js'
import type { INotifyAttack, Barrel } from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// AttackChargesInfo
// ---------------------------------------------------------------------------

/** Configuration for AttackCharges.
 *
 *  OpenRA 对照: AttackChargesInfo
 */
export class AttackChargesInfo extends AttackOmniInfo {
  /** Amount of charge required to attack.
   *
   *  OpenRA 对照: AttackChargesInfo.ChargeLevel
   */
  readonly chargeLevel: number = 25

  /** Amount to increase charge each tick with a valid target.
   *
   *  OpenRA 对照: AttackChargesInfo.ChargeRate
   */
  readonly chargeRate: number = 1

  /** Amount to decrease charge each tick without a valid target.
   *
   *  OpenRA 对照: AttackChargesInfo.DischargeRate
   */
  readonly dischargeRate: number = 1

  /** Condition granted while charge level > 0.
   *
   *  OpenRA 对照: AttackChargesInfo.ChargingCondition
   */
  readonly chargingCondition: string | null = null

  constructor(
    params: {
      chargeLevel?: number
      chargeRate?: number
      dischargeRate?: number
      chargingCondition?: string | null
    } & ConstructorParameters<typeof AttackOmniInfo>[0] = {},
  ) {
    super(params)
    this.chargeLevel = params.chargeLevel ?? 25
    this.chargeRate = params.chargeRate ?? 1
    this.dischargeRate = params.dischargeRate ?? 1
    this.chargingCondition = params.chargingCondition ?? null
  }
}

// ---------------------------------------------------------------------------
// AttackCharges
// OpenRA 对照: AttackCharges (AttackOmni, INotifyAttack, INotifySold)
// ---------------------------------------------------------------------------

/** Charge-limited attack: must charge up before firing.
 *
 *  OpenRA 对照: AttackCharges
 */
export class AttackCharges extends AttackOmni implements INotifyAttack {
  /** Current charge level.
   *
   *  OpenRA 对照: AttackCharges.ChargeLevel
   */
  chargeLevel: number = 0

  private charging: boolean = false
  private chargingToken: number = -1

  /** Override info type for access to Info.chargeLevel etc. */
  declare readonly info: AttackChargesInfo

  constructor(info: AttackChargesInfo) {
    super(info)
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /** Tick: charge up/down based on whether a target is being pursued.
   *
   *  OpenRA 对照: AttackCharges.Tick()
   */
  override tick(self: IGameActor): void {
    // Stop charging when we lose our target
    // Check if current activity is a SetTarget

    const delta = this.charging ? this.info.chargeRate : -this.info.dischargeRate
    this.chargeLevel = Math.max(
      0,
      Math.min(this.chargeLevel + delta, this.info.chargeLevel),
    )

    // Update charging condition
    if (this.chargeLevel > 0 && this.chargingToken === -1) {
      this.chargingToken =
        self.grantCondition?.(this.info.chargingCondition ?? '') ?? -1
    }

    if (this.chargeLevel === 0 && this.chargingToken !== -1) {
      self.revokeCondition?.(this.chargingToken)
      this.chargingToken = -1
    }

    super.tick(self)
  }

  // ---------------------------------------------------------------------------
  // CanAttack
  // ---------------------------------------------------------------------------

  /** Can only attack when fully charged and target is reachable.
   *
   *  OpenRA 对照: AttackCharges.CanAttack()
   */
  override canAttack(self: IGameActor, target: Target): boolean {
    this.charging =
      super.canAttack(self, target) && this.isReachableTarget(target, true)
    return this.chargeLevel >= this.info.chargeLevel && this.charging
  }

  // ---------------------------------------------------------------------------
  // INotifyAttack
  // ---------------------------------------------------------------------------

  /** Reset charge level on fire.
   *
   *  OpenRA 对照: INotifyAttack.Attacking()
   */
  attacking(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    this.chargeLevel = 0
  }

  /** No-op for preparing.
   *
   *  OpenRA 对照: INotifyAttack.PreparingAttack()
   */
  preparingAttack(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    // no-op
  }
}
