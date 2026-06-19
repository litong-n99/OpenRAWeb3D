/**
 * DownloadManager.ts — Streaming download with progress reporting, SHA1
 * verification, and mirror fallback for the Content Installer pipeline.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Installation/DownloadPackageLogic.cs
 *             (DownloadUrl method — streaming download + SHA1 verification)
 *
 * 核心范式转换:
 * - C# HttpClient.GetAsync() + ReadAsStreamWithProgress() → browser `fetch()`
 *   with ReadableStream reader + manual chunk accumulation
 * - C# FileStream temp file + CryptoUtil.SHA1Hash(Stream)
 *   → in-memory ArrayBuffer + Web Crypto API Sha1Verifier
 * - C# CancellationTokenSource + token → AbortController + AbortSignal
 * - C# retry via UI button → programmatic downloadWithRetry() with up to 3 attempts
 * - C# progress via DownloadProgressDelegate → onProgress callback with
 *   (received, total, percentage) tuple
 */

import { Sha1Verifier } from './Sha1Verifier.js'
import { proxiedFetch } from './ProxyResolver.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Initial buffer size for download accumulation (64 KB). */
const INITIAL_BUFFER_SIZE = 64 * 1024

/** Minimum interval between progress callbacks (milliseconds). */
const PROGRESS_INTERVAL_MS = 100

/** Minimum byte delta between progress callbacks (1 MB). */
const PROGRESS_INTERVAL_BYTES = 1024 * 1024

/** Maximum number of retry attempts across all mirrors. */
const MAX_RETRY_ATTEMPTS = 3

// ---------------------------------------------------------------------------
// DownloadManager
// ---------------------------------------------------------------------------

