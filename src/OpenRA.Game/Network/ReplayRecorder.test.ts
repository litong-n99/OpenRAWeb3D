/**
 * ReplayRecorder.test.ts — ReplayRecorder 迁移单元测试
 *
 * 测试重点：状态管理、预启动缓冲、二进制格式验证、dispose 生命周期。
 * 所有 Babylon.js 模块均不需要——纯逻辑测试。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ReplayRecorder } from './ReplayRecorder'
import { ReplayMetadata } from '../FileFormats/ReplayMetadata'
import { GameInformation } from '../GameInformation'
import {
  MetaStartMarker,
} from '../FileFormats/ReplayMetadata'
import { Order, OrderPacket } from './Order'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** INT32 的字节大小。 */
const INT32_SIZE = 4

/**
 * 创建一个模拟网络数据包（帧前缀 BE + 序列化的订单数据）。
 * 使用 OrderPacket.serialize() 以确保与 tryParseOrderPacket 兼容。
 * @param frame 帧编号
 * @param orders 订单数组
 */
function createNetworkPacket(frame: number, orders: readonly Order[]): Uint8Array {
  const packet = new OrderPacket(orders)
  return packet.serialize(frame)
}

/**
 * 创建一个 frame 0 的 "StartGame" 订单数据包。
 */
function createStartGamePacket(): Uint8Array {
  const order = Order.fromTargetString('StartGame', '', false)
  return createNetworkPacket(0, [order])
}

/**
 * 创建一个 frame 0 的 "SyncInfo" 订单数据包。
 */
function createSyncInfoPacket(info: string): Uint8Array {
  const order = Order.fromTargetString('SyncInfo', info, false)
  return createNetworkPacket(0, [order])
}

/**
 * 创建一个 frame N 的普通订单数据包。
 */
function createRegularPacket(frame: number, orderString: string): Uint8Array {
  const order = Order.fromTargetString(orderString, '', false)
  return createNetworkPacket(frame, [order])
}

// ---------------------------------------------------------------------------
// 测试：isGameStart
// ---------------------------------------------------------------------------

