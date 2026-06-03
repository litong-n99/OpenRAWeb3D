/**
 * BitSet.ts — Bit-packed set of named values (arbitrary-precision via bigint)
 * OpenRA 对照: OpenRA.Game/Primitives/BitSet.cs
 *
 * 核心范式转换:
 * - C# BitSetAllocator<T> static class → module-level string→bigint allocator
 * - C# System.Numerics.BigInteger → TypeScript bigint
 * - Generic type T serves as namespace tag for string allocation
 * - Thread safety (C# lock) → not needed in single-threaded JS
 */

// ---------------------------------------------------------------------------
// Global string-to-bit allocator (per T namespace)
// ---------------------------------------------------------------------------

/** Per-type allocator state. */
interface AllocatorState {
  /** Map from string value to allocated bit. */
  bits: Map<string, bigint>
  /** Next available bit (1 << n). */
  nextBits: bigint
}

/** Map from type name (the T tag) to allocator state. */
const _allocators = new Map<string, AllocatorState>()

function _getAllocator(typeName: string): AllocatorState {
  let state = _allocators.get(typeName)
  if (!state) {
    state = { bits: new Map(), nextBits: 1n }
    _allocators.set(typeName, state)
  }
  return state
}

function _allocate(state: AllocatorState, value: string): bigint {
  let bit = state.bits.get(value)
  if (bit === undefined) {
    bit = state.nextBits
    state.nextBits <<= 1n
    state.bits.set(value, bit)
  }
  return bit
}

function _getBits(typeName: string, values: readonly string[]): bigint {
  const state = _getAllocator(typeName)
  let bits = 0n
  for (const value of values) {
    bits |= _allocate(state, value)
  }
  return bits
}

function _getBitsNoAlloc(typeName: string, values: readonly string[]): bigint {
  const state = _getAllocator(typeName)
  let bits = 0n
  for (const value of values) {
    const valueBit = state.bits.get(value)
    if (valueBit !== undefined) {
      bits |= valueBit
    }
  }
  return bits
}

function _getStrings(typeName: string, bits: bigint): string[] {
  const state = _getAllocator(typeName)
  const values: string[] = []
  for (const [key, valueBit] of state.bits) {
    if ((valueBit & bits) !== 0n) {
      values.push(key)
    }
  }
  return values
}

function _bitsContainString(typeName: string, bits: bigint, value: string): boolean {
  const state = _getAllocator(typeName)
  const valueBit = state.bits.get(value)
  if (valueBit === undefined) return false
  return (bits & valueBit) !== 0n
}

// ---------------------------------------------------------------------------
// BitSet<T>
// ---------------------------------------------------------------------------

/**
 * Efficient bit-packed boolean set using bigint for arbitrary precision.
 *
 * OpenRA 对照: BitSet<T>
 *
 * The generic type parameter T serves as a namespace tag — strings are
 * allocated distinct bits per T. Supports standard set operations:
 * union, intersect, except, symmetric except, subset/superset checks.
 *
 * @typeParam T — type tag (class name) for namespace isolation
 */
export class BitSet<T> {
  /** The bit-packed representation using bigint. */
  private readonly bits: bigint

  /** The type name tag for allocator namespace. */
  private readonly typeName: string

  /**
   * Construct a BitSet from string values.
   *
   * OpenRA 对照: BitSet(params string[] values)
   */
  constructor(typeName: string, ...values: readonly string[])
  /**
   * Internal constructor from pre-computed bits.
   */
  constructor(typeName: string, bits: bigint)
  constructor(typeName: string, ...args: readonly (string | bigint)[]) {
    this.typeName = typeName
    if (args.length === 1 && typeof args[0] === 'bigint') {
      this.bits = args[0]
    } else {
      this.bits = _getBits(typeName, args as readonly string[])
    }
  }

  /**
   * Construct a BitSet from string values without allocating new bits.
   *
   * OpenRA 对照: BitSet.FromStringsNoAlloc(string[])
   */
  static fromStringsNoAlloc<T>(typeName: string, values: readonly string[]): BitSet<T> {
    return new BitSet<T>(typeName, _getBitsNoAlloc(typeName, values))
  }

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  /** Whether this set contains no values.
   *
   * OpenRA 对照: BitSet.IsEmpty
   */
  get isEmpty(): boolean {
    return this.bits === 0n
  }

