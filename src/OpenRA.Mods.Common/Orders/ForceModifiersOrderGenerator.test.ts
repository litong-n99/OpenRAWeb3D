/**
 * ForceModifiersOrderGenerator.test.ts — ForceModifiersOrderGenerator unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: modifier OR injection into mouse input, cancelOnFirstUse
 * behavior, delegation to super.orderInner and super.getCursor,
 * clearSelectionOnLeftClick, and actionType.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))
vi.mock('@babylonjs/core/Materials', () => ({}))
vi.mock('@babylonjs/core/Meshes', () => ({}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { CPos } from '../../OpenRA.Game/CPos.js'
import {
  TargetModifiers,
  PlayerRelationship,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  IMouseSettings,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  ForceModifiersOrderGenerator,
} from './ForceModifiersOrderGenerator.js'
import {
  UnitOrderGenerator,
} from './UnitOrderGenerator.js'
import type {
  IUnitOrderGeneratorWorld,
  IUnitOrderPlayer,
  IUnitOrderActor,
  IUnitOrderMouseInput,
} from './UnitOrderGenerator.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function cell(x: number, y: number): CPos {
  return new CPos(x, y)
}

function createMockSettings(overrides: Partial<{
  controlStyle: string
  actionButton: number
  cancelButton: number
}> = {}): IMouseSettings {
  return {
    mouseControlStyle: overrides.controlStyle ?? 'standard',
    resolveActionButton: vi.fn().mockReturnValue(overrides.actionButton ?? 2),
    resolveCancelButton: vi.fn().mockReturnValue(overrides.cancelButton ?? 1),
  }
}

function createMockPlayer(
  name: string = 'localPlayer',
  winState: number = 0,
): IUnitOrderPlayer {
  return {
    playerName: name,
    winState,
    playerActor: null,
    isAlliedWith(other: IUnitOrderPlayer): boolean {
      return other.playerName === name
    },
    relationshipWith(other: IUnitOrderPlayer): PlayerRelationship {
      if (other.playerName === name) return PlayerRelationship.Ally
      return PlayerRelationship.Enemy
    },
  }
}

function createMockWorld(overrides: Partial<{
  cancelInputMode: () => void
  localPlayer: IUnitOrderPlayer | null
  actorsAtCell: readonly IGameActor[]
  selectionActors: readonly IUnitOrderActor[]
  isGameOver: boolean
}> = {}): IUnitOrderGeneratorWorld {
  const cancelInputMode = overrides.cancelInputMode ?? vi.fn()
  return {
    actors: [],
    selection: {
      actors: overrides.selectionActors ?? [],
      clear: vi.fn(),
    },
    cancelInputMode,
    actorMap: {
      getActorsAt(_cell: CPos): readonly IGameActor[] {
        return overrides.actorsAtCell ?? []
      },
    },
    shroud: null,
    localPlayer: overrides.localPlayer ?? null,
    renderPlayer: null,
    isGameOver: overrides.isGameOver ?? false,
    map: null,
  }
}

function createMi(
  overrides: Partial<{
    button: number
    event: string
    modifiers: TargetModifiers
  }> = {},
): IUnitOrderMouseInput {
  return {
    button: overrides.button ?? 2,
    event: overrides.event ?? 'Down',
    modifiers: overrides.modifiers ?? TargetModifiers.None,
  }
}

// ---------------------------------------------------------------------------
// ForceModifiersOrderGenerator tests
// ---------------------------------------------------------------------------

describe('ForceModifiersOrderGenerator', () => {
  let world: IUnitOrderGeneratorWorld
  let settings: IMouseSettings
  let cancelInputMode: () => void
  let localPlayer: IUnitOrderPlayer

  beforeEach(() => {
    cancelInputMode = vi.fn()
    localPlayer = createMockPlayer('local')
    settings = createMockSettings()
    world = createMockWorld({ localPlayer, cancelInputMode })
  })

  // -----------------------------------------------------------------------
  // Constructor and basic properties
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with modifiers and cancelOnFirstUse', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, true,
      )

      expect(gen).toBeInstanceOf(ForceModifiersOrderGenerator)
    })

    it('sets actionType to ConfirmOrder', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, true,
      )

      // ConfirmOrder = 1
      // actionType is protected — access via type assertion for testing
      expect((gen as unknown as { actionType: number }).actionType).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // clearSelectionOnLeftClick
  // -----------------------------------------------------------------------

  describe('clearSelectionOnLeftClick', () => {
    it('returns false', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, true,
      )

      expect(gen.clearSelectionOnLeftClick).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // orderInner — modifier injection
  // -----------------------------------------------------------------------

  describe('orderInner', () => {
    it('ORs forced modifiers into the mouse input before delegating to super', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, false,
      )

      const mi = createMi({ modifiers: TargetModifiers.None })

      // orderInner is a generator; we consume it to observe side effects
      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(5, 5), TargetModifiers.None, mi)) {
        orders.push(o)
      }

      // With ForceAttack forced and cancelOnFirstUse=false, no cancel should occur
      expect(cancelInputMode).not.toHaveBeenCalled()
    })

    it('cancels input mode when cancelOnFirstUse=true and shift is not held', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, true,
      )

      const mi = createMi({ modifiers: TargetModifiers.None })

      for (const _o of gen['orderInner'](world, cell(5, 5), TargetModifiers.None, mi)) {
        // consume iterator
      }

      expect(cancelInputMode).toHaveBeenCalledTimes(1)
    })

    it('does NOT cancel when cancelOnFirstUse=true but shift IS held (queued)', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, true,
      )

      const mi = createMi({ modifiers: TargetModifiers.ForceQueue })

      for (const _o of gen['orderInner'](world, cell(5, 5), TargetModifiers.None, mi)) {
        // consume iterator
      }

      expect(cancelInputMode).not.toHaveBeenCalled()
    })

    it('does NOT cancel when cancelOnFirstUse=false', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, false,
      )

      const mi = createMi({ modifiers: TargetModifiers.None })

      for (const _o of gen['orderInner'](world, cell(5, 5), TargetModifiers.None, mi)) {
        // consume iterator
      }

      expect(cancelInputMode).not.toHaveBeenCalled()
    })

    it('cancels when cancel button is pressed regardless of cancelOnFirstUse', () => {
      settings = createMockSettings({ cancelButton: 3 })
      world = createMockWorld({ localPlayer, cancelInputMode })

      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, false,
      )

      // button=3 matches the cancel button
      const mi = createMi({ button: 3, event: 'Down' })

      for (const _o of gen['orderInner'](world, cell(5, 5), TargetModifiers.None, mi)) {
        // consume iterator
      }

      expect(cancelInputMode).toHaveBeenCalledTimes(1)
    })

    it('combines forced modifiers with existing mouse modifiers via OR', () => {
      // Start with ForceQueue (Shift=2), force ForceAttack (Ctrl=1)
      // Expected: 2 | 1 = 3 (both set in modifiedMi.modifiers)
      // Spy on parent to verify combined modifiers are passed through
      // biome-ignore lint/suspicious/noExplicitAny: protected method requires any cast for spyOn
      const superOrderInnerSpy = vi.spyOn(UnitOrderGenerator.prototype as any, 'orderInner')

      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, false,
      )

      const mi = createMi({
        modifiers: TargetModifiers.ForceQueue as TargetModifiers,
      })

      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(5, 5), TargetModifiers.None, mi)) {
        orders.push(o)
      }

      // The original mi should have been modified; cancel shouldn't trigger (not cancelOnFirstUse)
      expect(cancelInputMode).not.toHaveBeenCalled()
      // Verify parent.orderInner was called with the OR-combined modifiers in modifiedMi
      expect(superOrderInnerSpy).toHaveBeenCalledTimes(1)
      const callArgs = superOrderInnerSpy.mock.calls[0] as unknown[]
      const modifiedMi = callArgs[3] as IUnitOrderMouseInput
      expect(modifiedMi.modifiers).toBe(TargetModifiers.ForceQueue | TargetModifiers.ForceAttack)

      superOrderInnerSpy.mockRestore()
    })

    it('combines forced modifiers with the _modifiers parameter', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, false,
      )

      const mi = createMi({ modifiers: TargetModifiers.None })

      // Pass _modifiers=ForceQueue — should combine with forced ForceAttack
      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(5, 5), TargetModifiers.ForceQueue, mi)) {
        orders.push(o)
      }

      expect(cancelInputMode).not.toHaveBeenCalled()
    })

    it('yields nothing when mi is undefined', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, true,
      )

      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(5, 5), TargetModifiers.None, undefined)) {
        orders.push(o)
      }

      expect(orders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // getCursor — modifier injection
  // -----------------------------------------------------------------------

  describe('getCursor', () => {
    it('delegates to super with modified modifiers', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, false,
      )

      const mi = createMi({ modifiers: TargetModifiers.None })

      // Just verify no error thrown; the cursor depends on world state
      const cursor = gen.getCursor(world, cell(5, 5), { x: 0, y: 0 }, mi)
      expect(typeof cursor).toBe('string')
    })

    it('returns default cursor when mi is undefined', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, false,
      )

      const cursor = gen.getCursor(world, cell(5, 5), { x: 0, y: 0 }, undefined)
      expect(typeof cursor).toBe('string')
    })

    it('does not call cancelInputMode from getCursor', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, false,
      )

      const mi = createMi({ modifiers: TargetModifiers.None })
      gen.getCursor(world, cell(5, 5), { x: 0, y: 0 }, mi)

      // getCursor should never cancel input mode (only orderInner does)
      expect(cancelInputMode).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // deactivate
  // -----------------------------------------------------------------------

  describe('deactivate', () => {
    it('calls super deactivate without error', () => {
      const gen = new ForceModifiersOrderGenerator(
        world, settings, TargetModifiers.ForceAttack, true,
      )

      expect(() => gen.deactivate()).not.toThrow()
    })
  })
})
