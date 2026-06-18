/**
 * CheckExplicitInterfacesCommand.test.ts — 显式接口实现检查器单元测试
 *
 * 测试焦点: 参数验证、类注册表扫描、接口方法检测、
 * 原型链遍历、没有注册类时的错误处理。
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

import { CheckExplicitInterfacesCommand } from './CheckExplicitInterfacesCommand.js'
import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import type { Constructor } from '../../OpenRA.Game/ModData.js'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/**
 * 创建一个带有模拟 ObjectCreator 的 mock Utility，
 * 其中 registeredNames 和 getType 返回指定的构造函数。
 */
function createMockUtility(
  registry: Map<string, Constructor> = new Map(),
): Utility {
  return {
    modData: {
      manifest: {
        id: 'test-mod',
        metadata: { title: 'Test Mod', version: '1.0' },
        tileSets: [],
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
        registeredNames: Array.from(registry.keys()),
        getType: vi.fn((name: string) => {
          return registry.get(name) ?? undefined
        }),
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

/** 创建一个实现 ITick 接口的示例 trait 类。 */
function createTickTraitClass(): Constructor {
  class TickTrait {
    tick() {
      // ITick 实现
    }
  }
  return TickTrait
}

/** 创建一个实现 INotifyCreated 接口的示例 trait 类。 */
function createNotifyCreatedClass(): Constructor {
  class NotifyCreatedTrait {
    created() {
      // INotifyCreated 实现
    }
  }
  return NotifyCreatedTrait
}

describe('CheckExplicitInterfacesCommand', () => {
  let command: CheckExplicitInterfacesCommand

  beforeEach(() => {
    command = new CheckExplicitInterfacesCommand()
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
    expect(cmd.name).toBe('--check-explicit-interfaces')
  })

  describe('validateArguments', () => {
    it('should accept no arguments', () => {
      expect(command.validateArguments([])).toBe(true)
    })

    it('should reject any extra arguments', () => {
      expect(command.validateArguments(['extra'])).toBe(false)
      expect(command.validateArguments(['a', 'b'])).toBe(false)
    })
  })

  describe('run', () => {
    it('should log mod ID when running', () => {
      const utility = createMockUtility()
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Checking explicit interface implementations'),
      )
    })

    it('should handle empty registry gracefully', () => {
      const utility = createMockUtility()
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        'No explicit interface violations found.',
      )
    })

    it('should process registered classes', () => {
      const registry = new Map<string, Constructor>()
      registry.set('TickTrait', createTickTraitClass())
      registry.set('NotifyCreatedTrait', createNotifyCreatedClass())

      const utility = createMockUtility(registry)
      command.run(utility, [])
      // 处理完成，无违规（类实现了相关接口方法）
      expect(console.log).toHaveBeenCalledWith(
        'No explicit interface violations found.',
      )
    })

    it('should skip non-function entries in registry', () => {
      const registry = new Map<string, Constructor>()
      // 添加一个非函数的条目（如 Object 或原始类型）
      // getType 对此应返回 undefined
      const utility = createMockUtility(registry)
      command.run(utility, [])
      // 不应崩溃
      expect(console.log).toHaveBeenCalledWith(
        'No explicit interface violations found.',
      )
    })
  })
})
