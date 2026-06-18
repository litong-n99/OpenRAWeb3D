/**
 * ReplayMetadataCommand.test.ts — 回放元数据命令单元测试
 *
 * 测试焦点: 参数验证、回放文件读取、元数据 JSON 输出格式、
 * 错误处理（无效文件、缺失文件、损坏的元数据）。
 *
 * 由于 @babylonjs/core 不在此命令中使用，无需 mock。
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest'

import { ReplayMetadataCommand } from './ReplayMetadataCommand.js'
import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import {
  ReplayMetadata,
  MetaStartMarker,
  MetaEndMarker,
  MetaVersion,
} from '../../OpenRA.Game/FileFormats/ReplayMetadata.js'
import { GameInformation } from '../../OpenRA.Game/GameInformation.js'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/**
 * 为回放文件创建一个二进制缓冲区，末尾附加 ReplayMetadata 尾部。
 */
function createReplayBufferWithMetadata(
  gameInfo: GameInformation,
): ArrayBuffer {
  const replayData = new Uint8Array(100) // 模拟回放帧数据
  const metadata = new ReplayMetadata(gameInfo)

  // 计算元数据尾部大小
  const jsonStr = gameInfo.toJSONString()
  const encoder = new TextEncoder()
  const stringBytes = encoder.encode(jsonStr)
  const tailSize = 20 + stringBytes.length // 4 + 4 + 4 + N + 4 + 4

  const fullBuffer = new Uint8Array(replayData.length + tailSize)
  fullBuffer.set(replayData)
  metadata.writeToBuffer(fullBuffer, replayData.length)

  return fullBuffer.buffer as ArrayBuffer
}

/**
 * 创建一个最小的 mock Utility，包含文件系统中的示例回放文件数据。
 */
function createMockUtility(
  replayData: ArrayBuffer | null = null,
  replayPath = 'test.orarep',
): Utility {
  const fs = {
    exists: vi.fn((filename: string) => {
      return filename === replayPath && replayData !== null
    }),
    openAsync: vi.fn().mockResolvedValue(replayData),
    isMounted: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
    // 用于模拟回放文件读取的同步读取（二进制）
    tryReadFileAsBuffer: vi.fn((filePath: string) => {
      if (filePath === replayPath && replayData) {
        return replayData
      }
      return null
    }),
    tryReadFileAsString: vi.fn((filePath: string) => {
      if (filePath === replayPath && replayData) {
        const decoder = new TextDecoder()
        return decoder.decode(replayData)
      }
      return null
    }),
  }

  return {
    modData: {
      manifest: {
        id: 'test-mod',
        metadata: { title: 'Test Mod', version: '1.0' },
        tileSets: [],
        mounts: [],
        mapFolders: new Map<string, string>(),
      },
      modFiles: fs,
      objectCreator: {
        registeredNames: [],
        getType: vi.fn().mockReturnValue(undefined),
        createObject: vi.fn().mockReturnValue(null),
        register: vi.fn(),
        dispose: vi.fn(),
      },
      mapCache: {
        enumerateMapDirPackagesAndNames: vi.fn().mockReturnValue([]),
        dispose: vi.fn(),
      },
      dispose: vi.fn(),
    },
    mods: new Map(),
  } as unknown as Utility
}

/** 创建示例 GameInformation。 */
function createSampleGameInfo(): GameInformation {
  const info = new GameInformation()
  info.mod = 'cnc'
  info.version = 'release-20230225'
  info.mapUid = 'abc-123-def'
  info.mapTitle = 'Test Skirmish'
  info.finalGameTick = 15000
  info.startTimeUtc = new Date('2025-01-01T00:00:00Z')
  info.endTimeUtc = new Date('2025-01-01T01:30:00Z')
  info.addPlayer('Alice')
  info.addPlayer('Bob')
  return info
}

describe('ReplayMetadataCommand', () => {
  let command: ReplayMetadataCommand

  beforeEach(() => {
    command = new ReplayMetadataCommand()
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // IUtilityCommand 合约
  // ---------------------------------------------------------------------------

  it('should implement IUtilityCommand with correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--replay-metadata')
  })

  describe('validateArguments', () => {
    it('should accept at least one argument (replay file path)', () => {
      expect(command.validateArguments(['file.orarep'])).toBe(true)
      expect(command.validateArguments(['file.orarep', 'extra'])).toBe(true)
    })

    it('should reject no arguments', () => {
      expect(command.validateArguments([])).toBe(false)
    })
  })

  describe('run with valid replay', () => {
    it('should output JSON metadata for valid replay file', () => {
      const gameInfo = createSampleGameInfo()
      const buffer = createReplayBufferWithMetadata(gameInfo)

      const utility = createMockUtility(buffer, 'replay.orarep')

      command.run(utility, ['replay.orarep'])

      // 验证 JSON 输出包含游戏信息
      const logCalls = vi.mocked(console.log).mock.calls
      // 至少有一个调用包含 JSON（来自 JSON.stringify 的输出）
      const jsonOutput = logCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('"game"'),
      )
      expect(jsonOutput).toBeDefined()
    })

    it('should include player information in output', () => {
      const gameInfo = createSampleGameInfo()
      const buffer = createReplayBufferWithMetadata(gameInfo)

      const utility = createMockUtility(buffer, 'replay.orarep')

      command.run(utility, ['replay.orarep'])

      const logCalls = vi.mocked(console.log).mock.calls
      const jsonOutput = logCalls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('"players"'),
      )
      expect(jsonOutput).toBeDefined()
      const parsed = JSON.parse(jsonOutput![0] as string)
      expect(parsed.players).toHaveLength(2)
      expect(parsed.players[0].playerName).toBe('Alice')
    })
  })

  describe('error handling', () => {
    it('should report error when file cannot be read', () => {
      const utility = createMockUtility(null, 'missing.orarep')
      command.run(utility, ['missing.orarep'])
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read replay file'),
      )
    })

    it('should report error when metadata parsing fails', () => {
      // 创建没有元数据的回放文件（仅随机数据，无有效尾部）
      const badData = new Uint8Array(200).buffer as ArrayBuffer

      const utility = createMockUtility(badData, 'bad.orarep')

      command.run(utility, ['bad.orarep'])
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read replay metadata'),
      )
    })
  })

  describe('ReplayMetadata binary format', () => {
    it('should produce readable metadata via readFromBuffer', () => {
      const gameInfo = createSampleGameInfo()
      const buffer = createReplayBufferWithMetadata(gameInfo)

      const result = ReplayMetadata.readFromBuffer(buffer)
      expect(result).not.toBeNull()
      expect(result!.gameInfo.mod).toBe('cnc')
      expect(result!.gameInfo.mapTitle).toBe('Test Skirmish')
      expect(result!.gameInfo.players).toHaveLength(2)
    })

    it('should return null for data too short', () => {
      const shortData = new Uint8Array(10).buffer as ArrayBuffer
      const result = ReplayMetadata.readFromBuffer(shortData)
      expect(result).toBeNull()
    })

    it('should return null for data without valid markers', () => {
      const randomData = new Uint8Array(200)
      const result = ReplayMetadata.readFromBuffer(
        randomData.buffer as ArrayBuffer,
      )
      expect(result).toBeNull()
    })

    it('should verify MetaStartMarker and MetaEndMarker constants', () => {
      expect(MetaStartMarker).toBe(-1)
      expect(MetaEndMarker).toBe(-2)
      expect(MetaVersion).toBe(0x00000001)
    })
  })
})
