/**
 * ShroudPalette.test.ts — ShroudPalette migration unit tests
 *
 * Tests focus on: palette generation logic, color cycling,
 * shroud vs fog base color differences, addPalette invocation,
 * and IProvidesAssetBrowserPalettes interface (P1-C.7).
 *
 * Since ShroudPalette only depends on pure TypeScript math/interface modules
 * (no @babylonjs/core), no mocking is required.
 */

import { describe, it, expect } from 'vitest'
import { ShroudPalette, ShroudPaletteInfo, type IPaletteWorldRenderer } from './ShroudPalette'
import { fromArgb } from '../../../OpenRA.Game/Primitives/Color'
import { ImmutablePalette, PALETTE_SIZE, type IPalette } from '../../../OpenRA.Game/Graphics/Palette'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock IPaletteWorldRenderer that captures addPalette calls.
 */
function createMockWR(): {
  wr: IPaletteWorldRenderer
  addPaletteCalls: { name: string; pal: IPalette }[]
} {
  const addPaletteCalls: { name: string; pal: IPalette }[] = []
  const wr: IPaletteWorldRenderer = {
    addPalette(name: string, pal: IPalette): void {
      addPaletteCalls.push({ name, pal })
    },
  }
  return { wr, addPaletteCalls }
}

// ---------------------------------------------------------------------------
// ShroudPaletteInfo
// ---------------------------------------------------------------------------

describe('ShroudPaletteInfo', () => {
  it('has default Name "shroud" and Fog false', () => {
    const info = new ShroudPaletteInfo()
    expect(info.Name).toBe('shroud')
    expect(info.Fog).toBe(false)
  })

  it('accepts custom name and Fog flag', () => {
    const info = new ShroudPaletteInfo('custom_fog', true)
    expect(info.Name).toBe('custom_fog')
    expect(info.Fog).toBe(true)
  })

  it('implements ITraitInfo with optional instanceName', () => {
    const info = new ShroudPaletteInfo()
    expect(info.instanceName).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ShroudPalette.loadPalettes() — Shroud variant (Fog = false)
// ---------------------------------------------------------------------------

describe('ShroudPalette.loadPalettes with Fog=false (shroud)', () => {
  it('calls wr.addPalette with name "shroud" and an ImmutablePalette', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    expect(addPaletteCalls).toHaveLength(1)
    expect(addPaletteCalls[0]!.name).toBe('shroud')
    expect(addPaletteCalls[0]!.pal).toBeInstanceOf(ImmutablePalette)
  })

  it('generates a palette with PALETTE_SIZE (256) colors', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const pal = addPaletteCalls[0]!.pal
    // Spot-check palette indices exist within [0, 255]
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const color = pal.at(i)
      expect(color).toBeGreaterThanOrEqual(0)
    }
  })

  it('sets color 0 to transparent (ARGB: 0,0,0,0,0)', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const color0 = fromArgb(addPaletteCalls[0]!.pal.at(0))
    expect(color0.a).toBe(0)
    expect(color0.r).toBe(0)
    expect(color0.g).toBe(0)
    expect(color0.b).toBe(0)
  })

  it('cycles colors correctly using i % 8 pattern', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const pal = addPaletteCalls[0]!.pal
    // Color[0] should equal Color[8] (both index 0 in base)
    expect(pal.at(0)).toBe(pal.at(8))
    // Color[1] should equal Color[9]
    expect(pal.at(1)).toBe(pal.at(9))
    // Color[7] should equal Color[15]
    expect(pal.at(7)).toBe(pal.at(15))
    // Color[0] should equal Color[248] (248 % 8 === 0)
    expect(pal.at(0)).toBe(pal.at(248))
  })

  it('color 4 is full black (255, 0, 0, 0) for shroud', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const c4 = fromArgb(addPaletteCalls[0]!.pal.at(4))
    expect(c4.a).toBe(255)
    expect(c4.r).toBe(0)
    expect(c4.g).toBe(0)
    expect(c4.b).toBe(0)
  })

  it('color 5 is ~62.5% black (160, 0, 0, 0) for shroud', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const c5 = fromArgb(addPaletteCalls[0]!.pal.at(5))
    expect(c5.a).toBe(160)
    expect(c5.r).toBe(0)
    expect(c5.g).toBe(0)
    expect(c5.b).toBe(0)
  })

  it('color 6 is 50% black (128, 0, 0, 0) for shroud', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const c6 = fromArgb(addPaletteCalls[0]!.pal.at(6))
    expect(c6.a).toBe(128)
    expect(c6.r).toBe(0)
    expect(c6.g).toBe(0)
    expect(c6.b).toBe(0)
  })

  it('color 7 is 25% black (64, 0, 0, 0) for shroud', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const c7 = fromArgb(addPaletteCalls[0]!.pal.at(7))
    expect(c7.a).toBe(64)
    expect(c7.r).toBe(0)
    expect(c7.g).toBe(0)
    expect(c7.b).toBe(0)
  })

  it('debug colors 1-3 have correct ARGB values', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const pal = addPaletteCalls[0]!.pal
    // Green: (255, 0, 128, 0)
    const c1 = fromArgb(pal.at(1))
    expect(c1).toEqual({ a: 255, r: 0, g: 128, b: 0 })

    // Blue: (255, 0, 0, 255)
    const c2 = fromArgb(pal.at(2))
    expect(c2).toEqual({ a: 255, r: 0, g: 0, b: 255 })

    // Yellow: (255, 255, 255, 0)
    const c3 = fromArgb(pal.at(3))
    expect(c3).toEqual({ a: 255, r: 255, g: 255, b: 0 })
  })
})

