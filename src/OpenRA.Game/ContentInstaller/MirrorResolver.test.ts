/**
 * MirrorResolver.test.ts — Unit tests for MirrorResolver
 *
 * Since happy-dom provides a minimal `fetch` global, we mock it via vi.stubGlobal
 * to control response behavior. `crypto.getRandomValues` is also mocked for
 * deterministic tests.
 *
 * Tests cover:
 * - Valid mirror list parsing
 * - Empty mirror list error
 * - Blank line filtering
 * - HTTP error handling
 * - Random selection distribution
 * - Single mirror case
 * - Mixed whitespace handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MirrorResolver } from './MirrorResolver'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock fetch that returns the given text with status 200. */
function mockFetchOk(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
  })
}

/** Create a mock fetch that returns the given HTTP status. */
function mockFetchError(status: number, statusText: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(''),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MirrorResolver', () => {
  beforeEach(() => {
    // Deterministic crypto.getRandomValues: always returns index 0
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint32Array) => {
        arr[0] = 0
        return arr
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // -----------------------------------------------------------------------
  // fetchMirrors()
  // -----------------------------------------------------------------------

  describe('fetchMirrors', () => {
    it('parses a valid mirror list with multiple URLs', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk(
          'https://mirror1.example.com/ra.zip\n' +
            'https://mirror2.example.com/ra.zip\n' +
            'https://mirror3.example.com/ra.zip',
        ),
      )

      const mirrors = await MirrorResolver.fetchMirrors(
        'https://example.com/mirrors.txt',
      )

      expect(mirrors).toHaveLength(3)
      expect(mirrors[0]).toBe('https://mirror1.example.com/ra.zip')
      expect(mirrors[1]).toBe('https://mirror2.example.com/ra.zip')
      expect(mirrors[2]).toBe('https://mirror3.example.com/ra.zip')
    })

    it('returns empty array when response body is empty', async () => {
      vi.stubGlobal('fetch', mockFetchOk(''))

      const mirrors = await MirrorResolver.fetchMirrors(
        'https://example.com/mirrors.txt',
      )

      expect(mirrors).toHaveLength(0)
    })

    it('filters out blank lines and whitespace-only lines', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk(
          '\n' +
            'https://mirror1.example.com/ra.zip\n' +
            '\n' +
            '   \n' +
            'https://mirror2.example.com/ra.zip\n' +
            '\n',
        ),
      )

      const mirrors = await MirrorResolver.fetchMirrors(
        'https://example.com/mirrors.txt',
      )

      expect(mirrors).toHaveLength(2)
      expect(mirrors[0]).toBe('https://mirror1.example.com/ra.zip')
      expect(mirrors[1]).toBe('https://mirror2.example.com/ra.zip')
    })

    it('trims whitespace from each line', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk(
          '  https://mirror1.example.com/ra.zip  \n' +
            '\thttps://mirror2.example.com/ra.zip\t',
        ),
      )

      const mirrors = await MirrorResolver.fetchMirrors(
        'https://example.com/mirrors.txt',
      )

      expect(mirrors).toHaveLength(2)
      expect(mirrors[0]).toBe('https://mirror1.example.com/ra.zip')
      expect(mirrors[1]).toBe('https://mirror2.example.com/ra.zip')
    })

    it('throws on HTTP 404 error', async () => {
      vi.stubGlobal('fetch', mockFetchError(404, 'Not Found'))

      await expect(
        MirrorResolver.fetchMirrors('https://example.com/mirrors.txt'),
      ).rejects.toThrow('Failed to fetch mirror list: HTTP 404')
    })

    it('throws on HTTP 500 error', async () => {
      vi.stubGlobal('fetch', mockFetchError(500, 'Internal Server Error'))

      await expect(
        MirrorResolver.fetchMirrors('https://example.com/mirrors.txt'),
      ).rejects.toThrow('Failed to fetch mirror list: HTTP 500')
    })

    it('handles single mirror URL', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk('https://only-mirror.example.com/ra.zip'),
      )

      const mirrors = await MirrorResolver.fetchMirrors(
        'https://example.com/mirrors.txt',
      )

      expect(mirrors).toHaveLength(1)
      expect(mirrors[0]).toBe('https://only-mirror.example.com/ra.zip')
    })

    it('handles lines with only newlines (Unix and Windows style)', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk(
          'https://mirror1.example.com/ra.zip\r\n' +
            '\r\n' +
            'https://mirror2.example.com/ra.zip\r\n',
        ),
      )

      const mirrors = await MirrorResolver.fetchMirrors(
        'https://example.com/mirrors.txt',
      )

      expect(mirrors).toHaveLength(2)
    })
  })

  // -----------------------------------------------------------------------
  // resolveMirror()
  // -----------------------------------------------------------------------

  describe('resolveMirror', () => {
    it('returns a valid mirror URL from the list', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk(
          'https://mirror1.example.com/ra.zip\n' +
            'https://mirror2.example.com/ra.zip\n' +
            'https://mirror3.example.com/ra.zip',
        ),
      )

      // getRandomValues returns 0, so first mirror is selected
      const url = await MirrorResolver.resolveMirror(
        'https://example.com/mirrors.txt',
      )

      expect(url).toBe('https://mirror1.example.com/ra.zip')
    })

    it('throws when mirror list is empty', async () => {
      vi.stubGlobal('fetch', mockFetchOk(''))

      await expect(
        MirrorResolver.resolveMirror('https://example.com/mirrors.txt'),
      ).rejects.toThrow('No mirrors available')
    })

    it('throws when mirror list is all blank lines', async () => {
      vi.stubGlobal('fetch', mockFetchOk('\n\n   \n\t\n'))

      await expect(
        MirrorResolver.resolveMirror('https://example.com/mirrors.txt'),
      ).rejects.toThrow('No mirrors available')
    })

    it('selects single mirror when only one is available', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk('https://only-mirror.example.com/ra.zip'),
      )

      const url = await MirrorResolver.resolveMirror(
        'https://example.com/mirrors.txt',
      )

      expect(url).toBe('https://only-mirror.example.com/ra.zip')
    })

    it('uses crypto.getRandomValues for random selection', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetchOk(
          'https://a.example.com\n' +
            'https://b.example.com\n' +
            'https://c.example.com\n' +
            'https://d.example.com',
        ),
      )

      // Override getRandomValues to return a known value (index 2)
      vi.stubGlobal('crypto', {
        getRandomValues: (arr: Uint32Array) => {
          arr[0] = 2
          return arr
        },
      })

      const url = await MirrorResolver.resolveMirror(
        'https://example.com/mirrors.txt',
      )

      // Index 2 → third mirror (0-based)
      expect(url).toBe('https://c.example.com')
    })
  })
})
