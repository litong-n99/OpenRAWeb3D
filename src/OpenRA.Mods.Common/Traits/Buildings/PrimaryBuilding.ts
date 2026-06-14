/**
 * PrimaryBuilding.ts — 主生产建筑标记：指定某建筑为某队列的主生产建筑
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/PrimaryBuilding.cs (134 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<PrimaryBuildingInfo> → TS 类 + isTraitDisabled 标志
 * - C# Actor.InvalidConditionToken (-1) → TS -1 sentinel
 * - C# IIssueOrder / IResolveOrder → TS 接口方法
 * - C# PrimaryExts.IsPrimaryBuilding() → TS static isPrimaryBuilding()
 * - C# LINQ (Where, Any) → TS 显式循环
 *
 * PrimaryBuilding 标记某建筑为特定生产队列的主建筑。当多个同类型生产
 * 建筑存在时，新生产的单位优先从主建筑出口。
 */

// @ts-expect-error: unused imports kept for API parity
import type {
  IGameActor,
  PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// PrimaryBuildingInfo
// OpenRA 对照: PrimaryBuildingInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for the PrimaryBuilding trait.
 *
 * OpenRA 对照: PrimaryBuildingInfo
 */
export class PrimaryBuildingInfo {
  readonly instanceName?: string

  /** The condition to grant to self while this is the primary building.
   *
   * OpenRA 对照: PrimaryBuildingInfo.PrimaryCondition
   */
  readonly primaryCondition: string | null = null

  /** Speech notification to play when selecting a primary building.
   *
   * OpenRA 对照: PrimaryBuildingInfo.SelectionNotification
   */
  readonly selectionNotification: string | null = null

  /** Text notification to display when selecting a primary building.
   *
   * OpenRA 对照: PrimaryBuildingInfo.SelectionTextNotification
   */
  readonly selectionTextNotification: string | null = null

  /** List of production queues for which the primary flag should be set.
   * If empty, uses the Produces property of the Production trait.
   *
   * OpenRA 对照: PrimaryBuildingInfo.ProductionQueues (ImmutableArray<string>)
   */
  readonly productionQueues: readonly string[] = []

  /** Cursor to display when setting the primary building.
   *
   * OpenRA 对照: PrimaryBuildingInfo.Cursor
   */
  readonly cursor: string = 'deploy'

  constructor(params: {
    instanceName?: string
    primaryCondition?: string | null
    selectionNotification?: string | null
    selectionTextNotification?: string | null
    productionQueues?: readonly string[]
    cursor?: string
  } = {}) {
    this.instanceName = params.instanceName
    if (params.primaryCondition !== undefined) this.primaryCondition = params.primaryCondition
    if (params.selectionNotification !== undefined) this.selectionNotification = params.selectionNotification
    if (params.selectionTextNotification !== undefined) this.selectionTextNotification = params.selectionTextNotification
    if (params.productionQueues !== undefined) this.productionQueues = params.productionQueues
    if (params.cursor !== undefined) this.cursor = params.cursor
  }
}

// ---------------------------------------------------------------------------
// PrimaryBuilding
// OpenRA 对照: PrimaryBuilding class
// ---------------------------------------------------------------------------

/** Marks a building as the primary producer for certain queue types.
 *
 * OpenRA 对照: PrimaryBuilding
 *
 * When a building is set as primary, other primary buildings for the same
 * queue types are automatically unset.
 */
export class PrimaryBuilding {
  /** The configuration info for this trait. */
  readonly info: PrimaryBuildingInfo

  /** Whether this trait is currently disabled. */
  isTraitDisabled: boolean = false

  /** Whether this building is currently the primary producer. */
  private _isPrimary: boolean = false

  /** Condition token for the primary condition (-1 = invalid). */
  private _primaryToken: number = -1

  constructor(info: PrimaryBuildingInfo) {
    this.info = info
  }

  /** Whether this building is currently the primary producer. */
  get isPrimary(): boolean {
    return this._isPrimary
  }

  /** Set or unset this building as the primary producer.
   *
   * OpenRA 对照: PrimaryBuilding.SetPrimaryProducer(Actor, bool)
   *
   * @param isPrimary — whether to set as primary
   */
  setPrimaryProducer(isPrimary: boolean): void {
    this._isPrimary = isPrimary

    if (isPrimary) {
      // In full implementation: revoke other primaries for same queue type
      // Grant condition if configured
      if (this.info.primaryCondition !== null) {
        // _primaryToken = self.grantCondition(this.info.primaryCondition)
      }
      // Play notification
      // TODO-8.F: Wire up to Sound.PlayNotification
    } else {
      // Revoke condition
      if (this._primaryToken !== -1) {
        // self.revokeCondition(this._primaryToken)
        this._primaryToken = -1
      }
    }
  }

  /** Called when the trait is disabled.
   *
   * OpenRA 对照: PrimaryBuilding.TraitDisabled(Actor)
   */
  traitDisabled(): void {
    if (this._isPrimary) {
      this.setPrimaryProducer(false)
    }
  }

  /** Called when the trait is enabled.
   *
   * OpenRA 对照: PrimaryBuilding.TraitEnabled(Actor)
   */
  traitEnabled(): void {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// PrimaryExts
// OpenRA 对照: PrimaryExts static class
// ---------------------------------------------------------------------------

/** Static extension methods for primary building queries.
 *
 * OpenRA 对照: PrimaryExts
 */
export class PrimaryExts {
  /** Check if an actor is a primary building.
   *
   * OpenRA 对照: PrimaryExts.IsPrimaryBuilding(Actor)
   *
   * In this stub, the PrimaryBuilding is passed directly.
   *
   * @param pb — the PrimaryBuilding trait to check
   * @returns true if the building is primary
   */
  static isPrimaryBuilding(pb: PrimaryBuilding | null): boolean {
    return pb !== null && pb.isPrimary && !pb.isTraitDisabled
  }
}
