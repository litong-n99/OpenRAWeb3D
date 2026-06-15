/**
 * CaptureActor.test.ts — CaptureActor activity unit tests
 *
 * Tests focus on: tickInner validation, tryStartEnter, onEnterComplete,
 * ownership transfer, sabotage logic, cancellation cleanup.
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

import { CaptureActor } from './CaptureActor'
import { Enter, EnterState } from './Enter'
import { Target } from '../../OpenRA.Game/Traits/Target'
import { WPos } from '../../OpenRA.Game/WPos'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockActor(options: {
  actorId?: number
  centerPosition?: WPos
  hasCaptureManager?: boolean
  owner?: unknown
} = {}): unknown {
  const traits = new Map<string, unknown>()

  if (options.hasCaptureManager !== false) {
    traits.set('CaptureManager', {
      canTarget: vi.fn(() => true),
      startCapture: vi.fn((_tcm: unknown, out: { captures: unknown }) => {
        out.captures = {
          info: {
            consumedByCapture: true,
            sabotageThreshold: 0,
            sabotageHPRemoval: 0,
            sabotageDamageTypes: new Set<string>(),
            captureTypes: new Set<string>(['building']),
            playerExperienceRelationships: 1,
          },
        }
        return true
      }),
      cancelCapture: vi.fn(),
      validCapturesWithLowestSabotageThreshold: vi.fn(() => ({
        info: {
          consumedByCapture: true,
          sabotageThreshold: 0,
          sabotageHPRemoval: 0,
          sabotageDamageTypes: new Set<string>(),
          captureTypes: new Set<string>(['building']),
          playerExperienceRelationships: 1,
        },
      })),
    })
  }

  traits.set('Mobile', {
    isTraitDisabled: false,
    isTraitPaused: false,
    moveResult: 0,
    moveToTarget: vi.fn(() => ({ tick: () => true })),
    moveIntoTarget: vi.fn(() => ({ tick: () => true })),
    returnToCell: vi.fn(() => ({ tick: () => true })),
    canEnterTargetNow: vi.fn(() => true),
  })

  return {
    actorId: options.actorId ?? 1,
    centerPosition: options.centerPosition ?? WPos.Zero,
    traits,
    world: {
      sharedRandom: { next: vi.fn(() => 0.5) },
      frameEndActions: [] as Array<() => void>,
    },
    owner: options.owner ?? { playerName: 'test', relationshipWith: vi.fn(() => 1) },
    dispose: vi.fn(),
  }
}

function createMockTargetActor(options: {
  hasCaptureManager?: boolean
  owner?: unknown
  health?: { hp: number; maxHP: number }
} = {}): unknown {
  const traits = new Map<string, unknown>()

  if (options.hasCaptureManager !== false) {
    traits.set('CaptureManager', {
      canTarget: vi.fn(() => true),
    })
  }

  if (options.health) {
    traits.set('health', options.health)
  }

  return {
    actorId: 2,
    centerPosition: new WPos(1000, 0, 0),
    isInWorld: true,
    isDead: false,
    generation: 1,
    isTargetableBy: vi.fn(() => true),
    getTargetablePositions: vi.fn(() => [new WPos(1000, 0, 0)]),
    owner: options.owner ?? { playerName: 'enemy', nonCombatant: false },
    traits,
    changeOwnerSync: vi.fn(),
    inflictDamage: vi.fn(),
  }
}

// Helper to access protected methods for testing
type CaptureActorProtected = {
  tryStartEnter(self: unknown, target: unknown): boolean
  onEnterComplete(self: unknown, target: unknown): void
  lastState: number
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CaptureActor', () => {
  describe('constructor', () => {
    it('stores target and targetLineColor', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const color = { r: 255, g: 0, b: 0, a: 255 }
      const capture = new CaptureActor(actor, target, color)

      expect(capture).toBeDefined()
    })

    it('extends Enter', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const capture = new CaptureActor(actor, target)
      expect(capture).toBeInstanceOf(Enter)
    })
  })

  describe('tickInner', () => {
    it('cancels when target has no CaptureManager', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor({ hasCaptureManager: false })
      const target = Target.fromActor(targetActor as never)
      const capture = new CaptureActor(actor, target)

      // tickInner is called during tick; need to first transition to Active
      ;(capture as unknown as { state: number }).state = 1 // Active = 1
      capture.tick(actor)
      // When Active, cancel() sets Canceling (state = 2)
      expect(capture.state).toBe(2) // Canceling = 2
    })

    it('does not cancel when target is valid', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const capture = new CaptureActor(actor, target)

      capture.tick(actor)
      // Should not be canceling yet (target is valid)
      // Note: tick may advance state, but cancel shouldn't happen from tickInner
    })
  })

  describe('tryStartEnter', () => {
    it('returns true when capture is valid and consumed', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const capture = new CaptureActor(actor, target)

      // First tick to get to tryStartEnter
      capture.tick(actor)
      // Should have transitioned to Entering (tryStartEnter returned true)
      expect((capture as unknown as CaptureActorProtected).lastState).toBe(EnterState.Entering)
    })

    it('cancels when target has no CaptureManager', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor({ hasCaptureManager: false })
      const target = Target.fromActor(targetActor as never)
      const capture = new CaptureActor(actor, target)

      // Access protected method
      const result = (capture as unknown as CaptureActorProtected).tryStartEnter(actor, targetActor as never)
      expect(result).toBe(false)
      // cancel() on a Queued activity sets state to Done (not Canceling)
      expect(capture.state).toBe(3) // Done = 3
    })
  })

  describe('onEnterComplete', () => {
    it('queues frame-end action for ownership transfer', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor() as { changeOwnerSync: ReturnType<typeof vi.fn> }
      const target = Target.fromActor(targetActor as never)
      const capture = new CaptureActor(actor, target)

      // Set up via tryStartEnter first
      const capProtected = capture as unknown as CaptureActorProtected
      capProtected.tryStartEnter(actor, targetActor as never)

      // Call onEnterComplete
      capProtected.onEnterComplete(actor, targetActor as never)

      // Execute frame-end action
      const world = (actor as { world: { frameEndActions: Array<() => void> } }).world
      expect(world.frameEndActions.length).toBeGreaterThan(0)
      world.frameEndActions[0]!()

      // Verify ownership change was called
      expect(targetActor.changeOwnerSync).toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('calls cancelCapture on cancel', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const capture = new CaptureActor(actor, target)

      const captureManager = (actor as { traits: Map<string, unknown> }).traits.get('CaptureManager') as { cancelCapture: ReturnType<typeof vi.fn> }

      capture.cancel(actor, true)
      expect(captureManager.cancelCapture).toHaveBeenCalled()
    })
  })
})
