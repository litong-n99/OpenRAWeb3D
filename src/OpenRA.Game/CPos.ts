/**
 * CPos.ts — Cell position (bit-packed X, Y, Layer integer coordinates)
 * OpenRA 对照: OpenRA.Game/CPos.cs
 *
 * 核心范式转换:
 * - C# readonly struct with bit-packed Int32 → immutable TypeScript class
 * - C# operator overloading → static methods
 * - Lua scripting interface → removed (not needed in TS)
 * - 32-bit bit packing exactly matches OpenRA:
 *   X (12-bit signed, bits 31-20) | Y (12-bit signed, bits 19-8) | Layer (8-bit, bits 7-0)
 */

import { MPos } from './MPos'
import { MapGridType, type MapGridType as MapGridTypeEnum } from './Map/MapGridType'
import { CVec } from './CVec'

// ---------------------------------------------------------------------------
// CPos
// ---------------------------------------------------------------------------

/**
 * Cell position with packed bit representation.
 *
 * OpenRA 对照: CPos (readonly struct)
 *
 * Coordinates are packed in a 32-bit signed integer:
 *   X (12-bit signed, -2048..2047): bits 31-20
 *   Y (12-bit signed, -2048..2047): bits 19-8
 *   Layer (8-bit unsigned, 0-255): bits 7-0
 *
 * Immutable. All operations return new CPos instances.
 */
export class CPos {
  /** Packed bit representation.
   *
   * OpenRA 对照: CPos.Bits
   */
  readonly Bits: number

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  /** Zero cell position (0, 0, 0).
   *
   * OpenRA 对照: CPos.Zero
   */
  static readonly Zero = CPos.fromBits(0)

  // -----------------------------------------------------------------------
  // Extraction
  // -----------------------------------------------------------------------

  /**
   * X coordinate (12-bit signed, -2048..2047).
   *
   * OpenRA 对照: CPos.X
   *
   * Padded to MSB, so bit shift does the correct sign extension.
   */
  get X(): number {
    return this.Bits >> 20
  }

  /**
   * Y coordinate (12-bit signed, -2048..2047).
   *
   * OpenRA 对照: CPos.Y
   *
   * Align with a 16-bit short, then shift for correct sign extension.
   */
  get Y(): number {
    // (short)(Bits >> 4) >> 4
    // Step 1: shift Y into bits 15-4
    // Step 2: mask to 16 bits (short cast)
    // Step 3: convert to signed 16-bit
    // Step 4: arithmetic shift right by 4 for sign extension
    const shortVal = ((this.Bits >> 4) & 0xffff)
    const signedShort = shortVal >= 0x8000 ? shortVal - 0x10000 : shortVal
    return signedShort >> 4
  }

  /**
   * Layer (8-bit unsigned, 0-255).
   *
   * OpenRA 对照: CPos.Layer
   */
  get Layer(): number {
    return this.Bits & 0xff
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a CPos from packed Bits.
   *
   * OpenRA 对照: CPos(int bits)
   */
  static fromBits(bits: number): CPos {
    const cp = Object.create(CPos.prototype) as CPos
    Object.defineProperty(cp, 'Bits', { value: bits | 0, writable: false, enumerable: true, configurable: false })
    return cp
  }

  /**
   * Construct a CPos from X, Y coordinates (Layer defaults to 0).
   *
   * OpenRA 对照: CPos(int x, int y)
   */
  constructor(x: number, y: number)
  /**
   * Construct a CPos from X, Y, Layer coordinates.
   *
   * OpenRA 对照: CPos(int x, int y, byte layer)
   */
  constructor(x: number, y: number, layer: number)
  constructor(x: number, y: number, layer?: number) {
    const lyr = (layer ?? 0) & 0xff
    this.Bits = ((x & 0xfff) << 20) | ((y & 0xfff) << 8) | lyr
  }

  // -----------------------------------------------------------------------
  // Conversion
  // -----------------------------------------------------------------------

  /**
   * Convert this cell position to a map position.
   *
   * OpenRA 对照: CPos.ToMPos(MapGridType)
   *
   * For Rectangular grids: direct (X, Y) → (U, V) mapping.
   * For RectangularIsometric grids: staggered row conversion:
   *   v = X + Y
   *   u = (v - (v & 1)) / 2 - Y
   */
  toMPos(gridType: MapGridTypeEnum): MPos {
    if (gridType === MapGridType.Rectangular) return new MPos(this.X, this.Y)

    // Convert from RectangularIsometric cell (x, y) position to rectangular
    // map position (u, v). The staggered rows make this fiddly.
    const v = this.X + this.Y
    const u = ((v - (v & 1)) / 2) - this.Y
    return new MPos(u, v)
  }

  // -----------------------------------------------------------------------
  // Static operators
  // -----------------------------------------------------------------------

  /**
   * Add a cell vector to a cell position (displace the position).
   *
   * OpenRA 对照: CPos.operator+(CPos, CVec) or operator+(CVec, CPos)
   */
  static add(a: CPos, b: CVec): CPos {
    return new CPos(a.X + b.X, a.Y + b.Y, a.Layer)
  }

  /**
   * Subtract a cell vector from a cell position.
   *
   * OpenRA 对照: CPos.operator-(CPos, CVec)
   */
  static subtractVec(a: CPos, b: CVec): CPos {
    return new CPos(a.X - b.X, a.Y - b.Y, a.Layer)
  }

  /**
   * Subtract two cell positions to get a cell vector.
   *
   * OpenRA 对照: CPos.operator-(CPos, CPos) → CVec
   */
  static subtract(a: CPos, b: CPos): CVec {
    return new CVec(a.X - b.X, a.Y - b.Y)
  }

  /**
   * Test two CPos for equality.
   *
   * OpenRA 对照: CPos.operator==
   */
  static equals(a: CPos, b: CPos): boolean {
    return a.Bits === b.Bits
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another CPos.
   *
   * OpenRA 对照: CPos.Equals(CPos)
   */
  equals(other: CPos): boolean {
    return CPos.equals(this, other)
  }

  /**
   * String representation.
   *
   * OpenRA 对照: CPos.ToString()
   *
   * Format: "X,Y" if Layer is 0, "X,Y,Layer" otherwise.
   */
  toString(): string {
    if (this.Layer === 0) return `${this.X},${this.Y}`
    return `${this.X},${this.Y},${this.Layer}`
  }
}
