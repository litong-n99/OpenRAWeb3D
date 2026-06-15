/**
 * Move.test.ts — Move 迁移单元测试
 *
 * Tests focus on: construction, path following, cancellation, move results, target lines.
 */

import { describe, it, expect } from 'vitest'
import { Move } from './Move.js'
import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MoveResult } from '../../Traits/Mobile.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import type { ColorStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mock actor with Mobile trait
// ---------------------------------------------------------------------------

function mockActor(
  toCell: CPos = new CPos(0, 0),
  fromCell: CPos = new CPos(0, 0),
  facing: WAngle = new WAngle(0),
): GameActor & { _mobile: ReturnType<typeof mockMobile> } {
  const mobile = mockMobile(toCell, fromCell, facing)
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traits: new Map([['Mobile', mobile]]),
    _mobile: mobile,
    toString() { return 'Actor 1' },
  } as unknown as GameActor & { _mobile: ReturnType<typeof mockMobile> }
}

function mockMobile(toCell: CPos, fromCell: CPos, facing: WAngle) {
  return {
    toCell,
    fromCell,
    toSubCell: 0,
    fromSubCell: 0,
    facing,
    turnSpeed: new WAngle(512),
    moveResult: MoveResult.InProgress,
    turnToMove: false,
    isTraitDisabled: false,
    isTraitPaused: false,
    canStayInCell: () => true,
    canEnterCell: () => true,
    setLocation: (_from: CPos, _fromSub: number, _to: CPos, _toSub: number) => {},
    setCenterPosition: (_self: GameActor, _pos: WPos) => {},
    setPosition: (_self: GameActor, _cell: CPos) => {},
    finishedMoving: (_self: GameActor) => {},
    enteringCell: (_self: GameActor) => {},
    getAvailableSubCell: (_cell: CPos, _preferred: number, _ignore?: GameActor | null) => 0,
    getAdjacentCell: (_nextCell: CPos) => null,
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
      targetLineColor: { r: 0, g: 1, b: 0, a: 1 } as ColorStub,
      locomotorInfo: { waitAverage: 20 },
    },
    movementSpeedForCell: (_cell: CPos) => 100,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Move', () => {
  describe('constructor', () => {
    it('creates with destination cell', () => {
      const self = mockActor(new CPos(0, 0), new CPos(0, 0))
      const dest = new CPos(5, 5)
      const move = new Move(self, dest)
      expect(move).toBeDefined()
    })

    it('creates with custom path function', () => {
      const self = mockActor()
      const getPath = (_check: number) => ({ alreadyAtDestination: false, path: [new CPos(1, 0)] })
      const move = new Move(self, getPath)
      expect(move).toBeDefined()
    })

    it('sets nearEnough and ignoreActor', () => {
      const self = mockActor()
      const ignore = { actorId: 2 } as unknown as GameActor
      const move = new Move(self, new CPos(5, 5), 1024, ignore)
      expect(move.nearEnough).toBe(1024)
      expect(move.ignoreActor).toBe(ignore)
    })

    it('is interruptible by default', () => {
      const self = mockActor()
      const move = new Move(self, new CPos(5, 5))
      expect(move.isInterruptible).toBe(true)
    })
  })

  describe('onFirstRun', () => {
    it('sets move result to InProgress', () => {
      const self = mockActor(new CPos(0, 0), new CPos(0, 0))
      const move = new Move(self, new CPos(0, 0))
      move.tickOuter(self as unknown as GameActor)
      expect(self._mobile.moveResult).toBe(MoveResult.InProgress)
    })

    it('completes when already at destination', () => {
      const dest = new CPos(5, 5)
      const self = mockActor(dest, dest)
      const move = new Move(self, dest)
      // tickOuter returns null when activity completes (nextActivity is null)
      const result = move.tickOuter(self as unknown as GameActor)
      expect(result).toBeNull()
      expect(self._mobile.moveResult).toBe(MoveResult.CompleteDestinationReached)
    })
  })

  describe('tick', () => {
    it('returns false when trait is disabled', () => {
      const self = mockActor()
      self._mobile.isTraitDisabled = true
      const move = new Move(self, new CPos(5, 5))
      move.tickOuter(self as unknown as GameActor)
      const result = move.tick(self as unknown as GameActor)
      expect(result).toBe(false)
    })

    it('returns false when trait is paused', () => {
      const self = mockActor()
      self._mobile.isTraitPaused = true
      const move = new Move(self, new CPos(5, 5))
      move.tickOuter(self as unknown as GameActor)
      const result = move.tick(self as unknown as GameActor)
      expect(result).toBe(false)
    })

    it('sets CompleteCanceled when canceling', () => {
      const self = mockActor(new CPos(0, 0), new CPos(0, 0))
      const move = new Move(self, new CPos(5, 5))
      move.tickOuter(self as unknown as GameActor)
      move.cancel(self as unknown as GameActor)
      const result = move.tick(self as unknown as GameActor)
      expect(result).toBe(true)
      expect(self._mobile.moveResult).toBe(MoveResult.CompleteCanceled)
    })
  })

  describe('cancel', () => {
    it('sets isCanceling when canceling active move', () => {
      const self = mockActor(new CPos(0, 0), new CPos(0, 0))
      // Path with adjacent cell so tick doesn't complete immediately
      const move = new Move(self, (_check) => ({ alreadyAtDestination: false, path: [new CPos(0, 0), new CPos(1, 0)] }))
      move.tickOuter(self as unknown as GameActor)
      move.cancel(self as unknown as GameActor)
      expect(move.isCanceling).toBe(true)
    })

    it('preserves next queue when keepQueue=true', () => {
      const self = mockActor()
      const move = new Move(self, new CPos(5, 5))
      const next = new (class extends Activity {
        override tick(): boolean { return true }
      })()
      move.queue(next)
      move.cancel(self as unknown as GameActor, true)
      expect(move.nextActivity).toBe(next)
    })
  })

  describe('target lines', () => {
    it('returns target line for destination cell', () => {
      const self = mockActor()
      const color = { r: 1, g: 0, b: 0, a: 1 } as ColorStub
      const dest = new CPos(5, 5)
      const move = new Move(self, dest, color)
      const nodes = move.targetLineNodes(self as unknown as GameActor)
      expect(nodes.length).toBe(1)
      expect(nodes[0].color).toBe(color)
    })

    it('returns empty when no destination', () => {
      const self = mockActor()
      const move = new Move(self, (_check) => ({ alreadyAtDestination: false, path: [] }))
      const nodes = move.targetLineNodes(self as unknown as GameActor)
      expect(nodes.length).toBe(0)
    })
  })

  describe('accessors', () => {
    it('exposes _mobile', () => {
      const self = mockActor()
      const move = new Move(self, new CPos(5, 5))
      expect(move._mobile).toBeDefined()
    })

    it('exposes _carryoverProgress', () => {
      const self = mockActor()
      const move = new Move(self, new CPos(5, 5))
      expect(move._carryoverProgress).toBe(0)
      move._carryoverProgress = 50
      expect(move._carryoverProgress).toBe(50)
    })
  })
})
