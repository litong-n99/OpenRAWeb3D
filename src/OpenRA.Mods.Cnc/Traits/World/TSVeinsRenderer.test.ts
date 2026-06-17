/**
 * TSVeinsRenderer.test.ts — TSVeinsRenderer migration unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MPos } from '../../../OpenRA.Game/MPos.js'
import {
  TSVeinsRenderer,
  Adjacency,
  BorderIndices,
  HeavyIndices,
  LightIndices,
  Ramp1Indices,
  Ramp2Indices,
  Ramp3Indices,
  Ramp4Indices,
  createTSVeinsRendererInfo,
  type TSVeinsRendererInfo,
  type ResourceLayerContents,
} from './TSVeinsRenderer.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkCell(x: number, y: number): CPos {
  return new CPos(x, y)
}

function mkInfo(overrides?: Partial<TSVeinsRendererInfo> & { resourceType: string; name: string }): TSVeinsRendererInfo {
  return createTSVeinsRendererInfo({
    resourceType: 'Veins',
    name: 'Veins',
    ...overrides,
  })
}

function mkContents(type = 'Veins', density = 10): ResourceLayerContents {
  return { type, density }
}

function mkWorld(mapOverrides: any = {}): any {
  return {
    map: {
      ramp: {
        get(_cell: CPos): number { return 0 },
      },
      resources: {
        get(_cell: CPos): ResourceLayerContents { return { type: '', density: 0 } },
        contains(_cell: CPos): boolean { return true },
      },
      rules: {
        terrainInfo: {
          terrainTypes: [{ color: { toArgb: 0xFF00FF00, R: 0, G: 255, B: 0, A: 255 } }],
          getTerrainIndex(_t: string): number { return 0 },
        },
        actors: {},
      },
      sequences: {
        getSequence(_img: string, _seq: string): any {
          return {
            getSprite(_f: number): any { return {} },
            getAlpha(_f: number): number { return 1 },
            ignoreWorldTint: false,
            scale: 1,
          }
        },
      },
      allCells: [],
      mapSize: { Width: 64, Height: 64 },
      actorDefinitions: new Map(),
      ...mapOverrides,
    },
    actors: [],
    actorAdded: undefined as any,
    actorRemoved: undefined as any,
  }
}

function mkRenderer(info?: TSVeinsRendererInfo, world?: any): TSVeinsRenderer {
  const i = info ?? mkInfo()
  const w = world ?? mkWorld()

  const self: any = {
    world: w,
    getTrait(_name: string): any {
      return {
        info: {
          tryGetTerrainType(_rt: string): string | undefined { return 'Vein' },
          tryGetResourceIndex(_rt: string): number | undefined { return 1 },
        },
        getResource(_c: CPos): ResourceLayerContents { return { type: 'Veins', density: 10 } },
        getMaxDensity(_rt: string): number { return 10 },
        isVisible(_c: CPos): boolean { return true },
        onCellChanged(_c: CPos, _rt: string | null): void {},
        addCellChangedListener(_fn: Function): void {},
        removeCellChangedListener(_fn: Function): void {},
      }
    },
    info: { name: 'world' },
    owner: { playerName: 'neutral' },
  }

  return new TSVeinsRenderer(self, i)
}

// ---------------------------------------------------------------------------
// Adjacency enum tests
// ---------------------------------------------------------------------------

describe('Adjacency', () => {
  it('has correct flag values', () => {
    expect(Adjacency.None).toBe(0x0)
    expect(Adjacency.MinusX).toBe(0x1)
    expect(Adjacency.PlusX).toBe(0x2)
    expect(Adjacency.MinusY).toBe(0x4)
    expect(Adjacency.PlusY).toBe(0x8)
  })

  it('supports bitwise OR', () => {
    const combined = Adjacency.MinusX | Adjacency.PlusY
    expect(combined & Adjacency.MinusX).toBeTruthy()
    expect(combined & Adjacency.PlusY).toBeTruthy()
    expect(combined & Adjacency.MinusY).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// BorderIndices tests
// ---------------------------------------------------------------------------

describe('BorderIndices', () => {
  it('has 15 entries', () => {
    expect(BorderIndices.size).toBe(15)
  })

  it('each entry has at least one index', () => {
    for (const [, indices] of BorderIndices) {
      expect(indices.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('full adjacency maps to [45,46,47]', () => {
    const full = Adjacency.MinusX | Adjacency.PlusX | Adjacency.MinusY | Adjacency.PlusY
    expect(BorderIndices.get(full)).toEqual([45, 46, 47])
  })
})

// ---------------------------------------------------------------------------
// Sprite index constants
// ---------------------------------------------------------------------------

describe('Sprite indices', () => {
  it('HeavyIndices has 4 variants', () => {
    expect(HeavyIndices).toEqual([48, 49, 50, 51])
  })

  it('LightIndices has 1 variant', () => {
    expect(LightIndices).toEqual([52])
  })

  it('Ramp indices are 2 variants each', () => {
    expect(Ramp1Indices.length).toBe(2)
    expect(Ramp2Indices.length).toBe(2)
    expect(Ramp3Indices.length).toBe(2)
    expect(Ramp4Indices.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// TSVeinsRendererInfo tests
// ---------------------------------------------------------------------------

describe('TSVeinsRendererInfo', () => {
  it('requires resourceType and name', () => {
    const info = mkInfo()
    expect(info.resourceType).toBe('Veins')
    expect(info.name).toBe('Veins')
  })

  it('has correct defaults', () => {
    const info = mkInfo()
    expect(info.image).toBe('resources')
    expect(info.sequence).toBe('veins')
    expect(info.palette).toBe('terrain')
    expect(info.veinholeActors.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TSVeinsRenderer tests
// ---------------------------------------------------------------------------

describe('TSVeinsRenderer', () => {
  let renderer: TSVeinsRenderer

  beforeEach(() => {
    renderer = mkRenderer()
  })

  describe('_calculateCellIndices', () => {
    it('returns HeavyIndices for max-density vein on flat terrain', () => {
      const result = renderer._calculateCellIndices(
        mkContents('Veins', 10),
        mkCell(5, 5),
      )
      expect(result).toEqual(HeavyIndices)
    })

    it('returns LightIndices for sub-max-density vein', () => {
      const result = renderer._calculateCellIndices(
        mkContents('Veins', 5),
        mkCell(5, 5),
      )
      expect(result).toEqual(LightIndices)
    })

    it('returns null for non-vein resource type', () => {
      const result = renderer._calculateCellIndices(
        mkContents('Tiberium', 10),
        mkCell(5, 5),
      )
      expect(result).toBeNull()
    })

    it('returns null for zero density', () => {
      const result = renderer._calculateCellIndices(
        mkContents('Veins', 0),
        mkCell(5, 5),
      )
      expect(result).toBeNull()
    })
  })

  describe('_hasBorder', () => {
    it('returns false for cell not in renderIndices', () => {
      // renderIndices is a stub, contains() returns false
      const result = renderer._hasBorder(mkCell(5, 5))
      expect(result).toBe(false)
    })
  })

  describe('_calculateBorders', () => {
    it('returns Adjacency.None for flat cell with no vein neighbors', () => {
      const result = renderer._calculateBorders(mkCell(5, 5))
      expect(result).toBe(Adjacency.None)
    })
  })

  describe('resourceTypes', () => {
    it('yields the resource type', () => {
      const types = [...renderer.resourceTypes]
      expect(types).toEqual(['Veins'])
    })
  })

  describe('getRenderedResourceType', () => {
    it('returns null for cell with no render indices or borders', () => {
      const result = renderer.getRenderedResourceType(mkCell(5, 5))
      expect(result).toBeNull()
    })
  })

  describe('getRenderedResourceTooltip', () => {
    it('returns null for cell with no render indices or borders', () => {
      const result = renderer.getRenderedResourceTooltip(mkCell(5, 5))
      expect(result).toBeNull()
    })
  })

  describe('disposing', () => {
    it('does not throw', () => {
      expect(() => renderer.disposing()).not.toThrow()
    })

    // Regression BLOCKER #3: .bind(this) creates new function reference; must store bound reference
    it('unregisters the exact listener so it is NOT called after dispose', () => {
      let addedListener: Function | null = null
      let removedListener: Function | null = null

      const addSpy = vi.fn((fn: Function) => { addedListener = fn })
      const removeSpy = vi.fn((fn: Function) => { removedListener = fn })

      const info = mkInfo()
      const w = mkWorld()
      const resourceLayer = {
        info: {
          tryGetTerrainType(_rt: string): string | undefined { return 'Vein' },
          tryGetResourceIndex(_rt: string): number | undefined { return 1 },
        },
        getResource(_c: CPos): ResourceLayerContents { return { type: 'Veins', density: 10 } },
        getMaxDensity(_rt: string): number { return 10 },
        isVisible(_c: CPos): boolean { return true },
        onCellChanged(_c: CPos, _rt: string | null): void {},
        addCellChangedListener: addSpy,
        removeCellChangedListener: removeSpy,
      }

      const self: any = {
        world: w,
        getTrait(_name: string): any { return resourceLayer },
        info: { name: 'world' },
        owner: { playerName: 'neutral' },
      }

      const r = new TSVeinsRenderer(self, info)
      // Verify listener was registered during construction with exact function
      expect(addSpy).toHaveBeenCalledTimes(1)
      expect(addedListener).toBeDefined()

      // Call dispose — should unregister the same function reference
      r.disposing()
      expect(removeSpy).toHaveBeenCalledTimes(1)
      expect(removedListener).toBeDefined()

      // BLOCKER #3 verification: removed function must be === to added function
      // If .bind(this) were called again in disposing(), they would NOT match
      expect(removedListener).toBe(addedListener)
    })
  })

  describe('tryGetTerrainColorPair', () => {
    it('returns false for cell with no data', () => {
      const result = renderer.tryGetTerrainColorPair(new MPos(0, 0))
      expect(result[0]).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// populateMapPreviewSignatureCells tests
// ---------------------------------------------------------------------------

describe('populateMapPreviewSignatureCells', () => {
  it('returns early when no resourceLayer info', () => {
    const buffer: Array<{ uv: MPos; color: any }> = []
    const map: any = {
      mapSize: { Width: 2, Height: 2 },
      actorDefinitions: new Map(),
      ramp: { get: () => 0 },
      rampGet: () => 0,
      resources: {
        get: () => ({ type: '', density: 0 }),
        contains: () => false,
      },
      rules: {
        terrainInfo: {
          terrainTypes: [{ color: { toArgb: 0 } }],
          getTerrainIndex: () => 0,
        },
        actors: {},
      },
    }
    const ai = {
      traitInfoOrDefault(_type: string): null { return null },
    }
    TSVeinsRenderer.populateMapPreviewSignatureCells(
      map, ai, undefined, buffer, mkInfo(),
    )
    expect(buffer.length).toBe(0)
  })
})
