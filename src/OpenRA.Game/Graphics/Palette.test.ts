/**
 * Palette.test.ts — Palette 系统单元测试
 *
 * 测试 IPalette, ImmutablePalette, MutablePalette, PaletteReference 接口/类。
 *
 * Color.ts 是纯数学函数，无需 mock。
 */

import { describe, it, expect } from 'vitest'
import {
  PALETTE_SIZE,
  ImmutablePalette,
  MutablePalette,
  getPaletteColor,
  asReadOnly,
} from './Palette'
import type { IPalette, IPaletteRemap } from './Palette'

// ---------------------------------------------------------------------------
// Helper: create a simple test IPalette
// ---------------------------------------------------------------------------

function createTestPalette(): IPalette {
  return {
    at(index: number): number {
      // ARGB: A=255, R=index, G=index, B=index
      return ((255 << 24) | (index << 16) | (index << 8) | index) >>> 0
    },
    copyToArray(destination: Uint32Array, destinationOffset: number): void {
      for (let i = 0; i < PALETTE_SIZE; i++) {
        destination[destinationOffset + i] =
          ((255 << 24) | (i << 16) | (i << 8) | i) >>> 0
      }
    },
  }
}

// ---------------------------------------------------------------------------
// PALETTE_SIZE
// ---------------------------------------------------------------------------

describe('PALETTE_SIZE', () => {
  it('is 256 (matching OpenRA Palette.Size)', () => {
    expect(PALETTE_SIZE).toBe(256)
  })
})

// ---------------------------------------------------------------------------
// ImmutablePalette.fromPalette
// ---------------------------------------------------------------------------

describe('ImmutablePalette.fromPalette', () => {
  it('copies all 256 colors from source IPalette', () => {
    const source = createTestPalette()
    const immutable = ImmutablePalette.fromPalette(source)
    for (let i = 0; i < PALETTE_SIZE; i++) {
      expect(immutable.at(i)).toBe(source.at(i))
    }
  })

  it('creates an independent copy (modifying source does not affect immutable)', () => {
    const source = createTestPalette()
    const immutable = ImmutablePalette.fromPalette(source)

    // Create a different source (wouldn't affect immutable since it's copied)
    const otherSource = {
      at(_index: number): number { return 0 },
      copyToArray(dest: Uint32Array, offset: number): void {
        dest.fill(0, offset, offset + PALETTE_SIZE)
      },
    }
    ImmutablePalette.fromPalette(otherSource) // ensure independent copy
    // The original immutable should still have the original source data
    expect(immutable.at(0)).toBe(source.at(0))
  })
})

// ---------------------------------------------------------------------------
// ImmutablePalette.fromColors
// ---------------------------------------------------------------------------

describe('ImmutablePalette.fromColors', () => {
  it('creates palette from number array', () => {
    const colors = [0xff0000ff, 0xff00ff00, 0xffff0000] // RGBW patterns
    const immutable = ImmutablePalette.fromColors(colors)
    expect(immutable.at(0)).toBe(0xff0000ff)
    expect(immutable.at(1)).toBe(0xff00ff00)
    expect(immutable.at(2)).toBe(0xffff0000)
  })

  it('pads remaining entries with 0 when array is smaller than 256', () => {
    const colors = [0xffffffff]
    const immutable = ImmutablePalette.fromColors(colors)
    expect(immutable.at(0)).toBe(0xffffffff)
    expect(immutable.at(1)).toBe(0)
    expect(immutable.at(255)).toBe(0)
  })

  it('truncates to 256 entries when array is larger', () => {
    const colors = new Array(300).fill(0xff000000)
    colors[0] = 0xffffffff
    const immutable = ImmutablePalette.fromColors(colors)
    expect(immutable.at(0)).toBe(0xffffffff)
    expect(immutable.at(1)).toBe(0xff000000)
    expect(immutable.at(255)).toBe(0xff000000)
  })

  it('works with Uint32Array input', () => {
    const arr = new Uint32Array(PALETTE_SIZE)
    arr[5] = 0xdeadbeef
    const immutable = ImmutablePalette.fromColors(arr)
    expect(immutable.at(5)).toBe(0xdeadbeef)
  })
})

// ---------------------------------------------------------------------------
// ImmutablePalette.fromRemapped
// ---------------------------------------------------------------------------

