/**
 * SyncReport.ts — Desync diagnostic report generator with ring buffer
 * OpenRA 对照: OpenRA.Game/Network/SyncReport.cs (342 lines)
 *
 * 核心范式转换:
 * - C# Expression.Lambda<Func<ISync, object>> + Compile() → TypeScript runtime
 *   dump function registry (Map<string, dumpFn>), populated at module init time.
 *   TODO: Replace with build-time code generation (ADR-17.4) extending
 *   utils/sync-hash-generator.ts to emit dumpSyncState() functions.
 * - C# Values struct (4-slot inline storage optimization) → plain unknown[]
 *   (JS arrays are heap-allocated anyway)
 * - C# Log.AddChannel("sync", filename) / Log.Write() → returns formatted
 *   report string for download or console output
 * - C# Cache<Type, TypeInfo> with lock → Map<string, SyncTypeInfo> (JS is
 *   single-threaded)
 *
 * SyncReport snapshots ISync trait state across the last 7 frames in a ring
 * buffer. When a network desync is detected, dumpSyncReport() searches the
 * ring buffer for the desync frame and produces a detailed diagnostic report
 * including all sync trait values, synced effects, and pending orders.
 */

import { Sync, type ISync } from '../Sync.js'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Per-trait field dump function.
 *
 * Takes an ISync instance and returns an object mapping property names to
 * their current values (string or boxed number/boolean).
 *
 * OpenRA 对照: TypeInfo.SerializableCopyOfMemberFunctions array
 */
export type SyncDumpFn = (instance: ISync) => Record<string, unknown>

/**
 * Cached type info for a single ISync class.
 *
 * OpenRA 对照: SyncReport.TypeInfo (readonly struct)
 */
export interface SyncTypeInfo {
  /** Ordered list of @VerifySync-annotated property names. */
  readonly names: string[]
  /** Dump function that extracts all sync field values from an instance. */
  readonly dumpFn: SyncDumpFn
}

/**
 * Single trait entry in a sync report.
 *
 * OpenRA 对照: SyncReport.TraitReport (struct)
 */
export interface TraitReport {
  /** Actor unique identifier. */
  actorId: number
  /** Actor type name (Info.Name). */
  type: string
  /** Owner player name, or "null". */
  owner: string
  /** ISync trait class name. */
  trait: string
  /** Computed sync hash value. */
  hash: number
  /** All @VerifySync field name-value pairs. */
  namesValues: Record<string, unknown>
}

/**
 * Single effect entry in a sync report.
 *
 * OpenRA 对照: SyncReport.EffectReport (struct)
 */
export interface EffectReport {
  /** Effect type/class name. */
  name: string
  /** Computed sync hash value. */
  hash: number
  /** All @VerifySync field name-value pairs. */
  namesValues: Record<string, unknown>
}

/**
 * Client order entry in a sync report snapshot.
 *
 * OpenRA 对照: OrderManager.ClientOrder
 */
export interface ClientOrder {
  /** Frame number when the order was issued. */
  readonly frame: number
  /** Client slot that issued the order. */
  readonly clientId: number
  /** Serialized order data description. */
  readonly orderData: string
}

/**
 * Per-frame sync report snapshot.
 *
 * OpenRA 对照: SyncReport.Report (sealed class)
 */
export interface SyncFrameReport {
  /** Network frame number when this report was captured. */
  frame: number
  /** Last random number produced by the shared RNG. */
  syncedRandom: number
  /** Total number of random numbers generated so far. */
  totalCount: number
  /** All ISync traits with non-zero hashes. */
  traits: TraitReport[]
  /** All synced effects with non-zero hashes. */
  effects: EffectReport[]
  /** Pending client orders at this frame. */
  orders: ClientOrder[]
}

// ---------------------------------------------------------------------------
// Minimal world/order manager interfaces (SyncReport is a debug tool —
// we accept minimal stubs rather than importing the full GameWorldManager)
// ---------------------------------------------------------------------------

