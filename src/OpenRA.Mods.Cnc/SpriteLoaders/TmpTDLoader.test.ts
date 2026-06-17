/**
 * TmpTDLoader.test.ts — Tiberian Dawn TMP loader unit tests
 *
 * Tests focus on: format detection, frame parsing, edge cases.
 */

import { describe, it, expect } from 'vitest'
import { TmpTDLoader } from './TmpTDLoader.js'
import { SpriteFrameType } from '../../OpenRA.Game/Graphics/SpriteLoader.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal TMP TD file buffer
// ---------------------------------------------------------------------------

/**
 * Build a minimal TMP TD file buffer.
 *
 * Format:
 *   offset 0: width (uint16 LE)
 *   offset 2: height (uint16 LE)
 *   offset 4-11: 8 zero bytes
 *   offset 12: imgStart (uint32 LE)
 *   offset 16-19: 4 zero bytes
 *   offset 20: indexEnd (int32 LE)
 *   offset 24: indexStart (int32 LE)
 *   [index table at indexStart]
 *   [image data at imgStart]
 */
function buildTmpTDBuffer(
  width: number,
  height: number,
  tiles: (Uint8Array | null)[],
): Uint8Array {
  const tileSize = width * height
  // Header is 32 bytes, then index table, then image data
  const headerEnd = 32
  const indexStart = headerEnd
  const indexEnd = indexStart + tiles.length
  const imgStart = indexEnd

  const dataSize = imgStart + tiles.reduce((sum, t) => sum + (t ? tileSize : 0), 0)
  const buffer = new Uint8Array(dataSize)
  const dv = new DataView(buffer.buffer)

  dv.setUint16(0, width, true)
  dv.setUint16(2, height, true)
  // offset 4-11: already zero (padding)
  dv.setUint32(12, imgStart, true)
  // offset 16-19: magic a = 0 (already zero)
  // offset 20-23: magic b = 0x0D1AFFFF
  dv.setUint32(20, 0x0d1affff, true)
  // offset 24-27: indexEnd
  dv.setInt32(24, indexEnd, true)
  // offset 28-31: indexStart
  dv.setInt32(28, indexStart, true)

  // Index table — sequential tile numbering for data references
  let imgOffset = imgStart
  let tileNum = 0
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    if (tile) {
      buffer[indexStart + i] = tileNum
      buffer.set(tile, imgOffset + tileNum * tileSize)
      tileNum++
    } else {
      buffer[indexStart + i] = 255 // blank tile marker
    }
  }

  return buffer
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TmpTDLoader', () => {
  it('rejects empty buffer', () => {
    const result = TmpTDLoader.tryParseSprite(new Uint8Array(0), 'test.tmp')
    expect(result).toBeNull()
  })

  it('rejects buffer too small for header', () => {
    const buffer = new Uint8Array(10)
    const result = TmpTDLoader.tryParseSprite(buffer, 'test.tmp')
    expect(result).toBeNull()
  })

  it('rejects non-TMP data (wrong magic)', () => {
    const buffer = new Uint8Array(30)
    buffer.fill(0)
    // No valid magic at offset 16/20
    const result = TmpTDLoader.tryParseSprite(buffer, 'test.tmp')
    expect(result).toBeNull()
  })

  it('parses a single tile TMP file', () => {
    const tileData = new Uint8Array(24 * 24)
    tileData.fill(0x42)
    const buffer = buildTmpTDBuffer(24, 24, [tileData])

    const result = TmpTDLoader.tryParseSprite(buffer, 'test.tmp')
    expect(result).not.toBeNull()
    expect(result!.frames).toHaveLength(1)
    expect(result!.metadata).toBeNull()

    const frame = result!.frames[0]!
    expect(frame.type).toBe(SpriteFrameType.Indexed8)
    expect(frame.size.width).toBe(24)
    expect(frame.size.height).toBe(24)
    expect(frame.data.length).toBe(24 * 24)
    expect(frame.data[0]).toBe(0x42)
  })

  it('parses multiple tiles', () => {
    const tile1 = new Uint8Array(24 * 24)
    tile1.fill(0x01)
    const tile2 = new Uint8Array(24 * 24)
    tile2.fill(0x02)
    const tile3 = new Uint8Array(24 * 24)
    tile3.fill(0x03)

    const buffer = buildTmpTDBuffer(24, 24, [tile1, tile2, tile3])
    const result = TmpTDLoader.tryParseSprite(buffer, 'test.tmp')
    expect(result!.frames).toHaveLength(3)
    expect(result!.frames[0]!.data[0]).toBe(0x01)
    expect(result!.frames[1]!.data[0]).toBe(0x02)
    expect(result!.frames[2]!.data[0]).toBe(0x03)
  })

  it('handles blank tiles (index 255)', () => {
    const tile = new Uint8Array(24 * 24)
    tile.fill(0x88)
    const buffer = buildTmpTDBuffer(24, 24, [tile, null, tile])

    const result = TmpTDLoader.tryParseSprite(buffer, 'test.tmp')
    expect(result!.frames).toHaveLength(3)
    expect(result!.frames[0]!.data.length).toBe(24 * 24)
    expect(result!.frames[1]!.data.length).toBe(0) // blank
    expect(result!.frames[1]!.size.width).toBe(0)
    expect(result!.frames[2]!.data.length).toBe(24 * 24)
  })

  it('uses Indexed8 frame type', () => {
    const tileData = new Uint8Array(24 * 24)
    const buffer = buildTmpTDBuffer(24, 24, [tileData])
    const result = TmpTDLoader.tryParseSprite(buffer, 'test.tmp')
    expect(result!.frames[0]!.type).toBe(SpriteFrameType.Indexed8)
  })

  it('sets correct offset to zero', () => {
    const tileData = new Uint8Array(24 * 24)
    const buffer = buildTmpTDBuffer(24, 24, [tileData])
    const result = TmpTDLoader.tryParseSprite(buffer, 'test.tmp')
    expect(result!.frames[0]!.offset.x).toBe(0)
    expect(result!.frames[0]!.offset.y).toBe(0)
  })

  it('has disableExportPadding as false', () => {
    const tileData = new Uint8Array(24 * 24)
    const buffer = buildTmpTDBuffer(24, 24, [tileData])
    const result = TmpTDLoader.tryParseSprite(buffer, 'test.tmp')
    expect(result!.frames[0]!.disableExportPadding).toBe(false)
  })
})
