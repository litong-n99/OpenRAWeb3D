/**
 * PngHeader.test.ts -- PngHeader utility unit tests
 *
 * Tests focus on: valid PNG header parsing, invalid signature detection,
 * boundary checks on data length, edge cases.
 */

import { describe, it, expect } from 'vitest'
import { parsePngDimensions } from './PngHeader.js'

// ---------------------------------------------------------------------------
// Helper: create a minimal valid PNG IHDR block
// ---------------------------------------------------------------------------

/**
 * 创建一个最简 PNG 字节数组（仅签名 + IHDR 块，无像素数据）。
 * 这对解析器足够 —— 只需要前 24 字节。
 */
function makeMinimalPng(width: number, height: number): Uint8Array {
  const data = new Uint8Array(33) // 8 sig + 4 len + 4 IHDR + 13 data + 4 CRC
  // PNG 签名
  data[0] = 0x89
  data[1] = 0x50
  data[2] = 0x4e
  data[3] = 0x47
  data[4] = 0x0d
  data[5] = 0x0a
  data[6] = 0x1a
  data[7] = 0x0a
  // IHDR 长度 = 13（大端序）
  data[8] = 0
  data[9] = 0
  data[10] = 0
  data[11] = 13
  // "IHDR" ASCII
  data[12] = 0x49 // I
  data[13] = 0x48 // H
  data[14] = 0x44 // D
  data[15] = 0x52 // R
  // 宽度（大端序）
  data[16] = (width >> 24) & 0xff
  data[17] = (width >> 16) & 0xff
  data[18] = (width >> 8) & 0xff
  data[19] = width & 0xff
  // 高度（大端序）
  data[20] = (height >> 24) & 0xff
  data[21] = (height >> 16) & 0xff
  data[22] = (height >> 8) & 0xff
  data[23] = height & 0xff
  // 其余 9 字节 IHDR 数据 (bit depth, color type, etc.)
  data[24] = 8 // bit depth
  data[25] = 2 // color type (RGB)
  data[26] = 0 // compression
  data[27] = 0 // filter
  data[28] = 0 // interlace
  // IHDR CRC (placeholder)
  return data
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parsePngDimensions', () => {
  it('parses width and height from a valid PNG header', () => {
    const png = makeMinimalPng(128, 64)
    const result = parsePngDimensions(png)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(128)
    expect(result!.height).toBe(64)
  })

  it('parses a small PNG (1x1)', () => {
    const png = makeMinimalPng(1, 1)
    const result = parsePngDimensions(png)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(1)
    expect(result!.height).toBe(1)
  })

  it('parses a large PNG (256x256)', () => {
    const png = makeMinimalPng(256, 256)
    const result = parsePngDimensions(png)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(256)
    expect(result!.height).toBe(256)
  })

  it('returns null for empty data', () => {
    const result = parsePngDimensions(new Uint8Array(0))
    expect(result).toBeNull()
  })

  it('returns null for data shorter than 24 bytes', () => {
    const result = parsePngDimensions(new Uint8Array(23))
    expect(result).toBeNull()
  })

  it('returns null for exactly 24 bytes with invalid signature', () => {
    const data = new Uint8Array(24)
    // All zeros — not a valid PNG signature
    const result = parsePngDimensions(data)
    expect(result).toBeNull()
  })

  it('returns null when PNG signature is incorrect', () => {
    const png = makeMinimalPng(100, 100)
    // Corrupt the signature
    png[0] = 0x00
    const result = parsePngDimensions(png)
    expect(result).toBeNull()
  })

  it('returns null when IHDR tag is not "IHDR"', () => {
    const png = makeMinimalPng(100, 100)
    // Corrupt the IHDR tag
    png[12] = 0x00 // change 'I' to null byte
    const result = parsePngDimensions(png)
    expect(result).toBeNull()
  })

  it('returns null when IHDR length is not 13', () => {
    const png = makeMinimalPng(100, 100)
    // Corrupt IHDR length
    png[11] = 99
    const result = parsePngDimensions(png)
    expect(result).toBeNull()
  })

  // NOTE: JavaScript 位运算产生有符号 32 位整数，因此 0xFFFFFFFF 变为 -1。
  // 实际 PNG IHDR 尺寸限制为 2^31-1 (2147483647)，该值可正确处理。
  it('handles max valid PNG dimensions (2147483647 x 2147483647)', () => {
    const maxDim = 2147483647 // 2^31 - 1, valid PNG max
    const png = makeMinimalPng(maxDim, maxDim)
    const result = parsePngDimensions(png)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(maxDim)
    expect(result!.height).toBe(maxDim)
  })

  it('parses dimensions correctly when data is longer than 24 bytes', () => {
    // This simulates a real PNG with pixel data after the header
    const png = makeMinimalPng(200, 150)
    // Append extra data (fake pixel data)
    const extended = new Uint8Array(png.length + 100)
    extended.set(png)
    // Fill extra bytes with data
    for (let i = png.length; i < extended.length; i++) {
      extended[i] = i & 0xff
    }
    const result = parsePngDimensions(extended)
    expect(result).not.toBeNull()
    expect(result!.width).toBe(200)
    expect(result!.height).toBe(150)
  })

  it('returns null for non-PNG data (e.g., raw text)', () => {
    const textEncoder = new TextEncoder()
    const text = textEncoder.encode('This is not a PNG file')
    const result = parsePngDimensions(text)
    expect(result).toBeNull()
  })
})
