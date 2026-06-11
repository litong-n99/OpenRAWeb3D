/**
 * PackageEntry.test.ts — PackageEntry 迁移单元测试
 *
 * 测试重点：哈希算法正确性、DataView 解析、toString 格式化。
 * 由于哈希算法完全确定且不依赖 GPU，所有逻辑均可进行单元测试。
 */

import { describe, it, expect } from 'vitest'
import { PackageEntry, PackageHashType } from './PackageEntry.js'

// ---------------------------------------------------------------------------
// 辅助函数：创建包含 PackageEntry 数据的 ArrayBuffer
// ---------------------------------------------------------------------------

function createEntryBuffer(hash: number, offset: number, length: number): DataView {
  const buf = new ArrayBuffer(12)
  const dv = new DataView(buf)
  dv.setUint32(0, hash, true)
  dv.setUint32(4, offset, true)
  dv.setUint32(8, length, true)
  return dv
}

// ---------------------------------------------------------------------------
// PackageEntry 构造与属性
// ---------------------------------------------------------------------------

describe('PackageEntry construction', () => {
  it('stores hash, offset, length as unsigned 32-bit values', () => {
    const entry = new PackageEntry(0xDEADBEEF, 1024, 512)
    expect(entry.hash).toBe(0xDEADBEEF)
    expect(entry.offset).toBe(1024)
    expect(entry.length).toBe(512)
  })

  it('normalizes negative values to unsigned 32-bit', () => {
    const entry = new PackageEntry(-1, -2, -3)
    expect(entry.hash).toBe(0xFFFFFFFF)
    expect(entry.offset).toBe(0xFFFFFFFE)
    expect(entry.length).toBe(0xFFFFFFFD)
  })

  it('clamps large values to 32-bit unsigned range', () => {
    const entry = new PackageEntry(0x1FFFFFFFF, 0x1FFFFFFFF, 0x1FFFFFFFF)
    expect(entry.hash).toBe(0xFFFFFFFF)
    expect(entry.offset).toBe(0xFFFFFFFF)
    expect(entry.length).toBe(0xFFFFFFFF)
  })

  it('has static SIZE = 12 (3 x uint32)', () => {
    expect(PackageEntry.SIZE).toBe(12)
  })
})

// ---------------------------------------------------------------------------
// fromDataView
// ---------------------------------------------------------------------------

