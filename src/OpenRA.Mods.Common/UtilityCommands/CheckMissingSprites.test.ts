/**
 * CheckMissingSprites.test.ts — CheckMissingSprites 单元测试
 *
 * 测试焦点: 参数验证、序列文件发现、精灵引用提取、
 * 缺失精灵检测、exists() 文件查找、addFileContent API。
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

import { CheckMissingSprites } from './CheckMissingSprites.js'
import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/**
 * 创建一个带有 mock 文件系统的最小 Utility。
 * availableFiles 是存在于文件系统中的文件（小写）的集合。
 * 使用标准 IReadOnlyFileSystem API（exists, openAsync, isMounted）。
 */
function createMockUtility(
  availableFiles: Set<string> = new Set(),
): Utility {
  const fs = {
    exists: vi.fn((filename: string) => {
      return availableFiles.has(filename.toLowerCase())
    }),
    openAsync: vi.fn().mockResolvedValue(null),
    isMounted: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
  }

  return {
    modData: {
      manifest: {
        id: 'test-mod',
        metadata: { title: 'Test Mod', version: '1.0' },
        tileSets: ['TEMPERATE', 'DESERT'],
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

/** 创建一个带有一些精灵引用的示例序列 JSON 内容。 */
function makeSequenceJson(references: string[]): string {
  const seq: Record<string, unknown> = {}
  for (let i = 0; i < references.length; i++) {
    seq[`seq${i}`] = {
      Filename: references[i],
      Length: 8,
      Ticks: 80,
    }
  }
  return JSON.stringify(seq)
}

describe('CheckMissingSprites', () => {
  let command: CheckMissingSprites

  beforeEach(() => {
    command = new CheckMissingSprites()
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // IUtilityCommand 合约
  // ---------------------------------------------------------------------------

  it('should implement IUtilityCommand with correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--check-missing-sprites')
  })

  describe('validateArguments', () => {
    it('should accept any arguments', () => {
      expect(command.validateArguments([])).toBe(true)
      expect(command.validateArguments(['extra'])).toBe(true)
    })
  })

  describe('run', () => {
    it('should check each known tileset', () => {
      const utility = createMockUtility()
      command.run(utility, [])
      // 应记录每个地形集
      expect(console.log).toHaveBeenCalledWith('Tileset: TEMPERATE')
      expect(console.log).toHaveBeenCalledWith('Tileset: DESERT')
    })

    it('should detect missing sprites from sequence files', () => {
      // 文件系统中有序列文件，但引用的精灵缺失
      const availableFiles = new Set<string>(['sequences/infantry.yaml'])
      const utility = createMockUtility(availableFiles)

      // 通过标准 API 注入文件内容
      command.addFileContent(
        'sequences/infantry.yaml',
        makeSequenceJson(['e1', 'e2']),
      )

      command.run(utility, [])

      // 'e1' 和 'e2' 不在文件系统中 —— 应报告为缺失
      const logCalls = vi.mocked(console.log).mock.calls.flat()
      const notFoundMessages = logCalls.filter(
        (c) => typeof c === 'string' && c.includes('not found'),
      )
      expect(notFoundMessages.length).toBeGreaterThan(0)
    })

    it('should not report sprites that exist in file system', () => {
      const availableFiles = new Set<string>([
        'sequences/infantry.yaml',
        'sprites/e1.png', // 精灵文件存在
      ])
      const utility = createMockUtility(availableFiles)

      command.addFileContent(
        'sequences/infantry.yaml',
        makeSequenceJson(['e1', 'e2']),
      )

      command.run(utility, [])

      // e1 存在，e2 缺失 —— 应仅报告 e2
      const logCalls = vi.mocked(console.log).mock.calls.flat()
      const notFoundMessages = logCalls.filter(
        (c) => typeof c === 'string' && c.includes('not found'),
      )
      // 每个地形集 1 条（仅 e2 缺失）
      expect(notFoundMessages.length).toBe(2)
    })

    it('should handle missing tileset info gracefully', () => {
      const utility = createMockUtility(new Set<string>())
      const manifestObj =
        utility.modData.manifest as unknown as Record<string, unknown>
      manifestObj.tileSets = []
      command.run(utility, [])
      // 应回退到 'default' 地形集
      expect(console.log).toHaveBeenCalledWith('Tileset: default')
    })

    it('should handle JSON parse errors gracefully', () => {
      const availableFiles = new Set<string>(['sequences/infantry.yaml'])
      const utility = createMockUtility(availableFiles)

      // 注入损坏的 JSON，但通过 addFileContent
      command.addFileContent('sequences/infantry.yaml', 'not valid json {{{')

      command.run(utility, [])
      // 不应崩溃 —— JSON 错误被静默吞掉（CheckYaml 负责报告它们）
    })

    it('should try multiple file extensions when checking sprites', () => {
      const availableFiles = new Set<string>([
        'sequences/infantry.yaml',
        'bits/e1.shp', // .shp extension
      ])
      const utility = createMockUtility(availableFiles)

      command.addFileContent(
        'sequences/infantry.yaml',
        makeSequenceJson(['e1']),
      )

      command.run(utility, [])
      // e1 存在为 .shp —— 不应报告为缺失
      const logCalls = vi.mocked(console.log).mock.calls.flat()
      const notFoundMessages = logCalls.filter(
        (c) => typeof c === 'string' && c.includes('not found'),
      )
      expect(notFoundMessages).toHaveLength(0)
    })

    it('should not check files that do not exist in file system', () => {
      // 无序列文件在文件系统中
      const utility = createMockUtility(new Set<string>())

      // 即使通过 addFileContent 注入了内容，如果 exists() 返回 false，
      // 命令也不会处理该文件
      command.addFileContent(
        'sequences/missing.yaml',
        makeSequenceJson(['ghost']),
      )

      command.run(utility, [])
      // 不应报告缺失 —— 因为序列文件路径本身在文件系统中不存在
      const logCalls = vi.mocked(console.log).mock.calls.flat()
      const notFoundMessages = logCalls.filter(
        (c) => typeof c === 'string' && c.includes('not found'),
      )
      expect(notFoundMessages).toHaveLength(0)
    })
  })

  describe('addFileContent', () => {
    it('should accept file content via addFileContent API', () => {
      command.addFileContent('test.yaml', '{"key": "value"}')
      command.addFileContent('other.yaml', '{}')
      // 不应抛出异常 —— API 接受有效输入
    })
  })

  describe('sprite reference extraction', () => {
    it('should extract Filename references', () => {
      const refs = (command as unknown as {
        _extractSpriteReferences(obj: unknown): string[]
      })._extractSpriteReferences({
        Filename: 'my_sprite',
      })
      expect(refs).toContain('my_sprite')
    })

    it('should extract Image references', () => {
      const refs = (command as unknown as {
        _extractSpriteReferences(obj: unknown): string[]
      })._extractSpriteReferences({
        Image: 'terrain_tiles',
      })
      expect(refs).toContain('terrain_tiles')
    })

    it('should handle nested objects', () => {
      const refs = (command as unknown as {
        _extractSpriteReferences(obj: unknown): string[]
      })._extractSpriteReferences({
        sequences: {
          idle: { Filename: 'idle_seq' },
          run: { Filename: 'run_seq' },
        },
      })
      expect(refs).toHaveLength(2)
      expect(refs).toContain('idle_seq')
      expect(refs).toContain('run_seq')
    })

    it('should return empty array for null input', () => {
      const refs = (command as unknown as {
        _extractSpriteReferences(obj: unknown): string[]
      })._extractSpriteReferences(null)
      expect(refs).toEqual([])
    })

    it('should handle array input', () => {
      const refs = (command as unknown as {
        _extractSpriteReferences(obj: unknown): string[]
      })._extractSpriteReferences([
        { Filename: 'a' },
        { Filename: 'b' },
      ])
      expect(refs).toEqual(['a', 'b'])
    })
  })
})
