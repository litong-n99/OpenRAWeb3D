/**
 * EditorSelectionAnnotationRenderable.test.ts — EditorSelectionAnnotationRenderable unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, world-space vertex computation, color,
 * dispose lifecycle, and edge cases.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — mock only what the file imports as types
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core/Meshes/linesMesh', () => ({
  // LinesMesh is only used as a type — no runtime mock needed
}))

vi.mock('@babylonjs/core/scene', () => ({
  // Scene is only used as a type — no runtime mock needed
}))

vi.mock('@babylonjs/core/Maths/math.vector', () => ({
  // Vector3 is only used as a type in createOrUpdateMesh — no runtime mock needed
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { EditorSelectionAnnotationRenderable, type WorldPoint } from './EditorSelectionAnnotationRenderable'
import { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a test CellCoordsRegion from two cell positions. */
function makeRegion(x1: number, y1: number, x2: number, y2: number): CellCoordsRegion {
  return new CellCoordsRegion(new CPos(x1, y1), new CPos(x2, y2))
}

/** A simple cell-to-world conversion function for testing. */
function testCellToWorld(cpos: CPos, height: number): WorldPoint {
  // Simple linear mapping: each cell = 1 world unit
  return {
    x: cpos.X,
    y: height,
    z: cpos.Y,
  }
}

/** Default test color: semi-transparent green. */
const TEST_COLOR = { r: 0, g: 255, b: 0, a: 128 }

// ---------------------------------------------------------------------------
// Tests — EditorSelectionAnnotationRenderable
// ---------------------------------------------------------------------------

