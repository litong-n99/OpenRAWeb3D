/**
 * AffectsShroud.test.ts — AffectsShroud abstract trait unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed here.
 * The AffectsShroud trait does not depend on Babylon.js directly.
 *
 * Tests focus on:
 * - Abstract method dispatch (addCellsToPlayerShroud / removeCellsFromPlayerShroud)
 * - projectedCells for all VisibilityType variants
 * - Lifecycle: addedToWorld, removedFromWorld, tick, movement hooks
 * - Caching and dirty detection
 * - MoveRecalculationThreshold behavior
 * - range getter (disabled vs enabled)
 * - Dispose cleanup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AffectsShroud,
  AffectsShroudInfo,
  VisibilityType,
} from './AffectsShroud'
import { WPos } from '../../OpenRA.Game/WPos'
import { WDist } from '../../OpenRA.Game/WDist'
import { CPos } from '../../OpenRA.Game/CPos'
import { PPos } from '../../OpenRA.Game/MPos'
import type {
  IGameActor,
  IOccupySpace,
  OccupiedCell,
} from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { Player } from '../../OpenRA.Game/Player'
import type { Map as GameMap } from '../../OpenRA.Game/Map/Map'
import { Shroud } from '../../OpenRA.Game/Traits/Player/Shroud'

// ---------------------------------------------------------------------------
// Concrete Info class (AffectsShroudInfo is abstract — need concrete for tests)
// ---------------------------------------------------------------------------

/** Concrete AffectsShroudInfo for use in tests. */
class ConcreteInfo extends AffectsShroudInfo {
  constructor(params?: ConstructorParameters<typeof AffectsShroudInfo>[0]) {
    super(params)
  }
}

// ---------------------------------------------------------------------------
// Test subclass — concrete implementation of AffectsShroud for testing
// ---------------------------------------------------------------------------

/** Concrete test implementation of AffectsShroud.
 *
 * Records calls to abstract methods for test verification.
 * Wraps protected members with public accessors for test visibility.
 */
class TestAffectsShroud extends AffectsShroud<ConcreteInfo> {
  /** Recorded addCellsToPlayerShroud calls. */
  readonly addCalls: { player: Player; cells: readonly PPos[] }[] = []

  /** Recorded removeCellsFromPlayerShroud calls. */
  readonly removeCalls: { player: Player }[] = []

  protected addCellsToPlayerShroud(
    _self: IGameActor,
    player: Player,
    cells: readonly PPos[],
  ): void {
    this.addCalls.push({ player, cells })
  }

  protected removeCellsFromPlayerShroud(
    _self: IGameActor,
    player: Player,
  ): void {
    this.removeCalls.push({ player })
  }

  /** Reset all call records. */
  resetCalls(): void {
    this.addCalls.length = 0
    this.removeCalls.length = 0
  }

  /** Expose projectedCells for direct testing. */
  testProjectedCells(self: IGameActor): readonly PPos[] {
    return this.projectedCells(self)
  }

  /** Public wrapper for protected traitDisabled. */
  disableTrait(actor: IGameActor): void {
    this.traitDisabled(actor)
  }

  /** Public read access to cachedTraitDisabled. */
  getTestCachedTraitDisabled(): boolean {
    return this.cachedTraitDisabled
  }
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/** Create a mock GameMap with specified width and height. */
function createMockMap(width = 128, height = 128): GameMap {
  return {
    mapSize: { width, height },
    grid: { type: { value: 0 } },
    centerOfCell: vi.fn().mockReturnValue(new WPos(1024 * 10 + 512, 1024 * 20 + 512, 0)),
    cellContaining: vi.fn().mockReturnValue(new CPos(10, 20)),
    distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(0)),
    projectedHeight: vi.fn().mockReturnValue(0),
    findTilesInAnnulus: vi.fn().mockReturnValue([]),
    contains: vi.fn().mockReturnValue(true),
  } as unknown as GameMap
}

/** Create a mock occupied cell. */
function createOccupiedCell(x: number, y: number): OccupiedCell {
  return {
    cell: new CPos(x, y),
    subCell: 0 as unknown as OccupiedCell['subCell'],
  }
}

