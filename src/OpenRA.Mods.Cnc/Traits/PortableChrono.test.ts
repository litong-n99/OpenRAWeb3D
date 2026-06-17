/**
 * PortableChrono.test.ts — unit tests for portable chronoshift device
 *
 * Tests focus on: charge management, canTeleport state, order generation,
 * order resolution, ISelectionBar values, targeter logic, and order generator.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  PortableChronoInfo,
  PortableChrono,
  PortableChronoOrderTargeter,
  PortableChronoOrderGenerator,
} from './PortableChrono.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(name: string = 'chronoInfantry', id: number = 1, loc: CPos = new CPos(5, 5)): IGameActor {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name },
    location: loc,
  } as IGameActor & { location: CPos }
}

// ---------------------------------------------------------------------------
// PortableChronoInfo
// ---------------------------------------------------------------------------

describe('PortableChronoInfo', () => {
  describe('defaults', () => {
    const info = new PortableChronoInfo()

    it('has default chargeDelay of 500', () => {
      expect(info.chargeDelay).toBe(500)
    })

    it('has default hasDistanceLimit of true', () => {
      expect(info.hasDistanceLimit).toBe(true)
    })

    it('has default maxDistance of 12', () => {
      expect(info.maxDistance).toBe(12)
    })

    it('has default chronoshiftSound of "chrotnk1.aud"', () => {
      expect(info.chronoshiftSound).toBe('chrotnk1.aud')
    })

    it('has default killCargo of true', () => {
      expect(info.killCargo).toBe(true)
    })

    it('has default flashScreen of false', () => {
      expect(info.flashScreen).toBe(false)
    })

    it('has default voice of "Action"', () => {
      expect(info.voice).toBe('Action')
    })

    it('has default targetCursor of "chrono-target"', () => {
      expect(info.targetCursor).toBe('chrono-target')
    })

    it('has default targetBlockedCursor of "move-blocked"', () => {
      expect(info.targetBlockedCursor).toBe('move-blocked')
    })

    it('has default deployCursor of "deploy"', () => {
      expect(info.deployCursor).toBe('deploy')
    })

    it('has default deployBlockedCursor of "deploy-blocked"', () => {
      expect(info.deployBlockedCursor).toBe('deploy-blocked')
    })

    it('has default circleWidth of 1', () => {
      expect(info.circleWidth).toBe(1)
    })

    it('has default circleBorderWidth of 3', () => {
      expect(info.circleBorderWidth).toBe(3)
    })
  })

  describe('create', () => {
    it('creates a PortableChrono instance', () => {
      const info = new PortableChronoInfo()
      const actor = makeActor()
      const trait = info.create(actor)
      expect(trait).toBeInstanceOf(PortableChrono)
    })
  })
})

// ---------------------------------------------------------------------------
// PortableChrono
// ---------------------------------------------------------------------------

describe('PortableChrono', () => {
  let info: PortableChronoInfo
  let trait: PortableChrono
  let actor: IGameActor

  beforeEach(() => {
    info = new PortableChronoInfo({ chargeDelay: 100 })
    actor = makeActor()
    trait = new PortableChrono(actor, info)
  })

  describe('initial state', () => {
    it('has chargeTick of 0', () => {
      expect(trait.chargeTick).toBe(0)
    })

    it('can teleport (chargeTick <= 0)', () => {
      expect(trait.canTeleport).toBe(true)
    })

    it('displayWhenEmpty is false', () => {
      expect(trait.displayWhenEmpty).toBe(false)
    })

    it('stores self reference', () => {
      expect(trait.self).toBe(actor)
    })
  })

  describe('canTeleport', () => {
    it('returns false when trait disabled', () => {
      Object.defineProperty(trait, 'isTraitDisabled', { value: true, writable: false })
      expect(trait.canTeleport).toBe(false)
    })

    it('returns false when trait paused', () => {
      Object.defineProperty(trait, 'isTraitPaused', { value: true, writable: false })
      expect(trait.canTeleport).toBe(false)
    })

    it('returns false when chargeTick > 0', () => {
      trait.chargeTick = 10
      expect(trait.canTeleport).toBe(false)
    })

    it('returns true when chargeTick is 0', () => {
      trait.chargeTick = 0
      expect(trait.canTeleport).toBe(true)
    })
  })

  describe('resetChargeTime', () => {
    it('sets chargeTick to chargeDelay', () => {
      trait.resetChargeTime()
      expect(trait.chargeTick).toBe(100)
    })

    it('sets canTeleport to false', () => {
      trait.resetChargeTime()
      expect(trait.canTeleport).toBe(false)
    })
  })

  describe('tick()', () => {
    it('decrements chargeTick', () => {
      trait.resetChargeTime()
      expect(trait.chargeTick).toBe(100)
      trait.tick(actor)
      expect(trait.chargeTick).toBe(99)
    })

    it('does not decrement when trait disabled', () => {
      trait.resetChargeTime()
      Object.defineProperty(trait, 'isTraitDisabled', { value: true, writable: false })
      trait.tick(actor)
      expect(trait.chargeTick).toBe(100)
    })

    it('does not decrement when trait paused', () => {
      trait.resetChargeTime()
      Object.defineProperty(trait, 'isTraitPaused', { value: true, writable: false })
      trait.tick(actor)
      expect(trait.chargeTick).toBe(100)
    })

    it('does not go below zero', () => {
      trait.tick(actor)
      expect(trait.chargeTick).toBe(0)
    })
  })

  describe('getValue (ISelectionBar)', () => {
    it('returns 0 when trait disabled', () => {
      Object.defineProperty(trait, 'isTraitDisabled', { value: true, writable: false })
      expect(trait.getValue()).toBe(0)
    })

    it('returns charge progress as fraction', () => {
      trait.resetChargeTime() // chargeTick = 100
      expect(trait.getValue()).toBe(0) // (100 - 100) / 100 = 0

      trait.chargeTick = 50
      expect(trait.getValue()).toBe(0.5) // (100 - 50) / 100 = 0.5

      trait.chargeTick = 0
      expect(trait.getValue()).toBe(1.0) // (100 - 0) / 100 = 1.0
    })
  })

  describe('getColor (ISelectionBar)', () => {
    it('returns magenta', () => {
      const color = trait.getColor()
      expect(color.r).toBe(255); expect(color.g).toBe(0); expect(color.b).toBe(255); expect(color.a).toBe(255)
    })
  })

  describe('orders', () => {
    it('returns empty when trait disabled', () => {
      Object.defineProperty(trait, 'isTraitDisabled', { value: true, writable: false })
      expect(trait.orders).toEqual([])
    })

    it('returns targeters when enabled', () => {
      const orders = trait.orders
      expect(orders.length).toBe(1)
      expect(orders[0].orderID).toBe('PortableChronoTeleport')
    })
  })

  describe('issueOrder', () => {
    it('returns default order for unknown order ID', () => {
      const result = trait.issueOrder(actor, { orderID: 'Unknown', orderPriority: 0, isQueued: false, canTarget: () => false, targetOverridesSelection: () => false }, {}, false)
      expect(result).toBeDefined()
      expect(result.orderName).toBe('Unknown')
    })

    it('returns deploy order for PortableChronoDeploy', () => {
      const result = trait.issueOrder(actor, { orderID: 'PortableChronoDeploy', orderPriority: 5, isQueued: false, canTarget: () => false, targetOverridesSelection: () => false }, {}, false) as any
      expect(result).toBeDefined()
      expect(result.orderString).toBe('PortableChronoDeploy')
    })

    it('returns teleport order for PortableChronoTeleport', () => {
      const result = trait.issueOrder(actor, { orderID: 'PortableChronoTeleport', orderPriority: 5, isQueued: false, canTarget: () => false, targetOverridesSelection: () => false }, {}, true) as any
      expect(result).toBeDefined()
      expect(result.orderString).toBe('PortableChronoTeleport')
      expect(result.queued).toBe(true)
    })
  })

  describe('resolveOrder', () => {
    it('resets charge time after teleport order', () => {
      trait.resolveOrder(actor, {
        orderName: 'PortableChronoTeleport',
        orderString: 'PortableChronoTeleport',
        targetString: '',
        extraData: undefined,
        target: { cell: new CPos(10, 10) },
        queued: false,
      } as any)
      expect(trait.chargeTick).toBe(100)
    })

    it('does nothing for non-teleport orders', () => {
      trait.resolveOrder(actor, { orderName: 'Attack', targetString: '', extraData: undefined, orderString: 'Attack', queued: false } as any)
      expect(trait.chargeTick).toBe(0)
    })

    it('does nothing when target is missing', () => {
      trait.resolveOrder(actor, { orderName: 'PortableChronoTeleport', targetString: '', extraData: undefined, orderString: 'PortableChronoTeleport', queued: false } as any)
      expect(trait.chargeTick).toBe(0)
    })
  })

  describe('voicePhraseForOrder', () => {
    it('returns voice for teleport order', () => {
      expect(trait.voicePhraseForOrder(actor, { orderName: 'PortableChronoTeleport', targetString: '', extraData: undefined, orderString: 'PortableChronoTeleport' } as any)).toBe('Action')
    })

    it('returns null for other orders', () => {
      expect(trait.voicePhraseForOrder(actor, { orderName: 'Attack', targetString: '', extraData: undefined, orderString: 'Attack' } as any)).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// PortableChronoOrderTargeter
// ---------------------------------------------------------------------------

describe('PortableChronoOrderTargeter', () => {
  let targeter: PortableChronoOrderTargeter
  let actor: IGameActor

  beforeEach(() => {
    targeter = new PortableChronoOrderTargeter('chrono-target')
    actor = makeActor()
  })

  describe('initial state', () => {
    it('has correct orderID', () => {
      expect(targeter.orderID).toBe('PortableChronoTeleport')
    })

    it('has priority 5', () => {
      expect(targeter.orderPriority).toBe(5)
    })

    it('is not queued initially', () => {
      expect(targeter.isQueued).toBe(false)
    })
  })

  describe('canTarget', () => {
    it('returns false without ForceMove modifier', () => {
      expect(targeter.canTarget(actor, {}, 0  as any, '')).toBe(false)
    })

    it('returns true with ForceMove modifier', () => {
      expect(targeter.canTarget(actor, {}, 4 as any, '')).toBe(true) // ForceMove = 4
    })

    it('sets isQueued with ForceQueue modifier', () => {
      targeter.canTarget(actor, {}, 6 as any, '') // ForceMove(4) | ForceQueue(2) = 6
      expect(targeter.isQueued).toBe(true)
    })
  })

  describe('targetOverridesSelection', () => {
    it('always returns true', () => {
      expect(targeter.targetOverridesSelection(actor, {}, [], CPos.Zero, 0  as any)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// PortableChronoOrderGenerator
// ---------------------------------------------------------------------------

describe('PortableChronoOrderGenerator', () => {
  let info: PortableChronoInfo
  let trait: PortableChrono
  let generator: PortableChronoOrderGenerator
  let actor: IGameActor

  beforeEach(() => {
    info = new PortableChronoInfo({ chargeDelay: 100 })
    actor = makeActor()
    trait = new PortableChrono(actor, info)
    generator = new PortableChronoOrderGenerator(actor, trait)
  })

  describe('initial state', () => {
    it('stores the actor reference', () => {
      expect(generator.self).toBe(actor)
    })

    it('stores the portableChrono reference', () => {
      expect(generator.portableChrono).toBe(trait)
    })

    it('has actionType ConfirmOrder', () => {
      expect(generator.actionType).toBe('ConfirmOrder')
    })

    it('clearSelectionOnLeftClick is false', () => {
      expect(generator.clearSelectionOnLeftClick).toBe(false)
    })
  })

  describe('orderInner', () => {
    it('returns empty for same cell', () => {
      const orders = generator.orderInner(new CPos(5, 5), false)
      expect(orders).toEqual([])
    })

    it('returns empty when cannot teleport', () => {
      trait.resetChargeTime()
      const orders = generator.orderInner(new CPos(10, 10), false)
      expect(orders).toEqual([])
    })

    it('returns teleport order for valid cell', () => {
      const orders = generator.orderInner(new CPos(10, 10), false)
      expect(orders.length).toBe(1)
      expect(orders[0].orderString).toBe('PortableChronoTeleport')
      expect(orders[0].queued).toBe(false)
    })

    it('returns queued order when shift held', () => {
      const orders = generator.orderInner(new CPos(10, 10), true)
      expect(orders.length).toBe(1)
      expect(orders[0].queued).toBe(true)
    })
  })

  describe('getCursor', () => {
    it('returns targetCursor for valid cell', () => {
      expect(generator.getCursor(new CPos(10, 10))).toBe('chrono-target')
    })

    it('returns targetBlockedCursor for same cell', () => {
      expect(generator.getCursor(new CPos(5, 5))).toBe('move-blocked')
    })

    it('returns targetBlockedCursor when cannot teleport', () => {
      trait.resetChargeTime()
      expect(generator.getCursor(new CPos(10, 10))).toBe('move-blocked')
    })
  })

  describe('selectionChanged', () => {
    it('does not throw', () => {
      expect(() => generator.selectionChanged([actor])).not.toThrow()
      expect(() => generator.selectionChanged([])).not.toThrow()
    })
  })

  describe('tick', () => {
    it('does not throw when trait is enabled', () => {
      expect(() => generator.tick()).not.toThrow()
    })

    it('does not throw when trait is disabled', () => {
      Object.defineProperty(trait, 'isTraitDisabled', { value: true, writable: false })
      expect(() => generator.tick()).not.toThrow()
    })
  })
})
