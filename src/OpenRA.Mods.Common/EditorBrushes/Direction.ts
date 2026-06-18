/**
 * Direction.ts — 8-direction grid movement utilities for editor tiling path tools
 * OpenRA 对照: OpenRA.Mods.Common/MapGenerator/Direction.cs (373 lines)
 *
 * 核心范式转换:
 * - C# enum Direction / [Flags] enum DirectionMask → TypeScript const object + type alias
 *   (erasableSyntaxOnly prohibits runtime enums — they don't erase to pure types)
 * - C# static class DirectionExts (extension methods) → exported functions
 * - C# static class DirectionMaskExts → exported functions
 * - C# System.Collections.Immutable arrays → readonly TypeScript arrays
 * - C# System.Math → JavaScript Math
 * - C# int2 → [number, number] tuple for internal computation,
 *   CVec class for public API compatibility
 * - C# int.PopCount / int.Log2 → Math.clz32 based popcount, manual log2
 *
 * The Direction type uses CARTESIAN naming (R/RD/D/LD/L/LU/U/RU matching
 * +X/+X+Y/+Y/-X+Y/-X/-X-Y/-Y/+X-Y offsets) to match OpenRA's CPos coordinate
 * system conventions. This is NOT compass-based (N/NE/E/SE/S/SW/W/NW).
 *
 * Migration:  — Chapter 21 Phase B
 */

import { CVec } from '../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// Direction const object (对应 OpenRA Direction enum)
// ---------------------------------------------------------------------------

/**
 * Eight cardinal and diagonal directions, plus None for "no direction."
 *
 * OpenRA 对照: enum Direction { None = -1, R = 0, RD = 1, D = 2, LD = 3,
 *   L = 4, LU = 5, U = 6, RU = 7 }
 *
 * Directions are ordered clockwise starting from +X (Right/East):
 *   R(+X) → RD(+X+Y) → D(+Y) → LD(-X+Y) → L(-X) → LU(-X-Y) → U(-Y) → RU(+X-Y)
 */
export const Direction = {
  /** No direction / unset. */
  None: -1,

  /** +X ("right"). */
  R: 0,

  /** +X+Y ("right down"). */
  RD: 1,

  /** +Y ("down"). */
  D: 2,

  /** -X+Y ("left down"). */
  LD: 3,

  /** -X ("left"). */
  L: 4,

  /** -X-Y ("left up"). */
  LU: 5,

  /** -Y ("up"). */
  U: 6,

  /** +X-Y ("right up"). */
  RU: 7,
} as const

export type Direction = (typeof Direction)[keyof typeof Direction]

// ---------------------------------------------------------------------------
// DirectionMask — bitmask flags (对应 OpenRA [Flags] DirectionMask)
// ---------------------------------------------------------------------------

/**
 * Bitmask of directions. Each bit corresponds to a Direction value.
 *
 * OpenRA 对照: [Flags] enum DirectionMask { None=0, MR=1<<R, MRD=1<<RD, ...,
 *   All = MR|MRD|MD|MLD|ML|MLU|MU|MRU }
 */
export const DirectionMask = {
  None: 0,

  /** Bitmask for Direction.R. */
  MR: 1 << Direction.R,

  /** Bitmask for Direction.RD. */
  MRD: 1 << Direction.RD,

  /** Bitmask for Direction.D. */
  MD: 1 << Direction.D,

  /** Bitmask for Direction.LD. */
  MLD: 1 << Direction.LD,

  /** Bitmask for Direction.L. */
  ML: 1 << Direction.L,

  /** Bitmask for Direction.LU. */
  MLU: 1 << Direction.LU,

  /** Bitmask for Direction.U. */
  MU: 1 << Direction.U,

  /** Bitmask for Direction.RU. */
  MRU: 1 << Direction.RU,

  /** All 8 directions. */
  All:
    (1 << Direction.R) |
    (1 << Direction.RD) |
    (1 << Direction.D) |
    (1 << Direction.LD) |
    (1 << Direction.L) |
    (1 << Direction.LU) |
    (1 << Direction.U) |
    (1 << Direction.RU),
} as const

