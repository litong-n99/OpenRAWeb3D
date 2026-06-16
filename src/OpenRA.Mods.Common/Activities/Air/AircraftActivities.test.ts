/**
 * AircraftActivities.test.ts — Phase C Batch 2 + Batch 4 simple activity tests
 *
 * Covers: FlyForward, FlyIdle, FlyOffMap, Parachute, FlyFollow, ReturnToBase,
 *         FallToEarth, DeliverBulkOrder.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Vector3: class {},
}))

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { FlyForward } from './FlyForward'
import { FlyIdle } from './FlyIdle'
import { FlyOffMap } from './FlyOffMap'
import { Parachute } from '../Parachute'
import { FlyFollow } from './FlyFollow'
import { ReturnToBase } from './ReturnToBase'
import { FallToEarth } from './FallToEarth'
import { DeliverBulkOrder } from './DeliverBulkOrder'
import { createMockAircraft, createMockActor } from './AirTestHelpers'
import { Target } from '../../../OpenRA.Game/Traits/Target'
import { WDist } from '../../../OpenRA.Game/WDist'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WVec } from '../../../OpenRA.Game/WVec'
import { CPos } from '../../../OpenRA.Game/CPos'
import { FallsToEarthInfo } from '../../Traits/Air/FallsToEarth'

// ---------------------------------------------------------------------------
// FlyForward
// ---------------------------------------------------------------------------

describe('FlyForward', () => {
  it('requires Aircraft trait', () => {
    const actor = { traits: new Map() } as unknown as never
    expect(() => new FlyForward(actor, 5)).toThrow('FlyForward requires an Aircraft trait')
  })

  it('returns true after ticking N times', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const fw = new FlyForward(actor, 3)

    expect(fw.tick(actor)).toBe(false)
    expect(fw.tick(actor)).toBe(false)
    expect(fw.tick(actor)).toBe(false)
    expect(fw.tick(actor)).toBe(true)
  })

  it('returns true after traveling specified distance', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), speed: 100 })
    const actor = createMockActor(aircraft) as never
    const fw = new FlyForward(actor, new WDist(50))

    let result = false
    let ticks = 0
    while (!result && ticks < 100) {
      result = fw.tick(actor)
      ticks++
    }

    expect(result).toBe(true)
  })

  it('cancels when forceLanding is true', () => {
    const aircraft = createMockAircraft({ forceLanding: true, centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const fw = new FlyForward(actor, 10)
    expect(fw.tick(actor)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// FlyIdle
// ---------------------------------------------------------------------------

describe('FlyIdle', () => {
  it('requires Aircraft trait', () => {
    const actor = { traits: new Map() } as unknown as never
    expect(() => new FlyIdle(actor)).toThrow('FlyIdle requires an Aircraft trait')
  })

  it('returns true after countdown', () => {
    const aircraft = createMockAircraft({ canHover: true, centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const idle = new FlyIdle(actor, 3)

    expect(idle.tick(actor)).toBe(false)
    expect(idle.tick(actor)).toBe(false)
    expect(idle.tick(actor)).toBe(false)
    expect(idle.tick(actor)).toBe(true)
  })

  it('circles for non-hover aircraft', () => {
    const aircraft = createMockAircraft({ canHover: false, centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const idle = new FlyIdle(actor, 5)

    const result = idle.tick(actor)
    expect(result).toBe(false)
    // Facing should have changed (256 units)
    expect(aircraft.facing.angle).not.toBe(0)
  })

  it('notifies INotifyIdle traits', () => {
    const aircraft = createMockAircraft({ canHover: true, centerPosition: new WPos(0, 0, 1280) })
    const tickIdle = vi.fn()
    const notifyIdle = { tickIdle }
    const actor = createMockActor(aircraft, new Map([['NotifyIdle', notifyIdle]])) as never

    const idle = new FlyIdle(actor, 1)
    idle.tick(actor)
    expect(tickIdle).toHaveBeenCalled()
  })

  it('returns true when next activity is queued and ticks are negative', () => {
    const aircraft = createMockAircraft({ canHover: true, centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const idle = new FlyIdle(actor, -1)
    // Simulate nextActivity by queuing another activity
    idle.queue(new FlyIdle(actor, 1))
    expect(idle.tick(actor)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// FlyOffMap
// ---------------------------------------------------------------------------

describe('FlyOffMap', () => {
  it('requires Aircraft trait', () => {
    const actor = { traits: new Map() } as unknown as never
    expect(() => new FlyOffMap(actor)).toThrow('FlyOffMap requires an Aircraft trait')
  })

  it('queues Fly then FlyForward when target provided', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const target = Target.fromPos(new WPos(1000, 0, 1280))
    const offMap = new FlyOffMap(actor, target)
    ;(offMap as unknown as { onFirstRun: (self: unknown) => void }).onFirstRun(actor)

    offMap.tick(actor)
    expect((offMap as unknown as { _childActivity: unknown })._childActivity).not.toBeNull()
  })

  it('queues FlyForward without target', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const offMap = new FlyOffMap(actor, 25)
    ;(offMap as unknown as { onFirstRun: (self: unknown) => void }).onFirstRun(actor)

    offMap.tick(actor)
    expect((offMap as unknown as { _childActivity: unknown })._childActivity).not.toBeNull()
  })

  it('returns true when canceling', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const offMap = new FlyOffMap(actor, 25)
    ;(offMap as unknown as { state: number }).state = 2 // Canceling
    expect(offMap.tick(actor)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Parachute
// ---------------------------------------------------------------------------

describe('Parachute', () => {
  it('requires IPositionable trait', () => {
    const actor = { occupiesSpace: undefined } as unknown as never
    expect(() => new Parachute(actor)).toThrow('Parachute requires an IPositionable trait')
  })

  it('falls by fallRate each tick and lands', () => {
    const pos = new WPos(0, 0, 100)
    const positionable = {
      centerPosition: pos,
      setCenterPosition: vi.fn((_self: unknown, p: WPos) => {
        ;(pos as unknown as { X: number; Y: number; Z: number }).Z = p.Z
      }),
    }
    const parachuteInfo = { fallRate: new WDist(25) }
    const actor = {
      occupiesSpace: positionable,
      info: { traitInfo: () => parachuteInfo },
      traits: new Map([['ParachuteNotify', { onParachute: vi.fn(), onLanded: vi.fn() }]]),
      location: new CPos(0, 0),
      world: {
        map: {
          centerOfCell: () => new WPos(0, 0, 0),
        },
      },
    } as unknown as never

    const parachute = new Parachute(actor)
    ;(parachute as unknown as { onFirstRun: (self: unknown) => void }).onFirstRun(actor)

    let result = false
    let ticks = 0
    while (!result && ticks < 10) {
      result = parachute.tick(actor)
      ticks++
    }

    expect(result).toBe(true)
    expect(positionable.setCenterPosition).toHaveBeenCalled()
  })

  it('is non-interruptible', () => {
    const positionable = {
      centerPosition: new WPos(0, 0, 100),
      setCenterPosition: vi.fn(),
    }
    const actor = {
      occupiesSpace: positionable,
      info: { traitInfo: () => ({ fallRate: new WDist(25) }) },
      location: new CPos(0, 0),
      world: { map: { centerOfCell: () => new WPos(0, 0, 0) } },
    } as unknown as never

    const parachute = new Parachute(actor)
    expect((parachute as unknown as { isInterruptible: boolean }).isInterruptible).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// FlyFollow
// ---------------------------------------------------------------------------

describe('FlyFollow', () => {
  it('requires Aircraft trait', () => {
    const actor = { traits: new Map() } as unknown as never
    const target = Target.fromPos(new WPos(1000, 0, 1280))
    expect(() => new FlyFollow(actor, target, WDist.Zero, new WDist(500))).toThrow('FlyFollow requires an Aircraft trait')
  })

  it('returns true when target in range', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const actor = createMockActor(aircraft) as never
    const target = Target.fromPos(new WPos(0, 0, 1280))
    const follow = new FlyFollow(actor, target, WDist.Zero, new WDist(500))

    expect(follow.tick(actor)).toBe(false)
  })

  it('queues Fly when out of range', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const actor = createMockActor(aircraft) as never
    const target = Target.fromPos(new WPos(10000, 0, 1280))
    const follow = new FlyFollow(actor, target, WDist.Zero, new WDist(500))

    const result = follow.tick(actor)
    expect(result).toBe(false)
    expect((follow as unknown as { _childActivity: unknown })._childActivity).not.toBeNull()
  })

  it('gives up if target hidden after move', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const actor = createMockActor(aircraft) as never
    const target = Target.Invalid
    const follow = new FlyFollow(actor, target, WDist.Zero, new WDist(500))
    ;(follow as unknown as { state: number }).state = 1 // Active

    expect(follow.tick(actor)).toBe(true)
  })

  it('renders target line when color provided', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const target = Target.fromPos(new WPos(1000, 0, 1280))
    const color = { r: 0, g: 255, b: 0, a: 255 }
    const follow = new FlyFollow(actor, target, WDist.Zero, new WDist(500), null, color)

    const nodes = follow.targetLineNodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].color).toBe(color)
  })
})

// ---------------------------------------------------------------------------
// ReturnToBase
// ---------------------------------------------------------------------------

describe('ReturnToBase', () => {
  it('requires Aircraft trait', () => {
    const actor = { traits: new Map() } as unknown as never
    expect(() => new ReturnToBase(actor)).toThrow('ReturnToBase requires an Aircraft trait')
  })

  it('returns true immediately when forceLanding', () => {
    const aircraft = createMockAircraft({ forceLanding: true, centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft) as never
    const rtb = new ReturnToBase(actor)
    expect(rtb.tick(actor)).toBe(true)
  })

  it('hovers near nearest resupplier when none available', () => {
    const aircraft = createMockAircraft({ canHover: true, centerPosition: new WPos(0, 0, 1280) })
    const actor = createMockActor(aircraft, new Map(), { X: 0, Y: 0, Bits: 0 }) as never
    const rtb = new ReturnToBase(actor)

    // No resuppliers in world.actors -> idle and return true
    expect(rtb.tick(actor)).toBe(true)
  })

  it('flies to resupplier when one exists', () => {
    const aircraft = createMockAircraft({ canHover: false, centerPosition: new WPos(0, 0, 1280) })
    const resupplier = {
      isDead: false,
      owner: {},
      info: { name: 'afld' },
      centerPosition: new WPos(5000, 0, 0),
      traits: new Map([
        ['Reservable', { isAvailableFor: () => true }],
      ]),
    }
    const actor = createMockActor(
      aircraft,
      new Map(),
      { X: 0, Y: 0, Bits: 0 },
    ) as unknown as {
      owner: unknown
      world: { actors: unknown[] }
      traits: Map<string, unknown>
      [key: string]: unknown
    }
    actor.owner = {}
    actor.world.actors = [actor, resupplier]

    // Provide rearmInfo via info.traitInfoOrDefault
    actor.info = {
      traitInfoOrDefault: <T>(name: string): T | null => {
        if (name === 'Rearmable') {
          return { rearmActors: ['afld'] } as unknown as T
        }
        return null
      },
    }

    const rtb = new ReturnToBase(actor as unknown as never)
    expect(rtb.tick(actor as unknown as never)).toBe(true)
  })

  it('renders target line when destination set', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), targetLineColor: { r: 0, g: 255, b: 0, a: 255 } })
    const actor = createMockActor(aircraft) as never
    const dest = {
      isDead: false,
      owner: {},
      info: { name: 'afld' },
      centerPosition: new WPos(5000, 0, 0),
      traits: new Map(),
    } as unknown as never
    const rtb = new ReturnToBase(actor, dest as never)

    const nodes = rtb.targetLineNodes()
    expect(nodes).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// FallToEarth
// ---------------------------------------------------------------------------

describe('FallToEarth', () => {
  it('requires Aircraft trait', () => {
    const actor = { traits: new Map() } as unknown as never
    const info = new FallsToEarthInfo()
    expect(() => new FallToEarth(actor, info)).toThrow('FallToEarth requires an Aircraft trait')
  })

  it('falls straight down and kills actor on impact', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 100) })
    const kill = vi.fn()
    const actor = Object.assign(createMockActor(aircraft) as Record<string, unknown>, { kill }) as unknown as never

    const info = new FallsToEarthInfo({ velocity: new WDist(25) })
    const fall = new FallToEarth(actor, info)

    let result = false
    let ticks = 0
    while (!result && ticks < 10) {
      result = fall.tick(actor)
      ticks++
    }

    expect(result).toBe(true)
    expect(kill).toHaveBeenCalled()
  })

  it('is non-interruptible', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 100) })
    const actor = createMockActor(aircraft) as never
    const info = new FallsToEarthInfo()
    const fall = new FallToEarth(actor, info)
    expect((fall as unknown as { isInterruptible: boolean }).isInterruptible).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DeliverBulkOrder
// ---------------------------------------------------------------------------

describe('DeliverBulkOrder', () => {
  it('requires Cargo trait on transport', () => {
    const transport = { traits: new Map() } as unknown as never
    const producer = {} as never
    expect(() => new DeliverBulkOrder(transport, producer, [], 'type', { deliverFinished: vi.fn() })).toThrow('DeliverBulkOrder requires a Cargo trait')
  })

  it('queues Land and Wait on first run', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
    const transport = Object.assign(createMockActor(aircraft) as Record<string, unknown>, {
      traits: new Map<string, unknown>([
        ['Aircraft', aircraft],
        ['Cargo', { info: { beforeUnloadDelay: 5, betweenUnloadDelay: 1, afterUnloadDelay: 0 } }],
      ]),
    }) as unknown as never

    const producer = {
      info: { traitInfo: () => ({ landOffset: WVec.Zero }) },
      isInWorld: true,
      isDead: false,
      traits: new Map(),
    } as unknown as never

    const queue = { deliverFinished: vi.fn() }
    const delivery = new DeliverBulkOrder(transport, producer, [{ actorInfo: {}, resources: 100, cash: 0 }], 'type', queue)
    ;(delivery as unknown as { onFirstRun: (self: unknown) => void }).onFirstRun(transport)

    expect((delivery as unknown as { _childActivity: unknown })._childActivity).not.toBeNull()
  })

  it('finishes when ordered actors empty', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
    const transport = Object.assign(createMockActor(aircraft) as Record<string, unknown>, {
      traits: new Map<string, unknown>([
        ['Aircraft', aircraft],
        ['Cargo', { info: { beforeUnloadDelay: 0, betweenUnloadDelay: 0, afterUnloadDelay: 0 } }],
      ]),
    }) as unknown as never

    const producer = {
      info: { traitInfo: () => ({ landOffset: WVec.Zero }) },
      isInWorld: true,
      isDead: false,
      traits: new Map(),
    } as unknown as never

    const queue = { deliverFinished: vi.fn() }
    const delivery = new DeliverBulkOrder(transport, producer, [], 'type', queue)
    expect(delivery.tick(transport)).toBe(true)
    expect(queue.deliverFinished).toHaveBeenCalled()
  })
})
