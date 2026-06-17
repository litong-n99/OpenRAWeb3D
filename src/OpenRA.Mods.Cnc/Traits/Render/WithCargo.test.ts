/**
 * WithCargo.test.ts — Unit tests
 *
 * Tests focus on: passenger tracking, preview generation, facing change detection.
 */

import { describe, it, expect } from 'vitest'
import {
  WithCargo,
  WithCargoInfo,
  type ICargoBodyOrientation,
  type ICargoFacing,
  type ICargoAccess,
} from './WithCargo.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'

function makeBody(): ICargoBodyOrientation {
  return {
    quantizeOrientation: () => 0,
    quantizeFacing: () => 0,
    localToWorld: (w: WVec) => w,
  }
}

function makeFacing(angle: number): ICargoFacing {
  return { facing: { angle } as unknown as ICargoFacing['facing'] }
}

function makeCargo(passengerCount: number): ICargoAccess {
  return { passengerCount }
}

function makeActor(
  cargo: ICargoAccess,
  body: ICargoBodyOrientation,
  facing: ICargoFacing | null,
): IGameActor {
  return {
    trait(name: string): unknown {
      if (name === 'Cargo') return cargo
      if (name === 'BodyOrientation') return body
      return null
    },
    traitOrDefault(name: string): unknown {
      if (name === 'IFacing') return facing
      return null
    },
    orientation: 0,
    centerPosition: { x: 0, y: 0, z: 0 },
    world: { screenMap: { addOrUpdate() {} } },
  } as unknown as IGameActor
}

describe('WithCargoInfo', () => {
  it('should have default values', () => {
    const info = new WithCargoInfo()
    expect(info.localOffset).toEqual([WVec.Zero])
    expect(info.displayTypes.size).toBe(0)
  })

  it('should accept custom display types', () => {
    const displayTypes = new Set(['Passenger', 'Crushable'])
    const info = new WithCargoInfo({ displayTypes })
    expect(info.displayTypes).toBe(displayTypes)
  })
})

describe('WithCargo', () => {
  it('should start with 0 passengers', () => {
    const cargo = makeCargo(0)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo()
    const trait = new WithCargo(actor, info)

    expect(trait.passengerCount).toBe(0)
  })

  it('should add passenger on enter', () => {
    const cargo = makeCargo(1)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const passenger = {
      trait(name: string): unknown {
        if (name === 'Passenger') return { info: { cargoType: 'Passenger' } }
        return null
      },
      actorId: 'passenger-1',
    } as unknown as IGameActor

    trait.onPassengerEntered(actor, passenger)
    expect(trait.passengerCount).toBe(1)
  })

  it('should not add passenger if cargo type not in displayTypes', () => {
    const cargo = makeCargo(0)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const passenger = {
      trait(name: string): unknown {
        if (name === 'Passenger') return { info: { cargoType: 'Vehicle' } }
        return null
      },
      actorId: 'passenger-2',
    } as unknown as IGameActor

    trait.onPassengerEntered(actor, passenger)
    expect(trait.passengerCount).toBe(0)
  })

  it('should remove passenger on exit', () => {
    const cargo = makeCargo(1)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const passenger = {
      trait(name: string): unknown {
        if (name === 'Passenger') return { info: { cargoType: 'Passenger' } }
        return null
      },
      actorId: 'passenger-3',
    } as unknown as IGameActor

    trait.onPassengerEntered(actor, passenger)
    expect(trait.passengerCount).toBe(1)

    trait.onPassengerExited(actor, passenger)
    expect(trait.passengerCount).toBe(0)
  })

  it('should tick without errors when no passengers', () => {
    const cargo = makeCargo(0)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo()
    const trait = new WithCargo(actor, info)

    expect(() => trait.tick(actor)).not.toThrow()
  })

  it('should handle render with no passengers', () => {
    const cargo = makeCargo(0)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo()
    const trait = new WithCargo(actor, info)

    const wr = { screenPosition: () => ({ x: 0, y: 0 }) }
    const result = trait.render(actor, wr as any)
    expect(Array.isArray(result)).toBe(true)
  })

  it('should dispose cleanly', () => {
    const cargo = makeCargo(0)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo()
    const trait = new WithCargo(actor, info)

    expect(() => trait.dispose()).not.toThrow()
  })
})