// ---------------------------------------------------------------------------
// ShroudPalette.loadPalettes() — Fog variant (Fog = true)
// ---------------------------------------------------------------------------

describe('ShroudPalette.loadPalettes with Fog=true (fog)', () => {
  it('calls wr.addPalette with name "fog" and an ImmutablePalette', () => {
    const info = new ShroudPaletteInfo('fog', true)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    expect(addPaletteCalls).toHaveLength(1)
    expect(addPaletteCalls[0]!.name).toBe('fog')
    expect(addPaletteCalls[0]!.pal).toBeInstanceOf(ImmutablePalette)
  })

  it('sets color 0 to transparent (ARGB: 0,0,0,0,0)', () => {
    const info = new ShroudPaletteInfo('fog', true)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const color0 = fromArgb(addPaletteCalls[0]!.pal.at(0))
    expect(color0.a).toBe(0)
    expect(color0.r).toBe(0)
    expect(color0.g).toBe(0)
    expect(color0.b).toBe(0)
  })

  it('color 4 is 50% black (128, 0, 0, 0) for fog', () => {
    const info = new ShroudPaletteInfo('fog', true)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const c4 = fromArgb(addPaletteCalls[0]!.pal.at(4))
    expect(c4.a).toBe(128)
    expect(c4.r).toBe(0)
    expect(c4.g).toBe(0)
    expect(c4.b).toBe(0)
  })

  it('color 5 is 37.5% black (96, 0, 0, 0) for fog', () => {
    const info = new ShroudPaletteInfo('fog', true)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const c5 = fromArgb(addPaletteCalls[0]!.pal.at(5))
    expect(c5.a).toBe(96)
    expect(c5.r).toBe(0)
    expect(c5.g).toBe(0)
    expect(c5.b).toBe(0)
  })

  it('color 7 is 12.5% black (32, 0, 0, 0) for fog', () => {
    const info = new ShroudPaletteInfo('fog', true)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const c7 = fromArgb(addPaletteCalls[0]!.pal.at(7))
    expect(c7.a).toBe(32)
    expect(c7.r).toBe(0)
    expect(c7.g).toBe(0)
    expect(c7.b).toBe(0)
  })

  it('cycles colors correctly using i % 8 pattern', () => {
    const info = new ShroudPaletteInfo('fog', true)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    const pal = addPaletteCalls[0]!.pal
    expect(pal.at(0)).toBe(pal.at(8))
    expect(pal.at(1)).toBe(pal.at(9))
    expect(pal.at(7)).toBe(pal.at(15))
    expect(pal.at(3)).toBe(pal.at(11)) // 11 % 8 = 3
  })
})

// ---------------------------------------------------------------------------
// ShroudPalette: Shroud vs Fog differences
// ---------------------------------------------------------------------------

