/**
 * WAngle.ts — 1D world angle (0-1024 = 360 degrees)
 * OpenRA 对照: OpenRA.Game/WAngle.cs
 *
 * 核心范式转换:
 * - C# struct (value type) → immutable TypeScript class
 * - C# operator overloading → static methods
 * - OpenGL rendering angle (RendererRadians) → preserved for render boundary
 * - Deterministic trig via precomputed lookup tables (NOT Math.sin/cos)
 *
 * NOTE: WAngle uses 0-1024 range for a full circle (256 = 90 degrees).
 *   Conversion to radians happens ONLY at the render boundary via rendererRadians().
 *   The lookup tables are byte-for-byte copies from the OpenRA C# source to
 *   guarantee deterministic cross-browser behavior.
 */

// ---------------------------------------------------------------------------
// Lookup tables (byte-for-byte from OpenRA WAngle.cs)
// ---------------------------------------------------------------------------

/** Cosine table: 1024 * cos(angle * π/512) for angles 0-256 inclusive.
 *
 * OpenRA 对照: WAngle.CosineTable
 *
 * 257 entries, indexed by angle (0-256). cos(0)=1024, cos(256)=0.
 * NEVER modify these values — they guarantee cross-browser determinism.
 */
const COSINE_TABLE: readonly number[] = [
  1024, 1023, 1023, 1023, 1023, 1023, 1023, 1023, 1022, 1022, 1022, 1021,
  1021, 1020, 1020, 1019, 1019, 1018, 1017, 1017, 1016, 1015, 1014, 1013,
  1012, 1011, 1010, 1009, 1008, 1007, 1006, 1005, 1004, 1003, 1001, 1000,
  999, 997, 996, 994, 993, 991, 990, 988, 986, 985, 983, 981, 979, 978,
  976, 974, 972, 970, 968, 966, 964, 962, 959, 957, 955, 953, 950, 948,
  946, 943, 941, 938, 936, 933, 930, 928, 925, 922, 920, 917, 914, 911,
  908, 906, 903, 900, 897, 894, 890, 887, 884, 881, 878, 875, 871, 868,
  865, 861, 858, 854, 851, 847, 844, 840, 837, 833, 829, 826, 822, 818,
  814, 811, 807, 803, 799, 795, 791, 787, 783, 779, 775, 771, 767, 762,
  758, 754, 750, 745, 741, 737, 732, 728, 724, 719, 715, 710, 706, 701,
  696, 692, 687, 683, 678, 673, 668, 664, 659, 654, 649, 644, 639, 634,
  629, 625, 620, 615, 609, 604, 599, 594, 589, 584, 579, 574, 568, 563,
  558, 553, 547, 542, 537, 531, 526, 521, 515, 510, 504, 499, 493, 488,
  482, 477, 471, 466, 460, 454, 449, 443, 437, 432, 426, 420, 414, 409,
  403, 397, 391, 386, 380, 374, 368, 362, 356, 350, 344, 339, 333, 327,
  321, 315, 309, 303, 297, 291, 285, 279, 273, 267, 260, 254, 248, 242,
  236, 230, 224, 218, 212, 205, 199, 193, 187, 181, 175, 168, 162, 156,
  150, 144, 137, 131, 125, 119, 112, 106, 100, 94, 87, 81, 75, 69, 62,
  56, 50, 43, 37, 31, 25, 18, 12, 6, 0,
]

/** Tangent table: 1024 * tan(angle * π/512) for angles 0-256 inclusive.
 *
 * OpenRA 对照: WAngle.TanTable
 *
 * 257 entries, indexed by angle (0-256). tan(0)=0, tan(256)≈infinity (int.MaxValue).
 * NEVER modify these values — they guarantee cross-browser determinism.
 */
