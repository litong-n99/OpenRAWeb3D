/**
 * ReplayMetadata.test.ts — ReplayMetadata 迁移单元测试
 *
 * 这些测试是纯逻辑测试——不涉及 Babylon.js 或 WebGL。
 * 无需模拟 @babylonjs/core。
 *
 * 测试覆盖:
 * - writeToBuffer / readFromBuffer 往返
 * - 损坏数据返回 null
 * - 缓冲区截断返回 null
 * - 错误的 MetaStartMarker / MetaEndMarker 返回 null
 * - 未来的 MetaVersion 返回 null
 * - 数据为空时的处理
 * - Unicode 字符串编码
 */

import { describe, it, expect } from 'vitest'
import {
  ReplayMetadata,
  MetaStartMarker,
  MetaEndMarker,
  MetaVersion,
} from './ReplayMetadata'
import { GameInformation } from '../GameInformation'
import { WinState } from '../Player'

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 创建一个用于测试的带示例数据的 GameInformation。
 */
function createTestGameInfo(): GameInformation {
  const info = new GameInformation()
  info.mod = 'cnc'
  info.version = 'test-version'
  info.mapUid = 'test-map-uid'
  info.mapTitle = 'Test Map'
  info.finalGameTick = 12345
  info.startTimeUtc = new Date('2024-06-15T12:00:00.000Z')
  info.endTimeUtc = new Date('2024-06-15T12:30:00.000Z')

  const p1 = info.addPlayer('Alice')
  p1.playerId = 0
  p1.factionId = 'allies'
  p1.factionName = 'Allies'
  p1.isHuman = true
  p1.isBot = false
  p1.winState = WinState.Won

  const p2 = info.addPlayer('Bot1')
  p2.playerId = 1
  p2.factionId = 'soviet'
  p2.factionName = 'Soviet'
  p2.isHuman = false
  p2.isBot = true
  p2.winState = WinState.Lost

  return info
}

/**
 * 将 ReplayMetadata 转换为完整的 ArrayBuffer
 * （模拟回放文件数据 + 尾部元数据）。
 */
function metadataToBuffer(metadata: ReplayMetadata): ArrayBuffer {
  // 计算所需大小
  const jsonString = metadata.gameInfo.toJSONString()
  const encoder = new TextEncoder()
  const stringBytes = encoder.encode(jsonString)
  const dataLength = 4 + stringBytes.length
  const footerSize = 16 + dataLength // = 20 + stringBytes.length

  const buffer = new ArrayBuffer(footerSize)
  const uint8 = new Uint8Array(buffer)

  metadata.writeToBuffer(uint8, 0)
  return buffer
}

// ---------------------------------------------------------------------------
// 构造函数
// ---------------------------------------------------------------------------

describe('ReplayMetadata constructor', () => {
  it('stores gameInfo and initializes filePath', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)

    expect(metadata.gameInfo).toBe(info)
    expect(metadata.filePath).toBe('')
  })

  it('throws when gameInfo is null', () => {
    expect(() => new ReplayMetadata(null as unknown as GameInformation)).toThrow(
      'GameInfo must not be null',
    )
  })
})

// ---------------------------------------------------------------------------
// writeToBuffer
// ---------------------------------------------------------------------------

describe('ReplayMetadata.writeToBuffer', () => {
  it('writes correct binary format with markers', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)

    const buffer = new Uint8Array(4096)
    const bytesWritten = metadata.writeToBuffer(buffer, 0)

    expect(bytesWritten).toBeGreaterThan(20)

    const view = new DataView(buffer.buffer)

    // 验证 MetaStartMarker
    expect(view.getInt32(0, true)).toBe(MetaStartMarker)

    // 验证 MetaVersion
    expect(view.getInt32(4, true)).toBe(MetaVersion)

    // 验证 MetaEndMarker（在末尾附近）
    const dataSectionLength = view.getInt32(bytesWritten - 8, true)
    const endMarker = view.getInt32(bytesWritten - 4, true)
    expect(endMarker).toBe(MetaEndMarker)

    // dataLength 应与字节一致性
    expect(bytesWritten).toBe(20 + dataSectionLength - 4)
    // → bytesWritten = 16 + dataLength = 20 + stringByteLength
    // And dataSectionLength = 4 + stringByteLength
    // So dataSectionLength = bytesWritten - 16
  })

  it('writes at non-zero offset', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)

    const buffer = new Uint8Array(4096)
    const offset = 100
    const bytesWritten = metadata.writeToBuffer(buffer, offset)

    const view = new DataView(buffer.buffer)

    expect(view.getInt32(offset, true)).toBe(MetaStartMarker)
    expect(view.getInt32(offset + 4, true)).toBe(MetaVersion)
    expect(view.getInt32(offset + bytesWritten - 4, true)).toBe(
      MetaEndMarker,
    )
  })

  it('returns same byte count for same GameInfo', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)

    const buffer1 = new Uint8Array(4096)
    const buffer2 = new Uint8Array(4096)

    const written1 = metadata.writeToBuffer(buffer1, 0)
    const written2 = metadata.writeToBuffer(buffer2, 0)

    expect(written1).toBe(written2)
    expect(written1).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// readFromBuffer — 成功路径
