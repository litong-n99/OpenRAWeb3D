/**
 * ReplayConnection.test.ts — ReplayConnection 迁移单元测试
 *
 * 测试重点：二进制回放解析、块分组、IConnection 实现、
 * receiver 帧时序以及 OrderManager 交互。
 * 所有 Babylon.js 模块均不需要——纯逻辑测试。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ReplayConnection } from './ReplayConnection'
import { ReplayMetadata, MetaStartMarker } from '../FileFormats/ReplayMetadata'
import { GameInformation } from '../GameInformation'
import { Order, OrderPacket } from './Order'
import type { OrderManagerStub } from './UnitOrders'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const INT32_SIZE = 4

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 创建一个模拟网络数据包（帧前缀 BE + 序列化的订单数据）。
 */
function createNetworkPacket(frame: number, orders: readonly Order[]): Uint8Array {
  const serializedOrders: Uint8Array[] = orders.map((o) => o.serialize())
  const totalOrderLen = serializedOrders.reduce((s, o) => s + o.length, 0)
  const buffer = new Uint8Array(INT32_SIZE + totalOrderLen)
  const view = new DataView(buffer.buffer)
  view.setInt32(0, frame, false) // BE
  let offset = INT32_SIZE
  for (const o of serializedOrders) {
    buffer.set(o, offset)
    offset += o.length
  }
  return buffer
}

/**
 * 创建一个 frame 0 的 "StartGame" 订单数据包。
 */
function createStartGamePacket(): Uint8Array {
  const order = Order.fromTargetString('StartGame', '', false)
  return createNetworkPacket(0, [order])
}

/**
 * 创建一个 frame N 的普通订单数据包。
 */
function createOrderPacket(frame: number, orderString: string): Uint8Array {
  const order = Order.fromTargetString(orderString, '', false)
  return createNetworkPacket(frame, [order])
}

/**
 * 创建完整的回放二进制数据（含元数据尾部）。
 * @param packets — { clientId, data } 数组
 * @param gameInfo — 可选的 GameInformation（默认创建空对象）
 */
function createReplayBuffer(
  packets: Array<{ clientId: number; data: Uint8Array }>,
  gameInfo?: GameInformation,
): ArrayBuffer {
  // 计算数据包部分大小
  let packetSectionSize = 0
  for (const p of packets) {
    packetSectionSize += INT32_SIZE + INT32_SIZE + p.data.length
  }

  // 计算元数据尾部大小
  const info = gameInfo ?? new GameInformation()
  const metadata = new ReplayMetadata(info)
  const tempJson = info.toJSONString()
  const tempEncoded = new TextEncoder().encode(tempJson)
  const metadataSize = INT32_SIZE * 5 + tempEncoded.length // ReplayMetadata.writeToBuffer 大小

  const totalSize = packetSectionSize + metadataSize
  const buffer = new Uint8Array(totalSize)
  const view = new DataView(buffer.buffer)

  // 写入数据包
  let offset = 0
  for (const p of packets) {
    view.setInt32(offset, p.clientId, true) // LE
    offset += INT32_SIZE
    view.setInt32(offset, p.data.length, true) // LE
    offset += INT32_SIZE
    buffer.set(p.data, offset)
    offset += p.data.length
  }

  // 写入 MetaStartMarker
  view.setInt32(offset, MetaStartMarker, true)
  // 写入元数据尾部
  metadata.writeToBuffer(buffer, offset)

  return buffer.buffer
}

/**
 * 创建一个最小的 OrderManager mock。
 */