export type DirectionMask = number

// ---------------------------------------------------------------------------
// ALL_DIRECTIONS — ordered array (clockwise from R)
// ---------------------------------------------------------------------------

/** All 8 directions in clockwise order starting from R (+X).
 *
 * OpenRA 对照: implicit — Spread8D defines the order via its items
 */
export const ALL_DIRECTIONS: readonly Direction[] = [
  Direction.R,
  Direction.RD,
  Direction.D,
  Direction.LD,
  Direction.L,
  Direction.LU,
  Direction.U,
  Direction.RU,
]

// ---------------------------------------------------------------------------
// Spread arrays — pre-computed offset tables (对应 OpenRA Spread*)
// ---------------------------------------------------------------------------

/**
 * 4-direction (cardinal only) offsets with directions, excluding diagonals.
 *
 * OpenRA 对照: DirectionExts.Spread4D
 */
export const Spread4D: readonly (readonly [number, number, Direction])[] = [
  [1, 0, Direction.R],
  [0, 1, Direction.D],
  [-1, 0, Direction.L],
  [0, -1, Direction.U],
]

/**
 * 4-direction (cardinal only) offsets, excluding diagonals.
 *
 * OpenRA 对照: DirectionExts.Spread4
 */
export const Spread4: readonly (readonly [number, number])[] =
  Spread4D.map(([x, y]) => [x, y] as const)

/**
 * 4-direction (cardinal only) offsets as CVec, excluding diagonals.
 *
 * OpenRA 对照: DirectionExts.Spread4CVec
 *
 * Assumes CVec(1, 0) corresponds to Direction.R.
 */
export const Spread4CVec: readonly CVec[] = Spread4D.map(
  ([x, y]) => new CVec(x, y),
)

/**
 * 8-direction (cardinal + diagonal) offsets with directions.
 *
 * OpenRA 对照: DirectionExts.Spread8D
 */
export const Spread8D: readonly (readonly [number, number, Direction])[] = [
  [1, 0, Direction.R],
  [1, 1, Direction.RD],
  [0, 1, Direction.D],
  [-1, 1, Direction.LD],
  [-1, 0, Direction.L],
  [-1, -1, Direction.LU],
  [0, -1, Direction.U],
  [1, -1, Direction.RU],
]

/**
 * 8-direction (cardinal + diagonal) offsets.
 *
 * OpenRA 对照: DirectionExts.Spread8
 */
export const Spread8: readonly (readonly [number, number])[] =
  Spread8D.map(([x, y]) => [x, y] as const)

/**
 * 8-direction offsets as CVec.
 *
 * OpenRA 对照: DirectionExts.Spread8CVec
 *
 * Assumes CVec(1, 0) corresponds to Direction.R.
 */
export const Spread8CVec: readonly CVec[] = Spread8D.map(
  ([x, y]) => new CVec(x, y),
)

/**
 * Euclidean-distance 1024-unit direction vectors for angle comparison.
 *
 * OpenRA 对照: DirectionExts.EuclideanSpread8D (private)
 *
 * These approximate 1024-unit vectors at each angle (0, 45, 90, ... 315 degrees),
 * used by closestInMaskFromOffset() for dot-product-based direction selection.
 */
export const EuclideanSpread8D: readonly (readonly [number, number, Direction])[] = [
  [1024, 0, Direction.R],
  [724, 724, Direction.RD],
  [0, 1024, Direction.D],
  [-724, 724, Direction.LD],
  [-1024, 0, Direction.L],
  [-724, -724, Direction.LU],
  [0, -1024, Direction.U],
  [724, -724, Direction.RU],
]

// ---------------------------------------------------------------------------
// Direction → offset functions (对应 OpenRA DirectionExts extension methods)
// ---------------------------------------------------------------------------

/**
 * Convert a non-None direction to an [x, y] integer offset pair.
 *
 * OpenRA 对照: DirectionExts.ToInt2() — extension method on Direction
 *
 * @param direction — the direction (must be one of the 8 valid directions)
 * @returns [dx, dy] where each component is -1, 0, or 1
 * @throws if direction is None or out of range
 */
