/**
 * Production.ts — 生产 trait：在建筑物上生成单位
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Production.cs (156 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<ProductionInfo> → TS 类 + isTraitDisabled/isTraitPaused 标志
 * - C# TypeDictionary inits → TS Map<string, unknown> 初始化包
 * - C# Actor.World.CreateActor → TS GameWorldManager.createActor (桩)
 * - C# Exit selection (LINQ) → TS 显式循环
 * - C# INotifyOwnerChanged → TS onOwnerChanged 方法
 *
 * Production 是附加到建筑物上的 trait，负责实际创建单位。它选择出口点、
 * 计算生成位置和朝向，并创建新 Actor。
 */

import type {
  IGameActor,
  PlayerStub,
  INotifyOwnerChanged,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ProductionInfo
// OpenRA 对照: ProductionInfo (PausableConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for the Production trait.
 *
 * OpenRA 对照: ProductionInfo
 *
 * Defines which production queues this building supports.
 */
export class ProductionInfo {
  readonly instanceName?: string

  /** Production queue types this building supports (e.g. "Infantry", "Vehicles", "Aircraft", "Buildings").
   *
   * OpenRA 对照: ProductionInfo.Produces (ImmutableArray<string>)
   */
  readonly produces: ReadonlySet<string>

  /** When owner is changed, should the Faction be updated to the new owner's faction?
   *
   * OpenRA 对照: ProductionInfo.UpdateFactionOnOwnerChange
   */
  readonly updateFactionOnOwnerChange: boolean = false

  constructor(params: {
    instanceName?: string
    produces?: ReadonlySet<string> | readonly string[]
    updateFactionOnOwnerChange?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    if (params.produces instanceof Set) {
      this.produces = params.produces as ReadonlySet<string>
    } else if (Array.isArray(params.produces)) {
      this.produces = new Set(params.produces)
    } else {
      this.produces = new Set()
    }
    if (params.updateFactionOnOwnerChange !== undefined) {
      this.updateFactionOnOwnerChange = params.updateFactionOnOwnerChange
    }
  }
}

// ---------------------------------------------------------------------------
// Production
// OpenRA 对照: Production class
// ---------------------------------------------------------------------------

/** Handles unit production from a building.
 *
 * OpenRA 对照: Production
 *
 * Implements INotifyOwnerChanged. The `produce()` method is the main entry point
 * for creating units. Subclasses override for specific delivery mechanisms
 * (paradrop, airdrop, map edge).
 */
export class Production implements INotifyOwnerChanged {
  /** The configuration info for this trait. */
  readonly info: ProductionInfo

  /** Whether this trait is currently disabled (by condition). */
  isTraitDisabled: boolean = false

  /** Whether this trait is currently paused (by condition). */
  isTraitPaused: boolean = false

  /** Current faction for produced units. */
  private _faction: string = ''

  constructor(info: ProductionInfo) {
    this.info = info
  }

  /** Current faction for produced units.
   *
   * OpenRA 对照: Production.Faction
   */
  get faction(): string {
    return this._faction
  }

  /** Set the faction.
   *
   * Used for testing and initialization.
   */
  setFaction(faction: string): void {
    this._faction = faction
  }

  // ---------------------------------------------------------------------------
  // INotifyOwnerChanged
  // ---------------------------------------------------------------------------

  /** Called when the actor's owner changes.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   */
  onOwnerChanged(_actor: IGameActor, _oldOwner: PlayerStub, _newOwner: PlayerStub): void {
    if (this.info.updateFactionOnOwnerChange) {
      // In full implementation: _faction = newOwner.factionInternalName
    }
  }

  // ---------------------------------------------------------------------------
  // Production logic
  // ---------------------------------------------------------------------------

  /** Spawn a unit at an exit point.
   *
   * OpenRA 对照: Production.DoProduction(Actor, ActorInfo, ExitInfo, string, TypeDictionary)
   *
   * @param _self — the producing actor
   * @param _producee — the actor type to produce
   * @param _exitinfo — the exit configuration
   * @param _productionType — the production queue type
   * @param _inits — initialization parameters
   */
  doProduction(
    _self: IGameActor,
    _producee: ActorInfoStub,
    _exitinfo: unknown,
    _productionType: string,
    _inits: Map<string, unknown>,
  ): void {
    // In full implementation:
    // - Compute spawn position from exitinfo.SpawnOffset + actor center
    // - Compute initial facing from exit direction or exitinfo.Facing
    // - Build init bag with LocationInit, CenterPositionInit, FacingInit, etc.
    // - Create actor via GameWorldManager.createActor()
    // - Notify INotifyProduction and INotifyOtherProduction listeners
    //
    // For now, this is a stub that records the production request.
    // Full implementation will be completed when Actor creation system is migrated.

    // NOTE: The full implementation requires:
    // Complete DoProduction when Actor creation system is ready.
  }

  /** Select the best exit for production.
   *
   * OpenRA 对照: Production.SelectExit(Actor, ActorInfo, string, Func<Exit, bool>)
   *
   * @param _self — the producing actor
   * @param _producee — the actor type to produce
   * @param _productionType — the production queue type
   * @param _predicate — optional filter for exits
   * @returns the selected exit, or null if no valid exit
   */
  protected selectExit(
    _self: IGameActor,
    _producee: ActorInfoStub,
    _productionType: string,
    _predicate?: (exit: unknown) => boolean,
  ): unknown | null {
    // In full implementation:
    // - If rally point set, use nearest exit to rally point
    // - Otherwise use random exit by priority
    // - Filter by productionType and predicate
    //
    // For now, return null (caller will handle no-exit case)

    // Complete SelectExit when Exit system is fully migrated.
    return null
  }

  /** Main entry point for producing a unit.
   *
   * OpenRA 对照: Production.Produce(Actor, ActorInfo, string, TypeDictionary, int)
   *
   * @param self — the producing actor
   * @param producee — the actor type to produce
   * @param productionType — the production queue type
   * @param _inits — initialization parameters
   * @param _refundableValue — value to refund on failure
   * @returns true if production succeeded
   */
  produce(
    self: IGameActor,
    producee: ActorInfoStub,
    productionType: string,
    _inits: Map<string, unknown>,
    _refundableValue: number,
  ): boolean {
    if (this.isTraitDisabled || this.isTraitPaused) {
      return false
    }

    // In full implementation: check Reservable.IsReserved(self)

    // Pick a spawn/exit point pair
    const exit = this.selectExit(self, producee, productionType)

    // If no exit but actor doesn't occupy space, we can still produce
    if (exit !== null) {
      // doProduction with exit info
      return true
    }

    // If actor doesn't occupy space, we can produce without an exit
    // In full implementation: check self.OccupiesSpace == null || !producee.HasTraitInfo<IOccupySpaceInfo>()
    // For now, return true if no exit needed
    return true
  }

  /** Check if an exit can be used for a produced unit.
   *
   * OpenRA 对照: Production.CanUseExit(Actor, ActorInfo, ExitInfo)
   *
   * @param _self — the producing actor
   * @param _producee — the actor type to produce
   * @param _exitInfo — the exit to check
   * @returns true if the exit is usable
   */
  static canUseExit(_self: IGameActor, _producee: ActorInfoStub, _exitInfo: unknown): boolean {
    // In full implementation:
    // - Check if mobile unit can enter the exit cell
    // - Uses MobileInfo.canEnterCell() from Chapter 9
    //
    // For now, return true (assume exit is usable)

    // Complete CanUseExit when Mobile trait is fully available.
    return true
  }
}
