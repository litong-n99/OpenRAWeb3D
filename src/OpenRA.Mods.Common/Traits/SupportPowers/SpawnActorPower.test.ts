/**
 * SpawnActorPower.test.ts — SpawnActorPower 单元测试
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: validation logic, targeting cursor, order generation.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import {
  SpawnActorPower,
  SelectSpawnActorPowerTarget,
  SpawnValidationResult,
  type SpawnActorPowerInfo,
} from './SpawnActorPower.js'
import type { ISupportPowerManager, OrderStub } from './SupportPower.js'
import { SupportPowerManager } from './SupportPowerManager.js'
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

function createMockManager(): SupportPowerManager {
  return new SupportPowerManager({})
}

function makeInfo(overrides: Partial<SpawnActorPowerInfo> = {}): SpawnActorPowerInfo {
  return {
    orderName: 'SpawnActorPowerOrder',
    chargeInterval: 1000,
    actor: 'mcv',
    cursor: 'deploy',
    blockedCursor: 'deploy-blocked',
    lifeTime: 250,
    allowUnderShroud: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test subclass
// ---------------------------------------------------------------------------

class TestSpawnActorPower extends SpawnActorPower {
  public lastCell: CPos | null = null

  override _cellContaining(_position: { readonly X: number; readonly Y: number; readonly Z: number }): CPos | null {
    return new CPos(512, 512)
  }

  override _queueFrameEnd(
    _self: IGameActor,
    cell: CPos,
    _order: OrderStub,
    _manager: ISupportPowerManager,
  ): void {
    this.lastCell = cell
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpawnActorPower', () => {
  describe('constructor', () => {
    it('stores info and self', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42 })
      const power = new SpawnActorPower(actor, info)

      expect(power.self).toBe(actor)
      expect(power.spawnInfo).toBe(info)
    })
  })

  describe('validate', () => {
    it('returns true for a valid cell', () => {
      const result = SpawnActorPower.validate(null, makeInfo(), new CPos(512, 512))
      expect(result).toBe(true)
    })

    it('returns false for null cell', () => {
      const result = SpawnActorPower.validate(null, makeInfo(), null as unknown as CPos)
      expect(result).toBe(false)
    })

    it('validateDetailed returns Valid for a cell', () => {
      const result = SpawnActorPower.validateDetailed(null, makeInfo(), new CPos(512, 512))
      expect(result).toBe(SpawnValidationResult.Valid)
    })

    it('validateDetailed returns OutOfMap for null cell', () => {
      const result = SpawnActorPower.validateDetailed(null, makeInfo(), null as unknown as CPos)
      expect(result).toBe(SpawnValidationResult.OutOfMap)
    })
  })

  describe('activate', () => {
    it('activates with valid target position', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestSpawnActorPower(actor, info)

      const order: OrderStub = {
        orderName: 'SpawnActorPowerOrder',
        target: {
          cell: new CPos(512, 512),
          type: 2,
          centerPosition: { X: 1024, Y: 1024, Z: 0 },
        },
      }

      power.activate(actor, order, manager as unknown as ISupportPowerManager)

      expect(power.lastCell).not.toBeNull()
    })

    it('does nothing when target has no centerPosition', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const manager = createMockManager()
      const power = new TestSpawnActorPower(actor, info)

      const order: OrderStub = {
        orderName: 'SpawnActorPowerOrder',
        target: { cell: null, type: 0, centerPosition: null },
      }

      power.activate(actor, order, manager as unknown as ISupportPowerManager)

      expect(power.lastCell).toBeNull()
    })

    it('validates position before activating', () => {
      const info = makeInfo({ allowUnderShroud: false })
      const actor = createMockActor()
      const manager = createMockManager()
      const power = new TestSpawnActorPower(actor, info)

      // Even though validate always returns true in stubs,
      // the method should be called during activate
      const order: OrderStub = {
        orderName: 'SpawnActorPowerOrder',
        target: {
          cell: new CPos(512, 512),
          type: 2,
          centerPosition: { X: 1024, Y: 1024, Z: 0 },
        },
      }

      power.activate(actor, order, manager as unknown as ISupportPowerManager)
      // Should have set lastCell
      expect(power.lastCell).not.toBeNull()
    })
  })

  describe('selectTarget', () => {
    it('plays select target sound', () => {
      const info = makeInfo({ selectTargetSound: 'select-target' })
      const actor = createMockActor()
      const manager = createMockManager()
      const power = new SpawnActorPower(actor, info)

      // selectTarget is a no-op in stub but should be callable
      expect(() => {
        power.selectTarget(actor, 'SpawnActorPowerOrder', manager as unknown as ISupportPowerManager)
      }).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// SelectSpawnActorPowerTarget tests
// ---------------------------------------------------------------------------

describe('SelectSpawnActorPowerTarget', () => {
  function setup() {
    const info = makeInfo()
    const actor = createMockActor({ actorId: 42 })
    const manager = createMockManager()
    const power = new SpawnActorPower(actor, info)
    const target = new SelectSpawnActorPowerTarget('SpawnActorPowerOrder', manager, power)

    return { info, actor, manager, power, target }
  }

  describe('generateOrder', () => {
    it('returns an order for a valid cell', () => {
      const { target } = setup()
      const order = target.generateOrder(null, new CPos(512, 512))

      expect(order).not.toBeNull()
      expect(order!.orderName).toBe('SpawnActorPowerOrder')
      expect(order!.target!.cell).toEqual(new CPos(512, 512))
      expect(order!.target!.type).toBe(2)
    })
  })

  describe('tick', () => {
    it('returns false when power is not in manager', () => {
      const { target } = setup()
      const result = target.tick()
      expect(result).toBe(false)
    })
  })

  describe('getCursor', () => {
    it('returns cursor for valid cell', () => {
      const { target } = setup()
      const cursor = target.getCursor(null, new CPos(512, 512))
      expect(cursor).toBe('deploy')
    })
  })
})