  // -----------------------------------------------------------------------
  // Subset / Superset checks
  // -----------------------------------------------------------------------

  /**
   * Check if this set is a proper subset of another.
   *
   * OpenRA 对照: BitSet.IsProperSubsetOf(BitSet)
   */
  isProperSubsetOf(other: BitSet<T>): boolean {
    return this.isSubsetOf(other) && !this.setEquals(other)
  }

  /**
   * Check if this set is a proper superset of another.
   *
   * OpenRA 对照: BitSet.IsProperSupersetOf(BitSet)
   */
  isProperSupersetOf(other: BitSet<T>): boolean {
    return this.isSupersetOf(other) && !this.setEquals(other)
  }

  /**
   * Check if this set is a subset of another.
   *
   * OpenRA 对照: BitSet.IsSubsetOf(BitSet)
   */
  isSubsetOf(other: BitSet<T>): boolean {
    return (this.bits | other.bits) === other.bits
  }

  /**
   * Check if this set is a superset of another.
   *
   * OpenRA 对照: BitSet.IsSupersetOf(BitSet)
   */
  isSupersetOf(other: BitSet<T>): boolean {
    return (this.bits | other.bits) === this.bits
  }

  /**
   * Check if this set has any overlap with another.
   *
   * OpenRA 对照: BitSet.Overlaps(BitSet)
   */
  overlaps(other: BitSet<T>): boolean {
    return (this.bits & other.bits) !== 0n
  }

  /**
   * Check if both sets contain exactly the same values.
   *
   * OpenRA 对照: BitSet.SetEquals(BitSet)
   */
  setEquals(other: BitSet<T>): boolean {
    return this.bits === other.bits
  }

  // -----------------------------------------------------------------------
  // Set operations
  // -----------------------------------------------------------------------

  /**
   * Return the set difference (this \ other).
   *
   * OpenRA 对照: BitSet.Except(BitSet)
   */
  except(other: BitSet<T>): BitSet<T> {
    return new BitSet<T>(this.typeName, this.bits & ~other.bits)
  }

  /**
   * Return the set intersection (this ∩ other).
   *
   * OpenRA 对照: BitSet.Intersect(BitSet)
   */
  intersect(other: BitSet<T>): BitSet<T> {
    return new BitSet<T>(this.typeName, this.bits & other.bits)
  }

  /**
   * Return the symmetric difference (this △ other).
   *
   * OpenRA 对照: BitSet.SymmetricExcept(BitSet)
   */
  symmetricExcept(other: BitSet<T>): BitSet<T> {
    return new BitSet<T>(this.typeName, this.bits ^ other.bits)
  }

  /**
   * Return the set union (this ∪ other).
   *
   * OpenRA 对照: BitSet.Union(BitSet)
   */
  union(other: BitSet<T>): BitSet<T> {
    return new BitSet<T>(this.typeName, this.bits | other.bits)
  }

  // -----------------------------------------------------------------------
  // Contains
  // -----------------------------------------------------------------------

  /**
   * Check whether a specific string value is in this set.
   *
   * OpenRA 对照: BitSet.Contains(string)
   */
  contains(value: string): boolean {
    return _bitsContainString(this.typeName, this.bits, value)
  }

  // -----------------------------------------------------------------------
  // Enumeration
  // -----------------------------------------------------------------------

  /**
   * Get all string values represented by this set.
   */
  strings(): string[] {
    return _getStrings(this.typeName, this.bits)
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  /**
   * Reset the allocator for a type (for testing).
   *
   * OpenRA 对照: (not in OpenRA — added for test isolation)
   */
  static reset(typeName: string): void {
    _allocators.delete(typeName)
  }

  /**
   * Check equality with another BitSet.
   *
   * OpenRA 对照: BitSet.operator==
   */
  equals(other: BitSet<T>): boolean {
    return this.bits === other.bits
  }

  /**
   * String representation.
   *
   * OpenRA 对照: BitSet.ToString()
   */
  toString(): string {
    return this.strings().join(',')
  }
}
