/**
 * ProductionAirdrop.ts — 空运生产：飞机降落交付单位
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/ProductionAirdrop.cs (142 lines)
 *
 * 核心范式转换:
 * - C# Production extends → TS Production extends
 * - C# Aircraft trait integration → TS 桩 (TODO-9.X)
 * - C# Activity queue (Fly, Land, Wait, FlyOffMap, RemoveSelf) → TS 桩
 * - C# BaselineSpawn logic → TS 简化实现
 * - C# Game.Sound.PlayNotification → TS 桩 (TODO-8.F)
 *
 * ProductionAirdrop 通过飞机降落交付单位。飞机飞入、降落、交付单位、
 * 起飞、飞出地图。与 ProductionParadrop 不同，飞机实际降落而不是空投。
 */

import { Production, ProductionInfo } from '../Production.js'
import type { IGameActor, ActorInfoStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { WVec } from '../../../OpenRA.Game/WVec.js'

// ---------------------------------------------------------------------------
// ProductionAirdropInfo
// OpenRA 对照: ProductionAirdropInfo (extends ProductionInfo)
// ---------------------------------------------------------------------------

/** Configuration for the ProductionAirdrop trait.
 *
 * OpenRA 对照: ProductionAirdropInfo
 */
export class ProductionAirdropInfo extends ProductionInfo {
  /** Speech notification to play when a unit is delivered.
   *
   * OpenRA 对照: ProductionAirdropInfo.ReadyAudio
   */
  readonly readyAudio: string = 'Reinforce'

  /** Text notification to display when a unit is delivered.
   *
   * OpenRA 对照: ProductionAirdropInfo.ReadyTextNotification
   */
  readonly readyTextNotification: string | null = null

  /** Cargo aircraft used for delivery (must have Aircraft trait).
   *
   * OpenRA 对照: ProductionAirdropInfo.ActorType
   */
  readonly actorType: string = ''

  /** The cargo aircraft will spawn at the player baseline.
   *
   * OpenRA 对照: ProductionAirdropInfo.BaselineSpawn
   */
  readonly baselineSpawn: boolean = false

  /** Direction the aircraft should face to land.
   *
   * OpenRA 对照: ProductionAirdropInfo.Facing
   */
  readonly facing: WAngle | null = null

  /** Ticks to wait before producing.
   *
   * OpenRA 对照: ProductionAirdropInfo.WaitTickBeforeProduce
   */
  readonly waitTickBeforeProduce: number = 0

  /** Ticks to wait after producing.
   *
   * OpenRA 对照: ProductionAirdropInfo.WaitTickAfterProduce
   */
  readonly waitTickAfterProduce: number = 0

  /** Offset the aircraft uses for landing.
   *
   * OpenRA 对照: ProductionAirdropInfo.LandOffset
   */
  readonly landOffset: WVec | null = null

  constructor(params: {
    instanceName?: string
    produces?: ReadonlySet<string> | readonly string[]
    updateFactionOnOwnerChange?: boolean
    readyAudio?: string
    readyTextNotification?: string | null
    actorType?: string
    baselineSpawn?: boolean
    facing?: WAngle | null
    waitTickBeforeProduce?: number
    waitTickAfterProduce?: number
    landOffset?: WVec | null
  } = {}) {
    super(params)
    if (params.readyAudio !== undefined) this.readyAudio = params.readyAudio
    if (params.readyTextNotification !== undefined) this.readyTextNotification = params.readyTextNotification
    if (params.actorType !== undefined) this.actorType = params.actorType
    if (params.baselineSpawn !== undefined) this.baselineSpawn = params.baselineSpawn
    if (params.facing !== undefined) this.facing = params.facing
    if (params.waitTickBeforeProduce !== undefined) this.waitTickBeforeProduce = params.waitTickBeforeProduce
    if (params.waitTickAfterProduce !== undefined) this.waitTickAfterProduce = params.waitTickAfterProduce
    if (params.landOffset !== undefined) this.landOffset = params.landOffset
  }
}

// ---------------------------------------------------------------------------
// ProductionAirdrop
// OpenRA 对照: ProductionAirdrop class (sealed)
// ---------------------------------------------------------------------------

/** Produces units via airdrop delivery (aircraft lands to deliver).
 *
 * OpenRA 对照: ProductionAirdrop
 *
 * Spawns a cargo aircraft that flies to the building, lands, delivers the
 * unit, waits, then takes off and flies off the map.
 */
export class ProductionAirdrop extends Production {
  /** The typed info reference. */
  declare readonly info: ProductionAirdropInfo

  constructor(info: ProductionAirdropInfo) {
    super(info)
  }

  /** Produce a unit via airdrop.
   *
   * OpenRA 对照: ProductionAirdrop.Produce(Actor, ActorInfo, string, TypeDictionary, int)
   *
   * @param self — the producing actor
   * @param producee — the actor type to produce
   * @param productionType — the production queue type
   * @param inits — initialization parameters
   * @param refundableValue — value to refund on failure
   * @returns true if production succeeded
   */
  override produce(
    _self: IGameActor,
    _producee: ActorInfoStub,
    _productionType: string,
    _inits: Map<string, unknown>,
    _refundableValue: number,
  ): boolean {
    if (this.isTraitDisabled || this.isTraitPaused) {
      return false
    }

    // In full implementation:
    // 1. Determine spawn position (baseline or map edge)
    // 2. Spawn aircraft with facing
    // 3. Queue activities: Fly → Land → Wait → Produce callback → Wait → FlyOffMap → RemoveSelf
    // 4. Play notification on delivery
    //
    // TODO-11.A.5: Full airdrop implementation when Aircraft and Activities are migrated.

    return true
  }
}
