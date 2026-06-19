/**
 * MixFileRuntime.test.ts — MixFileRuntime 迁移单元测试
 *
 * 测试重点：C&C MIX 格式解析、isCncFormat 检测、文件名解析、
 * 数据访问正确性、边界情况处理、dispose 清理、Phase B 加密格式支持。
 * 所有逻辑均为纯数据处理，无需 Babylon.js 依赖。
 */

import { describe, it, expect } from 'vitest'
import { MixFileRuntime } from './MixFileRuntime.js'
import { Blowfish } from '../FileFormats/Blowfish.js'

// ---------------------------------------------------------------------------
// Helper: construct C&C MIX binary data
// ---------------------------------------------------------------------------

interface FileSpec {
  /** Filename hash (uint32). */
  hash: number
  /** Raw data content for this file. */
  data: Uint8Array
}

/**
 * Build a valid C&C-format MIX ArrayBuffer from file specifications.
 *
 * C&C binary layout (little-endian):
 * ```
 * Offset  Size    Field
 * 0       2       numFiles (uint16)
 * 2       4       totalSize (uint32) — sum of all data blocks
 * 6       N*12    PackageEntry[] (hash, offset, size as uint32 each)
 * 6+N*12  ...     Raw data blocks (concatenated, no padding)
 * ```
 *
 * PackageEntry.offset is relative to dataStart (end of entry table).
 */
function createCncMixBuffer(files: FileSpec[]): ArrayBuffer {
  const numFiles = files.length
  const entryTableSize = numFiles * 12 // PackageEntry.SIZE
  const dataStart = 6 + entryTableSize

  // Compute total data size and offsets
  let totalDataSize = 0
  for (const file of files) {
    totalDataSize += file.data.byteLength
  }

  const totalBufferSize = dataStart + totalDataSize
  const buf = new ArrayBuffer(totalBufferSize)
  const dv = new DataView(buf)

  // --- Header ---
  dv.setUint16(0, numFiles, true)
  dv.setUint32(2, totalDataSize, true)

  // --- Entry table ---
  let dataCursor = 0 // offset relative to dataStart
  let entryByteOffset = 6
  for (const file of files) {
    // hash (uint32)
    dv.setUint32(entryByteOffset, file.hash, true)
    // offset from dataStart (uint32)
    dv.setUint32(entryByteOffset + 4, dataCursor, true)
    // length (uint32)
    dv.setUint32(entryByteOffset + 8, file.data.byteLength, true)
    entryByteOffset += 12
    dataCursor += file.data.byteLength
  }

  // --- Raw data blocks ---
  dataCursor = 0
  for (const file of files) {
    const destView = new Uint8Array(buf, dataStart + dataCursor, file.data.byteLength)
    destView.set(file.data)
    dataCursor += file.data.byteLength
  }

  return buf
}

/**
 * Build a minimal MIX buffer with flag-controlled first uint16.
 * Useful for testing isCncFormat and format detection edge cases.
 */
function createMixWithFirstUint16(value: number): ArrayBuffer {
  const buf = new ArrayBuffer(6)
  const dv = new DataView(buf)
  dv.setUint16(0, value, true)
  dv.setUint32(2, 0, true)
  return buf
}

/**
 * Simple string-to-bytes helper for test data.
 */
