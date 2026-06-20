/**
 * HttpClient.test.ts — HTTP 客户端基础设施单元测试
 *
 * 由于 happy-dom 不支持网络且不提供全局 setTimeout，
 * 所有测试使用 vi.useFakeTimers() 控制时间并 mock 全局 fetch。
 * 测试重点：重试逻辑、退避计算、超时、中止信号、配置合并。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchWithRetry,
  isRetryableStatus,
  computeBackoffDelay,
  type RetryConfig,
} from './HttpClient.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 创建一个与 DEFAULT_RETRY_CONFIG 深度相等的可变 RetryConfig。 */
function defaultConfig(): RetryConfig {
  return {
    maxRetries: 3,
    baseDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    jitter: 0.25,
    timeoutMs: 30000,
    retryableStatuses: new Set([408, 429, 500, 502, 503, 504]),
  }
}

/** 创建一个成功的 Response mock。 */
function createOkResponse(
  status = 200,
  body: string | null = null,
): Response {
  return {
    ok: true,
    status,
    statusText: 'OK',
    text: async () => body ?? '',
    json: async () => JSON.parse(body ?? '{}'),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => createOkResponse(status, body),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response
}

/** 创建一个表示 HTTP 错误的 Response mock。 */
function createErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    statusText: 'Error',
    text: async () => '',
    json: async () => ({}),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => createErrorResponse(status),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as Response
}

/**
 * 创建确定性配置（jitter=0, timeoutMs=0），
 * 使得基于计时器的测试可预测。
 */
function deterministicConfig(
  overrides?: Partial<RetryConfig>,
): Partial<RetryConfig> {
  return {
    jitter: 0,
    timeoutMs: 0,
    ...overrides,
  }
}

/**
 * 创建仅包含给定状态码集合的重试配置。
 */
