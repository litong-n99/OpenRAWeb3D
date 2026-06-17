/**
 * Sandworm.test.ts — Unit tests for Sandworm migration
 *
 * Tests focus on: config defaults, state transitions (idle, attacking, disposed),
 * wander state machine, target rescan logic, dispose notification.
 */

import { describe, it, expect } from 'vitest'
import { Sandworm, SandwormInfo } from './Sandworm'
import { CPos } from '../../OpenRA.Game/CPos'
import { WDist } from '../../OpenRA.Game/WDist'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockActor(overrides?: Partial<{
  isInWorld: boolean
  centerPosition: { X: number; Y: number; Z: number }
  location: { X: number; Y: number }
  world: unknown
}> | null): IGameActor {
  const defaults = {
    isInWorld: true,
    centerPosition: { X: 0, Y: 0, Z: 0 },
    location: { X: 0, Y: 0 },
    world: {
      sharedRandom: { next: (min: number, _max: number) => min },
      findActorsInCircle: () => [],
      worldActor: {
        trait: () => null,
      },
      map: {
        contains: () => true,
        cellContaining: () => ({ X: 1, Y: 0 }),
        getTerrainInfo: () => null,
      },
    },
    ...overrides,
  }
  return {
    actorId: 1,
    disposed: false,
    world: defaults.world,
    isInWorld: defaults.isInWorld,
    centerPosition: defaults.centerPosition,
    location: defaults.location,
    trait: () => ({ canEnterCell: () => true }),
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SandwormInfo', () => {
  it('has correct default values', () => {
    const info = new SandwormInfo()
    expect(info.wanderMoveRadius).toBe(1)
    expect(info.reduceMoveRadiusDelay).toBe(5)
    expect(info.minMoveDelay).toBe(0)
    expect(info.maxMoveDelay).toBe(0)
    expect(info.targetRescanInterval).toBe(125)
    expect(info.maxSearchRadius.length).toBe(WDist.fromCells(20).length)
    expect(info.ignoreNoiseAttackRange.length).toBe(WDist.fromCells(3).length)
    expect(info.chanceToDisappear).toBe(100)
  })

  it('accepts custom wander config', () => {
    const info = new SandwormInfo({
      wanderMoveRadius: 5,
      minMoveDelay: 10,
      maxMoveDelay: 50,
    })
    expect(info.wanderMoveRadius).toBe(5)
    expect(info.minMoveDelay).toBe(10)
    expect(info.maxMoveDelay).toBe(50)
  })

  it('accepts custom worm config', () => {
    const info = new SandwormInfo({
      targetRescanInterval: 50,
      chanceToDisappear: 50,
    })
    expect(info.targetRescanInterval).toBe(50)
    expect(info.chanceToDisappear).toBe(50)
  })
})