// ---------------------------------------------------------------------------

describe('ReplayMetadata.readFromBuffer', () => {
  it('round-trip preserves all game info fields', () => {
    const originalInfo = createTestGameInfo()
    const original = new ReplayMetadata(originalInfo)

    const buffer = metadataToBuffer(original)
    const restored = ReplayMetadata.readFromBuffer(buffer)

    expect(restored).not.toBeNull()
    if (!restored) return

    const ri = restored.gameInfo
    expect(ri.mod).toBe('cnc')
    expect(ri.version).toBe('test-version')
    expect(ri.mapUid).toBe('test-map-uid')
    expect(ri.mapTitle).toBe('Test Map')
    expect(ri.finalGameTick).toBe(12345)
    expect(ri.startTimeUtc.toISOString()).toBe(
      '2024-06-15T12:00:00.000Z',
    )
    expect(ri.endTimeUtc?.toISOString()).toBe(
      '2024-06-15T12:30:00.000Z',
    )
    expect(ri.duration).toBe(1800)

    expect(ri.players).toHaveLength(2)
    expect(ri.players[0].playerName).toBe('Alice')
    expect(ri.players[0].winState).toBe(WinState.Won)
    expect(ri.players[1].playerName).toBe('Bot1')
    expect(ri.players[1].isBot).toBe(true)

    expect(ri.humanPlayers).toHaveLength(1)
    expect(ri.isSinglePlayer).toBe(true)
  })

  it('handles metadata at end of larger buffer (simulating replay data before footer)', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)

    // 创建包含一些“模拟回放数据”后跟尾部元数据的缓冲区
    const jsonString = info.toJSONString()
    const encoder = new TextEncoder()
    const stringBytes = encoder.encode(jsonString)
    const dataLength = 4 + stringBytes.length
    const footerSize = 16 + dataLength
    const prefixSize = 500 // 在元数据之前的模拟回放数据

    const totalBuffer = new ArrayBuffer(prefixSize + footerSize)
    const uint8 = new Uint8Array(totalBuffer)

    // 用非零值填充前缀（模拟回放数据）
    for (let i = 0; i < prefixSize; i++) {
      uint8[i] = (i % 256)
    }

    // 在前缀之后写入元数据
    metadata.writeToBuffer(uint8, prefixSize)

    const restored = ReplayMetadata.readFromBuffer(totalBuffer)
    expect(restored).not.toBeNull()
    if (!restored) return

    expect(restored.gameInfo.mod).toBe('cnc')
    expect(restored.gameInfo.players).toHaveLength(2)
  })

  it('handles empty players list', () => {
    const info = new GameInformation()
    info.mod = 'empty-test'
    info.startTimeUtc = new Date('2024-01-01T00:00:00.000Z')
    info.endTimeUtc = null

    const metadata = new ReplayMetadata(info)
    const buffer = metadataToBuffer(metadata)

    const restored = ReplayMetadata.readFromBuffer(buffer)
    expect(restored).not.toBeNull()
    if (!restored) return

    expect(restored.gameInfo.mod).toBe('empty-test')
    expect(restored.gameInfo.players).toHaveLength(0)
    expect(restored.gameInfo.endTimeUtc).toBeNull()
    expect(restored.gameInfo.duration).toBe(0)
  })

  it('preserves disabledSpawnPoints in round-trip', () => {
    const info = new GameInformation()
    info.mod = 'spawn-test'
    info.startTimeUtc = new Date('2024-01-01T00:00:00.000Z')
    info.endTimeUtc = null
    info.disabledSpawnPoints.add(2)
    info.disabledSpawnPoints.add(7)
    info.disabledSpawnPoints.add(9)

    const metadata = new ReplayMetadata(info)
    const buffer = metadataToBuffer(metadata)

    const restored = ReplayMetadata.readFromBuffer(buffer)
    expect(restored).not.toBeNull()
    if (!restored) return

    expect(restored.gameInfo.disabledSpawnPoints.has(2)).toBe(true)
    expect(restored.gameInfo.disabledSpawnPoints.has(7)).toBe(true)
    expect(restored.gameInfo.disabledSpawnPoints.has(9)).toBe(true)
    expect(restored.gameInfo.disabledSpawnPoints.size).toBe(3)
  })

  it('handles Unicode characters in player names', () => {
    const info = new GameInformation()
    info.mod = 'unicode-test'
    info.startTimeUtc = new Date('2024-01-01T00:00:00.000Z')
    info.endTimeUtc = null

    const p = info.addPlayer('プレイヤー1') // Japanese characters
    p.isHuman = true

    const metadata = new ReplayMetadata(info)
    const buffer = metadataToBuffer(metadata)

    const restored = ReplayMetadata.readFromBuffer(buffer)
    expect(restored).not.toBeNull()
    if (!restored) return

    expect(restored.gameInfo.players[0].playerName).toBe('プレイヤー1')
  })
})

