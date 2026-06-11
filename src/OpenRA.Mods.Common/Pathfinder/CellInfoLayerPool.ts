/**
 * CellInfoLayerPool.ts — Object pool for CellInfo layers used in pathfinding
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/CellInfoLayerPool.cs
 *
 * 核心范式转换:
 * - C# Stack<T> + lock → TypeScript array (single-threaded, no lock needed)
 * - C# sealed class + IDisposable → TypeScript class with dispose()
 * - C# CellLayer<CellInfo> default(Unvisited) → CellLayer.clear() resets to undefined,
 *   then we fill with CellInfo.unvisited() on first use
 * - C# nested class PooledCellInfoLayer → TypeScript inner class pattern
 */

import { CellLayer } from '../../OpenRA.Game/Map/CellLayer'
import { CellInfo } from './CellInfo'
import type { MapGridType } from '../../OpenRA.Game/Map/MapGridType'
import type { Size } from '../../OpenRA.Game/Map/CellLayerBase'

// ---------------------------------------------------------------------------
// CellInfoLayerPool
// ---------------------------------------------------------------------------

/**
 * Object pool for CellInfo layers used in pathfinding searches.
 *
 * OpenRA 对照: CellInfoLayerPool (sealed class)
 *
 * PERF: Pathfinding searches are performed often, so we avoid the high cost
 * of initializing a new search space every time by reusing old ones.
 *
 * NOTE: TypeScript is single-threaded, so no lock is needed.
 * The C# version uses `lock(pool)` which is omitted here.
 */
export class CellInfoLayerPool {
  /** Maximum number of layers to keep in the pool. */
  static readonly MaxPoolSize = 4

  /** Internal pool of reusable CellLayer<CellInfo> instances. */
  private readonly pool: CellLayer<CellInfo>[] = []

  /** Grid type for creating new layers. */
  private readonly gridType: MapGridType

  /** Size for creating new layers. */
  private readonly size: Size

  /**
   * Create a new CellInfoLayerPool.
   *
   * OpenRA 对照: CellInfoLayerPool(Map)
   *
   * @param gridType — the map's grid type
   * @param size — the map's size in cells
   */
  constructor(gridType: MapGridType, size: Size) {
    this.gridType = gridType
    this.size = size
  }

  /**
   * Get a pooled CellInfo layer wrapper.
   *
   * OpenRA 对照: CellInfoLayerPool.Get()
   *
   * @returns a PooledCellInfoLayer that can be used to acquire layers
   */
  get(): PooledCellInfoLayer {
    return new PooledCellInfoLayer(this)
  }

  /**
   * Internal: get or create a CellLayer<CellInfo>.
   *
   * OpenRA 对照: CellInfoLayerPool.GetLayer()
   *
   * As the default value of CellInfo represents an Unvisited location,
   * we don't need to initialize the values in the layer,
   * we can just clear them to the defaults.
   *
   * @returns a CellLayer<CellInfo> ready for use
   */
  getLayer(): CellLayer<CellInfo> {
    let layer: CellLayer<CellInfo> | undefined

    if (this.pool.length > 0) {
      layer = this.pool.pop()
    }

    if (layer === undefined) {
      layer = new CellLayer<CellInfo>(this.gridType, this.size)
    } else {
      layer.clear()
    }

    return layer
  }

  /**
   * Internal: return a layer to the pool.
   *
   * OpenRA 对照: CellInfoLayerPool.ReturnLayer(CellLayer<CellInfo>)
   *
   * @param layer — the layer to return to the pool
   */
  returnLayer(layer: CellLayer<CellInfo>): void {
    if (this.pool.length < CellInfoLayerPool.MaxPoolSize) {
      this.pool.push(layer)
    }
  }
}

// ---------------------------------------------------------------------------
// PooledCellInfoLayer
// ---------------------------------------------------------------------------

/**
 * Wrapper that manages the lifetime of pooled CellInfo layers.
 *
 * OpenRA 对照: CellInfoLayerPool.PooledCellInfoLayer (nested sealed class)
 *
 * Acquire layers via getLayer(), then dispose() to return all acquired layers
 * to the pool.
 */
export class PooledCellInfoLayer {
  private layerPool: CellInfoLayerPool | null
  private layers: CellLayer<CellInfo>[]

  /**
   * Create a new PooledCellInfoLayer wrapper.
   *
   * OpenRA 对照: PooledCellInfoLayer(CellInfoLayerPool)
   *
   * @param layerPool — the parent pool
   */
  constructor(layerPool: CellInfoLayerPool) {
    this.layerPool = layerPool
    this.layers = []
  }

  /**
   * Acquire a CellLayer<CellInfo> from the pool.
   *
   * OpenRA 对照: PooledCellInfoLayer.GetLayer()
   *
   * @returns a CellLayer<CellInfo> ready for use
   * @throws if this wrapper has already been disposed
   */
  getLayer(): CellLayer<CellInfo> {
    if (this.layerPool === null) {
      throw new Error('PooledCellInfoLayer has already been disposed')
    }

    const layer = this.layerPool.getLayer()
    this.layers.push(layer)
    return layer
  }

  /**
   * Return all acquired layers to the pool.
   *
   * OpenRA 对照: PooledCellInfoLayer.Dispose()
   *
   * After dispose(), this wrapper is no longer usable.
   */
  dispose(): void {
    if (this.layerPool !== null) {
      for (const layer of this.layers) {
        this.layerPool.returnLayer(layer)
      }
    }

    this.layers = []
    this.layerPool = null
  }
}
