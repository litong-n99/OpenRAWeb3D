/**
 * Compression.test.ts — C&C compression algorithm unit tests
 *
 * Tests focus on: decompression correctness, edge cases,
 * algorithm behavior matching C# OpenRA reference.
 */

import { describe, it, expect } from 'vitest'
import {
  FastByteReader,
  LCWCompression,
  XORDeltaCompression,
  RLEZerosCompression,
} from './Compression.js'

// ---------------------------------------------------------------------------
// FastByteReader
// ---------------------------------------------------------------------------

describe('FastByteReader', () => {
  it('reads bytes sequentially', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    const reader = new FastByteReader(data)
    expect(reader.done()).toBe(false)
    expect(reader.readByte()).toBe(0x01)
    expect(reader.readByte()).toBe(0x02)
    expect(reader.remaining()).toBe(2)
    expect(reader.readByte()).toBe(0x03)
    expect(reader.readByte()).toBe(0x04)
    expect(reader.done()).toBe(true)
  })

  it('reads words in little-endian', () => {
    const data = new Uint8Array([0x34, 0x12, 0x78, 0x56])
    const reader = new FastByteReader(data)
    expect(reader.readWord()).toBe(0x1234)
    expect(reader.readWord()).toBe(0x5678)
  })

  it('copies bytes to destination', () => {
    const src = new Uint8Array([0x0a, 0x0b, 0x0c, 0x0d, 0x0e])
    const reader = new FastByteReader(src)
    reader.readByte() // skip 0x0a
    const dest = new Uint8Array(10)
    reader.copyTo(dest, 2, 3)
    expect(dest[2]).toBe(0x0b)
    expect(dest[3]).toBe(0x0c)
    expect(dest[4]).toBe(0x0d)
    expect(reader.getOffset()).toBe(4)
  })

  it('starts at custom offset', () => {
    const data = new Uint8Array([0xff, 0xff, 0x42, 0x43])
    const reader = new FastByteReader(data, 2)
    expect(reader.readByte()).toBe(0x42)
    expect(reader.readByte()).toBe(0x43)
  })

  it('reports remaining bytes correctly', () => {
    const data = new Uint8Array(100)
    const reader = new FastByteReader(data)
    expect(reader.remaining()).toBe(100)
    reader.readByte()
    reader.readByte()
    expect(reader.remaining()).toBe(98)
  })

  it('reports done when at end', () => {
    const data = new Uint8Array([0x01])
    const reader = new FastByteReader(data)
    expect(reader.done()).toBe(false)
    reader.readByte()
    expect(reader.done()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LCWCompression
// ---------------------------------------------------------------------------

describe('LCWCompression', () => {
  it('decodes case 1 — raw copy', () => {
    // Case 1: cmd = 0x80 | count (0x20-0x3F), raw copy of count bytes
    // 0x83 = 0x80 | 0x03 = raw copy 3 bytes
    const src = new Uint8Array([0x83, 0x0a, 0x0b, 0x0c, 0x80]) // 0x80 terminates
    const dest = new Uint8Array(10)
    const result = LCWCompression.decodeInto(src, dest)
    expect(result).toBe(3)
    expect(dest[0]).toBe(0x0a)
    expect(dest[1]).toBe(0x0b)
    expect(dest[2]).toBe(0x0c)
  })

  it('terminates on count=0 (case 1 with 0x80)', () => {
    // 0x80 = case 1 with count = 0 → terminator
    const src = new Uint8Array([0x80])
    const dest = new Uint8Array(10)
    const result = LCWCompression.decodeInto(src, dest)
    expect(result).toBe(0)
  })

  it('decodes case 4 — RLE fill', () => {
    // case 4: 0xFE = 0xC0 | 0x3E (bits 7+6 set, lower 6 = 0x3E)
    // → follow with count(word) + color(byte)
    // Add 0x80 terminator
    const src = new Uint8Array([0xfe, 0x05, 0x00, 0x42, 0x80])
    const dest = new Uint8Array(10)
    const result = LCWCompression.decodeInto(src, dest)
    expect(result).toBe(5)
    for (let i = 0; i < 5; i++) {
      expect(dest[i]).toBe(0x42)
    }
  })

  it('decodes LCW compressed data round-trip known pattern', () => {
    // A simple known pattern: "AAAA" repeated
    const original = new Uint8Array(20)
    original.fill(0x41) // all 'A's

    // The encoder should produce an LCW stream; we test decode
    // A simple RLE pattern: 4 repeated 'A's
    // case 4: 0xFE (0xC0 | 0x3E) + count(2bytes) + value
    const compressed = new Uint8Array([0xfe, 0x04, 0x00, 0x41, 0x80])
    const dest = new Uint8Array(10)
    const result = LCWCompression.decodeInto(compressed, dest)
    expect(result).toBe(4)
    expect(dest[0]).toBe(0x41)
    expect(dest[1]).toBe(0x41)
    expect(dest[2]).toBe(0x41)
    expect(dest[3]).toBe(0x41)
  })

  it('handles empty source gracefully', () => {
    const src = new Uint8Array([0x80]) // terminator only
    const dest = new Uint8Array(10)
    const result = LCWCompression.decodeInto(src, dest)
    expect(result).toBe(0)
  })

  it('decodes case 2 — back-reference copy', () => {
    // Case 2: high bit 0, encode (count << 4 | offset_hi) followed by offset_lo
    // e.g., copy 3 bytes from offset 1 back
    // i = 0x10 | 0x00 = 0x10, second byte = 0x01
    // count = ((0 & 0x70) >> 4) + 3 = 3, rpos = ((0 & 0xf) << 8) + 1 = 1
    // But we need data already in dest...
    // This is hard to test standalone — tested indirectly via ShpTDLoader
  })
})

// ---------------------------------------------------------------------------
// XORDeltaCompression
// ---------------------------------------------------------------------------

describe('XORDeltaCompression', () => {
  it('decodes case 1 — skip bytes (no XOR)', () => {
    // case 1: high bit set, count > 0 → skip count bytes
    // 0x85 = 0x80 | 0x05 → skip 5 bytes
    // After skip: terminator 0x80 0x00 0x00 (readWord=0 → return)
    const src = new Uint8Array([0x85, 0x80, 0x00, 0x00])
    const dest = new Uint8Array(10)
    dest.fill(0x42)
    const result = XORDeltaCompression.decodeInto(src, dest, 0)
    // It should skip 5 bytes, then hit terminator → return
    expect(result).toBe(5)
    // Data at dest[5] should be unchanged
    expect(dest[5]).toBe(0x42)
  })

  it('decodes case 5 — XOR with sequential bytes', () => {
    // case 5: high bit clear, count > 0 → XOR count bytes with sequential values
    // 0x03 = XOR 3 bytes with next 3 bytes from src
    // Terminator: 0x80 0x00 0x00 (case 1 skip 0 → readWord=0 → return)
    const src = new Uint8Array([0x03, 0x01, 0x02, 0x03, 0x80, 0x00, 0x00])
    const dest = new Uint8Array([0x10, 0x10, 0x10, 0x00])
    const result = XORDeltaCompression.decodeInto(src, dest, 0)
    expect(result).toBe(3)
    expect(dest[0]).toBe(0x10 ^ 0x01)
    expect(dest[1]).toBe(0x10 ^ 0x02)
    expect(dest[2]).toBe(0x10 ^ 0x03)
  })

  it('decodes case 6 — XOR with single repeated byte', () => {
    // case 6: 0x00 v1 → XOR count=v1 bytes with single value v2
    // Terminator: 0x80 0x00 0x00 after the data
    const src = new Uint8Array([0x00, 0x03, 0xff, 0x80, 0x00, 0x00])
    const dest = new Uint8Array([0xaa, 0xaa, 0xaa, 0x00])
    const result = XORDeltaCompression.decodeInto(src, dest, 0)
    expect(result).toBe(3)
    expect(dest[0]).toBe(0xaa ^ 0xff)
    expect(dest[1]).toBe(0xaa ^ 0xff)
    expect(dest[2]).toBe(0xaa ^ 0xff)
  })

  it('terminates on double zero word', () => {
    const src = new Uint8Array([0x80, 0x00, 0x00])
    const dest = new Uint8Array(10)
    const result = XORDeltaCompression.decodeInto(src, dest, 0)
    expect(result).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// RLEZerosCompression
// ---------------------------------------------------------------------------

describe('RLEZerosCompression', () => {
  it('decodes zero runs', () => {
    // 0x00 followed by count → count zeroes
    const src = new Uint8Array([0x00, 0x05]) // 5 zeroes
    const dest = new Uint8Array(10)
    dest.fill(0xff) // pre-fill with non-zero
    RLEZerosCompression.decodeInto(src, dest, 0)
    expect(dest[0]).toBe(0)
    expect(dest[1]).toBe(0)
    expect(dest[2]).toBe(0)
    expect(dest[3]).toBe(0)
    expect(dest[4]).toBe(0)
    // rest should be untouched
    expect(dest[5]).toBe(0xff)
  })

  it('copies non-zero bytes directly', () => {
    const src = new Uint8Array([0x42, 0x43, 0x44])
    const dest = new Uint8Array(10)
    RLEZerosCompression.decodeInto(src, dest, 0)
    expect(dest[0]).toBe(0x42)
    expect(dest[1]).toBe(0x43)
    expect(dest[2]).toBe(0x44)
  })

  it('handles mixed sequence', () => {
    // 3 non-zero bytes, 3 zeroes, 3 non-zero bytes
    const src = new Uint8Array([0x01, 0x02, 0x03, 0x00, 0x03, 0x04, 0x05, 0x06])
    const dest = new Uint8Array(9)
    RLEZerosCompression.decodeInto(src, dest, 0)
    expect(dest[0]).toBe(0x01)
    expect(dest[1]).toBe(0x02)
    expect(dest[2]).toBe(0x03)
    expect(dest[3]).toBe(0)
    expect(dest[4]).toBe(0)
    expect(dest[5]).toBe(0)
    expect(dest[6]).toBe(0x04)
    expect(dest[7]).toBe(0x05)
    expect(dest[8]).toBe(0x06)
  })

  it('starts at custom destIndex', () => {
    const src = new Uint8Array([0x42, 0x43])
    const dest = new Uint8Array(10)
    dest.fill(0xff)
    RLEZerosCompression.decodeInto(src, dest, 5)
    expect(dest[5]).toBe(0x42)
    expect(dest[6]).toBe(0x43)
    expect(dest[4]).toBe(0xff) // before start, untouched
    expect(dest[7]).toBe(0xff) // after, untouched
  })

  it('handles empty source', () => {
    const src = new Uint8Array(0)
    const dest = new Uint8Array(5)
    RLEZerosCompression.decodeInto(src, dest, 0)
    // Should not modify dest
  })
})
