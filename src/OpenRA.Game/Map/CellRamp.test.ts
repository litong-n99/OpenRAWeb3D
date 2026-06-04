/**
 * CellRamp.test.ts — CellRamp unit tests
 *
 * Tests focus on:
 * - RampCornerHeight / RampSplit enum values
 * - CellRamp construction for rectangular and isometric grids
 * - Corner geometry (XY positions, Z heights)
 * - Polygon generation for Flat, X, Y split modes
 * - HeightOffset barycentric interpolation at corners and center
 * - centerHeightOffset correctness
 * - Constructor defaults
 */

import { describe, it, expect } from 'vitest'
import {
  CellRamp,
  RampCornerHeight,
  RampSplit,
} from './CellRamp'
import { MapGridType } from './MapGridType'
import { WRot } from '../WRot'

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
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None)

  it('corners are at correct XY with Z=0', () => {
    const [tl, tr, br, bl] = ramp.corners
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

  it('heightOffset at all 4 flat corners = 0', () => {
    // NOTE: For perfectly flat ramp (all Z=0), all corners are in the
    // first triangle (or the interpolation produces 0 regardless since Z=0)
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
    expect(ramp.corners[0].Z).toBe(0)
    expect(ramp.corners[1].Z).toBe(0)
    expect(ramp.corners[3].Z).toBe(0)
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
    expect(ramp.heightOffset(512, 512)).toBe(512)
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
// CellRamp — heightOffset interpolation
// ---------------------------------------------------------------------------

describe('CellRamp — heightOffset interpolation', () => {
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
    tr: RampCornerHeight.Half,
  })

  it('center height is within valid range', () => {
    const center = ramp.heightOffset(0, 0)
    expect(center).toBeGreaterThanOrEqual(0)
    expect(center).toBeLessThanOrEqual(512)
  })

  it('heightOffset at TL and BR corners = 0', () => {
    // NOTE: Flat split uses triangle TL-TR-BR. BL is outside this triangle.
    expect(ramp.heightOffset(-512, -512)).toBe(0) // TL — in triangle
    expect(ramp.heightOffset(512, 512)).toBe(0)   // BR — in triangle
  })

  it('heightOffset at TR corner = 512', () => {
    expect(ramp.heightOffset(512, -512)).toBe(512)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — default constructor options
// ---------------------------------------------------------------------------

describe('CellRamp — default constructor options', () => {
  it('all corners default to Low (Z=0)', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None)
    ramp.corners.forEach((c) => expect(c.Z).toBe(0))
  })

  it('split defaults to Flat (1 polygon)', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None)
    expect(ramp.polygons.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — all corners Full (uniform slope plateau)
// ---------------------------------------------------------------------------

describe('CellRamp — all corners Full (rectangular)', () => {
  const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
    tl: RampCornerHeight.Full,
    tr: RampCornerHeight.Full,
    br: RampCornerHeight.Full,
    bl: RampCornerHeight.Full,
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
// CellRamp — mid-cell heightOffset (non-corner, non-center, known C# values)
// ---------------------------------------------------------------------------

describe('CellRamp — mid-cell heightOffset', () => {
  it('flat tr=Half at (0,-256) mid-top-edge = 128', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tr: RampCornerHeight.Half,
    })
    // Tri TL-TR-BR: u=(p1-p2)x(d-p2)/1024=512, v=(p0-p2)x(d-p2)/1024=256
    // height = (512*0 + 256*512 + 256*0) / 1024 = 128
    expect(ramp.heightOffset(0, -256)).toBe(128)
  })

  it('flat tr=Half at (256,0) mid-right-edge = 128', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tr: RampCornerHeight.Half,
    })
    // Tri TL-TR-BR: u=256, v=256
    // height = (256*0 + 256*512 + 512*0) / 1024 = 128
    expect(ramp.heightOffset(256, 0)).toBe(128)
  })

  it('X split br=Half at (0,256) = 128', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      br: RampCornerHeight.Half,
      split: RampSplit.X,
    })
    // Tri TR-BR-BL: u=256, v=256
    // height = (256*0 + 256*512 + 512*0) / 1024 = 128
    expect(ramp.heightOffset(0, 256)).toBe(128)
  })

  it('Y split bl=Half at (-256,256) = 256', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      bl: RampCornerHeight.Half,
      split: RampSplit.Y,
    })
    // Tri TL-BR-BL: u=256, v=256
    // height = (256*0 + 256*0 + 512*512) / 1024 = 256
    expect(ramp.heightOffset(-256, 256)).toBe(256)
  })

  it('all Full corners at (200,-300) = 1024', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tl: RampCornerHeight.Full,
      tr: RampCornerHeight.Full,
      br: RampCornerHeight.Full,
      bl: RampCornerHeight.Full,
    })
    // Uniform Z=1024 — any point gives 1024
    expect(ramp.heightOffset(200, -300)).toBe(1024)
  })
})

// ---------------------------------------------------------------------------
// CellRamp — opposite corner ramps
// ---------------------------------------------------------------------------

describe('CellRamp — opposite corner ramps (rectangular)', () => {
  it('tr+bl Half Y split puts ridge along TR-BL diagonal', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tr: RampCornerHeight.Half,
      bl: RampCornerHeight.Half,
      split: RampSplit.Y,
    })

    expect(ramp.heightOffset(512, -512)).toBe(512)   // TR
    expect(ramp.heightOffset(-512, 512)).toBe(512)   // BL
    expect(ramp.heightOffset(-512, -512)).toBe(0)    // TL
    expect(ramp.heightOffset(512, 512)).toBe(0)      // BR
    // Center is on TL-BR valley (both endpoints Z=0), height = 0
    expect(ramp.centerHeightOffset).toBe(0)
  })

  it('tl+br Half Y split has correct corner heights', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tl: RampCornerHeight.Half,
      br: RampCornerHeight.Half,
      split: RampSplit.Y,
    })

    expect(ramp.heightOffset(-512, -512)).toBe(512)   // TL
    expect(ramp.heightOffset(512, 512)).toBe(512)     // BR
    expect(ramp.heightOffset(512, -512)).toBe(0)      // TR
    expect(ramp.heightOffset(-512, 512)).toBe(0)      // BL
  })

  it('tr+bl Half X split has correct corner heights', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tr: RampCornerHeight.Half,
      bl: RampCornerHeight.Half,
      split: RampSplit.X,
    })

    expect(ramp.heightOffset(512, -512)).toBe(512)   // TR
    expect(ramp.heightOffset(-512, 512)).toBe(512)   // BL
  })

  it('tl+br Half X split has correct corner heights', () => {
    const ramp = new CellRamp(MapGridType.Rectangular, WRot.None, {
      tl: RampCornerHeight.Half,
      br: RampCornerHeight.Half,
      split: RampSplit.X,
    })

    expect(ramp.heightOffset(-512, -512)).toBe(512)   // TL
    expect(ramp.heightOffset(512, 512)).toBe(512)     // BR
  })
})
