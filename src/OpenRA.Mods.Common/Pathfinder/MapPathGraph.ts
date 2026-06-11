/**
 * MapPathGraph.ts — Dense pathfinding graph backed by CellLayer pool
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/MapPathGraph.cs
 *
 * 核心范式转换:
 * - C# sealed class → TypeScript class
 * - C# CellInfoLayerPool.PooledCellInfoLayer → TypeScript PooledCellInfoLayer
 * - C# CellLayer<CellInfo>[] → TypeScript CellLayer<CellInfo>[]
 * - C# override this[CPos] → override getInfo()/setInfo()
 * - C# override Dispose(bool) → override dispose()
 */

import { CPos } from '../../OpenRA.Game/CPos'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { IGameWorld } from '../../OpenRA.Game/World'
import type { BlockedByActor } from '../Traits/BlockedByActor'
import type { ILocomotor } from '../Traits/World/Locomotor'
import { CellInfo } from './CellInfo'
import { CellInfoLayerPool, PooledCellInfoLayer } from './CellInfoLayerPool'
import { DensePathGraph } from './DensePathGraph'

// ---------------------------------------------------------------------------
// MapPathGraph
// ---------------------------------------------------------------------------

/**
 * A dense pathfinding graph that supports a search over all cells within a map.
 * Uses a pooled CellInfo layer to avoid allocating large arrays for every search.
 *
 * OpenRA 对照: MapPathGraph (sealed class)
 *
 * PERF: Uses CellInfoLayerPool to reuse CellLayer<CellInfo> instances across
 * searches, avoiding the high cost of initializing new search spaces.
 */
export class MapPathGraph extends DensePathGraph {
  /** Pooled layer wrapper — manages lifetime of borrowed layers. */
  private readonly pooledLayer: PooledCellInfoLayer

  /** CellInfo layers per movement layer (index 0 = ground). */
  private readonly cellInfoForLayer: (CellInfoLayer | null)[]

  /**
   * Create a new MapPathGraph.
   *
   * OpenRA 对照: MapPathGraph(CellInfoLayerPool, Locomotor, Actor, World, BlockedByActor, Func, Actor, bool, bool)
   *
   * @param layerPool — the cell info layer pool
   * @param locomotor — the locomotor defining movement rules
   * @param actor — the actor doing the moving (null for theoretical)
   * @param world — the game world
   * @param check — blocking check level
   * @param customCost — optional custom cost function
   * @param ignoreActor — actor to ignore during blocking
   * @param laneBias — whether to apply lane bias
   * @param inReverse — whether search is in reverse
   */
  constructor(
    layerPool: CellInfoLayerPool,
    locomotor: ILocomotor,
    actor: IGameActor | null,
    world: IGameWorld,
    check: BlockedByActor,
    customCost: ((pos: CPos) => number) | null,
    ignoreActor: IGameActor | null,
    laneBias: boolean,
    inReverse: boolean,
  ) {
    super(
      locomotor,
      actor,
      world,
      check,
      customCost,
      ignoreActor,
      laneBias,
      inReverse,
    )

    this.pooledLayer = layerPool.get()

    // Allocate layers for ground + enabled custom movement layers
    // STUB: CustomMovementLayers length is 0 in stub, so this creates [groundLayer]
    // TODO-5.X: When CustomMovementLayers is populated, allocate per-layer
    const layerCount = Math.max(1, this.CustomMovementLayers.length)
    this.cellInfoForLayer = new Array(layerCount).fill(null)
    this.cellInfoForLayer[0] = this.pooledLayer.getLayer()

    for (const cml of this.CustomMovementLayers) {
      if (cml !== null && cml.enabledForLocomotor(locomotor.Info)) {
        this.cellInfoForLayer[cml.Index] = this.pooledLayer.getLayer()
      }
    }
  }

  /**
   * Get the pathfinding information for a given node.
   *
   * OpenRA 对照: MapPathGraph.this[CPos] get
   *
   * @param pos — the cell position
   * @returns the CellInfo for this node
   */
  override getInfo(pos: CPos): CellInfo {
    const layer = this.cellInfoForLayer[pos.Layer]
    if (layer === null) {
      // Fallback: return unvisited if layer not allocated
      return CellInfo.unvisited()
    }
    return layer.get(pos)
  }

  /**
   * Set the pathfinding information for a given node.
   *
   * OpenRA 对照: MapPathGraph.this[CPos] set
   *
   * @param pos — the cell position
   * @param info — the new CellInfo
   */
  override setInfo(pos: CPos, info: CellInfo): void {
    const layer = this.cellInfoForLayer[pos.Layer]
    if (layer !== null) {
      layer.set(pos, info)
    }
  }

  /**
   * Check if a neighbor is within the map bounds.
   *
   * OpenRA 对照: MapPathGraph.IsValidNeighbor(CPos)
   *
   * @param neighbor — the candidate cell
   * @returns true if the cell is within the map
   */
  protected override isValidNeighbor(neighbor: CPos): boolean {
    const layer = this.cellInfoForLayer[neighbor.Layer]
    if (layer === null) {
      return false
    }
    const size = layer.Size
    return neighbor.X >= 0 && neighbor.Y >= 0 && neighbor.X < size.width && neighbor.Y < size.height
  }

  /**
   * Dispose of the pooled layers.
   *
   * OpenRA 对照: MapPathGraph.Dispose(bool)
   *
   * Returns all borrowed CellInfo layers to the pool.
   */
  override dispose(): void {
    this.pooledLayer.dispose()
  }
}

// ---------------------------------------------------------------------------
// CellInfoLayer type alias (local to avoid circular import)
// ---------------------------------------------------------------------------

import { CellLayer } from '../../OpenRA.Game/Map/CellLayer'

type CellInfoLayer = CellLayer<CellInfo>
