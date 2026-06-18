/**
 * RegisterModCommand.test.ts — RegisterModCommand 单元测试
 *
 * 测试焦点:
 * - 命令名和描述属性
 * - validateArguments 参数验证
 * - run() 从 Utility 获取 IModRegistry 并委托注册调用
 * - 无 ModRegistry 时的回退（无操作）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RegisterModCommand } from './RegisterModCommand'
import { ModRegistration, type IModRegistry } from './ModRegistration'
import { Utility } from '../IUtilityCommand'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 创建一个带有 spy 注册表的 Utility 上下文。 */
function createUtilityWithRegistry(): { utility: Utility; registry: IModRegistry; registerSpy: ReturnType<typeof vi.fn> } {
  const registerSpy = vi.fn()
  const registry: IModRegistry = {
    register: registerSpy,
    unregister: vi.fn(),
    clearInvalidRegistrations: vi.fn(),
  }
  const modData = {
    manifest: { id: 'test-mod', metadata: { version: '1.0', hidden: false } },
  } as never
  const utility = Object.assign(new Utility(modData, new Map()), { modRegistry: registry })
  return { utility, registry, registerSpy }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RegisterModCommand', () => {
  let command: RegisterModCommand

  beforeEach(() => {
    command = new RegisterModCommand()
  })

  // -----------------------------------------------------------------------
  // IUtilityCommand contract
  // -----------------------------------------------------------------------

  describe('name and description', () => {
    it('should have correct command name', () => {
      expect(command.name).toBe('--register-mod')
    })

    it('should have a non-empty description', () => {
      expect(command.description).toBeTruthy()
      expect(command.description).toContain('LAUNCHPATH')
    })
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('should reject empty args', () => {
      expect(command.validateArguments([])).toBe(false)
    })

    it('should reject args with only launchPath (missing registration type)', () => {
      expect(command.validateArguments(['/path/to/mod'])).toBe(false)
    })

    it('should accept "user" as registration type', () => {
      expect(command.validateArguments(['/path', 'user'])).toBe(true)
    })

    it('should accept "system" as registration type', () => {
      expect(command.validateArguments(['/path', 'system'])).toBe(true)
    })

    it('should accept "both" as registration type', () => {
      expect(command.validateArguments(['/path', 'both'])).toBe(true)
    })

    it('should reject invalid registration type', () => {
      expect(command.validateArguments(['/path', 'network'])).toBe(false)
    })

    it('should be case-sensitive (rejects "User")', () => {
      expect(command.validateArguments(['/path', 'User'])).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('should call registry.register with parsed registration flags', () => {
      const { utility, registerSpy } = createUtilityWithRegistry()

      command.run(utility, ['/path/to/mod', 'user'])

      expect(registerSpy).toHaveBeenCalledTimes(1)
      expect(registerSpy).toHaveBeenCalledWith(
        utility.modData.manifest,
        '/path/to/mod',
        [],  // empty launch args
        ModRegistration.User,
      )
    })

    it('should pass "system" as System flag', () => {
      const { utility, registerSpy } = createUtilityWithRegistry()

      command.run(utility, ['/path/to/mod', 'system'])

      expect(registerSpy).toHaveBeenCalledWith(
        utility.modData.manifest,
        '/path/to/mod',
        [],
        ModRegistration.System,
      )
    })

    it('should pass "both" as combined flags', () => {
      const { utility, registerSpy } = createUtilityWithRegistry()

      command.run(utility, ['/path/to/mod', 'both'])

      expect(registerSpy).toHaveBeenCalledWith(
        utility.modData.manifest,
        '/path/to/mod',
        [],
        ModRegistration.User | ModRegistration.System,
      )
    })

    it('should not throw when registry is missing (no-op fallback)', () => {
      const utility = new Utility({ manifest: { id: 'test', metadata: { version: '1.0' } } } as never, new Map())
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(() => command.run(utility, ['/path', 'user'])).not.toThrow()

      warnSpy.mockRestore()
    })
  })
})
