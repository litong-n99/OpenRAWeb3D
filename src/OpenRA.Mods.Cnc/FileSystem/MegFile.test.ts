/**
 * MegFile.test.ts — MegFile / MegV3Loader 迁移单元测试
 *
 * 测试重点：小端序解析、字符串表、文件条目提取、签名验证。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { MegV3Loader } from './MegFile.js'
import type { IReadOnlyPackage } from '../../OpenRA.Game/FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// 辅助函数：构建 MEG V3 文件二进制数据
// ---------------------------------------------------------------------------

/**
 * 创建最小的有效 MEG V3 文件缓冲区。
 *
 * MEG V3 格式:
 * - 4 bytes: id (0xFFFFFFFF)
 * - 4 bytes: version (0x3F7D70A4)
 * - 4 bytes: headerSize
 * - 4 bytes: numStrings
 * - 4 bytes: numFiles
 * - 4 bytes: stringsSize
 * - String table: each entry = uint16 length + ASCII bytes
 * - File entries: 10 bytes skipped + uint32 size + uint32 offset + uint16 nameIndex
 * - Data blocks follow at specified offsets
 */
function createMegBuffer(files: Array<{ name: string; size: number; data: Uint8Array }>): ArrayBuffer {
  // 收集所有唯一的文件名字符串
  const nameSet = new Map<string, number>() // name → index
  for (const f of files) {
    if (!nameSet.has(f.name)) {
      nameSet.set(f.name, nameSet.size)
    }
  }

  // 计算字符串表大小
  let stringsSize = 0
  for (const name of nameSet.keys()) {
    stringsSize += 2 + name.length // uint16 length + ASCII bytes
  }

  // 每个文件条目: 10 (skipped) + 4 (size) + 4 (offset) + 2 (nameIndex) = 20
  const fileEntrySize = 20
  const entriesSize = files.length * fileEntrySize

  // 头部 (不包含字符串表和条目前的字段): 4(id)+4(version)+4(headerSize)+4(numStrings)+4(numFiles)+4(stringsSize) = 24
  const headerPrefix = 24
  const headerSize = headerPrefix + stringsSize + entriesSize

  // 计算数据偏移量
  let dataStart = headerSize
  const fileData: Array<{ offset: number; size: number; data: Uint8Array; nameIndex: number }> = []
  for (const f of files) {
    fileData.push({
      offset: dataStart,
      size: f.size,
      data: f.data,
      nameIndex: nameSet.get(f.name)!,
    })
    dataStart += f.size
  }

  const totalSize = dataStart
  const buf = new ArrayBuffer(totalSize)
  const dv = new DataView(buf)
  let pos = 0

  // id (0xFFFFFFFF)
  dv.setUint32(pos, 0xFFFFFFFF, true)
  pos += 4

  // version (0x3F7D70A4)
  dv.setUint32(pos, 0x3F7D70A4, true)
  pos += 4

  // headerSize
  dv.setUint32(pos, headerSize, true)
  pos += 4

  // numStrings
  dv.setUint32(pos, nameSet.size, true)
  pos += 4

  // numFiles
  dv.setUint32(pos, files.length, true)
  pos += 4

  // stringsSize
  dv.setUint32(pos, stringsSize, true)
  pos += 4

  // 字符串表
  const nameArray = [...nameSet.keys()]
  for (const name of nameArray) {
    dv.setUint16(pos, name.length, true)
    pos += 2
    for (let i = 0; i < name.length; i++) {
      dv.setUint8(pos + i, name.charCodeAt(i) & 0xFF)
    }
    pos += name.length
  }

  // 文件条目
  for (const fd of fileData) {
    // 10 bytes 跳过（标志、crc、索引）
    for (let i = 0; i < 10; i++) {
      dv.setUint8(pos + i, 0)
    }
    pos += 10

    // size
    dv.setUint32(pos, fd.size, true)
    pos += 4

    // offset
    dv.setUint32(pos, fd.offset, true)
    pos += 4

    // nameIndex
    dv.setUint16(pos, fd.nameIndex, true)
    pos += 2
  }

  // 验证头部大小
  if (pos !== headerSize) {
    throw new Error(`Internal error: pos=${pos} != headerSize=${headerSize}`)
  }

  // 写入数据块
  for (const fd of fileData) {
    const dest = new Uint8Array(buf, fd.offset, fd.size)
    dest.set(fd.data)
  }

  return buf
}

// ---------------------------------------------------------------------------
// MegV3Loader
// ---------------------------------------------------------------------------

