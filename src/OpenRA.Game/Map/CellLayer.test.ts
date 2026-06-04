/**
 * CellLayer.test.ts — CellLayer unit tests
 *
 * Tests focus on: CPos/MPos get/set, index formula correctness (both grid types),
 * observer notification pattern, contains/clamp, TryGetValue edge cases,
 * CopyValuesFrom/Clear observer guards, CellRegion property, and static Resize.
 *
 * Index formulas from OpenRA MUST match exactly:
 *   Rectangular: index = Y * Width + X
 *   Isometric:   u = (X - Y) / 2, v = X + Y, index = V * Width + U
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CellLayer } from './CellLayer'
import { MapGridType } from './MapGridType'
import { CPos } from '../CPos'
import { MPos } from '../MPos'
import type { Size } from './CellLayerBase'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CellLayer', () => {
  describe('construction', () => {
    it('creates layer with correct size', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 10,
        height: 8,
      })
      expect(layer.Size.width).toBe(10)
      expect(layer.Size.height).toBe(8)
    })

    it('stores grid type', () => {
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 5,
        height: 5,
      })
      expect(layer.GridType).toBe(MapGridType.RectangularIsometric)
    })
  })

  // -----------------------------------------------------------------------
  // Index formula correctness — Rectangular
  // -----------------------------------------------------------------------

  describe('get/set CPos (Rectangular)', () => {
    const size: Size = { width: 5, height: 5 }
    let layer: CellLayer<number>

    beforeEach(() => {
      layer = new CellLayer<number>(MapGridType.Rectangular, size)
    })

    it('get returns undefined for unset cell', () => {
      expect(layer.get(new CPos(0, 0))).toBeUndefined()
    })

    it('set and get round-trip correctly', () => {
      layer.set(new CPos(2, 3), 42)
      expect(layer.get(new CPos(2, 3))).toBe(42)
    })

    it('uses flat V-major layout (index = Y*Width + X)', () => {
      layer.set(new CPos(0, 0), 0)
      layer.set(new CPos(4, 0), 4)
      layer.set(new CPos(0, 1), 5)
      layer.set(new CPos(4, 4), 24)

      // Verify via raw memory
      const mem = layer.asMemory()
      expect(mem[0]).toBe(0) // (0,0) → 0*5+0 = 0
      expect(mem[4]).toBe(4) // (4,0) → 0*5+4 = 4
      expect(mem[5]).toBe(5) // (0,1) → 1*5+0 = 5
      expect(mem[24]).toBe(24) // (4,4) → 4*5+4 = 24
    })

    it('set on one cell does not affect others', () => {
      layer.set(new CPos(1, 1), 100)
      expect(layer.get(new CPos(1, 1))).toBe(100)
      expect(layer.get(new CPos(0, 0))).toBeUndefined()
      expect(layer.get(new CPos(2, 2))).toBeUndefined()
    })

    it('throws RangeError for out-of-bounds CPos', () => {
      expect(() => layer.get(new CPos(5, 0))).toThrow(RangeError)
      expect(() => layer.get(new CPos(0, 5))).toThrow(RangeError)
      expect(() => layer.set(new CPos(10, 10), 1)).toThrow(RangeError)
    })
  })

  describe('get/set MPos (Rectangular)', () => {
    const size: Size = { width: 5, height: 5 }
    let layer: CellLayer<number>

    beforeEach(() => {
      layer = new CellLayer<number>(MapGridType.Rectangular, size)
    })

    it('getMPos returns value at MPos', () => {
      layer.set(new CPos(2, 3), 42)
      // Rectangular: CPos(2,3) == MPos(2,3)
      expect(layer.getMPos(new MPos(2, 3))).toBe(42)
    })

    it('setMPos writes value at MPos', () => {
      layer.setMPos(new MPos(3, 1), 77)
      expect(layer.get(new CPos(3, 1))).toBe(77)
    })

    it('setMPos throws for out-of-bounds MPos', () => {
      expect(() => layer.setMPos(new MPos(5, 0), 1)).toThrow(RangeError)
    })

    it('setMPos notifies observers with CPos (converted from MPos)', () => {
      const callback = vi.fn()
      layer.onCellEntryChanged(callback)

      layer.setMPos(new MPos(2, 3), 99)

      expect(callback).toHaveBeenCalledTimes(1)
      const notifiedCell = callback.mock.calls[0][0] as CPos
      // Rectangular: MPos(2,3) → CPos(2,3)
      expect(notifiedCell.X).toBe(2)
      expect(notifiedCell.Y).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // Index formula correctness — RectangularIsometric
  // -----------------------------------------------------------------------

  describe('get/set CPos (RectangularIsometric)', () => {
    const size: Size = { width: 7, height: 7 }
    let layer: CellLayer<number>

    beforeEach(() => {
      layer = new CellLayer<number>(MapGridType.RectangularIsometric, size)
    })

    it('get/set round-trip for CPos(0,0)', () => {
      layer.set(new CPos(0, 0), 1)
      expect(layer.get(new CPos(0, 0))).toBe(1)
    })

    it('index formula: CPos(0,0) → index 0', () => {
      layer.set(new CPos(0, 0), 1)
      const mem = layer.asMemory()
      expect(mem[0]).toBe(1)
      // u = (0-0)/2 = 0, v = 0+0 = 0, index = 0*7+0 = 0
    })

    it('index formula: CPos(1,0) → correct index', () => {
      layer.set(new CPos(1, 0), 5)
      const mem = layer.asMemory()
      // u = (1-0)/2 = 0, v = 1+0 = 1, index = 1*7+0 = 7
      expect(mem[7]).toBe(5)
    })

    it('index formula: CPos(0,1) → correct index', () => {
      layer.set(new CPos(0, 1), 5)
      const mem = layer.asMemory()
      // u = (0-1)/2 = 0 (truncates toward zero), v = 0+1 = 1, index = 1*7+0 = 7
      expect(mem[7]).toBe(5)
    })

    it('index formula: CPos(2,0) → correct index', () => {
      layer.set(new CPos(2, 0), 3)
      const mem = layer.asMemory()
      // u = (2-0)/2 = 1, v = 2+0 = 2, index = 2*7+1 = 15
      expect(mem[15]).toBe(3)
    })

    it('index formula: CPos(1,1) → correct index', () => {
      layer.set(new CPos(1, 1), 7)
      const mem = layer.asMemory()
      // u = (1-1)/2 = 0, v = 1+1 = 2, index = 2*7+0 = 14
      expect(mem[14]).toBe(7)
    })

    it('index formula: CPos(3,1) → correct index', () => {
      layer.set(new CPos(3, 1), 9)
      const mem = layer.asMemory()
      // u = (3-1)/2 = 1, v = 3+1 = 4, index = 4*7+1 = 29
      expect(mem[29]).toBe(9)
    })

    it('throws RangeError for out-of-bounds CPos (X far exceeds map)', () => {
      expect(() => layer.get(new CPos(10, 0))).toThrow(RangeError)
    })

    it('throws RangeError for out-of-bounds CPos (X < Y by large margin)', () => {
      // CPos(0, 5): u=(0-5)/2=-2, v=5, Bounds.contains(-2,5) fails
      expect(() => layer.get(new CPos(0, 5))).toThrow(RangeError)
    })
  })

  // -----------------------------------------------------------------------
  // Observer pattern
  // -----------------------------------------------------------------------

  describe('observer notification (CellEntryChanged)', () => {
    it('notifies observer on CPos set', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const callback = vi.fn()
      layer.onCellEntryChanged(callback)

      layer.set(new CPos(2, 3), 42)

      expect(callback).toHaveBeenCalledTimes(1)
      const notifiedCell = callback.mock.calls[0][0] as CPos
      expect(notifiedCell.X).toBe(2)
      expect(notifiedCell.Y).toBe(3)
    })

    it('notifies on MPos set (converts to CPos for callback)', () => {
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 7,
        height: 7,
      })
      const callback = vi.fn()
      layer.onCellEntryChanged(callback)

      // MPos(0,1) -> CPos depends on grid type
      layer.setMPos(new MPos(0, 1), 99)

      expect(callback).toHaveBeenCalledTimes(1)
      const notifiedCell = callback.mock.calls[0][0] as CPos
      // MPos(0,1) toCPos(RectangularIsometric):
      // v=1, y=(1 - 0)/2 - 0 = 0, x=1-0=1, CPos(1,0)
      expect(notifiedCell.X).toBe(1)
      expect(notifiedCell.Y).toBe(0)
    })

    it('notifies multiple observers', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      layer.onCellEntryChanged(cb1)
      layer.onCellEntryChanged(cb2)

      layer.set(new CPos(1, 1), 7)

      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).toHaveBeenCalledTimes(1)
    })

    it('does not notify after observer is removed', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const callback = vi.fn()
      layer.onCellEntryChanged(callback)
      layer.offCellEntryChanged(callback)

      layer.set(new CPos(1, 1), 7)

      expect(callback).not.toHaveBeenCalled()
    })

    it('does not notify on get (read-only)', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const callback = vi.fn()
      layer.onCellEntryChanged(callback)

      layer.get(new CPos(2, 3))

      expect(callback).not.toHaveBeenCalled()
    })

    it('does not notify on getMPos', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const callback = vi.fn()
      layer.onCellEntryChanged(callback)

      layer.getMPos(new MPos(2, 3))

      expect(callback).not.toHaveBeenCalled()
    })

    it('offCellEntryChanged does nothing for unregistered callback', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const cb = vi.fn()
      // Not registered — should not throw
      expect(() => layer.offCellEntryChanged(cb)).not.toThrow()
    })

    it('setting same value still notifies', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const callback = vi.fn()
      layer.onCellEntryChanged(callback)

      layer.set(new CPos(2, 3), 42)
      layer.set(new CPos(2, 3), 42) // same value

      expect(callback).toHaveBeenCalledTimes(2) // OpenRA fires every set
    })
  })

  // -----------------------------------------------------------------------
  // CopyValuesFrom / Clear observer guards
  // -----------------------------------------------------------------------

  describe('copyValuesFrom observer guard', () => {
    it('blocks copy when observers are attached', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 3,
        height: 3,
      })
      const src = new CellLayer<number>(MapGridType.Rectangular, {
        width: 3,
        height: 3,
      })
      layer.onCellEntryChanged(() => {})

      expect(() => layer.copyValuesFrom(src)).toThrow(
        'Cannot copy values when there are listeners attached',
      )
    })

    it('allows copy when no observers', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 2,
        height: 2,
      })
      const src = new CellLayer<number>(MapGridType.Rectangular, {
        width: 2,
        height: 2,
      })
      src.clear(5)

      expect(() => layer.copyValuesFrom(src)).not.toThrow()
      expect(layer.get(new CPos(0, 0))).toBe(5)
    })
  })

  describe('clear observer guard', () => {
    it('blocks clear when observers are attached', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 3,
        height: 3,
      })
      layer.onCellEntryChanged(() => {})

      expect(() => layer.clear()).toThrow(
        'Cannot clear values when there are listeners attached',
      )
    })

    it('blocks clear(value) when observers are attached', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 3,
        height: 3,
      })
      layer.onCellEntryChanged(() => {})

      expect(() => layer.clear(0)).toThrow(
        'Cannot clear values when there are listeners attached',
      )
    })

    it('allows clear after removing all observers', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 3,
        height: 3,
      })
      const cb = () => {}
      layer.onCellEntryChanged(cb)
      layer.offCellEntryChanged(cb)

      expect(() => layer.clear()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // TryGetValue
  // -----------------------------------------------------------------------

  describe('tryGetValue', () => {
    it('returns value for valid cell', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      layer.set(new CPos(2, 3), 42)
      expect(layer.tryGetValue(new CPos(2, 3))).toBe(42)
    })

    it('returns null for out-of-bounds cell', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      expect(layer.tryGetValue(new CPos(10, 10))).toBeNull()
    })

    it('returns null for isometric cell with X < Y', () => {
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 7,
        height: 7,
      })
      // X < Y is invalid for RectangularIsometric
      expect(layer.tryGetValue(new CPos(1, 3))).toBeNull()
    })

    it('returns value for isometric cell with X == Y (boundary)', () => {
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 7,
        height: 7,
      })
      layer.set(new CPos(2, 2), 88)
      // X==Y is valid (reviewer pre-audit finding)
      expect(layer.tryGetValue(new CPos(2, 2))).toBe(88)
    })

    it('returns value for isometric cell with X > Y', () => {
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 7,
        height: 7,
      })
      layer.set(new CPos(3, 1), 77)
      expect(layer.tryGetValue(new CPos(3, 1))).toBe(77)
    })
  })

  // -----------------------------------------------------------------------
  // Contains
  // -----------------------------------------------------------------------

  describe('contains (CPos)', () => {
    it('returns true for valid cell', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      expect(layer.contains(new CPos(2, 3))).toBe(true)
    })

    it('returns true for boundary CPos(0,0)', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      expect(layer.contains(new CPos(0, 0))).toBe(true)
    })

    it('returns true for boundary CPos(width-1, height-1)', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      expect(layer.contains(new CPos(4, 4))).toBe(true)
    })

    it('returns false for out-of-bounds cell', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      expect(layer.contains(new CPos(5, 0))).toBe(false)
    })

    it('returns false for isometric X < Y', () => {
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 7,
        height: 7,
      })
      expect(layer.contains(new CPos(1, 3))).toBe(false)
    })

    it('returns true for isometric X == Y (boundary)', () => {
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 7,
        height: 7,
      })
      expect(layer.contains(new CPos(2, 2))).toBe(true)
    })
  })

  describe('contains (MPos)', () => {
    it('returns true for valid MPos', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      expect(layer.contains(new MPos(2, 3))).toBe(true)
    })

    it('returns false for out-of-bounds MPos', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      expect(layer.contains(new MPos(5, 5))).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Clamp
  // -----------------------------------------------------------------------

  describe('clamp (CPos)', () => {
    it('returns same cell if in bounds', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const cell = new CPos(2, 3)
      const clamped = layer.clamp(cell)
      // Rectangular: direct mapping, should be the same
      expect(clamped.X).toBe(2)
      expect(clamped.Y).toBe(3)
    })

    it('clamps to bounds if out of bounds', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const clamped = layer.clamp(new CPos(10, 10))
      expect(clamped.X).toBe(4)
      expect(clamped.Y).toBe(4)
    })

    it('clamps negative coordinates to 0', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const clamped = layer.clamp(new CPos(-5, -5))
      expect(clamped.X).toBe(0)
      expect(clamped.Y).toBe(0)
    })
  })

  describe('clampMPos', () => {
    it('returns same MPos if in bounds', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const uv = new MPos(2, 3)
      const clamped = layer.clampMPos(uv)
      expect(clamped.U).toBe(2)
      expect(clamped.V).toBe(3)
    })

    it('clamps out-of-bounds MPos', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      const clamped = layer.clampMPos(new MPos(10, 10))
      expect(clamped.U).toBe(4)
      expect(clamped.V).toBe(4)
    })
  })

  // -----------------------------------------------------------------------
  // CellRegion property
  // -----------------------------------------------------------------------

  describe('layerCellRegion', () => {
    it('returns region spanning full layer', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 10,
        height: 8,
      })
      const region = layer.layerCellRegion
      // MPos(0,0) → CPos(0,0) for Rectangular
      expect(region.TopLeft.X).toBe(0)
      expect(region.TopLeft.Y).toBe(0)
      // MPos(9,7) → CPos(9,7) for Rectangular
      expect(region.BottomRight.X).toBe(9)
      expect(region.BottomRight.Y).toBe(7)
    })

    it('region iteration covers all cells', () => {
      const layer = new CellLayer<number>(MapGridType.Rectangular, {
        width: 3,
        height: 2,
      })
      const region = layer.layerCellRegion
      const cells = [...region]
      expect(cells.length).toBe(6)
    })
  })

  // -----------------------------------------------------------------------
  // Static: CellLayer.resize
  // -----------------------------------------------------------------------

  describe('resize (static)', () => {
    it('creates smaller layer with overlapping values preserved', () => {
      const original = new CellLayer<number>(MapGridType.Rectangular, {
        width: 5,
        height: 5,
      })
      // Fill original with known values
      for (let j = 0; j < 5; j++) {
        for (let i = 0; i < 5; i++) {
          original.set(new CPos(i, j), j * 5 + i)
        }
      }

      const resized = CellLayer.resize(original, { width: 3, height: 3 }, -1)

      // Overlapping cells should have original values
      expect(resized.get(new CPos(0, 0))).toBe(0)
      expect(resized.get(new CPos(2, 2))).toBe(12) // 2*5+2=12
      // New cells (beyond original) should have default
      // All cells within 3x3 should be set
      expect(resized.get(new CPos(2, 2))).not.toBe(-1)
    })

    it('creates larger layer with new cells set to default', () => {
      const original = new CellLayer<number>(MapGridType.Rectangular, {
        width: 2,
        height: 2,
      })
      original.clear(1)

      const resized = CellLayer.resize(original, { width: 4, height: 4 }, 0)

      // Original cells preserved
      expect(resized.get(new CPos(0, 0))).toBe(1)
      expect(resized.get(new CPos(1, 1))).toBe(1)
      // New cells have default
      expect(resized.get(new CPos(3, 3))).toBe(0)
    })

    it('preserves grid type', () => {
      const original = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 5,
        height: 5,
      })
      const resized = CellLayer.resize(original, { width: 3, height: 3 }, 0)
      expect(resized.GridType).toBe(MapGridType.RectangularIsometric)
    })
  })

  // -----------------------------------------------------------------------
  // Integration: RectangularIsometric full grid
  // -----------------------------------------------------------------------

  describe('RectangularIsometric full coverage', () => {
    it('can fill and verify all valid isometric cells', () => {
      const W = 7,
        H = 7
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: W,
        height: H,
      })

      // Fill layer with distinct values via MPos (guaranteed valid)
      let count = 0
      for (let v = 0; v < H; v++) {
        for (let u = 0; u < W; u++) {
          layer.setMPos(new MPos(u, v), count)
          count++
        }
      }
      expect(count).toBe(W * H)

      // Verify via getMPos
      count = 0
      for (let v = 0; v < H; v++) {
        for (let u = 0; u < W; u++) {
          expect(layer.getMPos(new MPos(u, v))).toBe(count)
          count++
        }
      }
    })

    it('get via CPos matches get via MPos→CPos round-trip', () => {
      const layer = new CellLayer<number>(MapGridType.RectangularIsometric, {
        width: 7,
        height: 7,
      })

      // Fill via MPos
      for (let v = 0; v < 7; v++) {
        for (let u = 0; u < 7; u++) {
          layer.setMPos(new MPos(u, v), u * 100 + v)
        }
      }

      // Verify: get(CPos) should equal getMPos(CPos.toMPos()) for valid cells
      for (let y = -1; y <= 6; y++) {
        for (let x = y; x <= 6; x++) {
          const cell = new CPos(x, y)
          if (layer.contains(cell)) {
            const val1 = layer.get(cell)
            const mp = cell.toMPos(MapGridType.RectangularIsometric)
            const val2 = layer.getMPos(mp)
            expect(val1).toBe(val2)
          }
        }
      }
    })
  })
})
