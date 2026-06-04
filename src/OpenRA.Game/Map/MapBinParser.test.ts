/**
 * MapBinParser.test.ts — MapBinParser migration unit tests
 */

import { describe, it, expect } from 'vitest'
import {
  parseBinaryDataHeader,
  computeBinaryDataLayout,
  buildBinaryData,
  writeBinaryDataHeader,
  BINARY_DATA_HEADER_SIZE,
  BYTES_PER_TILE,
  BYTES_PER_RESOURCE,
  NO_HEIGHT_OFFSET,
  type BinaryDataHeader,
  type BinaryDataLayout,
} from './MapBinParser'

// ---------------------------------------------------------------------------
// computeBinaryDataLayout
// ---------------------------------------------------------------------------

describe('computeBinaryDataLayout', () => {
  it('computes layout for a flat map (no height)', () => {
    const layout = computeBinaryDataLayout(64, 64, false)

    expect(layout.tilesOffset).toBe(BINARY_DATA_HEADER_SIZE) // 17
    expect(layout.heightsOffset).toBe(NO_HEIGHT_OFFSET) // 0
    expect(layout.tilesSize).toBe(BYTES_PER_TILE * 64 * 64) // 12288
    expect(layout.heightsSize).toBe(0)
    expect(layout.resourcesSize).toBe(BYTES_PER_RESOURCE * 64 * 64) // 8192
    expect(layout.resourcesOffset).toBe(BINARY_DATA_HEADER_SIZE + layout.tilesSize)
    expect(layout.totalSize).toBe(BINARY_DATA_HEADER_SIZE + layout.tilesSize + layout.resourcesSize)
  })

  it('computes layout for a map with height', () => {
    const layout = computeBinaryDataLayout(10, 10, true)

    expect(layout.tilesOffset).toBe(BINARY_DATA_HEADER_SIZE)
    expect(layout.heightsOffset).toBe(BINARY_DATA_HEADER_SIZE + BYTES_PER_TILE * 100)
    expect(layout.tilesSize).toBe(300)
    expect(layout.heightsSize).toBe(100)
    expect(layout.resourcesSize).toBe(200)
    expect(layout.heightsOffset).toBeGreaterThan(0)
    expect(layout.totalSize).toBe(BINARY_DATA_HEADER_SIZE + 300 + 100 + 200)
  })
})

// ---------------------------------------------------------------------------
// parseBinaryDataHeader
// ---------------------------------------------------------------------------

describe('parseBinaryDataHeader', () => {
  it('parses Format 2 header correctly', () => {
    const buffer = new ArrayBuffer(17)
    const data = new DataView(buffer)
    data.setUint8(0, 2) // format
    data.setUint16(1, 64, true) // width
    data.setUint16(3, 64, true) // height
    data.setUint32(5, 17, true) // tilesOffset
    data.setUint32(9, 0, true) // heightsOffset
    data.setUint32(13, 12301, true) // resourcesOffset

    const header = parseBinaryDataHeader(data, 64, 64)
    expect(header.format).toBe(2)
    expect(header.width).toBe(64)
    expect(header.height).toBe(64)
    expect(header.tilesOffset).toBe(17)
    expect(header.heightsOffset).toBe(0)
    expect(header.resourcesOffset).toBe(12301)
  })

  it('throws on dimension mismatch', () => {
    const buffer = new ArrayBuffer(17)
    const data = new DataView(buffer)
    data.setUint8(0, 2)
    data.setUint16(1, 64, true)
    data.setUint16(3, 32, true)

    expect(() => parseBinaryDataHeader(data, 64, 64)).toThrow('Invalid tile data')
  })

  it('parses Format 1 (legacy) header', () => {
    const buffer = new ArrayBuffer(5)
    const data = new DataView(buffer)
    data.setUint8(0, 1) // format
    data.setUint16(1, 10, true) // width
    data.setUint16(3, 10, true) // height

    const header = parseBinaryDataHeader(data, 10, 10)
    expect(header.format).toBe(1)
    expect(header.tilesOffset).toBe(5)
    expect(header.heightsOffset).toBe(0)
    expect(header.resourcesOffset).toBe(3 * 10 * 10 + 5) // 305
  })

  it('throws on unknown format', () => {
    const buffer = new ArrayBuffer(17)
    const data = new DataView(buffer)
    data.setUint8(0, 99) // unknown format

    expect(() => parseBinaryDataHeader(data, 1, 1)).toThrow("Unknown binary map format '99'")
  })

  it('skips dimension validation when expected dimensions are 0', () => {
    const buffer = new ArrayBuffer(17)
    const data = new DataView(buffer)
    data.setUint8(0, 2)
    data.setUint16(1, 64, true)
    data.setUint16(3, 64, true)
    data.setUint32(5, 17, true)
    data.setUint32(9, 0, true)
    data.setUint32(13, 12301, true)

    // Should not throw even though 64 != 0
    const header = parseBinaryDataHeader(data, 0, 0)
    expect(header.width).toBe(64)
    expect(header.height).toBe(64)
  })
})

// ---------------------------------------------------------------------------
// buildBinaryData / writeBinaryDataHeader
// ---------------------------------------------------------------------------

