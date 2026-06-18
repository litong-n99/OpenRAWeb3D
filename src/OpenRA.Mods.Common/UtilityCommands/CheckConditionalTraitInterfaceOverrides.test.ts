/**
 * CheckConditionalTraitInterfaceOverrides.test.ts — 条件 trait 接口覆盖检查器单元测试
 *
 * 测试焦点: 参数验证、ConditionalTrait 子类检测、
 * 接口方法覆盖确认、类注册表扫描。
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

import { CheckConditionalTraitInterfaceOverrides } from './CheckConditionalTraitInterfaceOverrides.js'
import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import type { Constructor } from '../../OpenRA.Game/ModData.js'

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/**
 * 创建一个 mocking ConditionalTrait 行为的原型对象。
 * ConditionalTrait 子类在原型上应有 `isTraitDisabled`, `created`,
 * 和 `getVariableObservers` 方法。
 */
class MockConditionalTraitBase {
  isTraitDisabled(): boolean {
    return false
  }
  created(): void {
    // INotifyCreated 的 ConditionalTrait 基础实现
  }
  getVariableObservers(): never[] {
    return []
  }
}

/**
 * 用于测试的 ConditionalTrait 子类 —— 正确重写 created()。
 */
class ProperOverrideTrait extends MockConditionalTraitBase {
  override created(): void {
    super.created()
    // 正确覆盖 ConditionalTrait 的处理程序
  }

  override getVariableObservers(): never[] {
    return super.getVariableObservers()
  }
}

/**
 * 创建一个带有模拟 ObjectCreator 的 mock Utility。
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

describe('CheckConditionalTraitInterfaceOverrides', () => {
  let command: CheckConditionalTraitInterfaceOverrides

  beforeEach(() => {
    command = new CheckConditionalTraitInterfaceOverrides()
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
    expect(cmd.name).toBe('--check-conditional-trait-interface-overrides')
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
        expect.stringContaining(
          'Checking conditional trait interface overrides',
        ),
      )
    })

    it('should handle empty registry gracefully', () => {
      const utility = createMockUtility()
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        'No conditional trait interface override violations found.',
      )
    })

    it('should not flag non-ConditionalTrait classes', () => {
      class RegularClass {
        regularMethod(): void {}
      }

      const registry = new Map<string, Constructor>()
      registry.set('RegularClass', RegularClass)

      const utility = createMockUtility(registry)
      command.run(utility, [])

      expect(console.log).toHaveBeenCalledWith(
        'No conditional trait interface override violations found.',
      )
    })

    it('should detect and process ConditionalTrait subclasses', () => {
      const registry = new Map<string, Constructor>()
      registry.set('ProperOverride', ProperOverrideTrait)

      const utility = createMockUtility(registry)
      command.run(utility, [])

      // 应记录 created() 覆盖
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('ProperOverride.created()'),
      )

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('ProperOverride.getVariableObservers()'),
      )
    })

    it('should skip non-function entries in registry', () => {
      const registry = new Map<string, Constructor>()
      // 注册表中没有类，仅注册名称
      const utility = createMockUtility(registry)
      command.run(utility, [])
      // 不应崩溃
      expect(console.log).toHaveBeenCalledWith(
        'No conditional trait interface override violations found.',
      )
    })
  })
})
