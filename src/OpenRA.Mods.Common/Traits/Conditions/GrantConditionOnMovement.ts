/**
 * GrantConditionOnMovement.ts -- Grant a condition when the actor is moving
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Conditions/GrantConditionOnMovement.cs (65 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<GrantConditionOnMovementInfo>, INotifyMoving
 *   → TS ConditionalTrait<GrantConditionOnMovementInfo> implements INotifyMoving
 * - C# INotifyMoving.MovementTypeChanged(self, types) passes raw MovementType bitmask
 *   → TS INotifyMoving.onNotifyMoving(self) — we query movement.movementTypes directly
 * - C# conditionToken tracking with GrantCondition/RevokeCondition → TS grantCondition?/revokeCondition?
 * - C# MovementType flags → TS hasMovementType() helper
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyMoving,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { MovementType } from '../World/Locomotor.js'

// ---------------------------------------------------------------------------
// GrantConditionOnMovementInfo
// OpenRA 对照: GrantConditionOnMovementInfo (ConditionalTraitInfo, Requires<IMoveInfo>)
// ---------------------------------------------------------------------------

/** Configuration for GrantConditionOnMovement trait.
 *
 *  OpenRA 对照: GrantConditionOnMovementInfo
 */
export class GrantConditionOnMovementInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Condition to grant when the actor moves with a matching movement type.
   *
   *  OpenRA 对照: GrantConditionOnMovementInfo.Condition
   */
  readonly condition: string

  /** Movement types that trigger the condition.
   *
   *  OpenRA 对照: GrantConditionOnMovementInfo.ValidMovementTypes
   *
   *  Default: Horizontal. Available: None, Horizontal, Vertical, Turn.
   */
  readonly validMovementTypes: MovementType = MovementType.Horizontal

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    condition: string
    validMovementTypes?: MovementType
  }) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.condition = params.condition
    this.validMovementTypes = params.validMovementTypes ?? MovementType.Horizontal
  }
}

// ---------------------------------------------------------------------------
// GrantConditionOnMovement
// OpenRA 对照: GrantConditionOnMovement (ConditionalTrait<...>, INotifyMoving)
// ---------------------------------------------------------------------------

/**
 * Grants a condition when the actor is moving with a matching movement type.
 *
 * OpenRA 对照: GrantConditionOnMovement
 *
 * The condition is granted when movement starts (matching types) and revoked
 * when movement stops or switches to non-matching types.
 */
export class GrantConditionOnMovement
  extends ConditionalTrait<GrantConditionOnMovementInfo>
  implements INotifyMoving
{
  /** Reference to the IMove trait for movement type queries.
   *
   *  OpenRA 对照: readonly IMove movement
   */
  private readonly _movement: {
    movementTypes: MovementType
  }

  /** Condition token for revocation, or -1 if no condition granted.
   *
   *  OpenRA 对照: int conditionToken = Actor.InvalidConditionToken
   */
  private _conditionToken: number = -1

  /**
   * @param info    — trait configuration
   * @param movement — the actor's IMove trait (duck-typed, exposes movementTypes)
   */
  constructor(
    info: GrantConditionOnMovementInfo,
    movement: { movementTypes: MovementType },
  ) {
    super(info)
    this._movement = movement
  }

  // ---------------------------------------------------------------------------
  // INotifyMoving
  // OpenRA 对照: INotifyMoving.MovementTypeChanged()
  // ---------------------------------------------------------------------------

  /**
   * Called each tick while the actor is moving.
   *
   * OpenRA 对照: INotifyMoving.MovementTypeChanged(Actor self, MovementType types)
   */
  onNotifyMoving(self: IGameActor): void {
    const types = this._movement.movementTypes
    this.updateCondition(self, types)
  }

  // ---------------------------------------------------------------------------
  // Condition management
  // OpenRA 对照: UpdateCondition(Actor self, MovementType types)
  // ---------------------------------------------------------------------------

  /**
   * Grant or revoke the condition based on current movement types.
   *
   * OpenRA 对照: UpdateCondition(Actor self, MovementType types)
   */
  private updateCondition(self: IGameActor, types: MovementType): void {
    const validMovement = !this.isTraitDisabled &&
      (types & this.info.validMovementTypes) !== 0

    if (!validMovement && this._conditionToken !== -1) {
      if (self.revokeCondition) {
        self.revokeCondition(this._conditionToken)
      }
      this._conditionToken = -1
    } else if (validMovement && this._conditionToken === -1) {
      if (self.grantCondition) {
        this._conditionToken = self.grantCondition(this.info.condition)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ConditionalTrait overrides
  // OpenRA 对照: TraitEnabled / TraitDisabled
  // ---------------------------------------------------------------------------

  protected override traitEnabled(actor: IGameActor): void {
    super.traitEnabled(actor)
    this.updateCondition(actor, this._movement.movementTypes)
  }

  protected override traitDisabled(actor: IGameActor): void {
    super.traitDisabled(actor)
    this.updateCondition(actor, this._movement.movementTypes)
  }
}
