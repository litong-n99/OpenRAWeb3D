/**
 * PngSheetImportMetadataCommand.test.ts — PngSheetImportMetadataCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、validateFrameCount、parseSize、stub 执行
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PngSheetImportMetadataCommand,
  validateFrameCount,
  parseSize,
} from './PngSheetImportMetadataCommand'

// ---------------------------------------------------------------------------
// PngSheetImportMetadataCommand
// ---------------------------------------------------------------------------

describe('PngSheetImportMetadataCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('has correct command name', () => {
    const cmd = new PngSheetImportMetadataCommand()
    expect(cmd.name).toBe('--png-sheet-import')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects no args', () => {
      const cmd = new PngSheetImportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-import'])).toBe(false)
    })

    it('accepts exactly one file arg', () => {
      const cmd = new PngSheetImportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-import', 'sheet.png'])).toBe(true)
    })

    it('rejects excessive args (> 2)', () => {
      const cmd = new PngSheetImportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-import', 'sheet.png', 'extra'])).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // run (stub)
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = new PngSheetImportMetadataCommand()
      expect(() => {
        cmd.run(
          { modData: {} as any, mods: new Map() },
          ['--png-sheet-import', 'sheet.png'],
        )
      }).not.toThrow()
    })

    it('logs the expected TODO message', () => {
      const cmd = new PngSheetImportMetadataCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--png-sheet-import', 'sheet.png'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('TODO-21.G.6')
    })

    it('reports the source YAML filename', () => {
      const cmd = new PngSheetImportMetadataCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--png-sheet-import', 'sheet.png'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('sheet.yaml')
    })
  })
})

// ---------------------------------------------------------------------------
// validateFrameCount
// ---------------------------------------------------------------------------

describe('validateFrameCount', () => {
  it('returns null when no FrameSize', () => {
    expect(validateFrameCount(undefined, 10, 1024, 1024)).toBeNull()
  })

  it('returns null when frame count is within bounds', () => {
    // PNG 1024x1024, frame 64x64 → max 256 frames
    expect(validateFrameCount({ Width: 64, Height: 64 }, 100, 1024, 1024)).toBeNull()
  })

  it('returns null when frame amount equals max', () => {
    // PNG 256x256, frame 64x64 → max 16 frames
    expect(validateFrameCount({ Width: 64, Height: 64 }, 16, 256, 256)).toBeNull()
  })

  it('returns error when frame count exceeds capacity', () => {
    const err = validateFrameCount({ Width: 64, Height: 64 }, 20, 256, 256)
    expect(err).not.toBeNull()
    expect(err!).toContain('too small')
  })

  it('returns null when FrameAmount is undefined', () => {
    expect(validateFrameCount({ Width: 64, Height: 64 }, undefined, 256, 256)).toBeNull()
  })

  it('calculates max frames from width and height divisions', () => {
    // PNG 100x200, frame 30x40 → cols=3, rows=5 → max 15
    const err = validateFrameCount({ Width: 30, Height: 40 }, 16, 100, 200)
    expect(err).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// parseSize
// ---------------------------------------------------------------------------

describe('parseSize', () => {
  it('parses comma-separated values', () => {
    const result = parseSize('64,32')
    expect(result).toEqual({ Width: 64, Height: 32 })
  })

  it('parses "x"-separated values', () => {
    const result = parseSize('64x32')
    expect(result).toEqual({ Width: 64, Height: 32 })
  })

  it('parses uppercase X', () => {
    const result = parseSize('64X32')
    expect(result).toEqual({ Width: 64, Height: 32 })
  })

  it('parses space-insensitive', () => {
    const result = parseSize(' 64 , 32 ')
    expect(result).toEqual({ Width: 64, Height: 32 })
  })

  it('returns null for invalid format', () => {
    expect(parseSize('abc')).toBeNull()
    expect(parseSize('')).toBeNull()
    expect(parseSize('64')).toBeNull()
  })

  it('returns null for non-numeric values', () => {
    expect(parseSize('abc,def')).toBeNull()
  })

  it('returns null for zero or negative dimensions', () => {
    expect(parseSize('0,32')).toBeNull()
    expect(parseSize('-1,32')).toBeNull()
  })
})
