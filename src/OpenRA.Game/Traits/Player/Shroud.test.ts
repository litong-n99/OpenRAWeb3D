/**
 * Shroud.test.ts — Shroud migration unit tests
 *
 * Tests focus on: state management, reference counting, visibility transitions,
 * boundary conditions, sync hash determinism.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Riser } from '../../Map/TerrainInfo'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — Shroud does not use Babylon.js directly, but
// we mock it to ensure no accidental WebGL dependencies
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  __esModule: true,
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  Shroud,
  ShroudInfo,
  SourceType,
  CellVisibility,
} from './Shroud'
import { PPos, MPos } from '../../MPos'
import { CPos } from '../../CPos'
import { WPos } from '../../WPos'
import { WDist } from '../../WDist'
import { Map } from '../../Map/Map'
import { MapGrid } from '../../Map/MapGrid'
import { MapGridType } from '../../Map/MapGridType'
import { WinState } from '../../Player'
import type { IGameActor } from '../TraitsInterfaces'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal 8x8 rectangular map for testing. */
function createTestMap(): Map {
  const grid = new MapGrid({
    type: MapGridType.Rectangular,
    maximumTerrainHeight: 0,
  })
  return Map.createBlank(grid, { width: 8, height: 8 }, {
    id: 'test',
    terrainTypes: [],
    defaultTerrainTile: { type: 0, index: 0 },
    getTerrainInfo: () => ({
      terrainType: 0,
      height: 0,
      rampType: 0,
      minColor: 0,
      maxColor: 0,
      riser: new Riser(),
      getColor: () => 0,
    }),
    tryGetTerrainInfo: () => null,
    getTerrainIndex: () => 0,
  })
}

/** Create a mock IGameActor with the given owner and world. */
function createMockActor(owner: unknown, worldTick: number = 0): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    owner: owner as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    world: { map: createTestMap(), worldTick } as any,
  }
}

