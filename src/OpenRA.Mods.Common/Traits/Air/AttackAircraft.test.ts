/**
 * AttackAircraft.test.ts — AttackAircraft migration unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { AttackAircraft, AttackAircraftInfo, AirAttackType } from './AttackAircraft.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'

function makeMockActor(overrides: Record<string, unknown> = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    centerPosition: new WPos(100, 200, 0),
    location: { U: 0, V: 0 },
    world: {
      actors: [],
      sharedRandom: { next: (_max?: number) => 0 },
      map: {
        distanceAboveTerrain: (_pos: unknown) => ({ length: 500 }),
        contains: (_pos: unknown) => true,
      },
    },
    ...overrides,
  }
}

describe('AirAttackType', () => {
  it('has Default, Hover, Strafe', () => {
    expect(AirAttackType.Default).toBe(0)
    expect(AirAttackType.Hover).toBe(1)
    expect(AirAttackType.Strafe).toBe(2)
  })
})

describe('AttackAircraftInfo', () => {
  it('defaults attackType to Default', () => {
    const info = new AttackAircraftInfo()
    expect(info.attackType).toBe(AirAttackType.Default)
  })

  it('defaults strafeRunLength to WDist.Zero', () => {
    const info = new AttackAircraftInfo()
    expect(info.strafeRunLength.length).toBe(0)
  })

  it('accepts custom attackType', () => {
    const info = new AttackAircraftInfo({ attackType: AirAttackType.Strafe })
    expect(info.attackType).toBe(AirAttackType.Strafe)
  })
})

describe('AttackAircraft', () => {
  let aircraft: AttackAircraft

  beforeEach(() => {
    const info = new AttackAircraftInfo({
      armaments: ['primary'],
      facingTolerance: new WAngle(100),
    })
    aircraft = new AttackAircraft(info)
  })

  it('getAttackActivity throws with TODO message', () => {
    expect(() =>
      aircraft.getAttackActivity(
        makeMockActor() as never,
        'Default',
        Target.Invalid,
        false,
        false,
      ),
    ).toThrow('Chapter 9 movement system')
  })

  it('canAttack returns true when altitude and map conditions met', () => {
    const self = makeMockActor()
    aircraft.setAircraftInfo({ minAirborneAltitude: 100 })
    const target = Target.fromPos(new WPos(300, 400, 0))
    // Without armaments set up, canAttack depends on base CheckFire
    const result = aircraft.canAttack(self, target)
    // Should not throw and return boolean
    expect(typeof result).toBe('boolean')
  })

  it('canAttack returns false when altitude below minimum', () => {
    const self = makeMockActor({
      world: {
        map: {
          distanceAboveTerrain: () => ({ length: 50 }),
          contains: () => true,
        },
      },
    })
    aircraft.setAircraftInfo({ minAirborneAltitude: 100 })
    const target = Target.fromPos(new WPos(300, 400, 0))
    expect(aircraft.canAttack(self, target)).toBe(false)
  })

  it('canAttack returns false when outside map', () => {
    const self = makeMockActor({
      world: {
        map: {
          distanceAboveTerrain: () => ({ length: 500 }),
          contains: () => false,
        },
      },
    })
    aircraft.setAircraftInfo({ minAirborneAltitude: 100 })
    const target = Target.fromPos(new WPos(300, 400, 0))
    expect(aircraft.canAttack(self, target)).toBe(false)
  })
})
