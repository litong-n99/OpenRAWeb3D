/**
 * PlayerRadarTerrain.test.ts — PlayerRadarTerrain migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, callback registration, color computation,
 * shroud integration, and lifecycle (create → use → dispose).
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — mock only the modules used by the file under test
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  return {
    // PlayerRadarTerrain does not use Babylon.js directly — no mocks needed
  }
})

// ---------------------------------------------------------------------------
// Imports (after vi.mock)
// ---------------------------------------------------------------------------

import { PlayerRadarTerrain, type CellTerrainColorChangedCallback } from './PlayerRadarTerrain'
import { Shroud } from '../../../OpenRA.Game/Traits/Player/Shroud'
import { PPos, MPos } from '../../../OpenRA.Game/MPos'
import { Map as GameMap } from '../../../OpenRA.Game/Map/Map'
import { MapGrid } from '../../../OpenRA.Game/Map/MapGrid'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import type { IRadarTerrainLayer, IGameActor, WorldStub, WorldRendererStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal grid for flat rectangular test maps. */
function makeTestGrid(maxTerrainHeight: number = 0): MapGrid {
  return new MapGrid({ type: MapGridType.Rectangular, maximumTerrainHeight: maxTerrainHeight })
}

/** Minimal terrain info stub for testing getTerrainColorPair. */
interface TestTerrainInfo {
  readonly id: string
  readonly terrainTypes: readonly TestTerrainType[]
  readonly defaultTerrainTile: { type: number; index: number }
  readonly minHeightColorBrightness?: number
  readonly maxHeightColorBrightness?: number
  getTerrainInfo(tile: { type: number; index: number }): TestTerrainType
  tryGetTerrainInfo(tile: { type: number; index: number }): TestTerrainType | null
  getTerrainIndex(tile: { type: number; index: number }): number
}

interface TestTerrainType {
  readonly rampType: number
  readonly minColor: number
  readonly maxColor: number
  getColor(randomFloat: number): number
}

/** Create a simple test map (flat, rectangular). */
function makeTestMap(width: number = 10, height: number = 10, maxTerrainHeight: number = 0): GameMap {
  const grid = makeTestGrid(maxTerrainHeight)
  const tileType: TestTerrainType = {
    rampType: 0,
    minColor: 0xFF00FF00, // green
    maxColor: 0xFF00FF00,
    getColor(_rf: number): number { return this.minColor }
  }
  const terrainInfo: TestTerrainInfo = {
    id: 'test',
    terrainTypes: [tileType],
    defaultTerrainTile: { type: 0, index: 0 },
    getTerrainInfo(_tile: { type: number; index: number }): TestTerrainType { return tileType },
    tryGetTerrainInfo(_tile: { type: number; index: number }): TestTerrainType | null { return tileType },
    getTerrainIndex(_tile: { type: number; index: number }): number { return 0 },
  }
  return GameMap.createBlank(grid, { width, height }, terrainInfo as any)
}

/** Create a mock Shroud with realistic visible/isVisible behavior. */
function makeMockShroud(visibleCells?: Set<string>): Shroud & { fireShroudChanged(puv: PPos): void; _callbacks: ((puv: PPos) => void)[] } {
  const visible = visibleCells ?? new Set<string>()
  const callbacks: ((puv: PPos) => void)[] = []
  const shroud = {
    addOnShroudChanged: vi.fn((cb: (puv: PPos) => void) => { callbacks.push(cb) }),
    removeOnShroudChanged: vi.fn((cb: (puv: PPos) => void) => {
      const idx = callbacks.indexOf(cb)
      if (idx >= 0) callbacks.splice(idx, 1)
    }),
    isVisible: vi.fn((arg: any) => {
      if (arg instanceof MPos) return visible.has(`${arg.U},${arg.V}`)
      return false
    }),
    isExplored: vi.fn(() => true),
    _callbacks: callbacks,
    fireShroudChanged(puv: PPos) {
      for (const cb of callbacks) { cb(puv) }
    },
  }

  return shroud as unknown as Shroud & { fireShroudChanged(puv: PPos): void; _callbacks: ((puv: PPos) => void)[] }
}

/** Create a mock IGameActor (player actor) with Shroud. */
function makeMockActor(shroud: Shroud): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traitsImplementing: vi.fn((_interfaceId: string) => {
      return [shroud]
    }),
  } as unknown as IGameActor
}