describe('buildBinaryData', () => {
  it('builds a valid Format 2 buffer with correct header', () => {
    const tiles = [
      { type: 1, index: 0 },
      { type: 2, index: 1 },
      { type: 3, index: 2 },
      { type: 4, index: 3 },
    ]

    const buffer = buildBinaryData({
      width: 2,
      height: 2,
      hasHeight: false,
      tiles,
    })

    const data = new DataView(buffer)

    // Header
    expect(data.getUint8(0)).toBe(2) // format
    expect(data.getUint16(1, true)).toBe(2) // width
    expect(data.getUint16(3, true)).toBe(2) // height
    expect(data.getUint32(5, true)).toBe(17) // tilesOffset
    expect(data.getUint32(9, true)).toBe(0) // heightsOffset
    expect(data.getUint32(13, true)).toBeGreaterThan(0) // resourcesOffset

    // Tile at MPos(0,0): bytes 17-18 = type, byte 19 = index
    expect(data.getUint16(17, true)).toBe(1)
    expect(data.getUint8(19)).toBe(0)

    // Tile at MPos(1,0): bytes 20-21 = type (default), 22 = index
    // Column-major: MPos(0,1) is second, MPos(1,0) is third
    expect(data.getUint16(20, true)).toBe(3) // MPos(0,1)
    expect(data.getUint16(23, true)).toBe(2) // MPos(1,0)
  })

  it('builds buffer with height data', () => {
    const tiles = [{ type: 0, index: 0 }]
    const heights = [5]

    const buffer = buildBinaryData({
      width: 1,
      height: 1,
      hasHeight: true,
      tiles,
      heights,
    })

    const data = new DataView(buffer)

    // heightsOffset should be > 0
    const heightsOffset = data.getUint32(9, true)
    expect(heightsOffset).toBeGreaterThan(0)

    // Height at the offset
    expect(data.getUint8(heightsOffset)).toBe(5)
  })

  it('builds buffer with resource data', () => {
    const tiles = [{ type: 0, index: 0 }]
    const resources = [{ type: 7, index: 200 }]

    const buffer = buildBinaryData({
      width: 1,
      height: 1,
      hasHeight: false,
      tiles,
      resources,
    })

    const data = new DataView(buffer)

    // resourcesOffset
    const resourcesOffset = data.getUint32(13, true)
    expect(resourcesOffset).toBeGreaterThan(0)

    // Resource data
    expect(data.getUint8(resourcesOffset)).toBe(7) // type
    expect(data.getUint8(resourcesOffset + 1)).toBe(200) // index
  })

  it('handles FF tile index by preserving it in binary', () => {
    const tiles = [{ type: 1, index: 0xff }]

    const buffer = buildBinaryData({
      width: 1,
      height: 1,
      hasHeight: false,
      tiles,
    })

    const data = new DataView(buffer)
    // Index byte is at offset 19 (17 header + 2 type for tile 0,0)
    expect(data.getUint8(19)).toBe(0xff)
  })
})

// ---------------------------------------------------------------------------
// writeBinaryDataHeader
// ---------------------------------------------------------------------------

describe('writeBinaryDataHeader', () => {
  it('writes correct 17-byte header to a DataView', () => {
    const layout = computeBinaryDataLayout(32, 24, true)
    const buffer = new ArrayBuffer(17)
    const data = new DataView(buffer)

    const newPos = writeBinaryDataHeader(data, 0, 2, 32, 24, layout)

    expect(newPos).toBe(17)
    expect(data.getUint8(0)).toBe(2)
    expect(data.getUint16(1, true)).toBe(32)
    expect(data.getUint16(3, true)).toBe(24)
    expect(data.getUint32(5, true)).toBe(layout.tilesOffset)
    expect(data.getUint32(9, true)).toBe(layout.heightsOffset)
    expect(data.getUint32(13, true)).toBe(layout.resourcesOffset)
  })

  it('writes header at non-zero offset', () => {
    const layout = computeBinaryDataLayout(1, 1, false)
    const buffer = new ArrayBuffer(27) // 10 + 17
    const data = new DataView(buffer)

    const newPos = writeBinaryDataHeader(data, 10, 2, 1, 1, layout)

    expect(newPos).toBe(27)
    expect(data.getUint8(10)).toBe(2)
    expect(data.getUint16(11, true)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Roundtrip: build → parse → verify
// ---------------------------------------------------------------------------

describe('MapBinParser roundtrip', () => {
  it('parseBinaryDataHeader can read what buildBinaryData wrote', () => {
    const tiles = Array.from({ length: 16 }, (_, i) => ({
      type: i + 1,
      index: i % 255,
    }))
    const resources = Array.from({ length: 16 }, (_, i) => ({
      type: i % 5,
      index: i * 10,
    }))
    const heights = Array.from({ length: 16 }, (_, i) => i % 4)

    const buffer = buildBinaryData({
      width: 4,
      height: 4,
      hasHeight: true,
      tiles,
      resources,
      heights,
    })

    const data = new DataView(buffer)
    const header = parseBinaryDataHeader(data, 4, 4)

    expect(header.format).toBe(2)
    expect(header.width).toBe(4)
    expect(header.height).toBe(4)
    expect(header.tilesOffset).toBe(17)
    expect(header.heightsOffset).toBeGreaterThan(0)
    expect(header.resourcesOffset).toBeGreaterThan(header.heightsOffset)
  })
})
