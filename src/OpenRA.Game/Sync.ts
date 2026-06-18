/**
 * Sync.ts — Deterministic lockstep sync hash engine
 * OpenRA 对照: OpenRA.Game/Sync.cs (212 lines)
 *
 * 核心范式转换:
 * - C# [VerifySync] attribute → JSDoc /** @VerifySync *`/` marker (scanned by
 *   build-time sync-hash-generator.ts; no decorators — tsconfig uses
 *   erasableSyntaxOnly)
 * - C# Reflection.Emit DynamicMethod → build-time AST code generation
 *   (utils/sync-hash-generator.ts) + runtime registry (Map<string, function>)
 * - C# ConcurrentCache<Type, Func<object, int>> → Map<string, (obj) => number>
 *   populated at import time
 * - C# XOR-based hash combining → FNV-1a combining for better distribution
 * - C# RunUnsynced<T>() nested detection → identical nesting counter pattern
 *   with try/finally for exception safety
 * - ZERO floating-point arithmetic — all hash math uses | 0, >>> 0, Math.imul()
 */

// ---------------------------------------------------------------------------
// Interfaces (avoid circular dependencies with Actor / Player / World)
// ---------------------------------------------------------------------------

/**
 * Marker interface for classes that participate in sync hash computation.
 *
 * OpenRA 对照: ISync interface
 *
 * Fields within ISync classes should be marked with /** @VerifySync *`/` in JSDoc.
 * The build-time sync-hash-generator.ts scans for this marker and generates
 * computeSyncHash() functions into sync-hashes.generated.ts.
 */
export interface ISync {
  /* marker — no members required */
}

/**
 * Minimal Actor reference for sync hashing.
 * Avoids importing GameActor (circular dependency risk).
 */
export interface ISyncActorRef {
  readonly actorId: number
}

/**
 * Minimal Player reference for sync hashing.
 * Avoids importing Player (circular dependency risk).
 */
export interface ISyncPlayerRef {
  readonly playerActor: ISyncActorRef
}

/**
 * Minimal World reference for computeFrameHash.
 * Avoids importing World (circular dependency risk).
 */
export interface ISyncWorldRef {
  readonly actors: Iterable<{
    readonly disposed?: boolean
    readonly isInWorld?: boolean
    computeSyncHash?(): number
  }>
}

// ---------------------------------------------------------------------------
// Hash combining (FNV-1a inspired, 32-bit)
// ---------------------------------------------------------------------------

/**
 * Combine two 32-bit hashes using FNV-1a mixing.
 *
 * NOTE: OpenRA uses XOR-based combining. We use FNV-1a which provides
 * better avalanche effect and distribution for multi-field hashes.
 * This is safe because all clients run the same TypeScript code.
 *
 * @param hash — accumulated hash so far
 * @param fieldHash — hash of the next field
 * @returns combined 32-bit unsigned hash
 */
export function hashCombine(hash: number, fieldHash: number): number {
  return (Math.imul((hash ^ fieldHash) >>> 0, 0x01000193) >>> 0)
}

/**
 * Combine three field values into a single hash.
 * Used by WPos, WVec, WRot — types with exactly 3 component fields.
 *
 * @param a — first field value (e.g., X, Roll)
 * @param b — second field value (e.g., Y, Pitch)
 * @param c — third field value (e.g., Z, Yaw)
 * @returns 32-bit unsigned hash
 */
export function hashCombine3(a: number, b: number, c: number): number {
  let h = 0
  h = hashCombine(h, a | 0)
  h = hashCombine(h, b | 0)
  h = hashCombine(h, c | 0)
  return h
}

// ---------------------------------------------------------------------------
// Custom hash functions for coordinate types (11 total, 对应 OpenRA
// CustomHashFunctions dictionary)
// ---------------------------------------------------------------------------

/**
 * Hash an int2 (X, Y pair) the same way OpenRA does.
 *
 * OpenRA 对照: Sync.HashInt2(int2)
 *
 * Used when a sync field is of type int2 (OpenRA.Primitives).
 * CVec fields use HashCVec instead.
 */
