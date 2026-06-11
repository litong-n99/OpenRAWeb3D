/**
 * Manifest.test.ts — Manifest migration unit tests
 *
 * Tests focus on: JSON parsing (full/minimal), field defaults,
 * dependency validation (satisfied, missing, cyclic, transitive),
 * globalModData collection, and RendererConstants defaults.
 */

import { describe, it, expect } from 'vitest'
import { Manifest } from './Manifest.js'

// ---------------------------------------------------------------------------
// Helper: build a reference mod.json object
// ---------------------------------------------------------------------------

function buildReferenceModJSON(): Record<string, unknown> {
  return {
    Metadata: {
      Title: 'Test Mod',
      Version: '2.0',
      Author: 'Test Author',
      Description: 'A test mod for unit tests',
      Website: 'https://example.com',
      WindowTitle: 'Test Window',
      Hidden: true,
    },
    RequiresMods: ['base', 'cnc'],
    FileSystem: {
      '$modid': 'testmod.mix',
      '~^content/cnc': '',
    },
    MapFolders: {
      release: 'maps/release',
      community: 'maps/community',
    },
    Rules: ['rules/default.yaml', 'rules/vehicles.yaml'],
    Sequences: ['sequences/units.yaml', 'sequences/buildings.yaml'],
    ModelSequences: ['mdlseq/units.yaml'],
    Cursors: ['cursors/default.yaml'],
    Chrome: ['chrome/main.yaml'],
    ChromeLayout: ['chrome/layouts.yaml'],
    Weapons: ['weapons/small.yaml', 'weapons/large.yaml'],
    Voices: ['voices/default.yaml'],
    Notifications: ['notifications/default.yaml'],
    Music: ['music/default.yaml'],
    FluentMessages: ['fluent/en.ftl'],
    TileSets: ['tilesets/temperate.yaml'],
    ChromeMetrics: ['metrics.yaml'],
    Missions: ['missions/campaign1.yaml'],
    Hotkeys: ['hotkeys/default.yaml'],
    ServerTraits: ['traits/server.yaml'],
    SupportsMapsFrom: 'cnc, ra',
    LoadScreen: { type: 'ModChooserLoadScreen', image: 'load.png' },
    DefaultOrderGenerator: 'UnitOrderGenerator',
    RendererConstants: {
      FontSheetSize: 1024,
      CursorSheetSize: 1024,
      MapPreviewSheetSize: 4096,
      SequenceBgraSheetSize: 4096,
      SequenceIndexedSheetSize: 4096,
      VertexBatchSize: 16384,
    },
    PackageFormats: ['folder', 'zip'],
    // Unrecognized keys → globalModData
    CustomGlobalSettings: { enableFeatureX: true, maxPlayers: 8 },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Manifest', () => {
  // -----------------------------------------------------------------------
  // Full JSON parsing
  // -----------------------------------------------------------------------

  describe('constructor — full JSON', () => {
    const manifest = new Manifest('testmod', buildReferenceModJSON())

    it('stores id', () => {
      expect(manifest.id).toBe('testmod')
    })

    it('parses all metadata fields', () => {
      expect(manifest.metadata.title).toBe('Test Mod')
      expect(manifest.metadata.version).toBe('2.0')
      expect(manifest.metadata.author).toBe('Test Author')
      expect(manifest.metadata.description).toBe('A test mod for unit tests')
      expect(manifest.metadata.website).toBe('https://example.com')
      expect(manifest.metadata.windowTitle).toBe('Test Window')
      expect(manifest.metadata.hidden).toBe(true)
    })

    it('parses RequiresMods', () => {
      expect(manifest.requiresMods).toEqual(['base', 'cnc'])
    })

    it('parses FileSystem into mounts (keys)', () => {
      expect(manifest.mounts).toEqual(['$modid', '~^content/cnc'])
    })

    it('parses MapFolders into Map', () => {
      expect(manifest.mapFolders.size).toBe(2)
      expect(manifest.mapFolders.get('release')).toBe('maps/release')
      expect(manifest.mapFolders.get('community')).toBe('maps/community')
    })

    it('parses all resource lists', () => {
      expect(manifest.rules).toEqual(['rules/default.yaml', 'rules/vehicles.yaml'])
      expect(manifest.sequences).toEqual([
        'sequences/units.yaml',
        'sequences/buildings.yaml',
      ])
      expect(manifest.modelSequences).toEqual(['mdlseq/units.yaml'])
      expect(manifest.cursors).toEqual(['cursors/default.yaml'])
      expect(manifest.chrome).toEqual(['chrome/main.yaml'])
      expect(manifest.chromeLayout).toEqual(['chrome/layouts.yaml'])
      expect(manifest.weapons).toEqual(['weapons/small.yaml', 'weapons/large.yaml'])
      expect(manifest.voices).toEqual(['voices/default.yaml'])
      expect(manifest.notifications).toEqual(['notifications/default.yaml'])
      expect(manifest.music).toEqual(['music/default.yaml'])
      expect(manifest.fluentMessages).toEqual(['fluent/en.ftl'])
      expect(manifest.tileSets).toEqual(['tilesets/temperate.yaml'])
      expect(manifest.chromeMetrics).toEqual(['metrics.yaml'])
      expect(manifest.missions).toEqual(['missions/campaign1.yaml'])
      expect(manifest.hotkeys).toEqual(['hotkeys/default.yaml'])
      expect(manifest.serverTraits).toEqual(['traits/server.yaml'])
    })

    it('parses mapCompatibility including self id', () => {
      expect(manifest.mapCompatibility).toEqual(['testmod', 'cnc', 'ra'])
    })

    it('parses LoadScreen', () => {
      expect(manifest.loadScreen).toEqual({
        type: 'ModChooserLoadScreen',
        image: 'load.png',
      })
    })

    it('parses DefaultOrderGenerator', () => {
      expect(manifest.defaultOrderGenerator).toBe('UnitOrderGenerator')
    })

    it('parses RendererConstants with custom values', () => {
      expect(manifest.rendererConstants.fontSheetSize).toBe(1024)
      expect(manifest.rendererConstants.cursorSheetSize).toBe(1024)
      expect(manifest.rendererConstants.mapPreviewSheetSize).toBe(4096)
      expect(manifest.rendererConstants.sequenceBgraSheetSize).toBe(4096)
      expect(manifest.rendererConstants.sequenceIndexedSheetSize).toBe(4096)
      expect(manifest.rendererConstants.vertexBatchSize).toBe(16384)
    })

    it('parses PackageFormats', () => {
      expect(manifest.packageFormats).toEqual(['folder', 'zip'])
    })

    it('collects unrecognized keys into globalModData', () => {
      expect(manifest.globalModData.has('CustomGlobalSettings')).toBe(true)
      expect(manifest.globalModData.get('CustomGlobalSettings')).toEqual({
        enableFeatureX: true,
        maxPlayers: 8,
      })
    })

    it('excludes reserved keys from globalModData', () => {
      // All known keys should be excluded
      const reservedKeys = [
        'Metadata',
        'RequiresMods',
        'FileSystem',
        'MapFolders',
        'Rules',
        'Sequences',
      ]
      for (const key of reservedKeys) {
        expect(manifest.globalModData.has(key)).toBe(false)
      }
    })
  })

  // -----------------------------------------------------------------------
  // Minimal JSON parsing (defaults)
  // -----------------------------------------------------------------------

  describe('constructor — minimal JSON', () => {
    const manifest = new Manifest('minimal', {})

    it('stores id', () => {
      expect(manifest.id).toBe('minimal')
    })

    it('defaults metadata title to id and version to "1.0"', () => {
      expect(manifest.metadata.title).toBe('minimal')
      expect(manifest.metadata.version).toBe('1.0')
      expect(manifest.metadata.author).toBeUndefined()
      expect(manifest.metadata.description).toBeUndefined()
      expect(manifest.metadata.website).toBeUndefined()
      expect(manifest.metadata.windowTitle).toBeUndefined()
      expect(manifest.metadata.hidden).toBeUndefined()
    })

    it('defaults requiresMods to empty array', () => {
      expect(manifest.requiresMods).toEqual([])
    })

    it('defaults mounts to empty array when FileSystem is missing', () => {
      expect(manifest.mounts).toEqual([])
    })

    it('defaults MapFolders to empty Map', () => {
      expect(manifest.mapFolders.size).toBe(0)
    })

    it('defaults all resource lists to empty arrays', () => {
      expect(manifest.rules).toEqual([])
      expect(manifest.sequences).toEqual([])
      expect(manifest.modelSequences).toEqual([])
      expect(manifest.cursors).toEqual([])
      expect(manifest.chrome).toEqual([])
      expect(manifest.chromeLayout).toEqual([])
      expect(manifest.weapons).toEqual([])
      expect(manifest.voices).toEqual([])
      expect(manifest.notifications).toEqual([])
      expect(manifest.music).toEqual([])
      expect(manifest.fluentMessages).toEqual([])
      expect(manifest.tileSets).toEqual([])
      expect(manifest.chromeMetrics).toEqual([])
      expect(manifest.missions).toEqual([])
      expect(manifest.hotkeys).toEqual([])
      expect(manifest.serverTraits).toEqual([])
    })

    it('defaults mapCompatibility to [id]', () => {
      expect(manifest.mapCompatibility).toEqual(['minimal'])
    })

    it('defaults LoadScreen to null', () => {
      expect(manifest.loadScreen).toBeNull()
    })

    it('defaults DefaultOrderGenerator to null', () => {
      expect(manifest.defaultOrderGenerator).toBeNull()
    })

    it('defaults RendererConstants to OpenRA defaults', () => {
      expect(manifest.rendererConstants.fontSheetSize).toBe(512)
      expect(manifest.rendererConstants.cursorSheetSize).toBe(512)
      expect(manifest.rendererConstants.mapPreviewSheetSize).toBe(2048)
      expect(manifest.rendererConstants.sequenceBgraSheetSize).toBe(2048)
      expect(manifest.rendererConstants.sequenceIndexedSheetSize).toBe(2048)
      expect(manifest.rendererConstants.vertexBatchSize).toBe(8192)
    })

    it('defaults PackageFormats to empty array', () => {
      expect(manifest.packageFormats).toEqual([])
    })

    it('defaults globalModData to empty Map', () => {
      expect(manifest.globalModData.size).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Partial metadata
  // -----------------------------------------------------------------------

  describe('constructor — partial metadata', () => {
    const manifest = new Manifest('partial', {
      Metadata: { Title: 'Only Title' },
    })

    it('gets specified metadata fields', () => {
      expect(manifest.metadata.title).toBe('Only Title')
      expect(manifest.metadata.version).toBe('1.0') // default
    })
  })

  // -----------------------------------------------------------------------
  // Metadata non-object edge cases (Fix 1 & 3)
  // -----------------------------------------------------------------------

  describe('Metadata — non-object produces defaults', () => {
    it('handles Metadata as string without crash', () => {
      const m = new Manifest('mod', { Metadata: 'not-an-object' })
      expect(m.metadata.title).toBe('mod') // defaults to id
      expect(m.metadata.version).toBe('1.0')
      expect(m.metadata.author).toBeUndefined()
    })

    it('handles Metadata as number without crash', () => {
      const m = new Manifest('mod', { Metadata: 123 })
      expect(m.metadata.title).toBe('mod')
      expect(m.metadata.version).toBe('1.0')
    })

    it('handles Metadata as array without crash', () => {
      const m = new Manifest('mod', { Metadata: [1, 2, 3] })
      expect(m.metadata.title).toBe('mod')
      expect(m.metadata.version).toBe('1.0')
    })

    it('handles Metadata as null without crash', () => {
      const m = new Manifest('mod', { Metadata: null })
      expect(m.metadata.title).toBe('mod')
      expect(m.metadata.version).toBe('1.0')
    })

    it('Hidden as string "false" is parsed as false', () => {
      const m = new Manifest('mod', {
        Metadata: { Title: 'T', Version: '1', Hidden: 'false' },
      })
      expect(m.metadata.hidden).toBe(false)
    })

    it('Hidden as string "true" is parsed as true', () => {
      const m = new Manifest('mod', {
        Metadata: { Title: 'T', Version: '1', Hidden: 'true' },
      })
      expect(m.metadata.hidden).toBe(true)
    })

    it('Hidden as non-boolean non-string converts to false', () => {
      const m = new Manifest('mod', {
        Metadata: { Title: 'T', Version: '1', Hidden: 1 },
      })
      expect(m.metadata.hidden).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // MapFolders edge cases (Fix 4)
  // -----------------------------------------------------------------------

  describe('MapFolders parsing', () => {
    it('skips null values gracefully', () => {
      const m = new Manifest('mod', {
        MapFolders: { valid: 'path/ok', bad: null },
      })
      expect(m.mapFolders.size).toBe(1)
      expect(m.mapFolders.get('valid')).toBe('path/ok')
      expect(m.mapFolders.has('bad')).toBe(false)
    })

    it('skips object values gracefully', () => {
      const m = new Manifest('mod', {
        MapFolders: { valid: 'path/ok', bad: { nested: 'value' } },
      })
      expect(m.mapFolders.size).toBe(1)
      expect(m.mapFolders.get('valid')).toBe('path/ok')
      expect(m.mapFolders.has('bad')).toBe(false)
    })

    it('skips array values gracefully', () => {
      const m = new Manifest('mod', {
        MapFolders: { valid: 'path/ok', bad: ['item1', 'item2'] },
      })
      expect(m.mapFolders.size).toBe(1)
      expect(m.mapFolders.has('bad')).toBe(false)
    })

    it('accepts numeric values and coerces to string', () => {
      const m = new Manifest('mod', {
        MapFolders: { depth: 3 },
      })
      expect(m.mapFolders.get('depth')).toBe('3')
    })
  })

  // -----------------------------------------------------------------------
  // SupportsMapsFrom edge cases
  // -----------------------------------------------------------------------

  describe('SupportsMapsFrom parsing', () => {
    it('handles single value', () => {
      const m = new Manifest('mod', { SupportsMapsFrom: 'ra' })
      expect(m.mapCompatibility).toEqual(['mod', 'ra'])
    })

    it('handles empty string', () => {
      const m = new Manifest('mod', { SupportsMapsFrom: '' })
      expect(m.mapCompatibility).toEqual(['mod'])
    })

    it('handles comma with whitespace', () => {
      const m = new Manifest('mod', {
        SupportsMapsFrom: '  cnc  ,  ra  ,  d2k  ',
      })
      expect(m.mapCompatibility).toEqual(['mod', 'cnc', 'ra', 'd2k'])
    })

    it('handles non-string gracefully', () => {
      const m = new Manifest('mod', { SupportsMapsFrom: 123 })
      expect(m.mapCompatibility).toEqual(['mod'])
    })
  })

  // -----------------------------------------------------------------------
  // LoadScreen parsing
  // -----------------------------------------------------------------------

  describe('LoadScreen parsing', () => {
    it('parses object', () => {
      const m = new Manifest('mod', {
        LoadScreen: { type: 'Test', bg: 'bg.png' },
      })
      expect(m.loadScreen).toEqual({ type: 'Test', bg: 'bg.png' })
    })

    it('defaults null for non-object', () => {
      expect(new Manifest('mod', { LoadScreen: 'string' }).loadScreen).toBeNull()
      expect(new Manifest('mod', { LoadScreen: 123 }).loadScreen).toBeNull()
      expect(new Manifest('mod', {}).loadScreen).toBeNull()
    })

    it('defaults null for array', () => {
      const m = new Manifest('mod', {
        LoadScreen: [{ type: 'One' }, { type: 'Two' }],
      })
      expect(m.loadScreen).toBeNull()
    })

    it('defaults null for null', () => {
      const m = new Manifest('mod', { LoadScreen: null })
      expect(m.loadScreen).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // DefaultOrderGenerator parsing
  // -----------------------------------------------------------------------

  describe('DefaultOrderGenerator parsing', () => {
    it('parses string', () => {
      const m = new Manifest('mod', {
        DefaultOrderGenerator: 'MyGenerator',
      })
      expect(m.defaultOrderGenerator).toBe('MyGenerator')
    })

    it('defaults null for non-string', () => {
      expect(
        new Manifest('mod', { DefaultOrderGenerator: 123 }).defaultOrderGenerator,
      ).toBeNull()
      expect(
        new Manifest('mod', {}).defaultOrderGenerator,
      ).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // RendererConstants partial
  // -----------------------------------------------------------------------

  describe('RendererConstants partial', () => {
    it('applies partial overrides with defaults for missing', () => {
      const m = new Manifest('mod', {
        RendererConstants: { FontSheetSize: 256 },
      })
      expect(m.rendererConstants.fontSheetSize).toBe(256)
      expect(m.rendererConstants.cursorSheetSize).toBe(512) // default
      expect(m.rendererConstants.mapPreviewSheetSize).toBe(2048)
    })

    it('handles string integer values', () => {
      const m = new Manifest('mod', {
        RendererConstants: { FontSheetSize: '1024', VertexBatchSize: '4096' },
      })
      expect(m.rendererConstants.fontSheetSize).toBe(1024)
      expect(m.rendererConstants.vertexBatchSize).toBe(4096)
    })

    it('ignores non-numeric values', () => {
      const m = new Manifest('mod', {
        RendererConstants: { FontSheetSize: 'abc' },
      })
      expect(m.rendererConstants.fontSheetSize).toBe(512) // falls back to default
    })

    it('preserves zero values as-is', () => {
      const m = new Manifest('mod', {
        RendererConstants: { FontSheetSize: 0, VertexBatchSize: 0 },
      })
      expect(m.rendererConstants.fontSheetSize).toBe(0)
      expect(m.rendererConstants.vertexBatchSize).toBe(0)
    })

    it('preserves negative values as-is', () => {
      const m = new Manifest('mod', {
        RendererConstants: { FontSheetSize: -1, VertexBatchSize: -100 },
      })
      expect(m.rendererConstants.fontSheetSize).toBe(-1)
      expect(m.rendererConstants.vertexBatchSize).toBe(-100)
    })
  })

  // -----------------------------------------------------------------------
  // globalModData — various value types
  // -----------------------------------------------------------------------

  describe('globalModData', () => {
    it('includes only object values (not arrays, strings, numbers)', () => {
      const m = new Manifest('mod', {
        UnknownString: 'hello',
        UnknownNumber: 42,
        UnknownArray: [1, 2, 3],
        UnknownObject: { key: 'value' },
        UnknownBool: true,
      })
      // Arrays are excluded
      expect(m.globalModData.has('UnknownArray')).toBe(false)
      expect(m.globalModData.has('UnknownString')).toBe(false)
      expect(m.globalModData.has('UnknownNumber')).toBe(false)
      expect(m.globalModData.has('UnknownBool')).toBe(false)
      // Object is included
      expect(m.globalModData.has('UnknownObject')).toBe(true)
      expect(m.globalModData.get('UnknownObject')).toEqual({ key: 'value' })
    })

    it('excludes null values', () => {
      const m = new Manifest('mod', { UnknownNull: null })
      expect(m.globalModData.has('UnknownNull')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // FileSystem mounts parsing
  // -----------------------------------------------------------------------

  describe('FileSystem mounts parsing', () => {
    it('handles empty FileSystem object', () => {
      const m = new Manifest('mod', { FileSystem: {} })
      expect(m.mounts).toEqual([])
    })

    it('ignores non-object FileSystem', () => {
      const m = new Manifest('mod', { FileSystem: 'string' })
      expect(m.mounts).toEqual([])
    })

    it('treats FileSystem array as non-object → mounts = []', () => {
      const m = new Manifest('mod', {
        FileSystem: ['package1.mix', 'package2.mix'],
      })
      expect(m.mounts).toEqual([])
    })

    it('treats FileSystem null as non-object → mounts = []', () => {
      const m = new Manifest('mod', { FileSystem: null })
      expect(m.mounts).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // static fromJSON factory
  // -----------------------------------------------------------------------

  describe('fromJSON', () => {
    it('creates Manifest identical to constructor', () => {
      const json = { Metadata: { Title: 'Test', Version: '1.0' } }
      const a = new Manifest('mod', json)
      const b = Manifest.fromJSON('mod', json)
      expect(b.id).toBe(a.id)
      expect(b.metadata).toEqual(a.metadata)
      expect(b.requiresMods).toEqual(a.requiresMods)
    })
  })

  // -----------------------------------------------------------------------
  // validateDependencies
  // -----------------------------------------------------------------------

  describe('validateDependencies', () => {
    function makeMod(
      id: string,
      deps: string[] = [],
    ): Manifest {
      return new Manifest(id, {
        Metadata: { Title: id, Version: '1.0' },
        ...(deps.length > 0 ? { RequiresMods: deps } : {}),
      })
    }

    it('returns empty array when all dependencies satisfied', () => {
      const base = makeMod('base')
      const cnc = makeMod('cnc', ['base'])
      const testmod = makeMod('testmod', ['base', 'cnc'])

      const available = new Map<string, Manifest>()
      available.set('base', base)
      available.set('cnc', cnc)

      const missing = testmod.validateDependencies(available)
      expect(missing).toEqual([])
    })

    it('returns missing dependency IDs', () => {
      const testmod = makeMod('testmod', ['base', 'cnc', 'ra'])

      const available = new Map<string, Manifest>()
      available.set('base', makeMod('base'))

      const missing = testmod.validateDependencies(available)
      expect(missing).toContain('cnc')
      expect(missing).toContain('ra')
      expect(missing.length).toBe(2)
    })

    it('detects transitive missing dependencies', () => {
      const testmod = makeMod('testmod', ['cnc'])
      const cnc = makeMod('cnc', ['base']) // base is missing

      const available = new Map<string, Manifest>()
      available.set('cnc', cnc)

      const missing = testmod.validateDependencies(available)
      expect(missing).toEqual(['base'])
    })

    it('handles cyclic dependencies without infinite loop', () => {
      const a = makeMod('a', ['b'])
      const b = makeMod('b', ['a'])

      const available = new Map<string, Manifest>()
      available.set('a', a)
      available.set('b', b)

      const missing = a.validateDependencies(available)
      expect(missing).toEqual([])
    })

    it('handles self-referencing dependency', () => {
      const selfRef = makeMod('selfref', ['selfref'])

      const available = new Map<string, Manifest>()
      available.set('selfref', selfRef)

      const missing = selfRef.validateDependencies(available)
      expect(missing).toEqual([])
    })

    it('returns empty array for mod with no dependencies', () => {
      const standalone = makeMod('standalone')
      const missing = standalone.validateDependencies(new Map())
      expect(missing).toEqual([])
    })

    it('handles empty availableMods', () => {
      const testmod = makeMod('testmod', ['base', 'cnc'])
      const missing = testmod.validateDependencies(new Map())
      expect(missing).toEqual(['base', 'cnc'])
    })

    it('deep transitive: A→B→C→D with D missing', () => {
      const a = makeMod('a', ['b'])
      const b = makeMod('b', ['c'])
      const c = makeMod('c', ['d']) // d is missing

      const available = new Map<string, Manifest>()
      available.set('a', a)
      available.set('b', b)
      available.set('c', c)

      const missing = a.validateDependencies(available)
      expect(missing).toEqual(['d'])
    })

    it('diamond dependency: A→B,C; B→D; C→D; D exists', () => {
      const d = makeMod('d')
      const b = makeMod('b', ['d'])
      const c = makeMod('c', ['d'])
      const a = makeMod('a', ['b', 'c'])

      const available = new Map<string, Manifest>()
      available.set('a', a)
      available.set('b', b)
      available.set('c', c)
      available.set('d', d)

      const missing = a.validateDependencies(available)
      expect(missing).toEqual([])
    })

    it('does not duplicate missing entries in output', () => {
      // A→B, A→C, B→D, C→D, D missing
      const b = makeMod('b', ['d'])
      const c = makeMod('c', ['d'])
      const a = makeMod('a', ['b', 'c'])

      const available = new Map<string, Manifest>()
      available.set('a', a)
      available.set('b', b)
      available.set('c', c)

      const missing = a.validateDependencies(available)
      expect(missing).toEqual(['d'])
    })
  })

  // -----------------------------------------------------------------------
  // Manifest satisfies ManifestStub (structural compatibility)
  // -----------------------------------------------------------------------

  describe('ManifestStub compatibility', () => {
    it('satisfies mapFolders requirement', () => {
      const m = new Manifest('mod', {
        MapFolders: { a: 'path/a' },
        RendererConstants: { MapPreviewSheetSize: 512 },
      })
      // Structural check: mapFolders is Map<string, string>
      expect(m.mapFolders).toBeInstanceOf(Map)
      expect(m.mapFolders.get('a')).toBe('path/a')
      // rendererConstants has mapPreviewSheetSize
      expect(m.rendererConstants.mapPreviewSheetSize).toBe(512)
    })
  })

  // -----------------------------------------------------------------------
  // Immutability / readonly semantics
  // -----------------------------------------------------------------------

  describe('readonly fields', () => {
    it('has readonly fields that match OpenRA contract', () => {
      const m = new Manifest('test', buildReferenceModJSON())
      // Verify all expected fields exist and have correct types
      expect(typeof m.id).toBe('string')
      expect(typeof m.metadata).toBe('object')
      expect(Array.isArray(m.requiresMods)).toBe(true)
      expect(Array.isArray(m.mounts)).toBe(true)
      expect(Array.isArray(m.rules)).toBe(true)
      expect(m.mapFolders).toBeInstanceOf(Map)
      expect(Array.isArray(m.mapCompatibility)).toBe(true)
      expect(m.rendererConstants).toBeDefined()
      expect(typeof m.rendererConstants.mapPreviewSheetSize).toBe('number')
      expect(m.globalModData).toBeInstanceOf(Map)
    })
  })
})
