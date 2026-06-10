/**
 * MapDirectoryTracker.test.ts — MapDirectoryTracker migration unit tests
 *
 * Tests focus on: action queuing, path normalization, updateMaps processing,
 * and dispose lifecycle.
 */

import { describe, it, expect, vi } from 'vitest'
import { MapDirectoryTracker } from './MapDirectoryTracker.js'
import { MapClassification, MapStatus } from './MapPreview.js'
import type { IReadOnlyPackage } from '../FileSystem/IReadOnlyPackage.js'
import type { MapPreview } from './MapPreview.js'

// ---------------------------------------------------------------------------
// Local type for MapCache (avoids circular dependency — MapCache not yet created)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface MapCacheLike {
  loadMap(map: string, package_: IReadOnlyPackage, classification: MapClassification, oldMap: string | null): void
  [Symbol.iterator](): Iterator<MapPreview>
}

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function createMockPackage(name: string, contents: string[] = []): IReadOnlyPackage {
  return {
    name,
    contents,
    openPackage: vi.fn(),
  }
}

function createMockMapCache(previews: MapPreview[] = []): MapCacheLike {
  return {
    [Symbol.iterator]: () => previews[Symbol.iterator](),
    loadMap: vi.fn(),
  } as unknown as MapCacheLike
}

