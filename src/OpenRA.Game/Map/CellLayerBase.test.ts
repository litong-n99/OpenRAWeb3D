/**
 * CellLayerBase.test.ts — CellLayerBase unit tests
 *
 * Tests focus on: array initialization, size/bounds correctness,
 * copyValuesFrom (including error path), clear (both forms),
 * iteration, and memory access methods.
 */

import { describe, it, expect } from 'vitest'
import { CellLayerBase } from './CellLayerBase'
import { MapGridType, type MapGridType as MapGridTypeEnum } from './MapGridType'
import type { Size } from './CellLayerBase'

// ---------------------------------------------------------------------------
// Concrete test subclass — CellLayerBase is abstract
// ---------------------------------------------------------------------------

class TestCellLayer extends CellLayerBase<number> {
  constructor(gridType: MapGridTypeEnum, size: Size) {
    super(gridType, size)
  }

  /** Expose protected Bounds for test assertions. */
  get testBounds() {
    return (this as any).Bounds
  }

  /** Expose protected Entries for test assertions. */
  get testEntries(): number[] {
    return (this as any).Entries
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CellLayerBase', () => {
  const size: Size = { width: 10, height: 8 }

  describe('construction', () => {
    it('stores Size with correct dimensions', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, size)
      expect(layer.Size.width).toBe(10)
      expect(layer.Size.height).toBe(8)
    })

    it('stores GridType', () => {
      const layer = new TestCellLayer(MapGridType.RectangularIsometric, size)
      expect(layer.GridType).toBe(MapGridType.RectangularIsometric)
    })

    it('creates Entries array of correct length', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, size)
      expect(layer.testEntries.length).toBe(80)
    })

    it('creates Entries array of size width*height', () => {
      const big: Size = { width: 50, height: 40 }
      const layer = new TestCellLayer(MapGridType.Rectangular, big)
      expect(layer.testEntries.length).toBe(2000)
    })

    it('creates Bounds from (0, 0) to (width, height)', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, size)
      const bounds = layer.testBounds
      expect(bounds.X).toBe(0)
      expect(bounds.Y).toBe(0)
      expect(bounds.Width).toBe(10)
      expect(bounds.Height).toBe(8)
    })

    it('Size is a distinct object (not same reference)', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, size)
      expect(layer.Size).not.toBe(size) // defensive copy check
    })

    it('all entries initially undefined', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })
      const entries = layer.testEntries
      for (let i = 0; i < 6; i++) {
        expect(entries[i]).toBeUndefined()
      }
    })
  })

  describe('copyValuesFrom', () => {
    it('copies all values from another layer', () => {
      const src = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })
      const dst = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })

      // Set values in source
      for (let i = 0; i < 6; i++) {
        ;(src as any).Entries[i] = i * 10
      }

      dst.copyValuesFrom(src)
      for (let i = 0; i < 6; i++) {
        expect(dst.testEntries[i]).toBe(i * 10)
      }
    })

    it('throws if sizes differ', () => {
      const src = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })
      const dst = new TestCellLayer(MapGridType.Rectangular, { width: 4, height: 2 })

      expect(() => dst.copyValuesFrom(src)).toThrow(
        'Layers must have a matching size and shape',
      )
    })

    it('throws if grid types differ', () => {
      const src = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })
      const dst = new TestCellLayer(MapGridType.RectangularIsometric, {
        width: 3,
        height: 2,
      })

      expect(() => dst.copyValuesFrom(src)).toThrow(
        'Layers must have a matching size and shape',
      )
    })

    it('does not throw for matching layers', () => {
      const src = new TestCellLayer(MapGridType.RectangularIsometric, { width: 2, height: 2 })
      const dst = new TestCellLayer(MapGridType.RectangularIsometric, { width: 2, height: 2 })

      expect(() => dst.copyValuesFrom(src)).not.toThrow()
    })
  })

  describe('clear (no-arg)', () => {
    it('sets all entries to undefined', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })
      // Pre-fill
      for (let i = 0; i < 6; i++) {
        ;(layer as any).Entries[i] = 42
      }

      layer.clear()
      for (let i = 0; i < 6; i++) {
        expect(layer.testEntries[i]).toBeUndefined()
      }
    })

    it('handles empty layer (0x0)', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 0, height: 0 })
      expect(() => layer.clear()).not.toThrow()
      expect(layer.testEntries.length).toBe(0)
    })

    it('handles large layer', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 100, height: 100 })
      for (let i = 0; i < 10000; i++) {
        ;(layer as any).Entries[i] = 7
      }
      layer.clear()
      for (let i = 0; i < 10000; i++) {
        expect(layer.testEntries[i]).toBeUndefined()
      }
    })
  })

  describe('clear (with value)', () => {
    it('sets all entries to the specified value', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })
      layer.clear(99)
      for (let i = 0; i < 6; i++) {
        expect(layer.testEntries[i]).toBe(99)
      }
    })

    it('works with zero', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })
      // Pre-fill with non-zero
      for (let i = 0; i < 6; i++) {
        ;(layer as any).Entries[i] = 42
      }
      layer.clear(0)
      for (let i = 0; i < 6; i++) {
        expect(layer.testEntries[i]).toBe(0)
      }
    })

    it('works with negative values', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 2, height: 2 })
      layer.clear(-1)
      for (let i = 0; i < 4; i++) {
        expect(layer.testEntries[i]).toBe(-1)
      }
    })
  })

  describe('iteration', () => {
    it('iterates over all entries', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 3, height: 2 })
      for (let i = 0; i < 6; i++) {
        ;(layer as any).Entries[i] = i
      }

      const values: number[] = []
      for (const v of layer) {
        values.push(v)
      }
      expect(values).toEqual([0, 1, 2, 3, 4, 5])
    })

    it('spread operator works', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 2, height: 2 })
      for (let i = 0; i < 4; i++) {
        ;(layer as any).Entries[i] = i
      }
      expect([...layer]).toEqual([0, 1, 2, 3])
    })

    it('empty layer iteration produces no values', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 0, height: 0 })
      expect([...layer]).toEqual([])
    })
  })

  describe('asReadOnlyMemory', () => {
    it('returns the same underlying array', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 2, height: 2 })
      const mem = layer.asReadOnlyMemory()
      expect(mem).toBe(layer.testEntries)
      expect(mem.length).toBe(4)
    })
  })

  describe('asMemory', () => {
    it('returns the same underlying array', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 2, height: 2 })
      const mem = layer.asMemory()
      expect(mem).toBe(layer.testEntries)
    })

    it('modifications through asMemory are visible', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 2, height: 2 })
      const mem = layer.asMemory()
      mem[0] = 123
      expect(layer.testEntries[0]).toBe(123)
    })
  })

  describe('grid type handling', () => {
    it('Rectangular grid stores correctly', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 5, height: 5 })
      expect(layer.GridType).toBe(0)
    })

    it('RectangularIsometric grid stores correctly', () => {
      const layer = new TestCellLayer(MapGridType.RectangularIsometric, { width: 5, height: 5 })
      expect(layer.GridType).toBe(1)
    })
  })

  describe('lifecycle', () => {
    it('create → use → clear → reuse cycle', () => {
      const layer = new TestCellLayer(MapGridType.Rectangular, { width: 4, height: 3 })

      // Fill
      layer.clear(1)
      expect([...layer].every((v) => v === 1)).toBe(true)

      // Reset
      layer.clear()
      expect([...layer].every((v) => v === undefined)).toBe(true)

      // Refill with different value
      layer.clear(5)
      expect([...layer].every((v) => v === 5)).toBe(true)

      // Copy
      const src = new TestCellLayer(MapGridType.Rectangular, { width: 4, height: 3 })
      src.clear(9)
      layer.copyValuesFrom(src)
      expect([...layer].every((v) => v === 9)).toBe(true)
    })
  })
})
