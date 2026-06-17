/**
 * InfiltrationUtils.ts — shared utility for infiltration type checking
 * OpenRA 对照: BitSet<TargetableType>.Overlaps()
 *
 * 核心范式转换:
 * - C# BitSet<TargetableType>.Overlaps(other) → TS array intersection check
 */

/** Check if two arrays of target type names overlap.
 *
 *  OpenRA 对照: BitSet<TargetableType>.Overlaps()
 *
 * @param a — first array of target type names
 * @param b — second array of target type names
 * @returns true if at least one element exists in both arrays
 */
export function typesOverlap(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length === 0 || b.length === 0) return false
  const bSet = new Set(b)
  return a.some((t) => bSet.has(t))
}
