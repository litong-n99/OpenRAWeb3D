/**
 * FastByteReader.test.ts — FastByteReader unit tests
 */

import { describe, it, expect } from 'vitest'
import { FastByteReader } from './FastByteReader.js'

describe('FastByteReader', () => {
  describe('construction', () => {
    it('creates with default offset 0', () => {
      const src = new Uint8Array([1, 2, 3])
      const reader = new FastByteReader(src)
      expect(reader.done()).toBe(false)
      expect(reader.remaining()).toBe(3)
    })

    it('creates with explicit offset', () => {
      const src = new Uint8Array([1, 2, 3, 4])
      const reader = new FastByteReader(src, 2)
      expect(reader.remaining()).toBe(2)
    })
  })

  describe('readByte', () => {
    it('reads sequential bytes', () => {
      const src = new Uint8Array([10, 20, 30])
      const reader = new FastByteReader(src)
      expect(reader.readByte()).toBe(10)
      expect(reader.readByte()).toBe(20)
      expect(reader.readByte()).toBe(30)
    })

    it('advances offset after each read', () => {
      const src = new Uint8Array([5, 10])
      const reader = new FastByteReader(src)
      expect(reader.remaining()).toBe(2)
      reader.readByte()
      expect(reader.remaining()).toBe(1)
    })
  })

  describe('readWord', () => {
    it('reads little-endian uint16', () => {
      // 0x41 + (0x02 << 8) = 0x0241 = 577
      const src = new Uint8Array([0x41, 0x02])
      const reader = new FastByteReader(src)
      expect(reader.readWord()).toBe(0x0241)
    })

    it('reads max uint16', () => {
      const src = new Uint8Array([0xff, 0xff])
      const reader = new FastByteReader(src)
      expect(reader.readWord()).toBe(0xffff)
    })

    it('advances by 2', () => {
      const src = new Uint8Array([0, 1, 2, 3])
      const reader = new FastByteReader(src)
      reader.readWord()
      expect(reader.remaining()).toBe(2)
    })
  })

  describe('copyTo', () => {
    it('copies bytes to destination', () => {
      const src = new Uint8Array([10, 20, 30, 40])
      const reader = new FastByteReader(src, 1)
      const dest = new Uint8Array(4)
      reader.copyTo(dest, 0, 3)
      expect(dest[0]).toBe(20)
      expect(dest[1]).toBe(30)
      expect(dest[2]).toBe(40)
      expect(dest[3]).toBe(0) // not touched
    })

    it('advances offset after copy', () => {
      const src = new Uint8Array([1, 2, 3, 4, 5])
      const reader = new FastByteReader(src)
      const dest = new Uint8Array(3)
      reader.copyTo(dest, 0, 3)
      expect(reader.remaining()).toBe(2)
    })
  })

  describe('done', () => {
    it('returns false when data remains', () => {
      const reader = new FastByteReader(new Uint8Array([1]))
      expect(reader.done()).toBe(false)
    })

    it('returns true when all data consumed', () => {
      const reader = new FastByteReader(new Uint8Array([1]))
      reader.readByte()
      expect(reader.done()).toBe(true)
    })

    it('returns true for empty source', () => {
      const reader = new FastByteReader(new Uint8Array(0))
      expect(reader.done()).toBe(true)
    })
  })
})
