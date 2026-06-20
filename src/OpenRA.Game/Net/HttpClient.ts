/**
 * HttpClient.ts — HTTP 客户端基础设施，带重试、超时和中止支持
 * OpenRA 对照: OpenRA.Support.HttpClientFactory + System.Net.Http.HttpClient
 *
 * 核心范式转换:
 * - C# HttpClient.GetStreamAsync(url) → fetchWithRetry(url).then(r => r.body)
 * - C# Task.Run(async () => { ... }) → async function (JS event loop)
 * - C# CancellationToken → AbortSignal
 * - C# HttpClientFactory (DI/testability) → 可配置的 fetch() 包装器（全局 mock）
 *
 * 提供可配置的 fetch() 包装器，支持指数退避重试、抖动、超时和中止信号。
 */

// ---------------------------------------------------------------------------
// RetryConfig
// ---------------------------------------------------------------------------

/**
 * fetchWithRetry 行为的重试配置。
 *
 * OpenRA 对照: HttpClientFactory 默认值（无直接 C# 等效；
 *   OpenRA 在 MapCache 中未实现重试，失败被记录并丢弃）
 */
export interface RetryConfig {
  /** 最大重试次数（默认: 3）。 */
  maxRetries: number
  /** 首次重试前的初始延迟（毫秒）（默认: 1000）。 */
  baseDelayMs: number
  /** 每次重试后应用于延迟的乘数（默认: 2）。 */
  backoffMultiplier: number
  /** 重试之间的最大延迟（毫秒）（默认: 30000）。 */
  maxDelayMs: number
  /** 抖动因子，0-1 之间。实际延迟 = baseDelay * (1 + random * jitter)（默认: 0.25）。 */
  jitter: number
  /** 触发重试的 HTTP 状态码集合。默认: [408, 429, 500, 502, 503, 504]。 */
  retryableStatuses: Set<number>
  /** 请求超时（毫秒），0 = 无超时（默认: 30000）。 */
  timeoutMs: number
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/**
 * 默认重试配置。
 *
 * 策略：指数退避 + 抖动，最多 3 次重试，初始延迟 1 秒，最大 30 秒。
 * 根据 ADR-4.E.3.2: HTTP 客户端重试策略。
 */
export const DEFAULT_RETRY_CONFIG: Readonly<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  jitter: 0.25,
  retryableStatuses: new Set([408, 429, 500, 502, 503, 504]),
  timeoutMs: 30000,
}

// ---------------------------------------------------------------------------
// Helper: merge configuration
// ---------------------------------------------------------------------------

/**
 * 将部分重试配置与默认值合并。
 *
 * @param partial — 部分重试配置（可选）
 * @returns 完整的重试配置
 */
function mergeConfig(partial?: Partial<RetryConfig>): RetryConfig {
  if (!partial) {
    return {
      ...DEFAULT_RETRY_CONFIG,
      retryableStatuses: new Set(DEFAULT_RETRY_CONFIG.retryableStatuses),
    }
  }
  return {
    maxRetries: partial.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
    baseDelayMs: partial.baseDelayMs ?? DEFAULT_RETRY_CONFIG.baseDelayMs,
    backoffMultiplier:
      partial.backoffMultiplier ?? DEFAULT_RETRY_CONFIG.backoffMultiplier,
    maxDelayMs: partial.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
    jitter: partial.jitter ?? DEFAULT_RETRY_CONFIG.jitter,
    timeoutMs: partial.timeoutMs ?? DEFAULT_RETRY_CONFIG.timeoutMs,
    // `??` 确保仅在 partial.retryableStatuses 为 null/undefined
    // 时才创建新 Set（DEFAULT 与 partial 是独立引用，必须深拷贝）
    retryableStatuses:
      partial.retryableStatuses ??
      new Set(DEFAULT_RETRY_CONFIG.retryableStatuses),
  }
}

// ---------------------------------------------------------------------------
// Public helpers (exported for testability)
// ---------------------------------------------------------------------------

/**
 * 检查 HTTP 状态码是否为可重试状态。
 *
 * OpenRA 对照: 无直接等效（OpenRA 无重试逻辑）
 *
 * @param status — HTTP 状态码
 * @param config — 重试配置
 * @returns 如果应重试则返回 true
 */
export function isRetryableStatus(
  status: number,
  config: RetryConfig,
): boolean {
  return config.retryableStatuses.has(status)
}

/**
 * 计算给定重试尝试次数的退避延迟（不含抖动）。
 *
 * OpenRA 对照: 无直接等效
 *
 * 公式: min(baseDelayMs * backoffMultiplier^attempt, maxDelayMs)
 * 抖动由调用方在应用此基础延迟后施加。
 *
 * @param attempt — 当前重试尝试次数（从 0 开始）
 * @param config — 重试配置
 * @returns 基础延迟（毫秒），应用抖动前
 */
export function computeBackoffDelay(
  attempt: number,
  config: RetryConfig,
): number {
  return Math.min(
    config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
    config.maxDelayMs,
  )
}

