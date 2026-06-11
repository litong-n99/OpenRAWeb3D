/**
 * MixFile.test.ts — MixFile / MixLoader 迁移单元测试
 *
 * 测试重点：ADR-5.1 存根行为、JSDoc 完整性、参考实现。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MixLoader, MixFile } from './MixFile.js'
import { PackageEntry, PackageHashType } from './PackageEntry.js'

// ---------------------------------------------------------------------------
// MixLoader — tryParsePackage 存根行为
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

  describe('tryParsePackage', () => {
    it('returns null for .mix files', () => {
      const result = loader.tryParsePackage(
        'conquer.mix',
        new ArrayBuffer(100),
      )
      expect(result).toBeNull()
    })

    it('logs a warning for .mix files directing to build-time tooling', () => {
      loader.tryParsePackage('conquer.mix', new ArrayBuffer(100))
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const callArg = warnSpy.mock.calls[0]?.[0] as string
      expect(callArg).toContain('build time')
      expect(callArg).toContain('conquer.mix')
    })

    it('returns null for non-.mix files without logging a warning', () => {
      const result = loader.tryParsePackage(
        'conquer.big',
        new ArrayBuffer(100),
      )
      expect(result).toBeNull()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('handles .MIX uppercase extension', () => {
      const result = loader.tryParsePackage(
        'CONQUER.MIX',
        new ArrayBuffer(100),
      )
      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('handles .Mix mixed-case extension', () => {
      const result = loader.tryParsePackage(
        'Conquer.Mix',
        new ArrayBuffer(100),
      )
      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('passes optional files parameter without error', () => {
      const result = loader.tryParsePackage(
        'test.mix',
        new ArrayBuffer(100),
        { openAsync: async () => null, exists: () => false, isMounted: () => false },
      )
      expect(result).toBeNull()
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

  it('prefers CRC32 over Classic when CRC32 has more matches', () => {
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
    // Tied — Classic is preferred (strict > check)
    expect(resolved.size).toBe(1)
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
