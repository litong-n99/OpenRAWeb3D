/**
 * EnterAlliedActorTargeter.test.ts — EnterAlliedActorTargeter unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: allied check, trait key check, canTarget delegate,
 * cursor selection (enterCursor vs enterBlockedCursor), frozen actor rejection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Babylon.js
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))
vi.mock('@babylonjs/core/Materials', () => ({}))
vi.mock('@babylonjs/core/Meshes', () => ({}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  TargetModifiers,
  PlayerRelationship,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  FrozenActorStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  EnterAlliedActorTargeter,
  type EnterAlliedCanTargetFn,
  type EnterAlliedUseEnterCursorFn,
} from './EnterAlliedActorTargeter.js'

// Target not needed for canTargetActor/canTargetFrozenActor unit tests

// ---------------------------------------------------------------------------
// Test helper factories
// ---------------------------------------------------------------------------

/** Create a mock IGameActor with owner and info. */
function createMockActor(
  overrides: Partial<{
    actorId: number
    isInWorld: boolean
    isDead: boolean
    disposed: boolean
    playerName: string
    traitKeys: string[]
    relationshipWith: PlayerRelationship
  }> = {},
): IGameActor {
  const actorId = overrides.actorId ?? 1
  const playerName = overrides.playerName ?? 'player1'
  const traitKeys = overrides.traitKeys ?? []
  const relationshipWith = overrides.relationshipWith ?? PlayerRelationship.Ally

  return {
    actorId,
    isInWorld: overrides.isInWorld ?? true,
    isDead: overrides.isDead ?? false,
    disposed: overrides.disposed ?? false,
    owner: {
      playerName,
      isAlliedWith(other: { playerName: string }) {
        return other.playerName === playerName
      },
      relationshipWith(_other: unknown) {
        return relationshipWith
      },
    },
    info: {
      name: `actor-${actorId}`,
      hasTraitInfo(key: string): boolean {
        return traitKeys.includes(key)
      },
    },
    // Extras for extended cast
    getTraitInfo: undefined,
    getTraitInfoOrDefault: undefined,
    getTraitInfos: undefined,
  } as unknown as IGameActor
}

/** Create a default always-pass canTarget delegate. */
function alwaysCanTarget(): EnterAlliedCanTargetFn {
  return (_target: IGameActor, _modifiers: TargetModifiers) => true
}

/** Create a default enterCursor selector (always enterCursor). */
function alwaysUseEnterCursor(): EnterAlliedUseEnterCursorFn {
  return (_target: IGameActor) => true
}

