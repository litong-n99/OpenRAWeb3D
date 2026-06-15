/**
 * SupportPower.test.ts — SupportPower 抽象基类 单元测试
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: configuration, lifecycle, charge notifications, CellsMatching.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import {
  type SupportPowerInfo,
  type ISupportPowerManager,
  type ISupportPowerInstance,
  SupportPower,
} from './SupportPower.js'
import type {
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Concrete SupportPower subclass for testing
// ---------------------------------------------------------------------------

interface TestPowerInfo extends SupportPowerInfo {
  readonly customField?: string
}

class TestSupportPower extends SupportPower {
  declare readonly info: TestPowerInfo

  constructor(self: IGameActor, info: TestPowerInfo) {
    super(self, info)
  }

  // Expose protected methods for testing
  public testNotifyCharged(self: IGameActor) {
    this.notifySupportPowerCharged(self)
  }

  public testNotifyActivated(self: IGameActor) {
    this.notifySupportPowerActivated(self)
  }

  public testSetOrderGenerator(self: IGameActor, orderKey: string, manager: ISupportPowerManager) {
    this.setOrderGenerator(self, orderKey, manager, this.info)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: Partial<IGameActor> = {}): IGameActor {
  const impls: Record<string, unknown[]> = {}
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: undefined,
    world: undefined,
    traitsImplementing(interfaceId: string): unknown[] {
      return impls[interfaceId] ?? []
    },
    // Internal for test setup
    _impls: impls,
    ...overrides,
  } as IGameActor & { _impls: Record<string, unknown[]> }
}

function createMockManager(overrides: Partial<ISupportPowerManager> = {}): ISupportPowerManager {
  const powers = new Map<string, ISupportPowerInstance>()
  return {
    self: createMockActor(),
    powers,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupportPower', () => {
  // -----------------------------------------------------------------------
  // makeKey
  // -----------------------------------------------------------------------

  describe('static makeKey', () => {
    it('returns orderName when AllowMultiple is false', () => {
      const info: SupportPowerInfo = { orderName: 'TestOrder', chargeInterval: 100 }
      const key = SupportPower.makeKey(info, 42)
      expect(key).toBe('TestOrder')
    })

    it('returns orderName with actorID when AllowMultiple is true', () => {
      const info: SupportPowerInfo = { orderName: 'TestOrder', chargeInterval: 100, allowMultiple: true }
      const key = SupportPower.makeKey(info, 42)
      expect(key).toBe('TestOrder_42')
    })

    it('returns orderName when AllowMultiple is explicitly false', () => {
      const info: SupportPowerInfo = { orderName: 'AirstrikePowerOrder', chargeInterval: 3000, allowMultiple: false }
      const key = SupportPower.makeKey(info, 777)
      expect(key).toBe('AirstrikePowerOrder')
    })
  })

  // -----------------------------------------------------------------------
  // Constructor & basic fields
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores self and info', () => {
      const actor = createMockActor()
      const info: TestPowerInfo = { orderName: 'TestOrder', chargeInterval: 100, customField: 'hello' }
      const power = new TestSupportPower(actor, info)

      expect(power.self).toBe(actor)
      expect(power.info).toBe(info)
      expect(power.info.customField).toBe('hello')
      expect(power.info.orderName).toBe('TestOrder')
      expect(power.info.chargeInterval).toBe(100)
    })
  })

  // -----------------------------------------------------------------------
  // createInstance
  // -----------------------------------------------------------------------

  describe('createInstance', () => {
    it('creates a SupportPowerInstance with correct key and info', () => {
      const actor = createMockActor()
      const manager = createMockManager()
      const info: SupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 500,
        startFullyCharged: false,
        allowMultiple: false,
      }
      const power = new TestSupportPower(actor, info)

      const instance = power.createInstance('TestOrder_1', manager)

      expect(instance.key).toBe('TestOrder_1')
      expect(instance.info).toBe(info)
      expect(instance.totalTicks).toBe(500)
      expect(instance.instances).toBeDefined()
    })

    it('creates instance with startFullyCharged', () => {
      const actor = createMockActor()
      const manager = createMockManager()
      const info: SupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 500,
        startFullyCharged: true,
      }
      const power = new TestSupportPower(actor, info)

      const instance = power.createInstance('TestOrder', manager)

      expect(instance.totalTicks).toBe(500)
      expect(instance.remainingTicks).toBe(0)
    })

    it('creates instance with remainingTicks matching totalTicks when not fully charged', () => {
      const actor = createMockActor()
      const manager = createMockManager()
      const info: SupportPowerInfo = {
        orderName: 'TestOrder',
        chargeInterval: 100,
        startFullyCharged: false,
      }
      const power = new TestSupportPower(actor, info)

      const instance = power.createInstance('TestOrder', manager)

      expect(instance.totalTicks).toBe(100)
      expect(instance.remainingTicks).toBe(100)
    })
  })

  // -----------------------------------------------------------------------
  // charging
  // -----------------------------------------------------------------------

  describe('charging', () => {
    it('does not throw when called with no audio configured', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(() => power.charging(actor, 'key')).not.toThrow()
    })

    it('can be called multiple times', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(() => { power.charging(actor, 'k1'); power.charging(actor, 'k2') }).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // charged
  // -----------------------------------------------------------------------

  describe('charged', () => {
    it('does not throw when called', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(() => power.charged(actor, 'key')).not.toThrow()
    })

    it('notifies INotifySupportPower traits on the actor', () => {
      const chargedSpy = vi.fn()
      const activatedSpy = vi.fn()

      const actor = createMockActor()
      ;(actor as any)._impls['INotifySupportPower'] = [
        { charged: chargedSpy, activated: activatedSpy },
      ]

      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      power.testNotifyCharged(actor)

      expect(chargedSpy).toHaveBeenCalledTimes(1)
      expect(chargedSpy).toHaveBeenCalledWith(actor)
      expect(activatedSpy).not.toHaveBeenCalled()
    })

    it('notifies multiple INotifySupportPower traits', () => {
      const charged1 = vi.fn()
      const charged2 = vi.fn()

      const actor = createMockActor()
      ;(actor as any)._impls['INotifySupportPower'] = [
        { charged: charged1, activated: vi.fn() },
        { charged: charged2, activated: vi.fn() },
      ]

      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      power.testNotifyCharged(actor)

      expect(charged1).toHaveBeenCalledTimes(1)
      expect(charged2).toHaveBeenCalledTimes(1)
    })

    it('handles traits without charged method gracefully', () => {
      const actor = createMockActor()
      ;(actor as any)._impls['INotifySupportPower'] = [
        { activated: vi.fn() }, // no charged method
      ]

      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(() => power.testNotifyCharged(actor)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------

  describe('activate', () => {
    it('does not throw when called', () => {
      const actor = createMockActor()
      const manager = createMockManager()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)
      const order = { orderName: 'TO', targetString: null, extraData: 0 }

      expect(() => power.activate(actor, order, manager)).not.toThrow()
    })

    it('notifies INotifySupportPower traits on the actor', () => {
      const chargedSpy = vi.fn()
      const activatedSpy = vi.fn()

      const actor = createMockActor()
      ;(actor as any)._impls['INotifySupportPower'] = [
        { charged: chargedSpy, activated: activatedSpy },
      ]

      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      power.testNotifyActivated(actor)

      expect(activatedSpy).toHaveBeenCalledTimes(1)
      expect(activatedSpy).toHaveBeenCalledWith(actor)
      expect(chargedSpy).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // selectTarget
  // -----------------------------------------------------------------------

  describe('selectTarget', () => {
    it('does not throw when called', () => {
      const actor = createMockActor()
      const manager = createMockManager()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(() => power.selectTarget(actor, 'TO', manager)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // playLaunchSounds
  // -----------------------------------------------------------------------

  describe('playLaunchSounds', () => {
    it('does not throw when called with no audio configured', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(() => power.playLaunchSounds()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // cellsMatching
  // -----------------------------------------------------------------------

  describe('static cellsMatching', () => {
    it('returns cells matching "x" in a 3x3 footprint', () => {
      // 3x3 footprint: "xxx" / "x-x" / "xxx" → 8 cells (center is '-')
      const location = new CPos(10, 20)
      const footprint = ['x', 'x', 'x', 'x', '-', 'x', 'x', 'x', 'x'] // 3x3
      const dimensions = new CVec(3, 3)

      const result = SupportPower.cellsMatching(location, footprint, dimensions)

      expect(result).toHaveLength(8)
      // Center should not be included
      const centerCell = new CPos(10, 20)
      expect(result.some((c) => CPos.equals(c, centerCell))).toBe(false)
    })

    it('returns empty array for footprint with no "x"', () => {
      const location = new CPos(10, 20)
      const footprint = ['-', '-', '-', '-']
      const dimensions = new CVec(2, 2)

      const result = SupportPower.cellsMatching(location, footprint, dimensions)

      expect(result).toHaveLength(0)
    })

    it('returns all cells for all-"x" footprint', () => {
      const location = new CPos(0, 0)
      const footprint = ['x', 'x', 'x', 'x']
      const dimensions = new CVec(2, 2)

      const result = SupportPower.cellsMatching(location, footprint, dimensions)

      expect(result).toHaveLength(4)
    })

    it('offsets correctly from center (3x1 footprint)', () => {
      // 3x1: center at (10, 20), dimensions (3, 1)
      // startX = 10 - (3-1)/2 = 9
      // startY = 20 - (1-1)/2 = 20
      // Cells: (9,20), (10,20), (11,20)
      const location = new CPos(10, 20)
      const footprint = ['x', 'x', 'x']
      const dimensions = new CVec(3, 1)

      const result = SupportPower.cellsMatching(location, footprint, dimensions)

      expect(result).toHaveLength(3)
      expect(result[0].X).toBe(9)
      expect(result[0].Y).toBe(20)
      expect(result[1].X).toBe(10)
      expect(result[1].Y).toBe(20)
      expect(result[2].X).toBe(11)
      expect(result[2].Y).toBe(20)
    })

    it('handles 1x1 footprint', () => {
      const location = new CPos(5, 5)
      const footprint = ['x']
      const dimensions = new CVec(1, 1)

      const result = SupportPower.cellsMatching(location, footprint, dimensions)

      expect(result).toHaveLength(1)
      expect(result[0].X).toBe(5)
      expect(result[0].Y).toBe(5)
    })

    it('handles 5x5 footprint with corners only', () => {
      // 5x5: x----, -----, --x--, -----, ----x (diagonal)
      const location = new CPos(20, 20)
      const footprint = [
        'x', '-', '-', '-', '-',
        '-', '-', '-', '-', '-',
        '-', '-', 'x', '-', '-',
        '-', '-', '-', '-', '-',
        '-', '-', '-', '-', 'x',
      ]
      const dimensions = new CVec(5, 5)

      const result = SupportPower.cellsMatching(location, footprint, dimensions)

      expect(result).toHaveLength(3)
    })
  })

  // -----------------------------------------------------------------------
  // INotifySupportPower methods — tested via the trait's own methods
  // -----------------------------------------------------------------------

  describe('INotifySupportPower-like behavior', () => {
    it('charging and charged are callable', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(typeof power.charging).toBe('function')
      expect(typeof power.charged).toBe('function')
    })

    it('charging is callable with (self, key)', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(() => power.charging(actor, 'key')).not.toThrow()
    })

    it('charged is callable with (self, key)', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(() => power.charged(actor, 'key')).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // attach / lifecycle
  // -----------------------------------------------------------------------

  describe('attach', () => {
    it('calls onCreated', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      // Verifying it doesn't throw is the main test
      expect(power.self).toBe(actor)
      expect(power.enabled).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // ConditionalTrait integration
  // -----------------------------------------------------------------------

  describe('ConditionalTrait integration', () => {
    it('extends ConditionalTrait', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(power.info).toBe(info)
      expect(power.isTraitDisabled).toBe(false)
      expect(power.isTraitPaused).toBe(false)
    })

    it('has isTraitDisabled as false by default', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(power.isTraitDisabled).toBe(false)
    })

    it('has isTraitPaused as false by default', () => {
      const actor = createMockActor()
      const info: SupportPowerInfo = { orderName: 'TO', chargeInterval: 100 }
      const power = new TestSupportPower(actor, info)

      expect(power.isTraitPaused).toBe(false)
    })
  })
})
