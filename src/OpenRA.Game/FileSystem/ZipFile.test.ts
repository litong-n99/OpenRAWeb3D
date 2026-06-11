/**
 * ZipFile.test.ts — ZipFile 迁移单元测试
 *
 * 测试焦点：构造与解压、contents 过滤（目录排除）、contains 查找、
 * open 返回解压数据、openPackage（目录子包、嵌套归档）、dispose 清理、
 * ZipFileLoader 格式识别（扩展名 + 魔数）、错误数据输入。
 */

import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { zipSync, strToU8 } from 'fflate'
import { ZipFile, ZipFileLoader } from './ZipFile.js'
import type { IReadOnlyFileSystem } from './IPackage.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 创建一个小型测试 ZIP（同步）。 */
function createTestZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const input: Record<string, Uint8Array> = {}
  for (const [name, content] of Object.entries(files)) {
    if (typeof content === 'string') {
      input[name] = strToU8(content)
    } else {
      input[name] = content
    }
  }
  return zipSync(input)
}

/** 创建一个存根 IReadOnlyFileSystem（仅用于类型检查）。 */
function stubFileSystem(): IReadOnlyFileSystem {
  return {
    async openAsync() { return null },
    exists() { return false },
    isMounted() { return false },
  }
}

/** 将字符串转换为 UTF-8 Uint8Array。 */
function textToBytes(text: string): Uint8Array {
  return strToU8(text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZipFile', () => {
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create a ZipFile from valid ZIP data', () => {
      const zipData = createTestZip({ 'hello.txt': 'Hello World' })
      const zf = new ZipFile('test.zip', zipData.buffer as ArrayBuffer)

      expect(zf.name).toBe('test.zip')
      expect(zf.entryCount).toBe(1)
    })

    it('should throw on invalid ZIP data', () => {
      const badData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])
      expect(() => new ZipFile('bad.zip', badData.buffer as ArrayBuffer)).toThrow()
    })

    it('should throw on empty buffer', () => {
      expect(() => new ZipFile('empty.zip', new ArrayBuffer(0))).toThrow()
    })

    it('should handle empty ZIP (no files)', () => {
      const zipData = createTestZip({})
      const zf = new ZipFile('empty.zip', zipData.buffer as ArrayBuffer)

      expect(zf.entryCount).toBe(0)
      expect(zf.contents).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // Contents — filtering directories
  // -----------------------------------------------------------------------

  describe('contents', () => {
    it('should return sorted file names', () => {
      const zipData = createTestZip({
        'zulu.txt': 'z',
        'alpha.txt': 'a',
        'mike.txt': 'm',
      })
      const zf = new ZipFile('sorted.zip', zipData.buffer as ArrayBuffer)

      expect(zf.contents).toEqual(['alpha.txt', 'mike.txt', 'zulu.txt'])
    })

    it('should filter out directory entries (entries ending with /)', () => {
      // fflate 的 zipSync 使用以 '/' 结尾的键表示目录
      const zipData = createTestZip({
        'files/': '', // 目录条目
        'files/a.txt': 'a',
        'files/b.txt': 'b',
        'root.txt': 'root',
      })
      const zf = new ZipFile('dirs.zip', zipData.buffer as ArrayBuffer)

      // 目录条目 'files/' 应被过滤掉
      expect(zf.contents).toEqual(['files/a.txt', 'files/b.txt', 'root.txt'])
    })

    it('should be readonly', () => {
      const zipData = createTestZip({ 'data.bin': '\x00\x01\x02' })
      const zf = new ZipFile('readonly.zip', zipData.buffer as ArrayBuffer)

      const contents = zf.contents
      expect(Array.isArray(contents)).toBe(true)
      expect(contents.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Contains
  // -----------------------------------------------------------------------

  describe('contains', () => {
    it('should return true for files in the ZIP', () => {
      const zipData = createTestZip({ 'config.yaml': 'key: value' })
      const zf = new ZipFile('contains.zip', zipData.buffer as ArrayBuffer)

      expect(zf.contains('config.yaml')).toBe(true)
    })

    it('should return false for files not in the ZIP', () => {
      const zipData = createTestZip({ 'real.txt': 'real' })
      const zf = new ZipFile('missing.zip', zipData.buffer as ArrayBuffer)

      expect(zf.contains('fake.txt')).toBe(false)
    })

    it('should return false for directory entries', () => {
      const zipData = createTestZip({
        'dir/': '',
        'dir/file.txt': 'content',
      })
      const zf = new ZipFile('dir-lookup.zip', zipData.buffer as ArrayBuffer)

      expect(zf.contains('dir/')).toBe(false)
      expect(zf.contains('dir/file.txt')).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Open
  // -----------------------------------------------------------------------

  describe('open', () => {
    it('should return decompressed file contents', async () => {
      const zipData = createTestZip({ 'greeting.txt': 'Hello, World!' })
      const zf = new ZipFile('data.zip', zipData.buffer as ArrayBuffer)

      const result = await zf.open('greeting.txt')
      expect(result).not.toBeNull()

      const decoder = new TextDecoder()
      expect(decoder.decode(result!)).toBe('Hello, World!')
    })

    it('should handle binary data', async () => {
      const binaryData = new Uint8Array([0x00, 0xFF, 0x42, 0x80])
      const zipData = createTestZip({ 'binary.bin': binaryData })
      const zf = new ZipFile('binary.zip', zipData.buffer as ArrayBuffer)

      const result = await zf.open('binary.bin')
      expect(result).not.toBeNull()
      expect(new Uint8Array(result!)).toEqual(binaryData)
    })

    it('should return null for non-existent files', async () => {
      const zipData = createTestZip({ 'only.txt': 'only' })
      const zf = new ZipFile('missing.zip', zipData.buffer as ArrayBuffer)

      const result = await zf.open('nonexistent.txt')
      expect(result).toBeNull()
    })

    it('should return a copy, not a reference to internal buffer', async () => {
      const original = new Uint8Array([5, 6, 7, 8])
      const zipData = createTestZip({ 'copy-test.bin': original })
      const zf = new ZipFile('copy.zip', zipData.buffer as ArrayBuffer)

      const result = await zf.open('copy-test.bin')
      // 修改返回的数据不应影响内部存储
      if (result) {
        new Uint8Array(result).fill(0)
      }
      const again = await zf.open('copy-test.bin')
      expect(new Uint8Array(again!)).toEqual(original)
    })

    it('should handle multiple files', async () => {
      const zipData = createTestZip({
        'one.txt': '1',
        'two.txt': '2',
        'three.txt': '3',
      })
      const zf = new ZipFile('multi.zip', zipData.buffer as ArrayBuffer)

      const r1 = await zf.open('one.txt')
      const r2 = await zf.open('two.txt')
      const r3 = await zf.open('three.txt')

      expect(new TextDecoder().decode(r1!)).toBe('1')
      expect(new TextDecoder().decode(r2!)).toBe('2')
      expect(new TextDecoder().decode(r3!)).toBe('3')
    })
  })

  // -----------------------------------------------------------------------
  // OpenPackage
  // -----------------------------------------------------------------------

  describe('openPackage', () => {
    it('should return null for regular files', () => {
      const zipData = createTestZip({ 'regular.txt': 'text' })
      const zf = new ZipFile('flat.zip', zipData.buffer as ArrayBuffer)

      const result = zf.openPackage('regular.txt', stubFileSystem())
      expect(result).toBeNull()
    })

    it('should return a ZipFolder for directory entries', () => {
      const zipData = createTestZip({
        'subdir/': '',
        'subdir/file.txt': 'nested',
      })
      const zf = new ZipFile('with-dir.zip', zipData.buffer as ArrayBuffer)

      const result = zf.openPackage('subdir', stubFileSystem())
      expect(result).not.toBeNull()
      expect(result!.name).toBe('subdir')
      expect(result!.contents).toEqual(['file.txt'])
    })

    it('should return ZipFolder with correct contents (one level deep)', () => {
      const zipData = createTestZip({
        'mod/': '',
        'mod/rules.yaml': 'rules',
        'mod/weapons.yaml': 'weapons',
        'mod/sub/deep.txt': 'deep', // 不应出现在 contents 中（多级深度）
      })
      const zf = new ZipFile('mod.zip', zipData.buffer as ArrayBuffer)

      const result = zf.openPackage('mod', stubFileSystem())
      expect(result).not.toBeNull()
      expect(result!.contents).toEqual(['rules.yaml', 'weapons.yaml'])
    })

    it('should handle recursive archive inside ZIP', () => {
      // 创建一个嵌套的 ZIP 文件
      const innerZipData = createTestZip({ 'inner.txt': 'inner content' })
      const outerZipData = createTestZip({
        'data.bin': 'outer',
        'nested.oramap': innerZipData,
      })
      const zf = new ZipFile('outer.zip', outerZipData.buffer as ArrayBuffer)

      const result = zf.openPackage('nested.oramap', stubFileSystem())
      // 应该递归解析嵌套的 .oramap 文件
      expect(result).not.toBeNull()
      expect(result!.contains('inner.txt')).toBe(true)
    })

    it('should return null for non-existent path', () => {
      const zipData = createTestZip({ 'file.txt': 'text' })
      const zf = new ZipFile('single.zip', zipData.buffer as ArrayBuffer)

      const result = zf.openPackage('nope.dir', stubFileSystem())
      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should clear internal entries', () => {
      const zipData = createTestZip({ 'data.bin': '\x00' })
      const zf = new ZipFile('dispose.zip', zipData.buffer as ArrayBuffer)

      expect(zf.entryCount).toBe(1)
      zf.dispose()
      expect(zf.entryCount).toBe(0)
      expect(zf.contents).toEqual([])
    })

    it('should make contains return false after dispose', () => {
      const zipData = createTestZip({ 'data.bin': 'data' })
      const zf = new ZipFile('post-dispose.zip', zipData.buffer as ArrayBuffer)

      zf.dispose()
      expect(zf.contains('data.bin')).toBe(false)
    })

    it('should make open return null after dispose', async () => {
      const zipData = createTestZip({ 'data.bin': 'data' })
      const zf = new ZipFile('open-post-dispose.zip', zipData.buffer as ArrayBuffer)

      zf.dispose()
      const result = await zf.open('data.bin')
      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose lifecycle — IReadOnlyPackage conformance
  // -----------------------------------------------------------------------

  describe('IReadOnlyPackage conformance — dispose lifecycle', () => {
    it('should support create → use → dispose cycle', async () => {
      const zipData = createTestZip({
        'level1.yaml': 'level: 1',
        'level2.yaml': 'level: 2',
      })
      const zf = new ZipFile('lifecycle.zip', zipData.buffer as ArrayBuffer)

      // Use — 验证多个文件
      expect(zf.contains('level1.yaml')).toBe(true)
      const data = await zf.open('level1.yaml')
      expect(data).not.toBeNull()

      // Dispose
      zf.dispose()
      expect(zf.entryCount).toBe(0)
      expect(zf.contains('level2.yaml')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------

  describe('metadata', () => {
    it('should report correct entry count', () => {
      const zipData = createTestZip({
        'a.txt': 'a',
        'b.txt': 'b',
        'c.txt': 'c',
      })
      const zf = new ZipFile('count.zip', zipData.buffer as ArrayBuffer)
      expect(zf.entryCount).toBe(3)
    })

    it('should report total decompressed size', () => {
      const content = 'Hello World!' // 12 bytes
      const zipData = createTestZip({ 'msg.txt': content })
      const zf = new ZipFile('size.zip', zipData.buffer as ArrayBuffer)

      expect(zf.totalSize).toBe(textToBytes(content).byteLength)
    })
  })
})

// ---------------------------------------------------------------------------
// ZipFileLoader
// ---------------------------------------------------------------------------

describe('ZipFileLoader', () => {
  // -----------------------------------------------------------------------
  // Extension detection
  // -----------------------------------------------------------------------

  describe('extension detection', () => {
    it('should recognize .zip extension', () => {
      const loader = new ZipFileLoader()
      const zipData = createTestZip({ 'file.txt': 'content' })

      const result = loader.tryParsePackage(
        'archive.zip',
        zipData.buffer as ArrayBuffer,
      )
      expect(result).not.toBeNull()
      expect(result!.name).toBe('archive.zip')
    })

    it('should recognize .oramap extension', () => {
      const loader = new ZipFileLoader()
      const zipData = createTestZip({ 'map.yaml': 'map info' })

      const result = loader.tryParsePackage(
        'map.oramap',
        zipData.buffer as ArrayBuffer,
      )
      expect(result).not.toBeNull()
      expect(result!.name).toBe('map.oramap')
    })

    it('should recognize by magic bytes even without known extension', () => {
      const loader = new ZipFileLoader()
      const zipData = createTestZip({ 'inside.dat': 'value' })

      const result = loader.tryParsePackage(
        'unknown.bin',
        zipData.buffer as ArrayBuffer,
      )
      // 即使扩展名未知，魔数检查也应通过
      expect(result).not.toBeNull()
    })

    it('should return null for non-ZIP data without known extension', () => {
      const loader = new ZipFileLoader()
      const nonZip = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01])

      const result = loader.tryParsePackage(
        'data.bin',
        nonZip.buffer as ArrayBuffer,
      )
      // 不是 ZIP 魔数，不是已知扩展名 → null
      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Magic byte checking
  // -----------------------------------------------------------------------

  describe('magic byte (PK signature) checking', () => {
    it('should recognize valid PK signature (0x504B0304)', () => {
      const loader = new ZipFileLoader()
      const zipData = createTestZip({ 'test.txt': 'test' })

      const result = loader.tryParsePackage(
        'whatever.dat',
        zipData.buffer as ArrayBuffer,
      )
      expect(result).not.toBeNull()
    })

    it('should reject invalid magic bytes', () => {
      const loader = new ZipFileLoader()
      // 前 4 字节是 0xDEADBEEF，不是 0x504B0304
      const notZip = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x50, 0x4B, 0x03, 0x04])
      // 没有已知扩展名，魔数不匹配 → null
      const result = loader.tryParsePackage(
        'corrupted.dat',
        notZip.buffer as ArrayBuffer,
      )
      expect(result).toBeNull()
    })

    it('should handle short buffers (less than 4 bytes)', () => {
      const loader = new ZipFileLoader()
      const shortData = new Uint8Array([0x50, 0x4B])

      // 没有已知扩展名，魔数太短无法匹配 → null
      const result = loader.tryParsePackage(
        'short.dat',
        shortData.buffer as ArrayBuffer,
      )
      expect(result).toBeNull()
    })

    it('should warn but try to parse when extension matches but magic is wrong', () => {
      const loader = new ZipFileLoader()
      const badZip = new Uint8Array([0x00, 0x00, 0x00, 0x00])

      // 扩展名是 .zip 但魔数无效 → 应该警告但尝试解析（解析会失败，返回 null）
      const result = loader.tryParsePackage(
        'broken.zip',
        badZip.buffer as ArrayBuffer,
      )
      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle files with special characters in names', () => {
      const zipData = createTestZip({
        'file with spaces.txt': 'spaces',
        'unicode_☃.txt': 'unicode',
      })
      const zf = new ZipFile('special.zip', zipData.buffer as ArrayBuffer)

      expect(zf.contains('file with spaces.txt')).toBe(true)
      expect(zf.contains('unicode_☃.txt')).toBe(true)
    })

    it('should handle nested directory structure', async () => {
      const zipData = createTestZip({
        'a/b/c/d/e/deep.txt': 'deep content',
      })
      const zf = new ZipFile('deep.zip', zipData.buffer as ArrayBuffer)

      expect(zf.contains('a/b/c/d/e/deep.txt')).toBe(true)
      const result = await zf.open('a/b/c/d/e/deep.txt')
      expect(new TextDecoder().decode(result!)).toBe('deep content')
    })

    it('should handle large number of files', () => {
      const files: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        files[`file_${String(i).padStart(3, '0')}.txt`] = `content ${i}`
      }
      const zipData = createTestZip(files)
      const zf = new ZipFile('many.zip', zipData.buffer as ArrayBuffer)

      expect(zf.entryCount).toBe(100)
      expect(zf.contents.length).toBe(100)
      expect(zf.contents[0]).toBe('file_000.txt')
      expect(zf.contents[99]).toBe('file_099.txt')
    })
  })
})
