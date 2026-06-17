/**
 * R8Loader.test.ts — Dune 2000 R8 sprite loader unit tests
 *
 * Tests focus on: format detection, frame parsing (8-bit and 16-bit),
 * palette extraction, RemappableFrame BGRA conversion, and byte order correctness.
 */

import { describe, it, expect } from 'vitest'
import { R8Loader } from './R8Loader.js'
import { SpriteFrameType } from '../../OpenRA.Game/Graphics/SpriteLoader.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal R8 file
// ---------------------------------------------------------------------------

/**
 * Build an R8 file with specified frames.
 *
 * Each 8-bit frame:
 *   type(1) = 1 (has palette)
 *   width(4) LE
 *   height(4) LE
 *   x(4) LE
 *   y(4) LE
 *   imageHandle(4) = 0
 *   paletteHandle(4) = 1
 *   bpp(1) = 8
 *   frameHeight(1)
 *   frameWidth(1)
 *   alignment(1)
 *   pixelData(width*height)
 *   palette: header(8) + 256*2 bytes (RGB5551 packed)
 */
function buildR8Buffer(
  frames: { width: number; height: number; data: Uint8Array; bpp?: number }[],
): Uint8Array {
  let totalSize = 0
  const frameSizes: number[] = []

  for (const frame of frames) {
    const bpp = frame.bpp ?? 8
    let size = 25 // header up to alignment byte

    if (bpp === 16) {
      size += frame.width * frame.height * 2 // 16-bit pixel data
    } else {
      size += frame.width * frame.height // 8-bit pixel data
    }

    // Palette: type=1 + paletteHandle != 0 → 8 + 256*2 bytes
    size += 8 + 512

    frameSizes.push(size)
    totalSize += size
  }

  const buffer = new Uint8Array(totalSize)
  let offset = 0

  for (let fi = 0; fi < frames.length; fi++) {
    const frame = frames[fi]!
    const dv = new DataView(buffer.buffer, buffer.byteOffset + offset)
    const bpp = frame.bpp ?? 8
    const frameOff = offset // absolute start of this frame

    buffer[frameOff] = 1 // type = has palette
    dv.setInt32(frameOff + 1, frame.width, true)
    dv.setInt32(frameOff + 5, frame.height, true)
    dv.setInt32(frameOff + 9, frame.width / 2, true) // x = width/2 (center)
    dv.setInt32(frameOff + 13, frame.height / 2, true) // y = height/2
    dv.setUint32(frameOff + 17, 0, true) // imageHandle
    dv.setInt32(frameOff + 21, 1, true) // paletteHandle
    buffer[frameOff + 25] = bpp // bpp
    buffer[frameOff + 26] = frame.height // frameHeight
    buffer[frameOff + 27] = frame.width // frameWidth
    // alignment byte at 28
    offset = frameOff + 29 // past header + alignment

    // Pixel data
    if (bpp === 16) {
      // Write 16-bit packed pixels (simple white: 0xFFFF)
      for (let i = 0; i < frame.width * frame.height; i++) {
        buffer[offset + i * 2] = 0xff
        buffer[offset + i * 2 + 1] = 0xff
      }
      offset += frame.width * frame.height * 2
    } else {
      buffer.set(frame.data, offset)
      offset += frame.width * frame.height
    }

    // Palette: header (8 bytes) + 256 entries of 16-bit RGB5551
    // Palette header
    offset += 8

    // Write palette entries (all white for simplicity)
    for (let i = 0; i < 256; i++) {
      buffer[offset + i * 2] = 0xff
      buffer[offset + i * 2 + 1] = 0xff
    }
    offset += 512
  }

  return buffer
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('R8Loader', () => {
  it('rejects empty buffer', () => {
    const result = R8Loader.tryParseSprite(new Uint8Array(0), 'test.r8')
    expect(result).toBeNull()
  })

  it('rejects buffer starting with zero', () => {
    const buffer = new Uint8Array(30)
    buffer[0] = 0 // first byte must be non-zero
    const result = R8Loader.tryParseSprite(buffer, 'test.r8')
    expect(result).toBeNull()
  })

  it('rejects buffer with invalid bpp', () => {
    const buffer = new Uint8Array(30)
    buffer[0] = 1 // type=1
    buffer[25] = 4 // bpp=4 (invalid)
    const result = R8Loader.tryParseSprite(buffer, 'test.r8')
    expect(result).toBeNull()
  })

  it('parses a single 8-bit indexed frame', () => {
    const pixelData = new Uint8Array([1, 2, 3, 4])
    const buffer = buildR8Buffer([{ width: 2, height: 2, data: pixelData }])

    const result = R8Loader.tryParseSprite(buffer, 'test.r8')
    expect(result).not.toBeNull()
    expect(result!.frames).toHaveLength(1)
  })

  it('parses a single 16-bit frame', () => {
    const buffer = buildR8Buffer([
      { width: 2, height: 2, data: new Uint8Array(0), bpp: 16 },
    ])

    const result = R8Loader.tryParseSprite(buffer, 'test.r8')
    expect(result).not.toBeNull()
    expect(result!.frames).toHaveLength(1)
    expect(result!.frames[0]!.type).toBe(SpriteFrameType.Bgra32)
  })

  it('16-bit frame produces BGRA byte order', () => {
    // Test regression for BLOCKER R1: the byte order was RGBA, must be BGRA.
    // Build a 1x1 frame with known RGB5551 packed pixel, NO palette
    // (type=0 so frame is not wrapped in RemappableFrame).
    // Red=31=0x1F (bits 10-14), Green=0, Blue=0 → packed = 0x7C00.
    // Expected BGRA output: B=0x00, G=0x00, R=0xF8, A=0xFF.
    const width = 1
    const height = 1
    const totalSize = 29 + 2 // header(29) + 16-bit pixel data(2)
    const buffer = new Uint8Array(totalSize)

    const dv = new DataView(buffer.buffer)
    buffer[0] = 3 // type = 3 (no palette, not type 1 or 2)
    dv.setInt32(1, width, true)
    dv.setInt32(5, height, true)
    dv.setInt32(9, 0, true) // x = 0
    dv.setInt32(13, 0, true) // y = 0
    dv.setUint32(17, 0, true) // imageHandle
    dv.setInt32(21, 0, true) // paletteHandle = 0
    buffer[25] = 16 // bpp = 16
    buffer[26] = height // frameHeight
    buffer[27] = width // frameWidth
    // alignment byte at 28 = 0
    // Pixel data at offset 29: packed Red=31
    // RGB5551: R=31=0b11111, G=0, B=0 → packed = 0x7C00
    buffer[29] = 0x00 // low byte
    buffer[30] = 0x7C // high byte

    const result = R8Loader.tryParseSprite(buffer, 'test.r8')
    expect(result).not.toBeNull()
    const frame = result!.frames[0]!

    // 16-bit frame should be Bgra32 (not wrapped in RemappableFrame,
    // since palette is null)
    expect(frame.type).toBe(SpriteFrameType.Bgra32)
    expect(frame.data.length).toBe(4)

    // BGRA byte order: byte[0]=B, byte[1]=G, byte[2]=R, byte[3]=A
    expect(frame.data[0]).toBe(0x00) // Blue=0
    expect(frame.data[1]).toBe(0x00) // Green=0
    expect(frame.data[2]).toBe(0xf8) // Red=0xF8 (31 << 3)
    expect(frame.data[3]).toBe(0xff) // Alpha=255
  })

  it('returns null metadata', () => {
    const pixelData = new Uint8Array([1, 2, 3, 4])
    const buffer = buildR8Buffer([{ width: 2, height: 2, data: pixelData }])

    const result = R8Loader.tryParseSprite(buffer, 'test.r8')
    expect(result!.metadata).toBeNull()
  })

  it('wraps frames with palette in RemappableFrame (BGRA32)', () => {
    const pixelData = new Uint8Array(4)
    pixelData.fill(1) // all index 1
    const buffer = buildR8Buffer([{ width: 2, height: 2, data: pixelData }])

    const result = R8Loader.tryParseSprite(buffer, 'test.r8')
    const frame = result!.frames[0]!
    // Frame with palette should be wrapped in RemappableFrame (BGRA32 output)
    expect(frame.type).toBe(SpriteFrameType.Bgra32)
    expect(frame.data.length).toBe(16) // 4 pixels * 4 bytes
  })
})
