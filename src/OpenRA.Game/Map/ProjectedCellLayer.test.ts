/**
 * ProjectedCellLayer.test.ts — ProjectedCellLayer unit tests
 *
 * Tests focus on: PPos get/set, integer index get/set,
 * Index/PPosFromIndex round-trip, Contains, SetAll, MaxIndex.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ProjectedCellLayer } from './ProjectedCellLayer'
import { MapGridType } from './MapGridType'
import { PPos } from '../MPos'
import type { Size } from './CellLayerBase'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectedCellLayer', () => {
  const size: Size = { width: 10, height: 8 }
  let layer: ProjectedCellLayer<number>

  beforeEach(() => {
    layer = new ProjectedCellLayer<number>(MapGridType.Rectangular, size)
  })

  describe('construction', () => {
    it('creates layer with correct size', () => {
      expect(layer.Size.width).toBe(10)
      expect(layer.Size.height).toBe(8)
    })

    it('stores grid type', () => {
      const iso = new ProjectedCellLayer<number>(
        MapGridType.RectangularIsometric,
        { width: 5, height: 5 },
      )
      expect(iso.GridType).toBe(MapGridType.RectangularIsometric)
    })

    it('initializes with all undefined entries', () => {
      expect(layer.get(new PPos(0, 0))).toBeUndefined()
    })
  })

  describe('MaxIndex', () => {
    it('returns width * height', () => {
      expect(layer.MaxIndex).toBe(80)
    })

    it('returns 0 for empty layer', () => {
      const empty = new ProjectedCellLayer<number>(MapGridType.Rectangular, {
        width: 0,
        height: 0,
      })
      expect(empty.MaxIndex).toBe(0)
    })
  })

  describe('Index', () => {
    it('computes correct index for PPos', () => {
      // index = V * Width + U
      expect(layer.index(new PPos(0, 0))).toBe(0)
      expect(layer.index(new PPos(9, 0))).toBe(9)
      expect(layer.index(new PPos(0, 1))).toBe(10)
      expect(layer.index(new PPos(5, 7))).toBe(75) // 7*10+5=75
      expect(layer.index(new PPos(9, 7))).toBe(79) // 7*10+9=79
    })

    it('no bounds check in Index', () => {
      // Index formula works even for out-of-bounds PPos
      expect(layer.index(new PPos(100, 100))).toBe(100 * 10 + 100)
    })
  })

  describe('PPosFromIndex', () => {
    it('inverse of Index', () => {
      const uv = new PPos(5, 7)
      const idx = layer.index(uv)
      const back = layer.pposFromIndex(idx)
      expect(back.U).toBe(5)
      expect(back.V).toBe(7)
    })

    it('works for index 0', () => {
      const back = layer.pposFromIndex(0)
      expect(back.U).toBe(0)
      expect(back.V).toBe(0)
    })

    it('works for last index', () => {
      const back = layer.pposFromIndex(79)
      expect(back.U).toBe(9)
      expect(back.V).toBe(7)
    })

    it('round-trip for all cells', () => {
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 10; u++) {
          const uv = new PPos(u, v)
          const idx = layer.index(uv)
          const back = layer.pposFromIndex(idx)
          expect(back.U).toBe(u)
          expect(back.V).toBe(v)
        }
      }
    })
  })

  describe('get/set by PPos', () => {
    it('get returns undefined for unset cell', () => {
      expect(layer.get(new PPos(2, 3))).toBeUndefined()
    })

    it('set and get round-trip', () => {
      layer.set(new PPos(2, 3), 42)
      expect(layer.get(new PPos(2, 3))).toBe(42)
    })

    it('set on one cell does not affect others', () => {
      layer.set(new PPos(1, 1), 100)
      expect(layer.get(new PPos(0, 0))).toBeUndefined()
      expect(layer.get(new PPos(1, 1))).toBe(100)
      expect(layer.get(new PPos(2, 2))).toBeUndefined()
    })

    it('preserves indices across the full range', () => {
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 10; u++) {
          layer.set(new PPos(u, v), u * 100 + v)
        }
      }

      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 10; u++) {
          expect(layer.get(new PPos(u, v))).toBe(u * 100 + v)
        }
      }
    })
  })

  describe('getByIndex / setByIndex', () => {
    it('accesses by raw integer index', () => {
      layer.setByIndex(0, 10)
      layer.setByIndex(79, 20)
      expect(layer.getByIndex(0)).toBe(10)
      expect(layer.getByIndex(79)).toBe(20)
    })

    it('getByIndex matches get(PPosFromIndex)', () => {
      layer.set(new PPos(5, 3), 77)
      const idx = layer.index(new PPos(5, 3))
      expect(layer.getByIndex(idx)).toBe(77)
    })

    it('setByIndex matches set via PPosFromIndex', () => {
      layer.setByIndex(35, 99) // index 35 = PPos(35%10=5, 35/10=3)
      expect(layer.get(new PPos(5, 3))).toBe(99)
    })
  })

  describe('contains', () => {
    it('returns true for valid PPos', () => {
      expect(layer.contains(new PPos(0, 0))).toBe(true)
      expect(layer.contains(new PPos(9, 7))).toBe(true)
      expect(layer.contains(new PPos(5, 3))).toBe(true)
    })

    it('returns false for out-of-bounds PPos', () => {
      expect(layer.contains(new PPos(10, 0))).toBe(false)
      expect(layer.contains(new PPos(0, 8))).toBe(false)
      expect(layer.contains(new PPos(-1, 0))).toBe(false)
    })
  })

  describe('setAll', () => {
    it('sets all entries to the same value', () => {
      layer.setAll(42)
      for (let i = 0; i < 80; i++) {
        expect(layer.getByIndex(i)).toBe(42)
      }
    })

    it('setAll overwrites previous values', () => {
      layer.set(new PPos(0, 0), 1)
      layer.setAll(0)
      expect(layer.get(new PPos(0, 0))).toBe(0)
      expect(layer.get(new PPos(9, 7))).toBe(0)
    })
  })

  describe('iteration (inherited from CellLayerBase)', () => {
    it('iterates over all values', () => {
      for (let i = 0; i < 80; i++) {
        layer.setByIndex(i, i)
      }
      const values = [...layer]
      expect(values.length).toBe(80)
      expect(values[0]).toBe(0)
      expect(values[79]).toBe(79)
    })
  })

  describe('lifecycle', () => {
    it('create → fill → read → clear → verify', () => {
      const l = new ProjectedCellLayer<string>(MapGridType.Rectangular, {
        width: 4,
        height: 3,
      })

      // Fill all cells
      for (let v = 0; v < 3; v++) {
        for (let u = 0; u < 4; u++) {
          l.set(new PPos(u, v), `${u},${v}`)
        }
      }

      // Verify
      expect(l.get(new PPos(2, 1))).toBe('2,1')

      // Clear
      l.setAll('empty')
      for (let i = 0; i < 12; i++) {
        expect(l.getByIndex(i)).toBe('empty')
      }
    })
  })
})