export function directionToInt2(direction: Direction): [number, number] {
  if (direction >= Direction.R && direction <= Direction.RU) {
    // PERF: .slice() avoids iterator overhead vs spread, while still
    // returning a mutable copy (caller contract requires [number, number])
    return Spread8[direction].slice() as [number, number]
  }
  throw new Error(`Bad direction: ${direction}`)
}

/**
 * Convert a non-None direction to a CVec offset.
 *
 * OpenRA 对照: DirectionExts.ToCVec() — extension method on Direction
 *
 * Assumes CVec(1, 0) corresponds to Direction.R.
 *
 * @param direction — the direction (must be one of the 8 valid directions)
 * @returns a CVec representing the unit offset
 * @throws if direction is None or out of range
 */
export function directionToCVec(direction: Direction): CVec {
  if (direction >= Direction.R && direction <= Direction.RU) {
    return Spread8CVec[direction]
  }
  throw new Error(`Bad direction: ${direction}`)
}

// ---------------------------------------------------------------------------
// Offset → direction functions (对应 OpenRA DirectionExts.From*)
// ---------------------------------------------------------------------------

/**
 * Convert a signed integer offset to a direction based purely on sign.
 *
 * OpenRA 对照: DirectionExts.FromOffset(int dx, int dy)
 *
 * Diagonal if both signs are non-zero; cardinal if one is zero.
 * Throws if both dx and dy are zero (zero offset has no direction).
 *
 * @param dx — X offset (positive = right, negative = left)
 * @param dy — Y offset (positive = down, negative = up)
 * @returns the direction matching the sign pattern
 * @throws if both dx and dy are 0
 */
export function directionFromOffset(dx: number, dy: number): Direction {
  if (dx > 0) {
    if (dy > 0) return Direction.RD
    if (dy < 0) return Direction.RU
    return Direction.R
  } else if (dx < 0) {
    if (dy > 0) return Direction.LD
    if (dy < 0) return Direction.LU
    return Direction.L
  } else {
    if (dy > 0) return Direction.D
    if (dy < 0) return Direction.U
    throw new Error('Bad direction: zero offset')
  }
}

/**
 * Convert a CVec offset to a direction based purely on sign.
 *
 * OpenRA 对照: DirectionExts.FromCVec(CVec delta)
 *
 * Assumes CVec(1, 0) corresponds to Direction.R.
 *
 * @param delta — the CVec offset
 * @returns the direction matching the sign pattern
 * @throws if the CVec is (0, 0)
 */
export function directionFromCVec(delta: CVec): Direction {
  return directionFromOffset(delta.X, delta.Y)
}

// ---------------------------------------------------------------------------
// Closest direction (angle-based) (对应 OpenRA DirectionExts.ClosestFrom*)
// ---------------------------------------------------------------------------

/**
 * Convert an offset to the closest direction by angle.
 *
 * OpenRA 对照: DirectionExts.ClosestFrom(int dx, int dy)
 *
 * Uses an approximation of tan(Pi/8) = 408/985 to determine whether the
 * offset falls into a diagonal or cardinal sector.
 * Keep input magnitudes to 1,000,000 or less.
 *
 * @param dx — X offset
 * @param dy — Y offset
 * @returns the direction with the closest angle
 * @throws if both dx and dy are 0
 */
export function closestDirectionFromOffset(dx: number, dy: number): Direction {
  if (dx === 0 && dy === 0) {
    throw new Error('Bad direction: zero offset')
  }

  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  const minAbs = Math.min(absX, absY)
  const maxAbs = Math.max(absX, absY)

  // 408 / 985 is an approximation of tan(Pi / 8 radians), or tan(22.5 degrees).
  // If 408 * max < 985 * min, the offset angle is within 22.5 degrees of a
  // diagonal direction. Otherwise, it is closer to a cardinal direction.
  if (408 * maxAbs < 985 * minAbs) {
    // Diagonal — use sign-based lookup
    return directionFromOffset(dx, dy)
  } else {
    // Cardinal — use the larger-magnitude axis
    if (absX > absY) {
      return directionFromNonDiagonal(dx, 0)
    } else {
      return directionFromNonDiagonal(0, dy)
    }
  }
}

