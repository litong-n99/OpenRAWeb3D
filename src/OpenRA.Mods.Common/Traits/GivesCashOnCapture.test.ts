/**
 * GivesCashOnCapture.test.ts — GivesCashOnCapture migration unit tests
 *
 * Tests focus on: GivesCashOnCaptureInfo defaults, ConditionalTrait behavior,
 * onCapture() cash grant to new owner, CaptureTypes filtering, trait-disabled guard,
 * showTicks floating text stub, _grantCash via duck-typing fallbacks,
 * and edge cases (zero amount, missing playerActor, numeric captureTypes bitmask).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  GivesCashOnCapture,
  GivesCashOnCaptureInfo,
} from './GivesCashOnCapture.js'
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

/** Make a BitSet stub with overlaps. */
function makeBitSetStub(overlapsResult: boolean, isEmpty = false): {
  isEmpty: boolean
  overlaps(_other: unknown): boolean
} {
  return {
    isEmpty,
    overlaps: vi.fn().mockReturnValue(overlapsResult),
  }
}

/** Make a newOwner with playerActor for _grantCash. */
function makeNewOwnerWithResources(
  changeCashFn: (amount: number) => number = vi.fn().mockReturnValue(100),
): Record<string, unknown> {
  const playerActor = {
    trait: vi.fn().mockReturnValue({ changeCash: changeCashFn }),
  }
  return {
    playerName: 'NewOwner',
    playerActor,
  } as unknown as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GivesCashOnCapture', () => {
  describe('GivesCashOnCaptureInfo', () => {
    it('has ShowTicks default of true', () => {
      const info = new GivesCashOnCaptureInfo()
      expect(info.showTicks).toBe(true)
    })

    it('has DisplayDuration default of 30', () => {
      const info = new GivesCashOnCaptureInfo()
      expect(info.displayDuration).toBe(30)
    })

    it('has Amount default of 0', () => {
      const info = new GivesCashOnCaptureInfo()
      expect(info.amount).toBe(0)
    })

    it('has CaptureTypes default empty', () => {
      const info = new GivesCashOnCaptureInfo()
      expect(info.captureTypes.isEmpty).toBe(true)
    })

    it('implements ConditionalTraitInfo', () => {
      const info = new GivesCashOnCaptureInfo({ requiresCondition: '!disabled' })
      expect(info.requiresCondition).toBe('!disabled')
      expect('instanceName' in info).toBe(true)
    })

    it('accepts custom showTicks', () => {
      const info = new GivesCashOnCaptureInfo({ showTicks: false })
      expect(info.showTicks).toBe(false)
    })

    it('accepts custom displayDuration', () => {
      const info = new GivesCashOnCaptureInfo({ displayDuration: 60 })
      expect(info.displayDuration).toBe(60)
    })

    it('accepts custom amount', () => {
      const info = new GivesCashOnCaptureInfo({ amount: 500 })
      expect(info.amount).toBe(500)
    })

    it('accepts custom captureTypes', () => {
      const customCT = makeBitSetStub(true, false)
      const info = new GivesCashOnCaptureInfo({ captureTypes: customCT })
      expect(info.captureTypes.isEmpty).toBe(false)
    })
  })

  describe('GivesCashOnCapture trait', () => {
    let info: GivesCashOnCaptureInfo
    let trait: GivesCashOnCapture

    beforeEach(() => {
      info = new GivesCashOnCaptureInfo({ amount: 500 })
      trait = new GivesCashOnCapture(info)
    })

    it('is a ConditionalTrait', () => {
      expect(trait.isTraitDisabled).toBe(false)
      expect(trait.info).toBe(info)
    })

    describe('onCapture() — basic flow', () => {
      it('grants cash to new owner on capture', () => {
        const changeCash = vi.fn().mockReturnValue(500)
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })
        const oldOwner = makePlayerStub()

        trait.onCapture(self, captor, oldOwner, newOwner, 1)

        // Verify trait was called
        const playerActor = (newOwner as Record<string, unknown>).playerActor as {
          trait: ReturnType<typeof vi.fn>
        }
        expect(playerActor.trait).toHaveBeenCalledWith('PlayerResources')
        expect(changeCash).toHaveBeenCalledWith(500)
      })

      it('grants cash with different amounts', () => {
        const bigInfo = new GivesCashOnCaptureInfo({ amount: 2000 })
        const bigTrait = new GivesCashOnCapture(bigInfo)
        const changeCash = vi.fn().mockReturnValue(2000)
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        bigTrait.onCapture(self, captor, makePlayerStub(), newOwner, 1)
        expect(changeCash).toHaveBeenCalledWith(2000)
      })
    })

    describe('onCapture() — guard conditions', () => {
      it('does nothing when trait is disabled', () => {
        const changeCash = vi.fn()
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        trait['_enabled'] = false
        trait.onCapture(self, captor, makePlayerStub(), newOwner, 1)
        expect(changeCash).not.toHaveBeenCalled()

        trait['_enabled'] = true
      })

      it('does nothing when amount is 0', () => {
        const zeroInfo = new GivesCashOnCaptureInfo({ amount: 0 })
        const zeroTrait = new GivesCashOnCapture(zeroInfo)
        const changeCash = vi.fn()
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        zeroTrait.onCapture(self, captor, makePlayerStub(), newOwner, 1)
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('does nothing when amount is negative', () => {
        const negInfo = new GivesCashOnCaptureInfo({ amount: -100 })
        const negTrait = new GivesCashOnCapture(negInfo)
        const changeCash = vi.fn()
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        negTrait.onCapture(self, captor, makePlayerStub(), newOwner, 1)
        expect(changeCash).not.toHaveBeenCalled()
      })
    })

    describe('onCapture() — CaptureTypes filtering', () => {
      it('grants when captureTypes is empty (all types)', () => {
        const changeCash = vi.fn().mockReturnValue(300)
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        trait.onCapture(self, captor, makePlayerStub(), newOwner, { overlaps: vi.fn().mockReturnValue(false) })
        expect(changeCash).toHaveBeenCalledWith(500)
      })

      it('skips when captureTypes do not overlap', () => {
        const nonOverlapCaptureTypes = makeBitSetStub(false, false)
        const filterInfo = new GivesCashOnCaptureInfo({
          amount: 500,
          captureTypes: nonOverlapCaptureTypes,
        })
        const filterTrait = new GivesCashOnCapture(filterInfo)
        const changeCash = vi.fn()
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        filterTrait.onCapture(self, captor, makePlayerStub(), newOwner, { overlaps: vi.fn().mockReturnValue(false) })
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('grants when captureTypes overlap', () => {
        const overlapCaptureTypes = makeBitSetStub(true, false)
        const filterInfo = new GivesCashOnCaptureInfo({
          amount: 500,
          captureTypes: overlapCaptureTypes,
        })
        const filterTrait = new GivesCashOnCapture(filterInfo)
        const changeCash = vi.fn().mockReturnValue(500)
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        filterTrait.onCapture(self, captor, makePlayerStub(), newOwner, { overlaps: vi.fn().mockReturnValue(true) })
        expect(changeCash).toHaveBeenCalledWith(500)
      })

      it('skips when captureTypes is numeric 0 (no types)', () => {
        const nonEmptyCT = new GivesCashOnCaptureInfo({
          amount: 500,
          captureTypes: makeBitSetStub(true, false),
        })
        const ctTrait = new GivesCashOnCapture(nonEmptyCT)
        const changeCash = vi.fn()
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        ctTrait.onCapture(self, captor, makePlayerStub(), newOwner, 0)
        expect(changeCash).not.toHaveBeenCalled()
      })

      it('grants when captureTypes is numeric non-zero', () => {
        const nonEmptyCT = new GivesCashOnCaptureInfo({
          amount: 500,
          captureTypes: makeBitSetStub(true, false),
        })
        const ctTrait = new GivesCashOnCapture(nonEmptyCT)
        const changeCash = vi.fn().mockReturnValue(500)
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        ctTrait.onCapture(self, captor, makePlayerStub(), newOwner, 5)
        expect(changeCash).toHaveBeenCalledWith(500)
      })
    })

    describe('onCapture() — _grantCash fallbacks', () => {
      it('uses changeCash directly on playerActor if trait() is not available', () => {
        const changeCash = vi.fn().mockReturnValue(500)
        const newOwner = {
          playerName: 'NewOwner',
          playerActor: {
            changeCash,
          },
        } as unknown as Record<string, unknown>

        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        trait.onCapture(self, captor, makePlayerStub(), newOwner, 1)
        expect(changeCash).toHaveBeenCalledWith(500)
      })

      it('does nothing when newOwner has no playerActor', () => {
        const newOwner = { playerName: 'NoPlayerActor' } as unknown as Record<string, unknown>
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        // Should not throw
        expect(() => trait.onCapture(self, captor, makePlayerStub(), newOwner, 1)).not.toThrow()
      })

      it('does nothing when playerActor is null', () => {
        const newOwner = {
          playerName: 'NullPlayerActor',
          playerActor: null,
        } as unknown as Record<string, unknown>

        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        expect(() => trait.onCapture(self, captor, makePlayerStub(), newOwner, 1)).not.toThrow()
      })
    })

    describe('showTicks flag', () => {
      it('does not throw when showTicks is true (floating text stubbed)', () => {
        const showInfo = new GivesCashOnCaptureInfo({ amount: 500, showTicks: true })
        const showTrait = new GivesCashOnCapture(showInfo)
        const changeCash = vi.fn().mockReturnValue(500)
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        expect(() => showTrait.onCapture(self, captor, makePlayerStub(), newOwner, 1)).not.toThrow()
        expect(changeCash).toHaveBeenCalledWith(500)
      })

      it('still grants cash when showTicks is false', () => {
        const noShowInfo = new GivesCashOnCaptureInfo({ amount: 500, showTicks: false })
        const noShowTrait = new GivesCashOnCapture(noShowInfo)
        const changeCash = vi.fn().mockReturnValue(500)
        const newOwner = makeNewOwnerWithResources(changeCash)
        const self = makeMockActor()
        const captor = makeMockActor({ actorId: 2 })

        noShowTrait.onCapture(self, captor, makePlayerStub(), newOwner, 1)
        expect(changeCash).toHaveBeenCalledWith(500)
      })
    })

    describe('Component lifecycle', () => {
      it('dispose clears state', () => {
        trait.dispose()
        expect(trait.disposed).toBe(true)
        expect(trait.actor).toBeNull()
      })

      it('isTraitDisabled reflects enabled state', () => {
        expect(trait.isTraitDisabled).toBe(false)
        trait['_enabled'] = false
        expect(trait.isTraitDisabled).toBe(true)
        trait['_enabled'] = true
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Edge case: onCapture() with various newOwner shapes
  // ---------------------------------------------------------------------------

  describe('onCapture() — edge cases', () => {
    it('handles newOwner as PlayerStub without playerActor gracefully', () => {
      const info = new GivesCashOnCaptureInfo({ amount: 500 })
      const trait = new GivesCashOnCapture(info)
      const self = makeMockActor()
      const captor = makeMockActor({ actorId: 2 })

      // newOwner is a simple PlayerStub with no playerActor
      const newOwner = makePlayerStub({ playerName: 'SimpleOwner' })
      expect(() =>
        trait.onCapture(self, captor, makePlayerStub(), newOwner, 1),
      ).not.toThrow()
    })

    it('handles oldOwner as null/undefined', () => {
      const capInfo = new GivesCashOnCaptureInfo({ amount: 500 })
      const capTrait = new GivesCashOnCapture(capInfo)
      const changeCash = vi.fn().mockReturnValue(500)
      const newOwner = makeNewOwnerWithResources(changeCash)
      const self = makeMockActor()
      const captor = makeMockActor({ actorId: 2 })

      expect(() =>
        capTrait.onCapture(self, captor, null, newOwner, 1),
      ).not.toThrow()
      expect(changeCash).toHaveBeenCalledWith(500)
    })
  })
})
