/**
 * CashTrickler.test.ts — CashTrickler migration unit tests
 *
 * Tests focus on:
 * - CashTricklerInfo defaults (amount=15, interval=50, initialDelay=0,
 *   showTicks=true, displayDuration=30, useResourceStorage=false)
 * - ConditionalTraitInfo compliance (requiresCondition, instanceName)
 * - CashTrickler construction and initial ticks = initialDelay
 * - ITick tick() state machine (enabled, paused, disabled)
 * - tick() decrements ticks and pays cash at correct thresholds
 * - modifyCash behavior tested via tick() with useResourceStorage
 * - onOwnerChanged re-resolves PlayerResources
 * - ConditionalTrait integration (isTraitDisabled, isTraitPaused)
 * - ICashTricklerModifier percentage application
 * - attach/detach lifecycle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CashTrickler, CashTricklerInfo } from './CashTrickler.js'
import type {
  IGameActor,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayerStub(
  overrides: Record<string, unknown> = {},
): PlayerStub & Record<string, unknown> {
  return {
    playerName: 'TestPlayer',
    ...overrides,
  }
}

function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: makePlayerStub(),
    ...overrides,
  } as IGameActor
}

/** Create a mock PlayerResources for testing. */
function createMockPlayerResources(): {
  cash: number
  resources: number
  changeCash: ReturnType<typeof vi.fn>
  giveResources: ReturnType<typeof vi.fn>
} {
  const state = { cash: 1000, resources: 500 }
  return {
    get cash() { return state.cash },
    get resources() { return state.resources },
    changeCash: vi.fn().mockImplementation((amount: number) => {
      state.cash += amount
      return amount
    }),
    giveResources: vi.fn().mockImplementation((amount: number) => {
      const oldResources = state.resources
      state.resources = Math.min(state.resources + amount, 10000) // cap
      return state.resources - oldResources
    }),
  }
}

