/**
 * VoteKickTracker.ts -- 投票踢人系统：管理服务器端的投票踢人生命周期，
 * 包括投票发起、计票、超时处理和冷却惩罚。
 *
 * OpenRA 对照: OpenRA.Game/Server/VoteKickTracker.cs (223 lines C#)
 *
 * 核心范式转换:
 * - C# Stopwatch voteKickTimer → TypeScript number (Date.now() timestamp)
 * - C# Dictionary<int, bool> voteTracker → Map<number, boolean>
 * - C# Dictionary<Session.Client, long> failedVoteKickers → Map<SessionClient, number>
 *   (用 Date.now() 绝对时间戳替换 Stopwatch.ElapsedMilliseconds)
 * - C# Stopwatch.ElapsedMilliseconds → Date.now() - connectionTimer
 * - C# lock-free (single-threaded JS runtime)
 */

import { Order } from '../Network/Order.js'
import { ServerState, ServerType, type SessionClient } from './SessionTypes.js'
import type { Server, Connection } from './Server.js'

// ---------------------------------------------------------------------------
// Fluent Message Keys (对应 OpenRA VoteKickTracker 中的 FluentReference 常量)
// ---------------------------------------------------------------------------

const InsufficientVotes = 'notification-insufficient-votes-to-kick'
const AlreadyVoted = 'notification-kick-already-voted'
const VoteKickStarted = 'notification-vote-kick-started'
const UnableToStartAVote = 'notification-unable-to-start-a-vote'
const VoteKickProgress = 'notification-vote-kick-in-progress'
const VoteKickEnded = 'notification-vote-kick-ended'

// ---------------------------------------------------------------------------
// VoteKickTracker
// ---------------------------------------------------------------------------

/**
 * 管理服务器投票踢人系统的完整生命周期。
 *
 * OpenRA 对照: sealed class VoteKickTracker
 */
export class VoteKickTracker {
  // ---- Server back-reference ----

  private readonly server: Server

  // ---- Vote State ----

  /** 投票开始时间戳（Date.now()），null 表示无进行中的投票。 */
  private voteStartTime: number | null = null

  /** 当前投票的计票器：playerIndex → 投票意向。 */
  private readonly voteTracker: Map<number, boolean> = new Map()

  /** 失败投票发起者的冷却记录：SessionClient → 上次失败投票发生时的绝对时间戳。 */
  private readonly failedVoteKickers: Map<SessionClient, number> = new Map()

  /** 当前投票的目标（被踢者）。 */
  private kickee: { client: SessionClient; conn: Connection } | null = null

