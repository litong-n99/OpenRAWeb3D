/**
 * Turreted.test.ts — Turreted migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  Turreted,
  TurretedInfo,
  TurretFacingInit,
  DynamicTurretFacingInit,
} from './Turreted.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WRot } from '../../OpenRA.Game/WRot.js'

describe('TurretedInfo', () => {
  it('defaults turret to primary', () => {
    const info = new TurretedInfo()
    expect(info.turret).toBe('primary')
  })

  it('defaults turnSpeed to 512', () => {
    const info = new TurretedInfo()
    expect(info.turnSpeed.angle).toBe(512)
  })

  it('defaults initialFacing to WAngle.Zero', () => {
    const info = new TurretedInfo()
    expect(info.initialFacing.angle).toBe(0)
  })

  it('defaults realignDelay to 40', () => {
    const info = new TurretedInfo()
    expect(info.realignDelay).toBe(40)
  })

  it('defaults offset to WVec.Zero', () => {
    const info = new TurretedInfo()
    expect(info.offset.X).toBe(0)
    expect(info.offset.Y).toBe(0)
    expect(info.offset.Z).toBe(0)
  })
})

describe('TurretFacingInit', () => {
  it('stores value and traitInfo', () => {
    const info = new TurretedInfo({ turret: 'primary' })
    const init = new TurretFacingInit(info, new WAngle(512))
    expect(init.value.angle).toBe(512)
    expect(init.traitInfo).toBe(info)
  })
})

describe('DynamicTurretFacingInit', () => {
  it('stores value factory and traitInfo', () => {
    const info = new TurretedInfo()
    const init = new DynamicTurretFacingInit(info, () => new WAngle(256))
    expect(init.value().angle).toBe(256)
    expect(init.traitInfo).toBe(info)
  })
})

describe('Turreted', () => {
  it('initializes localOrientation from initialFacing', () => {
    const info = new TurretedInfo({ initialFacing: new WAngle(512) })
    const turreted = new Turreted(info)
    expect(turreted.localOrientation.yaw.angle).toBe(512)
  })

  it('name matches info.turret', () => {
    const info = new TurretedInfo({ turret: 'secondary' })
    const turreted = new Turreted(info)
    expect(turreted.name).toBe('secondary')
  })

  it('worldOrientation includes body facing', () => {
    const info = new TurretedInfo({ initialFacing: new WAngle(256) })
    const turreted = new Turreted(info)

    const mockFacing = {
      facing: new WAngle(128),
      turnSpeed: WAngle.Zero,
      orientation: WRot.fromYaw(new WAngle(128)),
    }

    turreted.created({} as never, null, mockFacing, {})

    // World orientation = local rotation + body facing: 256 + 128 = 384
    expect(turreted.worldOrientation.yaw.angle).toBe(384)
  })

  it('worldOrientation equals local when no facing', () => {
    const info = new TurretedInfo({ initialFacing: new WAngle(256) })
    const turreted = new Turreted(info)
    turreted.created({} as never, null, null, {})

    expect(turreted.worldOrientation.yaw.angle).toBe(256)
  })

  it('moveTurret rotates toward desired direction', () => {
    const info = new TurretedInfo({ turnSpeed: new WAngle(128), initialFacing: new WAngle(0) })
    const turreted = new Turreted(info)

    // Set a direction and verify the turret rotates toward it
    turreted.desiredDirection = new WVec(0, 100, 0)
    const targetYaw = turreted.desiredDirection.yaw.angle

    // First tick: rotate from 0 toward targetYaw by 128
    turreted.tick({} as never)
    const afterFirst = turreted.localOrientation.yaw.angle
    expect(afterFirst).not.toBe(0) // should have moved
    expect(turreted.hasAchievedDesiredFacing).toBe(turreted.localOrientation.yaw.angle === targetYaw)

    // Second tick: continue rotating
    turreted.tick({} as never)
    const afterSecond = turreted.localOrientation.yaw.angle
    expect(afterSecond).not.toBe(afterFirst) // should have moved further
  })

  it('does not rotate when disabled', () => {
    const info = new TurretedInfo({ turnSpeed: new WAngle(512) })
    const turreted = new Turreted(info)
    ;(turreted as unknown as { _enabled: boolean })._enabled = false
    turreted.desiredDirection = new WVec(0, 100, 0)

    turreted.tick({} as never)
    expect(turreted.localOrientation.yaw.angle).toBe(0) // unchanged
  })

  it('realigns to initial facing after delay with no attack aiming', () => {
    const info = new TurretedInfo({
      initialFacing: new WAngle(64),
      realignDelay: 3,
      turnSpeed: new WAngle(64),
    })
    const turreted = new Turreted(info)
    // Need an attack (not aiming) for realignment to occur
    const mockAttack = { isAiming: false, isTraitDisabled: false, isTraitPaused: false }
    turreted.created({} as never, mockAttack, null, {})

    // Set a desired direction to rotate away
    turreted.desiredDirection = new WVec(0, 100, 0)
    turreted.tick({} as never) // moveTurret called (attack not aiming)

    // After 3 ticks with attack not aiming, realignTick increments
    turreted.tick({} as never) // realignTick++ = 1
    turreted.tick({} as never) // 2
    turreted.tick({} as never) // 3 -> triggers realignDesired
    expect(turreted.realignDesired).toBe(true)
    expect(WVec.equals(turreted.desiredDirection, WVec.Zero)).toBe(true)
  })

  it('realignTick stays at 0 when attack is aiming', () => {
    const info = new TurretedInfo({ realignDelay: 3 })
    const turreted = new Turreted(info)
    const mockAttack = { isAiming: true, isTraitDisabled: false, isTraitPaused: false }
    turreted.created({} as never, mockAttack, null, {})

    turreted.tick({} as never)
    expect(turreted.realignTick).toBe(0)
  })

  it('hasAchievedDesiredFacing returns true when at desired', () => {
    const info = new TurretedInfo({ initialFacing: new WAngle(0) })
    const turreted = new Turreted(info)
    expect(turreted.hasAchievedDesiredFacing).toBe(true)
  })

  it('faceTarget returns false when target is invalid', () => {
    const info = new TurretedInfo()
    const turreted = new Turreted(info)
    const mockAttack = {
      isTraitDisabled: false,
      isTraitPaused: false,
      getTargetPosition: vi.fn(),
    }
    turreted.created({} as never, mockAttack, null, {})

    const result = turreted.faceTarget({} as never, { type: 0 }) // type 0 = Invalid
    expect(result).toBe(false)
    expect(WVec.equals(turreted.desiredDirection, WVec.Zero)).toBe(true)
  })

  it('faceTarget sets desiredDirection when target is valid', () => {
    const info = new TurretedInfo({ turnSpeed: new WAngle(512) })
    const turreted = new Turreted(info)
    const mockAttack = {
      isTraitDisabled: false,
      isTraitPaused: false,
      getTargetPosition: vi.fn(() => ({ X: 200, Y: 300, Z: 0 })),
    }
    const self = { centerPosition: { X: 100, Y: 200, Z: 0 } }
    turreted.created(self as never, mockAttack, null, {})

    const target = { type: 1, centerPosition: { X: 200, Y: 300, Z: 0 } } // Actor type
    const result = turreted.faceTarget(self as never, target)
    expect(mockAttack.getTargetPosition).toHaveBeenCalled()
    expect(result).toBe(true) // turret moved to facing
  })

  it('WAngle.tickFacing rotates toward desired', () => {
    const current = new WAngle(0)
    const desired = new WAngle(200)
    const step = new WAngle(50)
    const result = WAngle.tickFacing(current, desired, step)
    expect(result.angle).toBe(50)
  })

  it('WAngle.tickFacing handles wrap-around correctly', () => {
    const current = new WAngle(1000)
    const desired = new WAngle(10)
    const step = new WAngle(50)
    const result = WAngle.tickFacing(current, desired, step)
    expect(result.angle).toBe(10)
  })

  it('tickFacing reduces step when close to target', () => {
    const current = new WAngle(100)
    const desired = new WAngle(120)
    const step = new WAngle(50)
    // diff = 20, move = min(20, 50) = 20, result = 120
    const result = WAngle.tickFacing(current, desired, step)
    expect(result.angle).toBe(120)
  })

  it('totalOffset includes info.offset + localOffset', () => {
    const info = new TurretedInfo({ offset: new WVec(10, 0, 5) })
    const turreted = new Turreted(info)
    expect(turreted.totalOffset.X).toBe(10)
    expect(turreted.totalOffset.Z).toBe(5)
  })

  it('worldFacingFromInit returns default when no init', () => {
    const info = new TurretedInfo({ initialFacing: new WAngle(256) })
    const fn = Turreted.worldFacingFromInit({}, info, new WAngle(100))
    expect(fn().angle).toBe(100)
  })

  it('worldFacingFromInit returns turret facing from init', () => {
    const info = new TurretedInfo()
    const init = { turretFacing: new TurretFacingInit(info, new WAngle(512)) }
    const fn = Turreted.worldFacingFromInit(init, info, WAngle.Zero)
    expect(fn().angle).toBe(512)
  })

  it('localFacingFromInit returns initialFacing when no init', () => {
    const info = new TurretedInfo({ initialFacing: new WAngle(300) })
    const fn = Turreted.localFacingFromInit({}, info)
    expect(fn().angle).toBe(300)
  })
})
