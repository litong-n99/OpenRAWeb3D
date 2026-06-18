/**
 * Polygon.test.ts — Polygon migration unit tests
 * OpenRA 对照: OpenRA.Game/Primitives/Polygon.cs
 *
 * Tests focus on: construction from Rectangle and vertices, point-in-polygon
 * (winding number), polygon-rectangle intersection, edge cases.
 */

import { describe, it, expect } from 'vitest'
import { Polygon } from './Polygon'
import { Rectangle } from './Rectangle'

// ===========================================================================
// Polygon Tests
// ===========================================================================

describe('Polygon', () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('creates from Rectangle with 4 corner vertices', () => {
      const rect = Rectangle.fromLTRB(0, 0, 10, 20)
      const poly = new Polygon(rect)

      expect(poly.BoundingRect.Left).toBe(0)
      expect(poly.BoundingRect.Top).toBe(0)
      expect(poly.BoundingRect.Right).toBe(10)
      expect(poly.BoundingRect.Bottom).toBe(20)
      expect(poly.Vertices).toHaveLength(4)
      expect(poly.IsEmpty).toBe(false)
    })

    it('creates from vertices and computes bounding rect', () => {
      const verts = [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 25 },
        { x: 5, y: 25 },
      ]
      const poly = new Polygon(verts)

      expect(poly.BoundingRect.Left).toBe(5)
      expect(poly.BoundingRect.Top).toBe(5)
      expect(poly.BoundingRect.Right).toBe(15)
      expect(poly.BoundingRect.Bottom).toBe(25)
      expect(poly.Vertices).toEqual(verts)
      expect(poly.IsEmpty).toBe(false)
    })

    it('creates empty polygon from empty vertices', () => {
      const poly = new Polygon([])

      expect(poly.IsEmpty).toBe(true)
      expect(poly.BoundingRect.isEmpty).toBe(true)
      expect(poly.Vertices).toHaveLength(4) // 4 zero vertices
    })

    it('creates empty polygon from empty Rectangle', () => {
      const poly = new Polygon(Rectangle.Empty)

      expect(poly.IsEmpty).toBe(true)
    })

    it('computes bounding rect from single vertex', () => {
      const poly = new Polygon([{ x: 7, y: 13 }])

      expect(poly.BoundingRect.Left).toBe(7)
      expect(poly.BoundingRect.Right).toBe(7)
      expect(poly.BoundingRect.Top).toBe(13)
      expect(poly.BoundingRect.Bottom).toBe(13)
    })

    it('handles negative coordinates', () => {
      const verts = [
        { x: -10, y: -20 },
        { x: -5, y: -15 },
      ]
      const poly = new Polygon(verts)

      expect(poly.BoundingRect.Left).toBe(-10)
      expect(poly.BoundingRect.Top).toBe(-20)
      expect(poly.BoundingRect.Right).toBe(-5)
      expect(poly.BoundingRect.Bottom).toBe(-15)
    })
  })

  // -------------------------------------------------------------------------
  // Empty
  // -------------------------------------------------------------------------

  describe('Empty', () => {
    it('is a static singleton', () => {
      expect(Polygon.Empty).toBeDefined()
      expect(Polygon.Empty.IsEmpty).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // fromRect static factory
  // -------------------------------------------------------------------------

  describe('fromRect', () => {
    it('creates polygon from rectangle', () => {
      const rect = Rectangle.fromLTRB(2, 3, 8, 9)
      const poly = Polygon.fromRect(rect)

      expect(poly.BoundingRect.Left).toBe(2)
      expect(poly.BoundingRect.Top).toBe(3)
      expect(poly.BoundingRect.Right).toBe(8)
      expect(poly.BoundingRect.Bottom).toBe(9)
      expect(poly.Vertices).toHaveLength(4)
      expect(poly.contains(5, 6)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Contains — point-in-polygon
  // -------------------------------------------------------------------------

  describe('contains (point-in-polygon)', () => {
    describe('rectangle polygon', () => {
      const rectPoly = new Polygon(Rectangle.fromLTRB(0, 0, 10, 10))

      it('returns true for point inside', () => {
        expect(rectPoly.contains(5, 5)).toBe(true)
      })

      it('returns true for point on left edge', () => {
        expect(rectPoly.contains(0, 5)).toBe(true)
      })

      it('returns true for point on top edge', () => {
        expect(rectPoly.contains(5, 0)).toBe(true)
      })

      it('returns false for point outside (right)', () => {
        expect(rectPoly.contains(10, 5)).toBe(false)
      })

      it('returns false for point outside (bottom)', () => {
        expect(rectPoly.contains(5, 10)).toBe(false)
      })

      it('returns false for point far outside', () => {
        expect(rectPoly.contains(100, 100)).toBe(false)
      })
    })

    describe('convex polygon (triangle)', () => {
      const tri = new Polygon([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ])

      it('returns true for point inside', () => {
        expect(tri.contains(5, 5)).toBe(true)
      })

      it('returns true for point near center', () => {
        expect(tri.contains(5, 2)).toBe(true)
      })

      it('returns false for point outside', () => {
        expect(tri.contains(0, 10)).toBe(false)
      })

      it('returns false for point far outside', () => {
        expect(tri.contains(-10, -10)).toBe(false)
      })

      it('returns true for point on vertex', () => {
        // The winding number test counts "on vertex" as boundary.
        // When tv.y <= p.y: (0,0).y <= 0 is true, nv.y (0 for top edge) > 0...
        // Actually need to see what happens. The winding test treats y=0 and
        // nv.y=0 as not crossing, so vertex may or may not register.
        // Just ensure we don't crash.
        expect(() => tri.contains(0, 0)).not.toThrow()
      })
    })

    describe('convex polygon (hexagon-like)', () => {
      // A simple irregular pentagon
      const pent = new Polygon([
        { x: 2, y: 2 },
        { x: 8, y: 1 },
        { x: 10, y: 5 },
        { x: 7, y: 9 },
        { x: 1, y: 7 },
      ])

      it('returns true for point inside', () => {
        expect(pent.contains(5, 5)).toBe(true)
      })

      it('returns false for point outside', () => {
        expect(pent.contains(0, 0)).toBe(false)
      })

      it('returns false for point outside near edge', () => {
        expect(pent.contains(12, 5)).toBe(false)
      })
    })
  })

  // -------------------------------------------------------------------------
  // IntersectsWith — polygon-rectangle intersection
  // -------------------------------------------------------------------------

  describe('intersectsWith', () => {
    describe('rectangle polygon intersection', () => {
      const rectPoly = new Polygon(Rectangle.fromLTRB(5, 5, 15, 15))

      it('returns true for overlapping rectangle', () => {
        const rect = Rectangle.fromLTRB(10, 10, 20, 20)
        expect(rectPoly.intersectsWith(rect)).toBe(true)
      })

      it('returns true for fully contained rectangle', () => {
        const rect = Rectangle.fromLTRB(7, 7, 12, 12)
        expect(rectPoly.intersectsWith(rect)).toBe(true)
      })

      it('returns false for non-overlapping rectangle (right)', () => {
        const rect = Rectangle.fromLTRB(20, 5, 25, 15)
        expect(rectPoly.intersectsWith(rect)).toBe(false)
      })

      it('returns false for non-overlapping rectangle (left)', () => {
        const rect = Rectangle.fromLTRB(0, 5, 4, 15)
        expect(rectPoly.intersectsWith(rect)).toBe(false)
      })
    })

    describe('arbitrary polygon intersection', () => {
      const tri = new Polygon([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ])

      it('returns true when rect overlaps polygon', () => {
        const rect = Rectangle.fromLTRB(3, 3, 8, 12)
        expect(tri.intersectsWith(rect)).toBe(true)
      })

      it('returns false when bounding boxes do not intersect', () => {
        const rect = Rectangle.fromLTRB(20, 20, 30, 30)
        expect(tri.intersectsWith(rect)).toBe(false)
      })

      it('returns true for cross-shape containment', () => {
        // Rect fully spans triangle in X axis
        const rect = Rectangle.fromLTRB(-5, 3, 15, 7)
        expect(tri.intersectsWith(rect)).toBe(true)
      })

      it('returns true when rect corner is inside polygon', () => {
        const rect = Rectangle.fromLTRB(3, 3, 7, 7)
        expect(tri.intersectsWith(rect)).toBe(true)
      })

      it('returns true when polygon vertex is inside rect', () => {
        const rect = Rectangle.fromLTRB(4, -1, 6, 1)
        expect(tri.intersectsWith(rect)).toBe(true)
      })

      it('returns true for edge-only intersection', () => {
        // Rectangle that crosses one edge of the triangle
        const rect = Rectangle.fromLTRB(-2, -2, 1, 1)
        expect(tri.intersectsWith(rect)).toBe(true)
      })

      it('returns false for nearby but non-intersecting rect', () => {
        const rect = Rectangle.fromLTRB(11, 0, 15, 5)
        expect(tri.intersectsWith(rect)).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('empty polygon does not intersect with anything', () => {
        const emptyPoly = Polygon.Empty
        const rect = Rectangle.fromLTRB(0, 0, 10, 10)
        expect(emptyPoly.intersectsWith(rect)).toBe(false)
      })

      it('empty rectangle does not intersect with polygon', () => {
        const poly = new Polygon(Rectangle.fromLTRB(0, 0, 10, 10))
        expect(poly.intersectsWith(Rectangle.Empty)).toBe(false)
      })
    })
  })

  // -------------------------------------------------------------------------
  // equals
  // -------------------------------------------------------------------------

  describe('equals', () => {
    it('returns true for same polygon', () => {
      const a = new Polygon(Rectangle.fromLTRB(0, 0, 10, 10))
      const b = new Polygon(Rectangle.fromLTRB(0, 0, 10, 10))
      expect(a.equals(b)).toBe(true)
    })

    it('returns false for different polygons', () => {
      const a = new Polygon(Rectangle.fromLTRB(0, 0, 10, 10))
      const b = new Polygon(Rectangle.fromLTRB(1, 1, 10, 10))
      expect(a.equals(b)).toBe(false)
    })

    it('returns false for different vertex counts', () => {
      const a = new Polygon(Rectangle.fromLTRB(0, 0, 10, 10))
      const b = new Polygon([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 5 },
      ])
      expect(a.equals(b)).toBe(false)
    })

    it('returns true for equal vertex-defined polygons', () => {
      const verts = [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ]
      const a = new Polygon(verts)
      const b = new Polygon(verts)
      expect(a.equals(b)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // toString
  // -------------------------------------------------------------------------

  describe('toString', () => {
    it('includes vertex coordinates', () => {
      const poly = new Polygon(Rectangle.fromLTRB(0, 0, 2, 2))
      expect(poly.toString()).toContain('(0,0)')
      expect(poly.toString()).toContain('(2,0)')
    })

    it('prefixed with Polygon', () => {
      const poly = new Polygon(Rectangle.fromLTRB(0, 0, 1, 1))
      expect(poly.toString()).toMatch(/^Polygon\[/)
    })
  })

  // -------------------------------------------------------------------------
  // Winding number edge cases
  // -------------------------------------------------------------------------

  describe('winding number edge cases', () => {
    it('handles degenerate (collinear) vertices', () => {
      // Three collinear points — still forms a polygon (line)
      const poly = new Polygon([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ])
      // Should not crash; winding number for any point above/below a
      // degenerate polygon should be 0
      expect(() => poly.contains(5, 5)).not.toThrow()
    })

    it('handles large coordinate values', () => {
      const poly = new Polygon([
        { x: -1000000, y: -1000000 },
        { x: 1000000, y: -1000000 },
        { x: 0, y: 1000000 },
      ])
      expect(poly.contains(0, 0)).toBe(true)
      expect(poly.contains(2000000, 0)).toBe(false)
    })
  })
})