function configWithStatuses(
  statuses: number[],
  overrides?: Partial<RetryConfig>,
): Partial<RetryConfig> {
  return deterministicConfig({
    retryableStatuses: new Set(statuses),
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Tests: isRetryableStatus
// ---------------------------------------------------------------------------

describe('isRetryableStatus', () => {
  it('returns true for 503', () => {
    const config = defaultConfig()
    expect(isRetryableStatus(503, config)).toBe(true)
  })

  it('returns true for 429', () => {
    const config = defaultConfig()
    expect(isRetryableStatus(429, config)).toBe(true)
  })

  it('returns false for 404', () => {
    const config = defaultConfig()
    expect(isRetryableStatus(404, config)).toBe(false)
  })

  it('returns false for 400', () => {
    const config = defaultConfig()
    expect(isRetryableStatus(400, config)).toBe(false)
  })

  it('respects custom retryableStatuses', () => {
    const config = {
      ...defaultConfig(),
      retryableStatuses: new Set([418, 503]),
    }
    expect(isRetryableStatus(418, config)).toBe(true)
    expect(isRetryableStatus(500, config)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: computeBackoffDelay
// ---------------------------------------------------------------------------

describe('computeBackoffDelay', () => {
  it('returns baseDelayMs for attempt 0', () => {
    const config = defaultConfig()
    expect(computeBackoffDelay(0, config)).toBe(1000)
  })

  it('doubles delay for attempt 1 with default backoffMultiplier=2', () => {
    const config = defaultConfig()
    expect(computeBackoffDelay(1, config)).toBe(2000)
  })

  it('quadruples delay for attempt 2', () => {
    const config = defaultConfig()
    expect(computeBackoffDelay(2, config)).toBe(4000)
  })

  it('respects maxDelayMs cap', () => {
    const config = {
      ...defaultConfig(),
      baseDelayMs: 10000,
      backoffMultiplier: 10,
      maxDelayMs: 30000,
    }
    expect(computeBackoffDelay(0, config)).toBe(10000)
    expect(computeBackoffDelay(1, config)).toBe(30000)
    expect(computeBackoffDelay(2, config)).toBe(30000)
  })

  it('uses custom backoffMultiplier', () => {
    const config = {
      ...defaultConfig(),
      backoffMultiplier: 3,
      baseDelayMs: 1000,
    }
    expect(computeBackoffDelay(0, config)).toBe(1000)
    expect(computeBackoffDelay(1, config)).toBe(3000)
    expect(computeBackoffDelay(2, config)).toBe(9000)
  })
})

// ---------------------------------------------------------------------------
// Tests: fetchWithRetry
// ---------------------------------------------------------------------------

describe('fetchWithRetry', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // -----------------------------------------------------------------------
  // 1. succeeds on first attempt
  // -----------------------------------------------------------------------

  it('succeeds on first attempt', async () => {
    const okResponse = createOkResponse(200, '{"ok":true}')
    mockFetch.mockResolvedValue(okResponse)

    const result = await fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    expect(result).toBe(okResponse)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // 2. retries on network error
  // -----------------------------------------------------------------------

  it('retries on network error (TypeError)', async () => {
    const okResponse = createOkResponse(200)
    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse)

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    // Advance through all backoffs (1000+2000+4000 + buffer)
    await vi.advanceTimersByTimeAsync(10000)

    const result = await promise

    expect(result).toBe(okResponse)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('throws after exhausting retries on network errors', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    await vi.advanceTimersByTimeAsync(10000)

    await expect(promise).rejects.toThrow(/failed after 4 attempt/)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  // -----------------------------------------------------------------------
  // 3. retries on 503
  // -----------------------------------------------------------------------

  it('retries on 503 and succeeds on second attempt', async () => {
    const errorResponse = createErrorResponse(503)
    const okResponse = createOkResponse(200)

    mockFetch
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(okResponse)

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    await vi.advanceTimersByTimeAsync(2000)

    const result = await promise
    expect(result).toBe(okResponse)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // -----------------------------------------------------------------------
  // 4. does not retry on 404
  // -----------------------------------------------------------------------

  it('does not retry on 404', async () => {
    mockFetch.mockResolvedValue(createErrorResponse(404))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    await expect(promise).rejects.toThrow(/HTTP 404/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // 5. does not retry on 400
  // -----------------------------------------------------------------------

  it('does not retry on 400', async () => {
    mockFetch.mockResolvedValue(createErrorResponse(400))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    await expect(promise).rejects.toThrow(/HTTP 400/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // 6. backoff delay increases exponentially
  // -----------------------------------------------------------------------

  it('backoff delay increases exponentially', async () => {
    const delayValues: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: (...args: unknown[]) => void,
      delay?: number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => {
      if (delay !== undefined && delay >= 1000 && delay < 29000) {
        delayValues.push(delay)
      }
      return origSetTimeout(fn, delay)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)

    mockFetch.mockRejectedValue(new TypeError('Network error'))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    await vi.advanceTimersByTimeAsync(10000)
    await expect(promise).rejects.toThrow()

    // computeBackoffDelay(0)=1000, (1)=2000, (2)=4000 (all < 29000)
    expect(delayValues.length).toBeGreaterThanOrEqual(3)
    expect(delayValues[0]).toBe(1000)
    expect(delayValues[1]).toBe(2000)
    expect(delayValues[2]).toBe(4000)
  })

  // -----------------------------------------------------------------------
  // 7. respects maxDelayMs cap
  // -----------------------------------------------------------------------

  it('respects maxDelayMs cap in actual retry loop', async () => {
    const delayValues: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: (...args: unknown[]) => void,
      delay?: number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => {
      if (delay !== undefined && delay >= 10000 && delay <= 31000) {
        delayValues.push(delay)
      }
      return origSetTimeout(fn, delay)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)

    const config = deterministicConfig({
      baseDelayMs: 10000,
      backoffMultiplier: 10,
      maxDelayMs: 30000,
      maxRetries: 2,
    })

    mockFetch.mockRejectedValue(new TypeError('Network error'))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      config,
    )

    await vi.advanceTimersByTimeAsync(100000)
    await expect(promise).rejects.toThrow()

    // computeBackoffDelay(0)=10000 (under cap), (1)=30000 (capped)
    expect(delayValues.length).toBeGreaterThanOrEqual(2)
    expect(delayValues[0]).toBe(10000)
    expect(delayValues[1]).toBe(30000)
  })

  // -----------------------------------------------------------------------
  // 8. jitter adds randomness to delay
  // -----------------------------------------------------------------------

  it('jitter adds randomness to delay', async () => {
    const delayValues: number[] = []
    const origSetTimeout = globalThis.setTimeout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: (...args: unknown[]) => void,
      delay?: number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => {
      if (delay !== undefined && delay >= 900 && delay <= 1300) {
        delayValues.push(delay)
      }
      return origSetTimeout(fn, delay)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)

    // jitter=0.25, timeoutMs=0 (no competing timeout timer)
    const config: Partial<RetryConfig> = {
      jitter: 0.25,
      timeoutMs: 0,
      maxRetries: 1,
    }

    mockFetch.mockRejectedValue(new TypeError('Network error'))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      config,
    )

    await vi.advanceTimersByTimeAsync(2000)
    await expect(promise).rejects.toThrow()

    // Backoff: computeBackoffDelay(0)=1000, with jitter: [1000, 1250]
    const backoffDelay = delayValues[0]
    expect(backoffDelay).toBeDefined()
    expect(backoffDelay).toBeGreaterThanOrEqual(1000)
    expect(backoffDelay).toBeLessThanOrEqual(1250)
  })

  // -----------------------------------------------------------------------
  // 9. timeout handling
  // -----------------------------------------------------------------------

  it('retries on timeout when maxRetries > 0', async () => {
    const okResponse = createOkResponse(200)
    const config: Partial<RetryConfig> = {
      timeoutMs: 5000,
      maxRetries: 1,
      jitter: 0,
    }

    mockFetch
      .mockRejectedValueOnce(new DOMException('Request timeout', 'AbortError'))
      .mockResolvedValueOnce(okResponse)

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      config,
    )

    // Wait for backoff: computeBackoffDelay(0) = 1000 (jitter=0)
    await vi.advanceTimersByTimeAsync(1100)

    const result = await promise
    expect(result).toBe(okResponse)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // -----------------------------------------------------------------------
  // 10. external abort
  // -----------------------------------------------------------------------

  it('throws immediately if signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
      controller.signal,
    )

    await expect(promise).rejects.toThrow('The operation was aborted')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('external abort during backoff cancels further attempts', async () => {
    const controller = new AbortController()

    // First attempt fails with TypeError, then during backoff, abort fires
    mockFetch.mockRejectedValue(new TypeError('Network error'))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
      controller.signal,
    )

    // Advance partway through backoff, then abort
    await vi.advanceTimersByTimeAsync(500)
    controller.abort()

    // Advance past where backoff would have resolved
    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).rejects.toThrow('The operation was aborted')
    // Only the initial attempt was made (aborted before retry)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // 11. custom retryableStatuses
  // -----------------------------------------------------------------------

  it('retries on custom retryable status 418', async () => {
    const okResponse = createOkResponse(200)
    mockFetch
      .mockResolvedValueOnce(createErrorResponse(418))
      .mockResolvedValueOnce(okResponse)

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      configWithStatuses([418, 503], { maxRetries: 1 }),
    )

    await vi.advanceTimersByTimeAsync(2000)

    const result = await promise
    expect(result).toBe(okResponse)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does not retry on 500 if removed from retryableStatuses', async () => {
    mockFetch.mockResolvedValue(createErrorResponse(500))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      configWithStatuses([408, 429], { maxRetries: 1 }),
    )

    await expect(promise).rejects.toThrow(/HTTP 500/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // 12. maxRetries=0 disables retry
  // -----------------------------------------------------------------------

  it('maxRetries=0 disables retry and throws on first failure', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network error'))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig({ maxRetries: 0 }),
    )

    await expect(promise).rejects.toThrow(/failed after 1 attempt/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  // -----------------------------------------------------------------------
  // 13. merges partial config with defaults
  // -----------------------------------------------------------------------

  it('merges partial config with defaults', async () => {
    const okResponse = createOkResponse(200)

    // Only set maxRetries, leave jitter/timeout as default → deterministic needs override
    const config: Partial<RetryConfig> = {
      maxRetries: 1,
      jitter: 0,
      timeoutMs: 0,
    }

    mockFetch
      .mockRejectedValueOnce(new TypeError('Network error'))
      .mockResolvedValueOnce(okResponse)

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      config,
    )

    await vi.advanceTimersByTimeAsync(2000)

    const result = await promise
    expect(result).toBe(okResponse)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // -----------------------------------------------------------------------
  // 14. passes RequestInit through to fetch
  // -----------------------------------------------------------------------

  it('passes RequestInit through to fetch', async () => {
    const okResponse = createOkResponse(200)
    mockFetch.mockResolvedValue(okResponse)

    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    }

    await fetchWithRetry('https://example.com/api', init, deterministicConfig())

    expect(mockFetch).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit | undefined]
    expect(callArgs[0]).toBe('https://example.com/api')
    expect(callArgs[1]?.method).toBe('POST')
    expect(callArgs[1]?.body).toBe(JSON.stringify({ key: 'value' }))
  })

  it('overrides signal in RequestInit with internal AbortController signal', async () => {
    const externalController = new AbortController()
    const okResponse = createOkResponse(200)
    mockFetch.mockResolvedValue(okResponse)

    await fetchWithRetry('https://example.com/api', {
      signal: externalController.signal,
    }, deterministicConfig())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit | undefined]
    expect(callArgs[1]?.signal).toBeDefined()
    expect(callArgs[1]?.signal).not.toBe(externalController.signal)
  })

  // -----------------------------------------------------------------------
  // 15. computeBackoffDelay returns correct values (already tested above)
  //     Additional edge case: does not retry on 401/403
  // -----------------------------------------------------------------------

  it('does not retry on 401 Unauthorized', async () => {
    mockFetch.mockResolvedValue(createErrorResponse(401))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    await expect(promise).rejects.toThrow(/HTTP 401/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry on 403 Forbidden', async () => {
    mockFetch.mockResolvedValue(createErrorResponse(403))

    const promise = fetchWithRetry(
      'https://example.com/api',
      undefined,
      deterministicConfig(),
    )

    await expect(promise).rejects.toThrow(/HTTP 403/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
