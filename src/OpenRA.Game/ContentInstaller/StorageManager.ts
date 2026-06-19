/**
 * StorageManager.ts — Browser storage quota and usage tracking for the
 * Content Installer pipeline.
 *
 * OpenRA 对照: No direct C# equivalent — desktop OpenRA uses file system
 *             with GetDiskFreeSpace checks. This is a web-specific adaptation.
 *
 * 核心范式转换:
 * - C# DriveInfo.AvailableFreeSpace / GetDiskFreeSpace
 *   → navigator.storage.estimate() Web Storage API
 * - C# per-mod directory size calculation via FileInfo.Length summation
 *   → IndexedDB `openra-content` record iteration + size estimation
 * - C# no offline concept (always local disk)
 *   → browser online/offline + storage quota awareness
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name for content package tracking (shared with
 * ContentInstallerService). */
const DB_NAME = 'openra-content'

/** Object store name. */
const STORE_NAME = 'packages'

/** Minimum free space percentage to consider "enough space" (20%). */
const MIN_FREE_SPACE_PCT = 20

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Storage quota information returned by {@link StorageManager.getQuota}. */
export interface StorageQuota {
  /** Current storage usage in bytes. */
  usage: number
  /** Total storage quota in bytes. */
  quota: number
  /** Usage as a percentage of quota (0-100). */
  percentage: number
}

/** Result of a space check. */
export interface SpaceCheckResult {
  /** Whether enough space is available. */
  hasSpace: boolean
  /** Shortfall in bytes (0 if hasSpace is true). */
  shortage: number
}

/** Per-mod storage usage entry. */
export interface ModUsage {
  /** The mod identifier. */
  modId: string
  /** Total estimated storage usage in bytes. */
  usageBytes: number
}

// ---------------------------------------------------------------------------
// ContentPackageRecord (minimal — matches ContentInstallerTypes)
// ---------------------------------------------------------------------------

interface PackageRecord {
  packageId: string
  files?: string[]
  sha1?: string
}

// ---------------------------------------------------------------------------
// StorageManager
// ---------------------------------------------------------------------------

/**
 * Static utilities for browser storage quota, space checks, and per-mod
 * usage tracking.
 *
 * Used by ContentInstallerService to verify sufficient disk space before
 * starting downloads, and by ContentInstallerUI to display storage info.
 */
export class StorageManager {
  /**
   * Get the current storage quota and usage information.
   *
   * Uses {@link https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate | navigator.storage.estimate()}
   * where available. Falls back gracefully to `{ usage: 0, quota: Infinity }`
   * on browsers that don't support the Storage API (e.g. older browsers,
   * some private browsing modes).
   *
   * @returns Current quota information.
   */
  static async getQuota(): Promise<StorageQuota> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate()
        const usage = estimate.usage ?? 0
        const quota = estimate.quota ?? 0
        const percentage =
          quota > 0 ? Math.round((usage / quota) * 100) : 0
        return { usage, quota, percentage }
      }
    } catch (err) {
      // Storage API unavailable (private browsing, old browser, etc.)
      console.warn('[StorageManager] navigator.storage.estimate() unavailable:', err)
    }

    return { usage: 0, quota: Infinity, percentage: 0 }
  }

  /**
   * Check whether there is enough storage space for the estimated download size.
   *
   * Conservative check: requires at least {@link MIN_FREE_SPACE_PCT}% (20%)
   * free space *after* the estimated download is added. If current usage +
   * estimated download exceeds the quota minus the safety margin, the check
   * fails.
   *
   * @param estimatedBytes — Estimated download size in bytes.
   * @returns Space check result with hasSpace flag and shortage in bytes.
   */
  static async hasSpaceFor(estimatedBytes: number): Promise<SpaceCheckResult> {
    const { usage, quota } = await StorageManager.getQuota()

    if (quota === Infinity) {
      // Unlimited storage — always OK
      return { hasSpace: true, shortage: 0 }
    }

    const projectedUsage = usage + estimatedBytes
    const minFree = (quota * MIN_FREE_SPACE_PCT) / 100
    const maxAllowed = quota - minFree

    if (projectedUsage <= maxAllowed) {
      return { hasSpace: true, shortage: 0 }
    }

    const shortage = projectedUsage - maxAllowed
    return { hasSpace: false, shortage }
  }

  /**
   * Get per-mod storage usage breakdown by scanning IndexedDB records.
   *
   * Iterates over all records in the `openra-content` IndexedDB database,
   * groups them by mod prefix (everything before the first `:`), and
   * estimates usage based on the number and names of stored files.
   *
   * @returns Array of per-mod usage entries, sorted by usage descending.
   */
  static async getModUsage(): Promise<ModUsage[]> {
    const records = await StorageManager._readAllRecords()
    if (records.length === 0) return []

    const modUsageMap = new Map<string, number>()

    for (const record of records) {
      if (!record.packageId) continue

      // Extract modId from packageId ("ra:quickinstall" → "ra")
      const colonIdx = record.packageId.indexOf(':')
      if (colonIdx <= 0) continue

      const modId = record.packageId.substring(0, colonIdx)

      // Estimate usage: count files × average file size (conservative ~64KB)
      // plus the sha1 length for the record itself
      const fileCount = record.files?.length ?? 0
      const estimatedBytes = fileCount > 0
        ? fileCount * 65536 // ~64KB average for game asset files
        : 1024 // Minimum 1KB for records without files

      const current = modUsageMap.get(modId) ?? 0
      modUsageMap.set(modId, current + estimatedBytes)
    }

    return Array.from(modUsageMap.entries())
      .map(([modId, usageBytes]) => ({ modId, usageBytes }))
      .sort((a, b) => b.usageBytes - a.usageBytes)
  }

  /**
   * Format bytes into a human-readable string.
   *
   * OpenRA 对照: No direct C# equivalent (desktop uses raw MB display).
   *
   * @param bytes — Number of bytes.
   * @returns Formatted string (e.g. "1.2 GB", "340 MB", "0 B").
   */
  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Read all package records from IndexedDB.
   *
   * Opens the `openra-content` database, iterates all records in the
   * `packages` object store, and returns them.
   *
   * @returns Array of all stored package records, or empty array if
   *   IndexedDB is unavailable.
   */
  private static async _readAllRecords(): Promise<PackageRecord[]> {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME)
        request.onsuccess = () => {
          const db = request.result
          try {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const store = tx.objectStore(STORE_NAME)
            const getAllRequest = store.getAll()

            getAllRequest.onsuccess = () => {
              resolve((getAllRequest.result as PackageRecord[]) ?? [])
              try { db.close() } catch { /* ignore */ }
            }
            getAllRequest.onerror = () => {
              resolve([])
              try { db.close() } catch { /* ignore */ }
            }
          } catch {
            resolve([])
            try { db.close() } catch { /* ignore */ }
          }
        }
        request.onerror = () => resolve([])
        request.onblocked = () => resolve([])
      } catch {
        resolve([])
      }
    })
  }
}
