/**
 * TemTileset.test.ts — TemTileset .tem parser unit tests
 *
 * Tests focus: header parsing, uncompressed tile extraction, error handling,
 * edge cases (empty tileset, invalid data, unsupported compression).
 */

import { describe, it, expect } from 'vitest'
import { TemTileset, type TemTilesetInfo } from './TemTileset.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal uncompressed .tem file binary
// ---------------------------------------------------------------------------

function buildTemBinary(params: {
  width?: number
  height?: number
  tileWidth?: number
  tileHeight?: number
  numTiles?: number
  compressionType?: number
  /** Pixel data to append after the 40-byte header */
  pixelData?: Uint8Array
}): ArrayBuffer {
  const {
    width = 4,
    height = 4,
    tileWidth = 32,
    tileHeight = 32,
    numTiles = 4,
    compressionType = 0,
    pixelData,
  } = params

  const bytesPerTile = tileWidth * tileHeight
  const totalPixelBytes = numTiles * bytesPerTile

  const pixelBytes = pixelData ?? new Uint8Array(totalPixelBytes).fill(0x42)
  if (pixelBytes.byteLength < totalPixelBytes) {
    throw new Error(`Not enough pixel data: need ${totalPixelBytes}, got ${pixelBytes.byteLength}`)
  }

  const buf = new ArrayBuffer(40 + totalPixelBytes)
  const dv = new DataView(buf)

  dv.setUint32(0, width, true)
  dv.setUint32(4, height, true)
  dv.setUint32(8, tileWidth, true)
  dv.setUint32(12, tileHeight, true)
  dv.setUint32(16, numTiles, true)
  dv.setUint32(20, compressionType, true)

  const outBytes = new Uint8Array(buf, 40)
  outBytes.set(pixelBytes.subarray(0, totalPixelBytes))

  return buf
}

// ---------------------------------------------------------------------------
// TemTileset.parse — basic parsing
// ---------------------------------------------------------------------------

describe('TemTileset.parse', () => {
  it('parses a minimal uncompressed .tem file', () => {
    const pixelData = new Uint8Array(4 * 8 * 8) // 4 tiles × 64 bytes each
    for (let i = 0; i < pixelData.length; i++) pixelData[i] = i

    const buf = buildTemBinary({
      width: 2,
      height: 2,
      tileWidth: 8,
      tileHeight: 8,
      numTiles: 4,
      compressionType: 0,
      pixelData,
    })

    const ts = TemTileset.parse(buf)

    expect(ts.info.width).toBe(2)
    expect(ts.info.height).toBe(2)
    expect(ts.info.tileWidth).toBe(8)
    expect(ts.info.tileHeight).toBe(8)
    expect(ts.info.numTiles).toBe(4)
    expect(ts.info.compressionType).toBe(0)
    expect(ts.tileCount).toBe(4)
    expect(ts.tiles.length).toBe(4)
  })

  it('extracts correct per-tile pixel data', () => {
    const bytesPerTile = 16 // 4x4
    const numTiles = 3
    const pixelData = new Uint8Array(numTiles * bytesPerTile)
    // Fill each tile with distinct patterns
    for (let i = 0; i < numTiles; i++) {
      for (let j = 0; j < bytesPerTile; j++) {
        pixelData[i * bytesPerTile + j] = 0x10 * (i + 1) + j
      }
    }

    const buf = buildTemBinary({
      width: 3,
      height: 1,
      tileWidth: 4,
      tileHeight: 4,
      numTiles,
      compressionType: 0,
      pixelData,
    })

    const ts = TemTileset.parse(buf)

    // Each tile should have exactly bytesPerTile bytes
    for (let i = 0; i < numTiles; i++) {
      const tileData = new Uint8Array(ts.getTileData(i))
      expect(tileData.length).toBe(bytesPerTile)
      expect(tileData[0]).toBe(0x10 * (i + 1))
      expect(tileData[bytesPerTile - 1]).toBe(0x10 * (i + 1) + bytesPerTile - 1)
    }
  })

  it('handles single-tile tileset', () => {
    const pixelData = new Uint8Array(16).fill(0xFF)
    const buf = buildTemBinary({
      width: 1,
      height: 1,
      tileWidth: 4,
      tileHeight: 4,
      numTiles: 1,
      compressionType: 0,
      pixelData,
    })

    const ts = TemTileset.parse(buf)
    expect(ts.tileCount).toBe(1)
    const tileData = new Uint8Array(ts.getTileData(0))
    expect(tileData.length).toBe(16)
    expect(tileData[0]).toBe(0xFF)
  })
})

// ---------------------------------------------------------------------------
// TemTileset.parse — error handling
// ---------------------------------------------------------------------------

