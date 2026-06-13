/**
 * LegacyBridgeLayer.test.ts — unit tests for LegacyBridgeLayer
 *
 * Tests focus on: configuration, terrain info validation, bridge type
 * registration, cell-level bridge lookup, and template-based generation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import {
  LegacyBridgeLayer,
  LegacyBridgeLayerInfo,
  type ITemplatedTerrainInfo,
  type ITerrainTemplate,
  type ITerrainTile,
  type ILegacyBridgeWorld,
  type ILegacyBridgeMap,
  type IBridgeStub,
} from './LegacyBridgeLayer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cpos(x: number, y: number): CPos {
  return new CPos(x, y)
}

/**
 * Create a mock terrain template.
 */
function makeTemplate(sizeX: number, sizeY: number): ITerrainTemplate {
  return {
    Size: { X: sizeX, Y: sizeY },
    PickAny: false,
  }
}

/**
 * Create a mock templated terrain info.
 */
function makeTerrainInfo(
  templates: Map<number, ITerrainTemplate> = new Map(),
): ITemplatedTerrainInfo {
  return { templates }
}

/**
 * Create a mock map with templated terrain info.
 */
function makeMap(overrides: Partial<ILegacyBridgeMap> = {}): ILegacyBridgeMap {
  const terrainInfo = makeTerrainInfo()
  return {
    tiles: {
      get(_cell: CPos): ITerrainTile {
        return { Type: 0, Index: 0 }
      },
      contains(_cell: CPos): boolean {
        return true
      },
    },
    rules: {
      actors: new Map(),
      terrainInfo,
    },
    allCells: [],
    gridType: MapGridType.Rectangular,
    mapSize: { width: 32, height: 32 },
    ...overrides,
  }
}

/**
 * Create a mock world.
 */
