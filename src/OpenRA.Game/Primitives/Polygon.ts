/**
 * Polygon.ts — 2D polygon defined by vertices + bounding rectangle
 * OpenRA 对照: OpenRA.Game/Primitives/Polygon.cs
 *
 * 核心范式转换:
 * - C# readonly struct (value type) → immutable TypeScript class
 * - C# ImmutableArray<int2> → readonly Vec2[]
 * - C# int2 → Vec2 ({x: number, y: number})
 * - C# Exts.PolygonContains / Exts.LinesIntersect → private static methods
 */

import { Rectangle } from './Rectangle'

// ---------------------------------------------------------------------------
// Vec2 — 2D integer vector (对应 OpenRA int2)
// ---------------------------------------------------------------------------

/**
 * 2D integer vector used for polygon vertices.
 *
 * OpenRA 对照: int2
 */
export interface Vec2 {
  readonly x: number
  readonly y: number
}

// ---------------------------------------------------------------------------
// Polygon
// ---------------------------------------------------------------------------

/**
 * 2D polygon with vertex array and pre-computed bounding rectangle.
 *
 * OpenRA 对照: Polygon (readonly struct)
 *
 * Supports point-in-polygon (winding number algorithm), rectangle
 * intersection tests, and construction from either a Rectangle or an
 * array of vertices.
 *
 * Immutable: Vertices and BoundingRect are readonly.
 */
export class Polygon {
  // -------------------------------------------------------------------------
  // Static constants
  // -------------------------------------------------------------------------

  /** Empty polygon singleton.
   *
   * OpenRA 对照: Polygon.Empty
   */
  static readonly Empty = new Polygon(Rectangle.Empty)

  // -------------------------------------------------------------------------
  // Public readonly fields
  // -------------------------------------------------------------------------

  /** Pre-computed bounding rectangle enclosing all vertices.
   *
   * OpenRA 对照: Polygon.BoundingRect
   */
  readonly BoundingRect: Rectangle

  /** The polygon's vertices in counter-clockwise order.
   *
   * OpenRA 对照: Polygon.Vertices
   */
  readonly Vertices: readonly Vec2[]

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /** Whether this polygon is a simple axis-aligned rectangle.
   *
   * OpenRA 对照: Polygon.isRectangle (private)
   *
   * When true, `contains()` and `intersectsWith()` can use fast
   * axis-aligned rectangle checks instead of the winding number algorithm.
   */
  private readonly _isRectangle: boolean

  // -------------------------------------------------------------------------
  // Construction (overloaded: Rectangle or Vec2[])
  // -------------------------------------------------------------------------

  /**
   * Create a polygon from a Rectangle or an array of vertices.
   *
   * OpenRA 对照: Polygon(Rectangle) / Polygon(ImmutableArray<int2>)
   *
   * When constructed from a Rectangle, the polygon has 4 vertices at the
   * rect corners and uses fast rectangle checks for contains/intersects.
   * When constructed from vertices, the bounding rectangle is computed
   * from the min/max of all vertices.
   *
   * @param arg — a Rectangle or array of Vec2 vertices
   */
  constructor(arg: Rectangle | readonly Vec2[]) {
    if (arg instanceof Rectangle) {
      const bounds = arg
      this.BoundingRect = bounds
      this.Vertices = [
        { x: bounds.Left, y: bounds.Top },
        { x: bounds.Left, y: bounds.Bottom },
        { x: bounds.Right, y: bounds.Bottom },
        { x: bounds.Right, y: bounds.Top },
      ]
      this._isRectangle = true
    } else {
      const verts = arg
      if (verts.length > 0) {
        this.Vertices = verts
        let left = Number.MAX_SAFE_INTEGER
        let right = Number.MIN_SAFE_INTEGER
        let top = Number.MAX_SAFE_INTEGER
        let bottom = Number.MIN_SAFE_INTEGER
        // PERF: Direct loop, no forEach allocation.
        for (let i = 0; i < verts.length; i++) {
          const p = verts[i]
          left = Math.min(left, p.x)
          right = Math.max(right, p.x)
          top = Math.min(top, p.y)
          bottom = Math.max(bottom, p.y)
        }
        this.BoundingRect = Rectangle.fromLTRB(left, top, right, bottom)
        this._isRectangle = false
      } else {
        this._isRectangle = true
        this.BoundingRect = Rectangle.Empty
        this.Vertices = [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ]
      }
    }
  }

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  /** Whether this polygon is empty (bounding rectangle is empty).
   *
   * OpenRA 对照: Polygon.IsEmpty
   */
  get IsEmpty(): boolean {
    return this.BoundingRect.isEmpty
  }

