/**
 * GrantExternalConditionPower.test.ts — GrantExternalConditionPower 单元测试
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: footprint parsing, UnitsInRange, condition grant, targeting cursor.
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import {
  GrantExternalConditionPower,
  SelectConditionTarget,
  PlayerRelationship,
  type GrantExternalConditionPowerInfo,
  type IExternalCondition,
} from './GrantExternalConditionPower.js'
import type { ISupportPowerManager, OrderStub } from './SupportPower.js'
import { SupportPowerManager } from './SupportPowerManager.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  const impls: Record<string, unknown[]> = {}
  // Merge any _impls from overrides into impls before spreading
  const extImpls: Record<string, unknown[]> = (overrides['_impls'] ?? {}) as Record<string, unknown[]>
  for (const [k, v] of Object.entries(extImpls)) {
    impls[k] = v ?? []
  }
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
  } as unknown as IGameActor & { _impls: Record<string, unknown[]> }
}

function createMockManager(): SupportPowerManager {
  return new SupportPowerManager({})
}

function makeInfo(overrides: Partial<GrantExternalConditionPowerInfo> = {}): GrantExternalConditionPowerInfo {
  return {
    orderName: 'GrantExternalConditionPowerOrder',
    chargeInterval: 1000,
    condition: 'Invulnerability',
    duration: 50,
    dimensions: new CVec(3, 3),
    footprint: 'xxx\nxxx\nxxx',
    onFireSound: 'fire',
    cursor: 'ability',
    blockedCursor: 'ability-blocked',
    sequence: 'active',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test subclass
// ---------------------------------------------------------------------------

class TestGrantExternalConditionPower extends GrantExternalConditionPower {
  public testActorsAtTile: Map<number, IGameActor[]> = new Map()
  public grantedActors: IGameActor[] = []

  override _getActorsAtTile(_self: IGameActor, _tile: CPos): IGameActor[] {
    // Return combined actors from all tiles
    const allActors: IGameActor[] = []
    for (const [, actors] of this.testActorsAtTile) {
      allActors.push(...actors)
    }
    return allActors
  }

  override _relationshipWith(_owner: any, _other: any): PlayerRelationship {
    return PlayerRelationship.Ally
  }

  override _canGrantCondition(self: IGameActor, target: IGameActor): boolean {
    if (!target.traitsImplementing) return false
    const traits = target.traitsImplementing('ExternalCondition') as IExternalCondition[]
    return traits.some(
      (t) => t.info.condition === this.conditionInfo.condition && t.canGrantCondition(self),
    )
  }

  override _grantConditionToActor(self: IGameActor, target: IGameActor): void {
    this.grantedActors.push(target)
    super._grantConditionToActor(self, target)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GrantExternalConditionPower', () => {
  describe('constructor', () => {
    it('parses footprint removing whitespace', () => {
      const info = makeInfo({ footprint: 'x x\n x \nx x' })
      const actor = createMockActor()
      const power = new GrantExternalConditionPower(actor, info)

      // Should have 5 'x' characters (whitespace removed)
      expect(power.footprint.length).toBe(5)
      expect(power.footprint.every((c) => c === 'x')).toBe(true)
    })

    it('handles empty footprint', () => {
      const info = makeInfo({ footprint: '' })
      const actor = createMockActor()
      const power = new GrantExternalConditionPower(actor, info)

      expect(power.footprint).toEqual([])
    })

    it('stores self and info', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42 })
      const power = new GrantExternalConditionPower(actor, info)

      expect(power.self).toBe(actor)
      expect(power.conditionInfo).toEqual(info)
    })
  })

  describe('unitsInRange', () => {
    it('returns empty array when no actors at footprint cells', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestGrantExternalConditionPower(actor, info)

      const result = power.unitsInRange(actor, new CPos(512, 512))
      expect(result).toEqual([])
    })

    it('filters actors by relationship and condition eligibility', () => {
      const info = makeInfo({ condition: 'Invulnerability' })
      const owner = { playerName: 'test' }
      const actor = createMockActor({ actorId: 1, owner })

      const targetActor = createMockActor({
        actorId: 2,
        owner,
        _impls: {
          ExternalCondition: [{
            info: { condition: 'Invulnerability' },
            canGrantCondition: () => true,
            grantCondition: () => {},
          } as IExternalCondition],
        },
      })

      const power = new TestGrantExternalConditionPower(actor, info)
      power.testActorsAtTile.set(1, [targetActor])

      const result = power.unitsInRange(actor, new CPos(512, 512))
      expect(result).toEqual([targetActor])
    })

    it('excludes actors with non-matching condition', () => {
      const info = makeInfo({ condition: 'Invulnerability' })
      const owner = { playerName: 'test' }
      const actor = createMockActor({ actorId: 1, owner })

      const targetActor = createMockActor({
        actorId: 2,
        owner,
        _impls: {
          ExternalCondition: [{
            info: { condition: 'DifferentCondition' },
            canGrantCondition: () => true,
            grantCondition: () => {},
          } as IExternalCondition],
        },
      })

      const power = new TestGrantExternalConditionPower(actor, info)
      power.testActorsAtTile.set(1, [targetActor])

      const result = power.unitsInRange(actor, new CPos(512, 512))
      expect(result).toEqual([])
    })

    it('deduplicates actors appearing in multiple footprint cells', () => {
      const info = makeInfo()
      const owner = { playerName: 'test' }
      const actor = createMockActor({ actorId: 1, owner })

      const target = createMockActor({
        actorId: 2,
        owner,
        _impls: {
          ExternalCondition: [{
            info: { condition: 'Invulnerability' },
            canGrantCondition: () => true,
            grantCondition: () => {},
          } as IExternalCondition],
        },
      })

      const power = new TestGrantExternalConditionPower(actor, info)
      // Same actor appears at two different tiles
      power.testActorsAtTile.set(0, [target])
      power.testActorsAtTile.set(1, [target])

      const result = power.unitsInRange(actor, new CPos(512, 512))
      expect(result.length).toBe(1)
    })
  })

  describe('activate', () => {
    it('grants condition to eligible actors in range', () => {
      const info = makeInfo({ condition: 'Invulnerability', duration: 50 })
      const owner = { playerName: 'test' }
      const actor = createMockActor({ actorId: 1, owner })

      const target = createMockActor({
        actorId: 2,
        owner,
        _impls: {
          ExternalCondition: [{
            info: { condition: 'Invulnerability' },
            canGrantCondition: () => true,
            grantCondition: () => {},
          } as IExternalCondition],
        },
      })

      const power = new TestGrantExternalConditionPower(actor, info)
      power.testActorsAtTile.set(1, [target])

      const order: OrderStub = {
        orderName: 'GrantExternalConditionPowerOrder',
        target: {
          cell: new CPos(512, 512),
          type: 2,
          centerPosition: { X: 1024, Y: 1024, Z: 0 },
        },
      }

      const manager = createMockManager()
      power.activate(actor, order, manager as unknown as ISupportPowerManager)

      expect(power.grantedActors).toContain(target)
    })

    it('plays onFireSound if configured', () => {
      const info = makeInfo({ onFireSound: 'boom' })
      const actor = createMockActor({ actorId: 1, owner: { playerName: 'test' } })
      const power = new TestGrantExternalConditionPower(actor, info)

      const order: OrderStub = {
        orderName: 'GrantExternalConditionPowerOrder',
        target: {
          cell: new CPos(512, 512),
          type: 2,
          centerPosition: { X: 1024, Y: 1024, Z: 0 },
        },
      }

      const manager = createMockManager()
      // Should not throw even though Sound is stubbed
      expect(() => {
        power.activate(actor, order, manager as unknown as ISupportPowerManager)
      }).not.toThrow()
    })
  })

  describe('selectTarget', () => {
    it('calls setConditionOrderGenerator', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new GrantExternalConditionPower(actor, info)
      const manager = createMockManager()

      expect(() => {
        power.selectTarget(actor, 'GrantExternalConditionPowerOrder', manager as unknown as ISupportPowerManager)
      }).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// SelectConditionTarget tests
// ---------------------------------------------------------------------------

describe('SelectConditionTarget', () => {
  function setup() {
    const info = makeInfo({ condition: 'Invulnerability' })
    const owner = { playerName: 'test' }
    const actor = createMockActor({ actorId: 1, owner })
    const manager = createMockManager()
    const power = new TestGrantExternalConditionPower(actor, info)
    const target = new SelectConditionTarget('GrantExternalConditionPowerOrder', manager, power)

    return { info, actor, manager, power, target }
  }

  describe('generateOrder', () => {
    it('returns null when no units in range', () => {
      const { target, actor } = setup()
      const order = target.generateOrder(actor, new CPos(512, 512))
      expect(order).toBeNull()
    })

    it('returns an order when units in range', () => {
      const { target, actor, power } = setup()
      const owner = actor.owner

      const targetActor = createMockActor({
        actorId: 2,
        owner,
        _impls: {
          ExternalCondition: [{
            info: { condition: 'Invulnerability' },
            canGrantCondition: () => true,
            grantCondition: () => {},
          } as IExternalCondition],
        },
      })

      power.testActorsAtTile.set(1, [targetActor])

      const order = target.generateOrder(actor, new CPos(512, 512))
      expect(order).not.toBeNull()
      expect(order!.orderName).toBe('GrantExternalConditionPowerOrder')
      expect(order!.target!.cell).toEqual(new CPos(512, 512))
    })
  })

  describe('tick', () => {
    it('returns false when power not in manager', () => {
      const { target } = setup()
      expect(target.tick()).toBe(false)
    })
  })

  describe('getCursor', () => {
    it('returns blocked cursor when no units in range', () => {
      const { target, actor } = setup()
      const cursor = target.getCursor(actor, new CPos(512, 512))
      expect(cursor).toBe('ability-blocked')
    })

    it('returns cursor when units in range', () => {
      const { target, actor, power } = setup()
      const owner = actor.owner

      const targetActor = createMockActor({
        actorId: 2,
        owner,
        _impls: {
          ExternalCondition: [{
            info: { condition: 'Invulnerability' },
            canGrantCondition: () => true,
            grantCondition: () => {},
          } as IExternalCondition],
        },
      })

      power.testActorsAtTile.set(1, [targetActor])

      const cursor = target.getCursor(actor, new CPos(512, 512))
      expect(cursor).toBe('ability')
    })
  })

  describe('getFootprintCells', () => {
    it('returns footprint cells at center position', () => {
      const { target } = setup()
      const cells = target.getFootprintCells(new CPos(512, 512))
      // 3x3 footprint with all 'x' = 9 cells
      expect(cells.length).toBe(9)
    })
  })
})
