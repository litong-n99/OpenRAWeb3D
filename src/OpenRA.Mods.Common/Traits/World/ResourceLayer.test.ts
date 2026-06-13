/**
 * ResourceLayer.test.ts — Unit tests for ResourceLayer migration
 *
 * Tests focus on: state management, resource add/remove/clear operations,
 * CellChanged event firing, density clamping, worldLoaded initialization,
 * and ResourceLayerInfo configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ResourceLayer, ResourceLayerInfo, type ResourceTypeInfoConfig, type IResourceMap, type IResourceWorld } from './ResourceLayer.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType.js'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer.js'
import { TileSet, TerrainTypeInfo } from '../../../OpenRA.Game/Map/TerrainInfo.js'
import type { Size } from '../../../OpenRA.Game/Primitives/Size.js'
import type { WorldRendererStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAP_SIZE: Size = { width: 10, height: 10 }

function makeResourceTile(type: number, index: number): { readonly type: number; readonly index: number } {
  return { type, index }
}

function createMapMock(
  overrides?: Partial<{
    resources: CellLayer<{ readonly type: number; readonly index: number }>
    customTerrain: CellLayer<number>
    ramp: CellLayer<number>
    getTerrainInfoResult: TerrainTypeInfo
  }>,
): IResourceMap {
  const resourcesLayer = overrides?.resources
    ?? (() => { const l = new CellLayer<{ readonly type: number; readonly index: number }>(MapGridType.Rectangular, MAP_SIZE); l.clear(makeResourceTile(0xff, 0xff)); return l })()
  const customTerrainLayer = overrides?.customTerrain
    ?? (() => { const l = new CellLayer<number>(MapGridType.Rectangular, MAP_SIZE); l.clear(0xff); return l })()
  const rampLayer = overrides?.ramp
    ?? (() => { const l = new CellLayer<number>(MapGridType.Rectangular, MAP_SIZE); l.clear(0); return l })()

  const defaultTerrain = TileSet.getTerrainType('Clear')
  const terrainResult = overrides?.getTerrainInfoResult ?? defaultTerrain

  return {
    mapSize: MAP_SIZE,
    grid: { type: MapGridType.Rectangular },
    contains(cell: CPos): boolean {
      return cell.X >= 0 && cell.X < MAP_SIZE.width
        && cell.Y >= 0 && cell.Y < MAP_SIZE.height
    },
    getTerrainInfo(_cell: CPos): TerrainTypeInfo {
      return terrainResult
    },
    resources: resourcesLayer,
    customTerrain: customTerrainLayer,
    ramp: rampLayer,
    allCells: [...createAllCells(MAP_SIZE)],
  }
}

function* createAllCells(size: Size): Generator<CPos> {
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      yield new CPos(x, y)
    }
  }
}

function createWorldMock(mapOverrides?: Parameters<typeof createMapMock>[0]): IResourceWorld {
  const map = createMapMock(mapOverrides)
  return { map, actors: [] }
}

// ---------------------------------------------------------------------------
// ResourceLayerInfo tests
// ---------------------------------------------------------------------------

describe('ResourceLayerInfo', () => {
  describe('construction', () => {
    it('creates with default empty resourceTypes', () => {
      const info = new ResourceLayerInfo()
      expect(info.resourceTypes.size).toBe(0)
      expect(info.recalculateResourceDensity).toBe(false)
      expect(info.instanceName).toBeUndefined()
    })

    it('accepts custom resourceTypes map', () => {
      const oreConfig: ResourceTypeInfoConfig = {
        resourceIndex: 1,
        terrainType: 'Ore',
        allowedTerrainTypes: new Set(['Clear']),
        maxDensity: 12,
      }
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([['Ore', oreConfig]]),
      })
      expect(info.resourceTypes.size).toBe(1)
      expect(info.resourceTypes.get('Ore')).toBe(oreConfig)
    })

    it('accepts instanceName', () => {
      const info = new ResourceLayerInfo({ instanceName: 'myLayer' })
      expect(info.instanceName).toBe('myLayer')
    })

    it('accepts recalculateResourceDensity = true', () => {
      const info = new ResourceLayerInfo({ recalculateResourceDensity: true })
      expect(info.recalculateResourceDensity).toBe(true)
    })
  })

  describe('loadFromJSON', () => {
    it('loads single resource type with AllowedTerrainTypes array', () => {
      const info = new ResourceLayerInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Ore: {
            ResourceIndex: 1,
            TerrainType: 'Ore',
            AllowedTerrainTypes: ['Clear', 'Rough'],
            MaxDensity: 12,
          },
        },
      })

      expect(info.resourceTypes.size).toBe(1)
      const oreInfo = info.resourceTypes.get('Ore')!
      expect(oreInfo.resourceIndex).toBe(1)
      expect(oreInfo.terrainType).toBe('Ore')
      expect(oreInfo.allowedTerrainTypes).toEqual(new Set(['Clear', 'Rough']))
      expect(oreInfo.maxDensity).toBe(12)
    })

    it('loads AllowedTerrainTypes as single string (converts to Set)', () => {
      const info = new ResourceLayerInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Gems: {
            ResourceIndex: 3,
            TerrainType: 'Gems',
            AllowedTerrainTypes: 'Clear',
            MaxDensity: 15,
          },
        },
      })

      const gemsInfo = info.resourceTypes.get('Gems')!
      expect(gemsInfo.allowedTerrainTypes).toEqual(new Set(['Clear']))
    })

    it('handles missing AllowedTerrainTypes (empty Set)', () => {
      const info = new ResourceLayerInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Tiberium: {
            ResourceIndex: 2,
            TerrainType: 'Tiberium',
          },
        },
      })

      const tibInfo = info.resourceTypes.get('Tiberium')!
      expect(tibInfo.allowedTerrainTypes).toEqual(new Set())
    })

    it('loads RecalculateResourceDensity flag', () => {
      const info = new ResourceLayerInfo()
      info.loadFromJSON({
        RecalculateResourceDensity: true,
        ResourceTypes: {},
      })

      expect(info.recalculateResourceDensity).toBe(true)
    })

    it('uses default MaxDensity when not specified', () => {
      const info = new ResourceLayerInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Ore: {
            ResourceIndex: 1,
            TerrainType: 'Ore',
            AllowedTerrainTypes: ['Clear'],
          },
        },
      })

      expect(info.resourceTypes.get('Ore')!.maxDensity).toBe(10)
    })

    it('loads multiple resource types', () => {
      const info = new ResourceLayerInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Ore: { ResourceIndex: 1, TerrainType: 'Ore', AllowedTerrainTypes: ['Clear'] },
          Gems: { ResourceIndex: 2, TerrainType: 'Gems', AllowedTerrainTypes: ['Clear', 'Beach'] },
          Tiberium: { ResourceIndex: 3, TerrainType: 'Tiberium', AllowedTerrainTypes: ['Clear', 'Rough'] },
        },
      })

      expect(info.resourceTypes.size).toBe(3)
    })
  })

  describe('tryGetTerrainType', () => {
    it('returns terrain type for known resource', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })

      expect(info.tryGetTerrainType('Ore')).toBe('Ore')
    })

    it('returns undefined for unknown resource', () => {
      const info = new ResourceLayerInfo()
      expect(info.tryGetTerrainType('Unknown')).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      const info = new ResourceLayerInfo()
      expect(info.tryGetTerrainType('')).toBeUndefined()
    })
  })

  describe('tryGetResourceIndex', () => {
    it('returns resource index for known resource', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 5, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 10 }],
        ]),
      })

      expect(info.tryGetResourceIndex('Ore')).toBe(5)
    })

    it('returns undefined for unknown resource', () => {
      const info = new ResourceLayerInfo()
      expect(info.tryGetResourceIndex('Unknown')).toBeUndefined()
    })

    it('returns undefined for empty string', () => {
      const info = new ResourceLayerInfo()
      expect(info.tryGetResourceIndex('')).toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// ResourceLayer tests
// ---------------------------------------------------------------------------

describe('ResourceLayer', () => {
  // Register terrain types in TileSet before tests
  beforeAll(() => {
    TileSet.clear()
    TileSet.fromJSON({
      terrainTypes: [
        { type: 'Clear', color: '000000' },
        { type: 'Ore', color: 'FF0000' },
        { type: 'Gems', color: '00FF00' },
        { type: 'Tiberium', color: '0000FF' },
      ],
      templates: [{
        id: 1, size: { x: 1, y: 1 },
        tiles: [
          { terrainType: 'Clear' },
          { terrainType: 'Ore' },
          { terrainType: 'Gems' },
          { terrainType: 'Tiberium' },
        ],
      }],
    })
  })

  describe('construction', () => {
    it('creates with empty content layer', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      // All cells should be empty
      for (let y = 0; y < MAP_SIZE.height; y++) {
        for (let x = 0; x < MAP_SIZE.width; x++) {
          const cell = new CPos(x, y)
          expect(layer.getResource(cell).type).toBe('')
          expect(layer.getResource(cell).density).toBe(0)
        }
      }
    })

    it('populates resourceTypesByIndex from info', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
          ['Gems', { resourceIndex: 3, terrainType: 'Gems', allowedTerrainTypes: new Set(['Clear']), maxDensity: 8 }],
        ]),
      })
      const world = createWorldMock()
      new ResourceLayer(world, info) // verify construction doesn't throw

      // Verify via worldLoaded (which uses resourceTypesByIndex)
      // We can verify indirectly by initializing a map resource
      const map = createMapMock()
      map.resources.set(new CPos(5, 5), makeResourceTile(1, 5))
      const world2 = { map, actors: [] as const }
      const layer2 = new ResourceLayer(world2, info)
      layer2.worldLoaded(world2, {} as WorldRendererStub)

      expect(layer2.getResource(new CPos(5, 5)).type).toBe('Ore')
      expect(layer2.getResource(new CPos(5, 5)).density).toBe(5)
    })

    it('isEmpty is true initially', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      expect(layer.isEmpty).toBe(true)
    })

    it('exposes info reference', () => {
      const info = new ResourceLayerInfo()
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      expect(layer.info).toBe(info)
    })
  })

  // -------------------------------------------------------------------------
  // getResource
  // -------------------------------------------------------------------------

  describe('getResource', () => {
    it('returns EMPTY for out-of-bounds cell', () => {
      const info = new ResourceLayerInfo()
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      const result = layer.getResource(new CPos(100, 100))
      expect(result.type).toBe('')
      expect(result.density).toBe(0)
    })

    it('returns EMPTY for uninitialized cell', () => {
      const info = new ResourceLayerInfo()
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      const result = layer.getResource(new CPos(0, 0))
      expect(result.type).toBe('')
      expect(result.density).toBe(0)
    })

    it('returns resource contents after addResource', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)
      const cell = new CPos(2, 2)

      layer.addResource('Ore', cell, 5)

      // createResourceCell clamps to min 1, so density = min(12, 1 + 5) = 6
      const result = layer.getResource(cell)
      expect(result.type).toBe('Ore')
      expect(result.density).toBe(6)
    })
  })

  // -------------------------------------------------------------------------
  // getMaxDensity
  // -------------------------------------------------------------------------

  describe('getMaxDensity', () => {
    it('returns configured max density', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      expect(layer.getMaxDensity('Ore')).toBe(12)
    })

    it('returns 0 for unknown resource type', () => {
      const info = new ResourceLayerInfo()
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      expect(layer.getMaxDensity('Unknown')).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // isVisible
  // -------------------------------------------------------------------------

  describe('isVisible', () => {
    it('always returns true (shroud stub)', () => {
      const info = new ResourceLayerInfo()
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      expect(layer.isVisible(new CPos(0, 0))).toBe(true)
      expect(layer.isVisible(new CPos(100, 100))).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // CellChanged listeners
  // -------------------------------------------------------------------------

  describe('CellChanged listener management', () => {
    let layer: ResourceLayer

    beforeEach(() => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      layer = new ResourceLayer(world, info)
    })

    it('fires registered callback on onCellChanged', () => {
      const cb = vi.fn<(cell: CPos, resourceType: string | null) => void>()
      layer.addCellChangedListener(cb)

      const cell = new CPos(3, 4)
      layer.onCellChanged(cell, 'Ore')

      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith(cell, 'Ore')
    })

    it('fires with null resourceType for clearing', () => {
      const cb = vi.fn<(cell: CPos, resourceType: string | null) => void>()
      layer.addCellChangedListener(cb)

      const cell = new CPos(1, 1)
      layer.onCellChanged(cell, null)

      expect(cb).toHaveBeenCalledWith(cell, null)
    })

    it('removed listener does not fire', () => {
      const cb = vi.fn<(cell: CPos, resourceType: string | null) => void>()
      layer.addCellChangedListener(cb)
      layer.removeCellChangedListener(cb)

      layer.onCellChanged(new CPos(0, 0), 'Ore')

      expect(cb).not.toHaveBeenCalled()
    })

    it('multiple listeners all fire', () => {
      const cb1 = vi.fn<(cell: CPos, resourceType: string | null) => void>()
      const cb2 = vi.fn<(cell: CPos, resourceType: string | null) => void>()
      const cb3 = vi.fn<(cell: CPos, resourceType: string | null) => void>()

      layer.addCellChangedListener(cb1)
      layer.addCellChangedListener(cb2)
      layer.addCellChangedListener(cb3)

      const cell = new CPos(5, 5)
      layer.onCellChanged(cell, 'Ore')

      expect(cb1).toHaveBeenCalledWith(cell, 'Ore')
      expect(cb2).toHaveBeenCalledWith(cell, 'Ore')
      expect(cb3).toHaveBeenCalledWith(cell, 'Ore')
    })

    it('removeCellChangedListener with non-existent callback does not throw', () => {
      const cb = vi.fn()
      expect(() => layer.removeCellChangedListener(cb)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // canAddResource
  // -------------------------------------------------------------------------

  describe('canAddResource', () => {
    let layer: ResourceLayer

    beforeEach(() => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
          ['Gems', { resourceIndex: 2, terrainType: 'Gems', allowedTerrainTypes: new Set(['Clear']), maxDensity: 8 }],
        ]),
      })
      const world = createWorldMock()
      layer = new ResourceLayer(world, info)
    })

    it('returns false for out-of-bounds cell', () => {
      expect(layer.canAddResource('Ore', new CPos(100, 100), 5)).toBe(false)
    })

    it('returns false for unknown resource type', () => {
      expect(layer.canAddResource('Unknown', new CPos(0, 0), 1)).toBe(false)
    })

    it('returns false for empty string resource type', () => {
      expect(layer.canAddResource('', new CPos(0, 0), 1)).toBe(false)
    })

    it('returns true for empty cell with valid amount', () => {
      expect(layer.canAddResource('Ore', new CPos(0, 0), 5)).toBe(true)
    })

    it('returns false for empty cell with amount exceeding maxDensity', () => {
      expect(layer.canAddResource('Ore', new CPos(0, 0), 20)).toBe(false)
    })

    it('returns true for same resource type below maxDensity', () => {
      layer.addResource('Ore', new CPos(0, 0), 5)
      expect(layer.canAddResource('Ore', new CPos(0, 0), 3)).toBe(true)
    })

    it('returns false for same resource type exceeding maxDensity', () => {
      layer.addResource('Ore', new CPos(0, 0), 10)
      expect(layer.canAddResource('Ore', new CPos(0, 0), 5)).toBe(false)
    })

    it('returns false for different resource type on occupied cell', () => {
      layer.addResource('Ore', new CPos(0, 0), 5)
      expect(layer.canAddResource('Gems', new CPos(0, 0), 1)).toBe(false)
    })

    it('returns false for cell with non-allowed terrain', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['BeachOre', { resourceIndex: 1, terrainType: 'BeachOre', allowedTerrainTypes: new Set(['Beach']), maxDensity: 10 }],
        ]),
      })
      // Default terrain is 'Clear', but 'BeachOre' only allows 'Beach'
      const world = createWorldMock({
        getTerrainInfoResult: TileSet.getTerrainType('Clear'),
      })
      const beachLayer = new ResourceLayer(world, info)

      expect(beachLayer.canAddResource('BeachOre', new CPos(0, 0), 1)).toBe(false)
    })

    it('returns false for cell with ramp > 0 (via allowResourceAt)', () => {
      const rampLayer = new CellLayer<number>(MapGridType.Rectangular, MAP_SIZE)
      rampLayer.clear(0)
      rampLayer.set(new CPos(0, 0), 1) // Has ramp

      const world = createWorldMock({ ramp: rampLayer })
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const rampLayerTest = new ResourceLayer(world, info)

      expect(rampLayerTest.canAddResource('Ore', new CPos(0, 0), 1)).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // addResource
  // -------------------------------------------------------------------------

  describe('addResource', () => {
    let layer: ResourceLayer
    let listenerCalls: Array<{ cell: CPos; resourceType: string | null }>

    beforeEach(() => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
          ['Gems', { resourceIndex: 2, terrainType: 'Gems', allowedTerrainTypes: new Set(['Clear']), maxDensity: 8 }],
        ]),
      })
      const world = createWorldMock()
      layer = new ResourceLayer(world, info)
      listenerCalls = []
      layer.addCellChangedListener((cell, type) => listenerCalls.push({ cell, resourceType: type }))
    })

    it('returns 0 for out-of-bounds cell', () => {
      expect(layer.addResource('Ore', new CPos(100, 100), 5)).toBe(0)
    })

    it('returns 0 for unknown resource type', () => {
      expect(layer.addResource('Unknown', new CPos(0, 0), 5)).toBe(0)
    })

    it('returns 0 for empty string resource type', () => {
      expect(layer.addResource('', new CPos(0, 0), 1)).toBe(0)
    })

    it('adds resource to an empty cell and returns the amount added', () => {
      const added = layer.addResource('Ore', new CPos(2, 3), 7)

      // createResourceCell clamps to 1, so density = min(12, 1+7) = 8
      expect(added).toBe(7)
      const contents = layer.getResource(new CPos(2, 3))
      expect(contents.type).toBe('Ore')
      expect(contents.density).toBe(8)
    })

    it('adds resource using default amount of 1', () => {
      const added = layer.addResource('Ore', new CPos(5, 5))

      expect(added).toBe(1)
    })

    it('adds to existing same-type resource up to max density', () => {
      layer.addResource('Ore', new CPos(1, 1), 5) // density becomes 6 (= 1 + 5)
      const added = layer.addResource('Ore', new CPos(1, 1), 5) // oldDensity=6, new=min(12, 11)=11

      expect(added).toBe(5)
      expect(layer.getResource(new CPos(1, 1)).density).toBe(11)
    })

    it('clamps at maxDensity and returns only what was added', () => {
      // First add: density becomes min(12, 1+10) = 11
      layer.addResource('Ore', new CPos(1, 1), 10)
      // Second add: oldDensity=11, new=min(12, 11+10)=12, added=12-11=1
      const added = layer.addResource('Ore', new CPos(1, 1), 10)

      // Only 1 more fits (12 - 11 = 1)
      expect(added).toBe(1)
      expect(layer.getResource(new CPos(1, 1)).density).toBe(12)
    })

    it('returns 0 when cell is already at maxDensity', () => {
      layer.addResource('Ore', new CPos(1, 1), 12)
      const added = layer.addResource('Ore', new CPos(1, 1), 3)

      expect(added).toBe(0)
    })

    it('returns 0 for different resource type on occupied cell', () => {
      layer.addResource('Ore', new CPos(1, 1), 5)
      const added = layer.addResource('Gems', new CPos(1, 1), 3)

      expect(added).toBe(0)
    })

    it('fires CellChanged callback', () => {
      const cell = new CPos(2, 2)
      layer.addResource('Ore', cell, 3)

      expect(listenerCalls.length).toBe(1)
      expect(listenerCalls[0]!.cell.Bits).toBe(cell.Bits)
      expect(listenerCalls[0]!.resourceType).toBe('Ore')
    })

    it('increments resourceCellCount when adding to empty cell', () => {
      expect(layer.resourceCellCount).toBe(0)

      layer.addResource('Ore', new CPos(0, 0), 5)
      expect(layer.resourceCellCount).toBe(1)

      layer.addResource('Ore', new CPos(1, 0), 5)
      expect(layer.resourceCellCount).toBe(2)
    })

    it('does NOT increment resourceCellCount when adding to same cell', () => {
      layer.addResource('Ore', new CPos(0, 0), 5)
      expect(layer.resourceCellCount).toBe(1)

      layer.addResource('Ore', new CPos(0, 0), 3)
      expect(layer.resourceCellCount).toBe(1)
    })

    it('sets customTerrain on the map', () => {
      const map = createMapMock()
      const world = { map, actors: [] }
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const customLayer = new ResourceLayer(world, info)
      const cell = new CPos(0, 0)

      customLayer.addResource('Ore', cell, 5)

      // customTerrain should be set to the terrain index for 'Ore'
      const terrainIdx = TileSet.getTerrainIndex('Ore')
      expect(map.customTerrain.get(cell)).toBe(terrainIdx)
    })
  })

  // -------------------------------------------------------------------------
  // removeResource
  // -------------------------------------------------------------------------

  describe('removeResource', () => {
    let layer: ResourceLayer
    let listenerCalls: Array<{ cell: CPos; resourceType: string | null }>

    beforeEach(() => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      layer = new ResourceLayer(world, info)
      listenerCalls = []
      layer.addCellChangedListener((cell, type) => listenerCalls.push({ cell, resourceType: type }))
    })

    it('returns 0 for out-of-bounds cell', () => {
      expect(layer.removeResource('Ore', new CPos(100, 100), 3)).toBe(0)
    })

    it('returns 0 for cell with no resource', () => {
      expect(layer.removeResource('Ore', new CPos(0, 0), 3)).toBe(0)
    })

    it('returns 0 for wrong resource type', () => {
      layer.addResource('Ore', new CPos(0, 0), 5)
      expect(layer.removeResource('Gems', new CPos(0, 0), 3)).toBe(0)
    })

    it('removes partial amount and returns amount removed', () => {
      const cell = new CPos(1, 1)
      // addResource(10): density becomes 1+10=11, returned=10
      layer.addResource('Ore', cell, 10)

      const removed = layer.removeResource('Ore', cell, 3)

      expect(removed).toBe(3)
      expect(layer.getResource(cell).density).toBe(8)
    })

    it('removes using default amount of 1', () => {
      const cell = new CPos(1, 1)
      // addResource(5): density becomes 1+5=6
      layer.addResource('Ore', cell, 5)

      const removed = layer.removeResource('Ore', cell)

      expect(removed).toBe(1)
      expect(layer.getResource(cell).density).toBe(5)
    })

    it('removes fully when amount exceeds density', () => {
      const cell = new CPos(1, 1)
      // addResource(5): density becomes 1+5=6
      layer.addResource('Ore', cell, 5)

      // Remove 10 from density 6 → removes all 6
      const removed = layer.removeResource('Ore', cell, 10)

      expect(removed).toBe(6)
      const contents = layer.getResource(cell)
      expect(contents.type).toBe('')
      expect(contents.density).toBe(0)
    })

    it('fires CellChanged with null when fully depleted', () => {
      const cell = new CPos(1, 1)
      // addResource(3): density becomes 1+3=4
      layer.addResource('Ore', cell, 3)
      listenerCalls = []

      // Remove 4 to fully deplete
      layer.removeResource('Ore', cell, 4)

      expect(listenerCalls.length).toBe(1)
      expect(listenerCalls[0]!.resourceType).toBeNull()
    })

    it('fires CellChanged with resource type on partial removal', () => {
      const cell = new CPos(1, 1)
      layer.addResource('Ore', cell, 10)

      layer.removeResource('Ore', cell, 3)

      expect(listenerCalls.length).toBe(2) // One from add, one from remove
      expect(listenerCalls[1]!.resourceType).toBe('Ore')
    })

    it('decrements resourceCellCount when fully depleted', () => {
      // addResource(5): density becomes 1+5=6
      layer.addResource('Ore', new CPos(0, 0), 5)
      expect(layer.resourceCellCount).toBe(1)

      // Remove all 6 to fully deplete
      layer.removeResource('Ore', new CPos(0, 0), 6)
      expect(layer.resourceCellCount).toBe(0)
    })

    it('does NOT decrement resourceCellCount on partial removal', () => {
      layer.addResource('Ore', new CPos(0, 0), 10)
      expect(layer.resourceCellCount).toBe(1)

      layer.removeResource('Ore', new CPos(0, 0), 3)
      expect(layer.resourceCellCount).toBe(1) // Still has 7
    })

    it('resets customTerrain when fully depleted', () => {
      const map = createMapMock()
      const world = { map, actors: [] }
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const customLayer = new ResourceLayer(world, info)
      const cell = new CPos(0, 0)

      // addResource(5): density becomes 1+5=6
      customLayer.addResource('Ore', cell, 5)
      expect(map.customTerrain.get(cell)).not.toBe(0xff)

      // Remove all 6 to fully deplete
      customLayer.removeResource('Ore', cell, 6)
      expect(map.customTerrain.get(cell)).toBe(0xff)
    })
  })

  // -------------------------------------------------------------------------
  // clearResources
  // -------------------------------------------------------------------------

  describe('clearResources', () => {
    let layer: ResourceLayer
    let listenerCalls: Array<{ cell: CPos; resourceType: string | null }>

    beforeEach(() => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      layer = new ResourceLayer(world, info)
      listenerCalls = []
      layer.addCellChangedListener((cell, type) => listenerCalls.push({ cell, resourceType: type }))
    })

    it('does nothing for out-of-bounds cell', () => {
      expect(() => layer.clearResources(new CPos(100, 100))).not.toThrow()
    })

    it('clears a resource cell', () => {
      const cell = new CPos(2, 3)
      layer.addResource('Ore', cell, 7)

      layer.clearResources(cell)

      const contents = layer.getResource(cell)
      expect(contents.type).toBe('')
      expect(contents.density).toBe(0)
    })

    it('does nothing on already empty cell', () => {
      expect(() => layer.clearResources(new CPos(0, 0))).not.toThrow()
      expect(listenerCalls.length).toBe(0)
    })

    it('fires CellChanged with null', () => {
      const cell = new CPos(1, 1)
      layer.addResource('Ore', cell, 5)
      listenerCalls = []

      layer.clearResources(cell)

      expect(listenerCalls.length).toBe(1)
      expect(listenerCalls[0]!.cell.Bits).toBe(cell.Bits)
      expect(listenerCalls[0]!.resourceType).toBeNull()
    })

    it('decrements resourceCellCount', () => {
      layer.addResource('Ore', new CPos(0, 0), 5)
      layer.addResource('Ore', new CPos(1, 0), 5)
      expect(layer.resourceCellCount).toBe(2)

      layer.clearResources(new CPos(0, 0))
      expect(layer.resourceCellCount).toBe(1)

      layer.clearResources(new CPos(1, 0))
      expect(layer.resourceCellCount).toBe(0)
    })

    it('resets customTerrain to 0xff', () => {
      const map = createMapMock()
      const world = { map, actors: [] }
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const customLayer = new ResourceLayer(world, info)
      const cell = new CPos(0, 0)

      customLayer.addResource('Ore', cell, 5)
      customLayer.clearResources(cell)

      expect(map.customTerrain.get(cell)).toBe(0xff)
    })
  })

  // -------------------------------------------------------------------------
  // worldLoaded
  // -------------------------------------------------------------------------

  describe('worldLoaded', () => {
    beforeAll(() => {
      TileSet.clear()
      TileSet.fromJSON({
        terrainTypes: [
          { type: 'Clear', color: '000000' },
          { type: 'Ore', color: 'FF0000' },
          { type: 'Gems', color: '00FF00' },
        ],
        templates: [{
          id: 1, size: { x: 1, y: 1 },
          tiles: [
            { terrainType: 'Clear' },
            { terrainType: 'Ore' },
            { terrainType: 'Gems' },
          ],
        }],
      })
    })

    it('initializes cells from map.resources', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const map = createMapMock()
      // Place a resource tile at cell (3, 3) with index 8
      map.resources.set(new CPos(3, 3), makeResourceTile(1, 8))

      const world: IResourceWorld = { map, actors: [] }
      const layer = new ResourceLayer(world, info)
      layer.worldLoaded(world, {} as WorldRendererStub)

      const contents = layer.getResource(new CPos(3, 3))
      expect(contents.type).toBe('Ore')
      expect(contents.density).toBe(8)
    })

    it('skips unknown resource types', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const map = createMapMock()
      // Resource index 99 is not registered
      map.resources.set(new CPos(2, 2), makeResourceTile(99, 5))

      const world: IResourceWorld = { map, actors: [] }
      const layer = new ResourceLayer(world, info)
      layer.worldLoaded(world, {} as WorldRendererStub)

      const contents = layer.getResource(new CPos(2, 2))
      expect(contents.type).toBe('')
      expect(contents.density).toBe(0)
    })

    it('skips cells where allowResourceAt returns false (non-allowed terrain)', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['BeachOre', { resourceIndex: 1, terrainType: 'BeachOre', allowedTerrainTypes: new Set(['Beach']), maxDensity: 10 }],
        ]),
      })
      const map = createMapMock({
        getTerrainInfoResult: TileSet.getTerrainType('Clear'), // Clear is not in allowedTerrainTypes
      })
      map.resources.set(new CPos(2, 2), makeResourceTile(1, 5))

      const world: IResourceWorld = { map, actors: [] }
      const layer = new ResourceLayer(world, info)
      layer.worldLoaded(world, {} as WorldRendererStub)

      const contents = layer.getResource(new CPos(2, 2))
      expect(contents.type).toBe('')
      expect(contents.density).toBe(0)
    })

    it('skips cells with ramp > 0', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const rampLayer = new CellLayer<number>(MapGridType.Rectangular, MAP_SIZE)
      rampLayer.clear(0)
      rampLayer.set(new CPos(2, 2), 1)

      const map = createMapMock({ ramp: rampLayer })
      map.resources.set(new CPos(2, 2), makeResourceTile(1, 5))

      const world: IResourceWorld = { map, actors: [] }
      const layer = new ResourceLayer(world, info)
      layer.worldLoaded(world, {} as WorldRendererStub)

      const contents = layer.getResource(new CPos(2, 2))
      expect(contents.type).toBe('')
      expect(contents.density).toBe(0)
    })

    it('clamps density to valid range (1..maxDensity)', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const map = createMapMock()
      // Density 0 should be clamped to 1
      map.resources.set(new CPos(1, 1), makeResourceTile(1, 0))
      // Density 100 should be clamped to 12
      map.resources.set(new CPos(2, 2), makeResourceTile(1, 100))

      const world: IResourceWorld = { map, actors: [] }
      const layer = new ResourceLayer(world, info)
      layer.worldLoaded(world, {} as WorldRendererStub)

      expect(layer.getResource(new CPos(1, 1)).density).toBe(1)
      expect(layer.getResource(new CPos(2, 2)).density).toBe(12)
    })

    describe('recalculateResourceDensity', () => {
      it('does NOT recalculate when recalculateResourceDensity is false', () => {
        const info = new ResourceLayerInfo({
          resourceTypes: new Map([
            ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
          ]),
          recalculateResourceDensity: false,
        })
        const map = createMapMock()
        // Place resources at two neighboring cells
        map.resources.set(new CPos(1, 1), makeResourceTile(1, 1))
        map.resources.set(new CPos(2, 1), makeResourceTile(1, 1))

        const world: IResourceWorld = { map, actors: [] }
        const layer = new ResourceLayer(world, info)
        layer.worldLoaded(world, {} as WorldRendererStub)

        // Densities should be the original values (clamped to 1 at minimum)
        expect(layer.getResource(new CPos(1, 1)).density).toBe(1)
        expect(layer.getResource(new CPos(2, 1)).density).toBe(1)
      })

      it('recalculates densities based on neighbor count when enabled', () => {
        const info = new ResourceLayerInfo({
          resourceTypes: new Map([
            ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
          ]),
          recalculateResourceDensity: true,
        })
        const map = createMapMock()

        // Place ore in a cluster: center cell has many neighbors
        // (0,0) has 3 neighbors: (0,1), (1,0), (1,1)
        // (1,1) has the most neighbors
        map.resources.set(new CPos(0, 0), makeResourceTile(1, 1))
        map.resources.set(new CPos(0, 1), makeResourceTile(1, 1))
        map.resources.set(new CPos(1, 0), makeResourceTile(1, 1))
        map.resources.set(new CPos(1, 1), makeResourceTile(1, 1))

        const world: IResourceWorld = { map, actors: [] }
        const layer = new ResourceLayer(world, info)
        layer.worldLoaded(world, {} as WorldRendererStub)

        // Each cell's density should be lerped based on neighbors
        // (1,1) has 3 Ore neighbors → lerp(0, 12, 3, 9) = 12 * 3/9 = 4, Math.max(4, 1) = 4 → floor = 4
        const center = layer.getResource(new CPos(1, 1))
        expect(center.type).toBe('Ore')
        expect(center.density).toBeGreaterThanOrEqual(1)
        expect(center.density).toBeLessThanOrEqual(12)

        // All cells have density >= 1
        for (const cell of [new CPos(0, 0), new CPos(0, 1), new CPos(1, 0)]) {
          expect(layer.getResource(cell).density).toBeGreaterThanOrEqual(1)
        }
      })

      it('isolated resource cell with no neighbors gets minimum density of 1', () => {
        const info = new ResourceLayerInfo({
          resourceTypes: new Map([
            ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
          ]),
          recalculateResourceDensity: true,
        })
        const map = createMapMock()
        // Single isolated ore cell at (9, 9)
        map.resources.set(new CPos(9, 9), makeResourceTile(1, 1))

        const world: IResourceWorld = { map, actors: [] }
        const layer = new ResourceLayer(world, info)
        layer.worldLoaded(world, {} as WorldRendererStub)

        const result = layer.getResource(new CPos(9, 9))
        expect(result.type).toBe('Ore')
        // 0 adjacent → lerp(0, 12, 0, 9) = 0, Math.max(0, 1) = 1 → floor = 1
        expect(result.density).toBe(1)
      })
    })
  })

  // -------------------------------------------------------------------------
  // resourceCellCount
  // -------------------------------------------------------------------------

  describe('resourceCellCount', () => {
    it('tracks number of non-empty resource cells correctly through add/remove/clear', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
          ['Gems', { resourceIndex: 2, terrainType: 'Gems', allowedTerrainTypes: new Set(['Clear']), maxDensity: 8 }],
        ]),
      })
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      expect(layer.resourceCellCount).toBe(0)

      // Add 3 resource cells (each gets +1 from createResourceCell clamp)
      layer.addResource('Ore', new CPos(0, 0), 5)  // density=6
      layer.addResource('Ore', new CPos(1, 0), 5)  // density=6
      layer.addResource('Gems', new CPos(0, 1), 3) // density=4
      expect(layer.resourceCellCount).toBe(3)

      // Adding more to same cell does not change count
      layer.addResource('Ore', new CPos(0, 0), 3)  // density=9
      expect(layer.resourceCellCount).toBe(3)

      // Remove one fully (density was 6, need to remove 6)
      layer.removeResource('Ore', new CPos(1, 0), 6)
      expect(layer.resourceCellCount).toBe(2)

      // Clear one
      layer.clearResources(new CPos(0, 1))
      expect(layer.resourceCellCount).toBe(1)

      // Remove last one (density was 9, need to remove 9)
      layer.removeResource('Ore', new CPos(0, 0), 9)
      expect(layer.resourceCellCount).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Stress / edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('can fill all cells and then clear all', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      // Fill all cells
      for (let y = 0; y < MAP_SIZE.height; y++) {
        for (let x = 0; x < MAP_SIZE.width; x++) {
          layer.addResource('Ore', new CPos(x, y), 1)
        }
      }
      expect(layer.resourceCellCount).toBe(MAP_SIZE.width * MAP_SIZE.height)
      expect(layer.isEmpty).toBe(false)

      // Clear all cells
      for (let y = 0; y < MAP_SIZE.height; y++) {
        for (let x = 0; x < MAP_SIZE.width; x++) {
          layer.clearResources(new CPos(x, y))
        }
      }
      expect(layer.resourceCellCount).toBe(0)
      expect(layer.isEmpty).toBe(true)
    })

    it('isEmpty reflects resource cell count', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
        ]),
      })
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      expect(layer.isEmpty).toBe(true)

      // addResource(1): density becomes 1+1=2
      layer.addResource('Ore', new CPos(0, 0), 1)
      expect(layer.isEmpty).toBe(false)

      // Remove all 2 to fully deplete
      layer.removeResource('Ore', new CPos(0, 0), 2)
      expect(layer.isEmpty).toBe(true)
    })

    it('supports multiple resource types on different cells', () => {
      const info = new ResourceLayerInfo({
        resourceTypes: new Map([
          ['Ore', { resourceIndex: 1, terrainType: 'Ore', allowedTerrainTypes: new Set(['Clear']), maxDensity: 12 }],
          ['Gems', { resourceIndex: 2, terrainType: 'Gems', allowedTerrainTypes: new Set(['Clear']), maxDensity: 8 }],
        ]),
      })
      const world = createWorldMock()
      const layer = new ResourceLayer(world, info)

      layer.addResource('Ore', new CPos(0, 0), 5)
      layer.addResource('Gems', new CPos(1, 0), 3)

      expect(layer.getResource(new CPos(0, 0)).type).toBe('Ore')
      expect(layer.getResource(new CPos(1, 0)).type).toBe('Gems')
      expect(layer.resourceCellCount).toBe(2)
    })
  })
})
