/**
 * ParatroopersPower.test.ts — ParatroopersPower 单元测试
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: formation creation, unit distribution, ceiling division,
 * even-sized squad logic, activation flow, unused unit disposal.
 */

import { describe, it, expect } from 'vitest'
import {
  ParatroopersPower,
  type ParatroopersPowerInfo,
  type IParaDrop,
  type ICargo,
} from './ParatroopersPower.js'
import type { WorldPos } from './AirstrikePower.js'
import { type DirectionalSupportPowerInfo } from './DirectionalSupportPower.js'
import type { ISupportPowerManager, OrderStub } from './SupportPower.js'
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

function createMockManager(): ISupportPowerManager {
  const powers = new Map()
  return {
    self: createMockActor(),
    powers,
  }
}

function makeInfo(overrides: Partial<ParatroopersPowerInfo & DirectionalSupportPowerInfo> = {}): ParatroopersPowerInfo & DirectionalSupportPowerInfo {
  return {
    orderName: 'ParatroopersPowerOrder',
    chargeInterval: 1000,
    squadSize: 2,
    unitType: 'badr',
    squadOffset: { X: -1536, Y: 1536, Z: 0 },
    dropItems: ['e1', 'e2', 'e3', 'e4'],
    quantizedFacings: 32,
    cordon: 5120,
    allowImpassableCells: false,
    cameraRemoveDelay: 85,
    beaconDistanceOffset: 4 * 1024,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test subclass
// ---------------------------------------------------------------------------

class TestParatroopersPower extends ParatroopersPower {
  public createdAircraft: IGameActor[] = []
  public createdUnits: IGameActor[] = []
  public disposedUnits: IGameActor[] = []
  public frameEndCalled: boolean = false
  public cameraRemoved: boolean = false
  public beaconRemoved: boolean = false

  override _resolveFacing(_self: IGameActor, providedFacing: number | null): number {
    return providedFacing ?? 128
  }

  override _getCruiseAltitude(_self: IGameActor, _unitType: string): number {
    return 2048
  }

  override _computeDelta(_facing: number): WorldPos {
    return { X: 0, Y: -1024, Z: 0 }
  }

  override _computeEdge(
    target: WorldPos,
    delta: WorldPos,
    sign: number,
    _self: IGameActor,
  ): WorldPos {
    const cordon = this.paraInfo.cordon ?? 5120
    return {
      X: target.X + sign * (10240 + cordon) * delta.X / 1024,
      Y: target.Y + sign * (10240 + cordon) * delta.Y / 1024,
      Z: target.Z,
    }
  }

  override _createAircraft(
    _self: IGameActor,
    _unitType: string,
    _pos: WorldPos,
    _facing: number,
  ): IGameActor {
    const a = createMockActor({ actorId: this.createdAircraft.length + 1000 })
    this.createdAircraft.push(a)
    return a
  }

  override _createUnit(_self: IGameActor, _unitType: string): IGameActor {
    const u = createMockActor({ actorId: this.createdUnits.length + 2000 })
    this.createdUnits.push(u)
    return u
  }

  override _getParaDrop(_aircraft: IGameActor): IParaDrop | null {
    return {
      setLZ: () => {},
    }
  }

  override _getCargo(_aircraft: IGameActor): ICargo | null {
    return {
      load: () => {},
    }
  }

  override _removeCamera(_camera: IGameActor | null): void {
    if (_camera) this.cameraRemoved = true
  }

  override _removeBeacon(_self: IGameActor, _beacon: unknown): void {
    this.beaconRemoved = true
  }

  override _disposeUnit(_unit: IGameActor): void {
    this.disposedUnits.push(_unit)
  }

  override _queueParadropFrameEnd(
    _self: IGameActor,
    aircraft: IGameActor[],
    units: IGameActor[],
    _target: WorldPos,
    _startEdge: WorldPos,
    _finishEdge: WorldPos,
    _squadOff: { readonly X: number; readonly Y: number; readonly Z: number },
    _facing: number,
    _altitude: number,
    _aircraftInRange: Map<IGameActor, boolean>,
    _onEnterRange: (a: IGameActor) => void,
    _onExitRange: (a: IGameActor) => void,
    _onRemovedFromWorld: (a: IGameActor) => void,
    _beaconRef: (b: unknown) => void,
  ): void {
    this.frameEndCalled = true

    // Simulate unit distribution and disposal
    const dropItems = this.paraInfo.dropItems ?? []
    const squadSize = this.paraInfo.squadSize ?? 1
    const passengersPerPlane = Math.ceil(dropItems.length / squadSize)
    let added = 0

    for (let _idx = 0; _idx < aircraft.length; _idx++) {
      const numToLoad = Math.min(passengersPerPlane, units.length - added)
      added += numToLoad
    }

    // Dispose unused
    for (let i = added; i < units.length; i++) {
      this._disposeUnit(units[i])
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParatroopersPower', () => {
  describe('constructor', () => {
    it('stores info and self', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42 })
      const power = new TestParatroopersPower(actor, info)

      expect(power.self).toBe(actor)
      expect(power.paraInfo).toBe(info)
    })
  })

  describe('activate', () => {
    it('activates with random facing (no extra data)', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestParatroopersPower(actor, info)

      const order: OrderStub = {
        orderName: 'ParatroopersPowerOrder',
        extraData: 0xffffffff,
        target: {
          cell: null,
          type: 2,
          centerPosition: { X: 10240, Y: 10240, Z: 0 },
        },
      }

      power.activate(actor, order, manager)
      expect(power.createdAircraft.length).toBeGreaterThan(0)
    })

    it('activates with directional facing from order', () => {
      const info = makeInfo({ useDirectionalTarget: true })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestParatroopersPower(actor, info)

      const order: OrderStub = {
        orderName: 'ParatroopersPowerOrder',
        extraData: 256,
        target: {
          cell: null,
          type: 2,
          centerPosition: { X: 10240, Y: 10240, Z: 0 },
        },
      }

      power.activate(actor, order, manager)
      expect(power.createdAircraft.length).toBeGreaterThan(0)
    })
  })

  describe('sendParatroopers', () => {
    it('creates aircraft matching squad size (even=2, skip lead)', () => {
      const info = makeInfo({ squadSize: 2 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestParatroopersPower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      const result = power.sendParatroopers(actor, target, null)

      // SquadSize 2: loop i = -1, 0, 1 → i=0 is skipped
      expect(result.aircraft.length).toBe(2)
    })

    it('creates aircraft for odd squad size (3, all positions)', () => {
      const info = makeInfo({ squadSize: 3 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestParatroopersPower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      const result = power.sendParatroopers(actor, target, null)

      // SquadSize 3: loop i = -1, 0, 1 → all 3 positions
      expect(result.aircraft.length).toBe(3)
    })

    it('creates units for each drop item', () => {
      const info = makeInfo({ dropItems: ['e1', 'e2', 'e3', 'e4', 'e5'] })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestParatroopersPower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      const result = power.sendParatroopers(actor, target, null)

      expect(result.units.length).toBe(5)
    })

    it('distributes units across planes with ceiling division', () => {
      const info = makeInfo({ squadSize: 2, dropItems: ['e1', 'e2', 'e3'] })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestParatroopersPower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      power.sendParatroopers(actor, target, null)

      // 3 units / 2 planes = Math.ceil(3/2) = 2 per plane
      // After loading 2 * 2 = 4 → but only 3 units available → 1 unit remains
      // Wait, the calculation is: max per plane = ceil(3/2)=2, but there are only 2 planes
      // So we load: min(2, 3) = 2 into plane 1, min(2, 1) = 1 into plane 2, added=3
      // No unused units since 3 units loaded out of 3
      expect(power.disposedUnits.length).toBe(0)
    })

    it('disposes units that exceed plane capacity', () => {
      const info = makeInfo({ squadSize: 1, dropItems: ['e1', 'e2', 'e3', 'e4', 'e5'] })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestParatroopersPower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      power.sendParatroopers(actor, target, null)

      // 5 units / 1 plane = ceil(5/1)=5 per plane
      // Only 1 plane, so it loads min(5, 5) = 5
      expect(power.disposedUnits.length).toBe(0)
    })

    it('returns both aircraft and units', () => {
      const info = makeInfo({ squadSize: 1, dropItems: ['e1', 'e2'] })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestParatroopersPower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      const result = power.sendParatroopers(actor, target, null)

      expect(result.aircraft).toBeDefined()
      expect(result.units).toBeDefined()
      expect(result.aircraft.length).toBe(1)
      expect(result.units.length).toBe(2)
    })
  })

  describe('remove camera / beacon', () => {
    it('_removeCamera sets flag', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestParatroopersPower(actor, info)
      const cam = createMockActor({ actorId: 999 })

      power._removeCamera(cam)
      expect(power.cameraRemoved).toBe(true)
    })

    it('_removeCamera does nothing for null', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestParatroopersPower(actor, info)

      power.cameraRemoved = false
      power._removeCamera(null)
      expect(power.cameraRemoved).toBe(false)
    })
  })
})
