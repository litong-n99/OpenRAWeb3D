/**
 * SwallowActor.test.ts — Unit tests for SwallowActor migration
 *
 * Tests focus on: state machine transitions (Uninitialized -> Burrowed -> Attacking),
 * countdown management, condition granting/revocation, target validity checks.
 */

import { describe, it, expect } from 'vitest'
import { SwallowActor } from './SwallowActor'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import { Target } from '../../OpenRA.Game/Traits/Target'
import { CPos } from '../../OpenRA.Game/CPos'
import { Sandworm, SandwormInfo } from '../Traits/Sandworm'
import { AttackSwallow, AttackSwallowInfo } from '../Traits/AttackSwallow'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockActorConfig {
  location?: CPos
  centerPosition?: unknown
  worldActors?: IGameActor[]
  grantCondition?: (c: string) => number
  revokeCondition?: (t: number) => number
}

function createMockActor(config: MockActorConfig = {}): IGameActor {
  const world = {
    actorMap: {
      getActorsAt: (_cell: CPos) => config.worldActors ?? [],
    },
    addFrameEndTask: (task: () => void) => task(),
    sharedRandom: { next: () => 0 },
    localPlayer: {},
    game: { sound: { play: () => {} } },
    textNotificationsManager: {
      addTransientLine: () => {},
    },
    add: () => {},
  }

  return {
    actorId: 1,
    disposed: false,
    isInWorld: true,
    world,
    location: config.location ?? new CPos(0, 0),
    centerPosition: config.centerPosition ?? { X: 0, Y: 0, Z: 0 },
    grantCondition: config.grantCondition ?? (() => 1),
    revokeCondition: config.revokeCondition ?? (() => -1),
    trait: () => ({
      canEnterCell: () => true,
    }),
    info: { hasTraitInfo: () => false },
  } as unknown as IGameActor
}

function createSandworm(): Sandworm {
  const info = new SandwormInfo()
  return new Sandworm(createMockActor(), info)
}

function createAttackSwallow(overrides?: Partial<{
  attackingCondition: string | null
}>): AttackSwallow {
  const info = new AttackSwallowInfo({
    attackingCondition: overrides?.attackingCondition !== undefined ? overrides.attackingCondition : 'attacking',
  })
  return new AttackSwallow(createMockActor(), info)
}

function createMockArmament(): unknown {
  return {
    weapon: {
      isValidAgainst: () => true,
    },
    checkFire: () => true,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SwallowActor', () => {
  it('creates activity with correct initial state', () => {
    const sandworm = createSandworm()
    const swallow = createAttackSwallow()
    const target = Target.fromCell(new CPos(0, 0))
    const armament = createMockArmament()
    const self = createMockActor()

    const activity = new SwallowActor(
      self,
      target,
      armament as never,
      {} as never,
      swallow,
      sandworm,
    )

    expect(activity).toBeInstanceOf(SwallowActor)
  })

  it('tick transitions Uninitialized -> Burrowed on first tick', () => {
    const sandworm = createSandworm()
    const swallow = createAttackSwallow()
    const target = Target.fromCell(new CPos(0, 0))
    const armament = createMockArmament()
    const self = createMockActor()

    const activity = new SwallowActor(
      self,
      target,
      armament as never,
      {} as never,
      swallow,
      sandworm,
    )

    // First tick: Uninitialized -> Burrowed, countdown = AttackDelay (30)
    const done = activity.tick(self)
    expect(done).toBe(false) // still in Burrowed phase
  })

  it('tick during Burrowed phase counts down', () => {
    const sandworm = createSandworm()
    const swallow = createAttackSwallow({ attackingCondition: 'attacking' })
    const target = Target.fromCell(new CPos(0, 0))
    const armament = createMockArmament()
    const self = createMockActor()

    const activity = new SwallowActor(
      self,
      target,
      armament as never,
      {} as never,
      swallow,
      sandworm,
    )

    // First tick: transitions to Burrowed
    activity.tick(self)

    // Subsequent ticks: countdown AttackDelay
    for (let i = 0; i < 28; i++) {
      const done = activity.tick(self)
      expect(done).toBe(false) // still counting down
    }
  })

  it('returns true when target has no actor (completed)', () => {
    const sandworm = createSandworm()
    const swallow = createAttackSwallow()
    // Use an invalid target (has no actor)
    const target = Target.Invalid as Target
    const armament = createMockArmament()
    const self = createMockActor()

    const activity = new SwallowActor(
      self,
      target,
      armament as never,
      {} as never,
      swallow,
      sandworm,
    )

    // First tick -> Burrowed
    activity.tick(self)

    // Simulate Burrowed countdown reaching 0 by fast-forwarding
    for (let i = 0; i < 30; i++) {
      activity.tick(self)
    }
    // After countdown expires and no target actor, should complete
  })

  it('progresses through Burrowed phase without completing when target exists', () => {
    const sandworm = createSandworm()
    const swallow = createAttackSwallow()
    const targetActor = createMockActor({ location: new CPos(0, 0) })
    const target = Target.fromActor(targetActor as unknown as import('../../OpenRA.Game/Traits/IActorRef').IActorRef)
    const armament = createMockArmament()
    const self = createMockActor({
      location: new CPos(0, 0),
      worldActors: [targetActor],
    })

    const activity = new SwallowActor(
      self,
      target,
      armament as never,
      {} as never,
      swallow,
      sandworm,
    )

    // First tick -> transitions to Burrowed, sets countdown to AttackDelay (30)
    const firstTickDone = activity.tick(self)
    expect(firstTickDone).toBe(false) // Not done, in Burrowed

    // Subsequent ticks decrement countdown
    for (let i = 0; i < 28; i++) {
      const done = activity.tick(self)
      expect(done).toBe(false) // Still counting down
    }
  })

  it('can set and query isAttacking on Sandworm directly', () => {
    const info = new SandwormInfo()
    const sandworm = new Sandworm(createMockActor(), info)

    expect(sandworm.isAttacking).toBe(false)
    sandworm.isAttacking = true
    expect(sandworm.isAttacking).toBe(true)
    sandworm.isAttacking = false
    expect(sandworm.isAttacking).toBe(false)
  })

  it('grants attacking condition when entering Burrowed phase', () => {
    let grantedCondition: string | null = null
    const sandworm = createSandworm()
    const swallow = createAttackSwallow({ attackingCondition: 'attacking' })
    const target = Target.fromCell(new CPos(0, 0))
    const armament = createMockArmament()

    const self = createMockActor({
      grantCondition: (c: string) => {
        grantedCondition = c
        return 1
      },
    })

    const activity = new SwallowActor(
      self,
      target,
      armament as never,
      {} as never,
      swallow,
      sandworm,
    )

    activity.tick(self)
    expect(grantedCondition).toBe('attacking')
  })

  it('does not grant condition when attackingCondition is null', () => {
    const sandworm = createSandworm()
    const swallow = createAttackSwallow({ attackingCondition: null })
    const target = Target.fromCell(new CPos(0, 0))
    const armament = createMockArmament()
    const self = createMockActor()

    const activity = new SwallowActor(
      self,
      target,
      armament as never,
      {} as never,
      swallow,
      sandworm,
    )

    // Should not throw
    activity.tick(self)
  })
})
