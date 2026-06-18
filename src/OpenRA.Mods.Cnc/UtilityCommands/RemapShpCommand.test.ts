/**
 * RemapShpCommand.test.ts -- RemapShpCommand migration unit tests
 *
 * Test focus: argument validation, colorDistance calculation,
 * computeRemap table construction, remapFrameData pixel remapping,
 * parseModPaletteArg parsing, computeRemapStats statistics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  RemapShpCommand,
  colorDistance,
  computeRemap,
  remapFrameData,
  parseModPaletteArg,
  computeRemapStats,
  SHP_FORMAT_SPEC,
} from './RemapShpCommand'

// ---------------------------------------------------------------------------
// RemapShpCommand
// ---------------------------------------------------------------------------

describe('RemapShpCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('has correct command name', () => {
    const cmd = new RemapShpCommand()
    expect(cmd.name).toBe('--remap')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects fewer than 5 args', () => {
      const cmd = new RemapShpCommand()
      expect(cmd.validateArguments(['--remap'])).toBe(false)
      expect(cmd.validateArguments(['--remap', 'a'])).toBe(false)
      expect(cmd.validateArguments(['--remap', 'a', 'b'])).toBe(false)
      expect(cmd.validateArguments(['--remap', 'a', 'b', 'c'])).toBe(false)
    })

    it('accepts 5 args', () => {
      const cmd = new RemapShpCommand()
      expect(cmd.validateArguments(['--remap', 'mod1:pal', 'mod2:pal', 'src.shp', 'dst.shp'])).toBe(true)
    })

    it('accepts more than 5 args', () => {
      const cmd = new RemapShpCommand()
      expect(cmd.validateArguments(['--remap', 'mod1:pal', 'mod2:pal', 'src.shp', 'dst.shp', 'extra'])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing', () => {
      const cmd = new RemapShpCommand()
      expect(() => {
        cmd.run(
          { modData: {} as any, mods: new Map() },
          ['--remap', 'cnc:temperat', 'ra:temperat', 'src.shp', 'dst.shp'],
        )
      }).not.toThrow()
    })

    it('logs remap plan with mod:palette parsing', () => {
      const cmd = new RemapShpCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--remap', 'cnc:temperat', 'ra:temperat', 'src.shp', 'dst.shp'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('RemapShpCommand')
      expect(allText).toContain('cnc')
      expect(allText).toContain('ra')
      expect(allText).toContain('temperat')
      expect(allText).toContain('src.shp')
      expect(allText).toContain('dst.shp')
      // Should NOT contain old TODO markers
      expect(allText).not.toContain('TODO-21.G.3')
    })

    it('logs remap table statistics', () => {
      const cmd = new RemapShpCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--remap', 'mod1:pal1', 'mod2:pal2', 'a.shp', 'b.shp'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('Remap table')
      expect(allText).toContain('entries')
    })

    it('handles malformed mod:palette arguments gracefully', () => {
      const cmd = new RemapShpCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--remap', 'badarg', 'alsobad', 'src.shp', 'dst.shp'],
      )
      // Should log error but not throw
      const errCalls = consoleErrorSpy.mock.calls.flat()
      const errText = errCalls.join(' ')
      expect(errText).toContain('mod:palette')
    })

    it('handles colon-only malformed args', () => {
      const cmd = new RemapShpCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--remap', ':palette', 'mod:', 'src.shp', 'dst.shp'],
      )
      const errCalls = consoleErrorSpy.mock.calls.flat()
      const errText = errCalls.join(' ')
      // ':palette' has colon at index 0 (invalid), 'mod:' has nothing after colon
      // Both fail parseModPaletteArg (colonIdx < 1 for the first, or empty palette for second)
      // Actually 'mod:' has colonIdx = 3 which is >= 1, so palette = '' which is valid
      // But ':palette' has colonIdx = 0 which is < 1
      expect(errText).toContain('mod:palette')
    })
  })
})

// ---------------------------------------------------------------------------
// parseModPaletteArg
// ---------------------------------------------------------------------------

describe('parseModPaletteArg', () => {
  it('parses valid mod:palette string', () => {
    const result = parseModPaletteArg('cnc:temperat')
    expect(result).toEqual({ mod: 'cnc', palette: 'temperat' })
  })

  it('parses mod with hyphens', () => {
    const result = parseModPaletteArg('cnc-td:palette-name')
    expect(result).toEqual({ mod: 'cnc-td', palette: 'palette-name' })
  })

  it('returns null for no colon', () => {
    expect(parseModPaletteArg('noColon')).toBeNull()
  })

  it('returns null for colon at start', () => {
    expect(parseModPaletteArg(':onlyPalette')).toBeNull()
  })

  it('returns valid result for colon at end (empty palette)', () => {
    const result = parseModPaletteArg('mod:')
    expect(result).toEqual({ mod: 'mod', palette: '' })
  })

  it('returns null for empty string', () => {
    expect(parseModPaletteArg('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// colorDistance
// ---------------------------------------------------------------------------

describe('colorDistance', () => {
  it('returns 0 for identical colors', () => {
    const red = 0xff_ff_00_00
    expect(colorDistance(red, red)).toBe(0)
  })

  it('computes Manhattan distance correctly', () => {
    const white = 0xff_ff_ff_ff
    const black = 0xff_00_00_00
    expect(colorDistance(white, black)).toBe(255 + 255 + 255)
  })

  it('handles alpha differences (ignored in distance)', () => {
    const opaque = 0xff_ff_00_00
    const transparent = 0x00_ff_00_00
    expect(colorDistance(opaque, transparent)).toBe(0)
  })

  it('computes distance between close colors', () => {
    const c1 = 0xff_ff_00_00 // red
    const c2 = 0xff_ff_00_01 // red + 1 blue
    expect(colorDistance(c1, c2)).toBe(1)
  })

  it('is symmetric', () => {
    const a = 0xff_12_34_56
    const b = 0xff_78_90_ab
    expect(colorDistance(a, b)).toBe(colorDistance(b, a))
  })
})

// ---------------------------------------------------------------------------
// computeRemap
// ---------------------------------------------------------------------------

describe('computeRemap', () => {
  function makePalette(colors: number[]): Uint32Array {
    const arr = new Uint32Array(256)
    for (let i = 0; i < colors.length; i++) {
      arr[i] = colors[i]!
    }
    return arr
  }

  it('maps first 4 indices to themselves', () => {
    const srcRemap = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]
    const destRemap = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]
    const srcPalette = makePalette([])
    const destPalette = makePalette([])

    const remap = computeRemap(srcRemap, destRemap, srcPalette, destPalette)

    expect(remap.get(0)).toBe(0)
    expect(remap.get(1)).toBe(1)
    expect(remap.get(2)).toBe(2)
    expect(remap.get(3)).toBe(3)

    expect(remap.get(16)).toBe(32)
    expect(remap.get(31)).toBe(47)
  })

  it('maps player color remap indices correctly', () => {
    const srcRemap = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    const destRemap = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    const srcPalette = makePalette([])
    const destPalette = makePalette([])

    const remap = computeRemap(srcRemap, destRemap, srcPalette, destPalette)

    expect(remap.get(15)).toBe(0)
    expect(remap.get(4)).toBe(11)
  })

  it('has exactly paletteSize entries', () => {
    const srcRemap = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]
    const destRemap = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]
    const srcPalette = makePalette([])
    const destPalette = makePalette([])

    const remap = computeRemap(srcRemap, destRemap, srcPalette, destPalette)
    expect(remap.size).toBe(256)
  })

  it('finds best color match for unmapped indices', () => {
    const srcRemap: number[] = []
    const destRemap: number[] = []
    const srcColors: number[] = []
    const destColors: number[] = []
    for (let i = 0; i < 256; i++) {
      srcColors.push(0xff_00_00_00 | (i << 8) | (i << 4) | i)
      destColors.push(0xff_00_00_00 | (i << 8) | (i << 4) | i)
    }
    const srcPalette = makePalette(srcColors)
    const destPalette = makePalette(destColors)

    const remap = computeRemap(srcRemap, destRemap, srcPalette, destPalette)

    expect(remap.size).toBe(256)
  })

  it('respects custom paletteSize', () => {
    const srcRemap = [5, 6, 7, 8]
    const destRemap = [9, 10, 11, 12]
    const srcPalette = new Uint32Array(16)
    const destPalette = new Uint32Array(16)

    const remap = computeRemap(srcRemap, destRemap, srcPalette, destPalette, 16)
    expect(remap.size).toBe(16)
  })

  it('handles empty remap indices', () => {
    const srcPalette = makePalette([])
    const destPalette = makePalette([])
    const remap = computeRemap([], [], srcPalette, destPalette)
    expect(remap.size).toBe(256)
    expect(remap.get(0)).toBe(0)
    expect(remap.get(3)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// remapFrameData
// ---------------------------------------------------------------------------

describe('remapFrameData', () => {
  it('returns a new array of the same length', () => {
    const pixels = new Uint8Array([0, 1, 2, 3, 4, 5])
    const remap = new Map<number, number>()
    const result = remapFrameData(pixels, remap)
    expect(result.length).toBe(pixels.length)
    expect(result).not.toBe(pixels) // new array
  })

  it('passes through unmapped indices unchanged', () => {
    const pixels = new Uint8Array([10, 20, 30, 40])
    const remap = new Map<number, number>()
    const result = remapFrameData(pixels, remap)
    expect(Array.from(result)).toEqual([10, 20, 30, 40])
  })

  it('remaps indices according to table', () => {
    const pixels = new Uint8Array([0, 1, 2, 3, 4])
    const remap = new Map<number, number>([
      [0, 10],
      [1, 11],
      [2, 12],
      [3, 13],
      [4, 14],
    ])
    const result = remapFrameData(pixels, remap)
    expect(Array.from(result)).toEqual([10, 11, 12, 13, 14])
  })

  it('handles partial remap (some indices mapped, some not)', () => {
    const pixels = new Uint8Array([0, 1, 2, 3])
    const remap = new Map<number, number>([
      [0, 100],
      [2, 200],
    ])
    const result = remapFrameData(pixels, remap)
    expect(Array.from(result)).toEqual([100, 1, 200, 3])
  })

  it('handles empty input', () => {
    const pixels = new Uint8Array(0)
    const remap = new Map<number, number>()
    const result = remapFrameData(pixels, remap)
    expect(result.length).toBe(0)
  })

  it('handles full 256-color remap', () => {
    const pixels = new Uint8Array(256)
    const remap = new Map<number, number>()
    for (let i = 0; i < 256; i++) {
      pixels[i] = i
      remap.set(i, 255 - i) // reverse mapping
    }
    const result = remapFrameData(pixels, remap)
    for (let i = 0; i < 256; i++) {
      expect(result[i]).toBe(255 - i)
    }
  })

  it('preserves original array (immutable input)', () => {
    const pixels = new Uint8Array([5, 10, 15])
    const original = new Uint8Array([5, 10, 15])
    const remap = new Map<number, number>([[5, 50]])
    remapFrameData(pixels, remap)
    expect(Array.from(pixels)).toEqual(Array.from(original))
  })
})

// ---------------------------------------------------------------------------
// computeRemapStats
// ---------------------------------------------------------------------------

describe('computeRemapStats', () => {
  it('counts all-identity remap correctly', () => {
    const remap = new Map<number, number>()
    for (let i = 0; i < 256; i++) {
      remap.set(i, i)
    }
    const stats = computeRemapStats(remap)
    expect(stats.totalMappings).toBe(256)
    expect(stats.identityCount).toBe(256)
    expect(stats.changedCount).toBe(0)
  })

  it('counts all-changed remap correctly', () => {
    const remap = new Map<number, number>()
    for (let i = 0; i < 256; i++) {
      remap.set(i, (i + 1) % 256)
    }
    const stats = computeRemapStats(remap)
    expect(stats.totalMappings).toBe(256)
    expect(stats.changedCount).toBe(256)
    expect(stats.identityCount).toBe(0)
  })

  it('counts mixed remap', () => {
    const remap = new Map<number, number>([
      [0, 0],
      [1, 1],
      [2, 200],
      [3, 3],
      [4, 400],
    ])
    const stats = computeRemapStats(remap)
    expect(stats.totalMappings).toBe(5)
    expect(stats.identityCount).toBe(3) // 0,1,3
    expect(stats.changedCount).toBe(2) // 2,4
  })

  it('handles empty remap', () => {
    const stats = computeRemapStats(new Map())
    expect(stats.totalMappings).toBe(0)
    expect(stats.identityCount).toBe(0)
    expect(stats.changedCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SHP_FORMAT_SPEC
// ---------------------------------------------------------------------------

describe('SHP_FORMAT_SPEC', () => {
  it('defines required constants', () => {
    expect(SHP_FORMAT_SPEC.headerSize).toBe(14)
    expect(SHP_FORMAT_SPEC.frameHeaderSize).toBe(8)
    expect(SHP_FORMAT_SPEC.formatLCW).toBe(0x80)
    expect(SHP_FORMAT_SPEC.formatXORPrev).toBe(0x20)
    expect(SHP_FORMAT_SPEC.formatXORLCW).toBe(0x40)
    expect(SHP_FORMAT_SPEC.extraHeaders).toBe(2)
  })
})
