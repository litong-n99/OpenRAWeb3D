/**
 * ReplayConnection.ts — 回放播放连接，实现 IConnection 接口以透明地向
 * OrderManager 提供预先录制的订单数据
 * OpenRA 对照: OpenRA.Game/Network/ReplayConnection.cs (136 lines)
 *
 * 核心范式转换:
 * - C# File.OpenRead + BinaryReader → DataView over ArrayBuffer 解析
 * - C# Queue<Chunk> + Queue<(int, int, ulong)> → Chunk[] 数组 + sync 数组
 *   (单线程，无并发访问)
 * - C# BitConverter.ToInt32(packet, 0) → DataView.getInt32(0, true) (小端序)
 * - C# Session.Deserialize(targetString, orderString) — LobbyInfo 解析
 *   → 简化版 LobbyInfoStub（TODO: 完整 Session.Deserialize 集成）
 * - C# Game.ModData.GetOrCreate<GameSpeeds>() → 默认 orderLatency = 1
 *   (回放播放始终可以安全地使用最低延迟)
 * - C# OrderIO.TryParse* → 已迁移的 tryParseDisconnect / tryParseSync /
 *   tryParseOrderPacket
 * - C# IDisposable.Dispose() → dispose() (空操作——无原生资源)
 */

import type { IConnection } from './Connection.js'
import {
  tryParseDisconnect,
  tryParseSync,
  tryParseOrderPacket,
} from './Order.js'
import { ReplayMetadata, MetaStartMarker } from '../FileFormats/ReplayMetadata.js'
import type { OrderManagerStub, LobbyInfoStub } from './UnitOrders.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** Int32 的字节大小（全部使用小端序）。 */
const INT32_SIZE = 4

/** 默认 orderLatency（单帧）——回放播放可以安全地以最低延迟处理。 */
const DEFAULT_ORDER_LATENCY = 1

// ---------------------------------------------------------------------------
// Chunk — 内部数据包分组（对应 OpenRA ReplayConnection.Chunk）
// ---------------------------------------------------------------------------

/**
 * 按帧号分组的一组数据包。
 *
 * OpenRA 对照: ReplayConnection.Chunk inner class
 */
interface Chunk {
  /** 此块数据包所属的帧编号。 */
  frame: number
  /** 此帧的数据包（每个数据包包括 clientId 和原始数据包字节）。 */
  packets: Array<{ clientId: number; packet: Uint8Array }>
}

// ---------------------------------------------------------------------------
// PacketEntry — 解析后的单条数据包（内部）
// ---------------------------------------------------------------------------

/**
 * 回放流中解析后的单条数据包。
 */
interface PacketEntry {
  /** 发送客户端 ID。 */
  clientId: number
  /** 原始数据包字节（4 字节帧前缀 + 序列化内容）。 */
  data: Uint8Array
  /** 从 data 中提取的帧编号（前 4 字节，小端序 int32）。 */
  frame: number
}

// ---------------------------------------------------------------------------
// ReplayConnection (对应 OpenRA ReplayConnection)
// ---------------------------------------------------------------------------

/**
 * 实现 IConnection 的回放播放连接。
 * 读取 .orarep 文件并逐帧向 OrderManager 提供录制的订单，
 * 使回放播放对游戏引擎完全透明。
 *
 * OpenRA 对照: ReplayConnection class : IConnection
 *
 * 所有 send() / sendImmediate() 均为空操作——回放期间本地生成的订单将被忽略。
 * sendSync() 排队同步哈希，以便 receive() 在正确的时机处理。
 * localClientId 返回 -1（观察者/旁观者）。
 */
export class ReplayConnection implements IConnection {
  // ---------------------------------------------------------------------------
  // 公共属性
  // ---------------------------------------------------------------------------

  /** 游戏过程中遇到的最大帧编号。
   *
   * OpenRA 对照: ReplayConnection.TickCount
   */
  readonly tickCount: number

  /** 游戏结束时的最终帧编号（来自元数据）。
   *
   * OpenRA 对照: ReplayConnection.FinalGameTick
   */
  readonly finalGameTick: number

  /** 此回放是否包含有效的 StartGame 订单。
   *
   * OpenRA 对照: ReplayConnection.IsValid
   */
  readonly isValid: boolean

  /** 回放中记录的 LobbyInfo（游戏大厅状态）。
   *
   * OpenRA 对照: ReplayConnection.LobbyInfo
   */
  readonly lobbyInfo: LobbyInfoStub

