/**
 * ConvertSpriteToPngCommand.test.ts — ConvertSpriteToPngCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、选项标志解析
 */

import { describe, it, expect } from 'vitest'
import { ConvertSpriteToPngCommand } from './ConvertSpriteToPngCommand'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConvertSpriteToPngCommand', () => {
  function createCommand(): ConvertSpriteToPngCommand {
    return new ConvertSpriteToPngCommand()
  }

  // -----------------------------------------------------------------------
  // IUtilityCommand contract
  // -----------------------------------------------------------------------

  it('has correct command name', () => {
    expect(createCommand().name).toBe('--png')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects too few args (<3)', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--png'])).toBe(false)
      expect(cmd.validateArguments(['--png', 'sprite.shp'])).toBe(false)
    })

    it('accepts minimum valid args (sprite + palette)', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments(['--png', 'sprite.shp', 'temperat.pal'])).toBe(true)
    })

    it('accepts args with --noshadow flag', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments([
        '--png', 'sprite.shp', 'temperat.pal', '--noshadow',
      ])).toBe(true)
    })

    it('accepts args with --nopadding flag', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments([
        '--png', 'sprite.shp', 'temperat.pal', '--nopadding',
      ])).toBe(true)
    })

    it('accepts args with both optional flags', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments([
        '--png', 'sprite.shp', 'temperat.pal', '--noshadow', '--nopadding',
      ])).toBe(true)
    })

    it('accepts extra args beyond minimum', () => {
      const cmd = createCommand()
      expect(cmd.validateArguments([
        '--png', 'sprite.shp', 'temperat.pal', '--noshadow', '--nopadding', 'extra',
      ])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = createCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {} },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, [
          '--png', 'sprite.shp', 'temperat.pal',
        ])
      }).not.toThrow()
    })

    it('executes with all flags (stub mode)', () => {
      const cmd = createCommand()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {} },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, [
          '--png', 'sprite.shp', 'temperat.pal', '--noshadow', '--nopadding',
        ])
      }).not.toThrow()
    })
  })
})
