/**
 * IPackage.test.ts — 文件系统包接口迁移单元测试
 *
 * 测试焦点：接口结构一致性、类型导出正确性、IReadOnlyPackage.ts 重新导出。
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Import interfaces from both modules to verify re-export consistency
// ---------------------------------------------------------------------------

import {
  type IReadOnlyPackage,
  type IPackage,
  type IPackageLoader,
  type IReadOnlyFileSystem,
} from './IPackage.js'

import {
  type IReadOnlyPackage as IReadOnlyPackageReExported,
  type IPackage as IPackageReExported,
  type IPackageLoader as IPackageLoaderReExported,
  type IReadOnlyFileSystem as IReadOnlyFileSystemReExported,
} from './IReadOnlyPackage.js'

import { type IReadWritePackage } from './IReadOnlyPackage.js'

// ---------------------------------------------------------------------------
// Test: Structural conformance (interface contracts)
// ---------------------------------------------------------------------------

describe('IReadOnlyPackage structural conformance', () => {
  it('should allow objects with all required members', () => {
    const pkg: IReadOnlyPackage = {
      name: 'test',
      contents: ['a.txt', 'b.txt'],
      contains(_filename: string) { return true },
      async open(_filename: string) { return null },
      openPackage(_filename: string) { return null },
      dispose() {},
    }
    expect(pkg.name).toBe('test')
    expect(pkg.contents).toEqual(['a.txt', 'b.txt'])
  })

  it('should support readonly contents', () => {
    const pkg: IReadOnlyPackage = {
      name: 'readonly-check',
      contents: ['file1.yaml'],
      contains: () => false,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
    }
    expect(pkg.contents).toHaveLength(1)
    expect(pkg.contents[0]).toBe('file1.yaml')
  })

  it('should support async open returning ArrayBuffer', async () => {
    const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer
    const pkg: IReadOnlyPackage = {
      name: 'data-pkg',
      contents: ['data.bin'],
      contains: () => true,
      open: async () => data,
      openPackage: () => null,
      dispose: () => {},
    }
    const result = await pkg.open('data.bin')
    expect(result).toBe(data)
  })

  it('should support open returning null when file not found', async () => {
    const pkg: IReadOnlyPackage = {
      name: 'missing-pkg',
      contents: [],
      contains: () => false,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
    }
    const result = await pkg.open('nonexistent.txt')
    expect(result).toBeNull()
  })

  it('should support contains checking', () => {
    const contents = ['alpha.yaml', 'beta.yaml']
    const pkg: IReadOnlyPackage = {
      name: 'check-pkg',
      contents,
      contains: (f) => contents.includes(f),
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
    }
    expect(pkg.contains('alpha.yaml')).toBe(true)
    expect(pkg.contains('gamma.yaml')).toBe(false)
  })

  it('should support openPackage returning sub-packages', () => {
    const subPkg: IReadOnlyPackage = {
      name: 'sub',
      contents: ['inner.txt'],
      contains: () => true,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
    }
    const pkg: IReadOnlyPackage = {
      name: 'parent',
      contents: ['sub.oramap'],
      contains: () => true,
      open: async () => null,
      openPackage: () => subPkg,
      dispose: () => {},
    }
    const result = pkg.openPackage('sub.oramap')
    expect(result).toBe(subPkg)
    expect(result!.name).toBe('sub')
  })

  it('should support dispose lifecycle', () => {
    let disposed = false
    const pkg: IReadOnlyPackage = {
      name: 'disposable',
      contents: [],
      contains: () => false,
      open: async () => null,
      openPackage: () => null,
      dispose: () => { disposed = true },
    }
    pkg.dispose()
    expect(disposed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test: IPackage (read-write interface, extends IReadOnlyPackage)
// ---------------------------------------------------------------------------

describe('IPackage structural conformance', () => {
  it('should include all IReadOnlyPackage members plus write methods', () => {
    const pkg: IPackage = {
      name: 'rw-pkg',
      contents: ['data.bin'],
      contains() { return true },
      async open() { return null },
      openPackage() { return null },
      dispose() {},
      update(_filename: string, _data: Uint8Array) {},
      delete(_filename: string) {},
    }
    expect(pkg.name).toBe('rw-pkg')
    expect(typeof pkg.update).toBe('function')
    expect(typeof pkg.delete).toBe('function')
  })

  it('should be assignable to IReadOnlyPackage', () => {
    const rw: IPackage = {
      name: 'cast-test',
      contents: [],
      contains: () => false,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
      update: () => {},
      delete: () => {},
    }
    // IPackage 应可赋值给 IReadOnlyPackage
    const ro: IReadOnlyPackage = rw
    expect(ro.name).toBe('cast-test')
  })
})

// ---------------------------------------------------------------------------
// Test: IPackageLoader
// ---------------------------------------------------------------------------

describe('IPackageLoader structural conformance', () => {
  it('should accept a proper loader implementation', () => {
    const loader: IPackageLoader = {
      tryParsePackage(_filename: string, _stream: ArrayBuffer) {
        return null
      },
    }
    expect(typeof loader.tryParsePackage).toBe('function')
  })

  it('should return a package when format matches', () => {
    const pkg: IReadOnlyPackage = {
      name: 'parsed',
      contents: ['inside.txt'],
      contains: () => true,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
    }
    const loader: IPackageLoader = {
      tryParsePackage(_filename: string, _stream: ArrayBuffer) {
        return pkg
      },
    }
    const result = loader.tryParsePackage('test.zip', new ArrayBuffer(0))
    expect(result).toBe(pkg)
  })

  it('should return null when format does not match', () => {
    const loader: IPackageLoader = {
      tryParsePackage(_filename: string, _stream: ArrayBuffer) {
        return null
      },
    }
    const result = loader.tryParsePackage('test.unknown', new ArrayBuffer(0))
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Test: IReadOnlyFileSystem
// ---------------------------------------------------------------------------

describe('IReadOnlyFileSystem structural conformance', () => {
  it('should accept a proper file system implementation', () => {
    const fs: IReadOnlyFileSystem = {
      async openAsync(_filename: string) { return null },
      exists(_filename: string) { return false },
      isMounted(_filename: string) { return false },
    }
    expect(typeof fs.openAsync).toBe('function')
    expect(typeof fs.exists).toBe('function')
    expect(typeof fs.isMounted).toBe('function')
  })

  it('should support openAsync returning data', async () => {
    const data = new Uint8Array([42]).buffer as ArrayBuffer
    const fs: IReadOnlyFileSystem = {
      async openAsync(_filename: string) { return data },
      exists: () => true,
      isMounted: () => true,
    }
    const result = await fs.openAsync('test.file')
    expect(result).toBe(data)
  })

  it('should support exists returning true for known files', () => {
    const knownFiles = new Set(['a.yaml', 'b.yaml'])
    const fs: IReadOnlyFileSystem = {
      async openAsync() { return null },
      exists: (f) => knownFiles.has(f),
      isMounted: () => false,
    }
    expect(fs.exists('a.yaml')).toBe(true)
    expect(fs.exists('c.yaml')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test: Re-export consistency (IReadOnlyPackage.ts shim)
// ---------------------------------------------------------------------------

describe('IReadOnlyPackage.ts re-export shim', () => {
  it('should export IReadOnlyPackage from re-export file', () => {
    // Simply verify the import resolves — if tsc passes, this test passes
    // Use a type-level check via structural assignment
    const pkg: IReadOnlyPackageReExported = {
      name: 'shim-test',
      contents: [],
      contains: () => false,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
    }
    expect(pkg.name).toBe('shim-test')
  })

  it('should export IPackage from re-export file', () => {
    const pkg: IPackageReExported = {
      name: 'shim-ipkg',
      contents: [],
      contains: () => false,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
      update: () => {},
      delete: () => {},
    }
    expect(pkg.name).toBe('shim-ipkg')
  })

  it('should export IReadWritePackage as alias of IPackage', () => {
    const pkg: IReadWritePackage = {
      name: 'legacy-alias',
      contents: [],
      contains: () => false,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
      update: () => {},
      delete: () => {},
    }
    expect(pkg.name).toBe('legacy-alias')
  })

  it('should export IPackageLoader from re-export file', () => {
    const loader: IPackageLoaderReExported = {
      tryParsePackage() { return null },
    }
    expect(typeof loader.tryParsePackage).toBe('function')
  })

  it('should export IReadOnlyFileSystem from re-export file', () => {
    const fs: IReadOnlyFileSystemReExported = {
      async openAsync() { return null },
      exists() { return false },
      isMounted() { return false },
    }
    expect(typeof fs.openAsync).toBe('function')
  })

  it('should allow re-exported IReadOnlyPackage to be used as IPackage when it has write methods', () => {
    // IReadWritePackage 是 IPackage 的别名，应该可以互换使用
    const rw: IReadWritePackage = {
      name: 'interop',
      contents: ['interop.txt'],
      contains: () => true,
      open: async () => null,
      openPackage: () => null,
      dispose: () => {},
      update: () => {},
      delete: () => {},
    }
    // 从 IReadOnlyPackage.js 导入的 IPackage 类型应该匹配 IReadWritePackage
    const ip: IPackage = rw
    expect(ip.name).toBe('interop')
  })
})