describe('MegV3Loader', () => {
  let loader: MegV3Loader

  beforeEach(() => {
    loader = new MegV3Loader()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('tryParsePackage', () => {
    it('parses a valid MEG file with one entry', () => {
      const data = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]) // "Hello"
      const buf = createMegBuffer([
        { name: 'greeting.txt', size: 5, data },
      ])

      const pkg = loader.tryParsePackage('data.meg', buf)
      expect(pkg).not.toBeNull()
      expect(pkg!.name).toBe('data.meg')
      expect(pkg!.contains('greeting.txt')).toBe(true)
    })

    it('returns null for files with invalid id', () => {
      const buf = new ArrayBuffer(8)
      const dv = new DataView(buf)
      dv.setUint32(0, 0x12345678, true) // 无效 id
      dv.setUint32(4, 0x3F7D70A4, true) // 有效 version

      const pkg = loader.tryParsePackage('data.meg', buf)
      expect(pkg).toBeNull()
    })

    it('returns null for files with invalid version', () => {
      const buf = new ArrayBuffer(8)
      const dv = new DataView(buf)
      dv.setUint32(0, 0xFFFFFFFF, true) // 有效 id
      dv.setUint32(4, 0x12345678, true) // 无效 version

      const pkg = loader.tryParsePackage('data.meg', buf)
      expect(pkg).toBeNull()
    })

    it('returns null for files too small to contain header', () => {
      const buf = new ArrayBuffer(4)
      const pkg = loader.tryParsePackage('data.meg', buf)
      expect(pkg).toBeNull()
    })

    it('returns null for empty buffer', () => {
      const buf = new ArrayBuffer(0)
      const pkg = loader.tryParsePackage('data.meg', buf)
      expect(pkg).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// MegFile — 包操作
// ---------------------------------------------------------------------------

describe('MegFile (IReadOnlyPackage)', () => {
  let pkg: IReadOnlyPackage

  const testFiles = [
    {
      name: 'alpha.txt',
      size: 4,
      data: new Uint8Array([0x41, 0x42, 0x43, 0x44]), // "ABCD"
    },
    {
      name: 'beta.bin',
      size: 8,
      data: new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
    },
    {
      name: 'gamma.dat',
      size: 3,
      data: new Uint8Array([0xFF, 0xEE, 0xDD]),
    },
  ]

  beforeEach(() => {
    const buf = createMegBuffer(testFiles)
    const loader = new MegV3Loader()
    pkg = loader.tryParsePackage('test.meg', buf)!
    expect(pkg).not.toBeNull()
  })

  describe('name', () => {
    it('returns the provided filename', () => {
      expect(pkg.name).toBe('test.meg')
    })
  })

  describe('contents', () => {
    it('returns all entry paths sorted alphabetically', () => {
      expect(pkg.contents).toEqual([
        'alpha.txt',
        'beta.bin',
        'gamma.dat',
      ])
    })
  })

  describe('contains', () => {
    it('returns true for existing files', () => {
      expect(pkg.contains('alpha.txt')).toBe(true)
      expect(pkg.contains('beta.bin')).toBe(true)
      expect(pkg.contains('gamma.dat')).toBe(true)
    })

    it('returns false for non-existing files', () => {
      expect(pkg.contains('delta.txt')).toBe(false)
    })
  })

  describe('open', () => {
    it('extracts correct data for existing files', async () => {
      const data = await pkg.open('alpha.txt')
      expect(data).not.toBeNull()
      expect(data!.byteLength).toBe(4)
      expect(new Uint8Array(data!)).toEqual(new Uint8Array([0x41, 0x42, 0x43, 0x44]))
    })

    it('extracts binary data correctly', async () => {
      const data = await pkg.open('beta.bin')
      expect(data).not.toBeNull()
      expect(data!.byteLength).toBe(8)
      expect(new Uint8Array(data!)).toEqual(
        new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
      )
    })

    it('returns null for non-existing files', async () => {
      const data = await pkg.open('missing.bin')
      expect(data).toBeNull()
    })
  })

  describe('openPackage', () => {
    it('returns null in current browser implementation', () => {
      expect(pkg.openPackage('alpha.txt')).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// MegFile — 生命周期与边界情况
// ---------------------------------------------------------------------------

describe('MegFile lifecycle', () => {
  it('dispose clears internal references', () => {
    const buf = createMegBuffer([
      { name: 'a.txt', size: 3, data: new Uint8Array([1, 2, 3]) },
    ])
    const loader = new MegV3Loader()
    const pkg = loader.tryParsePackage('test.meg', buf)!

    pkg.dispose()

    expect(pkg.contents).toEqual([])
    expect(pkg.contains('a.txt')).toBe(false)
  })

  it('dispose does not throw when called multiple times', () => {
    const buf = createMegBuffer([
      { name: 'a.txt', size: 3, data: new Uint8Array([1, 2, 3]) },
    ])
    const loader = new MegV3Loader()
    const pkg = loader.tryParsePackage('test.meg', buf)!

    expect(() => {
      pkg.dispose()
      pkg.dispose()
    }).not.toThrow()
  })

  it('handles MEG files with shared string table entries', () => {
    // 多个文件引用同一个字符串表条目
    const data1 = new Uint8Array(4)
    const data2 = new Uint8Array(6)
    const buf = createMegBuffer([
      { name: 'shared.txt', size: 4, data: data1 },
      { name: 'shared.txt', size: 6, data: data2 }, // 同名但不同数据
    ])

    const loader = new MegV3Loader()
    const pkg = loader.tryParsePackage('shared.meg', buf)
    expect(pkg).not.toBeNull()
    // contents 应去重（Map 键）
    expect(pkg!.contents.filter(c => c === 'shared.txt').length).toBe(1)
  })

  it('handles MEG files with many entries', () => {
    const files = []
    for (let i = 0; i < 30; i++) {
      const data = new Uint8Array([i & 0xFF, (i + 1) & 0xFF])
      files.push({
        name: `file_${i.toString().padStart(3, '0')}.dat`,
        size: 2,
        data,
      })
    }
    const buf = createMegBuffer(files)
    const loader = new MegV3Loader()
    const pkg = loader.tryParsePackage('large.meg', buf)

    expect(pkg).not.toBeNull()
    expect(pkg!.contents.length).toBe(30)
  })
})
