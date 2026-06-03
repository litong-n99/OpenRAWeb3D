/**
 * Sprite.test.ts — Sprite 迁移单元测试
 *
 * 测试: TextureChannel, Sprite construction (simple/full),
 * UV inset, zRamp/size, SpriteWithSecondaryData
 *
 * NOTE: Babylon.js mock is not needed because Sprite only references
 * Sheet (concrete class, no GPU dependency in construction).
 */

import { describe, it, expect } from 'vitest'
import { Sprite, SpriteWithSecondaryData, TextureChannel } from './Sprite'
import { Sheet, SheetType } from './Sheet'

// ---------------------------------------------------------------------------
// Helper: create a minimal Sheet for testing
// ---------------------------------------------------------------------------

function makeSheet(width: number, height: number, type: SheetType = SheetType.BGRA): Sheet {
  return new Sheet(type, { width, height })
}

// ---------------------------------------------------------------------------
// TextureChannel
// ---------------------------------------------------------------------------

describe('TextureChannel', () => {
  it('has correct values matching OpenRA', () => {
    expect(TextureChannel.Red).toBe(0)
    expect(TextureChannel.Green).toBe(1)
    expect(TextureChannel.Blue).toBe(2)
    expect(TextureChannel.Alpha).toBe(3)
    expect(TextureChannel.RGBA).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Sprite — simple constructor
// ---------------------------------------------------------------------------

describe('Sprite (simple constructor)', () => {
  it('constructs with sheet, bounds, channel', () => {
    const sheet = makeSheet(256, 256)
    const sprite = new Sprite(sheet, { x: 10, y: 20, width: 32, height: 32 }, TextureChannel.RGBA)

    expect(sprite.sheet).toBe(sheet)
    expect(sprite.bounds.x).toBe(10)
    expect(sprite.bounds.y).toBe(20)
    expect(sprite.bounds.width).toBe(32)
    expect(sprite.bounds.height).toBe(32)
    expect(sprite.channel).toBe(TextureChannel.RGBA)
  })

  it('defaults: zRamp=0, offset=(0,0,0), blendMode=Alpha', () => {
    const sheet = makeSheet(128, 128)
    const sprite = new Sprite(sheet, { x: 0, y: 0, width: 16, height: 16 }, TextureChannel.Red)

    expect(sprite.zRamp).toBe(0)
    expect(sprite.offset).toEqual({ x: 0, y: 0, z: 0 })
    expect(sprite.blendMode).toBe('Alpha')
  })

  it('size equals bounds * scale (zRamp=0 → size.z=0)', () => {
    const sheet = makeSheet(128, 128)
    const sprite = new Sprite(sheet, { x: 0, y: 0, width: 16, height: 16 }, TextureChannel.Alpha, 2)

    expect(sprite.size.x).toBe(32)
    expect(sprite.size.y).toBe(32)
    expect(sprite.size.z).toBe(0)
  })

  it('scale defaults to 1', () => {
    const sheet = makeSheet(64, 64)
    const sprite = new Sprite(sheet, { x: 0, y: 0, width: 10, height: 20 }, TextureChannel.Green)

    expect(sprite.size.x).toBe(10)
    expect(sprite.size.y).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Sprite — full constructor
// ---------------------------------------------------------------------------

describe('Sprite (full constructor)', () => {
  it('constructs with zRamp, offset, channel, blendMode, scale', () => {
    const sheet = makeSheet(256, 256)
    const sprite = new Sprite(
      sheet,
      { x: 10, y: 10, width: 32, height: 32 },
      0.5,                                  // zRamp
      { x: 1, y: 2, z: 3 },               // offset
      TextureChannel.Blue,
      'Additive',
      2,
    )

    expect(sprite.zRamp).toBe(0.5)
    expect(sprite.offset).toEqual({ x: 1, y: 2, z: 3 })
    expect(sprite.channel).toBe(TextureChannel.Blue)
    expect(sprite.blendMode).toBe('Additive')
    expect(sprite.size.x).toBe(64)      // 32 * 2
    expect(sprite.size.y).toBe(64)      // 32 * 2
    expect(sprite.size.z).toBe(64 * 0.5) // size.y * zRamp
  })

  it('zRamp=0 produces size.z=0', () => {
    const sheet = makeSheet(64, 64)
    const sprite = new Sprite(
      sheet, { x: 0, y: 0, width: 8, height: 8 },
      0, { x: 0, y: 0, z: 0 }, TextureChannel.RGBA,
    )

    expect(sprite.size.z).toBe(0)
  })

  it('zRamp>1 produces elongated Z', () => {
    const sheet = makeSheet(64, 64)
    const sprite = new Sprite(
      sheet, { x: 0, y: 0, width: 10, height: 10 },
      2, { x: 0, y: 0, z: 0 }, TextureChannel.Red,
      'Alpha', 1,
    )

    expect(sprite.size.z).toBe(20) // 10 * 1 * 2
  })
})

// ---------------------------------------------------------------------------
// UV inset (1/128 pixel)
// ---------------------------------------------------------------------------

describe('UV coordinates (with 1/128 pixel inset)', () => {
  it('computes normalized UV with inset', () => {
    const sheet = makeSheet(256, 256)
    // Rectangle at (0,0, 32,32) on 256x256 sheet
    const sprite = new Sprite(sheet, { x: 0, y: 0, width: 32, height: 32 }, TextureChannel.RGBA)

    const inset = 1 / 128
    expect(sprite.left).toBeCloseTo((0 + inset) / 256, 6)
    expect(sprite.top).toBeCloseTo((0 + inset) / 256, 6)
    expect(sprite.right).toBeCloseTo((32 - inset) / 256, 6)
    expect(sprite.bottom).toBeCloseTo((32 - inset) / 256, 6)
  })

  it('handles negative bounds (flipped sprite)', () => {
    // OpenRA uses Min/Max for bounds to handle flipped sprites
    const sheet = makeSheet(128, 128)
    // "Negative" width: bounds from x=32 to x=0
    const sprite = new Sprite(sheet, { x: 32, y: 32, width: -32, height: -32 }, TextureChannel.RGBA)

    const inset = 1 / 128
    // Min/Max handles the negative case
    expect(sprite.left).toBeCloseTo((0 + inset) / 128, 6)
    expect(sprite.top).toBeCloseTo((0 + inset) / 128, 6)
    expect(sprite.right).toBeCloseTo((32 - inset) / 128, 6)
    expect(sprite.bottom).toBeCloseTo((32 - inset) / 128, 6)
  })

  it('UV values are in [0, 1] range for full-sheet sprite', () => {
    const sheet = makeSheet(64, 64)
    const sprite = new Sprite(sheet, { x: 0, y: 0, width: 64, height: 64 }, TextureChannel.RGBA)

    expect(sprite.left).toBeGreaterThanOrEqual(0)
    expect(sprite.right).toBeLessThanOrEqual(1)
    expect(sprite.top).toBeGreaterThanOrEqual(0)
    expect(sprite.bottom).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Empty sprite
// ---------------------------------------------------------------------------

describe('empty sprite', () => {
  it('zero-size sprite has all Uvs at 0', () => {
    const sheet = makeSheet(128, 128)
    const sprite = new Sprite(sheet, { x: 0, y: 0, width: 0, height: 0 }, TextureChannel.RGBA)

    expect(sprite.size.x).toBe(0)
    expect(sprite.size.y).toBe(0)
    expect(sprite.size.z).toBe(0)
    expect(sprite.left).toBe(0)
    expect(sprite.right).toBe(0)
    expect(sprite.top).toBe(0)
    expect(sprite.bottom).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SpriteWithSecondaryData
// ---------------------------------------------------------------------------

describe('SpriteWithSecondaryData', () => {
  it('extends Sprite with secondary texture info', () => {
    const primarySheet = makeSheet(256, 256)
    const secondarySheet = makeSheet(128, 128)

    const base = new Sprite(
      primarySheet, { x: 0, y: 0, width: 32, height: 32 },
      0.5, { x: 1, y: 2, z: 3 }, TextureChannel.Red, 'Alpha', 1,
    )

    const swsd = new SpriteWithSecondaryData(
      base,
      secondarySheet,
      { x: 16, y: 16, width: 16, height: 16 },
      TextureChannel.Green,
    )

    // Inherited from base
    expect(swsd.sheet).toBe(primarySheet)
    expect(swsd.channel).toBe(TextureChannel.Red)
    expect(swsd.zRamp).toBe(0.5)
    expect(swsd.offset).toEqual({ x: 1, y: 2, z: 3 })

    // Secondary data
    expect(swsd.secondarySheet).toBe(secondarySheet)
    expect(swsd.secondaryChannel).toBe(TextureChannel.Green)
    expect(swsd.secondaryBounds.x).toBe(16)
    expect(swsd.secondaryBounds.y).toBe(16)
    expect(swsd.secondaryBounds.width).toBe(16)
    expect(swsd.secondaryBounds.height).toBe(16)
  })

  it('computes secondary UV (NO inset — matches OpenRA)', () => {
    const primarySheet = makeSheet(256, 256)
    const secondarySheet = makeSheet(64, 64)

    const base = new Sprite(
      primarySheet, { x: 0, y: 0, width: 16, height: 16 }, TextureChannel.RGBA,
    )

    const swsd = new SpriteWithSecondaryData(
      base,
      secondarySheet,
      { x: 16, y: 16, width: 32, height: 32 },
      TextureChannel.Alpha,
    )

    // Secondary UV: NO inset (diff from primary UV)
    expect(swsd.secondaryLeft).toBe(16 / 64)    // 0.25
    expect(swsd.secondaryTop).toBe(16 / 64)     // 0.25
    expect(swsd.secondaryRight).toBe(48 / 64)   // 0.75
    expect(swsd.secondaryBottom).toBe(48 / 64)  // 0.75
  })

  it('secondary UV works for negative bounds', () => {
    const primarySheet = makeSheet(256, 256)
    const secondarySheet = makeSheet(64, 64)

    const base = new Sprite(
      primarySheet, { x: 0, y: 0, width: 16, height: 16 }, TextureChannel.RGBA,
    )

    const swsd = new SpriteWithSecondaryData(
      base,
      secondarySheet,
      { x: 48, y: 48, width: -32, height: -32 },
      TextureChannel.Red,
    )

    // Min(48, 16)=16, Max(48, 16)=48
    expect(swsd.secondaryLeft).toBe(16 / 64)
    expect(swsd.secondaryRight).toBe(48 / 64)
  })
})