/**
 * Entry describing an actor's ISync trait for sync reporting.
 *
 * Each actor may have multiple ISync-implementing traits; each trait
 * produces its own TraitReport entry.
 */
export interface SyncReportTraitEntry {
  /** The ISync trait instance. */
  trait: ISync
  /** Computed sync hash for this trait (from Sync.hash()). */
  hash: number
}

/**
 * Entry describing an actor for sync reporting.
 */
export interface SyncReportActorEntry {
  readonly actorId: number
  readonly type: string
  readonly owner: string
  readonly syncTraits: readonly SyncReportTraitEntry[]
}

/**
 * Minimal world view needed by SyncReport.
 *
 * OpenRA 对照: World reference fields used by SyncReport
 */
export interface SyncReportWorld {
  /** Last generated random number. */
  readonly syncedRandomLast: number
  /** Total random roll count. */
  readonly syncedRandomTotal: number
  /** All ISync-participating actors with their trait data. */
  getSyncActors(): readonly SyncReportActorEntry[]
  /** All synced effects currently active. */
  readonly syncedEffects: readonly ISync[]
}

/**
 * Minimal order manager view needed by SyncReport.
 */
export interface SyncReportOrderManager {
  readonly netFrameNumber: number
  readonly world: SyncReportWorld | null
  readonly localClient: {
    readonly index: number
    readonly name?: string
  } | null
}

// ---------------------------------------------------------------------------
// Runtime dump function registry
// ---------------------------------------------------------------------------

/**
 * Global registry of dump functions keyed by ISync class constructor name.
 *
 * OpenRA 对照: TypeInfoCache = new Cache<Type, TypeInfo>
 *
 * Populated at module init time by registered ISync classes. The build-time
 * code generator (sync-hash-generator.ts) extends this registry alongside
 * the hash function registry in Sync.ts.
 *
 * TODO-17.D.1a: Replace with build-time code generation (ADR-17.4).
 */
const syncDumpRegistry = new Map<string, SyncTypeInfo>()

/**
 * Register a dump function for an ISync class.
 *
 * OpenRA 对照: TypeInfoCache[t] = new TypeInfo(t) (auto-populated by
 * expression tree compilation)
 *
 * Called by ISync classes or generated code to register their dump function.
 * Each registered dump function maps field name → current value.
 *
 * @param className — the constructor name of the ISync class
 * @param names — ordered array of @VerifySync field names
 * @param dumpFn — function that extracts all sync field values
 */
export function registerSyncDump(
  className: string,
  names: string[],
  dumpFn: SyncDumpFn,
): void {
  syncDumpRegistry.set(className, { names, dumpFn })
}

/**
 * Look up a registered dump function for an ISync class.
 *
 * OpenRA 对照: TypeInfoCache[sync.GetType()] (lock-protected in C#)
 *
 * @param className — the constructor name of the ISync class
 * @returns the cached SyncTypeInfo, or undefined if not registered
 */
export function getSyncDump(className: string): SyncTypeInfo | undefined {
  return syncDumpRegistry.get(className)
}

/**
 * Clear all registered dump functions (for testing).
 *
 * Not present in OpenRA — only used for unit test isolation.
 */
export function clearSyncDumpRegistry(): void {
  syncDumpRegistry.clear()
}

// ---------------------------------------------------------------------------
// SyncReport
// ---------------------------------------------------------------------------

/**
 * Desync diagnostic report generator with 7-frame ring buffer.
 *
 * OpenRA 对照: SyncReport (sealed class)
 *
 * Usage:
 * ```typescript
 * const report = new SyncReport(orderManager)
 * // Each frame:
 * report.updateSyncReport(pendingOrders)
 * // On desync detection at frame F:
 * const diagnosticText = report.dumpSyncReport(F)
 * ```
 */
export class SyncReport {
  /** Number of reports kept in the ring buffer.
   *
   * OpenRA 对照: SyncReport.NumSyncReports = 7
   */
  static readonly NumSyncReports = 7

