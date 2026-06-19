/**
 * ContentInstallerService.ts -- Central state machine orchestrating the
 * content installation pipeline (check, download, verify, extract, mount).
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Installation/DownloadPackageLogic.cs
 *             + OpenRA.Mods.Common/ModContent.cs (installation orchestration)
 *
 * 核心范式转换:
 * - C# ContentInstallerFileSystemLoader (file-based) -> IndexedDB-backed
 *   browser persistence for package installation records
 * - C# DownloadPackageLogic.ShowDownloadDialog() imperative UI flow
 *   -> ContentInstallState state machine + progress listener pattern
 * - C# File.Exists() check for TestFiles -> IndexedDB lookup
 * - C# synchronous ZipFile extraction -> async PackageExtractor.extract()
 * - C# SupportDir file writes -> FileSystem.mountFromBuffer() for runtime
 *   mounting + IndexedDB for persistence tracking
 */

import type { FileSystem } from '../FileSystem/FileSystem.js'
import { DownloadManager } from './DownloadManager.js'
import { PackageExtractor } from './PackageExtractor.js'
import { MirrorResolver } from './MirrorResolver.js'
import type {
  ContentInstallState,
  ContentInstallProgress,
  ContentInstallListener,
  ModContentManifest,
  ContentPackageRecord,
} from './ContentInstallerTypes.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name for content package tracking. */
const DB_NAME = 'openra-content'

/** IndexedDB object store name. */
const STORE_NAME = 'packages'

/** Database version. */
const DB_VERSION = 1

// ---------------------------------------------------------------------------
// ContentInstallerService
// ---------------------------------------------------------------------------

/**
 * Central state machine orchestrating the entire content installation pipeline.
 *
 * Manages: manifest fetching, IndexedDB tracking, download/verify/extract/mount
 * workflow, progress reporting, and cleanup.
 *
 * OpenRA 对照: DownloadPackageLogic + ModContent orchestration
 */
export class ContentInstallerService {
  // ---------------------------------------------------------------------------
  // Public state accessor
  // ---------------------------------------------------------------------------

  /** Current pipeline state.
   *
   * OpenRA 对照: synthesized from multiple C# state flags
   */
  get state(): ContentInstallState {
    return this._currentState
  }

  // ---------------------------------------------------------------------------
  // Private fields
  // ---------------------------------------------------------------------------

  private _fileSystem: FileSystem
  private _downloadManager: DownloadManager
  private _extractor: PackageExtractor
  private _listeners = new Set<ContentInstallListener>()
  private _currentState: ContentInstallState = 'idle'
  private _abortController: AbortController | null = null

  /** Cached content manifests, keyed by modId. */
  private _modContent = new Map<string, ModContentManifest>()

  /** IndexedDB database instance (lazy, opened on first use). */
  private _db: IDBDatabase | null = null
  private _dbPromise: Promise<IDBDatabase | null> | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Create a ContentInstallerService instance.
   *
   * @param fileSystem -- The game's FileSystem instance for mounting
   *   extracted content files. Borrowed, not owned.
   */
  constructor(fileSystem: FileSystem) {
    this._fileSystem = fileSystem
    this._downloadManager = new DownloadManager()
    this._extractor = new PackageExtractor()
  }