describe('PackageEntry.fromDataView', () => {
  it('parses three little-endian uint32 values from a DataView', () => {
    const dv = createEntryBuffer(0x12345678, 0x9ABCDEF0, 0xAABBCCDD)
    const { entry, nextOffset } = PackageEntry.fromDataView(dv, 0)

    expect(entry.hash).toBe(0x12345678)
    expect(entry.offset).toBe(0x9ABCDEF0)
    expect(entry.length).toBe(0xAABBCCDD)
    expect(nextOffset).toBe(12)
  })

  it('parses at a non-zero offset in the DataView', () => {
    const buf = new ArrayBuffer(24)
    const dv = new DataView(buf)
    // 首先写入一些填充数据
    dv.setUint32(0, 0x11111111, true)
    dv.setUint32(4, 0x22222222, true)
    dv.setUint32(8, 0x33333333, true)
    // 在偏移量 12 处写入实际条目
    dv.setUint32(12, 0xAAAA5555, true)
    dv.setUint32(16, 0xBBBB6666, true)
    dv.setUint32(20, 0xCCCC7777, true)

    const { entry, nextOffset } = PackageEntry.fromDataView(dv, 12)
    expect(entry.hash).toBe(0xAAAA5555)
    expect(entry.offset).toBe(0xBBBB6666)
    expect(entry.length).toBe(0xCCCC7777)
    expect(nextOffset).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// toString
// ---------------------------------------------------------------------------

describe('PackageEntry.toString', () => {
  it('formats as hex with padded 8-character values', () => {
    const entry = new PackageEntry(0x1234, 0x0, 0xABCD)
    const str = entry.toString()
    expect(str).toBe('0x00001234 - offset 0x00000000 - length 0x0000ABCD')
  })

  it('formats maximum values correctly', () => {
    const entry = new PackageEntry(0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF)
    const str = entry.toString()
    expect(str).toBe('0xFFFFFFFF - offset 0xFFFFFFFF - length 0xFFFFFFFF')
  })

  it('uses uppercase hex digits', () => {
    const entry = new PackageEntry(0xabcdef12, 0x0, 0x0)
    const str = entry.toString()
    expect(str).toContain('ABCDEF12')
  })
})

// ---------------------------------------------------------------------------
// hashFilename — 基本属性
// ---------------------------------------------------------------------------

describe('PackageEntry.hashFilename', () => {
  describe('basic properties', () => {
    it('returns a 32-bit unsigned integer for Classic', () => {
      const h = PackageEntry.hashFilename('test', PackageHashType.Classic)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xFFFFFFFF)
    })

    it('returns a 32-bit unsigned integer for CRC32', () => {
      const h = PackageEntry.hashFilename('test', PackageHashType.CRC32)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xFFFFFFFF)
    })

    it('is deterministic — same input always gives same output', () => {
      const h1 = PackageEntry.hashFilename('conquer.mix', PackageHashType.Classic)
      const h2 = PackageEntry.hashFilename('conquer.mix', PackageHashType.Classic)
      expect(h1).toBe(h2)
    })
  })

  // -----------------------------------------------------------------------
  // 区分大小写 — OpenRA 在运行哈希之前统一转为大写
  // -----------------------------------------------------------------------

  describe('case insensitivity', () => {
    it('produces the same hash for different cases (Classic)', () => {
      const lower = PackageEntry.hashFilename('e1.shp', PackageHashType.Classic)
      const upper = PackageEntry.hashFilename('E1.SHP', PackageHashType.Classic)
      const mixed = PackageEntry.hashFilename('E1.ShP', PackageHashType.Classic)
      expect(lower).toBe(upper)
      expect(lower).toBe(mixed)
    })

    it('produces the same hash for different cases (CRC32)', () => {
      const lower = PackageEntry.hashFilename('e1.shp', PackageHashType.CRC32)
      const upper = PackageEntry.hashFilename('E1.SHP', PackageHashType.CRC32)
      const mixed = PackageEntry.hashFilename('E1.ShP', PackageHashType.CRC32)
      expect(lower).toBe(upper)
      expect(lower).toBe(mixed)
    })
  })

  // -----------------------------------------------------------------------
  // 已知文件名 — 验证算法自一致性
  // -----------------------------------------------------------------------

  describe('known filenames self-consistency', () => {
    const KNOWN_NAMES = [
      'e1.shp',
      'conquer.mix',
      'local mix database.dat',
      'global mix database.dat',
      'scores.mix',
      'tibsun.mix',
      'cache.mix',
      'conquer.eng',
      'installer.mix',
    ]

    it('all known filenames produce non-zero hashes for Classic', () => {
      for (const name of KNOWN_NAMES) {
        const h = PackageEntry.hashFilename(name, PackageHashType.Classic)
        expect(h, `Classic hash of "${name}" should not be 0`).not.toBe(0)
      }
    })

    it('all known filenames produce non-zero hashes for CRC32', () => {
      for (const name of KNOWN_NAMES) {
        const h = PackageEntry.hashFilename(name, PackageHashType.CRC32)
        expect(h, `CRC32 hash of "${name}" should not be 0`).not.toBe(0)
      }
    })

    it('Classic and CRC32 produce different hashes for the same name', () => {
      const classic = PackageEntry.hashFilename('e1.shp', PackageHashType.Classic)
      const crc = PackageEntry.hashFilename('e1.shp', PackageHashType.CRC32)
      expect(classic).not.toBe(crc)
    })

    it('all known filenames have unique Classic hashes', () => {
      const seen = new Set<number>()
      for (const name of KNOWN_NAMES) {
        const h = PackageEntry.hashFilename(name, PackageHashType.Classic)
        expect(
          seen.has(h),
          `Classic hash collision for "${name}": 0x${h.toString(16).padStart(8, '0')}`,
        ).toBe(false)
        seen.add(h)
      }
    })

    it('all known filenames have unique CRC32 hashes', () => {
      const seen = new Set<number>()
      for (const name of KNOWN_NAMES) {
        const h = PackageEntry.hashFilename(name, PackageHashType.CRC32)
        expect(
          seen.has(h),
          `CRC32 hash collision for "${name}": 0x${h.toString(16).padStart(8, '0')}`,
        ).toBe(false)
        seen.add(h)
      }
    })
  })

  // -----------------------------------------------------------------------
  // Classic 哈希 — 边界情况与填充
  // -----------------------------------------------------------------------

  describe('Classic hash — padding and edge cases', () => {
    it('handles empty string', () => {
      const h = PackageEntry.hashFilename('', PackageHashType.Classic)
      expect(h).toBe(0) // result starts at 0, no data to add
    })

    it('handles single character (pads to 4 bytes)', () => {
      const h = PackageEntry.hashFilename('A', PackageHashType.Classic)
      // 'A' + 3 nulls -> 0x00000041 -> result = 0x00000041
      expect(h).toBe(0x41)
    })

    it('handles 4-character name (no padding needed)', () => {
      const h = PackageEntry.hashFilename('ABCD', PackageHashType.Classic)
      // 'A','B','C','D' -> [0x41, 0x42, 0x43, 0x44]
      // uint32 LE = 0x44434241
      expect(h).toBe(0x44434241)
    })

    it('handles 5-character name (pads to 8 bytes)', () => {
      const h = PackageEntry.hashFilename('ABCDE', PackageHashType.Classic)
      // 'A','B','C','D','E' + 3 nulls = [0x41, 0x42, 0x43, 0x44, 0x45, 0x00, 0x00, 0x00]
      // uint32[0] = 0x44434241, uint32[1] = 0x00000045
      // result = 0x44434241
      // result = ((0x44434241 << 1) | (0x44434241 >>> 31)) + 0x00000045
      // 0x44434241 << 1 = 0x88868482, >>> 31 = 0 (MSB is 0)
      // result = 0x88868482 + 0x45 = 0x888684C7
      expect(h).toBe(0x888684C7)
    })

    it('pads correctly for names with length % 4 == 2', () => {
      const h6 = PackageEntry.hashFilename('AB', PackageHashType.Classic)
      // 'AB' + 2 nulls = [0x41, 0x42, 0x00, 0x00] -> 0x00004241
      expect(h6).toBe(0x4241)
    })

    it('pads correctly for names with length % 4 == 3', () => {
      const h = PackageEntry.hashFilename('ABC', PackageHashType.Classic)
      // 'ABC' + 1 null = [0x41, 0x42, 0x43, 0x00] -> 0x00434241
      expect(h).toBe(0x434241)
    })
  })

  // -----------------------------------------------------------------------
  // CRC32 哈希 — 边界情况与填充
  // -----------------------------------------------------------------------

  describe('CRC32 hash — padding and edge cases', () => {
    it('handles empty string (CRC32 of zero bytes)', () => {
      const h = PackageEntry.hashFilename('', PackageHashType.CRC32)
      // CRC32 of empty: crc = 0xFFFFFFFF -> finish: 0xFFFFFFFF ^ 0xFFFFFFFF = 0
      expect(h).toBe(0)
    })

    it('handles 4-character name (no special padding)', () => {
      const h = PackageEntry.hashFilename('ABCD', PackageHashType.CRC32)
      expect(h).not.toBe(0)
      expect(h).toBeLessThanOrEqual(0xFFFFFFFF)
    })

    it('produces different results for different names', () => {
      const h1 = PackageEntry.hashFilename('e1.shp', PackageHashType.CRC32)
      const h2 = PackageEntry.hashFilename('e2.shp', PackageHashType.CRC32)
      expect(h1).not.toBe(h2)
    })

    it('is consistent for repeated calls', () => {
      const h1 = PackageEntry.hashFilename('conquer.mix', PackageHashType.CRC32)
      const h2 = PackageEntry.hashFilename('conquer.mix', PackageHashType.CRC32)
      expect(h1).toBe(h2)
    })
  })

  // -----------------------------------------------------------------------
  // 无效哈希类型
  // -----------------------------------------------------------------------

  describe('invalid hash type', () => {
    it('throws for an unknown hash type', () => {
      expect(() => {
        PackageEntry.hashFilename('test', 999 as PackageHashType)
      }).toThrow(/Unknown hash type/)
    })
  })
})
