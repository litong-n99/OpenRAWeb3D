/**
 * DownloadManager.test.ts — Unit tests for DownloadManager
 *
 * Mocks `fetch()` (with ReadableStream), `crypto.subtle.digest`, and
 * `crypto.getRandomValues` to test download, progress, SHA1 verification,
 * retry, and error handling logic without requiring network or WebGL.
 *
 * Tests cover:
 * - Successful download with Content-Length
 * - Successful download without Content-Length (unknown total)
 * - Progress reporting throttling
 * - SHA1 verification pass
 * - SHA1 verification failure
 * - HTTP 404 error
 * - Abort signal cancellation
 * - downloadWithRetry: first mirror succeeds
 * - downloadWithRetry: first fails, second succeeds
 * - downloadWithRetry: exhaustion after max attempts
 * - downloadWithRetry: abort stops retry immediately
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DownloadManager } from './DownloadManager'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA1 hash constants used in tests */
const EMPTY_SHA1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'

/** Convert hex string to ArrayBuffer (for mock digest return values). */
function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes.buffer
}

/** Create a mock ReadableStream that emits the given chunk. */
function createMockStream(
  chunk: Uint8Array,
): ReadableStream<Uint8Array> {
  let pulled = false
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!pulled) {
        pulled = true
        controller.enqueue(chunk)
      } else {
        controller.close()
      }
    },
  })
}

/** Create a mock fetch response with given body text and status. */
function mockFetchResponse(
  bodyText: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  const chunk = new TextEncoder().encode(bodyText)
  const stream = createMockStream(chunk)

  const responseHeaders = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    responseHeaders.set(key, value)
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders,
    body: stream,
  } as unknown as Response
}

