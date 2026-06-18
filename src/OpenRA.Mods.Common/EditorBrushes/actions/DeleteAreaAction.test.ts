/**
 * DeleteAreaAction.test.ts — DeleteAreaAction migration unit tests
 *
 * Tests the delete area undo/redo action: snapshot, delete, restore.
 * Focuses on: filter-respecting behavior, terrain reset, resource clearing,
 * actor removal/restoration, and edge cases.
 *
 * Since DeleteAreaAction has no Babylon.js dependency, no mocks are needed
 * beyond test doubles for map, actor layer, and resource layer.
 */

import { describe, it, expect, vi } from 'vitest'

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CellCoordsRegion } from '../../../OpenRA.Game/Map/CellCoordsRegion.js'
import { MapBlitFilters } from '../types.js'
import { DeleteAreaAction } from './DeleteAreaAction.js'
import type { ResourceLayerContents } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ResourceLayerContentsEmpty } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockMap() {
  const tiles = new Map<string, { type: number; index: number }>()
  const heights = new Map<string, number>()

  return {
    tiles: {
      contains: vi.fn().mockReturnValue(true),
      get: vi.fn().mockImplementation((pos: CPos) =>
        tiles.get(`${pos.X},${pos.Y}`) ?? { type: 1, index: 0 }),
      set: vi.fn().mockImplementation((pos: CPos, tile: { type: number; index: number }) => {
        tiles.set(`${pos.X},${pos.Y}`, tile)
      }),
    },
    height: {
      get: vi.fn().mockImplementation((cell: CPos) =>
        heights.get(`${cell.X},${cell.Y}`) ?? 5),
      set: vi.fn().mockImplementation((cell: CPos, h: number) => {
        heights.set(`${cell.X},${cell.Y}`, h)
      }),
    },
    rules: {
      terrainInfo: {
        defaultTerrainTile: { type: 255, index: 0 },
      },
    },
  }
}

function mockActorLayer() {
  const removedRegions: CellCoordsRegion[] = []
  const addedRanges: unknown[][] = []

  return {
    removeRegion: vi.fn().mockImplementation((region: CellCoordsRegion) => {
      removedRegions.push(region)
    }),
    addRange: vi.fn().mockImplementation((copies: unknown[]) => {
      addedRanges.push(copies)
    }),
    previewsInCellRegion: vi.fn().mockReturnValue([]),
    _removedRegions: removedRegions,
    _addedRanges: addedRanges,
  }
}

function mockResourceLayer() {
  const cells = new Map<string, ResourceLayerContents>()
  const cleared: CPos[] = []

  return {
    get info() { return { resourceTypes: new Map() } },
    get isEmpty() { return cells.size === 0 },
    get netWorth() { return 0 },
    getResource: vi.fn().mockImplementation((cell: CPos): ResourceLayerContents =>
      cells.get(`${cell.X},${cell.Y}`) ?? ResourceLayerContentsEmpty),
    getMaxDensity: vi.fn().mockReturnValue(10),
    getDensity: vi.fn().mockReturnValue(0),
    isVisible: vi.fn().mockReturnValue(true),
    canAddResource: vi.fn().mockReturnValue(true),
    addResource: vi.fn(),
    removeResource: vi.fn(),
    clearResources: vi.fn().mockImplementation((cell: CPos) => {
      cleared.push(cell)
    }),
    _setResource(cell: CPos, type: string, density: number) {
      cells.set(`${cell.X},${cell.Y}`, { type, density })
    },
    _cleared: cleared,
  }
}

// ---------------------------------------------------------------------------
// Helper: create a 2x2 region
// ---------------------------------------------------------------------------

function region2x2(): CellCoordsRegion {
  return new CellCoordsRegion(new CPos(10, 20), new CPos(11, 21))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeleteAreaAction', () => {
  describe('execute / redo — full deletion', () => {
    it('removes actors when Actors filter is set', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.Actors, region, rl as any, actorLayer as any,
      )

      action.execute()
      expect(actorLayer.removeRegion).toHaveBeenCalledWith(region)
    })

    it('resets terrain tiles to default when Terrain filter is set', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.Terrain, region, rl as any, actorLayer as any,
      )

      action.execute()

      // Default tile should have been written to all cells in region
      for (const cell of region) {
        expect(map.tiles.set).toHaveBeenCalledWith(
          expect.objectContaining({ X: cell.X, Y: cell.Y }),
          { type: 255, index: 0 },
        )
      }
    })

    it('resets height to 0 when Terrain filter is set', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.Terrain, region, rl as any, actorLayer as any,
      )

      action.execute()

      for (const cell of region) {
        expect(map.height.set).toHaveBeenCalledWith(
          expect.objectContaining({ X: cell.X, Y: cell.Y }),
          0,
        )
      }
    })

    it('clears resources when Resources filter is set', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.Resources, region, rl as any, actorLayer as any,
      )

      action.execute()

      expect(rl.clearResources).toHaveBeenCalled()
    })

    it('does not remove actors when Actors filter is NOT set', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.Resources, region, rl as any, actorLayer as any,
      )

      action.execute()
      expect(actorLayer.removeRegion).not.toHaveBeenCalled()
    })
  })

  describe('undo — restoration', () => {
    it('restores terrain tiles from snapshot', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.Terrain, region, rl as any, actorLayer as any,
      )

      // Apply deletion
      action.execute()

      // Clear the set mock so we can verify restore
      ;(map.tiles.set as ReturnType<typeof vi.fn>).mockClear()

      // Undo should restore from snapshot
      action.undo()

      // Should have called set for each cell to restore original tile
      expect(map.tiles.set).toHaveBeenCalled()
    })

    it('restores height from snapshot', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.Terrain, region, rl as any, actorLayer as any,
      )

      action.execute()
      ;(map.height.set as ReturnType<typeof vi.fn>).mockClear()

      action.undo()
      expect(map.height.set).toHaveBeenCalled()
    })

    it('restores actors from snapshot', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.Actors, region, rl as any, actorLayer as any,
      )

      action.execute()
      action.undo()

      // Actor restoration depends on what was in the snapshot
      expect(actorLayer.addRange).toHaveBeenCalled()
    })
  })

  describe('kind — text description', () => {
    it('formats text with region coordinates', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.All, region, rl as any, actorLayer as any,
      )

      expect(action.text).toContain('Removed area')
      expect(action.text).toContain('(10,20)')
    })
  })

  describe('kind — edge cases', () => {
    it('does nothing when deleting empty region (no-op)', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const rl = mockResourceLayer()
      // Single cell region
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(0, 0))

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.All, region, rl as any, actorLayer as any,
      )

      expect(() => action.execute()).not.toThrow()
    })

    it('handles null resource layer gracefully', () => {
      const map = mockMap()
      const actorLayer = mockActorLayer()
      const region = region2x2()

      const action = new DeleteAreaAction(
        map as any, MapBlitFilters.All, region, null, actorLayer as any,
      )

      expect(() => action.execute()).not.toThrow()
      expect(() => action.undo()).not.toThrow()
    })
  })
})