/** Create an actor with PlayerResources attached. */
function makeActorWithPlayerResources(
  mockPr: ReturnType<typeof createMockPlayerResources>,
  overrides: Record<string, unknown> = {},
): IGameActor {
  const owner = makePlayerStub({
    playerActor: {
      trait: (_name: string) => mockPr,
    },
  })
  return makeMockActor({ owner, ...overrides })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CashTrickler', () => {
  describe('CashTricklerInfo', () => {
    it('has default values', () => {
      const info = new CashTricklerInfo()
      expect(info.amount).toBe(15)
      expect(info.interval).toBe(50)
      expect(info.initialDelay).toBe(0)
      expect(info.showTicks).toBe(true)
      expect(info.displayDuration).toBe(30)
      expect(info.useResourceStorage).toBe(false)
      expect(info.requiresCondition).toBeUndefined()
    })

    it('accepts custom values', () => {
      const info = new CashTricklerInfo({
        amount: 25,
        interval: 100,
        initialDelay: 10,
        showTicks: false,
        displayDuration: 60,
        useResourceStorage: true,
        requiresCondition: '!disabled',
        instanceName: 'test_trickler',
      })
      expect(info.amount).toBe(25)
      expect(info.interval).toBe(100)
      expect(info.initialDelay).toBe(10)
      expect(info.showTicks).toBe(false)
      expect(info.displayDuration).toBe(60)
      expect(info.useResourceStorage).toBe(true)
      expect(info.requiresCondition).toBe('!disabled')
      expect(info.instanceName).toBe('test_trickler')
    })

    it('implements ConditionalTraitInfo', () => {
      const info = new CashTricklerInfo()
      expect('requiresCondition' in info).toBe(true)
      expect('instanceName' in info).toBe(true)
    })

    // -------------------------------------------------------------------
    // validateOnLoad — IRulesetLoaded deferred validation
    // OpenRA 对照: IRulesetLoaded<ActorInfo>.RulesetLoaded()
    // TODO-10.B.4-RULESET: integrate with build-time YAML validation
    // -------------------------------------------------------------------

    describe('validateOnLoad()', () => {
      it('does not throw when ShowTicks is false (no IOccupySpaceInfo needed)', () => {
        const info = new CashTricklerInfo({ showTicks: false })
        expect(() => info.validateOnLoad(new Set())).not.toThrow()
      })

      it('does not throw when ShowTicks is true and IOccupySpaceInfo is present', () => {
        const info = new CashTricklerInfo({ showTicks: true })
        const traitSet = new Set(['IOccupySpaceInfo', 'ITick', 'IRender'])
        expect(() => info.validateOnLoad(traitSet)).not.toThrow()
      })

      it('throws when ShowTicks is true but IOccupySpaceInfo is missing', () => {
        const info = new CashTricklerInfo({ showTicks: true })
        const traitSet = new Set(['ITick', 'IRender', 'IMove'])
        expect(() => info.validateOnLoad(traitSet)).toThrow(
          /CashTrickler is defined with ShowTicks/i,
        )
      })

      it('throws when ShowTicks is true and trait set is empty', () => {
        const info = new CashTricklerInfo({ showTicks: true })
        expect(() => info.validateOnLoad(new Set())).toThrow(
          /CashTrickler is defined with ShowTicks/i,
        )
      })

      it('does not throw for default-constructed info (ShowTicks=true) with IOccupySpaceInfo', () => {
        const info = new CashTricklerInfo() // showTicks defaults to true
        const traitSet = new Set(['IOccupySpaceInfo'])
        expect(() => info.validateOnLoad(traitSet)).not.toThrow()
      })
    })
  })

  describe('CashTrickler trait', () => {
    let info: CashTricklerInfo
    let trait: CashTrickler
    let mockPr: ReturnType<typeof createMockPlayerResources>

    beforeEach(() => {
      info = new CashTricklerInfo()
      trait = new CashTrickler(info)
      mockPr = createMockPlayerResources()
    })

    it('initializes ticks to initialDelay', () => {
      expect(trait.ticks).toBe(0)
    })

    it('initializes ticks to custom initialDelay', () => {
      const delayedInfo = new CashTricklerInfo({ initialDelay: 100 })
      const delayedTrait = new CashTrickler(delayedInfo)
      expect(delayedTrait.ticks).toBe(100)
    })

    it('extends ConditionalTrait', () => {
      expect(trait.enabled).toBe(true)
      expect(trait.disposed).toBe(false)
    })

    it('implements ISync (marker interface for network sync)', () => {
      // ISync is a marker interface — the `ticks` field is the sync data
      // (equivalent to C# [VerifySync] on Ticks).
      // The interface itself has no members; just verify the class is recognized.
      expect(trait).toBeDefined()
      // Verify ticks is a sync-relevant field
      expect(typeof trait.ticks).toBe('number')
    })

    // -----------------------------------------------------------------------
    // ITick tests — cash payment via tick()
    // -----------------------------------------------------------------------

    describe('tick()', () => {
      it('decrements ticks each call', () => {
        const actor = makeActorWithPlayerResources(mockPr)
        trait.attach(actor)
        trait.ticks = 10
        trait.tick(actor)
        expect(trait.ticks).toBe(9)
        trait.tick(actor)
        expect(trait.ticks).toBe(8)
      })

      it('pays cash and resets ticks when ticks reaches -1 (direct cash)', () => {
        const actor = makeActorWithPlayerResources(mockPr)
        trait.attach(actor)
        trait.ticks = 0
        trait.tick(actor)
        expect(trait.ticks).toBe(info.interval)
        expect(mockPr.changeCash).toHaveBeenCalledWith(info.amount)
      })

      it('pays via giveResources when useResourceStorage is true', () => {
        const storageInfo = new CashTricklerInfo({ useResourceStorage: true })
        const storageTrait = new CashTrickler(storageInfo)
        const actor = makeActorWithPlayerResources(mockPr)
        storageTrait.attach(actor)
        mockPr.giveResources.mockClear()
        storageTrait.ticks = 0
        storageTrait.tick(actor)
        expect(mockPr.giveResources).toHaveBeenCalled()
      })

      it('pays cash after initialDelay ticks', () => {
        const delayedInfo = new CashTricklerInfo({ initialDelay: 3, amount: 20 })
        const delayedTrait = new CashTrickler(delayedInfo)
        const actor = makeActorWithPlayerResources(mockPr)
        delayedTrait.attach(actor)

        expect(delayedTrait.ticks).toBe(3)
        delayedTrait.tick(actor) // ticks = 2
        expect(delayedTrait.ticks).toBe(2)
        expect(mockPr.changeCash).not.toHaveBeenCalled()

        delayedTrait.tick(actor) // ticks = 1
        delayedTrait.tick(actor) // ticks = 0
        delayedTrait.tick(actor) // ticks = -1 → pay!
        expect(delayedTrait.ticks).toBe(delayedInfo.interval)
        expect(mockPr.changeCash).toHaveBeenCalledWith(20)
      })

      it('does not pay when trait is disabled', () => {
        const actor = makeActorWithPlayerResources(mockPr)
        trait.attach(actor)
        trait.onEnabledChanged(false) // disable
        trait.ticks = 0
        trait.tick(actor)
        // When disabled, resets ticks but does NOT pay
        expect(trait.ticks).toBe(info.interval)
        expect(mockPr.changeCash).not.toHaveBeenCalled()
      })

      it('does not pay when trait is paused', () => {
        const actor = makeActorWithPlayerResources(mockPr)
        trait.attach(actor)
        // Pause via _paused (PausableConditionalTrait equivalent)
        ;(trait as unknown as { _paused: boolean })._paused = true
        trait.ticks = 0
        trait.tick(actor)
        // When paused, ticks does NOT get reset, and no payment
        expect(trait.ticks).toBe(0)
        expect(mockPr.changeCash).not.toHaveBeenCalled()
      })

      it('resumes counting after unpause', () => {
        const actor = makeActorWithPlayerResources(mockPr)
        trait.attach(actor)
        // Pause
        ;(trait as unknown as { _paused: boolean })._paused = true
        trait.ticks = 5
        trait.tick(actor)
        expect(trait.ticks).toBe(5) // unchanged when paused

        // Unpause
        ;(trait as unknown as { _paused: boolean })._paused = false
        trait.tick(actor)
        expect(trait.ticks).toBe(4) // continues from where it left off
      })

      it('resets ticks when disabled, then counts from interval when re-enabled', () => {
        const actor = makeActorWithPlayerResources(mockPr)
        trait.attach(actor)
        trait.ticks = 3
        trait.onEnabledChanged(false) // disable
        trait.tick(actor)
        expect(trait.ticks).toBe(info.interval) // reset to interval

        // Re-enable
        trait.onEnabledChanged(true)
        trait.tick(actor)
        expect(trait.ticks).toBe(info.interval - 1) // decrements from interval
      })

      it('does nothing when PlayerResources is not resolved', () => {
        const actor = makeMockActor() // no PlayerResources
        trait.attach(actor)
        trait.ticks = 0
        // Should not throw
        expect(() => trait.tick(actor)).not.toThrow()
      })
    })

    // -----------------------------------------------------------------------
    // ICashTricklerModifier tests — via tick()
    // -----------------------------------------------------------------------

    describe('modifier integration', () => {
      it('applies percentage modifiers to cash amount', () => {
        const actor = makeActorWithPlayerResources(mockPr, {
          traitsImplementing: (name: string) => {
            if (name === 'ICashTricklerModifier') {
              return [
                { getCashTricklerModifier: () => 110 }, // 110%
                { getCashTricklerModifier: () => 200 }, // 200%
              ]
            }
            return []
          },
        })
        trait.attach(actor)
        // Amount = 15, modified by 110% and 200%
        // = floor(15 * 110 / 100) * 200 / 100 = floor(16.5) * 2 = 16 * 2 = 32
        trait.ticks = 0
        trait.tick(actor)
        expect(mockPr.changeCash).toHaveBeenCalledWith(32)
      })

      it('handles empty modifiers list', () => {
        const actor = makeActorWithPlayerResources(mockPr)
        trait.attach(actor)
        trait.ticks = 0
        trait.tick(actor)
        expect(mockPr.changeCash).toHaveBeenCalledWith(info.amount)
      })

      it('handles 100% modifier (no change)', () => {
        const actor = makeActorWithPlayerResources(mockPr, {
          traitsImplementing: (name: string) => {
            if (name === 'ICashTricklerModifier') {
              return [{ getCashTricklerModifier: () => 100 }]
            }
            return []
          },
        })
        trait.attach(actor)
        trait.ticks = 0
        trait.tick(actor)
        expect(mockPr.changeCash).toHaveBeenCalledWith(15)
      })

      it('handles 0% modifier (zero cash)', () => {
        const actor = makeActorWithPlayerResources(mockPr, {
          traitsImplementing: (name: string) => {
            if (name === 'ICashTricklerModifier') {
              return [{ getCashTricklerModifier: () => 0 }]
            }
            return []
          },
        })
        trait.attach(actor)
        trait.ticks = 0
        trait.tick(actor)
        expect(mockPr.changeCash).toHaveBeenCalledWith(0)
      })

      it('handles rounding correctly (floor)', () => {
        const actor = makeActorWithPlayerResources(mockPr, {
          traitsImplementing: (name: string) => {
            if (name === 'ICashTricklerModifier') {
              return [{ getCashTricklerModifier: () => 75 }]
            }
            return []
          },
        })
        trait.attach(actor)
        // Amount=15 * 75/100 = 11.25 → floor → 11
        trait.ticks = 0
        trait.tick(actor)
        expect(mockPr.changeCash).toHaveBeenCalledWith(11)
      })
    })

    // -----------------------------------------------------------------------
    // INotifyOwnerChanged tests
    // -----------------------------------------------------------------------

    describe('onOwnerChanged()', () => {
      it('re-resolves PlayerResources from new owner', () => {
        const oldPr = createMockPlayerResources()
        const newPr = createMockPlayerResources()
        newPr.changeCash = vi.fn().mockImplementation((amount: number) => amount)

        const oldOwner = makePlayerStub({
          playerActor: { trait: (_name: string) => oldPr },
        })
        const newOwner = makePlayerStub({
          playerActor: { trait: (_name: string) => newPr },
        })

        const actor = makeMockActor({ owner: oldOwner })
        trait.attach(actor)

        // Verify old PR works via tick
        trait.ticks = 0
        trait.tick(actor)
        expect(oldPr.changeCash).toHaveBeenCalled()

        // Change ownership
        trait.onOwnerChanged(actor, oldOwner, newOwner)

        // Now tick should use new PR
        oldPr.changeCash.mockClear()
        trait.ticks = 0
        trait.tick(actor)
        expect(newPr.changeCash).toHaveBeenCalled()
      })
    })

    // -----------------------------------------------------------------------
    // Lifecycle tests
    // -----------------------------------------------------------------------

    describe('lifecycle', () => {
      it('attach then detach clears references', () => {
        const actor = makeActorWithPlayerResources(mockPr)
        trait.attach(actor)
        expect(trait.actor).toBe(actor)

        trait.detach(actor)
        expect(trait.actor).toBeNull()
      })

      it('dispose clears state', () => {
        trait.dispose()
        expect(trait.disposed).toBe(true)
        expect(trait.actor).toBeNull()
      })
    })

    // -----------------------------------------------------------------------
    // Cloak visibility edge case
    // -----------------------------------------------------------------------

    describe('cloak visibility', () => {
      it('cash is still granted even when all cloaks are invisible', () => {
        const actor = makeActorWithPlayerResources(mockPr, {
          world: { renderPlayer: null },
        })
        // Manually inject cloak-like traits that make the actor invisible
        // Cash should still be granted; only floating text is suppressed.
        ;(trait as unknown as { _cloaks: { isVisible: () => boolean }[] })._cloaks = [
          { isVisible: () => false },
        ]
        trait.attach(actor)
        trait.ticks = 0
        trait.tick(actor)
        // Cash granted (cloak only suppresses floating text, not cash)
        expect(mockPr.changeCash).toHaveBeenCalled()
      })
    })
  })
})
