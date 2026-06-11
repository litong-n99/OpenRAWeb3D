/**
 * CoordinateTransformer.test.ts — CoordinateTransformer migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: coordinate conversion correctness, caching behavior,
 * round-trip fidelity, grid type differences, ramp handling, batch conversion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core/Maths/math.vector
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core/Maths/math.vector', () => {
  class MockVector3 {
    x: number
    y: number
    z: number

    constructor(x: number, y: number, z: number) {
      this.x = x
      this.y = y
      this.z = z
    }

    add(other: MockVector3): MockVector3 {
      return new MockVector3(this.x + other.x, this.y + other.y, this.z + other.z)
    }

    subtract(other: MockVector3): MockVector3 {
      return new MockVector3(this.x - other.x, this.y - other.y, this.z - other.z)
    }

    scale(s: number): MockVector3 {
      return new MockVector3(this.x * s, this.y * s, this.z * s)
    }

    equals(other: MockVector3): boolean {
      return this.x === other.x && this.y === other.y && this.z === other.z
    }

    toString(): string {
      return `${this.x},${this.y},${this.z}`
    }
  }

  return {
    Vector3: MockVector3,
  }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  wPosToVector3,
  vector3ToWPos,
  cellToVector3,
  cellToVector3WithRamp,
  cellsToVertices,
  clearCoordinateCaches,
  getCacheSize,
  WORLD_SCALE,
  HEIGHT_SCALE,
} from './CoordinateTransformer'
import { WPos } from './WPos'
import { CPos } from './CPos'
import { MapGrid } from './Map/MapGrid'
import { MapGridType } from './Map/MapGridType'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a rectangular MapGrid for testing. */
function makeRectGrid(): MapGrid {
  return new MapGrid({ type: MapGridType.Rectangular })
}

/** Create an isometric MapGrid for testing. */
function makeIsoGrid(): MapGrid {
  return new MapGrid({ type: MapGridType.RectangularIsometric })
}

// ---------------------------------------------------------------------------
// wPosToVector3
// ---------------------------------------------------------------------------

describe('wPosToVector3', () => {
  beforeEach(() => {
    clearCoordinateCaches()
  })

  it('converts WPos(1024, 2048, 512) to Vector3(1, 1, 2)', () => {
    const wpos = new WPos(1024, 2048, 512)
    const vec = wPosToVector3(wpos)
    expect(vec.x).toBeCloseTo(1, 6)
    expect(vec.y).toBeCloseTo(1, 6)
    expect(vec.z).toBeCloseTo(2, 6)
  })

  it('converts WPos.Zero to Vector3.Zero', () => {
    const vec = wPosToVector3(WPos.Zero)
    expect(vec.x).toBe(0)
    expect(vec.y).toBe(0)
    expect(vec.z).toBe(0)
  })

  it('converts negative coordinates correctly', () => {
    const wpos = new WPos(-1024, -2048, -512)
    const vec = wPosToVector3(wpos)
    expect(vec.x).toBeCloseTo(-1, 6)
    expect(vec.y).toBeCloseTo(-1, 6)
    expect(vec.z).toBeCloseTo(-2, 6)
  })

  it('maps OpenRA X to Babylon.js X', () => {
    const wpos = new WPos(2048, 0, 0)
    const vec = wPosToVector3(wpos)
    expect(vec.x).toBeCloseTo(2, 6)
    expect(vec.y).toBe(0)
    expect(vec.z).toBe(0)
  })

  it('maps OpenRA Y to Babylon.js Z', () => {
    const wpos = new WPos(0, 2048, 0)
    const vec = wPosToVector3(wpos)
    expect(vec.x).toBe(0)
    expect(vec.y).toBe(0)
    expect(vec.z).toBeCloseTo(2, 6)
  })

  it('maps OpenRA Z to Babylon.js Y', () => {
    const wpos = new WPos(0, 0, 512)
    const vec = wPosToVector3(wpos)
    expect(vec.x).toBe(0)
    expect(vec.z).toBe(0)
    expect(vec.y).toBeCloseTo(1, 6)
  })

  it('uses cache on second call with same WPos', () => {
    const wpos = new WPos(1000, 2000, 300)
    const vec1 = wPosToVector3(wpos)
    const vec2 = wPosToVector3(wpos)
    // Same reference due to caching
    expect(vec2).toBe(vec1)
  })
})

