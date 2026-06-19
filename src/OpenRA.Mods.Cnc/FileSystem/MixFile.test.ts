/**
 * MixFile.test.ts — MixFile / MixLoader 迁移单元测试
 *
 * 测试重点：ADR-5.1 存根行为、JSDoc 完整性、参考实现、C&C 格式运行时解析、
 * Phase B 加密格式检测。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MixLoader, MixFile } from './MixFile.js'
import { PackageEntry, PackageHashType } from './PackageEntry.js'
import { MixFileRuntime } from './MixFileRuntime.js'
import { Blowfish } from '../FileFormats/Blowfish.js'

// ---------------------------------------------------------------------------
// Helpers — build a minimal valid C&C-format MIX binary
// ---------------------------------------------------------------------------

/**
 * Build a byte array that represents a valid C&C-format MIX file with the given
 * number of files. Each file entry gets a unique hash, zero offset, and a small
 * data size. All numeric fields are little-endian.
 *
 * Layout:
 * - bytes 0–1: numFiles (uint16 LE)
 * - bytes 2–5: totalDataSize (uint32 LE)
 * - bytes 6 – 6+12*numFiles-1: PackageEntry[] (12 bytes each)
 * - remaining: raw file data blocks (each file gets 4 bytes of filler)
 */
function buildCncMix(numFiles: number, fileSizes?: number[]): ArrayBuffer {
  const entrySize = 12
  const headerSize = 6 + numFiles * entrySize

  // Compute total data size
  const sizes = fileSizes ?? Array.from({ length: numFiles }, () => 4)
  const totalData = sizes.reduce((a, b) => a + b, 0)

  const buf = new ArrayBuffer(headerSize + totalData)
  const dv = new DataView(buf)

  dv.setUint16(0, numFiles, true)
  dv.setUint32(2, totalData, true)

  let dataOffset = 0
  for (let i = 0; i < numFiles; i++) {
    const eo = 6 + i * entrySize
    dv.setUint32(eo, 0x1000 + i, true) // hash
    dv.setUint32(eo + 4, dataOffset, true) // offset
    dv.setUint32(eo + 8, sizes[i], true) // size
    // Write filler data bytes
    for (let b = 0; b < sizes[i]; b++) {
      dv.setUint8(headerSize + dataOffset + b, 0x42 + i)
    }
    dataOffset += sizes[i]
  }

  return buf
}

/**
 * Build a byte array that looks like an encrypted RA/TS/RA2 MIX file.
 * First uint16 = 0 (OpenRA format marker), second uint16 has bit 1 set
 * (encrypted flag). This triggers isEncryptedFormat detection.
 */
function buildEncryptedMix(): ArrayBuffer {
  const buf = new ArrayBuffer(100)
  const dv = new DataView(buf)
  // Flags = 0 (RA/TS/RA2 format indicator)
  dv.setUint16(0, 0, true)
  // Sub-flags: bit 1 set = encrypted (value 0x0002)
  dv.setUint16(2, 0x0002, true)
  return buf
}

// ---------------------------------------------------------------------------
// MixLoader — tryParsePackage (updated: runtime C&C parsing)
// ---------------------------------------------------------------------------