  /** 回放文件名（虚拟路径）。
   *
   * OpenRA 对照: ReplayConnection.Filename
   */
  readonly filename: string

  // ---------------------------------------------------------------------------
  // 私有内部状态
  // ---------------------------------------------------------------------------

  /** 按帧分组的数据包块（FIFO 顺序）。 */
  private readonly _chunks: Chunk[] = []

  /** 待处理的同步哈希数据包队列。 */
  private readonly _sync: Array<{
    frame: number
    syncHash: number
    defeatState: bigint
  }> = []

  /** 订单延迟（帧数）——来自游戏速度配置。 */
  private readonly _orderLatency: number

  // ---------------------------------------------------------------------------
  // 构造
  // ---------------------------------------------------------------------------

  /**
   * 从二进制回放数据创建一个新的 ReplayConnection。
   *
   * OpenRA 对照: ReplayConnection(string replayFilename)
   *
   * 解析完整的 .orarep 二进制格式：
   * 1. 通过 ReplayMetadata.readFromBuffer() 从尾部读取元数据
   * 2. 解析数据包流：`[clientID: int32 LE][packetLen: int32 LE][packet: bytes]`
   * 3. Frame-0 数据包：解析 StartGame（设置 IsValid）和 SyncInfo（解析 LobbyInfo）
   * 4. Frame-N+ 数据包：按帧号分组为 Chunk
   * 5. 断开连接和同步哈希数据包类型会跳过帧分组，但保留在块内
   *    （它们会在 receive() 时被检测和处理）
   * 6. 跟踪 TickCount = max(frame)
   *
   * @param replayFilename — 回放文件的虚拟路径/名称
   * @param replayData — 包含完整回放文件的 ArrayBuffer（含元数据尾部）
   */
  constructor(replayFilename: string, replayData: ArrayBuffer) {
    this.filename = replayFilename

    // 1. 从尾部读取元数据
    const metadata = ReplayMetadata.readFromBuffer(replayData)
    this.finalGameTick = metadata?.gameInfo?.finalGameTick ?? 0

    // 2. 将所有数据包解析为扁平列表
    const allPackets = this._parseAllPackets(replayData)

    // 3. 处理 frame-0 数据包并构建块
    let isValid = false
    let lobbyInfo: LobbyInfoStub = createEmptyLobbyInfo()
    let tickCount = 0

    const chunks: Chunk[] = []
    // 积累当前帧的非特殊数据包（断开/同步被跳过，但合并到下一个块中）
    let currentPackets: Array<{ clientId: number; packet: Uint8Array }> = []

    for (const entry of allPackets) {
      const isSpecial =
        entry.data.length > 4 &&
        (entry.data[4] === 0xbf /* Disconnect */ ||
          entry.data[4] === 0x65 /* SyncHash */)

      // 将每个数据包添加到当前积累中
      currentPackets.push({ clientId: entry.clientId, packet: entry.data })

      if (isSpecial) {
        // 特殊数据包：跳过帧分组（它们将与下一个常规数据包合并到一个块中）
        continue
      }

      if (entry.frame === 0) {
        // Frame-0 常规数据包：解析 StartGame 和 SyncInfo
        const parsed = tryParseOrderPacket(entry.data)
        if (parsed) {
          for (const order of parsed.packet.getOrders(null)) {
            if (order.orderString === 'StartGame') {
              isValid = true
            } else if (order.orderString === 'SyncInfo' && !isValid) {
              lobbyInfo = parseLobbyInfo(order.targetString)
            }
          }
        }
        // 从当前积累中移除 frame-0 数据包（它们不属于任何块）
        // 但保留特殊数据包（断开/同步），它们需要通过 receive() 处理。
        // 由于我们已经遍历了该数据包，现在将它留待下一次常规帧迭代处理。
        // 实际上，我们只从 currentPackets 中移除最后一项（frame-0 常规数据包）。
        currentPackets.pop()
        // 特殊数据包可能在 frame-0 常规数据包之后到达——它们已存在于 currentPackets 中。
      } else {
        // Frame-N+ 常规数据包：完成当前块
        if (currentPackets.length > 0) {
          const frameForChunk = entry.frame
          chunks.push({
            frame: frameForChunk,
            packets: [...currentPackets],
          })
          currentPackets = []
        }

        tickCount = Math.max(tickCount, entry.frame)
      }
    }

    // 处理所有帧处理后可能剩余的未分组数据包
    if (currentPackets.length > 0) {
      // 这些数据包没有下一个帧可以关联——将它们附加到最后一个块中
      if (chunks.length > 0) {
        chunks[chunks.length - 1].packets.push(...currentPackets)
      }
      // 如果没有块，则这些数据包作为孤立数据包被丢弃（没有帧就无法重放）
    }

    this.isValid = isValid
    this.lobbyInfo = lobbyInfo
    this.tickCount = tickCount
    this._chunks = chunks

    // 4. 计算 orderLatency
    // TODO-17.B.2: 当 GameSpeeds 完全迁移后，通过 GameSpeeds 集成正确的游戏速度映射
    this._orderLatency = DEFAULT_ORDER_LATENCY
  }

