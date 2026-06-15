/**
 * AttackMoveActivity.test.ts — AttackMoveActivity 迁移单元测试
 *
 * Tests focus on: construction, tick behavior.
 */

import { describe, it, expect } from 'vitest'
import { AttackMoveActivity } from './AttackMoveActivity.js'
import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
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
      ['AttackMove', {
        targetLineColor: { r: 1, g: 0, b: 0, a: 1 },
      }],
    ]),
    toString() { return 'Actor 1' },
  } as unknown as GameActor
}

function createDummyActivity(): Activity {
  return new (class extends Activity {
    override tick(): boolean { return true }
  })()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AttackMoveActivity', () => {
  describe('constructor', () => {
    it('creates with getMove function', () => {
      const self = mockActor()
      const getMove = () => createDummyActivity()
      const activity = new AttackMoveActivity(self, getMove)
      expect(activity).toBeDefined()
    })

    it('stores assaultMove flag', () => {
      const self = mockActor()
      const getMove = () => createDummyActivity()
      const activity = new AttackMoveActivity(self, getMove, true)
      expect(activity.isAssaultMove).toBe(true)
    })
  })

  describe('tick', () => {
    it('completes immediately when autoTarget is missing', () => {
      const self = mockActor()
      const getMove = () => createDummyActivity()
      const activity = new AttackMoveActivity(self, getMove)
      // Mock actor has no AutoTarget trait, so activity completes immediately
      const result = activity.tick(self)
      expect(result).toBe(true)
    })

    it('queues move child via getMove on first tick when autoTarget is present', () => {
      const self = mockActor()
      // Add AutoTarget trait
      const autoTarget = {
        scanForTarget: () => ({ type: 0 }), // Invalid target
        allowMove: true,
        activeAttackBases: [],
      }
      ;(self as unknown as { traits: Map<string, unknown> }).traits.set('AutoTarget', autoTarget)

      let moveCalled = false
      const getMove = () => {
        moveCalled = true
        return createDummyActivity()
      }
      const activity = new AttackMoveActivity(self, getMove)
      activity.tick(self)
      expect(moveCalled).toBe(true)
    })
  })
})
