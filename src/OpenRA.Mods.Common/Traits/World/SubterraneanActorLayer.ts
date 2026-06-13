/**
 * SubterraneanActorLayer.ts — 地下 Actor 移动层管理
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/SubterraneanActorLayer.cs
 *
 * 核心范式转换:
 * - C# ICustomMovementLayer → TypeScript ICustomMovementLayer interface
 * - C# CellLayer<int> → CellLayer<number>
 * - C# WDist.HeightOffset → number (raw length)
 * - C# explicit interface implementation → TypeScript class methods
 * - C# for-each CellLayer 初始化 → TypeScript for-each cell
 *
 * SubterraneanActorLayer 实现 ICustomMovementLayer，管理地下层的
 * 位置计算、过渡成本验证和地形索引查找。
 * 在构造时计算平滑的地下高度图（基于邻居平均高度）。
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WVec } from '../../../OpenRA.Game/WVec'
import { WDist } from '../../../OpenRA.Game/WDist'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer'
import { type MapGridType as MapGridTypeEnum } from '../../../OpenRA.Game/Map/MapGridType'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import { CustomMovementLayerType } from './Locomotor'
import type { ICustomMovementLayer } from '../ICustomMovementLayer'
import { SubterraneanLocomotorInfo } from './SubterraneanLocomotor'
import type { LocomotorInfo } from './Locomotor'

// ---------------------------------------------------------------------------
// ISubterraneanMap — map contract for SubterraneanActorLayer
// ---------------------------------------------------------------------------

/**
 * Map contract needed by SubterraneanActorLayer.
 *
 * OpenRA 对照: Map (subset used by SubterraneanActorLayer)
 */
export interface ISubterraneanMap {
  /** Check if a cell is within map bounds. */
  contains(cell: CPos): boolean

  /** Raw terrain height layer (byte values, 0-255). */
  readonly height: CellLayer<number>

  /** Ramp values per cell (0 = flat). */
  readonly ramp: CellLayer<number>

  /** Get the terrain info at a cell (for Type string lookup). */
  getTerrainInfo(cell: CPos): { readonly Type: string }

  /** Iterate over all cells in the map. */
  allCells(): Iterable<CPos>

  /** Get the center WPos of a cell. */
  centerOfCell(cell: CPos): WPos

  /** Map dimensions. */
  readonly mapSize: { readonly width: number; readonly height: number }

  /** Map grid type (Rectangular or RectangularIsometric). */
  readonly gridType: MapGridTypeEnum

  /** Map rules for terrain index lookup. */
  readonly rules: {
    readonly terrainInfo: {
      getTerrainIndex(terrainType: string): number
    }
  }
}

// ---------------------------------------------------------------------------
// SubterraneanActorLayerInfo — 配置信息
// ---------------------------------------------------------------------------

/**
 * Configuration for SubterraneanActorLayer.
 *
 * OpenRA 对照: SubterraneanActorLayerInfo（TraitInfo + ICustomMovementLayerInfo）
 */
export class SubterraneanActorLayerInfo {
  /** Terrain type name of the underground layer.
   *
   * OpenRA 对照: TerrainType (string, default "Subterranean")
   */
  readonly TerrainType: string

  /** Height offset relative to the smoothed terrain for movement.
   *
   * OpenRA 对照: HeightOffset (WDist, default -new WDist(2048))
   */
  readonly HeightOffset: WDist

  /** Cell radius for smoothing adjacent cell heights.
   *
   * OpenRA 对照: SmoothingRadius (int, default 2)
   */
  readonly SmoothingRadius: number

  /**
   * Create a SubterraneanActorLayerInfo.
   *
   * OpenRA 对照: SubterraneanActorLayerInfo default constructor（YAML FieldLoader 填充）
   *
   * @param opts — configuration options
   */
  constructor(opts?: {
    terrainType?: string
    heightOffset?: WDist
    smoothingRadius?: number
  }) {
    this.TerrainType = opts?.terrainType ?? 'Subterranean'
    this.HeightOffset = opts?.heightOffset ?? new WDist(-2048)
    this.SmoothingRadius = opts?.smoothingRadius ?? 2
  }
}

