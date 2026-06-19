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
    const response = await fetch(url, { signal })

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
}
