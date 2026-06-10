/**
 * MapGrid.test.ts — MapGrid unit tests
 *
 * Tests focus on:
 * - MapGrid construction and configuration
 * - SubCell offsets and OffsetOfSubCell
 * - DefaultSubCell validation
 * - Ramp array integrity (21 ramps, polygon count, corner count)
 * - TilesByDistance deterministic generation
 */

import { describe, it, expect } from 'vitest'
import { MapGrid } from './MapGrid'
import { MapGridType } from './MapGridType'
import { WVec } from '../WVec'
import { SubCell } from '../Traits/SubCell'

// ---------------------------------------------------------------------------
// MapGrid — all 21 predefined CellRamp shapes (rectangular)
// ---------------------------------------------------------------------------

describe('MapGrid — all 21 predefined CellRamp shapes (rectangular)', () => {
  const grid = new MapGrid({ type: MapGridType.Rectangular })

  it('has exactly 21 ramps', () => {
    expect(grid.ramps.length).toBe(21)
  })

  it('ramp 0: flat — all corners Z=0', () => {
    const r = grid.ramps[0]
    r.corners.forEach((c) => expect(c.Z).toBe(0))
    expect(r.centerHeightOffset).toBe(0)
    expect(r.polygons.length).toBe(1)
  })

  it('ramps 1-4: two adjacent corners half', () => {
    expect(grid.ramps[1].corners[1].Z).toBe(512)
    expect(grid.ramps[1].corners[2].Z).toBe(512)
    expect(grid.ramps[1].corners[0].Z).toBe(0)
    expect(grid.ramps[1].corners[3].Z).toBe(0)
    expect(grid.ramps[1].polygons.length).toBe(1)

    expect(grid.ramps[2].corners[2].Z).toBe(512)
    expect(grid.ramps[2].corners[3].Z).toBe(512)

    expect(grid.ramps[3].corners[0].Z).toBe(512)
    expect(grid.ramps[3].corners[3].Z).toBe(512)

    expect(grid.ramps[4].corners[0].Z).toBe(512)
    expect(grid.ramps[4].corners[1].Z).toBe(512)
  })

  it('ramps 5-8: one corner half with split', () => {
    expect(grid.ramps[5].corners[2].Z).toBe(512)
    expect(grid.ramps[5].polygons.length).toBe(2)

    expect(grid.ramps[6].corners[3].Z).toBe(512)
    expect(grid.ramps[6].polygons.length).toBe(2)

    expect(grid.ramps[7].corners[0].Z).toBe(512)
    expect(grid.ramps[7].polygons.length).toBe(2)

    expect(grid.ramps[8].corners[1].Z).toBe(512)
    expect(grid.ramps[8].polygons.length).toBe(2)
  })

  it('ramps 9-12: three corners half', () => {
    expect(grid.ramps[9].corners[1].Z).toBe(512)
    expect(grid.ramps[9].corners[2].Z).toBe(512)
    expect(grid.ramps[9].corners[3].Z).toBe(512)
    expect(grid.ramps[9].corners[0].Z).toBe(0)
    expect(grid.ramps[9].polygons.length).toBe(2)

    expect(grid.ramps[10].corners[0].Z).toBe(512)
    expect(grid.ramps[10].corners[2].Z).toBe(512)
    expect(grid.ramps[10].corners[3].Z).toBe(512)
    expect(grid.ramps[10].polygons.length).toBe(2)

    expect(grid.ramps[11].corners[0].Z).toBe(512)
    expect(grid.ramps[11].corners[1].Z).toBe(512)
    expect(grid.ramps[11].corners[3].Z).toBe(512)
    expect(grid.ramps[11].polygons.length).toBe(2)

    expect(grid.ramps[12].corners[0].Z).toBe(512)
    expect(grid.ramps[12].corners[1].Z).toBe(512)
    expect(grid.ramps[12].corners[2].Z).toBe(512)
    expect(grid.ramps[12].polygons.length).toBe(2)
  })

  it('ramps 13-16: full tile sloped', () => {
    expect(grid.ramps[13].corners[1].Z).toBe(512)
    expect(grid.ramps[13].corners[2].Z).toBe(1024)
    expect(grid.ramps[13].corners[3].Z).toBe(512)
    expect(grid.ramps[13].corners[0].Z).toBe(0)

    expect(grid.ramps[14].corners[0].Z).toBe(512)
    expect(grid.ramps[14].corners[2].Z).toBe(512)
    expect(grid.ramps[14].corners[3].Z).toBe(1024)

    expect(grid.ramps[15].corners[0].Z).toBe(1024)
    expect(grid.ramps[15].corners[1].Z).toBe(512)
    expect(grid.ramps[15].corners[3].Z).toBe(512)

    expect(grid.ramps[16].corners[0].Z).toBe(512)
    expect(grid.ramps[16].corners[1].Z).toBe(1024)
    expect(grid.ramps[16].corners[2].Z).toBe(512)
  })

  it('ramps 17-20: two opposite corners half', () => {
    expect(grid.ramps[17].corners[1].Z).toBe(512)
    expect(grid.ramps[17].corners[3].Z).toBe(512)
    expect(grid.ramps[17].corners[0].Z).toBe(0)
    expect(grid.ramps[17].corners[2].Z).toBe(0)
    expect(grid.ramps[17].polygons.length).toBe(2)

    expect(grid.ramps[18].corners[0].Z).toBe(512)
    expect(grid.ramps[18].corners[2].Z).toBe(512)
    expect(grid.ramps[18].polygons.length).toBe(2)

    expect(grid.ramps[19].corners[1].Z).toBe(512)
    expect(grid.ramps[19].corners[3].Z).toBe(512)
    expect(grid.ramps[19].polygons.length).toBe(2)

    expect(grid.ramps[20].corners[0].Z).toBe(512)
    expect(grid.ramps[20].corners[2].Z).toBe(512)
    expect(grid.ramps[20].polygons.length).toBe(2)
  })

  it('every ramp has a valid centerHeightOffset in [0, 1024]', () => {
    grid.ramps.forEach((r, i) => {
      expect(
        r.centerHeightOffset,
        `ramp ${i} centerHeightOffset out of range`,
      ).toBeGreaterThanOrEqual(0)
      expect(
        r.centerHeightOffset,
        `ramp ${i} centerHeightOffset out of range`,
      ).toBeLessThanOrEqual(1024)
    })
  })

  it('every ramp has between 1 and 2 polygons', () => {
    grid.ramps.forEach((r, i) => {
      expect(r.polygons.length, `ramp ${i} polygon count`).toBeGreaterThanOrEqual(1)
      expect(r.polygons.length, `ramp ${i} polygon count`).toBeLessThanOrEqual(2)
    })
  })

  it('every ramp polygon vertex count matches split type', () => {
    grid.ramps.forEach((r, i) => {
      r.polygons.forEach((p, pi) => {
        // Flat split: single quad (4 vertices); X/Y split: triangles (3 vertices)
        const expectedVerts = r.polygons.length === 1 ? 4 : 3
        expect(p.length, `ramp ${i} polygon ${pi} vertex count`).toBe(expectedVerts)
      })
    })
  })

  it('every ramp has 4 corners', () => {
    grid.ramps.forEach((r) => {
      expect(r.corners.length).toBe(4)
    })
  })

  it('heightOffset at corners matches corner Z for all ramps', () => {
    grid.ramps.forEach((r, i) => {
      for (let ci = 0; ci < 4; ci++) {
        const c = r.corners[ci]
        const h = r.heightOffset(c.X, c.Y)
        expect(
          Math.abs(h - c.Z),
          `ramp ${i} corner ${ci}: heightOffset(${c.X},${c.Y})=${h}, expected ${c.Z}`,
        ).toBeLessThanOrEqual(1)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// MapGrid — defaults (rectangular)
// ---------------------------------------------------------------------------

describe('MapGrid — defaults (rectangular)', () => {
  const grid = new MapGrid()

  it('default type is Rectangular', () => {
    expect(grid.type).toBe(MapGridType.Rectangular)
  })

  it('tileScale is 1024 for rectangular', () => {
    expect(grid.tileScale).toBe(1024)
  })

  it('maximumTerrainHeight defaults to 0', () => {
    expect(grid.maximumTerrainHeight).toBe(0)
  })

  it('enableDepthBuffer defaults to false', () => {
    expect(grid.enableDepthBuffer).toBe(false)
  })

  it('maximumTileSearchRange defaults to 50', () => {
    expect(grid.maximumTileSearchRange).toBe(50)
  })

  it('defaultSubCell defaults to 3 (middle)', () => {
    expect(grid.defaultSubCell).toBe(3)
  })

  it('subCellOffsets has 6 entries', () => {
    expect(grid.subCellOffsets.length).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// MapGrid — isometric
// ---------------------------------------------------------------------------

describe('MapGrid — isometric', () => {
  const grid = new MapGrid({ type: MapGridType.RectangularIsometric })

  it('tileScale is 1448 for isometric', () => {
    expect(grid.tileScale).toBe(1448)
  })

  it('ramps use isometric scale (724)', () => {
    const flatRamp = grid.ramps[0]
    expect(flatRamp.corners[1].Y).toBe(0)
    expect(flatRamp.corners[1].X).toBe(724)
  })
})

// ---------------------------------------------------------------------------
// MapGrid — SubCellOffsets
// ---------------------------------------------------------------------------

describe('MapGrid — SubCellOffsets', () => {
  const grid = new MapGrid()

  it('index 0: full cell center (0,0,0)', () => {
    const o = grid.subCellOffsets[0]
    expect(o.X).toBe(0)
    expect(o.Y).toBe(0)
    expect(o.Z).toBe(0)
  })

  it('index 1: top left (-299,-256,0)', () => {
    const o = grid.subCellOffsets[1]
    expect(o.X).toBe(-299)
    expect(o.Y).toBe(-256)
    expect(o.Z).toBe(0)
  })

  it('index 2: top right (256,-256,0)', () => {
    const o = grid.subCellOffsets[2]
    expect(o.X).toBe(256)
    expect(o.Y).toBe(-256)
    expect(o.Z).toBe(0)
  })

  it('index 3: center (0,0,0) — duplicate of index 0, matches OpenRA', () => {
    const o = grid.subCellOffsets[3]
    expect(o.X).toBe(0)
    expect(o.Y).toBe(0)
    expect(o.Z).toBe(0)
  })

  it('index 4: bottom left (-299,256,0)', () => {
    const o = grid.subCellOffsets[4]
    expect(o.X).toBe(-299)
    expect(o.Y).toBe(256)
    expect(o.Z).toBe(0)
  })

  it('index 5: bottom right (256,256,0)', () => {
    const o = grid.subCellOffsets[5]
    expect(o.X).toBe(256)
    expect(o.Y).toBe(256)
    expect(o.Z).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// MapGrid — OffsetOfSubCell
// ---------------------------------------------------------------------------

describe('MapGrid — OffsetOfSubCell', () => {
  const grid = new MapGrid()

  it('returns WVec.Zero for SubCell.Invalid', () => {
    const result = grid.offsetOfSubCell(SubCell.Invalid)
    expect(WVec.equals(result, WVec.Zero)).toBe(true)
  })

  it('returns WVec.Zero for SubCell.Any', () => {
    const result = grid.offsetOfSubCell(SubCell.Any)
    expect(WVec.equals(result, WVec.Zero)).toBe(true)
  })

  it('returns correct offset for FullCell (index 0)', () => {
    const result = grid.offsetOfSubCell(SubCell.FullCell)
    expect(result.X).toBe(0)
    expect(result.Y).toBe(0)
  })

  it('returns correct offset for index 1', () => {
    const result = grid.offsetOfSubCell(1)
    expect(result.X).toBe(-299)
    expect(result.Y).toBe(-256)
  })

  it('returns correct offset for index 5', () => {
    const result = grid.offsetOfSubCell(5)
    expect(result.X).toBe(256)
    expect(result.Y).toBe(256)
  })

  it('returns WVec.Zero for out-of-range index', () => {
    const result = grid.offsetOfSubCell(6)
    expect(WVec.equals(result, WVec.Zero)).toBe(true)
  })

  it('returns WVec.Zero for negative index', () => {
    const result = grid.offsetOfSubCell(-1)
    expect(WVec.equals(result, WVec.Zero)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MapGrid — DefaultSubCell validation
// ---------------------------------------------------------------------------

describe('MapGrid — DefaultSubCell validation', () => {
  it('accepts valid default subcell index 1', () => {
    const grid = new MapGrid({ defaultSubCell: 1 })
    expect(grid.defaultSubCell).toBe(1)
  })

  it('accepts maximum valid index 5', () => {
    const grid = new MapGrid({ defaultSubCell: 5 })
    expect(grid.defaultSubCell).toBe(5)
  })

  it('throws for index 0 when subcell count > 1', () => {
    expect(() => new MapGrid({ defaultSubCell: 0 })).toThrow(
      /Subcell default index must be a valid index/,
    )
  })

  it('throws for out-of-range index 6', () => {
    expect(() => new MapGrid({ defaultSubCell: 6 })).toThrow(
      /Subcell default index must be a valid index/,
    )
  })

  it('SubCell.Invalid (255) defaults to middle index 3', () => {
    const grid = new MapGrid({ defaultSubCell: SubCell.Invalid })
    expect(grid.defaultSubCell).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// MapGrid — TilesByDistance
// ---------------------------------------------------------------------------

describe('MapGrid — TilesByDistance', () => {
  const grid = new MapGrid({ maximumTileSearchRange: 5 })

  it('has range+1 groups (6 for range=5)', () => {
    expect(grid.tilesByDistance.length).toBe(6)
  })

  it('group 0 contains only (0,0)', () => {
    expect(grid.tilesByDistance[0].length).toBe(1)
    expect(grid.tilesByDistance[0][0].X).toBe(0)
    expect(grid.tilesByDistance[0][0].Y).toBe(0)
  })

  it('group 1 contains 4 cells: (-1,0), (1,0), (0,-1), (0,1)', () => {
    expect(grid.tilesByDistance[1].length).toBe(4)
  })

  it('all cells in group N have distance ceiling = N', () => {
    for (let n = 0; n < grid.tilesByDistance.length; n++) {
      for (const cell of grid.tilesByDistance[n]) {
        const distSq = cell.X * cell.X + cell.Y * cell.Y
        const ceil = Math.ceil(Math.sqrt(distSq))
        expect(ceil, `group ${n}: cell (${cell.X},${cell.Y})`).toBe(n)
      }
    }
  })

  it('each group is sorted by lengthSquared ascending', () => {
    for (const group of grid.tilesByDistance) {
      for (let i = 1; i < group.length; i++) {
        expect(group[i - 1].lengthSquared).toBeLessThanOrEqual(
          group[i].lengthSquared,
        )
      }
    }
  })

  it('sort is deterministic (same input → same output)', () => {
    const grid2 = new MapGrid({ maximumTileSearchRange: 3 })
    const grid3 = new MapGrid({ maximumTileSearchRange: 3 })

    for (let n = 0; n < grid2.tilesByDistance.length; n++) {
      for (let i = 0; i < grid2.tilesByDistance[n].length; i++) {
        const a = grid2.tilesByDistance[n][i]
        const b = grid3.tilesByDistance[n][i]
        expect(a.X).toBe(b.X)
        expect(a.Y).toBe(b.Y)
      }
    }
  })

  it('no duplicate cells in any group', () => {
    for (const group of grid.tilesByDistance) {
      const seen = new Set<string>()
      for (const cell of group) {
        const key = `${cell.X},${cell.Y}`
        expect(seen.has(key), `duplicate cell ${key}`).toBe(false)
        seen.add(key)
      }
    }
  })

  it('total cell count includes all cells within range', () => {
    let expected = 0
    for (let j = -5; j <= 5; j++) {
      for (let i = -5; i <= 5; i++) {
        if (25 >= i * i + j * j) expected++
      }
    }

    let actual = 0
    for (const group of grid.tilesByDistance) {
      actual += group.length
    }
    expect(actual).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// MapGrid — config overrides
// ---------------------------------------------------------------------------

describe('MapGrid — config overrides', () => {
  it('accepts maximumTerrainHeight override', () => {
    const grid = new MapGrid({ maximumTerrainHeight: 5 })
    expect(grid.maximumTerrainHeight).toBe(5)
  })

  it('accepts enableDepthBuffer override', () => {
    const grid = new MapGrid({ enableDepthBuffer: true })
    expect(grid.enableDepthBuffer).toBe(true)
  })

  it('accepts maximumTileSearchRange override', () => {
    const grid = new MapGrid({ maximumTileSearchRange: 100 })
    expect(grid.maximumTileSearchRange).toBe(100)
  })

  it('empty config produces valid MapGrid', () => {
    const grid = new MapGrid({})
    expect(grid.type).toBe(MapGridType.Rectangular)
    expect(grid.tileScale).toBe(1024)
    expect(grid.ramps.length).toBe(21)
  })

  it('undefined config produces valid MapGrid', () => {
    const grid = new MapGrid()
    expect(grid.type).toBe(MapGridType.Rectangular)
    expect(grid.ramps.length).toBe(21)
  })
})

// ---------------------------------------------------------------------------
// MapGrid — tilesByDistance for isometric
// ---------------------------------------------------------------------------

describe('MapGrid — TilesByDistance with isometric type', () => {
  const grid = new MapGrid({
    type: MapGridType.RectangularIsometric,
    maximumTileSearchRange: 3,
  })

  it('produces same TilesByDistance structure as rectangular', () => {
    // TilesByDistance depends only on maximumTileSearchRange, not grid type
    expect(grid.tilesByDistance.length).toBe(4)
    expect(grid.tilesByDistance[0].length).toBe(1)
  })
})
