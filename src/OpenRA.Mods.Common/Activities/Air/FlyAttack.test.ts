/**
 * FlyAttack.test.ts — Phase C Batch 3 FlyAttack activity tests
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

import { FlyAttack } from './FlyAttack'
import { createMockAircraft } from './AirTestHelpers'
import { Target } from '../../../OpenRA.Game/Traits/Target'
import { WDist } from '../../../OpenRA.Game/WDist'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import { AttackSource } from '../../Traits/Attack/AttackBase'
import { AirAttackType } from '../../Traits/Air/AttackAircraft'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockAttackAircraft(options: {
  attackType?: AirAttackType
  abortOnResupply?: boolean
  armamentsPaused?: boolean
  hasAnyValidWeapons?: boolean
} = {}) {
  const attackAircraft = {
    isTraitDisabled: false,
    isTraitPaused: false,
    info: {
      attackType: options.attackType ?? AirAttackType.Default,
      abortOnResupply: options.abortOnResupply ?? true,
      facingTolerance: new WAngle(512),
      strafeRunLength: WDist.Zero,
    },
    requestedTarget: Target.Invalid,
    setRequestedTarget: vi.fn(),
    clearRequestedTarget: vi.fn(),
    chooseArmamentsForTarget: vi.fn(() => [{} as never]),
    hasAnyValidWeapons: vi.fn(() => options.hasAnyValidWeapons ?? true),
    getMaximumRangeVersusTarget: vi.fn(() => new WDist(5000)),
    getMinimumRangeVersusTarget: vi.fn(() => WDist.Zero),
    getTargetPosition: vi.fn((_pos: WPos, target: Target) => target.centerPosition),
    targetInFiringArc: vi.fn(() => true),
    armaments: [
      {
        isTraitPaused: options.armamentsPaused ?? false,
        weapon: {
          isValidAgainst: () => true,
        },
      },
    ],
  }
  return attackAircraft
}

function createFlyAttackActor(aircraft: ReturnType<typeof createMockAircraft>, attackAircraft: unknown, extraTraits?: Map<string, unknown>) {
  const traits = new Map<string, unknown>([
    ['Aircraft', aircraft],
    ['AttackAircraft', attackAircraft],
  ])
  if (extraTraits) {
    for (const [k, v] of extraTraits) traits.set(k, v)
  }

  return {
    traits,
    centerPosition: aircraft.centerPosition,
    location: { X: 0, Y: 0, Bits: 0 },
    owner: {},
    world: {
      map: {
        distanceAboveTerrain: (pos: WPos) => new WDist(pos.Z),
        cellContaining: () => ({ X: 0, Y: 0, Bits: 0 }),
      },
      actors: [],
      sharedRandom: 42,
    },
    currentActivity: { isCanceling: false, nextActivity: null },
    isDead: false,
    isInWorld: true,
  } as unknown as never
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlyAttack', () => {
  it('requires Aircraft trait', () => {
    const actor = { traits: new Map([['AttackAircraft', createMockAttackAircraft()]]) } as unknown as never
    const target = Target.fromPos(new WPos(1000, 0, 1280))
    expect(() => new FlyAttack(actor, AttackSource.Default, target, false)).toThrow('FlyAttack requires an Aircraft trait')
  })

  it('requires AttackAircraft trait', () => {
    const aircraft = createMockAircraft()
    const actor = { traits: new Map([['Aircraft', aircraft]]) } as unknown as never
    const target = Target.fromPos(new WPos(1000, 0, 1280))
    expect(() => new FlyAttack(actor, AttackSource.Default, target, false)).toThrow('FlyAttack requires an AttackAircraft trait')
  })

  it('cancels when no armaments for target', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280) })
    const attackAircraft = createMockAttackAircraft({ hasAnyValidWeapons: false })
    attackAircraft.chooseArmamentsForTarget = vi.fn(() => [])
    const actor = createFlyAttackActor(aircraft, attackAircraft)
    const target = Target.fromPos(new WPos(1000, 0, 1280))

    const flyAttack = new FlyAttack(actor, AttackSource.Default, target, false)
    ;(flyAttack as unknown as { state: number }).state = 1 // Active
    const result = flyAttack.tick(actor)
    expect(result).toBe(true)
  })

  it('queues TakeOff when airborne and in range', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const attackAircraft = createMockAttackAircraft()
    const actor = createFlyAttackActor(aircraft, attackAircraft)
    const target = Target.fromPos(new WPos(0, 0, 1280))

    const flyAttack = new FlyAttack(actor, AttackSource.Default, target, false)
    ;(flyAttack as unknown as { state: number }).state = 1 // Active
    const result = flyAttack.tick(actor)
    expect(result).toBe(false)
    expect((flyAttack as unknown as { _childActivity: unknown })._childActivity).not.toBeNull()
  })

  it('queues Fly when out of range', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const attackAircraft = createMockAttackAircraft()
    const actor = createFlyAttackActor(aircraft, attackAircraft)
    const target = Target.fromPos(new WPos(10000, 0, 1280))

    const flyAttack = new FlyAttack(actor, AttackSource.Default, target, false)
    ;(flyAttack as unknown as { state: number }).state = 1 // Active
    const result = flyAttack.tick(actor)
    expect(result).toBe(false)
    expect((flyAttack as unknown as { _childActivity: unknown })._childActivity).not.toBeNull()
  })

  it('returns to base when ammo depleted and AbortOnResupply true', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const attackAircraft = createMockAttackAircraft({ abortOnResupply: true, armamentsPaused: true })
    const actor = createFlyAttackActor(aircraft, attackAircraft, new Map([['Rearmable', {}]]))
    const target = Target.fromPos(new WPos(1000, 0, 1280))

    const flyAttack = new FlyAttack(actor, AttackSource.Default, target, false)
    ;(flyAttack as unknown as { state: number }).state = 1 // Active
    const result = flyAttack.tick(actor)
    expect(result).toBe(true)
    expect((flyAttack as unknown as { returnToBase: boolean }).returnToBase).toBe(true)
  })

  it('queues ReturnToBase as child when ammo depleted and AbortOnResupply false', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const attackAircraft = createMockAttackAircraft({ abortOnResupply: false, armamentsPaused: true })
    const actor = createFlyAttackActor(aircraft, attackAircraft, new Map([['Rearmable', {}]]))
    const target = Target.fromPos(new WPos(1000, 0, 1280))

    const flyAttack = new FlyAttack(actor, AttackSource.Default, target, false)
    ;(flyAttack as unknown as { state: number }).state = 1 // Active
    const result = flyAttack.tick(actor)
    expect(result).toBe(false)
    expect((flyAttack as unknown as { returnToBase: boolean }).returnToBase).toBe(true)
  })

  it('attack-move never resupplies', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const attackAircraft = createMockAttackAircraft({ armamentsPaused: true })
    const actor = createFlyAttackActor(aircraft, attackAircraft, new Map([['Rearmable', {}]]))
    const target = Target.fromPos(new WPos(1000, 0, 1280))

    const flyAttack = new FlyAttack(actor, AttackSource.AttackMove, target, false)
    ;(flyAttack as unknown as { state: number }).state = 1 // Active
    const result = flyAttack.tick(actor)
    expect(result).toBe(true)
  })

  it('renders target line when color provided', () => {
    const aircraft = createMockAircraft({ centerPosition: new WPos(0, 0, 1280), canHover: true })
    const attackAircraft = createMockAttackAircraft()
    const actor = createFlyAttackActor(aircraft, attackAircraft)
    const target = Target.fromPos(new WPos(1000, 0, 1280))
    const color = { r: 255, g: 0, b: 0, a: 255 }

    const flyAttack = new FlyAttack(actor, AttackSource.Default, target, false, color)
    const nodes = flyAttack.targetLineNodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].color).toBe(color)
  })
})
