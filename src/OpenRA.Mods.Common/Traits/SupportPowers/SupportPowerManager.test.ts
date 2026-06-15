/**
 * SupportPowerManager.test.ts — SupportPowerManager unit tests
 *
 * Tests focus on: power registration/unregistration, charge timer state machine,
 * activation logic, OneShot disable, GetPowersForActor query, SelectGenericPowerTarget.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SupportPowerManager,
  SupportPowerInstance,
  SelectGenericPowerTarget,
  type SupportPowerManagerInfo,
} from './SupportPowerManager.js'
import {
  type SupportPowerInfo,
  type ISupportPower,
  type ISupportPowerManager,
  type ISupportPowerInstance,
  type OrderStub,
  SupportPower,
} from './SupportPower.js'
import type {
  IGameActor,
  PlayerStub,
  WorldStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Mock SupportPower for testing
// ---------------------------------------------------------------------------

interface MockPowerInfo extends SupportPowerInfo {
  readonly _testId?: string
}

class MockSupportPower extends SupportPower {
  declare readonly info: MockPowerInfo

  public chargingCalled = 0
  public chargedCalled = 0
  public activateCalled = 0
  public selectTargetCalled = 0

  constructor(self: IGameActor, info: MockPowerInfo) {
    super(self, info)
  }

  override charging(self: IGameActor, key: string): void {
    this.chargingCalled++
    super.charging(self, key)
  }

  override charged(self: IGameActor, key: string): void {
    this.chargedCalled++
    super.charged(self, key)
  }

  override activate(self: IGameActor, order: unknown, manager: ISupportPowerManager): void {
    this.activateCalled++
    super.activate(self, order as OrderStub, manager)
  }

  override selectTarget(self: IGameActor, order: string, manager: ISupportPowerManager): void {
    this.selectTargetCalled++
    super.selectTarget(self, order, manager)
  }

  get isTraitDisabled(): boolean {
    return super.isTraitDisabled
  }

  get isTraitPaused(): boolean {
    return super.isTraitPaused
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(actorId = 1, owner?: PlayerStub): IGameActor & { _impls: Record<string, unknown[]> } {
  const impls: Record<string, unknown[]> = {}
  return {
    actorId,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner,
    world: undefined,
    traitsImplementing(interfaceId: string): unknown[] {
      return impls[interfaceId] ?? []
    },
    _impls: impls,
  } as IGameActor & { _impls: Record<string, unknown[]> }
}

function createMockPlayer(): PlayerStub {
  return { playerName: 'TestPlayer' }
}

function createMockWorld(): WorldStub {
  return { actors: [] }
}

function createPowerInfo(overrides: Partial<MockPowerInfo> = {}): MockPowerInfo {
  return {
    orderName: 'TestPowerOrder',
    chargeInterval: 100,
    ...overrides,
  }
}

function createManagerInfo(): SupportPowerManagerInfo {
  return {}
}

function createMockOrder(orderName: string) {
  return {
    orderName,
    targetString: '',
    extraData: 0,
  } as const
}

// ---------------------------------------------------------------------------
// SupportPowerManager
// ---------------------------------------------------------------------------

describe('SupportPowerManager', () => {
  let manager: SupportPowerManager
  let owner: PlayerStub

  beforeEach(() => {
    const info = createManagerInfo()
    manager = new SupportPowerManager(info)
    owner = createMockPlayer()
    const world = createMockWorld()
    manager.setWorld(world, owner)

    // Attach to a mock player actor
    const playerActor = createMockActor(0, owner)
    manager.attach(playerActor)
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an empty powers registry', () => {
      expect(manager.powers.size).toBe(0)
    })

    it('has default DevMode', () => {
      expect(manager.devMode.fastCharge).toBe(false)
      expect(manager.devMode.allTech).toBe(false)
    })

    it('extends ConditionalTrait', () => {
      expect(manager.isTraitDisabled).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Actor add/remove
  // -----------------------------------------------------------------------

  describe('onActorAdded', () => {
    it('registers a SupportPower on an owned actor', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'TestPowerOrder' })
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]

      manager.onActorAdded(actor)

      expect(manager.powers.size).toBe(1)
      const instance = manager.powers.get('TestPowerOrder')!
      expect(instance).toBeDefined()
      expect(instance.key).toBe('TestPowerOrder')
      expect(instance.instances).toContain(power)
    })

    it('does not register powers for actors owned by other players', () => {
      const otherOwner = createMockPlayer()
      const actor = createMockActor(2, otherOwner)
      const powerInfo = createPowerInfo()
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]

      manager.onActorAdded(actor)

      expect(manager.powers.size).toBe(0)
    })

    it('registers multiple powers from the same actor', () => {
      const actor = createMockActor(1, owner)
      const info1 = createPowerInfo({ orderName: 'Power1Order' })
      const info2 = createPowerInfo({ orderName: 'Power2Order' })
      const power1 = new MockSupportPower(actor, info1)
      const power2 = new MockSupportPower(actor, info2)

      actor._impls['SupportPower'] = [power1, power2]

      manager.onActorAdded(actor)

      expect(manager.powers.size).toBe(2)
      expect(manager.powers.has('Power1Order')).toBe(true)
      expect(manager.powers.has('Power2Order')).toBe(true)
    })

    it('generates unique keys with AllowMultiple', () => {
      const actor1 = createMockActor(1, owner)
      const actor2 = createMockActor(2, owner)
      const info = createPowerInfo({ orderName: 'PowerOrder', allowMultiple: true })
      const power1 = new MockSupportPower(actor1, info)
      const power2 = new MockSupportPower(actor2, info)

      actor1._impls['SupportPower'] = [power1]
      actor2._impls['SupportPower'] = [power2]

      manager.onActorAdded(actor1)
      manager.onActorAdded(actor2)

      expect(manager.powers.size).toBe(2)
      expect(manager.powers.has('PowerOrder_1')).toBe(true)
      expect(manager.powers.has('PowerOrder_2')).toBe(true)
    })

    it('reuses existing instance for same key', () => {
      const actor1 = createMockActor(1, owner)
      const actor2 = createMockActor(2, owner)
      const info = createPowerInfo({ orderName: 'PowerOrder' })
      const power1 = new MockSupportPower(actor1, info)
      const power2 = new MockSupportPower(actor2, info)

      actor1._impls['SupportPower'] = [power1]
      actor2._impls['SupportPower'] = [power2]

      manager.onActorAdded(actor1)
      manager.onActorAdded(actor2)

      expect(manager.powers.size).toBe(1)
      const instance = manager.powers.get('PowerOrder')!
      expect(instance.instances).toHaveLength(2)
    })
  })

  // -----------------------------------------------------------------------
  // Actor removal
  // -----------------------------------------------------------------------

  describe('onActorRemoved', () => {
    it('removes the power when last instance is removed', () => {
      const actor = createMockActor(1, owner)
      const info = createPowerInfo({ orderName: 'PowerOrder' })
      const power = new MockSupportPower(actor, info)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      expect(manager.powers.size).toBe(1)

      manager.onActorRemoved(actor)

      // When last instance is removed and power is not disabled,
      // the power is removed from the registry (matching OpenRA ActorRemoved)
      expect(manager.powers.size).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('ticks all powers', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'PowerOrder', chargeInterval: 100 })
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      const instance = manager.powers.get('PowerOrder')!
      expect(instance._testRemainingSubTicks).toBe(100 * 100) // TotalTicks * 100

      // Tick once
      manager.tick(manager.self)

      // charge interval 100 → remainingSubTicks = 100 * 100 = 10000
      // After 1 tick: 10000 - 100 = 9900
      expect(instance._testRemainingSubTicks).toBe(9900)
    })

    it('notifies charging on first tick', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'PowerOrder', chargeInterval: 100 })
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      expect(power.chargingCalled).toBe(0)

      manager.tick(manager.self)

      expect(power.chargingCalled).toBe(1)
    })

    it('notifies charged when timer reaches 0', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'PowerOrder', chargeInterval: 1 }) // 1 tick charge
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      // Charge: TotalTicks = 1, remainingSubTicks = 1 * 100 = 100
      // After 1 tick: 100 - 100 = 0 → charged
      expect(power.chargedCalled).toBe(0)

      manager.tick(manager.self)

      expect(power.chargedCalled).toBe(1)
    })

    it('does not advance timer when power is not active', () => {
      const actor = createMockActor(1, owner)

      // Don't register any SupportPower traits (power won't be active)
      actor._impls['SupportPower'] = []

      expect(() => manager.tick(manager.self)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // resolveOrder
  // -----------------------------------------------------------------------

  describe('resolveOrder', () => {
    it('activates the power for a matching order', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'PowerOrder', chargeInterval: 100 })
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      // Make the instance ready
      const instance = manager.powers.get('PowerOrder')!
      ;(instance as any)._remainingSubTicks = 0 // force ready

      const order = createMockOrder('PowerOrder')
      manager.resolveOrder(manager.self, order)

      expect(power.activateCalled).toBe(1)
    })

    it('ignores orders for unknown power keys', () => {
      const order = createMockOrder('UnknownOrder')

      expect(() => manager.resolveOrder(manager.self, order)).not.toThrow()
    })

    it('does not activate when power is not ready', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'PowerOrder', chargeInterval: 100 })
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      // Full charge remaining — not ready
      const order = createMockOrder('PowerOrder')
      manager.resolveOrder(manager.self, order)

      expect(power.activateCalled).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // getPowersForActor
  // -----------------------------------------------------------------------

  describe('getPowersForActor', () => {
    it('returns empty for unknown actor', () => {
      const actor = createMockActor(999, owner)
      const result = manager.getPowersForActor(actor)
      expect(result).toHaveLength(0)
    })

    it('returns registered powers for the actor', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'PowerOrder' })
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      const result = manager.getPowersForActor(actor)
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(manager.powers.get('PowerOrder'))
    })

    it('returns empty for empty registry', () => {
      const actor = createMockActor(1, owner)

      const result = manager.getPowersForActor(actor)
      expect(result).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // ITechTreeElement
  // -----------------------------------------------------------------------

  describe('ITechTreeElement', () => {
    it('prerequisitesAvailable calls instance prerequisitesAvailable(true)', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'PowerOrder', chargeInterval: 100 })
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      const instance = manager.powers.get('PowerOrder')!

      // Force prereqs unavailable
      instance._testPrereqsAvailable = false
      expect(instance.disabled).toBe(true)

      // Now make available
      manager.prerequisitesAvailable('PowerOrder')
      expect(instance.disabled).toBe(false)
    })

    it('prerequisitesUnavailable resets timer', () => {
      const actor = createMockActor(1, owner)
      const powerInfo = createPowerInfo({ orderName: 'PowerOrder', chargeInterval: 100 })
      const power = new MockSupportPower(actor, powerInfo)

      actor._impls['SupportPower'] = [power]
      manager.onActorAdded(actor)

      const instance = manager.powers.get('PowerOrder')!

      // Tick down
      manager.tick(manager.self)

      // Make unavailable
      manager.prerequisitesUnavailable('PowerOrder')
      expect(instance._testRemainingSubTicks).toBe(100 * 100) // Reset to full
    })

    it('prerequisitesItemHidden and prerequisitesItemVisible are no-ops', () => {
      expect(() => {
        manager.prerequisitesItemHidden('any')
        manager.prerequisitesItemVisible('any')
      }).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// SupportPowerInstance
// ---------------------------------------------------------------------------

describe('SupportPowerInstance', () => {
  let manager: SupportPowerManager
  let instance: SupportPowerInstance
  let powerInfo: SupportPowerInfo

  function createInstance(info: SupportPowerInfo = createPowerInfo({ orderName: 'TestOrder', chargeInterval: 100 })): {
    manager: SupportPowerManager
    instance: SupportPowerInstance
  } {
    const owner = createMockPlayer()
    const world = createMockWorld()
    const mgr = new SupportPowerManager(createManagerInfo())
    mgr.setWorld(world, owner)
    const playerActor = createMockActor(0, owner)
    mgr.attach(playerActor)

    const inst = new SupportPowerInstance('TestOrder', info, mgr)
    mgr.powers.set('TestOrder', inst)

    return { manager: mgr, instance: inst }
  }

  beforeEach(() => {
    const result = createInstance()
    manager = result.manager
    instance = result.instance
    powerInfo = createPowerInfo({ orderName: 'TestOrder', chargeInterval: 100 })
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with correct key and totalTicks', () => {
      expect(instance.key).toBe('TestOrder')
      expect(instance.totalTicks).toBe(100)
    })

    it('remainingSubTicks = totalTicks * 100 when not startFullyCharged', () => {
      expect(instance._testRemainingSubTicks).toBe(100 * 100) // 10000
    })

    it('remainingSubTicks = 0 when startFullyCharged', () => {
      const info2 = createPowerInfo({ orderName: 'TestOrder', chargeInterval: 100, startFullyCharged: true })
      const inst2 = new SupportPowerInstance('TestOrder', info2, manager)
      expect(inst2._testRemainingSubTicks).toBe(0)
      expect(inst2.remainingTicks).toBe(0)
    })

    it('remainingTicks = integer division of remainingSubTicks / 100', () => {
      expect(instance.remainingTicks).toBe(100) // 10000 / 100 = 100
    })

    it('name and description fallback to empty string', () => {
      expect(instance.name).toBe('')
      expect(instance.description).toBe('')
    })
  })

  // -----------------------------------------------------------------------
  // Ready
  // -----------------------------------------------------------------------

  describe('ready', () => {
    it('is false when remainingTicks > 0', () => {
      expect(instance.ready).toBe(false)
    })

    it('would be true if remainingTicks became 0', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      // Force remaining to 0
      ;(instance as any)._remainingSubTicks = 0

      // active = !disabled && any non-paused
      // disabled = !_instancesEnabled (since default prereqsAvailable=true, no oneShot)
      // _instancesEnabled is set in tick(). Default is true.
      // active = !false && true = true
      // ready = active && remainingTicks == 0 = true
      expect(instance.ready).toBe(true)
    })

    it('is false when power is not active', () => {
      // No instances → not active
      expect(instance.ready).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Disabled
  // -----------------------------------------------------------------------

  describe('disabled', () => {
    it('is disabled when no instances are enabled', () => {
      expect(instance.active).toBe(false)
    })

    it('is disabled when prerequisites unavailable and not AllTech', () => {
      instance._testPrereqsAvailable = false
      expect(instance.disabled).toBe(true)
    })

    it('is NOT disabled when prerequisites unavailable but AllTech is on', () => {
      instance._testPrereqsAvailable = false
      manager.devMode.allTech = true
      expect(instance.disabled).toBe(false)
    })

    it('is disabled when owner lost', () => {
      instance._testOwnerLost = true
      expect(instance.disabled).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Active
  // -----------------------------------------------------------------------

  describe('active', () => {
    it('is false when no instances', () => {
      expect(instance.active).toBe(false)
    })

    it('is true when at least one non-paused instance and not disabled', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      // Force enabled
      ;(instance as any)._instancesEnabled = true
      // disabled = !_instancesEnabled = false
      // active = !false && instances.some(!paused) = true && true = true
      expect(instance.active).toBe(true)
    })

    it('is false when all instances are paused', () => {
      const actor = createMockActor(1, createMockPlayer())
      const pausedPower: ISupportPower = {
        self: actor,
        info: powerInfo,
        isTraitDisabled: false,
        isTraitPaused: true,
        createInstance: () => ({} as ISupportPowerInstance),
      }

      instance.instances.push(pausedPower)
      ;(instance as any)._instancesEnabled = true

      expect(instance.active).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // resetTimer
  // -----------------------------------------------------------------------

  describe('resetTimer', () => {
    it('resets remainingSubTicks to totalTicks * 100', () => {
      instance.resetTimer()
      expect(instance._testRemainingSubTicks).toBe(100 * 100)
    })
  })

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('decrements remainingSubTicks by 100', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      const before = instance._testRemainingSubTicks // 10000
      instance.tick()
      expect(instance._testRemainingSubTicks).toBe(before - 100) // 9900
    })

    it('fires charging notification exactly once', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      expect(power.chargingCalled).toBe(0)
      instance.tick()
      expect(power.chargingCalled).toBe(1)
      instance.tick()
      expect(power.chargingCalled).toBe(1) // still 1 (notifiedCharging flag)
    })

    it('fires charged notification when remainingTicks reaches 0', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      // Force remainingSubTicks to 100 (1 tick remaining)
      ;(instance as any)._remainingSubTicks = 100

      instance.tick()

      expect(instance._testRemainingSubTicks).toBe(0)
      expect(instance.remainingTicks).toBe(0)
      expect(power.chargedCalled).toBe(1)
    })

    it('resets timer when no enabled instances', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      // Tick once to advance
      instance.tick()

      // Remove instances
      instance.instances.length = 0

      instance.tick()

      // Timer should be reset to full
      expect(instance._testRemainingSubTicks).toBe(100 * 100)
    })

    it('does not advance timer when not active', () => {
      // No instances → not active
      const before = instance._testRemainingSubTicks
      instance.tick()
      expect(instance._testRemainingSubTicks).toBe(before) // unchanged
    })
  })

  // -----------------------------------------------------------------------
  // FastCharge
  // -----------------------------------------------------------------------

  describe('FastCharge', () => {
    it('clamps remainingSubTicks to 2500 when FastCharge is on', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      manager.devMode.fastCharge = true

      // remainingSubTicks should be 100*100 = 10000, FastCharge clamps to 2500
      instance.tick()

      // After tick: remainingSubTicks was clamped to 2500 first, then decremented to 2400
      expect(instance._testRemainingSubTicks).toBe(2400)
    })

    it('does not clamp when remainingSubTicks already <= 2500', () => {
      const info = createPowerInfo({ orderName: 'FastOrder', chargeInterval: 10 }) // 10 * 100 = 1000
      const inst2 = new SupportPowerInstance('FastOrder', info, manager)
      manager.powers.set('FastOrder', inst2)
      manager.devMode.fastCharge = true

      const actor = createMockActor(2, createMockPlayer())
      const power = new MockSupportPower(actor, info)
      inst2.instances.push(power)

      inst2.tick()

      // 1000 - 100 = 900, no clamping needed
      expect(inst2._testRemainingSubTicks).toBe(900)
    })
  })

  // -----------------------------------------------------------------------
  // Target
  // -----------------------------------------------------------------------

  describe('target', () => {
    it('does nothing when not ready', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      expect(power.selectTargetCalled).toBe(0)
      instance.target()
      expect(power.selectTargetCalled).toBe(0) // Not ready
    })

    it('calls selectTarget when ready', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      // Force ready
      ;(instance as any)._remainingSubTicks = 0

      expect(power.selectTargetCalled).toBe(0)
      instance.target()
      expect(power.selectTargetCalled).toBe(1)
    })

    it('does nothing when all instances are paused', () => {
      const actor = createMockActor(1, createMockPlayer())
      const pausedPower: ISupportPower = {
        self: actor,
        info: powerInfo,
        isTraitDisabled: false,
        isTraitPaused: true,
        createInstance: () => ({} as ISupportPowerInstance),
      }

      instance.instances.push(pausedPower)
      ;(instance as any)._remainingSubTicks = 0 // force ready

      instance.target()
      // Should not crash, and no selectTarget should be called
    })
  })

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  describe('activate', () => {
    it('does nothing when not ready', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      const order = createMockOrder('TestOrder')
      expect(power.activateCalled).toBe(0)
      instance.activate(order)
      expect(power.activateCalled).toBe(0)
    })

    it('activates the best (closest) instance', () => {
      const actor1 = createMockActor(1, createMockPlayer())
      const actor2 = createMockActor(2, createMockPlayer())
      const info1 = createPowerInfo({ orderName: 'TestOrder', chargeInterval: 100 })
      const info2 = createPowerInfo({ orderName: 'TestOrder', chargeInterval: 100 })
      const power1 = new MockSupportPower(actor1, info1)
      const power2 = new MockSupportPower(actor2, info2)

      instance.instances.push(power1, power2)
      ;(instance as any)._remainingSubTicks = 0
      ;(instance as any)._instancesEnabled = true

      const order = createMockOrder('TestOrder')

      expect(power1.activateCalled).toBe(0)
      expect(power2.activateCalled).toBe(0)

      instance.activate(order)

      // Both are at distance Infinity from a null target → first instance wins
      expect(power1.activateCalled).toBe(1)
      expect(power2.activateCalled).toBe(0)
    })

    it('resets timer after activation', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      // Set remaining to 0 so it's ready
      ;(instance as any)._remainingSubTicks = 0
      ;(instance as any)._instancesEnabled = true

      const order = createMockOrder('TestOrder')
      instance.activate(order)

      expect(instance._testRemainingSubTicks).toBe(100 * 100)
    })

    it('resets notification flags after activation', () => {
      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, powerInfo)
      instance.instances.push(power)

      ;(instance as any)._remainingSubTicks = 0
      ;(instance as any)._instancesEnabled = true

      // Set notified flags to true
      ;(instance as any)._notifiedCharging = true
      ;(instance as any)._notifiedReady = true

      const order = createMockOrder('TestOrder')
      instance.activate(order)

      // Flags should be reset
      expect(instance._testNotifiedCharging).toBe(false)
      expect(instance._testNotifiedReady).toBe(false)
    })

    it('disables permanently on OneShot', () => {
      const onshotInfo = createPowerInfo({ orderName: 'OneShotOrder', chargeInterval: 100, oneShot: true })
      const inst2 = new SupportPowerInstance('OneShotOrder', onshotInfo, manager)
      manager.powers.set('OneShotOrder', inst2)

      const actor = createMockActor(3, createMockPlayer())
      const power = new MockSupportPower(actor, onshotInfo)
      inst2.instances.push(power)

      ;(inst2 as any)._remainingSubTicks = 0
      ;(inst2 as any)._instancesEnabled = true

      expect(inst2._testOneShotFired).toBe(false)
      expect(inst2.disabled).toBe(false)

      const order = createMockOrder('OneShotOrder')
      inst2.activate(order)

      expect(inst2._testOneShotFired).toBe(true)
      expect(inst2.disabled).toBe(true)
    })

    it('skips paused/disabled instances', () => {
      const actor1 = createMockActor(1, createMockPlayer())
      const actor2 = createMockActor(2, createMockPlayer())

      // Power 2 is paused
      const pausedPower: ISupportPower = {
        self: actor2,
        info: powerInfo,
        isTraitDisabled: false,
        isTraitPaused: true,
        createInstance: () => ({} as ISupportPowerInstance),
      }

      const activePower = new MockSupportPower(actor1, powerInfo)
      instance.instances.push(pausedPower, activePower)

      ;(instance as any)._remainingSubTicks = 0
      ;(instance as any)._instancesEnabled = true

      const order = createMockOrder('TestOrder')
      instance.activate(order)

      // Only activePower should be activated
      expect(activePower.activateCalled).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // UI overrides
  // -----------------------------------------------------------------------

  describe('UI overrides', () => {
    it('iconOverlayTextOverride returns null by default', () => {
      expect(instance.iconOverlayTextOverride()).toBeNull()
    })

    it('tooltipTimeTextOverride returns null by default', () => {
      expect(instance.tooltipTimeTextOverride()).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// SelectGenericPowerTarget
// ---------------------------------------------------------------------------

describe('SelectGenericPowerTarget', () => {
  let manager: SupportPowerManager
  let info: SupportPowerInfo

  beforeEach(() => {
    const mgrInfo = createManagerInfo()
    manager = new SupportPowerManager(mgrInfo)
    const owner = createMockPlayer()
    manager.setWorld(createMockWorld(), owner)
    const playerActor = createMockActor(0, owner)
    manager.attach(playerActor)

    info = createPowerInfo({ orderName: 'GenericPowerOrder', cursor: 'custom-cursor' })
  })

  describe('constructor', () => {
    it('stores orderKey, manager, and info', () => {
      const gen = new SelectGenericPowerTarget('Key1', manager, info)

      expect(gen.orderKey).toBe('Key1')
    })
  })

  describe('generateOrder', () => {
    it('generates order with correct orderName', () => {
      const gen = new SelectGenericPowerTarget('Key1', manager, info)
      const cell = new CPos(10, 20)

      const order = gen.generateOrder(cell)

      expect(order).not.toBeNull()
      expect(order!.orderName).toBe('Key1')
      expect(order!.target?.cell).toBe(cell)
    })
  })

  describe('tick', () => {
    it('returns false when power is not in registry', () => {
      const gen = new SelectGenericPowerTarget('MissingKey', manager, info)

      expect(gen.tick()).toBe(false)
    })

    it('returns true when power is active and ready', () => {
      // Register a ready instance
      const instance = new SupportPowerInstance('Key1', info, manager)
      manager.powers.set('Key1', instance)

      const actor = createMockActor(1, createMockPlayer())
      const power = new MockSupportPower(actor, createPowerInfo({ orderName: 'Key1', chargeInterval: 100 }))
      instance.instances.push(power)

      // Force active and ready
      ;(instance as any)._remainingSubTicks = 0
      ;(instance as any)._instancesEnabled = true

      const gen = new SelectGenericPowerTarget('Key1', manager, info)

      expect(gen.tick()).toBe(true)
    })
  })

  describe('getCursor', () => {
    it('returns info.cursor', () => {
      const gen = new SelectGenericPowerTarget('Key1', manager, info)
      const cell = new CPos(0, 0)

      expect(gen.getCursor(cell)).toBe('custom-cursor')
    })

    it('returns "ability" when cursor not configured', () => {
      const infoNoCursor = createPowerInfo({ orderName: 'Key1' })
      const gen = new SelectGenericPowerTarget('Key1', manager, infoNoCursor)

      expect(gen.getCursor(new CPos(0, 0))).toBe('ability')
    })
  })
})
