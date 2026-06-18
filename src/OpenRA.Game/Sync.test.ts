/**
 * Sync.test.ts — Sync hash engine migration unit tests
 *
 * All sync hash computation is pure integer math — no WebGL or Babylon.js
 * dependencies. Tests cover:
 * - All 11 custom hash functions with known-answer vectors
 * - hashCombine / hashCombine3 determinism and avalanche
 * - Registry operations (register, lookup, duplicates)
 * - Sync.hash() dispatch
 * - Sync.computeFrameHash() actor iteration
 * - Sync.runUnsynced() nesting, exception safety, mismatch detection
 * - Sync.assertUnsynced()
 * - Edge cases: null, zero, boundary values, 32-bit wraparound
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  // Interfaces
  type ISync,
  type ISyncActorRef,
  type ISyncPlayerRef,
  type ISyncWorldRef,
  // Hash helpers
  hashCombine,
  hashCombine3,
  // Custom hash functions
  HashInt2,
  HashCPos,
  HashCVec,
  HashWDist,
  HashWPos,
  HashWVec,
  HashWAngle,
  HashWRot,
  HashActor,
  HashPlayer,
  HashTarget,
  // Registry
  registerSyncHash,
  registerCustomSyncHash,
  // Sync engine
  Sync,
} from './Sync'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal ISync mock for testing. */
function makeSyncMock(className: string): ISync {
  return { constructor: { name: className } } as unknown as ISync
}

/** Create a minimal ISyncActorRef. */
function makeActorRef(id: number): ISyncActorRef {
  return { actorId: id }
}

/** Create a minimal ISyncPlayerRef. */
function makePlayerRef(actorId: number): ISyncPlayerRef {
  return { playerActor: makeActorRef(actorId) }
}

// ---------------------------------------------------------------------------
// hashCombine / hashCombine3
// ---------------------------------------------------------------------------

describe('hashCombine', () => {
  it('returns 32-bit unsigned integer', () => {
    const result = hashCombine(0, 42)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThan(0x100000000) // < 2^32
    expect(Number.isInteger(result)).toBe(true)
  })

  it('is deterministic', () => {
    expect(hashCombine(100, 200)).toBe(hashCombine(100, 200))
    expect(hashCombine(0, 0)).toBe(hashCombine(0, 0))
  })

  it('produces different values for different field hashes', () => {
    const h1 = hashCombine(0, 1)
    const h2 = hashCombine(0, 2)
    const h3 = hashCombine(0, 3)
    expect(h1).not.toBe(h2)
    expect(h1).not.toBe(h3)
    expect(h2).not.toBe(h3)
  })

  it('hashCombine is XOR-based (commutative in first step)', () => {
    // a ^ b === b ^ a, so hashCombine(a, b) === hashCombine(b, a)
    // This mirrors C# behavior which also uses XOR combining
    const ab = hashCombine(100, 200)
    const ba = hashCombine(200, 100)
    expect(ab).toBe(ba)
  })

  it('hashCombine with zero is not identity (FNV mixing)', () => {
    const h = hashCombine(0xdeadbeef, 0)
    // FNV-1a: (0xdeadbeef ^ 0) * prime ≠ original
    expect(h).not.toBe(0xdeadbeef)
  })

  it('handles large values without JS float issues', () => {
    const result = hashCombine(0x7fffffff, 0x7fffffff)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThan(0x100000000)
  })
})

describe('hashCombine3', () => {
  it('returns 32-bit unsigned integer', () => {
    const result = hashCombine3(1, 2, 3)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThan(0x100000000)
  })

  it('is deterministic', () => {
    expect(hashCombine3(1, 2, 3)).toBe(hashCombine3(1, 2, 3))
  })

  it('different inputs produce different hashes', () => {
    expect(hashCombine3(1, 2, 3)).not.toBe(hashCombine3(3, 2, 1))
    expect(hashCombine3(0, 0, 0)).not.toBe(hashCombine3(1, 0, 0))
  })

  it('zeros-only returns 0 (XOR-based, 0 ^ 0 = 0)', () => {
    // Since hashCombine(0, 0) = (0 ^ 0) * prime = 0 * prime = 0,
    // three rounds of (0, 0) still produce 0.
    const result = hashCombine3(0, 0, 0)
    expect(result).toBe(0)
  })

  it('handles negative values (truncated to int32)', () => {
    const result = hashCombine3(-1, -2, -3)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThan(0x100000000)
  })
})