  // ---------------------------------------------------------------------------
  // Progress subscription
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to content installation progress events.
   *
   * OpenRA 对照: DownloadPackageLogic progress callbacks
   *
   * @param listener -- Callback invoked on each state transition and progress update.
   * @returns Unsubscribe function. Call to stop receiving events.
   */
  onProgress(listener: ContentInstallListener): () => void {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  // ---------------------------------------------------------------------------
  // Manifest loading
  // ---------------------------------------------------------------------------

  /**
   * Fetch and cache the content manifest for a given mod.
   *
   * The content manifest is served at `/mods/${modId}-content/content.json`
   * and is generated at build time from the mod's installer configuration.
   *
   * OpenRA 对照: ModContent class loaded via MiniYaml from mod.yaml
   *
   * @param modId -- The game mod identifier (e.g. "ra", "cnc").
   * @returns The parsed ModContentManifest, or null if no content installer
   *   exists for this mod (HTTP 404). Returns cached value if already loaded.
   */
  async getContentManifest(modId: string): Promise<ModContentManifest | null> {
    // Check cache
    const cached = this._modContent.get(modId)
    if (cached) return cached

    const contentModId = `${modId}-content`
    const url = `/mods/${contentModId}/content.json`

    try {
      const response = await fetch(url)
      if (!response.ok) {
        if (response.status === 404) {
          // Mod has no content installer -- this is normal
          return null
        }
        console.warn(
          `[ContentInstaller] Failed to fetch content manifest for '${modId}': HTTP ${response.status}`,
        )
        return null
      }

      const json = (await response.json()) as ModContentManifest
      this._modContent.set(modId, json)
      return json
    } catch (err) {
      console.warn(
        `[ContentInstaller] Error fetching content manifest for '${modId}':`,
        err,
      )
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Content checking
  // ---------------------------------------------------------------------------

  /**
   * Check which content packages are missing for a given mod.
   *
   * Loads the content manifest, then checks IndexedDB for each package's
   * test files. A package is considered installed only if ALL its testFiles
   * exist in the recorded files list.
   *
   * OpenRA 对照: ModContent.ModPackage.TestFiles + File.Exists() check
   *
   * @param modId -- The game mod identifier.
   * @returns Array of missing package identifiers (e.g. ["quickinstall", "movies"]).
   *   Empty array means all required content is installed.
   */
  async checkContent(modId: string): Promise<string[]> {
    this._setState('checking')

    const manifest = await this.getContentManifest(modId)
    if (!manifest) {
      // No content installer for this mod -- everything is "available"
      this._setState('ready')
      return []
    }

    const db = await this._openDb()
    if (!db) {
      // IndexedDB unavailable -- treat all packages as missing
      const missing = Object.keys(manifest.packages)
      if (missing.length > 0) {
        this._setState('needs_install')
      } else {
        this._setState('ready')
      }
      return missing
    }

    const missing: string[] = []

    for (const [pkgKey, pkg] of Object.entries(manifest.packages)) {
      const packageId = `${modId}:${pkgKey}`
      const record = await this._getPackageRecord(packageId)

      if (!record) {
        missing.push(pkgKey)
        continue
      }

      // Verify test files exist in the record
      if (pkg.testFiles && pkg.testFiles.length > 0) {
        const allTestFilesPresent = pkg.testFiles.every((tf) =>
          record.files.includes(tf),
        )
        if (!allTestFilesPresent) {
          missing.push(pkgKey)
        }
      }
      // If no test files specified, the record's existence is sufficient
    }

    if (missing.length > 0) {
      this._setState('needs_install')
    } else {
      this._setState('ready')
    }

    return missing
  }

  // ---------------------------------------------------------------------------
  // Installation
  // ---------------------------------------------------------------------------

  /**
   * Install a single content package for a mod.
   *
   * Pipeline: resolve mirrors -> download -> verify SHA1 -> extract ->
   * persist to IndexedDB + mount to FileSystem.
   *
   * OpenRA 对照: DownloadPackageLogic.ShowDownloadDialog() flow
   *
   * @param modId -- The game mod identifier.
   * @param packageName -- Internal package identifier (key in manifest.packages).
   * @throws Error if the package or download definition is not found,
   *   or if installation fails at any stage.
   */
  async installPackage(modId: string, packageName: string): Promise<void> {
    const manifest = this._modContent.get(modId)
    if (!manifest) {
      throw new Error(`No content manifest loaded for mod '${modId}'`)
    }

    const pkg = manifest.packages[packageName]
    if (!pkg) {
      throw new Error(
        `Package '${packageName}' not found in manifest for mod '${modId}'`,
      )
    }

    const packageId = `${modId}:${packageName}`

    // Resolve download definition
    const downloadKey = pkg.download
    if (!downloadKey) {
      throw new Error(
        `Package '${packageName}' has no download definition (source-only, not yet supported)`,
      )
    }

    const download = manifest.downloads[downloadKey]
    if (!download) {
      throw new Error(
        `Download '${downloadKey}' not found in manifest for mod '${modId}'`,
      )
    }

    // Create abort controller for cancellation
    this._abortController = new AbortController()
    const signal = this._abortController.signal

    try {
      // Phase 1: Resolve mirrors
      let mirrors: string[]
      if (download.mirrorList) {
        try {
          mirrors = await MirrorResolver.fetchMirrors(download.mirrorList)
        } catch (err) {
          // If mirror list fetch fails and direct URL exists, use that
          if (download.url) {
            mirrors = [download.url]
          } else {
            throw new Error(
              `Failed to fetch mirror list and no direct URL available: ${String(err)}`,
            )
          }
        }
      } else if (download.url) {
        mirrors = [download.url]
      } else {
        throw new Error(
          `No download URL or mirror list for package '${packageName}'`,
        )
      }

      // Phase 2: Download
      this._setState('downloading')
      this._notifyListeners({
        state: 'downloading',
        packageId,
        statusText: 'Connecting to mirror...',
        progressPercent: 0,
        bytesReceived: 0,
        bytesTotal: -1,
      })

      const zipBuffer = await this._downloadManager.downloadWithRetry(
        mirrors,
        download.sha1,
        (received, total, percentage) => {
          this._notifyListeners({
            state: 'downloading',
            packageId,
            statusText: total > 0
              ? `Downloading (${percentage}%)`
              : `Downloading (${this._formatBytes(received)})`,
            progressPercent: percentage,
            bytesReceived: received,
            bytesTotal: total,
          })
        },
        signal,
      )

      // Phase 3: Verify
      this._setState('verifying')
      this._notifyListeners({
        state: 'verifying',
        packageId,
        statusText: 'Verifying SHA1...',
        progressPercent: -1,
        bytesReceived: 0,
        bytesTotal: 0,
      })

      // Phase 4: Extract
      this._setState('extracting')
      this._notifyListeners({
        state: 'extracting',
        packageId,
        statusText: 'Extracting files...',
        progressPercent: 0,
        bytesReceived: 0,
        bytesTotal: 0,
      })

      const extractedFiles = await this._extractor.extract(
        zipBuffer,
        download.extract,
        undefined, // mixDb -- not needed for Phase A
        (_entry, current, total) => {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0
          this._notifyListeners({
            state: 'extracting',
            packageId,
            statusText: `Extracting (${pct}%)...`,
            progressPercent: pct,
            bytesReceived: current,
            bytesTotal: total,
          })
        },
      )

      // Phase 5: Mount + Persist
      this._setState('mounting')
      const fileList: string[] = []

      let mounted = 0
      const totalFiles = extractedFiles.size

      for (const [filename, data] of extractedFiles) {
        // Mount into FileSystem
        const contentName = `@content:${modId}/${packageName}/${filename}`
        const explicitName = `${modId}|Content/${modId}/v2/${filename}`
        this._fileSystem.mountFromBuffer(contentName, data, explicitName)

        fileList.push(filename)
        mounted++

        if (totalFiles > 0) {
          const pct = Math.round((mounted / totalFiles) * 100)
          this._notifyListeners({
            state: 'mounting',
            packageId,
            statusText: `Mounting (${pct}%)...`,
            progressPercent: pct,
            bytesReceived: mounted,
            bytesTotal: totalFiles,
          })
        }
      }

      // Store in IndexedDB
      const record: ContentPackageRecord = {
        packageId,
        version: download.sha1,
        sha1: download.sha1,
        installedAt: Date.now(),
        files: fileList,
      }
      await this._putPackageRecord(record)

      // Phase 6: Complete
      this._setState('complete')
      this._notifyListeners({
        state: 'complete',
        packageId,
        statusText: 'Installation complete',
        progressPercent: 100,
        bytesReceived: 0,
        bytesTotal: 0,
      })
    } catch (err) {
      // Check if this was an abort (user cancellation)
      if (err instanceof DOMException && err.name === 'AbortError') {
        this._setState('idle')
        this._notifyListeners({
          state: 'idle',
          packageId,
          statusText: 'Cancelled',
          progressPercent: 0,
          bytesReceived: 0,
          bytesTotal: 0,
        })
        return
      }

      this._setState('error')
      const errorMsg = err instanceof Error ? err.message : String(err)
      this._notifyListeners({
        state: 'error',
        packageId,
        statusText: 'Installation failed',
        progressPercent: 0,
        bytesReceived: 0,
        bytesTotal: 0,
        error: errorMsg,
      })
      throw err
    } finally {
      this._abortController = null
    }
  }

  /**
   * Install all missing content packages for a mod, sequentially.
   *
   * Each package is installed one at a time. If a required package fails,
   * the installation stops. Optional package failures are logged but do
   * not block continuing to the next package.
   *
   * OpenRA 对照: ModContentLogic installing all packages in order
   *
   * @param modId -- The game mod identifier.
   * @throws Error if a required package fails to install.
   */
  async installAll(modId: string): Promise<void> {
    const missing = await this.checkContent(modId)
    if (missing.length === 0) {
      this._setState('ready')
      return
    }

    const manifest = this._modContent.get(modId)
    if (!manifest) {
      throw new Error(`No content manifest loaded for mod '${modId}'`)
    }

    for (const packageName of missing) {
      const pkg = manifest.packages[packageName]
      if (!pkg) continue

      try {
        await this.installPackage(modId, packageName)
      } catch (err) {
        if (pkg.required) {
          this._setState('error')
          throw new Error(
            `Failed to install required package '${packageName}': ${String(err)}`,
          )
        }
        // Optional package failed -- log and continue
        console.warn(
          `[ContentInstaller] Optional package '${packageName}' failed to install:`,
          err,
        )
        // Reset state to needs_install so UI can show partial progress
        this._setState('needs_install')
      }
    }

    // Re-check: if all required packages are now installed, transition to ready
    const stillMissing = await this.checkContent(modId)
    if (stillMissing.length === 0) {
      this._setState('ready')
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Clear all installed content for a specific mod.
   *
   * Deletes all IndexedDB records matching the mod prefix and clears
   * the cached manifest.
   *
   * @param modId -- The game mod identifier.
   */
  async clearModContent(modId: string): Promise<void> {
    // Clear cached manifest first (always, regardless of DB availability)
    this._modContent.delete(modId)

    const db = await this._openDb()
    if (!db) return

    const prefix = `${modId}:`

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.openCursor()

        request.onsuccess = () => {
          const cursor = request.result as IDBCursorWithValue | null
          if (cursor) {
            const record = cursor.value as ContentPackageRecord
            if (
              typeof record.packageId === 'string' &&
              record.packageId.startsWith(prefix)
            ) {
              cursor.delete()
            }
            cursor.continue()
          }
        }

        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  }

  /**
   * Clear ALL installed content across all mods.
   *
   * Deletes the entire IndexedDB database and clears all cached manifests.
   */
  async clearAll(): Promise<void> {
    this._modContent.clear()

    // Delete the entire database
    return new Promise((resolve) => {
      try {
        const request = indexedDB.deleteDatabase(DB_NAME)
        request.onsuccess = () => {
          this._db = null
          this._dbPromise = null
          resolve()
        }
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
      } catch {
        resolve()
      }
    })
  }

  /**
   * Cancel the currently running installation.
   *
   * Safe to call even when no installation is in progress.
   */
  cancel(): void {
    if (this._abortController) {
      this._abortController.abort()
    }
  }

  // ---------------------------------------------------------------------------
  // IndexedDB helpers (private)
  // ---------------------------------------------------------------------------

  /**
   * Open (or create) the IndexedDB database for content package records.
   *
   * Schema:
   * - Database: 'openra-content', version: 1
   * - Object store: 'packages', keyPath: 'packageId'
   *
   * @returns The database instance, or null if IndexedDB is unavailable.
   */
  private async _openDb(): Promise<IDBDatabase | null> {
    if (this._db) return this._db

    if (!this._dbPromise) {
      this._dbPromise = new Promise((resolve) => {
        try {
          const request = indexedDB.open(DB_NAME, DB_VERSION)

          request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME, { keyPath: 'packageId' })
            }
          }

          request.onsuccess = () => {
            this._db = request.result
            resolve(this._db)
          }

          request.onerror = () => {
            console.warn(
              `[ContentInstaller] Failed to open IndexedDB '${DB_NAME}':`,
              request.error?.message,
            )
            resolve(null)
          }

          request.onblocked = () => {
            console.warn(
              `[ContentInstaller] IndexedDB '${DB_NAME}' blocked`,
            )
            resolve(null)
          }
        } catch (err) {
          console.warn(
            '[ContentInstaller] IndexedDB not available:',
            err,
          )
          resolve(null)
        }
      })
    }

    return this._dbPromise
  }

  /**
   * Get a package record from IndexedDB.
   *
   * @param packageId -- The package identifier (e.g. "ra:quickinstall").
   * @returns The package record, or null if not found.
   */
  private async _getPackageRecord(
    packageId: string,
  ): Promise<ContentPackageRecord | null> {
    const db = await this._openDb()
    if (!db) return null

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const request = store.get(packageId)

        request.onsuccess = () => {
          resolve((request.result as ContentPackageRecord) ?? null)
        }
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }

  /**
   * Store (put) a package record in IndexedDB.
   *
   * @param record -- The package record to store.
   */
  private async _putPackageRecord(
    record: ContentPackageRecord,
  ): Promise<void> {
    const db = await this._openDb()
    if (!db) return

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        store.put(record)

        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
        tx.onabort = () => resolve()
      } catch {
        resolve()
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Set the current state and emit progress to all listeners.
   */
  private _setState(state: ContentInstallState): void {
    this._currentState = state
    // Notify listeners of the state change
    this._notifyListeners({
      state,
      packageId: '',
      statusText: this._stateToStatusText(state),
      progressPercent: -1,
      bytesReceived: 0,
      bytesTotal: 0,
    })
  }

  /**
   * Convert a state value to a human-readable status text.
   */
  private _stateToStatusText(state: ContentInstallState): string {
    switch (state) {
      case 'idle': return 'Ready'
      case 'checking': return 'Checking installed content...'
      case 'needs_install': return 'Content packages need to be installed'
      case 'ready': return 'All content is installed'
      case 'downloading': return 'Downloading...'
      case 'verifying': return 'Verifying...'
      case 'extracting': return 'Extracting files...'
      case 'mounting': return 'Mounting files...'
      case 'complete': return 'Installation complete'
      case 'error': return 'An error occurred'
    }
  }

  /**
   * Notify all registered listeners with a progress update.
   *
   * Errors in individual listeners are caught so one broken listener
   * does not prevent others from receiving updates.
   */
  private _notifyListeners(progress: ContentInstallProgress): void {
    for (const listener of this._listeners) {
      try {
        listener(progress)
      } catch (err) {
        console.warn('[ContentInstaller] Listener error:', err)
      }
    }
  }

  /**
   * Format bytes into a human-readable string.
   *
   * OpenRA 对照: DownloadPackageLogic size formatting
   */
  private _formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
}
