/**
 * UnregisterModCommand.test.ts — UnregisterModCommand 单元测试
 *
 * 测试焦点:
 * - 命令名和描述属性
 * - validateArguments 参数验证
 * - run() 从 Utility 获取 IModRegistry 并委托注销调用
 * - 无 ModRegistry 时的回退（无操作）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnregisterModCommand } from './UnregisterModCommand'
import { ModRegistration, type IModRegistry } from './ModRegistration'
import { Utility } from '../IUtilityCommand'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createUtilityWithRegistry(): { utility: Utility; registry: IModRegistry; unregisterSpy: ReturnType<typeof vi.fn> } {
  const unregisterSpy = vi.fn()
  const registry: IModRegistry = {
    register: vi.fn(),
    unregister: unregisterSpy,
    clearInvalidRegistrations: vi.fn(),
  }
  const modData = {
    manifest: { id: 'test-mod', metadata: { version: '1.0', hidden: false } },
  } as never
  const utility = Object.assign(new Utility(modData, new Map()), { modRegistry: registry })
  return { utility, registry, unregisterSpy }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnregisterModCommand', () => {
  let command: UnregisterModCommand

  beforeEach(() => {
    command = new UnregisterModCommand()
  })

  // -----------------------------------------------------------------------
  // IUtilityCommand contract
  // -----------------------------------------------------------------------

  describe('name and description', () => {
    it('should have correct command name', () => {
      expect(command.name).toBe('--unregister-mod')
    })

    it('should have a non-empty description', () => {
      expect(command.description).toBeTruthy()
      expect(command.description).toContain('metadata')
    })
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('should reject empty args', () => {
      expect(command.validateArguments([])).toBe(false)
    })

    it('should accept "user"', () => {
      expect(command.validateArguments(['user'])).toBe(true)
    })

    it('should accept "system"', () => {
      expect(command.validateArguments(['system'])).toBe(true)
    })

    it('should accept "both"', () => {
      expect(command.validateArguments(['both'])).toBe(true)
    })

    it('should reject invalid registration type', () => {
      expect(command.validateArguments(['all'])).toBe(false)
    })

    it('should reject extra args (strict)', () => {
      // C# impl checks args.Length >= 2 and args[1] in valid set
      // Extra args after the type are ignored
      expect(command.validateArguments(['user', 'extra'])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('should call registry.unregister with parsed flags', () => {
      const { utility, unregisterSpy } = createUtilityWithRegistry()

      command.run(utility, ['user'])

      expect(unregisterSpy).toHaveBeenCalledTimes(1)
      expect(unregisterSpy).toHaveBeenCalledWith(
        utility.modData.manifest,
        ModRegistration.User,
      )
    })

    it('should pass "system" as System flag', () => {
      const { utility, unregisterSpy } = createUtilityWithRegistry()
      command.run(utility, ['system'])
      expect(unregisterSpy).toHaveBeenCalledWith(utility.modData.manifest, ModRegistration.System)
    })

    it('should pass "both" as combined flags', () => {
      const { utility, unregisterSpy } = createUtilityWithRegistry()
      command.run(utility, ['both'])
      expect(unregisterSpy).toHaveBeenCalledWith(
        utility.modData.manifest,
        ModRegistration.User | ModRegistration.System,
      )
    })

    it('should not throw when registry is missing', () => {
      const utility = new Utility(
        { manifest: { id: 'test', metadata: { version: '1.0' } } } as never,
        new Map(),
      )
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(() => command.run(utility, ['user'])).not.toThrow()

      warnSpy.mockRestore()
    })
  })
})
