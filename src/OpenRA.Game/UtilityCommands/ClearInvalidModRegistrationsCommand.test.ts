/**
 * ClearInvalidModRegistrationsCommand.test.ts — ClearInvalidModRegistrationsCommand 单元测试
 *
 * 测试焦点:
 * - 命令名和描述属性
 * - validateArguments 参数验证
 * - run() 委托 registry.clearInvalidRegistrations 并报告清理数量
 * - 无 ModRegistry 时返回 0 的回退
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClearInvalidModRegistrationsCommand } from './ClearInvalidModRegistrationsCommand'
import { ModRegistration, type IModRegistry } from './ModRegistration'
import { Utility } from '../IUtilityCommand'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createUtilityWithRegistry(clearReturns = 5): {
  utility: Utility
  registry: IModRegistry
  clearSpy: ReturnType<typeof vi.fn>
} {
  const clearSpy = vi.fn(() => clearReturns)
  const registry: IModRegistry = {
    register: vi.fn(),
    unregister: vi.fn(),
    clearInvalidRegistrations: clearSpy,
  }
  const modData = {
    manifest: { id: 'test-mod', metadata: { version: '1.0' } },
  } as never
  const utility = Object.assign(new Utility(modData, new Map()), { modRegistry: registry })
  return { utility, registry, clearSpy }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClearInvalidModRegistrationsCommand', () => {
  let command: ClearInvalidModRegistrationsCommand

  beforeEach(() => {
    command = new ClearInvalidModRegistrationsCommand()
  })

  // -----------------------------------------------------------------------
  // IUtilityCommand contract
  // -----------------------------------------------------------------------

  describe('name and description', () => {
    it('should have correct command name', () => {
      expect(command.name).toBe('--clear-invalid-mod-registrations')
    })

    it('should have a non-empty description', () => {
      expect(command.description).toBeTruthy()
      expect(command.description).toContain('invalid')
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

    it('should reject invalid type', () => {
      expect(command.validateArguments(['all'])).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('should call registry.clearInvalidRegistrations and log count', () => {
      const { utility, clearSpy } = createUtilityWithRegistry(5)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['both'])

      expect(clearSpy).toHaveBeenCalledWith(ModRegistration.User | ModRegistration.System)
      expect(logSpy).toHaveBeenCalledWith('Cleared 5 invalid mod registration(s).')

      logSpy.mockRestore()
    })

    it('should report zero when registry returns 0', () => {
      const { utility } = createUtilityWithRegistry(0)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['system'])

      expect(logSpy).toHaveBeenCalledWith('Cleared 0 invalid mod registration(s).')
      logSpy.mockRestore()
    })

    it('should not throw when registry is missing (returns 0)', () => {
      const utility = new Utility(
        { manifest: { id: 'test', metadata: { version: '1.0' } } } as never,
        new Map(),
      )
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      expect(() => command.run(utility, ['user'])).not.toThrow()
      expect(logSpy).toHaveBeenCalledWith('Cleared 0 invalid mod registration(s).')

      warnSpy.mockRestore()
      logSpy.mockRestore()
    })
  })
})