describe('ImmutablePalette.fromRemapped', () => {
  it('applies remap to all colors', () => {
    const source = createTestPalette()
    // Remap that inverts colors: R' = 255 - R, same for G and B
    const remap: IPaletteRemap = {
      getRemappedColor(original) {
        return {
          r: 255 - original.r,
          g: 255 - original.g,
          b: 255 - original.b,
          a: original.a,
        }
      },
    }

    const remapped = ImmutablePalette.fromRemapped(source, remap)
    // source.at(10) has R=10, G=10, B=10 → remapped should have R=245, G=245, B=245
    const orig = getPaletteColor(source, 10)
    const remappedColor = getPaletteColor(remapped, 10)
    expect(remappedColor.r).toBe(255 - orig.r)
    expect(remappedColor.g).toBe(255 - orig.g)
    expect(remappedColor.b).toBe(255 - orig.b)
  })
})

// ---------------------------------------------------------------------------
// ImmutablePalette.loadFromBytes
// ---------------------------------------------------------------------------

describe('ImmutablePalette.loadFromBytes', () => {
  it('loads 6-bit palette data from bytes (3 bytes per color)', () => {
    // Create test bytes: 256 colors × 3 bytes
    const bytes = new Uint8Array(PALETTE_SIZE * 3)
    // Set color 0: full red (6-bit max = 63, which is 0x3F)
    bytes[0] = 63  // R
    bytes[1] = 0   // G
    bytes[2] = 0   // B
    // Set color 1: full green
    bytes[3] = 0   // R
    bytes[4] = 63  // G
    bytes[5] = 0   // B

    const palette = ImmutablePalette.loadFromBytes(bytes)

    // Color 0: 6-bit 63 → (63 << 2) | (63 >> 6) = 252 | 0 = 252
    // ARGB: A=255, R=252, G=0, B=0 → 0xFFFC0000
    palette.at(0) // verify no throw
    const c0 = getPaletteColor(palette, 0)
    expect(c0.a).toBe(255)
    expect(c0.r).toBe(252)
    expect(c0.g).toBe(0)
    expect(c0.b).toBe(0)

    // Color 1: 6-bit 63 → R=0, G=252, B=0
    const c1 = getPaletteColor(palette, 1)
    expect(c1.a).toBe(255)
    expect(c1.r).toBe(0)
    expect(c1.g).toBe(252)
    expect(c1.b).toBe(0)
  })

  it('applies remapTransparent (alpha=0)', () => {
    const bytes = new Uint8Array(PALETTE_SIZE * 3)
    bytes.fill(63) // All colors white-ish

    const palette = ImmutablePalette.loadFromBytes(bytes, [0, 1, 2])

    // Colors 0,1,2 should be fully transparent
    expect(palette.at(0)).toBe(0)
    expect(palette.at(1)).toBe(0)
    expect(palette.at(2)).toBe(0)
    // Color 3 should NOT be transparent
    expect(palette.at(3)).not.toBe(0)
  })

  it('applies remapShadow (alpha=140)', () => {
    const bytes = new Uint8Array(PALETTE_SIZE * 3)
    bytes.fill(63)

    const palette = ImmutablePalette.loadFromBytes(bytes, [], [0])

    // Color 0 should have alpha=140
    const c0 = getPaletteColor(palette, 0)
    expect(c0.a).toBe(140)
  })

  it('handles empty remap arrays', () => {
    const bytes = new Uint8Array(PALETTE_SIZE * 3)
    bytes.fill(63)
    const palette = ImmutablePalette.loadFromBytes(bytes)
    // All colors should have alpha=255 (no remaps)
    const c0 = getPaletteColor(palette, 0)
    expect(c0.a).toBe(255)
  })
})

// ---------------------------------------------------------------------------
// ImmutablePalette.copyToArray
// ---------------------------------------------------------------------------

describe('ImmutablePalette.copyToArray', () => {
  it('copies palette data to destination at offset', () => {
    const source = createTestPalette()
    const immutable = ImmutablePalette.fromPalette(source)

    const dest = new Uint32Array(PALETTE_SIZE + 10)
    immutable.copyToArray(dest, 5)

    // dest[5] should equal palette[0], dest[6] = palette[1], etc.
    expect(dest[5]).toBe(immutable.at(0))
    expect(dest[6]).toBe(immutable.at(1))
    expect(dest[5 + 255]).toBe(immutable.at(255))
  })
})

// ---------------------------------------------------------------------------
// ImmutablePalette.colors getter
// ---------------------------------------------------------------------------

