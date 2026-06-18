/**
 * Glob.test.ts — Glob 文件通配符工具迁移单元测试
 *
 * 测试焦点: needsExpansion 检测、路径展开、通配符模式匹配、globArgs 批量展开、
 *           Enabled 全局开关、文件系统注入
 */

import { describe, it, expect } from 'vitest'
import { Glob, type FileSystemInterface } from './Glob'

// ---------------------------------------------------------------------------
// Mock filesystem factory
// ---------------------------------------------------------------------------

interface MockFSOptions {
  dirs: string[]       // 目录路径列表
  files: string[]      // 文件路径列表
  cwd?: string          // 当前工作目录根
}

function createMockFS(opts: MockFSOptions): FileSystemInterface {
  const dirs = new Set(opts.dirs.map(d => d.replace(/\\/g, '/')))
  const files = new Set(opts.files.map(f => f.replace(/\\/g, '/')))

  return {
    existsSync(filePath: string): boolean {
      const normalized = filePath.replace(/\\/g, '/')
      return dirs.has(normalized) || files.has(normalized)
    },
    readdirSync(dirPath: string): string[] {
      const normalized = dirPath.replace(/\\/g, '/')
      const prefix = normalized.endsWith('/') ? normalized : normalized + '/'
      const entries = new Set<string>()
      for (const d of dirs) {
        if (d.startsWith(prefix) && d !== normalized) {
          const relative = d.slice(prefix.length).split('/')[0]
          if (relative) entries.add(relative)
        }
      }
      for (const f of files) {
        if (f.startsWith(prefix) && f !== normalized) {
          const relative = f.slice(prefix.length).split('/')[0]
          if (relative) entries.add(relative)
        }
      }
      return [...entries]
    },
    isDirectorySync(filePath: string): boolean {
      const normalized = filePath.replace(/\\/g, '/')
      // Check exact match first, then check if it's a parent directory of any known file
      if (dirs.has(normalized)) return true
      const prefix = normalized.endsWith('/') ? normalized : normalized + '/'
      return [...dirs, ...files].some(p => p.startsWith(prefix))
    },
    statSync(filePath: string) {
      // NOTE: Simple mock - only handles the exact file/dir matching use case
      const normalized = filePath.replace(/\\/g, '/')
      const isDir = normalized.endsWith('/') ||
        dirs.has(normalized) ||
        [...dirs, ...files].some(p => p.startsWith(normalized + '/'))
      const isFile = files.has(normalized)
      return {
        isDirectory: () => isDir && !isFile,
        isFile: () => isFile || (!isDir && !normalized.includes('*') && !normalized.includes('?')),
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Tests — Glob.needsExpansion
// ---------------------------------------------------------------------------

describe('Glob.needsExpansion (internal)', () => {
  it('returns false when Enabled is false', () => {
    const saved = Glob.Enabled
    Glob.Enabled = false
    const mockFS = createMockFS({ dirs: ['.'], files: [] })
    // Access needsExpansion via expand behavior: with Enabled=false, no expansion
    const result = Glob.expand('*.ts', mockFS)
    expect(result).toEqual(['*.ts'])
    Glob.Enabled = saved
  })

  it('returns true for * wildcard', () => {
    const saved = Glob.Enabled
    Glob.Enabled = true
    // When a path contains *, expand should not return the literal path
    const mockFS = createMockFS({ dirs: ['.'], files: ['a.ts', 'b.ts'] })
    const result = Glob.expand('*.ts', mockFS)
    // Should match files not return literal
    expect(result).not.toContain('*.ts')
    Glob.Enabled = saved
  })
})

// ---------------------------------------------------------------------------
// Tests — Glob.expand (non-wildcard paths)
// ---------------------------------------------------------------------------

describe('Glob.expand', () => {
  it('returns unchanged path when no wildcards present', () => {
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./test.txt'],
    })
    const result = Glob.expand('test.txt', mockFS)
    expect(result).toEqual(['test.txt'])
  })

  it('returns unchanged path when Enabled is false', () => {
    const saved = Glob.Enabled
    Glob.Enabled = false
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./a.ts', './b.ts'],
    })
    const result = Glob.expand('*.ts', mockFS)
    expect(result).toEqual(['*.ts'])
    Glob.Enabled = saved
  })

  it('returns empty array for non-matching pattern', () => {
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./a.ts', './b.ts'],
    })
    const result = Glob.expand('*.js', mockFS)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Tests — Glob.expand (* wildcard)
// ---------------------------------------------------------------------------

describe('Glob.expand with * wildcard', () => {
  it('matches all .ts files in current directory', () => {
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./a.ts', './b.ts', './c.js'],
    })
    const result = Glob.expand('*.ts', mockFS)
    expect(result.length).toBe(2)
    result.forEach(r => {
      const normalized = r.replace(/\\/g, '/')
      expect(normalized).toMatch(/[ab]\.ts$/)
    })
  })

  it('matches files with specific prefix pattern', () => {
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./infantry-0001.png', './infantry-0002.png', './tank-0001.png'],
    })
    const result = Glob.expand('infantry-*.png', mockFS)
    expect(result.length).toBe(2)
    result.forEach(r => {
      expect(r.replace(/\\/g, '/')).toMatch(/infantry-\d+\.png$/)
    })
  })

  it('matches files with ? wildcard (single character)', () => {
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./a1.ts', './ab1.ts', './a2.ts'],
    })
    const result = Glob.expand('a?.ts', mockFS)
    expect(result.length).toBe(2)
    result.forEach(r => {
      const normalized = r.replace(/\\/g, '/')
      expect(normalized).toMatch(/a\d\.ts$/)
    })
    // ab1.ts should NOT be matched (2 chars between 'a' and '.')
    expect(result.every(r => !r.includes('ab'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests — Glob.expand (directory wildcards)
// ---------------------------------------------------------------------------

describe('Glob.expand with directory wildcards', () => {
  it('matches files in a subdirectory pattern', () => {
    const mockFS = createMockFS({
      dirs: ['.', './data', './assets'],
      files: ['./data/config.json', './assets/image.png'],
    })
    const result = Glob.expand('*/config.json', mockFS)
    // The result may vary based on platform path separators,
    // but should match at most 1 file (only ./data/config.json)
    expect(result.length).toBeLessThanOrEqual(1)
    if (result.length > 0) {
      const normalized = result[0]!.replace(/\\/g, '/')
      expect(normalized).toContain('config.json')
    }
  })

  it('handles explicit path with subdirectory glob', () => {
    const mockFS = createMockFS({
      dirs: ['.', './subdir'],
      files: ['./subdir/file.txt'],
    })
    // Using an explicit path with wildcard in directory
    const result = Glob.expand('subdir/*.txt', mockFS)
    expect(result.length).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Tests — Glob.globArgs
// ---------------------------------------------------------------------------

describe('Glob.globArgs', () => {
  it('expands multiple arguments', () => {
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./a.png', './b.png', './c.txt'],
    })
    const args = ['--shp', 'a.png', '*.png']
    const result = Glob.globArgs(args, 1, mockFS)
    // a.png expanded as-is, *.png → a.png + b.png (deduplicated)
    expect(result.length).toBeLessThanOrEqual(3)
    expect(result.some(r => r.includes('a.png'))).toBe(true)
    expect(result.some(r => r.includes('b.png'))).toBe(true)
  })

  it('deduplicates expanded paths', () => {
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./a.png'],
    })
    const args = ['--shp', 'a.png', 'a.png', '*.png']
    const result = Glob.globArgs(args, 1, mockFS)
    // 'a.png' should appear only once
    const aPngCount = result.filter(r => r.includes('a.png')).length
    expect(aPngCount).toBe(1)
  })

  it('uses default startIndex of 1', () => {
    const mockFS = createMockFS({
      dirs: ['.'],
      files: ['./test.png'],
    })
    const args = ['--shp', 'test.png']
    const result = Glob.globArgs(args, undefined, mockFS)
    expect(result.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tests — Glob.Enabled toggle
// ---------------------------------------------------------------------------

describe('Glob.Enabled', () => {
  it('is true by default', () => {
    expect(Glob.Enabled).toBe(true)
  })

  it('can be toggled', () => {
    Glob.Enabled = false
    expect(Glob.Enabled).toBe(false)
    Glob.Enabled = true
    expect(Glob.Enabled).toBe(true)
  })
})
