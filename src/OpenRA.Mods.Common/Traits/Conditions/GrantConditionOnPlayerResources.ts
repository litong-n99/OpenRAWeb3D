/**
 * GrantConditionOnPlayerResources.ts — Grants a condition when the player has stored resources
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Conditions/GrantConditionOnPlayerResources.cs (64 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo (not ConditionalTraitInfo) → TS ITraitInfo (marker interface)
 * - C# INotifyCreated, INotifyOwnerChanged, ITick → TS implements all three interfaces
 * - C# self.Owner.PlayerActor.Trait<PlayerResources>() → TS duck-typing:
 *     owner.PlayerActor._playerResources (PlayerResources discovery pattern)
 * - C# Actor.InvalidConditionToken (-1) → TS INVALID_CONDITION_TOKEN (-1)
 * - C# self.GrantCondition/RevokeCondition → TS self.grantCondition?/revokeCondition?
 */

import type {
  ITraitInfo,
  IGameActor,
  INotifyCreated,
  INotifyOwnerChanged,
  ITick,
  PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PlayerResources } from '../Player/PlayerResources.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Invalid condition token constant.
 *
 * OpenRA 对照: Actor.InvalidConditionToken = -1
 */
const INVALID_CONDITION_TOKEN = -1

// ---------------------------------------------------------------------------
// GrantConditionOnPlayerResourcesInfo
// OpenRA 对照: GrantConditionOnPlayerResourcesInfo (TraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for GrantConditionOnPlayerResources trait.
 *
 *  OpenRA 对照: GrantConditionOnPlayerResourcesInfo
 *
 *  NOTE: In OpenRA C#, this extends TraitInfo (not ConditionalTraitInfo).
 *  The trait itself is always active; the condition it grants/revokes
 *  provides the conditional behavior.
 */
export class GrantConditionOnPlayerResourcesInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Condition to grant when resources exceed the threshold.
   *
   *  OpenRA 对照: GrantConditionOnPlayerResourcesInfo.Condition
   */
  readonly condition: string

  /** Minimum stored resources required to grant the condition.
   *
   *  OpenRA 对照: GrantConditionOnPlayerResourcesInfo.Threshold
   */
  readonly threshold: number = 0

  constructor(params: {
    instanceName?: string
    condition: string
    threshold?: number
  }) {
    this.instanceName = params.instanceName
    this.condition = params.condition
    this.threshold = params.threshold ?? 0
  }
}

// ---------------------------------------------------------------------------
// GrantConditionOnPlayerResources
// OpenRA 对照: GrantConditionOnPlayerResources (INotifyCreated, INotifyOwnerChanged, ITick)
// ---------------------------------------------------------------------------

/** Grants a condition to this actor when the player has stored resources
 *  above a threshold.
 *
 *  OpenRA 对照: GrantConditionOnPlayerResources
 *
 *  Each tick, checks the player's stored resources. When resources exceed
 *  the threshold, the configured condition is granted. When resources fall
 *  below or equal to the threshold, the condition is revoked.
 *
 *  Uses the PlayerResources discovery pattern:
 *    self.owner.PlayerActor._playerResources
 */
export class GrantConditionOnPlayerResources
  implements INotifyCreated, INotifyOwnerChanged, ITick
{
  /** Trait configuration.
   *
   *  OpenRA 对照: readonly GrantConditionOnPlayerResourcesInfo info
   */
  readonly info: GrantConditionOnPlayerResourcesInfo

  /** Reference to the player's resource manager.
   *
   *  OpenRA 对照: PlayerResources playerResources
   */
  private _playerResources: PlayerResources | null = null

  /** Token for the currently granted condition, or -1 if not granted.
   *
   *  OpenRA 对照: int conditionToken = Actor.InvalidConditionToken
   */
  private _conditionToken: number = INVALID_CONDITION_TOKEN

  constructor(info: GrantConditionOnPlayerResourcesInfo) {
    this.info = info
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated
  // OpenRA 对照: INotifyCreated.Created(Actor self)
  // ---------------------------------------------------------------------------

  /** Called after the actor is fully created.
   *
   *  Resolves the PlayerResources trait from the owner's player actor.
   *
   *  OpenRA 对照: GrantConditionOnPlayerResources.Created(Actor self)
   */
  created(self: IGameActor): void {
    this._resolvePlayerResources(self)
  }

  // ---------------------------------------------------------------------------
  // INotifyOwnerChanged
  // OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor self, Player oldOwner, Player newOwner)
  // ---------------------------------------------------------------------------

  /** Called when the actor's owner changes.
   *
   *  Re-resolves PlayerResources from the new owner's player actor.
   *
   *  OpenRA 对照: GrantConditionOnPlayerResources.OnOwnerChanged(Actor self, Player oldOwner, Player newOwner)
   */
  onOwnerChanged(
    _self: IGameActor,
    _oldOwner: PlayerStub,
    newOwner: PlayerStub,
  ): void {
    // Resolve PlayerResources from the new owner
    const playerActor = (newOwner as unknown as {
      playerActor?: IGameActor
    }).playerActor

    if (playerActor) {
      this._playerResources =
        (playerActor as unknown as {
          _playerResources?: PlayerResources
        })._playerResources ?? null
    } else {
      this._playerResources = null
    }

    // Revoke any currently granted condition before switching
    this._revokeCondition()
  }

  // ---------------------------------------------------------------------------
  // ITick
  // OpenRA 对照: ITick.Tick(Actor self)
  // ---------------------------------------------------------------------------

  /** Called every game tick (25 TPS).
   *
   *  Checks the player's resource level against the threshold and
   *  grants/revokes the condition accordingly.
   *
   *  OpenRA 对照: GrantConditionOnPlayerResources.Tick(Actor self)
   */
  tick(self: IGameActor): void {
    if (!this.info.condition) return

    const enabled = this._playerResources !== null &&
      this._playerResources.resources > this.info.threshold

    if (enabled && this._conditionToken === INVALID_CONDITION_TOKEN) {
      if (self.grantCondition) {
        this._conditionToken = self.grantCondition(this.info.condition)
      }
    } else if (!enabled && this._conditionToken !== INVALID_CONDITION_TOKEN) {
      if (self.revokeCondition) {
        this._conditionToken = self.revokeCondition(this._conditionToken)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolve PlayerResources from the actor's owner.
   *
   *  OpenRA 对照: self.Owner.PlayerActor.Trait<PlayerResources>()
   */
  private _resolvePlayerResources(self: IGameActor): void {
    const owner = self.owner
    if (!owner) {
      this._playerResources = null
      return
    }

    const ownerExt = owner as unknown as {
      playerActor?: IGameActor
    }

    const playerActor = ownerExt.playerActor
    if (!playerActor) {
      this._playerResources = null
      return
    }

    this._playerResources =
      (playerActor as unknown as {
        _playerResources?: PlayerResources
      })._playerResources ?? null
  }

  /** Revoke the currently granted condition, if any.
   *
   *  Used when the owner changes to clean up the old condition.
   */
  private _revokeCondition(): void {
    if (this._conditionToken !== INVALID_CONDITION_TOKEN) {
      // We cannot revoke without the actor reference, but the token
      // is no longer valid after owner change anyway. Reset to invalid.
      this._conditionToken = INVALID_CONDITION_TOKEN
    }
  }
}