function strToData(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FILE_A_DATA = strToData('Hello, world!')
const FILE_B_DATA = strToData('File B content here')
const FILE_C_DATA = strToData('C')

/** Hash for "test_a.shp" using Classic / CRC32 */
const HASH_A = 0x12345678
const HASH_B = 0xABCDEF01
const HASH_C = 0x00000042

const FILE_A_HASH_KEY = '0x' + HASH_A.toString(16).toUpperCase().padStart(8, '0')
const FILE_B_HASH_KEY = '0x' + HASH_B.toString(16).toUpperCase().padStart(8, '0')
const FILE_C_HASH_KEY = '0x' + HASH_C.toString(16).toUpperCase().padStart(8, '0')

// ---------------------------------------------------------------------------
// MixFileRuntime.isCncFormat
// ---------------------------------------------------------------------------

describe('MixFileRuntime.isCncFormat', () => {
  it('returns true for valid C&C MIX (numFiles > 0)', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    expect(MixFileRuntime.isCncFormat(buf)).toBe(true)
  })

  it('returns true for MIX with many files', () => {
    const files: FileSpec[] = Array.from({ length: 100 }, (_, i) => ({
      hash: i,
      data: new Uint8Array([i]),
    }))
    const buf = createCncMixBuffer(files)
    expect(MixFileRuntime.isCncFormat(buf)).toBe(true)
  })

  it('returns false for encrypted/RA format (first uint16 = 0)', () => {
    const buf = createMixWithFirstUint16(0)
    expect(MixFileRuntime.isCncFormat(buf)).toBe(false)
  })

  it('returns false for buffer smaller than minimum header size', () => {
    const tinyBuf = new ArrayBuffer(4)
    expect(MixFileRuntime.isCncFormat(tinyBuf)).toBe(false)
  })

  it('returns false for empty ArrayBuffer', () => {
    const emptyBuf = new ArrayBuffer(0)
    expect(MixFileRuntime.isCncFormat(emptyBuf)).toBe(false)
  })

  it('returns true for numFiles at uint16 max (65535)', () => {
    // This tests the boundary — we don't need to actually create 65535 entries
    const buf = new ArrayBuffer(6)
    const dv = new DataView(buf)
    dv.setUint16(0, 65535, true)
    dv.setUint32(2, 0, true)
    expect(MixFileRuntime.isCncFormat(buf)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.parse — valid parsing
// ---------------------------------------------------------------------------

describe('MixFileRuntime.parse', () => {
  it('parses a single-file C&C MIX with unresolved hashes', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)

    const mix = MixFileRuntime.parse('test.mix', buf)

    expect(mix.name).toBe('test.mix')
    expect(mix.contents.length).toBe(1)
    // Unresolved filename format
    expect(mix.contents[0]).toMatch(/^unresolved_0x[0-9A-F]{8}\.bin$/)
  })

  it('parses a multi-file C&C MIX with 3 files', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
      { hash: HASH_B, data: FILE_B_DATA },
      { hash: HASH_C, data: FILE_C_DATA },
    ]
    const buf = createCncMixBuffer(files)

    const mix = MixFileRuntime.parse('multifile.mix', buf)

    expect(mix.name).toBe('multifile.mix')
    expect(mix.contents.length).toBe(3)
    // All entries should have unresolved filenames
    for (const name of mix.contents) {
      expect(name).toMatch(/^unresolved_0x[0-9A-F]{8}\.bin$/)
    }
  })

  it('resolves filenames via mixDb', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
      { hash: HASH_B, data: FILE_B_DATA },
    ]
    const buf = createCncMixBuffer(files)

    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'allies.shp')
    mixDb.set(FILE_B_HASH_KEY, 'soviet.shp')

    const mix = MixFileRuntime.parse('resolved.mix', buf, mixDb)

    expect(mix.contents.length).toBe(2)
    expect(mix.contents).toContain('allies.shp')
    expect(mix.contents).toContain('soviet.shp')
    expect(mix.contains('allies.shp')).toBe(true)
    expect(mix.contains('soviet.shp')).toBe(true)
  })

  it('uses unresolved placeholder for hashes not in mixDb', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
      { hash: HASH_B, data: FILE_B_DATA },
    ]
    const buf = createCncMixBuffer(files)

    // mixDb only knows about HASH_A
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'known.shp')
    // FILE_B_HASH_KEY is NOT in mixDb

    const mix = MixFileRuntime.parse('partial.mix', buf, mixDb)

    expect(mix.contents.length).toBe(2)
    expect(mix.contains('known.shp')).toBe(true)
    // The second file should get an unresolved placeholder
    const unresolvedName = mix.contents.find(n => n.startsWith('unresolved_'))
    expect(unresolvedName).toBeDefined()
    expect(unresolvedName).toMatch(/^unresolved_0x[0-9A-F]{8}\.bin$/)
  })

  it('throws on encrypted/RA format data', () => {
    const buf = createMixWithFirstUint16(0)
    expect(() => {
      MixFileRuntime.parse('encrypted.mix', buf)
    }).toThrow(/not a valid C&C-format MIX/i)
  })

  it('throws on too-small buffer', () => {
    const tinyBuf = new ArrayBuffer(2)
    expect(() => {
      MixFileRuntime.parse('tiny.mix', tinyBuf)
    }).toThrow(/not a valid C&C-format MIX/i)
  })

  it('parses an empty MIX with zero files (isCncFormat rejects this)', () => {
    // An empty MIX (0 files) has numFiles=0, which means isCncFormat returns false.
    // parse() should throw because it calls isCncFormat first.
    const buf = createCncMixBuffer([])
    expect(MixFileRuntime.isCncFormat(buf)).toBe(false)
    expect(() => {
      MixFileRuntime.parse('empty.mix', buf)
    }).toThrow()
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.contains
// ---------------------------------------------------------------------------

describe('MixFileRuntime.contains', () => {
  it('returns true for existing filename', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'hero.shp')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)

    expect(mix.contains('hero.shp')).toBe(true)
    expect(mix.contains('nonexistent.shp')).toBe(false)
  })

  it('returns false after dispose', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'hero.shp')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)
    mix.dispose()

    // After disposal, all lookups return false
    expect(mix.contains('hero.shp')).toBe(false)
    expect(mix.contains('anything.shp')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.open
// ---------------------------------------------------------------------------

describe('MixFileRuntime.open', () => {
  it('returns correct data for a resolved filename', async () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'data.shp')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)
    const result = await mix.open('data.shp')

    expect(result).not.toBeNull()
    const bytes = new Uint8Array(result!)
    const expected = strToData('Hello, world!')
    expect(bytes).toEqual(expected)
  })

  it('returns correct data for each file in a multi-file MIX', async () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: strToData('AAA') },
      { hash: HASH_B, data: strToData('BBBB') },
      { hash: HASH_C, data: strToData('CCCCC') },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'a.dat')
    mixDb.set(FILE_B_HASH_KEY, 'b.dat')
    mixDb.set(FILE_C_HASH_KEY, 'c.dat')

    const mix = MixFileRuntime.parse('multi.mix', buf, mixDb)

    const dataA = await mix.open('a.dat')
    const dataB = await mix.open('b.dat')
    const dataC = await mix.open('c.dat')

    expect(new TextDecoder().decode(dataA!)).toBe('AAA')
    expect(new TextDecoder().decode(dataB!)).toBe('BBBB')
    expect(new TextDecoder().decode(dataC!)).toBe('CCCCC')
  })

  it('returns null for unknown filename', async () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'known.shp')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)
    const result = await mix.open('unknown.shp')

    expect(result).toBeNull()
  })

  it('returns null after dispose', async () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'hero.shp')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)
    mix.dispose()

    const result = await mix.open('hero.shp')
    expect(result).toBeNull()
  })

  it('returns independent copies (not shared buffer views)', async () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: strToData('original content') },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'file.dat')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)

    const result1 = await mix.open('file.dat')
    const result2 = await mix.open('file.dat')

    expect(result1).not.toBeNull()
    expect(result2).not.toBeNull()
    // Both should be valid, separate copies
    expect(new TextDecoder().decode(result1!)).toBe('original content')
    expect(new TextDecoder().decode(result2!)).toBe('original content')
    // They should be different ArrayBuffer instances
    expect(result1).not.toBe(result2)
  })

  it('also works with unresolved (placeholder) filenames', async () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)

    const mix = MixFileRuntime.parse('test.mix', buf) // no mixDb
    const placeholderName = mix.contents[0]
    const result = await mix.open(placeholderName)

    expect(result).not.toBeNull()
    expect(new TextDecoder().decode(result!)).toBe('Hello, world!')
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.openPackage
// ---------------------------------------------------------------------------

