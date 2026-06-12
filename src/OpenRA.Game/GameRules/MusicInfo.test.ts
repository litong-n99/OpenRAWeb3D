/**
 * MusicInfo.test.ts — MusicInfo migration unit tests
 *
 * MusicInfo is pure logic with no GPU/web dependencies.
 * No Babylon.js mocking required.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { MusicInfo } from './MusicInfo.js'
import type { IReadOnlyFileSystem } from '../FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFileSystem(
  files: Record<string, ArrayBuffer | null>,
): IReadOnlyFileSystem {
  return {
    openAsync: vi.fn(async (filename: string) => {
      return files[filename] ?? null
    }),
    exists: (filename: string) => filename in files,
    isMounted: () => false,
  }
}

// ---------------------------------------------------------------------------
// fromJSON() tests
// ---------------------------------------------------------------------------

describe('MusicInfo.fromJSON', () => {
  it('extracts Title from json.Value (matching C# value.Value)', () => {
    const info = MusicInfo.fromJSON('bigf226m', {
      Value: 'Hell March',
    })

    expect(info.title).toBe('Hell March')
  })

  it('falls back to json.Title when Value is missing', () => {
    const info = MusicInfo.fromJSON('track01', {
      Title: 'My Track',
    })

    expect(info.title).toBe('My Track')
  })

  it('falls back to key when both Value and Title are missing', () => {
    const info = MusicInfo.fromJSON('track12', {})

    expect(info.title).toBe('track12')
  })

  it('parses Hidden as boolean true', () => {
    const info = MusicInfo.fromJSON('track', {
      Hidden: true,
    })

    expect(info.hidden).toBe(true)
  })

  it('parses Hidden as boolean false', () => {
    const info = MusicInfo.fromJSON('track', {
      Hidden: false,
    })

    expect(info.hidden).toBe(false)
  })

  it('parses Hidden from string "true"', () => {
    const info = MusicInfo.fromJSON('track', {
      Hidden: 'true',
    })

    expect(info.hidden).toBe(true)
  })

  it('parses Hidden from string "True" (case insensitive)', () => {
    const info = MusicInfo.fromJSON('track', {
      Hidden: 'True',
    })

    expect(info.hidden).toBe(true)
  })

  it('defaults Hidden to false when absent', () => {
    const info = MusicInfo.fromJSON('track', {})

    expect(info.hidden).toBe(false)
  })

  it('parses VolumeModifier as number', () => {
    const info = MusicInfo.fromJSON('track', {
      VolumeModifier: 0.5,
    })

    expect(info.volumeModifier).toBe(0.5)
  })

  it('defaults VolumeModifier to 1.0 when absent', () => {
    const info = MusicInfo.fromJSON('track', {})

    expect(info.volumeModifier).toBe(1.0)
  })

  it('composes Filename from key + default extension', () => {
    const info = MusicInfo.fromJSON('hellmarch', {})

    expect(info.filename).toBe('hellmarch.aud')
  })

  it('composes Filename from key + custom extension', () => {
    const info = MusicInfo.fromJSON('hellmarch', {
      Extension: 'mp3',
    })

    expect(info.filename).toBe('hellmarch.mp3')
  })

  it('uses explicit Filename when provided', () => {
    const info = MusicInfo.fromJSON('key', {
      Filename: 'custom_music',
      Extension: 'wav',
    })

    expect(info.filename).toBe('custom_music.wav')
  })

  it('does not append extension when Filename already has one', () => {
    const info = MusicInfo.fromJSON('key', {
      Filename: 'music.ogg',
      Extension: 'aud',
    })

    expect(info.filename).toBe('music.ogg')
  })

  it('initializes length and exists to false', () => {
    const info = MusicInfo.fromJSON('track', { Title: 'Test' })

    expect(info.length).toBe(0)
    expect(info.exists).toBe(false)
  })

  it('defaults extension to "aud" when not specified', () => {
    const info = MusicInfo.fromJSON('track', {
      Filename: 'myfile',
    })

    expect(info.filename).toBe('myfile.aud')
  })
})

// ---------------------------------------------------------------------------
// load() tests
// ---------------------------------------------------------------------------

describe('MusicInfo.load', () => {
  it('sets exists=false when file is not in file system', () => {
    const info = MusicInfo.fromJSON('missing_track', {})
    const fs = createMockFileSystem({})

    info.load(fs)

    expect(info.exists).toBe(false)
    expect(info.length).toBe(0)
  })

  it('sets exists=true when file is found in file system', () => {
    const info = MusicInfo.fromJSON('track', {
      Filename: 'music',
      Extension: 'aud',
    })
    const fs = createMockFileSystem({
      'music.aud': new ArrayBuffer(0),
    })

    info.load(fs)

    expect(info.exists).toBe(true)
  })

  it('sets length=0 after load (TODO-8.C.DEFER-3)', () => {
    const info = MusicInfo.fromJSON('track', {
      Filename: 'music',
    })
    const fs = createMockFileSystem({
      'music.aud': new ArrayBuffer(1024),
    })

    info.load(fs)

    // TODO-8.C.DEFER-3: Length should be set from audio format
    expect(info.length).toBe(0)
    expect(info.exists).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// loadAsync() tests
// ---------------------------------------------------------------------------

describe('MusicInfo.loadAsync', () => {
  it('sets exists=false when file cannot be opened', async () => {
    const info = MusicInfo.fromJSON('missing', { Filename: 'nope' })
    const fs = createMockFileSystem({})

    await info.loadAsync(fs)

    expect(info.exists).toBe(false)
  })

  it('sets exists=true when file is opened successfully', async () => {
    const info = MusicInfo.fromJSON('exists', {
      Filename: 'good',
      Extension: 'aud',
    })
    const fs = createMockFileSystem({
      'good.aud': new ArrayBuffer(16),
    })

    await info.loadAsync(fs)

    expect(info.exists).toBe(true)
  })

  it('sets exists=false when openAsync throws', async () => {
    const info = MusicInfo.fromJSON('error', { Filename: 'bad' })
    const fs: IReadOnlyFileSystem = {
      openAsync: vi.fn(async () => { throw new Error('Access denied') }),
      exists: () => true,
      isMounted: () => false,
    }

    await info.loadAsync(fs)

    expect(info.exists).toBe(false)
  })
})
