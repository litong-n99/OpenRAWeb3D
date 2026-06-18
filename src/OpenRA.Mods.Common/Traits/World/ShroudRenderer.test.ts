/**
 * ShroudRenderer.test.ts — ShroudRenderer migration unit tests
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ShroudRenderer.cs
 *
 * Tests focus on: lifecycle, dirty tracking, render player switching,
 * visibility texture updates, edge computation, disposal, and the
 * 3D RTT pipeline (RawTexture + ShaderMaterial + ground plane Mesh).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Riser } from '../../../OpenRA.Game/Map/TerrainInfo'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — expanded for P1-B.11 3D RTT pipeline
//
// NOTE: vitest hoists vi.mock() calls above all imports. Variables referenced
// inside the mock factory MUST be declared with vi.hoisted() to avoid
// "Cannot access before initialization" errors.
// ---------------------------------------------------------------------------

const mockRefs = vi.hoisted(() => {
  const mockSetTexture = vi.fn()
  const mockSetVector2 = vi.fn()
  const mockDisposeCalls: string[] = []

  // Captured constructor args — wrapped in object for mutable access
  const captured = {
    rawTexture: null as {
      data: Uint8Array | null
      width: number
      height: number
      format: number
    } | null,
    shaderMaterial: null as {
      name: string
      options: Record<string, unknown> | null
    } | null,
    createGround: null as {
      name: string
      options: { width: number; height: number }
    } | null,
  }

  const MockRawTexture = vi.fn((data: Uint8Array, width: number, height: number, format: number) => {
    captured.rawTexture = { data, width, height, format }
    return {
      update: vi.fn(),
      dispose: vi.fn(() => mockDisposeCalls.push('RawTexture')),
    }
  })

  const MockShaderMaterial = vi.fn((name: string, _scene: unknown, _sources: unknown, options: Record<string, unknown>) => {
    captured.shaderMaterial = { name, options }
    return {
      setTexture: mockSetTexture,
      setVector2: mockSetVector2,
      dispose: vi.fn(() => mockDisposeCalls.push('ShaderMaterial')),
      backFaceCulling: false,
      disableDepthWrite: false,
      alphaMode: 0,
    }
  })

  const MockCreateGround = vi.fn((name: string, options: { width: number; height: number }) => {
    captured.createGround = { name, options }
    return {
      position: { x: 0, y: 0, z: 0 },
      isPickable: true,
      renderingGroupId: 0,
      dispose: vi.fn(() => mockDisposeCalls.push('Mesh')),
      material: null,
    }
  })

  return {
    mockSetTexture,
    mockSetVector2,
    mockDisposeCalls,
    captured,
    MockRawTexture,
    MockShaderMaterial,
    MockCreateGround,
  }
})

const mockSetTexture = mockRefs.mockSetTexture
const mockSetVector2 = mockRefs.mockSetVector2
const mockDisposeCalls = mockRefs.mockDisposeCalls
const captured = mockRefs.captured
const MockRawTexture = mockRefs.MockRawTexture
const MockShaderMaterial = mockRefs.MockShaderMaterial
const MockCreateGround = mockRefs.MockCreateGround

/** Reset state between tests. */
function resetTestTrackers() {
  mockDisposeCalls.length = 0
  captured.rawTexture = null
  captured.shaderMaterial = null
  captured.createGround = null
  MockRawTexture.mockClear()
  MockShaderMaterial.mockClear()
  MockCreateGround.mockClear()
  mockSetTexture.mockClear()
  mockSetVector2.mockClear()
}