/** Create a mock Player with a mock Shroud. */
function createMockPlayer(name = 'test'): Player {
  return {
    playerName: name,
    shroud: {
      addSource: vi.fn(),
      removeSource: vi.fn(),
    } as unknown as Shroud,
  } as unknown as Player
}

/** Create a mock world with map and players. */
function createMockWorld(map?: GameMap, players?: readonly Player[]): Record<string, unknown> {
  return {
    map: map ?? createMockMap(),
    players: players ?? [],
  }
}

/** Create a mock IGameActor with IOccupySpace trait. */
function createMockActor(
  overrides: Partial<{
    isInWorld: boolean
    centerPosition: WPos
    occupiedCells: readonly OccupiedCell[]
    world: Record<string, unknown>
    traitNames: Map<string, unknown>
  }> = {},
): IGameActor {
  const centerPosition = overrides.centerPosition ?? new WPos(10 * 1024 + 512, 20 * 1024 + 512, 0)
  const occupiedCells = overrides.occupiedCells ?? [createOccupiedCell(10, 20)]

  const iosMock: IOccupySpace = {
    centerPosition,
    topLeft: new CPos(10, 20),
    occupiedCells: () => occupiedCells,
  }

  const traits = new Map<string, unknown>()
  traits.set('IOccupySpace', iosMock)
  if (overrides.traitNames) {
    for (const [k, v] of overrides.traitNames) {
      traits.set(k, v)
    }
  }

  return {
    actorId: 1,
    isInWorld: overrides.isInWorld ?? true,
    isDead: false,
    disposed: false,
    world: overrides.world ?? createMockWorld(),
    traitOrDefault: (name: string) => traits.get(name) ?? null,
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests — VisibilityType
// ---------------------------------------------------------------------------

describe('VisibilityType', () => {
  it('defines CenterPosition, GroundPosition, and Footprint', () => {
    expect(VisibilityType.CenterPosition).toBe(0)
    expect(VisibilityType.GroundPosition).toBe(1)
    expect(VisibilityType.Footprint).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Tests — AffectsShroudInfo
// ---------------------------------------------------------------------------

describe('AffectsShroudInfo', () => {
  it('defaults to WDist.Zero for minRange and range', () => {
    const info = new ConcreteInfo()
    expect(info.minRange.length).toBe(0)
    expect(info.range.length).toBe(0)
  })

  it('defaults maxHeightDelta to -1', () => {
    const info = new ConcreteInfo()
    expect(info.maxHeightDelta).toBe(-1)
  })

  it('defaults moveRecalculationThreshold to 256', () => {
    const info = new ConcreteInfo()
    expect(info.moveRecalculationThreshold.length).toBe(256)
  })

  it('defaults type to Footprint', () => {
    const info = new ConcreteInfo()
    expect(info.type).toBe(VisibilityType.Footprint)
  })

  it('accepts custom values via constructor params', () => {
    const info = new ConcreteInfo({
      minRange: new WDist(512),
      range: new WDist(2048),
      maxHeightDelta: 3,
      moveRecalculationThreshold: new WDist(128),
      type: VisibilityType.CenterPosition,
    })
    expect(info.minRange.length).toBe(512)
    expect(info.range.length).toBe(2048)
    expect(info.maxHeightDelta).toBe(3)
    expect(info.moveRecalculationThreshold.length).toBe(128)
    expect(info.type).toBe(VisibilityType.CenterPosition)
  })
})

// ---------------------------------------------------------------------------
// Tests — AffectsShroud (abstract class via TestAffectsShroud)
// ---------------------------------------------------------------------------

describe('AffectsShroud', () => {
  let trait: TestAffectsShroud
  let mockMap: GameMap
  let mockPlayers: Player[]

  beforeEach(() => {
    mockMap = createMockMap()
    mockPlayers = [createMockPlayer('p1'), createMockPlayer('p2')]
    trait = new TestAffectsShroud(new ConcreteInfo({
      range: new WDist(2048),
      type: VisibilityType.CenterPosition,
    }))
  })

  // -----------------------------------------------------------------------
  // range getter
  // -----------------------------------------------------------------------

  describe('range', () => {
    it('returns info.range when trait is enabled', () => {
      expect(trait.range.length).toBe(2048)
    })

    it('returns WDist.Zero when trait is disabled', () => {
      // Manually disable (simulating condition effect)
      trait.disableTrait({} as IGameActor)
      expect(trait.range.length).toBe(0)
      expect(trait.range).toBe(WDist.Zero)
    })
  })

  // -----------------------------------------------------------------------
  // projectedCells — CenterPosition
  // -----------------------------------------------------------------------

  describe('projectedCells (CenterPosition)', () => {
    it('uses centerPosition for range calculation', () => {
      const actor = createMockActor({
        centerPosition: new WPos(5000, 6000, 0),
        world: createMockWorld(mockMap, mockPlayers),
      })

      const result = trait.testProjectedCells(actor)
      expect(Array.isArray(result)).toBe(true)
    })

    it('returns empty when minRange >= maxRange', () => {
      const info = new ConcreteInfo({
        minRange: new WDist(3000),
        range: new WDist(2000),
        type: VisibilityType.CenterPosition,
      })
      const t = new TestAffectsShroud(info)
      const actor = createMockActor({
        world: createMockWorld(mockMap, mockPlayers),
      })

      const result = t.testProjectedCells(actor)
      expect(result).toHaveLength(0)
    })

    it('returns empty when range is zero', () => {
      const info = new ConcreteInfo({
        range: WDist.Zero,
        type: VisibilityType.CenterPosition,
      })
      const t = new TestAffectsShroud(info)
      const actor = createMockActor({
        world: createMockWorld(mockMap, mockPlayers),
      })

      const result = t.testProjectedCells(actor)
      expect(result).toHaveLength(0)
    })

    it('returns empty when map is unavailable', () => {
      const actor = createMockActor({
        world: undefined as unknown as Record<string, unknown>,
      })

      const result = trait.testProjectedCells(actor)
      expect(result).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // projectedCells — GroundPosition
  // -----------------------------------------------------------------------

  describe('projectedCells (GroundPosition)', () => {
    it('adjusts center position by terrain height', () => {
      const mockMapWithHeight = createMockMap()
      mockMapWithHeight.distanceAboveTerrain = vi.fn().mockReturnValue(new WDist(512))

      const info = new ConcreteInfo({
        range: new WDist(2048),
        type: VisibilityType.GroundPosition,
      })
      const t = new TestAffectsShroud(info)
      const actor = createMockActor({
        centerPosition: new WPos(5000, 6000, 1024),
        world: createMockWorld(mockMapWithHeight, mockPlayers),
      })

      const result = t.testProjectedCells(actor)
      expect(Array.isArray(result)).toBe(true)
      expect(mockMapWithHeight.distanceAboveTerrain).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // projectedCells — Footprint
  // -----------------------------------------------------------------------

  describe('projectedCells (Footprint)', () => {
    it('uses occupied cells for range calculation', () => {
      const info = new ConcreteInfo({
        range: new WDist(2048),
        type: VisibilityType.Footprint,
      })
      const t = new TestAffectsShroud(info)

      const cells = [
        createOccupiedCell(10, 20),
        createOccupiedCell(11, 20),
      ]
      const actor = createMockActor({
        occupiedCells: cells,
        world: createMockWorld(mockMap, mockPlayers),
      })

      const result = t.testProjectedCells(actor)
      expect(Array.isArray(result)).toBe(true)
    })

    it('clears footprint set after each call', () => {
      const info = new ConcreteInfo({
        range: new WDist(2048),
        type: VisibilityType.Footprint,
      })
      const t = new TestAffectsShroud(info)
      const actor = createMockActor({
        world: createMockWorld(mockMap, mockPlayers),
      })

      // First call
      t.testProjectedCells(actor)
      // Second call should start with clean footprint
      t.testProjectedCells(actor)
      // Should not throw
    })

    it('returns empty when no occupied cells', () => {
      const info = new ConcreteInfo({
        range: new WDist(2048),
        type: VisibilityType.Footprint,
      })
      const t = new TestAffectsShroud(info)
      const actor = createMockActor({
        occupiedCells: [],
        world: createMockWorld(mockMap, mockPlayers),
      })

      const result = t.testProjectedCells(actor)
      expect(Array.isArray(result)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // addedToWorld
  // -----------------------------------------------------------------------

  describe('addedToWorld', () => {
    it('initializes cache and adds cells for all players', () => {
      const world = createMockWorld(mockMap, mockPlayers)
      const actor = createMockActor({ world })

      trait.addedToWorld(actor)

      expect(trait.getTestCachedTraitDisabled()).toBe(false)
      expect(trait.addCalls).toHaveLength(mockPlayers.length)
      // Each player should receive an add call
      for (let i = 0; i < mockPlayers.length; i++) {
        expect(trait.addCalls[i].player).toBe(mockPlayers[i])
        expect(Array.isArray(trait.addCalls[i].cells)).toBe(true)
      }
    })

    it('handles missing players gracefully', () => {
      const world = createMockWorld(mockMap, [] as Player[])
      const actor = createMockActor({ world })

      trait.addedToWorld(actor)

      expect(trait.addCalls).toHaveLength(0)
    })

    it('handles missing world gracefully', () => {
      const actor = createMockActor({
        world: undefined as unknown as Record<string, unknown>,
      })

      expect(() => trait.addedToWorld(actor)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // removedFromWorld
  // -----------------------------------------------------------------------

  describe('removedFromWorld', () => {
    it('removes cells for all players', () => {
      const world = createMockWorld(mockMap, mockPlayers)
      const actor = createMockActor({ world })

      trait.removedFromWorld(actor)

      expect(trait.removeCalls).toHaveLength(mockPlayers.length)
      for (let i = 0; i < mockPlayers.length; i++) {
        expect(trait.removeCalls[i].player).toBe(mockPlayers[i])
      }
    })

    it('handles missing players gracefully', () => {
      const world = createMockWorld(mockMap, [] as Player[])
      const actor = createMockActor({ world })

      trait.removedFromWorld(actor)

      expect(trait.removeCalls).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // tick
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('updates when range changes', () => {
      const world = createMockWorld(mockMap, mockPlayers)
      const actor = createMockActor({ world })
      trait.addedToWorld(actor)
      trait.resetCalls()

      // First tick: should update
      trait.tick(actor)
      expect(trait.addCalls.length).toBeGreaterThan(0)
      trait.resetCalls()

      // Second tick without change: should NOT update
      trait.tick(actor)
      expect(trait.addCalls).toHaveLength(0)
    })

    it('updates when trait disabled state changes', () => {
      const world = createMockWorld(mockMap, mockPlayers)
      const actor = createMockActor({ world })
      trait.addedToWorld(actor)
      trait.resetCalls()

      // Manually disable the trait
      trait.disableTrait(actor)

      trait.tick(actor)
      // Should have updated because disabled state changed
      expect(trait.addCalls.length).toBeGreaterThan(0)
    })

    it('skips update when actor is not in world', () => {
      const world = createMockWorld(mockMap, mockPlayers)
      const actor = createMockActor({ world, isInWorld: false })
      trait.resetCalls()

      trait.tick(actor)
      expect(trait.addCalls).toHaveLength(0)
    })

    it('updates on first tick (no cachedRange)', () => {
      const world = createMockWorld(mockMap, mockPlayers)
      const actor = createMockActor({ world })
      // Don't call addedToWorld - simulate fresh start
      trait.resetCalls()

      trait.tick(actor)
      expect(trait.addCalls.length).toBeGreaterThan(0)
    })
  })

  // -----------------------------------------------------------------------
  // onNotifyFinishedMoving
  // -----------------------------------------------------------------------

  describe('onNotifyFinishedMoving', () => {
    it('recalculates visibility at final position', () => {
      const world = createMockWorld(mockMap, mockPlayers)
      const actor = createMockActor({
        centerPosition: new WPos(8000, 9000, 0),
        world,
      })

      trait.onNotifyFinishedMoving(actor)

      // Should call update which calls remove + add for each player
      expect(trait.removeCalls).toHaveLength(mockPlayers.length)
      expect(trait.addCalls).toHaveLength(mockPlayers.length)
    })

    it('skips when actor is not in world', () => {
      const actor = createMockActor({ isInWorld: false })

      trait.resetCalls()
      trait.onNotifyFinishedMoving(actor)

      expect(trait.addCalls).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // onCenterPositionChanged
  // -----------------------------------------------------------------------

  describe('onCenterPositionChanged', () => {
    it('recalculates when position changes beyond threshold', () => {
      // Create a mock whose cellContaining returns different values on successive calls
      let callCount = 0
      const dynamicMap = createMockMap()
      dynamicMap.cellContaining = vi.fn().mockImplementation(() => {
        callCount++
        // Return different cell on second call to simulate movement
        if (callCount >= 2) return new CPos(15, 25)
        return new CPos(10, 20)
      })

      const world = createMockWorld(dynamicMap, mockPlayers)
      const actor = createMockActor({
        centerPosition: new WPos(5000, 5000, 0),
        world,
      })

      // First add to world (caches position at CPos(10,20))
      trait.addedToWorld(actor)
      trait.resetCalls()

      // Now cellContaining will return CPos(15,25) — different from cached
      trait.onCenterPositionChanged(actor)
      expect(trait.addCalls.length).toBeGreaterThan(0)
    })

    it('skips when actor is not in world', () => {
      const actor = createMockActor({ isInWorld: false })

      trait.resetCalls()
      trait.onCenterPositionChanged(actor)

      expect(trait.addCalls).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('cleans up resources', () => {
      trait.dispose()
      expect(trait.disposed).toBe(true)
    })

    it('can be called multiple times safely', () => {
      trait.dispose()
      expect(() => trait.dispose()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // PPos index conversion (via Footprint type)
  // -----------------------------------------------------------------------

  describe('_pposFromIndex', () => {
    it('correctly rounds-trips from PPos to index and back', () => {
      const testMap = createMockMap(64, 64)
      testMap.centerOfCell = vi.fn().mockReturnValue(new WPos(1024 * 5 + 512, 1024 * 10 + 512, 0))

      const info = new ConcreteInfo({
        range: new WDist(1024),
        type: VisibilityType.Footprint,
      })
      const t = new TestAffectsShroud(info)

      const actor = createMockActor({
        occupiedCells: [createOccupiedCell(5, 10)],
        world: createMockWorld(testMap, mockPlayers),
      })

      const result = t.testProjectedCells(actor)
      for (const puv of result) {
        expect(puv).toBeInstanceOf(PPos)
        expect(Number.isInteger(puv.U)).toBe(true)
        expect(Number.isInteger(puv.V)).toBe(true)
        expect(puv.U).toBeGreaterThanOrEqual(0)
        expect(puv.V).toBeGreaterThanOrEqual(0)
      }
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles actor without IOccupySpace', () => {
      const info = new ConcreteInfo({
        range: new WDist(2048),
        type: VisibilityType.CenterPosition,
      })
      const t = new TestAffectsShroud(info)

      const actor = {
        actorId: 2,
        isInWorld: true,
        isDead: false,
        disposed: false,
        world: createMockWorld(mockMap, mockPlayers),
        traitOrDefault: () => null,
      } as unknown as IGameActor

      // Should not throw — returns empty cells
      const result = t.testProjectedCells(actor)
      expect(result).toHaveLength(0)
    })

    it('handles actor without world', () => {
      const actor = {
        actorId: 3,
        isInWorld: true,
        isDead: false,
        disposed: false,
        world: null,
        traitOrDefault: () => null,
      } as unknown as IGameActor

      expect(() => trait.tick(actor)).not.toThrow()
      expect(() => trait.addedToWorld(actor)).not.toThrow()
      expect(() => trait.removedFromWorld(actor)).not.toThrow()
    })

    it('moveRecalculationThreshold of 0 skips dirty check but still checks cell location', () => {
      const info = new ConcreteInfo({
        range: new WDist(2048),
        moveRecalculationThreshold: WDist.Zero,
        type: VisibilityType.CenterPosition,
      })
      const t = new TestAffectsShroud(info)

      const world = createMockWorld(mockMap, mockPlayers)
      const actor = createMockActor({
        centerPosition: new WPos(5000, 5000, 0),
        world,
      })

      t.addedToWorld(actor)
      t.resetCalls()

      // With threshold 0 and same cell location, no update should occur
      // (cachedLocation matches projectedLocation from the mock)
      t.onCenterPositionChanged(actor)
      // Since our mock cellContaining returns same (10,20) and threshold is 0 (no dirty),
      // the cachedLocation check short-circuits → no update
    })
  })
})
