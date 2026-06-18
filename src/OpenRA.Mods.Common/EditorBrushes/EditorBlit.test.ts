/**
 * EditorBlit.test.ts — EditorBlit migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: blit commit/revert logic, CopyRegionContents, GetBlitSourceMask,
 * sparse mask correctness, respectBounds behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { CPos } from '../../OpenRA.Game/CPos.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import { ResourceLayerContentsEmpty } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IResourceLayer, ResourceLayerContents } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { MapBlitFilters, cposKey } from './types.js'
import type { BlitTile, EditorBlitSource } from './types.js'
import { EditorBlit } from './EditorBlit.js'
import type { MapBlitData, EditorActorLayerBlitInterface } from './EditorBlit.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tile(type: number, index: number) { return { type, index } }
function rTile(type: number, index: number) { return { type, index } }

// ---------------------------------------------------------------------------
// Mock Map
// ---------------------------------------------------------------------------

/** In-memory mock map for EditorBlit testing. */
class MockMap implements MapBlitData {
  private _tiles = new Map<string, ReturnType<typeof tile>>()
  private _height = new Map<string, number>()
  private _resources = new Map<string, ReturnType<typeof rTile>>()

  readonly mapSize = { width: 10, height: 10 }

  readonly tiles = {
    contains: (_cell: CPos): boolean => true,
    get: (cell: CPos) => this._tiles.get(cposKey(cell)) ?? tile(0, 0),
    set: (cell: CPos, t: ReturnType<typeof tile>) => { this._tiles.set(cposKey(cell), t) },
  }

  readonly height = {
    contains: (_cell: CPos): boolean => true,
    get: (cell: CPos) => this._height.get(cposKey(cell)) ?? 0,
    set: (cell: CPos, h: number) => { this._height.set(cposKey(cell), h) },
  }

  readonly resources = {
    contains: (_cell: CPos): boolean => true,
    get: (cell: CPos) => this._resources.get(cposKey(cell)) ?? rTile(0, 0),
    set: (cell: CPos, r: ReturnType<typeof rTile>) => { this._resources.set(cposKey(cell), r) },
  }

  contains(_cell: CPos): boolean {
    const { X, Y } = _cell
    return X >= 0 && X < this.mapSize.width && Y >= 0 && Y < this.mapSize.height
  }
}

// ---------------------------------------------------------------------------
// Mock Resource Layer
// ---------------------------------------------------------------------------

class MockResourceLayer implements IResourceLayer {
  private _cells = new Map<string, ResourceLayerContents>()
  readonly info: IResourceLayer['info'] = {
    tryGetTerrainType: () => undefined,
    tryGetResourceIndex: () => undefined,
  }
  get isEmpty(): boolean { return this._cells.size === 0 }
  readonly maxDensity = 10
  readonly validTypes = new Set(['ore', 'gems'])

  getResource(cell: CPos): ResourceLayerContents {
    return this._cells.get(cposKey(cell)) ?? ResourceLayerContentsEmpty
  }

  getMaxDensity(_type: string): number { return this.maxDensity }

  canAddResource(resourceType: string, _cell: CPos, _amount?: number): boolean {
    return this.validTypes.has(resourceType)
  }

  addResource(resourceType: string, cell: CPos, amount: number): number {
    this._cells.set(cposKey(cell), { type: resourceType, density: amount })
    return amount
  }

  clearResources(cell: CPos): void {
    this._cells.delete(cposKey(cell))
  }

  // Stubs for remaining IResourceLayer methods
  isVisible(_cell: CPos): boolean { return true }
  onCellChanged(_cell: CPos, _resourceType: string | null): void {}
  addCellChangedListener(_cb: (cell: CPos, resourceType: string | null) => void): void {}
  removeCellChangedListener(_cb: (cell: CPos, resourceType: string | null) => void): void {}
  removeResource(_resourceType: string, _cell: CPos, _amount?: number): number { return 0 }
  clone(): IResourceLayer & { applySnapshot(_s: unknown): void } { return this }
  applySnapshot(_s: unknown): void {}
}

// ---------------------------------------------------------------------------
// Mock EditorActorPreview — minimal stub for blit tests
// ---------------------------------------------------------------------------

class MockEditorActorPreview {
  readonly id: string
  readonly footprint = new Map<CPos, number>()
  private _ref: Map<string, unknown>

  constructor(id: string, location: CPos) {
    this.id = id
    this.footprint.set(location, 0)
    this._ref = new Map()
    this._ref.set('LocationInit', { type: 'LocationInit', value: location })
  }

