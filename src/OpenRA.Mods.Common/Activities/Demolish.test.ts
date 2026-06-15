/**
 * Demolish.test.ts — Demolish activity unit tests
 *
 * Tests focus on: tryStartEnter validation, onEnterComplete deferred action,
 * EnterBehaviour handling, cancellation.
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

import { Demolish as DemolishClass } from './Demolish.js'
import { Enter, EnterBehaviour } from './Enter.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockActor(options: {
  actorId?: number
  centerPosition?: WPos
  hasMobile?: boolean
} = {}): unknown {
  const traits = new Map<string, unknown>()

  if (options.hasMobile !== false) {
    traits.set('Mobile', {
      isTraitDisabled: false,
      isTraitPaused: false,
      moveResult: 0,
      moveToTarget: vi.fn(() => ({ tick: () => true })),
      moveIntoTarget: vi.fn(() => ({ tick: () => true })),
      returnToCell: vi.fn(() => ({ tick: () => true })),
      canEnterTargetNow: vi.fn(() => true),
    })
  }

  return {
    actorId: options.actorId ?? 1,
    centerPosition: options.centerPosition ?? WPos.Zero,
    traits,
    world: {
      sharedRandom: { next: vi.fn(() => 0.5) },
      frameEndActions: [] as Array<() => void>,
    },
    owner: { playerName: 'test' },
    dispose: vi.fn(),
    kill: vi.fn(),
  }
}

function createMockTargetActor(options: {
  validForDemolish?: boolean
} = {}): unknown {
  const demolishSpy = vi.fn()
  const validSpy = vi.fn(() => options.validForDemolish ?? true)

  const demolishableTrait = {
    isValidTarget: validSpy,
    demolish: demolishSpy,
  }

  return {
    actorId: 2,
    centerPosition: new WPos(1000, 0, 0),
    isInWorld: true,
    isDead: false,
    generation: 1,
    isTargetableBy: vi.fn(() => true),
    getTargetablePositions: vi.fn(() => [new WPos(1000, 0, 0)]),
    owner: { playerName: 'enemy' },
    traits: new Map<string, unknown>([
      ['demolishable', demolishableTrait],
      ['', [demolishableTrait]], // OpenRA's TraitDictionary.get('') returns all traits
    ]),
    _demolishSpy: demolishSpy,
    _validSpy: validSpy,
  }
}

// Helper type for accessing protected methods
type DemolishProtected = {
  tryStartEnter(self: unknown, target: unknown): boolean
  onEnterComplete(self: unknown, target: unknown): void
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Demolish', () => {
  describe('constructor', () => {
    it('stores configuration parameters', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)
      const damageTypes = new Set<string>(['Demolish'])

      const d = new DemolishClass(
        actor,
        target,
        EnterBehaviour.Dispose,
        50,
        3,
        10,
        5,
        damageTypes,
        { r: 255, g: 255, b: 255, a: 255 },
      )

      expect(d.delay).toBe(50)
      expect(d.flashes).toBe(3)
      expect(d.flashesDelay).toBe(10)
      expect(d.flashInterval).toBe(5)
      expect(d.enterBehaviour).toBe(EnterBehaviour.Dispose)
      expect(d.damageTypes).toBe(damageTypes)
    })
  })

  describe('tryStartEnter', () => {
    it('returns true when target has valid demolishable traits', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor({ validForDemolish: true })
      const target = Target.fromActor(targetActor as never)

      const d = new DemolishClass(
        actor,
        target,
        EnterBehaviour.Dispose,
        50, 3, 10, 5,
        new Set<string>(),
      )

      const dProtected = d as unknown as DemolishProtected
      const result = dProtected.tryStartEnter(actor, targetActor as never)
      expect(result).toBe(true)
    })

    it('returns false and cancels when target is not demolishable', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor({ validForDemolish: false })
      const target = Target.fromActor(targetActor as never)

      const d = new DemolishClass(
        actor,
        target,
        EnterBehaviour.Dispose,
        50, 3, 10, 5,
        new Set<string>(),
      )

      const dProtected = d as unknown as DemolishProtected
      const result = dProtected.tryStartEnter(actor, targetActor as never)
      expect(result).toBe(false)
      // When activity is Queued, cancel sets state to Done (not Canceling)
      expect(d.state === 3 /* Done */).toBe(true)
    })
  })

  describe('onEnterComplete', () => {
    it('queues frame-end action for demolition', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor() as { _demolishSpy: ReturnType<typeof vi.fn> }
      const target = Target.fromActor(targetActor as never)

      const d = new DemolishClass(
        actor,
        target,
        EnterBehaviour.Exit,
        50, 3, 10, 5,
        new Set<string>(['Demolish']),
      )

      const dProtected = d as unknown as DemolishProtected

      // First set up via tryStartEnter
      dProtected.tryStartEnter(actor, targetActor as never)

      // Then call onEnterComplete
      dProtected.onEnterComplete(actor, targetActor as never)

      // Verify frame-end action was queued
      const world = (actor as { world: { frameEndActions: Array<() => void> } }).world
      expect(world.frameEndActions.length).toBe(1)

      // Execute the frame-end action
      world.frameEndActions[0]!()

      // Verify demolish was called
      expect(targetActor._demolishSpy).toHaveBeenCalled()
    })

    it('disposes self when EnterBehaviour is Dispose', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)

      const d = new DemolishClass(
        actor,
        target,
        EnterBehaviour.Dispose,
        50, 3, 10, 5,
        new Set<string>(),
      )

      const dProtected = d as unknown as DemolishProtected
      dProtected.tryStartEnter(actor, targetActor as never)
      dProtected.onEnterComplete(actor, targetActor as never)

      const world = (actor as { world: { frameEndActions: Array<() => void> } }).world
      world.frameEndActions[0]!()

      expect((actor as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled()
    })

    it('kills self when EnterBehaviour is Suicide', () => {
      const actor = createMockActor() as never
      const targetActor = createMockTargetActor()
      const target = Target.fromActor(targetActor as never)

      const d = new DemolishClass(
        actor,
        target,
        EnterBehaviour.Suicide,
        50, 3, 10, 5,
        new Set<string>(),
      )

      const dProtected = d as unknown as DemolishProtected
      dProtected.tryStartEnter(actor, targetActor as never)
      dProtected.onEnterComplete(actor, targetActor as never)

      const world = (actor as { world: { frameEndActions: Array<() => void> } }).world
      world.frameEndActions[0]!()

      expect((actor as { kill: ReturnType<typeof vi.fn> }).kill).toHaveBeenCalledWith(actor)
    })
  })

  describe('inheritance', () => {
    it('extends Enter', () => {
      const actor = createMockActor() as never
      const target = Target.fromActor(createMockTargetActor() as never)
      const d = new DemolishClass(
        actor,
        target,
        EnterBehaviour.Exit,
        50, 3, 10, 5,
        new Set<string>(),
      )
      expect(d).toBeInstanceOf(Enter)
    })
  })
})
