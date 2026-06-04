/**
 * MapCoordsRegion.test.ts — MapCoordsRegion unit tests
 *
 * Tests focus on: region construction, iteration, edge cases.
 */

import { describe, it, expect } from 'vitest'
import { MapCoordsRegion } from './MapCoordsRegion'
import { MPos } from '../MPos'

describe('MapCoordsRegion', () => {
  describe('construction', () => {
    it('stores topLeft and bottomRight', () => {
      const tl = new MPos(0, 0)
      const br = new MPos(5, 3)
      const region = new MapCoordsRegion(tl, br)
      expect(MPos.equals(region.TopLeft, tl)).toBe(true)
      expect(MPos.equals(region.BottomRight, br)).toBe(true)
    })
  })

  describe('toString', () => {
    it('formats correctly', () => {
      const region = new MapCoordsRegion(new MPos(0, 0), new MPos(5, 3))
      expect(region.toString()).toBe('0,0->5,3')
    })
  })

  describe('iteration', () => {
    it('iterates over single cell', () => {
      const region = new MapCoordsRegion(new MPos(0, 0), new MPos(0, 0))
      const result = [...region]
      expect(result.length).toBe(1)
      expect(result[0].U).toBe(0)
      expect(result[0].V).toBe(0)
    })

    it('iterates over a row (U direction)', () => {
      const region = new MapCoordsRegion(new MPos(0, 0), new MPos(3, 0))
      const result = [...region]
      expect(result.length).toBe(4)
      expect(result[0].U).toBe(0)
      expect(result[0].V).toBe(0)
      expect(result[3].U).toBe(3)
      expect(result[3].V).toBe(0)
    })

    it('iterates over a column (V direction)', () => {
      const region = new MapCoordsRegion(new MPos(0, 0), new MPos(0, 2))
      const result = [...region]
      expect(result.length).toBe(3)
      expect(result[0].V).toBe(0)
      expect(result[2].V).toBe(2)
    })

    it('iterates row-major (U then V)', () => {
      const region = new MapCoordsRegion(new MPos(0, 0), new MPos(2, 1))
      const result = [...region]
      expect(result.length).toBe(6)

      // Expected order: (0,0), (1,0), (2,0), (0,1), (1,1), (2,1)
      const expected = [
        [0, 0], [1, 0], [2, 0],
        [0, 1], [1, 1], [2, 1],
      ]
      for (let i = 0; i < expected.length; i++) {
        expect(result[i].U).toBe(expected[i][0])
        expect(result[i].V).toBe(expected[i][1])
      }
    })

    it('handles larger region correctly', () => {
      const region = new MapCoordsRegion(new MPos(5, 5), new MPos(6, 6))
      const result = [...region]
      expect(result.length).toBe(4)
      const coords = result.map((m) => `${m.U},${m.V}`)
      expect(coords).toEqual(['5,5', '6,5', '5,6', '6,6'])
    })

    it('produces distinct MPos instances', () => {
      const region = new MapCoordsRegion(new MPos(0, 0), new MPos(1, 1))
      const result = [...region]
      // Each should be a different object
      expect(result[0]).not.toBe(result[1])
    })

    it('exhausted iterator returns done', () => {
      const region = new MapCoordsRegion(new MPos(0, 0), new MPos(0, 0))
      const iter = region[Symbol.iterator]()
      const first = iter.next()
      expect(first.done).toBe(false)
      expect(first.value.U).toBe(0)

      const second = iter.next()
      expect(second.done).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('works with negative coordinates', () => {
      const region = new MapCoordsRegion(new MPos(-2, -2), new MPos(-1, -1))
      const result = [...region]
      expect(result.length).toBe(4)
    })

    it('handles zero-width region', () => {
      // Negative width case: topLeft.U > bottomRight.U
      // This should produce empty iteration
      // The constructor doesn't validate; iteration handles it naturally
      const region = new MapCoordsRegion(new MPos(5, 0), new MPos(3, 0))
      const result = [...region]
      // U starts at 5-1=4, first next: 5 > 3 (bottomRight.U), so V increments,
      // but V: 0 > 0 (bottomRight.V), so done
      expect(result.length).toBe(0)
    })
  })
})
