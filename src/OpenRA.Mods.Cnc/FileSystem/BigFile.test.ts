/**
 * BigFile.test.ts — BigFile / BigFileLoader 迁移单元测试
 *
 * 测试重点：大端序解析、ASCIIZ 字符串、数据提取、签名验证。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { BigFileLoader } from './BigFile.js'
import type { IReadOnlyPackage } from '../../OpenRA.Game/FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// 辅助函数：构建 BIG 文件二进制数据
// ---------------------------------------------------------------------------

/**
 * 在缓冲区中写入大端序 uint32。
 */
function setUint32BE(dv: DataView, offset: number, value: number): void {
  dv.setUint32(offset, value, false) // false = big-endian
}

/**
 * 在缓冲区中写入以 null 结尾的 ASCII 字符串。
 * @returns 写入的字节数（包括 null 终止符）
 */
function writeASCIIZ(dv: DataView, offset: number, str: string): number {
  for (let i = 0; i < str.length; i++) {
    dv.setUint8(offset + i, str.charCodeAt(i) & 0xFF)
  }
  dv.setUint8(offset + str.length, 0) // null 终止符
  return str.length + 1
}

/**
 * 创建最小的有效 BIG 文件缓冲区。
 */
function createBigBuffer(entries: Array<{ offset: number; size: number; path: string }>): ArrayBuffer {
  // 首先计算头部大小
  let headerSize = 16 // 4(sig) + 4(totalSize) + 4(numEntries) + 4(firstEntryOffset)
  for (const e of entries) {
    headerSize += 4 + 4 + e.path.length + 1 // offset(4) + size(4) + ASCIIZ path
  }

  // 验证数据偏移量不重叠：调整任何太小的偏移量
  const adjustedEntries = entries.map((e) => {
    if (e.offset < headerSize) {
      // 偏移量位于头部内部——将文件上的使用告知调用者
      throw new Error(
        `Entry "${e.path}" offset ${e.offset} overlaps header (size ${headerSize}). ` +
        `Use offset >= ${headerSize}.`,
      )
    }
    return e
  })

  // 计算总大小
  let totalSize = headerSize
  for (const e of adjustedEntries) {
    const dataEnd = e.offset + e.size
    if (dataEnd > totalSize) totalSize = dataEnd
  }

  const buf = new ArrayBuffer(totalSize)
  const dv = new DataView(buf)

  // 签名
  let pos = 0
  dv.setUint8(pos++, 0x42) // B
  dv.setUint8(pos++, 0x49) // I
  dv.setUint8(pos++, 0x47) // G
  dv.setUint8(pos++, 0x46) // F

  // totalSize (BE)
  setUint32BE(dv, pos, totalSize)
  pos += 4

  // numEntries (BE)
  setUint32BE(dv, pos, entries.length)
  pos += 4

  // firstEntryOffset (BE) — 通常为 0，在 EA .big 文件中不可靠
  setUint32BE(dv, pos, 0)
  pos += 4

  // 条目
  for (const e of entries) {
    setUint32BE(dv, pos, e.offset)
    pos += 4
    setUint32BE(dv, pos, e.size)
    pos += 4
    pos += writeASCIIZ(dv, pos, e.path)
  }

  // 将测试数据写入数据块（写入可识别的模式）
  for (const e of entries) {
    const data = new Uint8Array(buf, e.offset, e.size)
    for (let i = 0; i < e.size; i++) {
      data[i] = (e.path.charCodeAt(0) + i) & 0xFF
    }
  }

  return buf
}

// ---------------------------------------------------------------------------
// BigFileLoader
// ---------------------------------------------------------------------------