describe('MixFileRuntime.openPackage', () => {
  it('always returns null (no sub-packages in MIX)', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'hero.shp')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)

    expect(mix.openPackage('hero.shp')).toBeNull()
    expect(mix.openPackage('anyfile.dat')).toBeNull()
    expect(mix.openPackage('', { openAsync: async () => null, exists: () => false, isMounted: () => false })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.contents
// ---------------------------------------------------------------------------

describe('MixFileRuntime.contents', () => {
  it('returns sorted filenames', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: strToData('1') },
      { hash: HASH_B, data: strToData('2') },
      { hash: HASH_C, data: strToData('3') },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_C_HASH_KEY, 'zulu.shp')
    mixDb.set(FILE_A_HASH_KEY, 'alpha.shp')
    mixDb.set(FILE_B_HASH_KEY, 'bravo.shp')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)

    const contents = mix.contents
    expect(contents.length).toBe(3)
    // Should be sorted alphabetically
    expect(contents[0]).toBe('alpha.shp')
    expect(contents[1]).toBe('bravo.shp')
    expect(contents[2]).toBe('zulu.shp')
  })

  it('is frozen (immutable)', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mix = MixFileRuntime.parse('test.mix', buf)

    const contents = mix.contents
    expect(Object.isFrozen(contents)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.dispose
// ---------------------------------------------------------------------------

describe('MixFileRuntime.dispose', () => {
  it('releases resources so open returns null', async () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'data.shp')

    const mix = MixFileRuntime.parse('test.mix', buf, mixDb)

    // Verify it works before dispose
    expect(mix.contains('data.shp')).toBe(true)
    const preResult = await mix.open('data.shp')
    expect(preResult).not.toBeNull()

    // Dispose
    mix.dispose()

    // Verify everything is cleaned up
    expect(mix.contains('data.shp')).toBe(false)
    const postResult = await mix.open('data.shp')
    expect(postResult).toBeNull()
    expect(mix.openPackage('data.shp')).toBeNull()
  })

  it('can be called multiple times without error', () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: FILE_A_DATA },
    ]
    const buf = createCncMixBuffer(files)
    const mix = MixFileRuntime.parse('test.mix', buf)

    expect(() => {
      mix.dispose()
      mix.dispose()
      mix.dispose()
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime — extra trailing data
// ---------------------------------------------------------------------------

describe('MixFileRuntime — trailing data', () => {
  it('parses correctly when buffer has extra bytes after the last file', async () => {
    // Create a normal MIX with one file, then manually append extra bytes
    const files: FileSpec[] = [
      { hash: HASH_A, data: strToData('good data') },
    ]
    const normalBuf = createCncMixBuffer(files)

    // Append 20 extra bytes of garbage
    const extraBytes = new Uint8Array(20)
    extraBytes.fill(0xFF)
    const extendedBuf = new ArrayBuffer(normalBuf.byteLength + 20)
    const extendedView = new Uint8Array(extendedBuf)
    extendedView.set(new Uint8Array(normalBuf), 0)
    extendedView.set(extraBytes, normalBuf.byteLength)

    const mix = MixFileRuntime.parse('trailing.mix', extendedBuf)

    expect(mix.contents.length).toBe(1)
    const result = await mix.open(mix.contents[0])
    expect(new TextDecoder().decode(result!)).toBe('good data')
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime — data offset truncated past buffer end
// ---------------------------------------------------------------------------

describe('MixFileRuntime — truncated data', () => {
  it('truncates data when entry size extends past buffer end', async () => {
    // Create a file spec with data, then truncate the buffer
    const files: FileSpec[] = [
      { hash: HASH_A, data: strToData('this is a long string that will be truncated') },
    ]
    const fullBuf = createCncMixBuffer(files)

    // Cut off the buffer before the full data ends (leave only 10 bytes of data)
    const dataStart = 6 + files.length * 12
    const truncatedSize = dataStart + 10 // only 10 bytes of data
    const truncatedBuf = fullBuf.slice(0, truncatedSize)

    const mix = MixFileRuntime.parse('trunc.mix', truncatedBuf)
    const result = await mix.open(mix.contents[0])

    expect(result).not.toBeNull()
    // Should only have 10 bytes (truncated)
    expect(result!.byteLength).toBe(10)
    expect(new TextDecoder().decode(result!)).toBe('this is a ')
  })

  it('returns null when data offset is beyond buffer end', async () => {
    const files: FileSpec[] = [
      { hash: HASH_A, data: strToData('some data') },
    ]
    const fullBuf = createCncMixBuffer(files)

    // Cut off buffer right at the start of data (no data bytes at all)
    const dataStart = 6 + files.length * 12
    const truncatedBuf = fullBuf.slice(0, dataStart)

    const mix = MixFileRuntime.parse('nocontent.mix', truncatedBuf)
    const result = await mix.open(mix.contents[0])

    // offset is at dataStart (== buffer end), should return null
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime — duplicate hash handling
// ---------------------------------------------------------------------------

describe('MixFileRuntime — duplicate filenames', () => {
  it('keeps last entry when two files resolve to the same name', async () => {
    // Two files with the SAME hash resolve to the same name.
    // The second entry should overwrite the first.
    const firstData = strToData('FIRST')
    const secondData = strToData('SECOND')
    const files: FileSpec[] = [
      { hash: HASH_A, data: firstData },
      { hash: HASH_A, data: secondData }, // same hash!
    ]
    const buf = createCncMixBuffer(files)
    const mixDb = new Map<string, string>()
    mixDb.set(FILE_A_HASH_KEY, 'dup.shp')

    const mix = MixFileRuntime.parse('dup.mix', buf, mixDb)

    // Only one entry kept (last wins)
    expect(mix.contents.length).toBe(1)
    expect(mix.contents[0]).toBe('dup.shp')

    // The data should be from the SECOND (last) entry
    const result = await mix.open('dup.shp')
    expect(new TextDecoder().decode(result!)).toBe('SECOND')
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.parse error message
// ---------------------------------------------------------------------------

describe('MixFileRuntime.parse error message', () => {
  it('includes the package name in the error', () => {
    const buf = createMixWithFirstUint16(0)
    expect(() => {
      MixFileRuntime.parse('my-custom-file.mix', buf)
    }).toThrow(/my-custom-file\.mix/)
  })
})

// ===========================================================================
// Phase B: Encrypted MIX support tests
// ===========================================================================

// ---------------------------------------------------------------------------
// Encrypted MIX test helpers
// ---------------------------------------------------------------------------

/** Generate a deterministic 56-byte test Blowfish key. */
function createTestKey(seed: number = 0x42): Uint8Array {
  const key = new Uint8Array(56)
  for (let i = 0; i < 56; i++) {
    key[i] = (seed + i * 7) & 0xFF
  }
  return key
}

/**
 * Build a universal key format encrypted MIX ArrayBuffer.
 *
 * Format:
 * - offset 0: uint16 flags = 0x0001 (universal key)
 * - offset 2: uint32 dataSize
 * - offset 6: Blowfish-encrypted header (padded to 8-byte blocks)
 * - after header: raw data blocks
 */
function createEncryptedMixBuffer(
  files: FileSpec[],
  key: Uint8Array,
): ArrayBuffer {
  const fish = new Blowfish(key)

  // Build plaintext header: numFiles(uint16) + dataSize(uint32) + entries(12 each)
  const numFiles = files.length
  let totalDataSize = 0
  for (const f of files) totalDataSize += f.data.byteLength

  const headerSize = 6 + numFiles * 12
  const blockCount = Math.ceil(headerSize / 8)
  const headerByteLength = blockCount * 8
  const dataStart = 6 + headerByteLength  // absolute offset of data blocks
  const totalSize = dataStart + totalDataSize

  const buf = new ArrayBuffer(totalSize)
  const dv = new DataView(buf)

  // Write flags (universal key) and dataSize
  dv.setUint16(0, 0x0001, true)
  dv.setUint32(2, totalDataSize, true)

  // Build plaintext header in a temporary buffer
  const plainHeader = new ArrayBuffer(headerByteLength)
  const plainDv = new DataView(plainHeader)
  plainDv.setUint16(0, numFiles, true)
  plainDv.setUint32(2, totalDataSize, true)

  let dataCursor = 0
  for (let i = 0; i < numFiles; i++) {
    const eo = 6 + i * 12
    plainDv.setUint32(eo, files[i].hash, true)
    plainDv.setUint32(eo + 4, dataCursor, true)
    plainDv.setUint32(eo + 8, files[i].data.byteLength, true)
    dataCursor += files[i].data.byteLength
  }

  // Encrypt header with Blowfish (returns a NEW Uint32Array)
  const headerU32 = new Uint32Array(plainHeader, 0, blockCount * 2)
  const encryptedU32 = fish.encrypt(headerU32)

  // Copy encrypted header bytes to output
  const encryptedBytes = new Uint8Array(encryptedU32.buffer, encryptedU32.byteOffset, headerByteLength)
  const outHeader = new Uint8Array(buf, 6, headerByteLength)
  outHeader.set(encryptedBytes)

  // Write data blocks
  dataCursor = 0
  for (const f of files) {
    const dest = new Uint8Array(buf, dataStart + dataCursor, f.data.byteLength)
    dest.set(f.data)
    dataCursor += f.data.byteLength
  }

  return buf
}

/**
 * Build an OpenRA format (flags=0, encrypted) buffer for detection testing.
 */
function createOpenRAEncryptedBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(100)
  const dv = new DataView(buf)
  dv.setUint16(0, 0x0000, true)    // OpenRA format marker
  dv.setUint16(2, 0x0002, true)    // bit 1 = encrypted
  // Fill remaining with non-zero filler
  for (let i = 4; i < 100; i++) {
    dv.setUint8(i, 0x42)
  }
  return buf
}

/** Test file specs for encrypted MIX tests. */
const ENC_TEST_KEY = createTestKey(0xAA)
const ENC_FILE_A_DATA = strToData('Encrypted file A')
const ENC_FILE_B_DATA = strToData('Encrypted file B content')

// ---------------------------------------------------------------------------
// MixFileRuntime.isEncryptedFormat
// ---------------------------------------------------------------------------

describe('MixFileRuntime.isEncryptedFormat', () => {
  it('returns true for universal key format (flags=1)', () => {
    const buf = createEncryptedMixBuffer(
      [{ hash: 0x1000, data: ENC_FILE_A_DATA }],
      ENC_TEST_KEY,
    )
    expect(MixFileRuntime.isEncryptedFormat(buf)).toBe(true)
  })

  it('returns true for OpenRA format (flags=0, encrypted bit set)', () => {
    const buf = createOpenRAEncryptedBuffer()
    expect(MixFileRuntime.isEncryptedFormat(buf)).toBe(true)
  })

  it('returns true for RSA key format (flags=2)', () => {
    const buf = new ArrayBuffer(10)
    const dv = new DataView(buf)
    dv.setUint16(0, 0x0002, true)  // RSA key flag
    dv.setUint32(2, 100, true)
    expect(MixFileRuntime.isEncryptedFormat(buf)).toBe(true)
  })

  it('returns false for valid C&C format with numFiles > 2', () => {
    // Use numFiles=3 to avoid conflict with universal key flag (1) and RSA flag (2)
    const files: FileSpec[] = [
      { hash: 0x3000, data: strToData('aaa') },
      { hash: 0x3001, data: strToData('bbb') },
      { hash: 0x3002, data: strToData('ccc') },
    ]
    const buf = createCncMixBuffer(files)
    expect(MixFileRuntime.isEncryptedFormat(buf)).toBe(false)
  })

  it('returns false for buffer smaller than minimum size', () => {
    const buf = new ArrayBuffer(4)
    expect(MixFileRuntime.isEncryptedFormat(buf)).toBe(false)
  })

  it('returns false for OpenRA format without encrypted flag', () => {
    const buf = new ArrayBuffer(100)
    const dv = new DataView(buf)
    dv.setUint16(0, 0x0000, true)  // OpenRA marker
    dv.setUint16(2, 0x0000, true)  // no flags
    expect(MixFileRuntime.isEncryptedFormat(buf)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.parseEncrypted
// ---------------------------------------------------------------------------

describe('MixFileRuntime.parseEncrypted', () => {
  it('parses a single-file encrypted MIX with explicit key', () => {
    const files: FileSpec[] = [
      { hash: 0x1234, data: ENC_FILE_A_DATA },
    ]
    const buf = createEncryptedMixBuffer(files, ENC_TEST_KEY)

    const mix = MixFileRuntime.parseEncrypted('enc-test.mix', buf, ENC_TEST_KEY)

    expect(mix.name).toBe('enc-test.mix')
    expect(mix.contents.length).toBe(1)
    expect(mix.contents[0]).toMatch(/^unresolved_0x[0-9A-F]{8}\.bin$/)
  })

  it('parses a multi-file encrypted MIX', () => {
    const files: FileSpec[] = [
      { hash: 0xAA00, data: ENC_FILE_A_DATA },
      { hash: 0xBB00, data: ENC_FILE_B_DATA },
    ]
    const buf = createEncryptedMixBuffer(files, ENC_TEST_KEY)

    const mix = MixFileRuntime.parseEncrypted('multi-enc.mix', buf, ENC_TEST_KEY)

    expect(mix.name).toBe('multi-enc.mix')
    expect(mix.contents.length).toBe(2)
  })

  it('resolves filenames via mixDb', () => {
    const hashA = 0xCAFE0001
    const hashB = 0xCAFE0002
    const files: FileSpec[] = [
      { hash: hashA, data: strToData('aaaa') },
      { hash: hashB, data: strToData('bbbb') },
    ]
    const buf = createEncryptedMixBuffer(files, ENC_TEST_KEY)

    const mixDb = new Map<string, string>()
    const hexA = '0x' + hashA.toString(16).toUpperCase().padStart(8, '0')
    const hexB = '0x' + hashB.toString(16).toUpperCase().padStart(8, '0')
    mixDb.set(hexA, 'alpha.dat')
    mixDb.set(hexB, 'bravo.dat')

    const mix = MixFileRuntime.parseEncrypted('resolved-enc.mix', buf, ENC_TEST_KEY, mixDb)

    expect(mix.contents).toContain('alpha.dat')
    expect(mix.contents).toContain('bravo.dat')
    expect(mix.contains('alpha.dat')).toBe(true)
    expect(mix.contains('bravo.dat')).toBe(true)
  })

  it('returns correct data for each file', async () => {
    const hashA = 0xD00D0001
    const hashB = 0xD00D0002
    const files: FileSpec[] = [
      { hash: hashA, data: strToData('first data block') },
      { hash: hashB, data: strToData('second block here') },
    ]
    const buf = createEncryptedMixBuffer(files, ENC_TEST_KEY)

    const mixDb = new Map<string, string>()
    const hexA = '0x' + hashA.toString(16).toUpperCase().padStart(8, '0')
    const hexB = '0x' + hashB.toString(16).toUpperCase().padStart(8, '0')
    mixDb.set(hexA, 'one.dat')
    mixDb.set(hexB, 'two.dat')

    const mix = MixFileRuntime.parseEncrypted('data-enc.mix', buf, ENC_TEST_KEY, mixDb)

    const dataA = await mix.open('one.dat')
    const dataB = await mix.open('two.dat')

    expect(new TextDecoder().decode(dataA!)).toBe('first data block')
    expect(new TextDecoder().decode(dataB!)).toBe('second block here')
  })

  it('throws without a key (none set as default)', () => {
    const files: FileSpec[] = [
      { hash: 0x1000, data: ENC_FILE_A_DATA },
    ]
    const buf = createEncryptedMixBuffer(files, ENC_TEST_KEY)

    // No key set as default and no explicit key
    expect(() => {
      MixFileRuntime.parseEncrypted('nokey.mix', buf)
    }).toThrow(/no Blowfish key available/i)
  })

  it('uses default key set via setDefaultEncryptedKey', () => {
    const files: FileSpec[] = [
      { hash: 0x9999, data: ENC_FILE_A_DATA },
    ]
    const buf = createEncryptedMixBuffer(files, ENC_TEST_KEY)

    MixFileRuntime.setDefaultEncryptedKey(ENC_TEST_KEY)
    try {
      const mix = MixFileRuntime.parseEncrypted('default-key.mix', buf)
      expect(mix.contents.length).toBe(1)
    } finally {
      MixFileRuntime.setDefaultEncryptedKey(null)
    }
  })

  it('throws for RSA key format (flags=2)', () => {
    const buf = new ArrayBuffer(20)
    const dv = new DataView(buf)
    dv.setUint16(0, 0x0002, true)
    dv.setUint32(2, 100, true)

    // Phase C: RSA key format is now processed (no longer immediately rejected).
    // The test data is too small/invalid so RSA decryption fails with a
    // data-related error, not a "not supported" error.
    expect(() => {
      MixFileRuntime.parseEncrypted('rsa.mix', buf, ENC_TEST_KEY)
    }).toThrow()
  })

  it('throws for OpenRA format (flags=0, encrypted)', () => {
    const buf = createOpenRAEncryptedBuffer()

    // Phase C: OpenRA format is now processed (no longer immediately rejected).
    // The test data has a garbage keyblock so it fails during RSA decryption
    // or header parsing, not with "not supported" error.
    expect(() => {
      MixFileRuntime.parseEncrypted('openra.mix', buf, ENC_TEST_KEY)
    }).toThrow()
  })

  it('throws for non-encrypted data', () => {
    // Use 3 files so first uint16 = 3 (not flags 1 or 2 which could be
    // confused with encrypted format indicators)
    const files: FileSpec[] = [
      { hash: 0x5100, data: strToData('aaa') },
      { hash: 0x5101, data: strToData('bbb') },
      { hash: 0x5102, data: strToData('ccc') },
    ]
    const buf = createCncMixBuffer(files)  // C&C format

    expect(() => {
      MixFileRuntime.parseEncrypted('plain.mix', buf, ENC_TEST_KEY)
    }).toThrow(/not a recognized encrypted MIX format/i)
  })

  it('handles multiple files with various data sizes', async () => {
    const files: FileSpec[] = [
      { hash: 0xE001, data: new Uint8Array([1]) },
      { hash: 0xE002, data: new Uint8Array(100).fill(0xAB) },
      { hash: 0xE003, data: new Uint8Array(7).fill(0xCD) },
      { hash: 0xE004, data: new Uint8Array(0) },  // empty file
    ]
    const buf = createEncryptedMixBuffer(files, ENC_TEST_KEY)

    const mix = MixFileRuntime.parseEncrypted('various.mix', buf, ENC_TEST_KEY)
    expect(mix.contents.length).toBe(4)

    const names = mix.contents
    const data1 = await mix.open(names[0])
    const data4 = await mix.open(names[3])
    expect(data1!.byteLength).toBe(1)
    expect(data4!.byteLength).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.setDefaultEncryptedKey
// ---------------------------------------------------------------------------

describe('MixFileRuntime.setDefaultEncryptedKey', () => {
  it('setting to null disables default key', () => {
    MixFileRuntime.setDefaultEncryptedKey(ENC_TEST_KEY)
    MixFileRuntime.setDefaultEncryptedKey(null)

    const files: FileSpec[] = [
      { hash: 0x1111, data: strToData('test') },
    ]
    const buf = createEncryptedMixBuffer(files, ENC_TEST_KEY)

    expect(() => {
      MixFileRuntime.parseEncrypted('disabled.mix', buf)
    }).toThrow(/no Blowfish key available/i)
  })

  it('can be called multiple times without error', () => {
    expect(() => {
      MixFileRuntime.setDefaultEncryptedKey(ENC_TEST_KEY)
      MixFileRuntime.setDefaultEncryptedKey(null)
      MixFileRuntime.setDefaultEncryptedKey(ENC_TEST_KEY)
      MixFileRuntime.setDefaultEncryptedKey(null)
    }).not.toThrow()
  })
})

// ===========================================================================
// Phase C: RSA key decryption + OpenRA format tests
// ===========================================================================

// ---------------------------------------------------------------------------
// RSA-encrypted MIX helpers (Phase C)
// ---------------------------------------------------------------------------

/** RSA public key (base64-encoded modulus from OpenRA). */
const RSA_PUBLIC_KEY_B64 = 'AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V'
const RSA_EXPONENT_UINT32 = 0x10001 // 65537

/**
 * Decode base64 public key to BigInt modulus.
 * Mirrors MixFileRuntime._getRsaModulus: strips DER header (ASN.1 INTEGER
 * tag 0x02 + length byte), then interprets remaining 40 bytes as big-endian.
 */
function getRsaModulus(): bigint {
  const binaryStr = atob(RSA_PUBLIC_KEY_B64)
  const derBytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    derBytes[i] = binaryStr.charCodeAt(i)
  }
  // Strip DER header: byte 0 = 0x02 (INTEGER tag), byte 1 = length
  const modulusLen = derBytes[1]
  const modulusBytes = derBytes.slice(2, 2 + modulusLen)
  let result = 0n
  for (let i = 0; i < modulusBytes.length; i++) {
    result = (result << 8n) | BigInt(modulusBytes[i])
  }
  return result
}

/**
 * Compute bit length of a BigInt.
 */
function bigIntBitLength(n: bigint): number {
  if (n === 0n) return 0
  return n.toString(2).length
}

/**
 * Modular exponentiation: base^exp mod modulus (square-and-multiply).
 */
function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n
  let result = 1n
  let b = base % modulus
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus
    e >>= 1n
    b = (b * b) % modulus
  }
  return result
}

/**
 * Convert a BigInt to Uint8Array with minimum length (big-endian, zero-padded).
 */
function bigIntToBytes(n: bigint, minLength: number): Uint8Array {
  if (n === 0n) return new Uint8Array(minLength)
  const bytes: number[] = []
  let remaining = n
  while (remaining > 0n) {
    bytes.unshift(Number(remaining & 0xFFn))
    remaining >>= 8n
  }
  while (bytes.length < minLength) bytes.unshift(0)
  return new Uint8Array(bytes)
}

// NOTE: rsaEncrypt and createOpenRAEncryptedMixBuffer are not used in active
// tests because RSA round-trip requires the private key exponent d (unavailable).
// These will be re-integrated when real encrypted MIX test data is available.
// See TODO-CI-C.3.

function bytesToBigIntForTest(bytes: Uint8Array): bigint {
  let result = 0n
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i])
  }
  return result
}

// NOTE: createOpenRAEncryptedMixBuffer, createRsaSafeTestKey, rsaEncrypt,
// and RSA_ENC_TEST_KEY are retained for reference but not used in active tests.
// They are available for future integration testing when real encrypted MIX
// files are available. See TODO-CI-C.3.

// ---------------------------------------------------------------------------
// RSA utility verification (independent of encrypt/decrypt round-trip)
// ---------------------------------------------------------------------------

describe('MixFileRuntime — RSA utilities (Phase C)', () => {
  it('modPow computes modular exponentiation correctly', () => {
    expect(modPow(3n, 5n, 7n)).toBe(5n)  // 3^5 mod 7 = 243 mod 7 = 5
    expect(modPow(2n, 10n, 1000n)).toBe(24n) // 2^10 = 1024, 1024 mod 1000 = 24
    expect(modPow(5n, 0n, 7n)).toBe(1n)  // any^0 mod n = 1
    expect(modPow(0n, 5n, 7n)).toBe(0n)  // 0^5 mod 7 = 0
  })

  it('BigInt byte conversion round-trips', () => {
    const original = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF])
    const bigInt = bytesToBigIntForTest(original)
    const converted = bigIntToBytes(bigInt, original.length)
    expect(converted).toEqual(original)
  })

  it('BigInt zero is handled correctly', () => {
    const converted = bigIntToBytes(0n, 4)
    expect(converted).toEqual(new Uint8Array([0, 0, 0, 0]))
  })

  it('RSA modulus is correctly decoded from base64', () => {
    const modulus = getRsaModulus()
    expect(modulus > 0n).toBe(true)
    const bitLen = bigIntBitLength(modulus)
    expect(bitLen).toBeGreaterThan(310)
    expect(bitLen).toBeLessThan(330)
  })

  // NOTE: RSA encrypt/decrypt round-trip cannot be tested without the private
  // key exponent d. OpenRA uses RSA with private key for encrypting the Blowfish
  // keyblock, and the public key (e=65537, given modulus) for decrypting.
  // The public key alone cannot encrypt data that is then decryptable with
  // the same public key (e·e ≠ 1 mod φ(n) in general).
  // TODO-CI-C.3: Add round-trip test if private exponent d becomes available.
})

// ---------------------------------------------------------------------------
// Phase C: RSA chunk sizes (structural verification)
// ---------------------------------------------------------------------------

describe('MixFileRuntime — RSA chunk sizes (Phase C)', () => {
  it('RSA chunk sizes are computed correctly from modulus', () => {
    const modulus = getRsaModulus()
    const bitLen = bigIntBitLength(modulus)
    const outSize = Math.floor((bitLen - 1) / 8)
    const inSize = outSize + 1

    // For a 319-bit modulus, outSize should be 39, inSize 40
    expect(outSize).toBe(39)
    expect(inSize).toBe(40)

    // pre_len = (55 / outSize + 1) * (outSize + 1)
    const preLen = (Math.floor(55 / outSize) + 1) * inSize
    // (55/39+1)*40 = (1+1)*40 = 80 (exactly matches keyblock size!)
    expect(preLen).toBe(80)
  })
})

// ---------------------------------------------------------------------------
// MixFileRuntime.parseEncrypted — previously unsupported formats (Phase C)
// ---------------------------------------------------------------------------

describe('MixFileRuntime.parseEncrypted — previously rejected formats (Phase C)', () => {
  it('accepts and processes OpenRA format (flags=0, encrypted)', () => {
    // For Phase C verification: OpenRA format no longer throws immediately.
    // Without a valid RSA keyblock, parsing fails later at the header
    // decryption stage. We verify that the old "not supported" error is gone.
    const buf = new ArrayBuffer(200)
    const dv = new DataView(buf)
    dv.setUint16(0, 0x0000, true)   // OpenRA format marker
    dv.setUint16(2, 0x0002, true)   // encrypted flag
    // Fill keyblock area with non-zero bytes
    for (let i = 4; i < 84; i++) dv.setUint8(i, 0x42)

    // Should not throw "RSA key decryption not supported" anymore
    // (may throw due to invalid data, which is expected)
    try {
      MixFileRuntime.parseEncrypted('openra-invalid.mix', buf)
    } catch (e: any) {
      // Acceptable: error from invalid data (not from "not supported" check)
      expect(e.message).not.toMatch(/not supported in Phase B/i)
    }
  })

  it('accepts and processes RSA key format (flags=2)', () => {
    const buf = new ArrayBuffer(200)
    const dv = new DataView(buf)
    dv.setUint16(0, 0x0002, true)   // RSA key format
    dv.setUint32(2, 100, true)      // dataSize
    // Fill keyblock area
    for (let i = 4; i < 84; i++) dv.setUint8(i, 0x42)

    // Should not throw "RSA-encrypted key not supported" anymore
    try {
      MixFileRuntime.parseEncrypted('rsa-invalid.mix', buf)
    } catch (e: any) {
      expect(e.message).not.toMatch(/not supported in Phase B/i)
    }
  })
})
