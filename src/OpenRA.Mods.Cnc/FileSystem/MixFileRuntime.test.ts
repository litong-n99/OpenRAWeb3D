/**
 * MixFileRuntime.test.ts — MixFileRuntime 迁移单元测试
 *
 * 测试重点：C&C MIX 格式解析、isCncFormat 检测、文件名解析、
 * 数据访问正确性、边界情况处理、dispose 清理。
 * 所有逻辑均为纯数据处理，无需 Babylon.js 依赖。
 */

import { describe, it, expect } from 'vitest'
import { MixFileRuntime } from './MixFileRuntime.js'

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
// MixFileRuntime — error message includes name
// ---------------------------------------------------------------------------

describe('MixFileRuntime.parse error message', () => {
  it('includes the package name in the error', () => {
    const buf = createMixWithFirstUint16(0)
    expect(() => {
      MixFileRuntime.parse('my-custom-file.mix', buf)
    }).toThrow(/my-custom-file\.mix/)
  })
})