// ---------------------------------------------------------------------------
// fetchWithRetry
// ---------------------------------------------------------------------------

/**
 * 使用重试、超时和中止支持进行 Fetch。
 *
 * OpenRA 对照: HttpClient.GetAsync() with CancellationToken
 *
 * 在网络错误和可配置的 HTTP 状态码上重试。
 * 使用带抖动的指数退避。
 *
 * 可重试失败：
 * - TypeError（网络错误，如 DNS 失败、连接被拒）
 * - 可重试状态码（默认：408, 429, 500, 502, 503, 504）
 * - 超时中止（来自内部超时控制器）
 *
 * 不可重试失败：
 * - 不可重试的 HTTP 状态码（400, 401, 403, 404 等）
 * - 外部 AbortSignal 中止
 *
 * @param url — 目标 URL
 * @param init — 标准 RequestInit（method, headers, body 等）
 * @param config — 重试配置（回退至 DEFAULT_RETRY_CONFIG）
 * @param signal — 可选的外部 AbortSignal 用于取消
 * @returns 成功时的 Response
 * @throws DOMException 在外部中止时
 * @throws Error 在所有重试耗尽或收到不可重试状态码时
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  config?: Partial<RetryConfig>,
  signal?: AbortSignal,
): Promise<Response> {
  const mergedConfig = mergeConfig(config)

  // 如果外部信号已中止，立即抛出
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError')
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
    // 如果不是首次尝试，等待退避延迟
    if (attempt > 0) {
      const baseDelay = computeBackoffDelay(attempt - 1, mergedConfig)
      const jitterFactor = 1 + Math.random() * mergedConfig.jitter
      const delay = baseDelay * jitterFactor
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    // 再次检查外部中止（等待后可能已中止）
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError')
    }

    // 为此次尝试创建组合中止控制器
    const attemptController = new AbortController()

    // 设置超时
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (mergedConfig.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        attemptController.abort(new Error('Request timeout'))
      }, mergedConfig.timeoutMs)
    }

    // 监听外部中止信号
    let onExternalAbort: (() => void) | undefined
    if (signal) {
      onExternalAbort = () => attemptController.abort(signal.reason)
      signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const response = await fetch(url, {
        ...init,
        signal: attemptController.signal,
      })

      // 成功——清理并返回
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      if (onExternalAbort && signal) {
        signal.removeEventListener('abort', onExternalAbort)
      }

      // 检查 HTTP 状态码
      if (response.ok) {
        return response
      }

      // 不可重试的状态码——立即抛出
      if (!isRetryableStatus(response.status, mergedConfig)) {
        throw new Error(
          `HTTP ${response.status}: fetch to ${url} failed (non-retryable)`,
        )
      }

      // 可重试的状态码——记录错误，准备重试
      lastError = new Error(
        `HTTP ${response.status}: ${url} (attempt ${attempt + 1}/${mergedConfig.maxRetries + 1})`,
      )
    } catch (e: unknown) {
      // 清理超时
      if (timeoutId !== undefined) clearTimeout(timeoutId)

      // 清理事件监听器
      if (onExternalAbort && signal) {
        signal.removeEventListener('abort', onExternalAbort)
      }

      // 外部中止——传播，不重试
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }

      // 如果这是 DOMException（很可能来自内部超时），并且外部信号未中止
      if (e instanceof DOMException && e.name === 'AbortError') {
        // 超时——可重试
        lastError = new Error(
          `Request timeout to ${url} after ${mergedConfig.timeoutMs}ms (attempt ${attempt + 1}/${mergedConfig.maxRetries + 1})`,
        )
        continue
      }

      // TypeError — 网络错误（DNS 失败、连接被拒等）——可重试
      if (e instanceof TypeError) {
        lastError = new Error(
          `Network error fetching ${url}: ${e.message} (attempt ${attempt + 1}/${mergedConfig.maxRetries + 1})`,
        )
        continue
      }

      // 未知错误——如果是 Error 实例则保留其信息，否则包装它
      if (e instanceof Error) {
        // 此错误可能来自之前的可重试 HTTP 状态码检查——记录日志以便调试
        if (
          e.message.startsWith('HTTP ') &&
          isRetryableStatus(
            parseInt(e.message.split(' ')[1] as string, 10),
            mergedConfig,
          )
        ) {
          // 可重试，继续循环
          continue
        }
        lastError = e
      } else {
        lastError = new Error(
          `Unknown error fetching ${url}: ${String(e)} (attempt ${attempt + 1}/${mergedConfig.maxRetries + 1})`,
        )
      }

      // 不可重试——中断循环
      break
    }
  }

  // 所有重试已耗尽
  // `||` 而非 `??`：防御性处理 error.message 可能为 '' 的情况
  const message =
    lastError?.message || `All retries exhausted for ${url}`
  throw new Error(
    `Fetch to ${url} failed after ${mergedConfig.maxRetries + 1} attempt(s): ${message}`,
  )
}
