/**
 * TypeDictionary.ts — Container storing objects keyed by type/interface
 * OpenRA 对照: OpenRA.Game/Primitives/TypeDictionary.cs
 *
 * 核心范式转换:
 * - C# reflection-based type traversal → static `interfaces` declaration
 * - Classes stored in TypeDictionary must declare `static readonly interfaces: string[]`
 * - Linear scan for Get/WithInterface (acceptable: ~10-30 traits per actor)
 * - C# inner interface ITypeContainer → index signature Map<string, object[]>
 */

// ---------------------------------------------------------------------------
// TypeDictionary
// ---------------------------------------------------------------------------

/**
 * Marker interface for classes that can be stored in a TypeDictionary.
 *
 * Classes must declare `static readonly interfaces: string[]` listing all
 * type/interface names (including parent classes) that the object should
 * be registered under.
 */
export interface ITypeDictionaryStorable {
  // NOTE: This is a structural interface marker.
  // Implementors must provide:
  //   static readonly interfaces: string[]
}

/**
 * Container that stores objects accessible by type/interface name.
 *
 * OpenRA 对照: TypeDictionary
 *
 * When an object is added, it is registered under all interface/type names
 * declared in its class's `static readonly interfaces` array.
 *
 * TypeDictionary is not generic — it stores heterogeneous objects.
 */
export class TypeDictionary {
  /** Internal storage: type name → list of objects. */
  private readonly data = new Map<string, unknown[]>()

  /** Construct an empty TypeDictionary. */
  constructor()

  /** Construct a TypeDictionary as a clone of another. */
  constructor(cloneFrom: TypeDictionary)
  constructor(cloneFrom?: TypeDictionary) {
    if (cloneFrom) {
      for (const [key, values] of cloneFrom.data) {
        this.data.set(key, [...values])
      }
    }
  }

  // -----------------------------------------------------------------------
  // Add
  // -----------------------------------------------------------------------

  /**
   * Add an object to the dictionary.
   *
   * OpenRA 对照: TypeDictionary.Add(object)
   *
   * The object's class must declare `static readonly interfaces: string[]`.
   * The object is registered under all declared interface/type names.
   *
   * @param val — the object to add
   * @throws if val.constructor has no `interfaces` static field
   */
  add(val: unknown): void {
    const ctor = (val as Record<string, unknown>).constructor as
      | { interfaces?: readonly string[] }
      | undefined
    const ifaces = ctor?.interfaces
    if (!ifaces) {
      const ctorName =
        typeof ctor === 'function' && 'name' in ctor ? (ctor as { name: string }).name : 'unknown'
      throw new Error(
        `TypeDictionary.add: object class "${ctorName}" does not declare static interfaces. ` +
        'Add `static readonly interfaces: string[] = [...]` to the class.',
      )
    }

    for (const iface of ifaces) {
      this.innerAdd(iface, val)
    }
  }

  private innerAdd(typeName: string, val: unknown): void {
    const list = this.innerGet(typeName)
    list.push(val)
  }

  private innerGet(typeName: string): unknown[] {
    let list = this.data.get(typeName)
    if (!list) {
      list = []
      this.data.set(typeName, list)
    }
    return list
  }

  // -----------------------------------------------------------------------
  // Remove
  // -----------------------------------------------------------------------

  /**
   * Remove an object from the dictionary.
   *
   * OpenRA 对照: TypeDictionary.Remove<T>(T)
   *
   * The object is removed from all type/interface entries it was registered under.
   */
  remove(val: unknown): void {
    const ctor = (val as Record<string, unknown>).constructor as
      | { interfaces?: readonly string[] }
      | undefined
    const ifaces = ctor?.interfaces
    if (!ifaces) return

    for (const iface of ifaces) {
      this.innerRemove(iface, val)
    }
  }

  private innerRemove(typeName: string, val: unknown): void {
    const list = this.data.get(typeName)
    if (!list) return

    const idx = list.indexOf(val)
    if (idx !== -1) {
      list.splice(idx, 1)
      if (list.length === 0) {
        this.data.delete(typeName)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Check whether the dictionary contains any object of the given type.
   *
   * OpenRA 对照: TypeDictionary.Contains<T>()
   */
  contains(typeName: string): boolean {
    return this.data.has(typeName)
  }

  /**
   * Get the (first/only) object of type T.
   *
   * OpenRA 对照: TypeDictionary.Get<T>()
   *
   * @param typeName — the type/interface name to query
   * @throws if no object of this type exists
   * @throws if multiple objects of this type exist
   */
  get<T>(typeName: string): T {
    return this.getOrThrow(typeName, true) as T
  }

  /**
   * Get an object of type T, or undefined if not present.
   *
   * OpenRA 对照: TypeDictionary.GetOrDefault<T>()
   *
   * @throws if multiple objects of this type exist
   */
  getOrDefault<T>(typeName: string): T | undefined {
    return this.getOrThrow(typeName, false) as T | undefined
  }

  private getOrThrow(typeName: string, throwsIfMissing: boolean): unknown {
    const list = this.data.get(typeName)
    if (!list || list.length === 0) {
      if (throwsIfMissing) {
        throw new Error(
          `TypeDictionary does not contain instance of type '${typeName}'`,
        )
      }
      return undefined
    }

    if (list.length > 1) {
      throw new Error(
        `TypeDictionary contains multiple instances of type '${typeName}'`,
      )
    }

    return list[0]
  }

  /**
   * Get all objects implementing the given interface/type.
   *
   * OpenRA 对照: TypeDictionary.WithInterface<T>()
   */
  withInterface<T>(typeName: string): readonly T[] {
    const list = this.data.get(typeName)
    if (!list) return []
    return list as readonly T[]
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /**
   * Trim excess capacity (no-op in TypeScript, matches OpenRA API).
   *
   * OpenRA 对照: TypeDictionary.TrimExcess()
   */
  trimExcess(): void {
    // JS Map doesn't have trim; no-op for API compatibility
  }

  /** Number of distinct type entries. */
  get size(): number {
    return this.data.size
  }

  /**
   * Iterate over all stored objects (deduplicated).
   *
   * OpenRA 对照: TypeDictionary.GetEnumerator()
   */
  [Symbol.iterator](): IterableIterator<unknown> {
    return this.withInterface<unknown>('object')[Symbol.iterator]()
  }
}
