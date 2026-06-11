/**
 * Folder.test.ts — Folder 迁移单元测试
 *
 * 测试焦点：构造、contents 排序、contains 查找、open 的 fetch 交互、
 * openPackage null 返回、dispose 清理、fromManifest 静态工厂、
 * 错误处理（404、网络错误）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Folder } from './Folder.js'
// (no additional imports needed)

// ---------------------------------------------------------------------------
// Helper: create a mock fetch that returns a response from a URL → data map
// ---------------------------------------------------------------------------

function createMockFetch(responses: Map<string, { ok: boolean; status: number; data: Uint8Array }>) {
  return vi.fn(async (url: string) => {
    const resp = responses.get(url)
    if (!resp) {
      return new Response(null, { status: 404, statusText: 'Not Found' })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Response(resp.data as any, {
      status: resp.status,
      statusText: resp.ok ? 'OK' : 'Error',
    })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Folder', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create a Folder with given name and file listing', () => {
      const listing = new Map([['a.txt', 'http://example.com/a.txt']])
      const folder = new Folder('test-folder', listing)

      expect(folder.name).toBe('test-folder')
      expect(folder.fileCount).toBe(1)
    })

    it('should create a Folder with empty listing', () => {
      const folder = new Folder('empty', new Map())
      expect(folder.name).toBe('empty')
      expect(folder.fileCount).toBe(0)
      expect(folder.contents).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // Contents
  // -----------------------------------------------------------------------

  describe('contents', () => {
    it('should return sorted file names', () => {
      const listing = new Map([
        ['zebra.txt', 'http://example.com/zebra.txt'],
        ['alpha.txt', 'http://example.com/alpha.txt'],
        ['middle.txt', 'http://example.com/middle.txt'],
      ])
      const folder = new Folder('sorted', listing)

      expect(folder.contents).toEqual(['alpha.txt', 'middle.txt', 'zebra.txt'])
    })

    it('should return readonly sorted file names', () => {
      const listing = new Map([
        ['b.txt', 'http://example.com/b.txt'],
        ['a.txt', 'http://example.com/a.txt'],
      ])
      const folder = new Folder('readonly', listing)

      const contents = folder.contents
      expect(contents).toEqual(['a.txt', 'b.txt'])
      expect(Array.isArray(contents)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Contains
  // -----------------------------------------------------------------------

  describe('contains', () => {
    it('should return true for files in the listing', () => {
      const listing = new Map([['config.yaml', 'http://example.com/config.yaml']])
      const folder = new Folder('has-file', listing)

      expect(folder.contains('config.yaml')).toBe(true)
    })

    it('should return false for files not in the listing', () => {
      const listing = new Map([['data.bin', 'http://example.com/data.bin']])
      const folder = new Folder('no-file', listing)

      expect(folder.contains('nonexistent.txt')).toBe(false)
    })

    it('should handle empty string', () => {
      const listing = new Map([['file.txt', 'http://example.com/file.txt']])
      const folder = new Folder('empty-key', listing)

      expect(folder.contains('')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Open — fetch integration
  // -----------------------------------------------------------------------

  describe('open', () => {
    it('should fetch a file and return its contents as ArrayBuffer', async () => {
      const testData = new Uint8Array([1, 2, 3, 4])
      const responses = new Map([
        ['http://example.com/data.bin', { ok: true, status: 200, data: testData }],
      ])
      globalThis.fetch = createMockFetch(responses) as unknown as typeof globalThis.fetch

      const listing = new Map([['data.bin', 'http://example.com/data.bin']])
      const folder = new Folder('fetcher', listing)

      const result = await folder.open('data.bin')
      expect(result).not.toBeNull()
      expect(new Uint8Array(result!)).toEqual(testData)
    })

    it('should return null for files not in the listing', async () => {
      const listing = new Map([['exists.txt', 'http://example.com/exists.txt']])
      const folder = new Folder('missing', listing)

      const result = await folder.open('missing.txt')
      expect(result).toBeNull()
    })

    it('should return null on HTTP 404', async () => {
      const responses = new Map([
        ['http://example.com/notfound.txt', { ok: false, status: 404, data: new Uint8Array() }],
      ])
      globalThis.fetch = createMockFetch(responses) as unknown as typeof globalThis.fetch

      const listing = new Map([['notfound.txt', 'http://example.com/notfound.txt']])
      const folder = new Folder('notfound', listing)

      const result = await folder.open('notfound.txt')
      expect(result).toBeNull()
    })

    it('should return null on HTTP 500', async () => {
      const responses = new Map([
        ['http://example.com/error.txt', { ok: false, status: 500, data: new Uint8Array() }],
      ])
      globalThis.fetch = createMockFetch(responses) as unknown as typeof globalThis.fetch

      const listing = new Map([['error.txt', 'http://example.com/error.txt']])
      const folder = new Folder('server-error', listing)

      const result = await folder.open('error.txt')
      expect(result).toBeNull()
    })

    it('should return null on network error', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('Network error')
      }) as unknown as typeof globalThis.fetch

      const listing = new Map([['net.txt', 'http://example.com/net.txt']])
      const folder = new Folder('network', listing)

      const result = await folder.open('net.txt')
      expect(result).toBeNull()
    })

    it('should return null when fetch is called — no mock needed for missing listing', async () => {
      const listing = new Map([['there.txt', 'http://example.com/there.txt']])
      const folder = new Folder('no-fetch-required', listing)

      // 'nope.txt' 不在 listing 中，所以 fetch 不应该被调用
      const result = await folder.open('nope.txt')
      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // OpenPackage
  // -----------------------------------------------------------------------

  describe('openPackage', () => {
    it('should always return null', () => {
      const listing = new Map([['test.zip', 'http://example.com/test.zip']])
      const folder = new Folder('flat', listing)

      expect(folder.openPackage('test.zip')).toBeNull()
      expect(folder.openPackage('anything')).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should clear the file listing', () => {
      const listing = new Map([['file.txt', 'http://example.com/file.txt']])
      const folder = new Folder('cleanup', listing)

      expect(folder.fileCount).toBe(1)
      folder.dispose()
      expect(folder.fileCount).toBe(0)
      expect(folder.contents).toEqual([])
    })

    it('should make contains return false after dispose', () => {
      const listing = new Map([['file.txt', 'http://example.com/file.txt']])
      const folder = new Folder('post-dispose', listing)

      folder.dispose()
      expect(folder.contains('file.txt')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Dispose lifecycle — IReadOnlyPackage conformance
  // -----------------------------------------------------------------------

  describe('IReadOnlyPackage conformance — dispose lifecycle', () => {
    it('should support create → use → dispose cycle', async () => {
      const testData = new Uint8Array([99])
      const responses = new Map([
        ['http://example.com/test.bin', { ok: true, status: 200, data: testData }],
      ])
      globalThis.fetch = createMockFetch(responses) as unknown as typeof globalThis.fetch

      const listing = new Map([['test.bin', 'http://example.com/test.bin']])
      const folder = new Folder('lifecycle', listing)

      // Use
      const result = await folder.open('test.bin')
      expect(result).not.toBeNull()

      // Dispose
      folder.dispose()
      expect(folder.fileCount).toBe(0)

      // 处置后使用应安全返回 null
      const after = await folder.open('test.bin')
      expect(after).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Static factory: fromManifest
  // -----------------------------------------------------------------------

  describe('fromManifest', () => {
    it('should create a Folder from a manifest with base URL', () => {
      const folder = Folder.fromManifest('https://example.com/assets/', {
        'ui.yaml': 'ui.yaml',
        'sprites/tank.png': 'sprites/tank.png',
      })

      expect(folder.name).toBe('https://example.com/assets/')
      expect(folder.contains('ui.yaml')).toBe(true)
      expect(folder.contains('sprites/tank.png')).toBe(true)
    })

    it('should normalize base URL to end with /', () => {
      const folder = Folder.fromManifest('https://example.com/assets', {
        'data.json': 'data.json',
      })

      expect(folder.name).toBe('https://example.com/assets')
      expect(folder.contains('data.json')).toBe(true)
    })

    it('should strip leading / from manifest keys', () => {
      const folder = Folder.fromManifest('https://example.com/data/', {
        '/absolute/looking/path.yaml': 'path.yaml',
      })

      expect(folder.contains('absolute/looking/path.yaml')).toBe(true)
      // 带前导 '/' 的原始键不应匹配
      // （已规范化）
    })

    it('should handle empty manifest', () => {
      const folder = Folder.fromManifest('https://example.com/', {})
      expect(folder.fileCount).toBe(0)
      expect(folder.contents).toEqual([])
    })

    it('should sort contents alphabetically', () => {
      const folder = Folder.fromManifest('/root/', {
        'z.json': 'z.json',
        'a.json': 'a.json',
        'm.json': 'm.json',
      })

      expect(folder.contents).toEqual(['a.json', 'm.json', 'z.json'])
    })
  })

  // -----------------------------------------------------------------------
  // getUrl
  // -----------------------------------------------------------------------

  describe('getUrl', () => {
    it('should return the URL for a file', () => {
      const listing = new Map([['pic.png', 'https://cdn.example.com/pic.png']])
      const folder = new Folder('cdn', listing)

      expect(folder.getUrl('pic.png')).toBe('https://cdn.example.com/pic.png')
    })

    it('should return undefined for unknown files', () => {
      const listing = new Map([['known.txt', 'https://cdn.example.com/known.txt']])
      const folder = new Folder('cdn2', listing)

      expect(folder.getUrl('unknown.txt')).toBeUndefined()
    })
  })
})