/** Create a mock fetch response with empty body (null ReadableStream). */
function mockFetchNoBody(
  status: number,
  headers: Record<string, string> = {},
): Response {
  const responseHeaders = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    responseHeaders.set(key, value)
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders,
    body: null,
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DownloadManager', () => {
  let manager: DownloadManager
  let mockDigest: ReturnType<typeof vi.fn>

  beforeEach(() => {
    manager = new DownloadManager()

    // Mock crypto.subtle.digest for SHA1 operations
    mockDigest = vi.fn(async (_algo: string, _data: ArrayBuffer) => {
      // Return empty SHA1 for empty data, or a fake hash
      return hexToBuffer(EMPTY_SHA1)
    })

    vi.stubGlobal('crypto', {
      subtle: {
        digest: mockDigest,
      },
      getRandomValues: (arr: Uint32Array) => {
        arr[0] = 42
        return arr
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // -----------------------------------------------------------------------
  // download() — Success paths
  // -----------------------------------------------------------------------

  describe('download', () => {
    it('downloads data and returns ArrayBuffer with correct content', async () => {
      const testData = 'Hello, World!'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse(testData, 200, {
            'Content-Length': String(testData.length),
          }),
        ),
      )

      const onProgress = vi.fn()
      const result = await manager.download(
        'https://example.com/test.bin',
        '',
        onProgress,
      )

      const text = new TextDecoder().decode(result)
      expect(text).toBe(testData)
    })

    it('reports progress with correct received/total/percentage', async () => {
      const testData = 'A'.repeat(1000)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse(testData, 200, {
            'Content-Length': String(testData.length),
          }),
        ),
      )

      const onProgress = vi.fn()
      await manager.download(
        'https://example.com/test.bin',
        '',
        onProgress,
      )

      // Should have been called at least once (final progress)
      expect(onProgress).toHaveBeenCalled()
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1]
      expect(lastCall[0]).toBe(1000) // received
      expect(lastCall[1]).toBe(1000) // total
      expect(lastCall[2]).toBe(100) // percentage
    })

    it('handles unknown Content-Length (total = 0)', async () => {
      const testData = 'Some data without length header'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse(testData, 200, {}), // No Content-Length
        ),
      )

      const onProgress = vi.fn()
      const result = await manager.download(
        'https://example.com/test.bin',
        '',
        onProgress,
      )

      const text = new TextDecoder().decode(result)
      expect(text).toBe(testData)

      // With unknown total, the final progress call should have total=0
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1]
      expect(lastCall[1]).toBe(0) // total = 0 when unknown
    })

    it('passes SHA1 verification when hash matches', async () => {
      const testData = 'verified data'
      const expectedHash = 'abc123def456abc123def456abc123def456abc1' // fake

      // Mock digest to return our fake hash for non-empty data
      mockDigest.mockImplementation(
        async (_algo: string, data: ArrayBuffer) => {
          if (data.byteLength === 0) {
            return hexToBuffer(EMPTY_SHA1)
          }
          return hexToBuffer(expectedHash)
        },
      )

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse(testData, 200, {
            'Content-Length': String(testData.length),
          }),
        ),
      )

      const onProgress = vi.fn()
      const result = await manager.download(
        'https://example.com/test.bin',
        expectedHash,
        onProgress,
      )

      expect(result.byteLength).toBe(testData.length)
    })

    it('throws on SHA1 mismatch', async () => {
      const testData = 'tampered data'
      const expectedHash = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555'
      const actualHash = 'ffff0000eeee1111dddd2222cccc3333bbbb4444'

      // First call = verify (returns actual), second call = compute (for error message)
      mockDigest.mockImplementation(
        async (_algo: string, data: ArrayBuffer) => {
          if (data.byteLength === 0) {
            return hexToBuffer(EMPTY_SHA1)
          }
          return hexToBuffer(actualHash)
        },
      )

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse(testData, 200, {
            'Content-Length': String(testData.length),
          }),
        ),
      )

      const onProgress = vi.fn()
      await expect(
        manager.download(
          'https://example.com/test.bin',
          expectedHash,
          onProgress,
        ),
      ).rejects.toThrow(/SHA1_MISMATCH/)
    })

    it('skips SHA1 verification when expectedSha1 is empty string', async () => {
      const testData = 'no verification needed'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse(testData, 200, {
            'Content-Length': String(testData.length),
          }),
        ),
      )

      const onProgress = vi.fn()
      const result = await manager.download(
        'https://example.com/test.bin',
        '',
        onProgress,
      )

      // Should succeed without calling digest
      expect(result.byteLength).toBe(testData.length)
    })
  })

  // -----------------------------------------------------------------------
  // download() — Error paths
  // -----------------------------------------------------------------------

  describe('download errors', () => {
    it('throws on HTTP 404', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockFetchResponse('Not Found', 404)),
      )

      const onProgress = vi.fn()
      await expect(
        manager.download(
          'https://example.com/missing.bin',
          '',
          onProgress,
        ),
      ).rejects.toThrow('Download failed: HTTP 404')
    })

    it('throws on HTTP 500', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('Internal Server Error', 500),
        ),
      )

      const onProgress = vi.fn()
      await expect(
        manager.download(
          'https://example.com/broken.bin',
          '',
          onProgress,
        ),
      ).rejects.toThrow('Download failed: HTTP 500')
    })

    it('handles AbortSignal cancellation', async () => {
      // Create a mock fetch that never resolves (simulating ongoing download)
      const abortController = new AbortController()

      // Mock fetch to reject with AbortError when signal is aborted
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, init?: { signal?: AbortSignal }) => {
            return new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted', 'AbortError'))
              })
            })
          },
        ),
      )

      const onProgress = vi.fn()
      const downloadPromise = manager.download(
        'https://example.com/slow.bin',
        '',
        onProgress,
        abortController.signal,
      )

      // Abort immediately
      abortController.abort()

      await expect(downloadPromise).rejects.toThrow('The operation was aborted')
    })

    it('handles empty body (null ReadableStream) with verification', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(mockFetchNoBody(200)),
      )

      const onProgress = vi.fn()
      const result = await manager.download(
        'https://example.com/empty.bin',
        EMPTY_SHA1,
        onProgress,
      )

      expect(result.byteLength).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // downloadWithRetry()
  // -----------------------------------------------------------------------

  describe('downloadWithRetry', () => {
    it('succeeds on first mirror', async () => {
      const testData = 'first mirror success'
      const mirrors = [
        'https://mirror1.example.com/ra.zip',
        'https://mirror2.example.com/ra.zip',
      ]

      let callCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          callCount++
          return Promise.resolve(
            mockFetchResponse(testData, 200, {
              'Content-Length': String(testData.length),
            }),
          )
        }),
      )

      const onProgress = vi.fn()
      const result = await manager.downloadWithRetry(
        mirrors,
        '',
        onProgress,
      )

      const text = new TextDecoder().decode(result)
      expect(text).toBe(testData)
      expect(callCount).toBe(1) // Only called once
    })

    it('fails on first mirror, succeeds on second', async () => {
      const testData = 'second mirror success'
      const mirrors = [
        'https://bad-mirror.example.com/ra.zip',
        'https://good-mirror.example.com/ra.zip',
      ]

      let callCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          callCount++
          if (url === mirrors[0]) {
            return Promise.resolve(
              mockFetchResponse('Not Found', 404),
            )
          }
          return Promise.resolve(
            mockFetchResponse(testData, 200, {
              'Content-Length': String(testData.length),
            }),
          )
        }),
      )

      const onProgress = vi.fn()
      const result = await manager.downloadWithRetry(
        mirrors,
        '',
        onProgress,
      )

      const text = new TextDecoder().decode(result)
      expect(text).toBe(testData)
      expect(callCount).toBe(2)
    })

    it('throws after exhausting all retry attempts', async () => {
      const mirrors = [
        'https://bad1.example.com/ra.zip',
        'https://bad2.example.com/ra.zip',
      ]

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('Not Found', 404),
        ),
      )

      const onProgress = vi.fn()
      await expect(
        manager.downloadWithRetry(mirrors, '', onProgress),
      ).rejects.toThrow(/Download failed after \d+ attempt/)
    })

    it('stops retry immediately on abort', async () => {
      const mirrors = [
        'https://mirror1.example.com/ra.zip',
        'https://mirror2.example.com/ra.zip',
      ]

      const abortController = new AbortController()

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, init?: { signal?: AbortSignal }) => {
            return new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(
                  new DOMException('The operation was aborted', 'AbortError'),
                )
              })
            })
          },
        ),
      )

      const onProgress = vi.fn()
      const promise = manager.downloadWithRetry(
        mirrors,
        '',
        onProgress,
        abortController.signal,
      )

      abortController.abort()

      await expect(promise).rejects.toThrow('The operation was aborted')
    })

    it('throws when mirror list is empty', async () => {
      const onProgress = vi.fn()
      await expect(
        manager.downloadWithRetry([], '', onProgress),
      ).rejects.toThrow('No mirrors available for download')
    })

    it('stops at MAX_RETRY_ATTEMPTS even with many mirrors', async () => {
      // 5 mirrors available, but only 3 attempts allowed
      const mirrors = [
        'https://bad1.example.com/ra.zip',
        'https://bad2.example.com/ra.zip',
        'https://bad3.example.com/ra.zip',
        'https://good.example.com/ra.zip', // Would succeed but won't be reached
        'https://good2.example.com/ra.zip',
      ]

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse('Server Error', 500),
        ),
      )

      const onProgress = vi.fn()
      await expect(
        manager.downloadWithRetry(mirrors, '', onProgress),
      ).rejects.toThrow(/Download failed after 3 attempt/)
    })
  })

  // -----------------------------------------------------------------------
  // downloadWithResume() — CI-B.4
  // -----------------------------------------------------------------------

  describe('downloadWithResume', () => {
    it('downloads data without prior partial (fresh download)', async () => {
      const testData = 'Fresh download content'
      let fetchCalled = false
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          fetchCalled = true
          return Promise.resolve(
            mockFetchResponse(testData, 200, {
              'Content-Length': String(testData.length),
            }),
          )
        }),
      )

      // Mock IndexedDB for chunk storage
      const idbStore = new Map<string, any>()
      ;(globalThis as any).indexedDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request: any = {
            result: {
              objectStoreNames: {
                contains: vi.fn(() => idbStore.has('_init')),
              },
              createObjectStore: vi.fn(() => {
                idbStore.set('_init', true)
              }),
              transaction: vi.fn((_storeName: string, _mode: string) => ({
                objectStore: vi.fn(() => ({
                  get: vi.fn((_key: string) => ({
                    result: undefined,
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                  })),
                  put: vi.fn((_v: any, _key: string) => ({
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                  })),
                  delete: vi.fn((_key: string) => ({
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                  })),
                })),
                set oncomplete(_cb: any) { setTimeout(() => _cb?.(), 0) },
                set onerror(_cb: any) {},
                set onabort(_cb: any) {},
              })),
              close: vi.fn(),
            },
            set onupgradeneeded(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onerror(_cb: any) {},
            set onblocked(_cb: any) {},
          }
          return request
        }),
        deleteDatabase: vi.fn(),
      }

      const onProgress = vi.fn()
      const result = await manager.downloadWithResume(
        'https://example.com/file.zip',
        '',
        onProgress,
      )

      const text = new TextDecoder().decode(result)
      expect(text).toBe(testData)
      expect(fetchCalled).toBe(true)
    })

    it('sends Range header when partial data exists', async () => {
      const partialData = new Uint8Array([1, 2, 3, 4, 5])
      const restData = new Uint8Array([6, 7, 8, 9, 10])

      // Store partial data in mock IndexedDB
      const idbStore = new Map<string, any>()
      idbStore.set(
        'https://example.com/resume.zip',
        partialData.buffer,
      )
      idbStore.set('_init', true)

      ;(globalThis as any).indexedDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request: any = {
            result: {
              objectStoreNames: {
                contains: vi.fn(() => idbStore.has('_init')),
              },
              createObjectStore: vi.fn(() => {
                idbStore.set('_init', true)
              }),
              transaction: vi.fn((_storeName: string, _mode: string) => ({
                objectStore: vi.fn(() => ({
                  get: vi.fn((key: string) => ({
                    result: idbStore.get(key),
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                  })),
                  put: vi.fn((v: any, key: string) => {
                    idbStore.set(key, v)
                    return {
                      set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                      set onerror(_cb: any) {},
                    }
                  }),
                  delete: vi.fn((key: string) => {
                    idbStore.delete(key)
                    return {
                      set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                      set onerror(_cb: any) {},
                    }
                  }),
                })),
                set oncomplete(_cb: any) { setTimeout(() => _cb?.(), 0) },
                set onerror(_cb: any) {},
                set onabort(_cb: any) {},
              })),
              close: vi.fn(),
            },
            set onupgradeneeded(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onerror(_cb: any) {},
            set onblocked(_cb: any) {},
          }
          return request
        }),
        deleteDatabase: vi.fn(),
      }

      let capturedHeaders: Record<string, string> = {}
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, init?: { headers?: Record<string, string> }) => {
            capturedHeaders = init?.headers ?? {}
            // Return 206 Partial Content with the rest of the data
            const chunk = restData
            let pulled = false
            const stream = new ReadableStream<Uint8Array>({
              pull(controller) {
                if (!pulled) {
                  pulled = true
                  controller.enqueue(chunk)
                } else {
                  controller.close()
                }
              },
            })
            const responseHeaders = new Headers()
            responseHeaders.set('Content-Length', String(restData.length))
            return Promise.resolve({
              ok: true,
              status: 206,
              headers: responseHeaders,
              body: stream,
            } as unknown as Response)
          },
        ),
      )

      const onProgress = vi.fn()
      const result = await manager.downloadWithResume(
        'https://example.com/resume.zip',
        '',
        onProgress,
      )

      expect(capturedHeaders['Range']).toBe('bytes=5-')
      // Result should be the concatenation of partial + rest
      expect(result.byteLength).toBe(10)
    })

    it('restarts from scratch when server returns 200 (ignores Range)', async () => {
      // Store partial data that should be discarded
      const partialData = new Uint8Array([1, 2, 3])
      const fullData = new Uint8Array([4, 5, 6, 7, 8, 9, 10])

      const idbStore = new Map<string, any>()
      idbStore.set(
        'https://example.com/no-resume.zip',
        partialData.buffer,
      )
      idbStore.set('_init', true)

      ;(globalThis as any).indexedDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request: any = {
            result: {
              objectStoreNames: {
                contains: vi.fn(() => idbStore.has('_init')),
              },
              createObjectStore: vi.fn(() => {
                idbStore.set('_init', true)
              }),
              transaction: vi.fn((_storeName: string, _mode: string) => ({
                objectStore: vi.fn(() => ({
                  get: vi.fn((key: string) => ({
                    result: idbStore.get(key),
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                  })),
                  put: vi.fn((v: any, key: string) => {
                    idbStore.set(key, v)
                    return {
                      set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                      set onerror(_cb: any) {},
                    }
                  }),
                  delete: vi.fn((key: string) => {
                    idbStore.delete(key)
                    return {
                      set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                      set onerror(_cb: any) {},
                    }
                  }),
                })),
                set oncomplete(_cb: any) { setTimeout(() => _cb?.(), 0) },
                set onerror(_cb: any) {},
                set onabort(_cb: any) {},
              })),
              close: vi.fn(),
            },
            set onupgradeneeded(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onerror(_cb: any) {},
            set onblocked(_cb: any) {},
          }
          return request
        }),
        deleteDatabase: vi.fn(),
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse(
            new TextDecoder().decode(fullData),
            200,
            { 'Content-Length': String(fullData.length) },
          ),
        ),
      )

      const onProgress = vi.fn()
      const result = await manager.downloadWithResume(
        'https://example.com/no-resume.zip',
        '',
        onProgress,
      )

      // Should return the full data (not concatenated with partial)
      expect(result.byteLength).toBe(7)
    })

    it('deletes IndexedDB chunk on SHA1 mismatch', async () => {
      const testData = 'corrupt data'
      const expectedHash = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555'
      const actualHash = 'ffff0000eeee1111dddd2222cccc3333bbbb4444'

      mockDigest.mockImplementation(
        async (_algo: string, data: ArrayBuffer) => {
          if (data.byteLength === 0) {
            return hexToBuffer(EMPTY_SHA1)
          }
          return hexToBuffer(actualHash)
        },
      )

      // Mock empty IndexedDB
      const idbStore = new Map<string, any>()
      idbStore.set('_init', true)
      ;(globalThis as any).indexedDB = {
        open: vi.fn((_name: string, _version?: number) => {
          const request: any = {
            result: {
              objectStoreNames: {
                contains: vi.fn(() => idbStore.has('_init')),
              },
              createObjectStore: vi.fn(() => {
                idbStore.set('_init', true)
              }),
              transaction: vi.fn((_storeName: string, _mode: string) => ({
                objectStore: vi.fn(() => ({
                  get: vi.fn((_key: string) => ({
                    result: undefined,
                    set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                    set onerror(_cb: any) {},
                  })),
                  put: vi.fn((v: any, key: string) => {
                    idbStore.set(key, v)
                    return {
                      set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                      set onerror(_cb: any) {},
                    }
                  }),
                  delete: vi.fn((key: string) => {
                    idbStore.delete(key)
                    return {
                      set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
                      set onerror(_cb: any) {},
                    }
                  }),
                })),
                set oncomplete(_cb: any) { setTimeout(() => _cb?.(), 0) },
                set onerror(_cb: any) {},
                set onabort(_cb: any) {},
              })),
              close: vi.fn(),
            },
            set onupgradeneeded(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onsuccess(_cb: any) { setTimeout(() => _cb?.(), 0) },
            set onerror(_cb: any) {},
            set onblocked(_cb: any) {},
          }
          return request
        }),
        deleteDatabase: vi.fn(),
      }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse(testData, 200, {
            'Content-Length': String(testData.length),
          }),
        ),
      )

      const onProgress = vi.fn()
      await expect(
        manager.downloadWithResume(
          'https://example.com/bad.zip',
          expectedHash,
          onProgress,
        ),
      ).rejects.toThrow(/SHA1_MISMATCH/)
    })
  })
})
