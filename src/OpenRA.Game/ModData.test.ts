/**
 * ModData.test.ts — ModData + ObjectCreator migration unit tests
 *
 * Tests focus on: ObjectCreator registration/lookup/factory,
 * ModData construction, init() lifecycle, dispose() cleanup,
 * and integration with Manifest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ObjectCreator, ModData, type ILoadScreen } from './ModData.js'
import { Manifest } from './Manifest.js'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

/** 创建最小 Manifest */
function createTestManifest(
  id = 'testmod',
  overrides: Record<string, unknown> = {},
): Manifest {
  return new Manifest(id, {
    Metadata: { Title: 'Test Mod', Version: '1.0' },
    FileSystem: {},
    ...overrides,
  })
}

/** 创建带挂载路径的 Manifest */
function createManifestWithMounts(
  id = 'testmod',
  mounts: Record<string, unknown> = { '~^content/test': '' },
): Manifest {
  return new Manifest(id, {
    Metadata: { Title: 'Test Mod', Version: '1.0' },
    FileSystem: mounts,
  })
}

/** 创建 mock FileSystem */
function createMockFileSystem() {
  return {
    mount: vi.fn().mockResolvedValue(undefined),
    mountFromBuffer: vi.fn().mockReturnValue(null),
    mountPackage: vi.fn(),
    unmount: vi.fn().mockReturnValue(true),
    unmountAll: vi.fn(),
    openAsync: vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockReturnValue(false),
    isMounted: vi.fn().mockReturnValue(false),
    dispose: vi.fn(),
    registerLoader: vi.fn(),
    clearCache: vi.fn(),
    mountedPackages: new Map(),
    explicitMounts: new Map(),
    getPackagesForFile: vi.fn().mockReturnValue([]),
  }
}

type MockFileSystem = ReturnType<typeof createMockFileSystem>

// ---------------------------------------------------------------------------
// Test classes for ObjectCreator
// ---------------------------------------------------------------------------

class TestWidget {
  readonly label: string
  constructor(label: string) {
    this.label = label
  }
}

class TestButton {
  readonly text: string
  readonly onClick: () => void
  constructor(text: string, onClick: () => void) {
    this.text = text
    this.onClick = onClick
  }
}

class NoArgWidget {
  readonly created = true
}

// ---------------------------------------------------------------------------
// ObjectCreator tests
// ---------------------------------------------------------------------------

