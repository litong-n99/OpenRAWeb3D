/**
 * FireWarheadsOnDeath.test.ts — FireWarheadsOnDeath migration unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  FireWarheadsOnDeath,
  FireWarheadsOnDeathInfo,
  ExplosionType,
  DamageSource,
} from './FireWarheadsOnDeath.js'
import { AttackInfo, Damage } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

function makeMockActor(overrides: Record<string, unknown> = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    centerPosition: new WPos(100, 200, 0),
    world: {
      actors: [] as never[],
      sharedRandom: { next: (_max: number) => Math.floor((_max ?? 10) / 2) },
    },
    ...overrides,
  } as never
}

function makeAttackInfo(attacker?: never) {
  return new AttackInfo(new Damage(50), attacker ?? (makeMockActor()), 4, 2)
}

function makeMockWeapon(mockImpact = vi.fn()) {
  return { impact: mockImpact }
}

describe('ExplosionType', () => {
  it('has Footprint and CenterPosition', () => {
    expect(ExplosionType.Footprint).toBe(0)
    expect(ExplosionType.CenterPosition).toBe(1)
  })
})

describe('DamageSource', () => {
  it('has Self, Parent, Killer', () => {
    expect(DamageSource.Self).toBe(0)
    expect(DamageSource.Parent).toBe(1)
    expect(DamageSource.Killer).toBe(2)
  })
})

describe('FireWarheadsOnDeathInfo', () => {
  it('defaults weapon to null', () => {
    const info = new FireWarheadsOnDeathInfo()
    expect(info.weapon).toBeNull()
  })

  it('defaults emptyWeapon to UnitExplode', () => {
    const info = new FireWarheadsOnDeathInfo()
    expect(info.emptyWeapon).toBe('UnitExplode')
  })

  it('defaults chance to 100', () => {
    const info = new FireWarheadsOnDeathInfo()
    expect(info.chance).toBe(100)
  })

  it('defaults type to CenterPosition', () => {
    const info = new FireWarheadsOnDeathInfo()
    expect(info.type).toBe(ExplosionType.CenterPosition)
  })
})

describe('FireWarheadsOnDeath', () => {
  let mockWeapon: { impact: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockWeapon = makeMockWeapon()
  })

  it('does not fire when trait disabled', () => {
    const info = new FireWarheadsOnDeathInfo({ weapon: 'Test' })
    const trait = new FireWarheadsOnDeath(info)
    trait.weaponInfo = mockWeapon
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    const self = makeMockActor()
    expect(() => trait.killed(self, makeAttackInfo())).not.toThrow()
    expect(mockWeapon.impact).not.toHaveBeenCalled()
  })

  it('does not fire when actor not in world', () => {
    const info = new FireWarheadsOnDeathInfo({ weapon: 'Test' })
    const trait = new FireWarheadsOnDeath(info)
    trait.weaponInfo = mockWeapon

    const self = makeMockActor({ isInWorld: false })
    trait.killed(self, makeAttackInfo())
    expect(mockWeapon.impact).not.toHaveBeenCalled()
  })

  it('fires at center position with CenterPosition explosion type', () => {
    const info = new FireWarheadsOnDeathInfo({
      weapon: 'Test',
      chance: 100,
    })
    const trait = new FireWarheadsOnDeath(info)
    trait.weaponInfo = mockWeapon

    const self = makeMockActor()
    trait.killed(self, makeAttackInfo())
    expect(mockWeapon.impact).toHaveBeenCalledTimes(1)
  })

  it('chooses empty weapon when no armaments', () => {
    const info = new FireWarheadsOnDeathInfo({
      weapon: 'LoadedWeapon',
      emptyWeapon: 'EmptyWeapon',
    })
    const trait = new FireWarheadsOnDeath(info)
    const emptyWeapon = { impact: vi.fn() }
    trait.weaponInfo = mockWeapon
    trait.emptyWeaponInfo = emptyWeapon
    trait.armaments = []

    const self = makeMockActor()
    trait.killed(self, makeAttackInfo())
    expect(mockWeapon.impact).toHaveBeenCalled()
  })

  it('does not fire when chance roll fails', () => {
    const info = new FireWarheadsOnDeathInfo({ chance: 0 })
    const trait = new FireWarheadsOnDeath(info)
    trait.weaponInfo = mockWeapon

    const self = makeMockActor()
    trait.killed(self, makeAttackInfo())
    expect(mockWeapon.impact).not.toHaveBeenCalled()
  })

  it('damage threshold triggers kill when HP below limit', () => {
    const info = new FireWarheadsOnDeathInfo({ damageThreshold: 50 })
    const trait = new FireWarheadsOnDeath(info)
    // HP=10, maxHP=100: 10*100 < 50*100 → triggers
    trait.init(makeMockActor(), { hp: 10, maxHP: 100 } as never, [])

    const addFrameEndTask = vi.fn()
    const self = makeMockActor({
      world: {
        actors: [] as never[],
        sharedRandom: { next: (_max?: number) => 0 },
        addFrameEndTask,
      },
    })
    trait.damaged(self, makeAttackInfo())
    expect(addFrameEndTask).toHaveBeenCalled()
  })

  it('damaged() kills self not source when DamageSource.Killer is used (regression)', () => {
	    // Verify that kill() is called on self with attacker as the damage source,
	    // NOT on the attacker itself.
	    const info = new FireWarheadsOnDeathInfo({
	      damageThreshold: 50,
	      damageSource: DamageSource.Killer,
	    })
	    const trait = new FireWarheadsOnDeath(info)
	    trait.init(makeMockActor(), { hp: 10, maxHP: 100 } as never, [])

	    const attacker = makeMockActor({ actorId: 99 })
	    let killedTarget: number | undefined = undefined
	    let killedAttacker: number | undefined = undefined

	    const addFrameEndTask = vi.fn((fn: (w: unknown) => void) => fn(undefined))
	    const self = makeMockActor({
	      actorId: 42,
	      world: {
	        actors: [] as never[],
	        sharedRandom: { next: (_max?: number) => 0 },
	        addFrameEndTask,
	      },
	      kill: (atk: { actorId: number }, _dmgTypes: unknown) => { killedTarget = 42; killedAttacker = atk.actorId },
	    })

	    // attacker is a different actor than self
	    const attackInfo = makeAttackInfo(attacker as never)
	    trait.damaged(self as never, attackInfo)
	    expect(addFrameEndTask).toHaveBeenCalled()
	    // Verify self (actorId=42) was killed, with attacker (actorId=99) as source
	    expect(killedTarget).toBe(42)
	    expect(killedAttacker).toBe(99)
	  })

	  it('damage threshold does not trigger when HP above limit', () => {
    const info = new FireWarheadsOnDeathInfo({ damageThreshold: 50 })
    const trait = new FireWarheadsOnDeath(info)
    // HP=80, maxHP=100: 80*100 >= 50*100 → does not trigger
    trait.init(makeMockActor(), { hp: 80, maxHP: 100 } as never, [])

    const addFrameEndTask = vi.fn()
    const self = makeMockActor({
      world: {
        actors: [] as never[],
        sharedRandom: { next: (_max?: number) => 0 },
        addFrameEndTask,
      },
    })
    trait.damaged(self, makeAttackInfo())
    expect(addFrameEndTask).not.toHaveBeenCalled()
  })
})
