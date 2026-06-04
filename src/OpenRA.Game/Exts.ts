/**
 * Exts.ts — OpenRA extension methods and utilities
 * OpenRA 对照: OpenRA.Game/Exts.cs
 *
 * 核心范式转换:
 * - C# extension methods → TypeScript static utility functions
 * - ISqrt for integer square root (deterministic, no Math.sqrt)
 */

// ---------------------------------------------------------------------------
// ISqrt — integer square root (floor mode)
// ---------------------------------------------------------------------------

/**
 * Integer square root (floor mode).
 *
 * OpenRA 对照: Exts.ISqrt(int, ISqrtRoundMode.Floor)
 *
 * Uses bit-shift algorithm for deterministic cross-platform behavior.
 * Only Floor mode is implemented (the default in OpenRA).
 *
 * @param n — non-negative integer
 * @returns floor(sqrt(n))
 * @throws Error if n is negative
 */
export function isqrt(n: number): number {
  if (n < 0) throw new Error(`ISqrt: negative number ${n}`)
  let divisor = 1 << 30
  let root = 0
  let remainder = n

  // Find the highest term in the divisor
  while (divisor > n) {
    divisor >>>= 2
  }

  while (divisor !== 0) {
    if (root + divisor <= remainder) {
      remainder -= root + divisor
      root += 2 * divisor
    }
    root >>>= 1
    divisor >>>= 2
  }

  return root
}

// ---------------------------------------------------------------------------
// ISqrt — integer square root (ceiling mode)
// ---------------------------------------------------------------------------

/**
 * Integer square root with ceiling rounding.
 *
 * OpenRA 对照: Exts.ISqrt(int, ISqrtRoundMode.Ceiling)
 *
 * Uses the floor isqrt then bumps up if root * root < n.
 *
 * @param n — non-negative integer
 * @returns ceil(sqrt(n))
 * @throws Error if n is negative
 */
export function isqrtCeiling(n: number): number {
  const root = isqrt(n)
  return root * root < n ? root + 1 : root
}
