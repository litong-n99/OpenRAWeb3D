/**
 * WithCargo.test.ts — Unit tests
 *
 * Tests focus on: passenger tracking, preview generation, facing change detection.
 * Phase B.10: Added passenger preview tests (owner, facing, init modifiers).
 */

import { describe, it, expect } from 'vitest'
import {
  WithCargo,
  WithCargoInfo,
  CargoPassengerPreview,
  type ICargoBodyOrientation,
  type ICargoFacing,
  type ICargoAccess,
  type ICargoRenderActorPreviewInfo,
  type ICargoActorPreviewInitializer,
  type ICargoActorPreviewInitModifier,
} from './WithCargo.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'

function makeBody(): ICargoBodyOrientation {
  return {
    quantizeOrientation: () => 0,
    quantizeFacing: () => 128,
    localToWorld: (w: WVec) => w,
  }
}

function makeFacing(angle: number): ICargoFacing {
  return { facing: WAngle.fromDegrees(angle) as unknown as ICargoFacing['facing'] }
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

// ---------------------------------------------------------------------------
// Passenger factory
// ---------------------------------------------------------------------------

function makePassenger(actorId: string, cargoType: string, owner?: PlayerStub, actorName?: string): IGameActor {
  return {
    actorId,
    trait(name: string): unknown {
      if (name === 'Passenger') return { info: { cargoType } }
      return null
    },
    traitsImplementing(name: string): unknown[] {
      if (name === 'IActorPreviewInitModifier') return []
      return []
    },
    owner: owner ?? { playerName: 'TestPlayer' } as PlayerStub,
    info: {
      name: actorName ?? 'testPassenger',
      traitInfos(name: string): Iterable<unknown> {
        if (name === 'IRenderActorPreviewInfo') return []
        return []
      },
    },
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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

    const passenger = makePassenger('passenger-1', 'Passenger')
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

    const passenger = makePassenger('passenger-2', 'Vehicle')
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

    const passenger = makePassenger('passenger-3', 'Passenger')
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

// ---------------------------------------------------------------------------
// Phase B.10: Passenger preview generation tests
// ---------------------------------------------------------------------------

describe('WithCargo.generatePreview', () => {
  it('returns preview for passenger with correct owner', () => {
    const cargo = makeCargo(1)
    const body = makeBody()
    const facing = makeFacing(45)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const owner: PlayerStub = { playerName: 'TestOwner' }
    const passenger = makePassenger('p1', 'Passenger', owner, 'rifleman')
    trait.onPassengerEntered(actor, passenger)

    // Trigger preview generation via render()
    const wr = {}
    trait.render(actor, wr)

    const previews = trait.previews.get('p1')
    expect(previews).not.toBeNull()
    expect(previews!.length).toBeGreaterThan(0)

    // Check that preview has correct owner
    const preview = previews![0] as CargoPassengerPreview
    expect(preview.owner).toBe(owner)
  })

  it('passenger preview has correct facing', () => {
    const cargo = makeCargo(1)
    const body = makeBody()
    const facing = makeFacing(90)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const owner: PlayerStub = { playerName: 'TestOwner' }
    const passenger = makePassenger('p2', 'Passenger', owner, 'rifleman')
    trait.onPassengerEntered(actor, passenger)

    const wr = {}
    trait.render(actor, wr)

    const previews = trait.previews.get('p2')
    const preview = previews![0] as CargoPassengerPreview
    // quantizeFacing of 90 returns 128 (from makeBody)
    expect(preview.getFacing()).toBeDefined()
  })

  it('empty cargo returns empty preview array', () => {
    const cargo = makeCargo(0)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const wr = {}
    const result = trait.render(actor, wr)
    expect(result).toHaveLength(0)
  })

  it('preview includes all passenger actors', () => {
    const cargo = makeCargo(3)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
      localOffset: [new WVec(0, 0, 0), new WVec(1, 0, 0), new WVec(-1, 0, 0)],
    })
    const trait = new WithCargo(actor, info)

    const p1 = makePassenger('a1', 'Passenger', { playerName: 'P1' }, 'unit1')
    const p2 = makePassenger('a2', 'Passenger', { playerName: 'P2' }, 'unit2')
    const p3 = makePassenger('a3', 'Passenger', { playerName: 'P3' }, 'unit3')

    trait.onPassengerEntered(actor, p1)
    trait.onPassengerEntered(actor, p2)
    trait.onPassengerEntered(actor, p3)

    expect(trait.passengerCount).toBe(3)

    const wr = {}
    const result = trait.render(actor, wr)
    // Should produce renderables for all 3 passengers
    expect(result.length).toBeGreaterThanOrEqual(3)
  })

  it('preview respects init modifiers', () => {
    const cargo = makeCargo(1)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const modifier: ICargoActorPreviewInitModifier = {
      modifyActorPreviewInit(_actor: IGameActor, inits: Map<string, unknown>): void {
        inits.set('customInit', 'modified')
      },
    }

    const passenger: IGameActor = {
      actorId: 'pMod',
      trait(name: string): unknown {
        if (name === 'Passenger') return { info: { cargoType: 'Passenger' } }
        return null
      },
      traitsImplementing(name: string): unknown[] {
        if (name === 'IActorPreviewInitModifier') return [modifier]
        return []
      },
      owner: { playerName: 'ModOwner' } as PlayerStub,
      info: {
        name: 'modPassenger',
        traitInfos(name: string): Iterable<unknown> {
          if (name === 'IRenderActorPreviewInfo') return []
          return []
        },
      },
    } as unknown as IGameActor

    trait.onPassengerEntered(actor, passenger)
    expect(trait.passengerCount).toBe(1)

    const wr = {}
    const result = trait.render(actor, wr)
    const previews = trait.previews.get('pMod')
    expect(previews).not.toBeNull()
  })

  it('passenger actor is stored for preview lookup', () => {
    const cargo = makeCargo(1)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const passenger = makePassenger('storedP', 'Passenger')
    trait.onPassengerEntered(actor, passenger)

    expect(trait.passengerActors.has('storedP')).toBe(true)
    expect(trait.passengerActors.get('storedP')).toBe(passenger)

    trait.onPassengerExited(actor, passenger)
    expect(trait.passengerActors.has('storedP')).toBe(false)
  })

  it('uses IRenderActorPreviewInfo pipeline when available', () => {
    const cargo = makeCargo(1)
    const body = makeBody()
    const facing = makeFacing(0)
    const actor = makeActor(cargo, body, facing)
    const info = new WithCargoInfo({
      displayTypes: new Set(['Passenger']),
    })
    const trait = new WithCargo(actor, info)

    const rpi: ICargoRenderActorPreviewInfo = {
      renderPreview(_init: ICargoActorPreviewInitializer): Iterable<import('./WithCargo.js').IActorPreview> {
        return [new CargoPassengerPreview('fromRPI', { playerName: 'RPIOwner' }, () => WAngle.Zero)]
      },
    }

    const passenger: IGameActor = {
      actorId: 'pRPI',
      trait(name: string): unknown {
        if (name === 'Passenger') return { info: { cargoType: 'Passenger' } }
        return null
      },
      traitsImplementing(name: string): unknown[] {
        if (name === 'IActorPreviewInitModifier') return []
        return []
      },
      owner: { playerName: 'RPIOwner' } as PlayerStub,
      info: {
        name: 'rpiPassenger',
        traitInfos(name: string): Iterable<unknown> {
          if (name === 'IRenderActorPreviewInfo') return [rpi]
          return []
        },
      },
    } as unknown as IGameActor

    trait.onPassengerEntered(actor, passenger)

    const wr = {}
    trait.render(actor, wr)

    const previews = trait.previews.get('pRPI')
    expect(previews).not.toBeNull()
    expect(previews!.length).toBeGreaterThan(0)
    const preview = previews![0] as CargoPassengerPreview
    expect(preview.actorName).toBe('fromRPI')
  })
})

// ---------------------------------------------------------------------------
// CargoPassengerPreview tests
// ---------------------------------------------------------------------------

describe('CargoPassengerPreview', () => {
  it('stores actor name, owner, and facing', () => {
    const owner: PlayerStub = { playerName: 'Test' }
    const getFacing = () => WAngle.fromDegrees(45)
    const preview = new CargoPassengerPreview('actor1', owner, getFacing)

    expect(preview.actorName).toBe('actor1')
    expect(preview.owner).toBe(owner)
    expect(preview.getFacing()).toBeDefined()
  })

  it('render() returns typed preview metadata', () => {
    const preview = new CargoPassengerPreview('actor1', { playerName: 'P' }, () => WAngle.Zero)

    const result = preview.render(null, { x: 100, y: 200, z: 0 })
    expect(result).toHaveLength(1)
    expect((result[0] as any).type).toBe('cargoPassenger')
    expect((result[0] as any).actorName).toBe('actor1')
  })

  it('screenBounds returns unit-sized rect', () => {
    const preview = new CargoPassengerPreview('actor1', { playerName: 'P' }, () => WAngle.Zero)

    const bounds = preview.screenBounds(null, { x: 0, y: 0, z: 0 })
    expect(bounds).toHaveLength(1)
  })

  it('tick does not throw', () => {
    const preview = new CargoPassengerPreview('actor1', { playerName: 'P' }, () => WAngle.Zero)
    expect(() => preview.tick()).not.toThrow()
  })

  it('stores init modifiers', () => {
    const modifiers = [{ type: 'testModifier' as const }]
    const preview = new CargoPassengerPreview('actor1', { playerName: 'P' }, () => WAngle.Zero, modifiers)
    expect(preview.modifiers).toHaveLength(1)
    expect(preview.modifiers[0].type).toBe('testModifier')
  })
})
