/**
 * CoordinateTransformer.ts — OpenRA ↔ Babylon.js 坐标转换
 * OpenRA 对照: (无直接对应，新文件)
 *
 * 核心范式转换:
 * - OpenRA 左手坐标系 (X→右, Y→下, Z→高度) → Babylon.js 右手坐标系 (X→右, Y→上, Z→前)
 * - 世界单位 (1024 = 1 cell) → 归一化 3D 单位
 * - 整数坐标 → 浮点 3D 向量
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { WPos } from './WPos'
import { CPos } from './CPos'
import { MapGrid } from './Map/MapGrid'
import { Cache } from './Primitives/Cache'
import { MapGridType } from './Map/MapGridType'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** World scale factor: 1024 OpenRA world units = 1 Babylon.js unit. */
export const WORLD_SCALE = 1 / 1024

/** Height scale factor: 512 OpenRA height units = 1 Babylon.js unit. */
export const HEIGHT_SCALE = 1 / 512

/** LRU cache size limit for coordinate conversions. */
export const CACHE_SIZE = 1000

// ---------------------------------------------------------------------------
// Internal: LRU Cache with eviction
// ---------------------------------------------------------------------------

/**
 * A size-bounded cache that evicts the oldest entry when full.
 * Wraps the project's Cache class with an LRU eviction policy.
 */
class LruCache<K, V> {
  private readonly store = new Map<K, V>()
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.store.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.store.delete(key)
      this.store.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key)
    } else if (this.store.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.store.keys().next().value as K
      this.store.delete(firstKey)
    }
    this.store.set(key, value)
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }
}

// ---------------------------------------------------------------------------
// Internal: Cache instances
// ---------------------------------------------------------------------------

/** Cache for WPos → Vector3 conversions. */
const wPosToVecCache = new LruCache<string, Vector3>(CACHE_SIZE)

/** Cache for Vector3 → WPos conversions. */
const vecToWPosCache = new LruCache<string, WPos>(CACHE_SIZE)

/** Cache for cell center world position → Vector3 conversions. */
const cellToVecCache = new Cache<string, Vector3>((key) => {
  const parts = key.split(',')
  const cX = parseInt(parts[0]!, 10)
  const cY = parseInt(parts[1]!, 10)
  const height = parseInt(parts[2]!, 10)
  const tileScale = parseInt(parts[3]!, 10)
  const gridTypeNum = parseInt(parts[4]!, 10)
  const gridType: MapGridType = gridTypeNum === 1 ? MapGridType.RectangularIsometric : MapGridType.Rectangular
  return cellCenterToVector3Raw(cX, cY, height, tileScale, gridType)
})

// ---------------------------------------------------------------------------
// WPos ↔ Vector3 conversion
// ---------------------------------------------------------------------------

/**
 * Convert an OpenRA WPos to a Babylon.js Vector3.
 *
 * Mapping: OpenRA (X, Y, Z) → Babylon.js (X * WORLD_SCALE, Z * HEIGHT_SCALE, Y * WORLD_SCALE)
 *
 * @param wpos — OpenRA world position
 * @returns A Vector3 that MUST NOT be mutated — it is a cached reference shared across callers.
 */
export function wPosToVector3(wpos: WPos): Vector3 {
  const key = wpos.toString()
  const cached = wPosToVecCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const result = new Vector3(
    wpos.X * WORLD_SCALE,
    wpos.Z * HEIGHT_SCALE,
    wpos.Y * WORLD_SCALE,
  )
  wPosToVecCache.set(key, result)
  return result
}

/**
 * Convert a Babylon.js Vector3 back to an OpenRA WPos.
 *
 * Mapping: Babylon.js (x, y, z) → OpenRA (round(x / WORLD_SCALE), round(z / WORLD_SCALE), round(y / HEIGHT_SCALE))
 *
 * @param vec — Babylon.js Vector3
 * @returns OpenRA WPos
 */
export function vector3ToWPos(vec: Vector3): WPos {
  const key = `${vec.x},${vec.y},${vec.z}`
  const cached = vecToWPosCache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const result = new WPos(
    Math.round(vec.x / WORLD_SCALE),
    Math.round(vec.z / WORLD_SCALE),
    Math.round(vec.y / HEIGHT_SCALE),
  )
  vecToWPosCache.set(key, result)
  return result
}

// ---------------------------------------------------------------------------
// Cell → Vector3 conversion
// ---------------------------------------------------------------------------

/**
 * Convert a cell position to a Babylon.js Vector3 at the cell center.
 *
 * For rectangular grids, the cell center is at (cX * tileScale, cY * tileScale).
 * For isometric grids, cells are staggered in a diamond pattern.
 *
 * @param cpos — cell position
 * @param height — terrain height in cell-height units
 * @param grid — map grid configuration
 * @returns Babylon.js Vector3 at cell center
 */
export function cellToVector3(cpos: CPos, height: number, grid: MapGrid): Vector3 {
  const key = `${cpos.X},${cpos.Y},${height | 0},${grid.tileScale | 0},${grid.type}`
  return cellToVecCache.get(key)
}

