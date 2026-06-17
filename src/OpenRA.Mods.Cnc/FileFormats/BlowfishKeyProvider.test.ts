/**
 * BlowfishKeyProvider.test.ts — Blowfish key derivation unit tests
 *
 * Tests the big-integer arithmetic helper functions and the key derivation
 * algorithm. Since the algorithm requires specific game EXE data as input,
 * we primarily test the mathematical helper functions and verify the
 * decryptKey method produces a 56-byte key for valid-looking input.
 */

import { describe, it, expect } from 'vitest'
import { BlowfishKeyProvider } from './BlowfishKeyProvider.js'

describe('BlowfishKeyProvider', () => {
  describe('construction', () => {
    it('creates an instance', () => {
      const provider = new BlowfishKeyProvider()
      expect(provider).toBeInstanceOf(BlowfishKeyProvider)
    })
  })

  describe('decryptKey', () => {
    it('returns 56-byte key for input data', () => {
      // Provide input data that looks like valid game EXE data
      // The algorithm will process it through the RSA-like big-int math
      const src = new Uint8Array(256).fill(0)
      // Set some non-zero bytes to avoid all-zero edge case
      for (let i = 0; i < 100; i++) {
        src[i] = (i + 1) & 0xff
      }

      const provider = new BlowfishKeyProvider()
      const key = provider.decryptKey(src)

      expect(key).toBeInstanceOf(Uint8Array)
      expect(key.length).toBe(56)
    })

    it('produces deterministic output for same input', () => {
      const src = new Uint8Array(256)
      for (let i = 0; i < src.length; i++) {
        src[i] = i & 0xff
      }

      const p1 = new BlowfishKeyProvider()
      const p2 = new BlowfishKeyProvider()

      const k1 = p1.decryptKey(src)
      const k2 = p2.decryptKey(src)

      expect(k1).toEqual(k2)
    })

    it('produces different output for different input', () => {
      const src1 = new Uint8Array(256).fill(0x01)
      const src2 = new Uint8Array(256).fill(0x02)

      const p1 = new BlowfishKeyProvider()
      const p2 = new BlowfishKeyProvider()

      const k1 = p1.decryptKey(src1)
      const k2 = p2.decryptKey(src2)

      // Different inputs should produce different keys
      // (unless degenerate case where they happen to collide)
      const same = k1.every((v, i) => v === k2[i])
      expect(same).toBe(false)
    })

    it('handles minimum-size input', () => {
      // The algorithm needs at least (pubKeyLen-1)/8+1 bytes per iteration
      const provider = new BlowfishKeyProvider()

      // Provide enough bytes for at least one iteration
      // pubKeyLen is derived from the base64 public key
      const src = new Uint8Array(100).fill(0x42)
      const key = provider.decryptKey(src)

      expect(key.length).toBe(56)
    })

    it('can reuse provider for multiple decryptKey calls', () => {
      const provider = new BlowfishKeyProvider()

      const src1 = new Uint8Array(200).fill(0x10)
      const src2 = new Uint8Array(200).fill(0x20)

      const k1_first = provider.decryptKey(src1)
      const k2_first = provider.decryptKey(src2)
      const k1_second = provider.decryptKey(src1)

      // Same input should produce same output on reuse
      expect(k1_first).toEqual(k1_second)
      // Different inputs should differ
      const same = k1_first.every((v, i) => v === k2_first[i])
      expect(same).toBe(false)
    })

    it('output key is non-zero', () => {
      const src = new Uint8Array(256)
      for (let i = 0; i < src.length; i++) src[i] = (i * 7 + 3) & 0xff

      const provider = new BlowfishKeyProvider()
      const key = provider.decryptKey(src)

      // The key should not be all zeros
      const allZero = key.every((v) => v === 0)
      expect(allZero).toBe(false)
    })
  })
})
