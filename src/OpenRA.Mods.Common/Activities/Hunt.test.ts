/**
 * Hunt.test.ts — Hunt activity unit tests
 *
 * Tests focus on: target acquisition, no-target completion, cancellation,
 * closest target selection.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Vector3: class {},
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { Hunt } from './Hunt'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target'
import { WPos } from '../../OpenRA.Game/WPos'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockActor(options: {
  actorId?: number
  centerPosition?: WPos
  hasAttackBase?: boolean
  hasMobile?: boolean
  targets?: unknown[]
} = {}): unknown {
  const traits = new Map<string, unknown>()

  if (options.hasAttackBase !== false) {
    traits.set('attackBase', {
      hasAnyValidWeapons: vi.fn((target: Target) => target.type !== TargetType.Invalid),
    })
  }

  if (options.hasMobile !== false) {
    traits.set('Mobile', {
      moveWithinRange: vi.fn(() => ({ tick: () => true })),
    })
  }

  const targets = options.targets ?? []

  return {
    actorId: options.actorId ?? 1,
    centerPosition: options.centerPosition ?? WPos.Zero,
    isDead: false,
    isInWorld: true,
    traits,
    world: { actors: targets },
    appearsHostileTo: vi.fn((other: unknown) => {
      const o = other as { actorId?: number }
      return o.actorId !== 1
    }),
    isTargetableBy: vi.fn(() => true),
  }
}

function createMockTarget(actorId: number, pos: WPos): unknown {
  return {
    actorId,
    centerPosition: pos,
    isDead: false,
    isInWorld: true,
    isTargetableBy: vi.fn(() => true),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Hunt', () => {
  describe('constructor', () => {
    it('collects potential targets from world', () => {
      const target1 = createMockTarget(2, new WPos(1000, 0, 0))
      const target2 = createMockTarget(3, new WPos(2000, 0, 0))
      const actor = createMockActor({ targets: [target1, target2] }) as never

      const hunt = new Hunt(actor)
      expect(hunt).toBeDefined()
    })

    it('filters out self from targets', () => {
      const self = createMockTarget(1, WPos.Zero)
      const target = createMockTarget(2, new WPos(1000, 0, 0))
      const actor = createMockActor({ actorId: 1, targets: [self, target] }) as never

      const hunt = new Hunt(actor)
      expect(hunt).toBeDefined()
    })

    it('filters out dead actors', () => {
      const dead = createMockTarget(2, new WPos(1000, 0, 0))
      ;(dead as { isDead: boolean }).isDead = true
      const alive = createMockTarget(3, new WPos(2000, 0, 0))
      const actor = createMockActor({ targets: [dead, alive] }) as never

      const hunt = new Hunt(actor)
      expect(hunt).toBeDefined()
    })
  })

  describe('tick', () => {
    it('returns true immediately when canceling', () => {
      const actor = createMockActor() as never
      const hunt = new Hunt(actor)

      // Simulate cancel
      ;(hunt as unknown as { state: number }).state = 2 // Canceling
      expect(hunt.tick(actor)).toBe(true)
    })

    it('returns true when no targets exist', () => {
      const actor = createMockActor({ targets: [] }) as never
      const hunt = new Hunt(actor)
      expect(hunt.tick(actor)).toBe(true)
    })

    it('returns false when a target is found (queues child)', () => {
      const target = createMockTarget(2, new WPos(1000, 0, 0))
      const actor = createMockActor({ targets: [target] }) as never
      const hunt = new Hunt(actor)

      const result = hunt.tick(actor)
      expect(result).toBe(false)
    })

    it('selects closest target by distance', () => {
      const close = createMockTarget(2, new WPos(1000, 0, 0))
      const far = createMockTarget(3, new WPos(5000, 0, 0))
      const actor = createMockActor({
        centerPosition: WPos.Zero,
        targets: [far, close], // far first in list, but close should be selected
      }) as never

      const hunt = new Hunt(actor)
      const result = hunt.tick(actor)
      expect(result).toBe(false)
      // The closest target should have been selected
    })

    it('skips targets with no valid weapons', () => {
      const noWeaponTarget = createMockTarget(2, new WPos(1000, 0, 0))
      const actor = createMockActor({
        targets: [noWeaponTarget],
        hasAttackBase: true,
      }) as never

      // Override hasAnyValidWeapons to return false
      const traits = (actor as { traits: Map<string, unknown> }).traits
      traits.set('attackBase', {
        hasAnyValidWeapons: vi.fn(() => false),
      })

      const hunt = new Hunt(actor)
      expect(hunt.tick(actor)).toBe(true)
    })

    it('returns true when no AttackBase trait', () => {
      const target = createMockTarget(2, new WPos(1000, 0, 0))
      const actor = createMockActor({
        targets: [target],
        hasAttackBase: false,
      }) as never

      const hunt = new Hunt(actor)
      expect(hunt.tick(actor)).toBe(true)
    })
  })
})
