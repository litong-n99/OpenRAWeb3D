/**
 * GrantConditionOnJumpjetLayer.ts — 在跳跃喷气层上时授予条件
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Conditions/GrantConditionOnJumpjetLayer.cs (59 lines)
 *
 * 核心范式转换:
 * - C# GrantConditionOnLayer<GrantConditionOnJumpjetLayerInfo> → TypeScript extends base
 * - C# CustomMovementLayerType.Jumpjet → TypeScript numeric layer type constant
 * - C# INotifyFinishedMoving → TypeScript movement notification interface
 * - C# GrantCondition/RevokeCondition → TypeScript condition manager
 *
 * NOTE: Extends the GrantConditionOnLayer pattern from OpenRA.Mods.Common.
 * The base GrantConditionOnLayer is referenced from TraitsInterfaces.
 * Jumpjet layer type is defined as CustomMovementLayerType.Jumpjet = 1.
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// CustomMovementLayerType enum for Jumpjet
// ---------------------------------------------------------------------------

/** Custom movement layer types.
 *
 * OpenRA 对照: CustomMovementLayerType enum
 */
export const CustomMovementLayerType = {
  Jumpjet: 1,
} as const

export type CustomMovementLayerType = (typeof CustomMovementLayerType)[keyof typeof CustomMovementLayerType]

// ---------------------------------------------------------------------------
// GrantConditionOnJumpjetLayerInfo
// OpenRA 对照: GrantConditionOnJumpjetLayerInfo : GrantConditionOnLayerInfo
// ---------------------------------------------------------------------------

/** Configuration for granting a condition while on the jumpjet movement layer.
 *
 * OpenRA 对照: GrantConditionOnJumpjetLayerInfo
 */
export class GrantConditionOnJumpjetLayerInfo implements ITraitInfo {
  /** The condition to grant when on the jumpjet layer.
   *
   * OpenRA 对照: GrantConditionOnLayerInfo.Condition
   */
  readonly condition: string

  constructor(params?: { condition?: string }) {
    this.condition = params?.condition ?? ''
  }

  create(_init: IGameActor): GrantConditionOnJumpjetLayer {
    return new GrantConditionOnJumpjetLayer(this)
  }

  /** Validate that Mobile uses a JumpjetLocomotor.
   *
   * OpenRA 对照: GrantConditionOnJumpjetLayerInfo.RulesetLoaded()
   *
   * NOTE: In C#, this validates at ruleset load time that
   * Mobile.LocomotorInfo is JumpjetLocomotorInfo.
   * In TypeScript, this is enforced at integration time.
   */
  validate(mobileInfo: unknown, locomotorInfo: unknown): void {
    if (!mobileInfo || !locomotorInfo) {
      throw new Error(
        'GrantConditionOnJumpjetLayer requires Mobile to be linked to a JumpjetLocomotor!',
      )
    }
  }
}

// ---------------------------------------------------------------------------
// GrantConditionOnJumpjetLayer
// OpenRA 对照: GrantConditionOnJumpjetLayer : GrantConditionOnLayer<...>, INotifyFinishedMoving
// ---------------------------------------------------------------------------

/** Grants a condition when the actor enters the jumpjet movement layer.
 *
 * OpenRA 对照: GrantConditionOnJumpjetLayer
 *
 * Tracks whether the jumpjet is currently in the air. The condition is
 * granted when the actor transitions onto the Jumpjet layer and revoked
 * when it transitions off.
 */
export class GrantConditionOnJumpjetLayer {
  readonly info: GrantConditionOnJumpjetLayerInfo

  /** The valid layer type for this condition grant.
   *
   * OpenRA 对照: base(info, CustomMovementLayerType.Jumpjet)
   */
  readonly validLayerType: CustomMovementLayerType = CustomMovementLayerType.Jumpjet

  /** Whether the jumpjet is currently in the air (condition granted).
   *
   * OpenRA 对照: GrantConditionOnJumpjetLayer.jumpjetInAir
   */
  private _jumpjetInAir: boolean = false

  /** Active condition token. Actor.InvalidConditionToken = -1.
   *
   * OpenRA 对照: GrantConditionOnJumpjetLayer.conditionToken
   */
  private _conditionToken: number = -1

  constructor(info: GrantConditionOnJumpjetLayerInfo) {
    this.info = info
  }

  // -------------------------------------------------------------------------
  // INotifyFinishedMoving
  // -------------------------------------------------------------------------

  /** Called when the actor finishes moving between layers.
   *
   * OpenRA 对照: INotifyFinishedMoving.FinishedMoving(Actor, byte, byte)
   *
   * @param self — the moving actor
   * @param oldLayer — the previous movement layer
   * @param newLayer — the new movement layer
   */
  finishedMoving(self: IGameActor, oldLayer: number, newLayer: number): void {
    // If in air and neither old nor new layer is the jumpjet layer,
    // we need to update conditions (landing case)
    if (
      this._jumpjetInAir &&
      oldLayer !== this.validLayerType &&
      newLayer !== this.validLayerType
    ) {
      this._updateConditions(self, oldLayer, newLayer)
    }
  }

  // -------------------------------------------------------------------------
  // Internal: condition management
  // -------------------------------------------------------------------------

  /** Update conditions based on layer transition.
   *
   * OpenRA 对照: GrantConditionOnJumpjetLayer.UpdateConditions(Actor, byte, byte)
   *
   * @param self — the actor
   * @param oldLayer — the previous movement layer
   * @param newLayer — the new movement layer
   */
  private _updateConditions(self: IGameActor, oldLayer: number, newLayer: number): void {
    // Grant condition when entering jumpjet layer
    if (
      !this._jumpjetInAir &&
      newLayer === this.validLayerType &&
      oldLayer !== this.validLayerType &&
      this._conditionToken === -1
    ) {
      // C#: conditionToken = self.GrantCondition(Info.Condition)
      this._conditionToken = this._grantCondition(self, this.info.condition)
      this._jumpjetInAir = true
    }

    // Revoke condition when leaving jumpjet layer
    if (
      this._jumpjetInAir &&
      newLayer !== this.validLayerType &&
      oldLayer !== this.validLayerType &&
      this._conditionToken !== -1
    ) {
      // C#: conditionToken = self.RevokeCondition(conditionToken)
      this._revokeCondition(self, this._conditionToken)
      this._conditionToken = -1
      this._jumpjetInAir = false
    }
  }

  /** Grant a condition to the actor.
   *
   * OpenRA 对照: self.GrantCondition(condition)
   */
  private _grantCondition(self: IGameActor, condition: string): number {
    const grantFn = (self as any).grantCondition as
      | ((c: string) => number)
      | undefined
    if (grantFn) return grantFn(condition)
    return -1
  }

  /** Revoke a condition from the actor.
   *
   * OpenRA 对照: self.RevokeCondition(token)
   */
  private _revokeCondition(self: IGameActor, token: number): void {
    const revokeFn = (self as any).revokeCondition as
      | ((t: number) => void)
      | undefined
    if (revokeFn) revokeFn(token)
  }

  // -------------------------------------------------------------------------
  // Public queries
  // -------------------------------------------------------------------------

  /** Whether the jumpjet is currently in the air.
   *
   * OpenRA 对照: GrantConditionOnJumpjetLayer.jumpjetInAir
   */
  get jumpjetInAir(): boolean {
    return this._jumpjetInAir
  }

  /** The active condition token (-1 if none).
   *
   * OpenRA 对照: GrantConditionOnJumpjetLayer.conditionToken
   */
  get conditionToken(): number {
    return this._conditionToken
  }
}
