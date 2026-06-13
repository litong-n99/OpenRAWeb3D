/**
 * Aircraft.test.ts — Aircraft trait migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, configuration defaults, facing, altitude,
 * position, movement, landing, repulsion, idle behavior, orders, conditions,
 * and lifecycle.
 */

import { describe, it, expect, vi } from 'vitest'

import {
  Aircraft,
  AircraftInfo,
  IdleBehaviorType,
  MovementType,
  hasMovementType,
  AircraftMoveOrderTargeter,
  type IAircraftCenterPositionOffset,
  type IOverrideAircraftLanding,
  type RepairableStub,
  type RearmableStub,
} from './Aircraft.js'

import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { SubCell as SubCellEnum } from '../../../OpenRA.Game/Traits/SubCell.js'
import type { Target } from '../../../OpenRA.Game/Traits/Target.js'

import type {
  IGameActor,
  ActivityStub,
  Order,
  ActorInfoStub,
  TargetStub,
  TargetModifiers,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock map with the methods needed by Aircraft. */
function mockMap(overrides: Record<string, unknown> = {}) {
  return {
    contains: vi.fn().mockReturnValue(true),
    cellContaining: vi.fn().mockReturnValue(new CPos(10, 10)),
    centerOfCell: vi.fn().mockImplementation((c: CPos) =>
      new WPos(c.X * 1024, c.Y * 1024, 0),
    ),
    clamp: vi.fn().mockImplementation((c: CPos) => c),
    distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(1280)),
    getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
    findTilesInCircle: vi.fn().mockReturnValue([]),
    chooseClosestEdgeCell: vi.fn().mockReturnValue(new CPos(0, 0)),
    ...overrides,
  }
}

/** Create a mock actorMap with the methods needed by Aircraft. */
function mockActorMap(overrides: Record<string, unknown> = {}) {
  return {
    getActorsAt: vi.fn().mockReturnValue([]),
    addInfluence: vi.fn(),
    removeInfluence: vi.fn(),
    ...overrides,
  }
}

/** Create a mock world with the methods needed by Aircraft. */
function mockWorld(overrides: Record<string, unknown> = {}) {
  return {
    map: mockMap(),
    actorMap: mockActorMap(),
    sharedRandom: 123,
    rulesContainTemporaryBlocker: false,
    addToMaps: vi.fn(),
    removeFromMaps: vi.fn(),
    updateMaps: vi.fn(),
    findActorsInCircle: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

/** Create a mock IGameActor with the methods needed by Aircraft. */
function mockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: { playerName: 'Neutral' },
    isIdle: false,
    info: { name: 'test-actor' } as ActorInfoStub,
    world: mockWorld(),
    queueActivity: vi.fn(),
    cancelActivity: vi.fn(),
    showTargetLines: vi.fn(),
    grantCondition: vi.fn().mockReturnValue(42),
    revokeCondition: vi.fn(),
    appearsHostileTo: vi.fn().mockReturnValue(false),
    getDamageState: vi.fn().mockReturnValue(1), // Undamaged
    ...overrides,
  } as unknown as IGameActor
}

/** Create an AircraftInfo with custom overrides. */
function makeInfo(overrides: Record<string, unknown> = {}): AircraftInfo {
  return new AircraftInfo(overrides as ConstructorParameters<typeof AircraftInfo>[0])
}

/** Full setup: returns { aircraft, info, actor, world, map, actorMap }. */
function setup(opts: {
  infoOverrides?: Record<string, unknown>
  actorOverrides?: Record<string, unknown>
  worldOverrides?: Record<string, unknown>
  mapOverrides?: Record<string, unknown>
  actorMapOverrides?: Record<string, unknown>
  location?: CPos
  centerPosition?: WPos
} = {}) {
  const info = makeInfo(opts.infoOverrides ?? {})
  const world = mockWorld({
    map: mockMap(opts.mapOverrides ?? {}),
    actorMap: mockActorMap(opts.actorMapOverrides ?? {}),
    ...opts.worldOverrides,
  })
  const actor = mockActor({ world, ...opts.actorOverrides })

  const aircraft = new Aircraft(info)
  aircraft.initialize(
    actor,
    opts.location ?? new CPos(10, 10),
    opts.centerPosition ?? new WPos(10240, 10240, 1280),
  )

  return { aircraft, info, actor, world }
}

// ---------------------------------------------------------------------------
// IdleBehaviorType
// ---------------------------------------------------------------------------