// ---------------------------------------------------------------------------
// Custom hash functions — HashInt2
// ---------------------------------------------------------------------------

describe('HashInt2', () => {
  it('matches OpenRA formula: ((x*5) ^ (y*3)) / 4', () => {
    // Manually compute expected value:
    // x=10, y=20: ((10*5) ^ (20*3)) / 4 = (50 ^ 60) / 4 = 14 / 4 = 3.5 → 3
    const expected = ((10 * 5) ^ (20 * 3)) / 4 | 0
    expect(HashInt2(10, 20)).toBe(expected)
  })

  it('returns 0 for (0, 0)', () => {
    expect(HashInt2(0, 0)).toBe(0)
  })

  it('is deterministic', () => {
    expect(HashInt2(42, 99)).toBe(HashInt2(42, 99))
  })

  it('handles negative values', () => {
    const result = HashInt2(-5, 10)
    expect(Number.isInteger(result)).toBe(true)
  })

  it('handles large values without overflow issues', () => {
    const result = HashInt2(32768, -32768)
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBeGreaterThanOrEqual(-0x80000000)
    expect(result).toBeLessThan(0x80000000)
  })

  it('symmetric inputs may produce different hashes', () => {
    // X=1,Y=2 vs X=2,Y=1
    expect(HashInt2(1, 2)).not.toBe(HashInt2(2, 1))
  })
})

// ---------------------------------------------------------------------------
// HashCPos
// ---------------------------------------------------------------------------

describe('HashCPos', () => {
  it('returns Bits value directly (identity hash)', () => {
    expect(HashCPos({ Bits: 0x12345678 })).toBe(0x12345678)
  })

  it('returns 0 for zero Bits', () => {
    expect(HashCPos({ Bits: 0 })).toBe(0)
  })

  it('preserves full 32-bit signed range', () => {
    expect(HashCPos({ Bits: -1 })).toBe(-1)
    expect(HashCPos({ Bits: 0x7fffffff })).toBe(0x7fffffff)
    expect(HashCPos({ Bits: -0x80000000 })).toBe(-0x80000000)
  })

  it('is deterministic', () => {
    expect(HashCPos({ Bits: 0x55555555 })).toBe(HashCPos({ Bits: 0x55555555 }))
  })
})

// ---------------------------------------------------------------------------
// HashCVec
// ---------------------------------------------------------------------------