/**
 * Convert a CVec offset to the closest direction by angle.
 *
 * OpenRA 对照: DirectionExts.ClosestFromCVec(CVec delta)
 *
 * Assumes CVec(1, 0) corresponds to Direction.R.
 *
 * @param delta — the CVec offset
 * @returns the direction with the closest angle
 * @throws if the CVec is (0, 0)
 */
export function closestDirectionFromCVec(delta: CVec): Direction {
  return closestDirectionFromOffset(delta.X, delta.Y)
}

// ---------------------------------------------------------------------------
// Closest direction within a mask (对应 OpenRA DirectionExts.ClosestInMaskFrom*)
// ---------------------------------------------------------------------------

/**
 * Find the best-matching direction within a DirectionMask via dot-product scoring.
 *
 * OpenRA 对照: DirectionExts.ClosestInMaskFrom(int dx, int dy, DirectionMask mask)
 *
 * Computes the dot product of (dx, dy) against each allowed Euclidean
 * direction vector; the highest-scoring direction wins.
 * Keep input magnitudes to 1,000,000 or less.
 *
 * @param dx — X offset
 * @param dy — Y offset
 * @param mask — bitmask of allowed directions
 * @returns the best direction within the mask
 * @throws if offset is zero or mask is empty
 */
export function closestInMaskFromOffset(
  dx: number,
  dy: number,
  mask: DirectionMask,
): Direction {
  if (dx === 0 && dy === 0) {
    throw new Error('Bad direction: zero offset')
  }
  if (mask === DirectionMask.None) {
    throw new Error('Empty mask')
  }

  let best: Direction = Direction.None
  let bestScore = -Infinity
  for (const [ex, ey, dir] of EuclideanSpread8D) {
    if ((mask & directionToMask(dir)) !== 0) {
      const score = ex * dx + ey * dy
      if (score > bestScore) {
        best = dir
        bestScore = score
      }
    }
  }

  return best
}

/**
 * Find the best-matching direction within a DirectionMask from a CVec.
 *
 * OpenRA 对照: DirectionExts.ClosestInMaskFromCVec(CVec delta, DirectionMask mask)
 *
 * @param delta — the CVec offset
 * @param mask — bitmask of allowed directions
 * @returns the best direction within the mask
 * @throws if offset is zero or mask is empty
 */
export function closestInMaskFromCVec(
  delta: CVec,
  mask: DirectionMask,
): Direction {
  return closestInMaskFromOffset(delta.X, delta.Y, mask)
}

// ---------------------------------------------------------------------------
// Non-diagonal (cardinal-only) direction from offset
//   (对应 OpenRA DirectionExts.FromOffsetNonDiagonal)
// ---------------------------------------------------------------------------

/**
 * Convert an offset to a non-diagonal (cardinal) direction.
 *
 * OpenRA 对照: DirectionExts.FromOffsetNonDiagonal(int dx, int dy)
 *
 * Determines which of the four cardinal directions best matches the offset
 * based on the sign and relative magnitude of dx and dy.
 *
 * @param dx — X offset
 * @param dy — Y offset
 * @returns one of R, D, L, or U
 * @throws if the offset is ambiguous or zero
 */
export function directionFromNonDiagonal(dx: number, dy: number): Direction {
  if (dx - dy > 0 && dx + dy >= 0) return Direction.R
  if (dy + dx > 0 && dy - dx >= 0) return Direction.D
  if (-dx + dy > 0 && -dx - dy >= 0) return Direction.L
  if (-dy - dx > 0 && -dy + dx >= 0) return Direction.U
  throw new Error('Bad direction: cannot determine non-diagonal direction')
}