const TAN_TABLE: readonly number[] = [
  0, 6, 12, 18, 25, 31, 37, 44, 50, 56, 62, 69, 75, 81, 88, 94, 100, 107,
  113, 119, 126, 132, 139, 145, 151, 158, 164, 171, 177, 184, 190, 197,
  203, 210, 216, 223, 229, 236, 243, 249, 256, 263, 269, 276, 283, 290,
  296, 303, 310, 317, 324, 331, 338, 345, 352, 359, 366, 373, 380, 387,
  395, 402, 409, 416, 424, 431, 438, 446, 453, 461, 469, 476, 484, 492,
  499, 507, 515, 523, 531, 539, 547, 555, 563, 571, 580, 588, 596, 605,
  613, 622, 630, 639, 648, 657, 666, 675, 684, 693, 702, 711, 721, 730,
  740, 749, 759, 769, 779, 789, 799, 809, 819, 829, 840, 850, 861, 872,
  883, 894, 905, 916, 928, 939, 951, 963, 974, 986, 999, 1011, 1023, 1036,
  1049, 1062, 1075, 1088, 1102, 1115, 1129, 1143, 1158, 1172, 1187, 1201,
  1216, 1232, 1247, 1263, 1279, 1295, 1312, 1328, 1345, 1363, 1380, 1398,
  1416, 1435, 1453, 1473, 1492, 1512, 1532, 1553, 1574, 1595, 1617, 1639,
  1661, 1684, 1708, 1732, 1756, 1782, 1807, 1833, 1860, 1887, 1915, 1944,
  1973, 2003, 2034, 2065, 2098, 2131, 2165, 2199, 2235, 2272, 2310, 2348,
  2388, 2429, 2472, 2515, 2560, 2606, 2654, 2703, 2754, 2807, 2861, 2918,
  2976, 3036, 3099, 3164, 3232, 3302, 3375, 3451, 3531, 3613, 3700, 3790,
  3885, 3984, 4088, 4197, 4311, 4432, 4560, 4694, 4836, 4987, 5147, 5318,
  5499, 5693, 5901, 6124, 6364, 6622, 6903, 7207, 7539, 7902, 8302, 8743,
  9233, 9781, 10396, 11094, 11891, 12810, 13882, 15148, 16667, 18524, 20843,
  23826, 27801, 33366, 41713, 55622, 83438, 166883, 2147483647,
]

// ---------------------------------------------------------------------------
// WAngle
// ---------------------------------------------------------------------------

/**
 * 1D world angle using 0-1024 range (1024 = 360 degrees).
 *
 * OpenRA 对照: WAngle (readonly struct)
 *
 * Immutable. All operations return new WAngle instances.
 * Trig functions use precomputed lookup tables for cross-browser determinism.
 */
export class WAngle {
  /** The normalized angle value in range [0, 1024). */
  readonly angle: number

  /** Zero angle pointing east/right.
   *
   * OpenRA 对照: WAngle.Zero
   */
  static readonly Zero = new WAngle(0)

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * Construct a WAngle, normalizing the input to [0, 1024).
   *
   * OpenRA 对照: WAngle(int a)
   */
  constructor(a: number) {
    // Truncate to int32 (C# constructor takes int, not float).
    // Use double-modulo to guarantee non-negative result in [0, 1024).
    this.angle = ((Math.trunc(a) % 1024) + 1024) % 1024
  }

  // -----------------------------------------------------------------------
  // Factory methods
  // -----------------------------------------------------------------------

  /**
   * Create a WAngle from a facing value (0-255 = full circle, 64 = 90 degrees).
   *
   * OpenRA 对照: WAngle.FromFacing(int facing)
   */
  static fromFacing(facing: number): WAngle {
    return new WAngle(facing * 4)
  }

  /**
   * Create a WAngle from degrees.
   *
   * OpenRA 对照: WAngle.FromDegrees(int degrees)
   */
  static fromDegrees(degrees: number): WAngle {
    return new WAngle(degrees * 1024 / 360)
  }

  // -----------------------------------------------------------------------
  // Derived properties
  // -----------------------------------------------------------------------

  /** The square of the angle value.
   *
   * OpenRA 对照: WAngle.AngleSquared
   */
  get angleSquared(): number {
    return this.angle * this.angle
  }

  /** The facing value (angle / 4), range 0-255.
   *
   * OpenRA 对照: WAngle.Facing
   */
  get facing(): number {
    return Math.floor(this.angle / 4)
  }

  // -----------------------------------------------------------------------
  // Static operators (OpenRA operator overloading → static methods)
  // -----------------------------------------------------------------------