  // -------------------------------------------------------------------------
  // Contains — point-in-polygon test
  // -------------------------------------------------------------------------

  /**
   * Test whether this polygon contains a point.
   *
   * OpenRA 对照: Polygon.Contains(int2)
   *
   * For rectangle-based polygons, this is a fast axis-aligned check.
   * For arbitrary polygons, this uses the winding number algorithm.
   *
   * @param x — the x coordinate to test
   * @param y — the y coordinate to test
   * @returns true if the point is inside the polygon
   */
  contains(x: number, y: number): boolean {
    if (this._isRectangle) {
      return this.BoundingRect.contains(x, y)
    }
    return Polygon._polygonContains(this.Vertices, { x, y })
  }

  // -------------------------------------------------------------------------
  // IntersectsWith — polygon-rectangle intersection
  // -------------------------------------------------------------------------

  /**
   * Test whether this polygon intersects with a rectangle.
   *
   * OpenRA 对照: Polygon.IntersectsWith(Rectangle)
   *
   * Uses a multi-stage test for efficiency:
   * 1. Fast bounding box intersection check
   * 2. Cross-shape containment check
   * 3. Corner-in-polygon check
   * 4. Vertex-in-rectangle check
   * 5. Line segment intersection test (expensive, last resort)
   *
   * @param rect — the rectangle to test intersection with
   * @returns true if the polygon and rectangle intersect
   */
  intersectsWith(rect: Rectangle): boolean {
    return Polygon._intersectsWithRect(this, rect)
  }

  // -------------------------------------------------------------------------
  // Static factory
  // -------------------------------------------------------------------------

  /**
   * Create a polygon from a Rectangle.
   *
   * OpenRA 对照: Polygon(Rectangle bounds)
   *
   * @param rect — the rectangle to convert to a polygon
   * @returns a new Polygon with 4 vertices at the rect corners
   */
  static fromRect(rect: Rectangle): Polygon {
    return new Polygon(rect)
  }

  // -------------------------------------------------------------------------
  // Equality and display
  // -------------------------------------------------------------------------

  /**
   * Test equality with another Polygon.
   *
   * Two polygons are equal if they have the same bounding rectangle
   * and the same vertices in the same order.
   *
   * @param other — the other polygon to compare
   * @returns true if equal
   */
  equals(other: Polygon): boolean {
    if (!Rectangle.equals(this.BoundingRect, other.BoundingRect)) {
      return false
    }
    if (this.Vertices.length !== other.Vertices.length) {
      return false
    }
    for (let i = 0; i < this.Vertices.length; i++) {
      if (
        this.Vertices[i].x !== other.Vertices[i].x ||
        this.Vertices[i].y !== other.Vertices[i].y
      ) {
        return false
      }
    }
    return true
  }

  /**
   * String representation.
   *
   * OpenRA 对照: Polygon.ToString()
   */
  toString(): string {
    const verts = this.Vertices.map((v) => `(${v.x},${v.y})`).join(',')
    return `Polygon[${verts}]`
  }

  // -------------------------------------------------------------------------
  // Private: Winding direction test
  // -------------------------------------------------------------------------

  /**
   * Compute the winding direction for three points.
   *
   * OpenRA 对照: Exts.WindingDirectionTest(int2, int2, int2)
   *
   * Returns the sign of the cross product (v1-v0) x (p-v0):
   *   >0  means counter-clockwise
   *   <0  means clockwise
   *   =0  means collinear
   *
   * @param v0 — first point of the segment
   * @param v1 — second point of the segment
   * @param p — the test point
   * @returns -1, 0, or 1
   */
  private static _windingDirection(v0: Vec2, v1: Vec2, p: Vec2): number {
    return Math.sign(
      (v1.x - v0.x) * (p.y - v0.y) - (p.x - v0.x) * (v1.y - v0.y),
    )
  }

  // -------------------------------------------------------------------------
  // Private: Winding number polygon contains
  // -------------------------------------------------------------------------

  /**
   * Test whether a polygon contains a point using the winding number algorithm.
   *
   * OpenRA 对照: Exts.PolygonContains(ImmutableArray<int2>, int2)
   *
   * Counts how many times the polygon winds around the point. A non-zero
   * winding number means the point is inside.
   *
   * @param vertices — the polygon vertices
   * @param p — the test point
   * @returns true if the point is inside the polygon
   */
  private static _polygonContains(
    vertices: readonly Vec2[],
    p: Vec2,
  ): boolean {
    let windingNumber = 0

    for (let i = 0; i < vertices.length; i++) {
      const tv = vertices[i]
      const nv = vertices[(i + 1) % vertices.length]

      if (
        tv.y <= p.y &&
        nv.y > p.y &&
        Polygon._windingDirection(tv, nv, p) > 0
      ) {
        windingNumber++
      } else if (
        tv.y > p.y &&
        nv.y <= p.y &&
        Polygon._windingDirection(tv, nv, p) < 0
      ) {
        windingNumber--
      }
    }

    return windingNumber !== 0
  }