describe('ReplayRecorder.isGameStart', () => {
  it('returns true for StartGame order at frame 0', () => {
    const packet = createStartGamePacket()
    expect(ReplayRecorder.isGameStart(packet)).toBe(true)
  })

  it('returns false for non-StartGame order at frame 0', () => {
    const packet = createSyncInfoPacket('{"maps":[]}')
    expect(ReplayRecorder.isGameStart(packet)).toBe(false)
  })

  it('returns false for StartGame order at non-zero frame', () => {
    const order = Order.fromTargetString('StartGame', '', false)
    const packet = createNetworkPacket(5, [order])
    expect(ReplayRecorder.isGameStart(packet)).toBe(false)
  })

  it('returns false for empty data', () => {
    const empty = new Uint8Array(0)
    expect(ReplayRecorder.isGameStart(empty)).toBe(false)
  })

  it('returns false for data too short to contain a frame', () => {
    const short = new Uint8Array(3)
    expect(ReplayRecorder.isGameStart(short)).toBe(false)
  })

  it('returns true when StartGame is the only order at frame 0', () => {
    // NOTE: tryParseOrderPacket 的拼接 msgpack 分割是启发式的（参见
    // Order.ts 中的 TODO-MINOR）。每个调用方应每个数据包只发送一个订单。
    // 此测试验证常见的单订单场景。
    const startGame = Order.fromTargetString('StartGame', '', false)
    const packet = createNetworkPacket(0, [startGame])
    expect(ReplayRecorder.isGameStart(packet)).toBe(true)
  })

  it('returns false for packet with frame 0 but unrelated order string', () => {
    const order = Order.fromTargetString('UnrelatedCommand', '', false)
    const packet = createNetworkPacket(0, [order])
    expect(ReplayRecorder.isGameStart(packet)).toBe(false)
  })

  it('returns false for corrupt/unparseable data', () => {
    // 数据包不是有效的 msgpack
    const badData = new Uint8Array([0, 0, 0, 0, 0xFF, 0xFF, 0xFF])
    expect(ReplayRecorder.isGameStart(badData)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 测试：预启动缓冲
// ---------------------------------------------------------------------------

describe('ReplayRecorder pre-start buffer', () => {
  let recorder: ReplayRecorder

  beforeEach(() => {
    recorder = new ReplayRecorder(() => 'test-replay')
  })

  it('buffers packets before StartGame detection', () => {
    const packet1 = createRegularPacket(0, 'SyncInfo')
    const packet2 = createRegularPacket(0, 'LobbyInfo')

    recorder.receive(1, packet1)
    recorder.receive(1, packet2)

    // 确认仍处于预启动模式
    expect(recorder.recordingToFile).toBe(false)
    expect(recorder.chosenFilename).toBe('')
  })

  it('flushes pre-start buffer on StartGame detection', () => {
    const prePacket = createRegularPacket(0, 'SyncInfo')
    const startPacket = createStartGamePacket()

    recorder.receive(1, prePacket)
    expect(recorder.recordingToFile).toBe(false)

    recorder.receive(1, startPacket)
    expect(recorder.recordingToFile).toBe(true)
    expect(recorder.chosenFilename).toBe('test-replay')
  })

  it('records post-StartGame packets to main storage', () => {
    const prePacket = createRegularPacket(0, 'SyncInfo')
    const startPacket = createStartGamePacket()
    const postPacket = createRegularPacket(1, 'Move')

    recorder.receive(1, prePacket)
    recorder.receive(1, startPacket)
    recorder.receive(1, postPacket)

    expect(recorder.recordingToFile).toBe(true)

    // dispose 并验证缓冲区包含所有数据包
    recorder.dispose()
    const buffer = recorder.getBuffer()!
    expect(buffer).not.toBeNull()
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('calls chooseFilename only once (on StartGame)', () => {
    let callCount = 0
    const rec = new ReplayRecorder(() => {
      callCount++
      return 'test-replay'
    })

    rec.receive(1, createRegularPacket(0, 'SyncInfo'))
    expect(callCount).toBe(0)

    rec.receive(1, createStartGamePacket())
    expect(callCount).toBe(1)
    expect(rec.chosenFilename).toBe('test-replay')

    // 后续调用不应再次触发 chooseFilename
    rec.receive(1, createRegularPacket(1, 'Move'))
    expect(callCount).toBe(1)

    rec.dispose()
  })
})

// ---------------------------------------------------------------------------
// 测试：receive 二进制格式
// ---------------------------------------------------------------------------

describe('ReplayRecorder receive binary format', () => {
  it('writes correct [clientID][dataLen][data] tuples in the buffer', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')

    // 首先发送 StartGame 以切换到文件模式
    recorder.receive(1, createStartGamePacket())

    // 发送已知的 clientId 和 data
    const clientId = 42
    const testData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05])
    recorder.receive(clientId, testData)

    recorder.dispose()
    const buffer = recorder.getBuffer()!

    // 计算预期的数据包部分偏移量
    // 第一个数据包：StartGame 数据包
    // [clientID(4) LE][dataLen(4) LE][data bytes]
    const expectedStartGameLen =
      INT32_SIZE + INT32_SIZE + createStartGamePacket().length

    // 验证第二个数据包（我们的测试数据包）
    const offset = expectedStartGameLen
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    const readClientId = view.getInt32(offset, true) // LE
    expect(readClientId).toBe(clientId)

    const readDataLen = view.getInt32(offset + INT32_SIZE, true) // LE
    expect(readDataLen).toBe(testData.length)

    // 验证数据字节
    for (let i = 0; i < testData.length; i++) {
      expect(buffer[offset + INT32_SIZE * 2 + i]).toBe(testData[i])
    }
  })

  it('writes multiple packets in order', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    recorder.receive(1, createStartGamePacket())

    const data1 = new Uint8Array([0xAA, 0xBB])
    const data2 = new Uint8Array([0xCC, 0xDD, 0xEE])

    recorder.receive(10, data1)
    recorder.receive(20, data2)

    recorder.dispose()
    const buffer = recorder.getBuffer()!

    // 跳过第一个数据包（StartGame）
    const firstPacketLen = INT32_SIZE + INT32_SIZE + createStartGamePacket().length
    let offset = firstPacketLen

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    // 验证数据包 1
    expect(view.getInt32(offset, true)).toBe(10) // clientId
    offset += INT32_SIZE
    const len1 = view.getInt32(offset, true)
    expect(len1).toBe(2)
    offset += INT32_SIZE
    expect(buffer[offset]).toBe(0xAA)
    expect(buffer[offset + 1]).toBe(0xBB)
    offset += len1

    // 验证数据包 2
    expect(view.getInt32(offset, true)).toBe(20) // clientId
    offset += INT32_SIZE
    const len2 = view.getInt32(offset, true)
    expect(len2).toBe(3)
    offset += INT32_SIZE
    expect(buffer[offset]).toBe(0xCC)
    expect(buffer[offset + 1]).toBe(0xDD)
    expect(buffer[offset + 2]).toBe(0xEE)
  })
})

// ---------------------------------------------------------------------------
// 测试：receiveFrame
// ---------------------------------------------------------------------------

describe('ReplayRecorder.receiveFrame', () => {
  it('prepends frame int32 (BE) to data and calls receive', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    recorder.receive(1, createStartGamePacket()) // 切换到文件模式

    const testData = new Uint8Array([0x10, 0x20, 0x30])
    recorder.receiveFrame(7, 99, testData)

    recorder.dispose()
    const buffer = recorder.getBuffer()!

    // 跳过第一个数据包（StartGame）
    const firstPacketLen = INT32_SIZE + INT32_SIZE + createStartGamePacket().length
    let offset = firstPacketLen

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    // 验证 clientId
    expect(view.getInt32(offset, true)).toBe(7)
    offset += INT32_SIZE

    // 验证 dataLen：帧前缀(4) + 测试数据(3) = 7
    const dataLen = view.getInt32(offset, true)
    expect(dataLen).toBe(INT32_SIZE + testData.length) // 4 + 3 = 7
    offset += INT32_SIZE

    // 验证帧前缀（大端序）
    const storedFrame = view.getInt32(offset, false) // BE
    expect(storedFrame).toBe(99)
    offset += INT32_SIZE

    // 验证数据字节
    expect(buffer[offset]).toBe(0x10)
    expect(buffer[offset + 1]).toBe(0x20)
    expect(buffer[offset + 2]).toBe(0x30)
  })
})

// ---------------------------------------------------------------------------
// 测试：dispose 生命周期
// ---------------------------------------------------------------------------

describe('ReplayRecorder dispose', () => {
  it('finalizes metadata with EndTimeUtc on dispose', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    const gameInfo = new GameInformation()
    gameInfo.startTimeUtc = new Date('2024-01-01T00:00:00Z')
    recorder.metadata = new ReplayMetadata(gameInfo)

    recorder.receive(1, createStartGamePacket())
    expect(gameInfo.endTimeUtc).toBeNull()

    recorder.dispose()
    expect(gameInfo.endTimeUtc).not.toBeNull()
    expect(gameInfo.endTimeUtc! > gameInfo.startTimeUtc).toBe(true)
  })

  it('writes metadata footer in dispose', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    const gameInfo = new GameInformation()
    gameInfo.mod = 'cnc'
    gameInfo.version = '1.0'
    gameInfo.mapUid = 'test-map'
    recorder.metadata = new ReplayMetadata(gameInfo)

    recorder.receive(1, createStartGamePacket())
    recorder.dispose()

    const buffer = recorder.getBuffer()!
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    // 计算预期数据包部分大小
    const packetSize = INT32_SIZE + INT32_SIZE + createStartGamePacket().length

    // MetaStartMarker 应紧跟数据包部分之后
    const metaStart = view.getInt32(packetSize, true) // LE
    expect(metaStart).toBe(MetaStartMarker)
  })

  it('is idempotent — double dispose is safe', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    recorder.receive(1, createStartGamePacket())

    recorder.dispose()
    const buffer1 = recorder.getBuffer()

    // 第二次 dispose 应不执行任何操作
    expect(() => recorder.dispose()).not.toThrow()
    const buffer2 = recorder.getBuffer()

    // 缓冲区应相同
    expect(buffer2).toEqual(buffer1)
  })

  it('getBuffer returns null before dispose', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    recorder.receive(1, createStartGamePacket())
    expect(recorder.getBuffer()).toBeNull()
  })

  it('getBuffer returns non-null after dispose', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    recorder.receive(1, createStartGamePacket())
    recorder.dispose()
    expect(recorder.getBuffer()).not.toBeNull()
  })

  it('receive after dispose is a no-op', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    recorder.receive(1, createStartGamePacket())
    recorder.dispose()

    const buffer1 = recorder.getBuffer()
    const buf1Len = buffer1!.length

    // 已 dispose 后再调用 receive 应被忽略
    recorder.receive(1, createRegularPacket(10, 'Move'))
    recorder.dispose()
    const buffer2 = recorder.getBuffer()

    // 缓冲区长度应不变
    expect(buffer2!.length).toBe(buf1Len)
  })
})

