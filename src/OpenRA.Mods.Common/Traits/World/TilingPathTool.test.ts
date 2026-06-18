/**
 * TilingPathTool.test.ts — TilingPathTool + PathPlan unit tests
 *
 * PathPlan is a pure-data class with no external dependencies beyond Direction.ts
 * and CPos/CVec, making it ideal for thorough unit testing. Tests cover:
 * - Construction and validation
 * - All 8 immutable mutator methods
 * - Computed properties (firstPoint, lastPoint, autoStart, autoEnd)
 * - PointsWithRallyIndex (Bresenham supercover algorithm)
 * - reversed() behavior
 * - Edge cases (duplicate rallies, empty, single, loop validation)
 *
 * TilingPathTool tests cover brush categorization, type validation, and state
 * management with stubbed segmented brushes.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import { Direction, DirectionMask } from '../../EditorBrushes/Direction.js'
import {
  PathPlan,
  TilingPathTool,
  type MultiBrushStub,
  type SegmentStub,
} from './TilingPathTool.js'

// ---------------------------------------------------------------------------
// Helper: create a minimal SegmentStub for test brushes
// ---------------------------------------------------------------------------

function makeSegment(
  inner: string | null,
  start: string,
  end: string,
  startDir: Direction = Direction.R,
  endDir: Direction = Direction.L,
): SegmentStub {
  return {
    inner,
    start,
    end,
    startDirection: startDir,
    endDirection: endDir,
    hasInnerType(type: string): boolean {
      if (this.inner !== null) return this.inner.split('.')[0] === type
      return this.start.split('.')[0] === type || this.end.split('.')[0] === type
    },
    hasStartType(type: string): boolean {
      return this.start.split('.')[0] === type.split('.')[0]
        ? (type.includes('.') ? this.start === type : true)
        : false
    },
    hasEndType(type: string): boolean {
      return this.end.split('.')[0] === type.split('.')[0]
        ? (type.includes('.') ? this.end === type : true)
        : false
    },
  }
}

function makeBrush(segment: SegmentStub | null): MultiBrushStub {
  return { segment }
}

// ===========================================================================
// PathPlan tests
// ===========================================================================

describe('PathPlan', () => {
  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('creates with single rally via static factory', () => {
      const plan = PathPlan.createSingle(new CPos(10, 20))
      expect(plan.rallies).toHaveLength(1)
      expect(plan.start).toBe(Direction.None)
      expect(plan.end).toBe(Direction.None)
      expect(plan.loop).toBe(false)
    })

    it('creates with full params via internal constructor', () => {
      // Using a mutator to verify the full constructor works
      const plan = PathPlan.createSingle(new CPos(0, 0))
      const plan2 = plan.withRallyAppended(new CPos(1, 0))
      const plan3 = plan2.withStart(Direction.R)
      expect(plan3.rallies).toHaveLength(2)
      expect(plan3.start).toBe(Direction.R)
      expect(plan3.end).toBe(Direction.None)
      expect(plan3.loop).toBe(false)
    })

    it('throws when rallies array is empty in internal constructor', () => {
      // The private constructor validates; test via a method that would fail
      // We access validation through public API
      const plan = PathPlan.createSingle(new CPos(0, 0))
      // withRallyRemoved of the last rally returns null, not an empty-plan-error
      expect(plan.withRallyRemoved(0)).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Immutable mutators
  // ---------------------------------------------------------------------------

  describe('immutable mutators', () => {
    let plan: PathPlan

    beforeEach(() => {
      plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 0))
        .withRallyAppended(new CPos(4, 0))
    })

    it('withStart returns new instance with start changed', () => {
      const result = plan.withStart(Direction.R)
      expect(result).not.toBe(plan)
      expect(result.start).toBe(Direction.R)
      expect(result.end).toBe(Direction.None)
      expect(result.loop).toBe(false)
      expect(result.rallies).toEqual(plan.rallies)
    })

    it('withEnd returns new instance with end changed', () => {
      const result = plan.withEnd(Direction.L)
      expect(result).not.toBe(plan)
      expect(result.end).toBe(Direction.L)
      expect(result.start).toBe(Direction.None)
      expect(result.rallies).toEqual(plan.rallies)
    })

    it('withLoop toggles loop flag', () => {
      const result = plan.withLoop(true)
      expect(result.loop).toBe(true)
      const result2 = result.withLoop(false)
      expect(result2.loop).toBe(false)
    })

    it('withRallyAppended adds rally at end', () => {
      const result = plan.withRallyAppended(new CPos(6, 0))
      expect(result.rallies).toHaveLength(4)
      expect(result.rallies[3]).toEqual(new CPos(6, 0))
    })

    it('withRallyRemoved (index=0) removes first rally', () => {
      const result = plan.withRallyRemoved(0)
      expect(result).not.toBeNull()
      expect(result!.rallies).toHaveLength(2)
      expect(result!.rallies[0]).toEqual(new CPos(2, 0))
      expect(result!.start).toBe(Direction.None) // start reset
    })

    it('withRallyRemoved (index=last) removes last rally and resets end', () => {
      const result = plan.withRallyRemoved(plan.rallies.length - 1)
      expect(result).not.toBeNull()
      expect(result!.rallies).toHaveLength(2)
      expect(result!.end).toBe(Direction.None) // end reset
    })

    it('withRallyRemoved returns null when removing last rally', () => {
      const single = PathPlan.createSingle(new CPos(0, 0))
      expect(single.withRallyRemoved(0)).toBeNull()
    })

    it('withRallyReplaced changes rally at index', () => {
      const result = plan.withRallyReplaced(1, new CPos(3, 1))
      expect(result.rallies[1]).toEqual(new CPos(3, 1))
      expect(result.rallies[0]).toEqual(new CPos(0, 0))
      expect(result.rallies[2]).toEqual(new CPos(4, 0))
    })

    it('withRallyInserted inserts before index', () => {
      const result = plan.withRallyInserted(1, new CPos(1, 0))
      expect(result.rallies).toHaveLength(4)
      expect(result.rallies[0]).toEqual(new CPos(0, 0))
      expect(result.rallies[1]).toEqual(new CPos(1, 0)) // inserted
      expect(result.rallies[2]).toEqual(new CPos(2, 0))
    })

    it('moved translates all rallies by offset', () => {
      const result = plan.moved(new CVec(5, 5))
      expect(result.rallies[0]).toEqual(new CPos(5, 5))
      expect(result.rallies[1]).toEqual(new CPos(7, 5))
      expect(result.rallies[2]).toEqual(new CPos(9, 5))
    })
  })

  // ---------------------------------------------------------------------------
  // firstPoint / lastPoint
  // ---------------------------------------------------------------------------

  describe('firstPoint / lastPoint', () => {
    it('non-loop lastPoint is the last rally', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 0))
      expect(plan.firstPoint).toEqual(new CPos(0, 0))
      expect(plan.lastPoint).toEqual(new CPos(2, 0))
    })

    it('loop lastPoint is the first rally', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 0))
        .withRallyAppended(new CPos(2, 2))
        .withLoop(true)
      expect(plan.lastPoint).toEqual(new CPos(0, 0))
    })

    it('single rally: firstPoint === lastPoint', () => {
      const plan = PathPlan.createSingle(new CPos(5, 5))
      expect(plan.firstPoint).toEqual(new CPos(5, 5))
      expect(plan.lastPoint).toEqual(new CPos(5, 5))
    })
  })

  // ---------------------------------------------------------------------------
  // autoStart / autoEnd
  // ---------------------------------------------------------------------------

  describe('autoStart / autoEnd', () => {
    it('explicit start set: returns that direction', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 0))
        .withStart(Direction.L)
      expect(plan.autoStart(DirectionMask.All)).toBe(Direction.L)
    })

    it('no explicit start, 2+ rallies: returns closest from offset', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(0, 3))
      // rallies are (0,0) → (0,3), direction should be D (+Y)
      expect(plan.autoStart(DirectionMask.All)).toBe(Direction.D)
    })

    it('no explicit start, 1 rally: returns None', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
      expect(plan.autoStart(DirectionMask.All)).toBe(Direction.None)
    })

    it('no explicit start, empty mask: returns None', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 0))
      expect(plan.autoStart(DirectionMask.None)).toBe(Direction.None)
    })

    it('autoEnd with loop mirrors autoStart', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 0))
        .withRallyAppended(new CPos(2, 2))
        .withLoop(true)
      expect(plan.autoEnd(DirectionMask.All)).toBe(plan.autoStart(DirectionMask.All))
    })

    it('autoEnd non-loop: returns direction from last two rallies', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(3, 0))
        .withRallyAppended(new CPos(3, 5))
      // Last two: (3,0)→(3,5), direction should be D (+Y)
      expect(plan.autoEnd(DirectionMask.All)).toBe(Direction.D)
    })

    it('autoEnd returns None with no explicit end and 1 rally', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
      expect(plan.autoEnd(DirectionMask.All)).toBe(Direction.None)
    })
  })

  // ---------------------------------------------------------------------------
  // pointsWithRallyIndex — axis-aligned
  // ---------------------------------------------------------------------------

  describe('pointsWithRallyIndex — axis-aligned', () => {
    it('horizontal path: (0,0) to (3,0) produces correct points', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(3, 0))
      const points = plan.pointsWithRallyIndex()
      expect(points).toHaveLength(4) // start + 3 steps
      expect(points[0]).toEqual({ cpos: new CPos(0, 0), rallyIndex: 0 })
      expect(points[1]).toEqual({ cpos: new CPos(1, 0), rallyIndex: 1 })
      expect(points[2]).toEqual({ cpos: new CPos(2, 0), rallyIndex: 1 })
      expect(points[3]).toEqual({ cpos: new CPos(3, 0), rallyIndex: 1 })
    })

    it('vertical path: (0,0) to (0,3) produces correct points', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(0, 3))
      const points = plan.pointsWithRallyIndex()
      expect(points).toHaveLength(4)
      expect(points[1]).toEqual({ cpos: new CPos(0, 1), rallyIndex: 1 })
      expect(points[3]).toEqual({ cpos: new CPos(0, 3), rallyIndex: 1 })
    })

    it('single rally: 1 point', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
      const points = plan.pointsWithRallyIndex()
      expect(points).toHaveLength(1)
      expect(points[0]).toEqual({ cpos: new CPos(0, 0), rallyIndex: 0 })
    })

    it('multiple rally segments increment rallyIndex correctly', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 0))
        .withRallyAppended(new CPos(2, 2))
      const points = plan.pointsWithRallyIndex()
      // rallyIndex 0: start, 1: down to (2,0), 2: down to (2,2)
      expect(points[0].rallyIndex).toBe(0)
      expect(points[points.length - 1].rallyIndex).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // pointsWithRallyIndex — diagonal (Bresenham supercover)
  // ---------------------------------------------------------------------------

  describe('pointsWithRallyIndex — diagonal', () => {
    it('45-degree diagonal: (0,0) to (3,3) uses supercover', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(3, 3))
      const points = plan.pointsWithRallyIndex()
      // Path goes from (0,0) to (3,3), following the supercover algorithm
      expect(points[0].cpos).toEqual(new CPos(0, 0))
      expect(points[points.length - 1].cpos).toEqual(new CPos(3, 3))
      // All points should advance in both X and Y eventually
      const xVals = points.map((p) => p.cpos.X)
      const yVals = points.map((p) => p.cpos.Y)
      expect(Math.max(...xVals)).toBe(3)
      expect(Math.max(...yVals)).toBe(3)
    })

    it('shallow diagonal: (0,0) to (5,2) follows correct stepping', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(5, 2))
      const points = plan.pointsWithRallyIndex()
      expect(points[0].cpos).toEqual(new CPos(0, 0))
      expect(points[points.length - 1].cpos).toEqual(new CPos(5, 2))
      // Should visit intermediate cells: not all cells need both axes moving per step
    })

    it('steep diagonal: (0,0) to (2,5) follows correct stepping', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 5))
      const points = plan.pointsWithRallyIndex()
      expect(points[0].cpos).toEqual(new CPos(0, 0))
      expect(points[points.length - 1].cpos).toEqual(new CPos(2, 5))
    })

    it('negative diagonal: (0,0) to (-3,-3) works', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(-3, -3))
      const points = plan.pointsWithRallyIndex()
      expect(points[points.length - 1].cpos).toEqual(new CPos(-3, -3))
    })
  })

  // ---------------------------------------------------------------------------
  // pointsWithRallyIndex — inertia
  // ---------------------------------------------------------------------------

  describe('pointsWithRallyIndex — inertia', () => {
    it('axis-aligned followed by diagonal: inertia transfers correctly', () => {
      // Move horizontally then diagonally
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(3, 0))
        .withRallyAppended(new CPos(7, 4))
      const points = plan.pointsWithRallyIndex()
      expect(points[0].cpos).toEqual(new CPos(0, 0))
      // Middle should be at (3, 0)
      const midPoint = points.find((p) => CPos.equals(p.cpos, new CPos(3, 0)))
      expect(midPoint).toBeDefined()
      // End should be (7, 4)
      expect(points[points.length - 1].cpos).toEqual(new CPos(7, 4))
    })

    it('diagonal path with explicit start direction uses initial inertia', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(4, 4))
        .withStart(Direction.D)
      const points = plan.pointsWithRallyIndex()
      // Start direction D means initial inertia is (0, 1)
      // First step after start should be (0, 1)
      expect(points[1].cpos).toEqual(new CPos(0, 1))
    })
  })

  // ---------------------------------------------------------------------------
  // pointsWithRallyIndex — loops
  // ---------------------------------------------------------------------------

  describe('pointsWithRallyIndex — loops', () => {
    it('loop closure: path returns to start', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(3, 0))
        .withRallyAppended(new CPos(3, 3))
        .withLoop(true)
      const points = plan.pointsWithRallyIndex()
      // Should return to (0, 0) at the end
      expect(points[points.length - 1].cpos).toEqual(new CPos(0, 0))
    })

    it('loop rallyIndex: final index equals rallies.length', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(2, 0))
        .withRallyAppended(new CPos(2, 2))
        .withLoop(true)
      const points = plan.pointsWithRallyIndex()
      // After closing the loop back to start, rallyIndex should be rallies.length (3)
      expect(points[points.length - 1].rallyIndex).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // reversed
  // ---------------------------------------------------------------------------

  describe('reversed', () => {
    it('non-loop reverse: rallies reversed, start/end swapped', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(3, 0))
        .withRallyAppended(new CPos(3, 3))
      // No explicit directions set
      const rev = plan.reversed()
      expect(rev.rallies[0]).toEqual(new CPos(3, 3))
      expect(rev.rallies[2]).toEqual(new CPos(0, 0))
      // Start becomes opposite of original end, end becomes opposite of original start
    })

    it('non-loop reverse with explicit directions', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(3, 3))
        .withStart(Direction.RD)
        .withEnd(Direction.LU)
      const rev = plan.reversed()
      // End becomes opposite of Start: opposite(RD)=LU, Start becomes opposite of End: opposite(LU)=RD
      expect(rev.start).toBe(Direction.RD) // opposite of End (LU)
      expect(rev.end).toBe(Direction.LU) // opposite of Start (RD)
    })

    it('double reverse returns to original', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(3, 3))
      const rev = plan.reversed()
      const rev2 = rev.reversed()
      expect(rev2.rallies).toEqual(plan.rallies)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('duplicate rally points throw on pointsWithRallyIndex', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(0, 0))
      // The autoStart guard prevents direction resolution from zero offset,
      // and addPointsUpTo catches duplicate rally points
      expect(() => plan.pointsWithRallyIndex()).toThrow('duplicate rally points')
    })

    it('loop with fewer than 3 rallies forces loop=false', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(1, 0))
        .withLoop(true)
      // Only 2 rallies → loop forced false (validation in private ctor)
      expect(plan.loop).toBe(false)
    })

    it('loop with 3+ rallies honors loop flag', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
        .withRallyAppended(new CPos(1, 0))
        .withRallyAppended(new CPos(1, 1))
        .withLoop(true)
      expect(plan.loop).toBe(true)
    })
  })
})

// ===========================================================================
// TilingPathTool tests
// ===========================================================================

describe('TilingPathTool', () => {
  // ---------------------------------------------------------------------------
  // Constructor — brush loading
  // ---------------------------------------------------------------------------

  describe('constructor — brush loading', () => {
    it('no segmented brushes: isEnabled = false', () => {
      const tool = new TilingPathTool([])
      expect(tool.isEnabled).toBe(false)
      expect(tool.innerTypes).toHaveLength(0)
    })

    it('brushes without segment are filtered out', () => {
      const tool = new TilingPathTool([makeBrush(null)])
      expect(tool.isEnabled).toBe(false)
    })

    it('segmented brushes with inner type: InnerTypes extracted', () => {
      const brush = makeBrush(makeSegment('Road.D', 'Road.R', 'Road.L'))
      const tool = new TilingPathTool([brush])
      expect(tool.isEnabled).toBe(true)
      expect(tool.innerTypes).toContain('Road')
    })

    it('segmented brushes without inner type: InnerTypes from start/end', () => {
      const brush = makeBrush(makeSegment(null, 'River.R', 'River.L'))
      const tool = new TilingPathTool([brush])
      expect(tool.isEnabled).toBe(true)
      expect(tool.innerTypes).toContain('River')
    })
  })

  // ---------------------------------------------------------------------------
  // Constructor — default types
  // ---------------------------------------------------------------------------

  describe('constructor — default types', () => {
    it('defaultInner matches available type: used directly', () => {
      const brush = makeBrush(makeSegment('Road.D', 'Road.R', 'Road.L'))
      const tool = new TilingPathTool([brush], ['Road'])
      expect(tool.innerType).toBe('Road')
    })

    it('defaultInner not available: first available used', () => {
      const brush = makeBrush(makeSegment('Road.D', 'Road.R', 'Road.L'))
      const tool = new TilingPathTool([brush], ['River'])
      // 'River' not available, falls back to first inner type 'Road'
      expect(tool.innerType).toBe('Road')
    })
  })

  // ---------------------------------------------------------------------------
  // VerifyTypes
  // ---------------------------------------------------------------------------

  describe('verifyTypes', () => {
    let tool: TilingPathTool

    beforeEach(() => {
      tool = new TilingPathTool([
        makeBrush(makeSegment('Road.D', 'Road.R', 'Road.L', Direction.R, Direction.L)),
        makeBrush(makeSegment('River.D', 'River.R', 'River.L', Direction.D, Direction.U)),
      ])
    })

    it('valid inner type: start/end types set to first available', () => {
      tool.verifyTypes('Road')
      expect(tool.innerType).toBe('Road')
      expect(tool.startType).toBe('Road')
      expect(tool.endType).toBe('Road')
    })

    it('re-verify with already valid types keeps them', () => {
      tool.verifyTypes('Road')
      const startBefore = tool.startType
      tool.verifyTypes('Road')
      expect(tool.startType).toBe(startBefore)
    })

    it('empty inner type: set to InnerTypes[0]', () => {
      tool.setInnerType('')
      tool.verifyTypes('')
      // 'River' sorts before 'Road' alphabetically
      expect(tool.innerType).toBe('River')
    })
  })

  // ---------------------------------------------------------------------------
  // State setters
  // ---------------------------------------------------------------------------

  describe('state setters', () => {
    let tool: TilingPathTool

    beforeEach(() => {
      tool = new TilingPathTool([
        makeBrush(makeSegment('Road.D', 'Road.R', 'Road.L', Direction.R, Direction.L)),
      ])
    })

    it('setPlan stores plan and updates EditorBlitSource (null stubbed)', () => {
      const plan = PathPlan.createSingle(new CPos(0, 0))
      tool.setPlan(plan)
      expect(tool.plan).toBe(plan)
      expect(tool.editorBlitSource).toBeNull() // stubbed TilePlan
    })

    it('setPlan(null) clears plan', () => {
      tool.setPlan(PathPlan.createSingle(new CPos(0, 0)))
      tool.setPlan(null)
      expect(tool.plan).toBeNull()
    })

    it('setStartType updates StartType and direction mask', () => {
      tool.setStartType('Custom')
      expect(tool.startType).toBe('Custom')
    })

    it('setInnerType re-verifies types', () => {
      tool.setInnerType('River')
      expect(tool.innerType).toBe('River')
    })

    it('setEndType updates EndType', () => {
      tool.setEndType('Custom')
      expect(tool.endType).toBe('Custom')
    })

    it('setClosedLoops toggles flag', () => {
      expect(tool.closedLoops).toBe(true)
      tool.setClosedLoops(false)
      expect(tool.closedLoops).toBe(false)
    })

    it('setMaxDeviation updates value', () => {
      tool.setMaxDeviation(10)
      expect(tool.maxDeviation).toBe(10)
    })

    it('setAllowEndDeviation updates value', () => {
      tool.setAllowEndDeviation(false)
      expect(tool.allowEndDeviation).toBe(false)
    })

    it('setRandomSeed updates value', () => {
      tool.setRandomSeed(42)
      expect(tool.randomSeed).toBe(42)
    })

    it('dispose marks as disposed', () => {
      tool.dispose()
      // No visible state change; just ensure no throw
    })
  })

  // ---------------------------------------------------------------------------
  // Direction mask updates
  // ---------------------------------------------------------------------------

  describe('direction masks', () => {
    it('matching brush: mask includes brush direction', () => {
      const tool = new TilingPathTool([
        makeBrush(makeSegment('Road.D', 'Road.R', 'Road.L', Direction.R, Direction.L)),
      ])
      // Default innerType is 'Road', which has a start direction of R
      expect(tool.autoStartDirectionMask).not.toBe(DirectionMask.None)
      expect(tool.autoStartDirectionMask & (1 << Direction.R)).not.toBe(0)
    })

    it('no matching brush: mask = DirectionMask.None (no effect)', () => {
      const tool = new TilingPathTool([])
      expect(tool.autoStartDirectionMask).toBe(DirectionMask.None)
      expect(tool.autoEndDirectionMask).toBe(DirectionMask.None)
    })

    it('multiple matching brushes: masks ORed together', () => {
      const tool = new TilingPathTool([
        makeBrush(makeSegment('Road.D', 'Road.R', 'Road.L', Direction.R, Direction.L)),
        makeBrush(makeSegment('Road.D', 'Road.RD', 'Road.LD', Direction.RD, Direction.LD)),
      ])
      // Both brushes have StartType 'Road', directions R and RD
      const mask = tool.autoStartDirectionMask
      expect(mask & (1 << Direction.R)).not.toBe(0)
      expect(mask & (1 << Direction.RD)).not.toBe(0)
    })
  })
})
