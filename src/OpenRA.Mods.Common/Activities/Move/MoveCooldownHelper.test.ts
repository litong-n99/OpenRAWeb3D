/**
 * MoveCooldownHelper.test.ts — MoveCooldownHelper 迁移单元测试
 *
 * Tests focus on: cooldown timing, retry logic, move result handling, reset.
 */

import { describe, it, expect } from 'vitest'
import { MoveCooldownHelper } from './MoveCooldownHelper.js'
import { MoveResult } from '../../Traits/Mobile.js'

// ---------------------------------------------------------------------------
// Mock Mobile
// ---------------------------------------------------------------------------

function mockMobile(moveResult: MoveResult = MoveResult.InProgress): { mobile: { moveResult: MoveResult } } {
  return { mobile: { moveResult } }
}

function castMobile(m: { moveResult: MoveResult }): import('../../Traits/Mobile.js').Mobile {
  return m as unknown as import('../../Traits/Mobile.js').Mobile
}

// ---------------------------------------------------------------------------
// Mock World with random
// ---------------------------------------------------------------------------

function mockWorld(randomValue: number = 0.5): { world: { sharedRandom: { next(): number } } } {
  return { world: { sharedRandom: { next: () => randomValue } } }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MoveCooldownHelper', () => {
  describe('constructor', () => {
    it('initializes with default values', () => {
      const helper = new MoveCooldownHelper(null, null)
      expect(helper.retryIfDestinationBlocked).toBe(false)
      expect(helper.cooldown).toEqual([20, 31])
    })

    it('accepts world and mobile references', () => {
      const { world } = mockWorld()
      const { mobile } = mockMobile()
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      expect(helper).toBeDefined()
    })
  })

  describe('notifyMoveQueued', () => {
    it('sets wasMoving flag', () => {
      const helper = new MoveCooldownHelper(null, null)
      helper.notifyMoveQueued()
      // tick should now enter the "wasMoving" branch
      const result = helper.tick(false)
      // With no mobile, it should treat as complete and return null
      expect(result).toBeNull()
    })
  })

  describe('tick - no move queued', () => {
    it('returns null when no move has been queued', () => {
      const helper = new MoveCooldownHelper(null, null)
      expect(helper.tick(false)).toBeNull()
      expect(helper.tick(false)).toBeNull()
    })
  })

  describe('tick - target hidden', () => {
    it('returns true when target is hidden', () => {
      const { world } = mockWorld()
      const { mobile } = mockMobile(MoveResult.InProgress)
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      helper.notifyMoveQueued()
      expect(helper.tick(true)).toBe(true)
    })
  })

  describe('tick - move completed', () => {
    it('returns null and resets wasMoving when move is complete (destination reached)', () => {
      const { world } = mockWorld()
      const { mobile } = mockMobile(MoveResult.CompleteDestinationReached)
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      helper.notifyMoveQueued()
      // After completion, returns null and resets
      expect(helper.tick(false)).toBeNull()
      // Next tick should also return null (wasMoving reset)
      expect(helper.tick(false)).toBeNull()
    })

    it('returns null and resets wasMoving when move is canceled', () => {
      const { world } = mockWorld()
      const { mobile } = mockMobile(MoveResult.CompleteCanceled)
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      helper.notifyMoveQueued()
      expect(helper.tick(false)).toBeNull()
    })
  })

  describe('tick - destination blocked', () => {
    it('returns true when blocked and retry is disabled', () => {
      const { world } = mockWorld()
      const { mobile } = mockMobile(MoveResult.CompleteDestinationBlocked)
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      helper.retryIfDestinationBlocked = false
      helper.notifyMoveQueued()
      expect(helper.tick(false)).toBe(true)
    })

    it('starts cooldown when blocked and retry is enabled', () => {
      const { world } = mockWorld(0.0)
      const { mobile } = mockMobile(MoveResult.CompleteDestinationBlocked)
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      helper.retryIfDestinationBlocked = true
      helper.cooldown = [5, 10]
      helper.notifyMoveQueued()
      // First tick starts cooldown, returns false
      expect(helper.tick(false)).toBe(false)
    })

    it('counts down cooldown ticks', () => {
      const { world } = mockWorld(0.0)
      const { mobile } = mockMobile(MoveResult.CompleteDestinationBlocked)
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      helper.retryIfDestinationBlocked = true
      helper.cooldown = [2, 3]
      helper.notifyMoveQueued()
      // Start cooldown
      helper.tick(false)
      // Count down
      expect(helper.tick(false)).toBe(false)
      expect(helper.tick(false)).toBe(false)
      // After cooldown expires, wasMoving is reset, returns null
      expect(helper.tick(false)).toBeNull()
    })
  })

  describe('tick - cooldown with jitter', () => {
    it('uses random value for cooldown duration', () => {
      const { world } = mockWorld(0.5)
      const { mobile } = mockMobile(MoveResult.CompleteDestinationBlocked)
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      helper.retryIfDestinationBlocked = true
      helper.cooldown = [10, 20]
      helper.notifyMoveQueued()
      // With random=0.5, cooldown should be 10 + floor(0.5 * 10) = 15
      helper.tick(false)
      // Tick 15 times
      for (let i = 0; i < 14; i++) {
        expect(helper.tick(false)).toBe(false)
      }
      // After 15 ticks, cooldown expires
      expect(helper.tick(false)).toBe(false)
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      const { world } = mockWorld()
      const { mobile } = mockMobile(MoveResult.CompleteDestinationBlocked)
      const helper = new MoveCooldownHelper(world, castMobile(mobile))
      helper.retryIfDestinationBlocked = true
      helper.notifyMoveQueued()
      helper.tick(false) // start cooldown
      helper.reset()
      // After reset, should behave as if no move was queued
      expect(helper.tick(false)).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('handles null mobile gracefully', () => {
      const helper = new MoveCooldownHelper(null, null)
      helper.notifyMoveQueued()
      // With null mobile, treats as complete
      expect(helper.tick(false)).toBeNull()
    })

    it('handles null world gracefully (no random)', () => {
      const { mobile } = mockMobile(MoveResult.CompleteDestinationBlocked)
      const helper = new MoveCooldownHelper(null, castMobile(mobile))
      helper.retryIfDestinationBlocked = true
      helper.cooldown = [5, 10]
      helper.notifyMoveQueued()
      // Without random, uses minTicks
      expect(helper.tick(false)).toBe(false)
    })
  })
})
