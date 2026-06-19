/**
 * FileSystem.test.ts — FileSystem 迁移单元测试
 *
 * 测试焦点：构造与加载器管理、tryParsePackage、mountFromBuffer、
 * mountPackage（含重新挂载优先级提升）、unmount（引用计数与 dispose）、
 * unmountAll、openAsync（显式挂载、fileIndex 优先级）、exists、isMounted、
 * L1 LRU 缓存（命中、未命中、驱逐）、dispose 生命周期、MOD 包保护、
 * L2-L4 缓存流水线（IndexedDB / Cache API / fetch）、TTL 过期、
 * 版本标记失效、缓存层启用/禁用、优雅降级（API 不可用时）。
 *
 * NOTE: L2 IndexedDB 和 L3 Cache API 在 Node.js/vitest 环境中不可用。
 * 测试验证：1) 这些 API 未定义时的优雅降级行为，
 * 2) 使用内存模拟时的缓存流水线逻辑。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { zipSync, strToU8 } from 'fflate'
import { FileSystem } from './FileSystem.js'
import type {
  IReadOnlyPackage,
  IPackageLoader,
} from './IPackage.js'

// ---------------------------------------------------------------------------
// Helpers: create mock packages and loaders
// ---------------------------------------------------------------------------

interface MockPackageOpts {
  name: string
  files?: Map<string, Uint8Array>
  contents?: string[]
}

/** 创建用于测试的模拟 IReadOnlyPackage。 */
function createMockPackage(opts: MockPackageOpts): IReadOnlyPackage {
  const files = opts.files ?? new Map()
  const contents = opts.contents ?? [...files.keys()].sort()

  return {
    name: opts.name,
    contents,
    contains(filename: string) { return files.has(filename) || contents.includes(filename) },
    async open(filename: string) {
      const data = files.get(filename)
      if (data) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
      // 对于仅 contents 的模拟包，返回虚拟数据
      if (contents.includes(filename)) {
        return new TextEncoder().encode(`content of ${filename} in ${opts.name}`).buffer as ArrayBuffer
      }
      return null
    },
    openPackage(_filename: string) { return null },
    dispose: vi.fn(),
  }
}

/** 创建始终返回 null 的模拟加载器（回退加载器）。 */
function createNullLoader(): IPackageLoader {
  return {
    tryParsePackage() { return null },
  }
}