describe('TemTileset.parse — error handling', () => {
  it('throws when data is too small (less than 40 bytes)', () => {
    const buf = new ArrayBuffer(20)
    expect(() => TemTileset.parse(buf)).toThrow(/too small/)
  })

  it('throws on invalid dimensions (zero width)', () => {
    const buf = buildTemBinary({ width: 0 })
    expect(() => TemTileset.parse(buf)).toThrow(/invalid tileset dimensions/)
  })

  it('throws on invalid dimensions (zero height)', () => {
    const buf = buildTemBinary({ height: 0 })
    expect(() => TemTileset.parse(buf)).toThrow(/invalid tileset dimensions/)
  })

  it('throws on invalid tile dimensions (zero tileWidth)', () => {
    const buf = buildTemBinary({ tileWidth: 0 })
    expect(() => TemTileset.parse(buf)).toThrow(/invalid tile dimensions/)
  })

  it('throws on zero tile count', () => {
    const buf = buildTemBinary({
      numTiles: 0,
      pixelData: new Uint8Array(0),
    })
    expect(() => TemTileset.parse(buf)).toThrow(/0 tiles/)
  })

  it('throws on LCW compression (type 1)', () => {
    const pixelData = new Uint8Array(64).fill(0xAA)
    const buf = buildTemBinary({
      width: 4, height: 4, tileWidth: 4, tileHeight: 4,
      numTiles: 4, compressionType: 1, pixelData,
    })
    expect(() => TemTileset.parse(buf)).toThrow(/LCW compression/)
  })

  it('throws on LZO compression (type 2)', () => {
    const pixelData = new Uint8Array(64).fill(0xAA)
    const buf = buildTemBinary({
      width: 4, height: 4, tileWidth: 4, tileHeight: 4,
      numTiles: 4, compressionType: 2, pixelData,
    })
    expect(() => TemTileset.parse(buf)).toThrow(/LZO compression/)
  })

  it('throws on unknown compression type', () => {
    const pixelData = new Uint8Array(64).fill(0xAA)
    const buf = buildTemBinary({
      width: 4, height: 4, tileWidth: 4, tileHeight: 4,
      numTiles: 4, compressionType: 99, pixelData,
    })
    expect(() => TemTileset.parse(buf)).toThrow(/unknown compression type 99/)
  })

  it('throws when pixel data is insufficient', () => {
    // Build a buffer with pixel data that is too short for the declared numTiles.
    // We manually construct a buffer where the header claims more data than exists.
    const tileWidth = 16
    const tileHeight = 16
    const bytesPerTile = tileWidth * tileHeight
    const numTiles = 4
    const requiredPixelBytes = numTiles * bytesPerTile // 1024

    // Provide only half the needed data
    const actualPixelBytes = requiredPixelBytes / 2
    const pixelData = new Uint8Array(actualPixelBytes).fill(0x42)

    // Build buffer manually to bypass the helper's minimum check
    const bufSize = 40 + actualPixelBytes // smaller than expected
    const buf = new ArrayBuffer(bufSize)
    const dv = new DataView(buf)
    dv.setUint32(0, 2, true)       // width
    dv.setUint32(4, 2, true)       // height
    dv.setUint32(8, tileWidth, true)
    dv.setUint32(12, tileHeight, true)
    dv.setUint32(16, numTiles, true)  // 4 tiles expected
    dv.setUint32(20, 0, true)      // uncompressed
    const outBytes = new Uint8Array(buf, 40)
    outBytes.set(pixelData)

    expect(() => TemTileset.parse(buf)).toThrow(/uncompressed data too small/)
  })
})

// ---------------------------------------------------------------------------
// TemTileset.getTileData — boundary checks
// ---------------------------------------------------------------------------

describe('TemTileset.getTileData', () => {
  it('throws on negative tile index', () => {
    const pixelData = new Uint8Array(16).fill(0x42)
    const buf = buildTemBinary({
      width: 1, height: 1, tileWidth: 4, tileHeight: 4,
      numTiles: 1, compressionType: 0, pixelData,
    })
    const ts = TemTileset.parse(buf)

    expect(() => ts.getTileData(-1)).toThrow(/out of range/)
  })

  it('throws on tile index >= numTiles', () => {
    const pixelData = new Uint8Array(16).fill(0x42)
    const buf = buildTemBinary({
      width: 1, height: 1, tileWidth: 4, tileHeight: 4,
      numTiles: 1, compressionType: 0, pixelData,
    })
    const ts = TemTileset.parse(buf)

    expect(() => ts.getTileData(1)).toThrow(/out of range/)
  })

  it('getTileData(0) works for single-tile tileset', () => {
    const pixelData = new Uint8Array(16)
    pixelData[0] = 0xCC
    const buf = buildTemBinary({
      width: 1, height: 1, tileWidth: 4, tileHeight: 4,
      numTiles: 1, compressionType: 0, pixelData,
    })
    const ts = TemTileset.parse(buf)

    const tileData = ts.getTileData(0)
    expect(tileData.byteLength).toBe(16)
    // First byte of tile data should match first pixel
    expect(new Uint8Array(tileData)[0]).toBe(0xCC)
  })
})

// ---------------------------------------------------------------------------
// TemTileset.info — metadata integrity
// ---------------------------------------------------------------------------

describe('TemTileset.info', () => {
  it('preserves all header fields correctly', () => {
    const pixelData = new Uint8Array(3 * 64).fill(0x42)
    const buf = buildTemBinary({
      width: 3,
      height: 1,
      tileWidth: 8,
      tileHeight: 8,
      numTiles: 3,
      compressionType: 0,
      pixelData,
    })

    const ts = TemTileset.parse(buf)
    const info: TemTilesetInfo = ts.info

    expect(info.width).toBe(3)
    expect(info.height).toBe(1)
    expect(info.tileWidth).toBe(8)
    expect(info.tileHeight).toBe(8)
    expect(info.numTiles).toBe(3)
    expect(info.compressionType).toBe(0)
  })
})
