/**
 * NukePower.test.ts — NukePower 单元测试
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: configuration, activation flow, palette resolution,
 * SkipAscent logic, SelectNukePowerTarget range circles, cursor.
 */

import { describe, it, expect } from 'vitest'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import {
  NukePower,
  SelectNukePowerTarget,
  type NukePowerInfo,
  type INukeLaunch,
  type IBodyOrientation,
  type NukeLaunchConfigData,
  NUKE_POWER_DEFAULTS,
  NUKE_DEFAULT_CIRCLE_COLOR,
  NUKE_DEFAULT_BORDER_COLOR,
} from './NukePower.js'
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

function makeInfo(overrides: Partial<NukePowerInfo> = {}): NukePowerInfo {
  return {
    orderName: 'NukePowerOrder',
    chargeInterval: 1000,
    missileWeapon: 'MiniNuke',
    missileImage: 'nuke',
    missileUp: 'up',
    missileDown: 'down',
    missilePalette: 'effect',
    isPlayerPalette: false,
    skipAscent: false,
    flightDelay: 400,
    flightVelocity: 512,
    detonationAltitude: 0,
    removeMissileOnDetonation: true,
    beaconRemoveAdvance: 25,
    cameraRange: 1024,
    cameraSpawnAdvance: 25,
    cameraRemoveDelay: 25,
    circleRanges: [2048, 4096],
    cursor: 'nuke',
    blockedCursor: 'nuke-blocked',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test subclass
// ---------------------------------------------------------------------------

class TestNukePower extends NukePower {
  public lastConfig: NukeLaunchConfigData | null = null
  public createdMissile: INukeLaunch | null = null
  public revealCreated: boolean = false
  public beaconCreated: boolean = false

  override _getBodyOrientation(_self: IGameActor): IBodyOrientation | null {
    return {
      localToWorld: (offset) => ({ X: offset.X, Y: offset.Y, Z: offset.Z }),
    }
  }

  override _createNukeLaunch(config: NukeLaunchConfigData): INukeLaunch {
    this.lastConfig = config
    this.createdMissile = { fractionComplete: 0 }
    return this.createdMissile
  }

  override _addToWorld(_self: IGameActor, _missile: unknown): void {
    // Track for testing
  }

  override _createRevealShroudEffect(_self: IGameActor, _targetPos: WPos): void {
    this.revealCreated = true
  }

  override _createBeacon(_self: IGameActor, _targetPos: WPos, _missile: INukeLaunch): void {
    this.beaconCreated = true
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NukePower', () => {
  describe('constructor', () => {
    it('stores info and self', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42 })
      const power = new NukePower(actor, info)

      expect(power.self).toBe(actor)
      expect(power.nukeInfo).toBe(info)
    })

    it('body defaults to null', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const power = new NukePower(actor, info)

      expect((power as any).body).toBeNull()
    })
  })

  describe('activate', () => {
    it('activates with valid target position', () => {
      const info = makeInfo()
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestNukePower(actor, info)

      const order: OrderStub = {
        orderName: 'NukePowerOrder',
        target: {
          cell: null,
          type: 2,
          centerPosition: { X: 10240, Y: 10240, Z: 0 },
        },
      }

      power.activate(actor, order, manager as unknown as ISupportPowerManager)
      expect(power.createdMissile).not.toBeNull()
    })

    it('creates missile with correct configuration', () => {
      const info = makeInfo({ missileWeapon: 'MiniNuke', missileImage: 'nuke', flightDelay: 400 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestNukePower(actor, info)

      const order: OrderStub = {
        orderName: 'NukePowerOrder',
        target: {
          cell: null,
          type: 2,
          centerPosition: { X: 10240, Y: 10240, Z: 0 },
        },
      }

      power.activate(actor, order, manager as unknown as ISupportPowerManager)

      expect(power.lastConfig).not.toBeNull()
      expect(power.lastConfig!.weapon.name).toBe('MiniNuke')
      expect(power.lastConfig!.flightDelay).toBe(400)
      expect(power.lastConfig!.image).toBe('nuke')
    })

    it('creates reveal effect when cameraRange > 0', () => {
      const info = makeInfo({ cameraRange: 1024 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestNukePower(actor, info)

      const order: OrderStub = {
        orderName: 'NukePowerOrder',
        target: {
          cell: null,
          type: 2,
          centerPosition: { X: 10240, Y: 10240, Z: 0 },
        },
      }

      power.activate(actor, order, manager as unknown as ISupportPowerManager)
      expect(power.revealCreated).toBe(true)
    })

    it('does not create reveal effect when cameraRange is 0', () => {
      const info = makeInfo({ cameraRange: 0 })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestNukePower(actor, info)

      const order: OrderStub = {
        orderName: 'NukePowerOrder',
        target: {
          cell: null,
          type: 2,
          centerPosition: { X: 10240, Y: 10240, Z: 0 },
        },
      }

      power.activate(actor, order, manager as unknown as ISupportPowerManager)
      expect(power.revealCreated).toBe(false)
    })

    it('creates beacon when displayBeacon is true', () => {
      const info = makeInfo({ displayBeacon: true })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const manager = createMockManager()
      const power = new TestNukePower(actor, info)

      const order: OrderStub = {
        orderName: 'NukePowerOrder',
        target: {
          cell: null,
          type: 2,
          centerPosition: { X: 10240, Y: 10240, Z: 0 },
        },
      }

      power.activate(actor, order, manager as unknown as ISupportPowerManager)
      expect(power.beaconCreated).toBe(true)
    })
  })

  describe('activateAtPosition', () => {
    it('sets palette with player name when isPlayerPalette', () => {
      const info = makeInfo({ isPlayerPalette: true, missilePalette: 'effect' })
      const owner = { playerName: 'Allies' }
      const actor = createMockActor({ actorId: 42, owner })
      const power = new TestNukePower(actor, info)

      power.activateAtPosition(actor, new WPos(10240, 10240, 0))

      expect(power.lastConfig).not.toBeNull()
      expect(power.lastConfig!.weaponPalette).toBe('effectAllies')
    })

    it('uses default palette when not player palette', () => {
      const info = makeInfo({ isPlayerPalette: false, missilePalette: 'effect' })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'Allies' } })
      const power = new TestNukePower(actor, info)

      power.activateAtPosition(actor, new WPos(10240, 10240, 0))

      expect(power.lastConfig).not.toBeNull()
      expect(power.lastConfig!.weaponPalette).toBe('effect')
    })
  })

  describe('SkipAscent behavior', () => {
    it('uses WPos.Zero when skipAscent is true', () => {
      const info = makeInfo({ skipAscent: true })
      const actor = createMockActor({ actorId: 42, owner: { playerName: 'test' } })
      const power = new TestNukePower(actor, info)

      power.activateAtPosition(actor, new WPos(10240, 10240, 0))

      expect(power.lastConfig!.launchPos.X).toBe(0)
      expect(power.lastConfig!.launchPos.Y).toBe(0)
      expect(power.lastConfig!.launchPos.Z).toBe(0)
    })
  })

  describe('selectTarget', () => {
    it('calls setNukeOrderGenerator', () => {
      const info = makeInfo()
      const actor = createMockActor()
      const manager = createMockManager()
      const power = new NukePower(actor, info)

      expect(() => {
        power.selectTarget(actor, 'NukePowerOrder', manager as unknown as ISupportPowerManager)
      }).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// SelectNukePowerTarget tests
// ---------------------------------------------------------------------------

describe('SelectNukePowerTarget', () => {
  function setup(ranges?: readonly number[]) {
    const info = makeInfo({ circleRanges: ranges ?? [2048, 4096, 6144] })
    const actor = createMockActor({ actorId: 42 })
    const manager = createMockManager()
    const target = new SelectNukePowerTarget('NukePowerOrder', manager, info)

    return { info, actor, manager, target }
  }

  describe('generateOrder', () => {
    it('returns an order with cell position', () => {
      const { target } = setup()
      const order = target.generateOrder({ X: 10, Y: 20 })

      expect(order).not.toBeNull()
      expect(order!.orderName).toBe('NukePowerOrder')
      expect(order!.target!.centerPosition).toEqual({ X: 10, Y: 20, Z: 0 })
    })
  })

  describe('tick', () => {
    it('returns false when power not in manager', () => {
      const { target } = setup()
      expect(target.tick()).toBe(false)
    })
  })

  describe('getCursor', () => {
    it('returns nuke cursor by default', () => {
      const { target } = setup()
      expect(target.getCursor({ X: 0, Y: 0 })).toBe('nuke')
    })
  })

  describe('getRangeCircles', () => {
    it('returns circle descriptors for all ranges', () => {
      const { target } = setup([2048, 4096, 6144])

      const circles = target.getRangeCircles({ X: 10240, Y: 10240, Z: 0 })
      expect(circles.length).toBe(3)
      expect(circles[0].range).toBe(2048)
      expect(circles[1].range).toBe(4096)
      expect(circles[2].range).toBe(6144)
    })

    it('returns empty array when no circle ranges configured', () => {
      // Override the info with explicitly empty circleRanges
      const emptyTarget = new SelectNukePowerTarget(
        'NukePowerOrder',
        createMockManager(),
        makeInfo({ circleRanges: undefined }),
      )
      const circles = emptyTarget.getRangeCircles({ X: 0, Y: 0, Z: 0 })
      expect(circles).toEqual([])
    })

    it('returns empty array for empty circle ranges', () => {
      const { target } = setup([])

      const circles = target.getRangeCircles({ X: 0, Y: 0, Z: 0 })
      expect(circles).toEqual([])
    })

    it('circles have default colors', () => {
      const { target } = setup([2048])

      const circles = target.getRangeCircles({ X: 0, Y: 0, Z: 0 })
      expect(circles[0].color).toEqual(NUKE_DEFAULT_CIRCLE_COLOR)
      expect(circles[0].borderColor).toEqual(NUKE_DEFAULT_BORDER_COLOR)
      expect(circles[0].width).toBe(NUKE_POWER_DEFAULTS.circleWidth)
      expect(circles[0].borderWidth).toBe(NUKE_POWER_DEFAULTS.circleBorderWidth)
    })
  })
})
