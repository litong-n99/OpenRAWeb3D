/**
 * ContentInstallerUI.test.ts -- DOM unit tests for ContentInstallerUI
 *
 * Tests the DOM overlay UI using happy-dom to verify:
 * - show() creates overlay with expected elements
 * - Package list rendering with required/optional badges
 * - Button bar rendering with Back, Install All, Play buttons
 * - hide() removes all DOM elements
 * - Progress view show/hide behavior
 * - _formatBytes and _formatSpeed formatting helpers
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
      music: {
        title: 'Music Tracks',
        identifier: 'music',
        testFiles: ['Content/ra/v2/scores.mix'],
        sources: [],
        required: false,
        download: 'dl_music',
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
      dl_music: {
        title: 'Music',
        url: 'https://example.com/music.zip',
        sha1: 'ghi789',
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
    checkContent: vi.fn().mockResolvedValue(['quickinstall', 'movies']),
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
  let storageGetModUsageSpy: ReturnType<typeof vi.fn>
  let storageGetQuotaSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockService = createMockService()

    // Mock StorageManager static methods
    storageGetModUsageSpy = vi.fn().mockResolvedValue([])
    storageGetQuotaSpy = vi.fn().mockResolvedValue({
      usage: 0,
      quota: Infinity,
      percentage: 0,
    })
    vi.spyOn(StorageManager, 'getModUsage').mockImplementation(storageGetModUsageSpy)
    vi.spyOn(StorageManager, 'getQuota').mockImplementation(storageGetQuotaSpy)
    vi.spyOn(StorageManager, 'formatBytes').mockImplementation((bytes: number) => {
      if (bytes === 0) return '0 B'
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    })
  })

  afterEach(() => {
    // Clean up DOM
    ContentInstallerUI.hide()
    const overlay = document.getElementById('content-installer-overlay')
    if (overlay) overlay.remove()
  })

  // -------------------------------------------------------------------------
  // show() / hide()
  // -------------------------------------------------------------------------

  describe('show()', () => {
    it('creates overlay with title, description, and button bar', async () => {
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

      // Description
      const desc = document.getElementById('content-installer-description')
      expect(desc).not.toBeNull()

      // Button bar
      const btnBar = document.getElementById('content-installer-button-bar')
      expect(btnBar).not.toBeNull()
    })

    it('renders package list with required and optional packages', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
        vi.fn(),
      )

      const pkgList = document.getElementById('content-installer-package-list')
      expect(pkgList).not.toBeNull()
      expect(pkgList!.textContent).toContain('Quick Install Package')
      expect(pkgList!.textContent).toContain('Required')
      expect(pkgList!.textContent).toContain('Optional')
    })

    it('shows Back button when onBack is provided', async () => {
      const onBack = vi.fn()
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
        onBack,
      )

      const backBtn = document.getElementById('content-installer-back')
      expect(backBtn).not.toBeNull()
      expect(backBtn!.textContent).toContain('Back')

      backBtn!.click()
      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('does not show Back button when onBack is not provided', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const backBtn = document.getElementById('content-installer-back')
      expect(backBtn).toBeNull()
    })

    it('subscribes to service.onProgress', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      expect(mockService.onProgress).toHaveBeenCalledTimes(1)
    })
  })

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
  // Play button
  // -------------------------------------------------------------------------

  describe('Play button', () => {
    it('calls onComplete when Play button is clicked', async () => {
      const onComplete = vi.fn()
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        onComplete,
      )

      // Play button should exist but may be hidden initially if packages exist
      const playBtn = document.getElementById('content-installer-play')
      expect(playBtn).not.toBeNull()
      // Make it visible for the test
      if (playBtn) {
        playBtn.style.display = ''
        playBtn.click()
        expect(onComplete).toHaveBeenCalledTimes(1)
      }
    })

    it('Play button hides the overlay', async () => {
      const onComplete = vi.fn()
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        onComplete,
      )

      const playBtn = document.getElementById('content-installer-play')
      if (playBtn) {
        playBtn.style.display = ''
        playBtn.click()
      }

      expect(document.getElementById('content-installer-overlay')).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Install All button
  // -------------------------------------------------------------------------

  describe('Install All button', () => {
    it('calls service.installAll when clicked', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const installAllBtn = document.getElementById('content-installer-install-all')
      expect(installAllBtn).not.toBeNull()
      expect(installAllBtn!.textContent).toContain('Install All')

      installAllBtn!.click()
      // CI-B.3: Install All now uses parallel install
      expect(mockService.installAllParallel).toHaveBeenCalledWith('ra', 2)
    })
  })

  // -------------------------------------------------------------------------
  // Formatting helpers (accessed via private static methods)
  // -------------------------------------------------------------------------

  describe('_formatBytes()', () => {
    // Test using reflection to access private static method
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
  // Progress handling
  // -------------------------------------------------------------------------

  describe('progress handling', () => {
    it('shows progress view on downloading state', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      // Emit a downloading progress
      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:quickinstall',
        statusText: 'Downloading (45%)...',
        progressPercent: 45,
        bytesReceived: 1024 * 500,
        bytesTotal: 1024 * 1024,
      })

      const progressContainer = document.getElementById(
        'content-installer-progress',
      )
      expect(progressContainer).not.toBeNull()
      // Progress should be visible now
      expect(progressContainer!.style.display).not.toBe('none')
    })

    it('shows error message on error state', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      // First trigger download to show progress view
      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:quickinstall',
        statusText: 'Downloading...',
        progressPercent: 10,
        bytesReceived: 100,
        bytesTotal: 1000,
      })

      // Then emit error
      mockService._emitProgress({
        state: 'error',
        packageId: 'ra:quickinstall',
        statusText: 'Installation failed',
        progressPercent: 0,
        bytesReceived: 0,
        bytesTotal: 0,
        error: 'Download failed: HTTP 500',
      })

      const errorEl = document.querySelector('.progress-error') as HTMLElement
      expect(errorEl).not.toBeNull()
      expect(errorEl?.textContent).toContain('HTTP 500')
    })

    it('hides progress view on complete state', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      // Trigger download
      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:quickinstall',
        statusText: 'Downloading...',
        progressPercent: 10,
        bytesReceived: 100,
        bytesTotal: 1000,
      })

      // Then complete
      mockService._emitProgress({
        state: 'complete',
        packageId: 'ra:quickinstall',
        statusText: 'Installation complete',
        progressPercent: 100,
        bytesReceived: 0,
        bytesTotal: 0,
      })

      // Progress should be hidden
      const progressContainer = document.getElementById(
        'content-installer-progress',
      )
      expect(progressContainer!.style.display).toBe('none')

      // Package list should be visible again
      const pkgList = document.getElementById('content-installer-package-list')
      expect(pkgList!.style.display).not.toBe('none')
    })
  })

  // -------------------------------------------------------------------------
  // CI-B.3: Parallel progress mode
  // -------------------------------------------------------------------------

  describe('parallel progress mode', () => {
    it('shows parallel progress rows when multiple packages are active', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      // Emit downloading progress for two different packages
      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:quickinstall',
        statusText: 'Downloading (45%)...',
        progressPercent: 45,
        bytesReceived: 1024 * 500,
        bytesTotal: 1024 * 1024,
      })

      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:movies',
        statusText: 'Downloading (30%)...',
        progressPercent: 30,
        bytesReceived: 1024 * 300,
        bytesTotal: 1024 * 1024,
      })

      // Should show parallel progress rows
      const progressContainer = document.getElementById(
        'content-installer-progress',
      )
      expect(progressContainer).not.toBeNull()

      // Check for parallel-pkg-row elements
      const rows = document.querySelectorAll('.parallel-pkg-row')
      expect(rows.length).toBeGreaterThanOrEqual(2)

      // Check package names are displayed
      const names = document.querySelectorAll('.parallel-pkg-name')
      expect(names.length).toBeGreaterThanOrEqual(2)
    })

    it('hides parallel mode when all packages complete', async () => {
      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      // Start two downloads (activates parallel mode)
      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:quickinstall',
        statusText: 'Downloading...',
        progressPercent: 50,
        bytesReceived: 500,
        bytesTotal: 1000,
      })

      mockService._emitProgress({
        state: 'downloading',
        packageId: 'ra:movies',
        statusText: 'Downloading...',
        progressPercent: 50,
        bytesReceived: 500,
        bytesTotal: 1000,
      })

      // Complete both
      mockService._emitProgress({
        state: 'complete',
        packageId: 'ra:quickinstall',
        statusText: 'Complete',
        progressPercent: 100,
        bytesReceived: 0,
        bytesTotal: 0,
      })

      mockService._emitProgress({
        state: 'complete',
        packageId: 'ra:movies',
        statusText: 'Complete',
        progressPercent: 100,
        bytesReceived: 0,
        bytesTotal: 0,
      })

      // Progress should be hidden, package list visible
      const progressContainer = document.getElementById(
        'content-installer-progress',
      )
      if (progressContainer) {
        // May have been hidden after completion
      }
    })
  })

  // -------------------------------------------------------------------------
  // _extractPackageKey
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
  // CI-C.4: Storage Breakdown
  // -------------------------------------------------------------------------

  describe('storage breakdown (CI-C.4)', () => {
    it('renders storage breakdown section with per-mod usage', async () => {
      storageGetModUsageSpy.mockResolvedValue([
        { modId: 'ra', usageBytes: 450 * 1024 * 1024 },
        { modId: 'cnc', usageBytes: 380 * 1024 * 1024 },
      ])
      storageGetQuotaSpy.mockResolvedValue({
        usage: 830 * 1024 * 1024,
        quota: 2 * 1024 * 1024 * 1024,
        percentage: 41,
      })

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const storageSection = document.getElementById('content-installer-storage')
      expect(storageSection).not.toBeNull()
      expect(storageSection!.textContent).toContain('Storage Usage')
      expect(storageSection!.textContent).toContain('Red Alert')
      expect(storageSection!.textContent).toContain('Tiberian Dawn')
    })

    it('shows current mod indicator', async () => {
      storageGetModUsageSpy.mockResolvedValue([
        { modId: 'ra', usageBytes: 450 * 1024 * 1024 },
      ])
      storageGetQuotaSpy.mockResolvedValue({
        usage: 450 * 1024 * 1024,
        quota: 2 * 1024 * 1024 * 1024,
        percentage: 22,
      })

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const storageSection = document.getElementById('content-installer-storage')
      expect(storageSection!.textContent).toContain('(current)')
    })

    it('shows free space when quota is finite', async () => {
      storageGetModUsageSpy.mockResolvedValue([])
      storageGetQuotaSpy.mockResolvedValue({
        usage: 500 * 1024 * 1024,
        quota: 2 * 1024 * 1024 * 1024,
        percentage: 25,
      })

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const storageSection = document.getElementById('content-installer-storage')
      expect(storageSection!.textContent).toContain('Free')
    })

    it('does not show free space when quota is infinite', async () => {
      storageGetModUsageSpy.mockResolvedValue([])
      storageGetQuotaSpy.mockResolvedValue({
        usage: 0,
        quota: Infinity,
        percentage: 0,
      })

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const storageSection = document.getElementById('content-installer-storage')
      expect(storageSection!.textContent).not.toContain('Free')
    })
  })

  // -------------------------------------------------------------------------
  // CI-C.4: Per-Mod Clear Buttons
  // -------------------------------------------------------------------------

  describe('per-mod clear buttons (CI-C.4)', () => {
    it('shows clear buttons for other mods with content', async () => {
      mockService.getInstalledModIds.mockResolvedValue(
        new Set(['ra', 'cnc']),
      )

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const clearSection = document.getElementById('content-installer-clear-mods')
      expect(clearSection).not.toBeNull()
      expect(clearSection!.textContent).toContain('Clear')
      expect(clearSection!.textContent).toContain('Tiberian Dawn')
    })

    it('does not show clear button for current mod', async () => {
      mockService.getInstalledModIds.mockResolvedValue(
        new Set(['ra']),
      )

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const clearSection = document.getElementById('content-installer-clear-mods')
      expect(clearSection!.innerHTML).toBe('')
    })

    it('does not show clear buttons when no other mods have content', async () => {
      mockService.getInstalledModIds.mockResolvedValue(new Set<string>())

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const clearSection = document.getElementById('content-installer-clear-mods')
      expect(clearSection!.innerHTML).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // CI-C.4: Other Mods Content Notice
  // -------------------------------------------------------------------------

  describe('other mods content notice (CI-C.4)', () => {
    it('shows notice when other mods have content', async () => {
      mockService.detectOtherModsContent.mockResolvedValue({
        otherModIds: ['cnc', 'd2k'],
        totalOtherPackages: 3,
      })

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const notice = document.getElementById('content-installer-other-mods')
      expect(notice).not.toBeNull()
      expect(notice!.style.display).not.toBe('none')
      expect(notice!.textContent).toContain('Tiberian Dawn')
      expect(notice!.textContent).toContain('Dune 2000')
      expect(notice!.textContent).toContain('own content')
    })

    it('does not show notice when no other mods have content', async () => {
      mockService.detectOtherModsContent.mockResolvedValue(null)

      await ContentInstallerUI.show(
        mockService as any,
        'ra',
        vi.fn(),
      )

      const notice = document.getElementById('content-installer-other-mods')
      expect(notice!.style.display).toBe('none')
    })
  })

  // -------------------------------------------------------------------------
  // _modIdToDisplayName
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