/** Create a mock RadarTerrainLayer that returns fixed colors. */
function makeMockRadarLayer(
  leftColor: number,
  rightColor: number,
): IRadarTerrainLayer {
  return {
    addCellEntryChangedListener: vi.fn(),
    removeCellEntryChangedListener: vi.fn(),
    tryGetTerrainColorPair: (_uv: MPos) => {
      return [true, { left: leftColor, right: rightColor }] as [true, { left: number; right: number }]
    },
  } as IRadarTerrainLayer
}

/** Create a minimal mock WorldStub with map and worldActor. */
function makeMockWorld(map: GameMap, radarLayers?: readonly IRadarTerrainLayer[]): WorldStub {
  return {
    actors: [],
    map,
    worldActor: {
      actorId: 999,
      isInWorld: true,
      isDead: false,
      disposed: false,
      traitsImplementing: (_interfaceId: string) => radarLayers ?? [],
    } as unknown as IGameActor,
    addFrameEndTask: vi.fn((fn: (w: WorldStub) => void) => fn({
      actors: [],
      map,
    } as unknown as WorldStub)),
  } as unknown as WorldStub
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlayerRadarTerrain', () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create a PlayerRadarTerrain instance', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)

      const prt = new PlayerRadarTerrain(actor)

      expect(prt).toBeDefined()
      expect(prt.isInitialized).toBe(false)
      expect(shroud.addOnShroudChanged).toHaveBeenCalledTimes(1)
    })

    it('should subscribe to shroud onShroudChanged during construction', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)

      new PlayerRadarTerrain(actor)

      expect(shroud.addOnShroudChanged).toHaveBeenCalledTimes(1)
      const cb = (shroud.addOnShroudChanged as any).mock.calls[0]![0]
      expect(typeof cb).toBe('function')
    })

    it('should throw if actor has no Shroud trait', () => {
      const actor: IGameActor = {
        actorId: 1,
        isInWorld: true,
        isDead: false,
        disposed: false,
        traitsImplementing: () => [],
      } as unknown as IGameActor

      expect(() => new PlayerRadarTerrain(actor)).toThrow(
        'PlayerRadarTerrain requires a Shroud trait',
      )
    })
  })

  // -------------------------------------------------------------------------
  // isInitialized
  // -------------------------------------------------------------------------

  describe('isInitialized', () => {
    it('should be false before worldLoaded', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const prt = new PlayerRadarTerrain(actor)

      expect(prt.isInitialized).toBe(false)
    })

    it('should be true after worldLoaded completes', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      expect(prt.isInitialized).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // worldLoaded
  // -------------------------------------------------------------------------

  describe('worldLoaded', () => {
    it('should create CellLayers after worldLoaded', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      // getTerrainColor should return real values (not [0,0]) after initialization
      const result = prt.getTerrainColor(new MPos(0, 0))
      expect(result).toHaveLength(2)
      // Both colors should be ARGB green (default from our test terrain)
      expect(result[0]).toBe(0xFF00FF00)
      expect(result[1]).toBe(0xFF00FF00)
    })

    it('should populate all cells with terrain colors', () => {
      const shroud = makeMockShroud(new Set(['0,0', '0,1', '1,0', '1,1']))
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      // Test a few cells
      for (const [u, v] of [[0, 0], [0, 1], [2, 3]]) {
        const result = prt.getTerrainColor(new MPos(u, v))
        expect(result[0]).toBe(0xFF00FF00)
        expect(result[1]).toBe(0xFF00FF00)
      }
    })

    it('should subscribe to map.tiles.onCellEntryChanged', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)

      // Spy on CellLayer.onCellEntryChanged
      const onCellEntryChangedSpy = vi.spyOn(map.tiles, 'onCellEntryChanged')

      const prt = new PlayerRadarTerrain(actor)
      prt.worldLoaded(world, {} as WorldRendererStub)

      expect(onCellEntryChangedSpy).toHaveBeenCalled()
    })

    it('should subscribe to radar layer cell changes', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const radarLayer = makeMockRadarLayer(0xFFFF0000, 0xFFFF0000)
      const world = makeMockWorld(map, [radarLayer])

      const prt = new PlayerRadarTerrain(actor)
      prt.worldLoaded(world, {} as WorldRendererStub)

      expect(radarLayer.addCellEntryChangedListener).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getTerrainColor (indexer)
  // -------------------------------------------------------------------------

  describe('getTerrainColor', () => {
    it('should return [0, 0] before initialization', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const prt = new PlayerRadarTerrain(actor)

      const result = prt.getTerrainColor(new MPos(0, 0))
      expect(result).toEqual([0, 0])
    })

    it('should return valid colors after initialization', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      const result = prt.getTerrainColor(new MPos(3, 3))
      expect(result[0]).not.toBe(0)
      expect(result[1]).not.toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Static getColor
  // -------------------------------------------------------------------------

  describe('static getColor', () => {
    it('should use map terrain colors when no radar layers', () => {
      const map = makeTestMap()
      const uv = new MPos(0, 0)

      const [left, right] = PlayerRadarTerrain.getColor(map, [], uv)

      // Default test terrain returns 0xFF00FF00 (green)
      expect(left).toBe(0xFF00FF00)
      expect(right).toBe(0xFF00FF00)
    })

    it('should use radar layer color before map default', () => {
      const map = makeTestMap()
      const uv = new MPos(0, 0)
      const radarLayer = makeMockRadarLayer(0xFF0000FF, 0xFFFF0000) // blue, red

      const [left, right] = PlayerRadarTerrain.getColor(map, [radarLayer], uv)

      expect(left).toBe(0xFF0000FF)   // blue
      expect(right).toBe(0xFFFF0000)  // red
    })

    it('should try multiple layers and use first match', () => {
      const map = makeTestMap()
      const uv = new MPos(0, 0)

      // Layer that returns false (no match)
      const missLayer: IRadarTerrainLayer = {
        addCellEntryChangedListener: vi.fn(),
        removeCellEntryChangedListener: vi.fn(),
        tryGetTerrainColorPair: (_uv: MPos) => [false] as [false],
      }

      // Layer that returns a match
      const hitLayer = makeMockRadarLayer(0xFFFFFF00, 0xFF00FFFF) // yellow, cyan

      const [left, right] = PlayerRadarTerrain.getColor(map, [missLayer, hitLayer], uv)

      expect(left).toBe(0xFFFFFF00)   // yellow
      expect(right).toBe(0xFF00FFFF)  // cyan
    })

    it('should fall back to map default when all layers miss', () => {
      const map = makeTestMap()
      const uv = new MPos(0, 0)

      const missLayer: IRadarTerrainLayer = {
        addCellEntryChangedListener: vi.fn(),
        removeCellEntryChangedListener: vi.fn(),
        tryGetTerrainColorPair: (_uv: MPos) => [false] as [false],
      }

      const [left, right] = PlayerRadarTerrain.getColor(map, [missLayer], uv)

      expect(left).toBe(0xFF00FF00)  // map default green
      expect(right).toBe(0xFF00FF00)
    })

    it('should respect layer priority order', () => {
      const map = makeTestMap()
      const uv = new MPos(0, 0)

      const firstLayer = makeMockRadarLayer(0xFFFFFFFF, 0xFFFFFFFF) // white
      const secondLayer = makeMockRadarLayer(0xFFFF0000, 0xFFFF0000) // red

      const [left, right] = PlayerRadarTerrain.getColor(map, [firstLayer, secondLayer], uv)

      // First layer wins
      expect(left).toBe(0xFFFFFFFF)
      expect(right).toBe(0xFFFFFFFF)
    })
  })

  // -------------------------------------------------------------------------
  // CellTerrainColorChanged callbacks
  // -------------------------------------------------------------------------

  describe('CellTerrainColorChanged callbacks', () => {
    it('should register callbacks', () => {
      const shroud = makeMockShroud(new Set(['0,0']))
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      const callback: CellTerrainColorChangedCallback = vi.fn()
      prt.addCellTerrainColorChangedListener(callback)

      // Access internal state via (prt as any)
      const callbacks = (prt as any)._cellTerrainColorChangedCallbacks as CellTerrainColorChangedCallback[]
      expect(callbacks).toHaveLength(1)
    })

    it('should remove callbacks correctly', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      const cb1 = vi.fn()
      const cb2 = vi.fn()

      prt.addCellTerrainColorChangedListener(cb1)
      prt.addCellTerrainColorChangedListener(cb2)
      expect((prt as any)._cellTerrainColorChangedCallbacks).toHaveLength(2)

      prt.removeCellTerrainColorChangedListener(cb1)
      expect((prt as any)._cellTerrainColorChangedCallbacks).toHaveLength(1)
      // cb2 should still be registered
      expect((prt as any)._cellTerrainColorChangedCallbacks[0]).toBe(cb2)
    })

    it('should not throw when removing non-existent callback', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const prt = new PlayerRadarTerrain(actor)

      const cb = vi.fn()
      expect(() => prt.removeCellTerrainColorChangedListener(cb)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Shroud visibility changes (updateShroudCell)
  // -------------------------------------------------------------------------

  describe('shroud visibility integration', () => {
    it('should update terrain cells when shroud changes', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      // Mark cell (0,0) as visible now
      shroud.isVisible = vi.fn((arg: any) => {
        if (arg instanceof MPos) return arg.U === 0 && arg.V === 0
        return false
      })

      // Fire shroud changed for PPos(0,0)
      shroud.fireShroudChanged(new PPos(0, 0))

      // Cell (0,0) should now have the terrain color
      const result = prt.getTerrainColor(new MPos(0, 0))
      expect(result[0]).toBe(0xFF00FF00)
    })

    it('should still populate all cells initially regardless of visibility', () => {
      const shroud = makeMockShroud(new Set()) // none visible
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      // worldLoaded populates all cells initially via frame-end task
      const result = prt.getTerrainColor(new MPos(1, 1))
      expect(result[0]).not.toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  describe('dispose', () => {
    it('should unsubscribe from shroud onShroudChanged', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const prt = new PlayerRadarTerrain(actor)

      prt.dispose()

      expect(shroud.removeOnShroudChanged).toHaveBeenCalledTimes(1)
    })

    it('should clear callbacks on dispose', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const prt = new PlayerRadarTerrain(actor)

      const cb = vi.fn()
      prt.addCellTerrainColorChangedListener(cb)

      prt.dispose()

      // Callbacks array should be cleared
      expect((prt as any)._cellTerrainColorChangedCallbacks).toHaveLength(0)
    })

    it('should set disposed flag', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const prt = new PlayerRadarTerrain(actor)

      expect(prt.disposed).toBe(false)
      prt.dispose()
      expect(prt.disposed).toBe(true)
    })

    it('should null out terrain color layers on dispose', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const prt = new PlayerRadarTerrain(actor)

      prt.dispose()

      expect((prt as any)._terrainColorLeft).toBeNull()
      expect((prt as any)._terrainColorRight).toBeNull()
    })

    it('should unsubscribe from tile entry changes on dispose after worldLoaded', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const world = makeMockWorld(map)
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      // Spy on offCellEntryChanged
      const offSpy = vi.spyOn(map.tiles, 'offCellEntryChanged')

      prt.dispose()

      expect(offSpy).toHaveBeenCalled()
    })

    it('should double dispose without error', () => {
      const shroud = makeMockShroud()
      const actor = makeMockActor(shroud as unknown as Shroud)
      const prt = new PlayerRadarTerrain(actor)

      prt.dispose()
      expect(() => prt.dispose()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Color brightness scaling (via Map.getTerrainColorPair)
  // -------------------------------------------------------------------------

  describe('color brightness scaling', () => {
    it('should preserve color when no brightness scaling is needed', () => {
      const map = makeTestMap()
      const uv = new MPos(0, 0)

      const [left, right] = map.getTerrainColorPair(uv)

      // Should be the default green color
      expect(left).toBe(0xFF00FF00)
      expect(right).toBe(0xFF00FF00)
    })
  })

  // -------------------------------------------------------------------------
  // RadarLayer integration (worldLoaded with layers)
  // -------------------------------------------------------------------------

  describe('integration', () => {
    it('should use radar layer colors after worldLoaded', () => {
      const shroud = makeMockShroud(new Set(['0,0', '0,1']))
      const actor = makeMockActor(shroud as unknown as Shroud)
      const map = makeTestMap()
      const radarLayer = makeMockRadarLayer(0xFFFF0000, 0xFF0000FF) // red, blue
      const world = makeMockWorld(map, [radarLayer])
      const prt = new PlayerRadarTerrain(actor)

      prt.worldLoaded(world, {} as WorldRendererStub)

      // getTerrainColor for (0,0) should use the radar layer
      const result = prt.getTerrainColor(new MPos(0, 0))
      expect(result[0]).toBe(0xFFFF0000) // red
      expect(result[1]).toBe(0xFF0000FF) // blue
    })
  })
})
