/**
 * PngSheetExportMetadataCommand.test.ts — PngSheetExportMetadataCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、文件名扩展名替换、stub 执行
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PngSheetExportMetadataCommand } from './PngSheetExportMetadataCommand'

// ---------------------------------------------------------------------------
// PngSheetExportMetadataCommand
// ---------------------------------------------------------------------------

describe('PngSheetExportMetadataCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('has correct command name', () => {
    const cmd = new PngSheetExportMetadataCommand()
    expect(cmd.name).toBe('--png-sheet-export')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects no args', () => {
      const cmd = new PngSheetExportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-export'])).toBe(false)
    })

    it('rejects too few args', () => {
      const cmd = new PngSheetExportMetadataCommand()
      // args.length === 2 means [command, pngFile]
      expect(cmd.validateArguments(['--png-sheet-export'])).toBe(false)
    })

    it('accepts exactly one file arg', () => {
      const cmd = new PngSheetExportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-export', 'sheet.png'])).toBe(true)
    })

    it('rejects excessive args (> 2)', () => {
      const cmd = new PngSheetExportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-export', 'sheet.png', 'extra'])).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // run (stub)
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = new PngSheetExportMetadataCommand()
      expect(() => {
        cmd.run(
          { modData: {} as any, mods: new Map() },
          ['--png-sheet-export', 'sheet.png'],
        )
      }).not.toThrow()
    })

    it('logs the expected TODO message', () => {
      const cmd = new PngSheetExportMetadataCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--png-sheet-export', 'sheet.png'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('TODO-21.G.5')
    })

    it('reports the target YAML filename', () => {
      const cmd = new PngSheetExportMetadataCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--png-sheet-export', 'sheet.png'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('sheet.yaml')
    })
  })
})
