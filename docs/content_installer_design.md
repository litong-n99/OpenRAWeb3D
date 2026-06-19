# Web Content Installer Pipeline -- Architecture Design

**Status**: DESIGN  
**Date**: 2026-06-19  
**Author**: Migration Architect  
**OpenRA Reference**: `ContentInstallerFileSystemLoader.cs`, `DownloadPackageLogic.cs`, `ModContentLogic.cs`, `ModContent.cs`

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Overview](#2-architecture-overview)
3. [MIX Format Strategy](#3-mix-format-strategy)
4. [Cache Design](#4-cache-design)
5. [Component Specifications](#5-component-specifications)
6. [Integration Points](#6-integration-points)
7. [URL Resolution](#7-url-resolution)
8. [build-mods.ts Changes](#8-build-modsts-changes)
9. [Data Model](#9-data-model)
10. [Phase Plan](#10-phase-plan)
11. [Open Questions & Risks](#11-open-questions--risks)

---

## 1. Problem Statement

### Context

OpenRAWeb3D currently launches with a "missing assets" experience. The `FileSystem.mount()` call tries to fetch binary package files (`.mix`, `.pak`) from the Vite dev server, but these assets do not exist in the web build. Vite's SPA fallback returns `index.html` instead, which `FileSystem` detects and warns about. The game launches with an empty asset tree -- no sprites, no sounds, no map tiles.

OpenRA solves this with a **Content Installer** pipeline:
1. Detects missing `ContentPackages` during mod mount (`ContentInstallerFileSystemLoader`)
2. Switches to a special "content installer" mod (`ra-content`, `cnc-content`, etc.)
3. Shows a UI where users download ZIP packages from mirrors
4. Downloads, SHA1-verifies, extracts files to the support directory
5. Switches back to the main mod, which now finds the assets

### What We Need

A browser-native equivalent that:
- Uses the **same download URLs** and **same SHA1 hashes** as desktop OpenRA
- Persists downloaded assets in **IndexedDB/Cache API** (no filesystem)
- Integrates with the existing **FileSystem 4-layer cache** and **IPackageLoader** infrastructure
- Provides a **download UI** (progress bar, retry, cancel) consistent with our SPA shell
- Works **offline** once assets are cached

### Key Constraint

The downloaded ZIPs contain `.mix` files. Our project's MixFile.ts is a **documentation stub** (ADR-5.1: build-time unpack). We must decide: implement runtime MIX parsing or pre-extract during download.

---

## 2. Architecture Overview

### 2.1 Component Diagram

```
                          ┌─────────────────────────────────────┐
                          │           ContentInstallerService    │
                          │  (state machine + progress events)   │
                          └─────┬───────────────────┬───────────┘
                                │                   │
                    ┌───────────▼──────┐   ┌────────▼──────────┐
                    │  MirrorResolver  │   │  DownloadManager   │
                    │  (fetch list +   │   │  (fetch ZIP +      │
                    │   pick random)   │   │   progress + SHA1) │
                    └──────────────────┘   └────────┬───────────┘
                                                    │
                              ┌─────────────────────▼──────────────┐
                              │           ZipFileRuntime           │
                              │  (fflate unzip → ArrayBuffer[] )    │
                              │   + Sha1Verifier (Web Crypto API)   │
                              └─────────────────────┬──────────────┘
                                                    │
                    ┌───────────────────────────────▼────────────────────────┐
                    │                  PackageExtractor                       │
                    │  For each file:                                         │
                    │    .mix → InternalMIXUnpacker → individual files        │
                    │    .pak → Pak runtime parser → individual files         │
                    │    .aud/.shp/.tem/.pal → raw bytes (pass through)      │
                    │  Output: Map<string, ArrayBuffer> (filename → data)     │
                    └───────────────────────────────┬────────────────────────┘
                                                    │
              ┌─────────────────────────────────────▼──────────────────────────┐
              │                      Persistence Layer                         │
              │                                                                 │
              │  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
              │  │  IndexedDB       │  │  Cache API        │  │  Memory       │  │
              │  │  openra-content  │  │  openra-content   │  │  VFS mount    │  │
              │  │  {pkgId → {sha1, │  │  same as IDB      │  │  via          │  │
              │  │   entries: []}}  │  │  key = pkgId      │  │  FileSystem.  │  │
              │  └─────────────────┘  └──────────────────┘  │  mountFromBuf  │  │
              └─────────────────────┬───────────────────────┬──────────────────┘
                                    │                       │
                                    └───────────┬───────────┘
                                                │
                            ┌───────────────────▼──────────────────────┐
                            │          FileSystem Integration           │
                            │                                           │
                            │  FileSystem.mountFromBuffer(              │
                            │    'Content|ra/v2/allies.mix',            │
                            │    alliedMixBuffer,                       │
                            │    'Content/ra/v2/allies.mix'             │
                            │  )                                        │
                            │                                           │
                            │  Explicit mount 'Content/ra/v2/allies.mix'│
                            │  → accessible via 'allies.mix|filename'   │
                            └───────────────────────────────────────────┘
```

### 2.2 Data Flow (Download to Mount)

```
User clicks "Install" in Content UI
  └──► ContentInstallerService.startDownload(packageId)
        │
        ├──► 1. MirrorResolver.fetchMirrorList(mirrorListUrl)
        │      └──► GET https://www.openra.net/packages/ra-quickinstall-mirrors.txt
        │          → text/plain: one URL per line
        │          → pick random URL (crypto.getRandomValues)
        │
        ├──► 2. DownloadManager.download(url, sha1, onProgress)
        │      └──► fetch(url) with ReadableStream
        │          → accumulate chunks, report progress
        │          → on complete: verify SHA1 via Web Crypto API
        │          → mismatch? try another mirror (max 3 retries)
        │
        ├──► 3. ZipFileRuntime.decompress(zipBuffer)
        │      └──► fflate unzipSync (already onboard)
        │          → Record<string, Uint8Array>
        │
        ├──► 4. PackageExtractor.extract(zip, extractMap)
        │      └──► For each [destPath, zipEntry]:
        │            ├── .mix → InternalMIXUnpacker (Phase A) or passthrough (Phase B)
        │            ├── .pak → Pak runtime parser (already implemented!)
        │            ├── .r16/.aud/.shp/.tem/.pal → raw bytes
        │            └── Collect into Map<string, ArrayBuffer>
        │
        ├──► 5. PersistenceLayer.store(packageId, extractedFiles)
        │      └──► IndexedDB: key = packageId, value = { sha1, version, files[] }
        │      └──► Cache API: key = URL, value = Response(blob)
        │
        ├──► 6. FileSystem.mountFromBuffer(name, data, explicitName)
        │      └──► For each extracted file:
        │            fileSystem.mountFromBuffer(
        │              `@content:${modId}/${mountName}`,
        │              fileData,
        │              `${modId}|Content/${modId}/v2/${mountName}`
        │            )
        │
        └──► 7. ContentInstallerService.onComplete(packageId)
              └──► Fire event → ModData re-checks → UI updates
```

### 2.3 State Machine

```
                    ┌──────────┐
                    │  IDLE    │
                    └────┬─────┘
                         │ checkContent()
                         ▼
              ┌─────────────────────┐
              │  CHECKING           │  Read IndexedDB → all installed?
              └──┬────────────┬─────┘
                 │ all found  │ missing
                 ▼            ▼
           ┌─────────┐  ┌─────────────────┐
           │ READY   │  │ NEEDS_INSTALL    │
           │ (launch │  └────────┬─────────┘
           │  mod)    │           │ user clicks Install
           └─────────┘           ▼
                      ┌─────────────────────┐
                      │  DOWNLOADING         │  Fetch mirror list → download ZIP
                      │  (progress: 0-100%)  │
                      └──┬──────────┬────────┘
                         │ success  │ error / cancel
                         ▼          ▼
              ┌──────────────┐  ┌──────────┐
              │  VERIFYING   │  │  ERROR   │  Retry / Back
              │  (SHA1)      │  └──────────┘
              └──┬───────────┘
                 │
                 ▼
              ┌──────────────┐
              │  EXTRACTING   │  ZIP → individual files → MIX unpack
              │  (progress)   │
              └──┬────────────┘
                 │
                 ▼
              ┌──────────────┐
              │  MOUNTING     │  IndexedDB write + FileSystem mount
              └──┬────────────┘
                 │
                 ▼
              ┌──────────────┐
              │  COMPLETE     │  All packages installed → switch to main mod
              └──────────────┘
```

---

## 3. MIX Format Strategy

### 3.1 Recommendation: Download-Time Extraction (Hybrid Approach)

**Phase A (immediate)**: Pre-extract MIX files inside the downloaded ZIP using a lightweight TypeScript runtime parser.

**Phase B (optimization)**: Add build-time MIX pre-extraction for known MIX files, with runtime fallback for unknown ones.

### 3.2 Rationale

| Option | Pros | Cons |
|--------|------|------|
| **Runtime MIX parsing** | Works with existing download ZIPs; no pre-processing; identical to OpenRA desktop flow | Need Blowfish decryption for RA/TS encrypted MIX; ~300KB WASM or JS crypto; filename hash database required |
| **Build-time pre-extraction** | No crypto in browser; faster first-load; simpler runtime code | Must pre-process every MIX; different pipeline from desktop; ZIPs from mirrors still contain .mix |
| **Download-time extraction** (RECOMMENDED) | Same URLs as desktop; reuses existing fflate ZIP; can defer encrypted MIX support | Extracts MIX in browser; needs runtime MIX parser for at least the C&C format |

**Decision**: Download-time extraction using a lightweight TypeScript MIX parser that handles:
1. **C&C format** (unencrypted, `isCncMix = true`) -- used by RA, C&C, D2K
2. **Pass-through** for RA/TS encrypted MIX files (flags bit 1 set) -- deferred to Phase B

The C&C format is straightforward (numFiles + dataSize + entries + raw data) and covers the majority of content:
- RA: most MIX files (allies.mix, conquer.mix, sounds.mix, etc.) are C&C format
- C&C/TD: all MIX files are C&C format
- D2K: `.R8`/`.R16`/`.RS` files are not MIX at all, they're raw data
- TS: some MIX may be encrypted (RA/TS/RA2 format with flags), but TS is lower priority

### 3.3 What We Already Have

The `MixFile.ts` documentation stub already contains:
- Complete format specification (JSDoc)
- `parseHeader()` reference implementation (C&C format)
- `parseIndex()` reference implementation (hash → filename resolution)
- `PackageEntry` class with `hashFilename()` for Classic and CRC32 hash types
- RSA public key string for Blowfish decryption

We need to promote this from "documentation reference" to "runtime implementation" for the C&C unencrypted path.

### 3.4 MIX Hash Database

MIX files store only 4-byte filename hashes, not actual filenames. We need a **filename database** to resolve these hashes. Strategy:

- **Phase A**: Bundle a `mixdb.json` (generated from the XCC global/local mix databases) at build time.
  - Source: `OpenRA/OpenRA.Mods.Cnc/FileSystem/` already contains the hash logic
  - Build script scans known filenames → computes Classic + CRC32 hashes
  - Runtime: match hashes from MIX entries against the database
- **Phase B**: Extract filenames from the "local mix database.dat" if present in the MIX

---

## 4. Cache Design

### 4.1 Storage Strategy

**Dual-layer persistence**: IndexedDB (structured metadata) + Cache API (large binary blobs).

| Layer | Backend | Stores | Key Format | Size Limit |
|-------|---------|--------|------------|-----------|
| **IDB** | IndexedDB | Per-file metadata: `{ sha1, size, mtime }` + extracted file list | `modId::packageId::filename` | ~50-100 MB (browser-dependent) |
| **Cache API** | Cache Storage | Raw extracted file data as `Response` objects | `/__content__/modId/packageId/filename` | ~unlimited (quota-managed) |
| **Memory** | L1 LRU (existing) | Recently accessed files | same as FileSystem cache keys | 100 MB (configurable) |

### 4.2 Why IndexedDB + Cache API (not just one)

- **IndexedDB**: Good for structured data, metadata queries, and small files. But quota is typically smaller (~50MB in some browsers).
- **Cache API**: Designed for large binary storage. Higher quota. But only stores `Request`/`Response` pairs -- poor for metadata queries.
- **Together**: Cache API stores the heavy binary data; IndexedDB stores the metadata (file list, SHA1, installed packages). This avoids the 50MB IndexedDB quota issue while keeping structured queries fast.

### 4.3 Content Package Schema (IndexedDB)

```typescript
// Database: 'openra-content'
// Object store: 'packages'
// Key: packageId (e.g., 'ra:quickinstall')

interface ContentPackageRecord {
  packageId: string          // "modId:packageName" e.g. "ra:quickinstall"
  modId: string              // "ra"
  packageName: string        // "quickinstall"
  downloadURL: string        // The mirror URL used to download
  sha1: string               // SHA1 hash of the downloaded ZIP
  downloadedAt: number       // Date.now() timestamp
  version: string            // Version tag for cache invalidation
  extractedFiles: string[]   // List of filenames extracted (mount paths)
  totalSize: number          // Total uncompressed bytes
}
```

### 4.4 Cache Invalidation

- **Version-based**: Each content package has a version string (the SHA1 itself). When re-downloading, the old version is detected and purged before writing new data.
- **User-triggered**: "Clear installed content" button in settings (calls `ContentInstallerService.clearAll()`).
- **Automatic**: TTL of 365 days (content rarely changes). After expiry, re-verify against the mirror list.

### 4.5 Integration with Existing FileSystem Cache

The existing FileSystem L1/L2/L3 cache is at the *file level* (individual file reads). Content installation is at the *package level* (bulk ZIP download). They work together:

```
L4 (fetch) ─── ContentInstaller downloads ZIP from mirror
    │
    ▼
L3/L2 ─── ContentInstaller writes extracted files to IndexedDB/Cache API
    │
    ▼
FileSystem.mountFromBuffer() ─── Loads files into L1 memory cache
    │
    ▼
L1 (LRU) ─── Subsequent file reads hit memory cache (same as always)
```

The content installer populates the persistence layers; FileSystem reads from them via the existing `mount()` cache pipeline (L2→L3→L4).

---

## 5. Component Specifications

### 5.1 ContentInstallerService

**File**: `src/OpenRA.Game/ContentInstaller/ContentInstallerService.ts`

**OpenRA Reference**: `ContentInstallerFileSystemLoader` + `DownloadPackageLogic` (combined)

```typescript
/**
 * Central coordinator for the content installation pipeline.
 *
 * Manages the lifecycle: check → download → verify → extract → mount.
 * Emits events for UI progress display.
 *
 * OpenRA 对照: ContentInstallerFileSystemLoader (check/mount) +
 *             DownloadPackageLogic (download UI) +
 *             ModContentLogic (content state management)
 */
export class ContentInstallerService {
  /** Current state of the installation pipeline */
  state: ContentInstallState

  /** Registered progress callbacks */
  private _listeners: Set<ContentInstallListener>

  /** Per-mod content manifests (loaded from content-installer YAML → JSON) */
  private _modContent: Map<string, ModContentManifest>

  /**
   * Check whether all required content packages for a mod are installed.
   *
   * OpenRA 对照: ContentInstallerFileSystemLoader.Mount() 中的 isContentAvailable 检查
   *
   * Checks IndexedDB for cached packages. Returns list of missing package IDs.
   */
  async checkContent(modId: string): Promise<string[]>  // missing package IDs

  /**
   * Download and install a single content package.
   *
   * OpenRA 对照: DownloadPackageLogic.ShowDownloadDialog()
   *
   * Flow: fetchMirrorList → pickRandom → downloadZIP → verifySHA1 →
   *       extractFiles → persistToCache → mountToFileSystem
   */
  async installPackage(modId: string, packageName: string): Promise<void>

  /**
   * Download and install all missing content for a mod.
   *
   * Installs packages sequentially (bandwidth-friendly).
   * Each package emits progress events.
   */
  async installAll(modId: string): Promise<void>

  /**
   * Get the content manifest for a mod.
   *
   * Loads from /mods/{modId}-content/content.json (build-time generated
   * from the OpenRA mods/{mod}-content/installer/*.yaml files).
   */
  async getContentManifest(modId: string): Promise<ModContentManifest | null>

  /** Subscribe to progress events. Returns unsubscribe function. */
  onProgress(listener: ContentInstallListener): () => void

  /** Check if a specific package is already installed (in IndexedDB). */
  async isPackageInstalled(modId: string, packageName: string): Promise<boolean>

  /** Clear all installed content for a mod. */
  async clearModContent(modId: string): Promise<void>

  /** Clear all installed content. */
  async clearAll(): Promise<void>
}
```

### 5.2 MirrorResolver

**File**: `src/OpenRA.Game/ContentInstaller/MirrorResolver.ts`

```typescript
/**
 * Fetches and selects a download mirror.
 *
 * OpenRA 对照: DownloadPackageLogic 中的 mirror list fetch + Random selection
 *
 * Mirror list format: plain text, one URL per line.
 * Uses crypto.getRandomValues for unbiased random selection.
 */
export class MirrorResolver {
  /**
   * Fetch mirror list from URL and pick a random mirror.
   *
   * @param mirrorListUrl — URL to the mirror list (e.g. openra.net/packages/...)
   * @returns A single mirror URL
   * @throws If mirror list is empty or fetch fails
   */
  async resolveMirror(mirrorListUrl: string): Promise<string>

  /**
   * Fetch mirror list and return all mirrors.
   * Useful for trying fallback mirrors on download failure.
   */
  async fetchMirrors(mirrorListUrl: string): Promise<string[]>
}
```

### 5.3 DownloadManager

**File**: `src/OpenRA.Game/ContentInstaller/DownloadManager.ts`

```typescript
/**
 * Downloads a ZIP from a mirror URL with progress reporting and SHA1 verification.
 *
 * OpenRA 对照: DownloadPackageLogic.Task.Run(() => { ... fetch + SHA1 + extract })
 *
 * Uses fetch() with ReadableStream for real-time progress.
 * SHA1 verification uses the Web Crypto API (SubtleCrypto.digest).
 */
export class DownloadManager {
  /**
   * Download a ZIP file with progress reporting.
   *
   * @param url — Direct download URL (from mirror list)
   * @param expectedSha1 — Expected SHA1 hash (from content manifest), optional
   * @param onProgress — Callback: (received, total, percentage)
   * @param signal — AbortSignal for cancellation
   * @returns The downloaded ZIP data
   * @throws On HTTP error, SHA1 mismatch, or cancellation
   */
  async download(
    url: string,
    expectedSha1: string | null,
    onProgress: (received: number, total: number, percentage: number) => void,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer>

  /**
   * Download with automatic mirror retry.
   *
   * Tries each mirror URL until one succeeds.
   * Max 3 retry attempts across all mirrors.
   */
  async downloadWithRetry(
    mirrors: string[],
    expectedSha1: string | null,
    onProgress: DownloadProgressCallback,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer>
}
```

### 5.4 Sha1Verifier (Web Crypto API)

**File**: `src/OpenRA.Game/ContentInstaller/Sha1Verifier.ts`

```typescript
/**
 * SHA1 hash verification using the browser's Web Crypto API.
 *
 * OpenRA 对照: CryptoUtil.SHA1Hash(Stream)
 *
 * The Web Crypto API supports SHA-1 natively via SubtleCrypto.digest('SHA-1', data).
 * No external crypto library needed.
 */
export class Sha1Verifier {
  /**
   * Compute SHA1 hash of data.
   *
   * @param data — Raw data
   * @returns Hex-encoded SHA1 hash (lowercase)
   */
  static async compute(data: ArrayBuffer): Promise<string>

  /**
   * Verify that data matches expected SHA1 hash.
   *
   * @returns true if hash matches, false otherwise
   */
  static async verify(data: ArrayBuffer, expectedHexSha1: string): Promise<boolean>
}
```

### 5.5 PackageExtractor

**File**: `src/OpenRA.Game/ContentInstaller/PackageExtractor.ts`

```typescript
/**
 * Extracts files from a downloaded content ZIP.
 *
 * OpenRA 对照: DownloadPackageLogic 中的 extraction loop
 *
 * For each entry in the package's Extract map:
 *   1. Look up file in the ZIP
 *   2. If .mix: unpack with InternalMIXUnpacker
 *   3. If .pak: parse with PakLoader (already implemented)
 *   4. Otherwise: pass through as raw bytes
 *
 * Collects all extracted files into a Map for persistence + mounting.
 */
export class PackageExtractor {
  /**
   * Extract files from a downloaded ZIP.
   *
   * @param zipBuffer — Raw ZIP data (from DownloadManager)
   * @param extractMap — { destPath → zipEntryPath } from content manifest
   * @param onProgress — Callback: (entry: string, current: number, total: number)
   * @returns Map of destPath → file data
   */
  async extract(
    zipBuffer: ArrayBuffer,
    extractMap: Record<string, string>,
    onProgress?: (entry: string, current: number, total: number) => void,
  ): Promise<Map<string, ArrayBuffer>>

  /**
   * Determine file type and parse if needed.
   *
   * - .mix → InternalMIXUnpacker (Phase A: C&C format only)
   * - .pak → PakLoader (already implemented in OpenRA.Mods.Cnc.FileSystem.Pak)
   * - .big → BigFileLoader (already implemented)
   * - .meg → MegFileLoader (already implemented)
   * - .aud/.shp/.tem/.pal/.r8/.r16/.rs → raw pass-through
   */
  private async _extractFile(
    filename: string,
    data: ArrayBuffer,
    extractMap: Record<string, string>,
  ): Promise<Map<string, ArrayBuffer>>
}
```

### 5.6 InternalMIXUnpacker (NEW -- Phase A)

**File**: `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts`

```typescript
/**
 * Lightweight runtime MIX file parser for C&C format (unencrypted).
 *
 * OpenRA 对照: MixLoader.MixFile (nested class) — C&C format parsing
 *
 * This is the RUNTIME counterpart to the MixFile.ts documentation stub.
 * Handles only the C&C format (isCncMix = true). Encrypted RA/TS/RA2 format
 * MIX files are passed through as raw bytes for Phase B.
 *
 * Uses the hash database (mixdb.json) for filename resolution.
 *
 * ADR-5.1 REVISION: Runtime MIX parsing for C&C format is now required
 * because downloaded content ZIPs contain .mix files that must be
 * extracted at runtime. Build-time unpack is not feasible because
 * the ZIPs come from external mirrors at runtime.
 */
export class MixFileRuntime implements IReadOnlyPackage {
  /**
   * Parse a C&C-format MIX file from buffer.
   *
   * @param name — Package name (e.g. "allies.mix")
   * @param data — Raw MIX file data
   * @param mixDb — Hash → filename database (from mixdb.json)
   * @returns A MixFileRuntime instance (implements IReadOnlyPackage)
   * @throws If data is not a valid C&C MIX file
   */
  static parse(name: string, data: ArrayBuffer, mixDb?: Map<string, string>): MixFileRuntime

  /**
   * Check if data is a valid C&C-format MIX file.
   *
   * C&C format: first uint16 != 0 (numFiles > 0)
   */
  static isCncFormat(data: ArrayBuffer): boolean

  // IReadOnlyPackage implementation
  readonly name: string
  get contents(): readonly string[]
  contains(filename: string): boolean
  open(filename: string, files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null>
  dispose(): void
}
```

### 5.7 ContentInstallerUI (Web Component)

**File**: `src/OpenRA.Game/ContentInstaller/ContentInstallerUI.ts`

```typescript
/**
 * HTML-based download UI for content installation.
 *
 * OpenRA 对照: ModContentLogic + ModContentInstallerLogic +
 *             DownloadPackageLogic (widget tree)
 *
 * Implemented as a TypeScript class that creates DOM elements
 * (consistent with the existing DOM overlay approach for main menu).
 * Can be later migrated to a Widget-based UI (Ch5 Widget system).
 */
export class ContentInstallerUI {
  /** Create and show the content installation dialog. */
  show(service: ContentInstallerService, modId: string): void

  /** Close the dialog. */
  hide(): void

  /**
   * Show package list with download buttons + status.
   * Each package row shows: name, required flag, status, download button.
   */
  private _renderPackageList(manifest: ModContentManifest): void

  /**
   * Show progress for a single package download.
   * Shows: status text, progress bar (determinate/indeterminate), retry/cancel buttons.
   */
  private _renderDownloadProgress(packageName: string): void
}
```

### 5.8 Types

**File**: `src/OpenRA.Game/ContentInstaller/ContentInstallerTypes.ts`

```typescript
/**
 * Content installation state machine.
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

/**
 * Progress event emitted during installation.
 */
export interface ContentInstallProgress {
  /** Current state */
  state: ContentInstallState

  /** Package identifier (e.g. "ra:quickinstall") */
  packageId: string

  /** Human-readable status text */
  statusText: string

  /** Download progress (0-100), or -1 if indeterminate */
  progressPercent: number

  /** Bytes received so far */
  bytesReceived: number

  /** Total bytes (or -1 if unknown) */
  bytesTotal: number

  /** Error message (only set when state === 'error') */
  error?: string
}

export type ContentInstallListener = (progress: ContentInstallProgress) => void

/**
 * Content manifest for a mod (build-time generated from OpenRA/ mods/*-content/installer/*.yaml).
 *
 * OpenRA 对照: ModContent class (IGlobalModData)
 */
export interface ModContentManifest {
  /** Mod ID (e.g. "ra") */
  modId: string

  /** The mod this content is for (e.g. "ra" → this is ra-content) */
  targetModId: string

  /** Content packages available for download */
  packages: Record<string, ContentPackage>

  /** Download definitions (referenced by packages) */
  downloads: Record<string, ContentDownload>

  /** Source definitions (referenced by packages) — defer to Phase B */
  sources?: Record<string, ContentSource>
}

export interface ContentPackage {
  /** Display title */
  title: string

  /** Unique identifier */
  identifier: string

  /** Files that must exist for this package to be considered installed */
  testFiles: string[]

  /** Source references (for source-based installation) */
  sources: string[]

  /** Whether this package is required */
  required: boolean

  /** Download reference key in ModContentManifest.downloads */
  download: string
}

export interface ContentDownload {
  /** Display title */
  title: string

  /** Direct download URL (optional, if MirrorList is set) */
  url?: string

  /** Mirror list URL (plain text, one URL per line) */
  mirrorList?: string

  /** Expected SHA1 hash of the downloaded file */
  sha1: string

  /** Package type (e.g. "ZipFile") */
  type: string

  /** Extraction map: destPath → zipEntryPath */
  extract: Record<string, string>
}

export interface ContentSource {
  /** Display title */
  title: string

  /** Source type (e.g. "Install", "Steam", "Origin") */
  type?: string

  /** Files used to identify a valid installation */
  idFiles?: Record<string, unknown>

  /** Installation instructions */
  install?: Record<string, string>[]
}
```

---

## 6. Integration Points

### 6.1 Where Does the Content Check Happen?

**Decision**: In `Game.loadMod()`, after `ModData.init()` and before `OrderManager` creation.

```
Game.loadMod(modId)
  ├── 1. Fetch mod.json → Manifest
  ├── 2. Create FileSystem → mount paths
  ├── 3. Create ModData → modData.init()
  ├── 4. loadRuleSet()
  │
  ├── ★ 5. ContentInstallerService.checkContent(modId)
  │        ├── All required packages present?
  │        │   YES → continue to step 6
  │        │   NO  → set state = 'needs_install'
  │        │         → ContentInstallerUI.show()
  │        │         → User clicks Install / Skip
  │        │         → on complete: re-mount assets → continue to step 6
  │        │
  ├── 6. Create OrderManager
  ├── 7. Create CursorManager
  └── 8. Set state → Shellmap
```

**Rationale**: Checking before OrderManager creation means:
- No network sync setup if we can't play yet (saves resources)
- The download UI can use the existing scene background (shellmap)
- The FileSystem is already initialized and ready for re-mounting

### 6.2 Download UI Integration

The download UI uses the **same DOM overlay pattern** as the main menu (Game.ts line 860-969). It overlays on top of the canvas with a semi-transparent backdrop.

The UI flow:
```
Main Menu → "Skirmish" → Game creates ContentInstallerUI (if content missing)
  │
  ├── Content list view: shows packages with status (Installed / Download / Manual)
  │     │
  │     └── User clicks "Download" on a package
  │           │
  │           └── Download progress view: status text + progress bar + Cancel button
  │                 │
  │                 ├── Success → return to content list (package now shows "Installed")
  │                 └── Error → show error message + Retry button
  │
  └── All required packages installed → "Play" button enabled → startGame()
```

### 6.3 FileSystem.mount() Integration

After extraction, content files are mounted into the existing FileSystem:

```typescript
// Existing FileSystem API used for content mounting:
for (const [destPath, fileData] of extractedFiles) {
  fileSystem.mountFromBuffer(
    destPath,        // e.g. "allies.mix" (logical name)
    fileData,        // ArrayBuffer of file contents
    destPath         // explicit mount name for "allies.mix|filename" resolution
  )
}
```

Key insight: The **existing** `mountFromBuffer()` API already supports this pattern. It:
1. Parses the buffer into an `IReadOnlyPackage` via registered loaders
2. Mounts it with an explicit name
3. Makes files accessible via `"explicitName|filename"` syntax

The `explicitMounts` map (line 484 of FileSystem.ts) already stores `"mountName → IReadOnlyPackage"` mappings, which are queried by `openAsync()` (line 993-1005).

### 6.4 How Content Installer Mod Works

In OpenRA desktop, the content installer is a **separate mod** (e.g., `ra-content`). The game switches to this mod, which has its own UI widgets, loadscreen, and logic.

In OpenRAWeb3D, we simplify this: the content installer runs as a **service within the main mod's Game instance**. No mod switching needed because:

1. The main mod's manifest already includes content package references in its FileSystem section
2. The download UI is a DOM overlay, not a separate Widget tree
3. No process-level state separation needed (browser is single-page)

However, we still build the content installer metadata at build time from the existing `OpenRA/mods/*-content/installer/*.yaml` files.

---

## 7. URL Resolution

### 7.1 Mapping Mount Names to Downloaded Assets

OpenRA mod.yaml FileSystem sections use these patterns:

```yaml
# SystemPackages (mod-provided, always available):
^EngineDir|mods/ra: ra          → mountName = "ra" (already in web build)
^EngineDir|mods/common: common  → mountName = "common" (already in web build)

# ContentPackages (user-installed, may be missing):
~^SupportDir|Content/ra/v2/: content  → mountName = "content"
  ~^SupportDir|Content/ra/v2/allies.mix: allies.mix
  ~^SupportDir|Content/ra/v2/conquer.mix: conquer.mix
```

In the web version, the resolution chain is:

```
mod manifest mount "allies.mix"
  │
  ├── 1. FileSystem.mount("allies.mix")
  │     → tries fetch("allies.mix") from Vite dev server
  │     → fails (SPA fallback returns HTML)
  │     → (optional mount: silently skipped)
  │
  ├── 2. ContentInstallerService.checkContent("ra")
  │     → sees "allies.mix" is missing from IndexedDB
  │     → shows download UI
  │
  ├── 3. User downloads ra-quickinstall ZIP from mirror
  │     → extracts allies.mix → IndexedDB + Cache API
  │
  └── 4. FileSystem.mountFromBuffer("allies.mix", alliedMixData, "Content/ra/v2/allies.mix")
        → registered as explicit mount "Content/ra/v2/allies.mix"
        → files accessible via "allies.mix|filename" syntax
```

### 7.2 Content Storage Key Scheme

```
IndexedDB:
  Database: 'openra-content'
  Store: 'packages'
  Key: 'ra:quickinstall'
  Value: { packageId, sha1, version, downloadedAt, extractedFiles[], totalSize }

  Store: 'files'
  Key: 'ra/v2/allies.mix' → { sha1, size, storedAt, cacheKey }

Cache API:
  Cache: 'openra-content-v1'
  Key: '/__content__/ra/v2/allies.mix'
  Value: Response with binary body + headers { x-sha1, x-size }
```

---

## 8. build-mods.ts Changes

### 8.1 New Build Step: Content Manifest Generation

The existing `build-mods.ts` converts mod.yaml → mod.json. We need a new step to convert the content installer YAML files:

```
OpenRA/mods/ra-content/installer/downloads.yaml   → public/mods/ra-content/content.json
OpenRA/mods/cnc-content/installer/downloads.yaml  → public/mods/cnc-content/content.json
OpenRA/mods/d2k-content/installer/downloads.yaml  → public/mods/d2k-content/content.json
OpenRA/mods/ts-content/installer/downloads.yaml   → public/mods/ts-content/content.json
```

### 8.2 New Build Script

**File**: `scripts/build-content.ts`

```typescript
/**
 * build-content.ts — Content installer YAML → JSON converter
 *
 * Reads OpenRA/mods/*-content/installer/downloads.yaml and converts to
 * public/mods/*-content/content.json (ModContentManifest format).
 *
 * Usage: npx tsx scripts/build-content.ts
 */

// For each mod with content:
//   1. Read downloads.yaml → parse with MiniYamlParser
//   2. Build ModContentManifest from parsed data
//   3. Write content.json to public/mods/{modId}-content/content.json
```

### 8.3 package.json Script Update

```json
{
  "scripts": {
    "build:mods": "tsx scripts/build-mods.ts",
    "build:content": "tsx scripts/build-content.ts",
    "build:all": "npm run build:mods && npm run build:content"
  }
}
```

### 8.4 MIX Hash Database Generation

**File**: `scripts/build-mixdb.ts`

```typescript
/**
 * build-mixdb.ts — Generate MIX filename hash database
 *
 * Builds a JSON mapping of hash → filename for all known Westwood game files.
 * Used by the runtime MIX parser to resolve filename hashes back to names.
 *
 * Sources:
 * - OpenRA's built-in filename database (from OpenRA.Mods.Cnc/FileSystem/)
 * - XCC global mix database (shipped with OpenRA)
 * - Per-game file lists extracted from existing mod data
 *
 * Output: public/mods/_mixdb.json
 */
```

### 8.5 Summary of build-mods.ts Changes

| Change | File | Description |
|--------|------|-------------|
| **NEW** | `scripts/build-content.ts` | Convert content installer YAML → JSON |
| **NEW** | `scripts/build-mixdb.ts` | Generate MIX hash → filename database |
| **MODIFY** | `scripts/build-mods.ts` | Add `ContentInstallerMod` field to mod.json; add FileSystem `ContentPackages` extraction |
| **MODIFY** | `package.json` | Add `build:content`, `build:mixdb`, `build:all` scripts |

The key modification to `build-mods.ts` is adding `ContentInstallerMod` to the mod.json output:

```typescript
// In transformToModJson():
result['ContentInstallerMod'] = modId + '-content'
```

This tells the runtime which content installer manifest to load.

---

## 9. Data Model

### 9.1 Content Manifest JSON (build output)

File: `public/mods/ra-content/content.json`

```json
{
  "modId": "ra-content",
  "targetModId": "ra",
  "packages": {
    "quickinstall": {
      "title": "Quick Install Package",
      "identifier": "quickinstall",
      "testFiles": ["Content/ra/v2/allies.mix"],
      "sources": [],
      "required": true,
      "download": "quickinstall"
    },
    "basefiles": {
      "title": "Base Freeware Content",
      "identifier": "basefiles",
      "testFiles": ["Content/ra/v2/allies.mix"],
      "sources": [],
      "required": true,
      "download": "basefiles"
    }
  },
  "downloads": {
    "quickinstall": {
      "title": "Quick Install Package",
      "mirrorList": "https://www.openra.net/packages/ra-quickinstall-mirrors.txt",
      "sha1": "44241f68e69db9511db82cf83c174737ccda300b",
      "type": "ZipFile",
      "extract": {
        "Content/ra/v2/allies.mix": "allies.mix",
        "Content/ra/v2/conquer.mix": "conquer.mix",
        "Content/ra/v2/russian.mix": "russian.mix"
      }
    },
    "basefiles": {
      "title": "Base Freeware Content",
      "mirrorList": "https://www.openra.net/packages/ra-base-mirrors.txt",
      "sha1": "aa022b208a3b45b4a45c00fdae22ccf3c6de3e5c",
      "type": "ZipFile",
      "extract": {
        "Content/ra/v2/allies.mix": "allies.mix",
        "Content/ra/v2/conquer.mix": "conquer.mix"
      }
    }
  }
}
```

### 9.2 MIX Database (build output)

File: `public/mods/_mixdb.json`

```json
{
  "ra": {
    "0x1234ABCD": "soviet.shp",
    "0x5678EF01": "harvester.shp",
    "_hashType": "CRC32",
    "_filenames": ["soviet.shp", "harvester.shp", "..."]
  },
  "cnc": {
    "_hashType": "Classic",
    "_filenames": ["..."],
    "...": "..."
  }
}
```

---

## 10. Phase Plan

### Phase A: Core Download Pipeline (Priority: HIGH)

**Goal**: Users can download RA content from OpenRA mirrors and play with real assets.

| # | Task | File(s) | Dependencies |
|---|------|---------|-------------|
| A.1 | `ContentInstallerTypes.ts` — type definitions | `src/OpenRA.Game/ContentInstaller/ContentInstallerTypes.ts` | None |
| A.2 | `Sha1Verifier.ts` — Web Crypto SHA1 | `src/OpenRA.Game/ContentInstaller/Sha1Verifier.ts` | A.1 |
| A.3 | `MirrorResolver.ts` — mirror list fetch + random pick | `src/OpenRA.Game/ContentInstaller/MirrorResolver.ts` | A.1 |
| A.4 | `DownloadManager.ts` — fetch with ReadableStream progress + SHA1 verify | `src/OpenRA.Game/ContentInstaller/DownloadManager.ts` | A.2, A.3 |
| A.5 | `MixFileRuntime.ts` — C&C format MIX parser (promote from doc stub) | `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` | Existing `PackageEntry.ts` |
| A.6 | `MixLoader` update — register `MixFileRuntime` as a valid loader | `src/OpenRA.Mods.Cnc/FileSystem/MixFile.ts` | A.5 |
| A.7 | `PackageExtractor.ts` — ZIP extraction + MIX/Pak sub-parse | `src/OpenRA.Game/ContentInstaller/PackageExtractor.ts` | A.4, A.5, A.6 |
| A.8 | `ContentInstallerService.ts` — state machine + orchestration | `src/OpenRA.Game/ContentInstaller/ContentInstallerService.ts` | A.7 |
| A.9 | `build-content.ts` — YAML → JSON content manifest conversion | `scripts/build-content.ts` | A.1 |
| A.10 | `build-mixdb.ts` — MIX hash database generation | `scripts/build-mixdb.ts` | A.5 |
| A.11 | Integration into `Game.loadMod()` — check content before starting | `src/OpenRA.Game/Game.ts` | A.8 |
| A.12 | `ContentInstallerUI.ts` — DOM overlay with package list + progress | `src/OpenRA.Game/ContentInstaller/ContentInstallerUI.ts` | A.8, A.11 |
| A.13 | Unit tests for all Phase A components | `*.test.ts` files | A.2-A.12 |

**Estimated: 13 tasks**

### Phase B: Polish & Offline (Priority: MEDIUM)

| # | Task | Description |
|---|------|-------------|
| B.1 | Encrypted MIX support (RA/TS format) | Requires Blowfish/RSA WASM (~300KB). May use web crypto or pre-extracted database. Deferred pending demand. |
| B.2 | Source-based installation (CD, Steam, Origin) | `ModContent.ModSource` — auto-detect game installations. Low priority for web. |
| B.3 | Multiple package concurrent downloads | Download two packages at once (Firefox/Chrome allow 6 concurrent HTTP connections) |
| B.4 | Resume interrupted downloads | Use Range headers + partial SHA1 verification for resumable downloads |
| B.5 | Content update check | Version comparison + re-download only changed packages |
| B.6 | Storage quota management | Detect StorageManager.estimate() quota exceeded → offer to clear old content |
| B.7 | Offline detection | navigator.onLine → skip mirror fetch, check IndexedDB only |
| B.8 | Service Worker cache integration | Pre-cache content ZIPs via SW for faster re-install on different devices |

### Phase C: Multi-Mod Support (Priority: LOW)

| # | Task | Description |
|---|------|-------------|
| C.1 | C&C (Tiberian Dawn) content | Already defined in `cnc-content/installer/` — same pipeline |
| C.2 | Dune 2000 content | `.R8`/`.R16`/`.RS` files — raw data (no MIX), simpler pipeline |
| C.3 | Tiberian Sun content | Encrypted MIX + `.tem` tilesets — needs Phase B.1 |
| C.4 | Content mod switching | When user switches from RA to C&C, install C&C content (keep RA cached) |

---

## 11. Open Questions & Risks

### 11.1 CORS for OpenRA Mirrors

**Risk**: The OpenRA mirror URLs (e.g., `https://www.openra.net/packages/ra-quickinstall-mirrors.txt`) may not include CORS headers allowing cross-origin fetch from a web app.

**Mitigation**:
- The mirror list URL itself (`openra.net`) likely has CORS headers (it's a CDN)
- If not, we need a CORS proxy or a custom mirror list hosted on our domain
- The actual download mirrors (individual ZIP URLs) may also need CORS. We should test early.

**Status**: NEEDS VERIFICATION. Test with `fetch()` from dev server to `https://www.openra.net/packages/ra-quickinstall-mirrors.txt`.

### 11.2 Content Package Size

**Risk**: RA quickinstall ZIP is approximately 500+ MB. Downloading in-browser may be slow and memory-intensive.

**Mitigation**:
- Use streaming download (ReadableStream) to avoid buffering entire ZIP in memory
- fflate supports streaming decompression (`unzip` vs `unzipSync`)
- Cache API stores the raw ZIP, so re-download only needed for fresh installs
- Show estimated download time + speed in UI

**Status**: Acceptable. 500 MB download is typical for modern web games.

### 11.3 IndexedDB Storage Quota

**Risk**: IndexedDB quota varies by browser (Chrome: ~60% of disk free space, Firefox: ~50% with user prompt, Safari: ~1GB limit).

**Mitigation**:
- Use Cache API (higher quota) for large binary blobs
- Store only metadata + small files in IndexedDB
- Check `navigator.storage.estimate()` before downloading
- Offer "low-storage mode" (download only required tilesets)

**Status**: Acceptable with Cache API. RA content (~500 MB) should fit in most browser quotas.

### 11.4 MIX Hash Database Completeness

**Risk**: The hash database may not resolve all filenames, especially for less common MIX files.

**Mitigation**:
- Use the local mix database (if present in the MIX) for self-describing MIX files
- Fall back to the XCC global database for broader coverage
- Unknown hashes produce warnings but don't block gameplay (the file is just inaccessible)
- Log unresolved hashes for manual review + database updates

**Status**: Acceptable. Unresolved hashes are non-fatal.

### 11.5 SHA1 Verification Performance

**Risk**: Computing SHA1 of a 500 MB ZIP in JavaScript may be slow.

**Mitigation**:
- Web Crypto API `SubtleCrypto.digest('SHA-1', data)` is hardware-accelerated
- SHA1 of 500 MB takes < 2 seconds on modern hardware
- Show a "Verifying..." step in the UI so the user knows it's working
- If too slow, use incremental hashing (hash chunks as they arrive)

**Status**: Low risk. Web Crypto API is fast enough.

---

## Appendix A: Existing Infrastructure Reuse Summary

| Component | Existing File | How It's Reused |
|-----------|--------------|-----------------|
| ZIP decompression | `ZipFile.ts` (fflate) | `PackageExtractor` uses `unzipSync` for downloaded ZIPs |
| Package loading | `IPackage.ts` / `IPackageLoader` | `MixFileRuntime` implements `IReadOnlyPackage`; `MixLoader` updated to load it |
| FileSystem 4-layer cache | `FileSystem.ts` | Downloaded content stored in L2/L3 cache; `mountFromBuffer()` integrates extracted files |
| Pak runtime parser | `Pak.ts` | Already implemented! Used directly in `PackageExtractor` for `.pak` files in ZIPs |
| BigFile loader | `BigFile.ts` | Already implemented! Used for `.big` files if present |
| MegFile loader | `MegFile.ts` | Already implemented! Used for `.meg` files if present |
| Build pipeline | `build-mods.ts` | Extended with content installer YAML conversion |
| MiniYAML parser | `miniyaml-to-json.ts` | Used in `build-content.ts` to parse installer YAML |
| DOM overlay pattern | `Game.ts` (main menu) | `ContentInstallerUI` uses the same approach |
| LRU memory cache | `FileSystem.ts` (L1) | Content files loaded into L1 via `mountFromBuffer()` |

## Appendix B: File Layout

```
src/OpenRA.Game/ContentInstaller/
  ContentInstallerTypes.ts       ← Phase A.1 — type definitions
  Sha1Verifier.ts                ← Phase A.2 — Web Crypto SHA1
  MirrorResolver.ts              ← Phase A.3 — mirror list fetch
  DownloadManager.ts             ← Phase A.4 — streaming download + progress
  PackageExtractor.ts            ← Phase A.7 — ZIP extraction + sub-format parse
  ContentInstallerService.ts     ← Phase A.8 — state machine + orchestration
  ContentInstallerUI.ts          ← Phase A.12 — DOM overlay UI
  index.ts                       ← Barrel re-export

src/OpenRA.Mods.Cnc/FileSystem/
  MixFileRuntime.ts              ← Phase A.5 — Promoted from doc stub
  MixFile.ts                     ← Phase A.6 — Updated MixLoader

scripts/
  build-content.ts               ← Phase A.9 — Content YAML → JSON conversion
  build-mixdb.ts                 ← Phase A.10 — MIX hash database generation

public/mods/
  ra-content/content.json        ← Phase A.9 output
  cnc-content/content.json       ← Phase B/C output
  d2k-content/content.json       ← Phase C output
  ts-content/content.json        ← Phase C output
  _mixdb.json                    ← Phase A.10 output
```

---

*End of Design Document*
