/**
 * Enter.test.ts — Enter abstract base class unit tests
 *
 * Tests focus on: state transitions, cancellation, target tracking,
 * subclass hook invocation.
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

import { Enter, EnterState, EnterBehaviour } from './Enter'
import { Activity } from '../../OpenRA.Game/Activities/Activity'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target'
import { WPos } from '../../OpenRA.Game/WPos'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class TestEnter extends Enter {
  tickInnerCalled = false
  tryStartEnterCalled = false
  tryStartEnterResult = true
  onEnterCompleteCalled = false
  enterCompleteTarget: unknown = null

  protected override tickInner(_self: unknown, _target: Target, _targetIsDeadOrHiddenActor: boolean): void {
    this.tickInnerCalled = true
  }

  protected override tryStartEnter(_self: unknown, _targetActor: unknown): boolean {
    this.tryStartEnterCalled = true
    this.enterCompleteTarget = _targetActor
    return this.tryStartEnterResult
  }

  protected override onEnterComplete(_self: unknown, _targetActor: unknown): void {
    this.onEnterCompleteCalled = true
    this.enterCompleteTarget = _targetActor
  }

  // Public accessors for testing protected properties
  getTestTarget(): Target { return this.target }
  getTestTargetLineColor(): unknown { return this.targetLineColor }
  getTestLastState(): number { return this.lastState }
  getTestLastVisibleTarget(): Target { return this.lastVisibleTarget }
  getTestUseLastVisibleTarget(): boolean { return this.useLastVisibleTarget }
}

function createMockActor(options: {
  centerPosition?: WPos
  hasMobile?: boolean
  mobileDisabled?: boolean
  mobilePaused?: boolean
} = {}): unknown {
  const traits = new Map<string, unknown>()

  if (options.hasMobile !== false) {
    traits.set('Mobile', {
      isTraitDisabled: options.mobileDisabled ?? false,
      isTraitPaused: options.mobilePaused ?? false,
      moveResult: 0,
      moveToTarget: vi.fn(() => new MockMoveActivity()),
      moveIntoTarget: vi.fn(() => new MockMoveActivity()),
      returnToCell: vi.fn(() => new MockMoveActivity()),
      canEnterTargetNow: vi.fn(() => true),
    })
  }

  return {
    traits,
    centerPosition: options.centerPosition ?? WPos.Zero,
    world: { sharedRandom: { next: vi.fn(() => 0.5) } },
    owner: { playerName: 'test' },
  }
}

class MockMoveActivity extends Activity {
  override tick(): boolean {
    return true
  }
}

function createMockTargetActor(pos: WPos = WPos.Zero): unknown {
  return {
    actorId: 2,
    centerPosition: pos,
    isInWorld: true,
    isDead: false,
    generation: 1,
    isTargetableBy: vi.fn(() => true),
    getTargetablePositions: vi.fn(() => [pos]),
    owner: { playerName: 'enemy' },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Enter', () => {
  describe('constructor', () => {
    it('stores target and targetLineColor', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const enter = new TestEnter(actor, target, { r: 255, g: 0, b: 0, a: 255 })

      expect(enter.getTestTarget()).toBe(target)
      expect(enter.getTestTargetLineColor()).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    })

    it('initializes lastState to Approaching', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const enter = new TestEnter(actor, target)
      expect(enter.getTestLastState()).toBe(EnterState.Approaching)
    })

    it('sets childHasPriority to false', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const enter = new TestEnter(actor, target)
      expect(enter.childHasPriority).toBe(false)
    })
  })

  describe('state machine', () => {
    it('starts in Approaching state', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const enter = new TestEnter(actor, target)
      expect(enter.getTestLastState()).toBe(EnterState.Approaching)
    })

    it('transitions Approaching -> Entering when canEnterTargetNow is true and tryStartEnter returns true', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const enter = new TestEnter(actor, target)

      // First tick: should be in Approaching, queue moveToTarget child
      const result = enter.tick(actor)
      expect(result).toBe(false)
      expect(enter.getTestLastState()).toBe(EnterState.Entering)
    })

    it('calls tickInner on each tick', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const enter = new TestEnter(actor, target)

      enter.tick(actor)
      expect(enter.tickInnerCalled).toBe(true)
    })

    it('calls tryStartEnter when transitioning to Entering', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const enter = new TestEnter(actor, target)

      enter.tick(actor)
      expect(enter.tryStartEnterCalled).toBe(true)
    })

    it('waits in Approaching if tryStartEnter returns false', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const enter = new TestEnter(actor, target)
      enter.tryStartEnterResult = false

      const result = enter.tick(actor)
      expect(result).toBe(false)
      // Should still be in Approaching (didn't transition)
      expect(enter.getTestLastState()).toBe(EnterState.Approaching)
    })

    it('completes immediately when canceling in Approaching state', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const enter = new TestEnter(actor, target)

      // Manually set state to Active (normally done by tickOuter calling onFirstRun)
      ;(enter as unknown as { state: number }).state = 1 // Active = 1

      // Now cancel (state is Active, so cancel sets Canceling)
      enter.cancel(actor, true)
      expect(enter.state).toBe(2) // Canceling = 2

      // Next tick should complete immediately
      const result = enter.tick(actor)
      expect(result).toBe(true)
    })

    it('returns true when target is invalid and no lastVisibleTarget', () => {
      const actor = createMockActor() as never
      // Invalid target
      const target = Target.Invalid
      const enter = new TestEnter(actor, target)

      const result = enter.tick(actor)
      expect(result).toBe(true)
    })
  })

  describe('target tracking', () => {
    it('updates lastVisibleTarget when target is visible actor', () => {
      const actor = createMockActor() as never
      const targetPos = new WPos(1000, 0, 0)
      const targetActor = createMockTargetActor(targetPos)
      const target = Target.fromActor(targetActor as never)
      const enter = new TestEnter(actor, target)

      enter.tick(actor)
      expect(enter.getTestLastVisibleTarget().type).not.toBe(TargetType.Invalid)
    })

    it('sets useLastVisibleTarget when target becomes hidden', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      // Make actor invalid (dead)
      ;(targetActor as { isDead: boolean }).isDead = true
      const target = Target.fromActor(targetActor as never)
      const enter = new TestEnter(actor, target)

      enter.tick(actor)
      expect(enter.getTestUseLastVisibleTarget()).toBe(true)
    })
  })

  describe('targetLineNodes', () => {
    it('returns empty array when no targetLineColor', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const enter = new TestEnter(actor, target)
      expect(enter.targetLineNodes(actor)).toEqual([])
    })

    it('returns target line node when targetLineColor is set', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const color = { r: 255, g: 0, b: 0, a: 255 }
      const enter = new TestEnter(actor, target, color)

      const nodes = enter.targetLineNodes(actor)
      expect(nodes.length).toBe(1)
      expect(nodes[0]!.color).toBe(color)
    })
  })

  describe('EnterBehaviour', () => {
    it('has correct enum values', () => {
      expect(EnterBehaviour.Exit).toBe(0)
      expect(EnterBehaviour.Suicide).toBe(1)
      expect(EnterBehaviour.Dispose).toBe(2)
    })
  })

  describe('EnterState', () => {
    it('has correct enum values', () => {
      expect(EnterState.Approaching).toBe(0)
      expect(EnterState.Entering).toBe(1)
      expect(EnterState.Exiting).toBe(2)
      expect(EnterState.Finished).toBe(3)
    })
  })
})
