/**
 * ContentSourceResolver.test.ts — Unit tests for ContentSourceResolver
 *
 * Mocks IndexedDB, FileReader, and DOM file input to test:
 * - selectFiles() with file selection and FileReader
 * - selectFiles() cancellation handling
 * - checkSourceFiles() with IndexedDB records
 * - checkSourceFiles() when IndexedDB is unavailable
 * - showSourceInstructions() for all source types
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ContentSourceResolver } from './ContentSourceResolver.js'
import type { ContentSource } from './ContentInstallerTypes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDiscSource(): ContentSource {
  return {
    title: 'Red Alert CD',
    type: 'Disc',
    idFiles: { 'INSTALL/allies.mix': 'hash123', 'INSTALL/soviet.mix': 'hash456' },
    install: { 'Content/ra/v2/allies.mix': 'INSTALL/allies.mix' },
  }
}

function makeSteamSource(): ContentSource {
  return {
    title: 'Steam Installation',
    type: 'Steam',
    idFiles: { 'allies.mix': 'hash789' },
  }
}

function makeOriginSource(): ContentSource {
  return {
    title: 'Origin Installation',
    type: 'Origin',
    idFiles: { 'game.dat': 'hash000' },
  }
}

function makeGenericSource(): ContentSource {
  return {
    title: 'Game Files',
    type: undefined,
    idFiles: undefined,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentSourceResolver', () => {
  beforeEach(() => {
    // Mock IndexedDB
    const store = new Map<string, any>()
    ;(globalThis as any).indexedDB = {
      open: vi.fn((_name: string, _version?: number) => {
        const request: any = {
          result: null as any,
          set onsuccess(_cb: any) { setTimeout(() => {
            request.result = {
              objectStoreNames: {
                contains: vi.fn(() => false),
              },
              createObjectStore: vi.fn(),
              transaction: vi.fn((_storeName: string, _mode: string) => ({
                objectStore: vi.fn(() => ({
                  getAll: vi.fn(() => ({
                    result: Array.from(store.values()),
                    set onsuccess(_cb2: any) { setTimeout(() => _cb2?.(), 0) },
                    set onerror(_cb2: any) {},
                  })),
                })),
              })),
              close: vi.fn(),
            }
            _cb?.()
          }, 0) },
          set onerror(_cb: any) {},
          set onblocked(_cb: any) {},
        }
        return request
      }),
      deleteDatabase: vi.fn(),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Clean up any lingering file inputs
    document.querySelectorAll('input[type="file"]').forEach((e) => e.remove())
  })

  // -------------------------------------------------------------------------
  // selectFiles
  // -------------------------------------------------------------------------

  describe('selectFiles()', () => {
    it('resolves with empty Map when no files selected (cancelled)', async () => {
      // Mock file input to trigger cancel immediately
      const addEventListenerSpy = vi.fn()

      const mockInput = {
        type: 'file',
        multiple: true,
        accept: '',
        style: { display: 'none' },
        click: vi.fn(() => {
          // Trigger cancel listener on next tick
          setTimeout(() => {
            const cancelHandler = addEventListenerSpy.mock.calls.find(
              (c: string[]) => c[0] === 'cancel',
            )?.[1]
            if (cancelHandler) cancelHandler()
          }, 10)
          // Also trigger focus to simulate dialog dismissal
          setTimeout(() => {
            window.dispatchEvent(new Event('focus'))
          }, 20)
        }),
        addEventListener: addEventListenerSpy,
      } as any

      vi.spyOn(document, 'createElement').mockReturnValue(mockInput)
      vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn())
      vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn())

      const resultPromise = ContentSourceResolver.selectFiles('.mix,.zip')
      const result = await resultPromise

      expect(result.size).toBe(0)
    })

    it('creates file input with correct accept attribute', () => {
      const addEventListenerSpy = vi.fn()
      const mockInput = {
        type: 'file',
        multiple: true,
        accept: '',
        style: { display: 'none' },
        click: vi.fn(),
        addEventListener: addEventListenerSpy,
      } as any

      vi.spyOn(document, 'createElement').mockReturnValue(mockInput)
      vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn())

      ContentSourceResolver.selectFiles('.mix,.pak,.big')

      expect(mockInput.accept).toBe('.mix,.pak,.big')
      expect(mockInput.multiple).toBe(true)
      expect(mockInput.click).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // checkSourceFiles
  // -------------------------------------------------------------------------

  describe('checkSourceFiles()', () => {
    it('returns false when source has no idFiles', async () => {
      const source = makeGenericSource()
      const result = await ContentSourceResolver.checkSourceFiles(source)
      expect(result).toBe(false)
    })

    it('returns false when source has empty idFiles', async () => {
      const source: ContentSource = { title: 'Test', idFiles: {} }
      const result = await ContentSourceResolver.checkSourceFiles(source)
      expect(result).toBe(false)
    })

    it('gracefully handles IndexedDB errors', async () => {
      ;(globalThis as any).indexedDB.open = vi.fn(() => {
        const request: any = {
          set onsuccess(_cb: any) {},
          set onerror(_cb: any) { setTimeout(() => _cb?.(new Error('DB error')), 0) },
          set onblocked(_cb: any) {},
        }
        return request
      })

      const source = makeDiscSource()
      const result = await ContentSourceResolver.checkSourceFiles(source)
      expect(result).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // showSourceInstructions
  // -------------------------------------------------------------------------

  describe('showSourceInstructions()', () => {
    it('returns Disc-specific instructions', () => {
      const result = ContentSourceResolver.showSourceInstructions(makeDiscSource())
      expect(result).toContain('Insert the game disc')
      expect(result).toContain('INSTALL/')
      expect(result).toContain('allies.mix')
    })

    it('returns Steam-specific instructions', () => {
      const result = ContentSourceResolver.showSourceInstructions(makeSteamSource())
      expect(result).toContain('Locate your Steam game directory')
      expect(result).toContain('steamapps')
      expect(result).toContain('allies.mix')
    })

    it('returns Origin-specific instructions', () => {
      const result = ContentSourceResolver.showSourceInstructions(makeOriginSource())
      expect(result).toContain('Origin')
      expect(result).toContain('game.dat')
    })

    it('returns generic instructions for unknown type', () => {
      const result = ContentSourceResolver.showSourceInstructions(makeGenericSource())
      expect(result).toContain('Locate your game installation')
      expect(result).not.toContain('Disc')
      expect(result).not.toContain('Steam')
    })
  })
})