// ---------------------------------------------------------------------------
// 测试：无元数据时应正确处理
// ---------------------------------------------------------------------------

describe('ReplayRecorder without metadata', () => {
  it('produces a valid buffer without metadata footer', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    recorder.receive(1, createStartGamePacket())
    recorder.receive(1, createRegularPacket(1, 'Move'))
    recorder.dispose()

    const buffer = recorder.getBuffer()!
    // 仅有数据包，无元数据尾部
    const packetCount = 2
    const totalPacketDataSize =
      (createStartGamePacket().length + createRegularPacket(1, 'Move').length)
    const expectedSize = packetCount * (INT32_SIZE * 2) + totalPacketDataSize
    expect(buffer.length).toBe(expectedSize)
  })
})

// ---------------------------------------------------------------------------
// 测试：chosenFilename 和 recordingToFile
// ---------------------------------------------------------------------------

describe('ReplayRecorder filename and state', () => {
  it('chosenFilename is empty before StartGame', () => {
    const recorder = new ReplayRecorder(() => 'my-replay')
    expect(recorder.chosenFilename).toBe('')
    expect(recorder.recordingToFile).toBe(false)
  })

  it('chosenFilename is set after StartGame', () => {
    const recorder = new ReplayRecorder(() => 'my-replay')
    recorder.receive(1, createStartGamePacket())
    expect(recorder.chosenFilename).toBe('my-replay')
    expect(recorder.recordingToFile).toBe(true)
  })

  it('disposed flag is false before dispose, true after', () => {
    const recorder = new ReplayRecorder(() => 'my-replay')
    expect(recorder.disposed).toBe(false)
    recorder.dispose()
    expect(recorder.disposed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 测试：全部处于预启动状态的缓冲区（未检测到 StartGame）
// ---------------------------------------------------------------------------

describe('ReplayRecorder all pre-start (no StartGame)', () => {
  it('includes pre-start packets in the final buffer even without StartGame', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')
    recorder.receive(1, createRegularPacket(0, 'SyncInfo'))
    recorder.receive(1, createRegularPacket(0, 'LobbyInfo'))
    recorder.dispose()

    const buffer = recorder.getBuffer()!
    // 应有 2 个数据包，且 recordingToFile 为 false
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('pre-start data is written before main data in serialized output', () => {
    const recorder = new ReplayRecorder(() => 'test-replay')

    // 预启动数据包
    const preData = new Uint8Array([0xDE, 0xAD])
    recorder.receive(100, preData)

    // StartGame
    recorder.receive(1, createStartGamePacket())

    // 启动后数据包
    const postData = new Uint8Array([0xBE, 0xEF])
    recorder.receive(200, postData)

    recorder.dispose()
    const buffer = recorder.getBuffer()!
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    // 验证预启动数据包排在第一位
    expect(view.getInt32(0, true)).toBe(100) // preStart clientId
    const preLen = view.getInt32(INT32_SIZE, true)
    expect(preLen).toBe(2) // 0xDE, 0xAD
    expect(buffer[INT32_SIZE * 2]).toBe(0xDE)
    expect(buffer[INT32_SIZE * 2 + 1]).toBe(0xAD)
  })
})
