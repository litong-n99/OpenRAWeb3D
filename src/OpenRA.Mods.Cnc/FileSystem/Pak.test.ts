/**
 * Pak.test.ts — PakFile / PakFileLoader 迁移单元测试
 *
 * 测试重点：偏移量链表解析、ASCIIZ 文件名、数据提取、扩展名识别。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { PakFileLoader } from './Pak.js'
import type { IReadOnlyPackage } from '../../OpenRA.Game/FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// 辅助函数：构建 PAK 文件二进制数据
// ---------------------------------------------------------------------------

/**
 * 创建 PAK 文件缓冲区。
 *
 * PAK 格式:
 * ```
 * [4 bytes: firstFileOffset (uint32 LE)]
 * [ASCIIZ filename + 4 bytes nextOffset] × N
 * [4 bytes: 0x00000000] — 链表结束
 * [data blocks at specified offsets...]
 * ```
 */
function createPakBuffer(files: Array<{ name: string; data: Uint8Array }>): ArrayBuffer {
  // 计算索引大小
  let indexSize = 4 // 首个偏移量
  for (const f of files) {
    indexSize += f.name.length + 1 + 4 // ASCIIZ name + nextOffset uint32
  }
  indexSize += 4 // 终止符 (0x00000000)... 等等，由 nextOffset==0 终止

  // 实际上：最后一个条目后跟 uint32 = 0 作为链表终止。
  // 如果已经有 nextOffset 字段，最后一个条目的 nextOffset=0 就是终止。
  // 但我们要在最后一条后面加尾随的 0 uint32... 等等，让我看看格式。
  //
  // while (offset != 0):
  //   file = readASCIIZ()
  //   next = readUInt32()
  //   length = (next == 0 ? streamLength : next) - offset
  //   entry stored
  //
  // 所以最后一个 entry 后跟的就是 0x00000000 作为 nextOffset。
  // 不需要额外的终止符。
  //
  // 但是，如果 files 为空，格式是什么样的？
  // firstFileOffset = 0x00000000 → while (offset != 0) 立即退出 → 空索引。
  //
  // 对于有文件的情况：
  // [4 bytes: offset_of_first_data]
  // [ASCIIZ name1][4 bytes: offset_of_second_data or 0]
  // [ASCIIZ name2][4 bytes: 0x00000000 (last)]
  // [data blocks...]

  // 计算数据偏移量 — 从索引末尾之后开始
  let dataStart = 4 // 首个偏移量
  for (const f of files) {
    dataStart += f.name.length + 1 + 4 // name + null + nextOffset
  }
  // 不需要额外的终止符，因为最后一个条目的 nextOffset 就是 0

  // 分配总缓冲区
  let totalSize = dataStart
  const fileOffsets: number[] = []
  for (const f of files) {
    fileOffsets.push(totalSize)
    totalSize += f.data.length
  }

  const buf = new ArrayBuffer(totalSize)
  const dv = new DataView(buf)
  let pos = 0

  // firstFileOffset
  if (files.length > 0) {
    dv.setUint32(pos, fileOffsets[0], true)
  } else {
    dv.setUint32(pos, 0, true) // 空包
  }
  pos += 4

  // 条目链表
  for (let i = 0; i < files.length; i++) {
    const f = files[i]

    // 文件名（ASCIIZ）
    for (let j = 0; j < f.name.length; j++) {
      dv.setUint8(pos + j, f.name.charCodeAt(j) & 0xFF)
    }
    pos += f.name.length
    dv.setUint8(pos, 0) // null 终止符
    pos += 1

    // nextOffset（如果为最后一个则为 0）
    const nextOffset = i + 1 < files.length ? fileOffsets[i + 1] : 0
    dv.setUint32(pos, nextOffset, true)
    pos += 4
  }

  // 验证索引大小
  if (pos !== dataStart) {
    throw new Error(`Internal error: pos=${pos} != dataStart=${dataStart}`)
  }

  // 写入数据块
  for (let i = 0; i < files.length; i++) {
    const dest = new Uint8Array(buf, fileOffsets[i], files[i].data.length)
    dest.set(files[i].data)
  }

  return buf
}

