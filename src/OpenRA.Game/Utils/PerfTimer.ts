/**
 * PerfTimer.ts — 高精度性能计时器
 * OpenRA 对照: OpenRA.Support.PerfTimer (基于 System.Diagnostics.Stopwatch)
 *
 * 核心范式转换:
 * - C# Stopwatch (QueryPerformanceCounter) → performance.now() (毫秒精度)
 * - C# Stopwatch.IsRunning → 内部 _running 状态标志
 * - C# Stopwatch.Elapsed (TimeSpan) → elapsed getter (number, 毫秒)
 * - C# Stopwatch.Restart() → reset() 重置并重新开始
 * - C# PerfTimer(long threshold) → 简单计时器，无阈值
 */

// ---------------------------------------------------------------------------
// PerfTimer
// ---------------------------------------------------------------------------

/**
 * 用于测量经过时间的高精度计时器。
 *
 * OpenRA 对照: OpenRA.Support.PerfTimer
 *
 * 包装 performance.now()，提供启动/停止/重置语义
 * 和人性化的字符串表示。
 */
export class PerfTimer {
  /** 计时开始时的 performance.now() 值（毫秒）。 */
  private _startTime = 0

  /** 累计经过的毫秒数（跨多次 start/stop 周期）。 */
  private _accumulated = 0

  /** 计时器当前是否正在运行。 */
  private _running = false

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * 开始（或恢复）计时。如果计时器已在运行，则此操作无效。
   *
   * OpenRA 对照: Stopwatch.Start()
   */
  start(): void {
    if (this._running) return
    this._startTime = performance.now()
    this._running = true
  }

  /**
   * 停止计时并返回从最近一次 start() 以来经过的总毫秒数。
   * 如果计时器未运行，则返回 0。
   *
   * OpenRA 对照: Stopwatch.Stop() + ElapsedMilliseconds
   *
   * @returns 自最近一次 start() 以来经过的毫秒数，如果未运行则返回 0
   */
  stop(): number {
    if (!this._running) return 0
    const elapsed = performance.now() - this._startTime
    this._accumulated += elapsed
    this._running = false
    return this.accumulated
  }

  /**
   * 重置计时器：清零累计时间并在此刻重新开始计时。
   *
   * OpenRA 对照: Stopwatch.Restart()
   */
  reset(): void {
    this._accumulated = 0
    this._startTime = performance.now()
    this._running = true
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /**
   * 获取从第一次 start()（和最后一次 reset()）以来经过的总毫秒数，
   * 或自 stop() 以来的最终时间。
   *
   * OpenRA 对照: Stopwatch.ElapsedMilliseconds
   */
  get elapsed(): number {
    if (this._running) {
      return this._accumulated + (performance.now() - this._startTime)
    }
    return this._accumulated
  }

  /**
   * 获取累计时间。与 elapsed 相同，但在 stop() 后使用此方法
   * 可避免访问 getter 时的计算开销。
   */
  get accumulated(): number {
    return this._accumulated
  }

  /**
   * 计时器当前是否正在运行。
   */
  get isRunning(): boolean {
    return this._running
  }

  // ---------------------------------------------------------------------------
  // String representation
  // ---------------------------------------------------------------------------

  /**
   * 返回经过时间的人类可读字符串（例如 "12.3 ms"）。
   *
   * OpenRA 对照: PerfTimer.ToString()
   */
  toString(): string {
    const ms = this.elapsed
    if (ms >= 1000 && ms < 10000) {
      return `${(ms / 1000).toFixed(2)} s`
    }
    if (ms >= 10000) {
      return `${(ms / 1000).toFixed(1)} s`
    }
    if (ms >= 1) {
      return `${ms.toFixed(1)} ms`
    }
    return `${(ms * 1000).toFixed(0)} µs`
  }
}
