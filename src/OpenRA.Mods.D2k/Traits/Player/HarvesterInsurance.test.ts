/**
 * HarvesterInsurance.test.ts — HarvesterInsurance migration unit tests
 *
 * Tests focus on: TryActivate logic, harvester detection, refinery selection,
 * delivery delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  HarvesterInsurance,
  HarvesterInsuranceInfo,
  type IHarvesterLike,
  type IRefineryLike,
} from './HarvesterInsurance.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 1,
    owner: { playerId: 0, playerName: 'Test' },
    world: {} as unknown as IGameActor['world'],
    centerPosition: { X: 0, Y: 0, Z: 0 },
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarvesterInsurance', () => {
  let self: IGameActor

  beforeEach(() => {
    self = createMockActor()
  })

  describe('HarvesterInsuranceInfo', () => {
    it('creates HarvesterInsurance instance', () => {
      const info = new HarvesterInsuranceInfo()
      const insurance = info.create({ self })
      expect(insurance).toBeInstanceOf(HarvesterInsurance)
      expect(insurance.self).toBe(self)
    })

    it('accepts instanceName', () => {
      const info = new HarvesterInsuranceInfo({ instanceName: 'test' })
      expect(info.instanceName).toBe('test')
    })
  })

  describe('tryActivate', () => {
    it('does nothing when actorsHavingTrait is not available', () => {
      const insurance = new HarvesterInsurance(self)
      expect(() => insurance.tryActivate()).not.toThrow()
    })

    it('skips when player has existing harvesters', () => {
      const mockHarvester = {
        actorId: 10,
        isInWorld: true,
        isDead: false,
        disposed: false,
        generation: 1,
        owner: self.owner,
        centerPosition: { X: 0, Y: 0, Z: 0 } as const,
        info: { name: 'harvester' },
      } as unknown as IGameActor & IHarvesterLike

      const selfWithWorld = {
        ...self,
        world: {
          actorsHavingTrait: vi.fn((_trait: string) => [mockHarvester]),
        },
      } as unknown as IGameActor

      const insurance = new HarvesterInsurance(selfWithWorld)
      insurance.tryActivate()
      // Should not have called any delivery
    })

    it('does delivery when no harvesters exist and refinery has FreeActorWithDelivery', () => {
      const doDelivery = vi.fn()
      const mockRefinery = {
        actorId: 20,
        isInWorld: true,
        isDead: false,
        disposed: false,
        generation: 1,
        owner: self.owner,
        centerPosition: { X: 0, Y: 0, Z: 0 } as const,
        info: {
          hasTraitInfo: vi.fn((name: string) => name === 'FreeActorWithDelivery'),
        },
        location: { X: 5, Y: 10 },
        trait: vi.fn((_name: string) => ({
          info: {
            actor: 'harvester',
            deliveringActor: 'carryall',
            deliveryOffset: { X: 1, Y: 2 },
          },
          doDelivery,
        })),
      } as unknown as IGameActor & IRefineryLike

      const selfWithWorld = {
        ...self,
        world: {
          actorsHavingTrait: vi.fn((traitName: string) => {
            if (traitName === 'Harvester') return [] // No harvesters
            if (traitName === 'Refinery') return [mockRefinery]
            return []
          }),
        },
      } as unknown as IGameActor

      const insurance = new HarvesterInsurance(selfWithWorld)
      insurance.tryActivate()

      expect(doDelivery).toHaveBeenCalledWith(
        { X: 6, Y: 12 }, // location + deliveryOffset
        'harvester',
        'carryall',
      )
    })

    it('skips refinery without FreeActorWithDelivery', () => {
      const mockRefinery = {
        actorId: 20,
        isInWorld: true,
        isDead: false,
        disposed: false,
        generation: 1,
        owner: self.owner,
        centerPosition: { X: 0, Y: 0, Z: 0 } as const,
        info: {
          hasTraitInfo: vi.fn(() => false),
        },
      } as unknown as IGameActor & IRefineryLike

      const selfWithWorld = {
        ...self,
        world: {
          actorsHavingTrait: vi.fn((traitName: string) => {
            if (traitName === 'Harvester') return []
            if (traitName === 'Refinery') return [mockRefinery]
            return []
          }),
        },
      } as unknown as IGameActor

      const insurance = new HarvesterInsurance(selfWithWorld)
      expect(() => insurance.tryActivate()).not.toThrow()
    })

    it('skips refinery not owned by player', () => {
      const mockRefinery = {
        actorId: 20,
        isInWorld: true,
        isDead: false,
        disposed: false,
        generation: 1,
        owner: { playerId: 1, playerName: 'Enemy' },
        centerPosition: { X: 0, Y: 0, Z: 0 } as const,
        info: { hasTraitInfo: vi.fn(() => true) },
      } as unknown as IGameActor & IRefineryLike

      const selfWithWorld = {
        ...self,
        world: {
          actorsHavingTrait: vi.fn((traitName: string) => {
            if (traitName === 'Harvester') return []
            if (traitName === 'Refinery') return [mockRefinery]
            return []
          }),
        },
      } as unknown as IGameActor

      const insurance = new HarvesterInsurance(selfWithWorld)
      expect(() => insurance.tryActivate()).not.toThrow()
    })
  })

  describe('constructor', () => {
    it('stores self reference', () => {
      const insurance = new HarvesterInsurance(self)
      expect(insurance.self).toBe(self)
    })
  })
})
