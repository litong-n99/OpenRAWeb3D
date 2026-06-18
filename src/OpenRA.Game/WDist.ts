/**
 * WDist.ts — 1D world distance (1024 units = 1 cell)
 * OpenRA 对照: OpenRA.Game/WDist.cs
 *
 * 核心范式转换:
 * - C# struct (value type) → immutable TypeScript class
 * - C# operator overloading → static methods
 * - C# comparison operators → static comparison methods
 * - FromPDF deferred (MersenneTwister not yet migrated)
 */

// ---------------------------------------------------------------------------
// WDist
// ---------------------------------------------------------------------------

/**
 * 1D world distance with range comparison support.
 *
 * OpenRA 对照: WDist (readonly struct, IComparable)
 *
 * Immutable. All arithmetic operations return new WDist instances.
 * 1024 WDist units = 1 cell.
 */
export class WDist {
  /** The raw distance value.
   *
   * OpenRA 对照: WDist.Length
   */
  readonly length: number

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  /** Zero distance.
   *
   * OpenRA 对照: WDist.Zero
   */
  static readonly Zero = new WDist(0)

  /** Maximum possible distance.
   *
   * OpenRA 对照: WDist.MaxValue
   */
  static readonly MaxValue = new WDist(2147483647)

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a WDist from a raw length value.
   *
   * OpenRA 对照: WDist(int r)
   */
  constructor(r: number) {
    this.length = r | 0 // truncate to int32
  }

  // -----------------------------------------------------------------------
  // Factory methods
  // -----------------------------------------------------------------------

  /**
   * Create a WDist from a cell count (1 cell = 1024 sub-units).
   *
   * OpenRA 对照: WDist.FromCells(int cells)
   */
  static fromCells(cells: number): WDist {
    return new WDist(1024 * cells)
  }

  /**
   * Parse a distance string in the format "XcY" where X is cells and Y is sub-units.
   * Examples: "5c512", "0c256", "3", "512"
   *
   * OpenRA 对照: WDist.TryParse(string s, out WDist result)
   *
   * @returns A valid WDist if parsing succeeded, or null.
   */
  static tryParse(s: string): WDist | null {
    if (!s || s.length === 0) return null

    const lower = s.toLowerCase()
    const components = lower.split('c')
    let cell = 0
    let subcell: number

    if (components.length === 2) {
      const cellParsed = parseInt(components[0], 10)
      if (isNaN(cellParsed)) return null
      const subcellParsed = parseInt(components[1], 10)
      if (isNaN(subcellParsed)) return null
      cell = cellParsed
      subcell = subcellParsed
    } else if (components.length === 1) {
      const subcellParsed = parseInt(components[0], 10)
      if (isNaN(subcellParsed)) return null
      subcell = subcellParsed
    } else {
      return null
    }

    // Propagate sign to fractional part
    if (cell < 0) subcell = -subcell

    return new WDist(1024 * cell + subcell)
  }

  // NOTE: fromPDF() is deferred pending MersenneTwister migration.
  // See  in docs/actor_system_migration_plan.md
  // When implemented:
  //   static fromPDF(r: MersenneTwisterLike, samples: number): WDist {
  //     // Sum samples random integers in [-1024, 1024] then divide by samples
  //   }

  // -----------------------------------------------------------------------
  // Derived properties
  // -----------------------------------------------------------------------

  /** Square of the length.
   *
   * OpenRA 对照: WDist.LengthSquared
   */
  get lengthSquared(): number {
    return this.length * this.length
  }

  // -----------------------------------------------------------------------
  // Static operators (OpenRA operator overloading → static methods)
  // -----------------------------------------------------------------------

  /**
   * Add two distances.
   *
   * OpenRA 对照: WDist.operator+(WDist, WDist)
   */
  static add(a: WDist, b: WDist): WDist {
    return new WDist(a.length + b.length)
  }

  /**
   * Subtract b from a.
   *
   * OpenRA 对照: WDist.operator-(WDist, WDist)
   */
  static subtract(a: WDist, b: WDist): WDist {
    return new WDist(a.length - b.length)
  }

  /**
   * Negate a distance.
   *
   * OpenRA 对照: WDist.operator-(WDist)
   */
  static negate(a: WDist): WDist {
    return new WDist(-a.length)
  }

  /**
   * Multiply distance by a scalar.
   *
   * OpenRA 对照: WDist.operator*(WDist, int)
   */
  static multiply(a: WDist, b: number): WDist {
    return new WDist(a.length * b)
  }

  /**
   * Multiply scalar by distance.
   *
   * OpenRA 对照: WDist.operator*(int, WDist)
   */
  static multiplyScalar(a: number, b: WDist): WDist {
    return new WDist(a * b.length)
  }

  /**
   * Divide distance by a scalar.
   *
   * OpenRA 对照: WDist.operator/(WDist, int)
   */
  static divide(a: WDist, b: number): WDist {
    return new WDist(a.length / b)
  }

  /**
   * Test a < b.
   *
   * OpenRA 对照: WDist.operator<(WDist, WDist)
   */
  static lessThan(a: WDist, b: WDist): boolean {
    return a.length < b.length
  }

  /**
   * Test a > b.
   *
   * OpenRA 对照: WDist.operator>(WDist, WDist)
   */
  static greaterThan(a: WDist, b: WDist): boolean {
    return a.length > b.length
  }

  /**
   * Test a <= b.
   *
   * OpenRA 对照: WDist.operator<=(WDist, WDist)
   */
  static lessThanOrEqual(a: WDist, b: WDist): boolean {
    return a.length <= b.length
  }

  /**
   * Test a >= b.
   *
   * OpenRA 对照: WDist.operator>=(WDist, WDist)
   */
  static greaterThanOrEqual(a: WDist, b: WDist): boolean {
    return a.length >= b.length
  }

  /**
   * Test two WDist instances for equality.
   *
   * OpenRA 对照: WDist.operator==(WDist, WDist)
   */
  static equals(a: WDist, b: WDist): boolean {
    return a.length === b.length
  }

  // -----------------------------------------------------------------------
  // Comparison
  // -----------------------------------------------------------------------

  /**
   * Compare this distance to another.
   * Returns negative if this < other, 0 if equal, positive if this > other.
   *
   * OpenRA 对照: WDist.CompareTo(WDist)
   */
  compareTo(other: WDist): number {
    return this.length - other.length
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another WDist.
   *
   * OpenRA 对照: WDist.Equals(WDist)
   */
  equals(other: WDist): boolean {
    return this.length === other.length
  }

  /**
   * String representation in "XcY" format.
   *
   * OpenRA 对照: WDist.ToString()
   */
  toString(): string {
    const absLength = Math.abs(this.length)
    const absValue = `${(absLength / 1024) | 0}c${absLength % 1024}`
    return this.length < 0 ? '-' + absValue : absValue
  }
}