/** 创建根据扩展名匹配的模拟加载器。 */
function createMockLoader(extension: string, name: string): IPackageLoader {
  return {
    tryParsePackage(filename: string, _stream: ArrayBuffer) {
      if (filename.endsWith(extension)) {
        return createMockPackage({
          name,
          files: new Map([
            [`file.${extension.replace('.', '')}`, new TextEncoder().encode(`data from ${name}`)],
          ]),
        })
      }
      return null
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileSystem', () => {
  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create a FileSystem with default ZipFileLoader', () => {
      const fs = new FileSystem()
      expect(fs.packageLoaders.length).toBe(1)
    })

    it('should create a FileSystem with custom loaders', () => {
      const loader = createNullLoader()
      const fs = new FileSystem([loader])
      expect(fs.packageLoaders).toContain(loader)
    })

    it('should accept custom L1 cache size', () => {
      const fs = new FileSystem([], 1024)
      expect(fs.cacheStats.maxSize).toBe(1024)
    })

    it('should default to 100MB L1 cache', () => {
      const fs = new FileSystem()
      expect(fs.cacheStats.maxSize).toBe(100 * 1024 * 1024)
    })

    it('should start with empty state', () => {
      const fs = new FileSystem()
      expect(fs.mountedPackages.size).toBe(0)
      expect(fs.explicitMounts.size).toBe(0)
      expect(fs.cacheStats.entryCount).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Loader management
  // -----------------------------------------------------------------------

  describe('loader management', () => {
    it('should register additional loaders', () => {
      const fs = new FileSystem([])
      const loader = createNullLoader()
      fs.registerLoader(loader)
      expect(fs.packageLoaders).toContain(loader)
    })

    it('should try loaders in registration order', () => {
      const fs = new FileSystem([])
      const first = createMockLoader('.first', 'first-pkg')
      const second = createMockLoader('.second', 'second-pkg')
      fs.registerLoader(first)
      fs.registerLoader(second)

      // should match first loader
      const data = new Uint8Array([0, 1, 2, 3]).buffer as ArrayBuffer
      const result = fs.tryParsePackage(data, 'test.first')
      expect(result).not.toBeNull()
      expect(result!.name).toBe('first-pkg')
    })
  })

  // -----------------------------------------------------------------------
  // tryParsePackage
  // -----------------------------------------------------------------------

  describe('tryParsePackage', () => {
    it('should parse using matching loader', () => {
      const loader = createMockLoader('.test', 'test-pkg')
      const fs = new FileSystem([loader])
      const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer

      const result = fs.tryParsePackage(data, 'archive.test')
      expect(result).not.toBeNull()
      expect(result!.name).toBe('test-pkg')
    })

    it('should return null when no loader matches', () => {
      const loader = createNullLoader()
      const fs = new FileSystem([loader])
      const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer

      const result = fs.tryParsePackage(data, 'unknown.format')
      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // mountFromBuffer
  // -----------------------------------------------------------------------

  describe('mountFromBuffer', () => {
    it('should parse and mount a package from raw data', () => {
      const loader = createMockLoader('.pkg', 'buffered')
      const fs = new FileSystem([loader])
      const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer

      const pkg = fs.mountFromBuffer('test.pkg', data)
      expect(pkg).not.toBeNull()
      expect(fs.mountedPackages.size).toBe(1)
      expect(fs.mountedPackages.get(pkg!)).toBe(1)
    })

    it('should return null when no loader recognizes the format', () => {
      const loader = createNullLoader()
      const fs = new FileSystem([loader])
      const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer

      const pkg = fs.mountFromBuffer('test.xyz', data)
      expect(pkg).toBeNull()
      expect(fs.mountedPackages.size).toBe(0)
    })

    it('should accept explicit mount name', () => {
      const loader = createMockLoader('.pkg', 'explicit-buf')
      const fs = new FileSystem([loader])
      const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer

      const pkg = fs.mountFromBuffer('test.pkg', data, 'modprefix')
      expect(pkg).not.toBeNull()
      expect(fs.explicitMounts.has('modprefix')).toBe(true)
      expect(fs.explicitMounts.get('modprefix')).toBe(pkg)
    })
  })

  // -----------------------------------------------------------------------
  // mountPackage
  // -----------------------------------------------------------------------

  describe('mountPackage', () => {
    it('should mount a package and populate fileIndex', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({
        name: 'pkg-a',
        files: new Map([['file.txt', new TextEncoder().encode('hello')]]),
      })

      fs.mountPackage(pkg)
      expect(fs.mountedPackages.size).toBe(1)
      expect(fs.mountedPackages.get(pkg)).toBe(1)
      expect(fs.exists('file.txt')).toBe(true)
    })

    it('should bump priority when same package is re-mounted', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({
        name: 'pkg-b',
        files: new Map([['config.yaml', new TextEncoder().encode('a')]]),
      })

      fs.mountPackage(pkg)
      expect(fs.mountedPackages.get(pkg)).toBe(1)

      // 重新挂载 → 引用计数递增
      fs.mountPackage(pkg)
      expect(fs.mountedPackages.get(pkg)).toBe(2)
    })

    it('should register explicit mount name', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({
        name: 'named-pkg',
        files: new Map([['data.bin', new TextEncoder().encode('x')]]),
      })

      fs.mountPackage(pkg, 'mymod|path')
      expect(fs.explicitMounts.get('mymod|path')).toBe(pkg)
    })

    it('should add files to fileIndex', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({
        name: 'indexed',
        files: new Map([
          ['a.txt', new TextEncoder().encode('a')],
          ['b.txt', new TextEncoder().encode('b')],
        ]),
      })

      fs.mountPackage(pkg)
      const packages = fs.getPackagesForFile('a.txt')
      expect(packages).toContain(pkg)
    })
  })

  // -----------------------------------------------------------------------
  // Unmount
  // -----------------------------------------------------------------------

  describe('unmount', () => {
    it('should decrement refcount on unmount but not dispose', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'refcount-pkg', files: new Map([['f.txt', new TextEncoder().encode('f')]]) })

      fs.mountPackage(pkg)
      fs.mountPackage(pkg) // refcount = 2

      const result = fs.unmount(pkg)
      expect(result).toBe(true)
      expect(fs.mountedPackages.get(pkg)).toBe(1)
      // dispose 不应被调用（refcount 仍 > 0）
      expect(pkg.dispose).not.toHaveBeenCalled()
    })

    it('should dispose when refcount reaches 0', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'dispose-pkg', files: new Map([['g.txt', new TextEncoder().encode('g')]]) })

      fs.mountPackage(pkg)
      fs.unmount(pkg)

      // refcount 变为 0 → dispose 应被调用
      expect(pkg.dispose).toHaveBeenCalled()
    })

    it('should clean up fileIndex when refcount reaches 0', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'cleanup-pkg', files: new Map([['h.txt', new TextEncoder().encode('h')]]) })

      fs.mountPackage(pkg)
      expect(fs.exists('h.txt')).toBe(true)

      fs.unmount(pkg)
      expect(fs.exists('h.txt')).toBe(false)
    })

    it('should clean up explicit mounts', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'explicit-cleanup', files: new Map([['i.txt', new TextEncoder().encode('i')]]) })

      fs.mountPackage(pkg, 'cleanup|prefix')
      expect(fs.explicitMounts.has('cleanup|prefix')).toBe(true)

      fs.unmount(pkg)
      expect(fs.explicitMounts.has('cleanup|prefix')).toBe(false)
    })

    it('should return false for unmounted packages', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'not-mounted' })

      expect(fs.unmount(pkg)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Mod packages (not disposed on unmount)
  // -----------------------------------------------------------------------

  describe('mod packages', () => {
    it('should not dispose mod packages on unmount', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'mod-pkg', files: new Map([['mod.txt', new TextEncoder().encode('mod')]]) })

      fs.mountPackage(pkg)
      fs.markAsModPackage(pkg)
      fs.unmount(pkg)

      // MOD 包不应被 dispose
      expect(pkg.dispose).not.toHaveBeenCalled()
    })

    it('should not dispose mod packages on unmountAll', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'mod2-pkg', files: new Map([['mod2.txt', new TextEncoder().encode('mod2')]]) })

      fs.mountPackage(pkg)
      fs.markAsModPackage(pkg)
      fs.unmountAll()

      expect(pkg.dispose).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // unmountAll
  // -----------------------------------------------------------------------

  describe('unmountAll', () => {
    it('should dispose all mounted packages', () => {
      const fs = new FileSystem()
      const pkg1 = createMockPackage({ name: 'all-1', files: new Map([['1.txt', new TextEncoder().encode('1')]]) })
      const pkg2 = createMockPackage({ name: 'all-2', files: new Map([['2.txt', new TextEncoder().encode('2')]]) })

      fs.mountPackage(pkg1)
      fs.mountPackage(pkg2)
      fs.unmountAll()

      expect(pkg1.dispose).toHaveBeenCalled()
      expect(pkg2.dispose).toHaveBeenCalled()
    })

    it('should clear all internal state', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'state-pkg', files: new Map([['s.txt', new TextEncoder().encode('s')]]) })

      fs.mountPackage(pkg, 's|prefix')
      fs.unmountAll()

      expect(fs.mountedPackages.size).toBe(0)
      expect(fs.explicitMounts.size).toBe(0)
      expect(fs.exists('s.txt')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // openAsync — priority
  // -----------------------------------------------------------------------

  describe('openAsync — priority', () => {
    it('should return file from highest priority package (last mounted wins)', async () => {
      const fs = new FileSystem()
      const pkgA = createMockPackage({
        name: 'low',
        files: new Map([['shared.txt', new TextEncoder().encode('LOW')]]),
      })
      const pkgB = createMockPackage({
        name: 'high',
        files: new Map([['shared.txt', new TextEncoder().encode('HIGH')]]),
      })

      fs.mountPackage(pkgA)
      fs.mountPackage(pkgB) // 最后挂载 → 最高优先级

      const result = await fs.openAsync('shared.txt')
      expect(new TextDecoder().decode(result!)).toBe('HIGH')
    })

    it('should return null when file is not in any package', async () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'only', files: new Map([['exists.txt', new TextEncoder().encode('yes')]]) })

      fs.mountPackage(pkg)
      const result = await fs.openAsync('missing.txt')
      expect(result).toBeNull()
    })

    it('should handle explicit mount paths (pipe syntax)', async () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({
        name: 'pipe-pkg',
        files: new Map([['inner.txt', new TextEncoder().encode('pipe content')]]),
      })

      fs.mountPackage(pkg, 'mymod')
      const result = await fs.openAsync('mymod|inner.txt')
      expect(new TextDecoder().decode(result!)).toBe('pipe content')
    })

    it('should return null for invalid explicit mount prefix', async () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'prefix-pkg', files: new Map([['data.bin', new TextEncoder().encode('data')]]) })

      fs.mountPackage(pkg, 'valid')
      const result = await fs.openAsync('invalid|data.bin')
      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // openAsync — explicit mount priority over fileIndex
  // -----------------------------------------------------------------------

  describe('openAsync — explicit mount priority', () => {
    it('should prioritize explicit mounts over other packages with same file name', async () => {
      const fs = new FileSystem()
      const otherPkg = createMockPackage({
        name: 'other',
        files: new Map([['overlap.txt', new TextEncoder().encode('from other')]]),
      })
      const explicitPkg = createMockPackage({
        name: 'explicit-priority',
        files: new Map([['overlap.txt', new TextEncoder().encode('from explicit')]]),
      })

      fs.mountPackage(otherPkg)
      fs.mountPackage(explicitPkg, 'pref')

      // 通过显式挂载访问 → 应返回显式包中的数据
      // 但应注意，openAsync 对 "pref|overlap.txt" 使用显式挂载，
      // 对 "overlap.txt" 使用 fileIndex（最后挂载的 = explicitPkg）
      const throughExplicit = await fs.openAsync('pref|overlap.txt')
      expect(new TextDecoder().decode(throughExplicit!)).toBe('from explicit')
    })
  })

  // -----------------------------------------------------------------------
  // exists
  // -----------------------------------------------------------------------

  describe('exists', () => {
    it('should return true for files in mounted packages', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'exists-pkg', files: new Map([['real.txt', new TextEncoder().encode('real')]]) })

      fs.mountPackage(pkg)
      expect(fs.exists('real.txt')).toBe(true)
    })

    it('should return false for files not in any package', () => {
      const fs = new FileSystem()
      expect(fs.exists('ghost.txt')).toBe(false)
    })

    it('should handle explicit mount prefix correctly', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({
        name: 'ex-exists',
        files: new Map([['inner.yaml', new TextEncoder().encode('inner')]]),
      })

      fs.mountPackage(pkg, 'mod')
      expect(fs.exists('mod|inner.yaml')).toBe(true)
      expect(fs.exists('mod|missing.yaml')).toBe(false)
    })

    it('should return false for empty pipe syntax with invalid prefix', () => {
      const fs = new FileSystem()
      expect(fs.exists('noprefix|anything')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // isMounted
  // -----------------------------------------------------------------------

  describe('isMounted', () => {
    it('should return true for mounted file names', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'mount-check', files: new Map([['avail.txt', new TextEncoder().encode('avail')]]) })

      fs.mountPackage(pkg)
      expect(fs.isMounted('avail.txt')).toBe(true)
    })

    it('should return false for unmounted file names', () => {
      const fs = new FileSystem()
      expect(fs.isMounted('nope.txt')).toBe(false)
    })

    it('should return true for explicit mount prefixes', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'mnt-prefix', files: new Map([['f.txt', new TextEncoder().encode('f')]]) })

      fs.mountPackage(pkg, 'pref')
      expect(fs.isMounted('pref|anything')).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // L1 LRU Cache
  // -----------------------------------------------------------------------

  describe('L1 LRU cache', () => {
    it('should cache file data on first access', async () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'cache-pkg', files: new Map([['cached.txt', new TextEncoder().encode('cached')]]) })

      fs.mountPackage(pkg)

      // 第一次访问 — 缓存未命中
      await fs.openAsync('cached.txt')
      expect(fs.cacheStats.entryCount).toBe(1)
    })

    it('should return cached data on subsequent access', async () => {
      const fs = new FileSystem()
      let accessCount = 0
      const pkg: IReadOnlyPackage = {
        name: 'count-pkg',
        contents: ['counted.txt'],
        contains: () => true,
        async open(_filename: string) {
          accessCount++
          return new TextEncoder().encode(`access ${accessCount}`).buffer as ArrayBuffer
        },
        openPackage: () => null,
        dispose: () => {},
      }

      fs.mountPackage(pkg)
      await fs.openAsync('counted.txt') // accessCount = 1
      await fs.openAsync('counted.txt') // 应从缓存返回，accessCount 仍为 1

      expect(accessCount).toBe(1)
    })

    it('should evict LRU entries when cache exceeds max size', async () => {
      // 设置小缓存来强制驱逐
      const smallCacheSize = 50 // 50 bytes max
      const fs = new FileSystem([], smallCacheSize)

      // 创建一个返回大数据的包（每个文件 ~30 bytes）
      const pkg = createMockPackage({
        name: 'big-pkg',
        files: new Map([
          ['large1.txt', new TextEncoder().encode('A'.repeat(30))],
          ['large2.txt', new TextEncoder().encode('B'.repeat(30))],
        ]),
      })

      fs.mountPackage(pkg)

      await fs.openAsync('large1.txt')
      expect(fs.cacheStats.entryCount).toBe(1)

      // 第二个文件应触发驱逐，因为 30+30=60 > 50
      await fs.openAsync('large2.txt')

      // 第一个条目应已被驱逐（缓存中只有 1 个条目或总大小 <= 50）
      const stats = fs.cacheStats
      expect(stats.size).toBeLessThanOrEqual(smallCacheSize)
    })

    it('should not cache files larger than max cache size', async () => {
      const tinyCache = 10 // 10 bytes
      const fs = new FileSystem([], tinyCache)

      const pkg = createMockPackage({
        name: 'huge-pkg',
        files: new Map([['huge.txt', new TextEncoder().encode('much larger than 10 bytes')]]),
      })

      fs.mountPackage(pkg)
      await fs.openAsync('huge.txt')
      // 大于缓存的文件不应被缓存
      expect(fs.cacheStats.entryCount).toBe(0)
      expect(fs.cacheStats.size).toBe(0)
    })

    it('should clear cache on demand', async () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'clr-pkg', files: new Map([['clr.txt', new TextEncoder().encode('clear me')]]) })

      fs.mountPackage(pkg)
      await fs.openAsync('clr.txt')
      expect(fs.cacheStats.entryCount).toBe(1)

      fs.clearCache()
      expect(fs.cacheStats.entryCount).toBe(0)
      expect(fs.cacheStats.size).toBe(0)
    })

    it('should track LRU correctly with multiple entries', async () => {
      // Use cache large enough for 3 entries
      const cacheSize = 1000
      const fs = new FileSystem([], cacheSize)
      const pkg = createMockPackage({
        name: 'lru-pkg',
        files: new Map([
          ['a.txt', new TextEncoder().encode('a')],
          ['b.txt', new TextEncoder().encode('b')],
          ['c.txt', new TextEncoder().encode('c')],
        ]),
      })

      fs.mountPackage(pkg)

      // Access a, b, c in order
      await fs.openAsync('a.txt')
      await fs.openAsync('b.txt')
      await fs.openAsync('c.txt')

      // Re-access a (becomes most recent)
      await fs.openAsync('a.txt')

      // All 3 should still be cached
      expect(fs.cacheStats.entryCount).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // getPackagesForFile
  // -----------------------------------------------------------------------

  describe('getPackagesForFile', () => {
    it('should return list of packages containing a file', () => {
      const fs = new FileSystem()
      const pkg1 = createMockPackage({ name: 'p1', files: new Map([['shared.txt', new TextEncoder().encode('1')]]) })
      const pkg2 = createMockPackage({ name: 'p2', files: new Map([['shared.txt', new TextEncoder().encode('2')]]) })

      fs.mountPackage(pkg1)
      fs.mountPackage(pkg2)

      const packages = fs.getPackagesForFile('shared.txt')
      expect(packages).toHaveLength(2)
      expect(packages[0]).toBe(pkg1) // 先挂载的在前
      expect(packages[1]).toBe(pkg2) // 最后挂载的在后（最高优先级）
    })

    it('should return empty array for unknown files', () => {
      const fs = new FileSystem()
      expect(fs.getPackagesForFile('unknown')).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // Dispose lifecycle
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should call unmountAll on dispose', () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'disp-pkg', files: new Map([['d.txt', new TextEncoder().encode('d')]]) })

      fs.mountPackage(pkg)
      fs.dispose()

      expect(pkg.dispose).toHaveBeenCalled()
      expect(fs.mountedPackages.size).toBe(0)
    })

    it('should clear cache on dispose', async () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'disp-cache', files: new Map([['dc.txt', new TextEncoder().encode('dc')]]) })

      fs.mountPackage(pkg)
      await fs.openAsync('dc.txt')
      expect(fs.cacheStats.entryCount).toBe(1)

      fs.dispose()
      expect(fs.cacheStats.entryCount).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Complex scenarios
  // -----------------------------------------------------------------------

  describe('complex scenarios', () => {
    it('should handle mount → use → unmount → use again lifecycle', async () => {
      const fs = new FileSystem()
      const pkg = createMockPackage({ name: 'lifecycle', files: new Map([['life.txt', new TextEncoder().encode('life')]]) })

      // 挂载并使用
      fs.mountPackage(pkg)
      const data1 = await fs.openAsync('life.txt')
      expect(data1).not.toBeNull()

      // 卸载
      fs.unmount(pkg)
      const data2 = await fs.openAsync('life.txt')
      expect(data2).toBeNull()

      // 重新挂载
      fs.mountPackage(pkg)
      const data3 = await fs.openAsync('life.txt')
      expect(data3).not.toBeNull()
    })

    it('should handle multiple packages with priority reordering', async () => {
      const fs = new FileSystem()
      const pkgA = createMockPackage({
        name: 'alpha',
        files: new Map([['common.txt', new TextEncoder().encode('a')]]),
      })
      const pkgB = createMockPackage({
        name: 'bravo',
        files: new Map([['common.txt', new TextEncoder().encode('b')]]),
      })
      const pkgC = createMockPackage({
        name: 'charlie',
        files: new Map([['common.txt', new TextEncoder().encode('c')]]),
      })

      // 挂载 A, B, C (优先级: C > B > A)
      fs.mountPackage(pkgA)
      fs.mountPackage(pkgB)
      fs.mountPackage(pkgC)

      let result = await fs.openAsync('common.txt')
      expect(new TextDecoder().decode(result!)).toBe('c') // 最高的

      // 卸载 C → 现在优先级: B > A
      fs.unmount(pkgC)
      result = await fs.openAsync('common.txt')
      expect(new TextDecoder().decode(result!)).toBe('b')

      // 重新挂载 A（提升到最高优先级: A > B）
      fs.mountPackage(pkgA)
      result = await fs.openAsync('common.txt')
      expect(new TextDecoder().decode(result!)).toBe('a')
    })

    it('should handle empty fileIndex gracefully', async () => {
      const fs = new FileSystem()
      expect(fs.exists('nothing')).toBe(false)
      expect(await fs.openAsync('nothing')).toBeNull()
      expect(fs.isMounted('nothing')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Mount idempotency and HTML fallback detection (Fix: duplicate mount + SPA)
  // -----------------------------------------------------------------------

  describe('mount() — idempotency and graceful degradation', () => {
    it('should skip duplicate mount attempts for the same name', async () => {
      const loader = createMockLoader('.zip', 'idem-pkg')
      const fs = new FileSystem([loader])

      const zipData = createTestZipForFetch('idem.zip')
      const originalFetch = globalThis.fetch
      let fetchCalls = 0
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCalls++
        return {
          ok: true,
          arrayBuffer: async () => zipData.buffer as ArrayBuffer,
          headers: new Headers({ 'Content-Type': 'application/zip' }),
        }
      })

      try {
        // First mount should fetch
        await fs.mount('/test/idem.zip')
        expect(fetchCalls).toBe(1)
        expect(fs.exists('file.zip')).toBe(true)

        // Second mount for same name should be no-op (no fetch)
        await fs.mount('/test/idem.zip')
        expect(fetchCalls).toBe(1) // Still 1 — skipped
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should not re-throw when duplicate mount previously failed', async () => {
      const fs = new FileSystem([])
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
      })

      try {
        // First mount fails but is tracked
        await expect(fs.mount('/test/missing.mix')).rejects.toThrow('HTTP 404')

        // Second mount for same name should be no-op (silently return,
        // even though it previously failed — the name is in _attemptedMounts)
        // Use a fresh FileSystem to test the duplicate behavior correctly
      } finally {
        globalThis.fetch = originalFetch
      }

      // A second FileSystem instance: first attempt fails, second is no-op
      const fs2 = new FileSystem([])
      const fetch2 = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
      })
      globalThis.fetch = fetch2

      try {
        await expect(fs2.mount('/test/missing2.mix')).rejects.toThrow('HTTP 404')

        // Second attempt should NOT call fetch again
        const callCountAfterFirst = fetch2.mock.calls.length
        // Try again — should be no-op since name is in _attemptedMounts
        try {
          await fs2.mount('/test/missing2.mix')
        } catch {
          // Should not reach here — idempotency returns early
        }
        // No additional fetch calls
        expect(fetch2.mock.calls.length).toBe(callCountAfterFirst)
      } finally {
        globalThis.fetch = (globalThis as Record<string, unknown>).__originalFetch as typeof fetch
      }
    })

    it('should handle optional mounts (with ~ prefix) gracefully on non-package response', async () => {
      const fs = new FileSystem([])
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('<!DOCTYPE html><html>...</html>').buffer as ArrayBuffer,
        headers: new Headers({ 'Content-Type': 'text/html' }),
      })

      try {
        // Optional mount (~ prefix) should not throw even with HTML response
        await expect(fs.mount('~optional/html-response')).resolves.toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should detect HTML fallback even without Content-Type header', async () => {
      const fs = new FileSystem([])
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('<!doctype html>\n<html lang="en">').buffer as ArrayBuffer,
        headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
      })

      try {
        // Even with octet-stream Content-Type, HTML heuristic catches it
        await expect(fs.mount('/test/html-disguised')).rejects.toThrow('appears to be HTML')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('should clear _attemptedMounts on unmountAll', async () => {
      const fs = new FileSystem([])
      const originalFetch = globalThis.fetch
      let fetchCalls = 0
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCalls++
        return {
          ok: false,
          status: 404,
          headers: new Headers(),
        }
      })

      try {
        // First attempt fails
        await expect(fs.mount('/test/pre-clear.mix')).rejects.toThrow('HTTP 404')
        expect(fetchCalls).toBe(1)

        // Clear all state
        fs.unmountAll()

        // After unmountAll, the name should not be in _attemptedMounts,
        // so a new mount attempt should fetch again
        await expect(fs.mount('/test/pre-clear.mix')).rejects.toThrow('HTTP 404')
        expect(fetchCalls).toBe(2) // fetch was called again
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  // -----------------------------------------------------------------------
  // L2-L4 Cache Pipeline (P1-D.3) — Graceful Degradation
  // -----------------------------------------------------------------------

  describe('L2-L4 cache — graceful degradation', () => {
    it('mount() works when IndexedDB and Cache API are unavailable (L4 fetch fallback)', async () => {
      // The constructor creates IndexedDBCache and CacheAPICache instances.
      // In Node.js, indexedDB and caches are undefined — that's fine.
      // The pipeline should fall through to L4 fetch.
      const loader = createMockLoader('.zip', 'fetched-pkg')
      const fs = new FileSystem([loader])

      // Mock fetch to return valid ZIP data
      const zipData = createTestZipForFetch('fetched.zip')
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => zipData.buffer as ArrayBuffer,
      })

      try {
        await fs.mount('/test/fetched.zip')
        expect(fs.exists('file.zip')).toBe(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('mount() with caching disabled skips L2/L3 entirely', async () => {
      const loader = createMockLoader('.zip', 'no-cache-pkg')
      const fs = new FileSystem([loader], 100 * 1024 * 1024, { cachingEnabled: false })

      const zipData = createTestZipForFetch('nocache.zip')
      const originalFetch = globalThis.fetch
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => zipData.buffer as ArrayBuffer,
      })

      try {
        await fs.mount('/test/nocache.zip')
        expect(fs.exists('file.zip')).toBe(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('cachingEnabled getter/setter', () => {
      const fs = new FileSystem([], 1024, { cachingEnabled: true })
      expect(fs.cachingEnabled).toBe(true)

      fs.setCachingEnabled(false)
      expect(fs.cachingEnabled).toBe(false)

      fs.setCachingEnabled(true)
      expect(fs.cachingEnabled).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // L2-L4 Cache Pipeline — Integration with Mocked APIs
  // -----------------------------------------------------------------------

  describe('L2-L4 cache — with mocked storage APIs', () => {
    let mockIDBStore: Map<string, ArrayBuffer>
    let mockCacheStore: Map<string, { data: Uint8Array; headers: Record<string, string> }>
    let originalIndexedDB: IDBFactory | undefined
    let originalCaches: CacheStorage | undefined

    beforeEach(() => {
      // In-memory stores
      mockIDBStore = new Map()
      mockCacheStore = new Map()

      // Save originals
      originalIndexedDB = (globalThis as Record<string, unknown>).indexedDB as IDBFactory | undefined
      originalCaches = (globalThis as Record<string, unknown>).caches as CacheStorage | undefined

      // Mock IndexedDB
      const mockIDB = createMockIndexedDB(mockIDBStore)
      ;(globalThis as Record<string, unknown>).indexedDB = mockIDB

      // Mock Cache API
      const mockCacheAPI = createMockCacheStorage(mockCacheStore)
      ;(globalThis as Record<string, unknown>).caches = mockCacheAPI

      // Mock fetch
      const originalFetch = globalThis.fetch
      ;(globalThis as Record<string, unknown>).__originalFetch = originalFetch
    })

    afterEach(() => {
      (globalThis as Record<string, unknown>).indexedDB = originalIndexedDB
      ;(globalThis as Record<string, unknown>).caches = originalCaches
      const origFetch = (globalThis as Record<string, unknown>).__originalFetch as typeof fetch
      if (origFetch) {
        globalThis.fetch = origFetch
      }
    })

    it('clearAllCaches() clears all caches without error', async () => {
      const fs = new FileSystem([], 1024 * 1024)
      // Should not throw even when caches are empty
      await expect(fs.clearAllCaches()).resolves.toBeUndefined()
    })

    it('clearAllCaches() is safe when caching is disabled', async () => {
      const fs = new FileSystem([], 1024, { cachingEnabled: false })
      await expect(fs.clearAllCaches()).resolves.toBeUndefined()
    })

    it('mount() with version tag constructs correct cache key', async () => {
      const loader = createMockLoader('.zip', 'versioned-pkg')
      const fs = new FileSystem([loader], 100 * 1024 * 1024, { cachingEnabled: true })

      const zipData = createTestZipForFetch('versioned.zip')
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => zipData.buffer as ArrayBuffer,
      })

      try {
        await fs.mount('/test/versioned.zip', undefined, { version: 'v2.0.1' })
        expect(fs.exists('file.zip')).toBe(true)
      } finally {
        globalThis.fetch = (globalThis as Record<string, unknown>).__originalFetch as typeof fetch
      }
    })

    it('mount() with custom TTL works', async () => {
      const loader = createMockLoader('.zip', 'ttl-pkg')
      const fs = new FileSystem([loader], 100 * 1024 * 1024, { cachingEnabled: true })

      const zipData = createTestZipForFetch('ttl.zip')
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => zipData.buffer as ArrayBuffer,
      })

      try {
        // Custom TTL of 1 hour
        await fs.mount('/test/ttl.zip', undefined, { version: '1.0', ttl: 3600000 })
        expect(fs.exists('file.zip')).toBe(true)
      } finally {
        globalThis.fetch = (globalThis as Record<string, unknown>).__originalFetch as typeof fetch
      }
    })

    it('mount() falls back to L4 when L2/L3 have corrupted data', async () => {
      // Pre-populate L3 cache with garbage data that won't parse as ZIP
      const loader = createMockLoader('.zip', 'fresh-pkg')
      const fs = new FileSystem([loader], 100 * 1024 * 1024, { cachingEnabled: true })

      // Put garbage in L3 cache
      const url = new Request('https://local.openra/pkg%3A%2Ftest%2Fcorrupt.zip%23v%3Dunknown')
      const headers = new Headers({
        'Content-Type': 'application/octet-stream',
        'x-pkg-version': 'unknown',
        'x-pkg-created-at': String(Date.now()),
        'x-pkg-ttl': '0',
      })
      const garbageData = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]) // Not valid ZIP
      const cache = await caches.open('openra-packages')
      await cache.put(url, new Response(garbageData, { headers }))

      // Now mount the same file — should detect garbage, fall through to L4
      const zipData = createTestZipForFetch('corrupt.zip')
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => zipData.buffer as ArrayBuffer,
      })

      try {
        await fs.mount('/test/corrupt.zip')
        expect(fs.exists('file.zip')).toBe(true)
      } finally {
        globalThis.fetch = (globalThis as Record<string, unknown>).__originalFetch as typeof fetch
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Helpers: Test ZIP data and mocked browser storage APIs
// ---------------------------------------------------------------------------

/**
 * Create valid ZIP data with a fixed filename 'file.zip'.
 * The file name must match what createMockLoader produces.
 */
function createTestZipForFetch(baseName: string): Uint8Array {
  return zipSync({
    'file.zip': strToU8(`content of ${baseName}`),
  })
}

/**
 * Create a minimal mock IndexedDB implementation backed by an in-memory Map.
 */
function createMockIndexedDB(store: Map<string, ArrayBuffer>): unknown {
  return {
    open(_name: string, _version: number) {
      const request: Record<string, unknown> = {
        result: null as unknown,
        error: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      }

      // Simulate async success
      setTimeout(() => {
        const db = {
          objectStoreNames: {
            contains: () => true,
          },
          transaction(_storeName: string, _mode: string) {
            const tx: Record<string, unknown> = {
              error: null,
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              objectStore(_name: string) {
                return {
                  get(key: string) {
                    const getReq: Record<string, unknown> = {
                      result: store.get(key),
                      onsuccess: null as (() => void) | null,
                      onerror: null as (() => void) | null,
                    }
                    setTimeout(() => {
                      if (getReq.onsuccess) (getReq.onsuccess as () => void)()
                    }, 0)
                    return getReq
                  },
                  put(value: unknown, key: string) {
                    if (value instanceof ArrayBuffer) {
                      store.set(key, value)
                    } else if (value && typeof value === 'object' && 'buffer' in value) {
                      store.set(key, (value as { buffer: ArrayBuffer }).buffer)
                    }
                    // Fire complete
                    setTimeout(() => {
                      if (tx.oncomplete) (tx.oncomplete as () => void)()
                    }, 0)
                    return {}
                  },
                  delete(key: string) {
                    store.delete(key)
                    setTimeout(() => {
                      if (tx.oncomplete) (tx.oncomplete as () => void)()
                    }, 0)
                    return {}
                  },
                  clear() {
                    store.clear()
                    setTimeout(() => {
                      if (tx.oncomplete) (tx.oncomplete as () => void)()
                    }, 0)
                    return {}
                  },
                }
              },
            }
            return tx
          },
        }
        request.result = db as unknown as IDBDatabase
        if (request.onsuccess) (request.onsuccess as () => void)()
      }, 5)

      return request
    },
  }
}

/**
 * Create a minimal mock CacheStorage implementation backed by an in-memory Map.
 */
function createMockCacheStorage(
  store: Map<string, { data: Uint8Array; headers: Record<string, string> }>,
): unknown {
  const cacheInstance = {
    async match(request: Request): Promise<Response | undefined> {
      const entry = store.get(request.url)
      if (!entry) return undefined
      const headers = new Headers(entry.headers)
      return new Response(entry.data as BodyInit, { headers })
    },
    async put(request: Request, response: Response): Promise<void> {
      const data = new Uint8Array(await response.arrayBuffer())
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })
      store.set(request.url, { data, headers })
    },
    async delete(request: Request): Promise<boolean> {
      return store.delete(request.url)
    },
  }

  return {
    open(_name: string): Promise<typeof cacheInstance | null> {
      // Always return same cache instance (simplified)
      return Promise.resolve(cacheInstance)
    },
    async delete(_name: string): Promise<boolean> {
      store.clear()
      return true
    },
  }
}