  /**
   * Add two angles, wrapping to [0, 1024).
   *
   * OpenRA 对照: WAngle.operator+(WAngle, WAngle)
   */
  static add(a: WAngle, b: WAngle): WAngle {
    return new WAngle(a.angle + b.angle)
  }

  /**
   * Subtract b from a, wrapping to [0, 1024).
   *
   * OpenRA 对照: WAngle.operator-(WAngle, WAngle)
   */
  static subtract(a: WAngle, b: WAngle): WAngle {
    return new WAngle(a.angle - b.angle)
  }

  /**
   * Negate an angle.
   *
   * OpenRA 对照: WAngle.operator-(WAngle)
   */
  static negate(a: WAngle): WAngle {
    return new WAngle(-a.angle)
  }

  /**
   * Test two WAngle instances for equality.
   *
   * OpenRA 对照: WAngle.operator==(WAngle, WAngle)
   */
  static equals(a: WAngle, b: WAngle): boolean {
    return a.angle === b.angle
  }

  // -----------------------------------------------------------------------
  // Trigonometric functions (lookup table based, deterministic)
  // -----------------------------------------------------------------------

  /**
   * Sine of this angle, using the cosine lookup table.
   * Returns integer in range [-1024, 1024] representing sin * 1024.
   *
   * OpenRA 对照: WAngle.Sin()
   */
  sin(): number {
    // `|| 0` converts -0 to +0 for deterministic output
    return new WAngle(this.angle - 256).cos() || 0
  }

  /**
   * Cosine of this angle, using the precomputed cosine lookup table.
   * Returns integer in range [-1024, 1024] representing cos * 1024.
   *
   * OpenRA 对照: WAngle.Cos()
   */
  cos(): number {
    // `|| 0` converts -0 to +0 for deterministic output
    let result: number
    if (this.angle <= 256) result = COSINE_TABLE[this.angle]
    else if (this.angle <= 512) result = -COSINE_TABLE[512 - this.angle]
    else result = -new WAngle(this.angle - 512).cos()
    return result || 0
  }

  /**
   * Tangent of this angle, using the precomputed tangent lookup table.
   * Returns integer representing tan * 1024.
   * Returns a large value at 256 (90 degrees), approaching infinity.
   *
   * OpenRA 对照: WAngle.Tan()
   */
  tan(): number {
    // `|| 0` converts -0 to +0 for deterministic output
    let result: number
    if (this.angle <= 256) result = TAN_TABLE[this.angle]
    else if (this.angle <= 512) result = -TAN_TABLE[512 - this.angle]
    else result = new WAngle(this.angle - 512).tan()
    return result || 0
  }

  // -----------------------------------------------------------------------
  // Inverse trigonometric functions
  // -----------------------------------------------------------------------

  /**
   * Find the index in CosineTable whose value is closest to the given value.
   *
   * OpenRA 对照: WAngle.ClosestCosineIndex(int value)
   */
  static closestCosineIndex(value: number): number {
    let aboveIndex = 0
    let belowIndex = 256
    while (aboveIndex !== belowIndex - 1) {
      const index = Math.floor((aboveIndex + belowIndex) / 2)
      const val = COSINE_TABLE[index]
      if (val === value) return index
      if (val < value) belowIndex = index
      else aboveIndex = index
    }
    // Take the index with the smallest error
    return COSINE_TABLE[aboveIndex] - value > value - COSINE_TABLE[belowIndex]
      ? belowIndex
      : aboveIndex
  }

  /**
   * Inverse sine. Returns angle in [0, 1024) whose sine * 1024 equals d.
   *
   * OpenRA 对照: WAngle.ArcSin(int d)
   *
   * @throws Error if d is outside [-1024, 1024]
   */
  static arcSin(d: number): WAngle {
    if (d < -1024 || d > 1024) {
      throw new Error(
        `ArcSin: value ${d} is outside valid range [-1024, 1024]`,
      )
    }
    const a = WAngle.closestCosineIndex(Math.abs(d))
    return new WAngle(d < 0 ? 768 + a : 256 - a)
  }

