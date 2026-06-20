# Chapter 4 Deferred Items Implementation Plan: HTTP Client and Minimap Rendering

> **Plan Status**: PLANNED
> **Created**: 2026-06-20
> **Last Updated**: 2026-06-20
> **Prerequisite**: Chapter 4 Map System migration (37/37, 100% complete)
> **Related Design Doc**: `docs/chapter4_deferred_items_design.md` (parallel work)
> **Post-Migration Reference**: `docs/post_migration_completion_plan.md` Phase D items P1-D.1 and P1-D.5

> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All implementation work should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overview and Background](#1-overview-and-background)
2. [File Mapping Table](#2-file-mapping-table)
3. [Phase A: HTTP Client Infrastructure (TODO-4.E.3)](#3-phase-a-http-client-infrastructure-todo-4e3)
4. [Phase B: Minimap Rendering Pipeline (TODO-4.E.4)](#4-phase-b-minimap-rendering-pipeline-todo-4e4)
5. [Dependency Graph](#5-dependency-graph)
6. [Verification and Test Strategy](#6-verification-and-test-strategy)
7. [Estimation Summary](#7-estimation-summary)
8. [Risk and Considerations](#8-risk-and-considerations)

---

## 1. Overview and Background

### 1.1 What Was Deferred

During the Chapter 4 Phase E code review of `MapCache.ts` and `MapPreview.ts`, two TODO items were intentionally deferred because they require independent subsystem designs that could not be resolved within the scope of the core map migration:

| TODO ID | Description | Source Location | Priority | Rationale for Deferral |
|---------|-------------|-----------------|----------|------------------------|
| **TODO-4.E.3** | Full HTTP client with retry logic, YAML/JSON response parsing, PerfTimer integration | `MapCache.ts:478-523` (`queryRemoteMapDetails`) | P1 -- Critical path for remote map functionality | Requires standalone `HttpClient` module design with configurable retry/backoff; also requires decision on server response format (JSON vs YAML) |
| **TODO-4.E.4** | Actual minimap rendering with SheetBuilder.Add channel allocation, correct SpriteFrameType, PNG decoding | `MapCache.ts:536-623` (`runMinimapLoader`), `MapPreview.ts:272-273,698-699` | P2 -- Visual quality for map selector UI | Requires: (a) `MapPreview.previewSize` property for image dimensions, (b) PNG decoder for remote map base64 minimaps, (c) correct `SpriteFrameType` selection, (d) `SheetBuilder.Current.ReleaseBuffer()` call after batch rendering |

### 1.2 Current State of Affected Code

**`MapCache.queryRemoteMapDetails()` (lines 525-569)**:
- Uses bare `fetch(url)` with no retry logic
- Hardcodes `response.json()` -- assumes JSON response format
- No `PerfTimer` instrumentation for performance tracking
- Error handling distinguishes network errors from HTTP errors only coarsely (single catch-all)

**`MapCache.runMinimapLoader()` (lines 606-669)**:
- Calls `sheetBuilder.addSimple(p.preview, 0, { width: 1, height: 1 })` with three bugs:
  1. `0` (Indexed8) is the wrong `SpriteFrameType` -- minimap pixel data is RGBA, should be `SpriteFrameType.Rgba32` (value 3)
  2. `{ width: 1, height: 1 }` is a placeholder -- should use actual minimap image dimensions
  3. For remote maps, `p.preview` contains raw PNG bytes (base64-decoded), not raw RGBA pixel data -- PNG must be decoded first
- Missing `sheetBuilder.Current.ReleaseBuffer()` call after batch rendering (present in OpenRA original at line 332)
- Worker loop uses `setTimeout(0)` for initial launch and `setTimeout(5)` per item; these are fine for the JS event loop

**`MapPreview.preview` field (line 272)**:
- Stores heterogeneous data depending on the source:
  - From `generatePreviewPixels()`: raw RGBA `Uint8Array` (width and height derivable from `mapWidth`/`mapHeight` but not stored)
  - From `completeRemoteSearch()`: raw PNG bytes after `base64ToUint8Array()` (not decoded to pixels)
- No `previewSize` property -- consumer code cannot determine image dimensions without inspecting the data

### 1.3 Pre-Existing Infrastructure (Already Available)

The following utilities were completed as part of the post-migration Phase D (P1-D.5) and are ready for direct use:

| Utility | Location | Purpose |
|---------|----------|---------|
| `PerfTimer` | `src/OpenRA.Game/Utils/PerfTimer.ts` (131 lines) | High-resolution `performance.now()` wrapper with start/stop/reset/elapsed semantics |
| `Log` | `src/OpenRA.Game/Utils/Log.ts` | Channel-based structured logging with `LogLevel` filtering |
| `SheetBuilder` | `src/OpenRA.Game/Graphics/SheetBuilder.ts` | Runtime row-packing sprite atlas builder with `addSimple()` / `addRaw()` |
| `fastCopyIntoChannel` | `src/OpenRA.Game/Graphics/Util.ts` | Pixel data copy into atlas buffer, supports `Rgba32` source format via slow path (R→G→B→A → BGRA) |
| `SpriteFrameType` | `src/OpenRA.Game/Graphics/Util.ts` (lines 25-38) | Full enum: `Indexed8=0`, `Bgra32=1`, `Bgr24=2`, `Rgba32=3`, `Rgb24=4` |

### 1.4 Key Design Decisions (from Architecture Design Doc)

These decisions are documented in the parallel design document (`docs/chapter4_deferred_items_design.md`) and referenced here for context:

1. **HTTP retry strategy**: Exponential backoff with jitter, configurable via `RetryConfig` interface. Default: 3 retries, base delay 1s, max delay 30s, backoff multiplier 2x.
2. **PNG decoding approach**: Use browser `createImageBitmap()` + offscreen Canvas for remote minimaps (async, leverages native codec). Fallback to a minimal pure-JS PNG parser for environments without DOM (tests).
3. **Minimap pixel format**: All minimap pixel data normalized to raw RGBA `Uint8Array` before storage in `MapPreview.preview`. `previewSize` added as a separate property.
4. **SpriteFrameType**: Always use `SpriteFrameType.Rgba32` for minimap data (matches the RGBA byte order produced by both `generatePreviewPixels` and PNG decoding).

---

## 2. File Mapping Table

### 2.1 Phase A: HTTP Client Infrastructure (TODO-4.E.3)

| # | File Path | Operation | OpenRA Reference | Description |
|:---:|:---|:---:|:---|:---|
| A1 | `src/OpenRA.Game/Net/HttpClient.ts` | **CREATE** | `OpenRA.Support.HttpClientFactory` + `HttpClient` | New module: fetch wrapper with retry, timeout, abort |
| A2 | `src/OpenRA.Game/Net/HttpClient.test.ts` | **CREATE** | N/A (new tests) | Unit tests for retry logic, backoff, timeout, abort |
| A3 | `src/OpenRA.Game/Map/MapCache.ts` | **MODIFY** | `OpenRA.Game/Map/MapCache.cs:223-268` | Integrate `fetchWithRetry`, add `PerfTimer`, improve error handling |
| A4 | `src/OpenRA.Game/Map/MapPreview.ts` | **MODIFY** | `OpenRA.Game/Map/MapPreview.cs:520-597` | Improve `completeRemoteSearch` response parsing; add JSON Schema validation |

### 2.2 Phase B: Minimap Rendering Pipeline (TODO-4.E.4)

| # | File Path | Operation | OpenRA Reference | Description |
|:---:|:---|:---:|:---|:---|
| B1 | `src/OpenRA.Game/Map/MapPreview.ts` | **MODIFY** | `OpenRA.Game/Map/MapPreview.cs:238,284-304` | Add `previewSize` property; refactor `preview` to always store raw RGBA; add PNG decoder integration |
| B2 | `src/OpenRA.Game/Map/MapPreview.test.ts` | **MODIFY** | N/A (existing + new tests) | Tests for `previewSize`, PNG decoding, `generatePreviewPixels` dimensions |
| B3 | `src/OpenRA.Game/Map/MapCache.ts` | **MODIFY** | `OpenRA.Game/Map/MapCache.cs:307-334` | Fix `runMinimapLoader`: correct SpriteFrameType, use `p.previewSize`, add `ReleaseBuffer()` |
| B4 | `src/OpenRA.Game/Map/MapCache.test.ts` | **MODIFY** | N/A (existing + new tests) | Tests for minimap rendering path with mocked `SheetBuilder` |
| B5 | `src/OpenRA.Game/Graphics/SheetBuilder.ts` | **VERIFY** | `OpenRA.Game/Graphics/SheetBuilder.cs` | Confirm `addSimple` / `addRaw` behavior with `Rgba32` + verify `ReleaseBuffer` availability |
| B6 | `src/__e2e__/manual/ch04-map/minimap-rendering/` | **CREATE** | N/A (manual verification) | Acceptance test page: render minimap sprites from sample terrain data |

---

## 3. Phase A: HTTP Client Infrastructure (TODO-4.E.3)

**Status**: PLANNED
**Complexity**: MEDIUM
**Blocked by**: Nothing (all dependencies satisfied)
**Blocks**: Phase A completion enables robust remote map queries

### 3.1 Task Breakdown

#### TODO-4.E.3.1: `HttpClient.ts` -- Fetch Wrapper with Retry Logic

- **File**: `src/OpenRA.Game/Net/HttpClient.ts` (CREATE, est. ~200 lines)
- **OpenRA Reference**: `OpenRA.Support.HttpClientFactory` + `System.Net.Http.HttpClient`

**Design**:

```typescript
/**
 * RetryConfig -- configuration for fetchWithRetry behavior.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries: number
  /** Base delay in milliseconds before first retry (default: 1000). */
  baseDelayMs: number
  /** Maximum delay cap in milliseconds (default: 30000). */
  maxDelayMs: number
  /** Backoff multiplier (default: 2.0 for exponential backoff). */
  backoffMultiplier: number
  /** HTTP status codes that trigger a retry. Default: [429, 500, 502, 503, 504]. */
  retryableStatuses: number[]
  /** Request timeout in milliseconds (default: 30000). 0 = no timeout. */
  timeoutMs: number
  /** Jitter factor applied to delay: delay * (1 + random * jitter). Default: 0.3. */
  jitter: number
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = { ... }

/**
 * Fetch with retry, timeout, and abort support.
 *
 * Retries on network errors and configurable HTTP status codes.
 * Uses exponential backoff with jitter.
 *
 * @param url -- Target URL
 * @param init -- Standard RequestInit (method, headers, body, etc.)
 * @param config -- Retry configuration (defaults to DEFAULT_RETRY_CONFIG)
 * @param signal -- Optional AbortSignal for external cancellation
 * @returns Response on success
 * @throws Error on all retries exhausted, timeout, or external abort
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  config?: Partial<RetryConfig>,
  signal?: AbortSignal,
): Promise<Response>
```

**Implementation requirements**:
- Merge partial `config` with `DEFAULT_RETRY_CONFIG`
- Wrap `fetch()` with `AbortController` for timeout + external signal composition
- On retryable failure: compute delay = `min(baseDelayMs * backoffMultiplier^attempt, maxDelayMs) * (1 + random * jitter)`, await `setTimeout`
- On non-retryable HTTP status (e.g., 400, 404): throw immediately, no retry
- Export `isRetryableStatus(status, config): boolean` helper for testability
- Export `computeBackoffDelay(attempt, config): number` helper for testability

**Paradigm mapping**:
- C# `HttpClient.GetStreamAsync(url)` -> `fetchWithRetry(url).then(r => r.body)`
- C# `Task.Run(async () => { ... })` -> direct `async function` (JS event loop)
- C# `CancellationToken` -> `AbortSignal`

#### TODO-4.E.3.2: `HttpClient.test.ts` -- Retry Logic Unit Tests

- **File**: `src/OpenRA.Game/Net/HttpClient.test.ts` (CREATE, est. ~300 lines)
- **OpenRA Reference**: N/A (new tests)

**Test cases** (minimum 15):

| # | Test Name | Description |
|:---:|:---|:---|
| 1 | `succeeds on first attempt` | Mock fetch returns 200, expect single call |
| 2 | `retries on network error` | Mock fetch rejects with TypeError, expect 3 retries then throw |
| 3 | `retries on 503` | Mock fetch returns 503 (retryable), succeeds on 2nd attempt |
| 4 | `does not retry on 404` | Mock fetch returns 404 (non-retryable), expect immediate throw |
| 5 | `does not retry on 400` | Mock fetch returns 400 (non-retryable), expect immediate throw |
| 6 | `backoff delay increases exponentially` | Verify delays follow backoffMultiplier pattern |
| 7 | `respects maxDelayMs cap` | With large backoffMultiplier, verify delays are capped |
| 8 | `jitter adds randomness to delay` | Verify delay != exact exponential value (within jitter range) |
| 9 | `timeout fires when request hangs` | Mock fetch never resolves, expect timeout error |
| 10 | `external abort cancels in-flight request` | Pass AbortSignal, call abort(), expect AbortError |
| 11 | `custom retryableStatuses` | Override retryableStatuses to include 418, verify retry |
| 12 | `maxRetries=0 disables retry` | First failure throws immediately |
| 13 | `merges partial config with defaults` | Only `maxRetries` provided, other fields use defaults |
| 14 | `passes RequestInit through to fetch` | Verify headers, method, body are forwarded correctly |
| 15 | `computeBackoffDelay returns correct values` | Unit test the pure function with known inputs |

**Mock strategy**:
- Use `vi.fn()` to mock global `fetch`
- Use `vi.useFakeTimers()` to control setTimeout for backoff timing tests
- Timeout test: advance timers past `timeoutMs`, verify fetch was called with AbortController signal

#### TODO-4.E.3.3: `MapCache.ts` -- Integrate Retry HTTP Client

- **File**: `src/OpenRA.Game/Map/MapCache.ts` (MODIFY, est. ~80 lines changed)
- **OpenRA Reference**: `OpenRA.Game/Map/MapCache.cs:223-268`

**Changes to `queryRemoteMapDetails()`**:

1. **Replace bare `fetch()` with `fetchWithRetry()`**:
   ```typescript
   // Before (TODO-4.E.3):
   const response = await fetch(url)
   if (!response.ok) {
     throw new Error(`HTTP ${response.status}`)
   }
   const data = await response.json() as Record<string, unknown>

   // After:
   const response = await fetchWithRetry(url, {
     signal: this._previewLoaderCancelled ? AbortSignal.abort() : undefined,
   })
   if (!response.ok) {
     throw new Error(`HTTP ${response.status}`)
   }
   const text = await response.text()
   const data = parseMapQueryResponse(text, url) // see TODO-4.E.3.4
   ```

2. **Add PerfTimer instrumentation**:
   ```typescript
   for (const batchUids of batches) {
     const timer = new PerfTimer()
     timer.start()
     try {
       // ... fetch logic ...
     } finally {
       const elapsed = timer.stop()
       Log.write('mapcache', LogLevel.DEBUG,
         `RemoteMapDetails batch ${batchUids.length} maps: ${timer.toString()}`
       )
     }
   }
   ```

3. **Improve error handling**:
   - Distinguish `TypeError` (network failure) from HTTP status errors -- `fetchWithRetry` handles this internally, but the caller should log appropriately
   - Pass `signal` from `_previewLoaderCancelled` flag for clean abort during dispose
   - Log the URL on failure (matching OpenRA `Log.Write("debug", $"URL was: {url}")`)

4. **Add import**: `import { fetchWithRetry } from '../Net/HttpClient.js'` and `import { PerfTimer } from '../Utils/PerfTimer.js'`

#### TODO-4.E.3.4: `MapPreview.ts` -- Response Parsing and Format Detection

- **File**: `src/OpenRA.Game/Map/MapPreview.ts` (MODIFY, est. ~60 lines changed)
- **OpenRA Reference**: `OpenRA.Game/Map/MapPreview.cs:547-597`

**Add JSON Schema Validation for RemoteMapData**:

```typescript
/**
 * Validate that an unknown object conforms to the RemoteMapData interface.
 * Returns a type-narrowed RemoteMapData or null if validation fails.
 */
export function validateRemoteMapData(data: unknown): RemoteMapData | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.title !== 'string') return null
  if (typeof d.author !== 'string') return null
  if (!Array.isArray(d.categories)) return null
  if (typeof d.players !== 'number') return null
  if (!d.bounds || typeof d.bounds !== 'object') return null
  if (!Array.isArray(d.spawnpoints)) return null
  if (typeof d.minimap !== 'string') return null
  if (typeof d.tileset !== 'string') return null
  if (typeof d.mapformat !== 'number') return null
  // Optional fields: downloading, rules, players_block, game_mod, map_grid_type
  return data as RemoteMapData
}
```

**Improve `completeRemoteSearch()`**:
- Replace inline type-narrowing with `validateRemoteMapData()` call
- This provides better error messages (log which field failed validation)

**Add response format detection helper**:

The server may return JSON or YAML. Add a detection function at the module level:

```typescript
/**
 * Parse a remote map query response, auto-detecting JSON vs YAML format.
 *
 * OpenRA original uses MiniYaml.FromStream() for YAML parsing.
 * Web adaptation: try JSON first (modern API), fall back to YAML.
 *
 * @param text -- Raw response body
 * @param url -- Source URL (for error messages)
 * @returns Parsed key-value map (uid => RemoteMapData or raw object)
 */
export function parseMapQueryResponse(
  text: string,
  url: string,
): Record<string, unknown> {
  // Try JSON first (most web APIs use JSON)
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Not JSON, try YAML
  }

  // Fallback: YAML parsing via MiniYamlLoader
  // NOTE: MiniYamlLoader is a build-time utility in utils/miniyaml-to-json.ts.
  // For runtime YAML parsing, we need a lightweight parser or we can use the
  // existing MiniYaml infrastructure from Ch4 Phase H.
  // If the server exclusively returns JSON, this fallback can be a stub.
  throw new Error(
    `Unsupported response format from ${url}: expected JSON. ` +
    `YAML parsing requires runtime MiniYaml integration (deferred).`
  )
}
```

**Note on YAML parsing**: OpenRA's resource center returns YAML by default (the URL ends with `/yaml`). For the web adaptation, we have two options:
1. Request the server to return JSON (change URL from `/yaml` to `/json`)
2. Integrate runtime YAML parsing using the MiniYaml pipeline from Ch4 Phase H

This plan prefers option 1 (JSON) for Phase A, with YAML as a deferred follow-up. The `parseMapQueryResponse` function is designed to make the switch straightforward.

### 3.2 Phase A Dependency Order

```
TODO-4.E.3.1 (HttpClient.ts)     ← no dependencies
  └── TODO-4.E.3.2 (HttpClient.test.ts)  ← depends on 3.1
  └── TODO-4.E.3.3 (MapCache.ts integration) ← depends on 3.1
        └── TODO-4.E.3.4 (MapPreview response parsing) ← depends on 3.3 (design)
```

---

## 4. Phase B: Minimap Rendering Pipeline (TODO-4.E.4)

**Status**: PLANNED
**Complexity**: MEDIUM
**Blocked by**: Nothing (independent of Phase A)
**Blocks**: Map selector UI visual quality

### 4.1 Task Breakdown

#### TODO-4.E.4.1: `MapPreview.ts` -- Add `previewSize` Property

- **File**: `src/OpenRA.Game/Map/MapPreview.ts` (MODIFY, est. ~40 lines changed)
- **OpenRA Reference**: `OpenRA.Game/Map/MapPreview.cs:238` (`Png Preview` with implicit size), `OpenRA.Game/Map/MapPreview.cs:284-304` (`GetMinimap`/`SetMinimap`)

**Changes**:

1. **Add `previewSize` property** (line ~272, after `preview`):
   ```typescript
   /** 小地图 PNG 原始像素数据。OpenRA 对照: InnerData.Preview (Png) */
   preview: Uint8Array | null

   /** 小地图图像尺寸。OpenRA 对照: Png.Width / Png.Height */
   previewSize: { width: number; height: number } | null
   ```

2. **Initialize in constructor** (after `this.preview = null`):
   ```typescript
   this.previewSize = null
   ```

3. **Update `generatePreviewPixels()`** to store dimensions:
   ```typescript
   generatePreviewPixels(...): Uint8Array | null {
     const previewWidth = Math.max(1, Math.min(256, mapWidth))
     const previewHeight = Math.max(1, Math.min(256, mapHeight))
     // ... pixel generation ...
     this.preview = pixels
     this.previewSize = { width: previewWidth, height: previewHeight }  // NEW
     return pixels
   }
   ```

4. **Update `completeRemoteSearch()`** -- after PNG decoding (see TODO-4.E.4.2), store the decoded dimensions:
   ```typescript
   // After PNG decode:
   this.preview = decodedPixels
   this.previewSize = { width: decodedWidth, height: decodedHeight }
   ```

5. **Update `setMinimap()`** to also accept and store size:
   ```typescript
   setMinimap(minimap: unknown, size?: { width: number; height: number }): void {
     if (minimap instanceof Uint8Array) {
       this.preview = minimap
     }
     if (size) {
       this.previewSize = size
     }
     this._generatingMinimap = false
   }
   ```

6. **Add PNG decoding utility** (inline or imported):
   ```typescript
   /**
    * Decode a base64-encoded PNG string to raw RGBA pixel data.
    *
    * Uses createImageBitmap for native decoding in browser environments.
    * Returns decoded RGBA pixels and image dimensions.
    *
    * OpenRA 对照: new Png(new MemoryStream(Convert.FromBase64String(minimap)))
    *
    * @param base64Png -- Base64-encoded PNG data (from remote API)
    * @returns Decoded pixels + size, or null on failure
    */
   async decodeBase64Png(
     base64Png: string,
   ): Promise<{ pixels: Uint8Array; width: number; height: number } | null>
   ```

   **Implementation approach for browser**:
   ```typescript
   async decodeBase64Png(base64Png: string) {
     try {
       const blob = new Blob(
         [Uint8Array.from(atob(base64Png), c => c.charCodeAt(0))],
         { type: 'image/png' }
       )
       const bitmap = await createImageBitmap(blob)
       const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
       const ctx = canvas.getContext('2d')!
       ctx.drawImage(bitmap, 0, 0)
       const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
       bitmap.close()
       return {
         pixels: new Uint8Array(imageData.data.buffer),
         width: bitmap.width,
         height: bitmap.height,
       }
     } catch {
       return null
     }
   }
   ```

   **Note for testing**: `createImageBitmap` and `OffscreenCanvas` are not available in happy-dom. Tests should mock `decodeBase64Png` or use a pure-JS PNG parser fallback. A minimal PNG parser that handles 8-bit RGB/RGBA without interlacing would be ~100 lines.

7. **Refactor `completeRemoteSearch()`** to use async PNG decoding:
   - The current code synchronously calls `this.base64ToUint8Array(remoteData.minimap)` and assigns to `this.preview`
   - Change to: store the base64 string temporarily, then decode asynchronously
   - Since `completeRemoteSearch()` is called synchronously from `queryRemoteMapDetails()`, the decoding should happen in `runMinimapLoader()` instead

#### TODO-4.E.4.2: `MapCache.ts` -- Fix Minimap Rendering in `runMinimapLoader()`

- **File**: `src/OpenRA.Game/Map/MapCache.ts` (MODIFY, est. ~50 lines changed)
- **OpenRA Reference**: `OpenRA.Game/Map/MapCache.cs:307-334`

**Changes to `runMinimapLoader()` (lines 643-664)**:

```typescript
// Before (BUGGY):
const sprite = this._sheetBuilder.addSimple(
  p.preview,
  0, // SpriteFrameType -- WRONG: should be Rgba32
  { width: 1, height: 1 }, // WRONG: placeholder dimensions
)
p.setMinimap(sprite)

// After (FIXED):
import { SpriteFrameType } from '../Graphics/Util.js'

// ...

// Inside the per-preview loop:
if (p.preview !== null && p.previewSize !== null) {
  try {
    const sprite = this._sheetBuilder.addSimple(
      p.preview,
      SpriteFrameType.Rgba32, // CORRECT: RGBA pixel data
      p.previewSize,           // CORRECT: actual image dimensions
    )
    p.setMinimap(sprite, p.previewSize)
  } catch (e) {
    Log.write('mapcache', LogLevel.WARN, `Failed to load minimap: ${String(e)}`)
  }
}
```

**Add `ReleaseBuffer()` call after batch** (matching OpenRA line 332):
```typescript
// After the for loop, before the function returns:
// Release the buffer by forcing changes to be written out to the texture,
// allowing the buffer to be reclaimed by GC.
if (this._sheetBuilder.current !== null) {
  this._sheetBuilder.current.releaseBuffer()
}
```

**Note**: This requires checking that `Sheet.releaseBuffer()` exists. Let me verify. (It should -- the Sheet class has `commitBufferedData()` which is the counterpart; `releaseBuffer()` might need to be added as a public method that calls `commitBufferedData()` and then nulls out the internal buffer.)

#### TODO-4.E.4.3: `SheetBuilder.ts` / `Sheet.ts` -- Verify Channel Allocation

- **File**: `src/OpenRA.Game/Graphics/SheetBuilder.ts` (VERIFY, est. ~10 lines if changes needed)
- **File**: `src/OpenRA.Game/Graphics/Sheet.ts` (VERIFY, est. ~5 lines if `releaseBuffer` needs adding)
- **OpenRA Reference**: `OpenRA.Game/Graphics/SheetBuilder.cs`, `OpenRA.Game/Graphics/Sheet.cs`

**Verification checklist**:

1. **`addSimple()` with `SpriteFrameType.Rgba32`**:
   - `frameTypeToSheetType(Rgba32)` returns `SheetType.BGRA` (line 82-86 of SheetBuilder.ts) -- CORRECT
   - `addSimple` calls `addRaw` which calls `allocate(size, ...)` then `fastCopyIntoChannel(...)` -- CORRECT
   - `fastCopyIntoChannel` with `Rgba32` and destChannel=4 (RGBA for BGRA sheet) goes through `copyIntoRgba` slow path, reading r,g,b,a and writing BGRA to destination -- CORRECT

2. **`Sheet.releaseBuffer()` availability**:
   - Check if `Sheet` class has a public `releaseBuffer()` method
   - If not: add `releaseBuffer(): void { this.commitBufferedData(); /* optionally null out buffer */ }`
   - OpenRA original: `sheetBuilder.Current.ReleaseBuffer` is a method on `Sheet` that forces GPU upload of pending changes

3. **Channel allocation for Indexed8 vs Rgba32**:
   - `SheetBuilder` constructor sets `currentChannel = 4` (RGBA) for BGRA sheet type -- CORRECT
   - This means all BGRA-type sprites go into the RGBA channel of the BGRA sheet
   - No per-channel cycling needed for BGRA (only for Indexed sheets with separate R/G/B/A channels)
   - CONFIRMED: minimap data (Rgba32) correctly maps to BGRA sheet RGBA channel

**Action**: If `Sheet.releaseBuffer()` is not a public method, add it. Otherwise, this task is verification-only.

#### TODO-4.E.4.4: `MapPreview.test.ts` -- Tests for previewSize and PNG Decoding

- **File**: `src/OpenRA.Game/Map/MapPreview.test.ts` (MODIFY if exists, CREATE if not, est. ~200 lines)
- **OpenRA Reference**: N/A (new tests)

**Test cases** (minimum 12):

| # | Test Name | Description |
|:---:|:---|:---|
| 1 | `generatePreviewPixels sets previewSize` | Verify `previewSize` is non-null and has correct clamped dimensions after `generatePreviewPixels()` |
| 2 | `previewSize width clamped to max 256` | Input mapWidth=512 produces previewSize.width=256 |
| 3 | `previewSize height clamped to max 256` | Input mapHeight=512 produces previewSize.height=256 |
| 4 | `previewSize minimum is 1` | Input mapWidth=0 produces previewSize.width=1 |
| 5 | `generatePreviewPixels produces RGBA data` | Verify pixel array length = width * height * 4 |
| 6 | `generatePreviewPixels handles square map` | 128x128 map produces 128x128 preview |
| 7 | `generatePreviewPixels handles non-square map` | 200x100 map preserves aspect ratio |
| 8 | `decodeBase64Png returns size and pixels` | Mock `createImageBitmap`, verify returned dimensions match |
| 9 | `decodeBase64Png returns null on failure` | Mock rejected `createImageBitmap`, verify null return |
| 10 | `setMinimap stores preview and size` | Call `setMinimap(pixels, size)`, verify both stored |
| 11 | `setMinimap without size leaves previewSize unchanged` | Set initial size, call `setMinimap(pixels)`, verify size preserved |
| 12 | `constructor initializes previewSize to null` | `new MapPreview(...)` has null `previewSize` |

#### TODO-4.E.4.5: `MapCache.test.ts` -- Tests for Minimap Rendering Path

- **File**: `src/OpenRA.Game/Map/MapCache.test.ts` (MODIFY, est. ~150 lines added)
- **OpenRA Reference**: N/A (new tests)

**Test cases** (minimum 8):

| # | Test Name | Description |
|:---:|:---|:---|
| 1 | `runMinimapLoader uses Rgba32 SpriteFrameType` | Mock SheetBuilder.addSimple, verify called with `SpriteFrameType.Rgba32` (value 3) |
| 2 | `runMinimapLoader uses previewSize for dimensions` | Set previewSize={w:128,h:128}, verify addSimple called with those dimensions |
| 3 | `runMinimapLoader skips previews with null previewSize` | preview=Uint8Array but previewSize=null, verify addSimple NOT called |
| 4 | `runMinimapLoader calls ReleaseBuffer after batch` | Mock sheetBuilder.current.releaseBuffer, verify called after processing |
| 5 | `runMinimapLoader handles addSimple exception gracefully` | Mock addSimple throws, verify preview not corrupted, loop continues |
| 6 | `cacheMinimap starts loader on first call` | Verify `_previewLoaderShutdown` transitions from true to false |
| 7 | `runMinimapLoader stops after keepAlive expiry` | With empty queue, verify loop exits after MaxKeepAlive iterations |
| 8 | `dispose cancels running loader` | Set `_previewLoaderCancelled`, verify loop exits early |

**Mock strategy**:
- Mock `SheetBuilder` and its `addSimple` method using `vi.fn()`
- Mock `Sheet` with `releaseBuffer` using `vi.fn()`
- Test `runMinimapLoader` by calling it directly (it's `private` -- use `// @ts-expect-error` or expose via `_runMinimapLoaderForTest`)

### 4.2 Phase B Dependency Order

```
TODO-4.E.4.1 (MapPreview previewSize)     ← no dependencies
  └── TODO-4.E.4.2 (MapCache render fix)  ← depends on 4.1
        └── TODO-4.E.4.3 (SheetBuilder verify) ← depends on 4.2 (validation)
              └── TODO-4.E.4.4 (MapPreview tests) ← depends on 4.1
              └── TODO-4.E.4.5 (MapCache tests)   ← depends on 4.2
  └── TODO-4.E.4.6 (Acceptance test page) ← depends on 4.2 (needs working renderer)
```

---

## 5. Dependency Graph

```
Phase A (HTTP Client) ──────────────────────────────────────────
  TODO-4.E.3.1 (HttpClient.ts)
    ├── TODO-4.E.3.2 (HttpClient.test.ts)
    └── TODO-4.E.3.3 (MapCache integration)
          └── TODO-4.E.3.4 (MapPreview response parsing)

Phase B (Minimap Rendering) ─── INDEPENDENT of Phase A ────────
  TODO-4.E.4.1 (MapPreview previewSize)
    ├── TODO-4.E.4.4 (MapPreview tests)
    └── TODO-4.E.4.2 (MapCache render fix)
          ├── TODO-4.E.4.3 (SheetBuilder verify)
          └── TODO-4.E.4.5 (MapCache tests)
                └── TODO-4.E.4.6 (Acceptance test page)

Phases A and B are fully independent and can be executed in parallel.
```

---

## 6. Verification and Test Strategy

### 6.1 Automated Testing

| Phase | Test File(s) | Min. Tests | Coverage Target |
|-------|-------------|:---:|:---:|
| Phase A | `HttpClient.test.ts` (new) | 15 | >95% for `HttpClient.ts` |
| Phase A | `MapCache.test.ts` (existing, additions) | N/A (integration) | Existing tests must continue passing |
| Phase B | `MapPreview.test.ts` (new/modified) | 12 | >90% for new methods |
| Phase B | `MapCache.test.ts` (existing, additions) | 8 | >90% for minimap path |
| Both | All existing tests | 30 (MapCache) + N (MapPreview) | No regressions; `npx vitest run` passes 100% |

### 6.2 Type Checking

- `npx tsc --noEmit` must produce zero errors after each task
- All new imports must be properly typed
- No `any` types except where `unknown` is narrowed with type guards

### 6.3 Manual Acceptance Testing (Phase B Only)

- **Test Page**: `src/__e2e__/manual/ch04-map/minimap-rendering/`
- **Purpose**: Visually verify that minimap sprites render correctly on the Babylon.js scene
- **URL**: `http://localhost:5173/test/ch04-map/minimap-rendering/`
- **Files to create**:
  - `index.html` -- Layout with canvas and controls
  - `main.ts` -- Create Babylon.js scene, generate sample terrain minimap, display via SheetBuilder
  - `README.md` -- Expected results and verification steps
- **Verification criteria** (minimum 3):
  1. Minimap sprite appears as a correctly colored grid matching terrain type colors
  2. Sprite dimensions match the expected minimap aspect ratio
  3. No visual artifacts (tearing, misalignment, color corruption) at sprite borders

### 6.4 Regression Check

After both phases are complete:
1. Run full test suite: `npx vitest run`
2. Verify `loadMaps` flow still works end-to-end (mock filesystem + manifest)
3. Verify `chooseInitialMap` still returns correct maps
4. Verify `enumerateMapDirPackages` still functions correctly

---

## 7. Estimation Summary

| Task | File(s) | Impl Lines | Test Lines | Complexity | Estimated Hours |
|:---|:---|---:|---:|:---:|:---:|
| **Phase A** | | | | | |
| TODO-4.E.3.1 | `HttpClient.ts` (CREATE) | ~200 | -- | MEDIUM | 2-3 |
| TODO-4.E.3.2 | `HttpClient.test.ts` (CREATE) | -- | ~300 | MEDIUM | 2-3 |
| TODO-4.E.3.3 | `MapCache.ts` (MODIFY) | ~80 | -- | LOW | 1 |
| TODO-4.E.3.4 | `MapPreview.ts` (MODIFY) | ~60 | -- | LOW | 1 |
| **Phase A Subtotal** | | **~340** | **~300** | | **6-8** |
| **Phase B** | | | | | |
| TODO-4.E.4.1 | `MapPreview.ts` (MODIFY) | ~40 | -- | LOW | 1 |
| TODO-4.E.4.2 | `MapCache.ts` (MODIFY) | ~50 | -- | LOW | 1 |
| TODO-4.E.4.3 | `SheetBuilder.ts` / `Sheet.ts` (VERIFY) | ~15 | -- | LOW | 0.5 |
| TODO-4.E.4.4 | `MapPreview.test.ts` (MODIFY/CREATE) | -- | ~200 | MEDIUM | 2 |
| TODO-4.E.4.5 | `MapCache.test.ts` (MODIFY) | -- | ~150 | MEDIUM | 1.5 |
| TODO-4.E.4.6 | `__e2e__/manual/ch04-map/minimap-rendering/` (CREATE) | ~150 | -- | MEDIUM | 2-3 |
| **Phase B Subtotal** | | **~255** | **~350** | | **8-9** |
| **Grand Total** | | **~595** | **~650** | | **14-17** |

**Total estimated lines**: ~1,245 (595 new/changed implementation + 650 test lines)
**Total estimated hours**: 14-17 (assuming sequential execution; can be ~8-10 with parallel Phase A + Phase B)

---

## 8. Risk and Considerations

### 8.1 Technical Risks

| Risk | Severity | Mitigation |
|------|:---:|------|
| **PNG decoding in test environment**: `createImageBitmap` is unavailable in happy-dom, and `OffscreenCanvas` may also be unavailable | MEDIUM | Include a minimal pure-JS PNG parser (~100 lines) as fallback for tests. Only needs to handle 8-bit RGB/RGBA without interlacing -- the subset used by map minimaps. |
| **YAML response format**: The OpenRA resource center returns YAML by default. If the server does not support JSON, Phase A requires runtime YAML parsing | MEDIUM | Design `parseMapQueryResponse` to support both formats. YAML fallback can use the existing MiniYaml infrastructure (Ch4 Phase H `utils/miniyaml-to-json.ts`), but that file is build-time only. A lightweight runtime YAML subset parser may be needed. |
| **`Sheet.releaseBuffer()` not public**: If the `Sheet` class does not expose `releaseBuffer()`, the OpenRA pattern of forcing buffer flush cannot be replicated | LOW | Add a public `releaseBuffer()` method that delegates to `commitBufferedData()`. This is a trivial addition. |
| **BGRA vs RGBA channel confusion**: `fastCopyIntoChannel` converts `Rgba32` source to BGRA destination correctly, but the slow path is used (not Uint32Array fast path) | LOW | The slow path is correct and tested. Performance impact is negligible for minimaps (256x256 max = 65K pixels, processed once per map load). |

### 8.2 Design Considerations

1. **`MapPreview.preview` data format consistency**: After Phase B, `preview` will always store **raw RGBA pixel data** (decoded from PNG for remote maps, generated directly for local maps). This invariant simplifies downstream consumers.

2. **Async PNG decoding flow**: Currently, `completeRemoteSearch()` is called synchronously from `queryRemoteMapDetails()`. The PNG decoding must be deferred to the async `runMinimapLoader()` loop. The intermediate state: `MapPreview` stores the base64 string (or intermediate buffer) until the loader decodes it. An alternative is to decode PNG immediately in `completeRemoteSearch()` by making it async -- but this requires changing the call signature and all callers. The simpler approach: store the base64 string, decode in the loader.

3. **Minimap data source tagging**: To avoid ambiguity about whether `preview` contains raw RGBA or encoded PNG, consider adding a private `_previewFormat` tag: `'rgba' | 'png-base64'`. The loader checks this tag and decodes if needed. Alternatively, always decode on storage -- the `completeRemoteSearch()` path is the only PNG source, so it can decode immediately (asynchronously) and store raw RGBA before the loader runs.

4. **Backward compatibility**: All existing `MapPreview` and `MapCache` tests must continue to pass after changes. The `previewSize` property addition is backward-compatible (new field, default null). The `setMinimap()` signature change is backward-compatible (optional second parameter).

### 8.3 Open Questions

1. **Remote map server API format**: Does the OpenRA resource center (or planned web equivalent) support JSON responses, or is it YAML-only? This determines whether `parseMapQueryResponse` needs YAML fallback in Phase A.
   - **Recommendation**: Implement JSON-first with YAML stub. If server is confirmed YAML-only, add runtime MiniYaml parsing as a follow-up task.

2. **`MapPreview.preview` field type**: Currently typed as `Uint8Array | null`. After Phase B, should this be refined to always represent raw RGBA? This would require a type-level invariant but is safe since both paths produce RGBA after Phase B changes.

---

## Appendix A: OpenRA Original Code References

### A.1 MapCache.QueryRemoteMapDetails (MapCache.cs:223-268)

```csharp
public void QueryRemoteMapDetails(string repositoryUrl, IEnumerable<string> uids,
    Action<MapPreview> mapDetailsReceived = null, Action<MapPreview> mapQueryFailed = null)
{
    var queryUids = uids.Distinct()
        .Where(uid => uid != null)
        .Select(uid => previews[uid])
        .Where(p => p.Status == MapStatus.Unavailable)
        .Select(p => p.Uid)
        .ToList();

    foreach (var uid in queryUids)
        previews[uid].BeginRemoteSearch();

    Task.Run(async () =>
    {
        var client = HttpClientFactory.Create();
        var stringPool = new HashSet<string>();

        foreach (var batchUids in queryUids.Chunk(50))
        {
            var url = repositoryUrl + "hash/" + string.Join(",", batchUids) + "/yaml";
            using (new PerfTimer("RemoteMapDetails"))
            {
                try
                {
                    var result = await client.GetStreamAsync(url);
                    foreach (var kv in MiniYaml.FromStream(result, url, stringPool: stringPool))
                        previews[kv.Key].CompleteRemoteSearch(kv.Value, mapDetailsReceived);
                }
                catch (Exception e)
                {
                    Log.Write("debug", "Remote map query failed with error:");
                    Log.Write("debug", e);
                    Log.Write("debug", $"URL was: {url}");
                }
                foreach (var uid in batchUids)
                {
                    var p = previews[uid];
                    if (p.Status == MapStatus.Searching)
                        p.CompleteRemoteSearch(null, mapQueryFailed);
                }
            }
        }
    });
}
```

### A.2 MapCache.LoadAsyncInternal (MapCache.cs:271-335)

```csharp
void LoadAsyncInternal()
{
    Log.Write("debug", "MapCache.LoadAsyncInternal started");

    const int EmptyDelay = 50;
    const int MaxKeepAlive = 5000 / EmptyDelay;
    var keepAlive = MaxKeepAlive;

    while (true)
    {
        List<MapPreview> todo;
        lock (syncRoot)
        {
            todo = generateMinimap.Where(p => p.GetMinimap() == null).ToList();
            generateMinimap.Clear();
            if (keepAlive > 0) keepAlive--;
            if (keepAlive == 0 && todo.Count == 0)
            {
                previewLoaderThreadShutDown = true;
                break;
            }
        }

        if (todo.Count == 0)
        {
            Thread.Sleep(EmptyDelay);
            continue;
        }
        else
            keepAlive = MaxKeepAlive;

        foreach (var p in todo)
        {
            if (p.Preview != null)
            {
                Game.RunAfterTick(() =>
                {
                    try
                    {
                        p.SetMinimap(sheetBuilder.Add(p.Preview));
                    }
                    catch (Exception e)
                    {
                        Log.Write("debug", "Failed to load minimap with exception:");
                        Log.Write("debug", e);
                    }
                });
            }
            Thread.Sleep(Environment.ProcessorCount == 1 ? 25 : 5);
        }
    }

    if (sheetBuilder.Current != null)
        Game.RunAfterTick(sheetBuilder.Current.ReleaseBuffer);

    Log.Write("debug", "MapCache.LoadAsyncInternal ended");
}
```

### A.3 MapPreview.Png Handling (MapPreview.cs)

```csharp
// Png class is OpenRA's internal PNG decoder. It reads from a Stream
// and exposes Width, Height, and raw pixel data.

// In UpdateFromMap():
if (cache.LoadPreviewImages && p.Contains("map.png"))
    using (var dataStream = p.GetStream("map.png"))
        newData.Preview = new Png(dataStream);

// In CompleteRemoteSearch():
newData.Preview = new Png(new MemoryStream(Convert.FromBase64String(r.minimap)));
```

### A.4 SheetBuilder.Add(Png) Overload (SheetBuilder.cs)

OpenRA's `SheetBuilder` has a specific overload for `Png` objects:
```csharp
public Sprite Add(Png png, bool premultiplied = false)
{
    // Creates sprite from Png's raw pixel data
    return Add(png.Data, SpriteFrameType.Rgba32, new Size(png.Width, png.Height), premultiplied);
}
```

This confirms that minimap data uses `SpriteFrameType.Rgba32` (since Png stores RGBA), and the size comes from `png.Width` / `png.Height`.

---

## Appendix B: File Header Templates

### B.1 HttpClient.ts

```typescript
/**
 * HttpClient.ts -- Fetch wrapper with retry, timeout, and abort support
 * OpenRA 对照: OpenRA.Support.HttpClientFactory + System.Net.Http.HttpClient
 *
 * 核心范式转换:
 * - C# HttpClient.GetStreamAsync(url) → fetchWithRetry(url, config)
 * - C# CancellationToken → AbortSignal
 * - C# Polly retry policy → exponential backoff with jitter
 * - C# Task.Run(async () => ...) → direct async function (JS event loop)
 * - C# Stopwatch (PerfTimer) → performance.now() via PerfTimer class
 */
```

### B.2 E2E Test Page (`__e2e__/manual/ch04-map/minimap-rendering/index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Minimap Rendering - Ch04 Map</title>
  <style>
    /* ... canvas layout ... */
  </style>
</head>
<body>
  <!-- Test page for verifying minimap sprite rendering via SheetBuilder -->
  <script type="module" src="./main.ts"></script>
</body>
</html>
```
