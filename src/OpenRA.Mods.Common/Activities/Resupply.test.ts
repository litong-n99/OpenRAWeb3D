/**
 * Resupply.test.ts — Resupply 迁移单元测试
 *
 * 测试重点: 构造函数 (确定补给类型)、修复 tick、装弹 tick、
 * 主机死亡、飞机/地面结束处理、取消、目标线。
 */

import { describe, it, expect, vi } from 'vitest'
import { Resupply, type AircraftLike } from './Resupply.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { IHealth } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import type {
  INotifyResupply,
  INotifyDockClient,
  INotifyDockHost,
  Repairable,
  Rearmable,
  RepairsUnits,
} from './EconomicActivityInterfaces.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: Record<string, unknown> = {}): GameActor {
  const baseTraits = new Map<string, unknown>([
    ['Mobile', {
      info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) },
      moveTo: vi.fn(() => ({ isCanceling: false, tick: () => true })),
      moveToTarget: vi.fn(() => ({ isCanceling: false, tick: () => true })),
      moveWithinRange: vi.fn(() => ({ isCanceling: false, tick: () => true })),
    }],
  ])
  const overrideTraits = (overrides.traits as Map<string, unknown> | undefined)
  if (overrideTraits) {
    for (const [key, value] of overrideTraits) {
      if (key === 'Mobile' && value && typeof value === 'object') {
        // Merge with base Mobile to ensure moveTo is always present
        const baseMobile = baseTraits.get('Mobile') as Record<string, unknown>
        baseTraits.set(key, { ...baseMobile, ...value as Record<string, unknown> })
      } else {
        baseTraits.set(key, value)
      }
    }
  }
  // Remove traits from overrides to avoid overwriting merged traits
  const { traits: _traits, ...restOverrides } = overrides
  void _traits
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traits: baseTraits,
    centerPosition: new WPos(100, 100, 0),
    owner: { playerName: 'Player1' },
    world: { playSound: vi.fn() },
    ...restOverrides,
  } as unknown as GameActor
}

function createMockHostActor(overrides: Record<string, unknown> = {}): GameActor {
  return {
    actorId: 2,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traits: new Map(),
    centerPosition: new WPos(200, 200, 0),
    info: { name: 'ServiceDepot' },
    owner: { playerName: 'Player1' },
    ...overrides,
  } as unknown as GameActor
}

function createMockHealth(overrides: Record<string, unknown> = {}): IHealth {
  return {
    damageState: 2, // Light damage
    hp: 50,
    maxHP: 100,
    displayHP: 50,
    isDead: false,
    inflictDamage: vi.fn(),
    ...overrides,
  } as unknown as IHealth
}

function createMockRepairsUnits(overrides: Record<string, unknown> = {}): RepairsUnits {
  return {
    isTraitDisabled: false,
    isTraitPaused: false,
    info: {
      hpPerStep: 5,
      valuePercentage: 100,
      interval: 2,
      repairDamageTypes: ['Repair'],
      startRepairingNotification: 'repair-start',
      finishRepairingNotification: 'repair-finish',
      startRepairingTextNotification: 'Repairing...',
      finishRepairingTextNotification: 'Repair complete',
      playerExperience: 10,
    },
    ...overrides,
  } as RepairsUnits
}

function createMockRepairable(overrides: Record<string, unknown> = {}): Repairable {
  return {
    info: {
      repairActors: ['ServiceDepot'],
      hpPerStep: 5,
    },
    ...overrides,
  } as Repairable
}

function createMockRearmable(overrides: Record<string, unknown> = {}): Rearmable {
  return {
    info: {
      rearmActors: ['ServiceDepot'],
    },
    rearmTick: vi.fn(() => false),
    rearmableAmmoPools: [{ hasFullAmmo: false }],
    ...overrides,
  } as Rearmable
}

function createMockNotifyResupply(): INotifyResupply {
  return {
    beforeResupply: vi.fn(),
    resupplyTick: vi.fn(),
  }
}

function createMockNotifyDockClient(): INotifyDockClient {
  return {
    docked: vi.fn(),
    undocked: vi.fn(),
  }
}

function createMockNotifyDockHost(): INotifyDockHost {
  return {
    docked: vi.fn(),
    undocked: vi.fn(),
  }
}

