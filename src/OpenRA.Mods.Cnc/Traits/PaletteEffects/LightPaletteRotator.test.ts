/**
 * LightPaletteRotator.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import { LightPaletteRotator, LightPaletteRotatorInfo } from './LightPaletteRotator.js'

describe('LightPaletteRotator', () => {
  it('should initialize with default rotation indices', () => {
    const info = new LightPaletteRotatorInfo()
    expect(info.rotationIndices.length).toBe(18)
    expect(info.modifyIndex).toBe(103)
    expect(info.timeStep).toBe(0.5)
  })

  it('should accumulate time on tick', () => {
    const trait = new LightPaletteRotator(new LightPaletteRotatorInfo())
    trait.tick({} as any)
    expect(trait.currentTime).toBe(0.5)
    trait.tick({} as any)
    expect(trait.currentTime).toBe(1.0)
  })

  it('should cycle rotation index with accumulated time', () => {
    const info = new LightPaletteRotatorInfo({ timeStep: 1 })
    const trait = new LightPaletteRotator(info)
    expect(trait.currentRotationIndex).toBe(0)
    trait.tick({} as any)
    expect(trait.currentRotationIndex).toBe(1)
    // Tick rotationIndices.length times to complete one cycle
    for (let i = 0; i < info.rotationIndices.length - 1; i++) trait.tick({} as any)
    expect(trait.currentRotationIndex).toBe(0)
  })

  it('should not modify excluded palettes', () => {
    const excluded = new Set(['shroud'])
    const info = new LightPaletteRotatorInfo({ excludePalettes: excluded, timeStep: 3 })
    const trait = new LightPaletteRotator(info)
    for (let i = 0; i < 3; i++) trait.tick({} as any)

    const shroudPalette = new Uint32Array(256)
    shroudPalette[103] = 0xffffffff
    const palettes = new Map([['shroud', shroudPalette]])
    trait.adjustPalette(palettes)
    // Shroud should be unaffected (excluded)
    expect(shroudPalette[103]).toBe(0xffffffff)
  })

  it('should modify non-excluded palettes', () => {
    const info = new LightPaletteRotatorInfo({ timeStep: 1 })
    const trait = new LightPaletteRotator(info)
    trait.tick({} as any) // t=1, rotate=0

    const palette = new Uint32Array(256)
    palette[230] = 0x12345678 // source color at rotationIndex[0]
    palette[103] = 0 // target index
    const palettes = new Map([['effect', palette]])
    trait.adjustPalette(palettes)
    // Should copy palette[230] to palette[103]
    expect(palette[103]).toBe(0x12345678)
  })
})