// ---------------------------------------------------------------------------
// vector3ToWPos
// ---------------------------------------------------------------------------

describe('vector3ToWPos', () => {
  beforeEach(() => {
    clearCoordinateCaches()
  })

  it('converts Vector3(1, 1, 2) to WPos(1024, 2048, 512)', () => {
    const vec = new Vector3(1, 1, 2)
    const wpos = vector3ToWPos(vec)
    expect(wpos.X).toBe(1024)
    expect(wpos.Y).toBe(2048)
    expect(wpos.Z).toBe(512)
  })

  it('converts Vector3.Zero to WPos.Zero', () => {
    const wpos = vector3ToWPos(new Vector3(0, 0, 0))
    expect(WPos.equals(wpos, WPos.Zero)).toBe(true)
  })

  it('rounds fractional values correctly', () => {
    const vec = new Vector3(1.5, 2.5, 3.5)
    const wpos = vector3ToWPos(vec)
    expect(wpos.X).toBe(Math.round(1.5 / WORLD_SCALE))
    expect(wpos.Y).toBe(Math.round(3.5 / WORLD_SCALE))
    expect(wpos.Z).toBe(Math.round(2.5 / HEIGHT_SCALE))
  })

  it('uses cache on second call with same Vector3', () => {
    const vec = new Vector3(1, 1, 2)
    const wpos1 = vector3ToWPos(vec)
    const wpos2 = vector3ToWPos(vec)
    // Same reference due to caching
    expect(wpos2).toBe(wpos1)
  })
})

// ---------------------------------------------------------------------------
// Round-trip: WPos -> Vector3 -> WPos
// ---------------------------------------------------------------------------

describe('round-trip conversion', () => {
  beforeEach(() => {
    clearCoordinateCaches()
  })

  it('WPos -> Vector3 -> WPos returns original for exact multiples', () => {
    const original = new WPos(1024, 2048, 512)
    const vec = wPosToVector3(original)
    const back = vector3ToWPos(vec)
    expect(WPos.equals(back, original)).toBe(true)
  })

  it('round-trip for arbitrary coordinates', () => {
    const original = new WPos(1234, 5678, 300)
    const vec = wPosToVector3(original)
    const back = vector3ToWPos(vec)
    // Due to rounding, should be very close
    expect(Math.abs(back.X - original.X)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.Y - original.Y)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.Z - original.Z)).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// cellToVector3 -- rectangular grid
// ---------------------------------------------------------------------------

describe('cellToVector3 -- rectangular grid', () => {
  beforeEach(() => {
    clearCoordinateCaches()
  })

  it('CPos(0, 0) at height=0 -> Vector3(0, 0, 0)', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(0, 0)
    const vec = cellToVector3(cpos, 0, grid)
    expect(vec.x).toBe(0)
    expect(vec.y).toBe(0)
    expect(vec.z).toBe(0)
  })

  it('CPos(1, 0) at height=0 -> x = tileScale * WORLD_SCALE', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(1, 0)
    const vec = cellToVector3(cpos, 0, grid)
    expect(vec.x).toBeCloseTo(grid.tileScale * WORLD_SCALE, 6)
    expect(vec.y).toBe(0)
    expect(vec.z).toBe(0)
  })

  it('CPos(0, 1) at height=0 -> z = tileScale * WORLD_SCALE', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(0, 1)
    const vec = cellToVector3(cpos, 0, grid)
    expect(vec.x).toBe(0)
    expect(vec.y).toBe(0)
    expect(vec.z).toBeCloseTo(grid.tileScale * WORLD_SCALE, 6)
  })

  it('CPos(2, 3) at height=1 -> correct position', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(2, 3)
    const vec = cellToVector3(cpos, 1, grid)
    expect(vec.x).toBeCloseTo(2 * grid.tileScale * WORLD_SCALE, 6)
    expect(vec.y).toBeCloseTo(1 * HEIGHT_SCALE, 6)
    expect(vec.z).toBeCloseTo(3 * grid.tileScale * WORLD_SCALE, 6)
  })

  it('uses cache on second call', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(1, 1)
    const vec1 = cellToVector3(cpos, 0, grid)
    const vec2 = cellToVector3(cpos, 0, grid)
    expect(vec2).toBe(vec1)
  })
})

