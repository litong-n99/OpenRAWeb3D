# OpenRA to Babylon.js Migration Plan: Chapter 5 -- UI System and Resource Management

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 6 (lines 853-940)
> **Chapter Status**: Chapter 5 -- PLANNING (0/16 migrated, 0%)
> **Planning Date**: 2026-06-11
> **Prerequisite**: Chapter 4 (Map & Terrain System) -- COMPLETE (37/37, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: File System Foundation](#31-phase-a-file-system-foundation)
   - 3.2 [Phase B: C&C Package Formats](#32-phase-b-cc-package-formats)
   - 3.3 [Phase C: MOD System Core](#33-phase-c-mod-system-core)
   - 3.4 [Phase D: UI Widget Core](#34-phase-d-ui-widget-core)
   - 3.5 [Phase E: World Interaction Bridge](#35-phase-e-world-interaction-bridge)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's UI and Resource Management system spans **two interconnected subsystems**: the **Virtual File System (VFS)** that abstracts game asset loading across multiple archive formats, and the **Chrome UI Widget system** that renders menus, HUDs, and interaction overlays. The core paradigm shifts:

- **File System**: From C# synchronous local filesystem (Directory/ZIP/MIX) to browser fetch-based layered VFS with four-level caching (memory / IndexedDB / Cache API / remote CDN).
- **UI System**: From retained-mode imperative Widget tree (SDL2 surface rendering) to a **mixed HTML/CSS Overlay + Babylon.GUI** architecture. Complex menus and dialogs use HTML/CSS for DOM-native text quality and accessibility; HUD elements anchored to 3D objects use Babylon.GUI for frame synchronization without coordinate conversion overhead.
- **MOD System**: From .NET Assembly reflection (`Activator.CreateInstance`) to **ES6 Dynamic Import + class registry**, with JSON manifests replacing `mod.yaml` at build time.

### 1.2 Six Core Architectural Principles

1. **Build-time preprocessing for asset archives**: MIX/BigFile/MegFile/PAK formats are unpacked at build time in Node.js, never in the browser. The browser only handles ZIP (via `fflate`) and HTTP folder mounts.
2. **Four-level cache hierarchy**: L1 = in-memory `Map<string, ArrayBuffer>` (session), L2 = IndexedDB (large file persistence), L3 = Cache API (HTTP caching), L4 = remote CDN (origin). Eviction policy: LRU with priority weighting.
3. **Mixed UI rendering strategy**: HTML/CSS Overlay for menus, dialogs, settings panels; Babylon.GUI for floating labels, health bars, and minimap. The decision boundary is: if the element needs to track a 3D world position frame-by-frame, use Babylon.GUI; otherwise use HTML/CSS.
4. **Event bus isolation**: Widget game-world communication goes exclusively through a typed event bus (`TypedEventEmitter`). No Widget may directly call Babylon.js scene methods or mutate game state.
5. **MOD system via registration, not reflection**: Each MOD's classes register themselves in a global `ModRegistry` at import time. `ObjectCreator` becomes a simple `Map<string, Constructor>` lookup.
6. **MiniYAML is already solved**: The build-time MiniYAML-to-JSON pipeline (`utils/miniyaml-to-json.ts`) from Chapter 4 Phase H handles all YAML parsing. This chapter consumes only JSON.

### 1.3 UI Strategy Decision Matrix

This table formalizes the HTML/CSS vs Babylon.GUI boundary:

| Evaluation Dimension | HTML/CSS Overlay | Babylon.GUI | Recommended For |
|:---|:---|:---|:---|
| Rendering Pipeline | DOM + CSS, excellent text quality | Canvas 2D, native 3D sync | Menus/dialogs -> HTML/CSS; floating labels -> GUI |
| Style Flexibility | Full CSS control, mature toolchain | Limited theme system, WPF-like API | Complex skins -> HTML/CSS; simple embedded -> GUI |
| Event Handling | Native DOM events, bubble/capture | `onPointerObservable`, manual dispatch | Complex interactions -> HTML/CSS |
| Dev Efficiency | React/Vue ecosystem, high reuse | Specialized API, steeper learning | Teams with frontend background -> HTML/CSS |
| 3D Synchronization | Manual coordinate transform (Canvas -> DOM) | Same coordinate system, zero overhead | Anchored to 3D objects -> GUI |
| Performance | DOM update cost, best for static/low-freq UI | GPU accelerated, best for high-freq updates | HUD data refresh -> GUI |
| Accessibility | Native ARIA support | No built-in a11y | WCAG compliance -> HTML/CSS |

### 1.4 Already Available (Completed in Prior Chapters)

| Dependency | Source | Status |
|:---|:---|:---|
| MiniYAML -> JSON pipeline | `utils/miniyaml-to-json.ts` | COMPLETE (Ch4 Phase H) |
| `IReadOnlyPackage` interface stub | `src/OpenRA.Game/FileSystem/IReadOnlyPackage.ts` | STUB (Ch4 Phase E) |
| `MapCache` (map directory scanner) | `src/OpenRA.Game/Map/MapCache.ts` | COMPLETE (Ch4 Phase E) |
| `MapDirectoryTracker` (file watcher) | `src/OpenRA.Game/Map/MapDirectoryTracker.ts` | COMPLETE (Ch4 Phase E) |
| `PlayerReference` | `src/OpenRA.Game/Map/PlayerReference.ts` | COMPLETE (Ch4 Phase E) |
| Coordinate types (WPos, CPos, etc.) | `src/OpenRA.Game/` | COMPLETE (Ch3 Phase A) |
| `World.ts` / `GameWorldManager` | `src/OpenRA.Game/World.ts` | COMPLETE (Ch3 Phase C) |
| `Actor.ts` / `GameActor` | `src/OpenRA.Game/Actor.ts` | COMPLETE (Ch3 Phase D) |
| `Renderer.ts` + `WorldRenderer.ts` | `src/OpenRA.Game/` | COMPLETE (Ch2) |
| CoordinateTransformer | `src/OpenRA.Game/CoordinateTransformer.ts` | COMPLETE (Ch4 Phase I) |

### 1.5 Architecture Diagram Reference

```
                     +-----------------------------------+
                     |        HTML/CSS Overlay Layer      |
                     |  (menus, dialogs, settings, chat)   |
                     +-----------------------------------+
                           | DOM Events (bubble)
                     +-----------------------------------+
                     |      Widget Tree (TypeScript)       |
                     |  Widget.ts, Ui.ts, WidgetLoader.ts  |
                     +-----------------------------------+
                           | Event Bus (TypedEventEmitter)
                     +-----------------------------------+
                     |     World Interaction Bridge        |
                     |  WorldInteractionControllerWidget   |
                     +-----------------------------------+
                     |  Babylon.GUI Layer                  |
                     |  (health bars, labels, minimap)     |
                     +-----------------------------------+
                     |  Babylon.js Scene (WorldRenderer)   |
                     +-----------------------------------+

                     +-----------------------------------+
                     |        MOD System (ModData)         |
                     |  Manifest.ts + ModData.ts            |
                     +-----------------------------------+
                           | depends on
                     +-----------------------------------+
                     |    Virtual File System (VFS)         |
                     |  FileSystem.ts + Package Loaders     |
                     +-----------------------------------+
                     |  Folder | ZIP | MIX | BigFile | etc |
                     +-----------------------------------+
                     |  Four-Level Cache                   |
                     |  Mem | IndexedDB | Cache API | CDN  |
                     +-----------------------------------+
```

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (16 files across 5 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: File System Foundation** | | | | | | |
| 1 | `OpenRA.Game/FileSystem/IPackage.cs` | `src/OpenRA.Game/FileSystem/IPackage.ts` | `IPackage`, `IReadOnlyPackage` | 42 | Low | A |
| 2 | `OpenRA.Game/FileSystem/Folder.cs` | `src/OpenRA.Game/FileSystem/Folder.ts` | `Folder` | 110 | Low | A |
| 3 | `OpenRA.Game/FileSystem/ZipFile.cs` | `src/OpenRA.Game/FileSystem/ZipFile.ts` | `ZipFile`, `ZipFileLoader` | 262 | Low | A |
| 4 | `OpenRA.Game/FileSystem/FileSystem.cs` | `src/OpenRA.Game/FileSystem/FileSystem.ts` | `FileSystem`, `IReadOnlyFileSystem` | 304 | Medium | A |
| | | | | | | |
| **Phase B: C&C Package Formats** | | | | | | |
| 5 | `OpenRA.Mods.Cnc/FileSystem/PackageEntry.cs` | `src/OpenRA.Mods.Cnc/FileSystem/PackageEntry.ts` | `PackageEntry` | 118 | Low | B |
| 6 | `OpenRA.Mods.Cnc/FileSystem/MixFile.cs` | `src/OpenRA.Mods.Cnc/FileSystem/MixFile.ts` | `MixFile`, `MixLoader` | 248 | HIGH | B |
| 7 | `OpenRA.Mods.Cnc/FileSystem/BigFile.cs` | `src/OpenRA.Mods.Cnc/FileSystem/BigFile.ts` | `BigFile`, `BigFileLoader` | 124 | Low | B |
| 8 | `OpenRA.Mods.Cnc/FileSystem/MegFile.cs` | `src/OpenRA.Mods.Cnc/FileSystem/MegFile.ts` | `MegFile`, `MegFileLoader` | 141 | Low | B |
| 9 | `OpenRA.Mods.Cnc/FileSystem/Pak.cs` | `src/OpenRA.Mods.Cnc/FileSystem/Pak.ts` | `Pak`, `PakLoader` | 103 | Low | B |
| | | | | | | |
| **Phase C: MOD System Core** | | | | | | |
| 10 | `OpenRA.Game/Manifest.cs` | `src/OpenRA.Game/Manifest.ts` | `Manifest`, `ModMetadata` | 206 | Low | C |
| 11 | `OpenRA.Game/ModData.cs` | `src/OpenRA.Game/ModData.ts` | `ModData`, `ObjectCreator` | 258 | Medium | C |
| | | | | | | |
| **Phase D: UI Widget Core** | | | | | | |
| 12 | `OpenRA.Game/Widgets/Widget.cs` | `src/OpenRA.Game/Widgets/Widget.ts` | `Widget`, `ContainerWidget`, `Ui` | 708 | Medium | D |
| 13 | `OpenRA.Game/Widgets/ChromeMetrics.cs` | `src/OpenRA.Game/Widgets/ChromeMetrics.ts` | `ChromeMetrics` | 49 | Low | D |
| 14 | `OpenRA.Game/Widgets/WidgetLoader.cs` | `src/OpenRA.Game/Widgets/WidgetLoader.ts` | `WidgetLoader` | 83 | Medium | D |
| 15 | `OpenRA.Game/Graphics/ChromeProvider.cs` | `src/OpenRA.Game/Graphics/ChromeProvider.ts` | `ChromeProvider`, `Collection` | 305 | Low | D |
| | | | | | | |
| **Phase E: World Interaction Bridge** | | | | | | |
| 16 | `OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget.cs` | `src/OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget.ts` | `WorldInteractionControllerWidget` | 235 | HIGH | E |

> **Complexity Legend**:
> - **LOW**: Pure data structures, simple format wrappers, or thin abstraction layers. 40-310 lines of C#. Minimal or no Babylon.js integration.
> - **MEDIUM**: Core orchestration classes with multiple dependencies. 250-710 lines of C#. Moderate architecture design required.
> - **HIGH**: Complex 2D-to-3D paradigm conversion (WorldInteractionController) or cryptography/format reverse-engineering (MixFile). Requires significant design and testing.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 16 (15 from OpenRA + 1 IPackage consolidation) |
| **Phase A (FileSystem foundation)** | 4 files |
| **Phase B (C&C package formats)** | 5 files |
| **Phase C (MOD system)** | 2 files |
| **Phase D (UI widget core)** | 4 files |
| **Phase E (World interaction)** | 1 file |
| **HIGH complexity** | 2 files (MixFile, WorldInteractionControllerWidget) |
| **MEDIUM complexity** | 4 files (FileSystem, ModData, Widget, WidgetLoader) |
| **LOW complexity** | 10 files |
| **Total OpenRA C# source lines** | ~3,296 (excluding MiniYaml which is already done) |
| **Already completed (MiniYAML)** | 1 file (Ch4 Phase H) |
| **Already available (IReadOnlyPackage stub)** | 1 file (needs full implementation in Phase A) |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: File System Foundation

**Status**: PENDING (0/4)
**Complexity**: Low-Medium
**Blocked by**: Nothing (foundation layer)
**Blocks**: Phase B (C&C formats register with FileSystem), Phase C (ModData needs FileSystem for mounting), Phase D (WidgetLoader needs FileSystem for reading UI YAML)

**Description**: The File System Foundation establishes the layered Virtual File System (VFS) -- the data access abstraction that all asset loading flows through. OpenRA's `FileSystem` supports mounting multiple package formats (Folder, ZIP, MIX) with priority-based override semantics ("last mounted wins"). In the browser, folder mounts become HTTP fetch-based directory listings, ZIP is handled by the `fflate` library, and MIX is deferred to build-time unpacking. The `IPackage` / `IReadOnlyPackage` interface already has a stub from Chapter 4; Phase A replaces it with the full implementation.

**Paradigm Shifts**:
- C# `IReadOnlyFileSystem` interface (`Stream Open(string)`) -> TypeScript async interface (`Promise<ArrayBuffer | null> openAsync(string)`)
- C# `Mount(string path)` with local filesystem -> `mount(string url, IPackageLoader)` with fetch-based loading
- C# `Dictionary<string, IReadOnlyPackage>` explicit mounts -> `Map<string, IReadOnlyPackage>` with URL prefix keys
- C# synchronous `Stream` -> `Promise<ArrayBuffer>` (all I/O is async in the browser)
- C# `Cache<string, List<IReadOnlyPackage>>` fileIndex -> `Map<string, IReadOnlyPackage[]>` with LRU eviction
- ZIP: C# `System.IO.Compression.ZipArchive` -> `fflate` library (`unzipSync` for small, `unzip` for large with Worker)

#### 3.1.1 IPackage / IReadOnlyPackage (Full Implementation)

- [ ] **TODO-5.A.1** `src/OpenRA.Game/FileSystem/IPackage.ts` (42 lines C#) -- Replace stub with full interface:
  - `IReadOnlyPackage`: `name: string`, `contents: readonly string[]`, `contains(filename: string): boolean`, `open(filename: string, files: IReadOnlyFileSystem): Promise<ArrayBuffer | null>`, `openPackage(filename: string, files: IReadOnlyFileSystem): IReadOnlyPackage | null`
  - `IPackage` (extends `IReadOnlyPackage`): `update(filename: string, data: Uint8Array): void`, `delete(filename: string): void`
  - `IPackageLoader`: `tryParsePackage(filename: string, stream: ArrayBuffer): IReadOnlyPackage | null`
  - **Key behavioral invariant**: `contains()` returns `true` for files; `openPackage()` returns `null` for non-package entries
  - **Existing stub preservation**: The current `IReadOnlyPackage.ts` (78 lines) from Chapter 4 Phase E must be refactored into this consolidated `IPackage.ts` file. Update all imports in `MapCache.ts`, `MapDirectoryTracker.ts` to point to the new path.

#### 3.1.2 Folder Package

- [ ] **TODO-5.A.2** `src/OpenRA.Game/FileSystem/Folder.ts` (110 lines C#) -- HTTP-backed folder package:
  - `Folder` class implements `IReadOnlyPackage`
  - Constructor takes `name: string` and optional `fileListing: Map<string, string>` (filename -> URL mapping)
  - `contents`: returns sorted array of keys from `fileListing`
  - `contains(filename: string): boolean` -- O(1) key lookup
  - `open(filename: string): Promise<ArrayBuffer | null>` -- `fetch(url)` for the file, returns `null` on 404
  - `openPackage(filename: string): IReadOnlyPackage | null` -- returns `null` (folders do not contain sub-packages)
  - **Static factory**: `Folder.fromManifest(baseUrl: string, manifest: Record<string, string>): Folder` -- maps relative paths to absolute URLs
  - **Performance**: Lazy fetch; no file listing preload. First access triggers the HTTP request.
  - **Error handling**: `open()` on missing file returns `null`, not `throw`. HTTP errors (403, 500) also return `null`.

#### 3.1.3 ZipFile Package

- [ ] **TODO-5.A.3** `src/OpenRA.Game/FileSystem/ZipFile.ts` (262 lines C#) -- ZIP archive package via fflate:
  - `ZipFile` class implements `IReadOnlyPackage`
  - Constructor: asynchronously decompresses ZIP buffer using `fflate.unzipSync(new Uint8Array(buffer))` or `fflate.unzip()` + `AsyncWorker` for large files
  - `contents`: sorted array of entry filenames (from `fflate.Unzipped` keys)
  - `contains(filename: string): boolean` -- O(1) key lookup
  - `open(filename: string): Promise<ArrayBuffer | null>` -- returns `decompressedEntry.buffer` if exists, `null` otherwise
  - `openPackage(filename: string): IReadOnlyPackage | null` -- checks if entry name ends with known archive extension (`.zip`, `.oramap`), recursively attempts to mount as nested package
  - `ZipFileLoader` class implements `IPackageLoader`:
    - `tryParsePackage(filename: string, stream: ArrayBuffer): IReadOnlyPackage | null`
    - Checks file extension `.zip`/`.oramap` AND header magic `0x504B0304`
    - Returns `new ZipFile(name, stream)` on match, `null` otherwise
  - **Large file strategy**: Files > 5MB decompress in a Web Worker via `fflate.unzip()` to avoid blocking the main thread
  - **Memory management**: `dispose()` clears internal `Map<string, Uint8Array>` of decompressed entries

#### 3.1.4 FileSystem (VFS Manager)

- [ ] **TODO-5.A.4** `src/OpenRA.Game/FileSystem/FileSystem.ts` (304 lines C#) -- Layered VFS manager + AssetManager:
  - `IReadOnlyFileSystem` interface: `openAsync(filename: string): Promise<ArrayBuffer | null>`, `exists(filename: string): boolean`, `isMounted(filename: string): boolean`
  - `FileSystem` class implements `IReadOnlyFileSystem`:
    - `packageLoaders: IPackageLoader[]` -- ordered list (Folder loader, ZipFile loader, future: build-time unpacked loader)
    - `mountedPackages: Map<IReadOnlyPackage, number>` -- reference counting for lifecycle
    - `explicitMounts: Map<string, IReadOnlyPackage>` -- `"$modid|path"` -> package mapping
    - `fileIndex: Map<string, IReadOnlyPackage[]>` -- filename -> ordered list of packages containing it (last mounted = highest priority)
    - `mount(name: string): Promise<void>` -- respects `$modid` prefix, resolves URL to package via loaders
    - `mountFromBuffer(name: string, data: ArrayBuffer): void` -- directly mount a pre-loaded buffer (for bundled assets)
    - `unmount(name: string): void` -- decrements refcount, removes package when count hits 0
    - `unmountAll(): void` -- clears all mounts, triggers `dispose()` on each package
    - `openAsync(filename: string): Promise<ArrayBuffer | null>` -- consults `fileIndex[filename]`, returns last entry's `open(filename)`, `null` if no package has the file
    - `exists(filename: string): boolean` -- `fileIndex.has(filename) && fileIndex[filename].length > 0`
    - `resolvePackage(filename: string): string` -- returns package name that would serve the file (for debugging)
    - `loadAllManifests(baseUrl: string): Promise<void>` -- scans for JSON manifests at build-defined paths
  - **Four-level cache integration**:
    - L1: In-memory `Map<string, ArrayBuffer>` with LRU eviction (max 100MB)
    - L2: IndexedDB store via `localForage` (large files, persistent across sessions)
    - L3: Cache API (automatic via `fetch` with proper `Cache-Control` headers)
    - L4: Remote origin (HTTP fetch with `Range` for partial reads)
    - `openAsync()` consults L1 -> L2 -> L3 -> L4, populates L1 and L2 on cache miss
  - **Event hooks**: `onFileLoaded: Observable<{ filename: string, size: number }>` for progress tracking
  - **Error handling**: `mount()` throws `FileNotFoundException` if URL 404s, `PackageFormatException` if no loader recognizes the format

**Acceptance Criteria**:
- `Folder.open()` returns file contents via fetch; returns `null` on missing file (no throw)
- `ZipFile.open()` correctly decompresses entries from `fflate.Unzipped`; nested `.oramap` sub-mounts work recursively
- `FileSystem.mount()` recognizes format via loader chain (extension + magic bytes)
- `FileSystem.openAsync("example.png")` returns file from highest-priority package when multiple packages contain the file
- `FileSystem.unmount()` decrements refcount and disposes when count reaches 0
- L1 cache evicts least-recently-used entries when memory exceeds threshold
- All I/O methods return `Promise` (no synchronous I/O)
- Existing `MapCache` and `MapDirectoryTracker` continue to work after `IReadOnlyPackage` import path update

**Estimated Effort**:
| File | Est. impl lines | Est. test lines | Est. tests |
|:---|:---:|:---:|:---:|
| IPackage.ts | 80 | 60 | 10 |
| Folder.ts | 140 | 180 | 18 |
| ZipFile.ts | 310 | 380 | 28 |
| FileSystem.ts | 480 | 520 | 35 |
| **Total** | **~1,010** | **~1,140** | **~91** |

---

### 3.2 Phase B: C&C Package Formats

**Status**: PENDING (0/5)
**Complexity**: Low-HIGH (MixFile is HIGH; others are Low)
**Blocked by**: Phase A (needs `IPackage`, `IPackageLoader`, `FileSystem` registration interfaces)
**Blocks**: Phase C (ModData loads mod packages via these loaders)

**Description**: Westwood Studios' classic RTS games (C&C, Red Alert, Dune 2000) use proprietary archive formats: MIX (hashed filenames with optional Blowfish encryption), BIG (4-byte entry count + filename table + data), MEG (header + index + data blocks), and PAK (raw concatenation with offset table). Per the architecture document recommendation, **MIX files are unpacked at build time into standard ZIP + directory structures**. The browser-side implementations of MixFile, BigFile, MegFile, and Pak serve as **validation/documentation stubs** that document the format structure and provide a controlled path for any runtime use in development/debugging.

**Core Architecture Decision (ADR-5.1)**: MIX unpacking happens at build time. The `MixFile.ts` browser implementation is a **documentation module**: it contains the full format specification (header layout, hash algorithm, Blowfish key table) and a `tryParsePackage()` that returns `null` (directing the caller to use build-time unpacked assets). This avoids shipping Blowfish/RSA crypto to the browser and eliminates ~300KB of WASM crypto overhead.

#### 3.2.1 PackageEntry (Shared Data Structure)

- [ ] **TODO-5.B.1** `src/OpenRA.Mods.Cnc/FileSystem/PackageEntry.ts` (118 lines C#) -- Entry metadata:
  - `PackageEntry` class: `offset: number`, `length: number`, `size: number` (decompressed), `filename: string`
  - Static `calculateHash(filename: string): number` -- Westwood 32-bit rolling hash algorithm (identical to OpenRA `PackageEntry.HashFilename`)
  - `toString(): string` -- `"filename: offset=0x1234, length=456"` format
  - Used by all C&C format parsers as shared entry type
  - **Test requirement**: Hash output matches OpenRA for known filenames (`"e1.shp"`, `"conquer.mix"`, etc.)

#### 3.2.2 MixFile (Documentation Stub)

- [ ] **TODO-5.B.2** `src/OpenRA.Mods.Cnc/FileSystem/MixFile.ts` (248 lines C#) -- MIX format documentation:
  - `MixFile` class implements `IReadOnlyPackage`
  - **ADR-5.1 compliance**: `tryParsePackage()` returns `null` unconditionally -- build-time unpacking is the sole supported path
  - Contains full format specification as JSDoc + comments:
    - Header: `[2 bytes: flags] [2 bytes: numFiles] [4 bytes: bodySize]`
    - Flag bit 0: has checksum (hash table following header)
    - Flag bit 1: encrypted (Blowfish + public RSA key `"AihRvNoIbTeX85..."`)
    - Hash table: `[numFiles: 4-byte hashes] [numFiles: 4-byte offsets]`
    - Data blocks at offsets
  - `DecryptHeader(data: Uint8Array): Uint8Array` -- documented reference implementation of Blowfish decryption (not used at runtime; pure documentation for build-tool author)
  - `ParseIndex(data: Uint8Array): PackageEntry[]` -- documented reference implementation (not used at runtime)
  - `MixLoader` class: `tryParsePackage()` checks `.mix` extension + header flags bits, logs `"MIX files must be unpacked at build time. Skipping..."`, returns `null`
  - **File header includes**: extensive `@see` refs to OpenRA `MixFile.cs`, `BlowfishKeyProvider.cs`

#### 3.2.3 BigFile

- [ ] **TODO-5.B.3** `src/OpenRA.Mods.Cnc/FileSystem/BigFile.ts` (124 lines C#) -- BIG archive format:
  - `BigFile` class implements `IReadOnlyPackage`
  - Format: `[4 bytes BE: numEntries] [4 bytes BE: entrySize]` -> `[numEntries * entrySize bytes: string names]` -> `[numEntries: 4-byte BE offset + 4-byte BE size]` -> data blocks
  - Key difference from MIX: filenames are stored as plain strings, not hashed
  - `tryParsePackage()`: checks `.big` extension + BE numEntries field valid + all filenames are readable ASCII
  - Full runtime implementation supported (BIG is a clean format without encryption)
  - `contents`: sorted array of filenames
  - `open(filename: string): Promise<ArrayBuffer | null>` -- extracts data block by offset+size from the original buffer

#### 3.2.4 MegFile

- [ ] **TODO-5.B.4** `src/OpenRA.Mods.Cnc/FileSystem/MegFile.ts` (141 lines C#) -- MEG archive format:
  - `MegFile` class implements `IReadOnlyPackage`
  - Similar to BIG but with different header layout
  - Format: `[variable: header block] [variable: filename strings] [variable: data blocks]`
  - `tryParsePackage()`: checks `.meg` extension
  - Full runtime implementation (no encryption)
  - `contents`: sorted filenames
  - `open(filename: string): Promise<ArrayBuffer | null>` -- standard offset+size extraction

#### 3.2.5 Pak

- [ ] **TODO-5.B.5** `src/OpenRA.Mods.Cnc/FileSystem/Pak.ts` (103 lines C#) -- PAK archive format:
  - `Pak` class implements `IReadOnlyPackage`
  - Format: `[variable: concatenated file data]` with an index at a known offset
  - `tryParsePackage()`: checks `.pak` extension
  - Full runtime implementation (no encryption)
  - `contents`: sorted filenames
  - `open(filename: string): Promise<ArrayBuffer | null>` -- standard extraction

**Acceptance Criteria**:
- `PackageEntry.calculateHash()` produces identical results to OpenRA for all known C&C filenames
- `MixFile.tryParsePackage()` returns `null` and logs actionable message directing to build-time tooling
- `MixFile.ts` JSDoc contains complete format specification usable by a build-tool author
- `BigFile`, `MegFile`, `Pak` correctly extract known test files from reference archives
- All five loaders register with `FileSystem` via `IPackageLoader` interface
- Disposed packages release their `ArrayBuffer` references (check memory via `FinalizationRegistry` in tests)

**Estimated Effort**:
| File | Est. impl lines | Est. test lines | Est. tests |
|:---|:---:|:---:|:---:|
| PackageEntry.ts | 130 | 150 | 15 |
| MixFile.ts | 320 | 200 | 18 |
| BigFile.ts | 160 | 190 | 16 |
| MegFile.ts | 170 | 190 | 16 |
| Pak.ts | 140 | 160 | 14 |
| **Total** | **~920** | **~890** | **~79** |

---

### 3.3 Phase C: MOD System Core

**Status**: PENDING (0/2)
**Complexity**: Low-Medium
**Blocked by**: Phase A (FileSystem for package mounting), Phase B (C&C loaders for mod asset packages)
**Blocks**: Phase D (WidgetLoader reads UI layouts from mod YAML via FileSystem), Phase E (interaction controller needs World + ModData)

**Description**: The MOD System is the orchestration layer that ties assets, rules, UI, and game logic into a playable mod. `Manifest` parses `mod.yaml` (now pre-compiled to `mod.json` by the MiniYAML pipeline) into a structured configuration object. `ModData` coordinates all runtime subsystems: FileSystem, ObjectCreator, MapCache, WidgetLoader, and various asset loaders. The core paradigm shift is from .NET Assembly reflection (`Assembly.GetTypes()` / `Activator.CreateInstance()`) to ES6 Dynamic Import with a class registry.

**Paradigm Shifts**:
- C# `mod.yaml` + `Include` directives -> JSON `mod.json` (preprocessed at build time by `utils/miniyaml-to-json.ts`)
- C# `ObjectCreator.CreateObject<T>(string className)` via `Activator.CreateInstance` -> `ModRegistry.get<T>(className): Constructor<T>` via class registration at import time
- C# `Assembly[]` programmatically loaded DLLs -> ES6 `import()` dynamic modules
- C# `RequiresMods` dependency resolution -> Topological sort of JSON dependency graph with cycle detection
- C# `FieldLoader` reflection-based property injection -> TypeScript decorator-based metadata + `Object.assign()`

#### 3.3.1 Manifest

- [ ] **TODO-5.C.1** `src/OpenRA.Game/Manifest.ts` (206 lines C#) -- Mod configuration container:
  - `ModMetadata` interface: `title: string`, `version: string`, `author?: string`, `description?: string`, `website?: string`
  - `Manifest` class:
    - Constructor from parsed `mod.json` object (pre-compiled from `mod.yaml`)
    - `id: string` -- mod identifier (directory name or explicit)
    - `metadata: ModMetadata` -- title, version, etc.
    - `requiresMods: string[]` -- dependency list (mod IDs)
    - `mounts: string[]` -- file system mount paths (e.g., `"$modid:mymod.mix"`, `"~^content/cnc"`)
    - `rules: string[]` -- rule definition YAML files (now rule JSON files)
    - `sequences: string[]` -- sprite sequence definition files
    - `weapons: string[]` -- weapon definition files
    - `chromeLayout: string[]` -- UI layout YAML files
    - `chromeMetrics: string[]` -- UI metrics YAML files
    - `loadScreen: string` -- loading screen image path
    - `packageFormats: string[]` -- expected package formats (folder, oramap, zip)
    - Static `fromJSON(json: object): Manifest` -- factory from pre-compiled JSON
    - `validateDependencies(availableMods: Map<string, Manifest>): string[]` -- returns missing dependency IDs (empty array = all satisfied)
  - **Build-time preprocessing note**: `mod.yaml` `Include` directives are resolved and inlined by the MiniYAML pipeline (already done, Chapter 4 Phase H). `mod.json` is the single output file.

#### 3.3.2 ModData + ObjectCreator

- [ ] **TODO-5.C.2** `src/OpenRA.Game/ModData.ts` (258 lines C#) -- Runtime mod coordinator:
  - `ObjectCreator` class:
    - `registry: Map<string, Constructor<any>>` -- class name -> constructor mapping
    - `register(name: string, ctor: Constructor<any>): void` -- add to registry
    - `createObject<T>(className: string, ...args: any[]): T | null` -- lookup + instantiation; returns `null` if class not registered
    - `getType(className: string): Constructor<any> | null` -- lookup without instantiation
  - `ModData` class:
    - Constructor: `ModData(manifest: Manifest, fileSystem: FileSystem)`
    - `manifest: Manifest`
    - `files: FileSystem` -- the VFS instance for this mod
    - `objectCreator: ObjectCreator`
    - `mapCache: MapCache` -- reused from Chapter 4 (already implemented)
    - `widgetLoader: WidgetLoader` -- instantiated during init (Phase D dependency)
    - `init(): Promise<void>` -- initialization sequence:
      1. Mount all `manifest.mounts` into `files`
      2. Initialize `ObjectCreator` by scanning registered modules
      3. Load MapCache (delegates to existing `MapCache` implementation)
      4. Create WidgetLoader (when Phase D is available)
      5. Fire `onInitialized` callback
    - `loadRuleSet(): Promise<Ruleset>` -- stub for Chapter 7 (networking/game logic); reads rule JSON files
    - `loadSequenceSet(): Promise<SequenceSet>` -- stub for future sprite sequence loading
    - `dispose(): void` -- unmounts file system, clears caches
  - **Module registration pattern**:
    ```typescript
    // In each trait/widget/loader module:
    import { ModRegistry } from 'src/OpenRA.Game/ModRegistry'
    ModRegistry.register('ButtonWidget', ButtonWidget)
    ModRegistry.register('LabelWidget', LabelWidget)
    ```
    This replaces C# `[assembly: Widget("Button")]` assembly-level attributes.

**Acceptance Criteria**:
- `Manifest.fromJSON()` correctly parses all sections from a reference `mod.json`
- `Manifest.validateDependencies()` correctly identifies missing, satisfied, and cyclic dependencies
- `ObjectCreator.createObject()` instantiates registered classes with correct constructor arguments
- `ObjectCreator.createObject()` returns `null` (not throws) for unregistered class names
- `ModData.init()` completes the full initialization sequence without errors
- `ModData.dispose()` releases FileSystem mounts and clears caches
- Integration: ModData can load a real mod's `mod.json`, mount its packages, and expose files through `files.openAsync()`

**Estimated Effort**:
| File | Est. impl lines | Est. test lines | Est. tests |
|:---|:---:|:---:|:---:|
| Manifest.ts | 180 | 200 | 22 |
| ModData.ts | 380 | 410 | 30 |
| **Total** | **~560** | **~610** | **~52** |

---

### 3.4 Phase D: UI Widget Core

**Status**: PENDING (0/4)
**Complexity**: Low-Medium
**Blocked by**: Phase C (WidgetLoader needs FileSystem + ModData for reading UI YAML layouts)
**Blocks**: Phase E (WorldInteractionControllerWidget extends Widget)

**Description**: The Chrome UI Widget system is OpenRA's retained-mode GUI framework. `Widget` is the abstract base class defining the component tree contract (parent/children hierarchy, bounds, event dispatch, focus management). `Ui` is the static root manager holding the root `ContainerWidget` and modal window stack. `WidgetLoader` instantiates Widget trees from MiniYAML layouts (now pre-compiled to JSON via Phase H of Chapter 4). `ChromeProvider` manages UI skin resources (panel images, HiDPI variants, 9-slice regions). `ChromeMetrics` provides default theme values (colors, fonts, spacing).

The TypeScript migration uses a **pure TypeScript Widget tree** (not React/Vue DOM components) for architectural parity with OpenRA. Each Widget class has a corresponding React wrapper that bridges the Widget lifecycle to DOM rendering. This dual-layer approach preserves OpenRA's exact Widget semantics (event handling order, focus management, modal stack) while leveraging CSS for actual visual rendering.

**Paradigm Shifts**:
- OpenRA `Widget.Draw()` (SDL2 bitmap rendering) -> `Widget.render(): HTMLElement` (returns DOM element for React to mount)
- OpenRA `HandleMouseInputOuter()` (manual hit-test + reverse-order event dispatch) -> DOM native event bubbling with `pointer-events` CSS control
- OpenRA `WindowList` (Stack<Widget> modal dialog stack) -> React Portal with z-index layering
- OpenRA `ChromeLogic` (C# class attached to Widget) -> TypeScript class + React hooks/composables
- OpenRA `WidgetArgs` (Dictionary<string, object>) -> React Context / typed Provider
- OpenRA 9-slice panel via `Sprite[]` -> CSS `border-image` with `border-image-slice`
- OpenRA ChromeMetrics (runtime class lookups) -> CSS custom properties (`--button-depth: 2px`) + `getComputedStyle()`

#### 3.4.1 Widget (Base Class + Ui Manager)

- [ ] **TODO-5.D.1** `src/OpenRA.Game/Widgets/Widget.ts` (708 lines C#) -- Widget base class + Ui static manager:
  - `Widget` abstract class:
    - `id: string` -- widget identifier (from YAML `Container@IDENTIFIER`)
    - `parent: Widget | null`, `children: Widget[]` -- tree structure
    - `bounds: WidgetBounds` (`{ x, y, width, height }`) -- layout rectangle
    - `visible: boolean` -- visibility toggle; propagates `becameHidden()`/`becameVisible()` lifecycle
    - `logic: ChromeLogic[]` -- attached logic objects
    - `postInitCalled: boolean` -- initialization guard
    - `initialize(args: WidgetArgs): void` -- computes `bounds` from expression variables (e.g., `WINDOW_RIGHT - WIDTH`)
    - `postInit(args: WidgetArgs): void` -- two-phase init: instantiates ChromeLogic after all children initialized
    - `addChild(w: Widget): void` -- appends to `children`, sets `parent`
    - `removeChild(w: Widget): void` -- removes from `children`, clears `parent`
    - `removeChildren(): void` -- removes all children
    - `render(): HTMLElement` -- returns the DOM element for this widget; subclasses override
    - `renderOuter(): HTMLElement` -- renders self + recursively renders children (equivalent to `DrawOuter()` painter's algorithm)
    - `becameHidden(): void` -- lifecycle hook when hidden (modal dialog covered)
    - `becameVisible(): void` -- lifecycle hook when revealed
    - `dispose(): void` -- cleanup; removes from parent
  - `ContainerWidget` class:
    - Extends `Widget` with no additional behavior (pure container)
    - Used as root node and intermediate grouping nodes
  - `Ui` static class:
    - `root: ContainerWidget` -- the single root node
    - `windowList: Widget[]` -- modal dialog stack (last = top)
    - `mouseFocusWidget: Widget | null`, `keyboardFocusWidget: Widget | null`
    - `openWindow(w: Widget): void` -- pushes to windowList, hides previous top
    - `closeWindow(): void` -- pops from windowList, shows previous top
    - `resetAll(): void` -- clears root children and window stack
    - `initialize(args: WidgetArgs): void` -- recursive init on root
  - **Event handling (critical paradigm shift)**:
    - OpenRA: `HandleMouseInputOuter()` iterates children **last-to-first** (reverse Z-order), first `true` return captures event
    - DOM: events bubble from target to parent
    - **Resolution**: React event handlers at each Widget's DOM node call `event.stopPropagation()` when the Widget "handles" the event, mimicking OpenRA's capture semantics. Container widgets use `pointer-events: none` for transparent areas (respecting `ClickThrough` semantics).
  - **Focus system**: `keyboardFocusWidget` tracks which Widget receives keyboard events. Tab order follows DOM natural order within the Widget tree. Focus is transferred on click (`mouseFocusWidget`) or Tab (`keyboardFocusWidget`). Both focus types can be held simultaneously by different Widgets.

#### 3.4.2 ChromeMetrics

- [ ] **TODO-5.D.2** `src/OpenRA.Game/Widgets/ChromeMetrics.ts` (49 lines C#) -- Theme defaults:
  - `ChromeMetrics` class:
    - `values: Map<string, string | number>` -- key-value store for theme defaults
    - `get<T extends string | number>(key: string): T` -- typed accessor
    - `tryGet<T extends string | number>(key: string): T | undefined` -- safe accessor
    - Static `fromJSON(json: Record<string, string | number>): ChromeMetrics` -- factory from JSON (pre-compiled from YAML)
  - **CSS integration**: Each `ChromeMetrics` value maps to a CSS custom property:
    ```css
    :root {
      --button-depth: 2px;
      --font-size-title: 24px;
      --color-panel-background: #1a1a1a;
    }
    ```
  - `get()` consults in-memory `values` first, falls back to `getComputedStyle(document.documentElement).getPropertyValue('--key')`
  - Used by Widget subclasses during `render()` to apply visual properties

#### 3.4.3 WidgetLoader

- [ ] **TODO-5.D.3** `src/OpenRA.Game/Widgets/WidgetLoader.ts` (83 lines C#) -- UI layout loader:
  - `WidgetLoader` class:
    - Constructor: reads `manifest.chromeLayout` files from FileSystem, parses as JSON (pre-compiled from MiniYAML)
    - `widgetDefinitions: Map<string, object>` -- widget ID -> parsed definition node
    - `loadWidget(args: WidgetArgs, parent: Widget | null, w: object): Widget` -- six-step instantiation:
      1. Look up `w.id` in `widgetDefinitions`
      2. Create instance via `ObjectCreator` (`ModData.objectCreator.createObject<Widget>(typeName)`)
      3. Inject properties via `FieldLoader` (TypeScript: `Object.assign()` + type guards)
      4. Call `initialize(args)` -- resolves `Bounds` expressions (`WINDOW_WIDTH`, `PARENT_WIDTH`, etc.)
      5. Recursively load children
      6. Call `postInit(args)` -- instantiates ChromeLogic
    - `loadUI(name: string, args: WidgetArgs): ContainerWidget` -- loads top-level UI by layout name (e.g., `"MAIN_MENU"`)
  - **Expression resolver** for `Bounds`:
    - Support variables: `WINDOW_WIDTH`, `WINDOW_HEIGHT`, `PARENT_WIDTH`, `PARENT_HEIGHT`
    - Support operators: `+`, `-`, `*`, `/`
    - Evaluate at `initialize()` time with runtime parent dimensions
    - Equivalent to OpenRA's `Evaluator.Evaluate()` in `Widget.Initialize()`
  - **Widget type registry**: Maps string type names to constructors (populated by mod's `ModRegistry`):
    ```typescript
    Map<string, Constructor<Widget>> = {
      'BUTTON': ButtonWidget,
      'LABEL': LabelWidget,
      'SCROLL_PANEL': ScrollPanelWidget,
      'TEXTFIELD': TextFieldWidget,
      // ... registered by mod code
    }
    ```

#### 3.4.4 ChromeProvider

- [ ] **TODO-5.D.4** `src/OpenRA.Game/Graphics/ChromeProvider.ts` (305 lines C#) -- UI skin resource manager:
  - `PanelRegion` data class: `[x, y, wTop, hTop, wCenter, hCenter, wBottom, hBottom]` (8 integers defining 9-slice)
  - `PanelSides` bitmask: `Left(1) | Top(2) | Right(4) | Bottom(8) | Center(16)`
  - `Collection` class:
    - `image: string` -- base image URL
    - `image2x: string` -- 2x DPI image URL
    - `image3x: string` -- 3x DPI image URL
    - `regions: Map<string, PanelRegion>` -- named 9-slice regions
  - `ChromeProvider` static class:
    - `collections: Map<string, Collection>` -- skin name -> Collection
    - `initialize(manifest: Manifest): void` -- loads chrome YAML files (now JSON), parses into Collections
    - `getImage(collection: string, image: string): string` -- resolves image path with DPI-aware selection
    - `getPanelRegion(collection: string, panel: string): PanelRegion` -- returns 9-slice parameters
  - **CSS integration**: `PanelRegion` drives CSS `border-image`:
    ```css
    .panel-{name} {
      border-image-source: url("{resolvedImage}");
      border-image-slice: {hTop} {wRight} {hBottom} {wLeft} fill;
      border-image-repeat: stretch;
    }
    ```
  - `Sprite` references from OpenRA are replaced with `background-image`/`border-image` CSS rules; no runtime sprite creation needed for chrome
  - HiDPI support via `image-set()`: `background-image: image-set(url(1x) 1x, url(2x) 2x, url(3x) 3x)`

**Acceptance Criteria**:
- `Widget` tree correctly manages parent/child hierarchy; `renderOuter()` produces nested DOM structure matching OpenRA draw order
- `Ui.openWindow()`/`closeWindow()` correctly manages modal stack with hide/show lifecycle hooks
- `WidgetLoader.loadUI("MAIN_MENU")` produces correct Widget tree from JSON layout definition
- `ChromeMetrics.get()` resolves values from JSON and falls back to CSS custom properties
- `ChromeProvider.getPanelRegion()` returns correct 9-slice parameters; generated CSS rules produce correct visual output in browser
- Widget event handling matches OpenRA capture semantics (last-added-child-first)
- `dispose()` on root widget removes all DOM nodes and cleans up event listeners

**Estimated Effort**:
| File | Est. impl lines | Est. test lines | Est. tests |
|:---|:---:|:---:|:---:|
| Widget.ts | 680 | 700 | 45 |
| ChromeMetrics.ts | 100 | 110 | 12 |
| WidgetLoader.ts | 280 | 320 | 22 |
| ChromeProvider.ts | 310 | 320 | 25 |
| **Total** | **~1,370** | **~1,450** | **~104** |

---

### 3.5 Phase E: World Interaction Bridge

**Status**: PENDING (0/1)
**Complexity**: HIGH
**Blocked by**: Phase C (needs ModData + World), Phase D (extends Widget)
**Blocks**: Nothing (leaf node -- this is the top of the UI chain)

**Description**: `WorldInteractionControllerWidget` is the critical bridge between the UI layer and the 3D game world. It handles unit selection (single click, double-click for same-type, drag-box), right-click command issuing (`ApplyOrders()`), and cursor switching. In the 3D environment, the 2D screen-space selection logic must be translated to raycasting and frustum culling, with the selection box preview rendered via `HighlightLayer` or semi-transparent overlays.

**Paradigm Shifts**:
- 2D `ScreenMap.ActorsInMouseBox()` spatial index query -> 3D raycasting (`scene.createPickingRay`) + frustum culling
- 2D selection box (`RgbaColorRenderer.DrawRect`) -> 3D frustum from corner rays + `HighlightLayer` for preview
- 2D `Viewport.ViewToWorldPx(int2)` -> `CoordinateTransformer.screenToWorld(x, y, camera, groundMesh)`
- C# `HandleMouseInput()` synchronous event routing -> `scene.onPointerObservable` + `POINTERDOWN/MOVE/UP` state machine
- OpenRA `ApplyOrders()` synchronous command -> event bus async dispatch (`eventBus.emit('order', order)`) with `event.preventDefault()` for right-click

#### 3.5.1 WorldInteractionControllerWidget

- [ ] **TODO-5.E.1** `src/OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget.ts` (235 lines C#) -- World interaction bridge:
  - Extends `Widget`
  - **Event capture**: Registers `scene.onPointerObservable` with `POINTERDOWN`, `POINTERMOVE`, `POINTERUP` callbacks
  - **State machine**:
    ```
    IDLE:
      POINTERDOWN (left) + no UI hit
        -> dragStart = worldPos, state = MAYBE_DRAG

    MAYBE_DRAG:
      POINTERMOVE + distance > DEADZONE
        -> state = DRAGGING, start drawing selection box
      POINTERUP (left) without moving
        -> state = CLICK, process single click selection

    DRAGGING:
      POINTERMOVE
        -> update selection box (world-space frustum from screen rect)
        -> highlight units within frustum (HighlightLayer, green)
      POINTERUP (left)
        -> finalize selection: units in frustum become selected (blue outline)
        -> state = IDLE

    POINTERUP (right):
      -> ApplyOrders(): issue command at world position
      -> event.preventDefault() (block browser context menu)
      -> state = IDLE (no state transition needed)
    ```
  - **Selection box to 3D frustum**:
    1. Record `dragStartScreen: {x, y}` and `currentScreen: {x, y}` in NDC
    2. Build four corner rays from screen rect: `scene.createPickingRay(ndcX, ndcY, camera)`
    3. Intersect each ray with `groundMesh` (terrain plane) to get world-space corners
    4. Build a frustum from the four world-space corners projected upward
    5. Test each selectable unit's `BoundingBox` against the frustum using `BABYLON.Frustum.GetPlanes()` + `boundingBox.isInFrustum(planes)`
  - **Single click selection**:
    1. Cast ray from click position: `scene.createPickingRay(pointerX, pointerY, camera)`
    2. Use `scene.multiPickWithRay(ray, predicate)` to get all hit meshes
    3. Filter to selectable units, find highest priority (closest to camera + selection priority)
    4. Apply modifier key logic (Ctrl = toggle, Shift = add to selection)
  - **Double-click selection**: select all units of same type on screen. Track last click time + position; if within 300ms and 5px radius, trigger `selectActorsByType()`.
  - **Right-click command dispatch**:
    1. Convert click position to world coordinate via `CoordinateTransformer.screenToWorld()`
    2. Determine target type: Actor (if hit unit), Terrain (if hit ground), Invalid (if nothing)
    3. Build `Order` object: `{ orderString, subject, target, targetCell, targetPosition }`
    4. Dispatch via event bus: `EventBus.emit('world-order', order)`
    5. The `World.OrderGenerator.Order()` chain processes it
  - **Cursor manager integration**:
    - `cursor: string` property updated by state machine
    - On hover over enemy: `"attack"` cursor; over friendly: `"select"`; over terrain: `"move"`
    - Cursor change applies via CSS on the HUD overlay element: `element.style.cursor = cursorName`
  - **ClickThrough mechanism**: Widgets with `ClickThrough = true` let pointer events pass through to the world. Implemented via CSS `pointer-events: none` on the Widget's DOM element.
  - **Dispose**: removes all `scene.onPointerObservable` callbacks; clears selection box preview; resets cursor

**Acceptance Criteria**:
- Single click on a unit selects it (visual feedback: outline/highlight applied)
- Double-click on a unit within 300ms selects all units of the same type on screen
- Drag-box selection correctly identifies all selectable units within the screen rectangle in 3D space
- Right-click on terrain issues a move command (event dispatched via event bus)
- Right-click on enemy unit issues an attack command
- Browser context menu is suppressed on right-click (`event.preventDefault()`)
- ClickThrough widgets do not block world interaction (pointer events pass through)
- Selection box preview renders during drag (green highlight)
- Selected units display blue outline/highlight after selection finalizes
- State machine correctly handles edge cases: drag below deadzone, rapid clicks, modifier keys

**Estimated Effort**:
| File | Est. impl lines | Est. test lines | Est. tests |
|:---|:---:|:---:|:---:|
| WorldInteractionControllerWidget.ts | 480 | 520 | 38 |
| **Total** | **~480** | **~520** | **~38** |

---

## 4. Dependency Graph

```
+---------------------------+
| Phase A: FileSystem       |  <-- FOUNDATION (no deps beyond Ch1-4)
| (4 files)                 |
+---------------------------+
        |
        v
+---------------------------+     +---------------------------+
| Phase B: C&C Packages     |     | Phase C: MOD System        |
| (5 files)                 |<--->| (2 files)                 |
| MixFile stub, BigFile,    |     | Manifest + ModData         |
| MegFile, Pak, PackageEntry|     | (depends on A; may run     |
| (depends on A interfaces) |     |  parallel with B)          |
+---------------------------+     +---------------------------+
                                              |
                                              v
                                    +---------------------------+
                                    | Phase D: UI Widget Core    |
                                    | (4 files)                 |
                                    | Widget, WidgetLoader,     |
                                    | ChromeMetrics, ChromeProvider|
                                    | (depends on C for FileSystem|
                                    |  + MiniYAML->JSON pipeline)|
                                    +---------------------------+
                                              |
                                              v
                                    +---------------------------+
                                    | Phase E: World Interaction |
                                    | (1 file)                  |
                                    | WorldInteractionController|
                                    | (depends on D for Widget, |
                                    |  C for World/ModData,     |
                                    |  CoordinateTransformer)   |
                                    +---------------------------+
```

**Phase parallelism**: Phase B and Phase C can be developed in parallel. Phase B needs Phase A's `IPackage`/`IPackageLoader` interfaces (stable at design time). Phase C needs Phase A's `FileSystem` class. Both can start after Phase A's interface definitions are finalized.

**Phase D block**: Must wait for Phase C (needs `ModData.objectCreator` for Widget instantiation, `FileSystem` for reading UI layout JSON). The MiniYAML-to-JSON pipeline (already done) must produce valid Chrome layout JSON for WidgetLoader to consume.

**Phase E block**: Must wait for Phase D (extends Widget base class) and Phase C/Chapters 3-4 (needs World, CoordinateTransformer, Scene). This is the final leaf node of Chapter 5.

### 4.2 Dependency on Prior Chapters

| Dependency | Chapter | Used By | Status |
|:---|:---:|:---|:---:|
| `Renderer.ts` (Engine + Canvas) | Ch2 | Phase D (UI overlay positioning) | COMPLETE |
| `WorldRenderer.ts` (Scene) | Ch2 | Phase E (raycasting, event observables) | COMPLETE |
| `World.ts` (GameWorldManager) | Ch3 | Phase E (Order dispatch, selection) | COMPLETE |
| `Actor.ts` (GameActor) | Ch3 | Phase E (selection, ISelectable trait) | COMPLETE |
| `Player.ts` | Ch3 | Phase E (ownership color) | COMPLETE |
| CoordinateTransformer | Ch4 | Phase E (screen-to-world coordinate transform) | COMPLETE |
| `IReadOnlyPackage.ts` stub | Ch4 | Phase A (full implementation replaces it) | STUB |
| `MapCache.ts` | Ch4 | Phase C (ModData uses it) | COMPLETE |
| MiniYAML-to-JSON pipeline | Ch4 | Phase C (mod.yaml), Phase D (UI layouts) | COMPLETE |
| `fflate` npm package | Ch4 | Phase A (ZipFile decompression) | ALREADY DEPENDENCY |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing (Vitest + happy-dom)

All phases are unit-testable. WebGL-dependent code (Phase E raycasting) must be mocked.

| Phase | Test Approach | Key Mock Targets |
|:---|:---|:---|
| A (FileSystem) | Pure logic tests + mock `fetch` for network I/O | `globalThis.fetch`, `fflate.unzipSync` |
| B (C&C Packages) | Binary fixture tests with reference `.mix`/`.big`/`.meg`/`.pak` files | `ArrayBuffer` from fixture files |
| C (MOD System) | JSON fixture tests with reference `mod.json` files | `FileSystem` mock |
| D (UI Widget) | DOM tests via happy-dom (no React rendering needed for logic) | `ObjectCreator`, `ChromeProvider` |
| E (Interaction) | State machine tests + mocked Babylon.js scene/picking | `scene.pickWithRay`, `scene.onPointerObservable`, `CoordinateTransformer` |

### 5.2 E2E Acceptance Testing (Playwright / Manual)

Per the project's acceptance test framework (`src/__e2e__/manual/`):

| Test Case | Phase | Description |
|:---|:---|:---|
| `file-system/zip-load` | A | Load a `.oramap` file via ZIP + verify file listing renders |
| `file-system/mount-override` | A | Mount two packages; verify later package's file is served |
| `cc-packages/bigfile-extract` | B | Load a `.big` file; verify extracted files match known hashes |
| `mod-system/load-mod` | C | Load a mod's `mod.json`; verify Manifest + ModData initialization |
| `ui-widget/widget-tree` | D | Render a Widget tree from JSON layout; verify DOM structure |
| `ui-widget/modal-stack` | D | Open/close modal dialogs; verify z-order and focus |
| `ui-widget/chrome-panel` | D | Verify 9-slice panel renders correctly at 1x/2x/3x DPI |
| `world-interaction/select-unit` | E | Click a unit in 3D scene; verify selection highlight |
| `world-interaction/drag-box` | E | Drag-select multiple units; verify selection box preview + result |
| `world-interaction/right-click-order` | E | Right-click on terrain; verify move order dispatched |

### 5.3 Performance Benchmarks

| Benchmark | Target | Phase |
|:---|:---:|:---:|
| VFS `openAsync()` cache hit | < 1ms (L1 memory) | A |
| VFS `openAsync()` cache miss | < 50ms (L4 fetch, 10KB file on localhost) | A |
| ZIP decompress (5MB .oramap) | < 500ms (Worker thread) | A |
| Widget tree render (100 nodes) | < 16ms (single frame) | D |
| Drag-box selection (200 units) | < 8ms (frustum test) | E |
| Memory: FileSystem after loading 10 mods | < 150MB (with L1 LRU enforcement) | A |

---

## 6. Risk and Considerations

### 6.1 Technical Risks

| Risk | Severity | Mitigation |
|:---|:---:|:---|
| **fflate ZIP decompression of large .oramap files blocks main thread** | HIGH | Use `fflate.unzip()` in Web Worker for files > 5MB. Implement progress callback for loading screen. |
| **MIX Blowfish decryption in JS is prohibitively slow** | HIGH | ADR-5.1: Build-time unpacking only. Browser never touches MIX format. |
| **DOM event handling order differs from OpenRA Widget tree** | MEDIUM | Implement reverse-order capture via React event delegation; `stopPropagation()` at each Widget boundary. |
| **Raycasting for unit selection is slower than 2D spatial index** | MEDIUM | Use `GPUPicker` (Babylon.js v8+) for large-scale pick scenarios. Fall back to CPU raycasting for < 200 units. |
| **Browser auto-play policy blocks audio context** | LOW | Deferred to Chapter 8 (Audio). Not in scope for Chapter 5. |
| **IndexedDB corruption on large asset stores** | LOW | Checksum verification on L2 entries; auto-re-fetch from L4 on mismatch. |

### 6.2 Migration Order Risks

| Risk | Impact | Mitigation |
|:---|:---:|:---|
| Phase A `FileSystem.ts` design changes cascade to Phase B loaders | All Phase B loader signatures must change | Finalize `IPackageLoader` interface during Phase A review; freeze before Phase B starts |
| Phase C `ModData` needs WidgetLoader reference but WidgetLoader is Phase D | Circular dependency | `ModData.widgetLoader` is nullable; set via setter after Phase D WidgetLoader is created |
| Phase E `WorldInteractionControllerWidget` needs Scene + World + Camera | Integration complexity | Accept that Phase E is heavily dependent; mock Scene + World in unit tests; E2E test for real integration |
| Existing `MapCache.ts` uses `IReadOnlyPackage` stub import | Import path changes after Phase A | Update imports in `MapCache.ts` and `MapDirectoryTracker.ts` as part of TODO-5.A.1 |

### 6.3 Dependency on External Libraries

| Library | Version | Purpose | Phase |
|:---|:---:|:---|:---:|
| `fflate` | ^0.8.x (already installed, Ch4) | ZIP decompression | A |
| `localforage` | ^1.10.x (new) | IndexedDB wrapper for L2 cache | A |
| `@babylonjs/core` | ^9.10.x (already installed) | 3D engine, GUI, picking | E |
| React/Vue | TBD (decision pending) | Optional: DOM rendering layer | D |

> **Note on React/Vue**: Phase D Widgets implement their own DOM rendering via `render(): HTMLElement`. A React wrapper layer is optional and can be added in a subsequent chapter. The core Widget tree must function standalone (vanilla TypeScript + DOM) to minimize dependency risk.

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-5.1: MIX Files -- Build-Time Unpacking (No Browser Runtime)

**Context**: OpenRA uses Westwood MIX archives for C&C game assets. MIX headers use 32-bit rolling hashes instead of filenames and optionally apply Blowfish encryption (key stored in RSA-encrypted form). Implementing Blowfish + RSA in JavaScript adds significant complexity and ~300KB of library overhead.

**Decision**: MIX files are unpacked at build time (Node.js) into standard ZIP archives or plain directories. The browser-side `MixFile.ts` is a documentation stub: it contains the full format specification in JSDoc but `tryParsePackage()` always returns `null`, directing the caller to build-time tooling.

**Alternatives Considered**:
- **Full JS Blowfish + RSA implementation** (rejected): Bloats bundle, slow runtime performance, security concerns with shipping crypto primitives that could trigger platform policy issues.
- **WASM Blowfish via Rust/emscripten** (rejected): Smaller bundle than pure JS but adds WASM toolchain complexity. Again, unnecessary runtime overhead for a build-time concern.
- **Server-side MIX unpacking on first request** (rejected): Adds server infrastructure dependency; no real advantage over build-time.

**Consequences**: Build pipeline must include a MIX unpacker. The `MixFile.ts` stub serves as reference documentation for build-tool authors. Blowfish/RSA code is not shipped to the browser.

### ADR-5.2: Pure TypeScript Widget Tree (Not React-First)

**Context**: The Widget system could be implemented directly in React/Vue (each Widget = a React component) or as a pure TypeScript class tree with an optional React wrapping layer.

**Decision**: Widgets are pure TypeScript classes with `render(): HTMLElement` methods. A React bridge layer wraps Widget lifecycle into React components but is optional. The Widget tree functions standalone.

**Alternatives Considered**:
- **React-first** (rejected for core): Ties Widget semantics to React's lifecycle, making it harder to reason about OpenRA's exact `Initialize()` -> `PostInit()` sequence. React's reconciliation could interfere with OpenRA's explicit child management.
- **Pure TypeScript** (chosen): Exact OpenRA semantics preserved. Tests can verify Widget tree behavior without React. React layer can be added later as a rendering optimization without changing Widget interfaces.

**Consequences**: Each Widget subclass must implement `render(): HTMLElement`. DOM manipulation is manual. React bridge must carefully synchronize Widget lifecycle with React's render cycle. Debugging is explicit (no virtual DOM diffing to reason about).

### ADR-5.3: Event Bus for UI-to-World Communication

**Context**: In OpenRA, `WorldInteractionControllerWidget` directly calls `world.OrderGenerator.Order()` and `world.IssueOrder()`. In the Web architecture, direct coupling between UI DOM handlers and game state creates tight coupling that hurts testability.

**Decision**: All UI-to-World communication goes through a typed `EventBus`. The Widget layer emits events (`'world-order'`, `'select-unit'`, etc.) and the World layer subscribes. No Widget directly holds a reference to `World` or calls its methods.

**Alternatives Considered**:
- **Direct coupling** (rejected): Makes Widgets untestable without a full World mock. Breaks the architecture doc's recommendation to keep UI and game logic separate.
- **Dependency injection via WidgetArgs** (partial): Kept for general context (manifest, modData, chromeMetrics). But game-state-mutating operations MUST go through the event bus.

**Consequences**: System behavior is observable via event log. Debugging requires event bus tracing. Additional indirection adds minor latency (< 0.1ms per event dispatch). Enables clean separation for future networked multiplayer and replay systems.

### ADR-5.4: Four-Level Asset Cache

**Context**: Browser environments cannot directly access the local filesystem. Repeated `fetch()` calls for game assets add network latency. Game assets total ~200-500MB for a typical mod installation.

**Decision**: Implement a four-level cache hierarchy with automatic promotion:

| Level | Storage | Capacity | Eviction | Purpose |
|:---:|:---|:---:|:---|:---|
| L1 | In-memory `Map` | 100MB | LRU | Hot assets accessed every frame |
| L2 | IndexedDB (`localforage`) | 500MB | LRU + age | Cached across sessions; large files |
| L3 | Cache API (automatic) | Browser-managed | HTTP headers | Transparent HTTP caching |
| L4 | Remote CDN | Unlimited | N/A | Origin server |

**Consequences**: First-load latency for a full mod is ~5-15 seconds (depends on network). Subsequent loads hit L2/L3 and are near-instant. Memory pressure must be monitored on low-memory devices. L1 eviction callback must dispose associated WebGL textures (GPU memory is separate from JS heap).

### ADR-5.5: `IPackageLoader` Registration Pattern

**Context**: OpenRA discovers package loaders via assembly scanning. In TypeScript, this must be done via explicit registration at import time.

**Decision**: Package loaders register themselves by importing and calling `FileSystem.registerLoader()`:
```typescript
// src/OpenRA.Game/FileSystem/ZipFile.ts
import { FileSystem } from './FileSystem'
FileSystem.registerLoader(new ZipFileLoader())
```
This replaces OpenRA's `ModData.PackageLoaders` assembly-scanned array.

**Consequences**: Loader registration is explicit and auditable. Order of import determines registration order (matters for format detection priority). Circular imports avoided by keeping loader classes separate from FileSystem class. Tree-shaking: unused loaders are removed by bundler.

---

## Phase Strategy Summary

| Phase | Files | Complexity | Est. Lines (impl+test) | Est. Tests | Depends On |
|-------|:---:|:---|:---:|:---:|-----------|
| A: FileSystem Foundation | 4 | Low-Medium | ~2,150 | ~91 | Nothing |
| B: C&C Package Formats | 5 | Low-HIGH | ~1,810 | ~79 | Phase A |
| C: MOD System Core | 2 | Low-Medium | ~1,170 | ~52 | Phase A |
| D: UI Widget Core | 4 | Low-Medium | ~2,820 | ~104 | Phase C |
| E: World Interaction | 1 | HIGH | ~1,000 | ~38 | Phases C, D |
| **Total** | **16** | | **~8,950** | **~364** | |

**Total estimated**: ~8,950 lines of implementation + test code. 5-7 developer-weeks (single developer) or 3-4 weeks (2 developers working in parallel on Phases B+C after Phase A completes).