  // -------------------------------------------------------------------------
  // Private: Line segment intersection test
  // -------------------------------------------------------------------------

  /**
   * Test whether two line segments intersect.
   *
   * OpenRA 对照: Exts.LinesIntersect(int2, int2, int2, int2)
   *
   * Segments AB and CD intersect if:
   *   - The orientation of (A,B,C) differs from (A,B,D), AND
   *   - The orientation of (C,D,A) differs from (C,D,B)
   * Assumes lines are not collinear.
   *
   * @param a — first endpoint of segment 1
   * @param b — second endpoint of segment 1
   * @param c — first endpoint of segment 2
   * @param d — second endpoint of segment 2
   * @returns true if the segments intersect
   */
  private static _linesIntersect(
    a: Vec2,
    b: Vec2,
    c: Vec2,
    d: Vec2,
  ): boolean {
    return (
      Polygon._windingDirection(c, d, a) !==
        Polygon._windingDirection(c, d, b) &&
      Polygon._windingDirection(a, b, c) !==
        Polygon._windingDirection(a, b, d)
    )
  }

  // -------------------------------------------------------------------------
  // Private: Full polygon-rectangle intersection logic
  // -------------------------------------------------------------------------

  /**
   * Full intersection test between a polygon and a rectangle.
   *
   * OpenRA 对照: Polygon.IntersectsWith(Rectangle)
   *
   * Uses progressive checks ordered by cost:
   *
   *   Easy case 1: Bounding boxes don't intersect → false
   *   Easy case 2: Cross-shape containment → true
   *   Easy case 3: Any rect corner is inside the polygon → true
   *   Easy case 4: Any polygon vertex is inside the rect → true
   *   Hard case: Check every edge pair for intersection
   *
   * @param poly — the polygon
   * @param rect — the rectangle
   * @returns true if they intersect
   */
  private static _intersectsWithRect(
    poly: Polygon,
    rect: Rectangle,
  ): boolean {
    const { BoundingRect, Vertices, _isRectangle } = poly

    // For rectangle polygons, use fast bounding box check
    if (_isRectangle) {
      return (
        BoundingRect.Left < rect.Right &&
        BoundingRect.Right > rect.Left &&
        BoundingRect.Top < rect.Bottom &&
        BoundingRect.Bottom > rect.Top
      )
    }

    // Easy case 1: Bounding boxes don't intersect
    if (
      !(
        BoundingRect.Left < rect.Right &&
        BoundingRect.Right > rect.Left &&
        BoundingRect.Top < rect.Bottom &&
        BoundingRect.Bottom > rect.Top
      )
    ) {
      return false
    }

    // Easy case 2: Cross-shape — rect fully spans polygon in one axis
    if (
      (rect.Left <= BoundingRect.Left && rect.Right >= BoundingRect.Right) ||
      (rect.Top <= BoundingRect.Top && rect.Bottom >= BoundingRect.Bottom)
    ) {
      return true
    }

    // Easy case 3: Any corner of rect is inside polygon
    if (
      Polygon._polygonContains(Vertices, {
        x: rect.Left,
        y: rect.Top,
      }) ||
      Polygon._polygonContains(Vertices, {
        x: rect.Right,
        y: rect.Top,
      }) ||
      Polygon._polygonContains(Vertices, {
        x: rect.Left,
        y: rect.Bottom,
      }) ||
      Polygon._polygonContains(Vertices, {
        x: rect.Right,
        y: rect.Bottom,
      })
    ) {
      return true
    }

    // Easy case 4: Any polygon vertex is inside rect
    for (let i = 0; i < Vertices.length; i++) {
      if (rect.contains(Vertices[i].x, Vertices[i].y)) {
        return true
      }
    }

    // Hard case: Check line segment intersections
    const rectVerts: Vec2[] = [
      { x: rect.Left, y: rect.Top },
      { x: rect.Left, y: rect.Bottom },
      { x: rect.Right, y: rect.Bottom },
      { x: rect.Right, y: rect.Top },
    ]

    for (let i = 0; i < Vertices.length; i++) {
      const v0 = Vertices[i]
      const v1 = Vertices[(i + 1) % Vertices.length]
      for (let j = 0; j < 4; j++) {
        const r0 = rectVerts[j]
        const r1 = rectVerts[(j + 1) % 4]
        if (Polygon._linesIntersect(v0, v1, r0, r1)) {
          return true
        }
      }
    }

    return false
  }
}
