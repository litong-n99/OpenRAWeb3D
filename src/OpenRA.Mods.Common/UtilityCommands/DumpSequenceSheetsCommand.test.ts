/**
 * DumpSequenceSheetsCommand.test.ts — DumpSequenceSheetsCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、CommitSheet 计数逻辑
 */

import { describe, it, expect } from 'vitest'
import { DumpSequenceSheetsCommand } from './DumpSequenceSheetsCommand'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DumpSequenceSheetsCommand', () => {
  function createCommand(): DumpSequenceSheetsCommand {
    return new DumpSequenceSheetsCommand()
  }

  // -----------------------------------------------------------------------
  // IUtilityCommand contract
  // -----------------------------------------------------------------------

  it('has correct command name', () => {
    expect(createCommand().name).toBe('--dump-sheets')
  })

  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  it('has correct CHANNEL_MASKS', () => {
    expect(DumpSequenceSheetsCommand.CHANNEL_MASKS).toEqual([2, 1, 0, 3])
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('accepts no extra args (dump all)', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--dump-sheets'])).toBe(true)
    })

    it('accepts palette arg only', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--dump-sheets', 'temperat.pal'])).toBe(true)
    })

    it('accepts palette + tileset args', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments([
        '--dump-sheets', 'temperat.pal', 'TEMPERATE',
      ])).toBe(true)
    })

    it('accepts palette + map path args', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments([
        '--dump-sheets', 'temperat.pal', 'maps/skirmish.oramap',
      ])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing with no extra args', () => {
      const cmd = createCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {} },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--dump-sheets'])
      }).not.toThrow()
    })

    it('executes without throwing with palette + tileset args', () => {
      const cmd = createCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {} },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--dump-sheets', 'temperat.pal', 'TEMPERATE'])
      }).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // commitSheet (static)
  // -----------------------------------------------------------------------

  describe('commitSheet', () => {
    it('increments count', () => {
      const count = { value: 1 }
      DumpSequenceSheetsCommand.commitSheet(null, {}, 'test', null, count)
      expect(count.value).toBe(2)
    })

    it('handles builder=null (BGRA sheet)', () => {
      const count = { value: 0 }
      // Should not throw
      expect(() => {
        DumpSequenceSheetsCommand.commitSheet(null, {}, 'bgrasheet', null, count)
      }).not.toThrow()
    })

    it('handles builder + palette present (indexed sheet)', () => {
      const count = { value: 5 }
      const mockBuilder = {}
      const mockPalette = {}
      expect(() => {
        DumpSequenceSheetsCommand.commitSheet(mockBuilder, {}, 'indexed', mockPalette, count)
      }).not.toThrow()
      expect(count.value).toBe(6)
    })

    it('handles builder present + palette=null', () => {
      const count = { value: 10 }
      const mockBuilder = {}
      expect(() => {
        DumpSequenceSheetsCommand.commitSheet(mockBuilder, {}, 'no-palette', null, count)
      }).not.toThrow()
      // Count still increments (per OpenRA behavior)
    })
  })
})
