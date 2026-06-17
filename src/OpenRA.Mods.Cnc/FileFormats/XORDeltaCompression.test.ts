/**
 * XORDeltaCompression.test.ts — XOR delta decompression unit tests
 */

import { describe, it, expect } from 'vitest'
import { XORDeltaCompression } from './XORDeltaCompression.js'

describe('XORDeltaCompression', () => {
  describe('decodeInto', () => {
    it('handles case 1: skip bytes (0x80-0xFF, count > 0)', () => {
      // 0x80 | 5 = 0x85: skip 5 bytes
      // Following byte 0x00: terminator (count=0, then readWord=0)
      // Actually: first readByte = 0x85, count = 5 (case 1), skip 5
      // then next readByte, need a terminator.
      // Terminator: 0x80 with count 0 -> readWord = 0
      const src = new Uint8Array([0x85, 0x80, 0x00])
      const dest = new Uint8Array(10).fill(0xaa)
      const result = XORDeltaCompression.decodeInto(src, dest, 0)
      // Skipped 5 bytes, then terminated. First 5 bytes unchanged, destIndex=5
      expect(result).toBe(5)
      expect(dest[0]).toBe(0xaa)
      expect(dest[4]).toBe(0xaa)
    })

    it('handles case 5: XOR count bytes from stream', () => {
      // 0x02 = 2 bytes to XOR from stream
      const src = new Uint8Array([0x02, 0x0f, 0xf0, 0x80, 0x00])
      const dest = new Uint8Array([0x00, 0x00, 0x00])
      const result = XORDeltaCompression.decodeInto(src, dest, 0)
      expect(result).toBe(2)
      expect(dest[0]).toBe(0x0f)
      expect(dest[1]).toBe(0xf0)
      expect(dest[2]).toBe(0x00) // not touched
    })

    it('handles case 6: XOR same value count times', () => {
      // First byte 0x00 (low, count=0) -> case 6
      // Then next byte = count=3, next byte = value=0x55
      const src = new Uint8Array([0x00, 0x03, 0x55, 0x80, 0x00])
      const dest = new Uint8Array([0xaa, 0xaa, 0xaa, 0x00])
      const result = XORDeltaCompression.decodeInto(src, dest, 0)
      expect(result).toBe(3)
      // 0xaa ^ 0x55 = 0xff
      expect(dest[0]).toBe(0xff)
      expect(dest[1]).toBe(0xff)
      expect(dest[2]).toBe(0xff)
      expect(dest[3]).toBe(0x00) // not touched
    })

    it('handles case 3: XOR count bytes from stream (extended)', () => {
      // First byte 0x80 (high, count=0) -> readWord = count
      // count = 0x8002 (bit 15 set, bit 14 clear) -> case 3 for 2 bytes
      const src = new Uint8Array([0x80, 0x02, 0x80, 0x11, 0x22, 0x80, 0x00])
      const dest = new Uint8Array([0x00, 0x00, 0x00])
      const result = XORDeltaCompression.decodeInto(src, dest, 0)
      // count = 0x8002 -> case 3 with 0x3fff & 0x8002 = 0x0002
      expect(result).toBe(2)
    })

    it('handles XOR of existing dest data (delta overlay)', () => {
      // XOR stream bytes onto pre-existing dest
      // 3 stream bytes to XOR (case 5)
      const src = new Uint8Array([0x03, 0x0f, 0x0f, 0x0f, 0x80, 0x00])
      const dest = new Uint8Array([0xf0, 0xf0, 0xf0, 0xf0])
      const result = XORDeltaCompression.decodeInto(src, dest, 0)
      expect(result).toBe(3)
      // 0xf0 ^ 0x0f = 0xff
      expect(dest[0]).toBe(0xff)
      expect(dest[1]).toBe(0xff)
      expect(dest[2]).toBe(0xff)
      expect(dest[3]).toBe(0xf0) // not touched
    })

    it('terminates on zero word count', () => {
      const src = new Uint8Array([0x80, 0x00, 0x00])
      const dest = new Uint8Array(10)
      const result = XORDeltaCompression.decodeInto(src, dest, 0)
      expect(result).toBe(0)
    })

    it('handles empty stream', () => {
      // Stream must have at least 1 byte to start
      const src = new Uint8Array([0x80, 0x00, 0x00])
      const dest = new Uint8Array(5)
      const result = XORDeltaCompression.decodeInto(src, dest, 0)
      expect(result).toBe(0)
    })

    it('uses srcOffset correctly', () => {
      // Skip first 2 bytes of src
      const src = new Uint8Array([0xff, 0xff, 0x03, 0x0a, 0x0b, 0x0c, 0x80, 0x00])
      const dest = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      const result = XORDeltaCompression.decodeInto(src, dest, 2)
      expect(result).toBe(3)
      expect(dest[0]).toBe(0x0a)
    })
  })
})