/**
 * Raw cell-to-Vector3 conversion without caching.
 * Internal implementation shared by cached and uncached paths.
 *
 * @returns A new Vector3 at the cell center (not cached — caller must manage lifetime).
 */
function cellCenterToVector3Raw(
  cX: number,
  cY: number,
  height: number,
  tileScale: number,
  gridType: MapGridType,
): Vector3 {
  if (gridType === MapGridType.RectangularIsometric) {
    // Isometric: diamond grid layout
    // X = (cX - cY) * tileScale / 2
    // Y = (cX + cY) * tileScale / 2
    const worldX = ((cX - cY) * tileScale) / 2
    const worldY = ((cX + cY) * tileScale) / 2
    return new Vector3(
      worldX * WORLD_SCALE,
      height * HEIGHT_SCALE,
      worldY * WORLD_SCALE,
    )
  }

  // Rectangular: orthogonal grid
  const worldX = cX * tileScale
  const worldY = cY * tileScale
  return new Vector3(
    worldX * WORLD_SCALE,
    height * HEIGHT_SCALE,
    worldY * WORLD_SCALE,
  )
}

// ---------------------------------------------------------------------------
// Cell + Ramp → Vector3 conversion
// ---------------------------------------------------------------------------

/**
 * Convert a cell position to a Babylon.js Vector3, accounting for ramp height offset.
 *
 * Uses the CellRamp's barycentric height interpolation at the cell center (0, 0)
 * to compute the precise height offset for the ramp shape.
 *
 * @param cpos — cell position
 * @param height — base terrain height in cell-height units
 * @param ramp — ramp type index (0-20, referencing MapGrid.ramps)
 * @param grid — map grid configuration
 * @returns Babylon.js Vector3 at cell center with ramp-adjusted height
 */
export function cellToVector3WithRamp(
  cpos: CPos,
  height: number,
  ramp: number,
  grid: MapGrid,
): Vector3 {
  const base = cellToVector3(cpos, height, grid)

  if (ramp <= 0 || ramp >= grid.ramps.length) {
    // No ramp or invalid ramp index — return base position
    return base
  }

  const cellRamp = grid.ramps[ramp]!
  const rampOffset = cellRamp.heightOffset(0, 0)

  return new Vector3(
    base.x,
    base.y + rampOffset * HEIGHT_SCALE,
    base.z,
  )
}

// ---------------------------------------------------------------------------
// Bulk conversion: cells → vertices
// ---------------------------------------------------------------------------

/**
 * Convert an array of cell positions to a flat Float32Array of vertex positions.
 *
 * Each cell produces one vertex at its center:
 *   output[i * 3 + 0] = x (Babylon.js X)
 *   output[i * 3 + 1] = y (Babylon.js Y, i.e. height)
 *   output[i * 3 + 2] = z (Babylon.js Z)
 *
 * This is a zero-allocation-per-element batch conversion: the output array
 * is pre-allocated and filled in place.
 *
 * @param cells — array of cell positions
 * @param heights — array of terrain heights (parallel to cells)
 * @param grid — map grid configuration
 * @returns Float32Array of length cells.length * 3
 */
export function cellsToVertices(
  cells: readonly CPos[],
  heights: readonly number[],
  grid: MapGrid,
): Float32Array {
  const count = cells.length
  if (count === 0) {
    return new Float32Array(0)
  }

  if (heights.length < count) {
    throw new Error(
      `heights array length (${heights.length}) must be >= cells array length (${count})`,
    )
  }

  const result = new Float32Array(count * 3)
  const isIsometric = grid.type === MapGridType.RectangularIsometric
  const tileScale = grid.tileScale

  for (let i = 0; i < count; i++) {
    const cpos = cells[i]!
    const height = heights[i]!

    let worldX: number
    let worldY: number

    if (isIsometric) {
      worldX = ((cpos.X - cpos.Y) * tileScale) / 2
      worldY = ((cpos.X + cpos.Y) * tileScale) / 2
    } else {
      worldX = cpos.X * tileScale
      worldY = cpos.Y * tileScale
    }

    const idx = i * 3
    result[idx] = worldX * WORLD_SCALE
    result[idx + 1] = height * HEIGHT_SCALE
    result[idx + 2] = worldY * WORLD_SCALE
  }

  return result
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/**
 * Clear all internal caches.
 *
 * Call this when switching maps or when memory pressure is detected.
 *
 * @returns void — all cache entries are dropped and eligible for garbage collection.
 */
export function clearCoordinateCaches(): void {
  wPosToVecCache.clear()
  vecToWPosCache.clear()
  cellToVecCache.clear()
}

/**
 * Get the total number of cached entries across all caches.
 *
 * @returns total cached entry count across wPosToVecCache, vecToWPosCache, and cellToVecCache.
 */
export function getCacheSize(): number {
  return wPosToVecCache.size + vecToWPosCache.size + cellToVecCache.size
}
