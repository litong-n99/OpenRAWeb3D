/**
 * SyncReport.test.ts — SyncReport migration unit tests
 *
 * Tests focus on: ring buffer wrapping, report generation with ISync
 * actors/effects, dump formatting, error paths.
 *
 * Babylon.js mocking is not needed — SyncReport is pure logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  SyncReport,
  registerSyncDump,
  clearSyncDumpRegistry,
  getSyncDump,
  type SyncReportOrderManager,
  type SyncReportWorld,
  type SyncReportActorEntry,
  type SyncReportTraitEntry,
  type ClientOrder,
} from './SyncReport.js'
import { type ISync } from '../Sync.js'
import { Sync } from '../Sync.js'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Stub ISync trait for testing.
 *
 * NOTE: Does not `implements ISync` — ISync is an empty marker interface
 * not usable with erasableSyntaxOnly. The type is asserted at usage sites.
 */
class TestSyncTrait {
  health: number
  position: string
  constructor(health: number, position: string) {
    this.health = health
    this.position = position
  }
}

/**
 * Stub ISync effect for testing.
 */
class TestSyncEffect {
  duration: number
  constructor(duration: number) {
    this.duration = duration
  }
}

/** Build a minimal sync actor entry. */
function makeActor(opts: {
  id: number
  type: string
  owner: string
  traits: SyncReportTraitEntry[]
}): SyncReportActorEntry {
  return {
    actorId: opts.id,
    type: opts.type,
    owner: opts.owner,
    syncTraits: opts.traits,
  }
}

/** Build a stub ISync world. */
function makeWorld(overrides: Partial<SyncReportWorld> = {}): SyncReportWorld {
  return {
    syncedRandomLast: 12345,
    syncedRandomTotal: 100,
    getSyncActors: () => [],
    syncedEffects: [],
    ...overrides,
  }
}

/** Build a stub order manager. */
function makeOrderManager(overrides: {
  netFrameNumber?: number
  world?: SyncReportWorld | null
  localClient?: { index: number } | null
} = {}): SyncReportOrderManager {
  return {
    netFrameNumber: overrides.netFrameNumber ?? 42,
    world: overrides.world ?? makeWorld(),
    localClient: overrides.localClient ?? { index: 0 },
  }
}

/** Create a minimal ClientOrder for tests. */
function makeOrder(frame: number, clientId: number): ClientOrder {
  return { frame, clientId, orderData: `Order_${frame}_${clientId}` }
}

/** Cast a test object to ISync (needed because erasableSyntaxOnly disallows `implements ISync`). */
function asISync<T>(obj: T): ISync {
  return obj as unknown as ISync
}

/** Create a SyncReportTraitEntry from a test trait. */
function makeTraitEntry(trait: TestSyncTrait, hash: number): SyncReportTraitEntry {
  return { trait: asISync(trait), hash }
}

// ---------------------------------------------------------------------------
// Setup & teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSyncDumpRegistry()
})

// ---------------------------------------------------------------------------
// describe('SyncReport')
// ---------------------------------------------------------------------------

