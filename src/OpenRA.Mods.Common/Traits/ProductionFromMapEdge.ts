/**
 * ProductionFromMapEdge.ts — 地图边缘生产：在地图边缘生成单位
 * OpenRA 对照: OpenRA.Mods.Common/Traits/ProductionFromMapEdge.cs (117 lines)
 *
 * 核心范式转换:
 * - C# Production extends → TS Production extends
 * - C# CPos? spawnLocation → TS CPos | null
 * - C# IPathFinder → TS 桩 (TODO-4.G)
 * - C# AircraftInfo / MobileInfo trait checks → TS 桩
 * - C# ChooseClosestEdgeCell / ChooseClosestMatchingEdgeCell → TS 桩
 *
 * ProductionFromMapEdge 在地图边缘生成单位，然后移动到集结点。
 * 对于飞机，在巡航高度生成；对于地面单位，使用路径检查找到可通行的边缘。
 */

import { Production, ProductionInfo } from './Production.js'
import type { IGameActor, ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// ProductionFromMapEdgeInfo
// OpenRA 对照: ProductionFromMapEdgeInfo (extends ProductionInfo)
// ---------------------------------------------------------------------------

/** Configuration for the ProductionFromMapEdge trait.
 *
 * OpenRA 对照: ProductionFromMapEdgeInfo
 */
export class ProductionFromMapEdgeInfo extends ProductionInfo {
  constructor(params: {
    instanceName?: string
    produces?: ReadonlySet<string> | readonly string[]
    updateFactionOnOwnerChange?: boolean
  } = {}) {
    super(params)
  }
}

// ---------------------------------------------------------------------------
// ProductionFromMapEdge
// OpenRA 对照: ProductionFromMapEdge class (sealed)
// ---------------------------------------------------------------------------

/** Produces units at the closest map edge cell.
 *
 * OpenRA 对照: ProductionFromMapEdge
 *
 * Spawns units at the closest map edge and moves them to the rally point.
 * Aircraft spawn at cruise altitude. Ground units use pathfinding to find
 * a valid edge cell.
 */
export class ProductionFromMapEdge extends Production {
  /** Optional fixed spawn location.
   * @deprecated Currently stored but not directly read; full implementation deferred.
   */
  // @ts-expect-error: stored for future spawn location logic
  private _spawnLocation: CPos | null = null

  constructor(info: ProductionFromMapEdgeInfo) {
    super(info)
  }

  /** Set a fixed spawn location.
   *
   * @param location — the fixed spawn cell, or null for auto-selection
   */
  setSpawnLocation(location: CPos | null): void {
    this._spawnLocation = location
  }

  /** Produce a unit at the map edge.
   *
   * OpenRA 对照: ProductionFromMapEdge.Produce(Actor, ActorInfo, string, TypeDictionary, int)
   *
   * @param _self — the producing actor
   * @param _producee — the actor type to produce
   * @param _productionType — the production queue type
   * @param _inits — initialization parameters
   * @param _refundableValue — value to refund on failure
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
    // 1. Determine spawn location:
    //    - If _spawnLocation is set, use it
    //    - If aircraft, use ChooseClosestEdgeCell(self.Location)
    //    - If mobile, use ChooseClosestMatchingEdgeCell with pathfinding
    // 2. Spawn unit at spawn location (at cruise altitude for aircraft)
    // 3. Set initial facing toward destinations[0]
    // 4. Queue move activities to rally point
    //
    // TODO-11.A.6: Full implementation when Aircraft/Mobile and pathfinding are available.

    return true
  }
}

// ---------------------------------------------------------------------------
// ProductionSpawnLocationInit
// OpenRA 对照: ProductionSpawnLocationInit (ValueActorInit<CPos>)
// ---------------------------------------------------------------------------

/** Initialization value for fixed spawn location.
 *
 * OpenRA 对照: ProductionSpawnLocationInit
 */
export class ProductionSpawnLocationInit {
  readonly value: CPos

  constructor(value: CPos) {
    this.value = value
  }
}
