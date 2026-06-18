/**
 * UpdateMapCommand.test.ts — UpdateMapCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、帮助消息输出（存根模式）
 */

import { describe, it, expect } from 'vitest'
import { UpdateMapCommand } from './UpdateMapCommand'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UpdateMapCommand', () => {
  function createCommand(): UpdateMapCommand {
    return new UpdateMapCommand()
  }

  // -----------------------------------------------------------------------
  // IUtilityCommand contract
  // -----------------------------------------------------------------------

  it('has correct command name', () => {
    expect(createCommand().name).toBe('--update-map')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects too few args', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--update-map'])).toBe(false)
    })

    it('accepts minimum valid args (map path)', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--update-map', 'map.oramap'])).toBe(true)
    })

    it('accepts args with update source', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--update-map', 'map.oramap', 'release-20230225'])).toBe(true)
    })

    it('accepts args with --detailed flag', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--update-map', 'map.oramap', 'release-20230225', '--detailed'])).toBe(true)
    })

    it('accepts args with --apply flag', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--update-map', 'map.oramap', 'release-20230225', '--apply'])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (help text mode)', () => {
      const cmd = createCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {} },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--update-map', 'map.oramap'])
      }).not.toThrow()
    })

    it('shows help for unknown sources', () => {
      const cmd = createCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {} },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--update-map', 'map.oramap', 'unknown-source'])
      }).not.toThrow()
    })
  })
})