export function HashInt2(x: number, y: number): number {
  return ((Math.imul(x, 5) ^ Math.imul(y, 3)) / 4) | 0
}

/**
 * Hash a CPos from its bit-packed representation.
 *
 * OpenRA 对照: Sync.HashCPos(CPos)
 *
 * CPos.Bits is the packed 32-bit integer (X|Y|Layer). This is an identity
 * hash — two equal CPos always produce the same Bits value.
 */
export function HashCPos(cpos: { readonly Bits: number }): number {
  return cpos.Bits
}

/**
 * Hash a CVec using its existing hashCode() method.
 *
 * OpenRA 对照: Sync.HashCVec(CVec)
 *
 * NOTE: OpenRA CVec uses the same formula as int2. TypeScript CVec has its
 * own deterministic hashCode() which uses a different algorithm for better
 * distribution. This is safe because all clients run the same TypeScript.
 */
export function HashCVec(cvec: { hashCode(): number }): number {
  return cvec.hashCode()
}

/**
 * Hash a WDist from its length field.
 *
 * OpenRA 对照: Sync.HashUsingHashCode(WDist) → WDist.GetHashCode()
 */
export function HashWDist(wdist: { readonly length: number }): number {
  return wdist.length | 0
}

/**
 * Hash a WPos from its X, Y, Z coordinates.
 *
 * OpenRA 对照: Sync.HashUsingHashCode(WPos) → WPos.GetHashCode()
 */
export function HashWPos(wpos: { readonly X: number; readonly Y: number; readonly Z: number }): number {
  return hashCombine3(wpos.X, wpos.Y, wpos.Z)
}

/**
 * Hash a WVec from its X, Y, Z components.
 *
 * OpenRA 对照: Sync.HashUsingHashCode(WVec) → WVec.GetHashCode()
 */
export function HashWVec(wvec: { readonly X: number; readonly Y: number; readonly Z: number }): number {
  return hashCombine3(wvec.X, wvec.Y, wvec.Z)
}

/**
 * Hash a WAngle from its angle value.
 *
 * OpenRA 对照: Sync.HashUsingHashCode(WAngle) → WAngle.GetHashCode()
 */
export function HashWAngle(wangle: { readonly angle: number }): number {
  return wangle.angle | 0
}

/**
 * Hash a WRot from the Euler angles of its three components.
 *
 * OpenRA 对照: Sync.HashUsingHashCode(WRot) → WRot.GetHashCode()
 *
 * Uses Roll.angle, Pitch.angle, Yaw.angle (already normalized to [0, 1024)).
 */
export function HashWRot(wrot: {
  readonly roll: { readonly angle: number }
  readonly pitch: { readonly angle: number }
  readonly yaw: { readonly angle: number }
}): number {
  return hashCombine3(wrot.roll.angle, wrot.pitch.angle, wrot.yaw.angle)
}

/**
 * Hash an Actor by its unique actor ID.
 *
 * OpenRA 对照: Sync.HashActor(Actor)
 *
 * @param a — the actor (or null → returns 0)
 */
export function HashActor(a: ISyncActorRef | null): number {
  if (a !== null) return (a.actorId << 16) | 0
  return 0
}

/**
 * Hash a Player by their PlayerActor's actor ID.
 *
 * OpenRA 对照: Sync.HashPlayer(Player)
 *
 * @param p — the player (or null → returns 0)
 */
export function HashPlayer(p: ISyncPlayerRef | null): number {
  if (p !== null) return Math.imul(((p.playerActor.actorId << 16) | 0), 0x567) | 0
  return 0
}

/**
 * Hash a Target, dispatching to the correct hash for its 4 variant types.
 *
 * OpenRA 对照: Sync.HashTarget(Target)
 *
 * - Actor: hashes by actor ID
 * - FrozenActor: DEFERRED (returns 0 — )
 * - Terrain: hashes by center position (WPos)
 * - Invalid: returns 0
 */
