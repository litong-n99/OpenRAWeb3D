/**
 * PackageExtractor.test.ts — PackageExtractor 迁移单元测试
 *
 * 测试重点：ZIP 解压、子归档递归解包、错误处理、进度报告。
 *
 * Since the extractor operates on raw buffers (no GPU / no Babylon.js),
 * all tests are pure unit tests without mocking.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { zipSync } from 'fflate'
import { PackageExtractor } from './PackageExtractor.js'
import { MixFileRuntime } from '../../OpenRA.Mods.Cnc/FileSystem/MixFileRuntime.js'
import { Blowfish } from '../../OpenRA.Mods.Cnc/FileFormats/Blowfish.js'

// ---------------------------------------------------------------------------
// Helpers — build test data
// ---------------------------------------------------------------------------

/**
 * Build a C&C-format MIX binary suitable for testing sub-archive extraction.
 * Uses the same binary layout as MixFile.test.ts.
 */
function buildCncMix(
  numFiles: number,
  fileSizes?: number[],
  baseHash?: number,
): ArrayBuffer {
  const entrySize = 12
  const headerSize = 6 + numFiles * entrySize

  const sizes = fileSizes ?? Array.from({ length: numFiles }, () => 4)
  const totalData = sizes.reduce((a, b) => a + b, 0)

  const buf = new ArrayBuffer(headerSize + totalData)
  const dv = new DataView(buf)

  dv.setUint16(0, numFiles, true)
  dv.setUint32(2, totalData, true)

  const hashBase = baseHash ?? 0x1000
  let dataOffset = 0
  for (let i = 0; i < numFiles; i++) {
    const eo = 6 + i * entrySize
    dv.setUint32(eo, hashBase + i, true) // hash
    dv.setUint32(eo + 4, dataOffset, true) // offset
    dv.setUint32(eo + 8, sizes[i], true) // size
    for (let b = 0; b < sizes[i]; b++) {
      dv.setUint8(headerSize + dataOffset + b, 0x41 + i)
    }
    dataOffset += sizes[i]
  }

  return buf
}

/**
 * Build a minimal PAK binary for testing.
 * Format: firstFileOffset(uint32 LE) + [filename(ASCIIZ) + nextOffset(uint32 LE)]* + data
 * We create a PAK with 1 file: "test.txt" with data at the end.
 */
function buildPak(filename: string, content: Uint8Array): ArrayBuffer {
  const nameBytes = new TextEncoder().encode(filename)
  // Layout:
  // - 4 bytes: firstFileOffset (points to data start)
  // - variable: filename + null terminator
  // - 4 bytes: nextFileOffset (0 = last file)
  const indexSize = 4 + nameBytes.length + 1 + 4
  const dataOffset = indexSize
  const buf = new ArrayBuffer(indexSize + content.byteLength)
  const dv = new DataView(buf)

  dv.setUint32(0, dataOffset, true) // firstFileOffset
  let pos = 4
  // Write filename + null
  for (let i = 0; i < nameBytes.length; i++) {
    dv.setUint8(pos++, nameBytes[i])
  }
  dv.setUint8(pos++, 0) // null terminator
  dv.setUint32(pos, 0, true) // nextFileOffset = 0 (last file)
  pos += 4

  // Write file data
  const outBytes = new Uint8Array(buf, pos)
  outBytes.set(content)

  return buf
}

/**
 * Build a Westwood classic (unencrypted RA/TS/RA2) MIX binary for testing.
 *
 * Binary layout:
 * ```
 * Offset  Size    Field
 * 0       2       format marker (uint16 LE) = 0x0000
 * 2       2       flags (uint16 LE) — bit 0: hasChecksum, bit 1: encrypted
 * 4       2       numFiles (uint16 LE)
 * 6       4       dataSize (uint32 LE)
 * 10      12×N    PackageEntry[] entries (hash, offset, length as uint32)
 * 10+12×N ...     Raw data blocks
 * ```
 */