// ---------------------------------------------------------------------------
// PakFileLoader
// ---------------------------------------------------------------------------

describe('PakFileLoader', () => {
  let loader: PakFileLoader

  beforeEach(() => {
    loader = new PakFileLoader()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('tryParsePackage', () => {
    it('parses a valid PAK file with one entry', () => {
      const buf = createPakBuffer([
        { name: 'test.txt', data: new Uint8Array([0x48, 0x69]) }, // "Hi"
      ])

      const pkg = loader.tryParsePackage('data.pak', buf)
      expect(pkg).not.toBeNull()
      expect(pkg!.name).toBe('data.pak')
      expect(pkg!.contains('test.txt')).toBe(true)
    })

    it('returns null for non-.pak extensions', () => {
      const buf = createPakBuffer([
        { name: 'test.txt', data: new Uint8Array([0x48, 0x69]) },
      ])

      expect(loader.tryParsePackage('data.big', buf)).toBeNull()
      expect(loader.tryParsePackage('data.mix', buf)).toBeNull()
      expect(loader.tryParsePackage('data.zip', buf)).toBeNull()
      expect(loader.tryParsePackage('data', buf)).toBeNull()
    })

    it('handles .PAK uppercase extension', () => {
      const buf = createPakBuffer([
        { name: 'test.txt', data: new Uint8Array([0x48, 0x69]) },
      ])

      const pkg = loader.tryParsePackage('DATA.PAK', buf)
      expect(pkg).not.toBeNull()
    })

    it('returns null for files too small (under 4 bytes)', () => {
      const buf = new ArrayBuffer(3) // 不足以存储 firstFileOffset
      const pkg = loader.tryParsePackage('data.pak', buf)
      expect(pkg).toBeNull()
    })

    it('returns null for empty buffer with .pak extension', () => {
      const buf = new ArrayBuffer(0)
      const pkg = loader.tryParsePackage('data.pak', buf)
      expect(pkg).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// PakFile — 包操作
// ---------------------------------------------------------------------------

describe('PakFile (IReadOnlyPackage)', () => {
  let pkg: IReadOnlyPackage

  const testFiles = [
    {
      name: 'readme.txt',
      data: new Uint8Array([0x52, 0x45, 0x41, 0x44, 0x4D, 0x45]), // "README"
    },
    {
      name: 'data/file.bin',
      data: new Uint8Array([0x00, 0x01, 0x02, 0x03]),
    },
    {
      name: 'config.cfg',
      data: new Uint8Array([0xFF, 0xFE, 0xFD]),
    },
  ]

  beforeEach(() => {
    const buf = createPakBuffer(testFiles)
    const loader = new PakFileLoader()
    pkg = loader.tryParsePackage('archive.pak', buf)!
    expect(pkg).not.toBeNull()
  })

  describe('name', () => {
    it('returns the provided filename', () => {
      expect(pkg.name).toBe('archive.pak')
    })
  })

  describe('contents', () => {
    it('returns all entry paths sorted alphabetically', () => {
      expect(pkg.contents).toEqual([
        'config.cfg',
        'data/file.bin',
        'readme.txt',
      ])
    })
  })

  describe('contains', () => {
    it('returns true for existing files', () => {
      expect(pkg.contains('readme.txt')).toBe(true)
      expect(pkg.contains('data/file.bin')).toBe(true)
      expect(pkg.contains('config.cfg')).toBe(true)
    })

    it('returns false for non-existing files', () => {
      expect(pkg.contains('missing.txt')).toBe(false)
      expect(pkg.contains('')).toBe(false)
    })
  })

  describe('open', () => {
    it('extracts correct data for existing files', async () => {
      const data = await pkg.open('readme.txt')
      expect(data).not.toBeNull()
      expect(data!.byteLength).toBe(6)
      expect(new Uint8Array(data!)).toEqual(
        new Uint8Array([0x52, 0x45, 0x41, 0x44, 0x4D, 0x45]),
      )
    })

    it('extracts binary data correctly', async () => {
      const data = await pkg.open('data/file.bin')
      expect(data).not.toBeNull()
      expect(data!.byteLength).toBe(4)
      expect(new Uint8Array(data!)).toEqual(new Uint8Array([0x00, 0x01, 0x02, 0x03]))
    })

    it('returns null for non-existing files', async () => {
      const data = await pkg.open('nonexistent.bin')
      expect(data).toBeNull()
    })

    it('returns independent copies on each call', async () => {
      const data1 = await pkg.open('readme.txt')
      const data2 = await pkg.open('readme.txt')
      expect(data1).not.toBeNull()
      expect(data2).not.toBeNull()
      expect(data1).not.toBe(data2)
    })
  })

  describe('openPackage', () => {
    it('always returns null (not implemented)', () => {
      expect(pkg.openPackage('readme.txt')).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// PakFile — 生命周期与边界情况
// ---------------------------------------------------------------------------

describe('PakFile lifecycle', () => {
  it('dispose clears internal references', () => {
    const buf = createPakBuffer([
      { name: 'a.txt', data: new Uint8Array([1, 2, 3]) },
    ])
    const loader = new PakFileLoader()
    const pkg = loader.tryParsePackage('test.pak', buf)!

    pkg.dispose()

    expect(pkg.contents).toEqual([])
    expect(pkg.contains('a.txt')).toBe(false)
  })

  it('dispose does not throw when called multiple times', () => {
    const buf = createPakBuffer([
      { name: 'a.txt', data: new Uint8Array([1, 2, 3]) },
    ])
    const loader = new PakFileLoader()
    const pkg = loader.tryParsePackage('test.pak', buf)!

    expect(() => {
      pkg.dispose()
      pkg.dispose()
    }).not.toThrow()
  })

  it('handles empty PAK (no files)', () => {
    const buf = createPakBuffer([])
    const loader = new PakFileLoader()
    const pkg = loader.tryParsePackage('empty.pak', buf)

    expect(pkg).not.toBeNull()
    expect(pkg!.contents).toEqual([])
    expect(pkg!.contains('anything.txt')).toBe(false)
  })

  it('handles duplicate filenames (keeps first only)', () => {
    // 创建两个同名但不同数据的文件
    const files = [
      { name: 'duplicate.txt', data: new Uint8Array([1, 2, 3]) },
      { name: 'duplicate.txt', data: new Uint8Array([4, 5, 6]) },
      { name: 'unique.txt', data: new Uint8Array([7, 8, 9]) },
    ]
    const buf = createPakBuffer(files)
    const loader = new PakFileLoader()
    const pkg = loader.tryParsePackage('dup.pak', buf)

    expect(pkg).not.toBeNull()
    expect(pkg!.contents.length).toBe(2) // 重复项被忽略
    expect(pkg!.contains('duplicate.txt')).toBe(true)
    expect(pkg!.contains('unique.txt')).toBe(true)
  })

  it('handles PAK files with many entries', () => {
    const files = []
    for (let i = 0; i < 40; i++) {
      files.push({
        name: `entry_${i.toString().padStart(4, '0')}.dat`,
        data: new Uint8Array([i & 0xFF]),
      })
    }
    const buf = createPakBuffer(files)
    const loader = new PakFileLoader()
    const pkg = loader.tryParsePackage('large.pak', buf)

    expect(pkg).not.toBeNull()
    expect(pkg!.contents.length).toBe(40)
    expect(pkg!.contains('entry_0039.dat')).toBe(true)
  })
})