// ---------------------------------------------------------------------------
// SubterraneanActorLayer — 地下 Actor 层
// ---------------------------------------------------------------------------

/**
 * Custom movement layer for subterranean (underground) actors.
 *
 * OpenRA 对照: SubterraneanActorLayer（ICustomMovementLayer 实现）
 *
 * 管理地下高度图，提供过渡成本验证和位置计算。
 * 在构造时计算每个 cell 的平滑地下高度（基于邻居平均高度）。
 *
 * NOTE: `InteractsWithDefaultLayer` (false) 和 `ReturnToGroundLayerOnIdle` (true)
 * 作为公共只读属性暴露，以便 Mobile 系统访问。
 */
export class SubterraneanActorLayer implements ICustomMovementLayer {
  /** The map this layer operates on. */
  private readonly map: ISubterraneanMap

  /** Terrain index for the subterranean layer. */
  private readonly terrainIndex: number

  /** Smoothed underground height for each cell. */
  private readonly height: CellLayer<number>

  /** Subterranean layer index — always CustomMovementLayerType.Subterranean (2).
   *
   * OpenRA 对照: ICustomMovementLayer.Index
   */
  get Index(): number {
    return CustomMovementLayerType.Subterranean
  }

  /** Subterranean layer does not interact with the default (ground) layer.
   *
   * OpenRA 对照: ICustomMovementLayer.InteractsWithDefaultLayer => false
   *
   * NOTE: When false, actors on this layer don't block or interact with ground-level actors.
   */
  readonly InteractsWithDefaultLayer: boolean = false

  /** Subterranean actors should return to ground layer when idle.
   *
   * OpenRA 对照: ICustomMovementLayer.ReturnToGroundLayerOnIdle => true
   *
   * NOTE: When true, actors will transition back to ground layer when not moving.
   */
  readonly ReturnToGroundLayerOnIdle: boolean = true

  /**
   * Create a new SubterraneanActorLayer.
   *
   * OpenRA 对照: SubterraneanActorLayer(Actor self, SubterraneanActorLayerInfo info)
   *
   * Builds a smoothed height map by averaging neighboring cell heights
   * within the smoothing radius, then applies the HeightOffset.
   *
   * Formula: height[c] = HeightOffset.length + avgNeighbourHeight * 512
   * where avgNeighbourHeight = sum(map.height[neighbour]) / neighbourCount
   * and 512 is the Z-scale factor (1 height unit = 512 WDist sub-units).
   *
   * @param map — the map contract
   * @param info — configuration
   */
  constructor(map: ISubterraneanMap, info: SubterraneanActorLayerInfo) {
    this.map = map
    this.terrainIndex = map.rules.terrainInfo.getTerrainIndex(info.TerrainType)
    this.height = new CellLayer<number>(map.gridType, map.mapSize)

    const smoothingRadius = info.SmoothingRadius
    const heightOffsetLen = info.HeightOffset.length

    for (const c of map.allCells()) {
      let neighbourCount = 0
      let neighbourHeight = 0

      for (let dy = -smoothingRadius; dy <= smoothingRadius; dy++) {
        for (let dx = -smoothingRadius; dx <= smoothingRadius; dx++) {
          const neighbour = CPos.add(c, new CVec(dx, dy))
          if (!map.contains(neighbour)) continue

          neighbourCount++
          neighbourHeight += map.height.get(neighbour)
        }
      }

      // Compute smoothed underground height:
      // avg_height * 512 sub-units → average terrain height in WDist units
      // then add the height offset (negative = below ground)
      const avgHeight = neighbourCount > 0
        ? Math.trunc((neighbourHeight * 512) / neighbourCount)
        : 0
      this.height.set(c, heightOffsetLen + avgHeight)
    }
  }

  // -------------------------------------------------------------------------
  // ICustomMovementLayer implementation
  // -------------------------------------------------------------------------

