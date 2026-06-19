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
      // Create a .mix file that is not actually valid MIX data (encrypted)
      const fakeMix = new ArrayBuffer(10)
      const dv = new DataView(fakeMix)
      dv.setUint16(0, 0, true) // encrypted format indicator
      dv.setUint16(2, 1, true)
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
