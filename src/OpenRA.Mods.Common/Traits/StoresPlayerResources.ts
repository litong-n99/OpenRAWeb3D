/**
 * StoresPlayerResources.ts — Contributes storage capacity to a player's resource pool
 * OpenRA 对照: OpenRA.Mods.Common/Traits/StoresPlayerResources.cs (67 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo → TS ConditionalTraitInfo (for condition support, per migration plan)
 * - C# PlayerResources concrete type → TS IPlayerResourcesForStorage forward interface
 *   (PlayerResources is migrated in Phase B — TODO-10.B.3)
 * - C# INotifyOwnerChanged, INotifyCapture, INotifyKilled, INotifyAddedToWorld,
 *     INotifyRemovedFromWorld → TS equivalent interfaces
 * - C# self.Owner.PlayerActor.Trait<PlayerResources>() → TS duck-typed resolution
 * - C# Stored getter with (long) cast → TS Math.floor for integer division
 *
 * StoresPlayerResources adds capacity to the owning player's resource storage
 * limit. When the actor is killed or captured, the stored resources are
 * transferred or lost accordingly.
 */

import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  ConditionalTraitInfo,
  IGameActor,
  INotifyOwnerChanged,
  INotifyCapture,
  INotifyKilled,
  INotifyAddedToWorld,
  INotifyRemovedFromWorld,
  PlayerStub,
  AttackInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IPlayerResourcesForStorage — Forward interface for PlayerResources (Phase B)
// OpenRA 对照: PlayerResources trait (Phase B, TODO-10.B.3)
// ---------------------------------------------------------------------------

/**
 * Minimal forward interface for PlayerResources storage operations.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlayerResources.cs
 *
 * PlayerResources is the central player economy manager. Since it is migrated
 * in Phase B (TODO-10.B.3), StoresPlayerResources uses this minimal interface
 * with duck-typed resolution. The full PlayerResources class replaces this stub
 * when migrated.
 *
 * TODO-10.B.3: Replace with full PlayerResources class when migrated.
 */
interface IPlayerResourcesForStorage {
  readonly resourceCapacity: number
  readonly resources: number
  addStorageCapacity(amount: number): void
  removeStorageCapacity(amount: number): void
  takeResources(amount: number): boolean
  giveResources(amount: number): void
}

// ---------------------------------------------------------------------------
// StoresPlayerResourcesInfo
// OpenRA 对照: StoresPlayerResourcesInfo (TraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for the StoresPlayerResources trait.
 *
 * OpenRA 对照: StoresPlayerResourcesInfo
 *
 * NOTE: In OpenRA C#, this extends TraitInfo directly. The TS migration
 * extends ConditionalTraitInfo to support condition-based enable/disable
 * for better flexibility (e.g., disabling storage when the building is
 * unpowered or under construction).
 */
export class StoresPlayerResourcesInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Amount of storage capacity to contribute to the player.
   *
   * OpenRA 对照: StoresPlayerResourcesInfo.Capacity (default 0)
   */
  readonly capacity: number = 0

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    capacity?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.capacity = params.capacity ?? 0
  }
}

// ---------------------------------------------------------------------------
// StoresPlayerResources
// OpenRA 对照: StoresPlayerResources (INotifyOwnerChanged, INotifyCapture,
//   INotifyKilled, INotifyAddedToWorld, INotifyRemovedFromWorld)
// ---------------------------------------------------------------------------

/** Contributes storage capacity to a player's resource pool.
 *
 * OpenRA 对照: StoresPlayerResources
 *
 * When added to the world, this trait increases the player's resource storage
 * capacity by info.Capacity. When removed, it decreases it back.
 *
 * The Stored getter calculates how many resources are currently in this
 * storage based on the player's total resource fill ratio:
 *   floor(info.Capacity * player.resources / player.resourceCapacity)
 *
 * On capture, the proportional stored resources are transferred from the old
 * owner to the new owner. On death, they are lost.
 *
 * NOTE: In OpenRA C#, StoresPlayerResources extends plain class directly.
 * The TS migration extends ConditionalTrait<StoresPlayerResourcesInfo> to
 * support condition-based enable/disable for better flexibility.
 */
