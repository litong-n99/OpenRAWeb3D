/**
 * Demolition.test.ts — Demolition 爆破 trait 单元测试
 *
 * Tests focus on:
 * - DemolitionInfo defaults (detonationDelay=45, flashes=3, flashesDelay=4,
 *   flashInterval=4, enterBehaviour=Exit, damageTypes=empty, voice="Action",
 *   targetLineColor=Crimson, cursor="c4")
 * - DemolitionInfo targetRelationships / forceTargetRelationships defaults
 * - DemolishActivityStub stores all constructor params
 * - DemolitionOrderTargeter extends UnitOrderTargeter
 * - DemolitionOrderTargeter.CanTargetActor (relationship + demolishable checks)
 * - DemolitionOrderTargeter.CanTargetFrozenActor (visibility checks)
 * - ConditionalTrait integration (isTraitDisabled gating)
 * - IOrderVoice.voicePhraseForOrder() returns voice for "C4" order
 * - getDemolishActivity() returns configured stub
 * - IIssueOrder.orders returns DemolitionOrderTargeter when enabled
 * - IIssueOrder.issueOrder() creates C4 order with target + queued
 * - IResolveOrder.resolveOrder() processes C4 with valid target
 * - resolveOrder ignores invalid targets, non-C4 orders, disabled traits
 * - Lifecycle (attach/detach/dispose)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Demolition,
  DemolitionInfo,
  DemolishActivityStub,
} from './Demolition.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import {
  EnterBehaviour,
  PlayerRelationship,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  IOrderTargeter,
  PlayerStub,
  ColorStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mocks for @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayerStub(name = 'TestPlayer'): PlayerStub {
  return { playerName: name }
}

function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: makePlayerStub(),
    queueActivity: vi.fn(),
    ...overrides,
  } as unknown as IGameActor
}

/**
 * Create a mock actor that has a demolishable trait.
 */
function makeDemolishableActor(
  overrides: Record<string, unknown> = {},
): IGameActor {
  const demolishable: {
    demolishableInfo: { isValidTarget: ReturnType<typeof vi.fn> }
  } = {
    demolishableInfo: {
      isValidTarget: vi.fn().mockReturnValue(true),
    },
  }

  const traitsImplementing = vi.fn((name: string) => {
    if (name === 'IDemolishable') return [demolishable]
    return []
  })

  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: makePlayerStub(),
    queueActivity: vi.fn(),
    traitsImplementing,
    info: { name: 'TestTarget' },
    ...overrides,
  } as unknown as IGameActor
}

/**
 * Create a Target for an actor.
 */
