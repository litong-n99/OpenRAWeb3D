/**
 * Rectangle.ts — Axis-aligned integer rectangle
 * OpenRA 对照: OpenRA.Game/Primitives/Rectangle.cs
 *
 * 核心范式转换:
 * - C# readonly struct (value type) → immutable TypeScript class
 * - C# operator overloading → static methods
 * - int2/Size dependencies → deferred (TODO markers)
 */

// ---------------------------------------------------------------------------
// Rectangle
// ---------------------------------------------------------------------------

/**
 * Axis-aligned integer rectangle with X, Y, Width, Height.
 *
 * OpenRA 对照: Rectangle (readonly struct)
 *
 * Immutable. Used by MPos.Clamp, CVec.Clamp, and SpatiallyPartitioned.
 */
export class Rectangle {
  /** X coordinate of the top-left corner.
   *
   * OpenRA 对照: Rectangle.X
   */
  readonly X: number

  /** Y coordinate of the top-left corner.
   *
   * OpenRA 对照: Rectangle.Y
   */
  readonly Y: number

  /** Width of the rectangle.
   *
   * OpenRA 对照: Rectangle.Width
   */
  readonly Width: number

  /** Height of the rectangle.
   *
   * OpenRA 对照: Rectangle.Height
   */
  readonly Height: number

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  /** Empty rectangle at (0, 0, 0, 0).
   *
   * OpenRA 对照: Rectangle.Empty
   */
  static readonly Empty = new Rectangle(0, 0, 0, 0)

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a Rectangle from X, Y, Width, Height.
   *
   * OpenRA 对照: Rectangle(int x, int y, int width, int height)
   */
  constructor(x: number, y: number, width: number, height: number) {
    this.X = x | 0
    this.Y = y | 0
    this.Width = width | 0
    this.Height = height | 0
  }

  /**
   * Construct a Rectangle from left, top, right, bottom edges.
   *
   * OpenRA 对照: Rectangle.FromLTRB(int, int, int, int)
   */
  static fromLTRB(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): Rectangle {
    return new Rectangle(left, top, right - left, bottom - top)
  }

  // -----------------------------------------------------------------------
  // Edge properties
  // -----------------------------------------------------------------------

  /** Left edge X.
   *
   * OpenRA 对照: Rectangle.Left
   */
  get Left(): number {
    return this.X
  }

  /** Right edge X.
   *
   * OpenRA 对照: Rectangle.Right
   */
  get Right(): number {
    return this.X + this.Width
  }

  /** Top edge Y.
   *
   * OpenRA 对照: Rectangle.Top
   */
  get Top(): number {
    return this.Y
  }

  /** Bottom edge Y.
   *
   * OpenRA 对照: Rectangle.Bottom
   */
  get Bottom(): number {
    return this.Y + this.Height
  }

  /** Whether this rectangle is the empty rectangle.
   *
   * OpenRA 对照: Rectangle.IsEmpty
   */
  get isEmpty(): boolean {
    return this.X === 0 && this.Y === 0 && this.Width === 0 && this.Height === 0
  }

  // -----------------------------------------------------------------------
  // Contains
  // -----------------------------------------------------------------------

  /**
   * Check whether the rectangle contains a point (x, y).
   *
   * OpenRA 对照: Rectangle.Contains(int, int)
   */
  contains(x: number, y: number): boolean {
    return x >= this.Left && x < this.Right && y >= this.Top && y < this.Bottom
  }

  /**
   * Check whether this rectangle fully contains another rectangle.
   *
   * OpenRA 对照: Rectangle.Contains(Rectangle)
   */
  containsRect(rect: Rectangle): boolean {
    return Rectangle.equals(rect, Rectangle.intersect(this, rect))
  }

  // -----------------------------------------------------------------------
  // Intersection
  // -----------------------------------------------------------------------

  /**
   * Check whether this rectangle intersects with another.
   *
   * OpenRA 对照: Rectangle.IntersectsWith(Rectangle)
   */
  intersectsWith(rect: Rectangle): boolean {
    return (
      this.Left < rect.Right &&
      this.Right > rect.Left &&
      this.Top < rect.Bottom &&
      this.Bottom > rect.Top
    )
  }

  /**
   * Check inclusive intersection (used internally by Intersect).
   *
   * OpenRA 对照: Rectangle.IntersectsWithInclusive(Rectangle)
   */
  private intersectsWithInclusive(rect: Rectangle): boolean {
    return (
      this.Left <= rect.Right &&
      this.Right >= rect.Left &&
      this.Top <= rect.Bottom &&
      this.Bottom >= rect.Top
    )
  }

  /**
   * Compute the intersection of two rectangles.
   *
   * OpenRA 对照: Rectangle.Intersect(Rectangle, Rectangle)
   */
  static intersect(a: Rectangle, b: Rectangle): Rectangle {
    if (!a.intersectsWithInclusive(b)) return Rectangle.Empty

    return Rectangle.fromLTRB(
      Math.max(a.Left, b.Left),
      Math.max(a.Top, b.Top),
      Math.min(a.Right, b.Right),
      Math.min(a.Bottom, b.Bottom),
    )
  }

  /**
   * Compute the union bounding box of two rectangles.
   *
   * OpenRA 对照: Rectangle.Union(Rectangle, Rectangle)
   */
  static union(a: Rectangle, b: Rectangle): Rectangle {
    return Rectangle.fromLTRB(
      Math.min(a.Left, b.Left),
      Math.min(a.Top, b.Top),
      Math.max(a.Right, b.Right),
      Math.max(a.Bottom, b.Bottom),
    )
  }

  // -----------------------------------------------------------------------
  // Static operators
  // -----------------------------------------------------------------------

  /**
   * Test two rectangles for equality.
   *
   * OpenRA 对照: Rectangle.operator==
   */
  static equals(a: Rectangle, b: Rectangle): boolean {
    return (
      a.X === b.X &&
      a.Y === b.Y &&
      a.Width === b.Width &&
      a.Height === b.Height
    )
  }

  /**
   * Multiply rectangle dimensions by a scalar.
   *
   * OpenRA 对照: Rectangle.operator*(int, Rectangle)
   */
  static multiply(a: number, b: Rectangle): Rectangle {
    return new Rectangle(a * b.X, a * b.Y, a * b.Width, a * b.Height)
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another Rectangle.
   *
   * OpenRA 对照: Rectangle.Equals(Rectangle)
   */
  equals(other: Rectangle): boolean {
    return Rectangle.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: Rectangle.ToString()
   */
  toString(): string {
    return `${this.X},${this.Y},${this.Width},${this.Height}`
  }
}

// NOTE: int2 Location and Size Size properties from OpenRA Rectangle are
// deferred pending migration of those primitives. See TODO-3.A.17 (int2)
// and TODO-3.A.18 (Size) in docs/actor_system_migration_plan.md.
// TopLeft/TopRight/BottomLeft/BottomRight corner properties are also
// deferred since they depend on int2.
