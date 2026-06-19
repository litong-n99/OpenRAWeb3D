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
import { Sha1Verifier } from './Sha1Verifier.js'
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

  /**
   * Whether the browser currently has internet connectivity.
   *
   * Reflects `navigator.onLine`. Updated in real-time via `online`/`offline`
   * window events registered in the constructor. When offline, download
   * operations will throw clear user-facing errors.
   *
   * OpenRA 对照: No direct C# equivalent — desktop OpenRA assumes always-online
   *             for content downloads (handled by system network stack).
   */
  get isOnline(): boolean {
    return this._online
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

  /**
   * Set of modIds for which we already determined there is no content
   * installer (received 404 or fetch failure). Prevents repeated
   * failing network requests.
   */
  private _modContentMissing = new Set<string>()

  /** IndexedDB database instance (lazy, opened on first use). */
  private _db: IDBDatabase | null = null
  private _dbPromise: Promise<IDBDatabase | null> | null = null

  /** MIX hash database for .mix filename resolution (lazy, fetched once).
   *
   * Referenced by TODO-22-CI-A.10 (mixDb generation in build pipeline).
   * Fetched from `/mods/_mixdb.json` which maps hash hex strings to
   * original filenames (e.g. "0A1B2C3D" -> "e1.shp").
   */
  private _mixDb: Map<string, string> | null = null
  private _mixDbPromise: Promise<Map<string, string> | null> | null = null

  /** Concurrent install guard — prevents overlapping installPackage() calls. */
  private _isInstalling = false

  /**
   * Online status flag.
   *
   * Initialized from `navigator.onLine` and updated by `online`/`offline`
   * window events. Used by offline detection (CI-B.7) to provide clear
   * error messages when content download is impossible.
   */
  private _online: boolean

  /** Cleanup function for online/offline event listeners. */
  private _onlineCleanup: (() => void) | null = null

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

    // CI-B.7: Offline detection
    this._online = typeof navigator !== 'undefined' ? navigator.onLine : true

    const handleOnline = () => {
      const wasOffline = !this._online
      this._online = true
      if (wasOffline) {
        this._notifyListeners({
          state: this._currentState,
          packageId: '',
          statusText: 'Internet connection restored',
          progressPercent: -1,
          bytesReceived: 0,
          bytesTotal: 0,
        })
      }
    }

    const handleOffline = () => {
      this._online = false
      this._notifyListeners({
        state: this._currentState,
        packageId: '',
        statusText: 'Internet connection lost — downloads paused',
        progressPercent: -1,
        bytesReceived: 0,
        bytesTotal: 0,
      })
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
      this._onlineCleanup = () => {
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
      }
    }
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

    // Avoid repeated 404 fetches — we already know this mod has no installer
    if (this._modContentMissing.has(modId)) {
      return null
    }

    const contentModId = `${modId}-content`
    const url = `/mods/${contentModId}/content.json`

    // CI-B.7: If offline and we have no cached manifest, skip fetch
    if (!this.isOnline) {
      console.log(
        `[ContentInstaller] Offline — cannot fetch manifest for '${modId}', using cached if available`,
      )
      // Return null if no cached manifest — caller must handle
      // the offline case by checking IndexedDB records only
      return null
    }

    try {
      const response = await fetch(url)
      if (!response.ok) {
        if (response.status === 404) {
          // Mod has no content installer -- cache the negative result
          this._modContentMissing.add(modId)
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
      // CI-B.7: When fetch fails and we're offline, it's expected
      if (!this.isOnline) {
        console.log('[ContentInstaller] Manifest fetch failed due to offline status')
        // Don't cache the miss when offline -- we might be online later
        return null
      }
      // Cache this miss to avoid repeated failing requests
      this._modContentMissing.add(modId)
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

  /**
   * Check which content packages need updating (stale) or are missing.
   *
   * Compares each package's stored SHA1 against the current manifest's
   * download SHA1. A package is:
   * - `current`: Installed and SHA1 matches the manifest
   * - `stale`: Installed but SHA1 differs (content was updated on mirror)
   * - `missing`: No record found in IndexedDB
   *
   * OpenRA 对照: Synthesized from ModContent check + version comparison
   *             (no direct C# equivalent — desktop OpenRA uses file timestamps
   *             and version strings)
   *
   * @param modId -- The game mod identifier.
   * @returns Object with three arrays: current, stale, and missing package keys.
   *   If the manifest is not available (404), all arrays are empty.
   */
  async checkForUpdates(modId: string): Promise<{
    current: string[]
    stale: string[]
    missing: string[]
  }> {
    this._setState('checking')

    const manifest = await this.getContentManifest(modId)
    if (!manifest) {
      this._setState('ready')
      return { current: [], stale: [], missing: [] }
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
      return { current: [], stale: [], missing }
    }

    const current: string[] = []
    const stale: string[] = []
    const missing: string[] = []

    for (const [pkgKey, pkg] of Object.entries(manifest.packages)) {
      const packageId = `${modId}:${pkgKey}`
      const record = await this._getPackageRecord(packageId)

      if (!record) {
        missing.push(pkgKey)
        continue
      }

      // Get the expected SHA1 from the download definition
      const downloadKey = pkg.download
      if (!downloadKey) {
        // Source-only package — check by test files
        if (pkg.testFiles && pkg.testFiles.length > 0) {
          const allPresent = pkg.testFiles.every((tf) =>
            record.files.includes(tf),
          )
          if (allPresent) {
            current.push(pkgKey)
          } else {
            stale.push(pkgKey)
          }
        } else {
          current.push(pkgKey)
        }
        continue
      }

      const download = manifest.downloads[downloadKey]
      if (!download) {
        // Download definition missing — treat as current if installed
        current.push(pkgKey)
        continue
      }

      const expectedSha1 = download.sha1

      // Compare record SHA1 with expected SHA1
      if (record.sha1 === expectedSha1) {
        current.push(pkgKey)
      } else {
        stale.push(pkgKey)
      }
    }

    if (stale.length > 0 || missing.length > 0) {
      this._setState('needs_install')
    } else {
      this._setState('ready')
    }

    return { current, stale, missing }
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
    // BLOCKER fix: guard against concurrent installPackage() calls
    if (this._isInstalling) {
      throw new Error(
        'Another package is already being installed. Wait for it to complete.',
      )
    }
    this._isInstalling = true

    try {
      return await this._installPackageImpl(modId, packageName)
    } finally {
      this._isInstalling = false
    }
  }

  /**
   * Internal implementation of installPackage (after concurrent guard).
   *
   * Pipeline: resolve mirrors -> download -> verify SHA1 -> extract ->
   * persist to IndexedDB + mount to FileSystem.
   *
   * @param modId -- The game mod identifier.
   * @param packageName -- Internal package identifier (key in manifest.packages).
   * @throws Error if the package or download definition is not found,
   *   or if installation fails at any stage.
   */
  private async _installPackageImpl(
    modId: string,
    packageName: string,
    externalSignal?: AbortSignal,
  ): Promise<void> {
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

    // Create abort controller for cancellation.
    // When externalSignal is provided (concurrent installAllParallel),
    // combine it with the local signal so both cancellation paths work.
    this._abortController = new AbortController()
    const localSignal = this._abortController.signal
    const signal = externalSignal
      ? AbortSignal.any([localSignal, externalSignal])
      : localSignal

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
      // CI-B.7: Check online status before attempting download
      if (!this.isOnline) {
        throw new Error(
          'Cannot download content while offline. ' +
          'Please connect to the internet to download required game assets.',
        )
      }

      this._setState('downloading')
      this._notifyListeners({
        state: 'downloading',
        packageId,
        statusText: 'Connecting to mirror...',
        progressPercent: 0,
        bytesReceived: 0,
        bytesTotal: -1,
      })

      // ----- CI-B.8: Cache API warm — check browser cache first -----
      let zipBuffer: ArrayBuffer | null = null
      const primaryUrl = mirrors[0]!
      const cachedData = await this._warmContentCache(
        primaryUrl,
        download.sha1,
      )
      if (cachedData) {
        zipBuffer = cachedData
        // Skip the download — cache hit. Report as downloaded
        this._notifyListeners({
          state: 'downloading',
          packageId,
          statusText: 'Using cached content',
          progressPercent: 100,
          bytesReceived: cachedData.byteLength,
          bytesTotal: cachedData.byteLength,
        })
      }

      // ----- CI-B.4: Download with resume support (fallback to retry) -----
      if (!zipBuffer) {
        try {
          // Try resume-enabled download first
          zipBuffer = await this._downloadManager.downloadWithResume(
            primaryUrl,
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

          // CI-B.8: Cache successful download for future reuse
          this._cacheContentUrl(primaryUrl, zipBuffer).catch(() => {
            // Best-effort caching — failures are non-fatal
          })
        } catch (resumeErr) {
          // If resume download fails (e.g., SHA1 mismatch, Range not supported
          // but server returned corrupt data), fall back to mirror retry
          if (
            resumeErr instanceof DOMException &&
            resumeErr.name === 'AbortError'
          ) {
            throw resumeErr
          }
          if (
            resumeErr instanceof Error &&
            resumeErr.message.startsWith('SHA1_MISMATCH:')
          ) {
            throw resumeErr
          }

          // Fallback: try retry-based download across mirrors
          zipBuffer = await this._downloadManager.downloadWithRetry(
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

          // Cache the successful download
          this._cacheContentUrl(mirrors[0]!, zipBuffer).catch(() => {})
        }
      }

      // Phase 3: Verify (SHA1 already verified by download step)
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

      const mixDb = await this._loadMixDb()
      const extractedFiles = await this._extractor.extract(
        zipBuffer,
        download.extract,
        mixDb ?? undefined,
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
      // CI-B.5: Include manifestSha1 for update detection
      const record: ContentPackageRecord = {
        packageId,
        version: download.sha1,
        sha1: download.sha1,
        manifestSha1: download.sha1,
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
    const manifest = await this.getContentManifest(modId)
    if (!manifest) {
      // No content installer for this mod — nothing to do
      this._setState('ready')
      return
    }

    // Build the list of all packages from manifest (not checkContent,
    // to avoid redundant DB round-trip mid-installation)
    const allPackageKeys = Object.keys(manifest.packages)
    if (allPackageKeys.length === 0) {
      this._setState('ready')
      return
    }

    let anyInstalled = false
    for (const packageName of allPackageKeys) {
      const pkg = manifest.packages[packageName]
      if (!pkg) continue

      try {
        await this.installPackage(modId, packageName)
        anyInstalled = true
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
        this._setState('needs_install')
      }
    }

    if (anyInstalled) {
      this._setState('ready')
    }
  }

  /**
   * Install all content packages for a mod in parallel, up to maxConcurrent
   * at a time.
   *
   * Uses a simple pool pattern: starts up to `maxConcurrent` downloads
   * simultaneously. When a download finishes (success or failure), the next
   * pending package starts. Required package failures stop the entire
   * installation; optional package failures are logged and continue.
   *
   * Each download emits independent progress events via the packageId in
   * {@link ContentInstallProgress}, enabling per-package progress display
   * in ContentInstallerUI.
   *
   * OpenRA 对照: No direct C# equivalent — desktop OpenRA installs packages
   *             sequentially. This is a web-specific optimization for
   *             concurrent HTTP/2 downloads.
   *
   * @param modId -- The game mod identifier.
   * @param maxConcurrent -- Maximum number of simultaneous downloads
   *   (default 2, browser-friendly).
   * @throws Error if a required package fails to install.
   */
  async installAllParallel(
    modId: string,
    maxConcurrent: number = 2,
  ): Promise<void> {
    const manifest = await this.getContentManifest(modId)
    if (!manifest) {
      this._setState('ready')
      return
    }

    const allPackageKeys = Object.keys(manifest.packages)
    if (allPackageKeys.length === 0) {
      this._setState('ready')
      return
    }

    if (maxConcurrent < 1) maxConcurrent = 1

    // Separate required vs optional — required packages are higher priority
    const required: string[] = []
    const optional: string[] = []
    for (const key of allPackageKeys) {
      const pkg = manifest.packages[key]
      if (pkg?.required) {
        required.push(key)
      } else {
        optional.push(key)
      }
    }

    const queue = [...required, ...optional]
    const maxSlots = Math.min(maxConcurrent, queue.length)

    // CI-B.1 BLOCKER: shared AbortController for concurrent downloads.
    // Without this, the second download overwrites this._abortController,
    // making the first download uncancellable. Each _installPackageImpl()
    // combines its local signal with this shared signal via AbortSignal.any().
    const sharedController = new AbortController()
    this._abortController = sharedController
    const sharedSignal = sharedController.signal

    let activeCount = 0
    let queueIndex = 0
    let firstRequiredError: Error | null = null
    let anyInstalled = false

    // Per-package install function
    const installOne = async (packageName: string): Promise<void> => {
      const pkg = manifest.packages[packageName]
      if (!pkg) return

      try {
        await this._installPackageImpl(modId, packageName, sharedSignal)
        anyInstalled = true
      } catch (err) {
        if (pkg.required) {
          firstRequiredError = err instanceof Error
            ? err
            : new Error(String(err))
        } else {
          console.warn(
            `[ContentInstaller] Optional package '${packageName}' failed to install:`,
            err,
          )
        }
      }
    }

    // Pool executor: when a slot is free, start next package
    const runNext = async (): Promise<void> => {
      while (queueIndex < queue.length) {
        // If a required package failed, stop launching new downloads
        if (firstRequiredError) return

        const packageName = queue[queueIndex]!
        queueIndex++
        activeCount++
        await installOne(packageName)
        activeCount--
      }
    }

    // Start initial pool
    const workers: Promise<void>[] = []
    for (let i = 0; i < maxSlots; i++) {
      workers.push(runNext())
    }

    await Promise.allSettled(workers)

    // If any required package failed, throw
    if (firstRequiredError) {
      this._setState('error')
      throw firstRequiredError
    }

    if (anyInstalled) {
      this._setState('ready')
    }
  }

  // ---------------------------------------------------------------------------
  // Cache API (CI-B.8)
  // ---------------------------------------------------------------------------

  /**
   * Cache downloaded content in the browser's Cache API for offline reuse.
   *
   * After a successful download, stores the data in a Cache API entry keyed
   * by URL. On subsequent download requests, the cache is checked first
   * before making network requests.
   *
   * NOTE: Cache API requires HTTPS (or localhost). In non-HTTPS contexts
   * or private browsing modes where Cache API is unavailable, this method
   * silently skips caching.
   *
   * @param url — The download URL to cache.
   * @param data — The downloaded content to store.
   */
  private async _cacheContentUrl(
    url: string,
    data: ArrayBuffer,
  ): Promise<void> {
    try {
      if (typeof caches === 'undefined') return
      const cache = await caches.open('openra-content-v1')
      await cache.put(url, new Response(data))
    } catch {
      // Cache API unavailable (non-HTTPS, private browsing, quota exceeded)
      // Silently skip — cache is best-effort, not required
    }
  }

  /**
   * Warm the content cache by checking the Cache API for a previously
   * cached download before falling back to IndexedDB or network.
   *
   * Called by installPackage() before initiating a download. If the URL
   * is found in the Cache API and the cached response's body matches the
   * expected SHA1, the download is skipped entirely.
   *
   * @param url — The download URL to check.
   * @param expectedSha1 — Expected SHA1 hex string for verification.
   * @returns The cached data as ArrayBuffer, or null if not found or
   *   SHA1 mismatch.
   */
  private async _warmContentCache(
    url: string,
    expectedSha1: string,
  ): Promise<ArrayBuffer | null> {
    try {
      if (typeof caches === 'undefined') return null
      const cache = await caches.open('openra-content-v1')
      const cachedResponse = await cache.match(url)
      if (!cachedResponse) return null

      const data = await cachedResponse.arrayBuffer()

      // Verify SHA1 if expected
      if (expectedSha1) {
        const ok = await Sha1Verifier.verify(data, expectedSha1)
        if (!ok) {
          // Cached data is stale — delete it
          await cache.delete(url)
          return null
        }
      }

      return data
    } catch {
      return null
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
    this._modContentMissing.delete(modId)

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
    this._modContentMissing.clear()

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

  // ---------------------------------------------------------------------------
  // Multi-Mod Content Switching (CI-C.4)
  // ---------------------------------------------------------------------------

  /**
   * Get the set of mod IDs that currently have content installed.
   *
   * Scans IndexedDB for all package records and extracts mod prefixes.
   * A mod is considered to have content if at least one package record
   * exists with that mod's prefix.
   *
   * OpenRA 对照: No direct C# equivalent — synthesized from ModContent
   *             enumeration logic. Desktop OpenRA checks per-mod directories
   *             in SupportDir/Content/{mod}/.
   *
   * @returns Set of mod IDs (e.g. "ra", "cnc", "d2k") with installed content.
   *   Empty set if IndexedDB is unavailable or no content is installed.
   */
  async getInstalledModIds(): Promise<Set<string>> {
    const db = await this._openDb()
    if (!db) return new Set()

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const request = store.openCursor()

        const modIds = new Set<string>()

        request.onsuccess = () => {
          const cursor = request.result as IDBCursorWithValue | null
          if (cursor) {
            const record = cursor.value as ContentPackageRecord
            if (typeof record.packageId === 'string') {
              const colonIdx = record.packageId.indexOf(':')
              if (colonIdx > 0) {
                modIds.add(record.packageId.substring(0, colonIdx))
              }
            }
            cursor.continue()
          } else {
            resolve(modIds)
          }
        }

        tx.onerror = () => resolve(modIds)
        tx.onabort = () => resolve(modIds)
      } catch {
        resolve(new Set())
      }
    })
  }

  /**
   * Detect whether content for other mods exists when switching to a new mod.
   *
   * This helps the UI inform the user: "You have Red Alert content installed.
   * Tiberian Dawn needs its own content. Install now?"
   *
   * Performs a SINGLE IndexedDB cursor pass that simultaneously collects all
   * installed mod IDs AND counts packages belonging to mods other than the
   * current one. Avoids the double-scan pattern of calling getInstalledModIds()
   * followed by a second cursor scan.
   *
   * @param currentModId — The mod the user is switching TO.
   * @returns Information about other mods with content installed, or null
   *   if no other mod content exists.
   */
  async detectOtherModsContent(
    currentModId: string,
  ): Promise<{ otherModIds: string[]; totalOtherPackages: number } | null> {
    const db = await this._openDb()
    if (!db) return null

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.openCursor()

        const allModIds = new Set<string>()
        let totalOtherPackages = 0

        req.onsuccess = () => {
          const cursor = req.result as IDBCursorWithValue | null
          if (cursor) {
            const record = cursor.value as ContentPackageRecord
            if (typeof record.packageId === 'string') {
              const colonIdx = record.packageId.indexOf(':')
              if (colonIdx > 0) {
                const modId = record.packageId.substring(0, colonIdx)
                allModIds.add(modId)
                if (modId !== currentModId) {
                  totalOtherPackages++
                }
              }
            }
            cursor.continue()
          } else {
            // Cursor exhausted — compute result
            const otherModIds = Array.from(allModIds).filter(
              (id) => id !== currentModId,
            )
            if (otherModIds.length === 0) {
              resolve(null)
            } else {
              resolve({ otherModIds, totalOtherPackages })
            }
          }
        }

        tx.onerror = () => resolve(null)
        tx.onabort = () => resolve(null)
      } catch {
        resolve(null)
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

  /**
   * Release all resources held by this service.
   *
   * Removes online/offline event listeners and clears cached manifests.
   * Safe to call multiple times.
   */
  dispose(): void {
    // Abort any in-flight download before cleaning up listeners
    this.cancel()

    // CI-B.7: Clean up online/offline listeners
    if (this._onlineCleanup) {
      this._onlineCleanup()
      this._onlineCleanup = null
    }
    this._modContent.clear()
    this._modContentMissing.clear()
    this._listeners.clear()
    this._abortController = null
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
        tx.onerror = () => {
          console.warn(
            '[ContentInstaller] IndexedDB write failed (quota exceeded or DB error)',
            tx.error?.message,
          )
          this._notifyListeners({
            state: this._currentState,
            packageId: record.packageId,
            statusText: 'Storage error: disk quota may be exceeded',
            progressPercent: -1,
            bytesReceived: 0,
            bytesTotal: 0,
            error: `IndexedDB write failed: ${tx.error?.message ?? 'unknown error'}`,
          })
          resolve()
        }
        tx.onabort = () => {
          console.warn(
            '[ContentInstaller] IndexedDB transaction aborted',
          )
          resolve()
        }
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
   *
   * Skips no-op transitions (same state -> same state) to avoid
   * redundant listener notifications during rapid state changes.
   */
  private _setState(state: ContentInstallState): void {
    if (this._currentState === state) return
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
   * Load the MIX hash database from `/mods/_mixdb.json`.
   *
   * The mixDb maps lowercase hex hash strings (without "0x" prefix) to
   * original MIX entry filenames (e.g. "0a1b2c3d" -> "e1.shp"). This is
   * essential for MIX sub-archive extraction — without it, all MIX entries
   * resolve as "unresolved_0xHHHHHHHH.bin".
   *
   * Fetched once and cached in `_mixDb`. Returns null if the file is
   * unavailable (graceful degradation for mods without MIX content).
   *
   * Referenced by TODO-22-CI-A.10 (mixDb generation in build pipeline).
   *
   * @returns Map of hex hash -> original filename, or null if unavailable.
   */
  private async _loadMixDb(): Promise<Map<string, string> | null> {
    if (this._mixDb) return this._mixDb

    if (!this._mixDbPromise) {
      this._mixDbPromise = (async () => {
        try {
          const response = await fetch('/mods/_mixdb.json')
          if (!response.ok) {
            if (response.status === 404) {
              // No mixDb available for this build — normal for mods without MIX
              return null
            }
            console.warn(
              `[ContentInstaller] Failed to fetch mixDb: HTTP ${response.status}`,
            )
            return null
          }
          const json = (await response.json()) as Record<string, string>
          this._mixDb = new Map(Object.entries(json))
          return this._mixDb
        } catch (err) {
          console.warn(
            '[ContentInstaller] Error loading mixDb:',
            err,
          )
          return null
        }
      })()
    }

    return this._mixDbPromise
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
