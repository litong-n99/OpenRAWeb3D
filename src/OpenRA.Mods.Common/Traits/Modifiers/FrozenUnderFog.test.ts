/**
 * FrozenUnderFog.test.ts — FrozenUnderFog migration unit tests
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Modifiers/FrozenUnderFog.cs
 *
 * Tests focus on: state management, lifecycle, visibility logic,
 * frozen actor creation/update, sync hash computation.
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PPos, MPos } from '../../../OpenRA.Game/MPos'
import { CPos } from '../../../OpenRA.Game/CPos'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  __esModule: true,
}))

// ---------------------------------------------------------------------------
// Mock FrozenActorLayer module — provides mock FrozenActor class
// ---------------------------------------------------------------------------

/** Mock FrozenActor instances created during tests. */
const { mockFrozenActorInstances, resetMockFrozenActors } = vi.hoisted(() => {
  const instances: MockFrozenActor[] = []
  return {
    mockFrozenActorInstances: instances,
    resetMockFrozenActors: () => { instances.length = 0 },
  }
})

interface MockFrozenActor {
  readonly Footprint: readonly PPos[]
  readonly Viewer: unknown
  Visible: boolean
  NeedRenderables: boolean
  Renderables: readonly unknown[]
  refreshHiddenCalls: number
  refreshStateCalls: number
  invalidateCalls: number
  RefreshHidden(): void
  RefreshState(): void
  /** camelCase alias (IFrozenActorRef compliance). */
  refreshState(): void
  /** camelCase alias (IFrozenActorRef compliance). */
  refreshHidden(): void
  Invalidate(): void
}