describe('SyncReport', () => {
  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('pre-allocates NumSyncReports empty reports', () => {
      const om = makeOrderManager()
      const sr = new SyncReport(om)

      expect(sr.reports).toHaveLength(SyncReport.NumSyncReports)
      for (let i = 0; i < SyncReport.NumSyncReports; i++) {
        const r = sr.reports[i]!
        expect(r.frame).toBe(0)
        expect(r.traits).toEqual([])
        expect(r.effects).toEqual([])
        expect(r.orders).toEqual([])
      }
      expect(sr.currentIndex).toBe(0)
    })

    it('starts with curIndex at 0', () => {
      const sr = new SyncReport(makeOrderManager())
      expect(sr.currentIndex).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // updateSyncReport — ring buffer
  // ---------------------------------------------------------------------------

  describe('updateSyncReport', () => {
    it('records Frame and SyncedRandom in the first report', () => {
      const world = makeWorld({ syncedRandomLast: 999, syncedRandomTotal: 42 })
      const om = makeOrderManager({ netFrameNumber: 10, world })
      const sr = new SyncReport(om)

      sr.updateSyncReport([])

      const report = sr.reports[0]!
      expect(report.frame).toBe(10)
      expect(report.syncedRandom).toBe(999)
      expect(report.totalCount).toBe(42)
    })

    it('advances curIndex after each update', () => {
      const sr = new SyncReport(makeOrderManager({ netFrameNumber: 1 }))
      expect(sr.currentIndex).toBe(0)
      sr.updateSyncReport([])
      expect(sr.currentIndex).toBe(1)
      sr.updateSyncReport([])
      expect(sr.currentIndex).toBe(2)
    })

    it('ring buffer wraps at NumSyncReports', () => {
      const sr = new SyncReport(makeOrderManager({}))

      // Fill entire buffer, advancing frame number each time
      for (let i = 0; i < SyncReport.NumSyncReports; i++) {
        // Use a different order manager each time to simulate different frames
        // Simulate different frames
        sr.updateSyncReport([makeOrder(i, 0)])
      }
      expect(sr.currentIndex).toBe(0) // wraps to 0

      // After wrapping, the first slot was overwritten by the last entry
      // Since all entries use frame from the same om, they're all frame 42
      expect(sr.reports[0]!.frame).toBe(42)
    })

    it('copies orders into the report', () => {
      const sr = new SyncReport(makeOrderManager({ netFrameNumber: 1 }))
      const orders: ClientOrder[] = [
        makeOrder(1, 0),
        makeOrder(1, 1),
      ]

      sr.updateSyncReport(orders)

      expect(sr.reports[0]!.orders).toHaveLength(2)
      expect(sr.reports[0]!.orders[0]!.clientId).toBe(0)
      expect(sr.reports[0]!.orders[1]!.clientId).toBe(1)
    })

    it('multiple reports do not interfere with each other', () => {
      const om = makeOrderManager({ netFrameNumber: 1 })
      const sr = new SyncReport(om)

      sr.updateSyncReport([makeOrder(1, 0)])
      const snap1Frame = sr.reports[0]!.frame

      // Advance frame
      // We need a new order manager with different frame number
      // Use a new instance
      const om2 = makeOrderManager({ netFrameNumber: 2, world: om.world })
      const sr2 = new SyncReport(om2)
      sr2.updateSyncReport([makeOrder(2, 1)])
      expect(sr2.reports[0]!.frame).toBe(2)
      expect(sr2.reports[0]!.orders[0]!.clientId).toBe(1)

      // Original report unchanged
      expect(sr.reports[0]!.frame).toBe(snap1Frame)
    })
  })

  // ---------------------------------------------------------------------------
  // generateSyncReport — ISync trait extraction
  // ---------------------------------------------------------------------------

  describe('generateSyncReport (via updateSyncReport)', () => {
    beforeEach(() => {
      clearSyncDumpRegistry()
      // Register dump function for TestSyncTrait
      registerSyncDump('TestSyncTrait', ['health', 'position'], (inst) => {
        const t = inst as TestSyncTrait
        return { health: t.health, position: t.position }
      })
    })

    it('records traits with non-zero hash', () => {
      // Register a hash function for TestSyncTrait so Sync.hash() works
      vi.spyOn(Sync, 'hash').mockImplementation((sync: ISync) => {
        if (sync instanceof TestSyncTrait) return 1234
        return 0
      })

      try {
        const trait = new TestSyncTrait(50, 'center')
        const actor = makeActor({
          id: 100,
          type: '1tnk',
          owner: 'PlayerA',
          traits: [makeTraitEntry(trait, 1234)],
        })
        const world = makeWorld({ getSyncActors: () => [actor] })
        const om = makeOrderManager({ netFrameNumber: 5, world })
        const sr = new SyncReport(om)

        sr.updateSyncReport([])

        const report = sr.reports[0]!
        expect(report.traits).toHaveLength(1)
        expect(report.traits[0]!.actorId).toBe(100)
        expect(report.traits[0]!.type).toBe('1tnk')
        expect(report.traits[0]!.owner).toBe('PlayerA')
        expect(report.traits[0]!.trait).toBe('TestSyncTrait')
        expect(report.traits[0]!.hash).toBe(1234)
        expect(report.traits[0]!.namesValues).toEqual({
          health: 50,
          position: 'center',
        })
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('skips traits with zero hash', () => {
      const trait = new TestSyncTrait(50, 'center')
      const actor = makeActor({
        id: 100,
        type: '1tnk',
        owner: 'PlayerA',
        traits: [makeTraitEntry(trait, 0)],
      })
      const world = makeWorld({ getSyncActors: () => [actor] })
      const om = makeOrderManager({ netFrameNumber: 5, world })
      const sr = new SyncReport(om)

      sr.updateSyncReport([])

      expect(sr.reports[0]!.traits).toHaveLength(0)
    })

    it('records synced effects with non-zero hash', () => {
      const effect = new TestSyncEffect(500)
      // Need ISync capability on TestSyncEffect for Sync.hash()
      // But the C# approach is: Sync.Hash(sync) for effects too.
      // Use the Sync.hash() mock
      vi.spyOn(Sync, 'hash').mockImplementation((sync: ISync) => {
        if (sync instanceof TestSyncEffect) return 5678
        return 0
      })

      try {
        const world = makeWorld({ syncedEffects: [asISync(effect)] })
        const om = makeOrderManager({ netFrameNumber: 5, world })
        const sr = new SyncReport(om)

        sr.updateSyncReport([])

        expect(sr.reports[0]!.effects).toHaveLength(1)
        expect(sr.reports[0]!.effects[0]!.name).toBe('TestSyncEffect')
        expect(sr.reports[0]!.effects[0]!.hash).toBe(5678)
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('skips effects with zero hash', () => {
      const effect = new TestSyncEffect(500)
      vi.spyOn(Sync, 'hash').mockReturnValue(0)

      try {
        const world = makeWorld({ syncedEffects: [asISync(effect)] })
        const om = makeOrderManager({ netFrameNumber: 5, world })
        const sr = new SyncReport(om)

        sr.updateSyncReport([])

        expect(sr.reports[0]!.effects).toHaveLength(0)
      } finally {
        vi.restoreAllMocks()
      }
    })

    it('handles world with null gracefully', () => {
      const om = makeOrderManager({ world: null })
      const sr = new SyncReport(om)

      // Should not throw
      sr.updateSyncReport([])
      expect(sr.reports[0]!.frame).toBe(42)
      expect(sr.reports[0]!.traits).toEqual([])
      expect(sr.reports[0]!.effects).toEqual([])
    })

    it('handles empty world (no ISync actors, no effects)', () => {
      const world = makeWorld({ getSyncActors: () => [], syncedEffects: [] })
      const om = makeOrderManager({ netFrameNumber: 5, world })
      const sr = new SyncReport(om)

      sr.updateSyncReport([])

      expect(sr.reports[0]!.traits).toEqual([])
      expect(sr.reports[0]!.effects).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // dumpSyncReport
  // ---------------------------------------------------------------------------

  describe('dumpSyncReport', () => {
    beforeEach(() => {
      clearSyncDumpRegistry()
    })

    it('formats report for matching frame', () => {
      const om = makeOrderManager({
        netFrameNumber: 100,
        localClient: { index: 0 },
      })
      const sr = new SyncReport(om)
      sr.updateSyncReport([makeOrder(100, 0)])

      const report = sr.dumpSyncReport(100)

      expect(report).toContain('Sync for net frame 100')
      expect(report).toContain('Synced Traits:')
      expect(report).toContain('Synced Effects:')
      expect(report).toContain('Orders Issued:')
      expect(report).toContain('Sync Report System Info:')
      expect(report).toContain('Out of sync frame: 100')
      expect(report).toContain('syncreport-')
      expect(report).toContain('-0.log')
    })

    it('includes recorded frames list', () => {
      const om = makeOrderManager({ netFrameNumber: 1 })
      const sr = new SyncReport(om)
      sr.updateSyncReport([])

      const report = sr.dumpSyncReport(1)
      expect(report).toContain('Recorded frames:')
    })

    it('handles frame not found', () => {
      const om = makeOrderManager({ netFrameNumber: 1 })
      const sr = new SyncReport(om)
      sr.updateSyncReport([])

      const report = sr.dumpSyncReport(999)

      expect(report).toContain(
        'Recorded frames do not contain the frame 999. No sync report available!',
      )
    })

    it('includes all fields from trait dumps', () => {
      registerSyncDump('TestSyncTrait', ['hp', 'pos'], () => ({
        hp: 80,
        pos: '256,512,0',
      }))

      const trait = new TestSyncTrait(80, '256,512,0')
      const actor = makeActor({
        id: 1,
        type: 'e1',
        owner: 'PlayerA',
        traits: [makeTraitEntry(trait, 999)],
      })
      const world = makeWorld({ getSyncActors: () => [actor] })
      const om = makeOrderManager({ netFrameNumber: 50, world })
      const sr = new SyncReport(om)

      sr.updateSyncReport([])
      const report = sr.dumpSyncReport(50)

      // Should contain the trait values (if non-null)
      // Since they are 80 and '256,512,0', both are non-null
      expect(report).toContain('hp')
      expect(report).toContain('pos')
    })

    it('does not crash when no dump function registered for type', () => {
      // TestSyncTrait has no dump registered
      const trait = new TestSyncTrait(10, 'x')
      const actor = makeActor({
        id: 2,
        type: 'harv',
        owner: 'null',
        traits: [makeTraitEntry(trait, 42)],
      })
      const world = makeWorld({ getSyncActors: () => [actor] })
      const om = makeOrderManager({ netFrameNumber: 60, world })
      const sr = new SyncReport(om)

      // Should not throw
      sr.updateSyncReport([])
      const report = sr.dumpSyncReport(60)

      expect(report).toContain('Sync for net frame 60')
      // namesValues is empty because no dump registered
    })
  })

  // ---------------------------------------------------------------------------
  // dumpSyncTrait — registry edge cases
  // ---------------------------------------------------------------------------

  describe('dumpSyncTrait (via registry)', () => {
    it('returns empty object when no dump function registered', () => {
      clearSyncDumpRegistry()
      const trait = new TestSyncTrait(10, 'foo')

      // Use the report directly
      const om = makeOrderManager({
        netFrameNumber: 1,
        world: makeWorld({
          getSyncActors: () => [
            makeActor({
              id: 1,
              type: 'test',
              owner: 'test',
              traits: [makeTraitEntry(trait, 1)],
            }),
          ],
        }),
      })
      const sr = new SyncReport(om)
      sr.updateSyncReport([])

      const report = sr.reports[0]!
      expect(report.traits[0]!.namesValues).toEqual({})
    })

    it('returns values when dump function registered', () => {
      clearSyncDumpRegistry()
      registerSyncDump('TestSyncTrait', ['health', 'position'], (inst) => {
        const t = inst as TestSyncTrait
        return { health: t.health, position: t.position }
      })

      const trait = new TestSyncTrait(30, 'center')
      const om = makeOrderManager({
        netFrameNumber: 1,
        world: makeWorld({
          getSyncActors: () => [
            makeActor({
              id: 1,
              type: 'test',
              owner: 'test',
              traits: [makeTraitEntry(trait, 1)],
            }),
          ],
        }),
      })
      const sr = new SyncReport(om)
      sr.updateSyncReport([])

      const report = sr.reports[0]!
      expect(report.traits[0]!.namesValues).toEqual({
        health: 30,
        position: 'center',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // registerSyncDump / clearSyncDumpRegistry
  // ---------------------------------------------------------------------------

  describe('registry functions', () => {
    it('registerSyncDump stores type info', () => {
      const fn = () => ({ a: 1 })
      registerSyncDump('Foo', ['a'], fn)

      const info = getSyncDump('Foo')
      expect(info).toBeDefined()
      expect(info!.names).toEqual(['a'])
      expect(info!.dumpFn).toBe(fn)
    })

    it('clearSyncDumpRegistry removes all', () => {
      registerSyncDump('Foo', ['a'], () => ({ a: 1 }))
      registerSyncDump('Bar', ['b'], () => ({ b: 2 }))

      clearSyncDumpRegistry()

      expect(getSyncDump('Foo')).toBeUndefined()
      expect(getSyncDump('Bar')).toBeUndefined()
    })
  })
})
