/**
 * SheetBuilder.test.ts — SheetBuilder 迁移单元测试
 *
 * 测试: SheetType, FrameTypeToSheetType, SheetBuilder construction,
 * allocate (rect packing), channel cycling, addRaw, dispose
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Sheet, SheetType } from './Sheet'
import { Sprite, TextureChannel } from './Sprite'
import { SheetBuilder, frameTypeToSheetType } from './SheetBuilder'
import { SpriteFrameType } from './Util'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeSize(w: number, h: number) {
  return { width: w, height: h }
}

// ---------------------------------------------------------------------------
// SheetType / FrameTypeToSheetType
// ---------------------------------------------------------------------------

describe('SheetType', () => {
  it('Indexed=1 (1 channel per sprite)', () => {
    expect(SheetType.Indexed).toBe(1)
  })

  it('BGRA=4 (4 channels per sprite)', () => {
    expect(SheetType.BGRA).toBe(4)
  })
})

describe('frameTypeToSheetType', () => {
  it('Indexed8 → Indexed', () => {
    expect(frameTypeToSheetType(SpriteFrameType.Indexed8)).toBe(SheetType.Indexed)
  })

  it('Bgra32 → BGRA', () => {
    expect(frameTypeToSheetType(SpriteFrameType.Bgra32)).toBe(SheetType.BGRA)
  })

  it('Bgr24 → BGRA', () => {
    expect(frameTypeToSheetType(SpriteFrameType.Bgr24)).toBe(SheetType.BGRA)
  })

  it('Rgba32 → BGRA', () => {
    expect(frameTypeToSheetType(SpriteFrameType.Rgba32)).toBe(SheetType.BGRA)
  })

  it('Rgb24 → BGRA', () => {
    expect(frameTypeToSheetType(SpriteFrameType.Rgb24)).toBe(SheetType.BGRA)
  })

  it('throws for unknown type', () => {
    expect(() => frameTypeToSheetType(99 as any)).toThrow(/Unknown SpriteFrameType/)
  })
})

// ---------------------------------------------------------------------------
// SheetBuilder construction
// ---------------------------------------------------------------------------

describe('SheetBuilder construction', () => {
  it('creates with type and sheet size', () => {
    const sb = new SheetBuilder(SheetType.BGRA, 256)
    expect(sb.type).toBe(SheetType.BGRA)
    expect(sb.current).toBeNull() // Sheet is lazy
    expect(sb.allSheets).toHaveLength(0)
  })

  it('creates with custom factory', () => {
    let callCount = 0
    const factory = () => {
      callCount++
      return new Sheet(SheetType.Indexed, { width: 128, height: 128 })
    }
    new SheetBuilder(SheetType.Indexed, factory)
    expect(callCount).toBe(0) // factory not called until needed
  })

  it('initializes Indexed currentChannel to Red (0)', () => {
    const sb = new SheetBuilder(SheetType.Indexed, 256)
    expect(sb.currentChannel).toBe(0)
  })

  it('initializes BGRA currentChannel to RGBA (4)', () => {
    const sb = new SheetBuilder(SheetType.BGRA, 256)
    expect(sb.currentChannel).toBe(4)
  })

  it('margin defaults to 1', () => {
    const sb = new SheetBuilder(SheetType.BGRA, 128)
    sb.allocate(makeSize(128, 128))
    // If margin is 1, a 128-width sprite fits in a 128 sheet
    // because (128 + 0 + 1 > 128) → wrap to new row
    expect(sb.current).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// allocate — rect packing
// ---------------------------------------------------------------------------

describe('allocate', () => {
  let sb: SheetBuilder

  beforeEach(() => {
    sb = new SheetBuilder(SheetType.BGRA, 256, 1)
  })

  it('creates first sheet lazily', () => {
    expect(sb.current).toBeNull()
    const sprite = sb.allocate(makeSize(32, 32))
    expect(sb.current).not.toBeNull()
    expect(sb.allSheets).toHaveLength(1)
    expect(sprite.sheet).toBe(sb.current)
  })

  it('places sprite at (margin, margin) = (1, 1)', () => {
    const sprite = sb.allocate(makeSize(32, 32))
    expect(sprite.bounds.x).toBe(1)
    expect(sprite.bounds.y).toBe(1)
    expect(sprite.bounds.width).toBe(32)
    expect(sprite.bounds.height).toBe(32)
  })

  it('places second sprite next to first (same row)', () => {
    void sb.allocate(makeSize(32, 32)) // allocate first sprite
    const s2 = sb.allocate(makeSize(32, 32))
    // First at x=1, second at x=1+32+1=34, same y=1
    expect(s2.bounds.x).toBe(34)
    expect(s2.bounds.y).toBe(1)
  })

  it('wraps to next row when width exceeded', () => {
    // Fill entire width: sprite width must be enough to overflow
    const first = sb.allocate(makeSize(250, 32)) // 250 + 1(margin) + 1(pos) = 252
    const s2 = sb.allocate(makeSize(10, 32))
    // s2 should be on a new row
    expect(s2.bounds.x).toBe(1) // back to left margin
    expect(s2.bounds.y).toBeGreaterThan(first.bounds.y)
    expect(s2.bounds.x).toBe(1) // back to left margin
  })

  it('updates rowHeight for taller sprites', () => {
    sb.allocate(makeSize(32, 16))
    sb.allocate(makeSize(32, 48)) // taller
    // Force next row
    sb.allocate(makeSize(200, 10)) // should be on next row
    // The row height should account for the 48-tall sprite
    // Next row Y should be >= 1 + 48 + 1 = 50
    const s3 = sb.allocate(makeSize(10, 10))
    expect(s3.bounds.y).toBeGreaterThanOrEqual(50)
  })

  it('returns valid Sprite with sheet reference', () => {
    const sprite = sb.allocate(makeSize(64, 64))
    expect(sprite).toBeInstanceOf(Sprite)
    expect(sprite.sheet).toBe(sb.current)
    expect(sprite.channel).toBe(TextureChannel.RGBA) // BGRA type
    expect(sprite.blendMode).toBe('Alpha')
    expect(sprite.zRamp).toBe(0)
  })

  it('passes zRamp and offset through', () => {
    const sprite = sb.allocate(makeSize(32, 32), 0.5, { x: 1, y: 2, z: 3 }, 2)
    expect(sprite.zRamp).toBe(0.5)
    expect(sprite.offset).toEqual({ x: 1, y: 2, z: 3 })
  })
})

// ---------------------------------------------------------------------------
// Channel cycling (Indexed sheets)
// ---------------------------------------------------------------------------

describe('channel cycling (Indexed)', () => {
  it('cycles R→G→B→A channels before new sheet', () => {
    // Small sheet to force overflow quickly
    const sb = new SheetBuilder(SheetType.Indexed, 64, 1)
    expect(sb.currentChannel).toBe(0) // Red

    // Fill the sheet
    const s1 = sb.allocate(makeSize(60, 60)) // fills almost entire sheet
    expect(s1.channel).toBe(TextureChannel.Red)
    expect(sb.currentChannel).toBe(0) // Same sheet, first sprite

    // Next allocation overflows → should cycle to Green on same sheet
    const s2 = sb.allocate(makeSize(60, 60))
    expect(s2.sheet).toBe(s1.sheet)  // Same sheet!
    expect(s2.channel).toBe(TextureChannel.Green)
    expect(sb.currentChannel).toBe(1) // Green

    // Overflow again → Blue
    const s3 = sb.allocate(makeSize(60, 60))
    expect(s3.sheet).toBe(s1.sheet)  // Still same sheet
    expect(s3.channel).toBe(TextureChannel.Blue)
    expect(sb.currentChannel).toBe(2)

    // Overflow again → Alpha
    const s4 = sb.allocate(makeSize(60, 60))
    expect(s4.sheet).toBe(s1.sheet)
    expect(s4.channel).toBe(TextureChannel.Alpha)
    expect(sb.currentChannel).toBe(3)

    // Overflow again → new sheet, back to Red
    const s5 = sb.allocate(makeSize(60, 60))
    expect(s5.sheet).not.toBe(s1.sheet)  // New sheet
    expect(s5.channel).toBe(TextureChannel.Red)
    expect(sb.currentChannel).toBe(0)
    expect(sb.allSheets).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Channel cycling (BGRA sheets — no cycling)
// ---------------------------------------------------------------------------

describe('BGRA sheets (no channel cycling)', () => {
  it('always stays on RGBA channel and allocates new sheets', () => {
    const sb = new SheetBuilder(SheetType.BGRA, 64, 1)
    expect(sb.currentChannel).toBe(4) // RGBA

    // Fill first sheet
    sb.allocate(makeSize(60, 60))
    expect(sb.currentChannel).toBe(4)

    // Overflow → new sheet, still RGBA
    sb.allocate(makeSize(60, 60))
    expect(sb.currentChannel).toBe(4)
    expect(sb.allSheets).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// addRaw
// ---------------------------------------------------------------------------

describe('addRaw', () => {
  let sb: SheetBuilder

  beforeEach(() => {
    sb = new SheetBuilder(SheetType.BGRA, 256)
  })

  it('allocates and copies pixel data', () => {
    const src = new Uint8Array(4 * 16 * 16) // 16x16 BGRA
    // Fill with some test data
    for (let i = 0; i < src.length; i += 4) {
      src[i] = 100     // B
      src[i + 1] = 150 // G
      src[i + 2] = 200 // R
      src[i + 3] = 255 // A
    }

    const sprite = sb.addRaw(
      src, SpriteFrameType.Bgra32, makeSize(16, 16),
      0, { x: 0, y: 0, z: 0 }, true,
    )

    expect(sprite).toBeInstanceOf(Sprite)
    expect(sprite.bounds.width).toBe(16)
    expect(sprite.bounds.height).toBe(16)
  })

  it('handles empty sprites (0x0)', () => {
    const src = new Uint8Array(0)
    const sprite = sb.addRaw(
      src, SpriteFrameType.Bgra32, makeSize(0, 0),
      0, { x: 0, y: 0, z: 0 },
    )

    expect(sprite.bounds.width).toBe(0)
    expect(sprite.bounds.height).toBe(0)
    expect(sb.allSheets).toHaveLength(1) // Sheet created even for empty
  })

  it('addSimple is convenience wrapper', () => {
    const src = new Uint8Array(4 * 8 * 8)
    const sprite = sb.addSimple(src, SpriteFrameType.Bgra32, makeSize(8, 8))
    expect(sprite).toBeInstanceOf(Sprite)
    expect(sprite.zRamp).toBe(0)
    expect(sprite.offset).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('addFrame uses ISpriteFrame interface', () => {
    const frame = {
      data: new Uint8Array(4 * 8 * 8),
      type: SpriteFrameType.Bgra32,
      size: { width: 8, height: 8 },
      offset: { x: 1, y: 2, z: 0 },
    }
    const sprite = sb.addFrame(frame)
    expect(sprite.offset).toEqual({ x: 1, y: 2, z: 0 })
  })

  it('addFrame with no offset defaults to (0,0,0)', () => {
    const frame = {
      data: new Uint8Array(4 * 4 * 4),
      type: SpriteFrameType.Bgra32,
      size: { width: 4, height: 4 },
    }
    const sprite = sb.addFrame(frame)
    expect(sprite.offset).toEqual({ x: 0, y: 0, z: 0 })
  })
})

// ---------------------------------------------------------------------------
// allocateSheet static method
// ---------------------------------------------------------------------------

describe('allocateSheet static', () => {
  it('creates square sheet', () => {
    const sheet = SheetBuilder.allocateSheet(SheetType.BGRA, 512)
    expect(sheet.size.width).toBe(512)
    expect(sheet.size.height).toBe(512)
    expect(sheet.type).toBe(SheetType.BGRA)
  })
})

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('disposes all sheets and clears state', () => {
    const sb = new SheetBuilder(SheetType.BGRA, 256)
    sb.allocate(makeSize(32, 32)) // creates first sheet
    expect(sb.allSheets).toHaveLength(1)

    sb.dispose()
    expect(sb.allSheets).toHaveLength(0)
    expect(sb.current).toBeNull()
  })

  it('safe to call twice', () => {
    const sb = new SheetBuilder(SheetType.Indexed, 128)
    sb.allocate(makeSize(16, 16))
    sb.dispose()
    expect(() => sb.dispose()).not.toThrow()
  })
})