describe('MixLoader', () => {
  let loader: MixLoader
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    loader = new MixLoader()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  describe('tryParsePackage — non-.mix files', () => {
    it('returns null for non-.mix files without logging a warning', () => {
      const result = loader.tryParsePackage(
        'conquer.big',
        new ArrayBuffer(100),
      )
      expect(result).toBeNull()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('returns null for files with no extension', () => {
      const result = loader.tryParsePackage(
        'README',
        new ArrayBuffer(100),
      )
      expect(result).toBeNull()
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('tryParsePackage — C&C format (.mix)', () => {
    it('returns a MixFileRuntime instance for valid C&C MIX data', () => {
      const mixData = buildCncMix(1, [10])
      const result = loader.tryParsePackage('test.mix', mixData)
      expect(result).not.toBeNull()
      expect(result).toBeInstanceOf(MixFileRuntime)
      expect(result!.name).toBe('test.mix')
    })

    it('parsed package contains the expected files', () => {
      const mixData = buildCncMix(3, [10, 20, 15])
      const result = loader.tryParsePackage('data.mix', mixData)
      expect(result).not.toBeNull()
      // Without a mixDb, files get placeholder names
      expect(result!.contents.length).toBe(3)
      for (const name of result!.contents) {
        expect(name).toMatch(/^unresolved_0x00001[0-9a-fA-F]{3}\.bin$/)
      }
    })

    it('can open files from the parsed MIX package', async () => {
      const mixData = buildCncMix(1, [10])
      const result = loader.tryParsePackage('test.mix', mixData)!
      expect(result).not.toBeNull()

      const contents = result.contents
      expect(contents.length).toBe(1)
      const fileData = await result.open(contents[0])
      expect(fileData).not.toBeNull()
      expect(fileData!.byteLength).toBe(10)
    })

    it('resolves filenames when mixDb is set', () => {
      // Build a MIX with file hash 0x1000
      const mixData = buildCncMix(1, [8])
      const mixDb = new Map<string, string>()
      mixDb.set('0x00001000', 'e1.shp')
      MixLoader.setMixDb(mixDb)

      const result = loader.tryParsePackage('test.mix', mixData)
      expect(result).not.toBeNull()
      expect(result!.contents).toContain('e1.shp')
    })

    it('handles .MIX uppercase extension for C&C data', () => {
      const mixData = buildCncMix(1, [5])
      const result = loader.tryParsePackage('CONQUER.MIX', mixData)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('CONQUER.MIX')
    })

    it('handles .Mix mixed-case extension for C&C data', () => {
      const mixData = buildCncMix(1, [5])
      const result = loader.tryParsePackage('Conquer.Mix', mixData)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Conquer.Mix')
    })

    it('calls contains correctly for files in the package', () => {
      const mixData = buildCncMix(3, [10, 20, 15])
      const result = loader.tryParsePackage('test.mix', mixData)!
      const firstFile = result.contents[0]
      expect(result.contains(firstFile)).toBe(true)
      expect(result.contains('nonexistent.shp')).toBe(false)
    })
  })

  describe('tryParsePackage — encrypted format (.mix)', () => {
    it('returns null for encrypted OpenRA format MIX (first uint16 == 0)', () => {
      const encData = buildEncryptedMix()
      const result = loader.tryParsePackage('encrypted.mix', encData)
      expect(result).toBeNull()
    })

    it('logs an RSA-related warning for encrypted OpenRA format MIX files', () => {
      const encData = buildEncryptedMix()
      loader.tryParsePackage('encrypted.mix', encData)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const callArg = warnSpy.mock.calls[0]?.[0] as string
      expect(callArg).toContain('RSA key decryption')
      expect(callArg).toContain('encrypted.mix')
    })
  })

  describe('tryParsePackage — Phase B encrypted format (.mix)', () => {
    /** Build a universal-key encrypted MIX buffer for testing. */
    function buildEncryptedTestMix(): ArrayBuffer {
      const key = new Uint8Array(56).fill(0x77)
      const fish = new Blowfish(key)
      // Build header: 1 file, hash 0x5000
      const headerByteLength = 24
      const headerData = new ArrayBuffer(headerByteLength)
      const hdv = new DataView(headerData)
      hdv.setUint16(0, 1, true)       // numFiles = 1
      hdv.setUint32(2, 5, true)       // dataSize = 5
      hdv.setUint32(6, 0x5000, true)  // hash
      hdv.setUint32(10, 0, true)      // offset
      hdv.setUint32(14, 5, true)      // length
      const padView = new Uint8Array(headerData, 18, 6)
      padView.fill(0)

      const headerU32 = new Uint32Array(headerData, 0, 6)
      const encryptedU32 = fish.encrypt(headerU32)

      const totalSize = 6 + headerByteLength + 5
      const buf = new ArrayBuffer(totalSize)
      const dv = new DataView(buf)
      dv.setUint16(0, 0x0001, true)  // universal key flag
      dv.setUint32(2, 5, true)       // dataSize
      const encBytes = new Uint8Array(encryptedU32.buffer, encryptedU32.byteOffset, headerByteLength)
      new Uint8Array(buf, 6, headerByteLength).set(encBytes)
      new Uint8Array(buf, 30, 5).fill(0x42)
      return buf
    }

    it('returns null when OpenRA encrypted MIX detected but no key set', () => {
      // Use OpenRA format (first uint16=0) to avoid C&C fallthrough ambiguity
      const encData = buildEncryptedMix()  // first uint16=0, second uint16=2
      const result = loader.tryParsePackage('test-enc.mix', encData)
      expect(result).toBeNull()
    })

    it('logs "no Blowfish key" warning when encrypted format detected without key', () => {
      const encData = buildEncryptedTestMix()  // first uint16=1, ambiguous
      // Since firstUint16=1 could also be C&C numFiles=1, the Loader falls through
      // to C&C and parses the file. So there should be no warning logged.
      // The key-not-available warning happens in parseEncrypted, but since we
      // fall through, the C&C parse may succeed or fail separately.
      // This test verifies that encrypted detection runs first and logs when key absent.
      const result = loader.tryParsePackage('test-enc.mix', encData)
      // With firstUint16=1 and no key: parseEncrypted fails (no key),
      // falls through to C&C (isCncFormat true for 1), C&C parse succeeds
      expect(result).not.toBeNull()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const callArg = warnSpy.mock.calls[0]?.[0] as string
      expect(callArg).toContain('no Blowfish key')
    })

    it('returns a MixFileRuntime when key is set as default', () => {
      const encData = buildEncryptedTestMix()
      const testKey = new Uint8Array(56).fill(0x77)
      MixFileRuntime.setDefaultEncryptedKey(testKey)
      try {
        const result = loader.tryParsePackage('test-enc.mix', encData)
        expect(result).not.toBeNull()
        expect(result!.contents.length).toBe(1)
        expect(result!.name).toBe('test-enc.mix')
      } finally {
        MixFileRuntime.setDefaultEncryptedKey(null)
      }
    })
  })

  describe('tryParsePackage — too-small .mix data', () => {
    it('returns null for .mix files smaller than header minimum', () => {
      const result = loader.tryParsePackage('tiny.mix', new ArrayBuffer(2))
      expect(result).toBeNull()
      // Small buffer: both isEncryptedFormat and isCncFormat return false
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0]?.[0] as string).toContain('not a recognized MIX format')
    })
  })
})

// ---------------------------------------------------------------------------
// MixFile — IReadOnlyPackage 存根行为
// ---------------------------------------------------------------------------

describe('MixFile (stub)', () => {
  let mixFile: MixFile

  beforeEach(() => {
    mixFile = new MixFile(new ArrayBuffer(100), 'test.mix')
  })

  it('stores the filename as name', () => {
    expect(mixFile.name).toBe('test.mix')
  })

  it('has empty contents', () => {
    expect(mixFile.contents).toEqual([])
  })

  it('contains returns false for any filename', () => {
    expect(mixFile.contains('anything.shp')).toBe(false)
    expect(mixFile.contains('')).toBe(false)
  })

  it('open returns null for any filename', async () => {
    const result = await mixFile.open('anything.shp')
    expect(result).toBeNull()
  })

  it('openPackage always returns null', () => {
    expect(mixFile.openPackage('anything.shp')).toBeNull()
  })

  it('dispose is a no-op (does not throw)', () => {
    expect(() => mixFile.dispose()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// MixFile.parseHeader — 参考实现
// ---------------------------------------------------------------------------

describe('MixFile.parseHeader (reference implementation)', () => {
  it('parses a simple C&C header', () => {
    // 构建一个最小的 C&C MIX 头部
    const buf = new ArrayBuffer(20)
    const dv = new DataView(buf)
    // numFiles = 1 (uint16 LE at offset 0)
    dv.setUint16(0, 1, true)
    // dataSize = 0 (uint32 LE at offset 2)
    dv.setUint32(2, 0, true)
    // PackageEntry at offset 6
    dv.setUint32(6, 0x12345678, true) // hash
    dv.setUint32(10, 0, true)          // offset
    dv.setUint32(14, 100, true)        // length

    const { entries, dataStart } = MixFile.parseHeader(
      new Uint8Array(buf), 0, true,
    )

    expect(entries.length).toBe(1)
    expect(entries[0].hash).toBe(0x12345678)
    expect(entries[0].offset).toBe(0)
    expect(entries[0].length).toBe(100)
    // dataStart = 6 + 12 = 18
    expect(dataStart).toBe(18)
  })

  it('parses multiple entries in C&C format', () => {
    const numFiles = 3
    const buf = new ArrayBuffer(6 + numFiles * 12)
    const dv = new DataView(buf)
    dv.setUint16(0, numFiles, true)
    dv.setUint32(2, 0, true)
    for (let i = 0; i < numFiles; i++) {
      const off = 6 + i * 12
      dv.setUint32(off, 0xAA + i, true)
      dv.setUint32(off + 4, i * 100, true)
      dv.setUint32(off + 8, 50, true)
    }

    const { entries, dataStart } = MixFile.parseHeader(
      new Uint8Array(buf), 0, true,
    )

    expect(entries.length).toBe(numFiles)
    expect(entries[0].hash).toBe(0xAA)
    expect(entries[1].offset).toBe(100)
    expect(entries[2].offset).toBe(200)
    expect(dataStart).toBe(6 + numFiles * 12)
  })

  it('parses RA/TS/RA2 format header (isCncMix = false)', () => {
    // RA format: parseHeader with isCncMix=false reads from offset 4.
    // Setup buffer so numFiles is at byte 4, dataSize at byte 6, entries at byte 10.
    const raNumFiles = 1
    const raBuf = new ArrayBuffer(22)
    const raDv = new DataView(raBuf)
    // bytes 0-3: skipped (flags area)
    raDv.setUint32(0, 0, true)
    // byte 4: numFiles
    raDv.setUint16(4, raNumFiles, true)
    // byte 6: dataSize
    raDv.setUint32(6, 0, true)
    // byte 10: PackageEntry
    raDv.setUint32(10, 0xBEEF, true)
    raDv.setUint32(14, 200, true)
    raDv.setUint32(18, 300, true)

    const { entries, dataStart } = MixFile.parseHeader(
      new Uint8Array(raBuf), 0, false,
    )

    expect(entries.length).toBe(1)
    expect(entries[0].hash).toBe(0xBEEF)
    expect(entries[0].offset).toBe(200)
    expect(entries[0].length).toBe(300)
    expect(dataStart).toBe(10 + 12) // 22
  })

  it('handles zero files', () => {
    const buf = new ArrayBuffer(6)
    const dv = new DataView(buf)
    dv.setUint16(0, 0, true)
    dv.setUint32(2, 0, true)

    const { entries, dataStart } = MixFile.parseHeader(
      new Uint8Array(buf), 0, true,
    )

    expect(entries.length).toBe(0)
    expect(dataStart).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// MixFile.parseIndex — 参考实现
// ---------------------------------------------------------------------------

describe('MixFile.parseIndex (reference implementation)', () => {
  it('resolves filenames using both Classic and CRC32 hashes', () => {
    // 创建带有已知文件名的哈希条目
    const entries = new Map<number, PackageEntry>()

    const name1 = 'e1.shp'
    const hash1 = PackageEntry.hashFilename(name1, PackageHashType.CRC32)
    entries.set(hash1, new PackageEntry(hash1, 0, 100))

    const name2 = 'htnk.shp'
    const hash2 = PackageEntry.hashFilename(name2, PackageHashType.CRC32)
    entries.set(hash2, new PackageEntry(hash2, 100, 200))

    const globalFilenames = ['e1.shp', 'htnk.shp', 'unknown.shp']

    const resolved = MixFile.parseIndex(entries, globalFilenames)

    expect(resolved.size).toBe(2)
    expect(resolved.has('e1.shp')).toBe(true)
    expect(resolved.has('htnk.shp')).toBe(true)
    expect(resolved.has('unknown.shp')).toBe(false)
  })

  it('prefers Classic over CRC32 when both have equal matches', () => {
    const entries = new Map<number, PackageEntry>()

    const name1 = 'test.shp'
    // Classic hash for name1
    const classicHash1 = PackageEntry.hashFilename(name1, PackageHashType.Classic)
    entries.set(classicHash1, new PackageEntry(classicHash1, 0, 100))
    // CRC32 hash for name1 (not present)
    // CRC32 hash for name2
    const name2 = 'other.shp'
    const crcHash2 = PackageEntry.hashFilename(name2, PackageHashType.CRC32)
    entries.set(crcHash2, new PackageEntry(crcHash2, 200, 300))

    // Both filenames in global list
    const globalFilenames = ['test.shp', 'other.shp']

    const resolved = MixFile.parseIndex(entries, globalFilenames)

    // CRC32 matches: other.shp (1 match)
    // Classic matches: test.shp (1 match)
    // Tied — Classic is preferred
    expect(resolved.size).toBe(1)
    expect(resolved.has('test.shp')).toBe(true)
  })

  it('prefers CRC32 over Classic when CRC32 has more matches', () => {
    const entries = new Map<number, PackageEntry>()

    // Classic match for file A
    const nameA = 'solo.shp'
    const classicHashA = PackageEntry.hashFilename(nameA, PackageHashType.Classic)
    entries.set(classicHashA, new PackageEntry(classicHashA, 0, 100))

    // CRC32 matches for file B and file C
    const nameB = 'duo_a.shp'
    const nameC = 'duo_b.shp'
    const crcHashB = PackageEntry.hashFilename(nameB, PackageHashType.CRC32)
    const crcHashC = PackageEntry.hashFilename(nameC, PackageHashType.CRC32)
    entries.set(crcHashB, new PackageEntry(crcHashB, 100, 200))
    entries.set(crcHashC, new PackageEntry(crcHashC, 300, 150))

    const globalFilenames = ['solo.shp', 'duo_a.shp', 'duo_b.shp']

    const resolved = MixFile.parseIndex(entries, globalFilenames)

    // CRC32 matches: duo_a.shp + duo_b.shp (2 matches)
    // Classic matches: solo.shp (1 match)
    // CRC32 has more matches → CRC32 index wins
    expect(resolved.size).toBe(2)
    expect(resolved.has('duo_a.shp')).toBe(true)
    expect(resolved.has('duo_b.shp')).toBe(true)
    expect(resolved.has('solo.shp')).toBe(false)
  })

  it('handles empty global filenames list', () => {
    const entries = new Map<number, PackageEntry>()
    entries.set(0x1234, new PackageEntry(0x1234, 0, 100))

    const resolved = MixFile.parseIndex(entries, [])

    expect(resolved.size).toBe(0)
  })

  it('handles empty entries map', () => {
    const entries = new Map<number, PackageEntry>()
    const globalFilenames = ['e1.shp', 'htnk.shp']

    const resolved = MixFile.parseIndex(entries, globalFilenames)

    expect(resolved.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// MixFile.decryptHeader — 存根（抛出异常）
// ---------------------------------------------------------------------------

describe('MixFile.decryptHeader', () => {
  it('throws an error directing to build-time tooling', () => {
    expect(() => {
      MixFile.decryptHeader(new Uint8Array(100), 4)
    }).toThrow(/Blowfish decryption/)
  })
})

// ---------------------------------------------------------------------------
// MixFile.RSA_PUBLIC_KEY
// ---------------------------------------------------------------------------

describe('MixFile.RSA_PUBLIC_KEY', () => {
  it('matches OpenRA BlowfishKeyProvider.PublicKeyString', () => {
    expect(MixFile.RSA_PUBLIC_KEY).toBe(
      'AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V',
    )
  })
})
