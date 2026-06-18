/**
 * Rgba2Hex.test.ts — Rgba2Hex / Argb2Hex 迁移单元测试
 *
 * 测试焦点: 参数验证、RGBA→十六进制转换、ARGB→十六进制转换、parseByteComponents 工具函数
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Rgba2Hex,
  Argb2Hex,
  parseByteComponents,
  rgbToHex,
  argbToHex,
} from './Rgba2Hex'

// ---------------------------------------------------------------------------
// Spy on console.log
// ---------------------------------------------------------------------------

describe('Rgba2Hex', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('has correct command name', () => {
    const cmd = new Rgba2Hex()
    expect(cmd.name).toBe('--rgba2hex')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects no color args', () => {
      const cmd = new Rgba2Hex()
      expect(cmd.validateArguments(['--rgba2hex'])).toBe(false)
    })

    it('accepts single RGB triple', () => {
      const cmd = new Rgba2Hex()
      expect(cmd.validateArguments(['--rgba2hex', '255,0,0'])).toBe(true)
    })

    it('accepts single RGBA quad', () => {
      const cmd = new Rgba2Hex()
      expect(cmd.validateArguments(['--rgba2hex', '255,0,0,128'])).toBe(true)
    })

    it('accepts multiple colors', () => {
      const cmd = new Rgba2Hex()
      expect(cmd.validateArguments(['--rgba2hex', '255,0,0', '0,255,0,128'])).toBe(true)
    })

    it('rejects invalid component count', () => {
      const cmd = new Rgba2Hex()
      expect(cmd.validateArguments(['--rgba2hex', '255,0'])).toBe(false)
    })

    it('rejects non-numeric component', () => {
      const cmd = new Rgba2Hex()
      expect(cmd.validateArguments(['--rgba2hex', 'abc,0,0'])).toBe(false)
    })

    it('rejects out-of-range component', () => {
      const cmd = new Rgba2Hex()
      expect(cmd.validateArguments(['--rgba2hex', '256,0,0'])).toBe(false)
    })

    it('rejects negative component', () => {
      const cmd = new Rgba2Hex()
      expect(cmd.validateArguments(['--rgba2hex', '-1,0,0'])).toBe(false)
    })

    it('prints usage on failure', () => {
      const cmd = new Rgba2Hex()
      cmd.validateArguments(['--rgba2hex'])
      expect(consoleLogSpy).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('converts single RGB to hex', () => {
      const cmd = new Rgba2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--rgba2hex', '255,0,0'])
      expect(consoleLogSpy).toHaveBeenCalledWith('FF0000')
    })

    it('converts single RGBA to hex', () => {
      const cmd = new Rgba2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--rgba2hex', '255,0,0,128'])
      expect(consoleLogSpy).toHaveBeenCalledWith('FF000080')
    })

    it('skips alpha when a=255', () => {
      const cmd = new Rgba2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--rgba2hex', '255,0,0,255'])
      expect(consoleLogSpy).toHaveBeenCalledWith('FF0000')
    })

    it('converts multiple colors with comma separator', () => {
      const cmd = new Rgba2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--rgba2hex', '255,0,0', '0,255,0'])
      expect(consoleLogSpy).toHaveBeenCalledWith('FF0000, 00FF00')
    })

    it('converts mixed RGB and RGBA', () => {
      const cmd = new Rgba2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--rgba2hex', '255,255,0', '0,255,0,128'])
      expect(consoleLogSpy).toHaveBeenCalledWith('FFFF00, 00FF0080')
    })

    it('ignores extra commas (empty entries)', () => {
      const cmd = new Rgba2Hex()
      // Split with extra commas between components
      cmd.run({ modData: {} as any, mods: new Map() }, ['--rgba2hex', '255,,0,,,0'])
      // The empty parts are filtered out, so '255,,0,,,0' → ['255','0','0'] → 3 parts
      expect(consoleLogSpy).toHaveBeenCalledWith('FF0000')
    })
  })
})

// ---------------------------------------------------------------------------
// Argb2Hex
// ---------------------------------------------------------------------------

describe('Argb2Hex', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('has correct command name', () => {
    const cmd = new Argb2Hex()
    expect(cmd.name).toBe('--argb2hex')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects no color args', () => {
      const cmd = new Argb2Hex()
      expect(cmd.validateArguments(['--argb2hex'])).toBe(false)
    })

    it('accepts 3-component input (RGB only, no alpha)', () => {
      const cmd = new Argb2Hex()
      expect(cmd.validateArguments(['--argb2hex', '255,0,0'])).toBe(true)
    })

    it('accepts 4-component input (ARGB)', () => {
      const cmd = new Argb2Hex()
      expect(cmd.validateArguments(['--argb2hex', '128,255,0,0'])).toBe(true)
    })

    it('rejects invalid component count', () => {
      const cmd = new Argb2Hex()
      expect(cmd.validateArguments(['--argb2hex', '255,0'])).toBe(false)
    })

    it('rejects non-numeric component', () => {
      const cmd = new Argb2Hex()
      expect(cmd.validateArguments(['--argb2hex', 'abc,0,0'])).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('converts 3-component to hex (as RGB)', () => {
      const cmd = new Argb2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--argb2hex', '255,0,0'])
      expect(consoleLogSpy).toHaveBeenCalledWith('FF0000')
    })

    it('converts ARGB with alpha < 255', () => {
      const cmd = new Argb2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--argb2hex', '128,255,0,0'])
      expect(consoleLogSpy).toHaveBeenCalledWith('FF000080')
    })

    it('skips alpha when a=255', () => {
      const cmd = new Argb2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--argb2hex', '255,0,255,0'])
      expect(consoleLogSpy).toHaveBeenCalledWith('00FF00')
    })

    it('converts multiple ARGB colors', () => {
      const cmd = new Argb2Hex()
      cmd.run({ modData: {} as any, mods: new Map() }, ['--argb2hex', '128,255,0,0', '255,0,0,255'])
      expect(consoleLogSpy).toHaveBeenCalledWith('FF000080, 0000FF')
    })
  })
})

// ---------------------------------------------------------------------------
// parseByteComponents
// ---------------------------------------------------------------------------

describe('parseByteComponents', () => {
  it('parses comma-separated values', () => {
    const result = parseByteComponents('255,128,64')
    expect(result).toEqual([255, 128, 64])
  })

  it('returns null for non-numeric values', () => {
    expect(parseByteComponents('abc,def')).toBeNull()
  })

  it('returns null for out-of-range values', () => {
    expect(parseByteComponents('256,0,0')).toBeNull()
  })

  it('returns null for negative values', () => {
    expect(parseByteComponents('-1,0,0')).toBeNull()
  })

  it('trims whitespace from components', () => {
    const result = parseByteComponents(' 255 , 0 , 0 ')
    expect(result).toEqual([255, 0, 0])
  })

  it('filters empty parts (extra commas)', () => {
    const result = parseByteComponents('255,,0,,,0')
    expect(result).toEqual([255, 0, 0])
  })
})

// ---------------------------------------------------------------------------
// rgbToHex
// ---------------------------------------------------------------------------

describe('rgbToHex', () => {
  it('converts RGB to uppercase hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('FF0000')
    expect(rgbToHex(0, 255, 0)).toBe('00FF00')
    expect(rgbToHex(0, 0, 255)).toBe('0000FF')
    expect(rgbToHex(0, 0, 0)).toBe('000000')
    expect(rgbToHex(255, 255, 255)).toBe('FFFFFF')
  })

  it('zero-pads single-digit hex values', () => {
    expect(rgbToHex(15, 15, 15)).toBe('0F0F0F')
    expect(rgbToHex(0, 0, 1)).toBe('000001')
  })

  it('appends alpha when < 255', () => {
    expect(rgbToHex(255, 0, 0, 128)).toBe('FF000080')
    expect(rgbToHex(255, 0, 0, 0)).toBe('FF000000')
  })

  it('omits alpha when 255', () => {
    expect(rgbToHex(255, 0, 0, 255)).toBe('FF0000')
  })

  it('omits alpha when undefined', () => {
    expect(rgbToHex(255, 0, 0)).toBe('FF0000')
  })
})

// ---------------------------------------------------------------------------
// argbToHex
// ---------------------------------------------------------------------------

describe('argbToHex', () => {
  it('converts ARGB to uppercase hex with explicit alpha', () => {
    // Output is RGB followed by optional alpha
    expect(argbToHex(128, 255, 0, 0)).toBe('FF000080')
  })

  it('omits alpha when 255', () => {
    expect(argbToHex(255, 0, 255, 0)).toBe('00FF00')
  })

  it('includes alpha when 0', () => {
    expect(argbToHex(0, 255, 0, 0)).toBe('FF000000')
  })
})