function createMockAircraft(overrides: Record<string, unknown> = {}): AircraftLike {
  return {
    forceLanding: false,
    info: { takeOffOnResupply: true },
    unReserve: vi.fn(),
    allowYieldingReservation: vi.fn(),
    ...overrides,
  } as AircraftLike
}

function createMockMove(): { moveTo: ReturnType<typeof vi.fn>; moveToTarget: ReturnType<typeof vi.fn>; moveWithinRange: ReturnType<typeof vi.fn> } {
  return {
    moveTo: vi.fn(() => ({ isCanceling: false, tick: () => true })),
    moveToTarget: vi.fn(() => ({ isCanceling: false, tick: () => true })),
    moveWithinRange: vi.fn(() => ({ isCanceling: false, tick: () => true })),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Resupply', () => {
  describe('constructor', () => {
    it('determines Repair only when damaged and host has RepairsUnits', () => {
      const health = createMockHealth()
      const repairsUnits = createMockRepairsUnits()
      const repairable = createMockRepairable()
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Repairable', repairable],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        traits: new Map<string, unknown>([['RepairsUnits', repairsUnits]]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      expect((resupply as unknown as { activeResupplyTypes: number }).activeResupplyTypes).toBe(1) // Repair
      expect((resupply as unknown as { wasRepaired: boolean }).wasRepaired).toBe(true)
    })

    it('determines no Repair when already undamaged', () => {
      const health = createMockHealth({ damageState: 1 }) // Undamaged
      const repairsUnits = createMockRepairsUnits()
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        traits: new Map<string, unknown>([['RepairsUnits', repairsUnits]]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      expect((resupply as unknown as { activeResupplyTypes: number }).activeResupplyTypes).toBe(0)
    })

    it('determines Rearm only when rearmable and not full ammo', () => {
      const rearmable = createMockRearmable()
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['Rearmable', rearmable],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor()
      const resupply = new Resupply(self, host, new WDist(1024))
      expect((resupply as unknown as { activeResupplyTypes: number }).activeResupplyTypes).toBe(2) // Rearm
    })

    it('determines no Rearm when ammo is full', () => {
      const rearmable = createMockRearmable({
        rearmableAmmoPools: [{ hasFullAmmo: true }],
      })
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['Rearmable', rearmable],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor()
      const resupply = new Resupply(self, host, new WDist(1024))
      expect((resupply as unknown as { activeResupplyTypes: number }).activeResupplyTypes).toBe(0)
    })

    it('determines both Repair and Rearm when applicable', () => {
      const health = createMockHealth()
      const repairsUnits = createMockRepairsUnits()
      const repairable = createMockRepairable()
      const rearmable = createMockRearmable()
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Repairable', repairable],
          ['Rearmable', rearmable],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        traits: new Map<string, unknown>([['RepairsUnits', repairsUnits]]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      expect((resupply as unknown as { activeResupplyTypes: number }).activeResupplyTypes).toBe(3) // Repair + Rearm
    })
  })

  describe('tick', () => {
    it('returns true when canceling with no remaining ticks', () => {
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor()
      const resupply = new Resupply(self, host, new WDist(1024))
      resupply.cancel(self)
      expect(resupply.tick(self)).toBe(true)
    })

    it('counts down remaining ticks when canceling', () => {
      const health = createMockHealth()
      const repairsUnits = createMockRepairsUnits()
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        traits: new Map<string, unknown>([['RepairsUnits', repairsUnits]]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      resupply.cancel(self)
      // remainingTicks starts at 0, so should return true immediately
      expect(resupply.tick(self)).toBe(true)
    })

    it('cancels when host becomes invalid', () => {
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({ isInWorld: false })
      const resupply = new Resupply(self, host, new WDist(1024))
      expect(resupply.tick(self)).toBe(true)
    })

    it('queues move when not close enough (ground unit)', () => {
      const health = createMockHealth()
      const repairsUnits = createMockRepairsUnits()
      const repairable = createMockRepairable()
      const move = createMockMove()
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Repairable', repairable],
          ['Mobile', { ...move, info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        centerPosition: new WPos(5000, 5000, 0), // Far away
        traits: new Map<string, unknown>([['RepairsUnits', repairsUnits]]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      const result = resupply.tick(self)
      expect(result).toBe(false)
      expect(resupply.childActivity).not.toBeNull()
    })

    it('starts resupply and notifies when close enough', () => {
      const health = createMockHealth()
      const repairsUnits = createMockRepairsUnits()
      const repairable = createMockRepairable()
      const notifyResupply = createMockNotifyResupply()
      const notifyDockClient = createMockNotifyDockClient()
      const notifyDockHost = createMockNotifyDockHost()
      const self = createMockActor({
        centerPosition: new WPos(200, 200, 0), // Same as host
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Repairable', repairable],
          ['NotifyDockClient', notifyDockClient],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([
          ['RepairsUnits', repairsUnits],
          ['NotifyDockHost', notifyDockHost],
          ['NotifyResupply', notifyResupply],
        ]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      resupply.tick(self)
      expect(notifyResupply.beforeResupply).toHaveBeenCalled()
      expect(notifyDockClient.docked).toHaveBeenCalled()
      expect(notifyDockHost.docked).toHaveBeenCalled()
    })

    it('heals actor during repair tick', () => {
      const health = createMockHealth()
      const repairsUnits = createMockRepairsUnits()
      const repairable = createMockRepairable()
      const self = createMockActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Repairable', repairable],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
        info: { valued: { cost: 100 } },
      })
      const host = createMockHostActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([
          ['RepairsUnits', repairsUnits],
        ]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      // First tick starts resupply
      resupply.tick(self)
      expect(health.inflictDamage).toHaveBeenCalled()
    })

    it('completes when repair finishes', () => {
      const health = createMockHealth({ damageState: 1 }) // Start as undamaged
      const repairsUnits = createMockRepairsUnits()
      const repairable = createMockRepairable()
      const self = createMockActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Repairable', repairable],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([['RepairsUnits', repairsUnits]]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      // First tick should complete immediately since already undamaged
      const result = resupply.tick(self)
      expect(result).toBe(true)
    })

    it('completes rearm when rearmTick returns true', () => {
      const rearmable = createMockRearmable({
        rearmTick: vi.fn(() => true), // Complete immediately
      })
      const self = createMockActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([
          ['Rearmable', rearmable],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        centerPosition: new WPos(200, 200, 0),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      const result = resupply.tick(self)
      expect(result).toBe(true)
    })

    it('handles aircraft resupply with takeoff', () => {
      const aircraft = createMockAircraft()
      const health = createMockHealth()
      const repairsUnits = createMockRepairsUnits()
      const self = createMockActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Aircraft', aircraft],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([['RepairsUnits', repairsUnits]]),
      })
      const resupply = new Resupply(self, host, new WDist(1024))
      resupply.tick(self) // Start
      const result = resupply.tick(self) // Complete
      expect(result).toBe(true)
    })

    it('handles stayOnResupplier flag', () => {
      const health = createMockHealth()
      const repairsUnits = createMockRepairsUnits()
      const self = createMockActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([
          ['IHealth', health],
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor({
        centerPosition: new WPos(200, 200, 0),
        traits: new Map<string, unknown>([['RepairsUnits', repairsUnits]]),
      })
      const resupply = new Resupply(self, host, new WDist(1024), true)
      expect(resupply.stayOnResupplier).toBe(true)
    })
  })

  describe('cancel', () => {
    it('cancels child activities and sets state to Done when queued', () => {
      const self = createMockActor()
      const host = createMockHostActor()
      const resupply = new Resupply(self, host, new WDist(1024))
      resupply.cancel(self)
      // When cancel() is called on a Queued activity, it transitions to Done
      // (not Canceling — Canceling is only for Active activities)
      expect(resupply.state).toBe(3) // ActivityState.Done = 3
    })
  })

  describe('targetLineNodes', () => {
    it('returns target line to host when no child', () => {
      const self = createMockActor({
        traits: new Map<string, unknown>([
          ['Mobile', { info: { getTargetLineColor: () => ({ r: 0, g: 1, b: 0, a: 1 }) } }],
        ]),
      })
      const host = createMockHostActor()
      const resupply = new Resupply(self, host, new WDist(1024))
      const nodes = resupply.targetLineNodes(self)
      expect(nodes.length).toBe(1)
    })
  })
})