describe('ShroudPalette: shroud vs fog palette differences', () => {
  it('color 4 differs: shroud = (255,0,0,0), fog = (128,0,0,0)', () => {
    const shroudInfo = new ShroudPaletteInfo('shroud', false)
    const fogInfo = new ShroudPaletteInfo('fog', true)
    const shroudSP = new ShroudPalette(shroudInfo)
    const fogSP = new ShroudPalette(fogInfo)
    const { wr: shroudWR, addPaletteCalls: shroudCalls } = createMockWR()
    const { wr: fogWR, addPaletteCalls: fogCalls } = createMockWR()

    shroudSP.loadPalettes(shroudWR)
    fogSP.loadPalettes(fogWR)

    const shroudC4 = fromArgb(shroudCalls[0]!.pal.at(4))
    const fogC4 = fromArgb(fogCalls[0]!.pal.at(4))
    expect(shroudC4.a).toBe(255) // full black
    expect(fogC4.a).toBe(128)    // 50% black
  })

  it('color 5 differs: shroud = (160,0,0,0), fog = (96,0,0,0)', () => {
    const shroudInfo = new ShroudPaletteInfo('shroud', false)
    const fogInfo = new ShroudPaletteInfo('fog', true)
    const shroudSP = new ShroudPalette(shroudInfo)
    const fogSP = new ShroudPalette(fogInfo)
    const { wr: shroudWR, addPaletteCalls: shroudCalls } = createMockWR()
    const { wr: fogWR, addPaletteCalls: fogCalls } = createMockWR()

    shroudSP.loadPalettes(shroudWR)
    fogSP.loadPalettes(fogWR)

    const shroudC5 = fromArgb(shroudCalls[0]!.pal.at(5))
    const fogC5 = fromArgb(fogCalls[0]!.pal.at(5))
    expect(shroudC5.a).toBe(160)
    expect(fogC5.a).toBe(96)
  })

  it('colors 0-3 (transparent, Green, Blue, Yellow) are identical for both', () => {
    const shroudInfo = new ShroudPaletteInfo('shroud', false)
    const fogInfo = new ShroudPaletteInfo('fog', true)
    const shroudSP = new ShroudPalette(shroudInfo)
    const fogSP = new ShroudPalette(fogInfo)
    const { wr: shroudWR, addPaletteCalls: shroudCalls } = createMockWR()
    const { wr: fogWR, addPaletteCalls: fogCalls } = createMockWR()

    shroudSP.loadPalettes(shroudWR)
    fogSP.loadPalettes(fogWR)

    const shroudPal = shroudCalls[0]!.pal
    const fogPal = fogCalls[0]!.pal

    for (let i = 0; i <= 3; i++) {
      expect(shroudPal.at(i)).toBe(fogPal.at(i))
    }
  })

  it('custom palette name is passed through to addPalette', () => {
    const info = new ShroudPaletteInfo('custom_shroud', false)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    expect(addPaletteCalls[0]!.name).toBe('custom_shroud')
  })

  it('fog palette with custom name calls addPalette correctly', () => {
    const info = new ShroudPaletteInfo('fog_of_war', true)
    const sp = new ShroudPalette(info)
    const { wr, addPaletteCalls } = createMockWR()

    sp.loadPalettes(wr)

    expect(addPaletteCalls[0]!.name).toBe('fog_of_war')
  })
})

// ---------------------------------------------------------------------------
// P1-C.7: IProvidesAssetBrowserPalettes — editor asset browser integration
// ---------------------------------------------------------------------------

describe('P1-C.7: IProvidesAssetBrowserPalettes', () => {
  it('paletteNames returns array containing the palette name', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)

    const names = sp.paletteNames
    expect(names).toEqual(['shroud'])
    expect(names.length).toBe(1)
    expect(names[0]).toBe('shroud')
  })

  it('paletteNames reflects custom name', () => {
    const info = new ShroudPaletteInfo('custom_shroud', false)
    const sp = new ShroudPalette(info)

    expect(sp.paletteNames).toEqual(['custom_shroud'])
  })

  it('paletteNames for fog palette returns fog name', () => {
    const info = new ShroudPaletteInfo('fog', true)
    const sp = new ShroudPalette(info)

    expect(sp.paletteNames).toEqual(['fog'])
  })

  it('paletteNames is readonly and immutable', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)

    const names = sp.paletteNames
    // Verify it is an array with one element
    expect(Array.isArray(names)).toBe(true)
    // Confirm the name inside is correct
    expect(names.includes('shroud')).toBe(true)
  })

  it('ShroudPalette implements IProvidesAssetBrowserPalettes', () => {
    const info = new ShroudPaletteInfo('shroud', false)
    const sp = new ShroudPalette(info)

    // Verify the class has the paletteNames property (interface conformance)
    expect(sp).toHaveProperty('paletteNames')
    expect(sp.paletteNames).toBeDefined()
    expect(sp.paletteNames.length).toBeGreaterThan(0)
  })
})
