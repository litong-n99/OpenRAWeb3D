/**
 * ProductionParadrop.ts — 伞兵空投生产：通过飞机空投单位
 * OpenRA 对照: OpenRA.Mods.Common/Traits/ProductionParadrop.cs (166 lines)
 *
 * 核心范式转换:
 * - C# Production extends → TS Production extends
 * - C# Lazy<RallyPoint> → TS 直接引用
 * - C# Aircraft trait integration → TS 桩 (TODO-9.X)
 * - C# Parachutable trait → TS 桩 (TODO-14.X)
 * - C# Game.Sound.Play → TS 桩 (TODO-8.F)
 *
 * ProductionParadrop 通过飞机空投生产单位。飞机从地图边缘飞入，
 * 在目标点空投单位（带降落伞），然后飞出地图。
 */

import { Production, ProductionInfo } from './Production.js'
import type { IGameActor, ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ProductionParadropInfo
// OpenRA 对照: ProductionParadropInfo (extends ProductionInfo)
// ---------------------------------------------------------------------------

/** Configuration for the ProductionParadrop trait.
 *
 * OpenRA 对照: ProductionParadropInfo
 */
export class ProductionParadropInfo extends ProductionInfo {
  /** Cargo aircraft used for delivery (must have Aircraft trait).
   *
   * OpenRA 对照: ProductionParadropInfo.ActorType
   */
  readonly actorType: string = 'badr'

  /** Sound to play when dropping the unit.
   *
   * OpenRA 对照: ProductionParadropInfo.ChuteSound
   */
  readonly chuteSound: string | null = null

  /** Speech notification to play when dropping the unit.
   *
   * OpenRA 对照: ProductionParadropInfo.ReadyAudio
   */
  readonly readyAudio: string | null = null

  /** Text notification to display when dropping the unit.
   *
   * OpenRA 对照: ProductionParadropInfo.ReadyTextNotification
   */
  readonly readyTextNotification: string | null = null

  constructor(params: {
    instanceName?: string
    produces?: ReadonlySet<string> | readonly string[]
    updateFactionOnOwnerChange?: boolean
    actorType?: string
    chuteSound?: string | null
    readyAudio?: string | null
    readyTextNotification?: string | null
  } = {}) {
    super(params)
    if (params.actorType !== undefined) this.actorType = params.actorType
    if (params.chuteSound !== undefined) this.chuteSound = params.chuteSound
    if (params.readyAudio !== undefined) this.readyAudio = params.readyAudio
    if (params.readyTextNotification !== undefined) this.readyTextNotification = params.readyTextNotification
  }
}

// ---------------------------------------------------------------------------
// ProductionParadrop
// OpenRA 对照: ProductionParadrop class (sealed)
// ---------------------------------------------------------------------------

/** Produces units via paradrop delivery.
 *
 * OpenRA 对照: ProductionParadrop
 *
 * Spawns a cargo aircraft that flies to the drop point, drops the unit
 * with a parachute, and flies off the map.
 */
export class ProductionParadrop extends Production {
  /** The typed info reference. */
  declare readonly info: ProductionParadropInfo

  constructor(info: ProductionParadropInfo) {
    super(info)
  }

  /** Produce a unit via paradrop.
   *
   * OpenRA 对照: ProductionParadrop.Produce(Actor, ActorInfo, string, TypeDictionary, int)
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
    // 1. Spawn aircraft at map edge
    // 2. Fly to drop point (self.Location + exit.ExitCell)
    // 3. Drop unit with parachute
    // 4. Fly off map and remove
    // 5. Play sounds and notifications
    //
    // Full paradrop implementation when Aircraft and Parachutable are migrated.

    return true
  }

  /** Spawn the unit at the drop point with parachute.
   *
   * OpenRA 对照: ProductionParadrop.DoProduction(Actor, ActorInfo, ExitInfo, string, TypeDictionary)
   *
   * @param self — the producing actor
   * @param producee — the actor type to produce
   * @param exitinfo — the exit configuration
   * @param productionType — the production queue type
   * @param inits — initialization parameters
   */
  override doProduction(
    _self: IGameActor,
    _producee: ActorInfoStub,
    _exitinfo: unknown,
    _productionType: string,
    _inits: Map<string, unknown>,
  ): void {
    // In full implementation:
    // Spawn unit at aircraft altitude with parachute
    // Set Parachutable.IgnoreActor = self
    // Queue move activities to rally point
    //
    // Full DoProduction when Parachutable trait is migrated.
  }
}