describe('BigFileLoader', () => {
  let loader: BigFileLoader

  beforeEach(() => {
    loader = new BigFileLoader()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('tryParsePackage', () => {
    it('parses a valid BIG file with one entry', () => {
      const buf = createBigBuffer([
        { offset: 100, size: 10, path: 'test.txt' },
      ])

      const pkg = loader.tryParsePackage('data.big', buf)
      expect(pkg).not.toBeNull()
      expect(pkg!.name).toBe('data.big')
      expect(pkg!.contains('test.txt')).toBe(true)
    })

    it('returns null for files without BIGF signature', () => {
      const buf = new ArrayBuffer(100)
      const dv = new DataView(buf)
      dv.setUint32(0, 0x12345678, true) // 不是 "BIGF"

      const pkg = loader.tryParsePackage('data.big', buf)
      expect(pkg).toBeNull()
    })

    it('returns null for files too small to contain a signature', () => {
      const buf = new ArrayBuffer(3)
      const pkg = loader.tryParsePackage('data.big', buf)
      expect(pkg).toBeNull()
    })

    it('returns null for empty buffer', () => {
      const buf = new ArrayBuffer(0)
      const pkg = loader.tryParsePackage('data.big', buf)
      expect(pkg).toBeNull()
    })

    it('handles files with .big extension but invalid signature gracefully', () => {
      // "BIG" (3 bytes) vs "BIGF" (4 bytes) — different signature
      const buf = new ArrayBuffer(4)
      const dv = new DataView(buf)
      dv.setUint8(0, 0x42) // B
      dv.setUint8(1, 0x49) // I
      dv.setUint8(2, 0x47) // G
      dv.setUint8(3, 0x00) // not F

      const pkg = loader.tryParsePackage('data.big', buf)
      expect(pkg).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// BigFile — 包操作
// ---------------------------------------------------------------------------

describe('BigFile (IReadOnlyPackage)', () => {
  let pkg: IReadOnlyPackage

  // 创建带有已知条目的测试包
  const testEntries = [
    { offset: 200, size: 15, path: 'readme.txt' },
    { offset: 300, size: 25, path: 'data/config.ini' },
    { offset: 400, size: 8, path: 'image.png' },
  ]

  beforeEach(() => {
    const buf = createBigBuffer(testEntries)
    const loader = new BigFileLoader()
    pkg = loader.tryParsePackage('test.big', buf)!
    expect(pkg).not.toBeNull()
  })

  describe('name', () => {
    it('returns the provided filename', () => {
      expect(pkg.name).toBe('test.big')
    })
  })

  describe('contents', () => {
    it('returns all entry paths sorted alphabetically', () => {
      const contents = pkg.contents
      expect(contents).toEqual([
        'data/config.ini',
        'image.png',
        'readme.txt',
      ])
    })

    it('returns sorted contents as an array', () => {
      const contents = pkg.contents
      expect(Array.isArray(contents)).toBe(true)
      expect(contents.length).toBe(3)
      // 内容按字母顺序排列
      expect(contents[0]).toBe('data/config.ini')
    })
  })

  describe('contains', () => {
    it('returns true for existing files', () => {
      expect(pkg.contains('readme.txt')).toBe(true)
      expect(pkg.contains('data/config.ini')).toBe(true)
      expect(pkg.contains('image.png')).toBe(true)
    })

    it('returns false for non-existing files', () => {
      expect(pkg.contains('missing.txt')).toBe(false)
      expect(pkg.contains('')).toBe(false)
    })

    it('handles case-sensitive lookups', () => {
      expect(pkg.contains('README.TXT')).toBe(false)
    })
  })

  describe('open', () => {
    it('extracts correct data for existing files', async () => {
      const data = await pkg.open('readme.txt')
      expect(data).not.toBeNull()
      expect(data!.byteLength).toBe(15)

      // 验证内容匹配构建时写入的可识别模式
      const bytes = new Uint8Array(data!)
      // "r" = 0x72, 字节 0 = 0x72, 字节 1 = 0x73, ...
      expect(bytes[0]).toBe(0x72)
      expect(bytes[1]).toBe(0x73)
    })

    it('returns null for non-existing files', async () => {
      const data = await pkg.open('nonexistent.bin')
      expect(data).toBeNull()
    })

    it('returns an independent copy each call', async () => {
      const data1 = await pkg.open('readme.txt')
      const data2 = await pkg.open('readme.txt')
      expect(data1).not.toBeNull()
      expect(data2).not.toBeNull()
      // 应该是不同的 ArrayBuffer 实例
      expect(data1).not.toBe(data2)
      // 但内容相同
      expect(new Uint8Array(data1!)).toEqual(new Uint8Array(data2!))
    })

    it('correctly extracts data at different offsets', async () => {
      const data1 = await pkg.open('readme.txt')
      const data2 = await pkg.open('data/config.ini')

      expect(data1!.byteLength).toBe(15)
      expect(data2!.byteLength).toBe(25)
      // 不同偏移量应产生不同内容
      expect(new Uint8Array(data1!)).not.toEqual(new Uint8Array(data2!))
    })
  })

  describe('openPackage', () => {
    it('always returns null (not implemented)', () => {
      expect(pkg.openPackage('readme.txt')).toBeNull()
      expect(pkg.openPackage('data/config.ini')).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// BigFile — 生命周期与边界情况
// ---------------------------------------------------------------------------

describe('BigFile lifecycle', () => {
  it('dispose clears internal references', () => {
    const buf = createBigBuffer([{ offset: 100, size: 10, path: 'a.txt' }])
    const loader = new BigFileLoader()
    const pkg = loader.tryParsePackage('test.big', buf)!

    pkg.dispose()

    // 释放后内容应为空
    expect(pkg.contents).toEqual([])
    expect(pkg.contains('a.txt')).toBe(false)
  })

  it('dispose does not throw when called multiple times', () => {
    const buf = createBigBuffer([{ offset: 100, size: 10, path: 'a.txt' }])
    const loader = new BigFileLoader()
    const pkg = loader.tryParsePackage('test.big', buf)!

    expect(() => {
      pkg.dispose()
      pkg.dispose()
    }).not.toThrow()
  })

  it('handles BIG files with many entries', () => {
    // 每个条目：4(offset) + 4(size) + 15(path "file_XXXX.dat\0") = 23 字节
    // 头部：16 + 50 * 23 = 1166
    const entrySize = 23
    const headerSize = 16 + 50 * entrySize // 1166
    const dataBaseOffset = headerSize + 100 // 确保数据在头部之后开始

    const entries = []
    for (let i = 0; i < 50; i++) {
      entries.push({
        offset: dataBaseOffset + i * 50,
        size: 30,
        path: `file_${i.toString().padStart(4, '0')}.dat`,
      })
    }
    const buf = createBigBuffer(entries)
    const loader = new BigFileLoader()
    const pkg = loader.tryParsePackage('large.big', buf)

    expect(pkg).not.toBeNull()
    expect(pkg!.contents.length).toBe(50)
    expect(pkg!.contains('file_0049.dat')).toBe(true)
  })
})
