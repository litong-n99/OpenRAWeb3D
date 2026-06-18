/**
 * ConvertPngToShpCommand.test.ts -- ConvertPngToShpCommand migration unit tests
 *
 * Test focus: argument validation, output filename derivation,
 * frame layout computation, PNG header reading, frame validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ConvertPngToShpCommand,
  computeFrameLayout,
  deriveOutputFilename,
  readPngHeaderInfo,
  validateFrameFiles,
} from './ConvertPngToShpCommand'

// ---------------------------------------------------------------------------
// ConvertPngToShpCommand
// ---------------------------------------------------------------------------

describe('ConvertPngToShpCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
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
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing', () => {
      const cmd = new ConvertPngToShpCommand()
      expect(() => {
        cmd.run(
          { modData: {} as any, mods: new Map() },
          ['--shp', 'image.png'],
        )
      }).not.toThrow()
    })

    it('handles no files found gracefully', () => {
      const cmd = new ConvertPngToShpCommand()
      // With no matching files, glob returns empty and it logs "No input files"
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--shp', 'nonexistent-*.png'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('No input files')
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

    it('shows conversion plan without TODO stub', () => {
      const cmd = new ConvertPngToShpCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--shp', 'image.png'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      // Should contain conversion plan info
      expect(allText).toContain('ConvertPngToShpCommand')
      // Should NOT contain old TODO stub
      expect(allText).not.toContain('TODO-21.G.4')
    })
  })
})

// ---------------------------------------------------------------------------
// computeFrameLayout
// ---------------------------------------------------------------------------

describe('computeFrameLayout', () => {
  it('computes evenly divisible grid', () => {
    const result = computeFrameLayout(1024, 512, 64, 64)
    expect(result).not.toBeNull()
    expect(result!.columns).toBe(16)
    expect(result!.rows).toBe(8)
    expect(result!.totalFrames).toBe(128)
    expect(result!.frameWidth).toBe(64)
    expect(result!.frameHeight).toBe(64)
  })

  it('returns single frame when dimensions match', () => {
    const result = computeFrameLayout(64, 64, 64, 64)
    expect(result).not.toBeNull()
    expect(result!.columns).toBe(1)
    expect(result!.rows).toBe(1)
    expect(result!.totalFrames).toBe(1)
  })

  it('truncates partial frames (floor division)', () => {
    const result = computeFrameLayout(100, 100, 30, 30)
    expect(result).not.toBeNull()
    expect(result!.columns).toBe(3)
    expect(result!.rows).toBe(3)
    expect(result!.totalFrames).toBe(9)
  })

  it('returns null for zero frame dimensions', () => {
    expect(computeFrameLayout(100, 100, 0, 10)).toBeNull()
    expect(computeFrameLayout(100, 100, 10, 0)).toBeNull()
  })

  it('returns null for zero image dimensions', () => {
    expect(computeFrameLayout(0, 100, 10, 10)).toBeNull()
    expect(computeFrameLayout(100, 0, 10, 10)).toBeNull()
  })

  it('returns null when frame is larger than image', () => {
    const result = computeFrameLayout(10, 10, 100, 100)
    expect(result).toBeNull()
  })

  it('handles non-square frames', () => {
    const result = computeFrameLayout(320, 200, 32, 40)
    expect(result).not.toBeNull()
    expect(result!.columns).toBe(10)
    expect(result!.rows).toBe(5)
    expect(result!.totalFrames).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// deriveOutputFilename
// ---------------------------------------------------------------------------

describe('deriveOutputFilename', () => {
  it('derives from hyphenated filename', () => {
    expect(deriveOutputFilename(['infantry-0001.png'])).toBe('infantry.shp')
  })

  it('derives from sorted list (first file determines name)', () => {
    const files = ['tank-0001.png', 'tank-0002.png', 'tank-0003.png']
    expect(deriveOutputFilename(files)).toBe('tank.shp')
  })

  it('handles paths with directories', () => {
    const files = ['/path/to/sprite-0001.png']
    expect(deriveOutputFilename(files)).toBe('sprite.shp')
  })

  it('handles filenames without hyphens', () => {
    const files = ['singleframe.png']
    expect(deriveOutputFilename(files)).toBe('singleframe.shp')
  })

  it('returns default for empty input', () => {
    expect(deriveOutputFilename([])).toBe('output.shp')
  })

  it('handles multiple hyphens (splits on first)', () => {
    const files = ['unit-walk-0001.png']
    expect(deriveOutputFilename(files)).toBe('unit.shp')
  })
})

// ---------------------------------------------------------------------------
// readPngHeaderInfo (only tests parse logic; file reads fail in unit tests)
// ---------------------------------------------------------------------------

describe('readPngHeaderInfo', () => {
  it('returns null for non-existent file', () => {
    const result = readPngHeaderInfo('/nonexistent/path/to/file.png')
    expect(result).toBeNull()
  })

  it('returns null for empty path', () => {
    const result = readPngHeaderInfo('')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// validateFrameFiles
// ---------------------------------------------------------------------------

describe('validateFrameFiles', () => {
  it('returns error for empty input', () => {
    const result = validateFrameFiles([])
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('No input files')
  })

  it('returns null dimensions for empty input', () => {
    const result = validateFrameFiles([])
    expect(result.commonWidth).toBeNull()
    expect(result.commonHeight).toBeNull()
  })

  it('reports errors for non-existent files', () => {
    const result = validateFrameFiles(['/nonexistent/file.png'])
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