  /**
   * Inverse cosine. Returns angle in [0, 1024) whose cosine * 1024 equals d.
   *
   * OpenRA 对照: WAngle.ArcCos(int d)
   *
   * @throws Error if d is outside [-1024, 1024]
   */
  static arcCos(d: number): WAngle {
    if (d < -1024 || d > 1024) {
      throw new Error(
        `ArcCos: value ${d} is outside valid range [-1024, 1024]`,
      )
    }
    const a = WAngle.closestCosineIndex(Math.abs(d))
    return new WAngle(d < 0 ? 512 - a : a)
  }

  /**
   * Inverse tangent returning angle for given y and x components.
   *
   * OpenRA 对照: WAngle.ArcTan(int y, int x, int stride)
   *
   * NOTE: arcTan(0, 0) is guarded — returns WAngle.Zero.
   *   The C# version does not explicitly handle this case.
   */
  static arcTan(y: number, x: number, stride: number = 1): WAngle {
    if (y === 0) return new WAngle(x >= 0 ? 0 : 512)
    if (x === 0) return new WAngle(Math.sign(y) * 256)

    const ay = Math.abs(y)
    const ax = Math.abs(x)

    // Find the closest angle that satisfies y = x*tan(theta)
    // Uses a number to store bestVal (eliminates integer overflow in common cases)
    let bestVal = Number.MAX_SAFE_INTEGER
    let bestAngle = 0
    for (let i = 0; i < 256; i += stride) {
      const val = Math.abs(1024 * ay - ax * TAN_TABLE[i])
      if (val < bestVal) {
        bestVal = val
        bestAngle = i
      }
    }

    // Calculate quadrant
    if (x < 0 && y > 0) bestAngle = 512 - bestAngle
    else if (x < 0 && y < 0) bestAngle = 512 + bestAngle
    else if (x > 0 && y < 0) bestAngle = 1024 - bestAngle

    return new WAngle(bestAngle)
  }

  // -----------------------------------------------------------------------
  // Interpolation
  // -----------------------------------------------------------------------

  /**
   * Rotate toward a desired facing by at most `step` angle units per call.
   *
   * OpenRA 对照: Util.TickFacing(WAngle facing, WAngle desired, WAngle step)
   *
   * @param current — current facing angle
   * @param desired — target facing angle
   * @param step — maximum rotation step per call
   * @returns new facing angle after one tick of rotation
   */
  static tickFacing(current: WAngle, desired: WAngle, step: WAngle): WAngle {
    const diff = WAngle.subtract(desired, current).angle
    if (diff === 0) return current
    // OpenRA convention: WAngle range is [0, 1024), shortest path through 512
    const absDiff = diff > 512 ? 1024 - diff : diff
    const sign = diff <= 512 ? 1 : -1
    const move = Math.min(absDiff, step.angle)
    return new WAngle(current.angle + sign * move)
  }

  /**
   * Linear interpolation between two angles, handling angle wrapping.
   *
   * OpenRA 对照: WAngle.Lerp(WAngle a, WAngle b, int mul, int div)
   */
  static lerp(a: WAngle, b: WAngle, mul: number, div: number): WAngle {
    // Map 1024 <-> 0 wrapping into linear space
    let aa = a.angle
    let bb = b.angle
    if (aa > bb && aa - bb > 512) aa -= 1024
    if (bb > aa && bb - aa > 512) bb -= 1024
    return new WAngle(aa + ((bb - aa) * mul) / div)
  }

  // -----------------------------------------------------------------------
  // Render boundary conversion (convert to radians/degrees for WebGL only)
  // -----------------------------------------------------------------------

  /**
   * Convert to radians for rendering. MUST NOT be used in game logic
   * (non-deterministic across browsers due to Math.PI precision differences).
   *
   * OpenRA 对照: WAngle.RendererRadians()
   */
  rendererRadians(): number {
    return (this.angle * Math.PI) / 512
  }

  /**
   * Convert to degrees for rendering. MUST NOT be used in game logic.
   *
   * OpenRA 对照: WAngle.RendererDegrees()
   */
  rendererDegrees(): number {
    return this.angle * 0.3515625
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Check equality with another WAngle.
   *
   * OpenRA 对照: WAngle.Equals(WAngle)
   */
  equals(other: WAngle): boolean {
    return this.angle === other.angle
  }

  /**
   * String representation.
   *
   * OpenRA 对照: WAngle.ToString()
   */
  toString(): string {
    return this.angle.toString()
  }
}