// ---------------------------------------------------------------------------
// readFromBuffer — 错误 / 边缘情况
// ---------------------------------------------------------------------------

describe('ReplayMetadata.readFromBuffer error handling', () => {
  it('returns null for empty buffer', () => {
    expect(ReplayMetadata.readFromBuffer(new ArrayBuffer(0))).toBeNull()
  })

  it('returns null for buffer smaller than 20 bytes', () => {
    const buffer = new ArrayBuffer(10)
    expect(ReplayMetadata.readFromBuffer(buffer)).toBeNull()
  })

  it('returns null when MetaEndMarker is wrong', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)
    const buffer = metadataToBuffer(metadata)

    // 修改 MetaEndMarker
    const view = new DataView(buffer)
    view.setInt32(buffer.byteLength - 4, 9999, true)

    expect(ReplayMetadata.readFromBuffer(buffer)).toBeNull()
  })

  it('returns null when MetaStartMarker is wrong', () => {
    // 构建一个正确的缓冲区，然后破坏 StartMarker
    const info = createTestGameInfo()

    const jsonString = info.toJSONString()
    const encoder = new TextEncoder()
    const stringBytes = encoder.encode(jsonString)
    const dataLength = 4 + stringBytes.length
    const footerSize = 16 + dataLength

    const buffer = new ArrayBuffer(footerSize)
    const uint8 = new Uint8Array(buffer)

    // 有效地写入元数据，但使用错误的 StartMarker
    const view = new DataView(buffer)
    // 写入错误的 MetaStartMarker
    view.setInt32(0, 0, true) // 不是 -1
    // 写入版本
    view.setInt32(4, MetaVersion, true)
    // 写入字符串长度 + 数据
    view.setInt32(8, stringBytes.length, true)
    uint8.set(stringBytes, 12)
    // 写入 dataLength + MetaEndMarker
    view.setInt32(12 + stringBytes.length, dataLength, true)
    view.setInt32(12 + stringBytes.length + 4, MetaEndMarker, true)

    expect(ReplayMetadata.readFromBuffer(buffer)).toBeNull()
  })

  it('returns null for future MetaVersion', () => {
    const info = createTestGameInfo()

    const jsonString = info.toJSONString()
    const encoder = new TextEncoder()
    const stringBytes = encoder.encode(jsonString)
    const dataLength = 4 + stringBytes.length
    const footerSize = 16 + dataLength

    const buffer = new ArrayBuffer(footerSize)
    const uint8 = new Uint8Array(buffer)
    const view = new DataView(buffer)

    view.setInt32(0, MetaStartMarker, true)
    view.setInt32(4, MetaVersion + 10, true) // 未来的版本
    view.setInt32(8, stringBytes.length, true)
    uint8.set(stringBytes, 12)
    view.setInt32(12 + stringBytes.length, dataLength, true)
    view.setInt32(12 + stringBytes.length + 4, MetaEndMarker, true)

    expect(ReplayMetadata.readFromBuffer(buffer)).toBeNull()
  })

  it('accepts version equal to MetaVersion', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)
    const buffer = metadataToBuffer(metadata)

    const restored = ReplayMetadata.readFromBuffer(buffer)
    expect(restored).not.toBeNull()
  })

  it('accepts version less than MetaVersion (older format)', () => {
    const info = createTestGameInfo()

    const jsonString = info.toJSONString()
    const encoder = new TextEncoder()
    const stringBytes = encoder.encode(jsonString)
    const dataLength = 4 + stringBytes.length
    const footerSize = 16 + dataLength

    const buffer = new ArrayBuffer(footerSize)
    const uint8 = new Uint8Array(buffer)
    const view = new DataView(buffer)

    view.setInt32(0, MetaStartMarker, true)
    view.setInt32(4, 0, true) // 较旧的版本（尽管实际中不会出现）
    view.setInt32(8, stringBytes.length, true)
    uint8.set(stringBytes, 12)
    view.setInt32(12 + stringBytes.length, dataLength, true)
    view.setInt32(12 + stringBytes.length + 4, MetaEndMarker, true)

    const restored = ReplayMetadata.readFromBuffer(buffer)
    expect(restored).not.toBeNull()
    if (!restored) return
    expect(restored.gameInfo.mod).toBe('cnc')
  })

  it('returns null for truncated buffer (missing MetaEndMarker)', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)

    const fullBuffer = metadataToBuffer(metadata)
    // 创建缺少最后 4 个字节（MetaEndMarker）的截断缓冲区
    const truncated = new ArrayBuffer(fullBuffer.byteLength - 4)
    const truncatedView = new Uint8Array(truncated)
    const fullView = new Uint8Array(fullBuffer)
    truncatedView.set(fullView.subarray(0, truncated.byteLength))

    expect(ReplayMetadata.readFromBuffer(truncated)).toBeNull()
  })

  it('returns null for corrupted dataLength (negative)', () => {
    const buffer = new ArrayBuffer(32)
    const view = new DataView(buffer)

    // 在“尾部”位置写入一个较负的 dataLength
    view.setInt32(buffer.byteLength - 8, -100, true)
    view.setInt32(buffer.byteLength - 4, MetaEndMarker, true)

    expect(ReplayMetadata.readFromBuffer(buffer)).toBeNull()
  })

  it('returns null for dataLength exceeding buffer size', () => {
    const buffer = new ArrayBuffer(32)
    const view = new DataView(buffer)

    // dataLength 太大：16 + dataLength > 32
    view.setInt32(buffer.byteLength - 8, 1000, true)
    view.setInt32(buffer.byteLength - 4, MetaEndMarker, true)

    expect(ReplayMetadata.readFromBuffer(buffer)).toBeNull()
  })

  it('returns null when JSON parsing fails', () => {
    const buffer = new ArrayBuffer(64)
    const uint8 = new Uint8Array(buffer)
    const view = new DataView(buffer)

    const encoder = new TextEncoder()
    const invalidJson = encoder.encode('this is not valid json!!!')

    const dataLength = 4 + invalidJson.length
    // 检查是否在范围内
    if (16 + dataLength > 64) {
      // 测试数据太大，跳过此测试
      return
    }

    view.setInt32(0, MetaStartMarker, true)
    view.setInt32(4, MetaVersion, true)
    view.setInt32(8, invalidJson.length, true)
    uint8.set(invalidJson, 12)
    view.setInt32(12 + invalidJson.length, dataLength, true)
    view.setInt32(12 + invalidJson.length + 4, MetaEndMarker, true)

    expect(ReplayMetadata.readFromBuffer(buffer)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// renameFile
// ---------------------------------------------------------------------------

describe('ReplayMetadata.renameFile', () => {
  it('sets filePath with .orarep extension', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)

    metadata.renameFile('my-replay')
    expect(metadata.filePath).toBe('my-replay.orarep')
  })

  it('preserves directory prefix when filePath is already set', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)
    metadata.filePath = '/replays/cnc/release/my-old-name.orarep'

    metadata.renameFile('my-new-name')
    expect(metadata.filePath).toBe(
      '/replays/cnc/release/my-new-name.orarep',
    )
  })

  it('preserves directory prefix with trailing slash', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)
    metadata.filePath = '/replays/cnc/release/old.orarep'

    metadata.renameFile('new-name')
    expect(metadata.filePath).toBe('/replays/cnc/release/new-name.orarep')
  })

  it('works with relative paths', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)
    metadata.filePath = 'cnc/release/old.orarep'

    metadata.renameFile('new-file')
    expect(metadata.filePath).toBe('cnc/release/new-file.orarep')
  })

  it('handles rename with no prior filePath', () => {
    const info = createTestGameInfo()
    const metadata = new ReplayMetadata(info)
    expect(metadata.filePath).toBe('')

    metadata.renameFile('first-name')
    expect(metadata.filePath).toBe('first-name.orarep')
  })
})

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

describe('ReplayMetadata constants', () => {
  it('MetaStartMarker is -1', () => {
    expect(MetaStartMarker).toBe(-1)
  })

  it('MetaEndMarker is -2', () => {
    expect(MetaEndMarker).toBe(-2)
  })

  it('MetaVersion is 0x00000001', () => {
    expect(MetaVersion).toBe(0x00000001)
    expect(MetaVersion).toBe(1)
  })
})
