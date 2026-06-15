/**
 * AirstrikePower.test.ts — AirstrikePower 单元测试
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: formation calculation, facing resolution, edge computation,
 * even-sized squad skip logic, activation flow.
 */

import { describe, it, expect } from 'vitest'
import {
  AirstrikePower,
  type AirstrikePowerInfo,
  type WorldPos,
  type AircraftState,
  type IAttackBomber,
} from './AirstrikePower.js'
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

function makeInfo(overrides: Partial<AirstrikePowerInfo & DirectionalSupportPowerInfo> = {}): AirstrikePowerInfo & DirectionalSupportPowerInfo {
  return {
    orderName: 'AirstrikePowerOrder',
    chargeInterval: 1000,
    squadSize: 3,
    unitType: 'badr.bomber',
    squadOffset: { X: -1536, Y: 1536, Z: 0 },
    quantizedFacings: 32,
    cordon: 5120,
    cameraRemoveDelay: 25,
    beaconDistanceOffset: 6 * 1024,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test subclass
// ---------------------------------------------------------------------------

class TestAirstrikePower extends AirstrikePower {
  // Track created aircraft for verification
  public createdAircraft: IGameActor[] = []
  public frameEndAircraft: IGameActor[] = []
  public cameraRemoved: boolean = false
  public beaconRemoved: boolean = false

  override _resolveFacing(_self: IGameActor, providedFacing: number | null): number {
    if (providedFacing !== null) return providedFacing
    return 128 // East-ish
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
    const cordon = this.airstrikeInfo.cordon ?? 5120
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
    _targetOffset: WorldPos,
  ): IGameActor {
    const a = createMockActor({ actorId: this.createdAircraft.length + 1000 })
    this.createdAircraft.push(a)
    return a
  }

  override _getAttackBomber(_aircraft: IGameActor): IAttackBomber | null {
    return {
      setTarget: () => {},
    }
  }

  override _removeCamera(_camera: IGameActor | null): void {
    if (_camera) this.cameraRemoved = true
  }

  override _removeBeacon(_self: IGameActor, _beacon: unknown): void {
    this.beaconRemoved = true
  }

  override _queueAirstrikeFrameEnd(
    _self: IGameActor,
    aircraft: IGameActor[],
    _target: WorldPos,
    _startEdge: WorldPos,
    _finishEdge: WorldPos,
    _target3d: WorldPos,
    _squadOff: { readonly X: number; readonly Y: number; readonly Z: number },
    _facing: number,
    _altitude: number,
    _aircraftStates: AircraftState[],
    _beaconRef: (b: unknown) => void,
  ): void {
    this.frameEndAircraft = aircraft
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AirstrikePower', () => {
  describe('constructor', () => {
    it('stores info and self', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42 })
      const power = new TestAirstrikePower(actor, info)

      expect(power.self).toBe(actor)
      expect(power.airstrikeInfo).toBe(info)
    })
  })

  describe('activate', () => {
    it('activates with target and random facing (no extra data)', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestAirstrikePower(actor, info)

      const order: OrderStub = {
        orderName: 'AirstrikePowerOrder',
        extraData: 0xffffffff, // NO_DIRECTION — use random
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
      const power = new TestAirstrikePower(actor, info)

      const order: OrderStub = {
        orderName: 'AirstrikePowerOrder',
        extraData: 256, // facing = East
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

  describe('sendAirstrike', () => {
    it('creates correct number of aircraft for odd squad size (3)', () => {
      const info = makeInfo({ squadSize: 3 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestAirstrikePower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      const result = power.sendAirstrike(actor, target, null)

      // SquadSize 3: loop i = -1, 0, 1 → all 3 should be created
      expect(result.length).toBe(3)
    })

    it('skips lead plane for even squad size (2)', () => {
      const info = makeInfo({ squadSize: 2 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestAirstrikePower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      const result = power.sendAirstrike(actor, target, null)

      // SquadSize 2: loop i = -1, 0, 1 → i=0 is skipped (even squad)
      expect(result.length).toBe(2)
      expect(result.length).not.toBe(3)
    })

    it('creates single aircraft for squad size 1', () => {
      const info = makeInfo({ squadSize: 1 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestAirstrikePower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      const result = power.sendAirstrike(actor, target, null)

      expect(result.length).toBe(1)
    })

    it('passes aircraft to frame-end queue', () => {
      const info = makeInfo({ squadSize: 3 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestAirstrikePower(actor, info)

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      power.sendAirstrike(actor, target, null)

      expect(power.frameEndAircraft.length).toBe(3)
      expect(power.frameEndAircraft).toEqual(power.createdAircraft)
    })

    it('uses provided facing when not null', () => {
      const info = makeInfo({ squadSize: 1 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestAirstrikePower(actor, info)

      let resolvedFacing = 0
      power._resolveFacing = (_self, provided) => {
        resolvedFacing = provided ?? -1
        return resolvedFacing
      }

      const target: WorldPos = { X: 10240, Y: 10240, Z: 0 }
      power.sendAirstrike(actor, target, 512)
      expect(resolvedFacing).toBe(512)
    })
  })

  describe('formation offset calculation', () => {
    it('computes spawn offset correctly for i=0 (center)', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestAirstrikePower(actor, info)
      const so = { X: -1536, Y: 1536, Z: 0 }

      const offset = (power as any)._computeSpawnOffset(0, so, 0)
      expect(offset.X).toBe(0)
      expect(offset.Y).toBe(0)
      expect(offset.Z).toBe(0)
    })

    it('computes spawn offset for i=1 (right wing)', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestAirstrikePower(actor, info)
      const so = { X: -1536, Y: 1536, Z: 0 }

      const offset = (power as any)._computeSpawnOffset(1, so, 0)
      expect(offset.X).toBe(1536) // i * so.Y = 1 * 1536
      expect(offset.Y).toBe(1536) // -|i| * so.X = -1 * (-1536) = 1536
      expect(offset.Z).toBe(0)
    })

    it('computes target offset for i=1', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestAirstrikePower(actor, info)
      const so = { X: -1536, Y: 1536, Z: 0 }

      const offset = (power as any)._computeTargetOffset(1, so, 0)
      expect(offset.X).toBe(1536)
      expect(offset.Y).toBe(0)
      expect(offset.Z).toBe(0)
    })
  })

  describe('remove camera / beacon', () => {
    it('_removeCamera sets flag', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestAirstrikePower(actor, info)

      const cam = createMockActor({ actorId: 999 })
      power._removeCamera(cam)
      expect(power.cameraRemoved).toBe(true)
    })

    it('_removeCamera does nothing for null', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestAirstrikePower(actor, info)

      power.cameraRemoved = false
      power._removeCamera(null)
      expect(power.cameraRemoved).toBe(false)
    })

    it('_removeBeacon sets flag', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new TestAirstrikePower(actor, info)

      power._removeBeacon(actor, {})
      expect(power.beaconRemoved).toBe(true)
    })
  })
})
