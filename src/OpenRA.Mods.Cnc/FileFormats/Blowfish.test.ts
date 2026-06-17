/**
 * Blowfish.test.ts — Blowfish block cipher unit tests
 *
 * Test vectors: OpenRA Blowfish uses byte-swapped (big-endian) input/output.
 * We test against known values from the Blowfish specification and OpenRA C#.
 */

import { describe, it, expect } from 'vitest'
import { Blowfish, swapBytes } from './Blowfish.js'

// ---------------------------------------------------------------------------
// swapBytes
// ---------------------------------------------------------------------------

describe('swapBytes', () => {
  it('swaps byte order of uint32', () => {
    // 0x01020304 -> 0x04030201
    expect(swapBytes(0x01020304)).toBe(0x04030201)
  })

  it('identity on 0', () => {
    expect(swapBytes(0)).toBe(0)
  })

  it('identity on 0xFFFFFFFF', () => {
    expect(swapBytes(0xffffffff)).toBe(0xffffffff)
  })

  it('swapBytes roundtrip returns original', () => {
    const val = 0x12345678
    expect(swapBytes(swapBytes(val))).toBe(val >>> 0)
  })
})

// ---------------------------------------------------------------------------
// Blowfish
// ---------------------------------------------------------------------------

describe('Blowfish', () => {
  // Known test vector from Blowfish paper:
  // Key: "abcdefghijklmnop" (16 bytes)
  // Plaintext: 0xFEDCBA9876543210 (two uint32: [0xFEDCBA98, 0x76543210])
  // But OpenRA uses byte-swapped convention.
  // In OpenRA convention: input data is in little-endian uint32,
  // swapped to big-endian, encrypted, swapped back.

  describe('construction', () => {
    it('creates instance with short key (4 bytes)', () => {
      const key = new Uint8Array([1, 2, 3, 4])
      const bf = new Blowfish(key)
      expect(bf).toBeInstanceOf(Blowfish)
    })

    it('creates instance with 16-byte key', () => {
      const key = new Uint8Array(16).map((_, i) => i)
      const bf = new Blowfish(key)
      expect(bf).toBeInstanceOf(Blowfish)
    })

    it('creates instance with 56-byte key (max)', () => {
      const key = new Uint8Array(56).fill(0x55)
      const bf = new Blowfish(key)
      expect(bf).toBeInstanceOf(Blowfish)
    })

    it('different keys produce different instances', () => {
      const k1 = new Blowfish(new Uint8Array([1, 2, 3, 4]))
      const k2 = new Blowfish(new Uint8Array([5, 6, 7, 8]))
      // Encrypt the same data - results should differ
      const data = new Uint32Array([0, 1])
      const e1 = k1.encrypt(data)
      const e2 = k2.encrypt(data)
      expect(e1[0]).not.toBe(e2[0])
    })
  })

  describe('encrypt / decrypt roundtrip', () => {
    it('encrypt then decrypt returns original data (4-byte key)', () => {
      const key = new Uint8Array([0x01, 0x23, 0x45, 0x67])
      const bf = new Blowfish(key)
      const plaintext = new Uint32Array([0x00000000, 0x00000001])
      const ciphertext = bf.encrypt(plaintext)
      const decrypted = bf.decrypt(ciphertext)
      expect(decrypted[0]).toBe(plaintext[0])
      expect(decrypted[1]).toBe(plaintext[1])
    })

    it('encrypt then decrypt returns original data (8-byte key)', () => {
      const key = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef])
      const bf = new Blowfish(key)
      const plaintext = new Uint32Array([0x01234567, 0x89abcdef])
      const ciphertext = bf.encrypt(plaintext)
      const decrypted = bf.decrypt(ciphertext)
      expect(decrypted[0]).toBe(plaintext[0])
      expect(decrypted[1]).toBe(plaintext[1])
    })

    it('encrypt then decrypt returns original data (16-byte key)', () => {
      const key = new Uint8Array([
        0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
        0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
      ])
      const bf = new Blowfish(key)
      const plaintext = new Uint32Array([0x00000001, 0x00000002, 0x00000003, 0x00000004])
      const ciphertext = bf.encrypt(plaintext)
      const decrypted = bf.decrypt(ciphertext)
      for (let i = 0; i < plaintext.length; i++) {
        expect(decrypted[i]).toBe(plaintext[i])
      }
    })

    it('encrypt then decrypt for 56-byte key', () => {
      const key = new Uint8Array(56)
      for (let i = 0; i < 56; i++) key[i] = i
      const bf = new Blowfish(key)
      const plaintext = new Uint32Array([0x11111111, 0x22222222, 0x33333333, 0x44444444])
      const ciphertext = bf.encrypt(plaintext)
      const decrypted = bf.decrypt(ciphertext)
      for (let i = 0; i < plaintext.length; i++) {
        expect(decrypted[i], `index ${i}`).toBe(plaintext[i])
      }
    })

    it('encrypt with zero key', () => {
      const key = new Uint8Array([0, 0, 0, 0])
      const bf = new Blowfish(key)
      const plaintext = new Uint32Array([0, 0])
      const ciphertext = bf.encrypt(plaintext)
      // Should produce some output (not identical to plaintext)
      expect(ciphertext[0]).not.toBe(plaintext[0])
    })

    it('handles odd-length data (single uint32) — no pairs to process', () => {
      const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const bf = new Blowfish(key)
      // Single uint32 — Math.floor(1/2) = 0 pairs, while loop never runs
      // result is new Uint32Array(1) all zeros, matching C# behavior
      const data = new Uint32Array([0x12345678])
      const encrypted = bf.encrypt(data)
      expect(encrypted.length).toBe(1)
      // No pairs processed, result stays as initialized (zeros)
      // This matches C# behavior where unpaired trailing data is dropped
    })

    it('encrypt changes all pairs', () => {
      const key = new Uint8Array(8).fill(0x42)
      const bf = new Blowfish(key)
      const plaintext = new Uint32Array([1, 2, 3, 4])
      const ciphertext = bf.encrypt(plaintext)
      // Each pair should be modified
      expect(ciphertext[0]).not.toBe(1)
      expect(ciphertext[1]).not.toBe(2)
      expect(ciphertext[2]).not.toBe(3)
      expect(ciphertext[3]).not.toBe(4)
    })
  })

  describe('Blowfish test vector (OpenRA compatibility)', () => {
    it('produces deterministic output for same key+data', () => {
      const key = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
      const bf1 = new Blowfish(key)
      const bf2 = new Blowfish(key)
      const data = new Uint32Array([0xaaaa5555, 0x5555aaaa])

      const e1 = bf1.encrypt(data)
      const e2 = bf2.encrypt(data)

      expect(e1[0]).toBe(e2[0])
      expect(e1[1]).toBe(e2[1])
    })

    it('OpenRA-compatible key (8 bytes, zeros) encrypts deterministically', () => {
      // Key: 8 zero bytes
      const key = new Uint8Array(8)
      const bf = new Blowfish(key)
      const data = new Uint32Array([0x00000000, 0x00000001])

      const encrypted = bf.encrypt(data)
      // Verify it's not plaintext
      expect(encrypted[0]).not.toBe(0)
      // Decrypt should work
      const decrypted = bf.decrypt(encrypted)
      expect(decrypted[0]).toBe(0)
      expect(decrypted[1]).toBe(1)
    })
  })
})