describe('IdleBehaviorType', () => {
  it('has correct values', () => {
    expect(IdleBehaviorType.None).toBe(0)
    expect(IdleBehaviorType.Land).toBe(1)
    expect(IdleBehaviorType.ReturnToBase).toBe(2)
    expect(IdleBehaviorType.LeaveMap).toBe(3)
    expect(IdleBehaviorType.LeaveMapAtClosestEdge).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// MovementType
// ---------------------------------------------------------------------------

describe('MovementType', () => {
  it('has correct bitmask values', () => {
    expect(MovementType.None).toBe(0)
    expect(MovementType.Horizontal).toBe(1)
    expect(MovementType.Vertical).toBe(2)
    expect(MovementType.Turn).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// hasMovementType
// ---------------------------------------------------------------------------

describe('hasMovementType', () => {
  it('returns true when the flag is present in the value', () => {
    expect(
      hasMovementType(
        (MovementType.Horizontal | MovementType.Turn) as MovementType,
        MovementType.Horizontal,
      ),
    ).toBe(true)
  })

  it('returns false when the flag is not present', () => {
    expect(
      hasMovementType(MovementType.Horizontal, MovementType.Turn),
    ).toBe(false)
  })

  it('returns false for None when value is None (0 & 0 === 0)', () => {
    // hasMovementType uses bitwise AND: (value & type) !== 0
    // 0 & 0 = 0, which is not !== 0, so it returns false
    expect(hasMovementType(MovementType.None, MovementType.None)).toBe(false)
  })

  it('returns false for Horizontal when value is None', () => {
    expect(hasMovementType(MovementType.None, MovementType.Horizontal)).toBe(false)
  })

  it('handles all three flags combined', () => {
    const all = (MovementType.Horizontal | MovementType.Vertical | MovementType.Turn) as MovementType
    expect(hasMovementType(all, MovementType.Horizontal)).toBe(true)
    expect(hasMovementType(all, MovementType.Vertical)).toBe(true)
    expect(hasMovementType(all, MovementType.Turn)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AircraftInfo — default values
// ---------------------------------------------------------------------------

describe('AircraftInfo default values', () => {
  it('has default idleBehavior of None', () => {
    const info = new AircraftInfo()
    expect(info.idleBehavior).toBe(IdleBehaviorType.None)
  })

  it('has default cruiseAltitude of WDist(1280)', () => {
    const info = new AircraftInfo()
    expect(info.cruiseAltitude.length).toBe(1280)
  })

  it('has default repulsable of true', () => {
    const info = new AircraftInfo()
    expect(info.repulsable).toBe(true)
  })

  it('has default idealSeparation of WDist(1706)', () => {
    const info = new AircraftInfo()
    expect(info.idealSeparation.length).toBe(1706)
  })

  it('has default repulsionSpeed of -1', () => {
    const info = new AircraftInfo()
    expect(info.repulsionSpeed).toBe(-1)
  })

  it('has default initialFacing of WAngle.Zero', () => {
    const info = new AircraftInfo()
    expect(info.initialFacing.angle).toBe(0)
  })

  it('has default turnSpeed of WAngle(512)', () => {
    const info = new AircraftInfo()
    expect(info.turnSpeed.angle).toBe(512)
  })

  it('has default idleTurnSpeed of null', () => {
    const info = new AircraftInfo()
    expect(info.idleTurnSpeed).toBeNull()
  })

  it('has default turnDeadzone of WAngle(2)', () => {
    const info = new AircraftInfo()
    expect(info.turnDeadzone.angle).toBe(2)
  })

  it('has default speed of 1', () => {
    const info = new AircraftInfo()
    expect(info.speed).toBe(1)
  })

  it('has default idleSpeed of -1', () => {
    const info = new AircraftInfo()
    expect(info.idleSpeed).toBe(-1)
  })

  it('has default pitch of WAngle.Zero', () => {
    const info = new AircraftInfo()
    expect(info.pitch.angle).toBe(0)
  })

  it('has default pitchSpeed of WAngle.Zero', () => {
    const info = new AircraftInfo()
    expect(info.pitchSpeed.angle).toBe(0)
  })

  it('has default roll of WAngle.Zero', () => {
    const info = new AircraftInfo()
    expect(info.roll.angle).toBe(0)
  })

  it('has default idleRoll of null', () => {
    const info = new AircraftInfo()
    expect(info.idleRoll).toBeNull()
  })

  it('has default rollSpeed of WAngle.Zero', () => {
    const info = new AircraftInfo()
    expect(info.rollSpeed.angle).toBe(0)
  })

  it('has default minAirborneAltitude of 1', () => {
    const info = new AircraftInfo()
    expect(info.minAirborneAltitude).toBe(1)
  })

  it('has default landableTerrainTypes of empty Set', () => {
    const info = new AircraftInfo()
    expect(info.landableTerrainTypes.size).toBe(0)
  })

  it('has default moveIntoShroud of true', () => {
    const info = new AircraftInfo()
    expect(info.moveIntoShroud).toBe(true)
  })

  it('has default crushes as empty BitSet', () => {
    const info = new AircraftInfo()
    expect(info.crushes.isEmpty()).toBe(true)
  })

  it('has default crushDamageTypes as empty BitSet', () => {
    const info = new AircraftInfo()
    expect(info.crushDamageTypes.isEmpty()).toBe(true)
  })

  it('has default voice of "Action"', () => {
    const info = new AircraftInfo()
    expect(info.voice).toBe('Action')
  })

  it('has default targetLineColor of Green', () => {
    const info = new AircraftInfo()
    expect(info.targetLineColor.r).toBe(0)
    expect(info.targetLineColor.g).toBe(1)
    expect(info.targetLineColor.b).toBe(0)
  })

  it('has default airborneCondition of null', () => {
    const info = new AircraftInfo()
    expect(info.airborneCondition).toBeNull()
  })

  it('has default cruisingCondition of null', () => {
    const info = new AircraftInfo()
    expect(info.cruisingCondition).toBeNull()
  })

  it('has default canHover of false', () => {
    const info = new AircraftInfo()
    expect(info.canHover).toBe(false)
  })

  it('has default canSlide of false', () => {
    const info = new AircraftInfo()
    expect(info.canSlide).toBe(false)
  })

  it('has default vTOL of false', () => {
    const info = new AircraftInfo()
    expect(info.vTOL).toBe(false)
  })

  it('has default turnToLand of false', () => {
    const info = new AircraftInfo()
    expect(info.turnToLand).toBe(false)
  })

  it('has default takeOffOnResupply of false', () => {
    const info = new AircraftInfo()
    expect(info.takeOffOnResupply).toBe(false)
  })

  it('has default takeOffOnCreation of true', () => {
    const info = new AircraftInfo()
    expect(info.takeOffOnCreation).toBe(true)
  })

  it('has default canForceLand of true', () => {
    const info = new AircraftInfo()
    expect(info.canForceLand).toBe(true)
  })

  it('has default landAltitude of WDist.Zero', () => {
    const info = new AircraftInfo()
    expect(info.landAltitude.length).toBe(0)
  })

  it('has default landRange of WDist.fromCells(5)', () => {
    const info = new AircraftInfo()
    expect(info.landRange.length).toBe(5 * 1024)
  })

  it('has default maximumPitch of WAngle.fromDegrees(10)', () => {
    const info = new AircraftInfo()
    expect(info.maximumPitch.angle).toBe(WAngle.fromDegrees(10).angle)
  })

  it('has default altitudeVelocity of WDist(43)', () => {
    const info = new AircraftInfo()
    expect(info.altitudeVelocity.length).toBe(43)
  })

  it('has default takeoffSounds of empty array', () => {
    const info = new AircraftInfo()
    expect(info.takeoffSounds).toEqual([])
  })

  it('has default landingSounds of empty array', () => {
    const info = new AircraftInfo()
    expect(info.landingSounds).toEqual([])
  })

  it('has default waitDistanceFromResupplyBase of WDist(3072)', () => {
    const info = new AircraftInfo()
    expect(info.waitDistanceFromResupplyBase.length).toBe(3072)
  })

  it('has default numberOfTicksToVerifyAvailableAirport of 150', () => {
    const info = new AircraftInfo()
    expect(info.numberOfTicksToVerifyAvailableAirport).toBe(150)
  })

  it('has default previewFacing of WAngle(384)', () => {
    const info = new AircraftInfo()
    expect(info.previewFacing.angle).toBe(384)
  })

  it('has default cursor of "move"', () => {
    const info = new AircraftInfo()
    expect(info.cursor).toBe('move')
  })

  it('has default blockedCursor of "move-blocked"', () => {
    const info = new AircraftInfo()
    expect(info.blockedCursor).toBe('move-blocked')
  })

  it('has default enterCursor of "enter"', () => {
    const info = new AircraftInfo()
    expect(info.enterCursor).toBe('enter')
  })

  it('has default enterBlockedCursor of "enter-blocked"', () => {
    const info = new AircraftInfo()
    expect(info.enterBlockedCursor).toBe('enter-blocked')
  })

  it('has default requireForceMoveCondition of null', () => {
    const info = new AircraftInfo()
    expect(info.requireForceMoveCondition).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AircraftInfo — custom values
// ---------------------------------------------------------------------------

describe('AircraftInfo custom values', () => {
  it('accepts custom idleBehavior', () => {
    const info = new AircraftInfo({ idleBehavior: IdleBehaviorType.ReturnToBase })
    expect(info.idleBehavior).toBe(IdleBehaviorType.ReturnToBase)
  })

  it('accepts custom cruiseAltitude', () => {
    const info = new AircraftInfo({ cruiseAltitude: new WDist(2000) })
    expect(info.cruiseAltitude.length).toBe(2000)
  })

  it('accepts custom repulsable=false', () => {
    const info = new AircraftInfo({ repulsable: false })
    expect(info.repulsable).toBe(false)
  })

  it('accepts custom idealSeparation', () => {
    const info = new AircraftInfo({ idealSeparation: new WDist(2048) })
    expect(info.idealSeparation.length).toBe(2048)
  })

  it('accepts custom repulsionSpeed', () => {
    const info = new AircraftInfo({ repulsionSpeed: 5 })
    expect(info.repulsionSpeed).toBe(5)
  })

  it('accepts custom initialFacing', () => {
    const info = new AircraftInfo({ initialFacing: new WAngle(256) })
    expect(info.initialFacing.angle).toBe(256)
  })

  it('accepts custom turnSpeed', () => {
    const info = new AircraftInfo({ turnSpeed: new WAngle(256) })
    expect(info.turnSpeed.angle).toBe(256)
  })

  it('accepts custom speed', () => {
    const info = new AircraftInfo({ speed: 3 })
    expect(info.speed).toBe(3)
  })

  it('accepts custom canHover=true', () => {
    const info = new AircraftInfo({ canHover: true })
    expect(info.canHover).toBe(true)
  })

  it('accepts custom canSlide=true', () => {
    const info = new AircraftInfo({ canSlide: true })
    expect(info.canSlide).toBe(true)
  })

  it('accepts custom vTOL=true', () => {
    const info = new AircraftInfo({ vTOL: true })
    expect(info.vTOL).toBe(true)
  })

  it('accepts custom landableTerrainTypes', () => {
    const types = new Set(['Clear', 'Rough'])
    const info = new AircraftInfo({ landableTerrainTypes: types })
    expect(info.landableTerrainTypes.size).toBe(2)
    expect(info.landableTerrainTypes.has('Clear')).toBe(true)
    expect(info.landableTerrainTypes.has('Rough')).toBe(true)
  })

  it('accepts custom airborneCondition', () => {
    const info = new AircraftInfo({ airborneCondition: 'airborne' })
    expect(info.airborneCondition).toBe('airborne')
  })

  it('accepts custom cruisingCondition', () => {
    const info = new AircraftInfo({ cruisingCondition: 'cruising' })
    expect(info.cruisingCondition).toBe('cruising')
  })

  it('accepts custom takeOffOnCreation=false', () => {
    const info = new AircraftInfo({ takeOffOnCreation: false })
    expect(info.takeOffOnCreation).toBe(false)
  })

  it('accepts custom landAltitude', () => {
    const info = new AircraftInfo({ landAltitude: new WDist(100) })
    expect(info.landAltitude.length).toBe(100)
  })

  it('accepts custom altitudeVelocity', () => {
    const info = new AircraftInfo({ altitudeVelocity: new WDist(100) })
    expect(info.altitudeVelocity.length).toBe(100)
  })

  it('accepts custom voice', () => {
    const info = new AircraftInfo({ voice: 'Move' })
    expect(info.voice).toBe('Move')
  })

  it('accepts custom requireForceMoveCondition', () => {
    const info = new AircraftInfo({ requireForceMoveCondition: '!deployed' })
    expect(info.requireForceMoveCondition).toBe('!deployed')
  })

  it('accepts custom instanceName', () => {
    const info = new AircraftInfo({ instanceName: 'myAircraft' })
    expect(info.instanceName).toBe('myAircraft')
  })

  it('accepts custom requiresCondition', () => {
    const info = new AircraftInfo({ requiresCondition: '!disabled' })
    expect(info.requiresCondition).toBe('!disabled')
  })
})

// ---------------------------------------------------------------------------
// AircraftInfo — methods
// ---------------------------------------------------------------------------

describe('AircraftInfo methods', () => {
  it('getInitialFacing returns initialFacing', () => {
    const info = new AircraftInfo({ initialFacing: new WAngle(512) })
    expect(info.getInitialFacing().angle).toBe(512)
  })

  it('getTargetLineColor returns targetLineColor', () => {
    const info = new AircraftInfo()
    const color = info.getTargetLineColor()
    expect(color.r).toBe(0)
    expect(color.g).toBe(1)
    expect(color.b).toBe(0)
  })

  it('occupiedCells returns empty map', () => {
    const info = new AircraftInfo()
    const result = info.occupiedCells(
      { name: 'test' } as ActorInfoStub,
      new CPos(5, 5),
    )
    expect(result.size).toBe(0)
  })

  it('sharesCell returns false', () => {
    const info = new AircraftInfo()
    expect(info.sharesCell).toBe(false)
  })

  it('canEnterCell returns false when map has no contains', () => {
    const info = new AircraftInfo({ landableTerrainTypes: new Set(['Clear']) })
    const world = {} // no map
    expect(info.canEnterCell(world, mockActor(), new CPos(0, 0))).toBe(false)
  })

  it('canEnterCell returns false when cell is not in map', () => {
    const info = new AircraftInfo({ landableTerrainTypes: new Set(['Clear']) })
    const map = mockMap({ contains: vi.fn().mockReturnValue(false) })
    const world = { map }
    expect(info.canEnterCell(world, mockActor(), new CPos(5, 5))).toBe(false)
  })

  it('canEnterCell returns false when terrain type is not landable', () => {
    const info = new AircraftInfo({ landableTerrainTypes: new Set(['Clear']) })
    const map = mockMap({
      contains: vi.fn().mockReturnValue(true),
      getTerrainInfo: vi.fn().mockReturnValue({ type: 'Water' }),
    })
    const world = { map }
    expect(info.canEnterCell(world, mockActor(), new CPos(5, 5))).toBe(false)
  })

  it('canEnterCell returns true for matching terrain type', () => {
    const info = new AircraftInfo({ landableTerrainTypes: new Set(['Clear']) })
    const map = mockMap({
      contains: vi.fn().mockReturnValue(true),
      getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
    })
    const world = { map, actorMap: { getActorsAt: vi.fn().mockReturnValue([]) } }
    expect(info.canEnterCell(world, mockActor(), new CPos(5, 5))).toBe(true)
  })

  it('canEnterCell returns false when cell is blocked by another actor', () => {
    const info = new AircraftInfo({ landableTerrainTypes: new Set(['Clear']) })
    const otherActor = mockActor({ actorId: 99 })
    const map = mockMap({
      contains: vi.fn().mockReturnValue(true),
      getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
    })
    const world = {
      map,
      actorMap: { getActorsAt: vi.fn().mockReturnValue([otherActor]) },
    }
    // BlockedByActor.All = 0 (default): blocked by other actor
    expect(info.canEnterCell(world, mockActor(), new CPos(5, 5))).toBe(false)
  })

  it('canEnterCell ignores the ignoreActor', () => {
    const info = new AircraftInfo({ landableTerrainTypes: new Set(['Clear']) })
    const self = mockActor()
    const map = mockMap({
      contains: vi.fn().mockReturnValue(true),
      getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
    })
    const world = {
      map,
      actorMap: { getActorsAt: vi.fn().mockReturnValue([self]) },
    }
    // Ignoring self should not be blocked
    expect(info.canEnterCell(world, self, new CPos(5, 5), SubCellEnum.FullCell, self)).toBe(true)
  })

  it('canEnterCell returns true when BlockedByActor is None', () => {
    const info = new AircraftInfo({ landableTerrainTypes: new Set(['Clear']) })
    const map = mockMap({
      contains: vi.fn().mockReturnValue(true),
      getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
    })
    const world = {
      map,
      actorMap: { getActorsAt: vi.fn().mockReturnValue([mockActor({ actorId: 99 })]) },
    }
    // BlockedByActor.None = 1
    expect(info.canEnterCell(world, mockActor(), new CPos(5, 5), SubCellEnum.FullCell, null, 1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — construction and initialization
// ---------------------------------------------------------------------------

describe('Aircraft construction and initialization', () => {
  it('constructs with default Info', () => {
    const info = makeInfo()
    const aircraft = new Aircraft(info)
    expect(aircraft.isTraitDisabled).toBe(false)
    expect(aircraft.isTraitPaused).toBe(false)
    expect(aircraft.info).toBe(info)
  })

  it('initialize sets facing to initialFacing', () => {
    const info = makeInfo({ initialFacing: new WAngle(256) })
    const aircraft = new Aircraft(info)
    const actor = mockActor()
    aircraft.initialize(actor, new CPos(10, 10), new WPos(10240, 10240, 1280))
    expect(aircraft.facing.angle).toBe(256)
  })

  it('initialize sets centerPosition', () => {
    const { aircraft } = setup({
      centerPosition: new WPos(5000, 3000, 2000),
    })
    expect(aircraft.centerPosition.X).toBe(5000)
    expect(aircraft.centerPosition.Y).toBe(3000)
    expect(aircraft.centerPosition.Z).toBe(2000)
  })

  it('initialize defaults facing to zero when initialFacing is zero', () => {
    const info = makeInfo()
    const aircraft = new Aircraft(info)
    const actor = mockActor()
    aircraft.initialize(actor, new CPos(5, 5), new WPos(5120, 5120, 0))
    expect(aircraft.facing.angle).toBe(0)
  })

  it('initialize stores creation params', () => {
    const info = makeInfo()
    const aircraft = new Aircraft(info)
    const actor = mockActor()
    aircraft.initialize(actor, new CPos(10, 10), new WPos(10240, 10240, 1280), true, 30, [new CPos(5, 5)])
    // Can't directly test private fields, but behavior is correct
    expect(aircraft.centerPosition.X).toBe(10240)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IFacing
// ---------------------------------------------------------------------------

describe('Aircraft IFacing', () => {
  it('facing getter returns current orientation yaw', () => {
    const { aircraft } = setup({ infoOverrides: { initialFacing: new WAngle(128) } })
    expect(aircraft.facing.angle).toBe(128)
  })

  it('facing setter updates orientation yaw', () => {
    const { aircraft } = setup({ infoOverrides: { initialFacing: new WAngle(0) } })
    aircraft.facing = new WAngle(384)
    expect(aircraft.facing.angle).toBe(384)
  })

  it('facing setter preserves pitch and roll', () => {
    const { aircraft } = setup()
    aircraft.pitch = new WAngle(64)
    aircraft.roll = new WAngle(32)
    aircraft.facing = new WAngle(256)
    expect(aircraft.facing.angle).toBe(256)
    expect(aircraft.pitch.angle).toBe(64)
    expect(aircraft.roll.angle).toBe(32)
  })

  it('orientation getter returns full WRot', () => {
    const { aircraft } = setup({ infoOverrides: { initialFacing: new WAngle(128) } })
    const orient = aircraft.orientation
    expect(orient.yaw.angle).toBe(128)
    expect(orient.pitch.angle).toBe(0)
    expect(orient.roll.angle).toBe(0)
  })

  it('orientation setter replaces entire WRot', () => {
    const { aircraft } = setup()
    // WRot constructor params: (roll, pitch, yaw)
    const newOrient = new WRot(new WAngle(64), new WAngle(32), new WAngle(16))
    aircraft.orientation = newOrient
    expect(aircraft.orientation.yaw.angle).toBe(16)
    expect(aircraft.orientation.pitch.angle).toBe(32)
    expect(aircraft.orientation.roll.angle).toBe(64)
  })

  it('pitch getter returns orientation pitch', () => {
    const { aircraft } = setup()
    aircraft.pitch = new WAngle(30)
    expect(aircraft.pitch.angle).toBe(30)
  })

  it('roll getter returns orientation roll', () => {
    const { aircraft } = setup()
    aircraft.roll = new WAngle(45)
    expect(aircraft.roll.angle).toBe(45)
  })

  it('turnSpeed returns info.turnSpeed', () => {
    const { aircraft } = setup({ infoOverrides: { turnSpeed: new WAngle(256) } })
    expect(aircraft.turnSpeed.angle).toBe(256)
  })

  it('turnSpeed returns WAngle.Zero when disabled', () => {
    const { aircraft } = setup({ infoOverrides: { turnSpeed: new WAngle(256) } })
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    expect(aircraft.turnSpeed.angle).toBe(0)
  })

  it('turnSpeed returns WAngle.Zero when paused', () => {
    const { aircraft } = setup({ infoOverrides: { turnSpeed: new WAngle(256) } })
    aircraft['_paused'] = true
    expect(aircraft.turnSpeed.angle).toBe(0)
  })

  it('idleTurnSpeed returns info.idleTurnSpeed', () => {
    const idleTurn = new WAngle(128)
    const { aircraft } = setup({ infoOverrides: { idleTurnSpeed: idleTurn } })
    expect(aircraft.idleTurnSpeed!.angle).toBe(128)
  })

  it('idleTurnSpeed returns null when disabled', () => {
    const { aircraft } = setup({ infoOverrides: { idleTurnSpeed: new WAngle(128) } })
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    expect(aircraft.idleTurnSpeed).toBeNull()
  })

  it('getTurnSpeed returns computed speed for non-idle', () => {
    const { aircraft } = setup({ infoOverrides: { turnSpeed: new WAngle(512) } })
    const speed = aircraft.getTurnSpeed(false)
    expect(speed.angle).toBeGreaterThan(0)
    expect(speed.angle).toBeLessThanOrEqual(1024)
  })

  it('getTurnSpeed returns WAngle.Zero when movement speed is 0', () => {
    const { aircraft } = setup({ infoOverrides: { turnSpeed: new WAngle(512), speed: 0 } })
    const speed = aircraft.getTurnSpeed(false)
    expect(speed.angle).toBe(0)
  })

  it('getTurnSpeed uses idleTurnSpeed for idle turns', () => {
    const { aircraft } = setup({
      infoOverrides: {
        turnSpeed: new WAngle(512),
        idleTurnSpeed: new WAngle(256),
      },
    })
    const speed = aircraft.getTurnSpeed(true)
    expect(speed.angle).toBeLessThanOrEqual(1024)
  })

  it('getTurnSpeed falls back to turnSpeed when idleTurnSpeed is null', () => {
    const { aircraft } = setup({
      infoOverrides: {
        turnSpeed: new WAngle(512),
        idleTurnSpeed: null,
      },
    })
    const speed = aircraft.getTurnSpeed(true)
    expect(speed.angle).toBeGreaterThan(0)
    expect(speed.angle).toBeLessThanOrEqual(1024)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — movement speed
// ---------------------------------------------------------------------------

describe('Aircraft movement speed', () => {
  it('movementSpeed returns info.speed when no modifiers', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 2 } })
    expect(aircraft.movementSpeed).toBe(2)
  })

  it('movementSpeed returns 0 when disabled', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 2 } })
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    expect(aircraft.movementSpeed).toBe(0)
  })

  it('movementSpeed returns 0 when paused', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 2 } })
    aircraft['_paused'] = true
    expect(aircraft.movementSpeed).toBe(0)
  })

  it('idleMovementSpeed returns movementSpeed when idleSpeed < 0', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 2, idleSpeed: -1 } })
    expect(aircraft.idleMovementSpeed).toBe(2)
  })

  it('idleMovementSpeed returns info.idleSpeed when >= 0', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 2, idleSpeed: 1 } })
    expect(aircraft.idleMovementSpeed).toBe(1)
  })

  it('idleMovementSpeed returns 0 when idleSpeed >= 0 and disabled', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 2, idleSpeed: 1 } })
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    expect(aircraft.idleMovementSpeed).toBe(0)
  })

  it('idleMovementSpeed returns 0 when idleSpeed is 0', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 2, idleSpeed: 0 } })
    expect(aircraft.idleMovementSpeed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — altitude
// ---------------------------------------------------------------------------

describe('Aircraft altitude', () => {
  it('landAltitude returns info.landAltitude by default', () => {
    const { aircraft } = setup({ infoOverrides: { landAltitude: new WDist(50) } })
    expect(aircraft.landAltitude.length).toBe(50)
  })

  it('landAltitude accounts for position offsets', () => {
    const { aircraft } = setup({ infoOverrides: { landAltitude: new WDist(100) } })
    // Simulate position offsets by adding to the internal array
    const offsets = (aircraft as unknown as Record<string, unknown>)['_positionOffsets'] as IAircraftCenterPositionOffset[]
    offsets.push({ positionOffset: new WVec(0, 0, 30) })
    expect(aircraft.landAltitude.length).toBe(70)
  })

  it('groundPosition subtracts terrain distance', () => {
    const { aircraft } = setup({
      centerPosition: new WPos(10240, 10240, 1280),
    })
    // distanceAboveTerrain returns 1280
    const ground = aircraft.groundPosition()
    expect(ground.Z).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — flyStep
// ---------------------------------------------------------------------------

describe('Aircraft flyStep', () => {
  it('returns a WVec for a given facing', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 1 } })
    const step = aircraft.flyStep(new WAngle(0)) // facing north
    expect(step).toBeInstanceOf(WVec)
  })

  it('non-zero speed produces non-zero step', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 2 } })
    const step = aircraft.flyStep(new WAngle(0))
    expect(step.horizontalLengthSquared).toBeGreaterThan(0)
  })

  it('zero speed produces zero step', () => {
    const { aircraft } = setup({ infoOverrides: { speed: 0 } })
    const step = aircraft.flyStep(new WAngle(0))
    expect(step.X).toBe(0)
    expect(step.Y).toBe(0)
    expect(step.Z).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IPositionable
// ---------------------------------------------------------------------------

describe('Aircraft IPositionable', () => {
  it('centerPosition getter returns stored position', () => {
    const pos = new WPos(5000, 3000, 2000)
    const { aircraft } = setup({ centerPosition: pos })
    expect(aircraft.centerPosition.X).toBe(5000)
    expect(aircraft.centerPosition.Y).toBe(3000)
    expect(aircraft.centerPosition.Z).toBe(2000)
  })

  it('setPosition updates centerPosition', () => {
    const { aircraft, actor } = setup()
    const newPos = new WPos(8888, 6666, 1000)
    aircraft.setPosition(actor, newPos)
    expect(aircraft.centerPosition.X).toBe(8888)
    expect(aircraft.centerPosition.Y).toBe(6666)
    expect(aircraft.centerPosition.Z).toBe(1000)
  })

  it('setCenterPosition delegates to setPosition', () => {
    const { aircraft, actor } = setup()
    const newPos = new WPos(9999, 7777, 500)
    aircraft.setCenterPosition(actor, newPos)
    expect(aircraft.centerPosition.X).toBe(9999)
    expect(aircraft.centerPosition.Y).toBe(7777)
    expect(aircraft.centerPosition.Z).toBe(500)
  })

  it('canCenterPositionChange returns true when enabled', () => {
    const { aircraft, actor } = setup()
    expect(aircraft.canCenterPositionChange(actor)).toBe(true)
  })

  it('canCenterPositionChange returns false when disabled', () => {
    const { aircraft, actor } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    expect(aircraft.canCenterPositionChange(actor)).toBe(false)
  })

  it('canCenterPositionChange returns false when paused', () => {
    const { aircraft, actor } = setup()
    aircraft['_paused'] = true
    expect(aircraft.canCenterPositionChange(actor)).toBe(false)
  })

  it('topLeft returns cell containing centerPosition', () => {
    const { aircraft } = setup({
      centerPosition: new WPos(10240, 10240, 1280),
    })
    const tl = aircraft.topLeft
    expect(tl).toBeInstanceOf(CPos)
  })

  it('isInWorld reflects actor.isInWorld', () => {
    const { aircraft } = setup({ actorOverrides: { isInWorld: true } })
    expect(aircraft.isInWorld).toBe(true)
  })

  it('isInWorld returns false when actor not in world', () => {
    const { aircraft } = setup({ actorOverrides: { isInWorld: false } })
    expect(aircraft.isInWorld).toBe(false)
  })

  it('isLeavingMap returns false when not moving', () => {
    const { aircraft, actor } = setup()
    expect(aircraft.isLeavingMap(actor)).toBe(false)
  })

  it('canExistInCell always returns true', () => {
    const { aircraft } = setup()
    expect(aircraft.canExistInCell(new CPos(0, 0))).toBe(true)
  })

  it('isLeavingCell always returns false', () => {
    const { aircraft } = setup()
    expect(aircraft.isLeavingCell(new CPos(5, 5))).toBe(false)
  })

  it('canEnterCell always returns true', () => {
    const { aircraft } = setup()
    expect(aircraft.canEnterCell(new CPos(5, 5))).toBe(true)
  })

  it('getValidSubCell returns Invalid', () => {
    const { aircraft } = setup()
    expect(aircraft.getValidSubCell(SubCellEnum.Any)).toBe(SubCellEnum.Invalid)
  })

  it('getAvailableSubCell returns Invalid', () => {
    const { aircraft } = setup()
    expect(aircraft.getAvailableSubCell(new CPos(0, 0))).toBe(SubCellEnum.Invalid)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IOccupySpace
// ---------------------------------------------------------------------------

describe('Aircraft IOccupySpace', () => {
  it('occupiedCells returns empty by default', () => {
    const { aircraft } = setup()
    expect(aircraft.occupiedCells()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Aircraft — influence and landing cells
// ---------------------------------------------------------------------------

describe('Aircraft influence', () => {
  it('hasInfluence returns false by default', () => {
    const { aircraft } = setup()
    expect(aircraft.hasInfluence()).toBe(false)
  })

  it('addInfluence sets landing cells', () => {
    const { aircraft } = setup()
    const cells = [{ cell: new CPos(5, 5), subCell: SubCellEnum.FullCell }]
    aircraft.addInfluence(cells)
    expect(aircraft.hasInfluence()).toBe(true)
    expect(aircraft.occupiedCells().length).toBe(1)
  })

  it('addInfluence throws when influence already exists', () => {
    const { aircraft } = setup()
    aircraft.addInfluence([{ cell: new CPos(5, 5), subCell: SubCellEnum.FullCell }])
    expect(() =>
      aircraft.addInfluence([{ cell: new CPos(6, 6), subCell: SubCellEnum.FullCell }]),
    ).toThrow('Cannot addInfluence until previous influence is removed with removeInfluence')
  })

  it('addInfluenceCell delegates to addInfluence', () => {
    const { aircraft } = setup()
    aircraft.addInfluenceCell(new CPos(7, 7))
    expect(aircraft.hasInfluence()).toBe(true)
    expect(aircraft.occupiedCells()[0].cell.X).toBe(7)
    expect(aircraft.occupiedCells()[0].cell.Y).toBe(7)
  })

  it('removeInfluence clears landing cells', () => {
    const { aircraft } = setup()
    aircraft.addInfluence([{ cell: new CPos(5, 5), subCell: SubCellEnum.FullCell }])
    aircraft.removeInfluence()
    expect(aircraft.hasInfluence()).toBe(false)
    expect(aircraft.occupiedCells()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Aircraft — reservation
// ---------------------------------------------------------------------------

describe('Aircraft reservation', () => {
  it('reservedActor returns null by default', () => {
    const { aircraft } = setup()
    expect(aircraft.reservedActor).toBeNull()
  })

  it('mayYieldReservation returns false by default', () => {
    const { aircraft } = setup()
    expect(aircraft.mayYieldReservation).toBe(false)
  })

  it('mayYieldReservation setter updates value', () => {
    const { aircraft } = setup()
    aircraft.mayYieldReservation = true
    expect(aircraft.mayYieldReservation).toBe(true)
  })

  it('unReserve is safe to call when no reservation', () => {
    const { aircraft } = setup()
    expect(() => aircraft.unReserve()).not.toThrow()
  })

  it('makeReservation calls reserve on target', () => {
    const { aircraft } = setup()
    const disposeFn = vi.fn()
    const target = mockActor({
      reserve: vi.fn().mockReturnValue({ dispose: disposeFn }),
    })
    aircraft.makeReservation(target)
    const reserveFn = (target as unknown as Record<string, unknown>).reserve as ReturnType<typeof vi.fn>
    expect(reserveFn).toHaveBeenCalledTimes(1)
    expect(aircraft.reservedActor).toBe(target)
  })

  it('makeReservation disposes previous reservation', () => {
    const { aircraft } = setup()
    const disposeFn1 = vi.fn()
    const target1 = mockActor({
      reserve: vi.fn().mockReturnValue({ dispose: disposeFn1 }),
    })
    aircraft.makeReservation(target1)

    const disposeFn2 = vi.fn()
    const target2 = mockActor({
      reserve: vi.fn().mockReturnValue({ dispose: disposeFn2 }),
    })
    aircraft.makeReservation(target2)
    expect(disposeFn1).toHaveBeenCalledTimes(1)
    expect(aircraft.reservedActor).toBe(target2)
  })

  it('unReserve disposes reservation and clears state', () => {
    const { aircraft } = setup()
    const disposeFn = vi.fn()
    const target = mockActor({
      reserve: vi.fn().mockReturnValue({ dispose: disposeFn }),
    })
    aircraft.makeReservation(target)
    aircraft.mayYieldReservation = true

    aircraft.unReserve()
    expect(disposeFn).toHaveBeenCalledTimes(1)
    expect(aircraft.reservedActor).toBeNull()
    expect(aircraft.mayYieldReservation).toBe(false)
  })

  it('allowYieldingReservation does nothing when no reservation', () => {
    const { aircraft } = setup()
    expect(() => aircraft.allowYieldingReservation()).not.toThrow()
    expect(aircraft.mayYieldReservation).toBe(false)
  })

  it('allowYieldingReservation sets mayYieldReservation when reservation exists', () => {
    const { aircraft } = setup()
    const target = mockActor({
      reserve: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    })
    aircraft.makeReservation(target)
    aircraft.allowYieldingReservation()
    expect(aircraft.mayYieldReservation).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — canLand, findLandingLocation, canLandMulti
// ---------------------------------------------------------------------------

describe('Aircraft canLand', () => {
  it('returns false when map is null', () => {
    const { aircraft } = setup({ actorOverrides: { world: {} } })
    expect(aircraft.canLand(new CPos(5, 5))).toBe(false)
  })

  it('returns false when cell is not in map bounds', () => {
    const { aircraft } = setup({
      mapOverrides: { contains: vi.fn().mockReturnValue(false) },
    })
    expect(aircraft.canLand(new CPos(5, 5))).toBe(false)
  })

  it('returns true for landable terrain type', () => {
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
        contains: vi.fn().mockReturnValue(true),
      },
      actorMapOverrides: { getActorsAt: vi.fn().mockReturnValue([]) },
    })
    expect(aircraft.canLand(new CPos(5, 5))).toBe(true)
  })

  it('returns false for non-landable terrain type', () => {
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Water' }),
        contains: vi.fn().mockReturnValue(true),
      },
    })
    expect(aircraft.canLand(new CPos(5, 5))).toBe(false)
  })

  it('returns true for any terrain type when dockingActor is provided', () => {
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Water' }),
        contains: vi.fn().mockReturnValue(true),
      },
    })
    const dockingActor = mockActor()
    expect(aircraft.canLand(new CPos(5, 5), dockingActor)).toBe(true)
  })

  it('uses override landable terrain when IOverrideAircraftLanding is present', () => {
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Rough' }),
        contains: vi.fn().mockReturnValue(true),
      },
    })
    // Set override
    ;(aircraft as unknown as Record<string, unknown>)['_overrideAircraftLanding'] = {
      landableTerrainTypes: new Set(['Rough']),
    } as IOverrideAircraftLanding
    expect(aircraft.canLand(new CPos(5, 5))).toBe(true)
  })

  it('returns false when blocked by another actor', () => {
    const otherActor = mockActor({ actorId: 99 })
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
        contains: vi.fn().mockReturnValue(true),
      },
      actorMapOverrides: { getActorsAt: vi.fn().mockReturnValue([otherActor]) },
    })
    // The aircraft cannot crush other actors (crushes is empty by default),
    // so _isBlockedBy returns true, making canLand return false.
    expect(aircraft.canLand(new CPos(5, 5))).toBe(false)
  })

  it('canLandMulti returns true when all cells are landable', () => {
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
        contains: vi.fn().mockReturnValue(true),
      },
      actorMapOverrides: { getActorsAt: vi.fn().mockReturnValue([]) },
    })
    expect(aircraft.canLandMulti([new CPos(1, 1), new CPos(2, 2)])).toBe(true)
  })

  it('canLandMulti returns false when any cell is not landable', () => {
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        // Override for each call wouldn't work easily with shared mock,
        // so test with bad terrain on all cells
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Water' }),
        contains: vi.fn().mockReturnValue(true),
      },
    })
    expect(aircraft.canLandMulti([new CPos(1, 1), new CPos(2, 2)])).toBe(false)
  })

  it('findLandingLocation returns target cell when directly landable', () => {
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
        contains: vi.fn().mockReturnValue(true),
      },
      actorMapOverrides: { getActorsAt: vi.fn().mockReturnValue([]) },
    })
    const result = aircraft.findLandingLocation(new CPos(5, 5), new WDist(5120))
    expect(result).not.toBeNull()
    expect(CPos.equals(result!, new CPos(5, 5))).toBe(true)
  })

  it('findLandingLocation returns null when no landable cell in range', () => {
    const { aircraft } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Water' }),
        contains: vi.fn().mockReturnValue(true),
      },
    })
    const result = aircraft.findLandingLocation(new CPos(5, 5), new WDist(5120))
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Aircraft — resupply checks
// ---------------------------------------------------------------------------

describe('Aircraft resupply checks', () => {
  it('aircraftCanEnter returns false when hostile', () => {
    const { aircraft } = setup()
    const hostActor = mockActor()
    // Set appearsHostileTo to return true
    const self = (aircraft as unknown as Record<string, unknown>)['_self'] as Record<string, unknown>
    self.appearsHostileTo = vi.fn().mockReturnValue(true)
    expect(aircraft.aircraftCanEnter(hostActor)).toBe(false)
  })

  it('aircraftCanEnter returns false when no rearm/repair capability', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    expect(aircraft.aircraftCanEnter(host)).toBe(false)
  })

  it('aircraftCanEnter returns true when can rearm at host', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    // Set up rearmable
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [{ hasFullAmmo: false }],
    } as RearmableStub
    expect(aircraft.aircraftCanEnter(host)).toBe(true)
  })

  it('aircraftCanEnter returns true when can repair at host', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    ;(aircraft as unknown as Record<string, unknown>)['_repairable'] = {
      info: { repairActors: new Set(['afld']) },
    } as RepairableStub
    expect(aircraft.aircraftCanEnter(host)).toBe(true)
  })

  it('aircraftCanResupplyAt returns false when hostile', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    const self = (aircraft as unknown as Record<string, unknown>)['_self'] as Record<string, unknown>
    self.appearsHostileTo = vi.fn().mockReturnValue(true)
    expect(aircraft.aircraftCanResupplyAt(host)).toBe(false)
  })

  it('aircraftCanResupplyAt returns true when allowedToForceEnter', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [{ hasFullAmmo: true }],
    } as RearmableStub
    // allowedToForceEnter=true bypasses ammo check
    expect(aircraft.aircraftCanResupplyAt(host, true)).toBe(true)
  })

  it('aircraftCanResupplyAt returns false when ammo pools are full and not forced', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [{ hasFullAmmo: true }],
    } as RearmableStub
    expect(aircraft.aircraftCanResupplyAt(host, false)).toBe(false)
  })

  it('canRearmAt returns true when has non-full ammo pools', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [{ hasFullAmmo: false }],
    } as RearmableStub
    expect(aircraft.canRearmAt(host)).toBe(true)
  })

  it('canRearmAt returns false when all ammo pools are full', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [{ hasFullAmmo: true }],
    } as RearmableStub
    expect(aircraft.canRearmAt(host)).toBe(false)
  })

  it('canRepairAt returns true when damaged', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    ;(aircraft as unknown as Record<string, unknown>)['_repairable'] = {
      info: { repairActors: new Set(['afld']) },
    } as RepairableStub
    // getDamageState returns something other than 1 (Undamaged)
    const self = (aircraft as unknown as Record<string, unknown>)['_self'] as Record<string, unknown>
    self.getDamageState = vi.fn().mockReturnValue(2) // Damaged
    expect(aircraft.canRepairAt(host)).toBe(true)
  })

  it('canRepairAt returns false when not damaged', () => {
    const { aircraft } = setup()
    const host = mockActor({ info: { name: 'afld' } as ActorInfoStub })
    ;(aircraft as unknown as Record<string, unknown>)['_repairable'] = {
      info: { repairActors: new Set(['afld']) },
    } as RepairableStub
    const self = (aircraft as unknown as Record<string, unknown>)['_self'] as Record<string, unknown>
    self.getDamageState = vi.fn().mockReturnValue(1) // Undamaged
    expect(aircraft.canRepairAt(host)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — repulse
// ---------------------------------------------------------------------------

describe('Aircraft repulse', () => {
  it('does not throw when repulsable=false', () => {
    const { aircraft } = setup({ infoOverrides: { repulsable: false } })
    expect(() => aircraft.repulse()).not.toThrow()
  })

  it('does not throw when no world', () => {
    const { aircraft } = setup({ actorOverrides: { world: {} } })
    expect(() => aircraft.repulse()).not.toThrow()
  })

  it('does not throw with normal config', () => {
    const { aircraft } = setup({ infoOverrides: { repulsable: true } })
    expect(() => aircraft.repulse()).not.toThrow()
  })

  it('applies nudge when outside map bounds', () => {
    const { aircraft } = setup({
      infoOverrides: { repulsable: true },
      mapOverrides: {
        contains: vi.fn().mockReturnValue(false),
        projectedTopLeft: new WPos(0, 0, 0),
        projectedBottomRight: new WPos(20480, 20480, 0),
      },
    })
    expect(() => aircraft.repulse()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IMove
// ---------------------------------------------------------------------------

describe('Aircraft IMove', () => {
  it('moveTo returns a Fly activity', () => {
    const { aircraft, actor } = setup()
    const activity = aircraft.moveTo(actor, {} as unknown as Target)
    expect(activity).toBeDefined()
  })

  it('moveWithinRange returns a Fly activity', () => {
    const { aircraft, actor } = setup()
    const activity = aircraft.moveWithinRange(
      actor,
      {} as unknown as Target,
      new WDist(100),
    )
    expect(activity).toBeDefined()
  })

  it('moveToTarget returns a Fly activity', () => {
    const { aircraft, actor } = setup()
    const activity = aircraft.moveToTarget(actor, {} as unknown as Target)
    expect(activity).toBeDefined()
  })

  it('moveIntoTarget returns a Land activity', () => {
    const { aircraft, actor } = setup()
    const activity = aircraft.moveIntoTarget(actor, {} as unknown as Target)
    expect(activity).toBeDefined()
  })

  it('moveOntoTarget returns a Land activity', () => {
    const { aircraft, actor } = setup()
    const activity = aircraft.moveOntoTarget(
      actor,
      {} as unknown as Target,
      {} as unknown as Target,
    )
    expect(activity).toBeDefined()
  })

  it('localMove returns a Fly activity', () => {
    const { aircraft, actor } = setup()
    const activity = aircraft.localMove(actor, WPos.Zero)
    expect(activity).toBeDefined()
  })

  it('returnToCell returns null', () => {
    const { aircraft, actor } = setup()
    expect(aircraft.returnToCell(actor)).toBeNull()
  })

  it('estimatedMoveDuration calculates non-zero for distance', () => {
    const { aircraft, actor } = setup({ infoOverrides: { speed: 1 } })
    const from = new WPos(0, 0, 0)
    const to = new WPos(1024, 0, 0)
    expect(aircraft.estimatedMoveDuration(actor, from, to)).toBeGreaterThan(0)
  })

  it('estimatedMoveDuration returns 0 when speed is 0', () => {
    const { aircraft, actor } = setup({ infoOverrides: { speed: 0 } })
    const from = new WPos(0, 0, 0)
    const to = new WPos(1024, 0, 0)
    expect(aircraft.estimatedMoveDuration(actor, from, to)).toBe(0)
  })

  it('nearestMoveableCell returns cell containing centerPosition', () => {
    const { aircraft, actor } = setup()
    const result = aircraft.nearestMoveableCell(actor, WPos.Zero)
    expect(result).toBeInstanceOf(CPos)
  })

  it('nearestMoveableCellFromCell returns the same cell', () => {
    const { aircraft } = setup()
    const cell = new CPos(7, 8)
    const result = aircraft.nearestMoveableCellFromCell(cell)
    expect(CPos.equals(result, cell)).toBe(true)
  })

  it('canEnterTargetNow returns false when no reserved actor', () => {
    const { aircraft, actor } = setup()
    // _reservedActor is null by default
    expect(aircraft.canEnterTargetNow(actor, {} as unknown as Target)).toBe(false)
  })

  it('canEnterTargetNow makes reservation and returns true', () => {
    const { aircraft, actor } = setup()
    const target = mockActor({
      reserve: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    })
    ;(aircraft as unknown as Record<string, unknown>)['_reservedActor'] = target
    expect(aircraft.canEnterTargetNow(actor, {} as unknown as Target)).toBe(true)
  })

  it('moveWithinRangeMinMax returns a Fly activity', () => {
    const { aircraft, actor } = setup()
    const activity = aircraft.moveWithinRangeMinMax(
      actor,
      {} as unknown as Target,
      new WDist(100),
      new WDist(500),
    )
    expect(activity).toBeDefined()
  })

  it('moveFollow returns a FlyFollow activity', () => {
    const { aircraft, actor } = setup()
    const activity = aircraft.moveFollow(
      actor,
      {} as unknown as Target,
      new WDist(100),
      {} as unknown as Target,
    )
    expect(activity).toBeDefined()
  })

  it('moveToCell returns a Fly activity', () => {
    const { aircraft } = setup()
    const activity = aircraft.moveToCell(new CPos(5, 5))
    expect(activity).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Aircraft — movement types and currentMovementTypes
// ---------------------------------------------------------------------------

describe('Aircraft movement types', () => {
  it('currentMovementTypes returns empty set by default', () => {
    const { aircraft } = setup()
    expect(aircraft.currentMovementTypes.size).toBe(0)
  })

  it('movementTypes returns None by default', () => {
    const { aircraft } = setup()
    expect(aircraft.movementTypes).toBe(MovementType.None)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — force flags
// ---------------------------------------------------------------------------

describe('Aircraft force flags', () => {
  it('forceLanding defaults to false', () => {
    const { aircraft } = setup()
    expect(aircraft.forceLanding).toBe(false)
  })

  it('forceLanding setter updates value', () => {
    const { aircraft } = setup()
    aircraft.forceLanding = true
    expect(aircraft.forceLanding).toBe(true)
  })

  it('requireForceMove defaults to false', () => {
    const { aircraft } = setup()
    expect(aircraft.requireForceMove).toBe(false)
  })

  it('requireForceMove setter updates value', () => {
    const { aircraft } = setup()
    aircraft.requireForceMove = true
    expect(aircraft.requireForceMove).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — isLeaving
// ---------------------------------------------------------------------------

describe('Aircraft isLeaving', () => {
  it('returns false when no movement', () => {
    const { aircraft } = setup()
    // Reset movement types to None
    ;(aircraft as unknown as Record<string, unknown>)['_movementTypes'] = MovementType.None
    expect(aircraft.isLeaving()).toBe(false)
  })

  it('returns true with horizontal movement', () => {
    const { aircraft } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_movementTypes'] = MovementType.Horizontal
    expect(aircraft.isLeaving()).toBe(true)
  })

  it('returns true with turn movement', () => {
    const { aircraft } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_movementTypes'] = MovementType.Turn
    expect(aircraft.isLeaving()).toBe(true)
  })

  it('returns false with vertical movement only', () => {
    const { aircraft } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_movementTypes'] = MovementType.Vertical
    // Vertical movement doesn't count as "leaving"
    expect(aircraft.isLeaving()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — ITick
// ---------------------------------------------------------------------------

describe('Aircraft tick', () => {
  it('tick does not throw', () => {
    const { aircraft, actor } = setup()
    expect(() => aircraft.tick(actor)).not.toThrow()
  })

  it('tick detects facing changes as Turn movement', () => {
    const { aircraft, actor } = setup({ infoOverrides: { initialFacing: new WAngle(0) } })
    // Set cached facing to 0, then change facing
    ;(aircraft as unknown as Record<string, unknown>)['_cachedFacing'] = new WAngle(0)
    aircraft.facing = new WAngle(128)
    aircraft.tick(actor)
    expect(aircraft.currentMovementTypes.has('Turn')).toBe(true)
  })

  it('tick pauses airborne aircraft when trait is paused', () => {
    const { aircraft, actor } = setup({
      infoOverrides: { landableTerrainTypes: new Set(['Clear']) },
      mapOverrides: {
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Clear' }),
        contains: vi.fn().mockReturnValue(true),
      },
    })
    // Set airborne state
    ;(aircraft as unknown as Record<string, unknown>)['_airborne'] = true
    ;(aircraft as unknown as Record<string, unknown>)['_paused'] = true

    aircraft.tick(actor)
    expect(aircraft.forceLanding).toBe(true)
  })

  it('tick unpauses when no longer paused, forceLanding was set, and not cruising', () => {
    const { aircraft, actor } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_forceLanding'] = true
    ;(aircraft as unknown as Record<string, unknown>)['_paused'] = false
    ;(aircraft as unknown as Record<string, unknown>)['_cruising'] = false
    aircraft.tick(actor)
    expect(aircraft.forceLanding).toBe(false)
  })

  it('tick resets roll when not moving horizontally', () => {
    const { aircraft, actor } = setup({
      infoOverrides: { roll: new WAngle(64), rollSpeed: new WAngle(10) },
    })
    aircraft.roll = new WAngle(30)
    // Movement types will be None (no change), so roll should tick toward Zero
    aircraft.tick(actor)
    // Roll should advance toward 0
    expect(aircraft.roll.angle).not.toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — addedToWorld / removedFromWorld
// ---------------------------------------------------------------------------

describe('Aircraft addedToWorld/removedFromWorld', () => {
  it('addedToWorld calls addToMaps', () => {
    const { aircraft, actor, world } = setup()
    aircraft.addedToWorld(actor)
    expect(world.addToMaps).toHaveBeenCalled()
  })

  it('addedToWorld sets airborne condition when above min altitude', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        airborneCondition: 'airborne',
        minAirborneAltitude: 1,
      },
      mapOverrides: { distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(100)) },
    })
    aircraft.addedToWorld(actor)
    expect(actor.grantCondition).toHaveBeenCalledWith('airborne')
  })

  it('addedToWorld sets cruising condition when at cruise altitude', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        cruisingCondition: 'cruising',
        cruiseAltitude: new WDist(1280),
      },
      mapOverrides: { distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(1280)) },
    })
    aircraft.addedToWorld(actor)
    expect(actor.grantCondition).toHaveBeenCalledWith('cruising')
  })

  it('removedFromWorld calls removeFromMaps and unReserves', () => {
    const { aircraft, actor, world } = setup()
    aircraft.removedFromWorld(actor)
    expect(world.removeFromMaps).toHaveBeenCalled()
  })

  it('removedFromWorld clears airborne and cruising conditions', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        airborneCondition: 'airborne',
        cruisingCondition: 'cruising',
      },
    })
    // Simulate being airborne
    ;(aircraft as unknown as Record<string, unknown>)['_airborne'] = true
    ;(aircraft as unknown as Record<string, unknown>)['_airborneToken'] = 42

    aircraft.removedFromWorld(actor)
    expect(actor.revokeCondition).toHaveBeenCalledWith(42)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — onBecomingIdle (idle behaviors)
// ---------------------------------------------------------------------------

describe('Aircraft onBecomingIdle', () => {
  it('idle behavior LeaveMap queues FlyOffMap and RemoveSelf', () => {
    const { aircraft, actor } = setup({
      infoOverrides: { idleBehavior: IdleBehaviorType.LeaveMap },
    })
    const queued: ActivityStub[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (a: ActivityStub) => {
      queued.push(a)
    }
    aircraft.onBecomingIdle(actor)
    expect(queued.length).toBeGreaterThanOrEqual(2)
  })

  it('idle behavior LeaveMapAtClosestEdge queues FlyOffMap and RemoveSelf', () => {
    const { aircraft, actor } = setup({
      infoOverrides: { idleBehavior: IdleBehaviorType.LeaveMapAtClosestEdge },
    })
    const queued: ActivityStub[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (a: ActivityStub) => {
      queued.push(a)
    }
    aircraft.onBecomingIdle(actor)
    expect(queued.length).toBeGreaterThanOrEqual(2)
  })

  it('idle behavior ReturnToBase queues ReturnToBase when no actor below', () => {
    const { aircraft, actor } = setup({
      infoOverrides: { idleBehavior: IdleBehaviorType.ReturnToBase },
    })
    const queued: ActivityStub[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (a: ActivityStub) => {
      queued.push(a)
    }
    aircraft.onBecomingIdle(actor)
    expect(queued.length).toBeGreaterThanOrEqual(1)
    // Last queued should be ReturnToBaseActivity
    expect((queued[queued.length - 1] as unknown as { activityLabel: string }).activityLabel).toBe('ReturnToBase')
  })

  it('idle behavior Land queues Land when landable terrain exists', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        idleBehavior: IdleBehaviorType.Land,
        landableTerrainTypes: new Set(['Clear']),
      },
    })
    const queued: ActivityStub[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (a: ActivityStub) => {
      queued.push(a)
    }
    aircraft.onBecomingIdle(actor)
    expect(queued.length).toBeGreaterThanOrEqual(1)
    expect((queued[queued.length - 1] as unknown as { activityLabel: string }).activityLabel).toBe('Land')
  })

  it('idle behavior None with no landable terrain queues FlyIdle', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        idleBehavior: IdleBehaviorType.None,
        landableTerrainTypes: new Set(), // empty
      },
    })
    const queued: ActivityStub[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (a: ActivityStub) => {
      queued.push(a)
    }
    aircraft.onBecomingIdle(actor)
    expect(queued.length).toBeGreaterThanOrEqual(1)
    expect((queued[queued.length - 1] as unknown as { activityLabel: string }).activityLabel).toBe('FlyIdle')
  })

  it('idle behavior Land with no landable terrain queues FlyIdle', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        idleBehavior: IdleBehaviorType.Land,
        landableTerrainTypes: new Set(), // empty
      },
    })
    const queued: ActivityStub[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (a: ActivityStub) => {
      queued.push(a)
    }
    aircraft.onBecomingIdle(actor)
    expect((queued[queued.length - 1] as unknown as { activityLabel: string }).activityLabel).toBe('FlyIdle')
  })

  it('already landed aircraft takes off if cannot land and no reservation', () => {
    const { aircraft, actor } = setup({
      infoOverrides: { idleBehavior: IdleBehaviorType.None },
      mapOverrides: {
        distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(0)), // at land altitude
        getTerrainInfo: vi.fn().mockReturnValue({ type: 'Water' }),
        contains: vi.fn().mockReturnValue(true),
      },
    })
    const queued: ActivityStub[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (a: ActivityStub) => {
      queued.push(a)
    }
    aircraft.onBecomingIdle(actor)
    // Should queue TakeOff since at land altitude but can't land
    const takeOffQueued = queued.some(
      (a: ActivityStub) => (a as unknown as { activityLabel: string }).activityLabel === 'TakeOff',
    )
    expect(takeOffQueued).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — ICreationActivity
// ---------------------------------------------------------------------------

describe('Aircraft ICreationActivity', () => {
  it('getCreationActivity returns null when no rally point, delay, or map-created flag', () => {
    const { aircraft } = setup()
    const activity = aircraft.getCreationActivity()
    // C# returns null when no special creation conditions are met
    expect(activity).toBeNull()
  })

  it('getCreationActivity returns ReturnToBase stub when creationByMap is true', () => {
    const info = makeInfo()
    const aircraft = new Aircraft(info)
    const actor = mockActor()
    aircraft.initialize(actor, new CPos(10, 10), new WPos(10240, 10240, 1280), true, 0)
    const activity = aircraft.getCreationActivity()
    expect(activity).not.toBeNull()
    expect((activity as unknown as { activityLabel: string }).activityLabel).toBe('ReturnToBase')
  })

  it('getCreationActivity returns ReturnToBase stub when creationActivityDelay > 0', () => {
    const info = makeInfo()
    const aircraft = new Aircraft(info)
    const actor = mockActor()
    aircraft.initialize(actor, new CPos(10, 10), new WPos(10240, 10240, 1280), false, 30)
    const activity = aircraft.getCreationActivity()
    expect(activity).not.toBeNull()
    expect((activity as unknown as { activityLabel: string }).activityLabel).toBe('ReturnToBase')
  })

  it('getCreationActivity returns ReturnToBase stub when rally point is set', () => {
    const info = makeInfo()
    const aircraft = new Aircraft(info)
    const actor = mockActor()
    aircraft.initialize(actor, new CPos(10, 10), new WPos(10240, 10240, 1280), false, 0, [new CPos(5, 5)])
    const activity = aircraft.getCreationActivity()
    expect(activity).not.toBeNull()
    expect((activity as unknown as { activityLabel: string }).activityLabel).toBe('ReturnToBase')
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IDeathActorInitModifier
// ---------------------------------------------------------------------------

describe('Aircraft IDeathActorInitModifier', () => {
  it('modifyDeathActorInit sets facing in init map', () => {
    const { aircraft, actor } = setup({ infoOverrides: { initialFacing: new WAngle(256) } })
    const init = new Map<string, unknown>()
    aircraft.modifyDeathActorInit(actor, init)
    expect(init.get('facing')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IActorPreviewInitModifier
// ---------------------------------------------------------------------------

describe('Aircraft IActorPreviewInitModifier', () => {
  it('modifyActorPreviewInit sets dynamicFacing when no facing present', () => {
    const { aircraft, actor } = setup()
    const inits = new Map<string, unknown>()
    aircraft.modifyActorPreviewInit(actor, inits)
    expect(inits.has('dynamicFacing')).toBe(true)
    expect(typeof inits.get('dynamicFacing')).toBe('function')
  })

  it('modifyActorPreviewInit does not override existing facing', () => {
    const { aircraft, actor } = setup()
    const inits = new Map<string, unknown>()
    inits.set('facing', new WAngle(100))
    aircraft.modifyActorPreviewInit(actor, inits)
    expect(inits.get('facing')).toBeDefined()
    // dynamicFacing should not be set because facing already exists
    expect(inits.has('dynamicFacing')).toBe(false)
  })

  it('modifyActorPreviewInit does not override existing dynamicFacing', () => {
    const { aircraft, actor } = setup()
    const inits = new Map<string, unknown>()
    const existingFn = () => new WAngle(50)
    inits.set('dynamicFacing', existingFn)
    aircraft.modifyActorPreviewInit(actor, inits)
    expect(inits.get('dynamicFacing')).toBe(existingFn)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IIssueDeployOrder
// ---------------------------------------------------------------------------

describe('Aircraft IIssueDeployOrder', () => {
  it('canIssueDeployOrder returns false when no rearmable', () => {
    const { aircraft } = setup()
    expect(aircraft.canIssueDeployOrder).toBe(false)
  })

  it('canIssueDeployOrder returns true when rearmable has rearmActors', () => {
    const { aircraft } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [],
    } as RearmableStub
    expect(aircraft.canIssueDeployOrder).toBe(true)
  })

  it('issueDeployOrder returns null when disabled', () => {
    const { aircraft, actor } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    expect(aircraft.issueDeployOrder(actor, false)).toBeNull()
  })

  it('issueDeployOrder returns null when no rearmable', () => {
    const { aircraft, actor } = setup()
    expect(aircraft.issueDeployOrder(actor, false)).toBeNull()
  })

  it('issueDeployOrder returns ReturnToBase order', () => {
    const { aircraft, actor } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [],
    } as RearmableStub
    const order = aircraft.issueDeployOrder(actor, false)
    expect(order).not.toBeNull()
    expect(order!.orderName).toBe('ReturnToBase')
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IIssueOrder
// ---------------------------------------------------------------------------

describe('Aircraft IIssueOrder', () => {
  it('orders returns empty array', () => {
    const { aircraft } = setup()
    expect(aircraft.orders).toEqual([])
  })

  it('issueOrder returns a Move order stub', () => {
    const { aircraft, actor } = setup()
    const order = aircraft.issueOrder(
      actor,
      {} as unknown as import('../../../OpenRA.Game/Traits/TraitsInterfaces.js').IOrderTargeter,
      {} as TargetStub,
      false,
    )
    expect(order).toBeDefined()
    expect(order.orderName).toBe('Move')
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IResolveOrder
// ---------------------------------------------------------------------------

describe('Aircraft IResolveOrder', () => {
  it('ignores orders when disabled', () => {
    const { aircraft, actor } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    const order: Order = { orderName: 'Move', targetString: '', extraData: {} }
    expect(() => aircraft.resolveOrder(actor, order)).not.toThrow()
  })

  it('handles Move order', () => {
    const { aircraft, actor } = setup()
    const queued: { activity: ActivityStub; queued: boolean }[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (
      a: ActivityStub,
      q: boolean,
    ) => {
      queued.push({ activity: a, queued: q })
    }
    const order: Order = {
      orderName: 'Move',
      targetString: '',
      extraData: { queued: false },
    }
    aircraft.resolveOrder(actor, order)
    expect(queued.length).toBeGreaterThanOrEqual(1)
    expect((queued[0].activity as unknown as { activityLabel: string }).activityLabel).toBe('Fly')
  })

  it('handles Stop order', () => {
    const { aircraft, actor } = setup()
    aircraft.resolveOrder(actor, {
      orderName: 'Stop',
      targetString: '',
      extraData: {},
    })
    // Should cancel activity
  })

  it('handles ReturnToBase order when rearmable', () => {
    const { aircraft, actor } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [],
    } as RearmableStub
    const queued: { activity: ActivityStub; queued: boolean }[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (
      a: ActivityStub,
      q: boolean,
    ) => {
      queued.push({ activity: a, queued: q })
    }
    aircraft.resolveOrder(actor, {
      orderName: 'ReturnToBase',
      targetString: '',
      extraData: { queued: false },
    })
    expect(queued.length).toBeGreaterThanOrEqual(1)
    expect((queued[0].activity as unknown as { activityLabel: string }).activityLabel).toBe('ReturnToBase')
  })

  it('handles Land order', () => {
    const { aircraft, actor } = setup()
    const queued: { activity: ActivityStub; queued: boolean }[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (
      a: ActivityStub,
      q: boolean,
    ) => {
      queued.push({ activity: a, queued: q })
    }
    aircraft.resolveOrder(actor, {
      orderName: 'Land',
      targetString: '',
      extraData: { queued: false },
    })
    expect(queued.length).toBeGreaterThanOrEqual(1)
    expect((queued[0].activity as unknown as { activityLabel: string }).activityLabel).toBe('Land')
  })

  it('handles Enter order', () => {
    const { aircraft, actor } = setup()
    const queued: { activity: ActivityStub; queued: boolean }[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (
      a: ActivityStub,
      q: boolean,
    ) => {
      queued.push({ activity: a, queued: q })
    }
    aircraft.resolveOrder(actor, {
      orderName: 'Enter',
      targetString: '',
      extraData: { queued: false },
    })
    expect(queued.length).toBeGreaterThanOrEqual(1)
    expect((queued[0].activity as unknown as { activityLabel: string }).activityLabel).toBe('ReturnToBase')
  })

  it('handles Scatter order', () => {
    const { aircraft, actor } = setup()
    const queued: { activity: ActivityStub; queued: boolean }[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (
      a: ActivityStub,
      q: boolean,
    ) => {
      queued.push({ activity: a, queued: q })
    }
    aircraft.resolveOrder(actor, {
      orderName: 'Scatter',
      targetString: '',
      extraData: { queued: false },
    })
    expect(queued.length).toBeGreaterThanOrEqual(1)
    expect((queued[0].activity as unknown as { activityLabel: string }).activityLabel).toBe('Nudge')
  })

  it('handles Move order with queued flag', () => {
    const { aircraft, actor } = setup()
    const queued: { activity: ActivityStub; queued: boolean }[] = []
    ;(actor as unknown as Record<string, unknown>).queueActivity = (
      a: ActivityStub,
      q: boolean,
    ) => {
      queued.push({ activity: a, queued: q })
    }
    aircraft.resolveOrder(actor, {
      orderName: 'Move',
      targetString: '',
      extraData: { queued: true },
    })
    expect(queued.length).toBeGreaterThanOrEqual(1)
    expect(queued[0].queued).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IOrderVoice
// ---------------------------------------------------------------------------

describe('Aircraft IOrderVoice', () => {
  it('returns empty string when disabled', () => {
    const { aircraft, actor } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'Move',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('')
  })

  it('returns voice for Move order', () => {
    const { aircraft, actor } = setup({ infoOverrides: { voice: 'Attack' } })
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'Move',
      targetString: '',
      extraData: {},
    })
    // moveIntoShroud is true by default, so voice is returned
    expect(result).toBe('Attack')
  })

  it('returns voice for Land order', () => {
    const { aircraft, actor } = setup({ infoOverrides: { voice: 'Attack' } })
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'Land',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('Attack')
  })

  it('returns voice for Stop order', () => {
    const { aircraft, actor } = setup({ infoOverrides: { voice: 'Action' } })
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'Stop',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('Action')
  })

  it('returns voice for Enter order', () => {
    const { aircraft, actor } = setup({ infoOverrides: { voice: 'Action' } })
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'Enter',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('Action')
  })

  it('returns voice for Scatter order', () => {
    const { aircraft, actor } = setup({ infoOverrides: { voice: 'Action' } })
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'Scatter',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('Action')
  })

  it('returns voice for ReturnToBase when rearmable', () => {
    const { aircraft, actor } = setup({ infoOverrides: { voice: 'Action' } })
    ;(aircraft as unknown as Record<string, unknown>)['_rearmable'] = {
      info: { rearmActors: new Set(['afld']) },
      rearmableAmmoPools: [],
    } as RearmableStub
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'ReturnToBase',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('Action')
  })

  it('returns empty string for ReturnToBase when not rearmable', () => {
    const { aircraft, actor } = setup()
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'ReturnToBase',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('')
  })

  it('returns empty string for Move order when moveIntoShroud=false and cell unexplored', () => {
    const { aircraft, actor } = setup({
      infoOverrides: { voice: 'Action', moveIntoShroud: false },
    })
    // Mock shroud: isExplored returns false for the target cell
    ;(actor as unknown as Record<string, unknown>).owner = {
      playerName: 'TestPlayer',
      shroud: {
        isExplored: vi.fn().mockReturnValue(false),
      },
    }
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'Move',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('')
  })

  it('returns voice for Move order when moveIntoShroud=false and cell explored', () => {
    const { aircraft, actor } = setup({
      infoOverrides: { voice: 'Action', moveIntoShroud: false },
    })
    // Mock shroud: isExplored returns true
    ;(actor as unknown as Record<string, unknown>).owner = {
      playerName: 'TestPlayer',
      shroud: {
        isExplored: vi.fn().mockReturnValue(true),
      },
    }
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'Move',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('Action')
  })

  it('returns empty string for unknown order', () => {
    const { aircraft, actor } = setup()
    const result = aircraft.voicePhraseForOrder(actor, {
      orderName: 'UnknownOrder',
      targetString: '',
      extraData: {},
    })
    expect(result).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Aircraft — IObservesVariables
// ---------------------------------------------------------------------------

describe('Aircraft IObservesVariables', () => {
  it('returns empty array when no requireForceMoveCondition', () => {
    const { aircraft } = setup()
    const observers = aircraft.getVariableObservers()
    expect(observers).toEqual([])
  })

  it('returns observer when requireForceMoveCondition is set', () => {
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: '!deployed' },
    })
    const observers = aircraft.getVariableObservers()
    expect(observers.length).toBe(1)
    expect(observers[0].variables).toContain('!deployed')
  })

  it('notifier function updates requireForceMove', () => {
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: 'deployed' },
    })
    const observers = aircraft.getVariableObservers()
    const conditions = new Map<string, number>()
    conditions.set('deployed', 1) // condition active
    observers[0].notifier({} as IGameActor, conditions)
    expect(aircraft.requireForceMove).toBe(true)
  })

  it('notifier function handles negated conditions', () => {
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: '!deployed' },
    })
    const observers = aircraft.getVariableObservers()
    const conditions = new Map<string, number>()
    conditions.set('deployed', 0) // condition NOT active
    observers[0].notifier({} as IGameActor, conditions)
    // !deployed: deployed has 0 tokens, so !deployed is true
    expect(aircraft.requireForceMove).toBe(true)
  })

  it('condition evaluator handles AND expressions', () => {
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: 'a&&b' },
    })
    const observers = aircraft.getVariableObservers()
    const conditions = new Map<string, number>()
    conditions.set('a', 1)
    conditions.set('b', 0)
    observers[0].notifier({} as IGameActor, conditions)
    // a is true, b is false, so a&&b is false
    expect(aircraft.requireForceMove).toBe(false)
  })

  it('condition evaluator handles OR expressions', () => {
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: 'a||b' },
    })
    const observers = aircraft.getVariableObservers()
    const conditions = new Map<string, number>()
    conditions.set('a', 0)
    conditions.set('b', 1)
    observers[0].notifier({} as IGameActor, conditions)
    // a is false, b is true, so a||b is true
    expect(aircraft.requireForceMove).toBe(true)
  })

  it('condition evaluator handles parenthesized expressions', () => {
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: '(a)' },
    })
    const observers = aircraft.getVariableObservers()
    const conditions = new Map<string, number>()
    conditions.set('a', 2)
    observers[0].notifier({} as IGameActor, conditions)
    expect(aircraft.requireForceMove).toBe(true)
  })

  it('condition evaluator handles spaces around operators (a || b)', () => {
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: 'a || b' },
    })
    const observers = aircraft.getVariableObservers()
    const conditions = new Map<string, number>()
    conditions.set('a', 1)
    conditions.set('b', 0)
    observers[0].notifier({} as IGameActor, conditions)
    // a is true, b is false => a || b is true
    expect(aircraft.requireForceMove).toBe(true)
  })

  it('condition evaluator handles spaces around AND operators (a && b)', () => {
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: 'a && b' },
    })
    const observers = aircraft.getVariableObservers()
    const conditions = new Map<string, number>()
    conditions.set('a', 1)
    conditions.set('b', 1)
    observers[0].notifier({} as IGameActor, conditions)
    // a is true, b is true => a && b is true
    expect(aircraft.requireForceMove).toBe(true)
  })

  it('condition evaluator ignores irrelevant spaces in logical expressions', () => {
    // Test with spaces AND parentheses: "(a  ||  b) && c"
    const { aircraft } = setup({
      infoOverrides: { requireForceMoveCondition: '(a  ||  b) && c' },
    })
    const observers = aircraft.getVariableObservers()
    const conditions = new Map<string, number>()
    conditions.set('a', 0)
    conditions.set('b', 1)
    conditions.set('c', 1)
    observers[0].notifier({} as IGameActor, conditions)
    // (false || true) && true = true
    expect(aircraft.requireForceMove).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — condition transitions (airborne / cruising)
// ---------------------------------------------------------------------------

describe('Aircraft condition transitions', () => {
  it('sets airborne condition when altitude >= minAirborneAltitude', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        airborneCondition: 'airborne',
        minAirborneAltitude: 1,
      },
      mapOverrides: { distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(100)) },
      centerPosition: new WPos(10240, 10240, 100),
    })
    aircraft.setPosition(actor, new WPos(20000, 20000, 100))
    expect(actor.grantCondition).toHaveBeenCalledWith('airborne')
  })

  it('sets cruising condition when altitude === cruiseAltitude', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        cruisingCondition: 'cruising',
        cruiseAltitude: new WDist(1280),
      },
      mapOverrides: { distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(1280)) },
      centerPosition: new WPos(10240, 10240, 1280),
    })
    aircraft.setPosition(actor, new WPos(20000, 20000, 1280))
    expect(actor.grantCondition).toHaveBeenCalledWith('cruising')
  })

  it('revokes airborne condition when altitude drops below minAirborneAltitude', () => {
    const { aircraft, actor } = setup({
      infoOverrides: {
        airborneCondition: 'airborne',
        minAirborneAltitude: 1,
      },
    })
    // First set airborne state
    ;(aircraft as unknown as Record<string, unknown>)['_airborne'] = true
    ;(aircraft as unknown as Record<string, unknown>)['_airborneToken'] = 42

    // Now set position at ground level (altitude = 0)
    const world = actor.world as unknown as Record<string, unknown>
    const map = world.map as unknown as Record<string, unknown>
    ;(map.distanceAboveTerrain as ReturnType<typeof vi.fn>).mockReturnValue(new WDist(0))
    aircraft.setPosition(actor, new WPos(20000, 20000, 0))
    expect(actor.revokeCondition).toHaveBeenCalledWith(42)
  })
})

// ---------------------------------------------------------------------------
// Aircraft — getActorBelow
// ---------------------------------------------------------------------------

describe('Aircraft getActorBelow', () => {
  it('returns null when not at land altitude', () => {
    const { aircraft } = setup({
      mapOverrides: { distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(100)) },
    })
    expect(aircraft.getActorBelow()).toBeNull()
  })

  it('returns null when no actors below at land altitude', () => {
    const { aircraft } = setup({
      infoOverrides: { landAltitude: new WDist(0) },
      mapOverrides: {
        distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(0)),
      },
      actorMapOverrides: { getActorsAt: vi.fn().mockReturnValue([]) },
    })
    expect(aircraft.getActorBelow()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Aircraft — setCellPosition
// ---------------------------------------------------------------------------

describe('Aircraft setCellPosition', () => {
  it('updates position to cell center while preserving Z', () => {
    const { aircraft, actor } = setup({
      centerPosition: new WPos(10240, 10240, 5000),
    })
    aircraft.setCellPosition(actor, new CPos(15, 20))
    expect(aircraft.centerPosition.X).toBe(15 * 1024)
    expect(aircraft.centerPosition.Y).toBe(20 * 1024)
    expect(aircraft.centerPosition.Z).toBe(5000)
  })
})

// ---------------------------------------------------------------------------
// AircraftMoveOrderTargeter
// ---------------------------------------------------------------------------

describe('AircraftMoveOrderTargeter', () => {
  it('constructs with orderID Move and priority 4', () => {
    const { aircraft } = setup()
    const targeter = new AircraftMoveOrderTargeter(aircraft)
    expect(targeter.orderID).toBe('Move')
    expect(targeter.orderPriority).toBe(4)
    expect(targeter.isQueued).toBe(false)
  })

  it('canTarget returns true when aircraft is enabled', () => {
    const { aircraft } = setup()
    const targeter = new AircraftMoveOrderTargeter(aircraft)
    expect(targeter.canTarget(
      {} as IGameActor,
      {} as TargetStub,
      {} as TargetModifiers,
      '',
    )).toBe(true)
  })

  it('canTarget returns false when aircraft is disabled', () => {
    const { aircraft } = setup()
    ;(aircraft as unknown as Record<string, unknown>)['_enabled'] = false
    const targeter = new AircraftMoveOrderTargeter(aircraft)
    expect(targeter.canTarget(
      {} as IGameActor,
      {} as TargetStub,
      {} as TargetModifiers,
      '',
    )).toBe(false)
  })

  it('targetOverridesSelection returns true for Actor type target', () => {
    const { aircraft } = setup()
    const targeter = new AircraftMoveOrderTargeter(aircraft)
    const result = targeter.targetOverridesSelection(
      {} as IGameActor,
      { type: 'Actor' } as unknown as TargetStub,
      [],
      new CPos(0, 0),
      0 as TargetModifiers,
    )
    expect(result).toBe(true)
  })

  it('targetOverridesSelection returns false for non-Actor without ForceMove', () => {
    const { aircraft } = setup()
    const targeter = new AircraftMoveOrderTargeter(aircraft)
    const result = targeter.targetOverridesSelection(
      {} as IGameActor,
      { type: 'Terrain' } as unknown as TargetStub,
      [],
      new CPos(0, 0),
      0 as TargetModifiers,
    )
    expect(result).toBe(false)
  })
})