  // ---------------------------------------------------------------------------
  // 内部：数据包解析
  // ---------------------------------------------------------------------------

  /**
   * 将回放二进制流解析为 PacketEntry 对象列表。
   *
   * 读取 [clientID: int32 LE][packetLen: int32 LE][packet: bytes] 元组，
   * 直到 clientID === MetaStartMarker（-1）标记数据包部分结束。
   *
   * @param data — 包含回放文件的 ArrayBuffer
   * @returns 解析后的数据包（按文件顺序）
   */
  private _parseAllPackets(data: ArrayBuffer): PacketEntry[] {
    const view = new DataView(data)
    const packets: PacketEntry[] = []
    let offset = 0

    while (offset + INT32_SIZE <= data.byteLength) {
      const clientId = view.getInt32(offset, true) // 小端序
      offset += INT32_SIZE

      // MetaStartMarker 标记数据包部分结束
      if (clientId === MetaStartMarker) {
        break
      }

      if (offset + INT32_SIZE > data.byteLength) break

      const packetLen = view.getInt32(offset, true) // 小端序
      offset += INT32_SIZE

      if (packetLen < 0 || offset + packetLen > data.byteLength) break

      const packetData = new Uint8Array(data, offset, packetLen)
      offset += packetLen

      // 提取帧（数据包的前 4 字节）
      // NOTE: 使用大端序以匹配网络协议（OrderPacket.serialize 使用 BE）。
      // C# 使用小端序（BitConverter + BinaryWriter），但我们的网络层已切换为大端序。
      let frame = 0
      if (packetData.length >= INT32_SIZE) {
        const packetView = new DataView(
          packetData.buffer,
          packetData.byteOffset,
          packetData.byteLength,
        )
        frame = packetView.getInt32(0, false) // 大端序（匹配网络协议）
      }

      packets.push({ clientId, data: packetData, frame })
    }

    return packets
  }

  // ---------------------------------------------------------------------------
  // IConnection 实现 — 游戏生命周期
  // ---------------------------------------------------------------------------

  /**
   * 空操作——回放会提供所有订单，游戏已经“启动”。
   *
   * OpenRA 对照: IConnection.StartGame()
   */
  startGame(): void {
    // 无操作
  }

  // ---------------------------------------------------------------------------
  // IConnection 实现 — 发送（全部为空操作）
  // ---------------------------------------------------------------------------

  /**
   * 空操作——忽略回放期间本地生成的订单。
   *
   * OpenRA 对照: IConnection.Send(int, IEnumerable<Order>)
   */
  send(_frame: number, _orders: readonly import('./Order.js').Order[]): void {
    // 无操作：回放播放期间忽略本地订单
  }

  /**
   * 空操作——忽略回放期间本地生成的即时订单。
   *
   * OpenRA 对照: IConnection.SendImmediate(IEnumerable<Order>)
   */
  sendImmediate(_orders: readonly import('./Order.js').Order[]): void {
    // 无操作：回放播放期间忽略本地订单
  }

  /**
   * 将同步哈希排队，供 receive() 期间处理。
   *
   * OpenRA 对照: IConnection.SendSync(int, int, ulong)
   */
  sendSync(frame: number, syncHash: number, defeatState: bigint): void {
    this._sync.push({ frame, syncHash, defeatState })
  }

  // ---------------------------------------------------------------------------
  // IConnection 实现 — 接收（主要播放循环）
  // ---------------------------------------------------------------------------

