/**
 * CellRegion.test.ts — CellRegion unit tests
 *
 * Tests focus on: rectangular construction (CPos and MPos forms),
 * contains (region and cell), MapCoords/CellCoords sub-regions,
 * iteration (map-coordinate-based for correct isometric order),
 * Expand, BoundingRegion, and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { CellRegion } from './CellRegion'
import { CPos } from '../CPos'
import { MPos } from '../MPos'
import { MapGridType } from './MapGridType'

describe('CellRegion', () => {
  describe('construction (CPos form)', () => {
    it('constructs from CPos corners', () => {
      const tl = new CPos(0, 0)
      const br = new CPos(5, 5)
      const region = new CellRegion(MapGridType.Rectangular, tl, br)
      expect(CPos.equals(region.TopLeft, tl)).toBe(true)
      expect(CPos.equals(region.BottomRight, br)).toBe(true)
    })

    it('computes mapTopLeft/BottomRight for Rectangular', () => {
      const tl = new CPos(2, 3)
      const br = new CPos(7, 8)
      const region = new CellRegion(MapGridType.Rectangular, tl, br)
      expect(region.mapTopLeft.U).toBe(2)
      expect(region.mapTopLeft.V).toBe(3)
      expect(region.mapBottomRight.U).toBe(7)
      expect(region.mapBottomRight.V).toBe(8)
    })

    it('computes mapTopLeft/BottomRight for RectangularIsometric', () => {
      const tl = new CPos(0, 0)
      const br = new CPos(2, 2)
      const region = new CellRegion(MapGridType.RectangularIsometric, tl, br)
      // CPos(0,0) -> MPos(0,0)
      expect(region.mapTopLeft.U).toBe(0)
      expect(region.mapTopLeft.V).toBe(0)
      // CPos(2,2) -> v=4, u=(4-0)/2-2=0 -> MPos(0,4)
      expect(region.mapBottomRight.U).toBe(0)
      expect(region.mapBottomRight.V).toBe(4)
    })
  })

  describe('construction (MPos form)', () => {
    it('constructs from MPos corners', () => {
      const tl = new MPos(0, 0)
      const br = new MPos(5, 5)
      const region = new CellRegion(MapGridType.Rectangular, tl, br)
      expect(region.mapTopLeft.U).toBe(0)
      expect(region.mapTopLeft.V).toBe(0)
    })

    it('converts MPos to CPos for Rectangular', () => {
      const tl = new MPos(3, 4)
      const br = new MPos(7, 9)
      const region = new CellRegion(MapGridType.Rectangular, tl, br)
      expect(region.TopLeft.X).toBe(3)
      expect(region.TopLeft.Y).toBe(4)
    })

    it('converts MPos to CPos for RectangularIsometric', () => {
      const tl = new MPos(0, 0)
      const br = new MPos(2, 4)
      const region = new CellRegion(MapGridType.RectangularIsometric, tl, br)
      // MPos(0,0) -> CPos(0,0) for isometric
      expect(region.TopLeft.X).toBe(0)
      expect(region.TopLeft.Y).toBe(0)
    })
  })

  describe('toString', () => {
    it('formats correctly', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(0, 0),
        new CPos(5, 5),
      )
      expect(region.toString()).toBe('0,0->5,5')
    })
  })

  describe('containsRegion', () => {
    const outer = new CellRegion(
      MapGridType.Rectangular,
      new CPos(0, 0),
      new CPos(10, 10),
    )

    it('returns true for fully contained region', () => {
      const inner = new CellRegion(
        MapGridType.Rectangular,
        new CPos(2, 2),
        new CPos(5, 5),
      )
      expect(outer.containsRegion(inner)).toBe(true)
    })

    it('returns true for identical region', () => {
      expect(outer.containsRegion(outer)).toBe(true)
    })

    it('returns false for partially overlapping region', () => {
      const partial = new CellRegion(
        MapGridType.Rectangular,
        new CPos(8, 8),
        new CPos(15, 15),
      )
      expect(outer.containsRegion(partial)).toBe(false)
    })

    it('returns false for completely outside region', () => {
      const outside = new CellRegion(
        MapGridType.Rectangular,
        new CPos(20, 20),
        new CPos(30, 30),
      )
      expect(outer.containsRegion(outside)).toBe(false)
    })
  })

  describe('contains (cell)', () => {
    const region = new CellRegion(
      MapGridType.Rectangular,
      new CPos(2, 3),
      new CPos(7, 8),
    )

    it('returns true for cell inside', () => {
      expect(region.contains(new CPos(4, 5))).toBe(true)
    })

    it('returns true for topLeft corner', () => {
      expect(region.contains(new CPos(2, 3))).toBe(true)
    })

    it('returns true for bottomRight corner', () => {
      expect(region.contains(new CPos(7, 8))).toBe(true)
    })

    it('returns false for cell before topLeft', () => {
      expect(region.contains(new CPos(1, 3))).toBe(false)
    })

    it('returns false for cell after bottomRight', () => {
      expect(region.contains(new CPos(8, 8))).toBe(false)
    })
  })

  describe('contains (isometric)', () => {
    it('uses map coordinates for correct isometric containment', () => {
      const region = new CellRegion(
        MapGridType.RectangularIsometric,
        new CPos(0, 0),
        new CPos(3, 3),
      )
      // CPos(0,3) has X=0, Y=3. X<Y, but ToMPos might be inside bounds
      // v=3, u=((3-0)/2)-3=-3 = -3 -> MPos(-3,3) — out of bounds
      expect(region.contains(new CPos(0, 3))).toBe(false)
      // CPos(1,0) — valid isometric cell
      expect(region.contains(new CPos(1, 0))).toBe(true)
    })
  })

  describe('MapCoords sub-region', () => {
    it('returns correct MapCoordsRegion', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(2, 2),
        new CPos(5, 5),
      )
      const mapCoords = region.MapCoords
      expect(mapCoords.TopLeft.U).toBe(2)
      expect(mapCoords.TopLeft.V).toBe(2)
      expect(mapCoords.BottomRight.U).toBe(5)
      expect(mapCoords.BottomRight.V).toBe(5)
    })
  })

  describe('CellCoords sub-region', () => {
    it('returns correct CellCoordsRegion', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(2, 2),
        new CPos(5, 5),
      )
      const cellCoords = region.CellCoords
      expect(cellCoords.TopLeft.X).toBe(2)
      expect(cellCoords.TopLeft.Y).toBe(2)
      expect(cellCoords.BottomRight.X).toBe(5)
      expect(cellCoords.BottomRight.Y).toBe(5)
    })
  })

  describe('iteration', () => {
    it('iterates over Rectangular region in map-coordinate order', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(0, 0),
        new CPos(1, 1),
      )
      const result = [...region]
      expect(result.length).toBe(4)
      // Rectangular: map coords == cell coords, so order is (0,0)(1,0)(0,1)(1,1)
      expect(result[0].X).toBe(0); expect(result[0].Y).toBe(0)
      expect(result[1].X).toBe(1); expect(result[1].Y).toBe(0)
      expect(result[2].X).toBe(0); expect(result[2].Y).toBe(1)
      expect(result[3].X).toBe(1); expect(result[3].Y).toBe(1)
    })

    it('iterates over single-cell region', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(5, 5),
        new CPos(5, 5),
      )
      const result = [...region]
      expect(result.length).toBe(1)
      expect(result[0].X).toBe(5)
      expect(result[0].Y).toBe(5)
    })

    it('exhausted iterator returns done', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(0, 0),
        new CPos(0, 0),
      )
      const iter = region[Symbol.iterator]()
      expect(iter.next().done).toBe(false)
      expect(iter.next().done).toBe(true)
    })

    it('produces distinct CPos objects', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(0, 0),
        new CPos(1, 1),
      )
      const result = [...region]
      expect(result[0]).not.toBe(result[1])
    })

    it('iteration count matches expected cell count', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(0, 0),
        new CPos(9, 4),
      )
      const result = [...region]
      expect(result.length).toBe(50) // 10 * 5 = 50
    })
  })

  describe('expand', () => {
    it('expands region by cordon on all sides', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(5, 5),
        new CPos(10, 10),
      )
      const expanded = CellRegion.expand(region, 2)

      // (5,5)->(10,10) with cordon 2 → (3,3)->(12,12) in map coords
      expect(expanded.mapTopLeft.U).toBe(3)
      expect(expanded.mapTopLeft.V).toBe(3)
      expect(expanded.mapBottomRight.U).toBe(12)
      expect(expanded.mapBottomRight.V).toBe(12)
    })

    it('expand by 0 returns equivalent region', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(1, 2),
        new CPos(3, 4),
      )
      const expanded = CellRegion.expand(region, 0)
      expect(expanded.mapTopLeft.U).toBe(1)
      expect(expanded.mapTopLeft.V).toBe(2)
      expect(expanded.mapBottomRight.U).toBe(3)
      expect(expanded.mapBottomRight.V).toBe(4)
    })

    it('may expand outside the map borders (no clamping)', () => {
      const region = new CellRegion(
        MapGridType.Rectangular,
        new CPos(0, 0),
        new CPos(2, 2),
      )
      const expanded = CellRegion.expand(region, 5)
      // Goes negative
      expect(expanded.mapTopLeft.U).toBe(-5)
      expect(expanded.mapTopLeft.V).toBe(-5)
    })
  })

  describe('boundingRegion', () => {
    it('computes minimal bounding region', () => {
      const cells = [new CPos(3, 5), new CPos(7, 2), new CPos(1, 8)]
      const region = CellRegion.boundingRegion(MapGridType.Rectangular, cells)

      // Min U=1,V=2, Max U=7,V=8 -> CPos (1,2) to (7,8) for Rectangular
      expect(region.TopLeft.X).toBe(1)
      expect(region.TopLeft.Y).toBe(2)
      expect(region.BottomRight.X).toBe(7)
      expect(region.BottomRight.Y).toBe(8)
    })

    it('works with single cell', () => {
      const region = CellRegion.boundingRegion(MapGridType.Rectangular, [
        new CPos(5, 5),
      ])
      expect(region.TopLeft.X).toBe(5)
      expect(region.TopLeft.Y).toBe(5)
      expect(region.BottomRight.X).toBe(5)
      expect(region.BottomRight.Y).toBe(5)
    })

    it('throws for null array', () => {
      expect(() =>
        CellRegion.boundingRegion(
          MapGridType.Rectangular,
          null as unknown as CPos[],
        ),
      ).toThrow('cells must not be null or empty')
    })

    it('throws for empty array', () => {
      expect(() =>
        CellRegion.boundingRegion(MapGridType.Rectangular, []),
      ).toThrow('cells must not be null or empty')
    })
  })

  describe('grid type property', () => {
    it('stores gridType correctly', () => {
      const rect = new CellRegion(
        MapGridType.Rectangular,
        new CPos(0, 0),
        new CPos(5, 5),
      )
      expect(rect.gridType).toBe(MapGridType.Rectangular)

      const iso = new CellRegion(
        MapGridType.RectangularIsometric,
        new CPos(0, 0),
        new CPos(3, 3),
      )
      expect(iso.gridType).toBe(MapGridType.RectangularIsometric)
    })
  })
})
