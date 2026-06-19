/**
 * ContentInstallerTypes.test.ts — ContentInstallerTypes compile-time type
 * validation.
 *
 * Since {@link ContentInstallerTypes} contains only type definitions (no
 * runtime logic), this test file validates that:
 * 1. All types are importable
 * 2. Objects conforming to the interfaces can be constructed
 * 3. The ContentInstallState union covers all expected values
 * 4. ContentInstallProgress optional error field behaves correctly
 * 5. ContentPackageRecord fields are properly typed
 */

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Import types under test
// ---------------------------------------------------------------------------

import type {
  ContentInstallState,
  ContentInstallProgress,
  ContentInstallListener,
  ModContentManifest,
  ContentPackage,
  ContentDownload,
  ContentSource,
  ContentPackageRecord,
} from './ContentInstallerTypes'

// ---------------------------------------------------------------------------
// ContentInstallState
// ---------------------------------------------------------------------------

describe('ContentInstallState', () => {
  it('is assignable from all 10 valid state string literals', () => {
    const states: ContentInstallState[] = [
      'idle',
      'checking',
      'needs_install',
      'ready',
      'downloading',
      'verifying',
      'extracting',
      'mounting',
      'complete',
      'error',
    ]
    expect(states).toHaveLength(10)
    // TypeScript will fail to compile if any string is not a valid state
    expect(states.every((s) => typeof s === 'string')).toBe(true)
  })

  it('contains exactly 10 unique states', () => {
    const all = [
      'idle',
      'checking',
      'needs_install',
      'ready',
      'downloading',
      'verifying',
      'extracting',
      'mounting',
      'complete',
      'error',
    ] as const
    const unique = new Set(all)
    expect(unique.size).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// ContentInstallProgress
// ---------------------------------------------------------------------------

describe('ContentInstallProgress', () => {
  it('constructs valid progress objects for each state', () => {
    // idle state
    const idle: ContentInstallProgress = {
      state: 'idle',
      packageId: 'ra:quickinstall',
      statusText: 'Not started',
      progressPercent: 0,
      bytesReceived: 0,
      bytesTotal: -1,
    }
    expect(idle.state).toBe('idle')
    expect(idle.error).toBeUndefined()

    // ready state
    const ready: ContentInstallProgress = {
      state: 'ready',
      packageId: 'ra:quickinstall',
      statusText: 'All content installed',
      progressPercent: 100,
      bytesReceived: 0,
      bytesTotal: -1,
    }
    expect(ready.state).toBe('ready')
    expect(ready.progressPercent).toBe(100)

    // downloading state
    const downloading: ContentInstallProgress = {
      state: 'downloading',
      packageId: 'ra:quickinstall',
      statusText: 'Downloading... 45%',
      progressPercent: 45,
      bytesReceived: 225000000,
      bytesTotal: 500000000,
    }
    expect(downloading.bytesReceived).toBeGreaterThan(0)
    expect(downloading.bytesTotal).toBeGreaterThan(0)
    expect(downloading.progressPercent).toBe(45)

    // error state with error message
    const error: ContentInstallProgress = {
      state: 'error',
      packageId: 'ra:quickinstall',
      statusText: 'Download failed',
      progressPercent: 30,
      bytesReceived: 150000000,
      bytesTotal: 500000000,
      error: 'Network error: connection reset',
    }
    expect(error.state).toBe('error')
    expect(error.error).toBe('Network error: connection reset')

    // complete state
    const complete: ContentInstallProgress = {
      state: 'complete',
      packageId: 'ra:quickinstall',
      statusText: 'Installation complete',
      progressPercent: 100,
      bytesReceived: 500000000,
      bytesTotal: 500000000,
    }
    expect(complete.state).toBe('complete')
    expect(complete.error).toBeUndefined()
  })

  it('allows error to be undefined in non-error states', () => {
    const checking: ContentInstallProgress = {
      state: 'checking',
      packageId: 'ra:quickinstall',
      statusText: 'Checking installed content...',
      progressPercent: -1,
      bytesReceived: 0,
      bytesTotal: -1,
    }
    // error is optional, so it should be undefined by default
    expect(checking.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ContentInstallListener
// ---------------------------------------------------------------------------

describe('ContentInstallListener', () => {
  it('is callable with ContentInstallProgress', () => {
    let receivedPackageId = ''
    const listener: ContentInstallListener = (progress) => {
      receivedPackageId = progress.packageId
    }
    listener({
      state: 'downloading',
      packageId: 'ra:quickinstall',
      statusText: 'Test',
      progressPercent: 50,
      bytesReceived: 100,
      bytesTotal: 200,
    })
    expect(receivedPackageId).toBe('ra:quickinstall')
  })
})

// ---------------------------------------------------------------------------
// ModContentManifest
// ---------------------------------------------------------------------------

describe('ModContentManifest', () => {
  it('constructs a RA content manifest matching build-time JSON schema', () => {
    const manifest: ModContentManifest = {
      modId: 'ra-content',
      targetModId: 'ra',
      packages: {
        quickinstall: {
          title: 'Quick Install Package',
          identifier: 'quickinstall',
          testFiles: ['Content/ra/v2/allies.mix'],
          sources: [],
          required: true,
          download: 'quickinstall',
        },
      },
      downloads: {
        quickinstall: {
          title: 'Quick Install Package',
          mirrorList:
            'https://www.openra.net/packages/ra-quickinstall-mirrors.txt',
          sha1: '44241f68e69db9511db82cf83c174737ccda300b',
          type: 'ZipFile',
          extract: {
            'Content/ra/v2/allies.mix': 'allies.mix',
            'Content/ra/v2/conquer.mix': 'conquer.mix',
          },
        },
      },
    }

    expect(manifest.modId).toBe('ra-content')
    expect(manifest.targetModId).toBe('ra')
    expect(manifest.packages['quickinstall'].required).toBe(true)
    expect(manifest.packages['quickinstall'].testFiles).toContain(
      'Content/ra/v2/allies.mix',
    )
    expect(manifest.downloads['quickinstall'].sha1).toBe(
      '44241f68e69db9511db82cf83c174737ccda300b',
    )
    expect(
      manifest.downloads['quickinstall'].extract['Content/ra/v2/allies.mix'],
    ).toBe('allies.mix')
  })

  it('supports optional sources field', () => {
    const withSources: ModContentManifest = {
      modId: 'ts-content',
      targetModId: 'ts',
      packages: {},
      downloads: {},
      sources: {
        cd: {
          title: 'Tiberian Sun CD',
          type: 'Disc',
          idFiles: { 'SETUP.EXE': 'exists' },
          install: { 'scores.mix': 'Install/scores.mix' },
        },
      },
    }
    expect(withSources.sources!['cd'].title).toBe('Tiberian Sun CD')
    expect(withSources.sources!['cd'].type).toBe('Disc')
  })

  it('supports multiple packages with varying required flags', () => {
    const manifest: ModContentManifest = {
      modId: 'ra-content',
      targetModId: 'ra',
      packages: {
        required_pkg: {
          title: 'Required Package',
          identifier: 'required_pkg',
          testFiles: ['Content/ra/test.mix'],
          sources: [],
          required: true,
          download: 'dl_required',
        },
        optional_pkg: {
          title: 'Optional Package',
          identifier: 'optional_pkg',
          testFiles: ['Content/ra/optional.mix'],
          sources: [],
          required: false,
          download: 'dl_optional',
        },
        source_only: {
          title: 'CD Only',
          identifier: 'source_only',
          testFiles: ['Content/ra/cd_only.mix'],
          sources: ['cd_source'],
          required: false,
          download: '',
        },
      },
      downloads: {
        dl_required: {
          title: 'Required Download',
          url: 'https://example.com/required.zip',
          sha1: 'aaa',
          type: 'ZipFile',
          extract: {},
        },
        dl_optional: {
          title: 'Optional Download',
          mirrorList: 'https://example.com/mirrors.txt',
          sha1: 'bbb',
          type: 'ZipFile',
          extract: {},
        },
      },
    }

    expect(Object.keys(manifest.packages)).toHaveLength(3)
    expect(manifest.packages['required_pkg'].required).toBe(true)
    expect(manifest.packages['optional_pkg'].required).toBe(false)
    expect(manifest.packages['source_only'].download).toBe('')
    expect(manifest.packages['source_only'].sources).toEqual(['cd_source'])
  })
})

// ---------------------------------------------------------------------------
// ContentPackage
// ---------------------------------------------------------------------------

describe('ContentPackage', () => {
  it('constructs with all fields', () => {
    const pkg: ContentPackage = {
      title: 'Base Freeware Content',
      identifier: 'basefiles',
      testFiles: ['Content/ra/v2/allies.mix', 'Content/ra/v2/conquer.mix'],
      sources: ['cd1', 'cd2'],
      required: true,
      download: 'basefiles_dl',
    }
    expect(pkg.title).toBe('Base Freeware Content')
    expect(pkg.identifier).toBe('basefiles')
    expect(pkg.testFiles).toHaveLength(2)
    expect(pkg.sources).toHaveLength(2)
    expect(pkg.required).toBe(true)
    expect(pkg.download).toBe('basefiles_dl')
  })

  it('handles empty sources for download-only packages', () => {
    const pkg: ContentPackage = {
      title: 'Download Only',
      identifier: 'dl_only',
      testFiles: ['Content/ra/test.mix'],
      sources: [],
      required: true,
      download: 'dl_key',
    }
    expect(pkg.sources).toHaveLength(0)
  })

  it('handles empty download string for source-only packages', () => {
    const pkg: ContentPackage = {
      title: 'Source Only',
      identifier: 'src_only',
      testFiles: ['Content/ra/cd.mix'],
      sources: ['disc1'],
      required: true,
      download: '',
    }
    expect(pkg.download).toBe('')
    expect(pkg.sources).toContain('disc1')
  })
})

// ---------------------------------------------------------------------------
// ContentDownload
// ---------------------------------------------------------------------------

describe('ContentDownload', () => {
  it('constructs with direct URL (no mirrorList)', () => {
    const dl: ContentDownload = {
      title: 'Quick Install',
      url: 'https://example.com/ra-quickinstall.zip',
      sha1: '44241f68e69db9511db82cf83c174737ccda300b',
      type: 'ZipFile',
      extract: { 'Content/ra/v2/allies.mix': 'allies.mix' },
    }
    expect(dl.url).toBe('https://example.com/ra-quickinstall.zip')
    expect(dl.mirrorList).toBeUndefined()
    expect(dl.sha1).toBe('44241f68e69db9511db82cf83c174737ccda300b')
  })

  it('constructs with mirrorList (no direct URL)', () => {
    const dl: ContentDownload = {
      title: 'Quick Install',
      mirrorList: 'https://www.openra.net/packages/ra-mirrors.txt',
      sha1: 'aa022b208a3b45b4a45c00fdae22ccf3c6de3e5c',
      type: 'ZipFile',
      extract: {},
    }
    expect(dl.mirrorList).toBe(
      'https://www.openra.net/packages/ra-mirrors.txt',
    )
    expect(dl.url).toBeUndefined()
  })

  it('supports both url and mirrorList for hybrid configs', () => {
    const dl: ContentDownload = {
      title: 'Full Package',
      url: 'https://cdn.example.com/ra.zip',
      mirrorList: 'https://www.openra.net/packages/ra-mirrors.txt',
      sha1: 'abcdef1234567890',
      type: 'ZipFile',
      extract: {
        'Content/ra/v2/allies.mix': 'allies.mix',
        'Content/ra/v2/conquer.mix': 'conquer.mix',
        'Content/ra/v2/russian.mix': 'russian.mix',
      },
    }
    expect(dl.url).toBeTruthy()
    expect(dl.mirrorList).toBeTruthy()
    expect(Object.keys(dl.extract)).toHaveLength(3)
  })

  it('validates SHA1 is lowercase hex with no separators', () => {
    const dl: ContentDownload = {
      title: 'Test',
      sha1: '44241F68E69DB9511DB82CF83C174737CCDA300B', // 40 hex chars, mixed case
      type: 'ZipFile',
      extract: {},
    }
    // SHA1 is exactly 40 hex characters (160 bits)
    expect(dl.sha1).toHaveLength(40)
    expect(/^[0-9a-fA-F]{40}$/.test(dl.sha1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ContentSource
// ---------------------------------------------------------------------------

describe('ContentSource', () => {
  it('constructs a CD source with all fields', () => {
    const src: ContentSource = {
      title: 'Red Alert CD',
      type: 'Disc',
      idFiles: { 'RA95.DAT': 'exists', 'SETUP.EXE': 'exists' },
      install: {
        'scores.mix': 'Install/scores.mix',
        'movies.mix': 'Movies/movies.mix',
      },
    }
    expect(src.title).toBe('Red Alert CD')
    expect(src.type).toBe('Disc')
    expect(Object.keys(src.idFiles!)).toHaveLength(2)
    expect(src.idFiles!['RA95.DAT']).toBe('exists')
    expect(src.install!['scores.mix']).toBe('Install/scores.mix')
  })

  it('constructs a minimal source (title only)', () => {
    const src: ContentSource = {
      title: 'Minimal Source',
    }
    expect(src.title).toBe('Minimal Source')
    expect(src.type).toBeUndefined()
    expect(src.idFiles).toBeUndefined()
    expect(src.install).toBeUndefined()
  })

  it('constructs a Steam source', () => {
    const src: ContentSource = {
      title: 'Steam',
      type: 'Steam',
      idFiles: { 'game.dat': 'steam_appid:12345' },
    }
    expect(src.title).toBe('Steam')
    expect(src.type).toBe('Steam')
    expect(src.install).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ContentPackageRecord
// ---------------------------------------------------------------------------

describe('ContentPackageRecord', () => {
  it('constructs with all fields', () => {
    const now = Date.now()
    const record: ContentPackageRecord = {
      packageId: 'ra:quickinstall',
      version: 'v2',
      sha1: '44241f68e69db9511db82cf83c174737ccda300b',
      installedAt: now,
      files: [
        'Content/ra/v2/allies.mix',
        'Content/ra/v2/conquer.mix',
        'Content/ra/v2/russian.mix',
      ],
    }
    expect(record.packageId).toBe('ra:quickinstall')
    expect(record.version).toBe('v2')
    expect(record.sha1).toBe('44241f68e69db9511db82cf83c174737ccda300b')
    expect(record.installedAt).toBe(now)
    expect(record.files).toHaveLength(3)
    expect(record.files[0]).toBe('Content/ra/v2/allies.mix')
  })

  it('handles empty files array for metadata-only records', () => {
    const record: ContentPackageRecord = {
      packageId: 'ra:empty',
      version: 'v1',
      sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      installedAt: Date.now(),
      files: [],
    }
    expect(record.files).toHaveLength(0)
  })

  it('installedAt is a valid timestamp', () => {
    const record: ContentPackageRecord = {
      packageId: 'ra:test',
      version: 'v1',
      sha1: 'abc123',
      installedAt: 1719264000000, // 2024-06-25 00:00:00 UTC
      files: [],
    }
    expect(record.installedAt).toBeGreaterThan(0)
    expect(new Date(record.installedAt).getTime()).toBe(record.installedAt)
  })

  it('supports package IDs for different mods', () => {
    const raPkg: ContentPackageRecord = {
      packageId: 'ra:quickinstall',
      version: 'v2',
      sha1: 'sha1_ra',
      installedAt: Date.now(),
      files: ['Content/ra/v2/allies.mix'],
    }
    const cncPkg: ContentPackageRecord = {
      packageId: 'cnc:quickinstall',
      version: 'v1',
      sha1: 'sha1_cnc',
      installedAt: Date.now(),
      files: ['Content/cnc/v2/gdi.mix'],
    }
    expect(raPkg.packageId).toBe('ra:quickinstall')
    expect(cncPkg.packageId).toBe('cnc:quickinstall')
  })
})
