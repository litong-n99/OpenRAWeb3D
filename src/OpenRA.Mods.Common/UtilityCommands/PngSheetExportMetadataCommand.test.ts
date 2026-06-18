/**
 * PngSheetExportMetadataCommand.test.ts -- PngSheetExportMetadataCommand migration unit tests
 *
 * Test focus: argument validation, metadata computation, JSON serialization,
 * PNG dimension reading, command execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  PngSheetExportMetadataCommand,
  computeSheetMetadata,
  generateMetadataJson,
  readPngDimensions,
  type PngSheetExportConfig,
} from './PngSheetExportMetadataCommand'

// ---------------------------------------------------------------------------
// PngSheetExportMetadataCommand
// ---------------------------------------------------------------------------

describe('PngSheetExportMetadataCommand', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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

    it('accepts exactly one file arg', () => {
      const cmd = new PngSheetExportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-export', 'sheet.png'])).toBe(true)
    })

    it('accepts additional options', () => {
      const cmd = new PngSheetExportMetadataCommand()
      expect(cmd.validateArguments(['--png-sheet-export', 'sheet.png', '--frame-width', '64'])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing', () => {
      const cmd = new PngSheetExportMetadataCommand()
      expect(() => {
        cmd.run(
          { modData: {} as any, mods: new Map() },
          ['--png-sheet-export', 'sheet.png'],
        )
      }).not.toThrow()
    })

    it('shows error for non-existent PNG file', () => {
      const cmd = new PngSheetExportMetadataCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--png-sheet-export', '/nonexistent/sheet.png'],
      )
      const errCalls = consoleErrorSpy.mock.calls.flat()
      const errText = errCalls.join(' ')
      expect(errText).toContain('Cannot read PNG dimensions')
    })

    it('does not log old TODO stub', () => {
      const cmd = new PngSheetExportMetadataCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--png-sheet-export', 'sheet.png'],
      )
      const errCalls = consoleErrorSpy.mock.calls.flat()
      const errText = errCalls.join(' ')
      expect(errText).not.toContain('TODO-21.G.5')
    })
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

// ---------------------------------------------------------------------------
// computeSheetMetadata
// ---------------------------------------------------------------------------

describe('computeSheetMetadata', () => {
  it('defaults to single frame (full image) when no config provided', () => {
    const result = computeSheetMetadata(1024, 512)
    expect(result.valid).toBe(true)
    expect(result.frameWidth).toBe(1024)
    expect(result.frameHeight).toBe(512)
    expect(result.columns).toBe(1)
    expect(result.rows).toBe(1)
    expect(result.totalFrames).toBe(1)
  })

  it('computes grid from frame size config', () => {
    const config: PngSheetExportConfig = { frameWidth: 64, frameHeight: 64 }
    const result = computeSheetMetadata(1024, 512, config)
    expect(result.valid).toBe(true)
    expect(result.frameWidth).toBe(64)
    expect(result.frameHeight).toBe(64)
    expect(result.columns).toBe(16)
    expect(result.rows).toBe(8)
    expect(result.totalFrames).toBe(128)
  })

  it('detects remainder pixels', () => {
    const config: PngSheetExportConfig = { frameWidth: 30, frameHeight: 30 }
    const result = computeSheetMetadata(100, 100, config)
    expect(result.valid).toBe(true)
    expect(result.columns).toBe(3)
    expect(result.rows).toBe(3)
    expect(result.totalFrames).toBe(9)
    expect(result.remainderX).toBe(10)
    expect(result.remainderY).toBe(10)
  })

  it('validates frame count against capacity', () => {
    const config: PngSheetExportConfig = { frameWidth: 64, frameHeight: 64, frameAmount: 300 }
    const result = computeSheetMetadata(256, 256, config)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('exceeds grid capacity')
  })

  it('accepts valid explicit frame amount', () => {
    const config: PngSheetExportConfig = { frameWidth: 64, frameHeight: 64, frameAmount: 10 }
    const result = computeSheetMetadata(256, 256, config)
    expect(result.valid).toBe(true)
    expect(result.totalFrames).toBe(10)
  })

  it('rejects frame size larger than image', () => {
    const config: PngSheetExportConfig = { frameWidth: 200, frameHeight: 200 }
    const result = computeSheetMetadata(100, 100, config)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('smaller than frame size')
  })

  it('rejects zero frame size', () => {
    const config: PngSheetExportConfig = { frameWidth: 0, frameHeight: 64 }
    const result = computeSheetMetadata(100, 100, config)
    expect(result.valid).toBe(false)
  })

  it('rejects negative frame size', () => {
    const config: PngSheetExportConfig = { frameWidth: -1, frameHeight: 64 }
    const result = computeSheetMetadata(100, 100, config)
    expect(result.valid).toBe(false)
  })

  it('handles non-square frame sizes', () => {
    const config: PngSheetExportConfig = { frameWidth: 32, frameHeight: 40 }
    const result = computeSheetMetadata(320, 200, config)
    expect(result.valid).toBe(true)
    expect(result.columns).toBe(10)
    expect(result.rows).toBe(5)
    expect(result.totalFrames).toBe(50)
  })

  it('returns zero remainder for evenly divisible dimensions', () => {
    const config: PngSheetExportConfig = { frameWidth: 64, frameHeight: 64 }
    const result = computeSheetMetadata(256, 256, config)
    expect(result.remainderX).toBe(0)
    expect(result.remainderY).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// generateMetadataJson
// ---------------------------------------------------------------------------

describe('generateMetadataJson', () => {
  it('generates valid JSON with required fields', () => {
    const metadata = computeSheetMetadata(512, 256, { frameWidth: 64, frameHeight: 64 })
    expect(metadata.valid).toBe(true)

    const json = generateMetadataJson(metadata)
    const parsed = JSON.parse(json)

    expect(parsed.FrameSize).toEqual({ Width: 64, Height: 64 })
    expect(parsed.FrameAmount).toBe(32) // 8 * 4
    expect(parsed.Grid).toEqual({ Columns: 8, Rows: 4 })
    expect(parsed.ImageSize).toEqual({ Width: 512, Height: 256 })
  })

  it('includes remainder when present', () => {
    const metadata = computeSheetMetadata(100, 100, { frameWidth: 30, frameHeight: 30 })
    expect(metadata.valid).toBe(true)

    const json = generateMetadataJson(metadata)
    const parsed = JSON.parse(json)

    expect(parsed.RemainderPixels).toEqual({ X: 10, Y: 10 })
  })

  it('omits remainder when zero', () => {
    const metadata = computeSheetMetadata(256, 256, { frameWidth: 64, frameHeight: 64 })
    const json = generateMetadataJson(metadata)
    const parsed = JSON.parse(json)

    expect(parsed.RemainderPixels).toBeUndefined()
  })

  it('includes custom metadata from config', () => {
    const metadata = computeSheetMetadata(64, 64)
    const config: PngSheetExportConfig = {
      custom: { 'Author': 'Test', 'Version': '1.0' },
    }
    const json = generateMetadataJson(metadata, config)
    const parsed = JSON.parse(json)

    expect(parsed.Author).toBe('Test')
    expect(parsed.Version).toBe('1.0')
  })

  it('produces pretty-printed JSON', () => {
    const metadata = computeSheetMetadata(100, 100)
    const json = generateMetadataJson(metadata)
    // Pretty-printed JSON has newlines
    expect(json).toContain('\n')
    expect(json).toContain('  ')
  })

  it('is valid JSON for single-frame default', () => {
    const metadata = computeSheetMetadata(800, 600)
    const json = generateMetadataJson(metadata)
    const parsed = JSON.parse(json)
    expect(parsed.FrameAmount).toBe(1)
    expect(parsed.FrameSize.Width).toBe(800)
    expect(parsed.FrameSize.Height).toBe(600)
  })
})
