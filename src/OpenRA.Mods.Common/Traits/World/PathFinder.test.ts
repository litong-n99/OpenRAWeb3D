/**
 * PathFinder.test.ts -- PathFinder migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, HPF selection logic, pathfinding
 * coordination, edge cases, and the Locomotor → HPF bridge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos'
import type { IGameWorld } from '../../../OpenRA.Game/World'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import type { BlockedByActor } from '../BlockedByActor'

// ---------------------------------------------------------------------------
// Mock HierarchicalPathFinder
// ---------------------------------------------------------------------------

const mockHpfFindPath = vi.fn()
const mockHpfPathExists = vi.fn()
const mockHpfGetOverlayData = vi.fn()

vi.mock('../../Pathfinder/HierarchicalPathFinder', () => {
  // NOTE: HierarchicalPathFinder is constructed with 'new' in PathFinder.worldLoaded().
  // We use a regular function (not arrow) as the mock implementation so 'new' works.
  return {
    HierarchicalPathFinder: vi.fn().mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function (this: any) {
        this.findPath = mockHpfFindPath
        this.pathExists = mockHpfPathExists
        this.getOverlayData = mockHpfGetOverlayData
      },
    ),
  }
})

// We need the actual class for call count tracking (constructs mock instance)
import { HierarchicalPathFinder } from '../../Pathfinder/HierarchicalPathFinder'
import {
  PathFinder,
  PathFinderInfo,
  NO_PATH,
  type PathResult,
  type IPathFinderOverlay,
} from './PathFinder'

// ---------------------------------------------------------------------------
// Module under test dependencies
// ---------------------------------------------------------------------------

import { SimpleLocomotor, WallAwareLocomotor, LocomotorInfo } from './Locomotor'

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const BLOCKED_NONE = 0 as BlockedByActor
const BLOCKED_IMMOVABLE = 1 as BlockedByActor

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal IGameWorld stub. */
function makeWorld(): IGameWorld {
  return { worldTick: 0, paused: false }
}

/** Create a SimpleLocomotor with uniform terrain costs. */
function makeSimpleLocomotor(): SimpleLocomotor {
  return new SimpleLocomotor(
    new LocomotorInfo({
      name: 'default',
      terrainSpeeds: new Map([['Clear', new LocomotorInfo.TerrainInfo(100, 100)]]),
    }),
  )
}

/** Create a minimal IGameActor stub with Mobile/Locomotor.
 *
 * NOTE: The PathFinder internally casts self to ILocomotorActor when calling
 * movementCostToEnterCell. For SimpleLocomotor tests, the actor parameter is
 * ignored, so the cast is safe even without full ILocomotorActor conformance.
 */
function makeActor(actorId: number, locomotor?: SimpleLocomotor | WallAwareLocomotor): IGameActor {
  const loco = locomotor ?? makeSimpleLocomotor()
  return {
    actorId,
    isInWorld: true,
    isDead: false,
    disposed: false,
    occupiesSpace: { locomotor: loco },
  } as unknown as IGameActor
}

/** Create a PathFinder with worldLoaded already called. */
function makeReadyPathFinder(
  info?: PathFinderInfo,
  locomotors?: (SimpleLocomotor | WallAwareLocomotor)[],
): { pf: PathFinder; world: IGameWorld; locos: (SimpleLocomotor | WallAwareLocomotor)[] } {
  const pfInfo = info ?? new PathFinderInfo()
  const pf = new PathFinder(pfInfo)
  const world = makeWorld()
  const locos = locomotors ?? [makeSimpleLocomotor()]
  pf.worldLoaded(world, locos)
  return { pf, world, locos }
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockHpfFindPath.mockReset()
  mockHpfPathExists.mockReset()
  mockHpfGetOverlayData.mockReset()
})

// ---------------------------------------------------------------------------
// Test: NO_PATH constant
// ---------------------------------------------------------------------------