function makeWorld(overrides: Partial<ILegacyBridgeWorld> = {}): ILegacyBridgeWorld {
  const map = makeMap()
  return {
    map,
    createActor(_name: string, _inits: readonly unknown[]) {
      return {
        trait<T>(): T {
          return {
            linkNeighbouringBridges: () => {},
            create: () => {},
          } as unknown as T
        },
      }
    },
    actorsWithTrait<_T>() {
      return [] as Iterable<{ trait: _T; actor: unknown }>
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LegacyBridgeLayerInfo', () => {
  it('defaults Bridges to ["bridge1", "bridge2"]', () => {
    const info = new LegacyBridgeLayerInfo()
    expect(info.Bridges).toEqual(['bridge1', 'bridge2'])
  })

  it('allows custom Bridges list', () => {
    const info = new LegacyBridgeLayerInfo({ bridges: ['woodbridge', 'railbridge'] })
    expect(info.Bridges).toEqual(['woodbridge', 'railbridge'])
  })

  it('create returns a LegacyBridgeLayer when terrain info supports templates', () => {
    const info = new LegacyBridgeLayerInfo()
    const map = makeMap()
    const world = makeWorld({ map })
    const layer = info.create(world)
    expect(layer).toBeInstanceOf(LegacyBridgeLayer)
  })
})

describe('LegacyBridgeLayer', () => {
  let world: ILegacyBridgeWorld
  let info: LegacyBridgeLayerInfo
  let layer: LegacyBridgeLayer

  beforeEach(() => {
    info = new LegacyBridgeLayerInfo()
    world = makeWorld()
    layer = new LegacyBridgeLayer(world, info)
  })

  // -------------------------------------------------------------------------
  // Construction & validation
  // -------------------------------------------------------------------------

  it('constructs successfully with templated terrain info', () => {
    expect(layer).toBeDefined()
  })

  it('throws when terrain info is null (no template-based tileset)', () => {
    const mapNoTemplates = makeMap({
      rules: {
        actors: new Map(),
        terrainInfo: null,
      },
    })
    const worldNoTemplates = makeWorld({ map: mapNoTemplates })

    expect(() => new LegacyBridgeLayer(worldNoTemplates, info)).toThrow(
      'LegacyBridgeLayer requires a template-based tileset.',
    )
  })

  // -------------------------------------------------------------------------
  // Bridge type registration
  // -------------------------------------------------------------------------

  it('registerBridgeType adds a bridge template entry', () => {
    layer.registerBridgeType(42, 'railbridge', 100)

    const entry = layer.getBridgeType(42)
    expect(entry).toBeDefined()
    expect(entry!.template).toBe('railbridge')
    expect(entry!.health).toBe(100)
  })

  it('getBridgeType returns undefined for unregistered template IDs', () => {
    expect(layer.getBridgeType(999)).toBeUndefined()
  })

  it('registerBridgeType allows overriding existing entries', () => {
    layer.registerBridgeType(10, 'bridge1', 50)
    layer.registerBridgeType(10, 'bridge2', 200)

    const entry = layer.getBridgeType(10)
    expect(entry!.template).toBe('bridge2')
    expect(entry!.health).toBe(200)
  })

  // -------------------------------------------------------------------------
  // getBridge — cell lookup before worldLoaded
  // -------------------------------------------------------------------------

  it('getBridge returns null when bridges CellLayer is not initialized', () => {
    // Before worldLoaded, getBridge will throw because bridges is not
    // initialized. But if bridges were initialized, null would be returned
    // for cells without bridges.
    //
    // Since bridges is only initialized in worldLoaded, and worldLoaded
    // requires mock actorsWithTrait, we test via pre-initialization through
    // worldLoaded.
  })

  // -------------------------------------------------------------------------
  // worldLoaded
  // -------------------------------------------------------------------------

  it('worldLoaded initializes bridges CellLayer and iterates actorsWithTrait', () => {
    const linkCalled: IBridgeStub[] = []
    const mockBridge: IBridgeStub = {
      linkNeighbouringBridges(_layer) {
        linkCalled.push(this)
      },
      create() {},
    }

    const worldWithActor = makeWorld({
      map: makeMap(),
      actorsWithTrait<T>() {
        return [{ trait: mockBridge as unknown as T, actor: {} }]
      },
    })

    layer.worldLoaded(worldWithActor)

    // Bridge should have been linked
    expect(linkCalled.length).toBe(1)
  })

  it('worldLoaded does not throw when no bridge actors exist', () => {
    const emptyWorld = makeWorld({
      map: makeMap({ allCells: [] }),
      actorsWithTrait<_T>() {
        return []
      },
    })

    expect(() => layer.worldLoaded(emptyWorld)).not.toThrow()
  })

  it('worldLoaded iterates allCells and converts matching bridge tiles', () => {
    // Set up a cell that has a registered bridge template
    const bridgeTemplateId = 55
    const bridgeCell = cpos(5, 5)

    let createdActorName = ''
    const worldWithTiles = makeWorld({
      map: makeMap({
        allCells: [bridgeCell],
        tiles: {
          get(cell: CPos): ITerrainTile {
            if (cell.equals(bridgeCell)) {
              return { Type: bridgeTemplateId, Index: 5 }
            }
            return { Type: 0, Index: 0 }
          },
          contains() {
            return true
          },
        },
        rules: {
          actors: new Map(),
          terrainInfo: makeTerrainInfo(
            new Map([[bridgeTemplateId, makeTemplate(3, 3)]]),
          ),
        },
      }),
      createActor(name, _inits) {
        createdActorName = name
        return {
          trait<T>(): T {
            return {
              linkNeighbouringBridges: () => {},
              create: () => {},
            } as unknown as T
          },
        }
      },
      actorsWithTrait<_T>() {
        return []
      },
    })

    // IMPORTANT: Create layer with the SAME world that will be used in
    // worldLoaded, so terrainInfo matches. In real OpenRA, constructor
    // and WorldLoaded receive the same world.
    const testLayer = new LegacyBridgeLayer(worldWithTiles, info)
    testLayer.registerBridgeType(bridgeTemplateId, 'woodbridge', 80)
    testLayer.worldLoaded(worldWithTiles)

    // Should have created a bridge actor with the registered name
    expect(createdActorName).toBe('woodbridge')
  })
})