export class DownloadManager {
  /**
   * Download data from the given URL with progress reporting and optional
   * SHA1 verification.
   *
   * Uses the browser Fetch API with ReadableStream reader for streaming
   * download. Accumulates data in an in-memory buffer that grows as needed.
   *
   * Progress is reported at most every ~100ms or ~1MB, whichever interval
   * is larger (i.e. whichever is less frequent).
   *
   * OpenRA 对照: DownloadPackageLogic.DownloadUrl() — the inner async lambda
   *
   * @param url — The URL to download from.
   * @param expectedSha1 — Expected SHA1 hex string for verification.
   *                       Empty string skips verification.
   * @param onProgress — Progress callback (received bytes, total bytes, percentage).
   *                     total = 0 means Content-Length was not available.
   * @param signal — Optional AbortSignal for cancellation.
   * @returns The downloaded data as an ArrayBuffer.
   * @throws Error on HTTP error, SHA1 mismatch, or cancellation.
   */
  async download(
    url: string,
    expectedSha1: string,
    onProgress: (received: number, total: number, percentage: number) => void,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const response = await proxiedFetch(url, { signal })

    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`)
    }

    const contentLength = response.headers.get('Content-Length')
    const total = contentLength ? parseInt(contentLength, 10) : 0
    const body = response.body

    if (!body) {
      // No body — return empty buffer
      const empty = new ArrayBuffer(0)
      if (expectedSha1) {
        const ok = await Sha1Verifier.verify(empty, expectedSha1)
        if (!ok) {
          const actual = await Sha1Verifier.compute(empty)
          throw new Error(
            `SHA1 mismatch: expected ${expectedSha1}, got ${actual}`,
          )
        }
      }
      return empty
    }

    const reader = body.getReader()

    let buffer = new Uint8Array(INITIAL_BUFFER_SIZE)
    let received = 0
    let lastReportTime = Date.now()
    let lastReportBytes = 0

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        // Ensure buffer has enough capacity
        if (received + value.length > buffer.length) {
          let newSize = buffer.length
          while (newSize < received + value.length) {
            newSize *= 2
          }
          const newBuffer = new Uint8Array(newSize)
          newBuffer.set(buffer.subarray(0, received))
          buffer = newBuffer
        }

        buffer.set(value, received)
        received += value.length

        // Throttled progress reporting
        const now = Date.now()
        const deltaBytes = received - lastReportBytes
        if (
          now - lastReportTime >= PROGRESS_INTERVAL_MS ||
          deltaBytes >= PROGRESS_INTERVAL_BYTES
        ) {
          const percentage = total > 0 ? Math.round((received / total) * 100) : 0
          onProgress(received, total, percentage)
          lastReportTime = now
          lastReportBytes = received
        }
      }
    } catch (err) {
      // Re-throw AbortError so callers can distinguish cancellation
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }
      throw err
    } finally {
      reader.releaseLock()
    }

    // Final progress report
    {
      const finalPercent = total > 0 ? 100 : 0
      onProgress(received, total, finalPercent)
    }

    // Trim buffer to exact size (single slice on the ArrayBuffer)
    const result = buffer.buffer.slice(0, received) as ArrayBuffer

    // SHA1 verification
    if (expectedSha1) {
      const ok = await Sha1Verifier.verify(result, expectedSha1)
      if (!ok) {
        const actual = await Sha1Verifier.compute(result)
        // Prefix with "SHA1_MISMATCH:" so downloadWithRetry can distinguish
        // permanent (hash mismatch) vs retry-eligible (network) errors.
        throw new Error(
          `SHA1_MISMATCH: expected ${expectedSha1}, got ${actual}`,
        )
      }
    }

    return result
  }

  /**
   * Download with mirror fallback.
   *
   * Tries each mirror URL in sequence until one succeeds. Makes at most
   * {@link MAX_RETRY_ATTEMPTS} (3) total download attempts across all mirrors.
   * If the signal is aborted, stops immediately without trying remaining mirrors.
   *
   * OpenRA 对照: DownloadPackageLogic.ShowDownloadDialog() — retry button
   *             calls ShowDownloadDialog() again, which may pick a different
   *             mirror. This is the automatic equivalent.
   *
   * @param mirrors — Array of mirror URLs to try.
   * @param expectedSha1 — Expected SHA1 hex string for verification.
   * @param onProgress — Progress callback (reset for each attempt).
   * @param signal — Optional AbortSignal for cancellation.
   * @returns The downloaded data as an ArrayBuffer.
   * @throws Error if all retry attempts are exhausted or signal is aborted.
   */
  async downloadWithRetry(
    mirrors: string[],
    expectedSha1: string,
    onProgress: (received: number, total: number, percentage: number) => void,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    if (mirrors.length === 0) {
      throw new Error('No mirrors available for download')
    }

    let lastError: Error | undefined
    let attempts = 0
    let mirrorIndex = 0

    while (attempts < MAX_RETRY_ATTEMPTS && mirrorIndex < mirrors.length) {
      // Check if already aborted before trying
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }

      const url = mirrors[mirrorIndex]!
      attempts++

      try {
        return await this.download(url, expectedSha1, onProgress, signal)
      } catch (err) {
        // If aborted, stop immediately
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err
        }
        // SHA1 mismatch is permanent — retrying a different mirror won't help
        if (err instanceof Error && err.message.startsWith('SHA1_MISMATCH:')) {
          throw err
        }
        lastError = err instanceof Error ? err : new Error(String(err))
        mirrorIndex++
      }
    }

    throw new Error(
      `Download failed after ${attempts} attempt(s): ${lastError?.message ?? 'unknown error'}`,
    )
  }

  // ---------------------------------------------------------------------------
  // Resume Download (CI-B.4)
  // ---------------------------------------------------------------------------

  /**
   * Download with resume support using HTTP Range requests and IndexedDB
   * chunk persistence.
   *
   * Before starting, checks IndexedDB `openra-downloads` for a partial
   * download record at the given URL. If found, resumes from the stored
   * byte offset by sending a `Range: bytes={stored}-` header. If the server
   * supports Range requests (returns 206), appends new data to the existing
   * partial buffer. If the server ignores the Range header (returns 200),
   * discards the partial data and starts fresh.
   *
   * After download completion, verifies SHA1 and cleans up the IndexedDB
   * record on success. On SHA1 mismatch, deletes the IndexedDB record so
   * the next call starts fresh.
   *
   * NOTE: Not all mirrors support Range requests. This implementation
   * gracefully falls back to a full download when the server returns 200
   * instead of 206.
   *
   * OpenRA 对照: No direct C# equivalent — desktop OpenRA does not support
   *             resume (always downloads from scratch). This is a web-specific
   *             enhancement for unreliable network connections.
   *
   * @param url — The URL to download from.
   * @param expectedSha1 — Expected SHA1 hex string for verification.
   * @param onProgress — Progress callback (received bytes, total bytes, percentage).
   * @param signal — Optional AbortSignal for cancellation.
   * @returns The downloaded data as an ArrayBuffer.
   * @throws Error on HTTP error, SHA1 mismatch, or cancellation.
   */
  async downloadWithResume(
    url: string,
    expectedSha1: string,
    onProgress: (received: number, total: number, percentage: number) => void,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const DB_NAME = 'openra-downloads'
    const STORE_NAME = 'chunks'

    // Graceful IndexedDB access helper
    const openDb = (): Promise<IDBDatabase | null> => {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, 1)
          req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME)
            }
          }
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          req.onblocked = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
    }

    const getStoredBytes = (
      db: IDBDatabase,
    ): Promise<ArrayBuffer | null> => {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly')
          const store = tx.objectStore(STORE_NAME)
          const req = store.get(url)
          req.onsuccess = () => {
            resolve((req.result as ArrayBuffer) ?? null)
          }
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
    }

    const saveChunks = (
      db: IDBDatabase,
      buffer: ArrayBuffer,
    ): Promise<void> => {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          const store = tx.objectStore(STORE_NAME)
          store.put(buffer, url)
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
          tx.onabort = () => resolve()
        } catch {
          resolve()
        }
      })
    }

    const deleteChunks = (db: IDBDatabase): Promise<void> => {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          const store = tx.objectStore(STORE_NAME)
          store.delete(url)
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
          tx.onabort = () => resolve()
        } catch {
          resolve()
        }
      })
    }

    // Phase 1: Check for partial download in IndexedDB
    const db = await openDb()
    let partialBuffer: ArrayBuffer | null = null
    let storedBytes = 0

    if (db) {
      partialBuffer = await getStoredBytes(db)
      if (partialBuffer && partialBuffer.byteLength > 0) {
        storedBytes = partialBuffer.byteLength
      } else {
        partialBuffer = null
      }
    }

    // Phase 2: Fetch with optional Range header
    const headers: Record<string, string> = {}
    if (storedBytes > 0) {
      headers['Range'] = `bytes=${storedBytes}-`
    }

    const response = await proxiedFetch(url, {
      signal,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    })

    if (!response.ok) {
      // 416 Range Not Satisfiable — stored bytes exceed file size, restart
      if (response.status === 416) {
        if (db) await deleteChunks(db)
        // Retry without Range header
        return this.downloadWithResume(url, expectedSha1, onProgress, signal)
      }
      throw new Error(`Download failed: HTTP ${response.status}`)
    }

    const contentLengthRaw = response.headers.get('Content-Length')
    let contentLength = contentLengthRaw ? parseInt(contentLengthRaw, 10) : 0

    const isRangeResponse = response.status === 206
    let total: number

    if (isRangeResponse && storedBytes > 0) {
      // Server supports resume — append to existing buffer
      total = storedBytes + contentLength
    } else if (response.status === 200 && storedBytes > 0) {
      // Server ignored Range header — discard partial, start fresh
      storedBytes = 0
      partialBuffer = null
      if (db) await deleteChunks(db)
      total = contentLength
    } else {
      total = contentLength
    }

    const body = response.body
    if (!body) {
      // No body
      const result = partialBuffer ?? new ArrayBuffer(0)
      if (expectedSha1) {
        const ok = await Sha1Verifier.verify(result, expectedSha1)
        if (!ok) {
          if (db) await deleteChunks(db)
          const actual = await Sha1Verifier.compute(result)
          throw new Error(
            `SHA1_MISMATCH: expected ${expectedSha1}, got ${actual}`,
          )
        }
      }
      if (db) await deleteChunks(db)
      return result
    }

    const reader = body.getReader()

    // Allocate buffer
    let bufferSize = Math.max(INITIAL_BUFFER_SIZE, storedBytes + INITIAL_BUFFER_SIZE)
    let buffer: Uint8Array

    if (partialBuffer) {
      buffer = new Uint8Array(bufferSize)
      buffer.set(new Uint8Array(partialBuffer), 0)
    } else {
      buffer = new Uint8Array(bufferSize)
    }
    let received = storedBytes
    let lastReportTime = Date.now()
    let lastReportBytes = received

    // Periodic IndexedDB save interval (every ~1MB or 5 seconds)
    let lastSaveBytes = received
    const SAVE_INTERVAL_BYTES = 1024 * 1024 // 1 MB
    let lastSaveTime = Date.now()
    const SAVE_INTERVAL_MS = 5000

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        // Ensure buffer capacity
        if (received + value.length > buffer.length) {
          let newSize = buffer.length
          while (newSize < received + value.length) {
            newSize *= 2
          }
          const newBuffer = new Uint8Array(newSize)
          newBuffer.set(buffer.subarray(0, received))
          buffer = newBuffer
        }

        buffer.set(value, received)
        received += value.length

        // Throttled progress reporting
        const now = Date.now()
        const deltaBytes = received - lastReportBytes
        if (
          now - lastReportTime >= PROGRESS_INTERVAL_MS ||
          deltaBytes >= PROGRESS_INTERVAL_BYTES
        ) {
          const percentage = total > 0 ? Math.round((received / total) * 100) : 0
          onProgress(received, total, percentage)
          lastReportTime = now
          lastReportBytes = received
        }

        // Periodic IndexedDB save
        const saveDeltaBytes = received - lastSaveBytes
        const saveDeltaTime = now - lastSaveTime
        if (
          db &&
          (saveDeltaBytes >= SAVE_INTERVAL_BYTES ||
            saveDeltaTime >= SAVE_INTERVAL_MS)
        ) {
          const slice = buffer.buffer.slice(0, received) as ArrayBuffer
          await saveChunks(db, slice)
          lastSaveBytes = received
          lastSaveTime = now
        }
      }
    } catch (err) {
      // NOTE: Do NOT call reader.releaseLock() here — the finally block
      // (line below) already releases the lock. Double releaseLock() throws
      // TypeError, masking the original error.
      // Save partial data on error (unless aborted)
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        if (db && received > 0) {
          const slice = buffer.buffer.slice(0, received) as ArrayBuffer
          await saveChunks(db, slice)
        }
      }
      throw err
    } finally {
      reader.releaseLock()
    }

    // Final progress report
    {
      const finalPercent = total > 0 ? 100 : 0
      onProgress(received, total, finalPercent)
    }

    // Trim buffer to exact size
    const result = buffer.buffer.slice(0, received) as ArrayBuffer

    // SHA1 verification
    if (expectedSha1) {
      const ok = await Sha1Verifier.verify(result, expectedSha1)
      if (!ok) {
        // SHA1 mismatch — delete stored chunks so next call starts fresh
        if (db) await deleteChunks(db)
        const actual = await Sha1Verifier.compute(result)
        throw new Error(
          `SHA1_MISMATCH: expected ${expectedSha1}, got ${actual}`,
        )
      }
    }

    // Clean up IndexedDB on success
    if (db) await deleteChunks(db)

    return result
  }
}
