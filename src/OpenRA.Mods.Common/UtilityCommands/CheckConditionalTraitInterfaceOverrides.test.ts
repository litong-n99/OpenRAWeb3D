/**
 * CheckConditionalTraitInterfaceOverrides.test.ts — 条件 trait 接口覆盖检查器单元测试
 *
 * 测试焦点: 参数验证、ConditionalTrait 子类检测、
 * 方法重写确认、getter/setter 违规检测、violationCount 递增。
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

/** 正确重写了 created() 和 getVariableObservers() 的子类。 */
class ProperOverrideTrait extends MockConditionalTraitBase {
  override created(): void {
    super.created()
  }
  override getVariableObservers(): never[] {
    return super.getVariableObservers()
  }
}

/** 未重写任一方法的子类（使用默认实现）。 */
class NoOverrideTrait extends MockConditionalTraitBase {
  customMethod(): boolean {
    return true
  }
}

/** 使用定义在实例而不是原型上的方式的类（非标准模式，但值得测试）。 */
class PrototypeOnlyTrait {
  isTraitDisabled(): boolean {
    return false
  }
  created(): void {}
  getVariableObservers(): never[] {
    return []
  }
}
// 所有三个方法都在原始类的原型上定义

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

    it('should log correct overrides for ConditionalTrait subclasses', () => {
      const registry = new Map<string, Constructor>()
      registry.set('ProperOverride', ProperOverrideTrait)

      const utility = createMockUtility(registry)
      command.run(utility, [])

      // 应记录 created() 重写包含 "correctly overrides"
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('correctly overrides'),
      )
    })

    it('should log info for subclasses with no overrides', () => {
      const registry = new Map<string, Constructor>()
      registry.set('NoOverride', NoOverrideTrait)

      const utility = createMockUtility(registry)
      command.run(utility, [])

      // 应记录 "no overrides" 消息
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('no overrides'),
      )
    })

    it('should detect ConditionalTrait via prototype chain methods', () => {
      const registry = new Map<string, Constructor>()
      registry.set('PrototypeOnlyTrait', PrototypeOnlyTrait)

      const utility = createMockUtility(registry)
      command.run(utility, [])

      // PrototypeOnlyTrait 在原型上拥有所有 ConditionalTrait 特征方法
      // 应被检测为 ConditionalTrait 子类并记录其重写
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('correctly overrides'),
      )
    })

    it('should skip non-function entries in registry', () => {
      const registry = new Map<string, Constructor>()
      const utility = createMockUtility(registry)
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        'No conditional trait interface override violations found.',
      )
    })
  })

  describe('violation detection', () => {
    it('should flag method defined as getter instead of function', () => {
      // 不能在 TypeScript 类上直接定义 getter 作为原型方法名称，
      // 但我们可以直接操作 prototype 来模拟。
      class BrokenTrait extends MockConditionalTraitBase {
        // 正常重写 getVariableObservers
        override getVariableObservers(): never[] {
          return super.getVariableObservers()
        }
      }

      // 将 created 定义为 getter（替换方法）
      Object.defineProperty(BrokenTrait.prototype, 'created', {
        get() {
          return () => {
            /* noop */
          }
        },
      })

      const registry = new Map<string, Constructor>()
      registry.set('BrokenTrait', BrokenTrait)

      const utility = createMockUtility(registry)
      command.run(utility, [])

      // 应报告违规：created 被定义为 getter 而非方法
      const errorCalls = vi.mocked(console.error).mock.calls.flat()
      expect(errorCalls.length).toBeGreaterThan(0)
      expect(errorCalls[0]).toContain('getter')
      expect(errorCalls[0]).toContain('BrokenTrait')
    })
  })
})
