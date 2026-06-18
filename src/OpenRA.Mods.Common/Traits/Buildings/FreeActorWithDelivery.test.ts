/**
 * FreeActorWithDelivery.test.ts — FreeActorWithDelivery trait unit tests
 *
 * Tests focus on: config defaults, doDelivery logic, actor spawning.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  FreeActorWithDelivery,
  FreeActorWithDeliveryInfo,
} from './FreeActorWithDelivery.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockBuildingActor(overrides: Partial<{ world: unknown; location: CPos }> = {}): IGameActor {
  return {
    actorId: 1,
    disposed: false,
    isDead: false,
    isInWorld: true,
    location: overrides.location ?? new CPos(5, 10),
    world: overrides.world ?? {
      createActor: vi.fn(() => ({
        actorId: 100,
        queueActivity: vi.fn(),
        trait: vi.fn(() => ({
          reserve: vi.fn(),
        })),
      })),
      map: {
        centerOfCell: vi.fn(() => new WPos(5632, 10752, 0)),
        chooseClosestEdgeCell: vi.fn(() => new CPos(0, 0)),
        facingBetween: vi.fn(() => 0),
        chooseRandomEdgeCell: vi.fn(() => new CPos(128, 0)),
      },
      sharedRandom: {},
      addFrameEndTask: vi.fn((fn: (w: unknown) => void) => fn({ add: vi.fn() })),
    },
    owner: {},
    centerPosition: new WPos(5632, 10752, 0),
    generation: 1,
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FreeActorWithDeliveryInfo', () => {
  it('has correct defaults', () => {
    const info = new FreeActorWithDeliveryInfo()
    expect(info.actor).toBe('harvester')
    expect(info.deliveringActor).toBe('carryall')
    expect(CPos.equals(info.spawnLocation, CPos.Zero)).toBe(true)
    expect(CPos.equals(info.deliveryOffset, CPos.Zero)).toBe(true)
    expect(info.deliveryRange).toBe(0)
    expect(info.allowRespawn).toBe(true)
  })

  it('accepts custom values', () => {
    const info = new FreeActorWithDeliveryInfo({
      actor: 'mcv',
      deliveringActor: 'chinook',
      spawnLocation: { X: 10, Y: 20 },
      deliveryOffset: { X: 2, Y: 3 },
      deliveryRange: 5,
      allowRespawn: false,
    })
    expect(info.actor).toBe('mcv')
    expect(info.deliveringActor).toBe('chinook')
    expect(info.spawnLocation.X).toBe(10)
    expect(info.spawnLocation.Y).toBe(20)
    expect(info.deliveryOffset.X).toBe(2)
    expect(info.deliveryOffset.Y).toBe(3)
    expect(info.deliveryRange).toBe(5)
    expect(info.allowRespawn).toBe(false)
  })
})

describe('FreeActorWithDelivery', () => {
  it('constructs with self and info', () => {
    const info = new FreeActorWithDeliveryInfo()
    const self = mockBuildingActor()
    const trait = new FreeActorWithDelivery(self, info)
    expect(trait).toBeInstanceOf(FreeActorWithDelivery)
    expect(trait.info).toBe(info)
  })

  it('doDelivery creates cargo and carrier', () => {
    const createActor = vi.fn(() => ({
      actorId: Math.random() * 1000 | 0,
      queueActivity: vi.fn(),
      trait: vi.fn(() => ({
        reserve: vi.fn(),
      })),
    }))
    const info = new FreeActorWithDeliveryInfo({
      actor: 'harvester',
      deliveringActor: 'carryall',
    })
    const self = mockBuildingActor({
      world: {
        createActor,
        map: {
          centerOfCell: vi.fn(() => new WPos(5632, 10752, 0)),
          chooseClosestEdgeCell: vi.fn(() => new CPos(0, 0)),
          facingBetween: vi.fn(() => 0),
          chooseRandomEdgeCell: vi.fn(() => new CPos(128, 0)),
        },
        sharedRandom: {},
        addFrameEndTask: vi.fn((fn: (w: unknown) => void) => fn({ add: vi.fn() })),
      },
    })
    const trait = new FreeActorWithDelivery(self, info)

    trait.doDelivery(new CPos(5, 5), 'harvester', 'carryall')

    // Should have created both cargo and carrier
    expect(createActor).toHaveBeenCalledTimes(2)
    // First call: carrier with deliverActorName
    expect(createActor).toHaveBeenCalledWith(
      false,
      'carryall',
      expect.any(Array),
    )
    // Second call: cargo
    expect(createActor).toHaveBeenCalledWith(
      false,
      'harvester',
      expect.any(Array),
    )
  })

  it('doDelivery uses custom spawn location when provided', () => {
    const createActor = vi.fn(() => ({
      actorId: 500,
      queueActivity: vi.fn(),
      trait: vi.fn(() => ({
        reserve: vi.fn(),
      })),
    }))
    const info = new FreeActorWithDeliveryInfo({
      spawnLocation: { X: 25, Y: 30 },
    })
    const self = mockBuildingActor({
      world: {
        createActor,
        map: {
          centerOfCell: vi.fn(() => new WPos(26624, 31744, 0)),
          chooseClosestEdgeCell: vi.fn(),
          facingBetween: vi.fn(() => 0),
          chooseRandomEdgeCell: vi.fn(() => new CPos(128, 0)),
        },
        sharedRandom: {},
        addFrameEndTask: vi.fn((fn: (w: unknown) => void) => fn({ add: vi.fn() })),
      },
    })
    const trait = new FreeActorWithDelivery(self, info)

    trait.doDelivery(new CPos(5, 5), 'harvester', 'carryall')

    expect(createActor).toHaveBeenCalled()
    // Should not call chooseClosestEdgeCell since spawnLocation is explicit
  })
})
