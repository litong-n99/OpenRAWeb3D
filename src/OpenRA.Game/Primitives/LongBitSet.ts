/**
 * LongBitSet.ts — Bit-packed set limited to 64 values (for PlayerMask)
 * OpenRA 对照: OpenRA.Game/Primitives/LongBitSet.cs
 *
 * 核心范式转换:
 * - C# long (64-bit) → TypeScript bigint (with overflow guard)
 * - C# LongBitSetAllocator<T> static class → module-level allocator
 * - Generic type T serves as namespace tag
 * - Reset() supported for testing/cleanup
 * - Maximum 64 values enforced (throws on overflow)
 */

// ---------------------------------------------------------------------------
// Global allocator (per T namespace, max 64 bits)
// ---------------------------------------------------------------------------

interface LongAllocatorState {
  bits: Map<string, bigint>
  nextBits: bigint
}

const _longAllocators = new Map<string, LongAllocatorState>()

function _getLongAllocator(typeName: string): LongAllocatorState {
  let state = _longAllocators.get(typeName)
  if (!state) {
    state = { bits: new Map(), nextBits: 1n }
    _longAllocators.set(typeName, state)
  }
  return state
}

function _longAllocate(state: LongAllocatorState, value: string): bigint {
  let bit = state.bits.get(value)
  if (bit === undefined) {
    // LongBitSet is limited to 64 values
    if (state.bits.size >= 64) {
      throw new Error(
        'LongBitSet: Trying to allocate bit index outside of index 64.',
      )
    }
    bit = state.nextBits
    state.nextBits <<= 1n
    state.bits.set(value, bit)
  }
  return bit
}

function _longGetBits(typeName: string, values: readonly string[]): bigint {
  const state = _getLongAllocator(typeName)
  let bits = 0n
  for (const value of values) {
    bits |= _longAllocate(state, value)
  }
  return bits
}

function _longGetBitsNoAlloc(typeName: string, values: readonly string[]): bigint {
  const state = _getLongAllocator(typeName)
  let bits = 0n
  for (const value of values) {
    const valueBit = state.bits.get(value)
    if (valueBit !== undefined) {
      bits |= valueBit
    }
  }
  return bits
}

function _longGetStrings(typeName: string, bits: bigint): string[] {
  const state = _getLongAllocator(typeName)
  const values: string[] = []
  for (const [key, valueBit] of state.bits) {
    if ((valueBit & bits) !== 0n) {
      values.push(key)
    }
  }
  return values
}

function _longBitsContainString(typeName: string, bits: bigint, value: string): boolean {
  const state = _getLongAllocator(typeName)
  const valueBit = state.bits.get(value)
  if (valueBit === undefined) return false
  return (bits & valueBit) !== 0n
}

// ---------------------------------------------------------------------------
// LongBitSet<T>
// ---------------------------------------------------------------------------

/**
 * Optimized bit-packed set limited to 64 values.
 *
 * OpenRA 对照: LongBitSet<T>
 *
 * Used for PlayerMask where up to 64 players need O(1) relationship queries
 * via bitwise AND. Throws on attempt to allocate beyond 64 values.
 *
 * @typeParam T — type tag for namespace isolation
 */
export class LongBitSet<T> {
  private readonly bits: bigint
  private readonly typeName: string

  /**
   * Construct a LongBitSet from string values.
   *
   * OpenRA 对照: LongBitSet(params string[])
   */
  constructor(typeName: string, ...values: readonly string[])
  /** Internal constructor from pre-computed bits. */
  constructor(typeName: string, bits: bigint)
  constructor(typeName: string, ...args: readonly (string | bigint)[]) {
    this.typeName = typeName
    if (args.length === 1 && typeof args[0] === 'bigint') {
      this.bits = args[0]
    } else {
      this.bits = _longGetBits(typeName, args as readonly string[])
    }
  }

  /**
   * Construct without allocating new bits for unknown strings.
   *
   * OpenRA 对照: LongBitSet.FromStringsNoAlloc(string[])
   */
  static fromStringsNoAlloc<T>(typeName: string, values: readonly string[]): LongBitSet<T> {
    return new LongBitSet<T>(typeName, _longGetBitsNoAlloc(typeName, values))
  }

  /**
   * Reset the allocator for a type (for testing/cleanup).
   *
   * OpenRA 对照: LongBitSet.Reset()
   */
  static reset(typeName: string): void {
    _longAllocators.delete(typeName)
  }

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  get isEmpty(): boolean {
    return this.bits === 0n
  }

  // -----------------------------------------------------------------------
  // Subset / Superset checks
  // -----------------------------------------------------------------------

  isProperSubsetOf(other: LongBitSet<T>): boolean {
    return this.isSubsetOf(other) && !this.setEquals(other)
  }

  isProperSupersetOf(other: LongBitSet<T>): boolean {
    return this.isSupersetOf(other) && !this.setEquals(other)
  }

  isSubsetOf(other: LongBitSet<T>): boolean {
    return (this.bits | other.bits) === other.bits
  }

  isSupersetOf(other: LongBitSet<T>): boolean {
    return (this.bits | other.bits) === this.bits
  }

  overlaps(other: LongBitSet<T>): boolean {
    return (this.bits & other.bits) !== 0n
  }

  setEquals(other: LongBitSet<T>): boolean {
    return this.bits === other.bits
  }

  // -----------------------------------------------------------------------
  // Set operations
  // -----------------------------------------------------------------------

  except(other: LongBitSet<T>): LongBitSet<T> {
    return new LongBitSet<T>(this.typeName, this.bits & ~other.bits)
  }

  intersect(other: LongBitSet<T>): LongBitSet<T> {
    return new LongBitSet<T>(this.typeName, this.bits & other.bits)
  }

  symmetricExcept(other: LongBitSet<T>): LongBitSet<T> {
    return new LongBitSet<T>(this.typeName, this.bits ^ other.bits)
  }

  union(other: LongBitSet<T>): LongBitSet<T> {
    return new LongBitSet<T>(this.typeName, this.bits | other.bits)
  }

  // -----------------------------------------------------------------------
  // Contains
  // -----------------------------------------------------------------------

  contains(value: string): boolean {
    return _longBitsContainString(this.typeName, this.bits, value)
  }

  // -----------------------------------------------------------------------
  // Enumeration
  // -----------------------------------------------------------------------

  strings(): string[] {
    return _longGetStrings(this.typeName, this.bits)
  }

  // -----------------------------------------------------------------------
  // Standard overrides
  // -----------------------------------------------------------------------

  equals(other: LongBitSet<T>): boolean {
    return this.bits === other.bits
  }

  toString(): string {
    return this.strings().join(',')
  }
}