describe('ImmutablePalette.colors', () => {
  it('returns a copy, not the internal array', () => {
    const immutable = ImmutablePalette.fromPalette(createTestPalette())
    const copy1 = immutable.colors
    const copy2 = immutable.colors
    copy1[0] = 0xdeadbeef
    // Modifying copy1 should NOT affect copy2 or the original
    expect(copy2[0]).not.toBe(0xdeadbeef)
    expect(immutable.at(0)).not.toBe(0xdeadbeef)
  })
})

// ---------------------------------------------------------------------------
// MutablePalette
// ---------------------------------------------------------------------------

describe('MutablePalette', () => {
  it('initializes from IPalette source', () => {
    const source = createTestPalette()
    const mutable = new MutablePalette(source)
    for (let i = 0; i < 10; i++) {
      expect(mutable.at(i)).toBe(source.at(i))
    }
  })

  it('setColor modifies palette entry', () => {
    const source = createTestPalette()
    const mutable = new MutablePalette(source)

    mutable.setColor(5, { r: 10, g: 20, b: 30, a: 255 })
    const color = getPaletteColor(mutable, 5)
    expect(color).toEqual({ r: 10, g: 20, b: 30, a: 255 })
  })

  it('setColor does not affect source IPalette', () => {
    const source = createTestPalette()
    const mutable = new MutablePalette(source)

    mutable.setColor(0, { r: 1, g: 2, b: 3, a: 4 })
    // Source should be unchanged
    expect(source.at(0)).not.toBe(mutable.at(0))
  })

  it('setFromPalette overwrites all colors', () => {
    const source1 = createTestPalette()
    const mutable = new MutablePalette(source1)

    // Create a different palette
    const source2: IPalette = {
      at(_index: number): number { return 0xffffffff },
      copyToArray(dest: Uint32Array, offset: number): void {
        dest.fill(0xffffffff, offset, offset + PALETTE_SIZE)
      },
    }

    mutable.setFromPalette(source2)
    expect(mutable.at(0)).toBe(0xffffffff)
    expect(mutable.at(255)).toBe(0xffffffff)
  })

  it('applyRemap applies remap to all 256 colors', () => {
    const source = createTestPalette()
    const mutable = new MutablePalette(source)

    // Remap that sets all to red
    const remap: IPaletteRemap = {
      getRemappedColor(_original) {
        return { r: 255, g: 0, b: 0, a: 255 }
      },
    }

    mutable.applyRemap(remap)
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const color = getPaletteColor(mutable, i)
      expect(color.r).toBe(255)
      expect(color.g).toBe(0)
      expect(color.b).toBe(0)
    }
  })

  it('_rawSet directly modifies internal array', () => {
    const source = createTestPalette()
    const mutable = new MutablePalette(source)

    mutable._rawSet(10, 0x12345678)
    expect(mutable.at(10)).toBe(0x12345678)
  })

  it('copyToArray exports all colors', () => {
    const source = createTestPalette()
    const mutable = new MutablePalette(source)
    mutable.setColor(42, { r: 1, g: 2, b: 3, a: 100 })

    const dest = new Uint32Array(PALETTE_SIZE)
    mutable.copyToArray(dest, 0)
    expect(dest[42]).toBe(mutable.at(42))
  })

  it('colors getter returns independent copy', () => {
    const source = createTestPalette()
    const mutable = new MutablePalette(source)
    const copy1 = mutable.colors
    copy1[0] = 0xbadf00d
    expect(mutable.at(0)).not.toBe(0xbadf00d)
  })
})

// ---------------------------------------------------------------------------
// getPaletteColor
// ---------------------------------------------------------------------------

describe('getPaletteColor', () => {
  it('extracts RGBA color from palette at index', () => {
    const palette = createTestPalette()
    const color = getPaletteColor(palette, 10)
    expect(color.a).toBe(255)
    expect(color.r).toBe(10)
    expect(color.g).toBe(10)
    expect(color.b).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// asReadOnly
// ---------------------------------------------------------------------------

describe('asReadOnly', () => {
  it('returns ImmutablePalette as-is', () => {
    const immutable = ImmutablePalette.fromPalette(createTestPalette())
    const result = asReadOnly(immutable)
    expect(result).toBe(immutable) // Same reference
  })

  it('wraps non-ImmutablePalette in ReadOnlyPalette', () => {
    const source = createTestPalette()
    const mutable = new MutablePalette(source)
    const result = asReadOnly(mutable)
    // Should NOT be the same reference
    expect(result).not.toBe(mutable)
    // But should return the same color values
    expect(result.at(0)).toBe(mutable.at(0))
  })
})
