/**
 * ProjectedCellRegion.test.ts — ProjectedCellRegion unit tests
 *
 * Tests focus on: construction with GridConfig + height offset (>> 1),
 * contains check, CandidateMapCoords sub-region, iteration in projected
 * space, and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { ProjectedCellRegion, type GridConfig } from './ProjectedCellRegion'
import { MapGridType } from './MapGridType'
import { PPos } from '../MPos'
import type { Size } from '../Primitives/Size'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shortcut for creating a GridConfig. */
function cfg(
  gridType: number,
  maxHeight: number,
): GridConfig {
  return { gridType: gridType as GridConfig['gridType'], maximumTerrainHeight: maxHeight }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectedCellRegion', () => {
  const mapSize: Size = { width: 50, height: 50 }

  describe('construction', () => {
    it('stores TopLeft and BottomRight', () => {
      const tl = new PPos(0, 0)
      const br = new PPos(10, 10)
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        mapSize,
        tl,
        br,
      )
      expect(PPos.equals(region.TopLeft, tl)).toBe(true)
      expect(PPos.equals(region.BottomRight, br)).toBe(true)
    })

    it('computes mapTopLeft from PPos topLeft (direct conversion)', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        mapSize,
        new PPos(5, 5),
        new PPos(15, 15),
      )
      expect(region.mapTopLeft.U).toBe(5)
      expect(region.mapTopLeft.V).toBe(5)
    })

    it('height offset for Rectangular is maxHeight >> 1 (Architect WR item 4)', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 10), // offset = 10 >> 1 = 5
        mapSize,
        new PPos(0, 0),
        new PPos(10, 10),
      )
      // bottomRight.V + heightOffset = 10 + 5 = 15, clamped to mapSize
      expect(region.mapBottomRight.V).toBe(15)
    })

    it('height offset for RectangularIsometric is full maxHeight', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.RectangularIsometric, 10), // offset = 10 (full)
        mapSize,
        new PPos(0, 0),
        new PPos(10, 10),
      )
      expect(region.mapBottomRight.V).toBe(20) // 10 + 10 = 20
    })

    it('clamps mapBottomRight to map bounds', () => {
      const smallMap: Size = { width: 10, height: 10 }
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 100), // offset = 100 >> 1 = 50
        smallMap,
        new PPos(0, 0),
        new PPos(5, 5),
      )
      // heightOffset = 50, bottomRight.V = 5+50=55, clamped to mapSize.height-1 = 9
      expect(region.mapBottomRight.V).toBe(9)
    })

    it('zero height offset for zero terrain height', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        mapSize,
        new PPos(2, 2),
        new PPos(8, 8),
      )
      expect(region.mapBottomRight.V).toBe(8)
    })

    it('height offset for Rectangular with odd maxHeight (>> 1 truncation)', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 7), // 7 >> 1 = 3
        mapSize,
        new PPos(0, 0),
        new PPos(5, 5),
      )
      expect(region.mapBottomRight.V).toBe(8) // 5 + 3 = 8
    })
  })

  describe('contains', () => {
    const region = new ProjectedCellRegion(
      cfg(MapGridType.Rectangular, 0),
      mapSize,
      new PPos(2, 2),
      new PPos(8, 8),
    )

    it('returns true for PPos inside region', () => {
      expect(region.contains(new PPos(5, 5))).toBe(true)
    })

    it('returns true for topLeft corner', () => {
      expect(region.contains(new PPos(2, 2))).toBe(true)
    })

    it('returns true for bottomRight corner', () => {
      expect(region.contains(new PPos(8, 8))).toBe(true)
    })

    it('returns false for PPos before topLeft', () => {
      expect(region.contains(new PPos(1, 5))).toBe(false)
    })

    it('returns false for PPos after bottomRight', () => {
      expect(region.contains(new PPos(9, 5))).toBe(false)
    })

    it('returns false for PPos below region', () => {
      expect(region.contains(new PPos(5, 9))).toBe(false)
    })

    it('returns false for PPos above region', () => {
      expect(region.contains(new PPos(5, 1))).toBe(false)
    })
  })

  describe('CandidateMapCoords', () => {
    it('returns MapCoordsRegion spanning mapTopLeft to mapBottomRight', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        mapSize,
        new PPos(5, 5),
        new PPos(15, 15),
      )
      const candidate = region.CandidateMapCoords
      expect(candidate.TopLeft.U).toBe(5)
      expect(candidate.TopLeft.V).toBe(5)
      expect(candidate.BottomRight.U).toBe(15)
      expect(candidate.BottomRight.V).toBe(15)
    })

    it('CandidateMapCoords is iterable', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        { width: 20, height: 20 },
        new PPos(0, 0),
        new PPos(1, 1),
      )
      const cells = [...region.CandidateMapCoords]
      expect(cells.length).toBe(4)
    })
  })

  describe('iteration', () => {
    it('iterates over all PPos in projected region', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        mapSize,
        new PPos(0, 0),
        new PPos(1, 1),
      )
      const result = [...region]
      expect(result.length).toBe(4)
      // Row-major: (0,0), (1,0), (0,1), (1,1)
      expect(result[0].U).toBe(0); expect(result[0].V).toBe(0)
      expect(result[1].U).toBe(1); expect(result[1].V).toBe(0)
      expect(result[2].U).toBe(0); expect(result[2].V).toBe(1)
      expect(result[3].U).toBe(1); expect(result[3].V).toBe(1)
    })

    it('single cell iteration', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        mapSize,
        new PPos(5, 5),
        new PPos(5, 5),
      )
      const result = [...region]
      expect(result.length).toBe(1)
      expect(result[0].U).toBe(5)
      expect(result[0].V).toBe(5)
    })

    it('exhausted iterator returns done', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        mapSize,
        new PPos(0, 0),
        new PPos(0, 0),
      )
      const iter = region[Symbol.iterator]()
      expect(iter.next().done).toBe(false)
      expect(iter.next().done).toBe(true)
    })

    it('iteration count matches area', () => {
      const w = 5,
        h = 3
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 0),
        mapSize,
        new PPos(0, 0),
        new PPos(w - 1, h - 1),
      )
      expect([...region].length).toBe(w * h)
    })
  })

  describe('edge cases', () => {
    it('handles zero-height terrain correctly', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.RectangularIsometric, 0),
        mapSize,
        new PPos(0, 0),
        new PPos(3, 3),
      )
      expect(region.mapBottomRight.V).toBe(3)
    })

    it('mapTopLeft.U matches PPos topLeft.U', () => {
      const region = new ProjectedCellRegion(
        cfg(MapGridType.Rectangular, 5),
        mapSize,
        new PPos(10, 20),
        new PPos(30, 40),
      )
      expect(region.mapTopLeft.U).toBe(10)
    })

    it('GridConfig exported type is usable', () => {
      const config: GridConfig = {
        gridType: MapGridType.RectangularIsometric,
        maximumTerrainHeight: 15,
      }
      expect(config.gridType).toBe(1)
      expect(config.maximumTerrainHeight).toBe(15)
    })
  })
})
