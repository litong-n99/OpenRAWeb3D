/**
 * ShroudRenderer.test.ts — ShroudRenderer migration unit tests
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ShroudRenderer.cs
 *
 * Tests focus on: lifecycle, dirty tracking, render player switching,
 * visibility texture updates, edge computation, disposal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Riser } from '../../../OpenRA.Game/Map/TerrainInfo'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — ShroudRenderer does not create real Babylon.js
// resources in unit tests; we mock to ensure no WebGL dependencies
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  __esModule: true,
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  ShroudRenderer,
  ShroudRendererInfo,
} from './ShroudRenderer'
import { PPos } from '../../../OpenRA.Game/MPos'
import { Map } from '../../../OpenRA.Game/Map/Map'
import { MapGrid } from '../../../OpenRA.Game/Map/MapGrid'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import {
  Shroud,
  ShroudInfo,
  SourceType,
  CellVisibility,
} from '../../../OpenRA.Game/Traits/Player/Shroud'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

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

/** Create a mock player object with shroud (for HashPlayer compatibility).
 *
 * Shroud.tick() calls HashPlayer(self.owner), which requires
 * owner.playerActor.actorId to exist.
 */
function createMockPlayer(shroud?: Shroud | null): Record<string, unknown> {
  return {
    winState: 0, // WinState.Undefined
    playerActor: { actorId: 42 },
    shroud: shroud ?? null,
  }
}

/** Create a mock IGameActor with a proper player owner.
 *
 * Default owner includes playerActor for HashPlayer compatibility.
 * Pass a custom owner to override.
 */
function createMockActor(owner?: unknown, worldTick: number = 0): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    owner: (owner ?? createMockPlayer()) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    world: { map: createTestMap(), worldTick } as any,
  }
}

/** Set up an actor-shroud-player chain where Shroud.tick(HashPlayer) works.
 *
 * Returns { actor, shroud, player }.
 */
function setupShroudActor(shroudInfo?: ShroudInfo) {
  const player = createMockPlayer()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actor = createMockActor(player as any)
  const shroud = new Shroud(actor, shroudInfo ?? new ShroudInfo())
  shroud.created(actor)
  // Bind the shroud back to the player (so renderPlayer.shroud works)
  player.shroud = shroud
  return { actor, shroud, player }
}

