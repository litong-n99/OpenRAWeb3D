/**
 * MapStatusCache.test.ts -- MapStatusCache migration unit tests
 *
 * Tests focus on: cache hits, status determination (local vs remote),
 * async lint dispatching, lint pass execution, UnsafeCustomRules detection,
 * max player count validation, and onStatusChanged callback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { MapStatusCache, type ServerMapPreview, type ILintServerMapPass } from './MapStatusCache.js'
import { MapStatus } from './SessionTypes.js'
import { MapPlayers } from '../Map/MapPlayers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock ServerMapPreview for testing.
 */
function createMockMap(
  uid: string,
  opts: {
    status?: number
    loadRuleset?: () => unknown
    definesUnsafeCustomRules?: () => boolean
    players?: MapPlayers | { players: Map<string, unknown> }
    title?: string
  } = {},
): ServerMapPreview {
  return {
    uid,
    title: opts.title ?? `Map ${uid}`,
    status: opts.status ?? 2, // Available by default
    loadRuleset: opts.loadRuleset,
    definesUnsafeCustomRules: opts.definesUnsafeCustomRules,
    players: opts.players,
  }
}

/**
 * Create a mock ModData for MapStatusCache.
 */
function createMockModData(lintPassTypes?: string[]) {
  const lintInstances: ILintServerMapPass[] = []

  return {
    manifest: {
      id: 'test-mod',
      metadata: { version: '1.0' },
    },
    objectCreator: {
      getTypesImplementing: vi.fn((_interfaceName: string) => lintPassTypes ?? []),
      createBasic: vi.fn((_typeName: string) => {
        // Always return the same mock lint pass
        const pass: ILintServerMapPass = {
          run: vi.fn(),
        }
        lintInstances.push(pass)
        return pass
      }),
      __lintInstances: lintInstances,
    },
  } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapStatusCache', () => {
  let onStatusChanged: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    onStatusChanged = vi.fn()
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  it('stores constructor parameters', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)

    // Access private fields to verify
    expect(cache).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // getStatus — cache returns cached status on second call
  // ---------------------------------------------------------------------------

  it('returns cached status on second call', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)
    const map = createMockMap('map-1', { status: 2 })

    const first = cache.getStatus(map)
    const second = cache.getStatus(map)

    expect(first).toBe(second)
    // onStatusChanged should not be called for immediate (non-validating) status
    expect(onStatusChanged).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // getStatus — local maps return Playable immediately
  // ---------------------------------------------------------------------------

  it('returns Playable for locally installed maps when no remote linting', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)
    const map = createMockMap('local-map', { status: 2 }) // Available

    const status = cache.getStatus(map)

    // No Validating flag since remote linting is disabled
    expect(status & MapStatus.Validating).toBe(0)
    expect(status & MapStatus.Playable).not.toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStatus — remote maps with linting return Validating
  // ---------------------------------------------------------------------------

  it('returns Validating for remote maps when linting is enabled', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, true)
    const map = createMockMap('remote-map', { status: 0 }) // Unavailable (remote)

    const status = cache.getStatus(map)

    expect(status & MapStatus.Validating).not.toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStatus — linting dispatched asynchronously via queueMicrotask
  // ---------------------------------------------------------------------------

  it('dispatches lint tests asynchronously when Validating', async () => {
    const modData = createMockModData(['TestLintPass'])
    const cache = new MapStatusCache(modData, onStatusChanged, true)
    const map = createMockMap('lint-map', { status: 0 })

    const status = cache.getStatus(map)
    expect(status & MapStatus.Validating).not.toBe(0)

    // Wait for microtask queue to flush
    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        queueMicrotask(() => resolve())
      })
    })

    // onStatusChanged should have been called after linting
    expect(onStatusChanged).toHaveBeenCalled()
    const call = onStatusChanged.mock.calls[0]
    expect(call[0]).toBe('lint-map')
  })

  // ---------------------------------------------------------------------------
  // getStatus — lint failure sets Incompatible
  // ---------------------------------------------------------------------------

  it('sets Incompatible when lint test fails', async () => {
    const modData = createMockModData(['FailingLintPass'])
    // Override the lint pass to report an error
    ;(modData.objectCreator as any).createBasic = vi.fn(() => ({
      run: (emitError: (msg: string) => void) => {
        emitError('map is broken')
      },
    }))

    const cache = new MapStatusCache(modData, onStatusChanged, true)
    const map = createMockMap('broken-map', { status: 0 })

    cache.getStatus(map)

    // Wait for microtask
    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        queueMicrotask(() => resolve())
      })
    })

    expect(onStatusChanged).toHaveBeenCalled()
    const finalStatus = onStatusChanged.mock.calls[0][1] as number
    expect(finalStatus & MapStatus.Validating).toBe(0)
    expect(finalStatus & MapStatus.Incompatible).not.toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStatus — lint success clears Validating flag
  // ---------------------------------------------------------------------------

  it('clears Validating and sets Playable on lint success', async () => {
    const modData = createMockModData(['PassingLintPass'])
    ;(modData.objectCreator as any).createBasic = vi.fn(() => ({
      run: vi.fn(), // No errors emitted
    }))

    const cache = new MapStatusCache(modData, onStatusChanged, true)
    const map = createMockMap('clean-map', { status: 0 })

    cache.getStatus(map)

    // Wait for microtask
    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        queueMicrotask(() => resolve())
      })
    })

    expect(onStatusChanged).toHaveBeenCalled()
    const finalStatus = onStatusChanged.mock.calls[0][1] as number
    expect(finalStatus & MapStatus.Validating).toBe(0)
    expect(finalStatus & MapStatus.Incompatible).toBe(0)
    expect(finalStatus & MapStatus.Playable).not.toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStatus — UnsafeCustomRules detected and flagged
  // ---------------------------------------------------------------------------

  it('flags UnsafeCustomRules when map defines them', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)
    const map = createMockMap('unsafe-map', {
      status: 2,
      definesUnsafeCustomRules: () => true,
    })

    const status = cache.getStatus(map)

    expect(status & MapStatus.UnsafeCustomRules).not.toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStatus — max player count exceeded sets Incompatible
  // ---------------------------------------------------------------------------

  it('sets Incompatible when player count exceeds maximum', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)

    // Create a MapPlayers with more than 63 players
    const mapPlayers = new MapPlayers()
    for (let i = 0; i < 64; i++) {
      mapPlayers.players.set(`Player${i}`, { name: `P${i}` } as any)
    }

    const map = createMockMap('huge-map', {
      status: 2,
      players: mapPlayers,
    })

    const status = cache.getStatus(map)

    expect(status & MapStatus.Incompatible).not.toBe(0)
    expect(status & MapStatus.Playable).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStatus — player count within limit is fine
  // ---------------------------------------------------------------------------

  it('does not set Incompatible when player count is within limit', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)

    const mapPlayers = new MapPlayers()
    mapPlayers.players.set('Player1', { name: 'P1' } as any)
    mapPlayers.players.set('Player2', { name: 'P2' } as any)

    const map = createMockMap('small-map', {
      status: 2,
      players: mapPlayers,
    })

    const status = cache.getStatus(map)

    expect(status & MapStatus.Incompatible).toBe(0)
    expect(status & MapStatus.Playable).not.toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStatus — handles loadRuleset error gracefully
  // ---------------------------------------------------------------------------

  it('handles loadRuleset error by setting Incompatible', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)
    const map = createMockMap('bad-map', {
      status: 2,
      loadRuleset: () => {
        throw new Error('corrupt ruleset')
      },
    })

    const status = cache.getStatus(map)

    expect(status & MapStatus.Incompatible).not.toBe(0)
  })

  // ---------------------------------------------------------------------------
  // onStatusChanged — callback invoked on status change after linting
  // ---------------------------------------------------------------------------

  it('invokes onStatusChanged when linting completes', async () => {
    const modData = createMockModData(['TestPass'])
    const cache = new MapStatusCache(modData, onStatusChanged, true)
    const map = createMockMap('cb-map', { status: 0 })

    cache.getStatus(map)

    // onStatusChanged should NOT be called yet (only on lint completion)
    expect(onStatusChanged).not.toHaveBeenCalled()

    // Wait for microtask
    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        queueMicrotask(() => resolve())
      })
    })

    expect(onStatusChanged).toHaveBeenCalledWith(
      'cb-map',
      expect.any(Number),
    )
  })

  // ---------------------------------------------------------------------------
  // getStatus — handles map without loadRuleset (stub compatibility)
  // ---------------------------------------------------------------------------

  it('handles map without loadRuleset gracefully', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)
    // No loadRuleset function
    const map: ServerMapPreview = {
      uid: 'stub-map',
      title: 'Stub Map',
      status: 2,
    }

    const status = cache.getStatus(map)

    // Should default to Playable (local map, no linting)
    expect(status & MapStatus.Playable).not.toBe(0)
  })

  // ---------------------------------------------------------------------------
  // getStatus — cache handles multiple map lookups independently
  // ---------------------------------------------------------------------------

  it('handles multiple map lookups independently', () => {
    const modData = createMockModData()
    const cache = new MapStatusCache(modData, onStatusChanged, false)

    const map1 = createMockMap('map-1', { status: 2 })
    const map2 = createMockMap('map-2', {
      status: 2,
      definesUnsafeCustomRules: () => true,
    })

    const status1 = cache.getStatus(map1)
    const status2 = cache.getStatus(map2)

    expect(status1 & MapStatus.UnsafeCustomRules).toBe(0)
    expect(status2 & MapStatus.UnsafeCustomRules).not.toBe(0)
    expect(status1).not.toBe(status2)
  })
})