function buildWestwoodClassicMix(
  numFiles: number,
  fileSizes?: number[],
  baseHash?: number,
  flags?: number,
): ArrayBuffer {
  const entrySize = 12
  const headerSize = 10 + numFiles * entrySize

  const sizes = fileSizes ?? Array.from({ length: numFiles }, () => 4)
  const totalData = sizes.reduce((a, b) => a + b, 0)

  const buf = new ArrayBuffer(headerSize + totalData)
  const dv = new DataView(buf)

  dv.setUint16(0, 0x0000, true)          // format marker
  dv.setUint16(2, flags ?? 0, true)      // flags
  dv.setUint16(4, numFiles, true)        // numFiles
  dv.setUint32(6, totalData, true)       // dataSize

  const hashBase = baseHash ?? 0x1000
  let dataOffset = 0
  for (let i = 0; i < numFiles; i++) {
    const eo = 10 + i * entrySize
    dv.setUint32(eo, hashBase + i, true) // hash
    dv.setUint32(eo + 4, dataOffset, true) // offset
    dv.setUint32(eo + 8, sizes[i], true) // size
    for (let b = 0; b < sizes[i]; b++) {
      dv.setUint8(headerSize + dataOffset + b, 0x42 + i)
    }
    dataOffset += sizes[i]
  }

  return buf
}

/**
 * Build a universal key format encrypted MIX binary for testing.
 *
 * Format:
 * - offset 0: uint16 flags = 0x0001 (universal key)
 * - offset 2: uint32 dataSize
 * - offset 6: Blowfish-encrypted header (padded to 8-byte blocks)
 * - after header: raw data blocks
 *
 * @param hash — entry hash
 * @param content — file content
 * @param key — Blowfish key (56 bytes)
 */
function buildEncryptedMix(
  hash: number,
  content: Uint8Array,
  key: Uint8Array,
): ArrayBuffer {
  const fish = new Blowfish(key)

  const numFiles = 1
  const totalDataSize = content.byteLength

  const headerSize = 6 + numFiles * 12
  const blockCount = Math.ceil(headerSize / 8)
  const headerByteLength = blockCount * 8
  const dataStart = 6 + headerByteLength
  const totalSize = dataStart + totalDataSize

  const buf = new ArrayBuffer(totalSize)
  const dv = new DataView(buf)

  // Write flags and dataSize
  dv.setUint16(0, 0x0001, true)
  dv.setUint32(2, totalDataSize, true)

  // Build plaintext header: numFiles(uint16) + dataSize(uint32) + entry(12)
  const plainHeader = new ArrayBuffer(headerByteLength)
  const plainDv = new DataView(plainHeader)
  plainDv.setUint16(0, numFiles, true)
  plainDv.setUint32(2, totalDataSize, true)
  plainDv.setUint32(6, hash, true)
  plainDv.setUint32(10, 0, true)
  plainDv.setUint32(14, totalDataSize, true)

  // Encrypt header with Blowfish
  const headerU32 = new Uint32Array(plainHeader, 0, blockCount * 2)
  const encryptedU32 = fish.encrypt(headerU32)

  // Copy encrypted header bytes to output
  const encryptedBytes = new Uint8Array(encryptedU32.buffer, encryptedU32.byteOffset, headerByteLength)
  const outHeader = new Uint8Array(buf, 6, headerByteLength)
  outHeader.set(encryptedBytes)

  // Write data block
  const dest = new Uint8Array(buf, dataStart, totalDataSize)
  dest.set(content)

  return buf
}

// ---------------------------------------------------------------------------
// PackageExtractor tests
// ---------------------------------------------------------------------------