// ---------------------------------------------------------------------------
// cellToVector3 -- isometric grid
// ---------------------------------------------------------------------------

describe('cellToVector3 -- isometric grid', () => {
  beforeEach(() => {
    clearCoordinateCaches()
  })

  it('CPos(0, 0) at height=0 -> Vector3(0, 0, 0)', () => {
    const grid = makeIsoGrid()
    const cpos = new CPos(0, 0)
    const vec = cellToVector3(cpos, 0, grid)
    expect(vec.x).toBe(0)
    expect(vec.y).toBe(0)
    expect(vec.z).toBe(0)
  })

  it('CPos(1, 1) produces correct diamond coordinates', () => {
    const grid = makeIsoGrid()
    const cpos = new CPos(1, 1)
    const vec = cellToVector3(cpos, 0, grid)
    // Isometric: X = (1-1)*tileScale/2 = 0, Y = (1+1)*tileScale/2 = tileScale
    expect(vec.x).toBeCloseTo(0, 6)
    expect(vec.z).toBeCloseTo(grid.tileScale * WORLD_SCALE, 6)
  })

  it('CPos(2, 0) produces x > 0, z > 0', () => {
    const grid = makeIsoGrid()
    const cpos = new CPos(2, 0)
    const vec = cellToVector3(cpos, 0, grid)
    // X = (2-0)*tileScale/2 = tileScale, Y = (2+0)*tileScale/2 = tileScale
    expect(vec.x).toBeCloseTo(grid.tileScale * WORLD_SCALE, 6)
    expect(vec.z).toBeCloseTo(grid.tileScale * WORLD_SCALE, 6)
  })

  it('isometric tileScale is 1448', () => {
    const grid = makeIsoGrid()
    expect(grid.tileScale).toBe(1448)
  })

  it('rectangular tileScale is 1024', () => {
    const grid = makeRectGrid()
    expect(grid.tileScale).toBe(1024)
  })
})

// ---------------------------------------------------------------------------
// cellToVector3WithRamp
// ---------------------------------------------------------------------------

describe('cellToVector3WithRamp', () => {
  beforeEach(() => {
    clearCoordinateCaches()
  })

  it('ramp=0 (flat) returns same as cellToVector3', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(1, 1)
    const base = cellToVector3(cpos, 0, grid)
    const withRamp = cellToVector3WithRamp(cpos, 0, 0, grid)
    expect(withRamp.x).toBeCloseTo(base.x, 6)
    expect(withRamp.y).toBeCloseTo(base.y, 6)
    expect(withRamp.z).toBeCloseTo(base.z, 6)
  })

  it('invalid ramp index returns base position', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(1, 1)
    const base = cellToVector3(cpos, 0, grid)
    const withRamp = cellToVector3WithRamp(cpos, 0, 999, grid)
    expect(withRamp.x).toBeCloseTo(base.x, 6)
    expect(withRamp.y).toBeCloseTo(base.y, 6)
    expect(withRamp.z).toBeCloseTo(base.z, 6)
  })

  it('ramp=1 (two adjacent corners raised) has non-zero center offset', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(0, 0)
    const withRamp = cellToVector3WithRamp(cpos, 0, 1, grid)
    const base = cellToVector3(cpos, 0, grid)
    // Ramp 1 has some corners at Half height, so center should be elevated
    expect(withRamp.y).not.toBe(base.y)
  })

  it('height is correctly applied with ramp', () => {
    const grid = makeRectGrid()
    const cpos = new CPos(0, 0)
    const withRamp0 = cellToVector3WithRamp(cpos, 0, 1, grid)
    const withRamp1 = cellToVector3WithRamp(cpos, 2, 1, grid)
    // Height difference should be 2 * HEIGHT_SCALE
    expect(withRamp1.y - withRamp0.y).toBeCloseTo(2 * HEIGHT_SCALE, 6)
  })
})

// ---------------------------------------------------------------------------
// cellsToVertices
// ---------------------------------------------------------------------------

