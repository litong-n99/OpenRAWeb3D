/**
 * LCWCompression.test.ts — LCW (Format80) compression unit tests
 */

import { describe, it, expect } from 'vitest'
import { LCWCompression } from './LCWCompression.js'

describe('LCWCompression', () => {
  // -----------------------------------------------------------------------
  // decodeInto
  // -----------------------------------------------------------------------

  describe('decodeInto', () => {
    it('handles case 1: raw copy with terminator', () => {
      // First byte 0x80 | 5 = 0x85: case 1, copy 5 bytes
      // Then 5 data bytes
      // Then terminator: 0x80 (case 1 with count=0 = terminator)
      const src = new Uint8Array([0x85, 10, 20, 30, 40, 50, 0x80])
      const dest = new Uint8Array(10)
      const result = LCWCompression.decodeInto(src, dest, 0)
      expect(result).toBe(5)
      expect(dest[0]).toBe(10)
      expect(dest[1]).toBe(20)
      expect(dest[4]).toBe(50)
      expect(dest[5]).toBe(0) // beyond result
    })

    it('handles case 2: back-reference copy', () => {
      // First fill dest with some data using case 1
      // Then use case 2 to copy from earlier in dest

      // Step 1: write "ABCD" to dest via case 1
      // 0x80 | 4 = 0x84
      // Step 2: case 2: 0x0X with secondByte
      // count=3+3=6, rpos = ((0&0xf)<<8) + secondByte = (0<<8)+4 = 4
      // This copies 6 bytes starting from destIndex-4

      const src = new Uint8Array([0x84, 0x41, 0x42, 0x43, 0x44, 0x00, 0x04, 0x80])
      // 0x84 = copy 4 bytes: 0x41, 0x42, 0x43, 0x44
      // 0x00 = case 2 with count bits=0 (count=3), offset bits=0
      // 0x04 = secondByte for rpos: rpos = (0<<8) | 4 = 4
      // Copies 3 bytes from destIndex-4 (back 4 positions)
      const dest = new Uint8Array(20)
      const result = LCWCompression.decodeInto(src, dest, 0)
      expect(result).toBe(7)
      expect(String.fromCharCode(dest[0])).toBe('A')
      expect(String.fromCharCode(dest[1])).toBe('B')
      expect(String.fromCharCode(dest[2])).toBe('C')
      expect(String.fromCharCode(dest[3])).toBe('D')
    })

    it('handles case 4: RLE fill (0xFE)', () => {
      // 0xFE: case 4, followed by word count (LE) and byte value
      // count=5, value=0x7a
      const src = new Uint8Array([0xFE, 5, 0, 0x7A, 0x80])
      const dest = new Uint8Array(10)
      const result = LCWCompression.decodeInto(src, dest, 0)
      expect(result).toBe(5)
      for (let i = 0; i < 5; i++) {
        expect(dest[i]).toBe(0x7a)
      }
    })

    it('handles simple encoded-then-decoded roundtrip', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5])
      const encoded = LCWCompression.encode(original)
      const decoded = new Uint8Array(original.length)
      const len = LCWCompression.decodeInto(encoded, decoded, 0)
      expect(len).toBe(original.length)
      expect(decoded.slice(0, len)).toEqual(original)
    })

    it('decodes data with repeated bytes efficiently', () => {
      // Create data with repeating pattern: "AAABBBCCC"
      const original = new Uint8Array(100)
      for (let i = 0; i < 100; i++) {
        original[i] = Math.floor(i / 10) * 25
      }
      const encoded = LCWCompression.encode(original)
      const decoded = new Uint8Array(original.length)
      const len = LCWCompression.decodeInto(encoded, decoded, 0)
      expect(len).toBe(original.length)
      expect(decoded.slice(0, len)).toEqual(original)
    })

    it('returns partial result if dest too small', () => {
      // In case 2, if destIndex + count > dest.length, returns current destIndex
      // Use a case 2 with large offset that would overflow dest
      const src = new Uint8Array([0x84, 0x41, 0x42, 0x43, 0x44, 0x37, 0x00, 0x80])
      // 0x84 = copy 4 bytes, then case 2: count=3+3=6, rpos=0
      const dest = new Uint8Array(5) // too small for 4+6 bytes
      const result = LCWCompression.decodeInto(src, dest, 0)
      // Should stop when destIndex + count > dest.length
      expect(result).toBeLessThanOrEqual(dest.length)
    })
  })

  // -----------------------------------------------------------------------
  // encode
  // -----------------------------------------------------------------------

  describe('encode', () => {
    it('encodes short unique data as raw copy blocks', () => {
      const data = new Uint8Array([1, 2, 3])
      const encoded = LCWCompression.encode(data)
      // Should have raw copy blocks + terminator
      expect(encoded.length).toBeGreaterThan(0)
      // Last byte should be 0x80 (terminator)
      expect(encoded[encoded.length - 1]).toBe(0x80)
    })

    it('compresses repeated bytes using RLE', () => {
      const data = new Uint8Array(10).fill(0x55)
      const encoded = LCWCompression.encode(data)
      // RLE should produce smaller output than source + overhead
      expect(encoded.length).toBeLessThan(data.length)
    })

    it('produces valid decodable output', () => {
      const original = new Uint8Array(200)
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256
      }
      const encoded = LCWCompression.encode(original)
      const decoded = new Uint8Array(original.length)
      const len = LCWCompression.decodeInto(encoded, decoded, 0)
      expect(len).toBe(original.length)
      expect(decoded).toEqual(original)
    })

    it('handles empty input', () => {
      const empty = new Uint8Array(0)
      const encoded = LCWCompression.encode(empty)
      // Should just have terminator
      expect(encoded.length).toBe(1)
      expect(encoded[0]).toBe(0x80)
    })

    it('handles single byte input', () => {
      const data = new Uint8Array([42])
      const encoded = LCWCompression.encode(data)
      const decoded = new Uint8Array(1)
      const len = LCWCompression.decodeInto(encoded, decoded, 0)
      expect(len).toBe(1)
      expect(decoded[0]).toBe(42)
    })
  })
})