/** Create a mock player with the given winState. */
function createMockPlayer(winState: WinState = WinState.Undefined): unknown {
  return {
    winState,
    playerActor: { actorId: 42 },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Shroud', () => {
  let shroud: Shroud
  let actor: IGameActor
  let map: Map

  beforeEach(() => {
    actor = createMockActor(createMockPlayer())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map = (actor.world as any).map
    shroud = new Shroud(actor, new ShroudInfo())
    shroud.created(actor)
  })

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('initializes with all cells as shrouded', () => {
      const puv = new PPos(0, 0)
      expect(shroud.getVisibility(puv)).toBe(CellVisibility.Hidden)
    })

    it('has zero revealed cells initially', () => {
      expect(shroud.revealedCells).toBe(0)
    })

    it('has zero hash initially', () => {
      expect(shroud.hash).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // INotifyCreated
  // -------------------------------------------------------------------------

  describe('created', () => {
    it('sets fogEnabled from info default', () => {
      shroud.created(actor)
      expect(shroud.fogEnabled).toBe(true)
    })

    it('explores all cells when exploreMapEnabled is true', () => {
      const info = new ShroudInfo()
      Object.assign(info, { exploredMapCheckboxEnabled: true, fogCheckboxEnabled: false })
      const shroud2 = new Shroud(actor, info)
      shroud2.created(actor)
      shroud2.tick(actor)

      for (const puv of map.projectedCells) {
        expect(shroud2.isExplored(puv)).toBe(true)
      }
    })

    it('sets revealedCells when fog disabled and explore map enabled', () => {
      const info = new ShroudInfo()
      Object.assign(info, { exploredMapCheckboxEnabled: true, fogCheckboxEnabled: false })
      const shroud2 = new Shroud(actor, info)
      shroud2.created(actor)
      expect(shroud2.revealedCells).toBe(map.projectedCells.length)
    })
  })

  // -------------------------------------------------------------------------
  // AddSource / RemoveSource reference counting
  // -------------------------------------------------------------------------

  describe('addSource / removeSource', () => {
    it('reveals cells with Visibility source', () => {
      const cells = [new PPos(1, 1), new PPos(2, 2)]
      shroud.addSource('source1', SourceType.Visibility, cells)
      shroud.tick(actor)

      for (const puv of cells) {
        expect(shroud.isVisible(puv)).toBe(true)
        expect(shroud.isExplored(puv)).toBe(true)
      }
    })

    it('reveals cells with PassiveVisibility source', () => {
      const cells = [new PPos(1, 1)]
      shroud.addSource('source1', SourceType.PassiveVisibility, cells)
      shroud.tick(actor)

      expect(shroud.isVisible(new PPos(1, 1))).toBe(true)
    })

    it('does not reveal cells with Shroud source', () => {
      const cells = [new PPos(1, 1)]
      shroud.addSource('source1', SourceType.Shroud, cells)
      shroud.tick(actor)

      expect(shroud.isVisible(new PPos(1, 1))).toBe(false)
      expect(shroud.isExplored(new PPos(1, 1))).toBe(false)
    })

    it('throws on duplicate source key', () => {
      const cells = [new PPos(1, 1)]
      shroud.addSource('source1', SourceType.Visibility, cells)
      expect(() => {
        shroud.addSource('source1', SourceType.Visibility, cells)
      }).toThrow('Attempting to add duplicate shroud source')
    })

    it('reference counts overlapping sources', () => {
      const cells = [new PPos(1, 1)]
      shroud.addSource('source1', SourceType.Visibility, cells)
      shroud.addSource('source2', SourceType.Visibility, cells)
      shroud.tick(actor)

      expect(shroud.isVisible(new PPos(1, 1))).toBe(true)

      shroud.removeSource('source1')
      shroud.tick(actor)
      expect(shroud.isVisible(new PPos(1, 1))).toBe(true)

      shroud.removeSource('source2')
      shroud.tick(actor)
      expect(shroud.isVisible(new PPos(1, 1))).toBe(false)
      expect(shroud.isExplored(new PPos(1, 1))).toBe(true)
    })

    it('ignores out-of-bounds cells', () => {
      const cells = [new PPos(100, 100)]
      shroud.addSource('source1', SourceType.Visibility, cells)
      // Should not throw
    })

    it('silently ignores removing non-existent source', () => {
      shroud.removeSource('nonexistent')
      // Should not throw
    })
  })

  // -------------------------------------------------------------------------
  // Tick / UpdateCell
  // -------------------------------------------------------------------------

  describe('tick', () => {
    it('fires onShroudChanged when visibility changes', () => {
      const changedCells: PPos[] = []
      shroud.onShroudChanged = (puv) => changedCells.push(puv)

      const cells = [new PPos(1, 1)]
      shroud.addSource('source1', SourceType.Visibility, cells)
      shroud.tick(actor)

      expect(changedCells.length).toBeGreaterThanOrEqual(1)
      expect(changedCells.some((p) => PPos.equals(p, new PPos(1, 1)))).toBe(true)
    })

    it('does not fire onShroudChanged when no callback registered', () => {
      const cells = [new PPos(1, 1)]
      shroud.addSource('source1', SourceType.Visibility, cells)
      // Should not throw even with null callback
      shroud.tick(actor)
    })

    it('skips tick when no cells touched', () => {
      shroud.onShroudChanged = () => {}
      shroud.tick(actor)
      const hash1 = shroud.hash
      shroud.tick(actor)
      expect(shroud.hash).toBe(hash1)
    })

    it('updates hash deterministically', () => {
      shroud.onShroudChanged = () => {}
      const hash1 = shroud.hash
      shroud.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud.tick(actor)
      const hash2 = shroud.hash
      expect(hash2).not.toBe(hash1)
    })

    it('resets revealedCells to 0 when player has lost', () => {
      const lostActor = createMockActor(createMockPlayer(WinState.Lost))
      const shroud2 = new Shroud(lostActor, new ShroudInfo())
      shroud2.onShroudChanged = () => {}

      shroud2.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud2.tick(lostActor)
      expect(shroud2.revealedCells).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Disabled
  // -------------------------------------------------------------------------

  describe('disabled', () => {
    beforeEach(() => {
      shroud.onShroudChanged = () => {}
    })

    it('all cells return explored when disabled', () => {
      shroud.disabled = true
      shroud.tick(actor)

      for (const puv of map.projectedCells) {
        expect(shroud.isExplored(puv)).toBe(true)
      }
    })

    it('all cells return visible when disabled and fog off', () => {
      shroud.disabled = true
      shroud.tick(actor)

      for (const puv of map.projectedCells) {
        expect(shroud.isVisible(puv)).toBe(true)
      }
    })

    it('setting disabled to same value is no-op', () => {
      shroud.disabled = false
      shroud.tick(actor)
      const hash1 = shroud.hash
      shroud.disabled = false
      shroud.tick(actor)
      expect(shroud.hash).toBe(hash1)
    })
  })

  // -------------------------------------------------------------------------
  // FogEnabled
  // -------------------------------------------------------------------------

  describe('fogEnabled', () => {
    beforeEach(() => {
      shroud.onShroudChanged = () => {}
    })

    it('explored cells remain visible when fog disabled', () => {
      shroud.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud.tick(actor)
      shroud.removeSource('source1')
      shroud.tick(actor)

      // With fog enabled, cell should be explored but not visible
      expect(shroud.isExplored(new PPos(1, 1))).toBe(true)
      expect(shroud.isVisible(new PPos(1, 1))).toBe(false)

      // Now disable fog
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(shroud as any)._fogEnabled = false
      expect(shroud.isVisible(new PPos(1, 1))).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // IsExplored
  // -------------------------------------------------------------------------

  describe('isExplored', () => {
    it('returns false for unexplored cells', () => {
      expect(shroud.isExplored(new PPos(0, 0))).toBe(false)
    })

    it('returns true after exploring a cell', () => {
      shroud.exploreProjectedCells([new PPos(0, 0)])
      shroud.tick(actor)
      expect(shroud.isExplored(new PPos(0, 0))).toBe(true)
    })

    it('works with WPos (projects to cell)', () => {
      const pos = new WPos(1024, 1024, 0)
      shroud.exploreProjectedCells([new PPos(1, 1)])
      shroud.tick(actor)
      expect(shroud.isExplored(pos)).toBe(true)
    })

    it('works with CPos (converts to MPos)', () => {
      const cell = new CPos(1, 1)
      shroud.exploreProjectedCells([new PPos(1, 1)])
      shroud.tick(actor)
      expect(shroud.isExplored(cell)).toBe(true)
    })

    it('works with MPos (checks projected cells covering)', () => {
      const uv = new MPos(1, 1)
      shroud.exploreProjectedCells([new PPos(1, 1)])
      shroud.tick(actor)
      expect(shroud.isExplored(uv)).toBe(true)
    })

    it('returns false for out-of-bounds MPos', () => {
      expect(shroud.isExplored(new MPos(100, 100))).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // IsVisible
  // -------------------------------------------------------------------------

  describe('isVisible', () => {
    it('returns false for unvisited cells', () => {
      expect(shroud.isVisible(new PPos(0, 0))).toBe(false)
    })

    it('returns true for visible cells', () => {
      shroud.addSource('source1', SourceType.Visibility, [new PPos(0, 0)])
      shroud.tick(actor)
      expect(shroud.isVisible(new PPos(0, 0))).toBe(true)
    })

    it('returns false for explored but not visible cells', () => {
      shroud.exploreProjectedCells([new PPos(0, 0)])
      shroud.tick(actor)
      expect(shroud.isVisible(new PPos(0, 0))).toBe(false)
    })

    it('works with WPos', () => {
      const pos = new WPos(1024, 1024, 0)
      shroud.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud.tick(actor)
      expect(shroud.isVisible(pos)).toBe(true)
    })

    it('works with CPos', () => {
      const cell = new CPos(1, 1)
      shroud.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud.tick(actor)
      expect(shroud.isVisible(cell)).toBe(true)
    })

    it('works with MPos', () => {
      const uv = new MPos(1, 1)
      shroud.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud.tick(actor)
      expect(shroud.isVisible(uv)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // GetVisibility
  // -------------------------------------------------------------------------

  describe('getVisibility', () => {
    it('returns Hidden for unvisited cell', () => {
      expect(shroud.getVisibility(new PPos(0, 0))).toBe(CellVisibility.Hidden)
    })

    it('returns Visible | Explored for visible cell', () => {
      shroud.addSource('source1', SourceType.Visibility, [new PPos(0, 0)])
      shroud.tick(actor)
      expect(shroud.getVisibility(new PPos(0, 0))).toBe(
        CellVisibility.Visible | CellVisibility.Explored,
      )
    })

    it('returns Explored for explored-but-fogged cell', () => {
      shroud.exploreProjectedCells([new PPos(0, 0)])
      shroud.tick(actor)
      expect(shroud.getVisibility(new PPos(0, 0))).toBe(CellVisibility.Explored)
    })

    it('works with WPos', () => {
      const pos = new WPos(1024, 1024, 0)
      shroud.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud.tick(actor)
      expect(shroud.getVisibility(pos)).toBe(
        CellVisibility.Visible | CellVisibility.Explored,
      )
    })
  })

  // -------------------------------------------------------------------------
  // ExploreProjectedCells
  // -------------------------------------------------------------------------

  describe('exploreProjectedCells', () => {
    it('marks cells as explored', () => {
      shroud.exploreProjectedCells([new PPos(0, 0), new PPos(1, 1)])
      shroud.tick(actor)
      expect(shroud.isExplored(new PPos(0, 0))).toBe(true)
      expect(shroud.isExplored(new PPos(1, 1))).toBe(true)
    })

    it('ignores already-explored cells', () => {
      shroud.exploreProjectedCells([new PPos(0, 0)])
      shroud.tick(actor)
      shroud.exploreProjectedCells([new PPos(0, 0)])
      shroud.tick(actor)
      expect(shroud.isExplored(new PPos(0, 0))).toBe(true)
    })

    it('ignores out-of-bounds cells', () => {
      shroud.exploreProjectedCells([new PPos(100, 100)])
      // Should not throw
    })
  })

  // -------------------------------------------------------------------------
  // ExploreAll
  // -------------------------------------------------------------------------

  describe('exploreAll', () => {
    it('marks all cells as explored', () => {
      shroud.exploreAll()
      shroud.tick(actor)
      for (const puv of map.projectedCells) {
        expect(shroud.isExplored(puv)).toBe(true)
      }
    })
  })

  // -------------------------------------------------------------------------
  // ResetExploration
  // -------------------------------------------------------------------------

  describe('resetExploration', () => {
    it('resets to only currently visible cells', () => {
      shroud.addSource('source1', SourceType.Visibility, [new PPos(0, 0)])
      shroud.exploreProjectedCells([new PPos(1, 1)])
      shroud.tick(actor)

      expect(shroud.isExplored(new PPos(0, 0))).toBe(true)
      expect(shroud.isExplored(new PPos(1, 1))).toBe(true)

      shroud.removeSource('source1')
      shroud.resetExploration()
      shroud.tick(actor)

      // Cell (0,0) was visible but no longer is → should be unexplored
      expect(shroud.isExplored(new PPos(0, 0))).toBe(false)
      // Cell (1,1) was explored but never visible → should be unexplored
      expect(shroud.isExplored(new PPos(1, 1))).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Explore (deferred)
  // -------------------------------------------------------------------------

  describe('explore (cross-shroud)', () => {
    it('throws not implemented', () => {
      const shroud2 = new Shroud(actor, new ShroudInfo())
      expect(() => shroud.explore(shroud2)).toThrow(
        'Shroud.explore(other) is not yet implemented. TODO-12.DEFERRED.6',
      )
    })
  })

  // -------------------------------------------------------------------------
  // Contains
  // -------------------------------------------------------------------------

  describe('contains', () => {
    it('returns true for in-bounds cells', () => {
      expect(shroud.contains(new PPos(0, 0))).toBe(true)
      expect(shroud.contains(new PPos(7, 7))).toBe(true)
    })

    it('returns false for out-of-bounds cells', () => {
      expect(shroud.contains(new PPos(100, 100))).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // RevealedCells
  // -------------------------------------------------------------------------

  describe('revealedCells', () => {
    beforeEach(() => {
      shroud.onShroudChanged = () => {}
    })

    it('increments when cells become visible', () => {
      shroud.addSource('source1', SourceType.Visibility, [new PPos(0, 0)])
      shroud.tick(actor)
      expect(shroud.revealedCells).toBeGreaterThan(0)
    })

    it('decrements when cells become fogged', () => {
      shroud.addSource('source1', SourceType.Visibility, [new PPos(0, 0)])
      shroud.tick(actor)
      const before = shroud.revealedCells

      shroud.removeSource('source1')
      shroud.tick(actor)
      expect(shroud.revealedCells).toBeLessThan(before)
    })
  })

  // -------------------------------------------------------------------------
  // ProjectedCellsInRange
  // -------------------------------------------------------------------------

  describe('projectedCellsInRange', () => {
    it('returns cells within range', () => {
      const center = new WPos(4 * 1024, 4 * 1024, 0)
      const range = WDist.fromCells(2)
      const cells = Shroud.projectedCellsInRange(map, center, WDist.Zero, range)

      expect(cells.length).toBeGreaterThan(0)
      // Center cell should be included
      expect(cells.some((p) => p.U === 4 && p.V === 4)).toBe(true)
    })

    it('respects minRange (donut)', () => {
      const center = new WPos(4 * 1024, 4 * 1024, 0)
      const minRange = WDist.fromCells(1)
      const maxRange = WDist.fromCells(2)
      const cells = Shroud.projectedCellsInRange(map, center, minRange, maxRange)

      // Center cell should NOT be included
      expect(cells.some((p) => p.U === 4 && p.V === 4)).toBe(false)
    })

    it('returns empty array for zero range at center', () => {
      const center = new WPos(4 * 1024, 4 * 1024, 0)
      const cells = Shroud.projectedCellsInRange(map, center, WDist.Zero, WDist.Zero)
      expect(cells.length).toBe(0)
    })

    it('works with projectedCellsInRangeFromCell', () => {
      const cell = new CPos(4, 4)
      const range = WDist.fromCells(1)
      const cells = Shroud.projectedCellsInRangeFromCell(map, cell, range)

      expect(cells.length).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty source cells', () => {
      shroud.addSource('empty', SourceType.Visibility, [])
      expect(shroud.revealedCells).toBe(0)
    })

    it('handles multiple sources with different types', () => {
      shroud.addSource('vis', SourceType.Visibility, [new PPos(0, 0)])
      shroud.addSource('passive', SourceType.PassiveVisibility, [new PPos(1, 1)])
      shroud.addSource('shroud', SourceType.Shroud, [new PPos(2, 2)])
      shroud.tick(actor)

      expect(shroud.isVisible(new PPos(0, 0))).toBe(true)
      expect(shroud.isVisible(new PPos(1, 1))).toBe(true)
      expect(shroud.isVisible(new PPos(2, 2))).toBe(false)
    })

    it('handles all map cells as sources', () => {
      const allCells = map.projectedCells
      shroud.addSource('all', SourceType.Visibility, allCells)
      shroud.tick(actor)
      expect(shroud.isVisible(new PPos(0, 0))).toBe(true)
      expect(shroud.isVisible(new PPos(7, 7))).toBe(true)
    })
  })
})