function createMockOrderManager(
  netFrameNumber: number = 0,
): OrderManagerStub & {
  _immediateOrders: Array<{ clientId: number; packet: OrderPacket }>
  _orders: Array<{ clientId: number; data: { frame: number; orders: OrderPacket } }>
  _syncs: Array<{ frame: number; syncHash: number; defeatState: bigint }>
  _disconnects: Array<{ clientId: number; frame: number }>
} {
  const immediateOrders: Array<{ clientId: number; packet: OrderPacket }> = []
  const orders: Array<{ clientId: number; data: { frame: number; orders: OrderPacket } }> = []
  const syncs: Array<{ frame: number; syncHash: number; defeatState: bigint }> = []
  const disconnects: Array<{ clientId: number; frame: number }> = []

  return {
    _immediateOrders: immediateOrders,
    _orders: orders,
    _syncs: syncs,
    _disconnects: disconnects,

    netFrameNumber,

    receiveImmediateOrders(clientId: number, packet: OrderPacket): void {
      immediateOrders.push({ clientId, packet })
    },
    receiveOrders(
      clientId: number,
      data: { frame: number; orders: OrderPacket },
    ): void {
      orders.push({ clientId, data })
    },
    receiveSync(frame: number, syncHash: number, defeatState: bigint): void {
      syncs.push({ frame, syncHash, defeatState })
    },
    receiveDisconnect(clientId: number, frame: number): void {
      disconnects.push({ clientId, frame })
    },

    receiveTickScale(_tickScale: number): void {
      // no-op for tests
    },

    // 其他必需的 OrderManagerStub 属性
    localFrameNumber: 0,
    gameStarted: true,
    lobbyInfo: {
      clients: [],
      globalSettings: {
        map: '',
        randomSeed: 0,
        netFrameInterval: 3,
        gameTimestep: 0,
        enableSyncReports: false,
        dedicated: false,
        optionOrDefault(_k: string, d: string | boolean): string | boolean {
          return d
        },
      },
      slots: new Map(),
      disabledSpawnPoints: [],
      clientWithIndex(_id: number) {
        return undefined
      },
      nonBotClients() {
        return []
      },
    },
    localClient: null,
    serverError: null,
    authenticationFailed: false,
    world: null,
    issueOrder(_o: Order): void {},
    gameSaveLastFrame: -1,
    gameSaveLastSyncFrame: -1,
    serverMapPool: null,
    connection: { localClientId: 1 },
  }
}

// ---------------------------------------------------------------------------
// 测试：构造函数 — 二进制解析
// ---------------------------------------------------------------------------

describe('ReplayConnection constructor — binary parsing', () => {
  it('parses StartGame and sets IsValid', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    gameInfo.finalGameTick = 1
    const buffer = createReplayBuffer(packets, gameInfo)

    const conn = new ReplayConnection('test.orarep', buffer)
    expect(conn.isValid).toBe(true)
  })

  it('sets IsValid=false when no StartGame order present', () => {
    const packets = [
      { clientId: 0, data: createOrderPacket(0, 'SyncInfo') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)

    const conn = new ReplayConnection('test.orarep', buffer)
    expect(conn.isValid).toBe(false)
  })

  it('parses FinalGameTick from metadata', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    gameInfo.finalGameTick = 12345
    const buffer = createReplayBuffer(packets, gameInfo)

    const conn = new ReplayConnection('test.orarep', buffer)
    expect(conn.finalGameTick).toBe(12345)
  })

  it('sets filename from constructor argument', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)

    const conn = new ReplayConnection('my-replay-file.orarep', buffer)
    expect(conn.filename).toBe('my-replay-file.orarep')
  })

  it('initializes LobbyInfo (empty by default)', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)

    const conn = new ReplayConnection('test.orarep', buffer)
    expect(conn.lobbyInfo).toBeDefined()
    expect(conn.lobbyInfo.clients).toEqual([])
  })

  it('handles empty replay data gracefully', () => {
    // 创建一个只包含元数据的缓冲区（无数据包）
    const gameInfo = new GameInformation()
    const metadata = new ReplayMetadata(gameInfo)
    const tempJson = gameInfo.toJSONString()
    const tempEncoded = new TextEncoder().encode(tempJson)
    const metadataSize = INT32_SIZE * 5 + tempEncoded.length
    const buffer = new Uint8Array(metadataSize)
    const view = new DataView(buffer.buffer)
    view.setInt32(0, MetaStartMarker, true)
    metadata.writeToBuffer(buffer, 0)

    const conn = new ReplayConnection('empty.orarep', buffer.buffer)
    expect(conn.isValid).toBe(false)
    expect(conn.tickCount).toBe(0)
    expect(conn.finalGameTick).toBe(0)
  })

  it('handles corrupt data gracefully', () => {
    // 提供完全无效的回放数据
    const badData = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00]).buffer

    // 构造应不抛出异常
    const conn = new ReplayConnection('bad.orarep', badData)
    expect(conn.isValid).toBe(false)
    expect(conn.finalGameTick).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 测试：TickCount 跟踪
