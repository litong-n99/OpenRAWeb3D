/**
 * Exts.ts — Server utility extension functions.
 *
 * OpenRA 对照: OpenRA.Game/Server/Exts.cs (24 lines C#)
 *
 * 核心范式转换:
 * - C# `IEnumerable<T>.Except(T t)` LINQ extension method → TypeScript
 *   `Array.filter(x => x !== item)` standalone utility function
 * - C# extension method (callable as `ts.Except(t)`) → TypeScript exported
 *   function `except(ts, t)`
 *
 * Usage: Used by `Server.ts` in lobby sync logic to exclude specific clients
 * from broadcast recipient lists.
 */

// ---------------------------------------------------------------------------
// except — exclude element from array
// ---------------------------------------------------------------------------

/**
 * Excludes all occurrences of `item` from the array.
 *
 * Returns a **new** array; the original is not modified.
 * Uses strict equality (`!==`) so reference identity matters for objects.
 *
 * OpenRA 对照: `Exts.Except<T>(this IEnumerable<T> ts, T t)`
 *
 * @param array — the array to filter (read-only reference, not mutated)
 * @param item — the element to exclude
 * @returns a new array with all occurrences of `item` removed
 *
 * @example
 * ```typescript
 * except([1, 2, 3], 2)        // [1, 3]
 * except([1, 1, 1], 1)        // []
 * except(['a', 'b'], 'c')      // ['a', 'b']
 * ```
 */
export function except<T>(array: readonly T[], item: T): T[] {
  return array.filter((x) => x !== item);
}