function makeTargetForActor(actor: IGameActor): Target {
  return Target.fromActor(actor as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Demolition', () => {
  // ---------------------------------------------------------------------------
  // DemolitionInfo
  // ---------------------------------------------------------------------------

  describe('DemolitionInfo', () => {
    it('has default values', () => {
      const info = new DemolitionInfo()
      expect(info.detonationDelay).toBe(45)
      expect(info.flashes).toBe(3)
      expect(info.flashesDelay).toBe(4)
      expect(info.flashInterval).toBe(4)
      expect(info.enterBehaviour).toBe(EnterBehaviour.Exit)
      expect(info.damageTypes).toEqual(new Set())
      expect(info.voice).toBe('Action')
      expect(info.cursor).toBe('c4')
      expect(info.targetLineColor).toEqual({ r: 220, g: 20, b: 60, a: 255 })
      expect(info.targetRelationships).toBe(
        PlayerRelationship.Enemy | PlayerRelationship.Neutral,
      )
      expect(info.forceTargetRelationships).toBe(
        PlayerRelationship.Enemy |
          PlayerRelationship.Neutral |
          PlayerRelationship.Ally,
      )
      expect(info.requiresCondition).toBeUndefined()
    })

    it('accepts custom values', () => {
      const customDamageTypes = new Set(['Explosion', 'Structure'])
      const customColor: ColorStub = { r: 255, g: 0, b: 0, a: 255 }
      const info = new DemolitionInfo({
        detonationDelay: 60,
        flashes: 5,
        flashesDelay: 10,
        flashInterval: 8,
        enterBehaviour: EnterBehaviour.Suicide,
        damageTypes: customDamageTypes,
        voice: 'Attack',
        targetLineColor: customColor,
        targetRelationships: PlayerRelationship.Enemy,
        forceTargetRelationships: PlayerRelationship.Enemy,
        cursor: 'c4_custom',
        requiresCondition: '!disabled',
        instanceName: 'demo_test',
      })
      expect(info.detonationDelay).toBe(60)
      expect(info.flashes).toBe(5)
      expect(info.flashesDelay).toBe(10)
      expect(info.flashInterval).toBe(8)
      expect(info.enterBehaviour).toBe(EnterBehaviour.Suicide)
      expect(info.damageTypes).toBe(customDamageTypes)
      expect(info.voice).toBe('Attack')
      expect(info.targetLineColor).toBe(customColor)
      expect(info.targetRelationships).toBe(PlayerRelationship.Enemy)
      expect(info.forceTargetRelationships).toBe(PlayerRelationship.Enemy)
      expect(info.cursor).toBe('c4_custom')
      expect(info.requiresCondition).toBe('!disabled')
      expect(info.instanceName).toBe('demo_test')
    })

    it('implements ConditionalTraitInfo', () => {
      const info = new DemolitionInfo()
      expect('requiresCondition' in info).toBe(true)
      expect('instanceName' in info).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // DemolishActivityStub
  // ---------------------------------------------------------------------------

  describe('DemolishActivityStub', () => {
    it('stores all constructor params', () => {
      const actor = makeMockActor()
      const target = makeTargetForActor(makeMockActor())
      const color: ColorStub = { r: 255, g: 0, b: 0, a: 255 }
      const damageTypes = new Set(['Explosion'])

      const stub = new DemolishActivityStub(
        actor,
        target,
        EnterBehaviour.Dispose,
        60,
        5,
        10,
        8,
        damageTypes,
        color,
      )

      expect(stub._self).toBe(actor)
      expect(stub._target).toBe(target)
      expect(stub._enterBehaviour).toBe(EnterBehaviour.Dispose)
      expect(stub._detonationDelay).toBe(60)
      expect(stub._flashes).toBe(5)
      expect(stub._flashesDelay).toBe(10)
      expect(stub._flashInterval).toBe(8)
      expect(stub._damageTypes).toBe(damageTypes)
      expect(stub._targetLineColor).toBe(color)
    })

    it('implements ActivityStub interface methods as no-ops', () => {
      const stub = new DemolishActivityStub(
        makeMockActor(),
        null,
        EnterBehaviour.Exit,
        45,
        3,
        4,
        4,
        new Set(),
        null,
      )

      expect(() => stub.queue(stub)).not.toThrow()
      expect(() => stub.cancel(makeMockActor())).not.toThrow()
      expect(() => stub.onActorDisposeOuter(makeMockActor())).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Demolition trait
  // ---------------------------------------------------------------------------

  describe('Demolition trait', () => {
    let info: DemolitionInfo
    let trait: Demolition
    let self: IGameActor

    beforeEach(() => {
      info = new DemolitionInfo()
      trait = new Demolition(info)
      self = makeMockActor()
    })

    it('extends ConditionalTrait', () => {
      expect(trait.enabled).toBe(true)
      expect(trait.disposed).toBe(false)
    })

    // -----------------------------------------------------------------------
    // voicePhraseForOrder
    // -----------------------------------------------------------------------

    describe('voicePhraseForOrder', () => {
      it('returns voice for C4 order', () => {
        const result = trait.voicePhraseForOrder(self, {
          orderName: 'C4',
          targetString: '',
          extraData: 0,
        })
        expect(result).toBe('Action')
      })

      it('returns empty string for other orders', () => {
        const result = trait.voicePhraseForOrder(self, {
          orderName: 'Attack',
          targetString: '',
          extraData: 0,
        })
        expect(result).toBe('')
      })

      it('returns empty string when trait is disabled', () => {
        trait.onEnabledChanged(false)
        const result = trait.voicePhraseForOrder(self, {
          orderName: 'C4',
          targetString: '',
          extraData: 0,
        })
        expect(result).toBe('')
      })
    })

    // -----------------------------------------------------------------------
    // getDemolishActivity
    // -----------------------------------------------------------------------

    describe('getDemolishActivity', () => {
      it('returns DemolishActivityStub with correct params', () => {
        const target = makeTargetForActor(makeMockActor())
        const activity = trait.getDemolishActivity(self, target) as DemolishActivityStub

        expect(activity).toBeInstanceOf(DemolishActivityStub)
        expect(activity._self).toBe(self)
        expect(activity._target).toBe(target)
        expect(activity._detonationDelay).toBe(45)
        expect(activity._flashes).toBe(3)
        expect(activity._enterBehaviour).toBe(EnterBehaviour.Exit)
      })

      it('uses custom targetLineColor when provided', () => {
        const color: ColorStub = { r: 0, g: 255, b: 0, a: 255 }
        const activity = trait.getDemolishActivity(
          self,
          null,
          color,
        ) as DemolishActivityStub

        expect(activity._targetLineColor).toBe(color)
      })

      it('uses info.targetLineColor when no override provided', () => {
        const activity = trait.getDemolishActivity(
          self,
          null,
        ) as DemolishActivityStub

        expect(activity._targetLineColor).toEqual({
          r: 220,
          g: 20,
          b: 60,
          a: 255,
        })
      })
    })

    // -----------------------------------------------------------------------
    // orders getter
    // -----------------------------------------------------------------------

    describe('orders getter', () => {
      it('returns DemolitionOrderTargeter when enabled', () => {
        const orders = trait.orders
        expect(orders).toHaveLength(1)
        expect(orders[0].orderID).toBe('C4')
        expect(orders[0].orderPriority).toBe(6)
      })

      it('returns empty array when disabled', () => {
        trait.onEnabledChanged(false)
        expect(trait.orders).toHaveLength(0)
      })
    })

    // -----------------------------------------------------------------------
    // issueOrder
    // -----------------------------------------------------------------------

    describe('issueOrder', () => {
      it('returns C4 order with target and queued', () => {
        const mockTargeter = { orderID: 'C4', orderPriority: 6 }
        const mockTarget = {}
        const result = trait.issueOrder(
          self,
          mockTargeter as IOrderTargeter,
          mockTarget,
          true,
        )
        expect(result.orderName).toBe('C4')
        const ed = result.extraData as { queued: boolean; target: unknown }
        expect(ed.queued).toBe(true)
        expect(ed.target).toBe(mockTarget)
      })

      it('returns empty order when trait is disabled', () => {
        trait.onEnabledChanged(false)
        const mockTargeter = { orderID: 'C4', orderPriority: 6 }
        const result = trait.issueOrder(
          self,
          mockTargeter as IOrderTargeter,
          {},
          false,
        )
        expect(result.orderName).toBe('')
      })

      it('returns empty order when orderID does not match', () => {
        const mockTargeter = { orderID: 'Other', orderPriority: 1 }
        const result = trait.issueOrder(
          self,
          mockTargeter as IOrderTargeter,
          {},
          false,
        )
        expect(result.orderName).toBe('')
      })

      it('returns empty order when targeter orderID is not C4', () => {
        const mockTargeter = { orderID: 'Attack', orderPriority: 10 }
        const result = trait.issueOrder(
          self,
          mockTargeter as IOrderTargeter,
          {},
          false,
        )
        expect(result.orderName).toBe('')
      })
    })

    // -----------------------------------------------------------------------
    // resolveOrder
    // -----------------------------------------------------------------------

    describe('resolveOrder', () => {
      it('processes C4 order on valid demolishable target', () => {
        const queueSpy = vi.fn()
        const saboteur = makeMockActor({ queueActivity: queueSpy })
        const target = makeDemolishableActor()
        const targetObj = makeTargetForActor(target)

        trait.resolveOrder(saboteur, {
          orderName: 'C4',
          targetString: '',
          extraData: { queued: false, target: targetObj },
        })

        expect(queueSpy).toHaveBeenCalledTimes(1)
        const activity = queueSpy.mock.calls[0][0] as DemolishActivityStub
        expect(activity).toBeInstanceOf(DemolishActivityStub)
        expect(activity._target).toBe(targetObj)
      })

      it('ignores non-C4 orders', () => {
        const queueSpy = vi.fn()
        const saboteur = makeMockActor({ queueActivity: queueSpy })
        const target = makeDemolishableActor()
        const targetObj = makeTargetForActor(target)

        trait.resolveOrder(saboteur, {
          orderName: 'Attack',
          targetString: '',
          extraData: { queued: false, target: targetObj },
        })

        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('ignores C4 order when trait is disabled', () => {
        trait.onEnabledChanged(false)
        const queueSpy = vi.fn()
        const saboteur = makeMockActor({ queueActivity: queueSpy })
        const target = makeDemolishableActor()
        const targetObj = makeTargetForActor(target)

        trait.resolveOrder(saboteur, {
          orderName: 'C4',
          targetString: '',
          extraData: { queued: false, target: targetObj },
        })

        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('ignores C4 order when target is missing', () => {
        const queueSpy = vi.fn()
        const saboteur = makeMockActor({ queueActivity: queueSpy })

        trait.resolveOrder(saboteur, {
          orderName: 'C4',
          targetString: '',
          extraData: { queued: false },
        })

        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('ignores C4 order when target is not demolishable', () => {
        const queueSpy = vi.fn()
        const saboteur = makeMockActor({ queueActivity: queueSpy })
        const nonDemoTarget = makeMockActor({
          traitsImplementing: vi.fn().mockReturnValue([]),
        })
        const targetObj = makeTargetForActor(nonDemoTarget)

        trait.resolveOrder(saboteur, {
          orderName: 'C4',
          targetString: '',
          extraData: { queued: false, target: targetObj },
        })

        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('ignores C4 order when demolishable isValidTarget returns false', () => {
        const queueSpy = vi.fn()
        const saboteur = makeMockActor({ queueActivity: queueSpy })
        const invalidTarget = makeDemolishableActor()
        // Override to make isValidTarget return false
        const traits = (invalidTarget as unknown as {
          traitsImplementing: (name: string) => { demolishableInfo: { isValidTarget: ReturnType<typeof vi.fn> } }[]
        }).traitsImplementing('IDemolishable')
        traits[0].demolishableInfo.isValidTarget = vi.fn().mockReturnValue(false)

        const targetObj = makeTargetForActor(invalidTarget)

        trait.resolveOrder(saboteur, {
          orderName: 'C4',
          targetString: '',
          extraData: { queued: false, target: targetObj },
        })

        expect(queueSpy).not.toHaveBeenCalled()
      })

      it('does not throw when queueActivity is not available', () => {
        const saboteur = makeMockActor({ queueActivity: undefined })
        const target = makeDemolishableActor()
        const targetObj = makeTargetForActor(target)

        expect(() =>
          trait.resolveOrder(saboteur, {
            orderName: 'C4',
            targetString: '',
            extraData: { queued: false, target: targetObj },
          }),
        ).not.toThrow()
      })
    })

    // -----------------------------------------------------------------------
    // DemolitionOrderTargeter (via orders)
    // -----------------------------------------------------------------------

    describe('DemolitionOrderTargeter', () => {
      it('can target demolishable enemy actor', () => {
        const orders = trait.orders
        const targeter = orders[0]

        const enemyOwner = makePlayerStub('Enemy')
        const target = makeDemolishableActor({ owner: enemyOwner })
        const result = targeter.canTarget(
          self,
          makeTargetForActor(target),
          TargetModifiers.None,
          '',
        )
        expect(result).toBe(true)
      })

      it('cannot target actor without demolishable trait', () => {
        const orders = trait.orders
        const targeter = orders[0]

        const nonDemoTarget = makeMockActor()
        const result = targeter.canTarget(
          self,
          makeTargetForActor(nonDemoTarget),
          TargetModifiers.None,
          '',
        )
        expect(result).toBe(false)
      })

      it('can target demolishable ally with ForceAttack', () => {
        const orders = trait.orders
        const targeter = orders[0]

        const allyActor = makeDemolishableActor({ owner: self.owner })
        const result = targeter.canTarget(
          self,
          makeTargetForActor(allyActor),
          TargetModifiers.ForceAttack,
          '',
        )
        expect(result).toBe(true)
      })

      it('cannot target demolishable ally without ForceAttack', () => {
        const orders = trait.orders
        const targeter = orders[0]

        const allyActor = makeDemolishableActor({ owner: self.owner })
        const result = targeter.canTarget(
          self,
          makeTargetForActor(allyActor),
          TargetModifiers.None,
          '',
        )
        expect(result).toBe(false)
      })

      it('returns false for ForceMove modifier', () => {
        const orders = trait.orders
        const targeter = orders[0]

        const target = makeDemolishableActor()
        const result = targeter.canTarget(
          self,
          makeTargetForActor(target),
          TargetModifiers.ForceMove,
          '',
        )
        expect(result).toBe(false)
      })

      it('returns false for non-actor target type', () => {
        const orders = trait.orders
        const targeter = orders[0]

        // Target.Invalid is not an actor target
        const invalidTarget = Target.Invalid
        const result = targeter.canTarget(
          self,
          invalidTarget,
          TargetModifiers.None,
          '',
        )
        expect(result).toBe(false)
      })
    })

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    describe('lifecycle', () => {
      it('supports attach and detach', () => {
        const testActor = makeMockActor()
        const testTrait = new Demolition(new DemolitionInfo())
        testTrait.attach(testActor)
        expect(testTrait.actor).toBe(testActor)
        testTrait.detach(testActor)
      })

      it('supports dispose', () => {
        trait.dispose()
        expect(trait.disposed).toBe(true)
      })

      it('onEnabledChanged toggles isTraitDisabled', () => {
        expect(trait.isTraitDisabled).toBe(false)
        trait.onEnabledChanged(false)
        expect(trait.isTraitDisabled).toBe(true)
        trait.onEnabledChanged(true)
        expect(trait.isTraitDisabled).toBe(false)
      })
    })
  })
})
