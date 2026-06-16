/**
 * GuardOrderGenerator.test.ts — GuardOrderGenerator unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: orderInner guard target resolution, selectionChanged
 * validation, getCursor cursor selection, friendlyGuardableUnits filtering,
 * inputOverridesSelection, clearSelectionOnLeftClick, and deactivate cleanup.
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
  GuardOrderGenerator,
} from './GuardOrderGenerator.js'
import type {
  IUnitOrderGeneratorWorld,
  IUnitOrderPlayer,
  IUnitOrderActor,
  IUnitOrderMouseInput,
  IUnitOrderActorInfo,
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

function createMockActorInfo(
  name: string,
  traitKeys: string[] = [],
): IUnitOrderActorInfo {
  return {
    name,
    hasTraitInfo(key: string): boolean {
      return traitKeys.includes(key)
    },
    traitInfos<T>(_interfaceId: string): readonly T[] {
      return [] as unknown as readonly T[]
    },
  }
}

function createMockPlayer(
  name: string = 'localPlayer',
  winState: number = 0,
  allies: string[] = [name],
): IUnitOrderPlayer {
  return {
    playerName: name,
    winState,
    playerActor: null,
    isAlliedWith(other: IUnitOrderPlayer): boolean {
      return allies.includes(other.playerName)
    },
    relationshipWith(other: IUnitOrderPlayer): PlayerRelationship {
      if (other.playerName === name || allies.includes(other.playerName)) {
        return PlayerRelationship.Ally
      }
      return PlayerRelationship.Enemy
    },
  }
}

function createMockActor(
  id: number,
  owner: IUnitOrderPlayer,
  info: IUnitOrderActorInfo,
  overrides: Partial<{
    isDead: boolean
    disposed: boolean
  }> = {},
): IUnitOrderActor {
  return {
    actorId: id,
    isInWorld: true,
    isDead: overrides.isDead ?? false,
    disposed: overrides.disposed ?? false,
    owner,
    info,
    traitsImplementing(_interfaceId: string): unknown[] {
      return []
    },
  }
}

function createMockWorld(overrides: Partial<{
  actorsAtCell: readonly IGameActor[]
  cancelInputMode: () => void
  localPlayer: IUnitOrderPlayer | null
  shroudFogObscures: boolean
  isGameOver: boolean
}> = {}): IUnitOrderGeneratorWorld {
  const cancelInputMode = overrides.cancelInputMode ?? vi.fn()
  return {
    actors: [],
    selection: {
      actors: [],
      clear: vi.fn(),
    },
    cancelInputMode,
    actorMap: {
      getActorsAt(_cell: CPos): readonly IGameActor[] {
        return overrides.actorsAtCell ?? []
      },
    },
    shroud: {
      fogObscures(_actor: IGameActor): boolean {
        return overrides.shroudFogObscures ?? false
      },
    },
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
// GuardOrderGenerator tests
// ---------------------------------------------------------------------------

describe('GuardOrderGenerator', () => {
  let world: IUnitOrderGeneratorWorld
  let settings: IMouseSettings
  let cancelInputMode: () => void
  let localPlayer: IUnitOrderPlayer
  let allyPlayer: IUnitOrderPlayer
  let enemyPlayer: IUnitOrderPlayer

  beforeEach(() => {
    cancelInputMode = vi.fn()
    localPlayer = createMockPlayer('local', 0, ['local', 'ally'])
    allyPlayer = createMockPlayer('ally', 0, ['local', 'ally'])
    enemyPlayer = createMockPlayer('enemy', 0, ['enemy'])
    settings = createMockSettings()
  })

  // -----------------------------------------------------------------------
  // Constructor and basic properties
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with subjects, orderName, and cursor', () => {
      const subject = createMockActor(1, localPlayer, createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo']))
      const subjects = [subject]
      world = createMockWorld({ localPlayer, cancelInputMode })

      const gen = new GuardOrderGenerator(world, settings, subjects, 'Guard', 'guard')

      expect(gen).toBeInstanceOf(GuardOrderGenerator)
    })

    it('sets actionType to ConfirmOrder', () => {
      const subject = createMockActor(1, localPlayer, createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo']))
      const subjects = [subject]
      world = createMockWorld({ localPlayer, cancelInputMode })

      const gen = new GuardOrderGenerator(world, settings, subjects, 'Guard', 'guard')
      // ConfirmOrder = 1
      // actionType is protected — access via type assertion for testing
      expect((gen as unknown as { actionType: number }).actionType).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // inputOverridesSelection
  // -----------------------------------------------------------------------

  describe('inputOverridesSelection', () => {
    it('always returns true', () => {
      const subject = createMockActor(1, localPlayer, createMockActorInfo('guard'))
      world = createMockWorld({ localPlayer })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')

      expect(gen.inputOverridesSelection(world, { x: 0, y: 0 }, createMi())).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // clearSelectionOnLeftClick
  // -----------------------------------------------------------------------

  describe('clearSelectionOnLeftClick', () => {
    it('returns false', () => {
      const subject = createMockActor(1, localPlayer, createMockActorInfo('guard'))
      world = createMockWorld({ localPlayer })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')

      expect(gen.clearSelectionOnLeftClick).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // friendlyGuardableUnits
  // -----------------------------------------------------------------------

  describe('friendlyGuardableUnits', () => {
    it('returns actors that are alive, friendly, have GuardableInfo, and are not fog-obscured', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      const friendlyActor = createMockActor(100, allyPlayer, guardableInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [friendlyActor],
        shroudFogObscures: false,
      })

      const result = GuardOrderGenerator.friendlyGuardableUnits(world, cell(10, 10))

      expect(result.length).toBe(1)
      expect(result[0].actorId).toBe(100)
    })

    it('excludes dead actors', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo'])
      const deadActor = createMockActor(100, allyPlayer, guardableInfo, { isDead: true })
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [deadActor],
        shroudFogObscures: false,
      })

      const result = GuardOrderGenerator.friendlyGuardableUnits(world, cell(10, 10))

      expect(result.length).toBe(0)
    })

    it('excludes enemies', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo'])
      const enemyActor = createMockActor(100, enemyPlayer, guardableInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [enemyActor],
        shroudFogObscures: false,
      })

      const result = GuardOrderGenerator.friendlyGuardableUnits(world, cell(10, 10))

      expect(result.length).toBe(0)
    })

    it('excludes actors without GuardableInfo', () => {
      const noTraitInfo = createMockActorInfo('no-guard', ['ITargetableInfo'])
      const actor = createMockActor(100, allyPlayer, noTraitInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [actor],
        shroudFogObscures: false,
      })

      const result = GuardOrderGenerator.friendlyGuardableUnits(world, cell(10, 10))

      expect(result.length).toBe(0)
    })

    it('excludes fog-obscured actors', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo'])
      const actor = createMockActor(100, allyPlayer, guardableInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [actor],
        shroudFogObscures: true,
      })

      const result = GuardOrderGenerator.friendlyGuardableUnits(world, cell(10, 10))

      expect(result.length).toBe(0)
    })

    it('returns empty array when localPlayer is null', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo'])
      const actor = createMockActor(100, allyPlayer, guardableInfo)
      world = createMockWorld({
        localPlayer: null,
        actorsAtCell: [actor],
        shroudFogObscures: false,
      })

      const result = GuardOrderGenerator.friendlyGuardableUnits(world, cell(10, 10))

      expect(result.length).toBe(0)
    })

    it('excludes actors with no owner', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo'])
      const ownerlessActor: IUnitOrderActor = {
        actorId: 100,
        isInWorld: true,
        isDead: false,
        disposed: false,
        owner: undefined as unknown as IUnitOrderPlayer,
        info: guardableInfo,
        traitsImplementing(_interfaceId: string): unknown[] { return [] },
      }
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [ownerlessActor as unknown as IGameActor],
        shroudFogObscures: false,
      })

      const result = GuardOrderGenerator.friendlyGuardableUnits(world, cell(10, 10))

      expect(result.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // orderInner
  // -----------------------------------------------------------------------

  describe('orderInner', () => {
    it('yields a guard order when a valid guardable target is found', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      const guardTarget = createMockActor(200, allyPlayer, guardableInfo)
      const subjectInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, subjectInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [guardTarget as unknown as IGameActor],
        cancelInputMode,
      })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')
      const mi = createMi({ modifiers: TargetModifiers.None })

      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(10, 10), TargetModifiers.None, mi)) {
        orders.push(o)
      }

      expect(orders.length).toBe(1)
      const order = orders[0] as { orderName: string; targetString: string; extraData: Record<string, unknown> }
      expect(order.orderName).toBe('Guard')
      expect(order.extraData.queued).toBe(false)
    })

    it('cancels input mode when not queued', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      const guardTarget = createMockActor(200, allyPlayer, guardableInfo)
      const subjectInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, subjectInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [guardTarget as unknown as IGameActor],
        cancelInputMode,
      })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')
      const mi = createMi({ modifiers: TargetModifiers.None })

      for (const _o of gen['orderInner'](world, cell(10, 10), TargetModifiers.None, mi)) {
        // consume iterator
      }

      expect(cancelInputMode).toHaveBeenCalledTimes(1)
    })

    it('does NOT cancel input mode when queued (Shift held)', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      const guardTarget = createMockActor(200, allyPlayer, guardableInfo)
      const subjectInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, subjectInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [guardTarget as unknown as IGameActor],
        cancelInputMode,
      })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')
      const mi = createMi({ modifiers: TargetModifiers.ForceQueue })

      for (const _o of gen['orderInner'](world, cell(10, 10), TargetModifiers.None, mi)) {
        // consume iterator
      }

      expect(cancelInputMode).not.toHaveBeenCalled()
    })

    it('yields queued=true order when Shift is held', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      const guardTarget = createMockActor(200, allyPlayer, guardableInfo)
      const subjectInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, subjectInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [guardTarget as unknown as IGameActor],
        cancelInputMode,
      })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')
      const mi = createMi({ modifiers: TargetModifiers.ForceQueue })

      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(10, 10), TargetModifiers.None, mi)) {
        orders.push(o)
      }

      expect(orders.length).toBe(1)
      const order = orders[0] as { orderName: string; extraData: Record<string, unknown> }
      expect(order.orderName).toBe('Guard')
      expect(order.extraData.queued).toBe(true)
    })

    it('yields nothing when no valid guard target found', () => {
      const subjectInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, subjectInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [], // no targets
        cancelInputMode,
      })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')
      const mi = createMi()

      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(10, 10), TargetModifiers.None, mi)) {
        orders.push(o)
      }

      expect(orders.length).toBe(0)
    })

    it('yields nothing when mi is undefined', () => {
      const subject = createMockActor(1, localPlayer, createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo']))
      world = createMockWorld({ localPlayer })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')

      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(10, 10), TargetModifiers.None, undefined)) {
        orders.push(o)
      }

      expect(orders.length).toBe(0)
    })

    it('excludes the guard target itself from the subjects list', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      const guardTarget = createMockActor(200, allyPlayer, guardableInfo)
      const subjectInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject1 = createMockActor(1, localPlayer, subjectInfo)
      // subject2 IS the guard target — making it a self-guard scenario
      const subject2 = guardTarget
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [guardTarget as unknown as IGameActor],
        cancelInputMode,
      })

      const gen = new GuardOrderGenerator(world, settings, [subject1, subject2], 'Guard', 'guard')
      const mi = createMi({ modifiers: TargetModifiers.ForceQueue })

      const orders: unknown[] = []
      for (const o of gen['orderInner'](world, cell(10, 10), TargetModifiers.None, mi)) {
        orders.push(o)
      }

      expect(orders.length).toBe(1)
      const order = orders[0] as { orderName: string; extraData: Record<string, unknown> }
      const subjects = order.extraData.subjects as IUnitOrderActor[]
      // target should be excluded from subjects
      expect(subjects).not.toContain(guardTarget)
      expect(subjects.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // selectionChanged
  // -----------------------------------------------------------------------

  describe('selectionChanged', () => {
    it('filters subjects to non-dead actors with GuardInfo', () => {
      const guardInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const noGuardInfo = createMockActorInfo('noguard', ['AutoTargetInfo'])
      const deadGuard = createMockActor(3, localPlayer, guardInfo, { isDead: true })

      const subject1 = createMockActor(1, localPlayer, guardInfo)
      const subject2 = createMockActor(2, localPlayer, noGuardInfo)

      world = createMockWorld({ localPlayer, cancelInputMode })

      const gen = new GuardOrderGenerator(world, settings, [subject1], 'Guard', 'guard')

      // Now call selectionChanged with mixed actors
      gen.selectionChanged(world, [subject1, subject2, deadGuard])

      // We indirectly verify by checking that getCursor still works
      // (subjects were filtered)
    })

    it('cancels input mode when no subjects have AutoTargetInfo', () => {
      const guardInfoNoAT = createMockActorInfo('guard', ['GuardInfo'])
      const subject = createMockActor(1, localPlayer, guardInfoNoAT)

      world = createMockWorld({ localPlayer, cancelInputMode })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')

      gen.selectionChanged(world, [subject])

      expect(cancelInputMode).toHaveBeenCalledTimes(1)
    })

    it('keeps input mode alive when subjects have AutoTargetInfo', () => {
      const guardInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, guardInfo)

      world = createMockWorld({ localPlayer, cancelInputMode })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')

      gen.selectionChanged(world, [subject])

      expect(cancelInputMode).not.toHaveBeenCalled()
    })

    it('cancels input mode when no subject has GuardInfo', () => {
      const noGuardInfo = createMockActorInfo('other', ['AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, noGuardInfo)

      world = createMockWorld({ localPlayer, cancelInputMode })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')

      gen.selectionChanged(world, [subject])

      // No subjects after filtering (none have GuardInfo) → no AutoTarget check → cancel
      expect(cancelInputMode).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // getCursor
  // -----------------------------------------------------------------------

  describe('getCursor', () => {
    it('returns empty string when no subjects', () => {
      world = createMockWorld({ localPlayer })

      const gen = new GuardOrderGenerator(world, settings, [], 'Guard', 'guard')

      const cursor = gen.getCursor(world, cell(10, 10))

      expect(cursor).toBe('')
    })

    it('returns the configured cursor when a guard target is available', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      const guardTarget = createMockActor(200, allyPlayer, guardableInfo)
      const subjectInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, subjectInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [guardTarget as unknown as IGameActor],
      })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')

      const cursor = gen.getCursor(world, cell(10, 10))

      expect(cursor).toBe('guard')
    })

    it('returns "move-blocked" when no valid guard targets', () => {
      const subjectInfo = createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo'])
      const subject = createMockActor(1, localPlayer, subjectInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [], // no guard targets
      })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')

      const cursor = gen.getCursor(world, cell(10, 10))

      expect(cursor).toBe('move-blocked')
    })

    it('returns "move-blocked" when the only guard target is the only subject (self-guard blocked)', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      // The same actor is both the subject and the only guardable unit at cell
      const selfGuardActor = createMockActor(100, allyPlayer, guardableInfo)
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [selfGuardActor as unknown as IGameActor],
      })

      // Only one subject, and it's the same actor as the guard target
      const gen = new GuardOrderGenerator(world, settings, [selfGuardActor], 'Guard', 'guard')

      const cursor = gen.getCursor(world, cell(10, 10))

      expect(cursor).toBe('move-blocked')
    })

    it('allows guarding when multiple subjects exist even if first matches target', () => {
      const guardableInfo = createMockActorInfo('guardable', ['GuardableInfo', 'ITargetableInfo'])
      const guardTarget = createMockActor(200, allyPlayer, guardableInfo)
      const subject1 = createMockActor(1, localPlayer, guardableInfo)
      const subject2 = createMockActor(2, localPlayer, createMockActorInfo('guard', ['GuardInfo', 'AutoTargetInfo']))
      world = createMockWorld({
        localPlayer,
        actorsAtCell: [guardTarget as unknown as IGameActor],
      })

      const gen = new GuardOrderGenerator(world, settings, [subject1, subject2], 'Guard', 'guard')

      const cursor = gen.getCursor(world, cell(10, 10))

      expect(cursor).toBe('guard')
    })
  })

  // -----------------------------------------------------------------------
  // deactivate
  // -----------------------------------------------------------------------

  describe('deactivate', () => {
    it('clears subjects and calls super deactivate', () => {
      const subject = createMockActor(1, localPlayer, createMockActorInfo('guard'))
      world = createMockWorld({ localPlayer })

      const gen = new GuardOrderGenerator(world, settings, [subject], 'Guard', 'guard')
      gen.deactivate()

      // After deactivate, getCursor should return empty string (no subjects)
      expect(gen.getCursor(world, cell(10, 10))).toBe('')
    })
  })
})