  /**
   * 将录制的订单按帧提供给 OrderManager。
   *
   * OpenRA 对照: IConnection.Receive(OrderManager)
   *
   * 1. 首先，将排队的同步哈希出队 → orderManager.receiveSync()
   * 2. 然后，将 Frame <= netFrameNumber + orderLatency 的块出队
   * 3. 对于每个块的数据包：通过 tryParse* 函数检测类型 →
   *    分发到适当的 OrderManager 方法：
   *    - tryParseDisconnect → receiveDisconnect
   *    - tryParseSync → receiveSync
   *    - tryParseOrderPacket → frame===0 ? receiveImmediateOrders : receiveOrders
   *    - 未知格式 → 抛出错误
   *
   * @param orderManager — 订单管理器
   */
  receive(orderManager: OrderManagerStub): void {
    // 首先处理排队的同步哈希
    while (this._sync.length > 0) {
      const s = this._sync.shift()!
      orderManager.receiveSync(s.frame, s.syncHash, s.defeatState)
    }

    // 处理已达到可重放帧号的块
    while (
      this._chunks.length > 0 &&
      this._chunks[0].frame <= orderManager.netFrameNumber + this._orderLatency
    ) {
      const chunk = this._chunks.shift()!
      for (const o of chunk.packets) {
        // 尝试作为断开连接数据包解析
        const disconnect = tryParseDisconnect(o.packet, undefined)
        if (disconnect) {
          orderManager.receiveDisconnect(disconnect.clientId, disconnect.frame)
          continue
        }

        // 尝试作为同步数据包解析
        const sync = tryParseSync(o.packet)
        if (sync) {
          orderManager.receiveSync(sync.frame, sync.syncHash, sync.defeatState)
          continue
        }

        // 尝试作为订单数据包解析
        const orderPacket = tryParseOrderPacket(o.packet)
        if (orderPacket) {
          if (orderPacket.frame === 0) {
            orderManager.receiveImmediateOrders(
              o.clientId,
              orderPacket.packet,
            )
          } else {
            orderManager.receiveOrders(o.clientId, {
              frame: orderPacket.frame,
              orders: orderPacket.packet,
            })
          }
          continue
        }

        // 未知数据包格式
        throw new Error(
          `Received unknown packet from client ${o.clientId} ` +
            `with length ${o.packet.length}`,
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // IConnection 实现 — 其它
  // ---------------------------------------------------------------------------

  /**
   * 返回 -1（观察者/旁观者）。
   *
   * OpenRA 对照: IConnection.LocalClientId => -1
   */
  get localClientId(): number {
    return -1
  }

  /**
   * 空操作——没有需要释放的原生资源。
   *
   * OpenRA 对照: IDisposable.Dispose()
   */
  dispose(): void {
    // 无操作
    this._chunks.length = 0
    this._sync.length = 0
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 创建一个空的 LobbyInfoStub。
 */
function createEmptyLobbyInfo(): LobbyInfoStub {
  const clients: import('./UnitOrders.js').ClientStub[] = []
  const slots = new Map<string, import('./UnitOrders.js').SlotStub>()

  const globalSettings: import('./UnitOrders.js').GlobalSettingsStub = {
    map: '',
    randomSeed: 0,
    netFrameInterval: 3,
    gameTimestep: 0,
    enableSyncReports: false,
    dedicated: false,
    optionOrDefault(
      _key: string,
      defaultValue: string | boolean,
    ): string | boolean {
      return defaultValue
    },
  } as import('./UnitOrders.js').GlobalSettingsStub

  return {
    clients,
    globalSettings,
    slots,
    disabledSpawnPoints: [],
    clientWithIndex(id: number): import('./UnitOrders.js').ClientStub | undefined {
      return clients.find((c) => c.index === id)
    },
    nonBotClients(): readonly import('./UnitOrders.js').ClientStub[] {
      return clients.filter((c) => !c.bot)
    },
  }
}

/**
 * 从 SyncInfo 订单的 targetString 解析 LobbyInfo。
 *
 * OpenRA 对照: Session.Deserialize(targetString, "SyncInfo")
 *
 * 简化实现：从 JSON targetString 创建一个空的 LobbyInfo。
 * TODO-17.B.2: 集成完整的 Session.Deserialize 以支持从回放中
 * 正确恢复 LobbyInfo。
 *
 * @param targetString — SyncInfo JSON 字符串（可能为 null）
 * @returns 一个 LobbyInfoStub
 */
function parseLobbyInfo(targetString: string | null): LobbyInfoStub {
  const empty = createEmptyLobbyInfo()
  if (!targetString || targetString.length === 0) return empty

  try {
    // 验证是否为有效的 JSON（格式与 Session.serialize 对应）
    // 目前这是一个简化实现
    void JSON.parse(targetString)
    // TODO-17.B.2: 当 Session.Deserialize 完成迁移后，从此处调用
    return empty
  } catch {
    return empty
  }
}