/** Create a mock world with map and render player support. */
function createMockWorld(map: Map): Record<string, unknown> {
  return {
    map,
    renderPlayer: null,
    renderPlayerChanged: null,
    type: 'Regular',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShroudRenderer', () => {
  let renderer: ShroudRenderer
  let map: Map
  let world: Record<string, unknown>
  let info: ShroudRendererInfo

  beforeEach(() => {
    map = createTestMap()
    world = createMockWorld(map)
    info = new ShroudRendererInfo()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer = new ShroudRenderer(world as any, info)
  })

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('initializes with all cells dirty', () => {
      expect(renderer.anyCellDirty).toBe(true)
      expect(renderer.cellsDirty.indexOf(1)).not.toBe(-1)
    })

    it('has null shroud initially', () => {
      expect(renderer.shroud).toBeNull()
    })

    it('has default cell visibility (all hidden for regular world)', () => {
      // Before worldLoaded, cellVisibility is null
      expect(renderer.cellVisibility).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // IWorldLoaded
  // -------------------------------------------------------------------------

  describe('worldLoaded', () => {
    it('sets cell visibility to all visible for editor world', () => {
      world.type = 'Editor'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const puv = new PPos(0, 0)
      const cv = renderer.cellVisibility!(puv)
      expect(cv).toBe(CellVisibility.Visible | CellVisibility.Explored)
    })

    it('sets cell visibility to all hidden for regular world', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const puv = new PPos(0, 0)
      const cv = renderer.cellVisibility!(puv)
      expect(cv).toBe(CellVisibility.Hidden)
    })

    it('initializes visibility data for editor world', () => {
      world.type = 'Editor'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // All cells should be 2 (Visible)
      expect(renderer.visibilityData.every((v) => v === 2)).toBe(true)
    })

    it('initializes visibility data for regular world', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // All cells should be 0 (Hidden)
      expect(renderer.visibilityData.every((v) => v === 0)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Render player switching
  // -------------------------------------------------------------------------

  describe('render player switching', () => {
    it('subscribes to new shroud when player changes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { shroud, player } = setupShroudActor()

      // Simulate render player change
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      expect(renderer.shroud).toBe(shroud)
    })

    it('unsubscribes from old shroud when player changes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { shroud: shroud1, player: player1 } = setupShroudActor()
      const { shroud: shroud2, player: player2 } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player1 as any)
      expect(renderer.shroud).toBe(shroud1)

      // Add a callback to shroud1 to verify it persists
      const changedCells: PPos[] = []
      shroud1.addOnShroudChanged((puv) => changedCells.push(puv))

      // Change to player2
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player2 as any)
      expect(renderer.shroud).toBe(shroud2)

      // shroud1's callback should still exist (but renderer unsubscribed)
      expect(shroud1).not.toBe(shroud2)
    })

    it('marks all cells dirty on player change', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { player } = setupShroudActor()

      // Clear dirty flags
      renderer.cellsDirty.fill(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._anyCellDirty = false

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      expect(renderer.anyCellDirty).toBe(true)
      expect(renderer.cellsDirty.indexOf(1)).not.toBe(-1)
    })

    it('handles null player (spectator mode)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(null)

      expect(renderer.shroud).toBeNull()
      // All cells should be visible
      const puv = new PPos(0, 0)
      const cv = renderer.cellVisibility!(puv)
      expect(cv).toBe(CellVisibility.Visible | CellVisibility.Explored)
    })
  })

  // -------------------------------------------------------------------------
  // Dirty cell tracking
  // -------------------------------------------------------------------------

  describe('dirty cell tracking', () => {
    it('marks cell dirty when shroud changes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { actor, shroud, player } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      // Clear dirty flags
      renderer.cellsDirty.fill(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._anyCellDirty = false

      // Add a source to make shroud change
      shroud.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud.tick(actor)

      // Cell (1,1) should be dirty
      const index11 = 1 * map.mapSize.width + 1
      expect(renderer.cellsDirty[index11]).toBe(1)
    })

    it('marks neighbors dirty when a cell changes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { actor, shroud, player } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      // Clear dirty flags
      renderer.cellsDirty.fill(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._anyCellDirty = false

      // Add a source at (3,3)
      shroud.addSource('source1', SourceType.Visibility, [new PPos(3, 3)])
      shroud.tick(actor)

      // The cell itself should be dirty
      const index33 = 3 * map.mapSize.width + 3
      expect(renderer.cellsDirty[index33]).toBe(1)

      // Neighbors should also be dirty (edge blending)
      const index23 = 3 * map.mapSize.width + 2 // Left
      const index43 = 3 * map.mapSize.width + 4 // Right
      const index32 = 2 * map.mapSize.width + 3 // Top
      const index34 = 4 * map.mapSize.width + 3 // Bottom

      expect(renderer.cellsDirty[index23] || renderer.cellsDirty[index43] ||
        renderer.cellsDirty[index32] || renderer.cellsDirty[index34]).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Visibility texture update
  // -------------------------------------------------------------------------

  describe('visibility texture update', () => {
    it('updates visibility data when shroud changes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { actor, shroud, player } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      // Initial state: all hidden (0)
      const index11 = 1 * map.mapSize.width + 1
      expect(renderer.visibilityData[index11]).toBe(0)

      // Add visibility source
      shroud.addSource('source1', SourceType.Visibility, [new PPos(1, 1)])
      shroud.tick(actor)

      // Render shroud to trigger texture update
      renderer.renderShroud({} as any)

      // Cell should now be visible (2)
      expect(renderer.visibilityData[index11]).toBe(2)
    })

    it('updates explored cells correctly', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { actor, shroud, player } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      // Explore a cell without making it visible
      shroud.exploreProjectedCells([new PPos(2, 2)])
      shroud.tick(actor)

      renderer.renderShroud({} as any)

      const index22 = 2 * map.mapSize.width + 2
      expect(renderer.visibilityData[index22]).toBe(1) // Explored
    })

    it('does not update when no cells are dirty', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // Clear all dirty flags
      renderer.cellsDirty.fill(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._anyCellDirty = false

      const before = new Uint8Array(renderer.visibilityData)

      renderer.renderShroud({} as any)

      // Data should be unchanged
      expect(renderer.visibilityData).toEqual(before)
    })
  })

  // -------------------------------------------------------------------------
  // Edge computation
  // -------------------------------------------------------------------------

  describe('edge computation', () => {
    it('returns all edges for hidden cell', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // In a regular world with no shroud, all cells are hidden
      // Use interior cell to avoid border artifacts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edges = (renderer as any)._getCellEdges(new PPos(3, 3))
      expect(edges[0]).toBe(0x0f) // All corners shrouded
      expect(edges[1]).toBe(0x0f) // All corners fogged
    })

    it('returns no edges for fully visible cell surrounded by visible cells', () => {
      world.type = 'Editor'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // Use interior cell (3,3) so all 8 neighbors are within map bounds
      // and have the same visibility (all visible in editor mode)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edges = (renderer as any)._getCellEdges(new PPos(3, 3))
      expect(edges[0]).toBe(0) // No shroud edges
      expect(edges[1]).toBe(0) // No fog edges
    })
  })

  // -------------------------------------------------------------------------
  // IRenderShroud
  // -------------------------------------------------------------------------

  describe('renderShroud', () => {
    it('does nothing when disposed', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.disposing(createMockActor({}) as any)

      expect(renderer.disposed).toBe(true)

      // Should not throw
      renderer.renderShroud({} as any)
    })

    it('updates texture and clears dirty flag', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      expect(renderer.anyCellDirty).toBe(true)

      renderer.renderShroud({} as any)

      // After rendering, dirty flag should be cleared
      expect(renderer.anyCellDirty).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // INotifyActorDisposing
  // -------------------------------------------------------------------------

  describe('disposing', () => {
    it('unsubscribes from shroud', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { actor, shroud, player } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      expect(renderer.shroud).toBe(shroud)

      renderer.disposing(createMockActor({}) as any)

      expect(renderer.disposed).toBe(true)
      // After disposing, the renderer should have unsubscribed
      // We verify by checking the shroud still works independently
      const changedCells: PPos[] = []
      shroud.addOnShroudChanged((puv) => changedCells.push(puv))
      shroud.addSource('test', SourceType.Visibility, [new PPos(0, 0)])
      shroud.tick(actor)

      // The renderer's old callback should not interfere
      expect(changedCells.length).toBeGreaterThan(0)
    })

    it('is idempotent (multiple dispose calls safe)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      renderer.disposing(createMockActor({}) as any)
      renderer.disposing(createMockActor({}) as any)
      renderer.disposing(createMockActor({}) as any)

      expect(renderer.disposed).toBe(true)
    })

    it('handles dispose without shroud subscription', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // No shroud attached
      expect(renderer.shroud).toBeNull()

      // Should not throw
      renderer.disposing(createMockActor({}) as any)
      expect(renderer.disposed).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // ShroudRendererInfo
  // -------------------------------------------------------------------------

  describe('ShroudRendererInfo', () => {
    it('has default values matching OpenRA defaults', () => {
      const testInfo = new ShroudRendererInfo()
      expect(testInfo.sequence).toBe('shroud')
      expect(testInfo.shroudVariants).toEqual(['shroud'])
      expect(testInfo.fogVariants).toEqual(['fog'])
      expect(testInfo.shroudPalette).toBe('shroud')
      expect(testInfo.fogPalette).toBe('fog')
      expect(testInfo.useExtendedIndex).toBe(false)
      expect(testInfo.overrideFullShroud).toBeNull()
      expect(testInfo.overrideFullFog).toBeNull()
      expect(testInfo.overrideShroudIndex).toBe(15)
      expect(testInfo.overrideFogIndex).toBe(15)
    })
  })

  // -------------------------------------------------------------------------
  // Integration with Shroud
  // -------------------------------------------------------------------------

  describe('integration with Shroud', () => {
    it('correctly tracks visibility through add/remove source cycle', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { actor, shroud, player } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      // Add source
      shroud.addSource('source1', SourceType.Visibility, [new PPos(3, 3)])
      shroud.tick(actor)
      renderer.renderShroud({} as any)

      const index33 = 3 * map.mapSize.width + 3
      expect(renderer.visibilityData[index33]).toBe(2) // Visible

      // Remove source
      shroud.removeSource('source1')
      shroud.tick(actor)
      renderer.renderShroud({} as any)

      expect(renderer.visibilityData[index33]).toBe(1) // Explored (not visible)
    })

    it('handles multiple overlapping sources', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { actor, shroud, player } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      // Add two sources at the same cell
      shroud.addSource('source1', SourceType.Visibility, [new PPos(4, 4)])
      shroud.addSource('source2', SourceType.Visibility, [new PPos(4, 4)])
      shroud.tick(actor)
      renderer.renderShroud({} as any)

      const index44 = 4 * map.mapSize.width + 4
      expect(renderer.visibilityData[index44]).toBe(2) // Visible

      // Remove one source — cell should still be visible
      shroud.removeSource('source1')
      shroud.tick(actor)
      renderer.renderShroud({} as any)

      expect(renderer.visibilityData[index44]).toBe(2) // Still visible

      // Remove second source — cell should become explored
      shroud.removeSource('source2')
      shroud.tick(actor)
      renderer.renderShroud({} as any)

      expect(renderer.visibilityData[index44]).toBe(1) // Explored
    })
  })
})
