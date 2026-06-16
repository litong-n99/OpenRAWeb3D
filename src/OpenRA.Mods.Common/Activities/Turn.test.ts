/**
 * Turn.test.ts — Turn activity unit tests
 *
 * Tests focus on: state transitions, facing rotation, cancellation,
 * Mobile trait disabled/paused handling.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — not needed for activity tests, but import safety
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Vector3: class {},
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { Turn } from './Turn'
import { WAngle } from '../../OpenRA.Game/WAngle'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockActor(options: {
  facing?: WAngle
  turnSpeed?: WAngle
  mobileDisabled?: boolean
  mobilePaused?: boolean
  noMobile?: boolean
  noFacing?: boolean
} = {}): unknown {
  const traits = new Map<string, unknown>()

  if (!options.noFacing) {
    traits.set('facing', {
      facing: options.facing ?? new WAngle(0),
      turnSpeed: options.turnSpeed ?? new WAngle(16),
    })
  }

  if (!options.noMobile) {
    traits.set('Mobile', {
      isTraitDisabled: options.mobileDisabled ?? false,
      isTraitPaused: options.mobilePaused ?? false,
    })
  }

  return { traits }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Turn', () => {
  describe('constructor', () => {
    it('stores desiredFacing', () => {
      const actor = createMockActor() as never
      const desired = new WAngle(128)
      const turn = new Turn(actor, desired)
      expect(turn.desiredFacing).toBe(desired)
    })
  })

  describe('tick', () => {
    it('returns true immediately when already facing desired direction', () => {
      const actor = createMockActor({ facing: new WAngle(64) }) as never
      const turn = new Turn(actor, new WAngle(64))
      expect(turn.tick(actor)).toBe(true)
    })

    it('returns true when canceling', () => {
      const actor = createMockActor({ facing: new WAngle(0) }) as never
      const turn = new Turn(actor, new WAngle(128))
      // Simulate cancel
      ;(turn as unknown as { state: number }).state = 2 // Canceling
      expect(turn.tick(actor)).toBe(true)
    })

    it('rotates toward desired facing by turnSpeed', () => {
      const actor = createMockActor({
        facing: new WAngle(0),
        turnSpeed: new WAngle(16),
      }) as never
      const turn = new Turn(actor, new WAngle(64))

      const result1 = turn.tick(actor)
      expect(result1).toBe(false)

      const facing = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing.facing.angle).toBe(16)
    })

    it('completes after reaching desired facing', () => {
      const actor = createMockActor({
        facing: new WAngle(0),
        turnSpeed: new WAngle(16),
      }) as never
      const turn = new Turn(actor, new WAngle(32))

      // First tick: 0 -> 16
      expect(turn.tick(actor)).toBe(false)
      const facing1 = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing1.facing.angle).toBe(16)

      // Second tick: 16 -> 32
      expect(turn.tick(actor)).toBe(true)
      const facing2 = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing2.facing.angle).toBe(32)
    })

    it('handles wrap-around (0 -> 1020 with turnSpeed 16) in one tick', () => {
      const actor = createMockActor({
        facing: new WAngle(0),
        turnSpeed: new WAngle(16),
      }) as never
      const turn = new Turn(actor, new WAngle(1020))

      // 0 -> 1020: shortest path is backward (diff = 1020, absDiff = 4)
      // move = min(4, 16) = 4, so 0 -> 1020 in one tick
      const result = turn.tick(actor)
      expect(result).toBe(true) // complete in one tick

      const facing = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing.facing.angle).toBe(1020)
    })

    it('waits (returns false) when Mobile is disabled', () => {
      const actor = createMockActor({
        facing: new WAngle(0),
        turnSpeed: new WAngle(16),
        mobileDisabled: true,
      }) as never
      const turn = new Turn(actor, new WAngle(64))
      expect(turn.tick(actor)).toBe(false)

      // Facing should NOT have changed
      const facing = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing.facing.angle).toBe(0)
    })

    it('waits (returns false) when Mobile is paused', () => {
      const actor = createMockActor({
        facing: new WAngle(0),
        turnSpeed: new WAngle(16),
        mobilePaused: true,
      }) as never
      const turn = new Turn(actor, new WAngle(64))
      expect(turn.tick(actor)).toBe(false)

      // Facing should NOT have changed
      const facing = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing.facing.angle).toBe(0)
    })

    it('returns true immediately if no facing trait', () => {
      const actor = createMockActor({ noFacing: true }) as never
      const turn = new Turn(actor, new WAngle(64))
      expect(turn.tick(actor)).toBe(true)
    })

    it('turns correctly when no Mobile trait (only IFacing)', () => {
      const actor = createMockActor({
        facing: new WAngle(0),
        turnSpeed: new WAngle(16),
        noMobile: true,
      }) as never
      const turn = new Turn(actor, new WAngle(32))

      expect(turn.tick(actor)).toBe(false)
      const facing = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing.facing.angle).toBe(16)

      expect(turn.tick(actor)).toBe(true)
      expect(facing.facing.angle).toBe(32)
    })

    it('handles large turn with small turnSpeed (multiple ticks)', () => {
      const actor = createMockActor({
        facing: new WAngle(0),
        turnSpeed: new WAngle(8),
      }) as never
      const turn = new Turn(actor, new WAngle(64))

      // Should take 8 ticks (64 / 8 = 8)
      let ticks = 0
      while (!turn.tick(actor)) {
        ticks++
        expect(ticks).toBeLessThan(20) // safety
      }
      expect(ticks).toBe(7) // 8 ticks total, 7 returns false, 8th returns true

      const facing = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing.facing.angle).toBe(64)
    })

    it('handles 180-degree turn (512 units) with turnSpeed 16', () => {
      const actor = createMockActor({
        facing: new WAngle(0),
        turnSpeed: new WAngle(16),
      }) as never
      const turn = new Turn(actor, new WAngle(512))

      let ticks = 0
      while (!turn.tick(actor)) {
        ticks++
        expect(ticks).toBeLessThan(50)
      }
      // 512 / 16 = 32 ticks
      expect(ticks).toBe(31)

      const facing = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      expect(facing.facing.angle).toBe(512)
    })

    it('handles wrap-around through 0 (e.g., 1000 -> 24)', () => {
      const actor = createMockActor({
        facing: new WAngle(1000),
        turnSpeed: new WAngle(32),
      }) as never
      const turn = new Turn(actor, new WAngle(24))

      // Shortest path: 1000 -> 24 is +48 forward (or -976 backward)
      // Forward: 1000 -> 1024(0) -> 24 = 48 units
      // Backward: 1000 -> 24 = 976 units
      // So should go forward: 1000 -> 1032(8) -> ... -> 24
      const result = turn.tick(actor)
      expect(result).toBe(false)

      const facing = (actor as { traits: Map<string, unknown> }).traits.get('facing') as { facing: WAngle }
      // 1000 + 32 = 1032, normalized to 8
      expect(facing.facing.angle).toBe(8)
    })
  })
})
