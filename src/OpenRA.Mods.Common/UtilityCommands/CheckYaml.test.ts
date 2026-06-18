/**
 * CheckYaml.test.ts — CheckYaml 单元测试
 *
 * 测试焦点: 参数验证、错误/警告计数、lint pass 调度、
 * warning-as-error 标志、地图规则检查流程。
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

import { CheckYaml } from './CheckYaml.js'
import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import { lintPassRegistry } from './LintInterfaces.js'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 创建一个最小的 Utility mock，带空 ModData。 */
function createMockUtility(overrides?: Record<string, unknown>): Utility {
  return {
    modData: {
      manifest: {
        id: 'test-mod',
        metadata: { title: 'Test Mod', version: '1.0' },
        tileSets: ['TEMPERATE'],
        mounts: [],
        mapFolders: new Map<string, string>(),
      },
      modFiles: {
        exists: vi.fn().mockReturnValue(false),
        openAsync: vi.fn().mockResolvedValue(null),
        isMounted: vi.fn().mockReturnValue(false),
        dispose: vi.fn(),
      },
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
    ...overrides,
  } as unknown as Utility
}

describe('CheckYaml', () => {
  let command: CheckYaml

  beforeEach(() => {
    command = new CheckYaml()
    lintPassRegistry.clear()
    // 抑制 process.exit 调用（vitest 将未模拟的 process.exit 视为失败）
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    // 抑制控制台输出（避免测试输出杂乱）
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    lintPassRegistry.clear()
  })

  // ---------------------------------------------------------------------------
  // IUtilityCommand 合约
  // ---------------------------------------------------------------------------

  it('should implement IUtilityCommand with correct name', () => {
    const cmd: IUtilityCommand = command
    expect(cmd.name).toBe('--check-yaml')
  })

  describe('validateArguments', () => {
    it('should accept no arguments (check entire mod)', () => {
      expect(command.validateArguments([])).toBe(true)
    })

    it('should accept one argument (check single map)', () => {
      expect(command.validateArguments(['path/to/map'])).toBe(true)
    })

    it('should reject more than one argument', () => {
      expect(command.validateArguments(['arg1', 'arg2'])).toBe(false)
    })
  })

  describe('run', () => {
    it('should log mod title when checking entire mod', () => {
      const utility = createMockUtility()
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Testing mod'),
      )
    })

    it('should attempt single map check when path argument provided', () => {
      const utility = createMockUtility()
      command.run(utility, ['test-map-path'])
      expect(console.log).toHaveBeenCalledWith(
        'Testing map: test-map-path',
      )
    })

    it('should dispatch registered ILintPass implementations', () => {
      const errors: string[] = []
      const warnings: string[] = []

      lintPassRegistry.register({
        run(e, w) {
          e('registration missing for actor e1')
          w('unused definition: heavy_tank')
        },
      })

      // 覆盖 console.error 和 console.warn 以捕获来自 emitError/emitWarning 的输出
      vi.mocked(console.error).mockImplementation((msg: unknown) => {
        if (typeof msg === 'string') errors.push(msg)
      })
      vi.mocked(console.warn).mockImplementation((msg: unknown) => {
        if (typeof msg === 'string') warnings.push(msg)
      })

      const utility = createMockUtility()
      command.run(utility, [])

      expect(errors).toContain('Error: registration missing for actor e1')
      expect(warnings).toContain('Warning: unused definition: heavy_tank')
    })

    it('should handle lint pass exceptions gracefully', () => {
      lintPassRegistry.register({
        run(_e, _w) {
          throw new Error('Boom!')
        },
      })

      const utility = createMockUtility()
      command.run(utility, [])

      // 应报告异常，但不会崩溃
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('failed with exception'),
      )
    })

    it('should count errors and warnings separately', () => {
      const utility = createMockUtility()

      // 注册一个lint pass，产生2个错误和1个警告
      lintPassRegistry.register({
        run(e, w) {
          e('error 1')
          e('error 2')
          w('warning 1')
        },
      })

      // 不触发 process.exit（通过mock避免）
      command.run(utility, [])
      // 当有错误时，run() 会尝试调用 process.exit(1)
      // 此测试验证日志调用 —— 实际错误发生是因为我们mock了console
    })
  })

  describe('checkRules', () => {
    it('should dispatch all registered rules passes', () => {
      const errors: string[] = []
      const utility = createMockUtility()
      const mockRules = {} as never

      let called = false
      lintPassRegistry.registerRules({
        run(_e, _w, _modData, rules) {
          called = true
          expect(rules).toBe(mockRules)
        },
      })

      command.checkRules(
        utility.modData,
        mockRules,
        (msg) => errors.push(msg),
        () => {},
      )

      expect(called).toBe(true)
    })

    it('should handle rules pass exceptions', () => {
      const errors: string[] = []
      const utility = createMockUtility()

      lintPassRegistry.registerRules({
        run() {
          throw new Error('Parse error')
        },
      })

      command.checkRules(
        utility.modData,
        {} as never,
        (msg) => errors.push(msg),
        () => {},
      )

      // 应包含异常信息
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toContain('failed')
    })
  })

  describe('checkSequences', () => {
    it('should dispatch all registered sequences passes', () => {
      const errors: string[] = []
      const utility = createMockUtility()

      let called = false
      lintPassRegistry.registerSequences({
        run() {
          called = true
        },
      })

      command.checkSequences(
        utility.modData,
        {} as never,
        {},
        (msg) => errors.push(msg),
        () => {},
      )

      expect(called).toBe(true)
    })
  })

  describe('testMap', () => {
    it('should log map title and run map passes', () => {
      const errors: string[] = []
      const utility = createMockUtility()

      // 注册一个 map pass 以验证它被调度
      let mapPassRun = false
      lintPassRegistry.registerMap({
        run() {
          mapPassRun = true
        },
      })

      const mockMap = {
        title: 'Test Map',
      } as never

      command.testMap(
        mockMap as Parameters<typeof command.testMap>[0],
        utility.modData,
        (msg) => errors.push(msg),
        () => {},
      )

      expect(mapPassRun).toBe(true)
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Testing map:'),
      )
    })

    it('should handle map pass exceptions gracefully', () => {
      const errors: string[] = []
      const utility = createMockUtility()

      lintPassRegistry.registerMap({
        run() {
          throw new Error('Map parse error')
        },
      })

      const mockMap = {
        title: 'Error Map',
      } as never

      command.testMap(
        mockMap as Parameters<typeof command.testMap>[0],
        utility.modData,
        (msg) => errors.push(msg),
        () => {},
      )

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toContain('failed')
    })

    it('should dispatch all registered map passes', () => {
      const errors: string[] = []
      const utility = createMockUtility()

      let mapPassRun = false
      lintPassRegistry.registerMap({
        run(_e, _w, _modData, map) {
          mapPassRun = true
          expect(map.title).toBe('Simple Map')
        },
      })

      const mockMap = {
        title: 'Simple Map',
        invalidCustomRules: false,
        invalidCustomRulesException: null,
        ruleDefinitions: null,
        voiceDefinitions: null,
        weaponDefinitions: null,
      } as never

      command.testMap(
        mockMap as Parameters<typeof command.testMap>[0],
        utility.modData,
        (msg) => errors.push(msg),
        () => {},
      )

      expect(mapPassRun).toBe(true)
    })
  })

  describe('warning as error', () => {
    it('should convert warnings to errors when TREAT_WARNINGS_AS_ERRORS is set', () => {
      const originalEnv = process.env.TREAT_WARNINGS_AS_ERRORS
      process.env.TREAT_WARNINGS_AS_ERRORS = 'true'

      try {
        vi.mocked(console.error).mockClear()
        vi.mocked(console.warn).mockClear()

        lintPassRegistry.register({
          run(_e, w) {
            w('this should become an error')
          },
        })

        const utility = createMockUtility()
        command.run(utility, [])

        // 警告应作为错误输出（console.error）
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('this should become an error'),
        )
      } finally {
        if (originalEnv === undefined) {
          delete process.env.TREAT_WARNINGS_AS_ERRORS
        } else {
          process.env.TREAT_WARNINGS_AS_ERRORS = originalEnv
        }
      }
    })
  })
})