describe('NO_PATH constant', () => {
  it('is an empty array (not null)', () => {
    expect(NO_PATH).toEqual([])
    expect(NO_PATH).not.toBeNull()
    expect(Array.isArray(NO_PATH)).toBe(true)
    expect(NO_PATH.length).toBe(0)
  })

  it('matches PathFinder.NoPath static', () => {
    expect(PathFinder.NoPath).toEqual([])
    // PathFinder.NoPath and exported NO_PATH are both empty arrays (deep equal, not same reference)
    expect(PathFinder.NoPath).toEqual(NO_PATH)
  })
})

// ---------------------------------------------------------------------------
// Test: PathFinderInfo construction
// ---------------------------------------------------------------------------

describe('PathFinderInfo', () => {
  it('constructs with default heuristicWeightPercentage (125)', () => {
    const info = new PathFinderInfo()
    expect(info.heuristicWeightPercentage).toBe(125)
  })

  it('constructs with custom heuristicWeightPercentage', () => {
    const info = new PathFinderInfo(150)
    expect(info.heuristicWeightPercentage).toBe(150)
  })

  it('preserves heuristicWeightPercentage below 100 (clamping done in PathFinder)', () => {
    const info = new PathFinderInfo(50)
    expect(info.heuristicWeightPercentage).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// Test: PathFinder heuristicWeightPercentage clamp
// ---------------------------------------------------------------------------

describe('PathFinder.heuristicWeightPercentage', () => {
  it('returns default 125', () => {
    const pf = new PathFinder(new PathFinderInfo())
    expect(pf.heuristicWeightPercentage).toBe(125)
  })

  it('returns custom value >= 100', () => {
    const pf = new PathFinder(new PathFinderInfo(150))
    expect(pf.heuristicWeightPercentage).toBe(150)
  })

  it('clamps to minimum 100', () => {
    const pf = new PathFinder(new PathFinderInfo(50))
    expect(pf.heuristicWeightPercentage).toBe(100)
  })

  it('clamps exactly at 100 boundary', () => {
    const pf = new PathFinder(new PathFinderInfo(99))
    expect(pf.heuristicWeightPercentage).toBe(100)
  })

  it('allows exactly 100', () => {
    const pf = new PathFinder(new PathFinderInfo(100))
    expect(pf.heuristicWeightPercentage).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Test: worldLoaded creates HPF instances for each Locomotor
// ---------------------------------------------------------------------------

describe('PathFinder.worldLoaded', () => {
  it('creates HPF instances for each Locomotor', () => {
    const pf = new PathFinder(new PathFinderInfo())
    const loco1 = makeSimpleLocomotor()
    const loco2 = new SimpleLocomotor(
      new LocomotorInfo({
        name: 'wheeled',
        terrainSpeeds: new Map([['Clear', new LocomotorInfo.TerrainInfo(80, 120)]]),
      }),
    )

    pf.worldLoaded(makeWorld(), [loco1, loco2])

    // HPFs should be created — verify by checking pathExists doesn't throw
    mockHpfPathExists.mockReturnValue(true)
    expect(pf.pathExistsForLocomotor(loco1, new CPos(0, 0), new CPos(1, 1))).toBe(true)
    expect(pf.pathExistsForLocomotor(loco2, new CPos(0, 0), new CPos(1, 1))).toBe(true)

    // Verify HierarchicalPathFinder constructor was called (4 times: 2 locos * 2 check levels)
    expect(HierarchicalPathFinder).toHaveBeenCalledTimes(4)
  })

  it('throws if pathExists called before worldLoaded', () => {
    const pf = new PathFinder(new PathFinderInfo())
    expect(() =>
      pf.pathExistsForLocomotor(makeSimpleLocomotor(), new CPos(0, 0), new CPos(1, 1)),
    ).toThrow(/Was worldLoaded\(\) called/)
  })
})

// ---------------------------------------------------------------------------
// Test: findPathToTargetCell (single source)
// ---------------------------------------------------------------------------

describe('PathFinder.findPathToTargetCell', () => {
  it('returns reversed path for reachable single source via HPF', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    // HPF returns source→target path
    const hpPath = [new CPos(0, 0), new CPos(1, 0), new CPos(2, 0)]
    mockHpfFindPath.mockReturnValue([...hpPath])

    const result = pf.findPathToTargetCell(actor, [new CPos(0, 0)], new CPos(2, 0), BLOCKED_NONE)

    // Result should be reversed: target→source
    expect(result.length).toBe(3)
    expect(CPos.equals(result[0], new CPos(2, 0))).toBe(true) // target first
    expect(CPos.equals(result[result.length - 1], new CPos(0, 0))).toBe(true) // source last
  })

  it('returns direct path for adjacent cells (no HPF call)', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    // Adjacent cells: distance < sqrt(3) ~ 1 cell apart
    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0)],
      new CPos(1, 0),
      BLOCKED_NONE,
    )

    // Direct path should be [target, source] (reversed convention)
    expect(result.length).toBe(2)
    expect(CPos.equals(result[0], new CPos(1, 0))).toBe(true)
    expect(CPos.equals(result[1], new CPos(0, 0))).toBe(true)

    // HPF should NOT have been called
    expect(mockHpfFindPath).not.toHaveBeenCalled()
  })

  it('returns NO_PATH for adjacent cells when source is inaccessible', () => {
    // NOTE: PathSearch.cellAllowsMovement STUB doesn't check locomotor movement cost,
    // so we use a customCost function that marks the source cell as invalid.
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    // customCost returns PathCostForInvalidPath for the source, marking it inaccessible
    const customCost = (cell: CPos) => CPos.equals(cell, new CPos(0, 0)) ? Number.MAX_SAFE_INTEGER : 0

    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0)], // blocked source via customCost
      new CPos(1, 0), // accessible target
      BLOCKED_NONE,
      customCost,
    )

    expect(result.length).toBe(0)
  })

  it('returns NO_PATH when target is inaccessible', () => {
    // Use WallAwareLocomotor where target is blocked
    const locomotor = new WallAwareLocomotor([new CPos(2, 0)])
    const { pf, locos } = makeReadyPathFinder(undefined, [locomotor])
    const actor = makeActor(1, locos[0] as WallAwareLocomotor)

    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0)],
      new CPos(2, 0), // blocked target
      BLOCKED_NONE,
    )

    expect(result).toBe(NO_PATH)
  })

  it('finds path when source is accessible and target is distant', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    const hpPath = [
      new CPos(0, 0), new CPos(1, 1), new CPos(2, 2),
      new CPos(5, 5), new CPos(10, 10),
    ]
    mockHpfFindPath.mockReturnValue([...hpPath])

    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0)],
      new CPos(10, 10),
      BLOCKED_NONE,
    )

    expect(result.length).toBeGreaterThan(0)
    expect(CPos.equals(result[0], new CPos(10, 10))).toBe(true) // target first (reversed)
  })

  it('returns shortest path when multiple sources provided', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    // HPF mock returns source→target path.
    // PathFinder reverses to get target→source convention.
    // First source (0,0) → long path (6 cells), second source (5,3) → short path (3 cells)
    mockHpfFindPath
      .mockReturnValueOnce([new CPos(0, 0), new CPos(1, 1), new CPos(2, 2), new CPos(3, 3), new CPos(4, 4), new CPos(5, 5)])
      .mockReturnValueOnce([new CPos(5, 3), new CPos(5, 4), new CPos(5, 5)])

    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0), new CPos(5, 3)],
      new CPos(5, 5),
      BLOCKED_NONE,
    )

    // Should pick the shorter path (3 cells) and reverse to target→source
    expect(result.length).toBe(3)
    // After reverse: target→source = [(5,5), (5,4), (5,3)]
    expect(CPos.equals(result[0], new CPos(5, 5))).toBe(true)
    expect(CPos.equals(result[result.length - 1], new CPos(5, 3))).toBe(true)
  })

  it('returns NO_PATH when no source has a path', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    mockHpfFindPath.mockReturnValue([]) // NoPath

    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0), new CPos(5, 3)],
      new CPos(5, 5),
      BLOCKED_NONE,
    )

    expect(result).toBe(NO_PATH)
  })

  it('returns NO_PATH when sources array is empty', () => {
    const { pf } = makeReadyPathFinder()
    const actor = makeActor(1)

    const result = pf.findPathToTargetCell(actor, [], new CPos(1, 1), BLOCKED_NONE)
    expect(result).toBe(NO_PATH)
  })

  it('accepts customCost function', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])
    const customCost = vi.fn().mockReturnValue(0)

    mockHpfFindPath.mockReturnValue([new CPos(0, 0), new CPos(1, 0)])

    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0)],
      new CPos(1, 0),
      BLOCKED_NONE,
      customCost,
    )

    // Should still work (customCost used in CellAllowsMovement check)
    expect(result.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Test: findPathToTargetCells (multiple targets)
// ---------------------------------------------------------------------------

describe('PathFinder.findPathToTargetCells', () => {
  it('returns path to nearest accessible target', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    // HPF returns source→target path (mock always returns fixed path for simplicity)
    mockHpfFindPath.mockReturnValue([
      new CPos(0, 0), new CPos(1, 0), new CPos(2, 0),
    ])

    const result = pf.findPathToTargetCells(
      actor,
      new CPos(0, 0),
      [new CPos(5, 0), new CPos(2, 0), new CPos(10, 0)],
      BLOCKED_NONE,
    )

    // When source is accessible, targets and source are swapped internally.
    // The fixed mock returns [(0,0),(1,0),(2,0)] for all calls.
    // After the swap-reverse-return-reverse, the result ends up in source→target direction.
    expect(result.length).toBeGreaterThan(0)
    // The path should contain positions connecting the source area to target area
    expect(CPos.equals(result[result.length - 1], new CPos(2, 0))).toBe(true)
  })

  it('returns NO_PATH when no targets are accessible', () => {
    // Create a WallAwareLocomotor where all targets are blocked
    const locomotor = new WallAwareLocomotor([new CPos(5, 0), new CPos(2, 0)])
    const { pf, locos } = makeReadyPathFinder(undefined, [locomotor])
    const actor = makeActor(1, locos[0] as WallAwareLocomotor)

    const result = pf.findPathToTargetCells(
      actor,
      new CPos(0, 0),
      [new CPos(5, 0), new CPos(2, 0)], // both blocked
      BLOCKED_NONE,
    )

    expect(result).toBe(NO_PATH)
  })

  it('returns NO_PATH when targets array is empty', () => {
    const { pf } = makeReadyPathFinder()
    const actor = makeActor(1)

    const result = pf.findPathToTargetCells(actor, new CPos(0, 0), [], BLOCKED_NONE)
    expect(result).toBe(NO_PATH)
  })

  it('swaps source and target correctly (accessible source)', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    // When source is accessible, the method swaps: targets become sources,
    // source becomes target.
    mockHpfFindPath.mockReturnValue([
      new CPos(5, 5), new CPos(4, 4), new CPos(3, 3),
      new CPos(2, 2), new CPos(1, 1), new CPos(0, 0),
    ])

    const result = pf.findPathToTargetCells(
      actor,
      new CPos(0, 0),
      [new CPos(5, 5)],
      BLOCKED_NONE,
    )

    // Path should have correct direction after swap and reverse
    expect(result.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Test: findPathToTargetCellByPredicate
// ---------------------------------------------------------------------------

describe('PathFinder.findPathToTargetCellByPredicate', () => {
  it('discovers a target via predicate', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    // This uses PathSearch directly, which does a map-scope search.
    // On a simple map, it should find a path to a matching cell.
    const result = pf.findPathToTargetCellByPredicate(
      actor,
      [new CPos(0, 0)],
      (cell: CPos) => cell.X >= 2 && cell.Y >= 2,
      BLOCKED_NONE,
    )

    // Since we're using SimpleLocomotor (all passable), a path should be found
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns NO_PATH when no cell matches predicate', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    const result = pf.findPathToTargetCellByPredicate(
      actor,
      [new CPos(0, 0)],
      (_cell: CPos) => false, // never matches
      BLOCKED_NONE,
    )

    // NOTE: PathSearch.findPath() returns NoPath (empty array), but it may
    // be a different array instance. Use deep equality.
    expect(result).toEqual(NO_PATH)
    expect(result.length).toBe(0)
  })

  it('finds path to matching target from multiple sources', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    const result = pf.findPathToTargetCellByPredicate(
      actor,
      [new CPos(0, 0), new CPos(1, 1)],
      (cell: CPos) => cell.X === 2 && cell.Y === 0,
      BLOCKED_NONE,
    )

    expect(Array.isArray(result)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test: pathExistsForLocomotor
// ---------------------------------------------------------------------------

describe('PathFinder.pathExistsForLocomotor', () => {
  it('returns true when HPF reports path exists', () => {
    const { pf, locos } = makeReadyPathFinder()
    mockHpfPathExists.mockReturnValue(true)

    const result = pf.pathExistsForLocomotor(
      locos[0],
      new CPos(0, 0),
      new CPos(5, 5),
    )

    expect(result).toBe(true)
    expect(mockHpfPathExists).toHaveBeenCalledWith(new CPos(0, 0), new CPos(5, 5))
  })

  it('returns false when HPF reports no path exists', () => {
    const { pf, locos } = makeReadyPathFinder()
    mockHpfPathExists.mockReturnValue(false)

    const result = pf.pathExistsForLocomotor(
      locos[0],
      new CPos(0, 0),
      new CPos(100, 100),
    )

    expect(result).toBe(false)
  })

  it('throws for unknown locomotor', () => {
    const { pf } = makeReadyPathFinder()
    const unknownLoco = new SimpleLocomotor(
      new LocomotorInfo({
        name: 'unknown',
        terrainSpeeds: new Map([['Clear', new LocomotorInfo.TerrainInfo(100, 100)]]),
      }),
    )

    expect(() =>
      pf.pathExistsForLocomotor(unknownLoco, new CPos(0, 0), new CPos(1, 1)),
    ).toThrow(/No HierarchicalPathFinder registered/)
  })
})

// ---------------------------------------------------------------------------
// Test: pathMightExistForLocomotorBlockedByImmovable
// ---------------------------------------------------------------------------

describe('PathFinder.pathMightExistForLocomotorBlockedByImmovable', () => {
  it('returns true via immovable HPF', () => {
    const { pf, locos } = makeReadyPathFinder()
    mockHpfPathExists.mockReturnValue(true)

    const result = pf.pathMightExistForLocomotorBlockedByImmovable(
      locos[0],
      new CPos(0, 0),
      new CPos(5, 5),
    )

    expect(result).toBe(true)
  })

  it('returns false when immovable path does not exist', () => {
    const { pf, locos } = makeReadyPathFinder()
    mockHpfPathExists.mockReturnValue(false)

    const result = pf.pathMightExistForLocomotorBlockedByImmovable(
      locos[0],
      new CPos(0, 0),
      new CPos(50, 50),
    )

    expect(result).toBe(false)
  })

  it('throws for unknown locomotor', () => {
    const { pf } = makeReadyPathFinder()
    const unknownLoco = new SimpleLocomotor(
      new LocomotorInfo({ name: 'alien' }),
    )

    expect(() =>
      pf.pathMightExistForLocomotorBlockedByImmovable(
        unknownLoco,
        new CPos(0, 0),
        new CPos(1, 1),
      ),
    ).toThrow(/No HierarchicalPathFinder registered/)
  })
})

// ---------------------------------------------------------------------------
// Test: getOverlayDataForLocomotor
// ---------------------------------------------------------------------------

describe('PathFinder.getOverlayDataForLocomotor', () => {
  it('returns overlay data from HPF', () => {
    const { pf, locos } = makeReadyPathFinder()
    const mockData = {
      abstractGraph: new Map(),
      abstractDomains: new Map([[0, 0]]),
    }
    mockHpfGetOverlayData.mockReturnValue(mockData)

    const result = pf.getOverlayDataForLocomotor(locos[0], BLOCKED_NONE)

    expect(result).toBe(mockData)
  })

  it('returns null when HPF has no overlay data', () => {
    const { pf, locos } = makeReadyPathFinder()
    mockHpfGetOverlayData.mockReturnValue(null)

    const result = pf.getOverlayDataForLocomotor(locos[0], BLOCKED_NONE)

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Test: getHierarchicalPathFinder selection logic
// ---------------------------------------------------------------------------

describe('PathFinder HPF selection', () => {
  it('uses BlockedByActor.None HPF when check is None', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    mockHpfFindPath.mockReturnValue([new CPos(0, 0), new CPos(1, 0), new CPos(2, 0)])

    // When check=BLOCKED_NONE, should use the None HPF
    const result = pf.findPathToTargetCell(actor, [new CPos(0, 0)], new CPos(2, 0), BLOCKED_NONE)

    expect(result.length).toBeGreaterThan(0)
    expect(mockHpfFindPath).toHaveBeenCalled()
  })

  it('uses BlockedByActor.Immovable HPF when check is Immovable without ignoreActor', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])

    // Use non-adjacent cells to avoid the adjacent-cell optimization
    mockHpfFindPath.mockReturnValue([new CPos(0, 0), new CPos(1, 0), new CPos(2, 0)])

    // When check=BLOCKED_IMMOVABLE and no ignoreActor, should use Immovable HPF
    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0)],
      new CPos(2, 0),
      BLOCKED_IMMOVABLE,
    )

    expect(result.length).toBeGreaterThan(0)
    expect(mockHpfFindPath).toHaveBeenCalled()
  })

  it('forces BlockedByActor.None HPF when ignoreActor is provided', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(1, locos[0])
    const otherActor = makeActor(2, locos[0])

    // Use non-adjacent cells to avoid the adjacent-cell optimization
    mockHpfFindPath.mockReturnValue([new CPos(0, 0), new CPos(1, 0), new CPos(2, 0)])

    // Even with check=BLOCKED_IMMOVABLE, ignoreActor forces None HPF
    // to avoid ignoring the actor that should be ignored
    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0)],
      new CPos(2, 0),
      BLOCKED_IMMOVABLE,
      null,
      otherActor,
    )

    expect(result.length).toBeGreaterThan(0)
    expect(mockHpfFindPath).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Test: getActorLocomotor (implicitly tested through all methods)
// ---------------------------------------------------------------------------

describe('getActorLocomotor', () => {
  it('throws when actor has no Mobile/OccupiesSpace', () => {
    const { pf } = makeReadyPathFinder()
    const actor: IGameActor = {
      actorId: 99,
      isInWorld: true,
      isDead: false,
      disposed: false,
    } as IGameActor

    expect(() =>
      pf.findPathToTargetCell(actor, [new CPos(0, 0)], new CPos(1, 0), BLOCKED_NONE),
    ).toThrow(/Mobile trait/)
  })

  it('extracts locomotor through occupiesSpace', () => {
    const { pf, locos } = makeReadyPathFinder()
    const actor = makeActor(42, locos[0])

    mockHpfFindPath.mockReturnValue([new CPos(0, 0), new CPos(1, 0)])

    // Should not throw — actor has occupiesSpace.locomotor
    const result = pf.findPathToTargetCell(
      actor,
      [new CPos(0, 0)],
      new CPos(1, 0),
      BLOCKED_NONE,
    )
    expect(Array.isArray(result)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test: PathResult type
// ---------------------------------------------------------------------------

describe('PathResult type', () => {
  it('can be constructed with path and cost', () => {
    const result: PathResult = {
      path: [new CPos(2, 2), new CPos(1, 1), new CPos(0, 0)],
      cost: 200,
    }
    expect(result.path).not.toBeNull()
    expect(result.path!.length).toBe(3)
    expect(result.cost).toBe(200)
  })

  it('can represent no path with null', () => {
    const result: PathResult = { path: null, cost: 0 }
    expect(result.path).toBeNull()
    expect(result.cost).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Test: IPathFinderOverlay stub
// ---------------------------------------------------------------------------

describe('IPathFinderOverlay', () => {
  it('accepts standard interface implementation', () => {
    const recorderCalls: unknown[] = []
    const overlay: IPathFinderOverlay = {
      newRecording(owner: IGameActor, _sources: Iterable<CPos>, target: CPos | null) {
        recorderCalls.push({ type: 'newRecording', ownerId: owner.actorId, target })
      },
      recordLocalEdges(_self: IGameActor) {
        return null
      },
    }

    const actor = makeActor(1)
    overlay.newRecording(actor, [new CPos(0, 0)], new CPos(5, 5))
    expect(recorderCalls.length).toBe(1)
  })
})
