/**
 * ContentInstallerTypes.ts -- Type definitions for the Web Content Installer
 * pipeline (state machine, progress events, manifest data model, storage).
 *
 * OpenRA 对照: OpenRA.Mods.Common/ModContent.cs
 *             (ModContent, ModPackage, ModDownload, ModSource)
 *
 * 核心范式转换:
 * - C# class ModContent : IGlobalModData + inner classes (ModPackage,
 *   ModDownload, ModSource) + MiniYaml loading → TypeScript interfaces for
 *   build-time-generated JSON manifests (content.json)
 * - C# File.Exists() check for TestFiles → browser IndexedDB lookup via
 *   ContentInstallerService (not in this types file)
 * - C# ZipFile extraction via SharpZipLib → fflate unzipSync in browser
 * - C# SHA1 verification via CryptoUtil → Web Crypto API SubtleCrypto.digest
 * - C# file system writes to SupportDir → IndexedDB + Cache API persistence
 *
 * All types are referenced by ContentInstallerService, DownloadManager,
 * MirrorResolver, PackageExtractor, and ContentInstallerUI.
 */

// ---------------------------------------------------------------------------
// State Machine Types
// ---------------------------------------------------------------------------

/**
 * Single-step state of the content installation pipeline.
 *
 * OpenRA 对照: No direct C# enum — this is a web-specific state machine that
 *             combines ContentInstallerFileSystemLoader, DownloadPackageLogic,
 *             and ModContentLogic into a unified async flow.
 *
 * States:
 * - 'idle':         No content check has been performed yet
 * - 'checking':     Checking IndexedDB for installed packages
 * - 'needs_install':One or more required packages are missing
 * - 'ready':        All required packages are installed, game can launch
 * - 'downloading':  Actively downloading a package from a mirror
 * - 'verifying':    Computing SHA1 hash of downloaded data
 * - 'extracting':   Decompressing ZIP and unpacking MIX/Pak sub-archives
 * - 'mounting':     Writing extracted files to persistence + FileSystem
 * - 'complete':     All packages have been installed successfully
 * - 'error':        An unrecoverable error occurred during installation
 */
export type ContentInstallState =
  | 'idle'
  | 'checking'
  | 'needs_install'
  | 'ready'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'mounting'
  | 'complete'
  | 'error'

// ---------------------------------------------------------------------------
// Progress Event Types
// ---------------------------------------------------------------------------

/**
 * Progress event emitted during content installation.
 *
 * Fired by {@link ContentInstallerService} to registered
 * {@link ContentInstallListener}s at each state transition and periodically
 * during download/verification/extraction.
 *
 * OpenRA 对照: DownloadPackageLogic progress callbacks (not a formal type,
 *             synthesized from the download UI status display logic)
 */
export interface ContentInstallProgress {
  /** Current state of the installation pipeline */
  state: ContentInstallState

  /**
   * Package identifier string (e.g. "ra:quickinstall").
   * Combines the mod ID and the internal package name.
   */
  packageId: string

  /**
   * Human-readable status text for UI display.
   * Examples: "Connecting to mirror...", "Downloading (45%)", "Verifying SHA1..."
   */
  statusText: string

  /**
   * Download progress percentage (0-100), or -1 if indeterminate.
   * Only meaningful during 'downloading' state; 0 otherwise.
   */
  progressPercent: number

  /**
   * Bytes received so far.
   * Only meaningful during 'downloading' state; 0 otherwise.
   */
  bytesReceived: number

  /**
   * Total bytes expected, or -1 if unknown (e.g. before Content-Length header
   * is received).
   */
  bytesTotal: number

  /**
   * Error message. Only set when `state === 'error'`.
   * Contains a human-readable description of what went wrong.
   */
  error?: string
}

/**
 * Callback type for receiving content installation progress events.
 *
 * Registered via {@link ContentInstallerService.onProgress} and invoked
 * synchronously on each state transition.
 *
 * @param progress — Current progress snapshot
 */