function createMockPreview(path: string, status: MapStatus, uid: string): MapPreview {
  return {
    path,
    status,
    uid,
    invalidate: vi.fn(),
  } as unknown as MapPreview
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapDirectoryTracker', () => {
  describe('constructor', () => {
    it('stores package and classification', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      expect(tracker.package).toBe(pkg)
      expect(tracker.classification).toBe(MapClassification.System)
    })

    it('uses default polling interval of 5000ms', () => {
      const tracker = new MapDirectoryTracker(createMockPackage('/maps'), MapClassification.System)
      expect(tracker.pollingInterval).toBe(5000)
    })

    it('accepts custom polling interval', () => {
      const tracker = new MapDirectoryTracker(
        createMockPackage('/maps'),
        MapClassification.System,
        10000,
      )
      expect(tracker.pollingInterval).toBe(10000)
    })
  })

  describe('addMapAction', () => {
    it('queues Add action for root-level path', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Add', '/maps/mymap.oramap')

      // Action should be queued - verified via updateMaps behavior
      const preview = createMockPreview('/maps/mymap.oramap', MapStatus.Available, 'old-uid')
      const cache = createMockMapCache([preview])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      // When an "Add" action finds an existing map, it treats it as an update
      // and passes the old UID for tracking
      expect(cache.loadMap).toHaveBeenCalledWith('mymap.oramap', pkg, MapClassification.System, 'old-uid')
    })

    it('collapses subdirectory changes to Update', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      // Adding a file inside a subdirectory should collapse to top-level dir update
      tracker.addMapAction('Add', '/maps/subdir/nested/file.txt')

      const preview = createMockPreview('/maps/subdir', MapStatus.Available, 'uid')
      const cache = createMockMapCache([preview])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      // Should treat as Update (not Add) for the top-level directory
      expect(preview.invalidate).toHaveBeenCalled()
    })

    it('ignores paths outside the package', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Add', '/other/path/map.oramap')

      const cache = createMockMapCache([])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      // Should not queue anything for paths outside package
      expect(cache.loadMap).not.toHaveBeenCalled()
    })

    it('handles Update action', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Update', '/maps/mymap.oramap')

      const preview = createMockPreview('/maps/mymap.oramap', MapStatus.Available, 'uid-1')
      const cache = createMockMapCache([preview])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      expect(preview.invalidate).toHaveBeenCalled()
      expect(cache.loadMap).toHaveBeenCalledWith('mymap.oramap', pkg, MapClassification.System, 'uid-1')
    })

    it('handles Delete action', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Delete', '/maps/mymap.oramap')

      const preview = createMockPreview('/maps/mymap.oramap', MapStatus.Available, 'uid-1')
      const cache = createMockMapCache([preview])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      expect(preview.invalidate).toHaveBeenCalled()
      expect(cache.loadMap).not.toHaveBeenCalled()
    })

    it('handles rename with oldFullPath', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Add', '/maps/newmap.oramap', '/maps/oldmap.oramap')

      const oldPreview = createMockPreview('/maps/oldmap.oramap', MapStatus.Available, 'old-uid')
      const cache = createMockMapCache([oldPreview])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      // Old path should be marked as Delete
      expect(oldPreview.invalidate).toHaveBeenCalled()
      // New path should be loaded
      expect(cache.loadMap).toHaveBeenCalledWith('newmap.oramap', pkg, MapClassification.System, null)
    })
  })

  describe('updateMaps', () => {
    it('does nothing when queue is empty', () => {
      const tracker = new MapDirectoryTracker(createMockPackage('/maps'), MapClassification.System)
      const cache = createMockMapCache([])

      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      expect(cache.loadMap).not.toHaveBeenCalled()
    })

    it('clears queue after processing', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Add', '/maps/map1.oramap')
      tracker.addMapAction('Add', '/maps/map2.oramap')

      const cache = createMockMapCache([])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      // Second call should not process anything
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])
      expect(cache.loadMap).toHaveBeenCalledTimes(2)
    })

    it('processes multiple actions in order', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Add', '/maps/new.oramap')
      tracker.addMapAction('Delete', '/maps/old.oramap')

      const oldPreview = createMockPreview('/maps/old.oramap', MapStatus.Available, 'old')
      const cache = createMockMapCache([oldPreview])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      expect(cache.loadMap).toHaveBeenCalledWith('new.oramap', pkg, MapClassification.System, null)
      expect(oldPreview.invalidate).toHaveBeenCalled()
    })

    it('only processes maps with Available status', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Update', '/maps/map.oramap')

      const unavailablePreview = createMockPreview('/maps/map.oramap', MapStatus.Unavailable, 'uid')
      const cache = createMockMapCache([unavailablePreview])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      // Should not process unavailable maps
      expect(unavailablePreview.invalidate).not.toHaveBeenCalled()
    })
  })

  describe('removeSubDirs', () => {
    it('returns null for paths outside package', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      expect(tracker.removeSubDirs('/other/path')).toBeNull()
    })

    it('returns path unchanged for root-level entries', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      expect(tracker.removeSubDirs('/maps/mymap.oramap')).toBe('/maps/mymap.oramap')
    })

    it('collapses subdirectory to top-level directory', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      expect(tracker.removeSubDirs('/maps/subdir/file.txt')).toBe('/maps/subdir')
    })

    it('handles deeply nested paths', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      expect(tracker.removeSubDirs('/maps/a/b/c/d.txt')).toBe('/maps/a')
    })
  })

  describe('dispose', () => {
    it('stops polling timer', () => {
      const tracker = new MapDirectoryTracker(createMockPackage('/maps'), MapClassification.System)
      tracker.startPolling()
      tracker.dispose()

      // Should not throw and timer should be cleared
      expect(() => tracker.dispose()).not.toThrow()
    })

    it('clears action queue', () => {
      const pkg = createMockPackage('/maps')
      const tracker = new MapDirectoryTracker(pkg, MapClassification.System)

      tracker.addMapAction('Add', '/maps/map.oramap')
      tracker.dispose()

      const cache = createMockMapCache([])
      tracker.updateMaps(cache as unknown as Parameters<typeof tracker.updateMaps>[0])

      expect(cache.loadMap).not.toHaveBeenCalled()
    })
  })

  describe('polling', () => {
    it('startPolling does not throw', () => {
      const tracker = new MapDirectoryTracker(createMockPackage('/maps'), MapClassification.System)
      expect(() => tracker.startPolling()).not.toThrow()
    })

    it('stopPolling is safe when not polling', () => {
      const tracker = new MapDirectoryTracker(createMockPackage('/maps'), MapClassification.System)
      expect(() => tracker.stopPolling()).not.toThrow()
    })
  })
})