describe('EditorSelectionAnnotationRenderable', () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('creates with valid CellCoordsRegion', () => {
      const region = makeRegion(0, 0, 10, 10)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      expect(renderable.selectionBounds).not.toBeNull()
      expect(renderable.selectionBounds!.TopLeft.X).toBe(0)
      expect(renderable.selectionBounds!.TopLeft.Y).toBe(0)
      expect(renderable.selectionBounds!.BottomRight.X).toBe(10)
      expect(renderable.selectionBounds!.BottomRight.Y).toBe(10)
      expect(renderable.disposed).toBe(false)
    })

    it('creates with null selection (no selection)', () => {
      const renderable = new EditorSelectionAnnotationRenderable(null, TEST_COLOR)
      expect(renderable.selectionBounds).toBeNull()
      expect(renderable.disposed).toBe(false)
    })

    it('creates with default altPixelOffset and offset', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      expect(renderable.altPixelOffset).toEqual({ x: 0, y: 0 })
      expect(renderable.offset).toEqual({ x: 0, y: 0 })
    })

    it('creates with custom altPixelOffset and offset', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(
        region,
        TEST_COLOR,
        { x: 10, y: 20 },
        { x: 1, y: 2 },
      )
      expect(renderable.altPixelOffset).toEqual({ x: 10, y: 20 })
      expect(renderable.offset).toEqual({ x: 1, y: 2 })
    })
  })

  // -------------------------------------------------------------------------
  // Color property
  // -------------------------------------------------------------------------

  describe('color property', () => {
    it('returns the configured color (defensive copy)', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const c = renderable.color
      expect(c.r).toBe(0)
      expect(c.g).toBe(255)
      expect(c.b).toBe(0)
      expect(c.a).toBe(128)
    })

    it('set/get preserves color values', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)

      const newColor = { r: 255, g: 128, b: 64, a: 200 }
      renderable.color = newColor

      const retrieved = renderable.color
      expect(retrieved.r).toBe(255)
      expect(retrieved.g).toBe(128)
      expect(retrieved.b).toBe(64)
      expect(retrieved.a).toBe(200)
    })

    it('color getter returns a copy (mutation does not affect internal state)', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const c = renderable.color
      c.r = 99
      expect(renderable.color.r).toBe(0)
    })

    it('color setter clones the input (mutation after set does not affect)', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const newColor = { r: 100, g: 200, b: 50, a: 255 }
      renderable.color = newColor
      newColor.r = 999
      expect(renderable.color.r).toBe(100)
    })

    it('color set does nothing when disposed', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      renderable.dispose()
      renderable.color = { r: 255, g: 0, b: 0, a: 255 }
      // Color should remain unchanged after disposal
      expect(renderable.color.r).toBe(TEST_COLOR.r)
    })
  })

  // -------------------------------------------------------------------------
  // World-space vertex computation
  // -------------------------------------------------------------------------

  describe('computeWorldCorners', () => {
    it('computes 4+1 corner points for a rectangular selection', () => {
      const region = makeRegion(5, 10, 15, 20)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const corners = renderable.computeWorldCorners(testCellToWorld)
      expect(corners).not.toBeNull()
      expect(corners!.length).toBe(5) // 4 corners + closing point

      // Top-left: extended 1 cell outward
      expect(corners![0]!.x).toBe(4)  // 5 - 1
      expect(corners![0]!.z).toBe(9)  // 10 - 1

      // Top-right
      expect(corners![1]!.x).toBe(16) // 15 + 1
      expect(corners![1]!.z).toBe(9)  // 10 - 1

      // Bottom-right
      expect(corners![2]!.x).toBe(16) // 15 + 1
      expect(corners![2]!.z).toBe(21) // 20 + 1

      // Bottom-left
      expect(corners![3]!.x).toBe(4)  // 5 - 1
      expect(corners![3]!.z).toBe(21) // 20 + 1

      // Closing point (equals first point)
      expect(corners![4]!.x).toBe(corners![0]!.x)
      expect(corners![4]!.z).toBe(corners![0]!.z)
    })

    it('computes corners for single-cell selection', () => {
      const region = makeRegion(10, 10, 10, 10)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const corners = renderable.computeWorldCorners(testCellToWorld)
      expect(corners).not.toBeNull()
      expect(corners!.length).toBe(5)

      // Single cell: extended to a 3x3 bounding box
      // topLeft = (9,9), topRight = (11,9), bottomRight = (11,11), bottomLeft = (9,11)
      expect(corners![0]!.x).toBe(9)
      expect(corners![0]!.z).toBe(9)
      expect(corners![2]!.x).toBe(11)
      expect(corners![2]!.z).toBe(11)
    })

    it('returns null when selection is null', () => {
      const renderable = new EditorSelectionAnnotationRenderable(null, TEST_COLOR)
      const corners = renderable.computeWorldCorners(testCellToWorld)
      expect(corners).toBeNull()
    })

    it('applies cell offset to corner positions', () => {
      const region = makeRegion(5, 5, 10, 10)
      const renderable = new EditorSelectionAnnotationRenderable(
        region,
        TEST_COLOR,
        undefined,
        { x: 3, y: 5 },
      )
      const corners = renderable.computeWorldCorners(testCellToWorld)

      // topLeft = (5 + 3 - 1, 5 + 5 - 1) = (7, 9)
      expect(corners![0]!.x).toBe(7)
      expect(corners![0]!.z).toBe(9)

      // bottomRight = (10 + 3 + 1, 10 + 5 + 1) = (14, 16)
      expect(corners![2]!.x).toBe(14)
      expect(corners![2]!.z).toBe(16)
    })

    it('correctly applies conversion function with tileScale', () => {
      const region = makeRegion(0, 0, 2, 2)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)

      // Custom conversion that applies tileScale
      const scaleCellToWorld = (cpos: CPos, height: number): WorldPoint => ({
        x: cpos.X * 1024,
        y: height * 512,
        z: cpos.Y * 1024,
      })

      const corners = renderable.computeWorldCorners(scaleCellToWorld, 1024)
      // topLeft = (-1, -1) * 1024
      expect(corners![0]!.x).toBe(-1024)
      expect(corners![0]!.z).toBe(-1024)
      // bottomRight = (3, 3) * 1024
      expect(corners![2]!.x).toBe(3072)
      expect(corners![2]!.z).toBe(3072)
    })
  })

  // -------------------------------------------------------------------------
  // selectionBounds property
  // -------------------------------------------------------------------------

  describe('selectionBounds property', () => {
    it('set/get preserves CellCoordsRegion values', () => {
      const region1 = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region1, TEST_COLOR)

      const region2 = makeRegion(10, 20, 30, 40)
      renderable.selectionBounds = region2

      expect(renderable.selectionBounds!.TopLeft.X).toBe(10)
      expect(renderable.selectionBounds!.TopLeft.Y).toBe(20)
      expect(renderable.selectionBounds!.BottomRight.X).toBe(30)
      expect(renderable.selectionBounds!.BottomRight.Y).toBe(40)
    })

    it('sets selectionBounds to null', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      renderable.selectionBounds = null
      expect(renderable.selectionBounds).toBeNull()
    })

    it('computes null corners after setting bounds to null', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      expect(renderable.computeWorldCorners(testCellToWorld)).not.toBeNull()

      renderable.selectionBounds = null
      expect(renderable.computeWorldCorners(testCellToWorld)).toBeNull()
    })

    it('set does nothing when disposed', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      renderable.dispose()
      renderable.selectionBounds = makeRegion(10, 10, 20, 20)
      // Should remain null (disposed state cleared it)
      expect(renderable.selectionBounds).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Dispose lifecycle
  // -------------------------------------------------------------------------

  describe('dispose lifecycle', () => {
    it('dispose cleans up resources and marks as disposed', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      expect(renderable.disposed).toBe(false)

      renderable.dispose()
      expect(renderable.disposed).toBe(true)
      expect(renderable.selectionBounds).toBeNull()
      expect(renderable.linesMesh).toBeNull()
    })

    it('double dispose is safe (idempotent)', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      renderable.dispose()
      // Should not throw
      expect(() => renderable.dispose()).not.toThrow()
      expect(renderable.disposed).toBe(true)
    })

    it('dispose fires onDisposed callback', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const onDisposed = vi.fn()
      renderable._onDisposed = onDisposed

      renderable.dispose()
      expect(onDisposed).toHaveBeenCalledTimes(1)
    })

    it('double dispose fires callback only once', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const onDisposed = vi.fn()
      renderable._onDisposed = onDisposed

      renderable.dispose()
      renderable.dispose()
      expect(onDisposed).toHaveBeenCalledTimes(1)
    })

    it('after dispose, computeWorldCorners returns null', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      renderable.dispose()
      expect(renderable.computeWorldCorners(testCellToWorld)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty CellCoordsRegion (single cell at origin)', () => {
      const region = makeRegion(0, 0, 0, 0)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      expect(renderable.selectionBounds).not.toBeNull()
      const corners = renderable.computeWorldCorners(testCellToWorld)
      expect(corners).not.toBeNull()
      // Single cell: -1 to +1 gives a 2x2 bounding box
      expect(corners![0]!.x).toBe(-1)
      expect(corners![0]!.z).toBe(-1)
    })

    it('handles negative cell coordinates', () => {
      const region = makeRegion(-10, -5, 10, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const corners = renderable.computeWorldCorners(testCellToWorld)
      expect(corners).not.toBeNull()
      // topLeft = (-11, -6), bottomRight = (11, 6)
      expect(corners![0]!.x).toBe(-11)
      expect(corners![0]!.z).toBe(-6)
      expect(corners![2]!.x).toBe(11)
      expect(corners![2]!.z).toBe(6)
    })

    it('handles large region (many cells)', () => {
      const region = makeRegion(0, 0, 500, 500)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      const corners = renderable.computeWorldCorners(testCellToWorld)
      expect(corners).not.toBeNull()
      expect(corners![0]!.x).toBe(-1)
      expect(corners![0]!.z).toBe(-1)
      expect(corners![2]!.x).toBe(501)
      expect(corners![2]!.z).toBe(501)
    })

    it('multiple instances are independent', () => {
      const region1 = makeRegion(0, 0, 5, 5)
      const region2 = makeRegion(10, 10, 20, 20)
      const r1 = new EditorSelectionAnnotationRenderable(region1, { r: 255, g: 0, b: 0, a: 255 })
      const r2 = new EditorSelectionAnnotationRenderable(region2, { r: 0, g: 0, b: 255, a: 128 })

      expect(r1.color.r).toBe(255)
      expect(r2.color.b).toBe(255)

      const c1 = r1.computeWorldCorners(testCellToWorld)!
      const c2 = r2.computeWorldCorners(testCellToWorld)!

      // Different regions produce different corners
      expect(c1[0]!.x).not.toBe(c2[0]!.x)
    })
  })

  // -------------------------------------------------------------------------
  // render() method (compatibility — no-op in Babylon.js)
  // -------------------------------------------------------------------------

  describe('render', () => {
    it('render() does not throw (no-op compatibility method)', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      expect(() => renderable.render(null)).not.toThrow()
      expect(() => renderable.render({})).not.toThrow()
    })

    it('render() does not throw on disposed instance', () => {
      const region = makeRegion(0, 0, 5, 5)
      const renderable = new EditorSelectionAnnotationRenderable(region, TEST_COLOR)
      renderable.dispose()
      expect(() => renderable.render(null)).not.toThrow()
    })
  })
})