  /** The order manager (provides netFrameNumber, world, localClient). */
  private readonly _orderManager: SyncReportOrderManager

  /** Ring buffer of pre-allocated report objects. */
  private readonly _syncReports: SyncFrameReport[]
  /** Current write position in the ring buffer. */
  private _curIndex: number = 0

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA SyncReport(OrderManager))
  // ---------------------------------------------------------------------------

  /**
   * Create a new SyncReport engine.
   *
   * OpenRA 对照: SyncReport(OrderManager orderManager)
   *
   * Pre-allocates `NumSyncReports` empty report objects.
   *
   * @param orderManager — the order manager (provides netFrameNumber/world)
   */
  constructor(orderManager: SyncReportOrderManager) {
    this._orderManager = orderManager
    this._syncReports = []
    for (let i = 0; i < SyncReport.NumSyncReports; i++) {
      this._syncReports.push(_emptyReport())
    }
  }

  // ---------------------------------------------------------------------------
  // updateSyncReport (对应 OpenRA SyncReport.UpdateSyncReport)
  // ---------------------------------------------------------------------------

  /**
   * Snapshot the current frame's sync state into the ring buffer.
   *
   * OpenRA 对照: SyncReport.UpdateSyncReport(IEnumerable<ClientOrder> orders)
   *
   * Writes to the current ring buffer slot, then advances the write index.
   * Called once per frame.
   *
   * @param orders — pending client orders at this frame
   */
  updateSyncReport(orders: readonly ClientOrder[]): void {
    this._generateSyncReport(this._syncReports[this._curIndex]!, orders)
    this._curIndex = (this._curIndex + 1) % SyncReport.NumSyncReports
  }

  // ---------------------------------------------------------------------------
  // dumpSyncReport (对应 OpenRA SyncReport.DumpSyncReport)
  // ---------------------------------------------------------------------------

  /**
   * Dump a formatted diagnostic report for a specific desync frame.
   *
   * OpenRA 对照: SyncReport.DumpSyncReport(int frame)
   *
   * Searches the ring buffer for a report matching the given frame number.
   * If found, produces a multi-line report with:
   * - Timestamp, player info, game ID, mod version
   * - SharedRandom state
   * - All synced traits with field values (indented)
   * - All synced effects with field values (indented)
   * - All pending orders
   *
   * If not found, produces a message listing all recorded frames.
   *
   * @param frame — the frame number where desync was detected
   * @returns formatted multi-line diagnostic report string
   */
  dumpSyncReport(frame: number): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '')
      .replace(/-/g, '')

    const localClient = this._orderManager.localClient
    const localIndex = localClient?.index

    const lines: string[] = []
    const log = (text: string) => lines.push(text)

    const recordedFrames: number[] = []
    let desyncFrameFound = false

    for (const r of this._syncReports) {
      recordedFrames.push(r.frame)
      if (r.frame === frame) {
        desyncFrameFound = true

        log('--- Sync Report ---')
        log(`Player Index: ${localIndex}`)
        if (localClient?.name) {
          log(`Player: ${localClient.name}`)
        }
        log(`Platform: ${navigator.userAgent}`)
        log('TODO: Game ID: (requires ModData)')
        log(`Sync for net frame ${r.frame} -------------`)
        log(`SharedRandom: ${r.syncedRandom} (#${r.totalCount})`)
        log('Synced Traits:')
        for (const a of r.traits) {
          log(`\t ${a.actorId} ${a.type} ${a.owner} ${a.trait} (${a.hash})`)

          const nvp = a.namesValues
          for (const key of Object.keys(nvp)) {
            const value = nvp[key]
            if (value != null) {
              log(`\t\t ${key}: ${value}`)
            }
          }
        }

        log('Synced Effects:')
        for (const e of r.effects) {
          log(`\t ${e.name} (${e.hash})`)

          const nvp = e.namesValues
          for (const key of Object.keys(nvp)) {
            const value = nvp[key]
            if (value != null) {
              log(`\t\t ${key}: ${value}`)
            }
          }
        }

        log('Orders Issued:')
        for (const o of r.orders) {
          log(`\t Frame ${o.frame} Client ${o.clientId}: ${o.orderData}`)
        }
      }
    }

    log('Sync Report System Info:')
    log(`Out of sync frame: ${frame}`)
    log('Recorded frames: ' + recordedFrames.join(','))

    if (!desyncFrameFound) {
      log(
        `Recorded frames do not contain the frame ${frame}. No sync report available!`,
      )
    }

    return `syncreport-${timestamp}-${localIndex}.log\n` + lines.join('\n')
  }

  // ---------------------------------------------------------------------------
  // getCurrentIndex (for testing) — not in OpenRA
  // ---------------------------------------------------------------------------

  /** Current write index in the ring buffer (for testing). */
  get currentIndex(): number {
    return this._curIndex
  }

  /** The ring buffer array (for testing). */
  get reports(): readonly SyncFrameReport[] {
    return this._syncReports
  }

  // ---------------------------------------------------------------------------
  // Private: dumpSyncTrait (对应 OpenRA DumpSyncTrait static method)
  // ---------------------------------------------------------------------------

  /**
   * Extract all @VerifySync field values from an ISync instance.
   *
   * OpenRA 对照: DumpSyncTrait(ISync sync) → (Names, Values)
   *
   * Looks up the type in the runtime dump registry. If no dump function
   * is registered, returns an empty record as a graceful fallback.
   *
   * @param sync — the ISync instance to dump
   * @returns name-value pairs of all sync fields
   */
  private static _dumpSyncTrait(sync: ISync): Record<string, unknown> {
    const className = sync.constructor.name
    const typeInfo = syncDumpRegistry.get(className)
    if (!typeInfo) {
      // No dump function registered for this type — return empty record.
      // This can happen when new ISync types are added before the build-time
      // code generator is updated.
      return {}
    }
    return typeInfo.dumpFn(sync)
  }

  // ---------------------------------------------------------------------------
  // Private: generateSyncReport (对应 OpenRA GenerateSyncReport)
  // ---------------------------------------------------------------------------

  /**
   * Populate a report with the current frame's sync state.
   *
   * OpenRA 对照: SyncReport.GenerateSyncReport(Report, IEnumerable<ClientOrder>)
   *
   * @param report — the report object to populate (reused across frames)
   * @param orders — pending client orders
   */
  private _generateSyncReport(
    report: SyncFrameReport,
    orders: readonly ClientOrder[],
  ): void {
    const world = this._orderManager.world

    // Reset report
    report.traits.length = 0
    report.effects.length = 0
    report.orders.length = 0

    // Frame and random state
    report.frame = this._orderManager.netFrameNumber
    report.syncedRandom = world?.syncedRandomLast ?? 0
    report.totalCount = world?.syncedRandomTotal ?? 0

    // Copy orders
    for (const o of orders) {
      report.orders.push(o)
    }

    if (!world) return

    // Iterate all ISync-participating actors and record non-zero hash traits
    for (const actor of world.getSyncActors()) {
      for (const entry of actor.syncTraits) {
        if (entry.hash !== 0) {
          report.traits.push({
            actorId: actor.actorId,
            type: actor.type,
            owner: actor.owner,
            trait: entry.trait.constructor.name,
            hash: entry.hash,
            namesValues: SyncReport._dumpSyncTrait(entry.trait),
          })
        }
      }
    }

    // Iterate all synced effects and record non-zero hash effects
    for (const effect of world.syncedEffects) {
      const hash = Sync.hash(effect)
      if (hash !== 0) {
        report.effects.push({
          name: effect.constructor.name,
          hash,
          namesValues: SyncReport._dumpSyncTrait(effect),
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Private: emptyReport factory (pre-allocation, not in OpenRA)
// ---------------------------------------------------------------------------

function _emptyReport(): SyncFrameReport {
  return {
    frame: 0,
    syncedRandom: 0,
    totalCount: 0,
    traits: [],
    effects: [],
    orders: [],
  }
}