export type ContentInstallListener = (progress: ContentInstallProgress) => void

// ---------------------------------------------------------------------------
// Content Manifest Data Model (build-time generated JSON)
// ---------------------------------------------------------------------------

/**
 * Top-level content manifest for a mod.
 *
 * Generated at build time from `OpenRA/mods/*-content/installer/downloads.yaml`
 * and served as `public/mods/{modId}-content/content.json`.
 *
 * OpenRA 对照: ModContent class (IGlobalModData)
 *   - C# `ModContent.Mod` (string) → targetModId
 *   - C# `ModContent.Packages` (ImmutableArray<KeyValuePair<string, ModPackage>>)
 *     → packages (Record<string, ContentPackage>)
 *   - C# `ModContent.Downloads` (ImmutableArray<string>) → keys of downloads dict
 *   - C# `ModContent.Sources` (ImmutableArray<string>) → keys of sources dict
 */
export interface ModContentManifest {
  /**
   * Content installer mod identifier (e.g. "ra-content", "cnc-content").
   * The mod.json this manifest belongs to.
   */
  modId: string

  /**
   * The game mod that this content is for (e.g. "ra", "cnc", "d2k").
   * Content packages install assets under this mod's mount paths.
   */
  targetModId: string

  /**
   * Available content packages, keyed by internal package identifier
   * (e.g. "quickinstall", "basefiles", "movies").
   */
  packages: Record<string, ContentPackage>

  /**
   * Download definitions, keyed by download identifier.
   * Referenced by {@link ContentPackage.download}.
   */
  downloads: Record<string, ContentDownload>

  /**
   * Source definitions for CD/local-install-based content.
   * Optional — only present for mods that support CD-based installation.
   *
   * OpenRA 对照: ModContent.Sources (ImmutableArray<string>)
   *
   * TODO-22-CI-B.2: Implement source-based installation in Phase B.
   */
  sources?: Record<string, ContentSource>
}

/**
 * Definition of a single installable content package.
 *
 * Maps to a download + a set of files that must be present for this
 * package to be considered "installed".
 *
 * OpenRA 对照: ModContent.ModPackage (inner class):
 *   - Title (string), Identifier (string), TestFiles (string[]),
 *     Sources (string[]), Required (bool), Download (string)
 */
export interface ContentPackage {
  /** Human-readable display title (e.g. "Quick Install Package") */
  title: string

  /** Machine-readable unique identifier (e.g. "quickinstall") */
  identifier: string

  /**
   * Files that must exist for this package to be considered installed.
   * These are the final mount paths (e.g. "Content/ra/v2/allies.mix").
   * Checked against IndexedDB by ContentInstallerService.
   *
   * OpenRA 对照: ModPackage.TestFiles — File.Exists() check
   */
  testFiles: string[]

  /**
   * CD-based source identifiers this package can be installed from.
   * Empty array if this package is download-only.
   *
   * OpenRA 对照: ModPackage.Sources (ImmutableArray<string>)
   */
  sources: string[]

  /** Whether this package is mandatory for gameplay. */
  required: boolean

  /**
   * Key into {@link ModContentManifest.downloads} for the download definition.
   * Empty string if no download is available (source-only package).
   *
   * OpenRA 对照: ModPackage.Download (string)
   */
  download: string
}

/**
 * Definition of a single downloadable content archive.
 *
 * OpenRA 对照: ModContent.ModDownload (inner class):
 *   - Title (string), URL (string), MirrorList (string),
 *     SHA1 (string), Type (string),
 *     Extract (FrozenDictionary<string, string>)
 */
export interface ContentDownload {
  /** Human-readable display title (e.g. "Quick Install Package") */
  title: string

  /**
   * Direct download URL. Optional if `mirrorList` is provided.
   *
   * OpenRA 对照: ModDownload.URL (string)
   */
  url?: string

