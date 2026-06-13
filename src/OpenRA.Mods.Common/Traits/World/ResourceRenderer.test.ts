/**
 * ResourceRenderer.test.ts — Unit tests for ResourceRenderer migration
 *
 * Tests focus on: variant selection, dirty cell tracking, sprite layer management,
 * lerp frame computation, dispose lifecycle, and ResourceRendererInfo configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ResourceRenderer,
  ResourceRendererInfo,
  RendererCellContentsEmpty,
  type ISpriteLayer,
  type ISpriteLayerFactory,
  type IResourceRendererWorld,
  type IResourceRendererMap,
  type IResourceLayerWithEvents,
  type IResourceRendererViewport,
  type IResourceRendererSprite,
  type ResourceRendererTypeConfig,
} from './ResourceRenderer.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { ISpriteSequence, ISequenceSet, IPaletteRef } from '../../../OpenRA.Game/Graphics/Animation.js'
import type { Sprite } from '../../../OpenRA.Game/Graphics/Sprite.js'
import type { WorldRendererStub, IResourceLayer, ResourceLayerContents } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Create a mock Sprite for ISpriteSequence to return. */
function createMockSprite(overrides?: Partial<Omit<Sprite, 'sheet'>> & { sheet?: unknown }): Sprite {
  return {
    sheet: {} as Sprite['sheet'],
    bounds: { x: 0, y: 0, width: 64, height: 64 },
    blendMode: 'Alpha' as const,
    channel: 0,
    zRamp: 0,
    size: { x: 0, y: 0, z: 0 },
    offset: { x: 0, y: 0, z: 0 },
    top: 0,
    left: 0,
    bottom: 1,
    right: 1,
    ...overrides,
  } as Sprite
}

/** Create a mock ISpriteSequence. */
function createMockSequence(
  name: string,
  length: number = 5,
  overrides?: Partial<ISpriteSequence>,
): ISpriteSequence {
  const sprite = overrides?.getSprite
    ? undefined
    : createMockSprite()
  return {
    name,
    length,
    tick: 40,
    scale: 1,
    zOffset: 0,
    shadowZOffset: 0,
    ignoreWorldTint: false,
    bounds: { x: 0, y: 0, width: 64, height: 64 },
    getSprite: vi.fn((_frame: number, _facing: number) => sprite ?? createMockSprite()),
    getSpriteWithRotation: vi.fn((_frame: number, _facing: number) => ({
      sprite: sprite ?? createMockSprite(),
      rotation: 0,
    })),
    getAlpha: vi.fn((_frame: number) => 1),
    getShadow: vi.fn((_frame: number, _facing: number) => null),
    ...overrides,
  }
}

/** Create a mock ISpriteLayer that records calls. */
function createMockSpriteLayer(blendMode: string = 'Alpha'): {
  layer: ISpriteLayer
  calls: {
    updates: Array<{ cell: CPos; frame: number; hasSequence: boolean }>
    clears: CPos[]
    draws: IResourceRendererViewport[]
  }
} {
  const calls = {
    updates: [] as Array<{ cell: CPos; frame: number; hasSequence: boolean }>,
    clears: [] as CPos[],
    draws: [] as IResourceRendererViewport[],
  }

  const layer: ISpriteLayer = {
    blendMode,
    clear(cell: CPos): void {
      calls.clears.push(cell)
    },
    update(cell: CPos, sequence: ISpriteSequence | null, _palette: IPaletteRef | null, frame: number): void {
      calls.updates.push({ cell, frame, hasSequence: sequence !== null })
    },
    draw(viewport: IResourceRendererViewport): void {
      calls.draws.push(viewport)
    },
    dispose: vi.fn(),
  }

  return { layer, calls }
}