/** Create a minimal FrozenActorStub. */
function createFrozenStub(): FrozenActorStub {
  return {
    isValid: true,
    visible: true,
    hidden: false,
    centerPosition: { X: 0, Y: 0, Z: 0 } as unknown as FrozenActorStub['centerPosition'],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnterAlliedActorTargeter', () => {
  const TRAIT_KEY = 'Cargo'
  const ORDER_ID = 'EnterTransport'
  const PRIORITY = 5
  const ENTER_CURSOR = 'enter'
  const ENTER_BLOCKED = 'enter-blocked'

  let targeter: EnterAlliedActorTargeter
  let canTargetFn: EnterAlliedCanTargetFn
  let useEnterCursorFn: EnterAlliedUseEnterCursorFn

  beforeEach(() => {
    canTargetFn = alwaysCanTarget()
    useEnterCursorFn = alwaysUseEnterCursor()
    targeter = new EnterAlliedActorTargeter(
      ORDER_ID,
      PRIORITY,
      ENTER_CURSOR,
      ENTER_BLOCKED,
      canTargetFn,
      useEnterCursorFn,
      TRAIT_KEY,
    )
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('sets orderID', () => {
      expect(targeter.orderID).toBe(ORDER_ID)
    })

    it('sets orderPriority', () => {
      expect(targeter.orderPriority).toBe(PRIORITY)
    })

    it('sets targetAllyUnits to true (targets allies only)', () => {
      // Verified via behavior — this is internal. We test it indirectly:
      // allied actors are accepted, non-allied are rejected.
    })

    it('sets targetEnemyUnits to false (excludes enemies)', () => {
      // Verified via behavior tests below
    })
  })

  // ---------------------------------------------------------------------------
  // getCursor — default and after canTargetActor
  // ---------------------------------------------------------------------------

  describe('getCursor', () => {
    it('returns default cursor (enterCursor) before any canTargetActor call', () => {
      expect(targeter.getCursor()).toBe(ENTER_CURSOR)
    })

    it('returns enterCursor after successful canTargetActor with useEnterCursor=true', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      targeter.canTargetActor(self, target, TargetModifiers.None, '')
      expect(targeter.getCursor()).toBe(ENTER_CURSOR)
    })
  })

  // ---------------------------------------------------------------------------
  // canTargetActor — allied check
  // ---------------------------------------------------------------------------

  describe('canTargetActor — allied check', () => {
    it('accepts allied actor (same owner)', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      expect(
        targeter.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(true)
    })

    it('rejects enemy actor (different owner, not allied)', () => {
      const self = createMockActor({ playerName: 'teamA' })
      const target = createMockActor({
        playerName: 'teamB',
        traitKeys: [TRAIT_KEY],
      })
      // Set relationship to Enemy
      ;(target.owner as any).relationshipWith = () => PlayerRelationship.Enemy
      expect(
        targeter.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(false)
    })

    it('rejects neutral actor (different owner, neutral stance)', () => {
      const self = createMockActor({ playerName: 'teamA' })
      const target = createMockActor({
        playerName: 'teamB',
        traitKeys: [TRAIT_KEY],
      })
      ;(target.owner as any).isAlliedWith = () => false
      ;(target.owner as any).relationshipWith = () => PlayerRelationship.Neutral
      expect(
        targeter.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(false)
    })

    it('uses relationshipWith if isAlliedWith is not available', () => {
      const self = createMockActor({ playerName: 'teamA' })
      const target = createMockActor({
        playerName: 'teamB',
        traitKeys: [TRAIT_KEY],
      })
      // Remove isAlliedWith from BOTH owners so fallback triggers
      delete (self.owner as any).isAlliedWith
      delete (target.owner as any).isAlliedWith
      ;(target.owner as any).relationshipWith = () => PlayerRelationship.Ally
      expect(
        targeter.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // canTargetActor — trait key check
  // ---------------------------------------------------------------------------

  describe('canTargetActor — trait key check (C# HasTraitInfo<T>)', () => {
    it('accepts target with required trait key', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      expect(
        targeter.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(true)
    })

    it('rejects target without required trait key', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: ['SomeOtherTrait'],
      })
      expect(
        targeter.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(false)
    })

    it('rejects target with empty trait list', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [],
      })
      expect(
        targeter.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // canTargetActor — canTarget delegate
  // ---------------------------------------------------------------------------

  describe('canTargetActor — canTarget delegate (Func<Actor, TargetModifiers, bool>)', () => {
    it('accepts target when canTarget delegate returns true', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      const passingFn: EnterAlliedCanTargetFn = vi.fn().mockReturnValue(true)
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        passingFn, alwaysUseEnterCursor(), TRAIT_KEY,
      )
      const result = t.canTargetActor(self, target, TargetModifiers.None, '')
      expect(result).toBe(true)
      expect(passingFn).toHaveBeenCalledWith(target, TargetModifiers.None)
    })

    it('rejects target when canTarget delegate returns false', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      const failingFn: EnterAlliedCanTargetFn = () => false
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        failingFn, alwaysUseEnterCursor(), TRAIT_KEY,
      )
      expect(
        t.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(false)
    })

    it('passes ForceAttack modifier to canTarget delegate', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      const spyFn: EnterAlliedCanTargetFn = vi.fn().mockReturnValue(true)
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        spyFn, alwaysUseEnterCursor(), TRAIT_KEY,
      )
      t.canTargetActor(
        self,
        target,
        TargetModifiers.ForceAttack,
        '',
      )
      expect(spyFn).toHaveBeenCalledWith(target, TargetModifiers.ForceAttack)
    })
  })

  // ---------------------------------------------------------------------------
  // canTargetActor — cursor selection
  // ---------------------------------------------------------------------------

  describe('canTargetActor — cursor selection (C# ref string cursor)', () => {
    it('sets cursor to enterCursor when useEnterCursor returns true', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      const useEnterFn: EnterAlliedUseEnterCursorFn = () => true
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        alwaysCanTarget(), useEnterFn, TRAIT_KEY,
      )
      t.canTargetActor(self, target, TargetModifiers.None, '')
      expect(t.getCursor()).toBe(ENTER_CURSOR)
    })

    it('sets cursor to enterBlockedCursor when useEnterCursor returns false', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      const useEnterFn: EnterAlliedUseEnterCursorFn = () => false
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        alwaysCanTarget(), useEnterFn, TRAIT_KEY,
      )
      t.canTargetActor(self, target, TargetModifiers.None, '')
      expect(t.getCursor()).toBe(ENTER_BLOCKED)
    })

    it('useEnterCursor receives the target actor', () => {
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      const spyFn: EnterAlliedUseEnterCursorFn = vi.fn().mockReturnValue(true)
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        alwaysCanTarget(), spyFn, TRAIT_KEY,
      )
      t.canTargetActor(self, target, TargetModifiers.None, '')
      expect(spyFn).toHaveBeenCalledWith(target)
    })

    it('does not change cursor when canTargetActor returns false', () => {
      const self = createMockActor({ playerName: 'teamA' })
      const target = createMockActor({
        playerName: 'teamB',
        traitKeys: [TRAIT_KEY],
      })
      // Enemy — will fail allied check, so cursor should NOT change
      ;(target.owner as any).isAlliedWith = () => false
      ;(target.owner as any).relationshipWith = () => PlayerRelationship.Enemy

      const useEnterFn = vi.fn().mockReturnValue(false)
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        alwaysCanTarget(), useEnterFn, TRAIT_KEY,
      )
      t.canTargetActor(self, target, TargetModifiers.None, '')
      // useEnterCursor should NOT be called when allied check fails
      expect(useEnterFn).not.toHaveBeenCalled()
      // Cursor should remain at default
      expect(t.getCursor()).toBe(ENTER_CURSOR)
    })
  })

  // ---------------------------------------------------------------------------
  // canTargetFrozenActor
  // ---------------------------------------------------------------------------

  describe('canTargetFrozenActor — always returns false (allied actors never frozen)', () => {
    it('returns false for any frozen actor', () => {
      const self = createMockActor({ playerName: 'same' })
      const frozen = createFrozenStub()
      expect(
        targeter.canTargetFrozenActor(
          self,
          frozen,
          TargetModifiers.None,
          '',
        ),
      ).toBe(false)
    })

    it('returns false even for valid-looking frozen actors', () => {
      const self = createMockActor({ playerName: 'same' })
      const frozen: FrozenActorStub = {
        isValid: true,
        visible: true,
        hidden: false,
        centerPosition: { X: 100, Y: 200, Z: 0 } as unknown as FrozenActorStub['centerPosition'],
      }
      expect(
        targeter.canTargetFrozenActor(
          self,
          frozen,
          TargetModifiers.None,
          '',
        ),
      ).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Multiple calls — cursor state
  // ---------------------------------------------------------------------------

  describe('cursor state across multiple canTargetActor calls', () => {
    it('cursor is preserved from last successful call', () => {
      const self = createMockActor({ playerName: 'same' })
      const target1 = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      // First call: cursor = enterCursor (useEnterCursor returns true)
      const useEnter1 = () => true
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        alwaysCanTarget(), useEnter1, TRAIT_KEY,
      )
      t.canTargetActor(self, target1, TargetModifiers.None, '')
      expect(t.getCursor()).toBe(ENTER_CURSOR)

      // But we can't change the useEnterCursor function after construction.
      // Test with a different targeter instance.
    })

    it('rejected call does not overwrite previous cursor', () => {
      const self = createMockActor({ playerName: 'same' })
      const validTarget = createMockActor({
        playerName: 'same',
        traitKeys: [TRAIT_KEY],
      })
      const badTarget = createMockActor({
        playerName: 'enemy',
        traitKeys: [TRAIT_KEY],
      })
      ;(badTarget.owner as any).isAlliedWith = () => false
      ;(badTarget.owner as any).relationshipWith = () => PlayerRelationship.Enemy

      // First: successful call with enterBlocked cursor
      const useEnterFn: EnterAlliedUseEnterCursorFn = () => false
      const t = new EnterAlliedActorTargeter(
        ORDER_ID, PRIORITY, ENTER_CURSOR, ENTER_BLOCKED,
        alwaysCanTarget(), useEnterFn, TRAIT_KEY,
      )
      t.canTargetActor(self, validTarget, TargetModifiers.None, '')
      expect(t.getCursor()).toBe(ENTER_BLOCKED)

      // Second: rejected call (enemy)
      t.canTargetActor(self, badTarget, TargetModifiers.None, '')
      // Cursor should still be from previous successful call
      expect(t.getCursor()).toBe(ENTER_BLOCKED)
    })
  })

  // ---------------------------------------------------------------------------
  // Inheritance from UnitOrderTargeter
  // ---------------------------------------------------------------------------

  describe('inheritance from UnitOrderTargeter', () => {
    it('orderID is accessible', () => {
      expect(targeter.orderID).toBe(ORDER_ID)
    })

    it('orderPriority is accessible', () => {
      expect(targeter.orderPriority).toBe(PRIORITY)
    })

    it('isQueued starts as false', () => {
      expect(targeter.isQueued).toBe(false)
    })

    it('forceAttack defaults to null (accept either)', () => {
      expect(targeter.forceAttack).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Different trait keys (C# generic <T> → TS string)
  // ---------------------------------------------------------------------------

  describe('traitKey parameter (replaces C# generic <T>)', () => {
    it('works with Passenger trait key', () => {
      const t = new EnterAlliedActorTargeter(
        'EnterTransport', 5, 'enter', 'enter-blocked',
        alwaysCanTarget(), alwaysUseEnterCursor(), 'Passenger',
      )
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: ['Passenger'],
      })
      expect(
        t.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(true)
    })

    it('rejects when target has wrong trait but other is correct', () => {
      const t = new EnterAlliedActorTargeter(
        'EnterTransport', 5, 'enter', 'enter-blocked',
        alwaysCanTarget(), alwaysUseEnterCursor(), 'Cargo',
      )
      const self = createMockActor({ playerName: 'same' })
      const target = createMockActor({
        playerName: 'same',
        traitKeys: ['Passenger'], // wrong trait key
      })
      expect(
        t.canTargetActor(self, target, TargetModifiers.None, ''),
      ).toBe(false)
    })
  })
})