  /**
   * URL to a mirror list text file (one URL per line, plain text).
   * Used by MirrorResolver to select a random mirror.
   * Optional if `url` is provided directly.
   *
   * OpenRA 对照: ModDownload.MirrorList (string)
   */
  mirrorList?: string

  /**
   * Expected SHA1 hash of the downloaded file.
   * Hex-encoded, lowercase, no separators
   * (e.g. "44241f68e69db9511db82cf83c174737ccda300b").
   * Verified after download completes using Web Crypto API.
   *
   * OpenRA 对照: ModDownload.SHA1 (string)
   */
  sha1: string

  /**
   * Package container type (e.g. "ZipFile").
   * Determines which decompressor to use in PackageExtractor.
   *
   * OpenRA 对照: ModDownload.Type (string)
   */
  type: string

  /**
   * Extraction mapping: destination path → path within the archive.
   * Keys are the final file mount paths (e.g. "Content/ra/v2/allies.mix").
   * Values are the entry paths within the downloaded archive
   * (e.g. "allies.mix" if the ZIP has files at root, or "subdir/allies.mix").
   *
   * OpenRA 对照: ModDownload.Extract (FrozenDictionary<string, string>)
   */
  extract: Record<string, string>
}

/**
 * Definition of a local/CD-based content source.
 *
 * Used for auto-detecting game installations (CD, Steam, Origin, etc.).
 * Deferred to Phase B.
 *
 * OpenRA 对照: ModContent.ModSource (inner class):
 *   - Title (string), Type (MiniYaml),
 *     IDFiles (MiniYaml), Install (ImmutableArray<MiniYamlNode>)
 */
export interface ContentSource {
  /** Human-readable source name (e.g. "Red Alert CD", "Steam") */
  title: string

  /**
   * Source type identifier (e.g. "Disc", "Steam", "Origin").
   * Optional — may be absent for generic sources.
   *
   * OpenRA 对照: ModSource.Type (MiniYaml)
   */
  type?: string

  /**
   * Files used to identify this source installation.
   * The keys are paths relative to the installation root;
   * implementation-specific values provide matching hints.
   *
   * OpenRA 对照: ModSource.IDFiles (MiniYaml)
   */
  idFiles?: Record<string, string>

  /**
   * Installation instructions: destination path → source path or pattern.
   * Each entry maps where to place the file relative to the content
   * directory (key) to where to find it in the source installation (value).
   *
   * OpenRA 对照: ModSource.Install (ImmutableArray<MiniYamlNode>)
   */
  install?: Record<string, string>
}

// ---------------------------------------------------------------------------
// IndexedDB Persistence Types
// ---------------------------------------------------------------------------

/**
 * Record stored in IndexedDB for each installed content package.
 *
 * Used by ContentInstallerService to track which packages are installed
 * and to detect cache staleness (version/SHA1 mismatch).
 *
 * OpenRA 对照: No direct C# equivalent — desktop OpenRA uses file system
 *             (SupportDir/Content/{mod}/{version}/) for persistence.
 *             This is a web-specific adaptation for browser storage.
 *
 * Database: 'openra-content'
 * Object store: 'packages'
 * Key: packageId
 */
export interface ContentPackageRecord {
  /**
   * Unique package identifier (e.g. "ra:quickinstall").
   * Combines mod ID and internal package name.
   */
  packageId: string

  /**
   * Version marker for cache invalidation.
   * Typically the SHA1 hash of the content manifest or a dedicated version
   * string. When the version changes, the cached package is invalidated.
   */
  version: string

  /**
   * SHA1 hash of the downloaded archive.
   * Used for integrity verification and cache key derivation.
   */
  sha1: string

  /**
   * Timestamp when the package was installed (Date.now()).
   * Used for TTL-based cache expiry (365 days default).
   */
  installedAt: number

  /**
   * List of extracted filenames (mount paths) for this package.
   * Used to enumerate and purge files when clearing package content.
   * Example: ["Content/ra/v2/allies.mix", "Content/ra/v2/conquer.mix"]
   */
  files: string[]
}
