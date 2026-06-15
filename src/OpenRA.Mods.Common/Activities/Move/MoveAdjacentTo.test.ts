/**
 * MoveAdjacentTo.test.ts — MoveAdjacentTo 迁移单元测试
 *
 * Tests focus on: construction, tick delegation, target line delegation.
 */

import { describe, it, expect } from 'vitest'
import { MoveAdjacentTo } from './MoveAdjacentTo.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
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

describe('MoveAdjacentTo', () => {
  describe('constructor', () => {
    it('creates with target', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const move = new MoveAdjacentTo(self, target)
      expect(move).toBeDefined()
    })

    it('accepts custom color', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const color = { r: 1, g: 0, b: 0, a: 1 }
      const move = new MoveAdjacentTo(self, target, null, color)
      expect(move).toBeDefined()
    })
  })

  describe('tick', () => {
    it('completes when target is invalid', () => {
      const self = mockActor()
      const move = new MoveAdjacentTo(self, Target.Invalid)
      const result = move.tick(self)
      expect(result).toBe(true)
    })

    it('ticks with valid target (activity queues child move)', () => {
      const self = mockActor(new CPos(0, 0))
      const target = Target.fromCell(new CPos(10, 10))
      const move = new MoveAdjacentTo(self, target)
      // tickOuter returns the activity itself when still running (child queued)
      const result = move.tickOuter(self)
      expect(result).toBe(move)
    })
  })

  describe('target lines', () => {
    it('returns nodes when color is provided', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const color = { r: 1, g: 0, b: 0, a: 1 }
      const move = new MoveAdjacentTo(self, target, null, color)
      const nodes = move.targetLineNodes(self)
      expect(nodes.length).toBeGreaterThan(0)
    })
  })
})
