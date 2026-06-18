/**
 * PngSheetImportMetadataCommand.test.ts -- PngSheetImportMetadataCommand migration unit tests
 *
 * Test focus: argument validation, validateFrameCount, parseSize,
 * parseMetadataFromJson, validateMetadataAgainstPng, readPngDimensions,
 * command execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PngSheetImportMetadataCommand,
  validateFrameCount,
  parseSize,
  parseMetadataFromJson,
  validateMetadataAgainstPng,
  readPngDimensions,
} from './PngSheetImportMetadataCommand'

// ---------------------------------------------------------------------------
// PngSheetImportMetadataCommand
// ---------------------------------------------------------------------------

describe('PngSheetImportMetadataCommand', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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

    it('accepts additional options', () => {
      const cmd = new PngSheetImportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-import', 'sheet.png', '--validate-only'])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing', () => {
      const cmd = new PngSheetImportMetadataCommand()
      expect(() => {
        cmd.run(
          { modData: {} as any, mods: new Map() },
          ['--png-sheet-import', 'sheet.png'],
        )
      }).not.toThrow()
    })

    it('shows error for non-existent PNG file', () => {
      const cmd = new PngSheetImportMetadataCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--png-sheet-import', '/nonexistent/sheet.png'],
      )
      const errCalls = consoleErrorSpy.mock.calls.flat()
      const errText = errCalls.join(' ')
      expect(errText).toContain('Cannot read PNG dimensions')
    })

    it('does not log old TODO stub', () => {
      const cmd = new PngSheetImportMetadataCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--png-sheet-import', 'sheet.png'],
      )
      const errCalls = consoleErrorSpy.mock.calls.flat()
      const errText = errCalls.join(' ')
      expect(errText).not.toContain('TODO-21.G.6')
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
    expect(validateFrameCount({ Width: 64, Height: 64 }, 100, 1024, 1024)).toBeNull()
  })

  it('returns null when frame amount equals max', () => {
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

// ---------------------------------------------------------------------------
// parseMetadataFromJson
// ---------------------------------------------------------------------------

describe('parseMetadataFromJson', () => {
  it('parses FrameSize with nested Width/Height numbers', () => {
    const json = JSON.stringify({ FrameSize: { Width: 64, Height: 32 } })
    const result = parseMetadataFromJson(json)
    expect(result.valid).toBe(true)
    expect(result.metadata.FrameSize).toEqual({ Width: 64, Height: 32 })
  })

  it('parses FrameSize as string', () => {
    const json = JSON.stringify({ FrameSize: '64,32' })
    const result = parseMetadataFromJson(json)
    expect(result.valid).toBe(true)
    expect(result.metadata.FrameSize).toEqual({ Width: 64, Height: 32 })
  })

  it('parses FrameAmount as number', () => {
    const json = JSON.stringify({ FrameAmount: 256 })
    const result = parseMetadataFromJson(json)
    expect(result.valid).toBe(true)
    expect(result.metadata.FrameAmount).toBe(256)
  })

  it('parses FrameAmount as string', () => {
    const json = JSON.stringify({ FrameAmount: '256' })
    const result = parseMetadataFromJson(json)
    expect(result.valid).toBe(true)
    expect(result.metadata.FrameAmount).toBe(256)
  })

  it('collects custom metadata key-value pairs', () => {
    const json = JSON.stringify({
      FrameSize: { Width: 64, Height: 64 },
      Author: 'TestAuthor',
      Version: '2.0',
    })
    const result = parseMetadataFromJson(json)
    expect(result.valid).toBe(true)
    expect(result.metadata.Author).toBe('TestAuthor')
    expect(result.metadata.Version).toBe('2.0')
  })

  it('returns error for invalid JSON', () => {
    const result = parseMetadataFromJson('not valid json {{{')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('JSON parse error')
  })

  it('handles empty JSON object', () => {
    const result = parseMetadataFromJson('{}')
    expect(result.valid).toBe(true)
    expect(result.metadata.FrameSize).toBeUndefined()
    expect(result.metadata.FrameAmount).toBeUndefined()
  })

  it('ignores zero or negative FrameAmount', () => {
    const json = JSON.stringify({ FrameAmount: 0 })
    const result = parseMetadataFromJson(json)
    expect(result.valid).toBe(true)
    expect(result.metadata.FrameAmount).toBeUndefined()
  })

  it('converts non-string custom values to string', () => {
    const json = JSON.stringify({ CustomBool: true, CustomNum: 42 })
    const result = parseMetadataFromJson(json)
    expect(result.valid).toBe(true)
    expect(result.metadata.CustomBool).toBe('true')
    expect(result.metadata.CustomNum).toBe('42')
  })
})

// ---------------------------------------------------------------------------
// validateMetadataAgainstPng
// ---------------------------------------------------------------------------

describe('validateMetadataAgainstPng', () => {
  it('returns valid for good metadata', () => {
    const metadata = {
      FrameSize: { Width: 64, Height: 64 },
      FrameAmount: 256,
    }
    const report = validateMetadataAgainstPng(metadata, 1024, 1024)
    expect(report.valid).toBe(true)
    expect(report.errors).toHaveLength(0)
    expect(report.columns).toBe(16)
    expect(report.rows).toBe(16)
    expect(report.maxFrames).toBe(256)
  })

  it('returns error for frame size exceeding image', () => {
    const metadata = {
      FrameSize: { Width: 200, Height: 200 },
    }
    const report = validateMetadataAgainstPng(metadata, 100, 100)
    expect(report.valid).toBe(false)
    expect(report.errors.length).toBeGreaterThan(0)
    expect(report.errors[0]).toContain('exceeds PNG dimensions')
  })

  it('adds warning for non-divisible dimensions', () => {
    const metadata = {
      FrameSize: { Width: 30, Height: 30 },
    }
    const report = validateMetadataAgainstPng(metadata, 100, 100)
    expect(report.valid).toBe(true)
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]).toContain('evenly divisible')
  })

  it('adds warning when no FrameSize', () => {
    const metadata = {}
    const report = validateMetadataAgainstPng(metadata, 1024, 1024)
    expect(report.valid).toBe(true)
    expect(report.warnings.length).toBeGreaterThan(0)
    expect(report.warnings[0]).toContain('No FrameSize')
  })

  it('validates FrameAmount against capacity', () => {
    const metadata = {
      FrameSize: { Width: 64, Height: 64 },
      FrameAmount: 100,
    }
    const report = validateMetadataAgainstPng(metadata, 256, 256)
    // 256/64=4, 4*4=16 max frames. FrameAmount=100 > 16 -> error
    expect(report.valid).toBe(false)
    expect(report.maxFrames).toBe(16)
    expect(report.errors.length).toBeGreaterThan(0)
  })

  it('accepts empty metadata', () => {
    const report = validateMetadataAgainstPng({}, 1024, 512)
    // No FrameSize → warning, but no errors (FrameAmount check skipped)
    expect(report.warnings.length).toBeGreaterThan(0)
    expect(report.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// readPngDimensions
// ---------------------------------------------------------------------------

describe('readPngDimensions', () => {
  it('returns null for non-existent file', () => {
    const result = readPngDimensions('/nonexistent/path/to/file.png')
    expect(result).toBeNull()
  })

  it('returns null for empty path', () => {
    const result = readPngDimensions('')
    expect(result).toBeNull()
  })
})
