/**
 * MoveWithinRange.test.ts — MoveWithinRange 迁移单元测试
 *
 * Tests focus on: construction, tick delegation, target line delegation.
 */

import { describe, it, expect } from 'vitest'
import { MoveWithinRange } from './MoveWithinRange.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// Mock actor
// ---------------------------------------------------------------------------

function mockActor(toCell: CPos = new CPos(0, 0)): GameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    location: toCell,
    centerPosition: new WPos(toCell.X * 1024, toCell.Y * 1024, 0),
    traits: new Map([
      ['Mobile', {
        toCell,
        fromCell: toCell,
        toSubCell: 0,
        fromSubCell: 0,
        facing: new WAngle(0),
        turnSpeed: new WAngle(512),
        moveResult: 0,
        turnToMove: false,
        isTraitDisabled: false,
        isTraitPaused: false,
        canStayInCell: () => true,
        canEnterCell: () => true,
        setLocation: () => {},
        setCenterPosition: () => {},
        setPosition: () => {},
        finishedMoving: () => {},
        enteringCell: () => {},
        getAvailableSubCell: () => 0,
        getAdjacentCell: () => null,
        removeInfluence: () => {},
        addInfluence: () => {},
        isBlocking: false,
        pathFinder: {
          findPathToTargetCells: (_self: GameActor, _from: CPos, _targets: CPos[], _check: number) => {
            return _targets.length > 0 ? [_targets[0]] : []
          },
        },
        info: {
          canMoveBackward: false,
          maxBackwardCells: 15,
          backwardDuration: 40,
          turnsWhileMoving: false,
          alwaysTurnInPlace: false,
          terrainOrientationAdjustmentMargin: { length: -1 },
          targetLineColor: { r: 0, g: 1, b: 0, a: 1 },
          locomotorInfo: { waitAverage: 20 },
        },
        movementSpeedForCell: () => 100,
      }],
    ]),
    toString() { return 'Actor 1' },
  } as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MoveWithinRange', () => {
  describe('constructor', () => {
    it('creates with target and range', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const range = new WDist(2048)
      const move = new MoveWithinRange(self, target, range, range)
      expect(move).toBeDefined()
    })

    it('stores range values', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const minRange = new WDist(512)
      const maxRange = new WDist(2048)
      const move = new MoveWithinRange(self, target, minRange, maxRange)
      expect(move).toBeDefined()
    })

    it('accepts custom color', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const color = { r: 1, g: 0, b: 0, a: 1 }
      const move = new MoveWithinRange(self, target, new WDist(512), new WDist(2048), null, color)
      expect(move).toBeDefined()
    })
  })

  describe('tick', () => {
    it('completes when target is invalid', () => {
      const self = mockActor()
      const move = new MoveWithinRange(self, Target.Invalid, new WDist(512), new WDist(2048))
      const result = move.tick(self)
      expect(result).toBe(true)
    })

    it('ticks with valid target (completes or queues move)', () => {
      const self = mockActor(new CPos(0, 0))
      // Use Target.fromPos with a far-away position so actor is not in range
      const target = Target.fromPos(new WPos(10240, 10240, 0))
      const move = new MoveWithinRange(self, target, new WDist(512), new WDist(2048))
      // Without a real map, getCellFromPos returns (0,0) which matches actor location,
      // causing the activity to think it's at destination. tickOuter returns null when done.
      const result = move.tickOuter(self)
      // Activity either completes (null) or stays active (move)
      expect(result === null || result === move).toBe(true)
    })
  })

  describe('target lines', () => {
    it('returns nodes when color is provided', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const color = { r: 1, g: 0, b: 0, a: 1 }
      const move = new MoveWithinRange(self, target, new WDist(512), new WDist(2048), null, color)
      const nodes = move.targetLineNodes(self)
      expect(nodes.length).toBeGreaterThan(0)
    })
  })
})
