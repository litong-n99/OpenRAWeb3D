/**
 * TmpRALoader.test.ts — Red Alert TMP loader unit tests
 *
 * Tests focus on: format detection, frame parsing, RA-specific header offsets.
 */

import { describe, it, expect } from 'vitest'
import { TmpRALoader } from './TmpRALoader.js'
import { SpriteFrameType } from '../../OpenRA.Game/Graphics/SpriteLoader.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal TMP RA file buffer
// ---------------------------------------------------------------------------

function buildTmpRABuffer(
  width: number,
  height: number,
  tiles: (Uint8Array | null)[],
): Uint8Array {
  const tileSize = width * height
  // Header is 40 bytes, then index table, then image data
  const headerEnd = 40
  const indexStart = headerEnd
  const indexEnd = indexStart + tiles.length
  const imgStart = indexEnd

  const dataSize = imgStart + tiles.reduce((sum, t) => sum + (t ? tileSize : 0), 0)
  const buffer = new Uint8Array(dataSize)
  const dv = new DataView(buffer.buffer)

  dv.setUint16(0, width, true)
  dv.setUint16(2, height, true)
  // offset 4-15: 12 zero bytes (padding)
  dv.setUint32(16, imgStart, true)
  // offset 20-23: magic a = 0 (already zero)
  // offset 24-25: padding
  // offset 26-27: magic b = 0x2c73
  dv.setUint16(26, 0x2c73, true)
  // offset 28-31: indexEnd
  dv.setInt32(28, indexEnd, true)
  // offset 32-35: padding (already zero)
  // offset 36-39: indexStart
  dv.setInt32(36, indexStart, true)

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
      buffer[indexStart + i] = 255
    }
  }

  return buffer
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TmpRALoader', () => {
  it('rejects empty buffer', () => {
    const result = TmpRALoader.tryParseSprite(new Uint8Array(0), 'test.tmp')
    expect(result).toBeNull()
  })

  it('rejects non-TMP RA data (wrong magic)', () => {
    const buffer = new Uint8Array(40)
    const result = TmpRALoader.tryParseSprite(buffer, 'test.tmp')
    expect(result).toBeNull()
  })

  it('parses a single tile TMP RA file', () => {
    const tileData = new Uint8Array(24 * 24)
    tileData.fill(0x77)
    const buffer = buildTmpRABuffer(24, 24, [tileData])

    const result = TmpRALoader.tryParseSprite(buffer, 'test.tmp')
    expect(result).not.toBeNull()
    expect(result!.frames).toHaveLength(1)
    expect(result!.frames[0]!.data[0]).toBe(0x77)
    expect(result!.frames[0]!.type).toBe(SpriteFrameType.Indexed8)
  })

  it('parses multiple tiles', () => {
    const t1 = new Uint8Array(24 * 24)
    t1.fill(0x11)
    const t2 = new Uint8Array(24 * 24)
    t2.fill(0x22)

    const buffer = buildTmpRABuffer(24, 24, [t1, t2])
    const result = TmpRALoader.tryParseSprite(buffer, 'test.tmp')
    expect(result!.frames).toHaveLength(2)
  })

  it('handles blank tiles', () => {
    const tile = new Uint8Array(24 * 24)
    tile.fill(0xaa)
    const buffer = buildTmpRABuffer(24, 24, [tile, null, tile])

    const result = TmpRALoader.tryParseSprite(buffer, 'test.tmp')
    expect(result!.frames).toHaveLength(3)
    expect(result!.frames[1]!.data.length).toBe(0)
    expect(result!.frames[0]!.data.length).toBe(24 * 24)
    expect(result!.frames[2]!.data.length).toBe(24 * 24)
  })

  it('sets correct frame size', () => {
    const tile = new Uint8Array(32 * 32)
    tile.fill(0x55)
    const buffer = buildTmpRABuffer(32, 32, [tile])
    const result = TmpRALoader.tryParseSprite(buffer, 'test.tmp')
    expect(result!.frames[0]!.size.width).toBe(32)
    expect(result!.frames[0]!.size.height).toBe(32)
    expect(result!.frames[0]!.frameSize.width).toBe(32)
    expect(result!.frames[0]!.frameSize.height).toBe(32)
  })
})
