# Chapter 4 Deferred Items Design

## MapCache Extended Features: Remote HTTP Client & Minimap Rendering

**Status**: Design Document  
**Created**: 2026-06-20  
**Affected Modules**: `MapCache.ts`, `MapPreview.ts`, `SheetBuilder.ts`, `Sheet.ts`  
**Related Plan**: `docs/map_system_migration_plan.md` (Chapter 4, Phase E)  
**OpenRA Reference**: `OpenRA/OpenRA.Game/Map/MapCache.cs` (463 lines)

---

## 1. Overview

Chapter 4 (Map & Terrain System) is 100% complete (37/37 files migrated). However, two TODO items in `MapCache.ts` were deferred because they depend on infrastructure decisions that benefit from a standalone design document rather than inline guesswork. This document provides architectural analysis, design decisions, and step-by-step implementation plans for both items.

### 1.1 Deferred Items

| ID | Title | Location | Complexity |
|----|-------|----------|------------|
| TODO-4.E.3 | Full HTTP client with retry logic + perf tracking | `MapCache.ts:517-569` (`queryRemoteMapDetails`) | Medium |
| TODO-4.E.4 | Actual minimap rendering via SheetBuilder.Add | `MapCache.ts:648-661` (`runMinimapLoader`), `MapPreview.ts:621-699` | Medium |

### 1.2 Current State Summary

**TODO-4.E.3** (`queryRemoteMapDetails`): Basic `fetch()` with `response.json()` works for the happy path. Missing: retry logic, performance tracking, proper error granularity (status code discrimination), and the string pool that OpenRA uses during YAML parsing. OpenRA's resource server returns YAML at the `.../yaml` endpoint, but the TS client currently expects JSON.

**TODO-4.E.4** (`runMinimapLoader` minimap generation): `SheetBuilder.addSimple()` is called with hardcoded `{ width: 1, height: 1 }` and `SpriteFrameType = 0`. The preview pixel data exists as a `Uint8Array` in `MapPreview.preview`, but its logical dimensions are discarded by `generatePreviewPixels()`. No `releaseBuffer()` call exists after batch completion.

---

## 2. TODO-4.E.3: Full HTTP Client (Retry Logic + Perf Tracking)

### 2.1 Current State vs. Target State

**Current code** (`MapCache.ts:525-569`):
```typescript
async queryRemoteMapDetails(repositoryUrl, uids, mapDetailsReceived, mapQueryFailed) {
  // ... batch UIDs into groups of 50
  for (const batchUids of batches) {
    const url = `${repositoryUrl}hash/${batchUids.join(',')}/yaml`
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as Record<string, unknown>
      // ... process data
    } catch (e) {
      Log.write('mapcache', LogLevel.WARN, `Remote map query failed: ${String(e)}`)
    }
    // ... mark still-searching maps as failed
  }
}
```

**Target behavior**:
1. Retry transient failures (network errors, 5xx, 429) with exponential backoff
2. Track per-batch performance with `PerfTimer`
3. Log detailed failure information (URL, HTTP status, attempt count) at `LogLevel.DEBUG`
4. Use `AbortController` for clean cancellation
5. Discriminate between retry-able and non-retry-able failures
6. Parse response as JSON (see ADR-4.E.3.1 below)

### 2.2 Architecture Decision Records

#### ADR-4.E.3.1: Response Format -- JSON vs. YAML

**Context**: OpenRA's resource server returns YAML at the `hash/...,.../yaml` endpoint, parsed by `MiniYaml.FromStream()`. The current TS implementation calls `response.json()`, expecting JSON.

**Decision**: **Accept JSON from the remote API.** The web-based map repository should return JSON.

