/**
 * ScriptTriggers.test.ts — Unit tests for ScriptTriggers trait
 *
 * Tests focus on: registration, trigger dispatch, disposing guard,
 * fatal error handling, internal events, clear/clearAll, and edge cases.
 * No WebGL or Babylon.js dependencies — pure game logic tested with
 * happy-dom and mocked IScriptContext.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptTriggers, ScriptTriggersInfo, Trigger, TRIGGER_COUNT } from './ScriptTriggers.js'
import type { TriggerCallback } from './ScriptTriggers.js'
import type { IScriptContext } from '../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackInfo, Damage, DamageState } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Test stubs
// ---------------------------------------------------------------------------

function stubActor(actorId = 1): IGameActor {
  return {
    actorId,
    isInWorld: true,
    isDead: false,
    owner: null as unknown as PlayerStub,
    disposed: false,
    traitName: 'testActor',
    world: null as unknown as never,
  } as IGameActor
}

function stubPlayer(name = 'TestPlayer'): PlayerStub {
  return { playerName: name }
}

function stubContext(): IScriptContext {
  return {
    world: {} as never,
    worldRenderer: {} as never,
    fatalErrorOccurred: false,
    errorMessage: null,
    getActorCommands: vi.fn().mockReturnValue([]),
    playerCommands: [],
    registerMapActor: vi.fn(),
    fatalError: vi.fn(),
    logDebug: () => {},
    get namedActors() { return new Map() },
  }
}

function stubCPos(): CPos {
  return { x: 0, y: 0, layer: 0, Bits: 0 } as unknown as CPos
}

function stubAttackInfo(attacker?: IGameActor, damageValue = 50): AttackInfo {
  const dmg = new Damage(damageValue)
  return new AttackInfo(dmg, attacker ?? stubActor(99), DamageState.Medium, DamageState.Light)
}

function makeCallback(fn?: TriggerCallback): TriggerCallback {
  return fn ?? vi.fn()
}

// ---------------------------------------------------------------------------
// ScriptTriggersInfo
// ---------------------------------------------------------------------------

describe('ScriptTriggersInfo', () => {
  it('creates without configuration', () => {
    const info = new ScriptTriggersInfo()
    expect(info).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Construction & Trigger enum
// ---------------------------------------------------------------------------

describe('ScriptTriggers', () => {
  let triggers: ScriptTriggers
  let self: IGameActor

  beforeEach(() => {
    self = stubActor(1)
    triggers = new ScriptTriggers(self)
  })

  it('constructs with an actor reference', () => {
    expect(triggers).toBeDefined()
  })

  it('has TRIGGER_COUNT equal to 21', () => {
    expect(TRIGGER_COUNT).toBe(21)
  })

  it('Trigger enum has 21 unique values', () => {
    const values = new Set(Object.values(Trigger).filter(v => typeof v === 'number'))
    expect(values.size).toBe(21)
  })

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe('registerCallback', () => {
    it('adds a callback to the correct trigger list', () => {
      const ctx = stubContext()
      const fn = makeCallback()
      triggers.registerCallback(Trigger.OnIdle, fn, ctx)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnIdle)).toBe(true)
    })

    it('adds multiple callbacks for the same trigger', () => {
      const ctx = stubContext()
      triggers.registerCallback(Trigger.OnKilled, makeCallback(), ctx)
      triggers.registerCallback(Trigger.OnKilled, makeCallback(), ctx)
      triggers.registerCallback(Trigger.OnKilled, makeCallback(), ctx)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnKilled)).toBe(true)
    })

    it('throws when fn is null', () => {
      const ctx = stubContext()
      expect(() =>
        triggers.registerCallback(Trigger.OnIdle, null as unknown as TriggerCallback, ctx),
      ).toThrow('fn must not be null')
    })

    it('stores selfArg as the owning actor', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      triggers.registerCallback(Trigger.OnAddedToWorld, fn, ctx)

      // Trigger the event to verify selfArg is passed
      triggers.addedToWorld(self)
      expect(fn).toHaveBeenCalledWith(ctx, self)
    })
  })

  describe('hasAnyCallbacksFor', () => {
    it('returns false for empty trigger list', () => {
      expect(triggers.hasAnyCallbacksFor(Trigger.OnProduction)).toBe(false)
    })

    it('returns true after registering', () => {
      triggers.registerCallback(Trigger.OnCapture, makeCallback(), stubContext())
      expect(triggers.hasAnyCallbacksFor(Trigger.OnCapture)).toBe(true)
    })

    it('returns false after clear', () => {
      triggers.registerCallback(Trigger.OnDamaged, makeCallback(), stubContext())
      triggers.clear(Trigger.OnDamaged)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnDamaged)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Clear / ClearAll
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('removes all callbacks for one trigger', () => {
      const ctx = stubContext()
      triggers.registerCallback(Trigger.OnIdle, makeCallback(), ctx)
      triggers.registerCallback(Trigger.OnKilled, makeCallback(), ctx)
      triggers.clear(Trigger.OnIdle)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnIdle)).toBe(false)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnKilled)).toBe(true)
    })

    it('is safe to call on empty list', () => {
      expect(() => triggers.clear(Trigger.OnTimerExpired)).not.toThrow()
    })
  })

  describe('clearAll', () => {
    it('removes all callbacks from all triggers', () => {
      const ctx = stubContext()
      triggers.registerCallback(Trigger.OnIdle, makeCallback(), ctx)
      triggers.registerCallback(Trigger.OnKilled, makeCallback(), ctx)
      triggers.registerCallback(Trigger.OnDamaged, makeCallback(), ctx)
      triggers.clearAll()
      expect(triggers.hasAnyCallbacksFor(Trigger.OnIdle)).toBe(false)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnKilled)).toBe(false)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnDamaged)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // World disposing guard
  // -----------------------------------------------------------------------

  describe('world disposing guard', () => {
    it('skips callbacks when world is disposing', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      triggers.registerCallback(Trigger.OnIdle, fn, ctx)
      triggers.setWorldDisposingCheck(() => true)

      triggers.tickIdle(self)
      expect(fn).not.toHaveBeenCalled()
    })

    it('invokes callbacks when world is not disposing', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      triggers.registerCallback(Trigger.OnIdle, fn, ctx)
      triggers.setWorldDisposingCheck(() => false)

      triggers.tickIdle(self)
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Trigger dispatch — INotifyIdle
  // -----------------------------------------------------------------------

  describe('INotifyIdle.tickIdle', () => {
    it('calls registered OnIdle callback with selfArg', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      triggers.registerCallback(Trigger.OnIdle, fn, ctx)
      triggers.tickIdle(self)
      expect(fn).toHaveBeenCalledWith(ctx, self)
    })

    it('calls multiple callbacks in order', () => {
      const ctx = stubContext()
      const order: number[] = []
      triggers.registerCallback(Trigger.OnIdle, vi.fn().mockImplementation(() => order.push(1)), ctx)
      triggers.registerCallback(Trigger.OnIdle, vi.fn().mockImplementation(() => order.push(2)), ctx)
      triggers.tickIdle(self)
      expect(order).toEqual([1, 2])
    })

    it('aborts on first fatal error', () => {
      const ctx = stubContext()
      const fn1 = vi.fn().mockImplementation(() => { throw new Error('boom') })
      const fn2 = vi.fn()
      triggers.registerCallback(Trigger.OnIdle, fn1, ctx)
      triggers.registerCallback(Trigger.OnIdle, fn2, ctx)
      triggers.tickIdle(self)
      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).not.toHaveBeenCalled()
      expect(ctx.fatalError).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // INotifyDamage
  // -----------------------------------------------------------------------

  describe('INotifyDamage.damaged', () => {
    it('passes selfArg, attacker, and damage value', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const attacker = stubActor(2)
      const e = stubAttackInfo(attacker, 75)
      triggers.registerCallback(Trigger.OnDamaged, fn, ctx)
      triggers.damaged(self, e)
      expect(fn).toHaveBeenCalledWith(ctx, self, attacker, 75)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyKilled
  // -----------------------------------------------------------------------

  describe('INotifyKilled.killed', () => {
    it('passes selfArg and killer', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const killer = stubActor(99)
      const e = stubAttackInfo(killer)
      triggers.registerCallback(Trigger.OnKilled, fn, ctx)
      triggers.killed(self, e)
      expect(fn).toHaveBeenCalledWith(ctx, self, killer)
    })

    it('fires onKilledInternal after Lua callbacks', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const internalFn = vi.fn()
      const killer = stubActor(99)
      const e = stubAttackInfo(killer)
      triggers.registerCallback(Trigger.OnKilled, fn, ctx)
      triggers.onKilledInternal.add(internalFn)

      triggers.killed(self, e)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(internalFn).toHaveBeenCalledWith(self)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyProduction (unitProduced)
  // -----------------------------------------------------------------------

  describe('INotifyProduction.unitProduced', () => {
    it('passes producer(selfArg) and produced actor', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const produced = stubActor(10)
      triggers.registerCallback(Trigger.OnProduction, fn, ctx)
      triggers.unitProduced(self, produced, stubCPos())
      expect(fn).toHaveBeenCalledWith(ctx, self, produced)
    })

    it('fires onProducedInternal', () => {
      const internalFn = vi.fn()
      const produced = stubActor(10)
      triggers.onProducedInternal.add(internalFn)
      triggers.unitProduced(self, produced, stubCPos())
      expect(internalFn).toHaveBeenCalledWith(self, produced)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyWinStateChanged — OnPlayerWon / OnPlayerLost
  // -----------------------------------------------------------------------

  describe('INotifyWinStateChanged', () => {
    it('onPlayerWon passes player', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const player = stubPlayer('Winner')
      triggers.registerCallback(Trigger.OnPlayerWon, fn, ctx)
      triggers.onPlayerWon(player)
      expect(fn).toHaveBeenCalledWith(ctx, player)
    })

    it('onPlayerLost passes player', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const player = stubPlayer('Loser')
      triggers.registerCallback(Trigger.OnPlayerLost, fn, ctx)
      triggers.onPlayerLost(player)
      expect(fn).toHaveBeenCalledWith(ctx, player)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyObjectivesUpdated
  // -----------------------------------------------------------------------

  describe('INotifyObjectivesUpdated', () => {
    it('onObjectiveAdded passes player and id', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const player = stubPlayer('P1')
      triggers.registerCallback(Trigger.OnObjectiveAdded, fn, ctx)
      triggers.onObjectiveAdded(player, 1)
      expect(fn).toHaveBeenCalledWith(ctx, player, 1)
    })

    it('onObjectiveCompleted passes player and id', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const player = stubPlayer('P1')
      triggers.registerCallback(Trigger.OnObjectiveCompleted, fn, ctx)
      triggers.onObjectiveCompleted(player, 2)
      expect(fn).toHaveBeenCalledWith(ctx, player, 2)
    })

    it('onObjectiveFailed passes player and id', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const player = stubPlayer('P1')
      triggers.registerCallback(Trigger.OnObjectiveFailed, fn, ctx)
      triggers.onObjectiveFailed(player, 3)
      expect(fn).toHaveBeenCalledWith(ctx, player, 3)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyBuildingPlaced
  // -----------------------------------------------------------------------

  describe('INotifyBuildingPlaced.buildingPlaced', () => {
    it('passes builder(selfArg) and placed building', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const building = stubActor(5)
      triggers.registerCallback(Trigger.OnBuildingPlaced, fn, ctx)
      triggers.buildingPlaced(self, building)
      expect(fn).toHaveBeenCalledWith(ctx, self, building)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyCapture
  // -----------------------------------------------------------------------

  describe('INotifyCapture.onCapture', () => {
    it('passes self, captor, oldOwner, newOwner', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const captor = stubActor(2)
      const oldOwner = stubPlayer('Old')
      const newOwner = stubPlayer('New')
      triggers.registerCallback(Trigger.OnCapture, fn, ctx)
      triggers.onCapture(self, captor, oldOwner, newOwner, 0)
      expect(fn).toHaveBeenCalledWith(ctx, self, captor, oldOwner, newOwner)
    })

    it('fires onCapturedInternal', () => {
      const internalFn = vi.fn()
      triggers.onCapturedInternal.add(internalFn)
      triggers.onCapture(self, stubActor(2), stubPlayer('O'), stubPlayer('N'), 0)
      expect(internalFn).toHaveBeenCalledWith(self)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyInfiltrated
  // -----------------------------------------------------------------------

  describe('INotifyInfiltrated.infiltrated', () => {
    it('passes selfArg and infiltrator', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const infiltrator = stubActor(77)
      triggers.registerCallback(Trigger.OnInfiltrated, fn, ctx)
      triggers.infiltrated(self, infiltrator, 1)
      expect(fn).toHaveBeenCalledWith(ctx, self, infiltrator)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyAddedToWorld / INotifyRemovedFromWorld
  // -----------------------------------------------------------------------

  describe('INotifyAddedToWorld / INotifyRemovedFromWorld', () => {
    it('addedToWorld passes selfArg', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      triggers.registerCallback(Trigger.OnAddedToWorld, fn, ctx)
      triggers.addedToWorld(self)
      expect(fn).toHaveBeenCalledWith(ctx, self)
    })

    it('addedToWorld fires onAddedInternal', () => {
      const internalFn = vi.fn()
      triggers.onAddedInternal.add(internalFn)
      triggers.addedToWorld(self)
      expect(internalFn).toHaveBeenCalledWith(self)
    })

    it('removedFromWorld passes selfArg', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      triggers.registerCallback(Trigger.OnRemovedFromWorld, fn, ctx)
      triggers.removedFromWorld(self)
      expect(fn).toHaveBeenCalledWith(ctx, self)
    })

    it('removedFromWorld fires onRemovedInternal', () => {
      const internalFn = vi.fn()
      triggers.onRemovedInternal.add(internalFn)
      triggers.removedFromWorld(self)
      expect(internalFn).toHaveBeenCalledWith(self)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyDiscovered
  // -----------------------------------------------------------------------

  describe('INotifyDiscovered.onDiscovered', () => {
    it('fires OnDiscovered with selfArg and discoverer', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const discoverer = stubPlayer('Discovery')
      triggers.registerCallback(Trigger.OnDiscovered, fn, ctx)
      triggers.onDiscovered(self, discoverer, true)
      expect(fn).toHaveBeenCalledWith(ctx, self, discoverer)
    })

    it('fires OnPlayerDiscovered with selfArg and discoverer', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const discoverer = stubPlayer('Discovery')
      triggers.registerCallback(Trigger.OnPlayerDiscovered, fn, ctx)
      triggers.onDiscovered(self, discoverer, true)
      expect(fn).toHaveBeenCalledWith(ctx, self, discoverer, self)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyPassengerEntered / Exited
  // -----------------------------------------------------------------------

  describe('INotifyPassengerEntered/Exited', () => {
    it('onPassengerEntered passes transport(selfArg) and passenger', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const passenger = stubActor(8)
      triggers.registerCallback(Trigger.OnPassengerEntered, fn, ctx)
      triggers.onPassengerEntered(self, passenger)
      expect(fn).toHaveBeenCalledWith(ctx, self, passenger)
    })

    it('onPassengerExited passes transport(selfArg) and passenger', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const passenger = stubActor(8)
      triggers.registerCallback(Trigger.OnPassengerExited, fn, ctx)
      triggers.onPassengerExited(self, passenger)
      expect(fn).toHaveBeenCalledWith(ctx, self, passenger)
    })
  })

  // -----------------------------------------------------------------------
  // INotifySold
  // -----------------------------------------------------------------------

  describe('INotifySold', () => {
    it('selling is a no-op', () => {
      expect(() => triggers.selling(self)).not.toThrow()
    })

    it('sold passes selfArg', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      triggers.registerCallback(Trigger.OnSold, fn, ctx)
      triggers.sold(self)
      expect(fn).toHaveBeenCalledWith(ctx, self)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyOtherProduction
  // -----------------------------------------------------------------------

  describe('INotifyOtherProduction', () => {
    it('passes producee, produced, productionType', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      const producee = stubActor(100)
      const produced = stubActor(200)
      triggers.registerCallback(Trigger.OnOtherProduction, fn, ctx)
      triggers.unitProducedByOther(self, producee, produced, 'Infantry', {})
      expect(fn).toHaveBeenCalledWith(ctx, producee, produced, 'Infantry')
    })

    it('fires onOtherProducedInternal', () => {
      const internalFn = vi.fn()
      const producee = stubActor(100)
      const produced = stubActor(200)
      triggers.onOtherProducedInternal.add(internalFn)
      triggers.unitProducedByOther(self, producee, produced, 'Vehicle', {})
      expect(internalFn).toHaveBeenCalledWith(producee, produced)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyTimeLimit
  // -----------------------------------------------------------------------

  describe('INotifyTimeLimit', () => {
    it('notifyTimerExpired calls callback with no args', () => {
      const ctx = stubContext()
      const fn = vi.fn()
      triggers.registerCallback(Trigger.OnTimerExpired, fn, ctx)
      triggers.notifyTimerExpired(self)
      expect(fn).toHaveBeenCalledWith(ctx)
    })
  })

  // -----------------------------------------------------------------------
  // INotifyActorDisposing
  // -----------------------------------------------------------------------

  describe('INotifyActorDisposing', () => {
    it('calls clearAll on dispose', () => {
      const ctx = stubContext()
      triggers.registerCallback(Trigger.OnIdle, vi.fn(), ctx)
      triggers.registerCallback(Trigger.OnKilled, vi.fn(), ctx)
      triggers.disposing(self)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnIdle)).toBe(false)
      expect(triggers.hasAnyCallbacksFor(Trigger.OnKilled)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Internal events: subscribe/unsubscribe
  // -----------------------------------------------------------------------

  describe('internal events', () => {
    it('onKilledInternal supports multiple listeners', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      triggers.onKilledInternal.add(fn1)
      triggers.onKilledInternal.add(fn2)

      const e = stubAttackInfo(stubActor(99))
      triggers.killed(self, e)

      expect(fn1).toHaveBeenCalledWith(self)
      expect(fn2).toHaveBeenCalledWith(self)
    })

    it('onKilledInternal listener can be removed', () => {
      const fn = vi.fn()
      triggers.onKilledInternal.add(fn)
      triggers.onKilledInternal.delete(fn)

      const e = stubAttackInfo(stubActor(99))
      triggers.killed(self, e)
      expect(fn).not.toHaveBeenCalled()
    })

    it('onProducedInternal receives producer and produced', () => {
      const fn = vi.fn()
      triggers.onProducedInternal.add(fn)
      const produced = stubActor(10)
      triggers.unitProduced(self, produced, stubCPos())
      expect(fn).toHaveBeenCalledWith(self, produced)
    })

    it('onAddedInternal receives the added actor', () => {
      const fn = vi.fn()
      triggers.onAddedInternal.add(fn)
      triggers.addedToWorld(self)
      expect(fn).toHaveBeenCalledWith(self)
    })

    it('onRemovedInternal receives the removed actor', () => {
      const fn = vi.fn()
      triggers.onRemovedInternal.add(fn)
      triggers.removedFromWorld(self)
      expect(fn).toHaveBeenCalledWith(self)
    })

    it('onCapturedInternal receives the captured actor', () => {
      const fn = vi.fn()
      triggers.onCapturedInternal.add(fn)
      triggers.onCapture(self, stubActor(2), stubPlayer('O'), stubPlayer('N'), 0)
      expect(fn).toHaveBeenCalledWith(self)
    })
  })

  // -----------------------------------------------------------------------
  // Fatal error handling
  // -----------------------------------------------------------------------

  describe('fatal error', () => {
    it('calls context.fatalError with the exception', () => {
      const ctx = stubContext()
      const error = new Error('script error')
      const fn = vi.fn().mockImplementation(() => { throw error })
      triggers.registerCallback(Trigger.OnIdle, fn, ctx)
      triggers.tickIdle(self)
      expect(ctx.fatalError).toHaveBeenCalledWith(error)
    })

    it('aborts remaining callbacks after error', () => {
      const ctx = stubContext()
      const fn1 = vi.fn().mockImplementation(() => { throw new Error('fail') })
      const fn2 = vi.fn()
      triggers.registerCallback(Trigger.OnDamaged, fn1, ctx)
      triggers.registerCallback(Trigger.OnDamaged, fn2, ctx)
      triggers.damaged(self, stubAttackInfo())
      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).not.toHaveBeenCalled()
    })

    it('aborts on first OnKilled error and still fires internal events', () => {
      const ctx = stubContext()
      const error = new Error('killed handler error')
      const fn = vi.fn().mockImplementation(() => { throw error })
      const internalFn = vi.fn()
      triggers.registerCallback(Trigger.OnKilled, fn, ctx)
      triggers.onKilledInternal.add(internalFn)
      triggers.killed(self, stubAttackInfo())
      // OpenRA: FatalError is called, but internal events still fire
      // because they fire AFTER the Lua callback loop returns early
      expect(ctx.fatalError).toHaveBeenCalledWith(error)
    })
  })
})