export function HashTarget(target: {
  readonly type: number
  readonly actor: ISyncActorRef | null
  readonly centerPosition: { readonly X: number; readonly Y: number; readonly Z: number }
}): number {
  // TargetType enum values (matched from Traits/Target.ts):
  const TT_Invalid = 0
  const TT_Actor = 1
  const TT_Terrain = 2
  const TT_FrozenActor = 3

  switch (target.type) {
    case TT_Actor: {
      const actor = target.actor
      if (actor === null) return 0
      return Math.imul(((actor.actorId << 16) | 0), 0x567) | 0
    }
    case TT_FrozenActor:
      // NOTE: FrozenActor hash deferred ().
      // Full implementation requires accessing FrozenActor.Actor, which
      // needs the FrozenActor type and World for actor resolution.
      return 0
    case TT_Terrain:
      return HashWPos(target.centerPosition)
    case TT_Invalid:
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// Sync hash registry (populated by sync-hashes.generated.ts at import time)
// ---------------------------------------------------------------------------

/**
 * Registry of generated sync hash functions keyed by class constructor name.
 *
 * OpenRA 对照: Sync.HashFunctions (ConcurrentCache<Type, Func<object, int>>)
 */
const _syncHashFunctions = new Map<string, (obj: ISync) => number>()

/**
 * Registry of custom hash functions for coordinate/primitives types.
 *
 * OpenRA 对照: Sync.CustomHashFunctions (FrozenDictionary<Type, MethodInfo>)
 *
 * Maps type name strings to hash functions. The build-time generator
 * uses this to resolve custom hashers for field types.
 */
const _customSyncHashFunctions = new Map<string, (obj: unknown) => number>()

/**
 * Register a generated sync hash function.
 *
 * Called by sync-hashes.generated.ts at module import time.
 * Each generated function computes the FNV-1a hash of a specific
 * ISync class's @VerifySync fields.
 *
 * @param className — the constructor name of the ISync class
 * @param fn — the hash function: (obj) => 32-bit unsigned hash
 */
export function registerSyncHash(
  className: string,
  fn: (obj: ISync) => number,
): void {
  if (_syncHashFunctions.has(className)) {
    // Duplicate registration — generated file may have been imported twice
    console.warn(`Sync: duplicate hash function registration for "${className}"`)
  }
  _syncHashFunctions.set(className, fn)
}

/**
 * Register a custom hash function for a coordinate/primitives type.
 *
 * Typically called during module initialization to populate the table
 * before the build-time generator needs it (not strictly required at
 * runtime since the generator outputs inline calls).
 *
 * @param typeName — the type name string (e.g., "CPos", "WPos")
 * @param fn — the hash function
 */
export function registerCustomSyncHash(
  typeName: string,
  fn: (obj: unknown) => number,
): void {
  _customSyncHashFunctions.set(typeName, fn)
}

/**
 * Populate the custom hash function registry with all 11 built-in hashers.
 *
 * Called lazily on first access to getHashFunction() or getCustomHashFunction().
 * Idempotent — subsequent calls are no-ops.
 */
let _customHashFunctionsRegistered = false
function _ensureCustomHashFunctions(): void {
  if (_customHashFunctionsRegistered) return
  _customHashFunctionsRegistered = true

  _customSyncHashFunctions.set('int2', (o: unknown) => {
    const v = o as { X: number; Y: number }
    return HashInt2(v.X, v.Y)
  })
  // CPos hash: supports both { Bits } and the full CPos class
  _customSyncHashFunctions.set('CPos', (o: unknown) => {
    const v = o as { Bits: number }
    return HashCPos(v)
  })
  _customSyncHashFunctions.set('CVec', (o: unknown) => {
    const v = o as { hashCode(): number }
    return HashCVec(v)
  })
  _customSyncHashFunctions.set('WDist', (o: unknown) => {
    const v = o as { length: number }
    return HashWDist(v)
  })
  _customSyncHashFunctions.set('WPos', (o: unknown) => {
    const v = o as { X: number; Y: number; Z: number }
    return HashWPos(v)
  })
  _customSyncHashFunctions.set('WVec', (o: unknown) => {
    const v = o as { X: number; Y: number; Z: number }
    return HashWVec(v)
  })
  _customSyncHashFunctions.set('WAngle', (o: unknown) => {
    const v = o as { angle: number }
    return HashWAngle(v)
  })
  _customSyncHashFunctions.set('WRot', (o: unknown) => {
    const v = o as {
      roll: { angle: number }
      pitch: { angle: number }
      yaw: { angle: number }
    }
    return HashWRot(v)
  })
  _customSyncHashFunctions.set('Actor', (o: unknown) => {
    return HashActor(o as ISyncActorRef | null)
  })
  _customSyncHashFunctions.set('Player', (o: unknown) => {
    return HashPlayer(o as ISyncPlayerRef | null)
  })
  // NOTE: Target custom hash is registered as 'Target' but the switch logic
  // needs the full discriminated union type. The generated code calls
  // HashTarget() directly rather than going through the registry.
  _customSyncHashFunctions.set('Target', (o: unknown) => {
    return HashTarget(
      o as {
        readonly type: number
        readonly actor: ISyncActorRef | null
        readonly centerPosition: { X: number; Y: number; Z: number }
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Sync — static utility class (对应 OpenRA static class Sync)
// ---------------------------------------------------------------------------

/**
 * Deterministic lockstep sync hash engine.
 *
 * OpenRA 对照: Sync (static class, 212 lines)
 *
 * Usage:
 * ```typescript
 * // Register custom hash functions (auto on module load)
 * // Generated file calls:
 * registerSyncHash('Health', (obj) => { ... })
 *
 * // Compute hash of a sync participant:
 * const hash = Sync.hash(myTrait)
 *
 * // Run unsafe (non-deterministic) code:
 * Sync.runUnsynced(world, () => { Math.random(); debugDraw(); })
 * ```
 */
export const Sync = {
  /**
   * Look up the hash function registered for a given ISync object.
   *
   * OpenRA 对照: Sync.GetHashFunction(ISync)
   *
   * @param sync — the ISync object to find a hash function for
   * @returns the registered hash function
   * @throws Error if no hash function is registered for this type
   */
  getHashFunction(sync: ISync): (obj: ISync) => number {
    _ensureCustomHashFunctions()
    const name = sync.constructor.name
    const fn = _syncHashFunctions.get(name)
    if (!fn) {
      throw new Error(
        `No sync hash function registered for "${name}". ` +
        `Ensure sync-hashes.generated.ts has been built and imported.`,
      )
    }
    return fn
  },

  /**
   * Compute the sync hash for an ISync object.
   *
   * OpenRA 对照: Sync.Hash(ISync)
   *
   * @param sync — the ISync object to hash
   * @returns 32-bit unsigned hash value
   */
  hash(sync: ISync): number {
    return Sync.getHashFunction(sync)(sync)
  },

  /**
   * Get the registered custom hash function for a given type name.
   *
   * OpenRA 对照: CustomHashFunctions.TryGetValue(Type, out MethodInfo)
   *
   * @param typeName — the constructor name of the type
   * @returns the custom hash function, or undefined if not registered
   */
  getCustomHashFunction(typeName: string): ((obj: unknown) => number) | undefined {
    _ensureCustomHashFunctions()
    return _customSyncHashFunctions.get(typeName)
  },

  /**
   * Look up a generated sync hash function by class name.
   *
   * Used by generated code (sync-hashes.generated.ts) for nested ISync fields.
   * Exported to avoid exposing the private registry.
   *
   * @param className — the constructor name of the ISync class
   * @returns the registered hash function, or undefined if not found
   */
  lookupSyncHash(className: string): ((obj: ISync) => number) | undefined {
    _ensureCustomHashFunctions()
    return _syncHashFunctions.get(className)
  },

  /**
   * Compute a combined frame hash over all ISync-participating actors in
   * the world.
   *
   * OpenRA 对照: world.SyncHash() (extension method using Sync)
   *
   * Walks `world.actors`, calling `computeSyncHash()` on each actor that
   * is in the world and not disposed. Combines all per-actor hashes using
   * FNV-1a.
   *
   * @param world — the game world (minimal interface for sync)
   * @returns 32-bit unsigned combined frame hash (0 if no actors)
   */
  computeFrameHash(world: ISyncWorldRef): number {
    let hash = 0
    for (const actor of world.actors) {
      if (actor.disposed === true) continue
      if (actor.isInWorld === false) continue
      if (typeof actor.computeSyncHash === 'function') {
        hash = hashCombine(hash, actor.computeSyncHash())
      }
    }
    return hash
  },

  // -----------------------------------------------------------------------
  // RunUnsynced — nesting counter pattern (对应 OpenRA RunUnsynced)
  // -----------------------------------------------------------------------

  /**
   * Nesting depth counter. > 0 when inside a runUnsynced() block.
   *
   * OpenRA 对照: Sync.unsyncCount (static int)
   */
  _unsyncDepth: 0,

  /**
   * Execute a function that is allowed to produce non-deterministic results
   * (e.g., debug rendering, UI updates). Guards against sync state mutation
   * by snapshotting the sync hash before and after execution.
   *
   * OpenRA 对照: Sync.RunUnsynced<T>(World, Func<T>)
   *
   * Nesting: nested runUnsynced() calls simply increment/decrement the
   * counter without re-snapshotting the hash.
   *
   * Exception safety: uses try/finally to guarantee the counter is
   * decremented even if fn() throws. This matches C#'s finally block.
   *
   * @param world — the world to check sync hash against (null skips check)
   * @param fn — the function to execute
   * @param checkSyncHash — whether to verify sync hash is unchanged
   *   (default: true). Pass false for bootstrap/loading code.
   * @returns the return value of fn()
   * @throws Error if sync hash changed during unsynced execution
   */
  runUnsynced<T>(
    world: ISyncWorldRef | null,
    fn: () => T,
    checkSyncHash: boolean = true,
  ): T {
    Sync._unsyncDepth++

    // Snapshot sync hash on first (outermost) entry only.
    // Nested entries do not re-snapshot.
    // Use -1 as sentinel for "no snapshot taken" (hash is always >= 0).
    const NO_SNAPSHOT = -1
    const sync =
      Sync._unsyncDepth === 1 && checkSyncHash && world !== null
        ? Sync.computeFrameHash(world)
        : NO_SNAPSHOT

    // try/finally ensures unsyncCount is decremented even if fn() throws.
    // This matches C#'s try/finally pattern exactly.
    try {
      return fn()
    } finally {
      Sync._unsyncDepth--

      // On outermost exit: verify sync hash has not changed.
      // Skip check if no snapshot was taken (sentinel value).
      if (
        Sync._unsyncDepth === 0 &&
        checkSyncHash &&
        world !== null &&
        sync !== NO_SNAPSHOT
      ) {
        const postSync = Sync.computeFrameHash(world)
        if (sync !== postSync) {
          throw new Error(
            'RunUnsynced: sync-changing code may not run in an unsynced context. ' +
            `Pre-hash: ${sync.toString(16)}, Post-hash: ${postSync.toString(16)}`,
          )
        }
      }
    }
  },

  // -----------------------------------------------------------------------
  // AssertUnsynced (对应 OpenRA AssertUnsynced)
  // -----------------------------------------------------------------------

  /**
   * Assert that the caller is inside a `runUnsynced()` block.
   * Throws if not, providing a clear error message for debugging.
   *
   * OpenRA 对照: Sync.AssertUnsynced(string)
   *
   * @param message — explanation of what requires unsynced context
   * @throws Error if not inside runUnsynced()
   */
  assertUnsynced(message: string): void {
    if (Sync._unsyncDepth === 0) {
      throw new Error(
        `AssertUnsynced: ${message}. This code may only run inside Sync.runUnsynced().`,
      )
    }
  },
}

// Ensure custom hash functions are registered lazily on first use.
// _ensureCustomHashFunctions() is called by getHashFunction() and
// getCustomHashFunction().
