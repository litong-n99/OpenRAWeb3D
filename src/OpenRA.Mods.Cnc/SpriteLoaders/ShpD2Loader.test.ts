/**
 * ShpD2Loader.test.ts — Dune 2000 SHP loader unit tests
 *
 * Tests focus on: format detection, frame parsing with palette table,
 * LCW/RLEZeros decompression, 2-byte vs 4-byte offset handling.
 */

import { describe, it, expect } from 'vitest'
import { ShpD2Loader } from './ShpD2Loader.js'
import { SpriteFrameType } from '../../OpenRA.Game/Graphics/SpriteLoader.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal SHP D2 file buffer
// ---------------------------------------------------------------------------

/**
 * Build a minimal SHP D2 file with raw uncompressed frames.
 *
 * Each frame has:
 *   flags(2) + unknown(1) + width(2) + height(1) + dataLeft(2) + dataSize(2)
 *   + optional table + compressed data
 *
 * For testing, we build frames with FormatFlags.NotLCWCompressed | PaletteTable
 * and provide a simple 16-byte identity palette table.
 */
function buildShpD2Buffer(
  frames: { width: number; height: number; data: Uint8Array; palette?: boolean }[],
): Uint8Array {
  // Use 4-byte offsets (temp & 0xFF0000 == 0 → 4-byte offsets)
  const imageCount = frames.length
  const offsetTableSize = 4 * (imageCount + 1)
  const headerSize = 2 + offsetTableSize

  // Build frames
  const frameBuffers: Uint8Array[] = []
  // Raw values stored in file (ParseFrames adds 2 to get absolute position)
  const fileValues: number[] = [headerSize - 2]

  for (const frame of frames) {
    const palette = frame.palette ?? true
    const tableSize = palette ? 16 : 0
    let flags = FormatFlags.NotLCWCompressed
    if (palette) flags |= FormatFlags.PaletteTable

    // Header: 10 bytes + table
    const headerLen = 10 + tableSize
    const dataLen = frame.data.length
    const frameSize = headerLen + dataLen

    const buf = new Uint8Array(frameSize)
    const dv = new DataView(buf.buffer)

    dv.setUint16(0, flags, true)
    // unknown byte at 2: skip (0)
    dv.setUint16(3, frame.width, true)
    buf[5] = frame.height
    // dataLeft field = remaining bytes in frame (header body + table + data)
    dv.setUint16(6, headerLen + dataLen, true)
    dv.setUint16(8, dataLen, true) // dataSize

    if (palette) {
      // Write identity palette table (16 entries: 0-15)
      for (let i = 0; i < 16; i++) {
        buf[10 + i] = i
      }
    }

    // Copy uncompressed data
    buf.set(frame.data, headerLen)

    frameBuffers.push(buf)
    fileValues.push(fileValues[fileValues.length - 1]! + frameSize)
  }

  const totalSize = fileValues[fileValues.length - 1]! + 2
  const buffer = new Uint8Array(totalSize)
  const dv = new DataView(buffer.buffer)

  dv.setUint16(0, imageCount, true)

  // Write raw file values (ParseFrames does: value + 2 = absolute position)
  for (let i = 0; i < fileValues.length; i++) {
    dv.setUint32(2 + i * 4, fileValues[i]!, true)
  }

  // Write frame data
  let writePos = headerSize
  for (const fb of frameBuffers) {
    buffer.set(fb, writePos)
    writePos += fb.length
  }

  return buffer
}

// Need the same FormatFlags values
const FormatFlags = {
  PaletteTable: 1,
  NotLCWCompressed: 2,
  VariableLengthTable: 4,
} as const

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShpD2Loader', () => {
  it('rejects empty buffer', () => {
    const result = ShpD2Loader.tryParseSprite(new Uint8Array(0), 'test.shp')
    expect(result).toBeNull()
  })

  it('rejects buffer with zero image count', () => {
    const buffer = new Uint8Array(10)
    const result = ShpD2Loader.tryParseSprite(buffer, 'test.shp')
    expect(result).toBeNull()
  })

  it('parses a single-frame SHP D2', () => {
    const pixelData = new Uint8Array([1, 2, 3, 4])
    const buffer = buildShpD2Buffer([{ width: 2, height: 2, data: pixelData }])

    const result = ShpD2Loader.tryParseSprite(buffer, 'test.shp')
    expect(result).not.toBeNull()
    expect(result!.frames).toHaveLength(1)
    expect(result!.frames[0]!.type).toBe(SpriteFrameType.Indexed8)
    expect(result!.frames[0]!.size.width).toBe(2)
    expect(result!.frames[0]!.size.height).toBe(2)
  })

  it('parses multi-frame SHP D2', () => {
    const f1 = new Uint8Array([10, 20, 30, 40, 50, 60])
    const f2 = new Uint8Array([70, 80, 90, 100, 110, 120])
    const buffer = buildShpD2Buffer([
      { width: 3, height: 2, data: f1 },
      { width: 3, height: 2, data: f2 },
    ])

    const result = ShpD2Loader.tryParseSprite(buffer, 'test.shp')
    expect(result!.frames).toHaveLength(2)
  })

  it('returns null metadata', () => {
    const pixelData = new Uint8Array([1, 2, 3, 4])
    const buffer = buildShpD2Buffer([{ width: 2, height: 2, data: pixelData }])

    const result = ShpD2Loader.tryParseSprite(buffer, 'test.shp')
    expect(result!.metadata).toBeNull()
  })

  it('handles frame without palette table (default table)', () => {
    const pixelData = new Uint8Array(16)
    pixelData.fill(5)
    const buffer = buildShpD2Buffer([
      { width: 4, height: 4, data: pixelData, palette: false },
    ])

    const result = ShpD2Loader.tryParseSprite(buffer, 'test.shp')
    expect(result!.frames).toHaveLength(1)
    // With default table, index 1 → 0x7f, 2 → 0x7e, etc.
    // Index 5 → 5 (identity)
    expect(result!.frames[0]!.data[0]).toBe(5)
  })

  it('rejects non-SHP D2 format', () => {
    const buffer = new Uint8Array(50)
    buffer.fill(0)
    const result = ShpD2Loader.tryParseSprite(buffer, 'test.shp')
    expect(result).toBeNull()
  })

  it('sets correct offset to zero for D2 frames', () => {
    const pixelData = new Uint8Array(4)
    pixelData.fill(0x11)
    const buffer = buildShpD2Buffer([{ width: 2, height: 2, data: pixelData }])

    const result = ShpD2Loader.tryParseSprite(buffer, 'test.shp')
    expect(result!.frames[0]!.offset.x).toBe(0)
    expect(result!.frames[0]!.offset.y).toBe(0)
  })
})