  /**
   * Check if this layer is enabled for the given locomotor.
   *
   * OpenRA 对照: ICustomMovementLayer.EnabledForLocomotor(LocomotorInfo li)
   *
   * Only SubterraneanLocomotor can use this layer.
   *
   * @param locomotorInfo — the locomotor configuration
   * @returns true if locomotorInfo is SubterraneanLocomotorInfo
   */
  enabledForLocomotor(locomotorInfo: LocomotorInfo): boolean {
    return locomotorInfo instanceof SubterraneanLocomotorInfo
  }

  /**
   * Get the movement cost to enter the subterranean layer at a cell.
   *
   * OpenRA 对照: ICustomMovementLayer.EntryMovementCost(LocomotorInfo li, CPos cell)
   *
   * @param locomotorInfo — the locomotor configuration
   * @param cell — the cell position
   * @returns transition cost, or MovementCostForUnreachableCell if invalid transition
   */
  entryMovementCost(locomotorInfo: LocomotorInfo, cell: CPos): number {
    if (!(locomotorInfo instanceof SubterraneanLocomotorInfo)) {
      return PathGraph.MovementCostForUnreachableCell
    }
    return this.validTransitionCell(cell, locomotorInfo)
      ? locomotorInfo.SubterraneanTransitionCost
      : PathGraph.MovementCostForUnreachableCell
  }

  /**
   * Get the movement cost to exit the subterranean layer at a cell.
   *
   * OpenRA 对照: ICustomMovementLayer.ExitMovementCost(LocomotorInfo li, CPos cell)
   *
   * @param locomotorInfo — the locomotor configuration
   * @param cell — the cell position
   * @returns transition cost, or MovementCostForUnreachableCell if invalid transition
   */
  exitMovementCost(locomotorInfo: LocomotorInfo, cell: CPos): number {
    if (!(locomotorInfo instanceof SubterraneanLocomotorInfo)) {
      return PathGraph.MovementCostForUnreachableCell
    }
    return this.validTransitionCell(cell, locomotorInfo)
      ? locomotorInfo.SubterraneanTransitionCost
      : PathGraph.MovementCostForUnreachableCell
  }

  /**
   * Get the center WPos of a cell in the subterranean layer.
   *
   * OpenRA 对照: ICustomMovementLayer.CenterOfCell(CPos cell)
   *
   * Returns the map center position adjusted by the underground height offset.
   *
   * @param cell — the cell position
   * @returns adjusted WPos with underground Z height
   */
  centerOfCell(cell: CPos): WPos {
    const pos = this.map.centerOfCell(cell)
    const zDelta = this.height.get(cell) - pos.Z
    return WPos.add(pos, new WVec(0, 0, zDelta))
  }

  /**
   * Get the terrain index for the subterranean layer at a cell.
   *
   * OpenRA 对照: ICustomMovementLayer.GetTerrainIndex(CPos cell)
   *
   * Always returns the subterranean terrain index (uniform underground terrain).
   *
   * @param _cell — the cell position (unused — uniform index)
   * @returns the subterranean terrain index
   */
  getTerrainIndex(_cell: CPos): number {
    return this.terrainIndex
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Validate whether a cell allows subterranean transition.
   *
   * OpenRA 对照: SubterraneanActorLayer.ValidTransitionCell(CPos cell, SubterraneanLocomotorInfo sli)
   *
   * Checks:
   * 1. If terrain type restrictions exist, cell terrain type must be in the allowed set
   * 2. If transition on ramps is not allowed, cell must be flat (ramp === 0)
   *
   * @param cell — the cell to check
   * @param sli — the subterranean locomotor info with transition rules
   * @returns true if the cell is a valid transition point
   */
  private validTransitionCell(cell: CPos, sli: SubterraneanLocomotorInfo): boolean {
    const terrainType = this.map.getTerrainInfo(cell).Type

    // If terrain type restrictions are specified, validate against allowed set
    if (
      sli.SubterraneanTransitionTerrainTypes.size > 0 &&
      !sli.SubterraneanTransitionTerrainTypes.has(terrainType)
    ) {
      return false
    }

    // If transition on ramps is allowed, any ramp is fine
    if (sli.SubterraneanTransitionOnRamps) return true

    // Otherwise, must be flat ground (ramp === 0)
    return this.map.ramp.get(cell) === 0
  }
}
