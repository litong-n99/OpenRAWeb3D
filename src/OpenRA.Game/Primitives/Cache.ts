/**
 * Cache.ts — Lazy-computed dictionary with factory function
 * OpenRA 对照: OpenRA.Game/Primitives/Cache.cs
 *
 * 核心范式转换:
 * - C# Cache<T, U> : IReadOnlyDictionary<T, U> → TypeScript class implementing Map-like interface
 * - C# Dictionary.GetOrAdd → lazy factory stored per cache instance
 * - No equality comparer parameter (uses Map built-in equality)
 */

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * A dictionary wrapper that lazily creates values on first access.
 *
 * OpenRA 对照: Cache<T, U>
 *
 * When a key is accessed via `get()`, if the key does not exist in the
 * underlying map, the loader function is called to create the value.
 *
 * @typeParam K — key type
 * @typeParam V — value type
 */
export class Cache<K, V> {
  /** The underlying map storage.
   *
   * OpenRA 对照: Cache.cache field (Dictionary<T, U>)
   */
  private readonly store = new Map<K, V>()

  /** The factory function for creating new values.
   *
   * OpenRA 对照: Cache.loader
   */
  private readonly loader: (key: K) => V

  /**
   * Construct a Cache with a loader function.
   *
   * OpenRA 对照: Cache(Func<T, U> loader)
   *
   * @param loader — factory function called when a key is not found
   */
  constructor(loader: (key: K) => V) {
    this.loader = loader
  }

  /**
   * Get a value by key, creating it via the loader if not present.
   *
   * OpenRA 对照: Cache<T, U>.this[T key]
   *
   * @param key — the key to look up
   * @returns the existing or newly-created value
   */
  get(key: K): V {
    if (!this.store.has(key)) {
      this.store.set(key, this.loader(key))
    }
    return this.store.get(key)!
  }

  /**
   * Check whether the cache contains a key.
   *
   * OpenRA 对照: Cache.ContainsKey(T)
   */
  has(key: K): boolean {
    return this.store.has(key)
  }

  /**
   * Try to get a value without invoking the loader.
   *
   * OpenRA 对照: Cache.TryGetValue(T, out U)
   *
   * @returns the value, or undefined if not present
   */
  tryGet(key: K): V | undefined {
    return this.store.get(key)
  }

  /** Number of cached entries.
   *
   * OpenRA 对照: Cache.Count
   */
  get size(): number {
    return this.store.size
  }

  /** All cached keys.
   *
   * OpenRA 对照: Cache.Keys
   */
  keys(): IterableIterator<K> {
    return this.store.keys()
  }

  /** All cached values.
   *
   * OpenRA 对照: Cache.Values
   */
  values(): IterableIterator<V> {
    return this.store.values()
  }

  /**
   * Clear all cached entries.
   *
   * OpenRA 对照: Cache.Clear()
   */
  clear(): void {
    this.store.clear()
  }

  /**
   * Iterate over all key-value pairs.
   *
   * OpenRA 对照: Cache.GetEnumerator()
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.store[Symbol.iterator]()
  }
}
