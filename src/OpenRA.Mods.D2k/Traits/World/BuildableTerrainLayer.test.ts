/**
 * BuildableTerrainLayer.test.ts — BuildableTerrainLayer migration unit tests
 *
 * Tests focus on: tile management (add/remove/hit), strength tracking,
 * dirty tile updates, disposal lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  BuildableTerrainLayer,
  BuildableTerrainLayerInfo,
  type IMapMinimal,
  type TerrainTile,
} from './BuildableTerrainLayer.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GRID_SIZE = { X: 10, Y: 10 }

function createMockMap(): IMapMinimal {
  const customTerrain: Record<number, number> = {}
  return {
    contains: vi.fn(() => true),
    customTerrain,
    rules: {
      terrainInfo: {
        getTerrainInfo: vi.fn((tile: TerrainTile) => ({
          terrainType: tile.templateId * 256 + tile.index,
          type: 'Concrete',
          getColor: vi.fn(() => ({
            left: { r: 128, g: 128, b: 128, a: 255 },
            right: { r: 128, g: 128, b: 128, a: 255 },
          })),
        })),
      },
    },
    gridsize: GRID_SIZE,
  }
}

function createMockActor(map?: IMapMinimal): IGameActor {
  const mockMap = map ?? createMockMap()
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 1,
    owner: { playerId: 0, playerName: 'Test' },
    world: {
      map: mockMap,
      fogObscures: vi.fn(() => false),
      worldActor: {
        TiledTerrainRenderer: { missingTile: null, tileSprite: vi.fn(() => ({})) },
      },
    },
    centerPosition: { X: 0, Y: 0, Z: 0 },
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BuildableTerrainLayer', () => {
  let info: BuildableTerrainLayerInfo
  let actor: IGameActor

  beforeEach(() => {
    info = new BuildableTerrainLayerInfo({ maxStrength: 9000 })
    actor = createMockActor()
  })

  describe('BuildableTerrainLayerInfo', () => {
    it('has defaults', () => {
      expect(info.palette).toBe('terrain')
      expect(info.maxStrength).toBe(9000)
    })

    it('creates layer instance', () => {
      const layer = info.create({ self: actor })
      expect(layer).toBeInstanceOf(BuildableTerrainLayer)
    })
  })

  describe('AddTile', () => {
    it('adds concrete to a cell', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      const cell = new CPos(3, 4)
      const tile: TerrainTile = { templateId: 88, index: 0 }

      layer.addTile(cell, tile)
      expect(layer.getStrength(cell)).toBe(9000)
      expect(layer.hasConcrete(cell)).toBe(true)
    })

    it('sets custom terrain type', () => {
      const map = createMockMap()
      const a = createMockActor(map)
      const layer = new BuildableTerrainLayer(a, info)
      const cell = new CPos(2, 2)
      const tile: TerrainTile = { templateId: 88, index: 5 }

      layer.addTile(cell, tile)

      // Check custom terrain was written
      const mposIdx = cell.Y * GRID_SIZE.X + cell.X
      expect((map.customTerrain as Record<number, number>)[mposIdx]).toBeDefined()
    })
  })

  describe('HitTile', () => {
    it('reduces concrete strength', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      const cell = new CPos(5, 5)
      const tile: TerrainTile = { templateId: 88, index: 0 }

      layer.addTile(cell, tile)
      layer.hitTile(cell, 1000)

      expect(layer.getStrength(cell)).toBe(8000)
    })

    it('removes tile when strength below 1', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      const cell = new CPos(1, 1)
      const tile: TerrainTile = { templateId: 88, index: 0 }

      layer.addTile(cell, tile)
      layer.hitTile(cell, 10000)

      expect(layer.hasConcrete(cell)).toBe(false)
      expect(layer.getStrength(cell)).toBe(0)
    })

    it('ignores damage when building is on cell', () => {
      const map = createMockMap()
      const a = createMockActor(map)
      // Add actor map with building
      const building = { Building: {} }
      ;(a.world as unknown as Record<string, unknown>).actorMap = {
        getActorsAt: vi.fn(() => [building]),
      }

      const layer = new BuildableTerrainLayer(a, info)
      const cell = new CPos(3, 3)
      const tile: TerrainTile = { templateId: 88, index: 0 }

      layer.addTile(cell, tile)
      layer.hitTile(cell, 500)

      // Strength should NOT be reduced because a building blocks the damage
      expect(layer.getStrength(cell)).toBe(9000)
    })

    it('ignores damage on zero-strength cell', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      const cell = new CPos(8, 8)

      layer.hitTile(cell, 500)
      // Should not throw, should be no-op
    })
  })

  describe('RemoveTile', () => {
    it('clears concrete from cell', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      const cell = new CPos(4, 4)
      const tile: TerrainTile = { templateId: 88, index: 0 }

      layer.addTile(cell, tile)
      expect(layer.hasConcrete(cell)).toBe(true)

      layer.removeTile(cell)
      expect(layer.hasConcrete(cell)).toBe(false)
    })
  })

  describe('disposing', () => {
    it('clears all state', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      layer.disposing(actor)
      expect(layer.isDisposed).toBe(true)
    })

    it('is idempotent', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      layer.disposing(actor)
      layer.disposing(actor)
      expect(layer.isDisposed).toBe(true)
    })
  })

  describe('tryGetTerrainColorPair', () => {
    it('returns false for cells without concrete', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      const result = layer.tryGetTerrainColorPair({ u: 0, v: 0 }, GRID_SIZE)
      expect(result.hasValue).toBe(false)
    })
  })

  describe('tickRender', () => {
    it('processes dirty tiles', () => {
      const layer = new BuildableTerrainLayer(actor, info)
      const cell = new CPos(2, 2)
      const tile: TerrainTile = { templateId: 88, index: 0 }

      layer.addTile(cell, tile)
      // tickRender should process dirty tiles (may fail without full TerrainSpriteLayer)
      // At minimum, it should not throw
      expect(() => layer.tickRender({})).not.toThrow()
    })
  })
})
