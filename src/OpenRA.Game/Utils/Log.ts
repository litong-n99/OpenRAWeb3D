/**
 * Log.ts — 通道化日志系统
 * OpenRA 对照: OpenRA.Support.Log (基于 System.Diagnostics.Trace)
 *
 * 核心范式转换:
 * - C# System.Diagnostics.Trace → console.log/console.warn/console.error
 * - C# TextWriter (文件/流) → 仅控制台 (浏览器端)
 *   (NOTE: 浏览器端日志持久化可通过 server-side 日志接收器实现)
 * - C# static readonly field per class → static level property
 * - C# Log.AddChannel / ChannelDebug / ChannelInfo → LogLevel 过滤 + channel 字符串
 */

// ---------------------------------------------------------------------------
// LogLevel
// ---------------------------------------------------------------------------

/**
 * 日志严重级别。
 *
 * OpenRA 对照: OpenRA.Support.Log 中的严重性概念
 *   映射：Trace.WriteLine = INFO，Debug.Assert = ERROR
 */
export const LogLevel = {
  /** 极度详细的诊断日志（开发用）。 */
  VERBOSE: 0,
  /** 调试信息（构建时通常被 strip）。 */
  DEBUG: 1,
  /** 一般运行信息。 */
  INFO: 2,
  /** 非致命警告（应调查的意外状况）。 */
  WARN: 3,
  /** 致命错误（恢复尝试，但程序状态可能已损坏）。 */
  ERROR: 4,
} as const

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/**
 * 基于通道的静态日志工具。
 *
 * OpenRA 对照: OpenRA.Support.Log
 *
 * 每条日志消息与一个通道（例如 'mapcache'、'filesystem'）和严重级别
 * 相关联。只有级别高于或等于全局阈值的消息才会被发出。
 *
 * 用法：
 * ```
 * Log.write('mapcache', LogLevel.WARN, 'Failed to load map: ' + mapName)
 * Log.level = LogLevel.VERBOSE  // 查看所有日志
 * ```
 */
export class Log {
  /** 全局日志级别阈值。仅发出此级别或更高的消息。 */
  static level: LogLevel = LogLevel.INFO

  /** 被静音的通道集合。这些通道中的消息永远不会被发出。 */
  static mutedChannels = new Set<string>()

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  /**
   * 向日志写入消息。
   *
   * OpenRA 对照: Log.Write(string channel, string category, string message)
   *
   * 如果消息级别低于全局阈值或通道被静音，则将其丢弃。
   *
   * @param channel — 逻辑通道名称（例如 'mapcache'、'filesystem'、'renderer'）
   * @param level — 消息严重级别
   * @param message — 日志消息文本
   */
  static write(channel: string, level: LogLevel, message: string): void {
    if (level < Log.level) return
    if (Log.mutedChannels.has(channel)) return

    const prefix = `[${channel}]`
    switch (level) {
      case LogLevel.ERROR:
        console.error(prefix, message)
        break
      case LogLevel.WARN:
        console.warn(prefix, message)
        break
      case LogLevel.INFO:
        console.info(prefix, message)
        break
      case LogLevel.DEBUG:
        console.debug(prefix, message)
        break
      case LogLevel.VERBOSE:
        console.debug(prefix, message)
        break
      default:
        console.log(prefix, message)
    }
  }

  /**
   * 便利方法：记录 DEBUG 级别的消息。
   *
   * @param channel — 逻辑通道名称
   * @param message — 日志消息文本
   */
  static debug(channel: string, message: string): void {
    Log.write(channel, LogLevel.DEBUG, message)
  }

  /**
   * 便利方法：记录 INFO 级别的消息。
   *
   * @param channel — 逻辑通道名称
   * @param message — 日志消息文本
   */
  static info(channel: string, message: string): void {
    Log.write(channel, LogLevel.INFO, message)
  }

  /**
   * 便利方法：记录 WARN 级别的消息。
   *
   * @param channel — 逻辑通道名称
   * @param message — 日志消息文本
   */
  static warn(channel: string, message: string): void {
    Log.write(channel, LogLevel.WARN, message)
  }

  /**
   * 便利方法：记录 ERROR 级别的消息。
   *
   * @param channel — 逻辑通道名称
   * @param message — 日志消息文本
   */
  static error(channel: string, message: string): void {
    Log.write(channel, LogLevel.ERROR, message)
  }
}