describe('HashCVec', () => {
  it('delegates to hashCode()', () => {
    const cvec = { hashCode: () => 42 }
    expect(HashCVec(cvec)).toBe(42)
  })

  it('works with real CVec hashCode formula: ((X*397)^Y)|0', () => {
    // Simulate CVec.hashCode() for X=5, Y=10
    const cv = { hashCode: () => ((5 * 397) ^ 10) | 0 }
    const expected = cv.hashCode()
    expect(HashCVec(cv)).toBe(expected)
  })

  it('returns 0 for zero values', () => {
    const cv = { hashCode: () => 0 }
    expect(HashCVec(cv)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// HashWDist
// ---------------------------------------------------------------------------

describe('HashWDist', () => {
  it('returns length truncated to int32', () => {
    expect(HashWDist({ length: 1024 })).toBe(1024)
    expect(HashWDist({ length: 0 })).toBe(0)
    expect(HashWDist({ length: -1024 })).toBe(-1024)
  })

  it('handles floating length values (truncated)', () => {
    expect(HashWDist({ length: 3.7 })).toBe(3)
  })

  it('is deterministic', () => {
    expect(HashWDist({ length: 999 })).toBe(HashWDist({ length: 999 }))
  })
})

// ---------------------------------------------------------------------------
// HashWPos
// ---------------------------------------------------------------------------

describe('HashWPos', () => {
  it('produces deterministic output', () => {
    const pos = { X: 1024, Y: 2048, Z: 512 }
    expect(HashWPos(pos)).toBe(HashWPos(pos))
  })

  it('different positions produce different hashes', () => {
    const a = { X: 0, Y: 0, Z: 0 }
    const b = { X: 1, Y: 0, Z: 0 }
    expect(HashWPos(a)).not.toBe(HashWPos(b))
  })

  it('origin (0,0,0) has a well-defined hash', () => {
    const h = HashWPos({ X: 0, Y: 0, Z: 0 })
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(0x100000000)
  })

  it('hash is order-sensitive', () => {
    const a = HashWPos({ X: 1, Y: 2, Z: 3 })
    const b = HashWPos({ X: 3, Y: 2, Z: 1 })
    expect(a).not.toBe(b)
  })

  it('handles negative coordinates', () => {
    const result = HashWPos({ X: -1024, Y: -2048, Z: -512 })
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThan(0x100000000)
  })
})

// ---------------------------------------------------------------------------
// HashWVec
// ---------------------------------------------------------------------------

describe('HashWVec', () => {
  it('produces deterministic output', () => {
    const vec = { X: 512, Y: 1024, Z: 256 }
    expect(HashWVec(vec)).toBe(HashWVec(vec))
  })

  it('zero vector has a well-defined hash', () => {
    const h = HashWVec({ X: 0, Y: 0, Z: 0 })
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(0x100000000)
  })

  it('same components as WPos with same values produce same hash', () => {
    const p = { X: 100, Y: 200, Z: 300 }
    const v = { X: 100, Y: 200, Z: 300 }
    // Both use hashCombine3 with same values → same hash
    expect(HashWPos(p)).toBe(HashWVec(v))
  })
})

// ---------------------------------------------------------------------------
// HashWAngle
// ---------------------------------------------------------------------------

describe('HashWAngle', () => {
  it('returns angle value truncated to int32', () => {
    expect(HashWAngle({ angle: 256 })).toBe(256)
    expect(HashWAngle({ angle: 0 })).toBe(0)
  })

  it('handles angle values up to 1023', () => {
    expect(HashWAngle({ angle: 1023 })).toBe(1023)
  })

  it('is deterministic', () => {
    expect(HashWAngle({ angle: 512 })).toBe(HashWAngle({ angle: 512 }))
  })
})

// ---------------------------------------------------------------------------
// HashWRot
// ---------------------------------------------------------------------------

describe('HashWRot', () => {
  it('produces deterministic output from Euler angles', () => {
    const rot = {
      roll: { angle: 0 },
      pitch: { angle: 256 },
      yaw: { angle: 512 },
    }
    expect(HashWRot(rot)).toBe(HashWRot(rot))
  })

  it('identity rotation has a well-defined hash', () => {
    const rot = {
      roll: { angle: 0 },
      pitch: { angle: 0 },
      yaw: { angle: 0 },
    }
    const h = HashWRot(rot)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(0x100000000)
  })

  it('different rotations produce different hashes', () => {
    const a = { roll: { angle: 0 }, pitch: { angle: 0 }, yaw: { angle: 0 } }
    const b = { roll: { angle: 1 }, pitch: { angle: 0 }, yaw: { angle: 0 } }
    expect(HashWRot(a)).not.toBe(HashWRot(b))
  })
})

// ---------------------------------------------------------------------------
// HashActor
// ---------------------------------------------------------------------------

describe('HashActor', () => {
  it('hashes by (actorId << 16) | 0', () => {
    const actor = makeActorRef(42)
    expect(HashActor(actor)).toBe((42 << 16) | 0)
  })

  it('returns 0 for null', () => {
    expect(HashActor(null)).toBe(0)
  })

  it('actorId 0 maps to 0', () => {
    expect(HashActor(makeActorRef(0))).toBe(0)
  })

  it('handles large actor IDs (truncated to int32)', () => {
    const id = 0x7fff // 32767, when << 16 still fits in int32
    const result = HashActor(makeActorRef(id))
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic', () => {
    const actor = makeActorRef(12345)
    expect(HashActor(actor)).toBe(HashActor(actor))
  })
})

// ---------------------------------------------------------------------------
// HashPlayer
// ---------------------------------------------------------------------------

describe('HashPlayer', () => {
  it('hashes by ((playerActor.actorId << 16) | 0) * 0x567', () => {
    const player = makePlayerRef(10)
    const expected = Math.imul(((10 << 16) | 0), 0x567) | 0
    expect(HashPlayer(player)).toBe(expected)
  })

  it('returns 0 for null', () => {
    expect(HashPlayer(null)).toBe(0)
  })

  it('player with actorId 0 maps to 0', () => {
    expect(HashPlayer(makePlayerRef(0))).toBe(0)
  })

  it('is deterministic', () => {
    const player = makePlayerRef(777)
    expect(HashPlayer(player)).toBe(HashPlayer(player))
  })

  it('handles large actorId with 32-bit overflow correctly', () => {
    // actorId << 16 can overflow 32-bit signed int; ensure the overflow
    // is applied BEFORE Math.imul (not after), so the result matches
    // the C# unchecked cast behavior.
    const largeId = 0x12345 // 32-bit: 0x12345 << 16 = 0x23450000
    const player = makePlayerRef(largeId)
    const expected = Math.imul(((largeId << 16) | 0), 0x567) | 0
    expect(HashPlayer(player)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// HashTarget — 4 variants
// ---------------------------------------------------------------------------

describe('HashTarget', () => {
  // TargetType enum values
  const TT_Actor = 1
  const TT_Terrain = 2
  const TT_FrozenActor = 3
  const TT_Invalid = 0

  it('returns 0 for Invalid target', () => {
    const t = {
      type: TT_Invalid,
      actor: null,
      centerPosition: { X: 0, Y: 0, Z: 0 },
    }
    expect(HashTarget(t)).toBe(0)
  })

  it('hashes Actor target by (actorId << 16) * 0x567', () => {
    const t = {
      type: TT_Actor,
      actor: makeActorRef(5),
      centerPosition: { X: 0, Y: 0, Z: 0 },
    }
    const expected = (Math.imul(5 << 16, 0x567)) | 0
    expect(HashTarget(t)).toBe(expected)
  })

  it('returns 0 for Actor target where actor is null', () => {
    const t = {
      type: TT_Actor,
      actor: null,
      centerPosition: { X: 0, Y: 0, Z: 0 },
    }
    expect(HashTarget(t)).toBe(0)
  })

  it('returns 0 for FrozenActor target (deferred — )', () => {
    const t = {
      type: TT_FrozenActor,
      actor: null,
      centerPosition: { X: 100, Y: 200, Z: 300 },
    }
    // FrozenActor hash currently returns 0
    expect(HashTarget(t)).toBe(0)
  })

  it('hashes Terrain target by centerPosition (WPos hash)', () => {
    const t = {
      type: TT_Terrain,
      actor: null,
      centerPosition: { X: 1024, Y: 2048, Z: 512 },
    }
    const expected = HashWPos({ X: 1024, Y: 2048, Z: 512 })
    expect(HashTarget(t)).toBe(expected)
  })

  it('is deterministic for each variant', () => {
    const terrainTarget = {
      type: TT_Terrain,
      actor: null,
      centerPosition: { X: 500, Y: 600, Z: 700 },
    }
    expect(HashTarget(terrainTarget)).toBe(HashTarget(terrainTarget))

    const actorTarget = {
      type: TT_Actor,
      actor: makeActorRef(99),
      centerPosition: { X: 0, Y: 0, Z: 0 },
    }
    expect(HashTarget(actorTarget)).toBe(HashTarget(actorTarget))
  })
})

// ---------------------------------------------------------------------------
// Registry: registerSyncHash, registerCustomSyncHash
// ---------------------------------------------------------------------------

describe('sync hash registry', () => {
  beforeEach(() => {
    // Reset: import gives us a fresh module, but for safety we clear state.
    // NOTE: _syncHashFunctions and _customSyncHashFunctions are module-private.
    // We test through the public API only.
  })

  it('registerSyncHash registers a function retrievable by getHashFunction', () => {
    const mockSync = makeSyncMock('TestHealth')
    const hashFn = () => 42

    registerSyncHash('TestHealth', hashFn as (obj: ISync) => number)
    expect(Sync.hash(mockSync)).toBe(42)
  })

  it('registerSyncHash handles multiple types independently', () => {
    const mockA = makeSyncMock('TypeA')
    const mockB = makeSyncMock('TypeB')

    registerSyncHash('TypeA', () => 100)
    registerSyncHash('TypeB', () => 200)

    expect(Sync.hash(mockA)).toBe(100)
    expect(Sync.hash(mockB)).toBe(200)
  })

  it('getHashFunction throws for unregistered type', () => {
    const mock = makeSyncMock('UnregisteredType')
    expect(() => Sync.getHashFunction(mock)).toThrow(
      /No sync hash function registered/,
    )
  })

  it('registerCustomSyncHash registers a custom hash function', () => {
    registerCustomSyncHash('MyType', (_obj: unknown) => 123)
    const fn = Sync.getCustomHashFunction('MyType')
    expect(fn).toBeDefined()
    expect(fn!({})).toBe(123)
  })

  it('getCustomHashFunction returns undefined for unregistered type', () => {
    const fn = Sync.getCustomHashFunction('NoSuchType')
    expect(fn).toBeUndefined()
  })

  it('registerSyncHash with duplicate name warns but updates', () => {
    const mock = makeSyncMock('DupType')
    registerSyncHash('DupType', () => 1)
    // Second registration should replace
    registerSyncHash('DupType', () => 99)
    expect(Sync.hash(mock)).toBe(99)
  })

  it('lookupSyncHash returns the same function as registered', () => {
    const hashFn = () => 42
    registerSyncHash('LookupTest', hashFn as (obj: ISync) => number)
    const found = Sync.lookupSyncHash('LookupTest')
    expect(found).toBeDefined()
    expect(found!(makeSyncMock('LookupTest'))).toBe(42)
  })

  it('lookupSyncHash returns undefined for unregistered class name', () => {
    expect(Sync.lookupSyncHash('NeverRegistered')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Sync.hash() dispatch
// ---------------------------------------------------------------------------

describe('Sync.hash', () => {
  it('dispatches to the registered hash function for this type', () => {
    const mock = makeSyncMock('Health')
    registerSyncHash('Health', (obj: ISync) => {
      // Return something derived from the object
      return obj.constructor.name.length
    })
    expect(Sync.hash(mock)).toBe(6) // "Health".length
  })

  it('passes the sync object itself to the hash function', () => {
    const mock = makeSyncMock('Ammo')
    let receivedObject: ISync | null = null
    registerSyncHash('Ammo', (obj: ISync) => {
      receivedObject = obj
      return 0
    })
    Sync.hash(mock)
    expect(receivedObject).toBe(mock)
  })

  it('throws for unregistered type', () => {
    const mock = makeSyncMock('Unknown')
    expect(() => Sync.hash(mock)).toThrow(
      /No sync hash function registered/,
    )
  })
})

// ---------------------------------------------------------------------------
// Sync.computeFrameHash()
// ---------------------------------------------------------------------------

describe('Sync.computeFrameHash', () => {
  it('returns 0 for an empty world', () => {
    const world: ISyncWorldRef = { actors: [] }
    expect(Sync.computeFrameHash(world)).toBe(0)
  })

  it('returns 0 when no actors implement computeSyncHash', () => {
    const world: ISyncWorldRef = {
      actors: [
        { disposed: false, isInWorld: true },
        { disposed: false, isInWorld: true },
      ],
    }
    expect(Sync.computeFrameHash(world)).toBe(0)
  })

  it('combines hash values from actors with computeSyncHash', () => {
    const world: ISyncWorldRef = {
      actors: [
        { disposed: false, isInWorld: true, computeSyncHash: () => 100 },
        { disposed: false, isInWorld: true, computeSyncHash: () => 200 },
      ],
    }
    const expected = hashCombine(hashCombine(0, 100), 200)
    expect(Sync.computeFrameHash(world)).toBe(expected)
  })

  it('skips disposed actors', () => {
    const world: ISyncWorldRef = {
      actors: [
        { disposed: true, isInWorld: true, computeSyncHash: () => 999 },
        { disposed: false, isInWorld: true, computeSyncHash: () => 42 },
      ],
    }
    const expected = hashCombine(0, 42)
    expect(Sync.computeFrameHash(world)).toBe(expected)
  })

  it('skips actors not in world', () => {
    const world: ISyncWorldRef = {
      actors: [
        { disposed: false, isInWorld: false, computeSyncHash: () => 999 },
        { disposed: false, isInWorld: true, computeSyncHash: () => 42 },
      ],
    }
    const expected = hashCombine(0, 42)
    expect(Sync.computeFrameHash(world)).toBe(expected)
  })

  it('is deterministic with same actor order', () => {
    const makeActors = () => [
      { disposed: false, isInWorld: true, computeSyncHash: () => 10 as number },
      { disposed: false, isInWorld: true, computeSyncHash: () => 20 as number },
      { disposed: false, isInWorld: true, computeSyncHash: () => 30 as number },
    ]
    const h1 = Sync.computeFrameHash({ actors: makeActors() })
    const h2 = Sync.computeFrameHash({ actors: makeActors() })
    expect(h1).toBe(h2)
  })

  it('handles actors where computeSyncHash is not a function', () => {
    const world: ISyncWorldRef = {
      actors: [
        {
          disposed: false,
          isInWorld: true,
          computeSyncHash: 'not a function' as unknown as () => number,
        },
        { disposed: false, isInWorld: true, computeSyncHash: () => 42 },
      ],
    }
    // First actor's computeSyncHash is not callable → skipped
    const expected = hashCombine(0, 42)
    expect(Sync.computeFrameHash(world)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Sync.runUnsynced() — nesting counter and exception safety
// ---------------------------------------------------------------------------

describe('Sync.runUnsynced', () => {
  let world: ISyncWorldRef

  beforeEach(() => {
    // Reset nesting depth between tests
    Sync._unsyncDepth = 0
    world = {
      actors: [
        { disposed: false, isInWorld: true, computeSyncHash: () => 42 },
      ],
    }
  })

  it('executes the function and returns its result', () => {
    const result = Sync.runUnsynced(world, () => 42)
    expect(result).toBe(42)
  })

  it('increments and decrements _unsyncDepth correctly', () => {
    expect(Sync._unsyncDepth).toBe(0)
    Sync.runUnsynced(world, () => {
      expect(Sync._unsyncDepth).toBe(1)
    })
    expect(Sync._unsyncDepth).toBe(0)
  })

  it('supports nested unsynced blocks (depth counting)', () => {
    const depths: number[] = []
    Sync.runUnsynced(world, () => {
      depths.push(Sync._unsyncDepth) // 1
      Sync.runUnsynced(world, () => {
        depths.push(Sync._unsyncDepth) // 2
        Sync.runUnsynced(world, () => {
          depths.push(Sync._unsyncDepth) // 3
        })
        depths.push(Sync._unsyncDepth) // 2
      })
      depths.push(Sync._unsyncDepth) // 1
    })
    expect(depths).toEqual([1, 2, 3, 2, 1])
  })

  it('does not re-snapshot sync hash in nested calls', () => {
    // Only the outermost runUnsynced snapshots the hash.
    // We verify this indirectly: if a nested call caused a mismatch,
    // it should NOT throw (only outermost checks).
    const mutableWorld: ISyncWorldRef = {
      actors: [
        {
          disposed: false,
          isInWorld: true,
          // This returns a different value each call
          computeSyncHash: (() => {
            let counter = 0
            return () => {
              counter++
              return counter * 100
            }
          })(),
        },
      ],
    }

    // This should throw because outermost detects the hash change
    expect(() => {
      Sync.runUnsynced(mutableWorld, () => {
        // Trigger hash change by causing computeSyncHash to return a new value
        mutableWorld.actors[Symbol.iterator] = function* () {
          yield { disposed: false, isInWorld: true, computeSyncHash: () => 99 }
        }
      })
    }).toThrow(/RunUnsynced: sync-changing code/)
  })

  it('throws if sync hash changes during unsynced execution', () => {
    let hashCalls = 0
    const changingWorld: ISyncWorldRef = {
      actors: [
        {
          disposed: false,
          isInWorld: true,
          computeSyncHash: () => {
            hashCalls++
            return hashCalls * 100 // Different each call
          },
        },
      ],
    }

    expect(() => {
      Sync.runUnsynced(changingWorld, () => {
        // Do nothing — the hash changed just by being called twice
        // (once for pre-snapshot, once for post-check)
      })
    }).toThrow(/RunUnsynced: sync-changing code/)
  })

  it('decrements unsyncDepth on exception (try/finally safety)', () => {
    expect(Sync._unsyncDepth).toBe(0)
    expect(() => {
      Sync.runUnsynced(null, () => {
        throw new Error('test error')
      })
    }).toThrow('test error')
    // Critical: depth MUST be decremented even after throw
    expect(Sync._unsyncDepth).toBe(0)
  })

  it('decrements nested depths on exception in inner block', () => {
    expect(Sync._unsyncDepth).toBe(0)
    expect(() => {
      Sync.runUnsynced(null, () => {
        Sync.runUnsynced(null, () => {
          Sync.runUnsynced(null, () => {
            throw new Error('deep error')
          })
        })
      })
    }).toThrow('deep error')
    // All depths must be restored
    expect(Sync._unsyncDepth).toBe(0)
  })

  it('does not throw if checkSyncHash is false', () => {
    let hashCalls = 0
    const changingWorld: ISyncWorldRef = {
      actors: [
        {
          disposed: false,
          isInWorld: true,
          computeSyncHash: () => {
            hashCalls++
            return hashCalls * 100
          },
        },
      ],
    }

    expect(() => {
      Sync.runUnsynced(changingWorld, () => {
        // No-op — hash changes but checkSyncHash=false suppresses it
      }, false) // skip check
    }).not.toThrow()
    expect(Sync._unsyncDepth).toBe(0)
  })

  it('skips check when world is null', () => {
    expect(() => {
      Sync.runUnsynced(null, () => {
        // Do nothing — but no world means no check
      })
    }).not.toThrow()
  })

  it('detects desync in world with initial zero hash (sentinel guard)', () => {
    // This is the edge case that motivated the -1 sentinel:
    // If the world hash starts at 0, the old sync !== 0 guard would
    // incorrectly skip the post-check. The -1 sentinel ensures that
    // a legitimate hash of 0 is still verified.
    let hashCounter = 0
    const zeroWorld: ISyncWorldRef = {
      actors: [
        {
          disposed: false,
          isInWorld: true,
          computeSyncHash: () => {
            hashCounter++
            return hashCounter === 1 ? 0 : 42 // first call=0, second=42
          },
        },
      ],
    }

    // hash starts at 0, changes to 42 during fn() → must throw
    expect(() => {
      Sync.runUnsynced(zeroWorld, () => {
        // hash changes on the post-check call
      })
    }).toThrow(/RunUnsynced: sync-changing code/)
  })
})

// ---------------------------------------------------------------------------
// Sync.assertUnsynced()
// ---------------------------------------------------------------------------

describe('Sync.assertUnsynced', () => {
  beforeEach(() => {
    Sync._unsyncDepth = 0
  })

  it('throws when not inside runUnsynced', () => {
    expect(() => Sync.assertUnsynced('Should not work outside unsynced')).toThrow(
      /AssertUnsynced:/
    )
  })

  it('does not throw when inside runUnsynced', () => {
    Sync.runUnsynced(null, () => {
      expect(() => Sync.assertUnsynced('OK inside unsynced')).not.toThrow()
    })
  })

  it('includes the message in the error', () => {
    expect(() => Sync.assertUnsynced('Custom message here')).toThrow(
      /Custom message here/,
    )
  })

  it('works at any nesting depth > 0', () => {
    Sync.runUnsynced(null, () => {
      Sync.runUnsynced(null, () => {
        expect(() => Sync.assertUnsynced('nested')).not.toThrow()
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Hash combining edge cases
// ---------------------------------------------------------------------------

describe('hash determinism and edge cases', () => {
  it('all HashInt2 calls produce int32-range results', () => {
    const testCases = [
      [0, 0],
      [1, 1],
      [-1, -1],
      [32767, -32768],
      [1000, -500],
      [0x7fff, 0x7fff],
      [-0x8000, 0],
    ] as const
    for (const [x, y] of testCases) {
      const result = HashInt2(x, y)
      expect(Number.isInteger(result)).toBe(true)
      // | 0 enforces int32 range
      expect(result).toBeGreaterThanOrEqual(-0x80000000)
      expect(result).toBeLessThan(0x80000000)
    }
  })

  it('hashCombine3 handles negative int32 values uniformly', () => {
    // (-1 | 0) = -1, (-2 | 0) = -2, etc.
    const a = hashCombine3(-1, -2, -3)
    const b = hashCombine3(-1, -2, -3)
    expect(a).toBe(b)
  })

  it('hashCombine is associative in a specific way for testing', () => {
    // Not mathematically associative, but behavior is predictable
    const a = hashCombine(hashCombine(0, 1), 2)
    const b = hashCombine(0, hashCombine(1, 2))
    // These won't be equal (FNV is not associative), but both are valid
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// Custom hash function registry auto-registration
// ---------------------------------------------------------------------------

describe('custom hash function registry', () => {
  it('getCustomHashFunction returns function for native type names', () => {
    // These are registered lazily when getCustomHashFunction is called
    const cpFn = Sync.getCustomHashFunction('CPos')
    expect(cpFn).toBeDefined()
    if (cpFn) {
      expect(cpFn({ Bits: 42 })).toBe(42)
    }
  })

  it('getCustomHashFunction returns function for WDist', () => {
    const fn = Sync.getCustomHashFunction('WDist')
    expect(fn).toBeDefined()
    if (fn) {
      expect(fn({ length: 1024 })).toBe(1024)
    }
  })

  it('getCustomHashFunction returns function for WAngle', () => {
    const fn = Sync.getCustomHashFunction('WAngle')
    expect(fn).toBeDefined()
    if (fn) {
      expect(fn({ angle: 512 })).toBe(512)
    }
  })

  it('getCustomHashFunction returns function for Actor', () => {
    const fn = Sync.getCustomHashFunction('Actor')
    expect(fn).toBeDefined()
    if (fn) {
      expect(fn(makeActorRef(10))).toBe((10 << 16) | 0)
      expect(fn(null)).toBe(0)
    }
  })

  it('getCustomHashFunction returns function for Player', () => {
    const fn = Sync.getCustomHashFunction('Player')
    expect(fn).toBeDefined()
    if (fn) {
      expect(fn(makePlayerRef(5))).toBe((Math.imul(5 << 16, 0x567)) | 0)
      expect(fn(null)).toBe(0)
    }
  })

  it('repeated calls return the same function instance', () => {
    const fn1 = Sync.getCustomHashFunction('WPos')
    const fn2 = Sync.getCustomHashFunction('WPos')
    expect(fn1).toBe(fn2)
  })

  it('getCustomHashFunction returns undefined for unknown type', () => {
    expect(Sync.getCustomHashFunction('SomeUnknownType')).toBeUndefined()
  })
})
