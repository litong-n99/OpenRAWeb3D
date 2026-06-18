/**
 * ConvertPngToShpCommand.test.ts — ConvertPngToShpCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、output 文件名生成、glob 集成逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConvertPngToShpCommand } from './ConvertPngToShpCommand'

// ---------------------------------------------------------------------------
// ConvertPngToShpCommand
// ---------------------------------------------------------------------------

describe('ConvertPngToShpCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('has correct command name', () => {
    const cmd = new ConvertPngToShpCommand()
    expect(cmd.name).toBe('--shp')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects no file args', () => {
      const cmd = new ConvertPngToShpCommand()
      expect(cmd.validateArguments(['--shp'])).toBe(false)
    })

    it('accepts single file', () => {
      const cmd = new ConvertPngToShpCommand()
      expect(cmd.validateArguments(['--shp', 'image.png'])).toBe(true)
    })

    it('accepts multiple files', () => {
      const cmd = new ConvertPngToShpCommand()
      expect(cmd.validateArguments(['--shp', 'a.png', 'b.png', 'c.png'])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run (stub with glob integration)
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = new ConvertPngToShpCommand()
      expect(() => {
        cmd.run(
          { modData: {} as any, mods: new Map() },
          ['--shp', 'image.png'],
        )
      }).not.toThrow()
    })

    it('logs the expected TODO message', () => {
      const cmd = new ConvertPngToShpCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--shp', 'image.png'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('TODO-21.G.4')
    })

    it('derives output filename from first input', () => {
      const cmd = new ConvertPngToShpCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--shp', 'infantry-0001.png'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('infantry.shp')
    })
  })
})
