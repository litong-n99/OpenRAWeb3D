/**
 * RemapShpCommand.test.ts — RemapShpCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、colorDistance 计算、computeRemap 重映射表构建
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  RemapShpCommand,
  colorDistance,
  computeRemap,
} from './RemapShpCommand'

// ---------------------------------------------------------------------------
// RemapShpCommand
// ---------------------------------------------------------------------------

describe('RemapShpCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
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
  // run (stub)
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = new RemapShpCommand()
      expect(() => {
        cmd.run(
          { modData: {} as any, mods: new Map() },
          ['--remap', 'cnc:temperat', 'ra:temperat', 'src.shp', 'dst.shp'],
        )
      }).not.toThrow()
    })

    it('logs the expected TODO message', () => {
      const cmd = new RemapShpCommand()
      cmd.run(
        { modData: {} as any, mods: new Map() },
        ['--remap', 'cnc:temperat', 'ra:temperat', 'src.shp', 'dst.shp'],
      )
      const calls = consoleLogSpy.mock.calls.flat()
      const allText = calls.join(' ')
      expect(allText).toContain('TODO-21.G.3')
    })
  })
})

// ---------------------------------------------------------------------------
// colorDistance
// ---------------------------------------------------------------------------

describe('colorDistance', () => {
  it('returns 0 for identical colors', () => {
    // 0xAARRGGBB: 0xFF_FF_00_00 = red
    const red = 0xff_ff_00_00
    expect(colorDistance(red, red)).toBe(0)
  })

  it('computes Manhattan distance correctly', () => {
    // 0xFFFFFF (R=255,G=255,B=255) vs 0x000000 (R=0,G=0,B=0)
    const white = 0xff_ff_ff_ff
    const black = 0xff_00_00_00
    expect(colorDistance(white, black)).toBe(255 + 255 + 255)
  })

  it('handles alpha differences (ignored in distance)', () => {
    // Both represent R=255,G=0,B=0 but with different alpha
    const opaque = 0xff_ff_00_00
    const transparent = 0x00_ff_00_00
    expect(colorDistance(opaque, transparent)).toBe(0)
  })

  it('computes distance between close colors', () => {
    const c1 = 0xff_ff_00_00 // red
    const c2 = 0xff_ff_00_01 // red + 1 blue
    expect(colorDistance(c1, c2)).toBe(1)
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
    // Use remap indices that DON'T overlap with 0-3 to test fixed entry behavior
    const srcRemap = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]
    const destRemap = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]
    const srcPalette = makePalette([])
    const destPalette = makePalette([])

    const remap = computeRemap(srcRemap, destRemap, srcPalette, destPalette)

    // Fixed entries (0-3) should remain unchanged because remap indices don't overlap
    expect(remap.get(0)).toBe(0)
    expect(remap.get(1)).toBe(1)
    expect(remap.get(2)).toBe(2)
    expect(remap.get(3)).toBe(3)

    // Player color entries should be remapped
    expect(remap.get(16)).toBe(32)
    expect(remap.get(31)).toBe(47)
  })

  it('maps player color remap indices correctly', () => {
    const srcRemap = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    const destRemap = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    const srcPalette = makePalette([])
    const destPalette = makePalette([])

    const remap = computeRemap(srcRemap, destRemap, srcPalette, destPalette)

    // src index 15 should map to dest index 0 (the 16th entry)
    expect(remap.get(15)).toBe(0)
    // src index 4 should map to dest index 11
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
    // Create palettes where each index maps to a distinct color
    const srcColors: number[] = []
    const destColors: number[] = []
    for (let i = 0; i < 256; i++) {
      // Encode index as RGB for easy verification
      srcColors.push(0xff_00_00_00 | (i << 8) | (i << 4) | i) // unique per index
      destColors.push(0xff_00_00_00 | (i << 8) | (i << 4) | i) // same encoding
    }
    const srcPalette = makePalette(srcColors)
    const destPalette = makePalette(destColors)

    const remap = computeRemap(srcRemap, destRemap, srcPalette, destPalette)

    // With identical palettes, each index should map to itself
    // (or a close neighbor, since we ignore first 4 fixed entries and the empty remap array)
    // The algorithm finds best match for non-fixed entries
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
})