describe('cellsToVertices', () => {
  beforeEach(() => {
    clearCoordinateCaches()
  })

  it('4 cells produce Float32Array of length 12', () => {
    const grid = makeRectGrid()
    const cells = [new CPos(0, 0), new CPos(1, 0), new CPos(0, 1), new CPos(1, 1)]
    const heights = [0, 0, 0, 0]
    const result = cellsToVertices(cells, heights, grid)
    expect(result.length).toBe(12)
  })

  it('0 cells produce empty Float32Array', () => {
    const grid = makeRectGrid()
    const result = cellsToVertices([], [], grid)
    expect(result.length).toBe(0)
  })

  it('first vertex matches cell(0,0) position', () => {
    const grid = makeRectGrid()
    const cells = [new CPos(0, 0)]
    const heights = [0]
    const result = cellsToVertices(cells, heights, grid)
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(0)
    expect(result[2]).toBe(0)
  })

  it('vertex layout is x, y, z per cell', () => {
    const grid = makeRectGrid()
    const cells = [new CPos(1, 0)]
    const heights = [2]
    const result = cellsToVertices(cells, heights, grid)
    expect(result[0]).toBeCloseTo(grid.tileScale * WORLD_SCALE, 6) // x
    expect(result[1]).toBeCloseTo(2 * HEIGHT_SCALE, 6) // y (height)
    expect(result[2]).toBe(0) // z
  })

  it('throws when heights array is shorter than cells', () => {
    const grid = makeRectGrid()
    const cells = [new CPos(0, 0), new CPos(1, 0)]
    const heights = [0]
    expect(() => cellsToVertices(cells, heights, grid)).toThrow(
      'heights array length',
    )
  })

  it('handles isometric grid correctly', () => {
    const grid = makeIsoGrid()
    const cells = [new CPos(1, 1)]
    const heights = [0]
    const result = cellsToVertices(cells, heights, grid)
    // Isometric: x = (1-1)*1448/2 = 0, z = (1+1)*1448/2 = 1448
    expect(result[0]).toBeCloseTo(0, 6)
    expect(result[2]).toBeCloseTo(grid.tileScale * WORLD_SCALE, 6)
  })
})

// ---------------------------------------------------------------------------
// Cache behavior
// ---------------------------------------------------------------------------

describe('cache behavior', () => {
  beforeEach(() => {
    clearCoordinateCaches()
  })

  it('cache size is 0 after clear', () => {
    expect(getCacheSize()).toBe(0)
  })

  it('cache accumulates entries after conversions', () => {
    const grid = makeRectGrid()
    cellToVector3(new CPos(0, 0), 0, grid)
    expect(getCacheSize()).toBeGreaterThan(0)
  })

  it('same WPos returns cached Vector3 instance', () => {
    const wpos = new WPos(1024, 2048, 512)
    const v1 = wPosToVector3(wpos)
    const v2 = wPosToVector3(wpos)
    expect(v1).toBe(v2)
  })

  it('same Vector3 returns cached WPos instance', () => {
    const vec = new Vector3(1, 1, 2)
    const w1 = vector3ToWPos(vec)
    const w2 = vector3ToWPos(vec)
    expect(w1).toBe(w2)
  })

  it('clearCoordinateCaches resets all caches', () => {
    const grid = makeRectGrid()
    wPosToVector3(new WPos(100, 200, 300))
    cellToVector3(new CPos(0, 0), 0, grid)
    expect(getCacheSize()).toBeGreaterThan(0)
    clearCoordinateCaches()
    expect(getCacheSize()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Performance: batch conversion
// ---------------------------------------------------------------------------

describe('batch conversion performance', () => {
  it('converts 1000 cells in under 50ms', () => {
    const grid = makeRectGrid()
    const cells: CPos[] = []
    const heights: number[] = []
    for (let i = 0; i < 1000; i++) {
      cells.push(new CPos(i % 32, Math.floor(i / 32)))
      heights.push(i % 5)
    }

    const start = performance.now()
    const result = cellsToVertices(cells, heights, grid)
    const elapsed = performance.now() - start

    expect(result.length).toBe(3000)
    expect(elapsed).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('WORLD_SCALE equals 1/1024', () => {
    expect(WORLD_SCALE).toBe(1 / 1024)
  })

  it('HEIGHT_SCALE equals 1/512', () => {
    expect(HEIGHT_SCALE).toBe(1 / 512)
  })
})