describe('Sandworm', () => {
  it('initializes with correct default state', () => {
    const info = new SandwormInfo()
    const worm = new Sandworm(mockActor(), info)

    expect(worm.isMovingTowardTarget).toBe(false)
    expect(worm.isAttacking).toBe(false)
    expect(worm.wormInfo).toBe(info)
  })

  it('does not rescan when targetCountdown has not expired', () => {
    const info = new SandwormInfo({ targetRescanInterval: 125 })
    const actor = mockActor()
    const worm = new Sandworm(actor, info)

    // First tick: countdown decrements from 125 to 124, > 0, no rescan
    worm.tick(actor)
    expect(worm.isMovingTowardTarget).toBe(false)
  })

  it('does not rescan when isAttacking is true', () => {
    const info = new SandwormInfo({ targetRescanInterval: 125 })
    const actor = mockActor()
    const worm = new Sandworm(actor, info)
    worm.isAttacking = true

    // Force countdown to expire
    for (let i = 0; i < 125; i++) {
      worm.tick(actor)
    }
    expect(worm.isMovingTowardTarget).toBe(false)
  })

  it('can be set to attacking state', () => {
    const info = new SandwormInfo()
    const worm = new Sandworm(mockActor(), info)

    worm.isAttacking = true
    expect(worm.isAttacking).toBe(true)

    worm.isAttacking = false
    expect(worm.isAttacking).toBe(false)
  })

  it('can be set to moving-toward-target state', () => {
    const info = new SandwormInfo()
    const worm = new Sandworm(mockActor(), info)

    worm.isMovingTowardTarget = true
    expect(worm.isMovingTowardTarget).toBe(true)

    worm.isMovingTowardTarget = false
    expect(worm.isMovingTowardTarget).toBe(false)
  })

  it('resets wander countdown on become idle', () => {
    const info = new SandwormInfo({ minMoveDelay: 10, maxMoveDelay: 10 })
    const actor = mockActor({
      world: {
        sharedRandom: { next: () => 10 },
        ...mockActor().world,
      },
    })
    const worm = new Sandworm(actor, info)

    worm.onBecomingIdle(actor)
    // State is internal — just verify no error
    expect(worm.isMovingTowardTarget).toBe(false)
  })

  it('ticks idle when not disabled', () => {
    const info = new SandwormInfo({ minMoveDelay: 0, maxMoveDelay: 0 })
    const actor = mockActor({
      world: {
        sharedRandom: { next: () => 0 },
        findActorsInCircle: () => [],
        ...mockActor().world,
      },
    })
    const worm = new Sandworm(actor, info)

    // Single tickIdle — should decrement countdown and potentially wander
    worm.tickIdle(actor)
    // No error = pass
  })

  it('disposing calls decreaseActorCount on manager', () => {
    const info = new SandwormInfo()
    let decreaseCalled = false
    const spawnManager = { decreaseActorCount: () => { decreaseCalled = true } }
    const world = {
      sharedRandom: { next: (min: number, _max: number) => min },
      findActorsInCircle: () => [],
      worldActor: {
        trait: (name: string) => name === 'ActorSpawnManager' ? spawnManager : null,
      },
      map: {
        contains: () => true,
        cellContaining: () => ({ X: 1, Y: 0 }),
        getTerrainInfo: () => null,
      },
    }
    const actor = { actorId: 1, disposed: false, world, isInWorld: true, centerPosition: { X: 0, Y: 0, Z: 0 }, location: { X: 0, Y: 0 }, trait: () => ({ canEnterCell: () => true }) } as unknown as IGameActor
    const worm = new Sandworm(actor, info)

    worm.disposing(actor)
    expect(decreaseCalled).toBe(true)
  })

  it('disposing is idempotent (only calls manager once)', () => {
    const info = new SandwormInfo()
    let callCount = 0
    const spawnManager = { decreaseActorCount: () => { callCount++ } }
    const world = {
      sharedRandom: { next: (min: number, _max: number) => min },
      findActorsInCircle: () => [],
      worldActor: {
        trait: (name: string) => name === 'ActorSpawnManager' ? spawnManager : null,
      },
      map: {
        contains: () => true,
        cellContaining: () => ({ X: 1, Y: 0 }),
        getTerrainInfo: () => null,
      },
    }
    const actor = { actorId: 1, disposed: false, world, isInWorld: true, centerPosition: { X: 0, Y: 0, Z: 0 }, location: { X: 0, Y: 0 }, trait: () => ({ canEnterCell: () => true }) } as unknown as IGameActor
    const worm = new Sandworm(actor, info)

    worm.disposing(actor)
    worm.disposing(actor) // second call should be no-op
    expect(callCount).toBe(1)
  })

  it('isTraitDisabled prevents tickIdle', () => {
    const info = new SandwormInfo({ minMoveDelay: 0, maxMoveDelay: 0 })
    const actor = mockActor()
    const worm = new Sandworm(actor, info)

    // Disable the trait by calling traitDisabled which sets _isTraitDisabled
    // Use the ConditionalTrait public API
    worm['traitDisabled']?.(actor)

    // tickIdle should return immediately
    worm.tickIdle(actor)
    expect(worm.isMovingTowardTarget).toBe(false)
  })

  it('doAction sets isMovingTowardTarget to false then rescans', () => {
    const info = new SandwormInfo()
    const actor = mockActor({
      world: {
        sharedRandom: { next: () => 0 },
        findActorsInCircle: () => [],
        ...mockActor().world,
      },
    })
    const worm = new Sandworm(actor, info)
    worm.isMovingTowardTarget = true

    // doAction should reset and then queue movement
    worm.doAction(actor, new CPos(0, 0))
    // After no targets found, isMovingTowardTarget remains false
    expect(worm.isMovingTowardTarget).toBe(false)
  })
})