describe('ObjectCreator', () => {
  let oc: ObjectCreator

  beforeEach(() => {
    oc = new ObjectCreator()
  })

  describe('register', () => {
    it('adds a class to the registry', () => {
      oc.register('TestWidget', TestWidget)
      expect(oc.getType('TestWidget')).toBe(TestWidget)
    })

    it('overwrites existing registration (last wins)', () => {
      oc.register('TestWidget', TestWidget)
      oc.register('TestWidget', TestButton)
      expect(oc.getType('TestWidget')).toBe(TestButton)
    })
  })

  describe('getType', () => {
    it('returns constructor for registered name', () => {
      oc.register('TestWidget', TestWidget)
      expect(oc.getType('TestWidget')).toBe(TestWidget)
    })

    it('returns undefined for unregistered name', () => {
      expect(oc.getType('UnknownClass')).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      expect(oc.getType('')).toBeUndefined()
    })
  })

  describe('createObject', () => {
    it('creates instance with constructor args', () => {
      oc.register('TestWidget', TestWidget)
      const widget = oc.createObject<TestWidget>('TestWidget', 'Hello')
      expect(widget).not.toBeNull()
      expect(widget!.label).toBe('Hello')
      expect(widget).toBeInstanceOf(TestWidget)
    })

    it('creates instance with no args', () => {
      oc.register('NoArgWidget', NoArgWidget)
      const widget = oc.createObject<NoArgWidget>('NoArgWidget')
      expect(widget).not.toBeNull()
      expect(widget!.created).toBe(true)
    })

    it('creates instance with multiple args', () => {
      const onClick = vi.fn()
      oc.register('TestButton', TestButton)
      const button = oc.createObject<TestButton>('TestButton', 'Click Me', onClick)
      expect(button).not.toBeNull()
      expect(button!.text).toBe('Click Me')
      button!.onClick()
      expect(onClick).toHaveBeenCalledOnce()
    })

    it('returns null for unregistered name', () => {
      const result = oc.createObject('UnknownClass', 'arg')
      expect(result).toBeNull()
    })

    it('does not throw for unregistered name', () => {
      expect(() => oc.createObject('UnknownClass')).not.toThrow()
    })

    it('returns null for empty string name', () => {
      expect(oc.createObject('')).toBeNull()
    })
  })

  describe('registeredNames', () => {
    it('returns empty array for empty registry', () => {
      expect(oc.registeredNames).toEqual([])
    })

    it('returns all registered names', () => {
      oc.register('A', TestWidget)
      oc.register('B', TestButton)
      oc.register('C', NoArgWidget)
      const names = oc.registeredNames
      expect(names).toHaveLength(3)
      expect(names).toContain('A')
      expect(names).toContain('B')
      expect(names).toContain('C')
    })
  })

  describe('dispose', () => {
    it('clears the registry', () => {
      oc.register('TestWidget', TestWidget)
      expect(oc.getType('TestWidget')).toBe(TestWidget)
      oc.dispose()
      expect(oc.getType('TestWidget')).toBeUndefined()
      expect(oc.registeredNames).toEqual([])
    })

    it('is safe to call multiple times', () => {
      oc.dispose()
      oc.dispose()
      expect(oc.registeredNames).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// ModData tests
// ---------------------------------------------------------------------------

describe('ModData', () => {
  let manifest: Manifest
  let mockFiles: MockFileSystem

  beforeEach(() => {
    manifest = createTestManifest()
    mockFiles = createMockFileSystem()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores manifest, modFiles', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      expect(md.manifest).toBe(manifest)
      expect(md.modFiles).toBe(mockFiles)
    })

    it('creates ObjectCreator', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      expect(md.objectCreator).toBeInstanceOf(ObjectCreator)
      expect(md.objectCreator.registeredNames).toEqual([])
    })

    it('creates MapCache from manifest', () => {
      const m = createTestManifest('testmod', {
        MapFolders: { release: 'maps/release' },
      })
      const md = new ModData(m, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      expect(md.mapCache).toBeDefined()
      // MapPreview sheet builder created with manifest's mapPreviewSheetSize
      expect(md.mapCache.loadPreviewImages).toBe(true)
    })

    it('defaultFileSystem returns modFiles', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      // defaultFileSystem is a getter that returns modFiles
      // Since our mock implements IReadOnlyFileSystem, it should work
      expect(md.defaultFileSystem).toBe(mockFiles)
    })

    it('loadScreen is null by default', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      expect(md.loadScreen).toBeNull()
    })

    it('accepts optional availableMods parameter', () => {
      const available = new Map<string, Manifest>()
      const md = new ModData(
        manifest,
        mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem,
        available,
      )
      expect(md).toBeDefined()
    })

    it('works without availableMods', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      expect(md).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // init()
  // -----------------------------------------------------------------------

  describe('init', () => {
    it('mounts all manifest.mounts paths', async () => {
      const m = createManifestWithMounts('testmod', {
        '~^content/cnc': 'cnc.mix',
        '$modid': 'test.mix',
      })
      const md = new ModData(m, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      await md.init()

      expect(mockFiles.mount).toHaveBeenCalledTimes(2)
      expect(mockFiles.mount).toHaveBeenCalledWith('~^content/cnc')
      expect(mockFiles.mount).toHaveBeenCalledWith('$modid')
    })

    it('handles manifest with no mounts', async () => {
      const m = createTestManifest('nomounts', { FileSystem: {} })
      const md = new ModData(m, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      await md.init()

      expect(mockFiles.mount).not.toHaveBeenCalled()
    })

    it('validates dependencies when availableMods provided', async () => {
      const base = createTestManifest('base')
      const depManifest = createTestManifest('dep', { RequiresMods: ['base'] })

      const available = new Map<string, Manifest>()
      available.set('base', base)

      const md = new ModData(
        depManifest,
        mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem,
        available,
      )
      await md.init() // should not throw
    })

    it('throws when dependencies are missing', async () => {
      const depManifest = createTestManifest('dep', {
        RequiresMods: ['missing_mod'],
      })

      const available = new Map<string, Manifest>()
      const md = new ModData(
        depManifest,
        mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem,
        available,
      )

      await expect(md.init()).rejects.toThrow(
        "Mod 'dep' requires missing dependencies: missing_mod",
      )
    })

    it('skips dependency validation when availableMods is not provided', async () => {
      const depManifest = createTestManifest('dep', {
        RequiresMods: ['missing_mod'],
      })
      // No availableMods parameter → validation skipped
      const md = new ModData(
        depManifest,
        mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem,
      )
      await expect(md.init()).resolves.toBeUndefined()
    })

    it('does not throw when all dependencies satisfied', async () => {
      const base = createTestManifest('base')
      const cnc = createTestManifest('cnc', { RequiresMods: ['base'] })
      const mod = createTestManifest('mod', { RequiresMods: ['cnc'] })

      const available = new Map<string, Manifest>()
      available.set('base', base)
      available.set('cnc', cnc)

      const md = new ModData(
        mod,
        mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem,
        available,
      )
      await expect(md.init()).resolves.toBeUndefined()
    })

    it('throws for transitive missing dependency', async () => {
      const cnc = createTestManifest('cnc', { RequiresMods: ['nonexistent_base'] })
      const mod = createTestManifest('mod', { RequiresMods: ['cnc'] })

      const available = new Map<string, Manifest>()
      available.set('cnc', cnc)

      const md = new ModData(
        mod,
        mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem,
        available,
      )
      await expect(md.init()).rejects.toThrow('nonexistent_base')
    })
  })

  // -----------------------------------------------------------------------
  // loadRuleSet (stub)
  // -----------------------------------------------------------------------

  describe('loadRuleSet', () => {
    it('returns a Ruleset instance', async () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      const rules = await md.loadRuleSet()
      expect(rules).not.toBeNull()
      expect(rules).toBeDefined()
      // Ruleset.loadAsync is now implemented and returns a Ruleset with actor definitions
      expect(rules!.actors).toBeInstanceOf(Map)
    })
  })

  // -----------------------------------------------------------------------
  // getOrCreate (stub)
  // -----------------------------------------------------------------------

  describe('getOrCreate', () => {
    it('returns undefined (stub)', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      class DummyModule {}
      expect(md.getOrCreate<DummyModule>(DummyModule)).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // dispose()
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('disposes loadScreen if set', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      const mockScreen: ILoadScreen = {
        init: vi.fn(),
        display: vi.fn(),
        dispose: vi.fn(),
      }
      md.loadScreen = mockScreen
      md.dispose()

      expect(mockScreen.dispose).toHaveBeenCalledOnce()
      expect(md.loadScreen).toBeNull()
    })

    it('does not throw when loadScreen is null', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      expect(() => md.dispose()).not.toThrow()
    })

    it('disposes modFiles', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      md.dispose()
      expect(mockFiles.dispose).toHaveBeenCalledOnce()
    })

    it('disposes mapCache', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      const disposeSpy = vi.spyOn(md.mapCache, 'dispose')
      md.dispose()
      expect(disposeSpy).toHaveBeenCalledOnce()
    })

    it('disposes objectCreator (clears registry)', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      md.objectCreator.register('Test', TestWidget)
      expect(md.objectCreator.getType('Test')).toBe(TestWidget)
      md.dispose()
      expect(md.objectCreator.getType('Test')).toBeUndefined()
    })

    it('is safe to call dispose multiple times', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      md.dispose()
      expect(() => md.dispose()).not.toThrow()
      expect(() => md.dispose()).not.toThrow()
    })

    it('dispose sequence: screen → mapCache → objectCreator → files', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      const callOrder: string[] = []

      const mockScreen: ILoadScreen = {
        init: vi.fn(),
        display: vi.fn(),
        dispose: vi.fn(() => callOrder.push('screen')),
      }
      md.loadScreen = mockScreen
      vi.spyOn(md.mapCache, 'dispose').mockImplementation(() =>
        callOrder.push('mapCache'),
      )
      vi.spyOn(md.objectCreator, 'dispose').mockImplementation(() =>
        callOrder.push('objectCreator'),
      )
      mockFiles.dispose.mockImplementation(() => callOrder.push('files'))

      md.dispose()

      expect(callOrder).toEqual([
        'screen',
        'mapCache',
        'objectCreator',
        'files',
      ])
    })
  })

  // -----------------------------------------------------------------------
  // init + dispose lifecycle
  // -----------------------------------------------------------------------

  describe('init → dispose lifecycle', () => {
    it('completes full lifecycle without errors', async () => {
      const m = createManifestWithMounts('lifecycle', {
        'test/package': 'pkg.mix',
      })
      const md = new ModData(m, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)

      await md.init()
      expect(mockFiles.mount).toHaveBeenCalledWith('test/package')

      md.dispose()
      expect(mockFiles.dispose).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Integration: Manifest + ObjectCreator + MapCache
  // -----------------------------------------------------------------------

  describe('integration', () => {
    it('ObjectCreator is usable after ModData construction', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      md.objectCreator.register('TestWidget', TestWidget)

      const widget = md.objectCreator.createObject<TestWidget>(
        'TestWidget',
        'Integrated',
      )
      expect(widget).not.toBeNull()
      expect(widget!.label).toBe('Integrated')
    })

    it('ModData with MapFolders creates valid MapCache', () => {
      const m = createTestManifest('mapmod', {
        MapFolders: { official: 'maps/official', custom: 'maps/custom' },
      })
      const md = new ModData(m, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)

      expect(md.mapCache).toBeDefined()
      // MapCache should have been constructed with a manifest that has mapFolders
      // We can verify MapCache was constructed by checking it's a proper instance
      expect(typeof md.mapCache.dispose).toBe('function')
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles manifest with empty FileSystem', async () => {
      const m = new Manifest('emptyfs', {
        Metadata: { Title: 'EmptyFS', Version: '1.0' },
        FileSystem: {},
      })
      const md = new ModData(m, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      await md.init()
      expect(mockFiles.mount).not.toHaveBeenCalled()
    })

    it('handles manifest without FileSystem', async () => {
      const m = new Manifest('nofs', {
        Metadata: { Title: 'NoFS', Version: '1.0' },
      })
      const md = new ModData(m, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      await md.init()
      expect(mockFiles.mount).not.toHaveBeenCalled()
    })

    it('MapCache is independent of ObjectCreator state', () => {
      const md = new ModData(manifest, mockFiles as unknown as import('./FileSystem/FileSystem.js').FileSystem)
      // ObjectCreator registry does not affect MapCache
      expect(md.mapCache).toBeDefined()
      md.objectCreator.dispose()
      // MapCache should still be valid
      expect(md.mapCache).toBeDefined()
    })
  })
})
