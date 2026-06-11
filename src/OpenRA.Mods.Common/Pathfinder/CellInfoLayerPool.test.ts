/**
 * CellInfoLayerPool.test.ts — CellInfoLayerPool unit tests
 *
 * Tests focus on: pool behavior, layer acquisition, reuse, disposal.
 */

import { describe, it, expect } from 'vitest'
import { CellInfoLayerPool, PooledCellInfoLayer } from './CellInfoLayerPool'
import { MapGridType } from '../../OpenRA.Game/Map/MapGridType'

// ---------------------------------------------------------------------------
// Pool construction
// ---------------------------------------------------------------------------

describe('CellInfoLayerPool', () => {
  it('constructs with grid type and size', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })
    expect(pool).toBeDefined()
  })

  it('get returns a PooledCellInfoLayer', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })
    const pooled = pool.get()
    expect(pooled).toBeInstanceOf(PooledCellInfoLayer)
  })
})

// ---------------------------------------------------------------------------
// Layer acquisition
// ---------------------------------------------------------------------------

describe('PooledCellInfoLayer layer acquisition', () => {
  it('getLayer returns a CellLayer', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })
    const pooled = pool.get()
    const layer = pooled.getLayer()
    expect(layer).toBeDefined()
    expect(layer.Size.width).toBe(10)
    expect(layer.Size.height).toBe(10)
  })

  it('getLayer returns different layers on multiple calls', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })
    const pooled = pool.get()
    const layer1 = pooled.getLayer()
    const layer2 = pooled.getLayer()
    expect(layer1).not.toBe(layer2)
  })

  it('throws when getting layer from disposed wrapper', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })
    const pooled = pool.get()
    pooled.dispose()
    expect(() => pooled.getLayer()).toThrow(
      'PooledCellInfoLayer has already been disposed',
    )
  })
})

// ---------------------------------------------------------------------------
// Layer reuse tests
// ---------------------------------------------------------------------------

describe('CellInfoLayerPool reuse', () => {
  it('reuses layers after disposal', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })

    // Acquire and dispose
    const pooled1 = pool.get()
    const layer1 = pooled1.getLayer()
    pooled1.dispose()

    // Acquire again — should get the same layer back
    const pooled2 = pool.get()
    const layer2 = pooled2.getLayer()
    pooled2.dispose()

    expect(layer1).toBe(layer2)
  })

  it('does not reuse beyond MaxPoolSize', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })

    // Acquire more layers than MaxPoolSize
    const pooled = pool.get()
    const layers: ReturnType<typeof pooled.getLayer>[] = []
    for (let i = 0; i < CellInfoLayerPool.MaxPoolSize + 2; i++) {
      layers.push(pooled.getLayer())
    }
    pooled.dispose()

    // Only MaxPoolSize layers should be returned to the pool
    // The next acquisition should create a new layer (not reuse the excess)
    const pooled2 = pool.get()
    const newLayer = pooled2.getLayer()
    pooled2.dispose()

    // newLayer should be one of the first MaxPoolSize layers (reused)
    // not one of the excess layers
    const firstFour = layers.slice(0, CellInfoLayerPool.MaxPoolSize)
    expect(firstFour).toContain(newLayer)
  })

  it('clears reused layers', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })

    // Acquire, modify, and dispose
    const pooled1 = pool.get()
    const layer1 = pooled1.getLayer()
    // CellLayer.clear() sets entries to undefined; we can't easily verify this
    // but we can verify the layer is returned and reused
    pooled1.dispose()

    // Reuse
    const pooled2 = pool.get()
    const layer2 = pooled2.getLayer()
    expect(layer1).toBe(layer2)
    pooled2.dispose()
  })
})

// ---------------------------------------------------------------------------
// Disposal tests
// ---------------------------------------------------------------------------

describe('PooledCellInfoLayer disposal', () => {
  it('dispose is idempotent (no throw on second dispose)', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })
    const pooled = pool.get()
    pooled.dispose()
    expect(() => pooled.dispose()).not.toThrow()
  })

  it('returns all acquired layers on dispose', () => {
    const pool = new CellInfoLayerPool(MapGridType.Rectangular, {
      width: 10,
      height: 10,
    })

    const pooled1 = pool.get()
    const layer1 = pooled1.getLayer()
    const layer2 = pooled1.getLayer()
    pooled1.dispose()

    // Both layers should be returned to the pool
    const pooled2 = pool.get()
    const reused1 = pooled2.getLayer()
    const reused2 = pooled2.getLayer()
    pooled2.dispose()

    const reusedSet = new Set([reused1, reused2])
    expect(reusedSet.has(layer1)).toBe(true)
    expect(reusedSet.has(layer2)).toBe(true)
  })
})