  export(): Map<string, unknown> {
    return new Map(this._ref)
  }
}

// ---------------------------------------------------------------------------
// Mock EditorActorLayer — implements EditorActorLayerBlitInterface
// ---------------------------------------------------------------------------

class MockEditorActorLayer implements EditorActorLayerBlitInterface {
  readonly _previews: MockEditorActorPreview[] = []
  readonly _removedRegions: Array<{ region: CellCoordsRegion; mask: ReadonlySet<number> }> = []
  readonly _addedRefs: Map<string, unknown>[][] = []
  readonly _addedPreviews: MockEditorActorPreview[][] = []

  addPreview(preview: MockEditorActorPreview): void {
    this._previews.push(preview)
  }

  previewsInCellRegion(region: CellCoordsRegion): ReturnType<EditorActorLayerBlitInterface['previewsInCellRegion']> {
    return this._previews.filter(p => {
      for (const [cell] of p.footprint) {
        if (region.contains(cell)) return true
      }
      return false
    }) as unknown as ReturnType<EditorActorLayerBlitInterface['previewsInCellRegion']>
  }

  removeRegionWithMask(region: CellCoordsRegion, mask: ReadonlySet<number>): void {
    this._removedRegions.push({ region, mask })
    const toRemove: MockEditorActorPreview[] = []
    for (const p of this._previews) {
      for (const [cell] of p.footprint) {
        if (region.contains(cell) && mask.has(cell.Bits)) {
          toRemove.push(p)
          break
        }
      }
    }
    for (const p of toRemove) {
      const idx = this._previews.indexOf(p)
      if (idx >= 0) this._previews.splice(idx, 1)
    }
  }

  addRange(refs: readonly Map<string, unknown>[]): void {
    this._addedRefs.push([...refs.map(r => new Map(r))])
    for (const ref of refs) {
      const locInit = ref.get('LocationInit') as { type: string; value: CPos } | undefined
      if (locInit) {
        this._previews.push(new MockEditorActorPreview(`added_${this._previews.length}`, locInit.value))
      }
    }
  }

  addRangePreviews(previews: ReturnType<EditorActorLayerBlitInterface['addRangePreviews']> extends (p: infer P) => void ? P : never): void {
    const mockPreviews = previews as unknown as readonly MockEditorActorPreview[]
    this._addedPreviews.push([...mockPreviews])
    this._previews.push(...mockPreviews)
  }
}

// ---------------------------------------------------------------------------
// EditorBlit Tests
// ---------------------------------------------------------------------------