/**
 * Convert a CVec to a non-diagonal (cardinal) direction.
 *
 * OpenRA 对照: DirectionExts.FromCVecNonDiagonal(CVec delta)
 *
 * @param delta — the CVec offset
 * @returns one of R, D, L, or U
 * @throws if the offset is ambiguous or zero
 */
export function directionFromCVecNonDiagonal(delta: CVec): Direction {
  return directionFromNonDiagonal(delta.X, delta.Y)
}

// ---------------------------------------------------------------------------
// Reverse / opposite direction (对应 OpenRA DirectionExts.Reverse)
// ---------------------------------------------------------------------------

/**
 * Return the opposite direction (180-degree rotation).
 *
 * OpenRA 对照: DirectionExts.Reverse() — extension method
 *
 * XOR with 4 swaps between opposite pairs:
 *   R(0)↔L(4), D(2)↔U(6), RD(1)↔LU(5), LD(3)↔RU(7)
 * None returns None.
 *
 * @param direction — the direction to reverse
 * @returns the opposite direction
 */
export function oppositeDirection(direction: Direction): Direction {
  if (direction !== Direction.None) {
    return (direction ^ 4) as Direction
  }
  return Direction.None
}

// ---------------------------------------------------------------------------
// Direction → bitmask conversion (对应 OpenRA DirectionExts.ToMask)
// ---------------------------------------------------------------------------

/**
 * Convert a Direction to its corresponding DirectionMask bit.
 *
 * OpenRA 对照: DirectionExts.ToMask() — extension method
 *
 * @param direction — the direction to convert
 * @returns the bitmask bit (1 << direction), or None for invalid inputs
 */
export function directionToMask(direction: Direction): DirectionMask {
  if (direction >= Direction.R && direction <= Direction.RU) {
    return 1 << direction
  }
  return DirectionMask.None
}

// ---------------------------------------------------------------------------
// DirectionMaskExts — bitmask operations (对应 OpenRA DirectionMaskExts)
// ---------------------------------------------------------------------------

/**
 * Count the number of set bits (directions) in a direction mask.
 *
 * OpenRA 对照: DirectionMaskExts.Count() — extension method on DirectionMask
 *
 * Uses Brian Kernighan's algorithm for bit counting.
 *
 * @param mask — the direction mask to count
 * @returns the number of directions in the mask
 */
export function directionMaskCount(mask: DirectionMask): number {
  let n = mask >>> 0 // cast to unsigned 32-bit
  let count = 0
  while (n !== 0) {
    n &= n - 1
    count++
  }
  return count
}

/**
 * Extract the single direction from a mask that has exactly one bit set.
 * Returns None if zero or multiple bits are set.
 *
 * OpenRA 对照: DirectionMaskExts.ToDirection() — extension method on DirectionMask
 *
 * Uses a fast bit-trick: checks that mask is a power of two, then computes
 * log2 via 31 - Math.clz32.
 *
 * @param mask — the direction mask (should have exactly 1 bit set)
 * @returns the single direction, or None if mask has 0 or 2+ bits
 */
export function directionFromMask(mask: DirectionMask): Direction {
  const u = mask >>> 0
  // Check that exactly one bit is set (power of two test, nonzero)
  if (u !== 0 && (u & (u - 1)) === 0) {
    const d = 31 - Math.clz32(u)
    if (d >= Direction.R && d <= Direction.RU) {
      return d as Direction
    }
  }
  return Direction.None
}

/**
 * Check if a direction is diagonal (odd index) vs cardinal (even index).
 *
 * OpenRA 对照: DirectionMaskExts.IsDiagonal() — extension method on Direction
 *
 * Direction indices 0-7: R(0)=card, RD(1)=diag, D(2)=card, LD(3)=diag,
 * L(4)=card, LU(5)=diag, U(6)=card, RU(7)=diag.
 *
 * @param direction — the direction to check
 * @returns true if diagonal, false if cardinal
 * @throws if direction is None or out of range
 */
export function directionIsDiagonal(direction: Direction): boolean {
  if (direction >= Direction.R && direction <= Direction.RU) {
    return (direction & 1) === 1
  }
  throw new Error('None or bad direction')
}
