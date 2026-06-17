/**
 * ConyardChronoReturn.test.ts — unit tests for construction yard chrono-return
 *
 * Tests focus on: state management, return timer lifecycle, INotifySold,
 * ISelectionBar values, vortex trigger, and return-to-origin logic.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ConyardChronoReturnInfo, ConyardChronoReturn } from './ConyardChronoReturn.js'
import type { IGameActor, ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(name: string = 'conyard'): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name },
    
  }
}


// ---------------------------------------------------------------------------
// ConyardChronoReturnInfo
// ---------------------------------------------------------------------------

describe('ConyardChronoReturnInfo', () => {
  describe('defaults', () => {
    const info = new ConyardChronoReturnInfo()

    it('has default condition of null', () => {
      expect(info.condition).toBeNull()
    })

    it('has default damage of 1000', () => {
      expect(info.damage).toBe(1000)
    })

    it('has default originalActor of "mcv"', () => {
      expect(info.originalActor).toBe('mcv')
    })

    it('has default facing of 384', () => {
      expect(info.facing).toBe(384)
    })

    it('has default chronoshiftSound of "chrono2.aud"', () => {
      expect(info.chronoshiftSound).toBe('chrono2.aud')
    })

    it('has empty damageTypes', () => {
      expect(info.damageTypes).toEqual([])
    })

    it('has null returnOriginalActorOnCondition', () => {
      expect(info.returnOriginalActorOnCondition).toBeNull()
    })
  })

  describe('custom params', () => {
    it('accepts custom damage', () => {
      const info = new ConyardChronoReturnInfo({ damage: 500 })
      expect(info.damage).toBe(500)
    })

    it('accepts custom originalActor', () => {
      const info = new ConyardChronoReturnInfo({ originalActor: 'mcv.alt' })
      expect(info.originalActor).toBe('mcv.alt')
    })

    it('accepts custom condition', () => {
      const info = new ConyardChronoReturnInfo({ condition: 'vortex' })
      expect(info.condition).toBe('vortex')
    })
  })

  describe('create', () => {
    it('creates a ConyardChronoReturn instance', () => {
      const info = new ConyardChronoReturnInfo()
      const actor = makeActor()
      const trait = info.create(actor)
      expect(trait).toBeInstanceOf(ConyardChronoReturn)
    })
  })
})

// ---------------------------------------------------------------------------
// ConyardChronoReturn
// ---------------------------------------------------------------------------

describe('ConyardChronoReturn', () => {
  let info: ConyardChronoReturnInfo
  let trait: ConyardChronoReturn
  let actor: IGameActor

  beforeEach(() => {
    info = new ConyardChronoReturnInfo({ condition: 'vortex', originalActor: 'mcv' })
    actor = makeActor()
    trait = new ConyardChronoReturn(actor, info)
  })

  describe('initial state', () => {
    it('has zero returnTicks', () => {
      expect(trait.returnTicks).toBe(0)
    })

    it('has CPos.Zero origin', () => {
      expect(trait.origin.Bits).toBe(CPos.Zero.Bits)
    })

    it('is not triggered', () => {
      expect(trait.triggered).toBe(false)
    })

    it('is not selling', () => {
      expect(trait.isSelling).toBe(false)
    })

    it('is not returning original', () => {
      expect(trait.returnOriginal).toBe(false)
    })

    it('has no chronosphere', () => {
      expect(trait.chronosphere).toBeNull()
    })

    it('displayWhenEmpty is false', () => {
      expect(trait.displayWhenEmpty).toBe(false)
    })

    it('stores info reference', () => {
      expect(trait.info).toBe(info)
    })
  })

  // -----------------------------------------------------------------------
  // INotifySold
  // -----------------------------------------------------------------------

  describe('selling / sold (INotifySold)', () => {
    it('selling() sets selling to true', () => {
      trait.selling(actor)
      expect(trait.isSelling).toBe(true)
    })

    it('sold() is a no-op (flag already set)', () => {
      trait.selling(actor)
      expect(trait.isSelling).toBe(true)
      trait.sold(actor)
      expect(trait.isSelling).toBe(true)
    })

    it('setSelling changes the flag', () => {
      trait.setSelling(true)
      expect(trait.isSelling).toBe(true)
      trait.setSelling(false)
      expect(trait.isSelling).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // triggerVortex
  // -----------------------------------------------------------------------

  describe('triggerVortex()', () => {
    it('sets triggered to true', () => {
      trait.triggerVortex()
      expect(trait.triggered).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // ISelectionBar
  // -----------------------------------------------------------------------

  describe('getValue (ISelectionBar)', () => {
    it('returns 0 when returnTicks is 0', () => {
      expect(trait.getValue()).toBe(0)
    })

    it('returns ratio of remaining to total duration', () => {
      trait.setReturnState(25, 100, CPos.Zero, null)
      expect(trait.getValue()).toBeCloseTo(0.25, 5)
    })
  })

  describe('getColor (ISelectionBar)', () => {
    it('returns the configured timeBarColor', () => {
      const color: ColorStub = { r: 255, g: 0, b: 0, a: 255 }
      const coloredInfo = new ConyardChronoReturnInfo({ timeBarColor: color })
      const coloredTrait = new ConyardChronoReturn(actor, coloredInfo)
      const resultColor = coloredTrait.getColor(); expect(resultColor.r).toBe(255); expect(resultColor.g).toBe(0); expect(resultColor.b).toBe(0); expect(resultColor.a).toBe(255)
    })

    it('returns white by default', () => {
      const defColor = trait.getColor(); expect(defColor.r).toBe(255); expect(defColor.g).toBe(255); expect(defColor.b).toBe(255); expect(defColor.a).toBe(255)
    })
  })

  // -----------------------------------------------------------------------
  // tick()
  // -----------------------------------------------------------------------

  describe('tick()', () => {
    it('does nothing when disposed', () => {
      const disposedActor = { ...actor, disposed: true }
      trait.setReturnState(10, 100, CPos.Zero, null)
      trait.tick(disposedActor)
      expect(trait.returnTicks).toBe(10) // unchanged
    })

    it('decrements returnTicks', () => {
      trait.setReturnState(10, 100, CPos.Zero, null)
      trait.tick(actor)
      expect(trait.returnTicks).toBe(9)
    })

    it('does not decrement below zero', () => {
      trait.setReturnState(0, 100, CPos.Zero, null)
      trait.tick(actor)
      expect(trait.returnTicks).toBe(0)
    })

    it('triggers vortex when timer expires and not returning original', () => {
      trait.setReturnState(1, 100, CPos.Zero, null)
      trait.setReturnOriginal(false)
      trait.tick(actor)
      // returnTicks goes to 0, triggered should be true (vortex triggered)
      expect(trait.triggered).toBe(true)
    })

    it('does not trigger vortex when returning original', () => {
      trait.setReturnState(1, 100, CPos.Zero, null)
      trait.setReturnOriginal(true)
      trait.setSelling(false)
      trait.tick(actor)
      // Should return to origin instead of triggering vortex
      expect(trait.triggered).toBe(false)
    })

    it('triggers vortex when returning original but selling', () => {
      trait.setReturnState(1, 100, CPos.Zero, null)
      trait.setReturnOriginal(true)
      trait.setSelling(true)
      trait.tick(actor)
      // Selling overrides return-to-origin — vortex is triggered
      expect(trait.triggered).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // setReturnState
  // -----------------------------------------------------------------------

  describe('setReturnState', () => {
    it('sets all return state fields', () => {
      const origin = new CPos(5, 10)
      trait.setReturnState(50, 200, origin, null)
      expect(trait.returnTicks).toBe(50)
      expect(trait.duration).toBe(200)
      expect(trait.origin.Bits).toBe(origin.Bits)
      expect(trait.chronosphere).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // changeBestDestinationCell
  // -----------------------------------------------------------------------

  describe('chooseBestDestinationCell', () => {
    it('returns the destination by default (stub)', () => {
      const dest = new CPos(10, 20)
      const result = trait.chooseBestDestinationCell(dest)
      expect(result).not.toBeNull()
      expect(result!.Bits).toBe(dest.Bits)
    })
  })

  // -----------------------------------------------------------------------
  // getVariableObservers
  // -----------------------------------------------------------------------

  describe('getVariableObservers', () => {
    it('returns empty array when no condition expression', () => {
      expect(trait.getVariableObservers()).toEqual([])
    })

    it('returns observers when condition expression is set', () => {
      const mockExpression = {
        variables: ['lowPower'],
        evaluate: () => true,
      }
      const exprInfo = new ConyardChronoReturnInfo({
        returnOriginalActorOnCondition: mockExpression,
      })
      const exprTrait = new ConyardChronoReturn(actor, exprInfo)
      const observers = exprTrait.getVariableObservers()
      expect(observers.length).toBe(1)
      expect(observers[0].variables).toEqual(['lowPower'])
    })
  })

  // -----------------------------------------------------------------------
  // createReturnInit
  // -----------------------------------------------------------------------

  describe('createReturnInit', () => {
    it('returns null when returnTicks is 0', () => {
      expect(trait.createReturnInit()).toBeNull()
    })

    it('returns null (stub) when returnTicks > 0 (delegated to runtime)', () => {
      // NOTE: createReturnInit is stubbed until ChronoshiftReturnInit integration
      // is wired at runtime. The method correctly guards on returnTicks <= 0.
      trait.setReturnState(30, 60, new CPos(3, 4), null)
      const init = trait.createReturnInit()
      expect(init).toBeNull() // stub returns null
    })
  })
})