describe('EditorBlit', () => {
  let map: MockMap
  let resourceLayer: MockResourceLayer
  let actorLayer: MockEditorActorLayer

  beforeEach(() => {
    map = new MockMap()
    resourceLayer = new MockResourceLayer()
    actorLayer = new MockEditorActorLayer()
  })

  // -------------------------------------------------------------------------
  // CopyRegionContents (static)
  // -------------------------------------------------------------------------

  describe('CopyRegionContents', () => {
    it('captures full region with all filters (Terrain | Resources | Actors)', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(2, 1))
      for (const cell of region) {
        map.tiles.set(cell, tile(100 + cell.X * 10 + cell.Y, 0))
        map.height.set(cell, 5)
        map.resources.set(cell, rTile(1, 3))
        resourceLayer.addResource('ore', cell, 7)
      }

      const actor = new MockEditorActorPreview('Actor0', new CPos(1, 0))
      actorLayer.addPreview(actor)

      const result = EditorBlit.copyRegionContents(
        map, actorLayer, resourceLayer, region, MapBlitFilters.All,
      )

      expect(result.cellCoords).toBe(region)
      expect(result.tiles.size).toBe(6) // 3x2 = 6 cells
      expect(result.actors.size).toBe(1)
      expect(result.actors.get('Actor0')).toBe(actor)

      const cell00 = result.tiles.get('0,0')!
      expect(cell00.terrainTile.type).toBe(100)
      expect(cell00.height).toBe(5)
      expect(cell00.resourceTile.type).toBe(1)
      expect(cell00.resourceLayerContents?.type).toBe('ore')
      expect(cell00.resourceLayerContents?.density).toBe(7)
    })

    it('captures only terrain when filter is Terrain only', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      for (const cell of region) {
        map.tiles.set(cell, tile(42, 1))
        map.height.set(cell, 3)
        map.resources.set(cell, rTile(2, 4))
        resourceLayer.addResource('gems', cell, 5)
      }
      const actor = new MockEditorActorPreview('Actor0', new CPos(0, 0))
      actorLayer.addPreview(actor)

      const result = EditorBlit.copyRegionContents(
        map, actorLayer, resourceLayer, region, MapBlitFilters.Terrain,
      )

      // Tiles captured (terrain + resources filter triggers tile capture)
      expect(result.tiles.size).toBe(4)
      expect(result.tiles.get('0,0')!.resourceTile.type).toBe(2)
      // Actors NOT captured
      expect(result.actors.size).toBe(0)
    })

    it('captures only actors when filter is Actors only', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(2, 2))
      const actor = new MockEditorActorPreview('Actor0', new CPos(1, 1))
      actorLayer.addPreview(actor)

      const result = EditorBlit.copyRegionContents(
        map, actorLayer, resourceLayer, region, MapBlitFilters.Actors,
      )

      expect(result.tiles.size).toBe(0)
      expect(result.actors.size).toBe(1)
    })

    it('filters tiles by mask when mask is provided', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(2, 2))
      const mask = new Set<number>([
        new CPos(0, 0).Bits,
        new CPos(1, 1).Bits,
      ])

      for (const cell of region) {
        map.tiles.set(cell, tile(10, 0))
      }

      const result = EditorBlit.copyRegionContents(
        map, actorLayer, resourceLayer, region, MapBlitFilters.All, mask,
      )

      expect(result.tiles.size).toBe(2)
      expect(result.tiles.has('0,0')).toBe(true)
      expect(result.tiles.has('1,1')).toBe(true)
      expect(result.tiles.has('2,2')).toBe(false)
    })

    it('includes actor if footprint overlaps mask (even partially)', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(2, 2))
      const actor = new MockEditorActorPreview('Actor0', new CPos(0, 1))
      actor.footprint.set(new CPos(0, 0), 0)
      actorLayer.addPreview(actor)

      const mask = new Set<number>([new CPos(0, 0).Bits])

      const result = EditorBlit.copyRegionContents(
        map, actorLayer, resourceLayer, region, MapBlitFilters.Actors, mask,
      )

      expect(result.actors.size).toBe(1)
    })

    it('excludes actor if footprint does not overlap mask', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(2, 2))
      const actor = new MockEditorActorPreview('Actor0', new CPos(1, 1))
      actorLayer.addPreview(actor)

      const mask = new Set<number>([new CPos(0, 0).Bits])

      const result = EditorBlit.copyRegionContents(
        map, actorLayer, resourceLayer, region, MapBlitFilters.Actors, mask,
      )

      expect(result.actors.size).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // GetBlitSourceMask (static)
  // -------------------------------------------------------------------------

  describe('GetBlitSourceMask', () => {
    it('includes all tile cells in mask with offset applied', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      const tiles = new Map<string, BlitTile>()
      for (const cell of region) {
        tiles.set(cposKey(cell), {
          terrainTile: tile(0, 0),
          resourceTile: rTile(0, 0),
          resourceLayerContents: null,
          height: 0,
        })
      }
      const source: EditorBlitSource = {
        cellCoords: region,
        actors: new Map(),
        tiles,
      } as unknown as EditorBlitSource

      const offset = new CVec(5, 3)
      const mask = EditorBlit.getBlitSourceMask(source, offset)

      expect(mask.size).toBe(4)
      expect(mask.has(CPos.add(new CPos(0, 0), offset).Bits)).toBe(true)
      expect(mask.has(CPos.add(new CPos(1, 0), offset).Bits)).toBe(true)
      expect(mask.has(CPos.add(new CPos(0, 1), offset).Bits)).toBe(true)
      expect(mask.has(CPos.add(new CPos(1, 1), offset).Bits)).toBe(true)
    })

    it('includes actor footprint cells in mask', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(3, 3))
      const actors = new Map<string, MockEditorActorPreview>()
      const actor = new MockEditorActorPreview('Actor0', new CPos(2, 2))
      actors.set(actor.id, actor)

      const source = {
        cellCoords: region,
        actors: actors as unknown as ReadonlyMap<string, unknown>,
        tiles: new Map(),
      } as unknown as EditorBlitSource

      const mask = EditorBlit.getBlitSourceMask(source, CVec.Zero)
      expect(mask.has(new CPos(2, 2).Bits)).toBe(true)
    })

    it('returns empty mask for empty blit source', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(0, 0))
      const source: EditorBlitSource = {
        cellCoords: region,
        actors: new Map(),
        tiles: new Map(),
      }

      const mask = EditorBlit.getBlitSourceMask(source, CVec.Zero)
      expect(mask.size).toBe(0)
    })

    it('throws if tile is outside source region', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      const tiles = new Map<string, BlitTile>()
      tiles.set('5,5', {
        terrainTile: tile(0, 0),
        resourceTile: rTile(0, 0),
        resourceLayerContents: null,
        height: 0,
      })
      const source: EditorBlitSource = {
        cellCoords: region,
        actors: new Map(),
        tiles,
      } as unknown as EditorBlitSource

      expect(() => EditorBlit.getBlitSourceMask(source, CVec.Zero))
        .toThrow('outside of its CellRegion')
    })

    it('throws if actor is entirely outside source region', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(1, 1))
      const actors = new Map<string, MockEditorActorPreview>()
      const actor = new MockEditorActorPreview('Actor0', new CPos(5, 5))
      actors.set(actor.id, actor)

      const source = {
        cellCoords: region,
        actors: actors as unknown as ReadonlyMap<string, unknown>,
        tiles: new Map(),
      } as unknown as EditorBlitSource

      expect(() => EditorBlit.getBlitSourceMask(source, CVec.Zero))
        .toThrow('actor entirely outside')
    })
  })

  // -------------------------------------------------------------------------
  // Commit (apply blit data)
  // -------------------------------------------------------------------------

  describe('Commit', () => {
    function makeSource(
      topLeft: CPos,
      bottomRight: CPos,
      tileData: Array<{ pos: CPos; terrainType: number; height: number; resType?: string; resDensity?: number }>,
      actors: MockEditorActorPreview[] = [],
    ): EditorBlitSource {
      const region = new CellCoordsRegion(topLeft, bottomRight)
      const tiles = new Map<string, BlitTile>()
      for (const d of tileData) {
        tiles.set(cposKey(d.pos), {
          terrainTile: tile(d.terrainType, 0),
          resourceTile: rTile(d.resType ? 1 : 0, d.resDensity ?? 0),
          resourceLayerContents: d.resType ? { type: d.resType, density: d.resDensity ?? 1 } : null,
          height: d.height,
        })
      }
      const actorsMap = new Map<string, MockEditorActorPreview>()
      for (const a of actors) actorsMap.set(a.id, a)
      return { cellCoords: region, actors: actorsMap as unknown as ReadonlyMap<string, unknown>, tiles } as unknown as EditorBlitSource
    }

    it('copies terrain tiles and heights to target offset', () => {
      const source = makeSource(
        new CPos(0, 0), new CPos(1, 1),
        [
          { pos: new CPos(0, 0), terrainType: 100, height: 3 },
          { pos: new CPos(1, 0), terrainType: 101, height: 4 },
          { pos: new CPos(0, 1), terrainType: 102, height: 5 },
          { pos: new CPos(1, 1), terrainType: 103, height: 6 },
        ],
      )

      const blit = new EditorBlit(
        MapBlitFilters.Terrain,
        resourceLayer,
        new CPos(5, 5),
        map,
        source,
        actorLayer,
        false,
      )

      blit.commit()

      expect(map.tiles.get(new CPos(5, 5)).type).toBe(100)
      expect(map.height.get(new CPos(5, 5))).toBe(3)
      expect(map.tiles.get(new CPos(6, 5)).type).toBe(101)
      expect(map.height.get(new CPos(6, 5))).toBe(4)
      expect(map.tiles.get(new CPos(5, 6)).type).toBe(102)
      expect(map.height.get(new CPos(5, 6))).toBe(5)
      expect(map.tiles.get(new CPos(6, 6)).type).toBe(103)
      expect(map.height.get(new CPos(6, 6))).toBe(6)
    })

    it('copies resources with density preserved and clears existing first', () => {
      resourceLayer.addResource('ore', new CPos(5, 5), 3)

      const source = makeSource(
        new CPos(0, 0), new CPos(0, 0),
        [{ pos: new CPos(0, 0), terrainType: 50, height: 0, resType: 'gems', resDensity: 8 }],
      )

      const blit = new EditorBlit(
        MapBlitFilters.Resources,
        resourceLayer,
        new CPos(5, 5),
        map,
        source,
        actorLayer,
        false,
      )

      blit.commit()

      const contents = resourceLayer.getResource(new CPos(5, 5))
      expect(contents.type).toBe('gems')
      expect(contents.density).toBe(8)
    })

    it('copies actors with LocationInit offset', () => {
      const actor = new MockEditorActorPreview('Actor0', new CPos(0, 0))
      const source = makeSource(
        new CPos(0, 0), new CPos(1, 1),
        [],
        [actor],
      )

      const blit = new EditorBlit(
        MapBlitFilters.Actors,
        resourceLayer,
        new CPos(3, 4),
        map,
        source,
        actorLayer,
        false,
      )

      blit.commit()

      expect(actorLayer._addedRefs.length).toBe(1)
      expect(actorLayer._addedRefs[0].length).toBe(1)
      const addedRef = actorLayer._addedRefs[0][0]
      const locInit = addedRef.get('LocationInit') as { type: string; value: CPos } | undefined
      expect(locInit).toBeDefined()
      expect(locInit!.value.X).toBe(3)
      expect(locInit!.value.Y).toBe(4)
    })

    it('clears existing actors in the paste region before adding', () => {
      const existingActor = new MockEditorActorPreview('ExistingActor', new CPos(3, 3))
      actorLayer.addPreview(existingActor)

      const sourceActor = new MockEditorActorPreview('SourceActor', new CPos(0, 0))
      const source = makeSource(
        new CPos(0, 0), new CPos(0, 0),
        [{ pos: new CPos(0, 0), terrainType: 10, height: 0 }],
        [sourceActor],
      )

      const blit = new EditorBlit(
        MapBlitFilters.All,
        resourceLayer,
        new CPos(3, 3),
        map,
        source,
        actorLayer,
        false,
      )

      blit.commit()

      expect(actorLayer._removedRegions.length).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Revert (undo blit)
  // -------------------------------------------------------------------------

  describe('Revert', () => {
    it('restores original tiles after commit', () => {
      map.tiles.set(new CPos(5, 5), tile(1, 0))
      map.height.set(new CPos(5, 5), 7)

      const source = makeSimpleSource(
        new CPos(0, 0), new CPos(0, 0),
        [{ pos: new CPos(0, 0), terrainType: 99, height: 2 }],
      )

      const blit = new EditorBlit(
        MapBlitFilters.Terrain,
        resourceLayer,
        new CPos(5, 5),
        map,
        source,
        actorLayer,
        false,
      )

      blit.commit()
      expect(map.tiles.get(new CPos(5, 5)).type).toBe(99)
      expect(map.height.get(new CPos(5, 5))).toBe(2)

      blit.revert()
      expect(map.tiles.get(new CPos(5, 5)).type).toBe(1)
      expect(map.height.get(new CPos(5, 5))).toBe(7)
    })

    it('restores original actors after commit', () => {
      const sourceActor = new MockEditorActorPreview('SourceActor', new CPos(0, 0))
      const source = makeSimpleSource(
        new CPos(0, 0), new CPos(0, 0),
        [],
        [sourceActor],
      )

      const blit = new EditorBlit(
        MapBlitFilters.Actors,
        resourceLayer,
        new CPos(3, 3),
        map,
        source,
        actorLayer,
        false,
      )

      blit.commit()
      expect(actorLayer._addedRefs.length).toBe(1)

      blit.revert()
      expect(actorLayer._addedPreviews.length).toBeGreaterThanOrEqual(1)
    })
  })

  // -------------------------------------------------------------------------
  // respectBounds
  // -------------------------------------------------------------------------

  describe('respectBounds', () => {
    it('skips tiles outside map bounds when respectBounds=true', () => {
      const source = makeSimpleSource(
        new CPos(0, 0), new CPos(1, 0),
        [
          { pos: new CPos(0, 0), terrainType: 50, height: 0 },
          { pos: new CPos(1, 0), terrainType: 51, height: 0 },
        ],
      )

      const blit = new EditorBlit(
        MapBlitFilters.Terrain,
        resourceLayer,
        new CPos(9, 0),
        map,
        source,
        actorLayer,
        true,
      )

      blit.commit()

      expect(map.tiles.get(new CPos(9, 0)).type).toBe(50)
      expect(map.tiles.get(new CPos(10, 0)).type).toBe(0)
    })

    it('places tiles outside map bounds when respectBounds=false', () => {
      map.mapSize.width = 20
      map.mapSize.height = 20

      const source = makeSimpleSource(
        new CPos(0, 0), new CPos(0, 0),
        [{ pos: new CPos(0, 0), terrainType: 77, height: 0 }],
      )

      const blit = new EditorBlit(
        MapBlitFilters.Terrain,
        resourceLayer,
        new CPos(15, 15),
        map,
        source,
        actorLayer,
        false,
      )

      blit.commit()

      expect(map.tiles.get(new CPos(15, 15)).type).toBe(77)
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('blit of empty region is a no-op', () => {
      const source: EditorBlitSource = {
        cellCoords: new CellCoordsRegion(new CPos(0, 0), new CPos(0, 0)),
        actors: new Map(),
        tiles: new Map(),
      }

      const blit = new EditorBlit(
        MapBlitFilters.All,
        resourceLayer,
        new CPos(5, 5),
        map,
        source,
        actorLayer,
        false,
      )

      expect(() => blit.commit()).not.toThrow()
      expect(() => blit.revert()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // TileCount / ActorCount
  // -------------------------------------------------------------------------

  describe('TileCount and ActorCount', () => {
    it('returns correct tile and actor counts', () => {
      const tiles = new Map<string, BlitTile>()
      tiles.set('0,0', {
        terrainTile: tile(1, 0), resourceTile: rTile(0, 0),
        resourceLayerContents: null, height: 0,
      })
      tiles.set('1,0', {
        terrainTile: tile(2, 0), resourceTile: rTile(0, 0),
        resourceLayerContents: null, height: 0,
      })

      const actors = new Map<string, MockEditorActorPreview>()
      actors.set('Actor0', new MockEditorActorPreview('Actor0', new CPos(0, 0)))
      actors.set('Actor1', new MockEditorActorPreview('Actor1', new CPos(1, 0)))
      actors.set('Actor2', new MockEditorActorPreview('Actor2', new CPos(2, 0)))

      const source: EditorBlitSource = {
        cellCoords: new CellCoordsRegion(new CPos(0, 0), new CPos(2, 0)),
        actors: actors as unknown as ReadonlyMap<string, unknown>,
        tiles,
      } as unknown as EditorBlitSource

      const blit = new EditorBlit(
        MapBlitFilters.All,
        resourceLayer,
        new CPos(5, 5),
        map,
        source,
        actorLayer,
        false,
      )

      expect(blit.tileCount()).toBe(2)
      expect(blit.actorCount()).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  // Constructor: revert source creation
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates revert source from target area on construction', () => {
      map.tiles.set(new CPos(5, 5), tile(33, 0))
      map.height.set(new CPos(5, 5), 9)
      map.tiles.set(new CPos(6, 5), tile(34, 0))
      map.height.set(new CPos(6, 5), 10)

      const source = makeSimpleSource(
        new CPos(0, 0), new CPos(1, 0),
        [
          { pos: new CPos(0, 0), terrainType: 100, height: 1 },
          { pos: new CPos(1, 0), terrainType: 101, height: 2 },
        ],
      )

      const blit = new EditorBlit(
        MapBlitFilters.Terrain,
        resourceLayer,
        new CPos(5, 5),
        map,
        source,
        actorLayer,
        false,
      )

      blit.commit()
      expect(map.tiles.get(new CPos(5, 5)).type).toBe(100)

      blit.revert()
      expect(map.tiles.get(new CPos(5, 5)).type).toBe(33)
      expect(map.height.get(new CPos(5, 5))).toBe(9)
      expect(map.tiles.get(new CPos(6, 5)).type).toBe(34)
      expect(map.height.get(new CPos(6, 5))).toBe(10)
    })
  })
})

// ---------------------------------------------------------------------------
// Helper for creating simple EditorBlitSource
// ---------------------------------------------------------------------------

function makeSimpleSource(
  topLeft: CPos,
  bottomRight: CPos,
  tileData: Array<{ pos: CPos; terrainType: number; height: number }>,
  actors: MockEditorActorPreview[] = [],
): EditorBlitSource {
  const tiles = new Map<string, BlitTile>()
  for (const d of tileData) {
    tiles.set(cposKey(d.pos), {
      terrainTile: tile(d.terrainType, 0),
      resourceTile: rTile(0, 0),
      resourceLayerContents: null,
      height: d.height,
    })
  }
  const actorsMap = new Map<string, MockEditorActorPreview>()
  for (const a of actors) actorsMap.set(a.id, a)
  return { cellCoords: new CellCoordsRegion(topLeft, bottomRight), actors: actorsMap as unknown as ReadonlyMap<string, unknown>, tiles } as unknown as EditorBlitSource
}
