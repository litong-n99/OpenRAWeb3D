/**
 * ShpRemasteredLoader.test.ts — Remastered SHP loader unit tests
 *
 * Tests focus on: ZIP file detection, frame prefix matching, TGA frame
 * decoding, meta JSON cropping.
 */

import { describe, it, expect } from 'vitest'
import { ShpRemasteredLoader } from './ShpRemasteredLoader.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal ZIP file in buffer
// ---------------------------------------------------------------------------

/**
 * Build a minimal ZIP file with stored (uncompressed) TGA frame entries.
 *
 * ZIP Local File Header format:
 *   signature(4) = 0x04034b50
 *   version(2) = 20
 *   flags(2) = 0
 *   compression(2) = 0 (stored)
 *   modTime(2) = 0
 *   modDate(2) = 0
 *   crc32(4) = 0
 *   compressedSize(4)
 *   uncompressedSize(4)
 *   nameLength(2)
 *   extraLength(2) = 0
 *   filename(variable)
 *   data(variable)
 *
 * TGA Header (minimal 18 bytes for 32-bit BGRA):
 *   idLength(1) = 0
 *   colorMapType(1) = 0
 *   imageType(1) = 2 (uncompressed truecolor)
 *   colorMapSpec(5) = 0
 *   xOrigin(2) = 0
 *   yOrigin(2) = 0
 *   width(2) LE
 *   height(2) LE
 *   bpp(1) = 32
 *   imageDescriptor(1) = 0x20 (top-left origin)
 */
function buildMinimalTgaData(width: number, height: number): Uint8Array {
  const pixelDataSize = width * height * 4
  const tga = new Uint8Array(18 + pixelDataSize)
  tga[2] = 2 // imageType = uncompressed truecolor
  const dv = new DataView(tga.buffer)
  dv.setUint16(12, width, true)
  dv.setUint16(14, height, true)
  tga[16] = 32 // 32 bpp
  tga[17] = 0x20 // top-left origin
  // Fill pixel data with a gradient
  for (let i = 0; i < pixelDataSize; i += 4) {
    tga[18 + i] = i % 256 // B
    tga[18 + i + 1] = (i + 1) % 256 // G
    tga[18 + i + 2] = (i + 2) % 256 // R
    tga[18 + i + 3] = 255 // A
  }
  return tga
}

function buildZipFile(
  entries: { name: string; data: Uint8Array }[],
): Uint8Array {
  const localHeaders: Uint8Array[] = []
  let totalSize = 0

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name)
    const header = new Uint8Array(30 + nameBytes.length + entry.data.length)
    const dv = new DataView(header.buffer)

    dv.setUint32(0, 0x04034b50, true) // signature
    dv.setUint16(4, 20, true) // version
    // flags = 0
    dv.setUint16(8, 0, true) // compression = stored
    // modTime/modDate = 0
    dv.setUint32(14, 0, true) // crc32 = 0
    dv.setUint32(18, entry.data.length, true) // compressedSize
    dv.setUint32(22, entry.data.length, true) // uncompressedSize
    dv.setUint16(26, nameBytes.length, true) // nameLength
    // extraLength = 0
    header.set(nameBytes, 30)
    header.set(entry.data, 30 + nameBytes.length)

    localHeaders.push(header)
    totalSize += header.length
  }

  const buffer = new Uint8Array(totalSize)
  let offset = 0
  for (const h of localHeaders) {
    buffer.set(h, offset)
    offset += h.length
  }

  return buffer
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShpRemasteredLoader', () => {
  it('rejects empty buffer', () => {
    const result = ShpRemasteredLoader.tryParseSprite(
      new Uint8Array(0),
      'test.zip',
    )
    expect(result).toBeNull()
  })

  it('rejects non-ZIP data', () => {
    const buffer = new Uint8Array(20)
    buffer.fill(0xff)
    const result = ShpRemasteredLoader.tryParseSprite(
      buffer,
      'test.bin',
    )
    expect(result).toBeNull()
  })

  it('parses a single-frame remastered SHP (ZIP with TGA)', () => {
    const tgaData = buildMinimalTgaData(4, 4)
    const zipBuf = buildZipFile([
      { name: 'test_0000.tga', data: tgaData },
    ])

    const result = ShpRemasteredLoader.tryParseSprite(zipBuf, 'test.zip')
    expect(result).not.toBeNull()
    expect(result!.frames).toHaveLength(1)
  })

  it('parses multi-frame remastered SHP', () => {
    const tga1 = buildMinimalTgaData(4, 4)
    const tga2 = buildMinimalTgaData(4, 4)
    const zipBuf = buildZipFile([
      { name: 'unit_0000.tga', data: tga1 },
      { name: 'unit_0001.tga', data: tga2 },
    ])

    const result = ShpRemasteredLoader.tryParseSprite(zipBuf, 'test.zip')
    expect(result!.frames).toHaveLength(2)
  })

  it('handles missing frames (inserts blank frames)', () => {
    const tga = buildMinimalTgaData(4, 4)
    const zipBuf = buildZipFile([
      { name: 'sprite_0000.tga', data: tga },
      // 0001 is missing
      { name: 'sprite_0002.tga', data: tga },
    ])

    const result = ShpRemasteredLoader.tryParseSprite(zipBuf, 'test.zip')
    expect(result!.frames).toHaveLength(3)
    // frame[1] should be blank
    expect(result!.frames[1]!.data.length).toBe(0)
  })

  it('returns null metadata', () => {
    const tga = buildMinimalTgaData(4, 4)
    const zipBuf = buildZipFile([
      { name: 'test_0000.tga', data: tga },
    ])

    const result = ShpRemasteredLoader.tryParseSprite(zipBuf, 'test.zip')
    expect(result!.metadata).toBeNull()
  })

  it('returns Bgra32 frame type for TGA data', () => {
    const tga = buildMinimalTgaData(2, 2)
    const zipBuf = buildZipFile([
      { name: 'test_0000.tga', data: tga },
    ])

    const result = ShpRemasteredLoader.tryParseSprite(zipBuf, 'test.zip')
    expect(result!.frames[0]!.type).toBe(1) // Bgra32
  })

  it('ignores non-TGA files in ZIP', () => {
    const tga = buildMinimalTgaData(2, 2)
    const zipBuf = buildZipFile([
      { name: 'readme.txt', data: new Uint8Array([0x48, 0x49]) },
      { name: 'sprite_0000.tga', data: tga },
    ])

    const result = ShpRemasteredLoader.tryParseSprite(zipBuf, 'test.zip')
    expect(result!.frames).toHaveLength(1)
  })

  it('parses TGA with meta JSON cropping', () => {
    const tga = buildMinimalTgaData(8, 8)
    const metaJson = '{"size":[8,8],"crop":[1,1,6,6]}'
    const metaBytes = new TextEncoder().encode(metaJson)

    const zipBuf = buildZipFile([
      { name: 'sprite_0000.tga', data: tga },
      { name: 'sprite_0000.meta', data: metaBytes },
    ])

    const result = ShpRemasteredLoader.tryParseSprite(zipBuf, 'test.zip')
    expect(result!.frames).toHaveLength(1)
    const frame = result!.frames[0]!
    // Crop from [1,1] to [6,6] = 6x6 effective area
    expect(frame.size.width).toBe(6)
    expect(frame.size.height).toBe(6)
    expect(frame.frameSize.width).toBe(8)
    expect(frame.frameSize.height).toBe(8)
  })
})
