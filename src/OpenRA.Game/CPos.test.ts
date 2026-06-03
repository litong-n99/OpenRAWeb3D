/**
 * CPos.test.ts — CPos migration unit tests
 */

import { describe, it, expect } from 'vitest'
import { CPos } from './CPos'
import { CVec } from './CVec'
import { MPos } from './MPos'
import { MapGridType } from './Map/MapGridType'

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('CPos construction', () => {
  it('packs X, Y, Layer into Bits', () => {
    const cp = new CPos(5, 10, 0)
    expect(cp.X).toBe(5)
    expect(cp.Y).toBe(10)
    expect(cp.Layer).toBe(0)
  })

  it('default Layer is 0', () => {
    const cp = new CPos(5, 10)
    expect(cp.Layer).toBe(0)
  })

  it('has Zero static constant', () => {
    expect(CPos.Zero.X).toBe(0)
    expect(CPos.Zero.Y).toBe(0)
    expect(CPos.Zero.Layer).toBe(0)
    expect(CPos.Zero.Bits).toBe(0)
  })

  it('fromBits reconstructs identical CPos', () => {
    const cp = new CPos(5, 10, 3)
    const reconstructed = CPos.fromBits(cp.Bits)
    expect(reconstructed.X).toBe(5)
    expect(reconstructed.Y).toBe(10)
    expect(reconstructed.Layer).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Bit packing
// ---------------------------------------------------------------------------

describe('CPos bit packing', () => {
  it('positive X/Y are encoded correctly', () => {
    const cp = new CPos(100, 200, 5)
    expect(cp.X).toBe(100)
    expect(cp.Y).toBe(200)
    expect(cp.Layer).toBe(5)
  })

  it('negative X is sign-extended correctly', () => {
    const cp = new CPos(-50, 100, 0)
    expect(cp.X).toBe(-50)
    expect(cp.Y).toBe(100)
  })

  it('negative Y is sign-extended correctly', () => {
    const cp = new CPos(100, -50, 0)
    expect(cp.X).toBe(100)
    expect(cp.Y).toBe(-50)
  })

  it('both negative', () => {
    const cp = new CPos(-100, -200, 0)
    expect(cp.X).toBe(-100)
    expect(cp.Y).toBe(-200)
  })

  it('X boundary values (-2048, 2047)', () => {
    const cpMin = new CPos(-2048, 0, 0)
    const cpMax = new CPos(2047, 0, 0)
    expect(cpMin.X).toBe(-2048)
    expect(cpMax.X).toBe(2047)
  })

  it('Y boundary values (-2048, 2047)', () => {
    const cpMin = new CPos(0, -2048, 0)
    const cpMax = new CPos(0, 2047, 0)
    expect(cpMin.Y).toBe(-2048)
    expect(cpMax.Y).toBe(2047)
  })

  it('Layer max value is 255', () => {
    const cp = new CPos(0, 0, 255)
    expect(cp.Layer).toBe(255)
  })

  it('Layer wraps at 256 (like C# byte cast)', () => {
    const cp = new CPos(0, 0, 256)
    expect(cp.Layer).toBe(0)
  })

  it('X wraps at 12 bits', () => {
    const cp = new CPos(4096, 0, 0) // 4096 = 0x1000 → 0 in low 12 bits
    expect(cp.X).toBe(0)
  })

  it('Y wraps at 12 bits', () => {
    const cp = new CPos(0, 4096, 0)
    expect(cp.Y).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// toMPos — Rectangular grid
// ---------------------------------------------------------------------------

describe('CPos.toMPos Rectangular', () => {
  it('direct (X,Y) to (U,V) mapping', () => {
    const cp = new CPos(5, 10)
    const mp = cp.toMPos(MapGridType.Rectangular)
    expect(mp.U).toBe(5)
    expect(mp.V).toBe(10)
  })

  it('round-trip MPos ↔ CPos is lossless', () => {
    const mp = new MPos(50, 75)
    const cp = mp.toCPos(MapGridType.Rectangular)
    const mp2 = cp.toMPos(MapGridType.Rectangular)
    expect(MPos.equals(mp, mp2)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toMPos — RectangularIsometric grid
// ---------------------------------------------------------------------------

describe('CPos.toMPos RectangularIsometric', () => {
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
})

// ---------------------------------------------------------------------------
// Static operators
// ---------------------------------------------------------------------------

describe('CPos static operators', () => {
  it('add(CPos, CVec) displaces position', () => {
    const cp = new CPos(10, 20, 0)
    const cv = new CVec(5, 3)
    const result = CPos.add(cp, cv)
    expect(result.X).toBe(15)
    expect(result.Y).toBe(23)
    expect(result.Layer).toBe(0)
  })

  it('subtractVec(CPos, CVec) displaces opposite', () => {
    const cp = new CPos(10, 20, 0)
    const cv = new CVec(5, 3)
    const result = CPos.subtractVec(cp, cv)
    expect(result.X).toBe(5)
    expect(result.Y).toBe(17)
  })

  it('subtract(CPos, CPos) returns CVec', () => {
    const a = new CPos(10, 20, 0)
    const b = new CPos(3, 5, 0)
    const result = CPos.subtract(a, b)
    expect(result).toBeInstanceOf(CVec)
    expect(result.X).toBe(7)
    expect(result.Y).toBe(15)
  })

  it('equals checks Bits equality', () => {
    expect(CPos.equals(new CPos(1, 2, 0), new CPos(1, 2, 0))).toBe(true)
    expect(CPos.equals(new CPos(1, 2, 0), CPos.Zero)).toBe(false)
  })

  it('add preserves Layer', () => {
    const cp = new CPos(10, 20, 7)
    const cv = new CVec(1, 2)
    const result = CPos.add(cp, cv)
    expect(result.Layer).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// Standard methods
// ---------------------------------------------------------------------------

describe('CPos standard methods', () => {
  it('instance equals matches static', () => {
    expect(new CPos(1, 2, 0).equals(new CPos(1, 2, 0))).toBe(true)
    expect(new CPos(1, 2, 0).equals(new CPos(3, 4, 0))).toBe(false)
  })

  it('toString for Layer 0 shows X,Y', () => {
    expect(new CPos(5, 10).toString()).toBe('5,10')
  })

  it('toString for non-zero Layer shows X,Y,Layer', () => {
    expect(new CPos(5, 10, 3).toString()).toBe('5,10,3')
  })
})
