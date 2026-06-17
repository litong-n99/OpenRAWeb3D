/**
 * PlayerMessageTracker.ts -- 玩家聊天洪水控制：限速玩家消息，防止刷屏，
 * 支持管理员绕过、加入冷却和限制过后的聊天禁用。
 *
 * OpenRA 对照: OpenRA.Game/Server/PlayerMessageTracker.cs (86 lines C#)
 *
 * 核心范式转换:
 * - C# Dictionary<int, List<long>> messageTracker → Map<number, number[]>
 * - C# Stopwatch.ElapsedMilliseconds → Date.now() - connectionTimer
 * - C# List<T>.RemoveAll(predicate) → Array.filter() + 重新赋值
 * - C# Action<Connection, int, int, byte[]> → 函数参数
 * - C# Action<Connection, string, object[]> → 函数参数
 * - C# lock-free (single-threaded JS runtime)
 */

import { Order } from '../Network/Order.js'
import type { Server, Connection } from './Server.js'

// ---------------------------------------------------------------------------
// Fluent Message Key (对应 OpenRA PlayerMessageTracker 中的 FluentReference)
// ---------------------------------------------------------------------------

const ChatTemporaryDisabled = 'notification-chat-temp-disabled'

// ---------------------------------------------------------------------------
// PlayerMessageTracker
// ---------------------------------------------------------------------------

/**
 * 玩家聊天消息频率限制器。
 * 追踪每个玩家的消息时间戳，在超过洪水限制时阻止消息并禁用聊天 UI。
 *
 * OpenRA 对照: sealed class PlayerMessageTracker
 */
export class PlayerMessageTracker {
  /** 每个玩家的消息时间戳追踪器：playerIndex → 消息发送时间戳数组。 */
  private readonly messageTracker: Map<number, number[]> = new Map()

  /** 服务器反引用。 */
  private readonly server: Server

  /** 向特定客户端分发订单的函数。 */
  private readonly dispatchOrdersToClient: (
    conn: Connection,
    client: number,
    frame: number,
    data: Uint8Array,
  ) => void

  /** 向特定客户端发送 Fluent 消息的函数。 */
  private readonly sendFluentMessageTo: (
    conn: Connection,
    key: string,
    args?: unknown[],
  ) => void

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA PlayerMessageTracker 构造函数)
  // ---------------------------------------------------------------------------

  /**
   * @param server — 服务器反引用
   * @param dispatchOrdersToClient — 向客户端分发订单的函数
   * @param sendFluentMessageTo — 向客户端发送 Fluent 消息的函数
   */
  constructor(
    server: Server,
    dispatchOrdersToClient: (
      conn: Connection,
      client: number,
      frame: number,
      data: Uint8Array,
    ) => void,
    sendFluentMessageTo: (
      conn: Connection,
      key: string,
      args?: unknown[],
    ) => void,
  ) {
    this.server = server
    this.dispatchOrdersToClient = dispatchOrdersToClient
    this.sendFluentMessageTo = sendFluentMessageTo
  }

  // ---------------------------------------------------------------------------
  // DisableChatUI (对应 OpenRA DisableChatUI)
  // ---------------------------------------------------------------------------

  /**
   * 向客户端发送 DisableChatEntry 订单以禁用其聊天 UI。
   *
   * OpenRA 对照: PlayerMessageTracker.DisableChatUI(Connection, int)
   *
   * @param conn — 目标客户端连接
   * @param time — 聊天禁用时长（毫秒）
   */
  disableChatUI(conn: Connection, time: number): void {
    this.dispatchOrdersToClient(
      conn,
      0,
      0,
      Order.fromTargetString('DisableChatEntry', '', false, time).serialize(),
    )
  }

  // ---------------------------------------------------------------------------
  // IsPlayerAtFloodLimit (对应 OpenRA IsPlayerAtFloodLimit)
  // ---------------------------------------------------------------------------

  /**
   * 检查玩家是否达到洪水限制，如果达到则阻止其发送消息。
   * 也负责清理过期时间戳和应用冷却惩罚。
   *
   * OpenRA 对照: PlayerMessageTracker.IsPlayerAtFloodLimit(Connection)
   *
   * @param conn — 要检查的玩家连接
   * @returns true 表示玩家被限制（消息应被阻止），false 表示允许通过
   */
  isPlayerAtFloodLimit(conn: Connection): boolean {
    // 确保该玩家的追踪器已初始化
    if (!this.messageTracker.has(conn.playerIndex)) {
      this.messageTracker.set(conn.playerIndex, [])
    }

    const isAdmin = this.server.getClient(conn)?.isAdmin ?? false
    const settings = this.server.settings
    const time = Date.now() - conn.connectionTimer
    const tracker = this.messageTracker.get(conn.playerIndex)!

    // 移除超出洪水间隔的旧条目
    // NOTE: tracker 从 Map 中取出后原地过滤并重新设置
    const filtered = tracker.filter(
      (t) => t + settings.floodLimitInterval >= time,
    )
    this.messageTracker.set(conn.playerIndex, filtered)

    // 辅助函数：将剩余毫秒转换为秒（向上取整）
    const calculateRemaining = (cooldown: number): number =>
      Math.floor((cooldown - time + 999) / 1000)

    // 管理员绕过洪水限制
    if (!isAdmin) {
      // 加入冷却期内阻止消息
      if (time < settings.floodLimitJoinCooldown) {
        const remaining = calculateRemaining(
          settings.floodLimitJoinCooldown,
        )
        this.sendFluentMessageTo(conn, ChatTemporaryDisabled, [
          'remaining',
          remaining,
        ])
        return true
      }

      // 超过洪水限制时阻止消息
      if (filtered.length >= settings.floodLimitMessageCount) {
        const remaining = calculateRemaining(
          filtered[0] + settings.floodLimitInterval,
        )
        this.sendFluentMessageTo(conn, ChatTemporaryDisabled, [
          'remaining',
          remaining,
        ])
        return true
      }
    }

    // 添加当前时间戳
    filtered.push(time)
    this.messageTracker.set(conn.playerIndex, filtered)

    // 达到洪水限制时：应用冷却并禁用聊天 UI
    if (!isAdmin && filtered.length >= settings.floodLimitMessageCount) {
      const cooldownDelta = Math.max(
        0,
        settings.floodLimitCooldown - settings.floodLimitInterval,
      )
      for (let i = 0; i < filtered.length; i++) {
        filtered[i] = time + cooldownDelta
      }
      this.messageTracker.set(conn.playerIndex, filtered)

      this.disableChatUI(conn, settings.floodLimitCooldown)
    }

    return false
  }
}