// ---------------------------------------------------------------------------

describe('ReplayConnection TickCount', () => {
  it('tracks maximum frame number', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      { clientId: 1, data: createOrderPacket(5, 'Move') },
      { clientId: 1, data: createOrderPacket(10, 'Attack') },
      { clientId: 1, data: createOrderPacket(3, 'Guard') },
    ]
    const gameInfo = new GameInformation()
    gameInfo.finalGameTick = 10
    const buffer = createReplayBuffer(packets, gameInfo)

    const conn = new ReplayConnection('test.orarep', buffer)
    expect(conn.tickCount).toBe(10)
  })

  it('TickCount is 0 when no frame-N+ packets exist', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)

    const conn = new ReplayConnection('test.orarep', buffer)
    expect(conn.tickCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 测试：IConnection — send / sendImmediate（空操作）
// ---------------------------------------------------------------------------

describe('ReplayConnection send operations are no-ops', () => {
  let conn: ReplayConnection

  beforeEach(() => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    conn = new ReplayConnection('test.orarep', buffer)
  })

  it('send does not throw and does not modify state', () => {
    const order = Order.command('test')
    expect(() => conn.send(1, [order])).not.toThrow()
  })

  it('sendImmediate does not throw and does not modify state', () => {
    const order = Order.command('test')
    expect(() => conn.sendImmediate([order])).not.toThrow()
  })

  it('startGame is a no-op', () => {
    expect(() => conn.startGame()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 测试：IConnection — sendSync
// ---------------------------------------------------------------------------

describe('ReplayConnection sendSync', () => {
  it('enqueues sync hashes for receive processing', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    conn.sendSync(1, 0xABCD, 0n)

    const om = createMockOrderManager(0)
    conn.receive(om)

    expect(om._syncs.length).toBe(1)
    expect(om._syncs[0].frame).toBe(1)
    expect(om._syncs[0].syncHash).toBe(0xABCD)
    expect(om._syncs[0].defeatState).toBe(0n)
  })

  it('processes sync hashes before chunks', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      { clientId: 1, data: createOrderPacket(1, 'Move') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    // 在 receive 之前调用 sendSync——它应在 receive 中被处理
    conn.sendSync(1, 42, 1n)

    const om = createMockOrderManager(1) // netFrameNumber = 1
    conn.receive(om)

    // 同步哈希应排在首位（在块之前处理）
    expect(om._syncs.length).toBe(1)
    // 块也应被处理（frame 1 <= netFrameNumber(1) + latency(1)）
    expect(om._orders.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 测试：IConnection — receive
// ---------------------------------------------------------------------------

describe('ReplayConnection receive', () => {
  it('feeds orders at correct frame (respecting orderLatency)', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      { clientId: 1, data: createOrderPacket(3, 'Move') },
      { clientId: 1, data: createOrderPacket(5, 'Attack') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    // netFrameNumber = 1, orderLatency = 1
    // Chunk frame 3: 3 <= 1 + 1 = 2 → NO（不够）
    // Chunk frame 5: 5 <= 1 + 1 = 2 → NO
    const om1 = createMockOrderManager(1)
    conn.receive(om1)
    expect(om1._orders.length).toBe(0) // 没有块可以释放

    // netFrameNumber = 3, orderLatency = 1
    // Chunk frame 3: 3 <= 3 + 1 = 4 → YES
    // Chunk frame 5: 5 <= 3 + 1 = 4 → NO
    const om2 = createMockOrderManager(3)
    conn.receive(om2)
    expect(om2._orders.length).toBe(1)
    expect(om2._orders[0].data.frame).toBe(3)
  })

  it('feeds multiple frames as netFrameNumber advances', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      { clientId: 1, data: createOrderPacket(1, 'Move') },
      { clientId: 1, data: createOrderPacket(2, 'Attack') },
      { clientId: 1, data: createOrderPacket(3, 'Guard') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    // netFrameNumber = 3, orderLatency = 1
    // All frames (1,2,3) <= 3+1=4 → YES
    const om = createMockOrderManager(3)
    conn.receive(om)
    expect(om._orders.length).toBe(3)
    expect(om._orders[0].data.frame).toBe(1)
    expect(om._orders[1].data.frame).toBe(2)
    expect(om._orders[2].data.frame).toBe(3)
  })

  it('dispatches frame-0 orders as immediate orders', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      { clientId: 0, data: createOrderPacket(0, 'SyncInfo') },
      { clientId: 1, data: createOrderPacket(1, 'Move') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    const om = createMockOrderManager(1)
    conn.receive(om)

    // Frame-0 SyncInfo 应从块中消失（在构造函数中处理）
    // Frame-1 Move 应作为常规订单分派
    expect(om._orders.length).toBe(1)
    expect(om._orders[0].data.frame).toBe(1)
  })

  it('dispatches orders to correct OrderManager methods', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      { clientId: 5, data: createOrderPacket(1, 'Move') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    const om = createMockOrderManager(1)
    conn.receive(om)

    expect(om._orders.length).toBe(1)
    expect(om._orders[0].clientId).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 测试：localClientId
// ---------------------------------------------------------------------------

describe('ReplayConnection localClientId', () => {
  it('returns -1 (observer)', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    expect(conn.localClientId).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// 测试：dispose
// ---------------------------------------------------------------------------

describe('ReplayConnection dispose', () => {
  it('is a no-op that clears internal state', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      { clientId: 1, data: createOrderPacket(1, 'Move') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    conn.dispose()
    // dispose 之后 receive 不应抛出异常（但也不应处理任何数据）
    const om = createMockOrderManager(10)
    expect(() => conn.receive(om)).not.toThrow()
    expect(om._orders.length).toBe(0) // 块已清除
  })
})

// ---------------------------------------------------------------------------
// 测试：多个数据包共处一个块
// ---------------------------------------------------------------------------

describe('ReplayConnection multi-packet chunks', () => {
  it('groups multiple same-frame packets into one chunk', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      // 同一个客户端在 frame 1 的多条订单
      { clientId: 1, data: createOrderPacket(1, 'Move') },
      { clientId: 1, data: createOrderPacket(1, 'Attack') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    const om = createMockOrderManager(1)
    conn.receive(om)

    // 两个订单都应在同一个块中分派
    expect(om._orders.length).toBe(2)
    expect(om._orders[0].data.frame).toBe(1)
    expect(om._orders[1].data.frame).toBe(1)
  })

  it('handles packets from different clients in the same frame', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
      { clientId: 1, data: createOrderPacket(2, 'Move') },
      { clientId: 2, data: createOrderPacket(2, 'Attack') },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    const om = createMockOrderManager(2)
    conn.receive(om)

    expect(om._orders.length).toBe(2)
    expect(om._orders[0].clientId).toBe(1)
    expect(om._orders[1].clientId).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 测试：SyncInfo 和 LobbyInfo 解析
// ---------------------------------------------------------------------------

describe('ReplayConnection SyncInfo parsing', () => {
  it('parses SyncInfo from frame-0 packet before StartGame', () => {
    // SyncInfo 必须在 StartGame 之前到达（与 OpenRA 行为一致）
    const syncInfoOrder = Order.fromTargetString(
      'SyncInfo',
      '{"map":"test","mod":"cnc"}',
      false,
    )
    const syncInfoPacket = createNetworkPacket(0, [syncInfoOrder])

    const packets = [
      { clientId: 0, data: syncInfoPacket },
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    // LobbyInfo 应从 SyncInfo 中解析
    expect(conn.lobbyInfo).toBeDefined()
    expect(conn.isValid).toBe(true)
  })

  it('creates empty LobbyInfo when no SyncInfo is present', () => {
    const packets = [
      { clientId: 0, data: createStartGamePacket() },
    ]
    const gameInfo = new GameInformation()
    const buffer = createReplayBuffer(packets, gameInfo)
    const conn = new ReplayConnection('test.orarep', buffer)

    expect(conn.lobbyInfo).toBeDefined()
    expect(conn.lobbyInfo.clients).toEqual([])
  })
})