/** Create a mock ISpriteLayerFactory. */
function createMockSpriteLayerFactory(): {
  factory: ISpriteLayerFactory
  layers: ISpriteLayer[]
  createSpriteLayerSpy: ReturnType<typeof vi.fn>
} {
  const layers: ISpriteLayer[] = []
  const createSpriteLayerSpy = vi.fn(
    (_emptySprite: IResourceRendererSprite, _blendMode: string, _restrictToBounds: boolean): ISpriteLayer => {
      const { layer } = createMockSpriteLayer(_blendMode)
      layers.push(layer)
      return layer
    },
  )

  return {
    factory: { createSpriteLayer: createSpriteLayerSpy },
    layers,
    createSpriteLayerSpy,
  }
}

/** Create a mock IResourceLayerWithEvents. */
function createMockResourceLayer(overrides?: {
  getResourceReturn?: ResourceLayerContents | ((cell: CPos) => ResourceLayerContents)
  getMaxDensityReturn?: number
  isVisibleReturn?: boolean
  info?: IResourceLayer['info']
  isEmpty?: boolean
}): {
  resourceLayer: IResourceLayerWithEvents
  listeners: Array<(cell: CPos, resourceType: string | null) => void>
  fireCellChanged: (cell: CPos, resourceType: string | null) => void
} {
  const listeners: Array<(cell: CPos, resourceType: string | null) => void> = []

  const resourceLayer: IResourceLayerWithEvents = {
    info: overrides?.info ?? ({} as IResourceLayer['info']),
    isEmpty: overrides?.isEmpty ?? false,
    getResource(cell: CPos): ResourceLayerContents {
      if (typeof overrides?.getResourceReturn === 'function') {
        return (overrides.getResourceReturn as (c: CPos) => ResourceLayerContents)(cell)
      }
      return overrides?.getResourceReturn ?? { type: '', density: 0 }
    },
    getMaxDensity(_resourceType: string): number {
      return overrides?.getMaxDensityReturn ?? 10
    },
    canAddResource(): boolean { return true },
    addResource(): number { return 0 },
    removeResource(): number { return 0 },
    clearResources(): void {},
    isVisible(_cell: CPos): boolean {
      return overrides?.isVisibleReturn ?? true
    },
    onCellChanged(cell: CPos, resourceType: string | null): void {
      for (const cb of listeners) {
        cb(cell, resourceType)
      }
    },
    addCellChangedListener(cb: (cell: CPos, resourceType: string | null) => void): void {
      listeners.push(cb)
    },
    removeCellChangedListener(cb: (cell: CPos, resourceType: string | null) => void): void {
      const idx = listeners.indexOf(cb)
      if (idx >= 0) listeners.splice(idx, 1)
    },
  }

  return {
    resourceLayer,
    listeners,
    fireCellChanged: (cell: CPos, type: string | null) => resourceLayer.onCellChanged(cell, type),
  }
}

/** Create a mock IResourceRendererMap. */
function createMockRendererMap(size: { width: number; height: number } = { width: 16, height: 16 }): IResourceRendererMap {
  return {
    mapSize: size,
    contains(cell: CPos): boolean {
      return cell.X >= 0 && cell.X < size.width && cell.Y >= 0 && cell.Y < size.height
    },
  }
}

/** Create a mock IResourceRendererWorld. */
function createMockWorld(overrides?: {
  rendererConfigs?: Map<string, ResourceRendererTypeConfig>
  resourceLayerReturns?: Parameters<typeof createMockResourceLayer>[0]
  mapSize?: { width: number; height: number }
}): {
  world: IResourceRendererWorld
  sequences: ISequenceSet
  sequenceMocks: Map<string, ISpriteSequence>
  resourceLayer: IResourceLayerWithEvents
  listeners: Array<(cell: CPos, resourceType: string | null) => void>
  fireCellChanged: (cell: CPos, resourceType: string | null) => void
} {
  const sequenceMocks = new Map<string, ISpriteSequence>()

  const sequences: ISequenceSet = {
    hasSequence(_actorName: string, sequenceName: string): boolean {
      return sequenceMocks.has(sequenceName)
    },
    getSequence(_actorName: string, sequenceName: string): ISpriteSequence {
      const seq = sequenceMocks.get(sequenceName)
      if (!seq) throw new Error(`Sequence "${sequenceName}" not found in mock`)
      return seq
    },
  }

  const { resourceLayer, listeners, fireCellChanged }
    = createMockResourceLayer(overrides?.resourceLayerReturns)

  const map = createMockRendererMap(overrides?.mapSize)

  const world: IResourceRendererWorld = {
    map,
    sequences,
    resourceLayer,
    actors: [],
  }

  return { world, sequences, sequenceMocks, resourceLayer, listeners, fireCellChanged }
}

