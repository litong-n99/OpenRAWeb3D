/**
 * CellCoordsRegion.test.ts — CellCoordsRegion unit tests
 *
 * Tests focus on: region construction, contains check, iteration,
 * boundingRegion static factory, and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { CellCoordsRegion } from './CellCoordsRegion'
import { CPos } from '../CPos'

describe('CellCoordsRegion', () => {
  describe('construction', () => {
    it('stores topLeft and bottomRight', () => {
      const tl = new CPos(0, 0)
      const br = new CPos(5, 3)
      const region = new CellCoordsRegion(tl, br)
      expect(CPos.equals(region.TopLeft, tl)).toBe(true)
      expect(CPos.equals(region.BottomRight, br)).toBe(true)
    })

    it('works with layer values', () => {
      const tl = new CPos(0, 0, 1)
      const br = new CPos(5, 3, 1)
      const region = new CellCoordsRegion(tl, br)
      expect(region.TopLeft.Layer).toBe(1)
    })
  })

  describe('contains', () => {
    const region = new CellCoordsRegion(new CPos(2, 2), new CPos(5, 5))

    it('returns true for cell inside region', () => {
      expect(region.contains(new CPos(3, 4))).toBe(true)
    })

    it('returns true for topLeft corner', () => {
      expect(region.contains(new CPos(2, 2))).toBe(true)
    })

    it('returns true for bottomRight corner', () => {
      expect(region.contains(new CPos(5, 5))).toBe(true)
    })

    it('returns false for cell before topLeft', () => {
      expect(region.contains(new CPos(1, 2))).toBe(false)
    })

    it('returns false for cell after bottomRight', () => {
      expect(region.contains(new CPos(6, 5))).toBe(false)
    })

    it('returns false for cell below region', () => {
      expect(region.contains(new CPos(3, 6))).toBe(false)
    })

    it('returns false for cell above region', () => {
      expect(region.contains(new CPos(3, 1))).toBe(false)
    })
  })

  describe('toString', () => {
    it('formats correctly', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(5, 3))
      expect(region.toString()).toBe('0,0->5,3')
    })
  })

  describe('iteration', () => {
    it('iterates over single cell', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(0, 0))
      const result = [...region]
      expect(result.length).toBe(1)
      expect(result[0].X).toBe(0)
      expect(result[0].Y).toBe(0)
    })

    it('iterates row-major (X then Y)', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      const result = [...region]
      expect(result.length).toBe(4)
      // Expected: (0,0), (1,0), (0,1), (1,1)
      expect(result[0].X).toBe(0); expect(result[0].Y).toBe(0)
      expect(result[1].X).toBe(1); expect(result[1].Y).toBe(0)
      expect(result[2].X).toBe(0); expect(result[2].Y).toBe(1)
      expect(result[3].X).toBe(1); expect(result[3].Y).toBe(1)
    })

    it('iterates 2x3 region correctly', () => {
      const region = new CellCoordsRegion(new CPos(10, 10), new CPos(11, 12))
      const result = [...region]
      expect(result.length).toBe(6)
    })
  })

  describe('boundingRegion', () => {
    it('returns minimal region covering all cells', () => {
      const cells = [
        new CPos(3, 5),
        new CPos(7, 2),
        new CPos(1, 8),
      ]
      const region = CellCoordsRegion.boundingRegion(cells)
      expect(region.TopLeft.X).toBe(1)
      expect(region.TopLeft.Y).toBe(2)
      expect(region.BottomRight.X).toBe(7)
      expect(region.BottomRight.Y).toBe(8)
    })

    it('works with single cell', () => {
      const cells = [new CPos(5, 5)]
      const region = CellCoordsRegion.boundingRegion(cells)
      expect(region.TopLeft.X).toBe(5)
      expect(region.TopLeft.Y).toBe(5)
      expect(region.BottomRight.X).toBe(5)
      expect(region.BottomRight.Y).toBe(5)
    })

    it('throws for null', () => {
      expect(() =>
        CellCoordsRegion.boundingRegion(null as unknown as CPos[]),
      ).toThrow('cells must not be null or empty')
    })

    it('throws for empty array', () => {
      expect(() => CellCoordsRegion.boundingRegion([])).toThrow(
        'cells must not be null or empty',
      )
    })

    it('handles negative coordinates', () => {
      const cells = [new CPos(-10, -5), new CPos(-2, -1)]
      const region = CellCoordsRegion.boundingRegion(cells)
      expect(region.TopLeft.X).toBe(-10)
      expect(region.TopLeft.Y).toBe(-5)
      expect(region.BottomRight.X).toBe(-2)
      expect(region.BottomRight.Y).toBe(-1)
    })
  })
})
