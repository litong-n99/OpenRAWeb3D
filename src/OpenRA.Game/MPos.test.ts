/**
 * MPos.test.ts — MPos and PPos migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { MPos, PPos } from './MPos'
import { CPos } from './CPos'
import { MapGridType } from './Map/MapGridType'
import { Rectangle } from './Primitives/Rectangle'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('MPos construction', () => {
  it('stores U, V components', () => {
    const mp = new MPos(10, 20)
    expect(mp.U).toBe(10)
    expect(mp.V).toBe(20)
  })

  it('truncates to int32', () => {
    const mp = new MPos(1.7, -2.3)
    expect(mp.U).toBe(1)
    expect(mp.V).toBe(-2)
  })

  it('has Zero static constant', () => {
    expect(MPos.Zero.U).toBe(0)
    expect(MPos.Zero.V).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Static operators
// ---------------------------------------------------------------------------

describe('MPos static operators', () => {
  it('equals checks component equality', () => {
    const a = new MPos(1, 2)
    const b = new MPos(1, 2)
    expect(MPos.equals(a, b)).toBe(true)
    expect(MPos.equals(a, MPos.Zero)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Clamp
// ---------------------------------------------------------------------------

describe('MPos.clamp', () => {
  const bounds = new Rectangle(0, 0, 100, 100)

  it('position inside bounds is unchanged', () => {
    const mp = new MPos(50, 50)
    const clamped = mp.clamp(bounds)
    expect(clamped.U).toBe(50)
    expect(clamped.V).toBe(50)
  })

  it('position outside left/top is clamped', () => {
    const mp = new MPos(-10, -10)
    const clamped = mp.clamp(bounds)
    expect(clamped.U).toBe(0)
    expect(clamped.V).toBe(0)
  })

  it('position outside right/bottom is clamped', () => {
    const mp = new MPos(200, 200)
    const clamped = mp.clamp(bounds)
    expect(clamped.U).toBe(100)
    expect(clamped.V).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// toCPos — Rectangular grid
// ---------------------------------------------------------------------------

describe('MPos.toCPos Rectangular', () => {
  it('direct (U,V) to (X,Y) mapping', () => {
    const mp = new MPos(5, 10)
    const cp = mp.toCPos(MapGridType.Rectangular)
    expect(cp.X).toBe(5)
    expect(cp.Y).toBe(10)
    expect(cp.Layer).toBe(0)
  })

  it('round-trip CPos → MPos → CPos is lossless', () => {
    const cp = new CPos(100, 200, 0)
    const mp = cp.toMPos(MapGridType.Rectangular)
    const cp2 = mp.toCPos(MapGridType.Rectangular)
    expect(CPos.equals(cp, cp2)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toCPos — RectangularIsometric grid
// ---------------------------------------------------------------------------

describe('MPos.toCPos RectangularIsometric', () => {
  it('round-trip CPos → MPos → CPos is lossless', () => {
    const cp = new CPos(10, 5, 0)
    const mp = cp.toMPos(MapGridType.RectangularIsometric)
    const cp2 = mp.toCPos(MapGridType.RectangularIsometric)
    expect(cp2.X).toBe(cp.X)
    expect(cp2.Y).toBe(cp.Y)
    expect(cp2.Layer).toBe(cp.Layer)
  })

  it('round-trip with negative coordinates', () => {
    const cp = new CPos(-50, -30, 0)
    const mp = cp.toMPos(MapGridType.RectangularIsometric)
    const cp2 = mp.toCPos(MapGridType.RectangularIsometric)
    expect(cp2.X).toBe(cp.X)
    expect(cp2.Y).toBe(cp.Y)
  })

  it('round-trip preserves X and Y (layer is 2D→2D conversion, lost)', () => {
    // NOTE: CPos.toMPos is a 2D conversion; Layer is lost.
    // This matches OpenRA behavior — MPos only stores U,V (no layer).
    const cp = new CPos(10, 5, 3)
    const mp = cp.toMPos(MapGridType.RectangularIsometric)
    const cp2 = mp.toCPos(MapGridType.RectangularIsometric)
    expect(cp2.X).toBe(cp.X)
    expect(cp2.Y).toBe(cp.Y)
    // Layer defaults to 0 since MPos has no Layer
    expect(cp2.Layer).toBe(0)
  })

  it('toCPos.rectangular matches OpenRA formula for zero', () => {
    const mp = new MPos(0, 0)
    const cp = mp.toCPos(MapGridType.RectangularIsometric)
    // For (0,0): v is even, y = (0-0)/2 - 0 = 0, x = 0-0 = 0
    expect(cp.X).toBe(0)
    expect(cp.Y).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('MPos standard methods', () => {
  it('instance equals matches static', () => {
    expect(new MPos(1, 2).equals(new MPos(1, 2))).toBe(true)
    expect(new MPos(1, 2).equals(new MPos(3, 4))).toBe(false)
  })

  it('toString returns U,V', () => {
    expect(new MPos(1, 2).toString()).toBe('1,2')
  })
})

// ===========================================================================
// PPos tests
// ===========================================================================

describe('PPos construction', () => {
  it('stores U, V components', () => {
    const pp = new PPos(10, 20)
    expect(pp.U).toBe(10)
    expect(pp.V).toBe(20)
  })

  it('has Zero static constant', () => {
    expect(PPos.Zero.U).toBe(0)
    expect(PPos.Zero.V).toBe(0)
  })
})

describe('PPos conversions', () => {
  it('fromMPos creates PPos from MPos', () => {
    const mp = new MPos(5, 10)
    const pp = PPos.fromMPos(mp)
    expect(pp.U).toBe(5)
    expect(pp.V).toBe(10)
  })

  it('toMPos creates MPos from PPos', () => {
    const pp = new PPos(5, 10)
    const mp = pp.toMPos()
    expect(mp.U).toBe(5)
    expect(mp.V).toBe(10)
  })

  it('round-trip MPos → PPos → MPos is lossless', () => {
    const mp = new MPos(5, 10)
    const pp = PPos.fromMPos(mp)
    const mp2 = pp.toMPos()
    expect(MPos.equals(mp, mp2)).toBe(true)
  })
})

describe('PPos.clamp', () => {
  it('clamp constrains coordinates to rectangle', () => {
    const bounds = new Rectangle(0, 0, 10, 10)
    const pp = new PPos(20, -5)
    const clamped = pp.clamp(bounds)
    expect(clamped.U).toBe(10)
    expect(clamped.V).toBe(0)
  })
})

describe('PPos standard methods', () => {
  it('equals checks component equality', () => {
    expect(PPos.equals(new PPos(1, 2), new PPos(1, 2))).toBe(true)
    expect(PPos.equals(new PPos(1, 2), PPos.Zero)).toBe(false)
  })

  it('toString returns U,V', () => {
    expect(new PPos(1, 2).toString()).toBe('1,2')
  })
})