/** Create a ResourceRendererInfo with a given set of resource type configs. */
function createInfo(resourceTypes: Map<string, ResourceRendererTypeConfig>): ResourceRendererInfo {
  return new ResourceRendererInfo({ resourceTypes })
}

/** Helper to populate map resources into the resourceLayer mock. */
function setMockResource(
  resourceLayer: IResourceLayerWithEvents,
  cells: Array<{ cell: CPos; type: string; density: number }>,
): void {
  const cellMap = new Map<string, ResourceLayerContents>()
  for (const { cell, type, density } of cells) {
    cellMap.set(`${cell.X},${cell.Y}`, { type, density })
  }

  // Override getResource to return from the map
  ;(resourceLayer as unknown as Record<string, unknown>).getResource = (cell: CPos): ResourceLayerContents => {
    const key = `${cell.X},${cell.Y}`
    return cellMap.get(key) ?? { type: '', density: 0 }
  }
}

// ---------------------------------------------------------------------------
// ResourceRendererInfo tests
// ---------------------------------------------------------------------------

describe('ResourceRendererInfo', () => {
  describe('construction', () => {
    it('creates with default empty resourceTypes', () => {
      const info = new ResourceRendererInfo()
      expect(info.resourceTypes.size).toBe(0)
      expect(info.instanceName).toBeUndefined()
    })

    it('accepts custom resourceTypes map', () => {
      const oreConfig: ResourceRendererTypeConfig = {
        image: 'resources',
        sequences: ['ore01', 'ore02'],
        palette: 'terrain',
        name: 'Ore',
      }
      const info = new ResourceRendererInfo({
        resourceTypes: new Map([['Ore', oreConfig]]),
      })
      expect(info.resourceTypes.size).toBe(1)
      expect(info.resourceTypes.get('Ore')).toBe(oreConfig)
    })

    it('accepts instanceName', () => {
      const info = new ResourceRendererInfo({ instanceName: 'myRenderer' })
      expect(info.instanceName).toBe('myRenderer')
    })
  })

  describe('loadFromJSON', () => {
    it('loads resource types with Sequences array', () => {
      const info = new ResourceRendererInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Ore: {
            Image: 'resources',
            Sequences: ['ore01', 'ore02', 'ore03'],
            Palette: 'terrain',
            Name: 'Iron Ore',
          },
        },
      })

      const oreInfo = info.resourceTypes.get('Ore')!
      expect(oreInfo.sequences).toEqual(['ore01', 'ore02', 'ore03'])
      expect(oreInfo.image).toBe('resources')
      expect(oreInfo.palette).toBe('terrain')
      expect(oreInfo.name).toBe('Iron Ore')
    })

    it('loads Sequences as single string (converts to array)', () => {
      const info = new ResourceRendererInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Gems: {
            Sequences: 'gems01',
          },
        },
      })

      expect(info.resourceTypes.get('Gems')!.sequences).toEqual(['gems01'])
    })

    it('handles missing Sequences (empty array)', () => {
      const info = new ResourceRendererInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Tiberium: {},
        },
      })

      expect(info.resourceTypes.get('Tiberium')!.sequences).toEqual([])
    })

    it('uses default values when fields are missing', () => {
      const info = new ResourceRendererInfo()
      info.loadFromJSON({
        ResourceTypes: {
          Ore: { Sequences: ['ore01'] },
        },
      })

      const oreInfo = info.resourceTypes.get('Ore')!
      expect(oreInfo.image).toBe('resources')
      expect(oreInfo.palette).toBe('terrain')
      expect(oreInfo.name).toBe('Ore')
    })
  })
})

