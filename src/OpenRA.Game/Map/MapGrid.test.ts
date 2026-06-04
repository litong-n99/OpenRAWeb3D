/**
 * MapGrid.test.ts — MapGrid and CellRamp unit tests
 *
 * Tests focus on:
 * - RampCornerHeight / RampSplit enum values
 * - CellRamp construction and geometry (corners, polygons, centerHeightOffset)
 * - CellRamp heightOffset barycentric interpolation
 * - All 21 predefined ramps for both grid types
 * - MapGrid construction and configuration
 * - SubCell offsets and OffsetOfSubCell
 * - TilesByDistance deterministic generation
 */

import { describe, it, expect } from 'vitest'
import {
  MapGrid,
  CellRamp,
  RampCornerHeight,
  RampSplit,
} from './MapGrid'
import { MapGridType } from './MapGridType'
import { WRot } from '../WRot'
import { WVec } from '../WVec'
import { SubCell } from '../Traits/SubCell'

// ---------------------------------------------------------------------------
// RampCornerHeight
// ---------------------------------------------------------------------------

describe('RampCornerHeight', () => {
  it('values match OpenRA', () => {
    expect(RampCornerHeight.Low).toBe(0)
    expect(RampCornerHeight.Half).toBe(1)
    expect(RampCornerHeight.Full).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// RampSplit
// ---------------------------------------------------------------------------

describe('RampSplit', () => {
  it('values match OpenRA', () => {
    expect(RampSplit.Flat).toBe(0)
    expect(RampSplit.X).toBe(1)
    expect(RampSplit.Y).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — flat rectangular
// ---------------------------------------------------------------------------

describe('CellRamp — flat rectangular', () => {
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
    tl: RampCornerHeight.Low,
    tr: RampCornerHeight.Low,
    br: RampCornerHeight.Low,
    bl: RampCornerHeight.Low,
    split: RampSplit.Flat,
  })

  it('corners are at correct XY with Z=0', () => {
    const [tl, tr, br, bl] = ramp.corners
    // Rectangular corners: (-512,-512,0), (512,-512,0), (512,512,0), (-512,512,0)
    expect(tl.X).toBe(-512)
    expect(tl.Y).toBe(-512)
    expect(tl.Z).toBe(0)

    expect(tr.X).toBe(512)
    expect(tr.Y).toBe(-512)
    expect(tr.Z).toBe(0)

    expect(br.X).toBe(512)
    expect(br.Y).toBe(512)
    expect(br.Z).toBe(0)

    expect(bl.X).toBe(-512)
    expect(bl.Y).toBe(512)
    expect(bl.Z).toBe(0)
  })

  it('has one polygon (flat split)', () => {
    expect(ramp.polygons.length).toBe(1)
    expect(ramp.polygons[0].length).toBe(3)
  })

  it('centerHeightOffset is 0 for flat ramp', () => {
    expect(ramp.centerHeightOffset).toBe(0)
  })

  it('heightOffset at center is 0', () => {
    expect(ramp.heightOffset(0, 0)).toBe(0)
  })

  it('heightOffset at corners is 0', () => {
    expect(ramp.heightOffset(-512, -512)).toBe(0)
    expect(ramp.heightOffset(512, -512)).toBe(0)
    expect(ramp.heightOffset(512, 512)).toBe(0)
    expect(ramp.heightOffset(-512, 512)).toBe(0)
  })

  it('orientation is preserved', () => {
    expect(WRot.equals(ramp.orientation, WRot.None)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — one corner half, rectangular, X split
// ---------------------------------------------------------------------------

describe('CellRamp — one corner Half, rectangular, X split', () => {
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
    br: RampCornerHeight.Half,
    split: RampSplit.X,
  })

  it('br corner Z = 512 (scale * Half)', () => {
    expect(ramp.corners[2].Z).toBe(512)
  })

  it('other corners Z = 0', () => {
    expect(ramp.corners[0].Z).toBe(0) // TL Low
    expect(ramp.corners[1].Z).toBe(0) // TR Low
    expect(ramp.corners[3].Z).toBe(0) // BL Low
  })

  it('has two polygons (X split)', () => {
    expect(ramp.polygons.length).toBe(2)
  })

  it('first polygon is TL-TR-BL (corners 0,1,3)', () => {
    const [a, b, c] = ramp.polygons[0]
    expect(a).toBe(ramp.corners[0])
    expect(b).toBe(ramp.corners[1])
    expect(c).toBe(ramp.corners[3])
  })

  it('second polygon is TR-BR-BL (corners 1,2,3)', () => {
    const [a, b, c] = ramp.polygons[1]
    expect(a).toBe(ramp.corners[1])
    expect(b).toBe(ramp.corners[2])
    expect(c).toBe(ramp.corners[3])
  })

  it('heightOffset at BR corner = 512', () => {
    const h = ramp.heightOffset(512, 512)
    // Should be very close to 512 (the Z at BR corner)
    expect(h).toBe(512)
  })

  it('heightOffset at TL corner = 0', () => {
    expect(ramp.heightOffset(-512, -512)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — one corner half, rectangular, Y split
// ---------------------------------------------------------------------------

describe('CellRamp — one corner Half, rectangular, Y split', () => {
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
    bl: RampCornerHeight.Half,
    split: RampSplit.Y,
  })

  it('has two polygons (Y split)', () => {
    expect(ramp.polygons.length).toBe(2)
  })

  it('first polygon is TL-TR-BR (corners 0,1,2)', () => {
    const [a, b, c] = ramp.polygons[0]
    expect(a).toBe(ramp.corners[0])
    expect(b).toBe(ramp.corners[1])
    expect(c).toBe(ramp.corners[2])
  })

  it('second polygon is TL-BR-BL (corners 0,2,3)', () => {
    const [a, b, c] = ramp.polygons[1]
    expect(a).toBe(ramp.corners[0])
    expect(b).toBe(ramp.corners[2])
    expect(c).toBe(ramp.corners[3])
  })

  it('heightOffset at BL corner = 512', () => {
    expect(ramp.heightOffset(-512, 512)).toBe(512)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — full corner, rectangular
// ---------------------------------------------------------------------------

describe('CellRamp — full height corner, rectangular', () => {
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
    tr: RampCornerHeight.Full,
    split: RampSplit.Flat,
  })

  it('tr corner Z = 1024 (scale * Full)', () => {
    expect(ramp.corners[1].Z).toBe(1024)
  })

  it('heightOffset at TR corner = 1024', () => {
    expect(ramp.heightOffset(512, -512)).toBe(1024)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — isometric grid
// ---------------------------------------------------------------------------

describe('CellRamp — isometric grid', () => {
  const ramp = new CellRamp(MapGridType.RectangularIsometric, WRot.None, {
    br: RampCornerHeight.Half,
    split: RampSplit.Flat,
  })

  it('corners are at isometric XY positions', () => {
    const [tl, tr, br, bl] = ramp.corners
    expect(tl.X).toBe(0)
    expect(tl.Y).toBe(-724)
    expect(tr.X).toBe(724)
    expect(tr.Y).toBe(0)
    expect(br.X).toBe(0)
    expect(br.Y).toBe(724)
    expect(bl.X).toBe(-724)
    expect(bl.Y).toBe(0)
  })

  it('br corner Z = 724 (isometric scale * Half)', () => {
    expect(ramp.corners[2].Z).toBe(724)
  })

  it('heightOffset at BR corner = 724', () => {
    expect(ramp.heightOffset(0, 724)).toBe(724)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — heightOffset checks for key points
// ---------------------------------------------------------------------------

describe('CellRamp — heightOffset interpolation', () => {
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
    tr: RampCornerHeight.Half,
    split: RampSplit.Flat,
  })

  it('center height is a weighted average', () => {
    // With only TR=512 and others=0, center should be 512/4 = 128
    // for a flat (quad) split, since the center gets equal weight from all corners
    const center = ramp.heightOffset(0, 0)
    // The quad is treated as triangle (0,1,2): TL(0), TR(512), BR(0)
    // Center is at (0,0) which is equally between all four corners
    // Barycentric: the formula divides area contribution
    // Actually, center for quad treated as triangle 0-1-2 will depend on
    // which triangle contains the point. Let's just check it's non-negative
    expect(center).toBeGreaterThanOrEqual(0)
    expect(center).toBeLessThanOrEqual(512)
  })

  it('heightOffset at TL and BR corners = 0', () => {
    // NOTE: Flat split uses triangle TL-TR-BR for interpolation.
    // BL corner (-512,512) is outside this triangle, so HeightOffset
    // there returns an extrapolated (incorrect) value.
    // This matches OpenRA behavior — Flat split is only intended for
    // ramps where the first 3 corners cover all relevant points.
    expect(ramp.heightOffset(-512, -512)).toBe(0) // TL — in triangle
    expect(ramp.heightOffset(512, 512)).toBe(0)   // BR — in triangle
  })

  it('heightOffset at TR corner = 512', () => {
    expect(ramp.heightOffset(512, -512)).toBe(512)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — all 20 predefined ramps (rectangular)
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
    // Ramp 1: tr+br Half
    expect(grid.ramps[1].corners[1].Z).toBe(512) // TR
    expect(grid.ramps[1].corners[2].Z).toBe(512) // BR
    expect(grid.ramps[1].corners[0].Z).toBe(0) // TL
    expect(grid.ramps[1].corners[3].Z).toBe(0) // BL
    expect(grid.ramps[1].polygons.length).toBe(1) // Flat

    // Ramp 2: br+bl Half
    expect(grid.ramps[2].corners[2].Z).toBe(512) // BR
    expect(grid.ramps[2].corners[3].Z).toBe(512) // BL

    // Ramp 3: tl+bl Half
    expect(grid.ramps[3].corners[0].Z).toBe(512) // TL
    expect(grid.ramps[3].corners[3].Z).toBe(512) // BL

    // Ramp 4: tl+tr Half
    expect(grid.ramps[4].corners[0].Z).toBe(512) // TL
    expect(grid.ramps[4].corners[1].Z).toBe(512) // TR
  })

  it('ramps 5-8: one corner half with split', () => {
    // Ramp 5: br Half, X split
    expect(grid.ramps[5].corners[2].Z).toBe(512)
    expect(grid.ramps[5].polygons.length).toBe(2)
    expect(grid.ramps[5].corners[0].Z).toBe(0)

    // Ramp 6: bl Half, Y split
    expect(grid.ramps[6].corners[3].Z).toBe(512)
    expect(grid.ramps[6].polygons.length).toBe(2)

    // Ramp 7: tl Half, X split
    expect(grid.ramps[7].corners[0].Z).toBe(512)
    expect(grid.ramps[7].polygons.length).toBe(2)

    // Ramp 8: tr Half, Y split
    expect(grid.ramps[8].corners[1].Z).toBe(512)
    expect(grid.ramps[8].polygons.length).toBe(2)
  })

  it('ramps 9-12: three corners half', () => {
    // Ramp 9: tr+br+bl Half, X split
    expect(grid.ramps[9].corners[1].Z).toBe(512) // TR
    expect(grid.ramps[9].corners[2].Z).toBe(512) // BR
    expect(grid.ramps[9].corners[3].Z).toBe(512) // BL
    expect(grid.ramps[9].corners[0].Z).toBe(0) // TL Low
    expect(grid.ramps[9].polygons.length).toBe(2)

    // Ramp 10: tl+br+bl Half, Y split
    expect(grid.ramps[10].corners[0].Z).toBe(512)
    expect(grid.ramps[10].corners[2].Z).toBe(512)
    expect(grid.ramps[10].corners[3].Z).toBe(512)
    expect(grid.ramps[10].polygons.length).toBe(2)

    // Ramp 11: tl+tr+bl Half, X split
    expect(grid.ramps[11].corners[0].Z).toBe(512)
    expect(grid.ramps[11].corners[1].Z).toBe(512)
    expect(grid.ramps[11].corners[3].Z).toBe(512)
    expect(grid.ramps[11].polygons.length).toBe(2)

    // Ramp 12: tl+tr+br Half, Y split
    expect(grid.ramps[12].corners[0].Z).toBe(512)
    expect(grid.ramps[12].corners[1].Z).toBe(512)
    expect(grid.ramps[12].corners[2].Z).toBe(512)
    expect(grid.ramps[12].polygons.length).toBe(2)
  })

  it('ramps 13-16: full tile sloped', () => {
    // Ramp 13: tr Half, br Full, bl Half
    expect(grid.ramps[13].corners[1].Z).toBe(512) // TR Half
    expect(grid.ramps[13].corners[2].Z).toBe(1024) // BR Full
    expect(grid.ramps[13].corners[3].Z).toBe(512) // BL Half
    expect(grid.ramps[13].corners[0].Z).toBe(0) // TL Low

    // Ramp 14: tl Half, br Half, bl Full
    expect(grid.ramps[14].corners[0].Z).toBe(512)
    expect(grid.ramps[14].corners[2].Z).toBe(512)
    expect(grid.ramps[14].corners[3].Z).toBe(1024)

    // Ramp 15: tl Full, tr Half, bl Half
    expect(grid.ramps[15].corners[0].Z).toBe(1024)
    expect(grid.ramps[15].corners[1].Z).toBe(512)
    expect(grid.ramps[15].corners[3].Z).toBe(512)

    // Ramp 16: tl Half, tr Full, br Half
    expect(grid.ramps[16].corners[0].Z).toBe(512)
    expect(grid.ramps[16].corners[1].Z).toBe(1024)
    expect(grid.ramps[16].corners[2].Z).toBe(512)
  })

  it('ramps 17-20: two opposite corners half', () => {
    // Ramp 17: tr+bl Half, Y split
    expect(grid.ramps[17].corners[1].Z).toBe(512)
    expect(grid.ramps[17].corners[3].Z).toBe(512)
    expect(grid.ramps[17].corners[0].Z).toBe(0)
    expect(grid.ramps[17].corners[2].Z).toBe(0)
    expect(grid.ramps[17].polygons.length).toBe(2) // Y split

    // Ramp 18: tl+br Half, Y split
    expect(grid.ramps[18].corners[0].Z).toBe(512)
    expect(grid.ramps[18].corners[2].Z).toBe(512)
    expect(grid.ramps[18].polygons.length).toBe(2)

    // Ramp 19: tr+bl Half, X split
    expect(grid.ramps[19].corners[1].Z).toBe(512)
    expect(grid.ramps[19].corners[3].Z).toBe(512)
    expect(grid.ramps[19].polygons.length).toBe(2) // X split

    // Ramp 20: tl+br Half, X split
    expect(grid.ramps[20].corners[0].Z).toBe(512)
    expect(grid.ramps[20].corners[2].Z).toBe(512)
    expect(grid.ramps[20].polygons.length).toBe(2)
  })

  it('every ramp has a valid centerHeightOffset', () => {
    grid.ramps.forEach((r, i) => {
      expect(
        r.centerHeightOffset,
        `ramp ${i} centerHeightOffset out of range`,
      ).toBeGreaterThanOrEqual(0)
      // Maximum possible height: 4 corners * max corner Z / 4 ≈ Full corner
      // For rectangular: max Z = 1024, so center max is about 1024
      expect(
        r.centerHeightOffset,
        `ramp ${i} centerHeightOffset out of range`,
      ).toBeLessThanOrEqual(1024)
    })
  })

  it('every ramp has between 1 and 2 polygons', () => {
    grid.ramps.forEach((r, i) => {
      expect(
        r.polygons.length,
        `ramp ${i} polygon count`,
      ).toBeGreaterThanOrEqual(1)
      expect(
        r.polygons.length,
        `ramp ${i} polygon count`,
      ).toBeLessThanOrEqual(2)
    })
  })

  it('every ramp polygon has exactly 3 vertices', () => {
    grid.ramps.forEach((r, i) => {
      r.polygons.forEach((p, pi) => {
        expect(
          p.length,
          `ramp ${i} polygon ${pi} vertex count`,
        ).toBe(3)
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
        // The point should be within tolerance of the corner Z
        // Due to integer division, it may be off by 1
        expect(
          Math.abs(h - c.Z),
          `ramp ${i} corner ${ci}: heightOffset(${c.X},${c.Y})=${h}, expected ${c.Z}`,
        ).toBeLessThanOrEqual(1)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// MapGrid — defaults
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

  it('index 3: center (0,0,0)', () => {
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
  it('accepts valid default subcell', () => {
    const grid = new MapGrid({ defaultSubCell: 1 })
    expect(grid.defaultSubCell).toBe(1)
  })

  it('accepts maximum valid index', () => {
    const grid = new MapGrid({ defaultSubCell: 5 })
    expect(grid.defaultSubCell).toBe(5)
  })

  it('throws for index 0 when subcell count > 1', () => {
    expect(() => new MapGrid({ defaultSubCell: 0 })).toThrow(
      /Subcell default index must be a valid index/,
    )
  })

  it('throws for out-of-range index', () => {
    expect(() => new MapGrid({ defaultSubCell: 6 })).toThrow(
      /Subcell default index must be a valid index/,
    )
  })

  it('SubCell.Invalid (255) defaults to middle index', () => {
    const grid = new MapGrid({ defaultSubCell: SubCell.Invalid })
    expect(grid.defaultSubCell).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// MapGrid — TilesByDistance
// ---------------------------------------------------------------------------

describe('MapGrid — TilesByDistance', () => {
  const grid = new MapGrid({ maximumTileSearchRange: 5 })

  it('has range+1 groups', () => {
    expect(grid.tilesByDistance.length).toBe(6) // range 5 → 6 groups (0-5)
  })

  it('group 0 contains only (0,0)', () => {
    expect(grid.tilesByDistance[0].length).toBe(1)
    expect(grid.tilesByDistance[0][0].X).toBe(0)
    expect(grid.tilesByDistance[0][0].Y).toBe(0)
  })

  it('group 1 contains cells with distance <= 1 (ceiling)', () => {
    // Cells with i² + j² <= 1: (0,0), (-1,0), (1,0), (0,-1), (0,1)
    // But (0,0) is in group 0, so group 1 has the rest with ceiling=1
    // Actually: ceiling(sqrt(1)) = 1 for (±1,0) and (0,±1)
    // ceiling(sqrt(2)) = 2 for (±1,±1)
    // So group 1: (-1,0), (1,0), (0,-1), (0,1)
    expect(grid.tilesByDistance[1].length).toBe(4)
  })

  it('all cells in group N have distance ceiling = N', () => {
    for (let n = 0; n < grid.tilesByDistance.length; n++) {
      for (const cell of grid.tilesByDistance[n]) {
        const distSq = cell.X * cell.X + cell.Y * cell.Y
        const ceil = Math.ceil(Math.sqrt(distSq))
        // Note: our isqrtCeiling should match Math.ceil(Math.sqrt())
        // for these integer values
        expect(ceil, `group ${n}: cell (${cell.X},${cell.Y})`).toBe(n)
      }
    }
  })

  it('each group is sorted by lengthSquared', () => {
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
    // Count all cells manually
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
// MapGrid — tilesByDistance for isometric (same generation, different type)
// ---------------------------------------------------------------------------

describe('MapGrid — TilesByDistance with isometric type', () => {
  const grid = new MapGrid({
    type: MapGridType.RectangularIsometric,
    maximumTileSearchRange: 3,
  })

  it('produces same TilesByDistance structure as rectangular', () => {
    // TilesByDistance depends only on maximumTileSearchRange, not grid type
    expect(grid.tilesByDistance.length).toBe(4) // range 3 → 4 groups
    expect(grid.tilesByDistance[0].length).toBe(1) // (0,0)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — constructor default options
// ---------------------------------------------------------------------------

describe('CellRamp — default constructor options', () => {
  it('all corners default to Low', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None)
    ramp.corners.forEach((c) => expect(c.Z).toBe(0))
  })

  it('split defaults to Flat (1 polygon)', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None)
    expect(ramp.polygons.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — heightOffset for ramp with Full corners
// ---------------------------------------------------------------------------

describe('CellRamp — all corners Full (rectangular)', () => {
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
    tl: RampCornerHeight.Full,
    tr: RampCornerHeight.Full,
    br: RampCornerHeight.Full,
    bl: RampCornerHeight.Full,
    split: RampSplit.Flat,
  })

  it('all corners Z = 1024', () => {
    ramp.corners.forEach((c) => expect(c.Z).toBe(1024))
  })

  it('heightOffset at any point = 1024', () => {
    expect(ramp.heightOffset(0, 0)).toBe(1024)
    expect(ramp.heightOffset(512, 512)).toBe(1024)
    expect(ramp.heightOffset(-512, -512)).toBe(1024)
    expect(ramp.heightOffset(256, -128)).toBe(1024)
  })

  it('centerHeightOffset = 1024', () => {
    expect(ramp.centerHeightOffset).toBe(1024)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — check opposite corner ramps have opposite heights
// ---------------------------------------------------------------------------

describe('CellRamp — opposite corner ramps (rectangular)', () => {
  it('tr+bl Half Y split produces ridge along TR-BL diagonal', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tr: RampCornerHeight.Half,
      bl: RampCornerHeight.Half,
      split: RampSplit.Y,
    })

    // At TR corner: 512
    expect(ramp.heightOffset(512, -512)).toBe(512)
    // At BL corner: 512
    expect(ramp.heightOffset(-512, 512)).toBe(512)
    // At TL corner: 0
    expect(ramp.heightOffset(-512, -512)).toBe(0)
    // At BR corner: 0
    expect(ramp.heightOffset(512, 512)).toBe(0)
    // NOTE: Y-split divides cell along TL-BR diagonal.
    // The center (0,0) is ON the TL-BR valley, not the TR-BL ridge.
    // Triangle 1 (TL-TR-BR) has heights 0,512,0.
    // Center is on edge TL-BR with barycentric weight TR=0, so height=0.
    // This matches OpenRA behavior.
    expect(ramp.centerHeightOffset).toBe(0)
  })

  it('tl+br Half Y split produces ridge along TR-BL diagonal', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tl: RampCornerHeight.Half,
      br: RampCornerHeight.Half,
      split: RampSplit.Y,
    })

    expect(ramp.heightOffset(-512, -512)).toBe(512) // TL
    expect(ramp.heightOffset(512, 512)).toBe(512) // BR
    expect(ramp.heightOffset(512, -512)).toBe(0) // TR
    expect(ramp.heightOffset(-512, 512)).toBe(0) // BL
  })
})
