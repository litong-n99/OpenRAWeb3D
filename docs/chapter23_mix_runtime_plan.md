# OpenRA to Babylon.js Migration Plan: Chapter 23 -- MIX File Format Runtime Support

> **Source Reference**: `OpenRA.Mods.Cnc/FileSystem/MixFile.cs` (OpenRA MIX parser)
> **Chapter Status**: PLANNING (0/8 migrated)
> **Planning Date**: 2026-06-20
> **Prerequisite**: Chapters 2-22 COMPLETE (719+ files, 100%)

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Westwood Classic Format Parsing](#31-phase-a-westwood-classic-format-parsing)
   - 3.2 [Phase B: Filename Resolution Database](#32-phase-b-filename-resolution-database)
   - 3.3 [Phase C: Integration and Edge Cases](#33-phase-c-integration-and-edge-cases)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Problem Statement

After completing the Content Installer pipeline, all `.mix` files downloaded from the OpenRA CDN (e.g. `scores.mix`, `allies.mix`, `conquer.mix`) pass through the `PackageExtractor` as raw bytes. Individual sprites, sounds, and terrain data inside these archives are inaccessible at runtime.

**Root cause**: The CDN MIX files have `firstUint16=0x0000` (not C&C format) and `secondUint16=0x0000`, `0x0001`, `0x0002`, or `0x0003`. Our current `MixFileRuntime` only handles two formats:

1. **C&C format** (`isCncFormat`): `firstUint16 >= 1` -- unencrypted, header at offset 0
2. **Encrypted RA/TS/RA2 format** (`isEncryptedFormat`): `firstUint16 == 0` AND encryption bit set in the flags word

The CDN files with `firstUint16=0, secondUint16=0` (no encryption flag) fall through both checks and are treated as unrecognized. Additionally, a subtle bug in `isEncryptedFormat()` reads the entire 4-byte uint32 at offset 0 and checks bit 1 of that, which checks bit 1 of the *first* uint16 (always 0 when firstUint16=0), rather than the *second* uint16 as OpenRA does.

**The missing format is the unencrypted Westwood RA/TS/RA2 format**: `firstUint16=0`, second uint16 does NOT have bit 1 set (encryption flag). These files have the header at offset 4 with plain (unencrypted) numFiles + dataSize + PackageEntry records.

### 1.2 Core Paradigm Shift

- **C# `Stream.ReadUInt16()` sequential reads** -> TypeScript `DataView.getUint16()` with explicit offsets. The bug in `isEncryptedFormat` arises from reading a `getUint32(0, true)` and checking bit 1 of the combined value instead of checking bit 1 of the uint16 at offset 2 separately.
- **C# three-format detection chain** (C&C, encrypted RA, unencrypted RA) -> TypeScript three-format detection with corrected bit testing
- **C# `ParseHeader(s, 4, out dataStart)` for unencrypted RA** -> TypeScript `parseWestwoodClassic()` with header offset 4
- **C# `ParseIndex` with local/global mix databases** -> TypeScript `buildMixDb()` extracting filenames from `local mix database.dat` and `global mix database.dat` entries within the MIX itself

### 1.3 Architecture Principles

1. **Format detection must match OpenRA exactly**: The three-way detection chain (C&C, encrypted, unencrypted Westwood) follows the same order as `MixFile.MixFile(Stream, string, string[])` constructor. No creative reinterpretation.

2. **Bit testing already matches C#**: `isEncryptedFormat` reads `getUint32(0, true)` checking bit 1 — matching C#'s `(s.ReadUInt32() & 0x2) != 0` exactly. However, for CDN files with `firstUint16=0, secondUint16=0x0002` the uint32=0x00020000 → `(0x00020000 & 0x2) = 0` → NOT encrypted (same result as C#). These files are NOT encrypted — the real task is determining what format they ARE (possibly pre-extracted data or an unknown variant).

3. **Filename resolution reuses existing `PackageEntry.hashFilename()`**: Both Classic and CRC32 hash types already exist in `PackageEntry.ts`. The resolution database is built by iterating MIX entries, finding the `"local mix database.dat"` or `"global mix database.dat"` entry by hash, extracting it, and parsing it as a newline-delimited filename list.

4. **Backward compatibility**: All existing `MixFileRuntime.parse()`, `parseEncrypted()`, and `isCncFormat()` APIs continue to work. The new format is added as an additional path in the detection chain and `_extractSubPackage`.

5. **No new npm dependencies**: The Westwood classic format uses existing `DataView` / `ArrayBuffer` primitives. Filename resolution uses existing `PackageEntry.HashFilename()`. No new packages.

### 1.4 Completed Foundation

The following infrastructure is available for Chapter 23:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| PackageEntry | Ch5 Phase B | `PackageEntry`, `PackageHashType.Classic`, `PackageHashType.CRC32`, `hashFilename()` |
| MixFileRuntime | Ch5 Phase B + Phase C | C&C parse, encrypted parse (universal + RSA key), RSA decryption, Blowfish |
| MixLoader + MixFile | Ch5 Phase B | `IPackageLoader`, `tryParsePackage()`, `setMixDb()`, format doc reference |
| PackageExtractor | Ch22 Content Installer | `_extractSubPackage()`, `mixDb` passthrough |
| ContentInstallerService | Ch22 | Content download + extraction orchestration |
| FileSystem | Ch5 Phase A | `mountPackage()`, `tryOpen()`, `openAsync()` |
| IReadOnlyPackage | Ch5 Phase A | `contents`, `contains()`, `open()`, `dispose()` |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (8 operations across 3 Phases)

| # | OpenRA Source | Target File(s) | Operation | Est. LOC | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Westwood Classic Format Parsing** | | | | | |
| 1 | `MixFile.cs:35-65` (constructor format chain) | `MixFileRuntime.ts` | Fix `isEncryptedFormat` bit test bug | ~10 | LOW | A |
| 2 | `MixFile.cs:42-43` (not C&C, not encrypted) | `MixFileRuntime.ts` | Add `isWestwoodClassicFormat()` detector | ~30 | LOW | A |
| 3 | `MixFile.cs:53-54,114-126` (ParseHeader) | `MixFileRuntime.ts` | Add `parseWestwoodClassic()` static method | ~100 | MEDIUM | A |
| 4 | `MixFile.cs:35-65` (full constructor) | `MixFileRuntime.ts` | Update `parse()` and `parseEncrypted()` flow | ~30 | LOW | A |
| **Phase B: Filename Resolution Database** | | | | | |
| 5 | `MixFile.cs:67-112` (ParseIndex) | `MixFileRuntime.ts` | Add `buildMixDbFromEntries()` for local/global db | ~120 | MEDIUM | B |
| 6 | `MixFile.cs:229-246` (MixLoader) | `MixLoader.ts` (MixFile.ts) | Update `tryParsePackage()` for 3-way chain | ~30 | LOW | B |
| **Phase C: Integration and Edge Cases** | | | | | |
| 7 | -- | `PackageExtractor.ts` | Wire new format into `_extractSubPackage` | ~30 | LOW | C |
| 8 | -- | `MixFileRuntime.test.ts` | Tests for Westwood classic + db resolution + bug fix | ~500 | MEDIUM | C |

> **Complexity Legend**:
> - **LOW**: Simple detection change, wire-up, or small refactor. 10-50 estimated TS lines.
> - **MEDIUM**: New parsing logic, hash database construction, or comprehensive test suite. 100-500 estimated TS lines.
> - **HIGH**: Significant cross-file integration or complex cryptographic logic. Not used in Ch23.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total operations** | 8 (5 file modifications + 1 bugfix + 1 new feature + 1 test expansion) |
| **Phase A (Format Parsing)** | 4 operations |
| **Phase B (Filename Resolution)** | 2 operations |
| **Phase C (Integration + Tests)** | 2 operations |
| **New files to create** | 0 |
| **Files to modify** | 3 (`MixFileRuntime.ts`, `MixFile.ts`/`MixLoader`, `PackageExtractor.ts`) |
| **Test expansion** | 1 file (`MixFileRuntime.test.ts`, +~500 lines) |
| **Estimated total new/modified lines** | ~850 (370 impl + 500 test) |

| Phase | Operations | Impl Lines | Test Lines | Status |
|:---|:---:|:---:|:---:|:---|
| A: Format Parsing | 4 | ~170 | -- | PLANNING |
| B: Filename Resolution | 2 | ~150 | -- | PLANNING |
| C: Integration + Tests | 2 | ~50 | ~500 | PLANNING |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Westwood Classic Format Parsing

**Status**: PLANNING
**Complexity**: LOW-MEDIUM (bitfix LOW, parser MEDIUM)
**Blocked by**: Nothing (all dependencies are migrated)
**Blocks**: Phase B (filename resolution needs working parser), Ch24 (C&C effects need assets from MIX files)

**Description**: Fixes the format detection bug in `isEncryptedFormat()` and adds support for the unencrypted Westwood RA/TS/RA2 format. This is the primary blocker for CDN MIX files -- once this format is parsed, all sprite/sound/terrain data in CDN `.mix` files becomes accessible.

**Paradigm Shifts**:
- C# `s.ReadUInt16()` sequential stateful reads -> explicit `DataView.getUint16(offset, true)` with fixed offsets
- C# `flags & 0x2` on second uint16 -> `getUint16(2, true) & 0x2` on bytes 2-3
- C# `ParseHeader(s, 4, out dataStart)` -> `_parseWestwoodHeader(data)` with offset 4

#### 3.1.1 Fix `isEncryptedFormat` Bit Test Bug

- [ ] **TODO-23.A.1** `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` (est. 10 lines) -- Fix the encrypted flag detection:
  - **Current bug**: `isEncryptedFormat()` reads `dv.getUint32(0, true)` and checks `flags & 0x2`. For a file with bytes `[0x00, 0x00, 0x03, 0x00]` at offset 0, the uint32 LE value is `0x00000300`. Bit 1 (`0x2`) of this value is `0` -- **incorrectly returns false** when the real encrypted flag at offset 2 is `0x0003` (bit 1 set).
  - **Fix**: Read `dv.getUint16(2, true)` separately and test `(secondUint16 & OPENRA_ENCRYPTED_FLAG) !== 0`.
  - This matches OpenRA's: `s.ReadUInt16()` (consumes first uint16), then `(s.ReadUInt16() & 0x2) != 0` (tests second uint16).
  - **Impact**: Files with `secondUint16=3` were silently treated as unrecognized. After the fix, they will correctly be detected as encrypted and routed to `parseEncrypted()`.
  - **Important follow-up**: Some CDN files with `secondUint16=3` may NOT actually be encrypted (the bit may be set for other reasons). If `parseEncrypted()` fails (RSA keyblock is not valid encrypted data), the parser must fall through to try unencrypted parsing. This is handled in 23.A.3.

#### 3.1.2 Add `isWestwoodClassicFormat` Detection

- [ ] **TODO-23.A.2** `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` (est. 30 lines) -- Add unencrypted Westwood RA format detector:
  - **Format**: `firstUint16 == 0 && (secondUint16 & 0x2) == 0`
  - Static method: `static isWestwoodClassicFormat(data: ArrayBuffer): boolean`
  - Validation: minimum 10 bytes (4 for header prefix + 6 for at least zero entries)
  - The `secondUint16 & 0x1` bit (hasChecksum) is informational for this format -- it indicates a checksum table follows the entries but does not affect header parsing
  - OpenRA reference: `MixFile.cs` constructor path for `!isCncMix && !isEncrypted`

#### 3.1.3 Add `parseWestwoodClassic` Parser

- [ ] **TODO-23.A.3** `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` (est. 100 lines) -- Parse unencrypted Westwood RA format:
  - Static method: `static parseWestwoodClassic(name: string, data: ArrayBuffer, mixDb?: Map<string, string>): MixFileRuntime`
  - **Binary format** (header at offset 4):
    ```
    Offset  Size    Field
    0       2       flags (uint16 LE) — bit 0: hasChecksum, bit 1: encrypted (must be 0)
    2       2       numFiles (uint16 LE) — number of entries
    4       4       dataSize (uint32 LE) — total size of data blocks
    8       12×N     PackageEntry[] entries (12 bytes each, unencrypted)
    8+12×N   ...     Raw data blocks
    ```
  - Parse steps:
    1. Read numFiles at offset 2: `dv.getUint16(2, true)`
    2. Read dataSize at offset 4: `dv.getUint32(4, true)` (informational)
    3. Parse N PackageEntry records starting at offset 8
    4. `dataStart = 8 + numFiles * 12`
    5. Build entry map via `_buildEntryMap()`
  - Validate numFiles in range [0, 65535]. Zero files is valid (empty MIX).
  - **Encrypted fallthrough**: When `parseEncrypted()` is attempted on a file with `secondUint16=3` (bit 1 set) and fails due to invalid RSA keyblock data, the caller should try `parseWestwoodClassic()` as a fallback. Some CDN files may have the encrypted flag set spuriously.
  - Unit tests: parse with 0 files, parse with N files, parse with truncated data, validate data offsets

#### 3.1.4 Update `parse()` and `parseEncrypted()` Flow

- [ ] **TODO-23.A.4** `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` (est. 30 lines) -- Update static factory method routing:
  - Add a new static method `parseAuto(name, data, mixDb?)` that implements the full 3-way detection chain:
    1. `isCncFormat(data)` -> `parse(name, data, mixDb)` (existing C&C path)
    2. `isEncryptedFormat(data)` -> try `parseEncrypted(name, data, undefined, mixDb)`. If it throws, fall through to step 3.
    3. `isWestwoodClassicFormat(data)` -> `parseWestwoodClassic(name, data, mixDb)`
    4. None match -> throw descriptive Error with diagnostic hex dump of first 8 bytes
  - Keep existing `parse()` and `parseEncrypted()` methods unchanged for backward compatibility.
  - This centralized method is the recommended entry point for new callers.

**Phase A Summary**: 4 operations, ~170 lines TS. After Phase A, all CDN MIX file formats (C&C, encrypted RA/TS, unencrypted Westwood) are parseable at runtime.

---

### 3.2 Phase B: Filename Resolution Database

**Status**: PLANNING
**Complexity**: MEDIUM
**Blocked by**: Phase A (format parsing must work first)
**Blocks**: All asset loading from MIX files (sprites, sounds, terrain)

**Description**: MIX files store only filename hashes (Classic or CRC32), not actual filenames. To resolve hashes to filenames, we need a hash database. OpenRA builds this database from two sources: a `"local mix database.dat"` entry inside each MIX file, and a `"global mix database.dat"` loaded from the filesystem. Phase B implements this database construction at runtime.

**Paradigm Shifts**:
- C# `XccLocalDatabase` / `XccGlobalDatabase` text file parsing -> TypeScript `TextDecoder` + newline split
- C# `ParseIndex` dual-hash matching (Classic vs CRC32, pick best) -> TypeScript dual-hash matching with same selection logic
- C# `globalFilenames` pre-loaded from `MixLoader` -> TypeScript `mixDb` Map passed via `MixLoader.setMixDb()` or built at parse time

#### 3.2.1 Build Mix Database from MIX Internal Entry

- [ ] **TODO-23.B.1** `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` (est. 120 lines) -- Construct filename resolution database:
  - New static method: `static buildMixDb(data: ArrayBuffer, entries: Map<string, MixFileEntry>, openFn: (name: string) => ArrayBuffer | null): Map<string, string>`
  - **Step 1**: Search parsed entries for the `"local mix database.dat"` hash:
    - Compute Classic hash: `PackageEntry.hashFilename('local mix database.dat', PackageHashType.Classic)`
    - Compute CRC32 hash: `PackageEntry.hashFilename('local mix database.dat', PackageHashType.CRC32)`
    - Iterate entries looking for either hash. If found, extract the data via `openFn()`.
  - **Step 2**: If local database found, decode as UTF-8 text (newline-delimited filenames). Each non-empty, non-comment line is a filename. Add all to a `Set<string>`.
  - **Step 3**: Merge with externally-provided `mixDb` (global database). External entries take priority for deduplication.
  - **Step 4**: For each unique filename, compute Classic hash and CRC32 hash. If the hash matches an entry in the MIX, add `hexKey -> filename` to the result map.
  - **Step 5**: If CRC32 matches more entries than Classic, use CRC32-hash map. If Classic matches more, use Classic. Tie goes to Classic.
  - **Step 6**: Log the number of *unresolved* hashes (entries without matching filenames). These become `"unresolved_0xHHHHHHHH.bin"` placeholders.
  - The result `Map<string, string>` uses the same hex-key format as the existing `mixDb` parameter: `"0x1234ABCD"` (uppercase, 8-digit zero-padded).
  - Unit tests: local db with 10 filenames resolves matching entries; empty db produces all unresolved; CRC32 preferred over Classic when it matches more

#### 3.2.2 Update MixLoader `tryParsePackage` for Integrated DB

- [ ] **TODO-23.B.2** `src/OpenRA.Mods.Cnc/FileSystem/MixFile.ts` (est. 30 lines) -- Update `MixLoader.tryParsePackage()`:
  - Replace the two-stage check (C&C then encrypted) with the new 3-way `parseAuto()` call.
  - After successful parse, call `buildMixDb(data, entriesMap, openFn)` to enrich the mix database.
  - Store the enriched database back via `MixLoader.setMixDb()` so subsequent MIX parses benefit from the expanded database.
  - On fallthrough (unrecognized format), still log the diagnostic info but additionally suggest manual extraction for formats we can't handle.
  - OpenRA reference: `MixLoader.TryParsePackage()` -- constructs `MixFile` which internally calls `ParseIndex`

**Phase B Summary**: 2 operations, ~150 lines TS. After Phase B, MIX files resolve human-readable filenames (e.g., `e1.shp`, `fireblst.aud`) from their hash values.

---

### 3.3 Phase C: Integration and Edge Cases

**Status**: PLANNING
**Complexity**: LOW-MEDIUM
**Blocked by**: Phase A (format parsing), Phase B (filename resolution)
**Blocks**: Nothing (endpoint phase for MIX runtime support)

**Description**: Wires the new Westwood classic format and filename resolution into the `PackageExtractor` extraction pipeline and the `FileSystem` runtime mount chains. Expands the test suite to cover all three MIX formats with real-world CDN file structures.

#### 3.3.1 Wire into PackageExtractor

- [ ] **TODO-23.C.1** `src/OpenRA.Game/ContentInstaller/PackageExtractor.ts` (est. 30 lines) -- Update `_extractSubPackage()` for the new format:
  - In the `format === 'mix'` branch, after the existing `isEncryptedFormat` + `isCncFormat` checks:
  - Add a third check: `MixFileRuntime.isWestwoodClassicFormat(data)` -> `MixFileRuntime.parseWestwoodClassic(destPath, data, mixDb)`
  - **Encrypted fallthrough**: If `isEncryptedFormat` returns true but `parseEncrypted` throws (RSA keyblock invalid), fall through to try `parseWestwoodClassic`. This handles CDN files where the encryption flag bit is set spuriously.
  - Log a warning on fallthrough for diagnostic purposes (helps identify format edge cases).
  - This is the primary integration point -- after this change, the Content Installer pipeline extracts individual files from CDN MIX archives.

#### 3.3.2 Expand Test Suite

- [ ] **TODO-23.C.2** `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.test.ts` (est. 500 lines) -- Comprehensive Westwood classic format tests:
  - **Format detection tests**:
    - `isEncryptedFormat` correctly detects secondUint16 bit 1 (the fixed bug)
    - `isEncryptedFormat` correctly returns false for secondUint16=0, secondUint16=1
    - `isWestwoodClassicFormat` returns true for firstUint16=0, secondUint16=0
    - `isWestwoodClassicFormat` returns true for firstUint16=0, secondUint16=1 (hasChecksum, no encryption)
    - `isWestwoodClassicFormat` returns false for firstUint16=0, secondUint16=2 (encrypted)
    - `isWestwoodClassicFormat` returns false for too-small buffers
  - **Parsing tests**:
    - Parse Westwood classic with 0 entries -> empty contents
    - Parse Westwood classic with 5 entries -> 5 files with correct sizes
    - Parse Westwood classic with 100 entries -> all offsets correctly computed
    - Parse Westwood classic with data extending beyond buffer -> open() clamps correctly
    - Parse Westwood classic from a buffer that matches a real CDN `.mix` file structure
  - **Database resolution tests**:
    - `buildMixDb` with local database of 20 filenames resolves all 20 entries
    - `buildMixDb` with empty local database returns empty resolution map
    - CRC32 preferred over Classic when CRC32 matches more entries
    - Classic used when CRC32 matches fewer (or equal) entries
    - Duplicate filenames (after resolution) overwrite: last entry wins
  - **Integration tests**:
    - `parseAuto()` routes Westwood classic correctly
    - `parseAuto()` routes C&C correctly
    - `parseAuto()` routes encrypted correctly (mock Blowfish/RSA for test)
    - `parseAuto()` throws on unrecognized format
    - Encrypted fallthrough: when `parseEncrypted` throws, `parseWestwoodClassic` is tried
  - **PackageExtractor tests** (in `PackageExtractor.test.ts`):
    - MIX sub-archive with Westwood classic format extracts inner files
    - MIX sub-archive with failed encrypted parse falls through to Westwood classic
    - Inner file keys include both dest path and inner filename

**Phase C Summary**: 2 operations, ~50 impl lines + ~500 test lines. After Phase C, all CDN MIX files are fully extractable with resolved filenames, tested, and integrated.

---

## 4. Dependency Graph

```
Chapters 2-22 (ALL COMPLETE)
  |
  v
Phase A (Westwood Classic Format: 4 operations)
  |
  +-- 23.A.1 (Fix isEncryptedFormat bit test) -- independent, ~10 lines
  +-- 23.A.2 (isWestwoodClassicFormat detector) -- independent (but validates after A.1 fix)
  +-- 23.A.3 (parseWestwoodClassic parser) -- depends on A.2 being defined
  +-- 23.A.4 (parseAuto routing) -- depends on A.1, A.2, A.3
  |
  v
Phase B (Filename Resolution: 2 operations)
  |
  +-- 23.B.1 (buildMixDb) -- depends on A.3 (needs parsed entries to search)
  +-- 23.B.2 (MixLoader integration) -- depends on A.4, B.1
  |
  v
Phase C (Integration + Tests: 2 operations)
  |
  +-- 23.C.1 (PackageExtractor wire-up) -- depends on A.4, B.2
  +-- 23.C.2 (Test suite expansion) -- can start in parallel once A.3 is code-complete
```

### Critical Path

```
23.A.1 (bugfix) -> 23.A.2 (detector) -> 23.A.3 (parser) -> 23.A.4 (routing)
  -> 23.B.1 (mixDb) -> 23.B.2 (MixLoader) -> 23.C.1 (PackageExtractor) -> DONE
```

### Parallelization Opportunities

- 23.A.1, 23.A.2, and 23.A.4 can be developed in parallel (they're separate sections of `MixFileRuntime.ts`)
- 23.C.2 (test suite) can begin as soon as 23.A.3 is code-complete, before B and C integration
- 23.B.2 and 23.C.1 are sequential but small (~30 lines each)

### Key Blocking Relationships

| Dependency | Constraint |
|:---|:---|
| 23.A.1 (encrypted format bugfix) | Must be done first -- incorrect detection affects A.2 validation |
| 23.A.3 (parseWestwoodClassic) | Required for 23.B.1 (buildMixDb needs parsed entries) |
| 23.A.4 (parseAuto) | Required for 23.B.2 (MixLoader integration) and 23.C.1 (PackageExtractor) |
| 23.B.1 (buildMixDb) | Required for 23.B.2 (MixLoader enriches and stores the database) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

- [ ] **TEST-23.1** Bugfix verification: `isEncryptedFormat` returns true for secondUint16=2 and secondUint16=3; returns false for secondUint16=0 and secondUint16=1
- [ ] **TEST-23.2** Westwood classic detection: correct positive/negative for all secondUint16 values (0, 1, 2, 3)
- [ ] **TEST-23.3** Westwood classic parsing: 0 entries, N entries, max entries; data offset computation; edge truncation
- [ ] **TEST-23.4** `parseAuto` routing: each format correctly routed; unrecognized format throws
- [ ] **TEST-23.5** `buildMixDb`: local database resolution, CRC32 vs Classic preference, empty database handling
- [ ] **TEST-23.6** Encrypted fallthrough: when `parseEncrypted` throws on spuriously-flagged file, `parseWestwoodClassic` succeeds
- [ ] **TEST-23.7** End-to-end: real CDN MIX file (from test fixtures) -> `parseAuto` -> extract inner files with resolved names

### 5.2 Test File Estimates

| Phase | New Test Files | Estimated New Tests | Estimated Test Lines |
|:---|:---:|:---:|:---:|
| A: Format Parsing | 0 (expand existing) | ~15 | ~200 |
| B: Filename Resolution | 0 (expand existing) | ~10 | ~150 |
| C: Integration + Tests | 0 (expand existing) | ~10 | ~150 |
| **Total** | **0** | **~35** | **~500** |

All tests expand `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.test.ts` (existing, ~900 lines) and `src/OpenRA.Game/ContentInstaller/PackageExtractor.test.ts` (existing).

### 5.3 Visual Acceptance Testing

Not applicable for Chapter 23 (purely data format work). Verified through unit tests and content installation end-to-end.

### 5.4 Integration Testing

- [ ] **TEST-23.I1** Content Installer flow: download a real CDN package -> extract -> verify inner `.shp`, `.aud`, `.tem` files are individually accessible
- [ ] **TEST-23.I2** MixLoader + FileSystem: mount a `.mix` file in the virtual filesystem -> `filesystem.open("scores/fireblst.aud")` returns correct audio data
- [ ] **TEST-23.I3** buildMixDb cross-pollination: parse `allies.mix` (which has a local mix database) -> the database enriches subsequent `conquer.mix` parse

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Encrypted fallthrough false positives**: Files with `secondUint16=3` that are actually encrypted (not spuriously flagged) could have their header data incorrectly parsed as unencrypted, producing garbage entries | MEDIUM | Corrupt inner files extracted from that MIX | Only fall through on `parseEncrypted` exception, not on detection. Validate `numFiles` is in reasonable range [0, 65535] after Westwood classic parse; reject if obviously wrong. |
| **Hash collision in filename resolution**: Classic and CRC32 hashes are both 32-bit, collisions possible | LOW | Wrong filename assigned to an entry, loading wrong asset | Log all duplicate hash matches. Prefer CRC32 (better distribution). The OpenRA approach of picking the hash type with MORE matches naturally mitigates this. |
| **Large MIX files exceeding browser memory**: Some MIX files can be 100MB+ | LOW | Browser tab crashes on parse | MIX files are already loaded into memory as ArrayBuffer by the time they reach the parser. The parsing itself is lightweight (only metadata, not data blocks). Data blocks are lazily sliced via `open()`. |
| **local mix database.dat not present**: Some MIX files don't contain a local database | MEDIUM | All entries remain `unresolved_0xHHHHHHHH.bin` -- assets loadable but not by human-readable name | The global mix database (`global mix database.dat` loaded from the CDN manifest) provides fallback resolution. Without either database, files are still accessible by hash-key. |
| **hasChecksum flag misinterpretation**: `secondUint16 & 0x1` (hasChecksum) means a checksum table follows the data blocks | LOW | Extra bytes at end of MIX data could be misinterpreted as file data | For now, treat the checksum table as opaque trailing data. The entry `length` fields are authoritative for file boundaries. The checksum table does not affect header parsing or file extraction. |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-23.1: Three-Format Detection Chain

- **Decision**: Implement a `parseAuto()` factory method that tries C&C format first, then encrypted RA format with fallthrough, then unencrypted Westwood format.
- **Rationale**: OpenRA's `MixFile` constructor implements this three-way chain implicitly via `if/else`. Making it explicit in TypeScript with clear format detector methods (`isCncFormat`, `isEncryptedFormat`, `isWestwoodClassicFormat`) improves debuggability and testability. The fallthrough from encrypted to unencrypted handles CDN edge cases where the encrypted flag is set spuriously.
- **Mitigation**: The `parseEncrypted` fallthrough only triggers on actual exceptions (RSA keyblock decryption failure), not on detection. A file genuinely encrypted will fail early with a clear error, not silently produce garbage.

### ADR-23.2: Bit Test Fix -- Use getUint16 not getUint32

- **Decision**: Fix `isEncryptedFormat` to test `getUint16(2, true) & 0x2` instead of `getUint32(0, true) & 0x2`.
- **Rationale**: The OpenRA C# code reads two sequential uint16 values. The first (`firstUint16`) determines C&C vs RA format. The second (`secondUint16`) determines encryption. Our bug used a single uint32 read and tested bit 1 of the combined value, which examines bit 1 of the *first* uint16 (always 0 for RA format) instead of the *second* uint16. This caused all CDN RA-format files to fall through detection.
- **Mitigation**: Add explicit unit tests for all four secondUint16 values: 0 (no flags), 1 (hasChecksum only), 2 (encrypted), 3 (hasChecksum + encrypted). Each must produce the correct `isEncryptedFormat` result.

### ADR-23.3: Filename Resolution Strategy

- **Decision**: Build the mix database from the `"local mix database.dat"` entry inside each MIX file, supplemented by the global `mixDb` parameter, using the same dual-hash (Classic + CRC32) matching as OpenRA.
- **Rationale**: The local mix database is the most authoritative source -- it lists exactly the filenames contained in that specific MIX. The global database is a fallback. OpenRA's approach of trying both Classic and CRC32 hashes and picking the type with more matches minimizes unresolved entries.
- **Mitigation**: The database is built lazily on first MIX parse and cached via `MixLoader.setMixDb()`. Subsequent parses benefit from the accumulated database. This matches OpenRA's behavior where `globalFilenames` is loaded once per `MixLoader` instance.

### ADR-23.4: No Build-Time Preprocessing

- **Decision**: All MIX parsing happens at runtime in the browser. No build-time MIX extraction step.
- **Rationale**: The Content Installer already downloads MIX files at runtime. Adding a build-time preprocessing step would require bundling MIX extraction tools and pre-extracting all assets, doubling the asset pipeline's complexity. Runtime parsing is lightweight (~1-2ms for metadata extraction from a 50MB MIX file) and lazily defers actual data block reads to `open()` calls.
- **Mitigation**: The existing `MixFile.parseHeader/parseIndex/decryptHeader` doc reference implementations are preserved as documentation for build-tool authors who need offline extraction. Browser runtime parsing uses the `MixFileRuntime` class.

---

> **Plan Status**: This plan defines the 3-phase approach to MIX file format runtime support. The key fix is in 23.A.1 (bit test bug) which unblocks format detection for all CDN RA-format files. Adding Westwood classic format parsing (23.A.3) handles the unencrypted variant. Filename resolution (Phase B) makes extracted files usable by human-readable names.

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All implementation work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `CLAUDE.md` -- Project conventions and overall status
> - `docs/post_migration_completion_plan.md` -- Post-migration plan (Phase B: 3D Rendering items need MIX-extracted assets)
> - `docs/chapter24_animation_effects_plan.md` -- Chapter 24 (depends on MIX assets for sprite sheets and effects)
> - `src/OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.ts` -- Current runtime MIX parser (C&C + encrypted, ~1100 lines)
> - `src/OpenRA.Mods.Cnc/FileSystem/MixFile.ts` -- MixLoader + doc reference (format specification)
> - `src/OpenRA.Game/ContentInstaller/PackageExtractor.ts` -- Content extraction pipeline (MIX sub-archive handler)
