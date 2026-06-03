/**
 * CachedTransform.ts — Memoized transformation with invalidation
 * OpenRA 对照: OpenRA.Game/Primitives/CachedTransform.cs
 *
 * 核心范式转换:
 * - C# class with nullable T → TypeScript class with tracked state
 * - Equality check via Object.is() for null-safe comparison
 */

// ---------------------------------------------------------------------------
// CachedTransform
// ---------------------------------------------------------------------------

/**
 * A memoized transformation that only recomputes when the input changes.
 *
 * OpenRA 对照: CachedTransform<T, U>
 *
 * Stores the last input and output. On update(), if the input matches the
 * last input (by value equality), returns the cached output without calling
 * the transform function. Otherwise, recomputes.
 *
 * @typeParam T — input type
 * @typeParam U — output type
 */
export class CachedTransform<T, U> {
  /** The transform function. */
  private readonly transform: (input: T) => U

  /** Whether the cache has been initialized. */
  private initialized = false

  /** The last input value passed to update(). */
  private lastInput: T | undefined

  /** The cached output from the last transform call. */
  private lastOutput: U | undefined

  /**
   * Create a CachedTransform with a transform function.
   *
   * OpenRA 对照: CachedTransform(Func<T, U> transform)
   *
   * @param transform — the function to memoize
   */
  constructor(transform: (input: T) => U) {
    this.transform = transform
  }

  /**
   * Update the cached transform with an input.
   *
   * OpenRA 对照: CachedTransform.Update(T)
   *
   * If the input matches the last input, returns the cached result.
   * Otherwise, recomputes via the transform function.
   *
   * NOTE: Equality check uses == (with null/undefined handling), matching
   * OpenRA's behavior: if both input and lastInput are null/undefined,
   * they are considered equal.
   *
   * @param input — the current input value
   * @returns the transform result (cached or freshly computed)
   */
  update(input: T): U {
    if (this.initialized) {
      if (
        (input == null && this.lastInput == null) ||
        (input != null && input === this.lastInput)
      ) {
        return this.lastOutput!
      }
    }

    this.lastInput = input
    this.lastOutput = this.transform(input)
    this.initialized = true

    return this.lastOutput
  }
}
