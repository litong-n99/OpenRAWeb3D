/**
 * AttackSwallow.test.ts — Unit tests for AttackSwallow migration
 *
 * Tests focus on: config defaults, SwallowTarget activity stub,
 * AttackSwallowInfo inheritance from AttackFrontalInfo.
 */

import { describe, it, expect } from 'vitest'
import { AttackSwallow, AttackSwallowInfo, SwallowTarget } from './AttackSwallow'
import { AttackFrontal } from '../../OpenRA.Mods.Common/Traits/Attack/AttackFrontal'
import { AttackBaseInfo } from '../../OpenRA.Mods.Common/Traits/Attack/AttackBase'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target'
import { CPos } from '../../OpenRA.Game/CPos'
import { WPos } from '../../OpenRA.Game/WPos'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockActor(): IGameActor {
  return {
    actorId: 1,
    disposed: false,
    world: {},
    centerPosition: WPos.Zero,
  } as unknown as IGameActor
}

/** Cast IGameActor to GameActor for Activity constructors. */
function asGameActor(a: IGameActor): GameActor {
  return a as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AttackSwallowInfo', () => {
  it('extends AttackFrontalInfo', () => {
    const info = new AttackSwallowInfo()
    expect(info).toBeInstanceOf(AttackBaseInfo)
  })

  it('has correct default values', () => {
    const info = new AttackSwallowInfo()
    expect(info.returnDelay).toBe(60)
    expect(info.attackDelay).toBe(30)
    expect(info.attackingCondition).toBeNull()
    expect(info.wormAttackSound).toBe('WORM.WAV')
    expect(info.wormAttackNotification).toBe('WormAttack')
    expect(info.wormAttackTextNotification).toBe('notification-worm-attack')
  })

  it('accepts custom values', () => {
    const info = new AttackSwallowInfo({
      returnDelay: 120,
      attackDelay: 15,
      attackingCondition: 'attacking',
      wormAttackSound: 'custom.wav',
    })
    expect(info.returnDelay).toBe(120)
    expect(info.attackDelay).toBe(15)
    expect(info.attackingCondition).toBe('attacking')
    expect(info.wormAttackSound).toBe('custom.wav')
  })
})

describe('AttackSwallow', () => {
  it('extends AttackFrontal', () => {
    const info = new AttackSwallowInfo()
    const self = mockActor()
    const swallow = new AttackSwallow(self, info)
    expect(swallow).toBeInstanceOf(AttackFrontal)
  })

  it('has correct info type', () => {
    const info = new AttackSwallowInfo()
    const self = mockActor()
    const swallow = new AttackSwallow(self, info)
    expect(swallow.info).toBe(info)
    expect(swallow.info.returnDelay).toBe(60)
  })
})

describe('SwallowTarget', () => {
  it('creates a SwallowTarget extending Attack', () => {
    const info = new AttackSwallowInfo()
    const self = mockActor()
    const swallow = new AttackSwallow(self, info)
    const target = Target.fromCell(new CPos(0, 0))

    const st = new SwallowTarget(swallow, asGameActor(self), target, false, false)

    // Tick via Attack base class (expects GameActor)
    const done = st.tick(asGameActor(self))
    expect(done).toBe(true) // No armaments → complete
  })

  it('SwallowTarget handles invalid target', () => {
    const info = new AttackSwallowInfo()
    const self = mockActor()
    const swallow = new AttackSwallow(self, info)
    const st = new SwallowTarget(
      swallow,
      asGameActor(self),
      Target.Invalid as Target,
      false,
      false,
    )

    // Attack base class handles invalid target
    const done = st.tick(asGameActor(self))
    expect(done).toBe(true)
  })
})
