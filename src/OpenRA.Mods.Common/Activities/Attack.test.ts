/**
 * Attack.test.ts — Attack activity unit tests
 *
 * Tests focus on: attack loop states, range checks, facing checks,
 * armament firing, target invalidation, cancellation, stance changes.
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

import { Attack } from './Attack'
import { Activity } from '../../OpenRA.Game/Activities/Activity'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target'
import { WPos } from '../../OpenRA.Game/WPos'
import { WDist } from '../../OpenRA.Game/WDist'
import { WAngle } from '../../OpenRA.Game/WAngle'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockArmament(options: {
  isTraitDisabled?: boolean
  isTraitPaused?: boolean
  maxRange?: WDist
  minRange?: WDist
  isValidAgainst?: boolean
} = {}): unknown {
  return {
    isTraitDisabled: options.isTraitDisabled ?? false,
    isTraitPaused: options.isTraitPaused ?? false,
    isReloading: false,
    maxRange: vi.fn(() => options.maxRange ?? WDist.fromCells(5)),
    weapon: {
      minRange: options.minRange ?? WDist.Zero,
      isValidAgainst: vi.fn(() => options.isValidAgainst ?? true),
      targetActorCenter: false,
    },
    checkFire: vi.fn(() => true),
    info: { name: 'primary' },
  }
}

function createMockAttackBase(armaments: unknown[] = []): unknown {
  return {
    isTraitDisabled: false,
    isTraitPaused: false,
    info: {
      armaments: ['primary'],
      attackRequiresEnteringCell: false,
      targetFrozenActors: false,
      facingTolerance: new WAngle(512),
      targetTerrainWithoutForceFire: false,
    },
    chooseArmamentsForTarget: vi.fn(() => armaments),
    hasAnyValidWeapons: vi.fn((target: Target) => target.type !== TargetType.Invalid),
    getMaximumRangeVersusTarget: vi.fn(() => WDist.fromCells(5)),
    getMinimumRangeVersusTarget: vi.fn(() => WDist.Zero),
    targetInFiringArc: vi.fn(() => true),
    getTargetPosition: vi.fn((_pos: WPos, target: Target) => target.centerPosition),
    doAttack: vi.fn(),
    isAiming: false,
  }
}

function createMockActor(options: {
  actorId?: number
  centerPosition?: WPos
  facing?: WAngle
  turnSpeed?: WAngle
  hasAttackBase?: boolean
  armaments?: unknown[]
  hasMobile?: boolean
  allowMovement?: boolean
} = {}): unknown {
  const traits = new Map<string, unknown>()

  if (options.hasAttackBase !== false) {
    const attackBase = createMockAttackBase(options.armaments ?? [createMockArmament()])
    traits.set('attackBase', attackBase)
  }

  traits.set('facing', {
    facing: options.facing ?? new WAngle(0),
    turnSpeed: options.turnSpeed ?? new WAngle(16),
  })

  if (options.hasMobile !== false) {
    traits.set('Mobile', {
      isTraitDisabled: false,
      isTraitPaused: false,
      canInteractWithGroundLayer: vi.fn(() => true),
      moveResult: 0,
      moveWithinRangeMinMax: vi.fn((_self: unknown, _target: Target, _minRange: WDist, _maxRange: WDist, _initialPos: WPos, _color: unknown) => {
        return new MockMoveActivity()
      }),
    })
  }

  // Add all traits under '' key (OpenRA TraitDictionary convention)
  traits.set('', Array.from(traits.values()))

  return {
    actorId: options.actorId ?? 1,
    centerPosition: options.centerPosition ?? WPos.Zero,
    isInWorld: true,
    isDead: false,
    traits,
    world: { sharedRandom: { next: vi.fn(() => 0.5) } },
    owner: { playerName: 'test' },
  }
}

function createMockTargetActor(pos: WPos = new WPos(1000, 0, 0)): unknown {
  return {
    actorId: 2,
    centerPosition: pos,
    isInWorld: true,
    isDead: false,
    generation: 1,
    isTargetableBy: vi.fn(() => true),
    getTargetablePositions: vi.fn(() => [pos]),
    getEnabledTargetTypes: vi.fn(() => new Set(['Building'])),
    owner: { playerName: 'enemy' },
    canBeViewedByPlayer: vi.fn(() => true),
    location: { X: 1, Y: 1 },
  }
}

class MockMoveActivity extends Activity {
  override tick(): boolean {
    return true
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Attack', () => {
  describe('constructor', () => {
    it('stores target, forceAttack, and targetLineColor', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const color = { r: 255, g: 0, b: 0, a: 255 }
      const attack = new Attack(actor, target, true, false, color)

      expect((attack as unknown as { target: Target }).target).toBe(target)
      expect(attack.forceAttack).toBe(false)
      expect((attack as unknown as { targetLineColor: unknown }).targetLineColor).toBe(color)
    })

    it('sets childHasPriority to false', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const attack = new Attack(actor, target, true, false)
      expect(attack.childHasPriority).toBe(false)
    })
  })

  describe('tick', () => {
    it('cancels when no armaments for target', () => {
      const actor = createMockActor({ hasAttackBase: false }) as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const attack = new Attack(actor, target, true, false)

      // Set state to Active so cancel() sets Canceling (not Done)
      ;(attack as unknown as { state: number }).state = 1 // Active = 1
      // Should cancel immediately because no attack traits
      attack.tick(actor)
      expect(attack.isCanceling).toBe(true)
    })

    it('returns true when canceling and child done', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const attack = new Attack(actor, target, true, false)

      // Set state to Active so cancel() sets Canceling instead of Done
      ;(attack as unknown as { state: number }).state = 1 // Active = 1
      attack.cancel(actor, true)
      const result = attack.tick(actor)
      expect(result).toBe(true)
    })

    it('returns false when target is in range and attacking', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor(new WPos(1000, 0, 0))
      const target = Target.fromActor(targetActor as never)
      const attack = new Attack(actor, target, true, false)

      // Set state to Active for proper tick behavior
      ;(attack as unknown as { state: number }).state = 1 // Active = 1
      // Target at 1000,0,0 is within 5 cells (5120 units) range
      const result = attack.tick(actor)
      // Should be attacking (in range, facing correct), returns false to continue
      expect(result).toBe(false)
    })

    it('queues move when target is out of range', () => {
      const actor = createMockActor() as never
      const farPos = new WPos(10000, 0, 0) // 10 cells away
      const targetActor = createMockTargetActor(farPos)
      const target = Target.fromActor(targetActor as never)
      const attack = new Attack(actor, target, true, false)

      // Set state to Active for proper tick behavior
      ;(attack as unknown as { state: number }).state = 1 // Active = 1
      const result = attack.tick(actor)
      // Should need to move (out of range)
      expect(result).toBe(false)
    })

    it('handles invalid target', () => {
      const actor = createMockActor() as never
      const target = Target.Invalid
      const attack = new Attack(actor, target, true, false)

      const result = attack.tick(actor)
      // Invalid target should cause completion
      expect(result).toBe(true)
    })

    it('uses lastVisibleTarget when target becomes hidden', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      // Make actor dead (will become hidden after recalculate)
      ;(targetActor as { isDead: boolean }).isDead = true
      const target = Target.fromActor(targetActor as never)
      const attack = new Attack(actor, target, true, false)

      // First tick to set up lastVisibleTarget
      attack.tick(actor)
      // After recalculate, target should be invalid/hidden
      // useLastVisibleTarget should be set
      expect((attack as unknown as { useLastVisibleTarget: boolean }).useLastVisibleTarget).toBe(true)
    })

    it('turns toward target when not in firing arc', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor(new WPos(1000, 0, 0))
      const target = Target.fromActor(targetActor as never)

      // Override targetInFiringArc to report out-of-arc
      const traits = (actor as { traits: Map<string, unknown> }).traits
      const attackBase = traits.get('attackBase') as Record<string, unknown>
      attackBase['targetInFiringArc'] = vi.fn(() => false)
      // Rebuild the OpenRA convention aggregate trait array
      traits.set('', Array.from(traits.values()))

      const attack = new Attack(actor, target, true, false)
      ;(attack as unknown as { state: number }).state = 1 // Active
      const result = attack.tick(actor)
      // Needs to turn, so not done
      expect(result).toBe(false)
    })
  })

  describe('targetLineNodes', () => {
    it('returns empty when no targetLineColor', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const attack = new Attack(actor, target, true, false)
      expect(attack.targetLineNodes(actor)).toEqual([])
    })

    it('returns target line node when targetLineColor is set', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const color = { r: 255, g: 0, b: 0, a: 255 }
      const attack = new Attack(actor, target, true, false, color)

      const nodes = attack.targetLineNodes(actor)
      expect(nodes.length).toBe(1)
      expect(nodes[0]!.color).toBe(color)
    })
  })

  describe('onLastRun', () => {
    it('resets isAiming on all attack traits', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)

      // Set up aiming state on the mock BEFORE creating Attack
      const traits = (actor as { traits: Map<string, unknown> }).traits
      const attackBase = traits.get('attackBase') as Record<string, unknown>
      attackBase['isAiming'] = true

      const a = new Attack(actor, target, true, false)

      // Call onLastRun
      const aCast = a as unknown as { onLastRun(self: unknown): void }
      aCast.onLastRun(actor)

      expect(attackBase['isAiming']).toBe(false)
    })
  })

  describe('stanceChanged', () => {
    it('does not cancel forced targets', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const attack = new Attack(actor, target, true, true) // forceAttack = true

      // Simulate stance change to more restrictive
      ;(attack as unknown as { stanceChanged(self: unknown, autoTarget: unknown, oldStance: number, newStance: number): void })
        .stanceChanged(actor, null, 3, 2) // AttackAnything -> Defend

      // Target should still be valid (forceAttack)
      expect((attack as unknown as { target: Target }).target.type).not.toBe(TargetType.Invalid)
    })
  })
})