describe('PackageExtractor', () => {
  let extractor: PackageExtractor

  beforeEach(() => {
    extractor = new PackageExtractor()
  })

  // ---------------------------------------------------------------------
  // extract — flat files (raw pass-through)
  // ---------------------------------------------------------------------

  describe('extract — flat files', () => {
    it('extracts a single flat file from a ZIP', async () => {
      const content = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
      const zipData = zipSync({ 'data.txt': content })
      const extractMap = { 'output/data.txt': 'data.txt' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(1)
      expect(result.has('output/data.txt')).toBe(true)
      const extracted = result.get('output/data.txt')!
      expect(new Uint8Array(extracted)).toEqual(content)
    })

    it('extracts multiple flat files from a ZIP', async () => {
      const zipData = zipSync({
        'a.bin': new Uint8Array([0x01, 0x02, 0x03]),
        'b.bin': new Uint8Array([0x04, 0x05]),
        'sub/c.dat': new Uint8Array([0x06]),
      })
      const extractMap = {
        'out/a.bin': 'a.bin',
        'out/b.bin': 'b.bin',
        'out/sub/c.dat': 'sub/c.dat',
      }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(3)
      expect(result.get('out/a.bin')!.byteLength).toBe(3)
      expect(result.get('out/b.bin')!.byteLength).toBe(2)
      expect(result.get('out/sub/c.dat')!.byteLength).toBe(1)
    })
  })

  // ---------------------------------------------------------------------
  // extract — empty extractMap
  // ---------------------------------------------------------------------

  describe('extract — empty extractMap', () => {
    it('returns an empty Map for an empty extractMap', async () => {
      const zipData = zipSync({ 'dummy.txt': new Uint8Array([0x00]) })
      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        {},
      )
      expect(result.size).toBe(0)
    })

    it('handles empty extractMap with valid ZIP (no wasted work)', async () => {
      // Even a completely empty ZIP should work
      const zipData = zipSync({})
      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        {},
      )
      expect(result.size).toBe(0)
    })
  })

  // ---------------------------------------------------------------------
  // extract — 0-byte file
  // ---------------------------------------------------------------------

  describe('extract — 0-byte file', () => {
    it('includes a 0-byte ArrayBuffer when ZIP entry is empty', async () => {
      const zipData = zipSync({ 'empty.dat': new Uint8Array(0) })
      const extractMap = { 'out/empty.dat': 'empty.dat' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(1)
      const extracted = result.get('out/empty.dat')!
      expect(extracted.byteLength).toBe(0)
    })
  })

  // ---------------------------------------------------------------------
  // extract — missing ZIP entry
  // ---------------------------------------------------------------------

  describe('extract — missing ZIP entry', () => {
    it('throws when a required entry is not found in the ZIP', async () => {
      const zipData = zipSync({ 'a.txt': new Uint8Array([0x01]) })
      const extractMap = { 'out/missing.txt': 'missing.txt' }

      await expect(
        extractor.extract(zipData.buffer as ArrayBuffer, extractMap),
      ).rejects.toThrow(/Archive entry not found.*missing\.txt/)
    })
  })

  // ---------------------------------------------------------------------
  // extract — MIX sub-archive
  // ---------------------------------------------------------------------

  describe('extract — MIX sub-archive', () => {
    it('unpacks a .mix file and extracts inner files', async () => {
      const mixData = buildCncMix(2, [10, 20])
      const zipData = zipSync({ 'allies.mix': new Uint8Array(mixData) })
      const extractMap = { 'Content/ra/v2/allies.mix': 'allies.mix' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      // Should have 2 inner files from the MIX
      expect(result.size).toBe(2)
      const keys = Array.from(result.keys())
      for (const key of keys) {
        expect(key).toMatch(/^Content\/ra\/v2\/allies\.mix\/unresolved_0x/)
      }
    })

    it('resolves MIX filenames when mixDb is provided', async () => {
      const mixData = buildCncMix(2, [5, 5])
      const zipData = zipSync({ 'data.mix': new Uint8Array(mixData) })
      const extractMap = { 'Content/data.mix': 'data.mix' }

      const mixDb = new Map<string, string>()
      mixDb.set('0x00001000', 'e1.shp')
      mixDb.set('0x00001001', 'htnk.shp')

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
        mixDb,
      )

      expect(result.size).toBe(2)
      expect(result.has('Content/data.mix/e1.shp')).toBe(true)
      expect(result.has('Content/data.mix/htnk.shp')).toBe(true)
    })

    it('handles MIX with unresolved hashes (placeholder filenames)', async () => {
      const mixData = buildCncMix(1, [8])
      const zipData = zipSync({ 'unknown.mix': new Uint8Array(mixData) })
      const extractMap = { 'out/unknown.mix': 'unknown.mix' }

      // No mixDb provided — files get placeholder names
      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(1)
      const key = Array.from(result.keys())[0]
      expect(key).toMatch(/unresolved_0x/)
    })
  })

  // ---------------------------------------------------------------------
  // extract — Westwood classic MIX sub-archive (Ch23 Phase C)
  // ---------------------------------------------------------------------

  describe('extract — Westwood classic MIX sub-archive', () => {
    it('unpacks a Westwood classic .mix file and extracts inner files', async () => {
      const mixData = buildWestwoodClassicMix(2, [10, 20])
      const zipData = zipSync({ 'scores.mix': new Uint8Array(mixData) })
      const extractMap = { 'Content/ra/scores.mix': 'scores.mix' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      // Should have 2 inner files from the Westwood classic MIX
      expect(result.size).toBe(2)
      const keys = Array.from(result.keys())
      for (const key of keys) {
        expect(key).toMatch(/^Content\/ra\/scores\.mix\/unresolved_0x/)
      }
    })

    it('extracts correct file data from Westwood classic MIX', async () => {
      const mixData = buildWestwoodClassicMix(1, [5], 0x2000)
      const zipData = zipSync({ 'westwood.mix': new Uint8Array(mixData) })
      const extractMap = { 'out/westwood.mix': 'westwood.mix' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(1)
      const key = Array.from(result.keys())[0]
      const data = result.get(key)!
      const bytes = new Uint8Array(data)
      expect(bytes.byteLength).toBe(5)
      expect(bytes[0]).toBe(0x42)
    })

    it('resolves Westwood classic MIX filenames when mixDb is provided', async () => {
      const mixData = buildWestwoodClassicMix(2, [5, 8], 0x7000)
      const zipData = zipSync({ 'data.mix': new Uint8Array(mixData) })
      const extractMap = { 'Content/data.mix': 'data.mix' }

      const mixDb = new Map<string, string>()
      mixDb.set('0x00007000', 'icon.shp')
      mixDb.set('0x00007001', 'mouse.shp')

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
        mixDb,
      )

      expect(result.size).toBe(2)
      expect(result.has('Content/data.mix/icon.shp')).toBe(true)
      expect(result.has('Content/data.mix/mouse.shp')).toBe(true)
    })

    it('handles Westwood classic MIX with hasChecksum flag', async () => {
      const mixData = buildWestwoodClassicMix(1, [3], 0x9000, 0x0001) // flags=hasChecksum
      const zipData = zipSync({ 'checksum.mix': new Uint8Array(mixData) })
      const extractMap = { 'out/checksum.mix': 'checksum.mix' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(1)
      const key = Array.from(result.keys())[0]
      expect(key).toContain('checksum.mix/')
    })
  })

  // ---------------------------------------------------------------------
  // extract — encrypted MIX fallthrough (Ch23 Phase C)
  // ---------------------------------------------------------------------

  describe('extract — encrypted MIX fallthrough', () => {
    it('falls back to raw bytes when encrypted MIX parse fails and no other format matches', async () => {
      // Create a buffer with firstUint16=0, secondUint16=2 (encrypted flag set)
      // but too small/invalid for actual RSA decryption.
      // isEncryptedFormat → true, parseEncrypted → throws
      // isCncFormat → false, isWestwoodClassicFormat → false (bit 1 set)
      // → passes through as raw bytes
      const fakeEncMix = new ArrayBuffer(10)
      const dv = new DataView(fakeEncMix)
      dv.setUint16(0, 0x0000, true)   // OpenRA format marker
      dv.setUint16(2, 0x0002, true)   // encrypted flag (bit 1)
      const zipData = zipSync({ 'fake.mix': new Uint8Array(fakeEncMix) })
      const extractMap = { 'out/fake.mix': 'fake.mix' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      // Should fall back to raw bytes pass-through
      expect(result.size).toBe(1)
      expect(result.has('out/fake.mix')).toBe(true)
      const raw = result.get('out/fake.mix')!
      expect(raw.byteLength).toBe(10)
    })

    it('handles encrypted MIX that is actually Westwood classic (spurious flag)', async () => {
      // A MIX with firstUint16=0, secondUint16=0 (unencrypted Westwood classic)
      // but with enough structure that it could be confused with encrypted.
      // This verifies the normal Westwood classic path doesn't interfere.
      const mixData = buildWestwoodClassicMix(1, [4], 0xA000)
      const zipData = zipSync({ 'normal.mix': new Uint8Array(mixData) })
      const extractMap = { 'out/normal.mix': 'normal.mix' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      // Should extract as Westwood classic (not encrypted fallthrough)
      expect(result.size).toBe(1)
      const key = Array.from(result.keys())[0]
      expect(key).toContain('normal.mix/')
    })
  })

  // ---------------------------------------------------------------------
  // extract — all three MIX formats in one ZIP (Ch23 Phase C)
  // ---------------------------------------------------------------------

  describe('extract — all three MIX formats', () => {
    it('extracts C&C, encrypted, and Westwood classic MIX files from one ZIP', async () => {
      // 1. C&C MIX
      const cncMixData = buildCncMix(1, [4], 0xCC00)

      // 2. Encrypted MIX (universal key)
      const encKey = new Uint8Array(56)
      for (let i = 0; i < 56; i++) encKey[i] = (0xAB + i * 3) & 0xFF
      const encContent = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD])
      const encMixData = buildEncryptedMix(0xEC00, encContent, encKey)

      // 3. Westwood classic MIX
      const wwMixData = buildWestwoodClassicMix(1, [4], 0xDD00)

      const zipData = zipSync({
        'cnc.mix': new Uint8Array(cncMixData),
        'enc.mix': new Uint8Array(encMixData),
        'west.mix': new Uint8Array(wwMixData),
      })
      const extractMap = {
        'out/cnc.mix': 'cnc.mix',
        'out/enc.mix': 'enc.mix',
        'out/west.mix': 'west.mix',
      }

      // Set the default encrypted key for the encrypted MIX
      MixFileRuntime.setDefaultEncryptedKey(encKey)
      let result: Map<string, ArrayBuffer>
      try {
        result = await extractor.extract(
          zipData.buffer as ArrayBuffer,
          extractMap,
        )
      } finally {
        MixFileRuntime.setDefaultEncryptedKey(null)
      }

      // All 3 MIX files should yield their inner file
      expect(result.size).toBe(3)

      const cncKeys = Array.from(result.keys()).filter(k => k.includes('cnc.mix/'))
      const encKeys = Array.from(result.keys()).filter(k => k.includes('enc.mix/'))
      const wwKeys = Array.from(result.keys()).filter(k => k.includes('west.mix/'))

      expect(cncKeys.length).toBe(1)
      expect(encKeys.length).toBe(1)
      expect(wwKeys.length).toBe(1)

      // Verify encrypted MIX data integrity
      const encData = result.get(encKeys[0])!
      expect(new Uint8Array(encData)).toEqual(new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]))
    })
  })

  // ---------------------------------------------------------------------
  // extract — PAK sub-archive
  // ---------------------------------------------------------------------

  describe('extract — PAK sub-archive', () => {
    it('unpacks a .pak file and extracts inner files', async () => {
      const pakData = buildPak('inner.txt', new Uint8Array([0xAA, 0xBB, 0xCC]))
      const zipData = zipSync({ 'archive.pak': new Uint8Array(pakData) })
      const extractMap = { 'output/archive.pak': 'archive.pak' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(1)
      expect(result.has('output/archive.pak/inner.txt')).toBe(true)
      const data = result.get('output/archive.pak/inner.txt')!
      expect(new Uint8Array(data)).toEqual(new Uint8Array([0xAA, 0xBB, 0xCC]))
    })
  })

  // ---------------------------------------------------------------------
  // extract — progress reporting
  // ---------------------------------------------------------------------

  describe('extract — progress reporting', () => {
    it('calls onProgress for each extractMap entry', async () => {
      const zipData = zipSync({
        'a.txt': new Uint8Array([0x01]),
        'b.txt': new Uint8Array([0x02]),
        'c.txt': new Uint8Array([0x03]),
      })
      const extractMap = {
        'out/a.txt': 'a.txt',
        'out/b.txt': 'b.txt',
        'out/c.txt': 'c.txt',
      }

      const progressCalls: [string, number, number][] = []
      const onProgress = (entry: string, current: number, total: number) => {
        progressCalls.push([entry, current, total])
      }

      await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
        undefined,
        onProgress,
      )

      // Should have 4 calls: 3 for entries + 1 for completion
      expect(progressCalls.length).toBe(4)
      expect(progressCalls[0]).toEqual(['a.txt', 0, 3])
      expect(progressCalls[1]).toEqual(['b.txt', 1, 3])
      expect(progressCalls[2]).toEqual(['c.txt', 2, 3])
      expect(progressCalls[3]).toEqual(['__done__', 3, 3])
    })
  })

  // ---------------------------------------------------------------------
  // extract — ZIP with directory entries (should not interfere)
  // ---------------------------------------------------------------------

  describe('extract — ZIP with directory entries', () => {
    it('handles ZIPs with directory entries (fflate strips them)', async () => {
      // fflate zipSync includes directory entries. They end with '/'.
      // The extractor uses exact key lookup, so directory entries are ignored.
      const zipData = zipSync({
        'subdir/': new Uint8Array(0),
        'subdir/file.txt': new Uint8Array([0x42]),
      })
      const extractMap = { 'out/file.txt': 'subdir/file.txt' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(1)
      expect(result.has('out/file.txt')).toBe(true)
    })
  })

  // ---------------------------------------------------------------------
  // extract — multiple sub-archives in one ZIP
  // ---------------------------------------------------------------------

  describe('extract — multiple sub-archives', () => {
    it('extracts both MIX and PAK files from the same ZIP', async () => {
      const mixData = buildCncMix(1, [4], 0x2000)
      const pakData = buildPak('pkg.txt', new Uint8Array([0x99, 0x88]))

      const zipData = zipSync({
        'archives/a.mix': new Uint8Array(mixData),
        'archives/b.pak': new Uint8Array(pakData),
      })
      const extractMap = {
        'Content/a.mix': 'archives/a.mix',
        'Content/b.pak': 'archives/b.pak',
      }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      // MIX yields 1 file + PAK yields 1 file = 2 total
      expect(result.size).toBe(2)
      // Check MIX file (unresolved, hash 0x2000)
      const mixKeys = Array.from(result.keys()).filter(k => k.includes('a.mix/'))
      expect(mixKeys.length).toBe(1)
      expect(mixKeys[0]).toMatch(/unresolved_0x00002000/)
      // Check PAK file
      expect(result.has('Content/b.pak/pkg.txt')).toBe(true)
      expect(new Uint8Array(result.get('Content/b.pak/pkg.txt')!)).toEqual(
        new Uint8Array([0x99, 0x88]),
      )
    })
  })

  // ---------------------------------------------------------------------
  // extract — invalid archive data (graceful degradation)
  // ---------------------------------------------------------------------

  describe('extract — invalid archive data', () => {
    it('falls back to raw bytes when sub-archive is not valid for its extension', async () => {
      // Create a .mix file that triggers isEncryptedFormat but fails
      // parseEncrypted (buffer too small for RSA keyblock). Since the
      // encrypted flag bit is set, isWestwoodClassicFormat returns false.
      // isCncFormat also returns false → falls through to raw bytes.
      const fakeMix = new ArrayBuffer(10)
      const dv = new DataView(fakeMix)
      dv.setUint16(0, 0x0000, true)   // OpenRA format marker
      dv.setUint16(2, 0x0002, true)   // encrypted flag (bit 1 set)
      const zipData = zipSync({ 'bad.mix': new Uint8Array(fakeMix) })
      const extractMap = { 'out/bad.mix': 'bad.mix' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      // Should fall back to raw bytes pass-through
      expect(result.size).toBe(1)
      expect(result.has('out/bad.mix')).toBe(true)
      // The data should be the raw bytes (our inner _extractSubPackage fallback)
      const raw = result.get('out/bad.mix')!
      expect(raw.byteLength).toBe(10)
    })
  })

  // ---------------------------------------------------------------------
  // extract — .tem terrain tileset pass-through (Phase C)
  // ---------------------------------------------------------------------

  describe('extract — .tem terrain tileset', () => {
    it('passes through .tem files as raw bytes', async () => {
      const temData = new Uint8Array(200)
      for (let i = 0; i < temData.length; i++) temData[i] = i & 0xFF
      const zipData = zipSync({ 'blat01.tem': temData })
      const extractMap = { 'Content/ts/firestorm/blat01.tem': 'blat01.tem' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(1)
      expect(result.has('Content/ts/firestorm/blat01.tem')).toBe(true)
      const extracted = result.get('Content/ts/firestorm/blat01.tem')!
      const extractedArr = new Uint8Array(extracted)
      expect(extractedArr.byteLength).toBe(200)
      for (let i = 0; i < 200; i++) {
        expect(extractedArr[i]).toBe(i & 0xFF)
      }
    })

    it('handles multiple .tem files in one extraction', async () => {
      const tem1 = new Uint8Array(50).fill(0xAA)
      const tem2 = new Uint8Array(100).fill(0xBB)
      const zipData = zipSync({
        'tiles1.tem': tem1,
        'tiles2.tem': tem2,
      })
      const extractMap = {
        'out/tiles1.tem': 'tiles1.tem',
        'out/tiles2.tem': 'tiles2.tem',
      }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      expect(result.size).toBe(2)
      expect(new Uint8Array(result.get('out/tiles1.tem')!)[0]).toBe(0xAA)
      expect(new Uint8Array(result.get('out/tiles2.tem')!)[0]).toBe(0xBB)
    })
  })

  // ---------------------------------------------------------------------
  // extract — binary fidelity (content preservation)
  // ---------------------------------------------------------------------

  describe('extract — binary fidelity', () => {
    it('preserves binary content exactly for raw pass-through', async () => {
      const content = new Uint8Array(256)
      for (let i = 0; i < 256; i++) content[i] = i
      const zipData = zipSync({ 'binary.bin': content })
      const extractMap = { 'out/binary.bin': 'binary.bin' }

      const result = await extractor.extract(
        zipData.buffer as ArrayBuffer,
        extractMap,
      )

      const extracted = result.get('out/binary.bin')!
      const extractedArr = new Uint8Array(extracted)
      expect(extractedArr.byteLength).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(extractedArr[i]).toBe(i)
      }
    })
  })
})