**Rationale**:
- The `RemoteMapData` TypeScript interface (MapPreview.ts:112-130) already defines a JSON-compatible shape with camelCase field names (`title`, `author`, `categories`, etc.)
- `completeRemoteSearch()` (MapPreview.ts:520-587) already processes JSON-shaped objects
- Adding a runtime MiniYAML parser to the client would increase bundle size by ~15-20 KB (gzipped) for a feature used only in the map browser
- The URL path `/yaml` is a server-side convention; the web repository can transparently return JSON from the same endpoint, or a new `/json` variant
- If the server cannot be changed, a thin `YamlToJson` transform can be added as a build step in the repository service, keeping the client simple

**Alternatives considered**:
- **Runtime YAML parsing**: More faithful to OpenRA, but adds bundle weight and parsing overhead. Viable if the server truly cannot be changed. The existing `miniyaml-to-json.ts` utility (build-time tool, 762 lines) could be adapted but is not designed for runtime use.
- **Content negotiation (Accept header)**: Request `Accept: application/json` and let the server decide. Cleanest HTTP approach but requires server cooperation. Recommended as the long-term solution; fall back to JSON-only for now.

**Consequence**: The client is simpler and lighter. If the server returns YAML, a 415 or parsing error will surface as a non-retry-able failure.

#### ADR-4.E.3.2: Retry Strategy

**Decision**: **Exponential backoff with jitter, max 3 retries, 1s initial delay, 30s cap.**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Max retries | 3 | Matches common HTTP client defaults (e.g., `fetch-retry` libraries) |
| Initial delay | 1000 ms | Gives the server time to recover from transient overload |
| Backoff multiplier | 2x | Standard exponential backoff |
| Max delay | 30000 ms | Prevents excessive wait on repeatedly failing endpoints |
| Jitter | +/- 25% | Avoids thundering herd when multiple clients retry simultaneously |

**Retry-able status codes**: 408 (Request Timeout), 429 (Too Many Requests), 500 (Internal Server Error), 502 (Bad Gateway), 503 (Service Unavailable), 504 (Gateway Timeout).

**Non-retry-able**: 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), and all other 4xx codes. Network errors (TypeError from `fetch`) are retry-able.

**Rationale**: The map repository is an optional convenience feature. Aggressive retry (more than 3 attempts) wastes bandwidth and delays the UI. Three attempts with backoff provides a good balance between resilience and responsiveness.

#### ADR-4.E.3.3: String Pool

**Decision**: **Do not implement a string pool in the HTTP client layer.**