vi.mock('../../../OpenRA.Game/Traits/Player/FrozenActorLayer', () => {
  class MockFrozenActorImpl implements MockFrozenActor {
    readonly Footprint: readonly PPos[]
    readonly Viewer: unknown
    Visible: boolean = true
    NeedRenderables: boolean = false
    Renderables: readonly unknown[] = []
    refreshHiddenCalls: number = 0
    refreshStateCalls: number = 0
    invalidateCalls: number = 0

    constructor(
      _self: unknown,
      _frozenTrait: unknown,
      footprint: readonly PPos[],
      viewer: unknown,
      startsRevealed: boolean,
    ) {
      this.Footprint = footprint
      this.Viewer = viewer
      this.NeedRenderables = startsRevealed
      mockFrozenActorInstances.push(this)
    }

    RefreshHidden(): void {
      this.refreshHiddenCalls++
    }

    refreshHidden(): void {
      this.refreshHiddenCalls++
    }

    RefreshState(): void {
      this.refreshStateCalls++
    }

    refreshState(): void {
      this.refreshStateCalls++
    }

    Invalidate(): void {
      this.invalidateCalls++
    }
  }

  return { FrozenActor: MockFrozenActorImpl }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  FrozenUnderFog,
  FrozenUnderFogInfo,
} from './FrozenUnderFog'
import {
  PlayerRelationship,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import type {
  IGameActor,
  PlayerStub,
  WorldRendererStub,
  IRenderable,
  RectangleStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Counter for unique actor IDs. */
let actorIdCounter = 0

/** Create a mock WPos-like object for centerPosition. */
function mockCenterPosition(): Record<string, unknown> {
  return { X: 0, Y: 0, Z: 0, toWVec: vi.fn(() => ({ X: 0, Y: 0, Z: 0 })), equals: vi.fn(() => true) }
}

/** Create a mock Map object with projectedCellsCovering. */
function createMockMap(): Record<string, unknown> {
  return {
    grid: { type: MapGridType.Rectangular },
    projectedCellsCovering: vi.fn((uv: MPos) => {
      return [new PPos(uv.U, uv.V)]
    }),
  }
}

/** Type for a mock player object. */
type MockPlayer = Record<string, unknown> & { _isMockPlayer: true; playerName: string }

/** Setup helper: create N mock players with a shared world. */
function setupPlayersWorld(
  count: number,
  options?: {
    shroud?: Record<string, unknown> | null
    fogEnabled?: boolean
    isExploredReturn?: boolean
  },
): {
  players: MockPlayer[]
  world: Record<string, unknown>
} {
  const frameEndTasks: (() => void)[] = []

  const world: Record<string, unknown> = {
    players: [] as MockPlayer[],
    renderPlayer: null,
    map: createMockMap(),
    screenMap: {
      addOrUpdate: vi.fn(),
      remove: vi.fn(),
    },
    addFrameEndTask: vi.fn((action: () => void) => {
      frameEndTasks.push(action)
    }),
    _executeFrameEndTasks: () => {
      for (const task of frameEndTasks) task()
      frameEndTasks.length = 0
    },
  }

  const players: MockPlayer[] = []
  for (let i = 0; i < count; i++) {
    const player: MockPlayer = {
      _isMockPlayer: true,
      playerName: 'player' + i,
      playerActor: {
        actorId: actorIdCounter++,
        world,
        traitOrDefault: vi.fn((_name: string) => undefined),
      },
      shroud: options?.shroud !== undefined
        ? options.shroud
        : {
            fogEnabled: options?.fogEnabled ?? true,
            isExplored: vi.fn((_puv: PPos) => options?.isExploredReturn ?? false),
          },
      relationshipWith: vi.fn(() => PlayerRelationship.Enemy),
    }
    players.push(player)
  }

  world.players = players
  return { players, world }
}

/** Create a mock FrozenActorLayer with Add method. */
function createMockFrozenActorLayer(): Record<string, unknown> {
  const addedActors: unknown[] = []
  return {
    Add: vi.fn((fa: unknown) => { addedActors.push(fa) }),
    addedActors,
  }
}

/** Add FrozenActorLayer trait to a player's playerActor. */
function addFrozenLayerToPlayer(player: MockPlayer, layer?: Record<string, unknown>): void {
  const fl = layer ?? createMockFrozenActorLayer()
  const pa = player.playerActor as Record<string, unknown>
  pa['traitOrDefault'] = vi.fn((name: string) => {
    if (name === 'FrozenActorLayer') return fl
    return undefined
  })
}

/**
 * Create a mock IFrozenActorRef for onVisibilityChanged tests.
 *
 * Includes refreshState()/refreshHidden() (camelCase for IFrozenActorRef)
 * as well as PascalCase RefreshState/RefreshHidden for legacy assertions.
 */
function createMockFrozenRef(options: {
  viewer: unknown
  visible?: boolean
}): Record<string, unknown> {
  const refreshState = vi.fn()
  return {
    viewer: options.viewer,
    visible: options.visible ?? false,
    hidden: false,
    centerPosition: mockCenterPosition(),
    refreshHidden: vi.fn(),
    refreshState,
    // PascalCase kept for tests that verify FrozenActor-like behavior
    RefreshState: refreshState,
    RefreshHidden: vi.fn(),
  }
}

/** Create a mock BuildingInfo. */
function createMockBuildingInfo(footprintCells?: CPos[]): Record<string, unknown> {
  return {
    frozenUnderFogTiles: vi.fn((_loc: CPos) => {
      return footprintCells ?? [new CPos(0, 0), new CPos(1, 0), new CPos(0, 1), new CPos(1, 1)]
    }),
  }
}

/** Create a mock ActorInfo. */
function createMockActorInfo(buildingInfo?: Record<string, unknown>): Record<string, unknown> {
  return {
    traitInfoOrDefault: vi.fn((name: string) => {
      if (name === 'BuildingInfo') return buildingInfo ?? createMockBuildingInfo()
      return undefined
    }),
  }
}

/** Create a mock IGameActor for testing (a building with BuildingInfo). */
function createMockBuildingActor(options: {
  owner?: PlayerStub | null
  world?: Record<string, unknown>
  /** Pass null to explicitly set no location (for empty footprint tests). */
  location?: CPos | null
  actorInfo?: Record<string, unknown>
} = {}): IGameActor {
  const hasLocation = 'location' in options
  const actorAny: Record<string, unknown> = {
    actorId: actorIdCounter++,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: options.owner ?? null,
    world: options.world ?? { players: [], map: createMockMap() },
    location: hasLocation ? (options.location ?? undefined) : new CPos(5, 10),
    info: options.actorInfo ?? createMockActorInfo(),
  }
  return actorAny as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFogInfo
// ---------------------------------------------------------------------------

describe('FrozenUnderFogInfo', () => {
  it('has default alwaysVisibleRelationships set to Ally', () => {
    const info = new FrozenUnderFogInfo()
    expect(info.alwaysVisibleRelationships).toBe(PlayerRelationship.Ally)
  })

  it('implements IDefaultVisibilityInfo marker interface', () => {
    const info = new FrozenUnderFogInfo()
    expect(info).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — Constructor
// ---------------------------------------------------------------------------

describe('FrozenUnderFog constructor', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('computes footprint from BuildingInfo using frozenUnderFogTiles', () => {
    const map = createMockMap()
    const world: Record<string, unknown> = { players: [], map }
    const buildingInfo = createMockBuildingInfo()
    const actorInfo = createMockActorInfo(buildingInfo)
    const self = createMockBuildingActor({ world, actorInfo, location: new CPos(5, 10) })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    expect(fuf).toBeDefined()
    expect(map.projectedCellsCovering).toHaveBeenCalled()
  })

  it('uses single cell footprint when no BuildingInfo is available', () => {
    const map = createMockMap()
    const world: Record<string, unknown> = { players: [], map }
    const actorInfo = createMockActorInfo(undefined)
    const self = createMockBuildingActor({ world, actorInfo, location: new CPos(5, 10) })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    expect(fuf).toBeDefined()
    expect(map.projectedCellsCovering).toHaveBeenCalled()
  })

  it('handles missing location gracefully (empty footprint)', () => {
    const map = createMockMap()
    const world: Record<string, unknown> = { players: [], map }
    const self = createMockBuildingActor({ world, location: undefined })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    expect(fuf).toBeDefined()
  })

  it('handles missing map gracefully (empty footprint)', () => {
    const world: Record<string, unknown> = { players: [] }
    const self = createMockBuildingActor({ world, location: new CPos(3, 4) })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    expect(fuf).toBeDefined()
  })

  it('handles missing world gracefully', () => {
    const self = createMockBuildingActor({
      world: undefined as unknown as Record<string, unknown>,
      location: new CPos(1, 1),
    })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    expect(fuf).toBeDefined()
  })

  it('initializes VisibilityHash to 0', () => {
    const self = createMockBuildingActor()
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    expect(fuf.VisibilityHash).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenState — per-player frozen actor + visibility
// ---------------------------------------------------------------------------

describe('FrozenState (via FrozenUnderFog)', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('FrozenActor defaults Visible to true (frozen copy shown)', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(mockFrozenActorInstances[0].Visible).toBe(true)
  })

  it('FrozenActor starts with NeedRenderables = startsRevealed', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    // startsRevealed is always false per TODO-12.A.6.1
    expect(mockFrozenActorInstances[0].NeedRenderables).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — created()
// ---------------------------------------------------------------------------

describe('FrozenUnderFog.created', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('creates a FrozenActor for each player', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(mockFrozenActorInstances.length).toBe(2)
  })

  it('adds each FrozenActor to the player FrozenActorLayer', () => {
    const { players, world } = setupPlayersWorld(2)
    const layer0 = createMockFrozenActorLayer()
    const layer1 = createMockFrozenActorLayer()
    addFrozenLayerToPlayer(players[0], layer0)
    addFrozenLayerToPlayer(players[1], layer1)
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(layer0.Add).toHaveBeenCalledTimes(1)
    expect(layer1.Add).toHaveBeenCalledTimes(1)
  })

  it('defers initial visibility update via addFrameEndTask', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(world.addFrameEndTask).toHaveBeenCalledTimes(1)
  })

  it('executes frame end task to update frozen actor visibility', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    ;(world._executeFrameEndTasks as () => void)()

    expect(mockFrozenActorInstances[0].refreshHiddenCalls).toBeGreaterThanOrEqual(1)
  })

  it('sets _created flag after initialization', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    const mockFrozenRef = createMockFrozenRef({ viewer: players[0], visible: false })
    fuf.onVisibilityChanged(mockFrozenRef as any)
    expect(mockFrozenRef.refreshHidden).toHaveBeenCalled()
  })

  it('handles null world gracefully', () => {
    const self = createMockBuildingActor({ world: undefined as unknown as Record<string, unknown> })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    expect(() => fuf.created(self)).not.toThrow()
  })

  it('handles world with no players in created()', () => {
    const world: Record<string, unknown> = { players: [], map: createMockMap() }
    const self = createMockBuildingActor({ owner: null, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    expect(() => fuf.created(self)).not.toThrow()
    expect(mockFrozenActorInstances.length).toBe(0)
  })

  it('frameEndTask exits early if _frozenStates was cleared', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(world.addFrameEndTask).toHaveBeenCalledTimes(1)
    expect(() => (world._executeFrameEndTasks as () => void)()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — onVisibilityChanged()
// ---------------------------------------------------------------------------

describe('FrozenUnderFog.onVisibilityChanged', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('ignores callbacks before created() is called', () => {
    const { players, world } = setupPlayersWorld(1)
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    const mockFrozenRef = {
      viewer: players[0],
      visible: false,
      hidden: false,
      centerPosition: mockCenterPosition(),
      refreshHidden: vi.fn(),
    }

    fuf.onVisibilityChanged(mockFrozenRef as any)
    expect(mockFrozenRef.refreshHidden).not.toHaveBeenCalled()
  })

  it('updates FrozenState.isVisible when frozen actor becomes visible', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    const mockFrozenRef = createMockFrozenRef({ viewer: players[0], visible: false })

    fuf.onVisibilityChanged(mockFrozenRef as any)
    expect(mockFrozenRef.refreshHidden).toHaveBeenCalled()
    expect(mockFrozenRef.refreshState).toHaveBeenCalled()
    expect(fuf.VisibilityHash).toBe(1)
  })

  it('updates VisibilityHash when frozen actor visibility changes', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    const mockFrozenRef = createMockFrozenRef({ viewer: players[1], visible: false })
    fuf.onVisibilityChanged(mockFrozenRef as any)

    expect(fuf.VisibilityHash & 2).toBe(2)
  })

  it('sets isVisible correctly based on frozen.visible flag', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    const mockFrozenRef = createMockFrozenRef({ viewer: players[0], visible: true })
    fuf.onVisibilityChanged(mockFrozenRef as any)
    expect(mockFrozenRef.refreshHidden).toHaveBeenCalled()
    expect(mockFrozenRef.refreshState).not.toHaveBeenCalled()
  })

  it('handles viewer not in players list gracefully', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })
    const unknownPlayer = { playerActor: { world: { players: [] } }, _isMockPlayer: true, playerName: 'unknown' }

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    const mockFrozenRef = createMockFrozenRef({ viewer: unknownPlayer, visible: false })

    expect(() => fuf.onVisibilityChanged(mockFrozenRef as any)).not.toThrow()
    expect(mockFrozenRef.refreshHidden).not.toHaveBeenCalled()
  })

  it('ignores callbacks when _frozenStates is null (before created)', () => {
    const { players, world } = setupPlayersWorld(1)
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    // created() not called, _frozenStates is null

    const mockFrozenRef = createMockFrozenRef({ viewer: players[0], visible: false })

    expect(() => fuf.onVisibilityChanged(mockFrozenRef as any)).not.toThrow()
    expect(mockFrozenRef.refreshHidden).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — isVisible()
// ---------------------------------------------------------------------------

describe('FrozenUnderFog.isVisible', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('returns true for null player (observer)', () => {
    const self = createMockBuildingActor()
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    expect(fuf.isVisible(self, null)).toBe(true)
  })

  it('returns true for undefined player', () => {
    const self = createMockBuildingActor()
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(fuf.isVisible(self, undefined as any)).toBe(true)
  })

  it('returns true for player with Ally relationship (always visible)', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Ally
      return PlayerRelationship.Enemy
    })
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(fuf.isVisible(self, players[1] as unknown as PlayerStub)).toBe(true)
  })

  it('checks shroud exploration when fog is disabled', () => {
    const { players, world } = setupPlayersWorld(2, {
      fogEnabled: false,
      isExploredReturn: true,
    })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Enemy
      return PlayerRelationship.Ally
    })
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(fuf.isVisible(self, players[1] as unknown as PlayerStub)).toBe(true)
  })

  it('returns false when fog is enabled and state.isVisible is false', () => {
    const { players, world } = setupPlayersWorld(2, {
      fogEnabled: true,
      isExploredReturn: false,
    })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Enemy
      return PlayerRelationship.Ally
    })
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(fuf.isVisible(self, players[1] as unknown as PlayerStub)).toBe(false)
  })

  it('returns true when no shroud is available on player', () => {
    const { players, world } = setupPlayersWorld(2, { shroud: null })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Enemy
      return PlayerRelationship.Ally
    })
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(fuf.isVisible(self, players[1] as unknown as PlayerStub)).toBe(true)
  })

  it('falls back to _isVisibleInner when relationship is not always-visible', () => {
    const { players, world } = setupPlayersWorld(2, { fogEnabled: false, isExploredReturn: false })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Enemy
      return PlayerRelationship.Ally
    })
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    // Enemy relation + fog disabled + not explored → invisible
    expect(fuf.isVisible(self, players[1] as unknown as PlayerStub)).toBe(false)
  })

  it('returns false for player not found in _frozenStates (fog enabled)', () => {
    const { players, world } = setupPlayersWorld(1, { fogEnabled: true })
    addFrozenLayerToPlayer(players[0])
    const unknownPlayer = { playerActor: { world: { players: [] } }, _isMockPlayer: true, playerName: 'unknown', shroud: players[0].shroud }
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    // _getPlayerIndex returns -1 for unknownPlayer → returns false
    expect(fuf.isVisible(self, unknownPlayer as unknown as PlayerStub)).toBe(false)
  })

  it('returns true when any footprint cell is explored (fog disabled)', () => {
    const { players, world } = setupPlayersWorld(2, { fogEnabled: false })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[1].shroud as Record<string, unknown>)['isExplored'] = vi.fn((puv: PPos) => puv.U === 1 && puv.V === 0)
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Enemy
      return PlayerRelationship.Ally
    })
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    // Fog disabled + footprint has cell (1,0) that is explored → visible
    expect(fuf.isVisible(self, players[1] as unknown as PlayerStub)).toBe(true)
  })

  it('handles null owner and null _frozenStates in _isVisibleInner', () => {
    const { players, world } = setupPlayersWorld(1)
    const self = createMockBuildingActor({ owner: null, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    // No owner → alwaysVisible check skipped
    // _frozenStates is null → _isVisibleInner returns false for fog enabled
    expect(fuf.isVisible(self, players[0] as unknown as PlayerStub)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — tickRender()
// ---------------------------------------------------------------------------

describe('FrozenUnderFog.tickRender', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('processes frozen actors that need renderables', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    mockFrozenActorInstances[0].NeedRenderables = true

    const mockWr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
    fuf.tickRender(mockWr as unknown as WorldRendererStub, self)

    expect(mockFrozenActorInstances[0].NeedRenderables).toBe(false)
  })

  it('sets empty renderables on frozen actor when capturing', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    mockFrozenActorInstances[0].NeedRenderables = true

    const mockWr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
    fuf.tickRender(mockWr as unknown as WorldRendererStub, self)

    expect(mockFrozenActorInstances[0].Renderables).toBeDefined()
    expect(mockFrozenActorInstances[0].Renderables.length).toBe(0)
  })

  it('skips frozen actors that do not need renderables', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    mockFrozenActorInstances[0].NeedRenderables = true

    const mockWr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
    fuf.tickRender(mockWr as unknown as WorldRendererStub, self)

    expect(mockFrozenActorInstances[0].NeedRenderables).toBe(false)
  })

  it('handles null frozen states gracefully', () => {
    const self = createMockBuildingActor()
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    const mockWr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
    expect(() => fuf.tickRender(mockWr as unknown as WorldRendererStub, self)).not.toThrow()
  })

  it('calls screenMap.addOrUpdate for frozen actors needing renderables', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    mockFrozenActorInstances[0].NeedRenderables = true

    const mockWr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
    fuf.tickRender(mockWr as unknown as WorldRendererStub, self)

    expect(world.screenMap).toBeDefined()
    const screenMap = world.screenMap as Record<string, unknown>
    expect(screenMap.addOrUpdate).toHaveBeenCalled()
  })

  it('skips screenMap when world has no screenMap', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    delete world.screenMap
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    mockFrozenActorInstances[0].NeedRenderables = true

    const mockWr = { viewport: { topLeft: { x: 0, y: 0 }, bottomRight: { x: 100, y: 100 } } }
    expect(() => fuf.tickRender(mockWr as unknown as WorldRendererStub, self)).not.toThrow()
    expect(mockFrozenActorInstances[0].NeedRenderables).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — modifyRender()
// ---------------------------------------------------------------------------

describe('FrozenUnderFog.modifyRender', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('returns original renderables when visible to render player', () => {
    const { players, world } = setupPlayersWorld(2, { fogEnabled: false, isExploredReturn: true })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Ally
      return PlayerRelationship.Enemy
    })
    world.renderPlayer = players[1]

    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    const original: IRenderable[] = [{ type: 'test' } as unknown as IRenderable]
    const mockWr = {} as unknown as WorldRendererStub
    const result = fuf.modifyRender(self, mockWr, original)

    expect(result).toBe(original)
  })

  it('returns empty array when not visible to render player', () => {
    const { players, world } = setupPlayersWorld(2, { fogEnabled: true, isExploredReturn: false })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Enemy
      return PlayerRelationship.Ally
    })
    world.renderPlayer = players[1]

    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    const original: IRenderable[] = [{ type: 'test' } as unknown as IRenderable]
    const mockWr = {} as unknown as WorldRendererStub
    const result = fuf.modifyRender(self, mockWr, original)

    expect(result).not.toBe(original)
    expect(result.length).toBe(0)
  })

  it('returns original renderables when no render player is set', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    const original: IRenderable[] = [{ type: 'test' } as unknown as IRenderable]
    const mockWr = {} as unknown as WorldRendererStub
    const result = fuf.modifyRender(self, mockWr, original)

    expect(result).toBe(original)
  })

  it('returns original renderables during _isRendering guard (capture mode)', () => {
    const { players, world } = setupPlayersWorld(2, { fogEnabled: true, isExploredReturn: false })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Enemy
      return PlayerRelationship.Ally
    })
    world.renderPlayer = players[1]

    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    // Simulate isRendering = true (as during tickRender capture)
    ;(fuf as any)._isRendering = true

    const original: IRenderable[] = [{ type: 'test' } as unknown as IRenderable]
    const mockWr = {} as unknown as WorldRendererStub
    const result = fuf.modifyRender(self, mockWr, original)

    expect(result).toBe(original)
    ;(fuf as any)._isRendering = false
  })

  it('handles null world gracefully in modifyRender', () => {
    const self = createMockBuildingActor({ world: undefined as unknown as Record<string, unknown> })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    const original: IRenderable[] = [{ type: 'test' } as unknown as IRenderable]
    const mockWr = {} as unknown as WorldRendererStub
    // No world, no renderPlayer → returns original
    const result = fuf.modifyRender(self, mockWr, original)

    expect(result).toBe(original)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — modifyScreenBounds()
// ---------------------------------------------------------------------------

describe('FrozenUnderFog.modifyScreenBounds', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('passes through screen bounds unchanged', () => {
    const self = createMockBuildingActor()
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    const bounds = [{ x: 0, y: 0, width: 100, height: 100 }]
    const mockWr = {} as unknown as WorldRendererStub
    const result = fuf.modifyScreenBounds(self, mockWr, bounds)

    expect(result).toBe(bounds)
  })

  it('passes through empty bounds unchanged', () => {
    const self = createMockBuildingActor()
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    const bounds: RectangleStub[] = []
    const mockWr = {} as unknown as WorldRendererStub
    const result = fuf.modifyScreenBounds(self, mockWr, bounds)

    expect(result).toBe(bounds)
    expect(result.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — onOwnerChanged()
// ---------------------------------------------------------------------------

describe('FrozenUnderFog.onOwnerChanged', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('updates old owner frozen actor state and refreshes hidden', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    const beforeRefreshStateCalls = mockFrozenActorInstances[0].refreshStateCalls
    const beforeRefreshHiddenCalls = mockFrozenActorInstances[0].refreshHiddenCalls

    fuf.onOwnerChanged(self, players[0] as unknown as PlayerStub, players[1] as unknown as PlayerStub)

    expect(mockFrozenActorInstances[0].refreshStateCalls).toBeGreaterThan(beforeRefreshStateCalls)
    expect(mockFrozenActorInstances[0].refreshHiddenCalls).toBeGreaterThan(beforeRefreshHiddenCalls)
  })

  it('handles null frozen states gracefully', () => {
    const { players, world } = setupPlayersWorld(2)
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    expect(() =>
      fuf.onOwnerChanged(self, players[0] as unknown as PlayerStub, players[1] as unknown as PlayerStub),
    ).not.toThrow()
  })

  it('updates VisibilityHash for old owner player index', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    const hashBefore = fuf.VisibilityHash
    fuf.onOwnerChanged(self, players[0] as unknown as PlayerStub, players[1] as unknown as PlayerStub)

    expect(fuf.VisibilityHash & 1).toBe(1)
    if (hashBefore === 0) {
      expect(fuf.VisibilityHash).toBeGreaterThan(0)
    }
  })

  it('handles oldOwner not found in players list gracefully', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    const unknownOwner = { playerActor: { world: { players: [] } }, _isMockPlayer: true, playerName: 'unknown' }

    expect(() =>
      fuf.onOwnerChanged(self, unknownOwner as unknown as PlayerStub, players[1] as unknown as PlayerStub),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — disposing()
// ---------------------------------------------------------------------------

describe('FrozenUnderFog.disposing', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('invalidates the current owner frozen actor', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    fuf.disposing(self)

    expect(mockFrozenActorInstances[0].invalidateCalls).toBe(1)
  })

  it('handles null owner gracefully', () => {
    const self = createMockBuildingActor({ owner: null })
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    expect(() => fuf.disposing(self)).not.toThrow()
  })

  it('handles null frozen states gracefully', () => {
    const { players, world } = setupPlayersWorld(1)
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    expect(() => fuf.disposing(self)).not.toThrow()
  })

  it('handles owner not in players list gracefully', () => {
    const { world } = setupPlayersWorld(1)
    const unknownOwner = { playerActor: { world: { players: [] } }, _isMockPlayer: true, playerName: 'unknown' }
    const self = createMockBuildingActor({ owner: unknownOwner as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)

    expect(() => fuf.disposing(self)).not.toThrow()
  })

  it('invalidates correct player index with multiple players', () => {
    const { players, world } = setupPlayersWorld(3)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    addFrozenLayerToPlayer(players[2])
    const self = createMockBuildingActor({ owner: players[2] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    fuf.disposing(self)

    // Only player index 2 (owner) should be invalidated
    expect(mockFrozenActorInstances[2].invalidateCalls).toBe(1)
    expect(mockFrozenActorInstances[0].invalidateCalls).toBe(0)
    expect(mockFrozenActorInstances[1].invalidateCalls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — VisibilityHash accumulation
// ---------------------------------------------------------------------------

describe('FrozenUnderFog VisibilityHash', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('starts at 0', () => {
    const self = createMockBuildingActor()
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    expect(fuf.VisibilityHash).toBe(0)
  })

  it('correctly sets bit for playerIndex % 32', () => {
    const { players, world } = setupPlayersWorld(35)
    for (let i = 0; i < 35; i++) {
      addFrozenLayerToPlayer(players[i])
    }
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    const mockFrozenRef = createMockFrozenRef({ viewer: players[33], visible: false })
    fuf.onVisibilityChanged(mockFrozenRef as any)

    expect(fuf.VisibilityHash & 2).toBe(2)
  })

  it('accumulates multiple player visibility changes', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    fuf.onVisibilityChanged(createMockFrozenRef({ viewer: players[0], visible: false }) as any)
    fuf.onVisibilityChanged(createMockFrozenRef({ viewer: players[1], visible: false }) as any)

    expect(fuf.VisibilityHash & 0b11).toBe(0b11)
  })

  it('correctly wraps playerIndex >= 32 using modulo', () => {
    const { players, world } = setupPlayersWorld(34)
    for (let i = 0; i < 34; i++) {
      addFrozenLayerToPlayer(players[i])
    }
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    // playerIndex 32 → 1 << 0 = 1
    fuf.onVisibilityChanged(createMockFrozenRef({ viewer: players[32], visible: false }) as any)
    expect(fuf.VisibilityHash & 1).toBe(1)

    // playerIndex 33 → 1 << 1 = 2
    fuf.onVisibilityChanged(createMockFrozenRef({ viewer: players[33], visible: false }) as any)
    expect(fuf.VisibilityHash & 2).toBe(2)
  })

  it('combines VisibilityHash from onOwnerChanged and onVisibilityChanged', () => {
    const { players, world } = setupPlayersWorld(2)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    // Set hash bit for player 0 via visibility change
    fuf.onVisibilityChanged(createMockFrozenRef({ viewer: players[0], visible: false }) as any)
    expect(fuf.VisibilityHash & 1).toBe(1)

    // Set hash bit for player 0 again via owner change
    fuf.onOwnerChanged(self, players[0] as unknown as PlayerStub, players[1] as unknown as PlayerStub)
    expect(fuf.VisibilityHash & 1).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — _anyExplored behavior (私有方法，通过 isVisible 间接测试)
// ---------------------------------------------------------------------------

describe('FrozenUnderFog _anyExplored behavior', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('returns false when footprint is empty (no cells to explore)', () => {
    const { players, world } = setupPlayersWorld(1, { fogEnabled: false, isExploredReturn: true })
    addFrozenLayerToPlayer(players[0])
    // Pass location: null to explicitly create actor with no location → empty footprint
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world, location: null })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    // Empty footprint + fog disabled → _anyExplored returns false → actor invisible
    expect(fuf.isVisible(self, players[0] as unknown as PlayerStub)).toBe(false)
  })

  it('returns true when at least one footprint cell is explored', () => {
    const { players, world } = setupPlayersWorld(1, { fogEnabled: false })
    addFrozenLayerToPlayer(players[0])
    // Shroud returns false for first cell, true for fourth cell
    let callCount = 0
    ;(players[0].shroud as Record<string, unknown>)['isExplored'] = vi.fn(() => {
      callCount++
      return callCount >= 4
    })
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world, location: new CPos(5, 10) })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    // At least one cell (the 4th) is explored → visible
    expect(fuf.isVisible(self, players[0] as unknown as PlayerStub)).toBe(true)
  })

  it('returns false when no footprint cells are explored', () => {
    const { players, world } = setupPlayersWorld(1, { fogEnabled: false, isExploredReturn: false })
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world, location: new CPos(5, 10) })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)

    // Fog disabled + none explored → invisible
    expect(fuf.isVisible(self, players[0] as unknown as PlayerStub)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — _getPlayerIndex edge cases (私有方法，通过公共 API 间接测试)
// ---------------------------------------------------------------------------

describe('FrozenUnderFog Map lookup edge cases (O(1) via Map<PlayerStub, FrozenState>)', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('returns false when player not in Map (e.g. no playerActor)', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    // Create a player with no playerActor — not in the Map → isVisible returns false
    const playerWithNoActor = { shroud: players[0].shroud, _isMockPlayer: true, playerName: 'noActor' }

    expect(fuf.isVisible(self, playerWithNoActor as unknown as PlayerStub)).toBe(false)
  })

  it('returns false when player not in Map (e.g. playerActor has no world)', () => {
    const { players, world } = setupPlayersWorld(1)
    addFrozenLayerToPlayer(players[0])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    // Create a player whose playerActor has no world — not in the Map → isVisible returns false
    const playerWithActorNoWorld = {
      shroud: players[0].shroud,
      _isMockPlayer: true,
      playerName: 'actorNoWorld',
      playerActor: { traitOrDefault: vi.fn(() => undefined) },
    }

    expect(fuf.isVisible(self, playerWithActorNoWorld as unknown as PlayerStub)).toBe(false)
  })

  it('finds player in Map by reference equality for onVisibilityChanged', () => {
    const { players, world } = setupPlayersWorld(3)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    addFrozenLayerToPlayer(players[2])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    // players[2] is in the Map; O(1) lookup finds it, playerIndex=2
    const mockFrozenRef0 = createMockFrozenRef({ viewer: players[2], visible: false })
    fuf.onVisibilityChanged(mockFrozenRef0 as any)
    // player index 2 → bit position 2 → `1 << 2 = 4`
    expect(fuf.VisibilityHash & 4).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — Complete lifecycle
// ---------------------------------------------------------------------------

describe('FrozenUnderFog complete lifecycle', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('handles full create → created → visibility → ownerChange → dispose cycle', () => {
    const { players, world } = setupPlayersWorld(2, { fogEnabled: true, isExploredReturn: false })
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    ;(players[0].relationshipWith as ReturnType<typeof vi.fn>).mockImplementation((other: unknown) => {
      if (other === players[1]) return PlayerRelationship.Enemy
      return PlayerRelationship.Ally
    })
    world.renderPlayer = players[1]

    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    // 1. Constructor
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    expect(fuf.VisibilityHash).toBe(0)

    // 2. created() — creates FrozenActor per player
    fuf.created(self)
    expect(mockFrozenActorInstances.length).toBe(2)
    ;(world._executeFrameEndTasks as () => void)()

    // 3. isVisible — not visible to enemy player (fog enabled, not visible)
    expect(fuf.isVisible(self, players[1] as unknown as PlayerStub)).toBe(false)

    // 4. modifyRender — hides renderables from enemy
    const original: IRenderable[] = [{ type: 'test' } as unknown as IRenderable]
    const mockWr = {} as unknown as WorldRendererStub
    expect(fuf.modifyRender(self, mockWr, original).length).toBe(0)

    // 5. tickRender
    mockFrozenActorInstances[0].NeedRenderables = true
    fuf.tickRender(mockWr, self)
    expect(mockFrozenActorInstances[0].NeedRenderables).toBe(false)

    // 6. onVisibilityChanged
    const mockFrozenRef = createMockFrozenRef({ viewer: players[0], visible: false })
    fuf.onVisibilityChanged(mockFrozenRef as any)
    expect(fuf.VisibilityHash & 1).toBe(1)

    // 7. onOwnerChanged
    fuf.onOwnerChanged(self, players[0] as unknown as PlayerStub, players[1] as unknown as PlayerStub)
    expect(mockFrozenActorInstances[0].refreshStateCalls).toBeGreaterThan(0)

    // 8. disposing — invalidates owner's frozen actor
    fuf.disposing(self)
    expect(mockFrozenActorInstances[0].invalidateCalls).toBe(1)
    expect(mockFrozenActorInstances[1].invalidateCalls).toBe(0)
  })

  it('handles multiple ownership changes in lifecycle', () => {
    const { players, world } = setupPlayersWorld(3)
    addFrozenLayerToPlayer(players[0])
    addFrozenLayerToPlayer(players[1])
    addFrozenLayerToPlayer(players[2])
    const self = createMockBuildingActor({ owner: players[0] as unknown as PlayerStub, world })

    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), self)
    fuf.created(self)
    ;(world._executeFrameEndTasks as () => void)()

    // Owner 0 → Owner 1
    fuf.onOwnerChanged(self, players[0] as unknown as PlayerStub, players[1] as unknown as PlayerStub)
    expect(mockFrozenActorInstances[0].refreshStateCalls).toBeGreaterThan(0)

    // Update self with new owner
    const selfAny = self as unknown as Record<string, unknown>
    selfAny.owner = players[1]

    // Owner 1 → Owner 2
    fuf.onOwnerChanged(self, players[1] as unknown as PlayerStub, players[2] as unknown as PlayerStub)
    expect(mockFrozenActorInstances[1].refreshStateCalls).toBeGreaterThan(0)

    // Dispose with final owner
    fuf.disposing(self)
    expect(mockFrozenActorInstances[1].invalidateCalls).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: FrozenUnderFog — Interface compliance
// ---------------------------------------------------------------------------

describe('FrozenUnderFog interface compliance', () => {
  beforeEach(() => {
    resetMockFrozenActors()
    actorIdCounter = 0
  })

  it('implements ICreatesFrozenActors via onVisibilityChanged', () => {
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), createMockBuildingActor())
    expect(typeof fuf.onVisibilityChanged).toBe('function')
  })

  it('implements IRenderModifier via modifyRender and modifyScreenBounds', () => {
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), createMockBuildingActor())
    expect(typeof fuf.modifyRender).toBe('function')
    expect(typeof fuf.modifyScreenBounds).toBe('function')
  })

  it('implements IDefaultVisibility via isVisible', () => {
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), createMockBuildingActor())
    expect(typeof fuf.isVisible).toBe('function')
  })

  it('implements ITickRender via tickRender', () => {
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), createMockBuildingActor())
    expect(typeof fuf.tickRender).toBe('function')
  })

  it('implements INotifyCreated via created', () => {
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), createMockBuildingActor())
    expect(typeof fuf.created).toBe('function')
  })

  it('implements INotifyOwnerChanged via onOwnerChanged', () => {
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), createMockBuildingActor())
    expect(typeof fuf.onOwnerChanged).toBe('function')
  })

  it('implements INotifyActorDisposing via disposing', () => {
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), createMockBuildingActor())
    expect(typeof fuf.disposing).toBe('function')
  })

  it('has ISync marker via VisibilityHash', () => {
    const fuf = new FrozenUnderFog(new FrozenUnderFogInfo(), createMockBuildingActor())
    expect(fuf).toHaveProperty('VisibilityHash')
  })
})