export class StoresPlayerResources
  extends ConditionalTrait<StoresPlayerResourcesInfo>
  implements INotifyOwnerChanged, INotifyCapture, INotifyKilled, INotifyAddedToWorld, INotifyRemovedFromWorld
{
  /** Reference to the owning player's PlayerResources trait.
   *
   * OpenRA 对照: PlayerResources player
   *
   * NOTE: Typed as unknown due to PlayerResources being migrated in
   * Phase B (TODO-10.B.3). Cast to IPlayerResourcesForStorage when used.
   */
  private _playerResources: unknown = null

  constructor(info: StoresPlayerResourcesInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // Calculated storage amount
  // OpenRA 对照: int Stored
  // -----------------------------------------------------------------------

  /** The amount of resources currently stored in this storage, calculated
   * proportionally from the player's total resources and capacity.
   *
   * OpenRA 对照: Stored getter
   *
   * Formula: resourceCapacity == 0 ? 0 : floor(capacity * resources / resourceCapacity)
   *
   * This reflects the proportional share of the player's total stored
   * resources that would be in this specific storage.
   */
  get stored(): number {
    const pr = this._playerResources as IPlayerResourcesForStorage | null
    if (!pr) return 0
    if (pr.resourceCapacity === 0) return 0
    return Math.floor((this.info.capacity * pr.resources) / pr.resourceCapacity)
  }

  // -----------------------------------------------------------------------
  // Component lifecycle overrides
  // -----------------------------------------------------------------------

  /** Called when this component is attached to an actor.
   *
   * OpenRA 对照: StoresPlayerResources constructor body
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    this._resolvePlayerResources(actor)
  }

  /** Called when this component is detached from its actor. */
  override detach(actor: IGameActor): void {
    this._playerResources = null
    super.detach(actor)
  }

  // -----------------------------------------------------------------------
  // INotifyAddedToWorld
  // OpenRA 对照: void INotifyAddedToWorld.AddedToWorld(Actor self)
  // -----------------------------------------------------------------------

  /** Called when the actor is added to the game world.
   * Adds this storage's capacity to the player's resource storage limit.
   *
   * OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor)
   */
  addedToWorld(_self: IGameActor): void {
    if (this.isTraitDisabled) return
    const pr = this._playerResources as IPlayerResourcesForStorage | null
    if (pr && typeof pr.addStorageCapacity === 'function') {
      pr.addStorageCapacity(this.info.capacity)
    }
  }

  // -----------------------------------------------------------------------
  // INotifyRemovedFromWorld
  // OpenRA 对照: void INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
  // -----------------------------------------------------------------------

  /** Called when the actor is removed from the game world.
   * Removes this storage's capacity from the player's resource storage limit.
   *
   * OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor)
   */
  removedFromWorld(_self: IGameActor): void {
    if (this.isTraitDisabled) return
    const pr = this._playerResources as IPlayerResourcesForStorage | null
    if (pr && typeof pr.removeStorageCapacity === 'function') {
      pr.removeStorageCapacity(this.info.capacity)
    }
  }

  // -----------------------------------------------------------------------
  // INotifyOwnerChanged
  // OpenRA 对照: void INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
  // -----------------------------------------------------------------------

  /** Called when the actor's owner changes.
   * Re-resolves the PlayerResources reference from the new owning player.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   */
  onOwnerChanged(
    self: IGameActor,
    _oldOwner: PlayerStub,
    _newOwner: PlayerStub,
  ): void {
    this._resolvePlayerResources(self)
  }

  // -----------------------------------------------------------------------
  // INotifyCapture
  // OpenRA 对照: void INotifyCapture.OnCapture(Actor, Actor, Player, Player, BitSet<CaptureType>)
  // -----------------------------------------------------------------------

  /** Called when the actor is captured.
   * Transfers the proportional stored resources from the old owner to the
   * new owner.
   *
   * OpenRA 对照: INotifyCapture.OnCapture(Actor, Actor, Player, Player, BitSet<CaptureType>)
   */
  onCapture(
    _self: IGameActor,
    _captor: IGameActor,
    oldOwner: unknown,
    newOwner: unknown,
    _captureTypes: number,
  ): void {
    const resources = this.stored

    // Take resources from old owner
    const oldPlayerActor = (oldOwner as {
      playerActor?: IGameActor & { _playerResources?: IPlayerResourcesForStorage }
    })?.playerActor
    if (oldPlayerActor?._playerResources?.takeResources) {
      oldPlayerActor._playerResources.takeResources(resources)
    }

    // Give resources to new owner
    const newPlayerActor = (newOwner as {
      playerActor?: IGameActor & { _playerResources?: IPlayerResourcesForStorage }
    })?.playerActor
    if (newPlayerActor?._playerResources?.giveResources) {
      newPlayerActor._playerResources.giveResources(resources)
    }
  }

  // -----------------------------------------------------------------------
  // INotifyKilled
  // OpenRA 对照: void INotifyKilled.Killed(Actor self, AttackInfo e)
  // -----------------------------------------------------------------------

  /** Called when the actor is killed.
   * The stored resources are lost (taken from the player).
   *
   * OpenRA 对照: INotifyKilled.Killed(Actor, AttackInfo)
   */
  killed(_self: IGameActor, _attackInfo: AttackInfo): void {
    const pr = this._playerResources as IPlayerResourcesForStorage | null
    if (pr && typeof pr.takeResources === 'function') {
      pr.takeResources(this.stored)
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Resolve the PlayerResources trait for the actor's owning player.
   *
   * OpenRA 对照:
   *   player = self.Owner.PlayerActor.Trait<PlayerResources>()
   *
   * Uses duck-typing to resolve PlayerResources from the owner's PlayerActor.
   * Falls back to a stub for testing when the full PlayerResources is not yet
   * available.
   *
   * TODO-10.B.3: Replace duck-typing with full PlayerResources class
   *               when migrated in Phase B.
   */
  private _resolvePlayerResources(self: IGameActor): void {
    const owner = self.owner
    if (!owner) {
      this._playerResources = null
      return
    }

    const playerActor = (owner as unknown as {
      playerActor?: IGameActor & { _playerResources?: unknown }
    })?.playerActor

    if (playerActor && playerActor._playerResources !== undefined) {
      this._playerResources = playerActor._playerResources
    } else {
      // Fallback: create a stub PlayerResources for testing
      this._playerResources = this._createStubPlayerResources()
    }
  }

  /** Create a stub PlayerResources for testing when the real trait is
   * not yet available.
   *
   * TODO-10.B.3: Remove this stub when PlayerResources is migrated.
   */
  private _createStubPlayerResources(): IPlayerResourcesForStorage {
    let resourceCapacity = 5000
    let resources = 0

    return {
      get resourceCapacity(): number {
        return resourceCapacity
      },
      get resources(): number {
        return resources
      },
      addStorageCapacity(amount: number): void {
        resourceCapacity += amount
      },
      removeStorageCapacity(amount: number): void {
        resourceCapacity = Math.max(0, resourceCapacity - amount)
      },
      takeResources(amount: number): boolean {
        if (resources >= amount) {
          resources -= amount
          return true
        }
        return false
      },
      giveResources(amount: number): void {
        resources += amount
      },
    }
  }
}
