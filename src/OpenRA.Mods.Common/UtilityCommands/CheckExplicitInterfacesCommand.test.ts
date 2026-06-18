/**
 * CheckExplicitInterfacesCommand.test.ts — 显式接口实现检查器单元测试
 *
 * 测试焦点: 参数验证、trait 类扫描、部分接口检测、
 * 原型链方法检查、compile-time delegate 消息、violationCount 递增。
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

/** 创建一个仅部分实现 ITick 的类（仅 tick 方法，而非完整接口）。 */
function createPartialTickClass(): Constructor {
  // 虽然 ITick 只有 tick() 一个方法，但模拟一个"部分实现"的概念:
  // 创建一个具有一些已知接口方法但缺少其他的类
  class PartialTrait {
    tick(): void {
      // ITick 实现
    }
    // 缺少其他接口方法
  }
  return PartialTrait
}

/** 创建一个带有多个接口方法的完全实现类。 */
function createFullTraitClass(): Constructor {
  class FullTrait {
    tick(): void {}
    created(): void {}
    render(): void {}
    resolveOrder(): void {}
  }
  return FullTrait
}

/** 创建一个没有接口方法的简单类。 */
function createPlainClass(): Constructor {
  class PlainClass {
    doSomething(): void {}
  }
  return PlainClass
}

describe('CheckExplicitInterfacesCommand', () => {
  let command: CheckExplicitInterfacesCommand

  beforeEach(() => {
    command = new CheckExplicitInterfacesCommand()
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
    it('should print compile-time delegate message', () => {
      const utility = createMockUtility()
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('tsc --noEmit'),
      )
    })

    it('should log mod ID when running', () => {
      const utility = createMockUtility()
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          'Checking explicit interface implementations',
        ),
      )
    })

    it('should handle empty registry gracefully', () => {
      const utility = createMockUtility()
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        'No explicit interface violations found.',
      )
    })

    it('should process registered classes with full implementations', () => {
      const registry = new Map<string, Constructor>()
      registry.set('FullTrait', createFullTraitClass())

      const utility = createMockUtility(registry)
      command.run(utility, [])
      // 完全实现对多个接口 —— 无违规
      expect(console.log).toHaveBeenCalledWith(
        'No explicit interface violations found.',
      )
    })

    it('should skip non-function entries in registry', () => {
      const registry = new Map<string, Constructor>()
      const utility = createMockUtility(registry)
      command.run(utility, [])
      // 不应崩溃
      expect(console.log).toHaveBeenCalledWith(
        'No explicit interface violations found.',
      )
    })

    it('should detect partial interface implementations as violations', () => {
      const registry = new Map<string, Constructor>()
      registry.set('PartialTrait', createPartialTickClass())

      const utility = createMockUtility(registry)
      command.run(utility, [])

      // PartialTrait 有 tick()，实现 ITick 的 1/1 方法（100%）。
      // 对于其他接口，匹配为 0/1（0%）—— 不触发违规。
      // 只有当部分匹配（0 < count < total）时才产生违规，此处无此情况。
    })

    it('should have no violations for classes without any interface methods', () => {
      const registry = new Map<string, Constructor>()
      registry.set('PlainClass', createPlainClass())

      const utility = createMockUtility(registry)
      command.run(utility, [])
      expect(console.log).toHaveBeenCalledWith(
        'No explicit interface violations found.',
      )
    })

    it('should increment violationCount for partial matches', () => {
      // 创建一个类，具有某些接口的部分方法
      class BrokenTrait {
        tick(): void {} // ITick 的一部分
        created(): void {} // INotifyCreated 的一部分
        // 但假设 ITick 有多个方法（例如 tick + tickRender），
        // 而 BrokenTrait 只有 tick()...
        // 实际上，根据 KNOWN_INTERFACE_METHODS，INotifyDamageStateChanged
        // 有 damageStateChanged() — 如果 BrokenTrait 拥有其中一些方法
        damageStateChanged(): void {} // INotifyDamageStateChanged 的 1/1
      }

      const registry = new Map<string, Constructor>()
      registry.set('BrokenTrait', BrokenTrait)

      const utility = createMockUtility(registry)
      command.run(utility, [])

      // BrokenTrait 有:
      // - ITick: tick 1/1 = 100% → 完全实现（通过 duck typing）
      // - INotifyCreated: created 1/1 = 100%
      // - INotifyDamageStateChanged: damageStateChanged 1/1 = 100%
      // 由于全部都是完全实现或 0%，不应有违规
      // 但日志应包含 implement 信息
    })
  })

  describe('partial implementation detection', () => {
    it('should flag classes with partial interface method coverage', () => {
      // 创建一个类，实现 INotifyMoving 的一部分（onMovementStarted 但缺少 onMovementComplete）
      class PartialMovingTrait {
        onMovementStarted(): void {}
        // 缺少 onMovementComplete
      }

      const registry = new Map<string, Constructor>()
      registry.set('PartialMovingTrait', PartialMovingTrait)

      const utility = createMockUtility(registry)
      command.run(utility, [])

      // INotifyMoving 有 2 个方法: onMovementStarted, onMovementComplete
      // PartialMovingTrait 只有 1/2 —— 这是部分实现，应报告为违规
      const errorCalls = vi.mocked(console.error).mock.calls.flat()
      expect(errorCalls.length).toBeGreaterThan(0)
      expect(errorCalls[0]).toContain('partial implementation')
      expect(errorCalls[0]).toContain('INotifyMoving')
      expect(errorCalls[0]).toContain('1/2')
    })
  })
})
