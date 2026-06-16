/**
 * Follow.test.ts — Follow 迁移单元测试
 *
 * Tests focus on: construction, tick behavior, target line delegation.
 */

import { describe, it, expect } from 'vitest'
import { Follow } from './Follow.js'
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

describe('Follow', () => {
  describe('constructor', () => {
    it('creates with target and range', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const range = new WDist(2048)
      const follow = new Follow(self, target, range, range)
      expect(follow).toBeDefined()
    })

    it('accepts custom color', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const color = { r: 1, g: 0, b: 0, a: 1 }
      const follow = new Follow(self, target, new WDist(1024), new WDist(2048), null, color)
      expect(follow).toBeDefined()
    })
  })

  describe('tick', () => {
    it('completes when target is invalid', () => {
      const self = mockActor()
      const follow = new Follow(self, Target.Invalid, new WDist(2048), new WDist(2048))
      const result = follow.tick(self)
      expect(result).toBe(true)
    })

    it('ticks with valid target (activity stays active for following)', () => {
      const self = mockActor(new CPos(0, 0))
      const target = Target.fromCell(new CPos(10, 10))
      const follow = new Follow(self, target, new WDist(1024), new WDist(2048))
      // tickOuter returns the activity itself when still running
      const result = follow.tickOuter(self)
      expect(result).toBe(follow)
    })
  })

  describe('target lines', () => {
    it('returns nodes when color is provided', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const color = { r: 1, g: 0, b: 0, a: 1 }
      const follow = new Follow(self, target, new WDist(1024), new WDist(2048), null, color)
      const nodes = follow.targetLineNodes(self)
      expect(nodes.length).toBeGreaterThan(0)
    })
  })
})
