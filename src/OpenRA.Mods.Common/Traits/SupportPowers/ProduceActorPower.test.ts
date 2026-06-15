/**
 * ProduceActorPower.test.ts — ProduceActorPower 单元测试
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: configuration, producer discovery, activation logic, audio stubs.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  ProduceActorPower,
  type ProduceActorPowerInfo,
  type IProduction,
} from './ProduceActorPower.js'
import type { ISupportPowerManager } from './SupportPower.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: Partial<IGameActor> = {}): IGameActor {
  const impls: Record<string, unknown[]> = {}
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disabled: false,
    disposed: false,
    owner: undefined,
    world: undefined,
    traitsImplementing(interfaceId: string): unknown[] {
      return impls[interfaceId] ?? []
    },
    _impls: impls,
    ...overrides,
  } as IGameActor & { _impls: Record<string, unknown[]> }
}

function createMockManager(overrides: Partial<ISupportPowerManager> = {}): ISupportPowerManager {
  const powers = new Map()
  return {
    self: createMockActor(),
    powers,
    ...overrides,
  }
}

function makeInfo(overrides: Partial<ProduceActorPowerInfo> = {}): ProduceActorPowerInfo {
  return {
    orderName: 'ProduceActorPowerOrder',
    chargeInterval: 1000,
    actors: ['e1', 'e2'],
    type: 'Infantry',
    readyAudio: 'ready',
    readyTextNotification: 'Reinforcements ready',
    blockedAudio: 'blocked',
    blockedTextNotification: 'Unable to build',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test subclasses
// ---------------------------------------------------------------------------

class TestProduceActorPower extends ProduceActorPower {
  public testFindProducers(self: IGameActor): { actor: IGameActor; trait: IProduction }[] {
    return this._findProducers(self)
  }

  public testCreateInits(self: IGameActor): Map<string, unknown> {
    return this._createInits(self)
  }

  // Override to intercept _directActivate
  public directActivateCalled = false
  override selectTarget(
    self: IGameActor,
    _order: string,
    manager: ISupportPowerManager,
  ): void {
    this.directActivateCalled = true
    super.selectTarget(self, _order, manager)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProduceActorPower', () => {
  describe('constructor', () => {
    it('stores info and faction', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new ProduceActorPower(actor, info, 'allies')

      expect(power.info).toBe(info)
      expect(power.faction).toBe('allies')
    })

    it('defaults faction to empty string', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new ProduceActorPower(actor, info)

      expect(power.faction).toBe('')
    })

    it('sets self from constructor', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42 })
      const power = new ProduceActorPower(actor, info)

      expect(power.self).toBe(actor)
    })
  })

  describe('selectTarget', () => {
    it('calls _directActivate without target selection', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const manager = createMockManager()
      const power = new TestProduceActorPower(actor, info)

      power.selectTarget(actor, 'ProduceActorPowerOrder', manager)

      expect(power.directActivateCalled).toBe(true)
    })
  })

  describe('activate', () => {
    it('calls super.activate and playLaunchSounds', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const manager = createMockManager()
      const power = new TestProduceActorPower(actor, info)

      // Spy on playLaunchSounds
      const launchSpy = vi.spyOn(power, 'playLaunchSounds')

      const mockOrder = { orderName: 'ProduceActorPowerOrder' }
      power.activate(actor, mockOrder, manager)

      expect(launchSpy).toHaveBeenCalled()
    })

    it('plays blocked audio when no producers available', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const manager = createMockManager()
      const power = new TestProduceActorPower(actor, info)

      const playSoundSpy = vi.spyOn(power as any, 'playPowerSound')
      const addTextSpy = vi.spyOn(power as any, 'addTextNotification')

      const mockOrder = { orderName: 'ProduceActorPowerOrder' }
      power.activate(actor, mockOrder, manager)

      // Should play blocked audio since no producers exist
      expect(playSoundSpy).toHaveBeenCalledWith(actor, 'blocked', 'blocked')
      expect(addTextSpy).toHaveBeenCalledWith(actor, 'Unable to build')
    })

    it('plays ready audio when production succeeds', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 1 })
      const manager = createMockManager()

      const power = new (class extends TestProduceActorPower {
        override _findProducers(_self: IGameActor) {
          const mockProd: IProduction = {
            info: { produces: new Set(['Infantry']) },
            isTraitDisabled: false,
            isTraitPaused: false,
            produce: () => true,
          }
          return [{ actor: createMockActor({ actorId: 100 }), trait: mockProd }]
        }
      })(actor, info)

      const playSoundSpy = vi.spyOn(power as any, 'playPowerSound')
      const addTextSpy = vi.spyOn(power as any, 'addTextNotification')

      const mockOrder = { orderName: 'ProduceActorPowerOrder' }
      power.activate(actor, mockOrder, manager)

      expect(playSoundSpy).toHaveBeenCalledWith(actor, 'ready', 'ready')
      expect(addTextSpy).toHaveBeenCalledWith(actor, 'Reinforcements ready')
    })
  })

  describe('_findProducers', () => {
    it('returns empty array when no world actors', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestProduceActorPower(actor, info)

      const result = power.testFindProducers(actor)
      expect(result).toEqual([])
    })

    it('sorts primary buildings first', () => {
      const info = makeInfo()
      const actor = createMockActor({
        actorId: 1,
        owner: { playerName: 'test' },
        world: { getActors: () => [] } as any,
      })

      const primaryActor = createMockActor({ actorId: 200, owner: actor.owner })
      const secondaryActor = createMockActor({ actorId: 100, owner: actor.owner })

      const mockPrimary: IProduction = {
        info: { produces: new Set(['Infantry']) },
        isTraitDisabled: false,
        isTraitPaused: false,
        produce: () => true,
      }

      const mockSecondary: IProduction = {
        info: { produces: new Set(['Infantry']) },
        isTraitDisabled: false,
        isTraitPaused: false,
        produce: () => true,
      }

      const power = new (class extends TestProduceActorPower {
        override _getWorldActors(_self: IGameActor) {
          return [secondaryActor, primaryActor]
        }
        override _getProductionTrait(act: IGameActor) {
          if (act === primaryActor) return mockPrimary
          if (act === secondaryActor) return mockSecondary
          return null
        }
        override _isPrimaryBuilding(act: IGameActor) {
          return act === primaryActor
        }
      })(actor, info)

      const result = power.testFindProducers(actor)
      expect(result.length).toBe(2)
    })
  })

  describe('_createInits', () => {
    it('creates inits map with OwnerInit and FactionInit', () => {
      const info = makeInfo()
      const owner = { playerName: 'test' }
      const actor = createMockActor({ owner })
      const power = new TestProduceActorPower(actor, info, 'allies')

      const inits = power.testCreateInits(actor)
      expect(inits.get('OwnerInit')).toBe(owner)
      expect(inits.get('FactionInit')).toBe('allies')
    })
  })
})
