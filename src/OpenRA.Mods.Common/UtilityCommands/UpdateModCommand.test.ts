/**
 * UpdateModCommand.test.ts — UpdateModCommand 单元测试
 *
 * 测试焦点:
 * - 命令名和描述属性
 * - validateArguments 始终返回 true
 * - run() 参数解析（SOURCE、--detailed、--apply、--skip-maps、--yes）
 * - 摘要输出模式 vs 应用模式
 * - IUpdateRuleSource 查找
 * - 缺少来源时的帮助输出
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UpdateModCommand, type IUpdateRule, type IUpdateRuleSource } from './UpdateModCommand'
import { Utility } from '../../OpenRA.Game/IUtilityCommand'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 创建一个最小化的 Utility 上下文。 */
function createUtility(): Utility {
  const modData = {
    manifest: { id: 'test-mod', metadata: { version: '1.0' } },
    mapCache: {},
  } as never
  return new Utility(modData, new Map())
}

/** 创建一个带有已知规则来源的 UpdateModCommand。 */
function createCommandWithRules(): {
  command: UpdateModCommand
  source: IUpdateRuleSource & { getRulesSpy: ReturnType<typeof vi.fn> }
  rules: IUpdateRule[]
} {
  const rules: IUpdateRule[] = [
    {
      name: 'RemoveOldWidget',
      description: 'Removes the old widget subsystem.',
      beforeUpdate: vi.fn(() => []),
      afterUpdate: vi.fn(() => []),
    },
    {
      name: 'RenameTrait',
      description: 'Renames TraitA to TraitB.',
    },
  ]
  const getRulesSpy = vi.fn(() => rules)
  const source: IUpdateRuleSource & { getRulesSpy: ReturnType<typeof vi.fn> } = {
    getRules: getRulesSpy,
    knownPaths: ['release-20230225', 'release-20231010'],
    knownRuleNames: ['RemoveOldWidget', 'RenameTrait', 'OtherRule'],
    getRulesSpy,
  }
  const command = new UpdateModCommand(source)
  return { command, source, rules }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateModCommand', () => {
  describe('without rule source', () => {
    let command: UpdateModCommand

    beforeEach(() => {
      command = new UpdateModCommand()
    })

    // -----------------------------------------------------------------------
    // IUtilityCommand contract
    // -----------------------------------------------------------------------

    it('should have correct command name', () => {
      expect(command.name).toBe('--update-mod')
    })

    it('should have a non-empty description', () => {
      expect(command.description).toBeTruthy()
      expect(command.description).toContain('SOURCE')
    })

    it('should always return true from validateArguments', () => {
      expect(command.validateArguments([])).toBe(true)
      expect(command.validateArguments(['anything'])).toBe(true)
      expect(command.validateArguments(['release-20230225', '--apply'])).toBe(true)
    })

    // -----------------------------------------------------------------------
    // run — no source
    // -----------------------------------------------------------------------

    it('should print help when no source provided', () => {
      const utility = createUtility()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, [])

      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })

    it('should print help and unknown source message when source is given', () => {
      const utility = createUtility()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['unknown-source'])

      // Should mention unknown source
      const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join(' ')
      expect(allLogs).toContain('Unknown source')

      logSpy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // With rule source
  // -----------------------------------------------------------------------

  describe('with rule source', () => {
    it('should look up rules from source by name', () => {
      const { command, source } = createCommandWithRules()
      const utility = createUtility()

      command.run(utility, ['release-20230225'])

      expect(source.getRulesSpy).toHaveBeenCalledWith('release-20230225')
    })

    it('should print summary in default mode', () => {
      const { command } = createCommandWithRules()
      const utility = createUtility()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['release-20231010'])

      const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(allLogs).toContain('Found 2 API changes')
      expect(allLogs).toContain('RemoveOldWidget')
      expect(allLogs).toContain('RenameTrait')

      logSpy.mockRestore()
    })

    it('should print detailed summary with --detailed', () => {
      const { command } = createCommandWithRules()
      const utility = createUtility()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['release-20231010', '--detailed'])

      const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(allLogs).toContain('Removes the old widget subsystem')

      logSpy.mockRestore()
    })

    it('should run BeforeUpdate and AfterUpdate with --apply', () => {
      const { command, rules } = createCommandWithRules()
      const utility = createUtility()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['release-20230225', '--apply', '--yes'])

      // Rule 0 has beforeUpdate/afterUpdate
      const rule0 = rules[0]
      expect(rule0.beforeUpdate).toHaveBeenCalled()
      expect(rule0.afterUpdate).toHaveBeenCalled()

      logSpy.mockRestore()
    })

    it('should respect skipMaps with --skip-maps', () => {
      const { command } = createCommandWithRules()
      const utility = createUtility()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['release-20230225', '--apply', '--yes', '--skip-maps'])

      const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(allLogs).toContain('SKIPPED')

      logSpy.mockRestore()
    })

    it('should cancel apply without --yes', () => {
      const { command } = createCommandWithRules()
      const utility = createUtility()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['release-20230225', '--apply'])

      const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(allLogs).toContain('Update cancelled')

      logSpy.mockRestore()
    })

    it('should print help when source is unknown', () => {
      const { command, source } = createCommandWithRules()
      source.getRulesSpy.mockReturnValue(null) // unknown source
      const utility = createUtility()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      command.run(utility, ['nonexistent-path'])

      const allLogs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(allLogs).toContain('Unknown source')

      logSpy.mockRestore()
    })

    it('should detect source arg among flags', () => {
      const { command, source } = createCommandWithRules()
      const utility = createUtility()

      // Source is the first non-flag arg
      command.run(utility, ['--detailed', 'release-20231010', '--apply', '--yes'])

      expect(source.getRulesSpy).toHaveBeenCalledWith('release-20231010')
    })
  })
})
