/**
 * UtilityRunner.test.ts — UtilityRunner 命令调度器单元测试
 *
 * 测试焦点:
 * - 命令注册/注销
 * - 参数解析与命令分派
 * - 验证失败处理
 * - ModData 工厂注入
 * - 帮助输出
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UtilityRunner } from './UtilityRunner'
import { Utility } from './IUtilityCommand'
import type { IUtilityCommand } from './IUtilityCommand'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 创建一个带有 spy 验证和 spy 执行的命令。 */
function makeSpyCommand(name: string, valid = true): IUtilityCommand & { runSpy: ReturnType<typeof vi.fn>; validateSpy: ReturnType<typeof vi.fn> } {
  const runSpy = vi.fn()
  const validateSpy = vi.fn().mockReturnValue(valid)
  return {
    name,
    validateArguments: (args: string[]) => validateSpy(args),
    run: runSpy,
    runSpy,
    validateSpy,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UtilityRunner', () => {
  let runner: UtilityRunner

  beforeEach(() => {
    runner = new UtilityRunner()
  })

  // -----------------------------------------------------------------------
  // Command registration
  // -----------------------------------------------------------------------

  describe('register', () => {
    it('should register a command', () => {
      const cmd = makeSpyCommand('--test')
      runner.register(cmd)
      expect(runner.registeredCommands).toContain('--test')
      expect(runner.commandCount).toBe(1)
    })

    it('should throw on duplicate registration', () => {
      runner.register(makeSpyCommand('--test'))
      expect(() => runner.register(makeSpyCommand('--test'))).toThrow(
        /duplicate command registration/,
      )
    })

    it('should allow multiple different commands', () => {
      runner.register(makeSpyCommand('--cmd1'))
      runner.register(makeSpyCommand('--cmd2'))
      runner.register(makeSpyCommand('--cmd3'))
      expect(runner.commandCount).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // Command unregistration
  // -----------------------------------------------------------------------

  describe('unregister', () => {
    it('should remove a registered command', () => {
      runner.register(makeSpyCommand('--test'))
      expect(runner.unregister('--test')).toBe(true)
      expect(runner.commandCount).toBe(0)
    })

    it('should return false for unknown command', () => {
      expect(runner.unregister('--nonexistent')).toBe(false)
    })

    it('should allow re-registration after unregistration', () => {
      runner.register(makeSpyCommand('--test'))
      runner.unregister('--test')
      expect(() => runner.register(makeSpyCommand('--test'))).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // getCommand
  // -----------------------------------------------------------------------

  describe('getCommand', () => {
    it('should return the command instance', () => {
      const cmd = makeSpyCommand('--test')
      runner.register(cmd)
      expect(runner.getCommand('--test')).toBe(cmd)
    })

    it('should return undefined for unknown command', () => {
      expect(runner.getCommand('--unknown')).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // run — command dispatch
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('should dispatch to the correct command', async () => {
      const cmd = makeSpyCommand('--test')
      runner.register(cmd)
      runner.setModsProvider(() => new Map())

      await runner.run(['--test', 'arg1', 'arg2'])

      expect(cmd.validateSpy).toHaveBeenCalledWith(['arg1', 'arg2'])
      expect(cmd.runSpy).toHaveBeenCalled()
    })

    it('should find command among multiple args', async () => {
      const cmd = makeSpyCommand('--target')
      runner.register(cmd)
      runner.setModsProvider(() => new Map())

      await runner.run(['some-prefix', '--target', 'value'])

      expect(cmd.runSpy).toHaveBeenCalled()
      const utilityArg = cmd.runSpy.mock.calls[0][0] as Utility
      expect(utilityArg).toBeInstanceOf(Utility)
    })

    it('should pass only args after command name', async () => {
      const cmd = makeSpyCommand('--cmd')
      runner.register(cmd)
      runner.setModsProvider(() => new Map())

      await runner.run(['--cmd', 'arg1', 'arg2'])

      expect(cmd.validateSpy).toHaveBeenCalledWith(['arg1', 'arg2'])
    })

    it('should throw on unknown command', async () => {
      await expect(runner.run(['--unknown'])).rejects.toThrow(/Unknown command/)
    })

    it('should throw when validation fails', async () => {
      const cmd = makeSpyCommand('--cmd', false)
      runner.register(cmd)
      runner.setModsProvider(() => new Map())

      await expect(runner.run(['--cmd', 'bad'])).rejects.toThrow(/Invalid arguments/)
    })

    it('should print help with no args', async () => {
      // No args — should not throw, just log help
      await expect(runner.run([])).resolves.toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // run — ModData factory
  // -----------------------------------------------------------------------

  describe('run with ModData factory', () => {
    it('should call the factory with args', async () => {
      const cmd = makeSpyCommand('--cmd')
      runner.register(cmd)
      runner.setModsProvider(() => new Map())

      const factorySpy = vi.fn(() => ({ init: vi.fn().mockResolvedValue(undefined), manifest: { id: 'test' } }) as never)
      runner.setModDataFactory(factorySpy)

      await runner.run(['--cmd'])

      expect(factorySpy).toHaveBeenCalledWith(['--cmd'])
    })

    it('should throw when factory returns null', async () => {
      const cmd = makeSpyCommand('--cmd')
      runner.register(cmd)
      runner.setModsProvider(() => new Map())
      runner.setModDataFactory(() => null)

      await expect(runner.run(['--cmd'])).rejects.toThrow(/Failed to initialize ModData/)
    })
  })

  // -----------------------------------------------------------------------
  // run — ModRegistry injection
  // -----------------------------------------------------------------------

  describe('setModRegistry', () => {
    it('should inject registry into Utility context', async () => {
      const cmd = makeSpyCommand('--cmd')
      runner.register(cmd)
      runner.setModsProvider(() => new Map())

      const mockRegistry = {
        register: vi.fn(),
        unregister: vi.fn(),
        clearInvalidRegistrations: vi.fn(() => 0),
      }
      runner.setModRegistry(mockRegistry)

      await runner.run(['--cmd'])

      // Verify registry was attached to the Utility context passed to command
      const utilityArg = cmd.runSpy.mock.calls[0][0] as Record<string, unknown>
      expect(utilityArg).toHaveProperty('modRegistry')
      expect(utilityArg.modRegistry).toBe(mockRegistry)
    })

    it('should not attach modRegistry when not set', async () => {
      const cmd = makeSpyCommand('--cmd')
      runner.register(cmd)
      runner.setModsProvider(() => new Map())
      // No setModRegistry call

      await runner.run(['--cmd'])

      const utilityArg = cmd.runSpy.mock.calls[0][0] as Record<string, unknown>
      expect(utilityArg.modRegistry).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // registeredCommands
  // -----------------------------------------------------------------------

  describe('registeredCommands', () => {
    it('should return empty array when no commands', () => {
      expect(runner.registeredCommands).toEqual([])
    })

    it('should return all command names', () => {
      runner.register(makeSpyCommand('--a'))
      runner.register(makeSpyCommand('--b'))
      expect(runner.registeredCommands).toEqual(expect.arrayContaining(['--a', '--b']))
    })
  })
})