**Rationale**: JavaScript engines (V8, SpiderMonkey) already perform string interning for string literals and frequently used strings. The `HashSet<string>` that OpenRA uses is specific to the `MiniYaml.FromStream()` parsing path, where many YAML keys are repeated across map entries. Since the web version receives JSON (already parsed by the browser's native JSON parser), string deduplication is handled by the engine.

**Consequence**: No code needed. The `stringPool` property on MapCache (line 134) remains available if a future YAML parsing path needs it, but the HTTP client does not use it.

#### ADR-4.E.3.4: HTTP Client Abstraction

**Decision**: **No HttpClientFactory abstraction at this time. Use a configurable `fetch` wrapper with retry logic built into `queryRemoteMapDetails`.**

**Rationale**: OpenRA's `HttpClientFactory` exists primarily for testability (injecting mock HTTP clients) and centralized configuration (timeouts, headers). In the web environment:
- Tests can mock `fetch` globally via Vitest's `vi.spyOn(globalThis, 'fetch')` or by replacing `globalThis.fetch`
- Centralized configuration (base URL, default headers) can be handled by a simple options object passed to `queryRemoteMapDetails`
- A full `HttpClientFactory` abstraction would be over-engineered for a single call site

**Future consideration**: If additional modules need HTTP (e.g., replay downloads, server browser), extract a shared `HttpClient` utility class at that point.

### 2.3 Interface Design

```typescript
/**
 * Retry configuration for HTTP requests.
 *
 * OpenRA 对照: HttpClientFactory defaults (no direct C# equivalent;
 *   OpenRA does not implement retry in MapCache, failures are logged and discarded)
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries: number
  /** Initial delay in milliseconds before first retry (default: 1000). */
  initialDelayMs: number
  /** Multiplier applied to delay after each retry (default: 2). */
  backoffMultiplier: number
  /** Maximum delay in milliseconds between retries (default: 30000). */
  maxDelayMs: number
  /** Fraction of delay to use as random jitter, 0-1 (default: 0.25). */
  jitter: number
  /** HTTP status codes that trigger a retry. */
  retryableStatuses: Set<number>
  /** AbortSignal for cancellation (optional). */
  signal?: AbortSignal
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: Readonly<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  jitter: 0.25,
  retryableStatuses: new Set([408, 429, 500, 502, 503, 504]),
}
```

### 2.4 Data Flow

```
queryRemoteMapDetails(repositoryUrl, uids, callbacks)
  │
  ├─ 1. Filter: only Unavailable maps
  ├─ 2. Mark each as Searching (beginRemoteSearch)
  ├─ 3. Chunk UIDs into batches of 50
  │
  └─ For each batch:
       │
       ├─ Start PerfTimer("RemoteMapDetails")
       ├─ fetchWithRetry(url, retryConfig)
       │    │
       │    ├─ Attempt 1: fetch(url)
       │    │   ├─ OK (2xx) → parse JSON → return data
       │    │   ├─ Retryable status → backoff → Attempt 2
       │    │   └─ Non-retryable → throw
       │    └─ After maxRetries: throw AggregateError
       │
       ├─ On success:
       │    ├─ For each (uid, value) in response:
       │    │     previews[uid].completeRemoteSearch(value, mapDetailsReceived)
       │    └─ Log.debug: batch completed in N ms
       │
       ├─ On failure:
       │    ├─ Log.debug: batch failed after N attempts, URL was: ...
       │    └─ Fall through to mark still-Searching as failed
       │
       └─ For each uid in batch:
            if previews[uid].status === Searching:
              previews[uid].completeRemoteSearch(null, mapQueryFailed)
```

### 2.5 Implementation Steps

**Step 1: Create `fetchWithRetry` utility function**

Add `src/OpenRA.Game/Utils/HttpClient.ts` with:
- `fetchWithRetry(url: string, config: Partial<RetryConfig>): Promise<Response>` -- core retry loop with exponential backoff and jitter
- `computeBackoff(attempt: number, config: RetryConfig): number` -- delay calculation
- `isRetryable(status: number, config: RetryConfig): boolean` -- status code check
- Unit tests in `HttpClient.test.ts`: mock `fetch` to simulate retry scenarios

**Step 2: Add `PerfTimer` integration to `queryRemoteMapDetails`**

- Wrap each batch request in `const timer = new PerfTimer(); timer.start()`
- After response (success or final failure), log: `Log.debug('mapcache', \`RemoteMapDetails batch completed in ${timer.stop().toFixed(0)}ms\`)`

**Step 3: Enhance error logging in `queryRemoteMapDetails`**

- Log the URL on failure (currently only logs the error message)
- Log attempt count for retried batches
- Use `LogLevel.DEBUG` for retry attempts, `LogLevel.WARN` for final failure (consistent with OpenRA's `Log.Write("debug", ...)` pattern)

**Step 4: Add `AbortController` support**

- Accept an optional `AbortSignal` in `queryRemoteMapDetails` options
- Pass it through to `fetchWithRetry`
- On abort, stop processing remaining batches and mark in-progress previews as `Unavailable`

**Step 5: Write unit tests**

- `MapCache.test.ts`: test retry behavior, batch chunking, success/failure callbacks, abort behavior
- `HttpClient.test.ts`: test backoff calculation, jitter range, retryable status discrimination

### 2.6 Files to Create / Modify

| File | Action | Lines (est.) |
|------|--------|--------------|
| `src/OpenRA.Game/Utils/HttpClient.ts` | CREATE | ~120 |
| `src/OpenRA.Game/Utils/HttpClient.test.ts` | CREATE | ~200 |
| `src/OpenRA.Game/Map/MapCache.ts` | MODIFY (~lines 517-569) | ~60 changed |
| `src/OpenRA.Game/Map/MapCache.test.ts` | MODIFY | ~150 added |

---

## 3. TODO-4.E.4: Actual Minimap Rendering via SheetBuilder.Add

### 3.1 Current State vs. Target State

**Current code** (`MapCache.ts:648-657`):
```typescript
const sprite = this._sheetBuilder.addSimple(
  p.preview,              // Uint8Array -- correct pixel data
  0,                      // SpriteFrameType -- hardcoded to 0 (Indexed8), WRONG
  { width: 1, height: 1 }, // Size -- hardcoded, WRONG
)
p.setMinimap(sprite)
```

**Target behavior**:
1. Use correct `SpriteFrameType.Bgra32` (value 1) since preview data is BGRA32
2. Use actual preview image dimensions stored in `MapPreview`
3. Call `sheetBuilder.current?.releaseBuffer()` after batch completion to free CPU memory
4. Handle `SheetOverflowException` gracefully (log warning, skip that preview)

### 3.2 Architecture Decision Records

#### ADR-4.E.4.1: Preview Dimension Storage

**Context**: `MapPreview.generatePreviewPixels()` computes `previewWidth` and `previewHeight` as local variables (MapPreview.ts:674-675) but discards them after creating the `Uint8Array`. Similarly, `base64ToUint8Array()` in `completeRemoteSearch()` decodes base64 PNG data but does not store the image dimensions. `SheetBuilder.addSimple()` needs `{ width, height }` to allocate atlas space.

**Decision**: **Store `previewSize: { width: number; height: number } | null` as a single public property on `MapPreview`.**

**Rationale**:
- A single `{ width, height }` object is more concise than two separate properties and avoids
  the `null`/`0` ambiguity for "no preview" state
- The dimensions are inherent properties of the preview image, not transient computation results
- Storing them avoids redundant dimension extraction (which would require parsing PNG headers
  or re-sampling terrain data)
- `generatePreviewPixels()` already computes the correct values; it just needs to store them
- `SheetBuilder.addSimple()` accepts a `Size` object, so the stored format matches the consumer directly

**Alternative considered**:
- **Separate `previewWidth`/`previewHeight` properties**: More self-documenting but requires two null
  checks and two assignments. The `previewSize` object approach is adopted for conciseness.
- **Compute dimensions on demand**: Parse PNG headers or infer from `Uint8Array.byteLength / 4` and
  known aspect ratios. Fragile, slow, and adds unnecessary complexity.

**Consequence**: `MapPreview` gains one `previewSize` property. All code paths that set `this.preview` must also set `this.previewSize`.

#### ADR-4.E.4.2: SpriteFrameType for Minimap Data

**Context**: The current code passes `0` (`SpriteFrameType.Indexed8`) to `addSimple()`. Preview data is RGBA pixel data (from `generatePreviewPixels()` or base64-decoded PNG).

**Decision**: **Use `SpriteFrameType.Bgra32` (value 1).**

**Rationale**:
- `generatePreviewPixels()` produces data with channel order R, G, B, A (see MapPreview.ts:691-694, where bit shifts extract R/G/B/A in that order)
- However, OpenRA's `Util.ChannelMasks = [2, 1, 0, 3]` means the CPU-side buffer treats byte 0 as B, byte 1 as G, byte 2 as R, byte 3 as A -- i.e., BGRA order
- `SheetBuilder` is constructed with `SheetType.BGRA` (MapCache.ts:182), which expects BGRA channel order
- `frameTypeToSheetType(SpriteFrameType.Bgra32)` returns `SheetType.BGRA` -- types are consistent
- `fastCopyIntoChannel()` for `Bgra32` copies bytes as-is (no channel swizzling needed for BGRA-to-BGRA)

**Correction needed**: `generatePreviewPixels()` currently writes in RGBA order (R at byte 0). For BGRA consistency, this should be B at byte 0, G at byte 1, R at byte 2, A at byte 3. Alternatively, use `SpriteFrameType.Rgba32` and let `fastCopyIntoChannel` handle the swizzle. The pragmatically simpler fix: use `SpriteFrameType.Rgba32` (since the generator writes R,G,B,A), and `fastCopyIntoChannel` already handles Rgba32-to-BGRA conversion (it extracts channels by the CHANNEL_MASKS mapping).

**Final decision**: Use `SpriteFrameType.Rgba32` for generated previews. Use `SpriteFrameType.Bgra32` for base64-decoded PNG data (PNG decoders typically output RGBA, so same reasoning applies -- use Rgba32 if the data is RGBA, or test empirically).

**Recommendation**: Add a comment at the call site explaining the channel order.

#### ADR-4.E.4.3: releaseBuffer Timing

**Context**: OpenRA calls `Game.RunAfterTick(sheetBuilder.Current.ReleaseBuffer)` after the minimap loading thread exits (MapCache.cs:331-332). `ReleaseBuffer` marks the Sheet's CPU buffer for reclamation after the next GPU upload. In C#, this must be queued to the render thread because the loader thread cannot directly touch GPU resources.

**Decision**: **Call `this._sheetBuilder.current?.releaseBuffer()` at the end of `runMinimapLoader()`, after the batch loop, before resetting `_previewLoaderRunning`.**

**Rationale**:
- JavaScript is single-threaded; there is no render thread / loader thread distinction
- GPU uploads in Babylon.js happen during `scene.render()`, which runs on the same thread
- Calling `releaseBuffer()` after the batch is complete is safe -- the Sheet's `getTexture()` method will handle the upload on next use
- The C# pattern of `Game.RunAfterTick()` is equivalent to `Promise.resolve().then()` or placing the call after the batch loop in JS

**Placement**: At `MapCache.ts` line ~666, after the `for (const p of todo)` loop and before line ~668:
```typescript
// Release the buffer by forcing changes to be written out to the texture,
// allowing the buffer to be reclaimed by GC.
// OpenRA 对照: Game.RunAfterTick(sheetBuilder.Current.ReleaseBuffer)
if (this._sheetBuilder.current) {
  this._sheetBuilder.current.releaseBuffer()
}
```

### 3.3 MapPreview Interface Changes

Add two public readonly properties:

```typescript
export class MapPreview {
  // ... existing properties ...

  /**
   * Width of the preview image in pixels.
   * 0 when no preview is available.
   *
   * OpenRA 对照: Png.Width (no direct property; Png object stores dimensions internally)
   */
  previewWidth: number

  /**
   * Height of the preview image in pixels.
   * 0 when no preview is available.
   *
   * OpenRA 对照: Png.Height
   */
  previewHeight: number
}
```

**Initialization** (constructor, MapPreview.ts:311-341): Both default to `0`.

**Mutation points**:
1. `completeRemoteSearch()` (line ~570): After `this.preview = this.base64ToUint8Array(remoteData.minimap)`, set dimensions. Since the data is base64-encoded PNG, the dimensions are not trivially extractable without a PNG parser. **Mitigation**: For remote maps, the `minimap` field is a base64 PNG. We can either parse the PNG header (first 24 bytes contain width/height at offsets 16-23 for IHDR) or accept that remote minimaps are already correctly sized. **Recommendation**: Parse PNG IHDR chunk to extract dimensions, or store dimensions in the RemoteMapData interface if the API can provide them. Simplest approach: parse the PNG header (reliable, few lines of code).
2. `generatePreviewPixels()` (line ~698): After `this.preview = pixels`, set `this.previewWidth = previewWidth` and `this.previewHeight = previewHeight`.
3. `setMinimap()` (line ~646): If called with a `Uint8Array`, the dimensions should already be set. If called with a `Sprite` (post-4.E.4), the Sprite already carries dimension info via `sprite.bounds`.

### 3.4 SheetBuilder Integration

The corrected minimap rendering code in `runMinimapLoader()`:

```typescript
// Render the minimap into the shared sheet
for (const p of todo) {
  if (this._previewLoaderCancelled) break

  if (p.preview !== null && p.previewWidth > 0 && p.previewHeight > 0) {
    try {
      // OpenRA 对照: p.SetMinimap(sheetBuilder.Add(p.Preview))
      // Preview data is RGBA32 pixel data (from generatePreviewPixels or PNG decode).
      // SheetBuilder is BGRA type, and fastCopyIntoChannel handles Rgba32→BGRA conversion.
      const sprite = this._sheetBuilder.addSimple(
        p.preview,
        SpriteFrameType.Rgba32,
        { width: p.previewWidth, height: p.previewHeight },
      )
      p.setMinimap(sprite)
    } catch (e) {
      // SheetOverflowException or other allocation failure
      Log.write('mapcache', LogLevel.WARN, `Failed to load minimap: ${String(e)}`)
    }
  }

  // Yield to prevent UI jank (OpenRA 对照: Thread.Sleep(5))
  await new Promise((resolve) => setTimeout(resolve, 5))
}

// Release the buffer by forcing changes to be written out to the texture,
// allowing the buffer to be reclaimed by GC.
// OpenRA 对照: Game.RunAfterTick(sheetBuilder.Current.ReleaseBuffer)
if (this._sheetBuilder.current) {
  this._sheetBuilder.current.releaseBuffer()
}
```

### 3.5 Implementation Steps

**Step 1: Add `previewWidth` / `previewHeight` to MapPreview**

- Add property declarations with JSDoc
- Initialize to `0` in constructor
- Set in `generatePreviewPixels()` after creating the pixel buffer
- Set in `completeRemoteSearch()` after base64 decode (requires PNG header parsing)
- Set in `setMinimap()` when receiving a `Uint8Array` (dimensions already set by caller)

**Step 2: Implement PNG header parser utility**

- Add `src/OpenRA.Game/Utils/PngHeader.ts` with `parsePngDimensions(data: Uint8Array): { width: number; height: number } | null`
- Parse the 8-byte PNG signature + 4-byte IHDR length + 4-byte 'IHDR' tag + 4-byte width + 4-byte height (24 bytes total)
- Return null if data is too short or signature is invalid
- This is needed for base64-decoded PNG minimaps from remote API

**Step 3: Fix `runMinimapLoader()` sprite creation**

- Import `SpriteFrameType` from `../Graphics/Util.js`
- Replace hardcoded `0` with `SpriteFrameType.Rgba32`
- Replace `{ width: 1, height: 1 }` with `{ width: p.previewWidth, height: p.previewHeight }`
- Add the null check `p.previewWidth > 0 && p.previewHeight > 0` to skip previews without valid dimensions

**Step 4: Add `releaseBuffer()` call after batch**

- After the `for (const p of todo)` loop, call `this._sheetBuilder.current?.releaseBuffer()`
- Add comment referencing OpenRA `MapCache.cs:331-332`

**Step 5: Write unit tests**

- `MapPreview.test.ts`: verify `previewWidth`/`previewHeight` are set by `generatePreviewPixels()`
- `MapCache.test.ts`: verify `runMinimapLoader` correctly passes dimensions to `addSimple`
- `PngHeader.test.ts`: test PNG dimension parsing with various valid/invalid inputs

### 3.6 Files to Create / Modify

| File | Action | Lines (est.) |
|------|--------|--------------|
| `src/OpenRA.Game/Utils/PngHeader.ts` | CREATE | ~50 |
| `src/OpenRA.Game/Utils/PngHeader.test.ts` | CREATE | ~120 |
| `src/OpenRA.Game/Map/MapPreview.ts` | MODIFY | ~20 changed/added |
| `src/OpenRA.Game/Map/MapPreview.test.ts` | MODIFY | ~80 added |
| `src/OpenRA.Game/Map/MapCache.ts` | MODIFY (~lines 648-668) | ~30 changed |
| `src/OpenRA.Game/Map/MapCache.test.ts` | MODIFY | ~100 added |

---

## 4. Dependencies

### 4.1 Between the Two Deferred Items

The two items are **independent** and can be implemented in parallel.

- TODO-4.E.3 deals with remote HTTP fetching; minimap data from remote sources arrives via `completeRemoteSearch()` which decodes base64 PNG. This does not go through `runMinimapLoader()`.
- TODO-4.E.4 deals with local minimap generation in the background loader; it only processes previews queued via `cacheMinimap()`.

However, both touch `MapPreview.completeRemoteSearch()`: TODO-4.E.4 Step 1 needs `completeRemoteSearch()` to set `previewWidth`/`previewHeight` when decoding remote minimaps, which overlaps with TODO-4.E.3's data flow. This is a minor touchpoint, not a blocking dependency.

### 4.2 Dependencies on External Modules

| Module | Used By | Status |
|--------|---------|--------|
| `SheetBuilder` / `Sheet` | TODO-4.E.4 | COMPLETE (migrated, reviewed) |
| `SpriteFrameType` (Util.ts) | TODO-4.E.4 | COMPLETE (migrated, reviewed) |
| `PerfTimer` | TODO-4.E.3 | COMPLETE (migrated, reviewed) |
| `Log` | TODO-4.E.3 | COMPLETE (migrated, reviewed) |
| `MapPreview` | Both | COMPLETE (migrated, reviewed) |
| `MapStatus` / `MapClassification` | TODO-4.E.3 | COMPLETE (migrated, reviewed) |

All dependencies are already migrated and reviewed. No blocking prerequisites.

### 4.3 Recommended Implementation Order

1. **TODO-4.E.4 first** (minimap rendering) -- changes are more localized, touch fewer files, and the visual improvement (actual sprite creation vs. 1x1 placeholder) is more immediately testable
2. **TODO-4.E.3 second** (HTTP client) -- involves a new utility module and more complex test scenarios

---

## 5. Risk Assessment

### 5.1 TODO-4.E.3 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Map repository returns YAML, breaking `response.json()` | Low | Medium | The endpoint path `.../yaml` suggests YAML, but the server may be configurable. If YAML is returned, add a `Content-Type` check and, if `text/yaml` or `application/x-yaml`, use a lightweight YAML parser or request the server team to add JSON support. |
| Retry storms: multiple clients retry simultaneously after a server hiccup | Low | Low | Jitter (+/- 25%) desynchronizes retry timing across clients. Map repository queries are user-initiated (map browser), not automatic, so simultaneous retries are unlikely. |
| `AbortController` not passed through correctly | Low | Low | Simple pass-through pattern; well-tested in the platform. |
| Large batch responses exceed memory limits | Very Low | Low | Batches are capped at 50 UIDs. Response size per map is ~2 KB. Max batch response: ~100 KB. Trivial for modern browsers. |

### 5.2 TODO-4.E.4 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `generatePreviewPixels()` produces RGBA, but SheetBuilder expects BGRA | High | Medium | Use `SpriteFrameType.Rgba32` explicitly. `fastCopyIntoChannel` handles Rgba32-to-BGRA conversion via CHANNEL_MASKS. Add a comment documenting the channel order contract. |
| PNG header parsing fails for unusual PNG variants | Low | Low | Only parse the IHDR chunk (first chunk, bytes 8-32). This is standardized across all PNG variants. Skip non-PNG data (check 8-byte signature). Return null on failure, which prevents minimap rendering but does not crash. |
| `SheetOverflowException` during batch processing | Low | Medium | Catch the exception per-preview (as OpenRA does). The failed preview simply won't have a minimap sprite; it can be retried on next `cacheMinimap()` call. The map preview sheet size (`mapPreviewSheetSize`) is controlled by the manifest and should be sized for the largest expected minimap. |
| `releaseBuffer()` called while Sheet has pending uploads | Very Low | Low | `releaseBuffer()` only sets a flag (`_releaseBufferOnCommit = true`). The actual buffer release happens in `getTexture()`, which is called during rendering. No race condition in single-threaded JS. |
| Preview image dimensions mismatch with pixel buffer length | Low | Medium | Validate: `previewWidth * previewHeight * 4 === preview.byteLength`. Skip the preview if the check fails. Add this validation in `runMinimapLoader()`. |

### 5.3 Cross-Cutting Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Both items modify `MapPreview`, creating merge conflicts if implemented in parallel | Medium | Low | The changes touch different properties (TODO-4.E.3 doesn't add properties; TODO-4.E.4 adds two). Coordinate via git branching or implement sequentially. |
| Test mocking complexity for `fetch` retry scenarios | Medium | Low | Vitest's `vi.spyOn(globalThis, 'fetch')` is sufficient. Mock implementations can return different responses per call to simulate retry sequences. |

---

## 6. Acceptance Criteria Summary

### TODO-4.E.3
- [ ] `fetchWithRetry` utility created with exponential backoff, jitter, and configurable retry count
- [ ] `queryRemoteMapDetails` wraps each batch in `PerfTimer`
- [ ] `queryRemoteMapDetails` retries transient failures (5xx, 429, network errors) up to 3 times
- [ ] `queryRemoteMapDetails` does not retry client errors (4xx except 408, 429)
- [ ] `queryRemoteMapDetails` logs URL and attempt count on failure at DEBUG level
- [ ] `AbortController` support: aborting stops remaining batches
- [ ] Unit tests cover: retry success, retry exhaustion, non-retryable failure, abort, backoff calculation, jitter range

### TODO-4.E.4
- [ ] `MapPreview` has `previewWidth` and `previewHeight` properties, set to 0 by default
- [ ] `generatePreviewPixels()` stores computed dimensions
- [ ] `completeRemoteSearch()` stores dimensions from decoded base64 PNG (via PNG header parser)
- [ ] `runMinimapLoader()` passes `SpriteFrameType.Rgba32` and actual dimensions to `addSimple()`
- [ ] `runMinimapLoader()` calls `sheetBuilder.current?.releaseBuffer()` after batch completion
- [ ] `runMinimapLoader()` validates `previewWidth * previewHeight * 4 === preview.byteLength`
- [ ] Unit tests cover: dimension storage, dimension validation, `releaseBuffer()` call, `SheetOverflowException` handling

---

## 7. References

- OpenRA source: `OpenRA/OpenRA.Game/Map/MapCache.cs` (lines 223-269 for remote query, lines 271-335 for minimap loader)
- TS implementation: `src/OpenRA.Game/Map/MapCache.ts` (822 lines)
- TS implementation: `src/OpenRA.Game/Map/MapPreview.ts` (908 lines)
- SheetBuilder: `src/OpenRA.Game/Graphics/SheetBuilder.ts` (502 lines)
- Sheet: `src/OpenRA.Game/Graphics/Sheet.ts` (releaseBuffer at line 311)
- Util (SpriteFrameType): `src/OpenRA.Game/Graphics/Util.ts` (lines 25-38)
- Log: `src/OpenRA.Game/Utils/Log.ts` (143 lines)
- PerfTimer: `src/OpenRA.Game/Utils/PerfTimer.ts` (131 lines)
- Migration plan: `docs/map_system_migration_plan.md` (Chapter 4, Phase E)