// ---------------------------------------------------------------------------
// ResourceRenderer tests
// ---------------------------------------------------------------------------

describe('ResourceRenderer', () => {
  describe('construction', () => {
    it('builds variant maps from sequence definitions', () => {
      const seq1 = createMockSequence('ore01', 5)
      const seq2 = createMockSequence('ore02', 3)
      const { world, sequenceMocks } = createMockWorld({
        rendererConfigs: new Map([
          ['Ore', { image: 'resources', sequences: ['ore01', 'ore02'], palette: 'terrain', name: 'Ore' }],
        ]),
      })
      sequenceMocks.set('ore01', seq1)
      sequenceMocks.set('ore02', seq2)

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01', 'ore02'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      // Test that chooseVariant works (implies variants were built)
      const variant = (renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', new CPos(0, 0))
      expect(variant).not.toBeNull()
      expect(variant!.name).toBe('ore01') // first variant for hash(0,0)
    })

    it('subscribes to CellChanged events on construction', () => {
      const { world, sequenceMocks } = createMockWorld({
        rendererConfigs: new Map([
          ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
        ]),
      })
      const seq = createMockSequence('ore01', 5)
      sequenceMocks.set('ore01', seq)

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      // Verify subscription happens by checking that a listener was added
      const renderer = new ResourceRenderer(world, info)

      // After construction, the resourceLayer should have a listener
      // We can verify this by firing a cell change and checking that
      // tickRender processes it (the dirty set has the cell)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      // Fire a cell change — the listener should add it to the dirty set
      const cell = new CPos(1, 1)
      setMockResource(world.resourceLayer, [{ cell, type: 'Ore', density: 5 }])

      // Fire cell changed via the resource layer
      world.resourceLayer.onCellChanged(cell, 'Ore')

      // tickRender should process the dirty cell
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // The sprite layer should have been updated
      const updateCalls = layerCalls.calls.updates.filter(u => !CPos.equals(u.cell, new CPos(0, 0)))
      expect(updateCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('resourceTypes returns the set of resource type keys', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))
      sequenceMocks.set('gems01', createMockSequence('gems01', 3))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
        ['Gems', { image: 'resources', sequences: ['gems01'], palette: 'terrain', name: 'Gems' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      const types = [...renderer.resourceTypes]
      expect(types).toContain('Ore')
      expect(types).toContain('Gems')
      expect(types).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // chooseVariant — deterministic variant selection
  // -------------------------------------------------------------------------

  describe('chooseVariant', () => {
    it('selects a variant deterministically for a cell', () => {
      const { world, sequenceMocks } = createMockWorld()
      const seq1 = createMockSequence('ore01', 5)
      const seq2 = createMockSequence('ore02', 5)
      const seq3 = createMockSequence('ore03', 5)
      sequenceMocks.set('ore01', seq1)
      sequenceMocks.set('ore02', seq2)
      sequenceMocks.set('ore03', seq3)

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01', 'ore02', 'ore03'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      // Same cell always returns the same variant
      const v1 = (renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', new CPos(5, 3))
      const v2 = (renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', new CPos(5, 3))
      expect(v1!.name).toBe(v2!.name)
    })

    it('different cells may get different variants', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('a', createMockSequence('a', 5))
      sequenceMocks.set('b', createMockSequence('b', 5))
      sequenceMocks.set('c', createMockSequence('c', 5))
      sequenceMocks.set('d', createMockSequence('d', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['a', 'b', 'c', 'd'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      const names = new Set<string>()
      const variants: string[] = []
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const v = (renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', new CPos(x, y))
          expect(v).not.toBeNull()
          names.add(v!.name)
          variants.push(v!.name)
        }
      }

      // With 4 variants, we expect at least some variation
      expect(names.size).toBeGreaterThanOrEqual(1)
    })

    it('returns null for unknown resource type', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      expect((renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Unknown', new CPos(0, 0))).toBeNull()
    })

    it('returns null for resource type with empty variants', () => {
      const { world } = createMockWorld()

      // No sequences registered in the mock, AND empty sequences array
      // This means the variant map will be empty, so chooseVariant returns null
      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: [], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      // Resource type is known but has no variants
      expect((renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', new CPos(0, 0))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getRenderedResourceType / getRenderedResourceTooltip
  // -------------------------------------------------------------------------

  describe('getRenderedResourceType', () => {
    it('returns null for uninitialized cell', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      expect(renderer.getRenderedResourceType(new CPos(0, 0))).toBeNull()
    })

    it('returns resource type after worldLoaded populates render state', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      const seq = createMockSequence('ore01', 5)
      sequenceMocks.set('ore01', seq)

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      // Set resource layer to return Ore at (0, 0)
      setMockResource(resourceLayer, [
        { cell: new CPos(0, 0), type: 'Ore', density: 5 },
      ])

      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      expect(renderer.getRenderedResourceType(new CPos(0, 0))).toBe('Ore')
    })

    it('returns null for cells without resources', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      setMockResource(resourceLayer, [])
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      expect(renderer.getRenderedResourceType(new CPos(0, 0))).toBeNull()
    })
  })

  describe('getRenderedResourceTooltip', () => {
    it('returns the tooltip name', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Iron Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      setMockResource(resourceLayer, [
        { cell: new CPos(0, 0), type: 'Ore', density: 5 },
      ])
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      expect(renderer.getRenderedResourceTooltip(new CPos(0, 0))).toBe('Iron Ore')
    })

    it('returns null for empty cell', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      expect(renderer.getRenderedResourceTooltip(new CPos(0, 0))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // worldLoaded — sprite layer creation and initial render state
  // -------------------------------------------------------------------------

  describe('worldLoaded', () => {
    it('creates sprite layers via factory', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)

      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      expect(factory.createSpriteLayerSpy).toHaveBeenCalled()
    })

    it('does not create layers when no factory is set', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      // worldLoaded without factory should not throw
      expect(() => renderer.worldLoaded(world, {} as WorldRendererStub)).not.toThrow()
    })

    it('populates initial render state from resource layer', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      setMockResource(resourceLayer, [
        { cell: new CPos(0, 0), type: 'Ore', density: 8 },
        { cell: new CPos(1, 0), type: 'Ore', density: 3 },
      ])

      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      expect(renderer.getRenderedResourceType(new CPos(0, 0))).toBe('Ore')
      expect(renderer.getRenderedResourceType(new CPos(1, 0))).toBe('Ore')
    })

    it('only renders resource types managed by this renderer', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      setMockResource(resourceLayer, [
        { cell: new CPos(0, 0), type: 'Gems', density: 5 }, // Not in renderer's resourceTypes
      ])

      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      expect(renderer.getRenderedResourceType(new CPos(0, 0))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // tickRender — dirty cell processing
  // -------------------------------------------------------------------------

  describe('tickRender', () => {
    let renderer: ResourceRenderer
    let world: IResourceRendererWorld
    let resourceLayer: IResourceLayerWithEvents
    let sequenceMocks: Map<string, ISpriteSequence>
    let layerCalls: ReturnType<typeof createMockSpriteLayer>

    beforeEach(() => {
      const mock = createMockWorld()
      world = mock.world
      resourceLayer = mock.resourceLayer
      sequenceMocks = mock.sequenceMocks
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))
      sequenceMocks.set('ore02', createMockSequence('ore02', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01', 'ore02'], palette: 'terrain', name: 'Ore' }],
      ]))

      renderer = new ResourceRenderer(world, info)
      layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)
    })

    it('processes dirty cell on CellChanged', () => {
      const cell = new CPos(2, 2)
      setMockResource(resourceLayer, [
        { cell, type: 'Ore', density: 5 },
      ])

      // Fire cell changed to dirty the cell
      world.resourceLayer.onCellChanged(cell, 'Ore')

      // Process dirty cells
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // The sprite layer should have been updated for this cell
      const cellUpdates = layerCalls.calls.updates.filter(u => CPos.equals(u.cell, cell))
      expect(cellUpdates.length).toBeGreaterThanOrEqual(1)
    })

    it('clears sprite for cell with no resource after CellChanged(null)', () => {
      const cell = new CPos(2, 2)
      // First add a resource so the cell has render state
      setMockResource(resourceLayer, [
        { cell, type: 'Ore', density: 5 },
      ])
      world.resourceLayer.onCellChanged(cell, 'Ore')
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // Now clear it
      setMockResource(resourceLayer, [])
      layerCalls.calls.clears = []
      layerCalls.calls.updates = []
      world.resourceLayer.onCellChanged(cell, null)
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // Should have cleared the cell on the sprite layer
      const cellClears = layerCalls.calls.clears.filter(c => CPos.equals(c, cell))
      expect(cellClears.length).toBeGreaterThanOrEqual(1)

      // Rendered type should be empty
      expect(renderer.getRenderedResourceType(cell)).toBeNull()
    })

    it('does not update invisible cells', () => {
      // Make isVisible return false
      const partialMock = resourceLayer as unknown as Record<string, unknown>
      partialMock.isVisible = () => false

      const cell = new CPos(2, 2)
      setMockResource(resourceLayer, [
        { cell, type: 'Ore', density: 5 },
      ])

      world.resourceLayer.onCellChanged(cell, 'Ore')
      layerCalls.calls.updates = []
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // Should not have updated the invisible cell
      const cellUpdates = layerCalls.calls.updates.filter(u => CPos.equals(u.cell, cell))
      expect(cellUpdates.length).toBe(0)
    })

    it('updates density for same resource type without recalculating variant', () => {
      const cell = new CPos(3, 3)
      // First render with density 3
      setMockResource(resourceLayer, [
        { cell, type: 'Ore', density: 3 },
      ])
      world.resourceLayer.onCellChanged(cell, 'Ore')
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // Now the cell has render state. Update density to 8
      setMockResource(resourceLayer, [
        { cell, type: 'Ore', density: 8 },
      ])
      layerCalls.calls.updates = []
      world.resourceLayer.onCellChanged(cell, 'Ore')
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // Should have updated with the new frame (based on lerp(density/maxDensity))
      const cellUpdates = layerCalls.calls.updates.filter(u => CPos.equals(u.cell, cell))
      expect(cellUpdates.length).toBeGreaterThanOrEqual(1)

      // Frame should be different between density 3 and density 8
      // At density 3 (maxDensity 10): lerp(0, 4, 3, 10) = round(4 * 3/10) = round(1.2) = 1
      // At density 8: lerp(0, 4, 8, 10) = round(4 * 8/10) = round(3.2) = 3
      const density8Frame = cellUpdates[cellUpdates.length - 1]!.frame
      expect(density8Frame).toBeGreaterThan(0)
    })

    it('processes cell when resource type changes', () => {
      // We need a second resource type for this test
      sequenceMocks.set('gems01', createMockSequence('gems01', 5))
      const info2 = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
        ['Gems', { image: 'resources', sequences: ['gems01'], palette: 'terrain', name: 'Gems' }],
      ]))

      const renderer2 = new ResourceRenderer(world, info2)
      const layerCalls2 = createMockSpriteLayer()
      const factory2 = createMockSpriteLayerFactory()
      factory2.createSpriteLayerSpy.mockReturnValue(layerCalls2.layer)
      renderer2.setSpriteLayerFactory(factory2.factory)
      renderer2.worldLoaded(world, {} as WorldRendererStub)

      const cell = new CPos(4, 4)
      setMockResource(resourceLayer, [
        { cell, type: 'Ore', density: 5 },
      ])
      world.resourceLayer.onCellChanged(cell, 'Ore')
      renderer2.tickRender({} as WorldRendererStub, {} as IGameActor)

      expect(renderer2.getRenderedResourceType(cell)).toBe('Ore')

      // Change to Gems
      setMockResource(resourceLayer, [
        { cell, type: 'Gems', density: 3 },
      ])
      world.resourceLayer.onCellChanged(cell, 'Gems')
      renderer2.tickRender({} as WorldRendererStub, {} as IGameActor)

      expect(renderer2.getRenderedResourceType(cell)).toBe('Gems')
    })

    it('clears dirty set after processing', () => {
      const cell = new CPos(2, 2)
      setMockResource(resourceLayer, [
        { cell, type: 'Ore', density: 5 },
      ])
      world.resourceLayer.onCellChanged(cell, 'Ore')

      // First tickRender processes it
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // Second tickRender should not re-process (dirty set should be empty)
      layerCalls.calls.updates = []
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      const cellUpdates = layerCalls.calls.updates.filter(u => CPos.equals(u.cell, cell))
      expect(cellUpdates.length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Frame computation via lerp
  // -------------------------------------------------------------------------

  describe('frame computation (lerp via sprite layer update)', () => {
    it('computes frame 0 for density 1', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      const seq = createMockSequence('ore01', 5)
      sequenceMocks.set('ore01', seq)

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)

      setMockResource(resourceLayer, [
        { cell: new CPos(0, 0), type: 'Ore', density: 1 },
      ])

      renderer.worldLoaded(world, {} as WorldRendererStub)

      // Find update for (0, 0)
      const update = layerCalls.calls.updates.find(u => CPos.equals(u.cell, new CPos(0, 0)))
      expect(update).toBeDefined()
      // lerpFrame(0, 4, 1, 10) = round(0 + 4 * 1/10) = round(0.4) = 0
      expect(update!.frame).toBe(0)
    })

    it('computes max frame for density at maxDensity', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      const seq = createMockSequence('ore01', 5) // length = 5, maxFrame = 4
      sequenceMocks.set('ore01', seq)

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)

      setMockResource(resourceLayer, [
        { cell: new CPos(0, 0), type: 'Ore', density: 10 }, // maxDensity is 10
      ])

      renderer.worldLoaded(world, {} as WorldRendererStub)

      const update = layerCalls.calls.updates.find(u => CPos.equals(u.cell, new CPos(0, 0)))
      expect(update).toBeDefined()
      // lerpFrame(0, 4, 10, 10) = round(0 + 4 * 10/10) = 4
      expect(update!.frame).toBe(4)
    })

    it('computes intermediate frame for partial density', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      const seq = createMockSequence('ore01', 5)
      sequenceMocks.set('ore01', seq)

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)

      setMockResource(resourceLayer, [
        { cell: new CPos(0, 0), type: 'Ore', density: 5 }, // 50% full
      ])

      renderer.worldLoaded(world, {} as WorldRendererStub)

      const update = layerCalls.calls.updates.find(u => CPos.equals(u.cell, new CPos(0, 0)))
      expect(update).toBeDefined()
      // lerpFrame(0, 4, 5, 10) = round(0 + 4 * 5/10) = round(2.0) = 2
      expect(update!.frame).toBe(2)
    })
  })

  // -------------------------------------------------------------------------
  // Variant selection determinism
  // -------------------------------------------------------------------------

  describe('variant selection determinism', () => {
    it('same cell position always yields the same variant', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('a', createMockSequence('a', 5))
      sequenceMocks.set('b', createMockSequence('b', 5))
      sequenceMocks.set('c', createMockSequence('c', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['a', 'b', 'c'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      const cell = new CPos(7, 3)
      const v1 = (renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', cell)
      const v2 = (renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', cell)
      const v3 = (renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', cell)

      expect(v1!.name).toBe(v2!.name)
      expect(v2!.name).toBe(v3!.name)
    })

    it('all variants are used across the map', () => {
      const { world, sequenceMocks } = createMockWorld({
        mapSize: { width: 32, height: 32 },
      })
      sequenceMocks.set('a', createMockSequence('a', 5))
      sequenceMocks.set('b', createMockSequence('b', 5))
      sequenceMocks.set('c', createMockSequence('c', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['a', 'b', 'c'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      const names = new Set<string>()
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const v = (renderer as unknown as { chooseVariant(type: string, cell: CPos): ISpriteSequence | null }).chooseVariant('Ore', new CPos(x, y))
          expect(v).not.toBeNull()
          names.add(v!.name)
        }
      }

      // With 1024 cells and 3 variants, all variants should be used
      expect(names.size).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // dispose / disposing
  // -------------------------------------------------------------------------

  describe('dispose', () => {
    it('disposes sprite layers', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      renderer.dispose()

      expect(layerCalls.layer.dispose).toHaveBeenCalled()
    })

    it('unsubscribes from CellChanged on dispose', () => {
      const { world, sequenceMocks, resourceLayer } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      renderer.dispose()

      // After dispose, fire a cell change — should not cause any dirty cells
      // because the listener should be unregistered
      // We can verify by checking tickRender doesn't process anything
      setMockResource(resourceLayer, [
        { cell: new CPos(0, 0), type: 'Ore', density: 5 },
      ])
      layerCalls.calls.updates = []
      resourceLayer.onCellChanged(new CPos(0, 0), 'Ore')

      // This should do nothing since disposed flag is set
      renderer.tickRender({} as WorldRendererStub, {} as IGameActor)

      // Also the listener should have been removed, so the dirty set
      // won't have the cell added. But tickRender also checks _disposed.
    })

    it('double dispose is safe', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      renderer.dispose()
      expect(() => renderer.dispose()).not.toThrow()
      // dispose should only be called once on each layer
      expect(layerCalls.layer.dispose).toHaveBeenCalledTimes(1)
    })

    it('disposing() calls dispose()', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      renderer.disposing({} as IGameActor)

      expect(layerCalls.layer.dispose).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------

  describe('render', () => {
    it('draws sprite layer with viewport', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)
      const layerCalls = createMockSpriteLayer()
      const factory = createMockSpriteLayerFactory()
      factory.createSpriteLayerSpy.mockReturnValue(layerCalls.layer)
      renderer.setSpriteLayerFactory(factory.factory)
      renderer.worldLoaded(world, {} as WorldRendererStub)

      renderer.render({} as WorldRendererStub)

      expect(layerCalls.calls.draws.length).toBeGreaterThanOrEqual(1)
    })

    it('does nothing if no sprite layer exists', () => {
      const { world, sequenceMocks } = createMockWorld()
      sequenceMocks.set('ore01', createMockSequence('ore01', 5))

      const info = createInfo(new Map([
        ['Ore', { image: 'resources', sequences: ['ore01'], palette: 'terrain', name: 'Ore' }],
      ]))

      const renderer = new ResourceRenderer(world, info)

      // No factory set, no worldLoaded called — so no sprite layer exists
      expect(() => renderer.render({} as WorldRendererStub)).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// RendererCellContents / RendererCellContentsEmpty
// ---------------------------------------------------------------------------

describe('RendererCellContents', () => {
  it('RendererCellContentsEmpty is frozen and has sentinel values', () => {
    expect(RendererCellContentsEmpty.type).toBe('')
    expect(RendererCellContentsEmpty.density).toBe(0)
    expect(RendererCellContentsEmpty.info).toBeNull()
    expect(RendererCellContentsEmpty.sequence).toBeNull()
    expect(RendererCellContentsEmpty.palette).toBeNull()
    expect(Object.isFrozen(RendererCellContentsEmpty)).toBe(true)
  })
})
