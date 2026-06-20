/**
 * ContentInstallerUI.test.ts -- DOM unit tests for ContentInstallerUI
 *
 * Tests the auto-install overlay UI using happy-dom to verify:
 * - show() creates overlay with title, description, progress container
 * - show() auto-triggers installAllParallel and manages the flow
 * - hide() removes all DOM elements
 * - _handleAutoProgress updates status text and progress bar
 * - _formatBytes and _formatSpeed formatting helpers
 * - _extractPackageKey and _modIdToDisplayName helpers
 *
 * Mock ContentInstallerService to avoid actual network/IndexedDB calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ContentInstallerUI } from './ContentInstallerUI.js'
import { StorageManager } from './StorageManager.js'
import type { ModContentManifest, ContentInstallProgress } from './ContentInstallerTypes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(): ModContentManifest {
  return {
    modId: 'ra-content',
    targetModId: 'ra',
    packages: {
      quickinstall: {
        title: 'Quick Install Package',
        identifier: 'quickinstall',
        testFiles: ['Content/ra/v2/allies.mix'],
        sources: [],
        required: true,
        download: 'dl_quickinstall',
      },
      movies: {
        title: 'Movie Files',
        identifier: 'movies',
        testFiles: ['Content/ra/v2/movies.mix'],
        sources: [],
        required: false,
        download: 'dl_movies',
      },
    },
    downloads: {
      dl_quickinstall: {
        title: 'Quick Install',
        url: 'https://example.com/quickinstall.zip',
        sha1: 'abc123',
        type: 'ZipFile',
        extract: {},
      },
      dl_movies: {
        title: 'Movies',
        url: 'https://example.com/movies.zip',
        sha1: 'def456',
        type: 'ZipFile',
        extract: {},
      },
    },
  }
}

function createMockService() {
  let _listeners: Array<(p: ContentInstallProgress) => void> = []

  return {
    state: 'idle' as const,
    onProgress: vi.fn((listener: (p: ContentInstallProgress) => void) => {
      _listeners.push(listener)
      return () => {
        _listeners = _listeners.filter((l) => l !== listener)
      }
    }),
    getContentManifest: vi.fn().mockResolvedValue(makeManifest()),
    checkContent: vi.fn().mockResolvedValue(['quickinstall']),
    installPackage: vi.fn().mockResolvedValue(undefined),
    installAll: vi.fn().mockResolvedValue(undefined),
    installAllParallel: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    clearModContent: vi.fn().mockResolvedValue(undefined),
    clearAll: vi.fn().mockResolvedValue(undefined),
    getInstalledModIds: vi.fn().mockResolvedValue(new Set<string>()),
    detectOtherModsContent: vi.fn().mockResolvedValue(null),
    // Simulate progress emission for testing
    _emitProgress: (progress: ContentInstallProgress) => {
      for (const l of _listeners) l(progress)
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentInstallerUI', () => {
  let mockService: ReturnType<typeof createMockService>

  beforeEach(() => {
    mockService = createMockService()

    // Mock StorageManager static methods
    vi.spyOn(StorageManager, 'getModUsage').mockResolvedValue([])
    vi.spyOn(StorageManager, 'getQuota').mockResolvedValue({
      usage: 0,
      quota: Infinity,
      percentage: 0,
    })
    vi.spyOn(StorageManager, 'formatBytes').mockImplementation((bytes: number) => {
      if (bytes === 0) return '0 B'
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    })
  })

  afterEach(() => {
    // Restore real timers if any test used fake timers
    vi.useRealTimers()
    // Clean up DOM
    ContentInstallerUI.hide()
    const overlay = document.getElementById('content-installer-overlay')
    if (overlay) overlay.remove()
  })

  // -------------------------------------------------------------------------
  // show()
  // -------------------------------------------------------------------------

  describe('show()', () => {
    it('creates overlay with title, description, and progress container', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
        vi.fn(),
      )

      const overlay = document.getElementById('content-installer-overlay')
      expect(overlay).not.toBeNull()
      expect(overlay!.style.position).toBe('fixed')

      // Title
      const title = document.getElementById('content-installer-title')
      expect(title).not.toBeNull()
      expect(title!.textContent).toContain('Game Content Required')

      // Description (updated for auto-install)
      const desc = document.getElementById('content-installer-description')
      expect(desc).not.toBeNull()
      expect(desc!.textContent).toContain('Downloading')

      // Progress container should be visible
      const progressContainer = document.getElementById('content-installer-progress')
      expect(progressContainer).not.toBeNull()
      expect(progressContainer!.style.display).not.toBe('none')
    })

    it('creates status text and progress bar inside progress container', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const statusEl = document.getElementById('content-installer-status')
      expect(statusEl).not.toBeNull()
      expect(statusEl!.textContent).toContain('Connecting')

      const progressBar = document.getElementById('content-installer-progress-bar') as HTMLProgressElement | null
      expect(progressBar).not.toBeNull()
      expect(progressBar!.max).toBe(100)
      expect(progressBar!.value).toBe(0)
    })

    it('auto-triggers installAllParallel when content is needed', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      expect(mockService.installAllParallel).toHaveBeenCalledWith('ra', 2)
    })

    it('shows auto-play banner after install completes', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const panel = document.getElementById('content-installer-panel')
      expect(panel).not.toBeNull()
      expect(panel!.textContent).toContain('All content installed')
      expect(panel!.textContent).toContain('Starting game')
    })

    it('calls onComplete after auto-play timeout (2s delay)', async () => {
      vi.useFakeTimers()
      const onComplete = vi.fn()

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        onComplete,
      )

      // onComplete should NOT have been called yet — waiting for timeout
      expect(onComplete).not.toHaveBeenCalled()

      // The overlay should still exist
      expect(document.getElementById('content-installer-overlay')).not.toBeNull()

      // Advance past the 2-second delay
      vi.advanceTimersByTime(2500)

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(document.getElementById('content-installer-overlay')).toBeNull()
    })

    it('calls hide and onComplete immediately when manifest has no packages', async () => {
      mockService.getContentManifest.mockResolvedValue({
        ...makeManifest(),
        packages: {},
      })
      const onComplete = vi.fn()

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        onComplete,
      )

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(document.getElementById('content-installer-overlay')).toBeNull()
    })

    it('calls hide and onComplete immediately when manifest is null', async () => {
      mockService.getContentManifest.mockResolvedValue(null)
      const onComplete = vi.fn()

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        onComplete,
      )

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(document.getElementById('content-installer-overlay')).toBeNull()
    })

    it('shows error message when installAllParallel fails', async () => {
      mockService.installAllParallel.mockRejectedValue(new Error('Network failure'))

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const statusEl = document.getElementById('content-installer-status')
      expect(statusEl).not.toBeNull()
      expect(statusEl!.textContent).toContain('Download failed')
      // Error color should be set
      expect(statusEl!.style.color).toBe('#ff8888')
    })

    it('subscribes to service.onProgress', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      expect(mockService.onProgress).toHaveBeenCalledTimes(1)
    })

    it('does NOT create Back, Install All, or Play buttons in auto-install flow', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
        vi.fn(),
      )

      // No button bar — removed in auto-install flow
      expect(document.getElementById('content-installer-button-bar')).toBeNull()
      expect(document.getElementById('content-installer-back')).toBeNull()
      expect(document.getElementById('content-installer-install-all')).toBeNull()
      expect(document.getElementById('content-installer-play')).toBeNull()
    })

    it('does NOT create package list in auto-install flow', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      expect(document.getElementById('content-installer-package-list')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // hide()
  // -------------------------------------------------------------------------

  describe('hide()', () => {
    it('removes overlay from DOM', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      expect(document.getElementById('content-installer-overlay')).not.toBeNull()

      ContentInstallerUI.hide()

      expect(document.getElementById('content-installer-overlay')).toBeNull()
    })

    it('is safe to call twice', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      ContentInstallerUI.hide()
      expect(() => ContentInstallerUI.hide()).not.toThrow()
    })

    it('is safe to call before show', () => {
      expect(() => ContentInstallerUI.hide()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Progress handling (_handleAutoProgress)
  // -------------------------------------------------------------------------

  describe('progress handling', () => {
    it('updates status text on progress', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:quickinstall',
        statusText: 'Downloading (45%)...',
        progressPercent: 45,
        bytesReceived: 1024 * 500,
        bytesTotal: 1024 * 1024,
      })

      const statusEl = document.getElementById('content-installer-status')
      expect(statusEl).not.toBeNull()
      expect(statusEl!.textContent).toBe('Downloading (45%)...')
    })

    it('updates progress bar value on progress', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:quickinstall',
        statusText: 'Downloading (67%)...',
        progressPercent: 67,
        bytesReceived: 1024 * 700,
        bytesTotal: 1024 * 1024,
      })

      const progressBar = document.getElementById('content-installer-progress-bar') as HTMLProgressElement | null
      expect(progressBar).not.toBeNull()
      expect(progressBar!.value).toBe(67)
    })

    it('does not update if UI is not visible', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )
      ContentInstallerUI.hide()

      // Capture current status text
      const statusEl = document.getElementById('content-installer-status')
      // After hide(), statusEl is removed from DOM — it should be null
      expect(statusEl).toBeNull()

      // Emit progress — should be safely ignored (no crash)
      expect(() => {
        mockService._emitProgress({
          state: 'downloading',
          packageId: 'ra:quickinstall',
          statusText: 'Should not appear',
          progressPercent: 99,
          bytesReceived: 0,
          bytesTotal: 0,
        })
      }).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // _formatBytes()
  // -------------------------------------------------------------------------

  describe('_formatBytes()', () => {
    function formatBytes(bytes: number): string {
      return (ContentInstallerUI as any)._formatBytes(bytes)
    }

    it('formats 0 as "0 B"', () => {
      expect(formatBytes(0)).toBe('0 B')
    })

    it('formats bytes < 1024', () => {
      expect(formatBytes(500)).toBe('500 B')
    })

    it('formats KB range', () => {
      expect(formatBytes(1536)).toBe('1.5 KB')
    })

    it('formats MB range', () => {
      expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    })

    it('formats GB range', () => {
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB')
    })
  })

  // -------------------------------------------------------------------------
  // _formatSpeed()
  // -------------------------------------------------------------------------

  describe('_formatSpeed()', () => {
    function formatSpeed(bytesPerSec: number): string {
      return (ContentInstallerUI as any)._formatSpeed(bytesPerSec)
    }

    it('appends /s suffix', () => {
      const result = formatSpeed(1024 * 1024)
      expect(result).toContain('/s')
    })
  })

  // -------------------------------------------------------------------------
  // _extractPackageKey()
  // -------------------------------------------------------------------------

  describe('_extractPackageKey()', () => {
    function extractPackageKey(packageId: string): string | null {
      return (ContentInstallerUI as any)._extractPackageKey(packageId)
    }

    it('extracts key from "ra:quickinstall"', () => {
      expect(extractPackageKey('ra:quickinstall')).toBe('quickinstall')
    })

    it('returns original string when no colon present', () => {
      expect(extractPackageKey('quickinstall')).toBe('quickinstall')
    })

    it('returns null for empty string', () => {
      expect(extractPackageKey('')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // _modIdToDisplayName()
  // -------------------------------------------------------------------------

  describe('_modIdToDisplayName()', () => {
    function modIdToDisplayName(modId: string): string {
      return (ContentInstallerUI as any)._modIdToDisplayName(modId)
    }

    it('maps "ra" to "Red Alert"', () => {
      expect(modIdToDisplayName('ra')).toBe('Red Alert')
    })

    it('maps "cnc" to "Tiberian Dawn"', () => {
      expect(modIdToDisplayName('cnc')).toBe('Tiberian Dawn')
    })

    it('maps "d2k" to "Dune 2000"', () => {
      expect(modIdToDisplayName('d2k')).toBe('Dune 2000')
    })

    it('maps "ts" to "Tiberian Sun"', () => {
      expect(modIdToDisplayName('ts')).toBe('Tiberian Sun')
    })

    it('maps unknown modId to uppercase', () => {
      expect(modIdToDisplayName('unknown')).toBe('UNKNOWN')
    })
  })
})
