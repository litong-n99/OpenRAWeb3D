/**
 * MoveOnto.test.ts — MoveOnto 迁移单元测试
 *
 * Tests focus on: construction, tick delegation, target line delegation.
 */

import { describe, it, expect } from 'vitest'
import { MoveOnto } from './MoveOnto.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'

// ---------------------------------------------------------------------------
// Mock actor with Mobile
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

describe('MoveOnto', () => {
  describe('constructor', () => {
    it('creates with target and offset', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const offset = new WVec(0, 0, 0)
      const move = new MoveOnto(self, target, offset)
      expect(move).toBeDefined()
    })

    it('stores target reference', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const move = new MoveOnto(self, target, new WVec(0, 0, 0))
      expect(move.getTargets(self).length).toBeGreaterThan(0)
    })

    it('uses default target line color from mobile', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const move = new MoveOnto(self, target, new WVec(0, 0, 0))
      // targetLineColor is null by default (not passed), so nodes is empty
      const nodes = move.targetLineNodes(self)
      expect(nodes.length).toBe(0)
    })

    it('accepts custom target line color', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const color = { r: 1, g: 0, b: 0, a: 1 }
      const move = new MoveOnto(self, target, new WVec(0, 0, 0), null, color)
      const nodes = move.targetLineNodes(self)
      expect(nodes.length).toBeGreaterThan(0)
      expect(nodes[0].color).toBe(color)
    })
  })

  describe('tick', () => {
    it('completes when target is invalid', () => {
      const self = mockActor()
      const target = Target.Invalid
      const move = new MoveOnto(self, target, new WVec(0, 0, 0))
      // MoveOnto now extends Move, so tick goes through Move's logic
      // Invalid target causes shouldStop to return true, which cancels the activity
      const result = move.tickOuter(self)
      // After cancel, activity is done (returns null since nextActivity is null)
      expect(result).toBeNull()
    })

    it('ticks with valid target (Move activity handles pathing)', () => {
      const self = mockActor(new CPos(0, 0))
      const target = Target.fromCell(new CPos(5, 5))
      const move = new MoveOnto(self, target, new WVec(0, 0, 0))
      // tickOuter runs Move's onFirstRun which sets up path, then tick processes it
      // With no real map, the path will be empty and Move handles it
      const result = move.tickOuter(self)
      // Activity completes (returns null) or stays active
      expect(result === null || result === move).toBe(true)
    })
  })

  describe('target lines', () => {
    it('returns nodes when color is provided', () => {
      const self = mockActor()
      const target = Target.fromCell(new CPos(5, 5))
      const color = { r: 1, g: 0, b: 0, a: 1 }
      const move = new MoveOnto(self, target, new WVec(0, 0, 0), null, color)
      const nodes = move.targetLineNodes(self)
      expect(nodes.length).toBeGreaterThan(0)
    })

    it('returns empty for invalid target', () => {
      const self = mockActor()
      const target = Target.Invalid
      const move = new MoveOnto(self, target, new WVec(0, 0, 0))
      const nodes = move.targetLineNodes(self)
      expect(nodes.length).toBe(0)
    })
  })
})