  /** 当前投票的发起者。 */
  private voteKickerStarter: { client: SessionClient; conn: Connection } | null = null

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA VoteKickTracker 构造函数)
  // ---------------------------------------------------------------------------

  /**
   * @param server — 服务器反引用，用于状态查询和消息分发
   */
  constructor(server: Server) {
    this.server = server
  }

  // ---------------------------------------------------------------------------
  // ClientHasPower (对应 OpenRA ClientHasPower)
  // ---------------------------------------------------------------------------

  /**
   * 判断客户端是否有资格参与投票踢人。
   * 仅管理员和存活（非观战者、未战败）的玩家有投票权。
   *
   * OpenRA 对照: VoteKickTracker.ClientHasPower(Session.Client)
   */
  private clientHasPower(client: SessionClient): boolean {
    return (
      client.isAdmin ||
      (!client.isObserver && !this.server.hasClientWonOrLost(client))
    )
  }

  // ---------------------------------------------------------------------------
  // Tick (对应 OpenRA Tick)
  // ---------------------------------------------------------------------------

  /**
   * 每服务器 tick 调用一次。检查投票是否已超时或被踢者是否已断开连接。
   *
   * OpenRA 对照: VoteKickTracker.Tick()
   */
  tick(): void {
    if (this.voteStartTime === null || this.kickee === null) return

    // 被踢者已断开连接 → 结束投票
    if (!this.server.conns.includes(this.kickee.conn)) {
      this.endKickVote()
      return
    }

    // 投票超时 → 结束投票并阻止发起者
    if (
      Date.now() - this.voteStartTime >
      this.server.settings.voteKickTimer
    ) {
      this.endKickVoteAndBlockKicker()
    }
  }

  // ---------------------------------------------------------------------------
  // VoteKick (对应 OpenRA VoteKick)
  // ---------------------------------------------------------------------------

  /**
   * 处理一个投票踢人请求。
   *
   * OpenRA 对照: VoteKickTracker.VoteKick(Connection, Session.Client,
   *   Connection, Session.Client, int, bool)
   *
   * @param conn — 投票者连接
   * @param kicker — 投票的 SessionClient
   * @param kickeeConn — 被踢者连接
   * @param kickee — 被踢的 SessionClient
   * @param kickeeID — 被踢者玩家索引
   * @param vote — 投票意向（true = 赞成, false = 反对）
   * @returns 投票是否已达到通过门槛
   */
  voteKick(
    conn: Connection,
    kicker: SessionClient,
    kickeeConn: Connection,
    kickee: SessionClient,
    kickeeID: number,
    vote: boolean,
  ): boolean {
    const voteInProgress = this.voteStartTime !== null

    // 前提条件验证
    if (
      this.server.state !== ServerState.GameStarted ||
      (kickee.isAdmin && this.server.type !== ServerType.Dedicated) ||
      (!voteInProgress && !vote) || // 不允许以反对票发起投票
      (voteInProgress && this.kickee!.client !== kickee) || // 已有进行中投票时不接受新投票
      !this.clientHasPower(kicker)
    ) {
      this.server.sendFluentMessageTo(conn, UnableToStartAVote)
      return false
    }

    // 统计有资格的投票者
    let eligiblePlayers = 0
    let isKickeeOnline = false
    let adminIsDeadButOnline = false

    for (const c of this.server.conns) {
      const client = this.server.getClient(c)
      if (!client) continue

      if (client !== kickee && this.clientHasPower(client)) {
        eligiblePlayers++
      }

      if (c === kickeeConn) {
        isKickeeOnline = true
      }

      if (
        client.isAdmin &&
        (client.isObserver || this.server.hasClientWonOrLost(client))
      ) {
        adminIsDeadButOnline = true
      }
    }

    // 被踢者不在线 → 结束投票
    if (!isKickeeOnline) {
      this.endKickVote()
      return false
    }

    // 有资格玩家不足 → 投票无法进行
    if (
      eligiblePlayers < 2 ||
      (adminIsDeadButOnline && !kickee.isAdmin && eligiblePlayers < 3)
    ) {
      if (
        !kickee.isObserver &&
        !this.server.hasClientWonOrLost(kickee)
      ) {
        // 投票踢人不能成为游戏结果的决定性因素
        this.server.sendFluentMessageTo(conn, InsufficientVotes, [
          'kickee',
          kickee.name,
        ])
        this.endKickVote()
        return false
      } else if (vote) {
        // 仅一个玩家在游戏时，允许踢观战者
        this.endKickVote(false)
        return true
      }
    }

    // 发起新投票
    if (!voteInProgress) {
      // 检查冷却：被阻止的发起者在冷却期内不能发起新投票
      const cooldownTime = this.failedVoteKickers.get(kicker)
      if (cooldownTime !== undefined) {
        if (
          Date.now() - cooldownTime <
          this.server.settings.voteKickerCooldown
        ) {
          this.server.sendFluentMessageTo(conn, UnableToStartAVote)
          return false
        } else {
          this.failedVoteKickers.delete(kicker)
        }
      }

      // 开始投票
      console.log(
        `[server] Vote kick started on ${kickeeID}.`,
      )
      this.voteStartTime = Date.now()
      this.server.sendFluentMessage(
        VoteKickStarted,
        'kicker',
        kicker.name,
        'kickee',
        kickee.name,
      )
      this.server.dispatchServerOrdersToClients(
        Order.fromTargetString(
          'StartKickVote',
          '',
          false,
          kickeeID,
        ).serialize(),
      )
      this.kickee = { client: kickee, conn: kickeeConn }
      this.voteKickerStarter = { client: kicker, conn }
    }

    // 记录投票（不允许重复投票）
    if (!this.voteTracker.has(conn.playerIndex)) {
      this.voteTracker.set(conn.playerIndex, vote)
    } else {
      this.server.sendFluentMessageTo(conn, AlreadyVoted)
      return false
    }

    // 统计票数
    let votesFor = 0
    let votesAgainst = 0
    for (const [, v] of this.voteTracker) {
      if (v) {
        votesFor++
      } else {
        votesAgainst++
      }
    }

    // 将被踢者计入有资格玩家数，保障偶数对局公平性
    // （2v2 中一方不能踢掉另一方的玩家）
    if (this.clientHasPower(kickee)) {
      eligiblePlayers++
      votesAgainst++
    }

    const votesNeeded = Math.floor(eligiblePlayers / 2) + 1
    this.server.sendFluentMessage(
      VoteKickProgress,
      'kickee',
      kickee.name,
      'percentage',
      Math.floor((votesFor * 100) / eligiblePlayers),
    )

    // 投票通过
    if (vote && votesFor >= votesNeeded) {
      this.endKickVote(false)
      return true
    }

    // 投票已不可能通过
    if (eligiblePlayers - votesAgainst < votesNeeded) {
      this.endKickVoteAndBlockKicker()
      return false
    }

    // 重置计时器（有新投票时延长投票窗口）
    this.voteStartTime = Date.now()
    return false
  }

  // ---------------------------------------------------------------------------
  // EndKickVoteAndBlockKicker (对应 OpenRA EndKickVoteAndBlockKicker)
  // ---------------------------------------------------------------------------

  /**
   * 结束投票并阻止发起者在冷却期内发起新投票。
   *
   * OpenRA 对照: VoteKickTracker.EndKickVoteAndBlockKicker()
   */
  private endKickVoteAndBlockKicker(): void {
    if (this.voteStartTime === null) return

    if (
      this.voteKickerStarter &&
      this.server.conns.includes(this.voteKickerStarter.conn)
    ) {
      this.failedVoteKickers.set(
        this.voteKickerStarter.client,
        Date.now(),
      )
    }

    this.endKickVote()
  }

  // ---------------------------------------------------------------------------
  // EndKickVote (对应 OpenRA EndKickVote)
  // ---------------------------------------------------------------------------

  /**
   * 结束当前投票并清理所有投票状态。
   *
   * OpenRA 对照: VoteKickTracker.EndKickVote(bool sendMessage = true)
   *
   * @param sendMessage — 是否发送投票结束的 Fluent 消息
   */
  private endKickVote(sendMessage: boolean = true): void {
    if (this.voteStartTime === null) return

    if (sendMessage && this.kickee) {
      this.server.sendFluentMessage(VoteKickEnded, 'kickee', this.kickee.client.name)
    }

    if (this.kickee) {
      this.server.dispatchServerOrdersToClients(
        Order.fromTargetString(
          'EndKickVote',
          '',
          false,
          this.kickee.client.index,
        ).serialize(),
      )
    }

    // 清理状态
    this.voteStartTime = null
    this.voteKickerStarter = null
    this.kickee = null
    this.voteTracker.clear()
  }
}