vi.mock('@babylonjs/core', () => {
  return {
    __esModule: true,
    RawTexture: mockRefs.MockRawTexture,
    ShaderMaterial: mockRefs.MockShaderMaterial,
    MeshBuilder: {
      CreateGround: mockRefs.MockCreateGround,
      CreatePlane: vi.fn(),
    },
    Mesh: vi.fn(),
    Constants: {
      TEXTUREFORMAT_R: 6, // TEXTUREFORMAT_RED = 6
      TEXTUREFORMAT_RGBA: 5,
      TEXTURE_NEAREST_SAMPLINGMODE: 1,
      TEXTURE_BILINEAR_SAMPLINGMODE: 2,
      TEXTURETYPE_UNSIGNED_BYTE: 0,
      TEXTURETYPE_FLOAT: 1,
      TEXTURETYPE_HALF_FLOAT: 2,
    },
  }
})

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
function createTestMap(width = 8, height = 8): Map {
  const grid = new MapGrid({
    type: MapGridType.Rectangular,
    maximumTerrainHeight: 0,
  })
  return Map.createBlank(grid, { width, height }, {
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

/** Create a mock player object with shroud (for HashPlayer compatibility). */
function createMockPlayer(shroud?: Shroud | null): Record<string, unknown> {
  return {
    winState: 0, // WinState.Undefined
    playerActor: { actorId: 42 },
    shroud: shroud ?? null,
  }
}

/** Create a mock IGameActor with a proper player owner. */
function createMockActor(owner?: unknown, worldTick = 0): IGameActor {
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

/** Set up an actor-shroud-player chain where Shroud.tick(HashPlayer) works. */
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

/** Create a mock world renderer with a Babylon.js scene mock. */
function createMockWorldRenderer(): Record<string, unknown> {
  return {
    scene: {
      getUniqueId: vi.fn(() => Math.floor(Math.random() * 100000)),
      getEngine: vi.fn(() => ({ isDisposed: false })),
      addMesh: vi.fn(),
      removeMesh: vi.fn(),
    },
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
    vi.clearAllMocks()
    resetTestTrackers()

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

    it('has null GPU resources before worldLoaded', () => {
      expect(renderer.visibilityTexture).toBeNull()
      expect(renderer.shroudMaterial).toBeNull()
      expect(renderer.quadMesh).toBeNull()
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

    it('sets cell visibility to spectator (all visible) when no render player', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const puv = new PPos(0, 0)
      const cv = renderer.cellVisibility!(puv)
      expect(cv).toBe(CellVisibility.Visible | CellVisibility.Explored)
    })

    it('initializes visibility data for editor world', () => {
      world.type = 'Editor'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // All cells should be 2 (Visible)
      expect(renderer.visibilityData.every((v) => v === 2)).toBe(true)
    })

    it('initializes visibility data for regular world (spectator = all visible)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // worldLoaded marks all cells dirty; renderShroud syncs _visibilityData
      renderer.renderShroud({} as any)
      expect(renderer.visibilityData.every((v) => v === 2)).toBe(true)
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

    it('marks diagonal neighbors dirty when a cell changes', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      const { actor, shroud, player } = setupShroudActor()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      // Clear dirty flags
      renderer.cellsDirty.fill(0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._anyCellDirty = false

      // Add a source at interior cell (3,3) — all 8 neighbors should be dirty
      shroud.addSource('source1', SourceType.Visibility, [new PPos(3, 3)])
      shroud.tick(actor)

      // Diagonal neighbors
      const indexTL = 2 * map.mapSize.width + 2 // TopLeft (2,2)
      const indexTR = 2 * map.mapSize.width + 4 // TopRight (2,4)
      const indexBR = 4 * map.mapSize.width + 4 // BottomRight (4,4)
      const indexBL = 4 * map.mapSize.width + 2 // BottomLeft (4,2)

      // All 8 neighbors (including diagonals) should be marked dirty
      const anyDiagonalDirty =
        renderer.cellsDirty[indexTL] === 1 ||
        renderer.cellsDirty[indexTR] === 1 ||
        renderer.cellsDirty[indexBR] === 1 ||
        renderer.cellsDirty[indexBL] === 1
      expect(anyDiagonalDirty).toBe(true)
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

      // Override spectator-mode visibility to simulate a fully-hidden shroud
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._cellVisibility = (_puv: PPos) => CellVisibility.Hidden

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edges = (renderer as any)._getCellEdges(new PPos(3, 3))
      expect(edges[0]).toBe(0) // No shroud edges
      expect(edges[1]).toBe(0) // No fog edges
    })

    it('returns edges at map border (out-of-bounds neighbors = hidden)', () => {
      world.type = 'Editor'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const edges = (renderer as any)._getCellEdges(new PPos(0, 0))

      const hasShroudEdges = edges[0] !== 0
      const hasFogEdges = edges[1] !== 0
      expect(hasShroudEdges || hasFogEdges).toBe(true)
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

  // -------------------------------------------------------------------------
  // P1-B.11: 3D RTT Pipeline — GPU resource creation
  // -------------------------------------------------------------------------

  describe('3D RTT Pipeline — GPU resource creation', () => {
    it('creates RawTexture with correct dimensions (map width × map height)', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      expect(captured.rawTexture).not.toBeNull()
      expect(captured.rawTexture!.width).toBe(map.mapSize.width) // 8
      expect(captured.rawTexture!.height).toBe(map.mapSize.height) // 8
    })

    it('allocates RawTexture data matching initial visibility state', () => {
      world.type = 'Editor'
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      expect(captured.rawTexture).not.toBeNull()
      const data = captured.rawTexture!.data!
      // Editor world: all cells visible (value = 2)
      expect(data.length).toBe(64) // 8x8 = 64
      for (let i = 0; i < data.length; i++) {
        expect(data[i]).toBe(2) // Visible
      }
    })

    it('uses TEXTUREFORMAT_R (single-channel) for visibility texture', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      expect(captured.rawTexture).not.toBeNull()
      // TEXTUREFORMAT_R = 6 (from Constants mock)
      expect(captured.rawTexture!.format).toBe(6)
    })

    it('creates ShaderMaterial with shroud shaders', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      expect(captured.shaderMaterial).not.toBeNull()
      expect(captured.shaderMaterial!.name).toBe('shroudMat')
      expect(captured.shaderMaterial!.options).not.toBeNull()
      expect(captured.shaderMaterial!.options!.attributes).toEqual(['position', 'uv'])
      expect(captured.shaderMaterial!.options!.samplers).toContain('uVisibilityTexture')
      expect(captured.shaderMaterial!.options!.needAlphaBlending).toBe(true)
    })

    it('sets shader uniforms (uMapSize, uTexelSize)', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      // ShaderMaterial.setVector2 should have been called with map dimensions
      expect(MockShaderMaterial).toHaveBeenCalled()
    })

    it('creates ground plane Mesh covering the entire map', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      expect(captured.createGround).not.toBeNull()
      expect(captured.createGround!.name).toBe('shroudOverlay')
      expect(captured.createGround!.options!.width).toBe(map.mapSize.width)
      expect(captured.createGround!.options!.height).toBe(map.mapSize.height)
    })

    it('sets renderingGroupId = 2 on the shroud quad (above terrain/actors)', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      expect(renderer.quadMesh).not.toBeNull()
      expect(renderer.quadMesh!.renderingGroupId).toBe(2)
    })

    it('does not create GPU resources when no scene is provided', () => {
      // worldLoaded with empty world renderer (no scene property)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, {} as any)

      expect(captured.rawTexture).toBeNull()
      expect(captured.shaderMaterial).toBeNull()
      expect(captured.createGround).toBeNull()
    })

    it('exposes GPU resources via public accessors', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      expect(renderer.visibilityTexture).not.toBeNull()
      expect(renderer.shroudMaterial).not.toBeNull()
      expect(renderer.quadMesh).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // P1-B.11: 3D RTT Pipeline — visibility texture upload
  // -------------------------------------------------------------------------

  describe('3D RTT Pipeline — visibility texture upload', () => {
    it('uploads visibility data to RawTexture when dirty cells change', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      // After worldLoaded, the texture exists and cells are dirty
      // Call renderShroud to trigger texture update
      renderer.renderShroud({} as any)

      // The mock texture's update should have been called
      // (spectator mode: all cells set to visible=2)
      const texture = renderer.visibilityTexture!
      expect(texture.update).toHaveBeenCalled()
    })

    it('hidden cells produce value 0 in visibility texture data', () => {
      // Create a new renderer WITHOUT calling worldLoaded,
      // so cells stay at default value 0
      const localMap = createTestMap()
      const localWorld = createMockWorld(localMap)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const localRenderer = new ShroudRenderer(localWorld as any, info)

      // Visibility data should be all zeros (hidden)
      const allHidden = localRenderer.visibilityData.every((v) => v === 0)
      expect(allHidden).toBe(true)
    })

    it('visible cells produce value 2 in visibility texture data', () => {
      world.type = 'Editor'
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      // Editor world: all visible
      const allVisible = renderer.visibilityData.every((v) => v === 2)
      expect(allVisible).toBe(true)
    })

    it('explored cells produce value 1 in visibility texture data', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const { actor, shroud, player } = setupShroudActor()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(renderer as any)._worldOnRenderPlayerChanged(player as any)

      // Explore a specific cell
      shroud.exploreProjectedCells([new PPos(2, 2)])
      shroud.tick(actor)
      renderer.renderShroud({} as any)

      const index22 = 2 * map.mapSize.width + 2
      expect(renderer.visibilityData[index22]).toBe(1) // Explored
    })
  })

  // -------------------------------------------------------------------------
  // P1-B.11: 3D RTT Pipeline — dispose cleanup
  // -------------------------------------------------------------------------

  describe('3D RTT Pipeline — dispose cleanup', () => {
    it('disposes RawTexture on disposing()', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const texture = renderer.visibilityTexture!
      expect(texture).not.toBeNull()

      renderer.disposing(createMockActor({}) as any)

      expect(texture.dispose).toHaveBeenCalled()
      expect(renderer.visibilityTexture).toBeNull()
    })

    it('disposes ShaderMaterial on disposing()', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const material = renderer.shroudMaterial!
      expect(material).not.toBeNull()

      renderer.disposing(createMockActor({}) as any)

      expect(material.dispose).toHaveBeenCalled()
      expect(renderer.shroudMaterial).toBeNull()
    })

    it('disposes Mesh on disposing()', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const mesh = renderer.quadMesh!
      expect(mesh).not.toBeNull()

      renderer.disposing(createMockActor({}) as any)

      expect(mesh.dispose).toHaveBeenCalled()
      expect(renderer.quadMesh).toBeNull()
    })

    it('disposes all three GPU resources (RawTexture, ShaderMaterial, Mesh) in one call', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      renderer.disposing(createMockActor({}) as any)

      // All three resources should be disposed
      expect(mockDisposeCalls).toContain('RawTexture')
      expect(mockDisposeCalls).toContain('ShaderMaterial')
      expect(mockDisposeCalls).toContain('Mesh')
    })
  })

  // -------------------------------------------------------------------------
  // P1-B.11: 3D RTT Pipeline — resource recreation on map change
  // -------------------------------------------------------------------------

  describe('3D RTT Pipeline — resource recreation on map change', () => {
    it('handles different map dimensions on resource creation', () => {
      // Create a renderer with a 12x10 map
      const largeMap = createTestMap(12, 10)
      const largeWorld = createMockWorld(largeMap)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const largeRenderer = new ShroudRenderer(largeWorld as any, info)

      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      largeRenderer.worldLoaded(largeWorld as any, wr as any)

      expect(captured.rawTexture!.width).toBe(12)
      expect(captured.rawTexture!.height).toBe(10)
      expect(captured.rawTexture!.data!.length).toBe(120) // 12 * 10 = 120
    })

    it('reuses the _disposeGPUResources helper for cleanup before recreation', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      // Call worldLoaded again (simulating map reload) with a new scene
      const wr2 = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr2 as any)

      // Old resources should have been disposed before new ones created
      expect(mockDisposeCalls.length).toBeGreaterThanOrEqual(3)
    })
  })

  // -------------------------------------------------------------------------
  // P1-B.11: Shader uniform verification
  // -------------------------------------------------------------------------

  describe('3D RTT Pipeline — shader configuration', () => {
    it('configures ShaderMaterial with backFaceCulling = false', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const material = renderer.shroudMaterial!
      expect(material.backFaceCulling).toBe(false)
    })

    it('configures ShaderMaterial with disableDepthWrite = true', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const material = renderer.shroudMaterial!
      expect(material.disableDepthWrite).toBe(true)
    })

    it('sets uMapSize uniform to map dimensions', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const material = renderer.shroudMaterial!
      // setVector2 should have been called with map dimensions
      expect(material.setVector2).toHaveBeenCalledWith('uMapSize', { x: map.mapSize.width, y: map.mapSize.height })
    })

    it('sets uTexelSize uniform to 1/mapSize', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const material = renderer.shroudMaterial!
      expect(material.setVector2).toHaveBeenCalledWith('uTexelSize', { x: 1 / map.mapSize.width, y: 1 / map.mapSize.height })
    })

    it('binds uVisibilityTexture sampler to the visibility RawTexture', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      const material = renderer.shroudMaterial!
      expect(material.setTexture).toHaveBeenCalledWith('uVisibilityTexture', expect.anything())
    })

    it('ShaderMaterial is created with correct uniforms declaration', () => {
      const wr = createMockWorldRenderer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderer.worldLoaded(world as any, wr as any)

      expect(captured.shaderMaterial!.options!.uniforms).toContain('worldViewProjection')
      expect(captured.shaderMaterial!.options!.uniforms).toContain('uMapSize')
      expect(captured.shaderMaterial!.options!.uniforms).toContain('uTexelSize')
    })
  })
})
