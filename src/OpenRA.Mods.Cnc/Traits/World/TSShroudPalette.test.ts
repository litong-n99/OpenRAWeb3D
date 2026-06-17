/**
 * TSShroudPalette.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import { TSShroudPalette, TSShroudPaletteInfo } from './TSShroudPalette.js'

describe('TSShroudPalette', () => {
  it('should create with default name "shroud"', () => {
    const info = new TSShroudPaletteInfo()
    expect(info.name).toBe('shroud')
  })

  it('should generate 256-color palette data', () => {
    const info = new TSShroudPaletteInfo()
    const palette = new TSShroudPalette(info)
    const data = palette.getPaletteData()
    expect(data.length).toBe(256)
  })

  it('should produce fully opaque first entry (alpha=255)', () => {
    const palette = new TSShroudPalette(new TSShroudPaletteInfo())
    const data = palette.getPaletteData()
    // ARGB: alpha in high byte
    expect(data[0]).toBe(0xff000000)
  })

  it('should produce fully transparent entries >= 128', () => {
    const palette = new TSShroudPalette(new TSShroudPaletteInfo())
    const data = palette.getPaletteData()
    expect(data[128]).toBe(0)
    expect(data[255]).toBe(0)
  })

  it('should return palette name list', () => {
    const info = new TSShroudPaletteInfo({ name: 'myshroud' })
    const palette = new TSShroudPalette(info)
    expect(palette.paletteNames).toEqual(['myshroud'])
  })
})
