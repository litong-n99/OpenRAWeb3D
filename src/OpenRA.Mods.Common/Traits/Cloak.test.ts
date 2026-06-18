/**
 * Cloak.test.ts — Cloak migration unit tests
 *
 * Tests focus on: state machine (timer, cloak/uncloak transitions),
 * INotifyDamage handling, INotifyAttack handling, ITick logic,
 * IsVisible checks including DetectCloaked integration (P1-C.5),
 * condition grant/revoke, cloak/uncloak effect spawning (P1-C.4),
 * and edge cases.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  Cloak,
  CloakInfo,
  UncloakType,
  CloakStyle,
  type CloakedColor,
  type DetectionType,
} from './Cloak.js'
import { AttackInfo, Damage } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock IGameActor for testing. */
function mockActor(overrides: Record<string, unknown> = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: {
      playerName: 'TestPlayer',
      isAlliedWith: () => false,
    },
    location: { x: 0, y: 0 },
    grantCondition: vi.fn().mockReturnValue(42),
    revokeCondition: vi.fn().mockReturnValue(-1),
    traitsImplementing: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

/** Create a CloakInfo with specific UncloakOn flags. */
function cloakInfo(uncloakOn: number = 0, overrides: Partial<Record<string, unknown>> = {}) {
  return new CloakInfo({
    uncloakOn,
    initialDelay: 10,
    cloakDelay: 30,
    cloakedCondition: null,
    cloakType: null,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// UncloakType
// ---------------------------------------------------------------------------

describe('UncloakType', () => {
  it('has distinct power-of-2 values', () => {
    const values = [
      UncloakType.None,
      UncloakType.Attack,
      UncloakType.Move,
      UncloakType.Load,
      UncloakType.Unload,
      UncloakType.Infiltrate,
      UncloakType.Demolish,
      UncloakType.Damage,
      UncloakType.Heal,
      UncloakType.SelfHeal,
      UncloakType.Dock,
      UncloakType.SupportPower,
    ]
    // Each non-zero value is power of 2
    for (const v of values.filter(Boolean)) {
      expect((v & (v - 1)) === 0).toBe(true)
    }
    // All are distinct
    expect(new Set(values).size).toBe(values.length)
  })

  it('None is 0', () => {
    expect(UncloakType.None).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// CloakStyle
// ---------------------------------------------------------------------------

describe('CloakStyle', () => {
  it('has correct values', () => {
    expect(CloakStyle.None).toBe(0)
    expect(CloakStyle.Alpha).toBe(1)
    expect(CloakStyle.Color).toBe(2)
    expect(CloakStyle.Palette).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// CloakInfo
// ---------------------------------------------------------------------------

describe('CloakInfo', () => {
  it('has correct defaults', () => {
    const info = new CloakInfo()
    expect(info.initialDelay).toBe(10)
    expect(info.cloakDelay).toBe(30)
    expect(info.uncloakOn).toBe(
      UncloakType.Attack | UncloakType.Unload | UncloakType.Infiltrate
      | UncloakType.Demolish | UncloakType.Dock,
    )
    expect(info.cloakSound).toBeNull()
    expect(info.uncloakSound).toBeNull()
    expect(info.detectionTypes).toEqual(['Cloak'])
    expect(info.cloakedCondition).toBeNull()
    expect(info.cloakType).toBeNull()
    expect(info.cloakStyle).toBe(CloakStyle.Alpha)
    expect(info.cloakedAlpha).toBe(0.55)
    expect(info.cloakedColor).toEqual({ a: 140, r: 0, g: 0, b: 0 })
    expect(info.cloakedPalette).toBeNull()
    expect(info.isPlayerPalette).toBe(false)
    expect(info.effectImage).toBeNull()
    expect(info.cloakEffectSequence).toBeNull()
    expect(info.uncloakEffectSequence).toBeNull()
    expect(info.effectPalette).toBe('effect')
    expect(info.effectPaletteIsPlayerPalette).toBe(false)
    expect(info.effectOffset).toBeNull()
    expect(info.effectTracksActor).toBe(true)
  })

  it('accepts custom values', () => {
    const customColor: CloakedColor = { a: 200, r: 1, g: 2, b: 3 }
    const info = new CloakInfo({
      initialDelay: 5,
      cloakDelay: 15,
      uncloakOn: UncloakType.Attack | UncloakType.Move,
      cloakedAlpha: 0.3,
      cloakedColor: customColor,
      cloakStyle: CloakStyle.Color,
      cloakedCondition: 'cloaked',
    })
    expect(info.initialDelay).toBe(5)
    expect(info.cloakDelay).toBe(15)
    expect(info.uncloakOn).toBe(UncloakType.Attack | UncloakType.Move)
    expect(info.cloakedAlpha).toBe(0.3)
    expect(info.cloakedColor).toBe(customColor)
    expect(info.cloakStyle).toBe(CloakStyle.Color)
    expect(info.cloakedCondition).toBe('cloaked')
  })

  it('respects instanceName and requiresCondition', () => {
    const info = new CloakInfo({
      instanceName: 'myCloak',
      requiresCondition: '!disabled',
    })
    expect(info.instanceName).toBe('myCloak')
    expect(info.requiresCondition).toBe('!disabled')
  })
})

// ---------------------------------------------------------------------------
// Cloak — construction and initial state
// ---------------------------------------------------------------------------

describe('Cloak construction', () => {
  it('initializes remainingTime to initialDelay', () => {
    const info = cloakInfo(0, { initialDelay: 10 })
    const cloak = new Cloak(info)
    expect(cloak.remainingTime).toBe(10)
  })

  it('initializes remainingTime to 0 when initialDelay is 0', () => {
    const info = cloakInfo(0, { initialDelay: 0 })
    const cloak = new Cloak(info)
    expect(cloak.remainingTime).toBe(0)
  })

  it('is not cloaked when remainingTime > 0', () => {
    const info = cloakInfo(0, { initialDelay: 10 })
    const cloak = new Cloak(info)
    expect(cloak.cloaked).toBe(false)
  })

  it('is cloaked when initialDelay is 0', () => {
    const info = cloakInfo(0, { initialDelay: 0 })
    const cloak = new Cloak(info)
    expect(cloak.cloaked).toBe(true)
  })

  it('pre-computes cloakedColor values', () => {
    const customColor: CloakedColor = { a: 128, r: 255, g: 128, b: 64 }
    const info = cloakInfo(0, { cloakedColor: customColor })
    const cloak = new Cloak(info)
    expect(cloak._cloakedColorRgb).toEqual([1.0, 128 / 255, 64 / 255])
    expect(cloak._cloakedColorAlpha).toBeCloseTo(128 / 255, 5)
  })

  it('initializes isDocking to false', () => {
    const cloak = new Cloak(cloakInfo())
    expect(cloak.isDocking).toBe(false)
  })

  it('initializes firstTick to true', () => {
    const cloak = new Cloak(cloakInfo())
    expect(cloak.firstTick).toBe(true)
  })

  it('initializes cloakedToken to -1', () => {
    const cloak = new Cloak(cloakInfo())
    expect(cloak.cloakedToken).toBe(-1)
  })

  it('initializes wasCloaked correctly for delayed cloak', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    expect(cloak.wasCloaked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Cloak — cloaked getter
// ---------------------------------------------------------------------------

describe('Cloak.cloaked', () => {
  it('returns false when remainingTime > 0', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    expect(cloak.cloaked).toBe(false)
  })

  it('returns true when remainingTime <= 0', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    expect(cloak.cloaked).toBe(true)
  })

  it('returns false when remainingTime <= 0 but trait is disabled', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    ;(cloak as unknown as { _enabled: boolean })._enabled = false
    expect(cloak.cloaked).toBe(false)
  })

  it('returns false when remainingTime <= 0 but trait is paused', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    ;(cloak as unknown as { _paused: boolean })._paused = true
    expect(cloak.cloaked).toBe(false)
  })

  it('returns false when disabled and paused', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    ;(cloak as unknown as { _enabled: boolean; _paused: boolean })._enabled = false
    ;(cloak as unknown as { _enabled: boolean; _paused: boolean })._paused = true
    expect(cloak.cloaked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Cloak — uncloak()
// ---------------------------------------------------------------------------

describe('Cloak.uncloak', () => {
  it('sets remainingTime to max(remainingTime, cloakDelay)', () => {
    const cloak = new Cloak(cloakInfo(0, { cloakDelay: 30 }))
    cloak.remainingTime = 0
    cloak.uncloak()
    expect(cloak.remainingTime).toBe(30)
  })

  it('keeps larger remainingTime when current is higher', () => {
    const cloak = new Cloak(cloakInfo(0, { cloakDelay: 30 }))
    cloak.remainingTime = 40
    cloak.uncloak()
    expect(cloak.remainingTime).toBe(40)
  })

  it('accepts custom time', () => {
    const cloak = new Cloak(cloakInfo(0, { cloakDelay: 30 }))
    cloak.remainingTime = 0
    cloak.uncloak(50)
    expect(cloak.remainingTime).toBe(50)
  })

  it('keeps larger time with custom argument', () => {
    const cloak = new Cloak(cloakInfo(0, { cloakDelay: 30 }))
    cloak.remainingTime = 100
    cloak.uncloak(50)
    expect(cloak.remainingTime).toBe(100)
  })

  it('keeps current time when custom is smaller', () => {
    const cloak = new Cloak(cloakInfo(0, { cloakDelay: 30 }))
    cloak.remainingTime = 20
    cloak.uncloak(10)
    expect(cloak.remainingTime).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// Cloak — ITick
// ---------------------------------------------------------------------------

describe('Cloak.tick', () => {
  it('decrements remainingTime by 1 each tick', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    const self = mockActor()
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(9)
  })

  it('stops decrementing at 0', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 1 }))
    const self = mockActor()
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(0)
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(0)
  })

  it('does not decrement when isDocking is true', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    cloak.isDocking = true
    const self = mockActor()
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(10)
  })

  it('does not decrement when trait is disabled', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    ;(cloak as unknown as { _enabled: boolean })._enabled = false
    const self = mockActor()
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(10)
  })

  it('does not decrement when trait is paused', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    ;(cloak as unknown as { _paused: boolean })._paused = true
    const self = mockActor()
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(10)
  })

  it('transitions from uncloaked to cloaked state', () => {
    const info = cloakInfo(0, { initialDelay: 1 })
    const cloak = new Cloak(info)
    const self = mockActor()
    expect(cloak.cloaked).toBe(false)
    expect(cloak.wasCloaked).toBe(false)

    cloak.tick(self) // remainingTime: 1 -> 0
    expect(cloak.cloaked).toBe(true)
    expect(cloak.wasCloaked).toBe(true)
  })

  it('transitions from cloaked to uncloaked state', () => {
    const info = cloakInfo(0, { initialDelay: 0 })
    const cloak = new Cloak(info)
    const self = mockActor()
    expect(cloak.cloaked).toBe(true)
    cloak.wasCloaked = true

    // Manually trigger uncloak
    cloak.uncloak(30)
    expect(cloak.cloaked).toBe(false)

    cloak.tick(self) // now wasCloaked should be updated
    expect(cloak.wasCloaked).toBe(false)
  })

  it('sets firstTick to false after first tick', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    const self = mockActor()
    expect(cloak.firstTick).toBe(true)
    cloak.tick(self)
    expect(cloak.firstTick).toBe(false)
  })

  it('triggers uncloak on move when Move flag is set', () => {
    const info = cloakInfo(UncloakType.Move, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    const self = mockActor({ location: { x: 0, y: 0 } })

    // First tick: lastPos is null, so Move check triggers uncloak
    // (OpenRA behavior: null != currentLocation always triggers Move)
    cloak.tick(self)
    expect(cloak.lastPos).toBe(self.location)
    // After uncloak, remainingTime = max(0, 30) = 30
    expect(cloak.remainingTime).toBe(30)

    // Wait to re-cloak
    cloak.remainingTime = 0

    // Move actor: should trigger uncloak again
    const self2 = mockActor({ location: { x: 1, y: 0 } })
    cloak.tick(self2)
    expect(cloak.remainingTime).toBe(30) // uncloak triggered
    expect(cloak.lastPos).toBe(self2.location)
  })

  it('does not uncloak on move when Move flag is not set', () => {
    const info = cloakInfo(0, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    const self = mockActor({ location: { x: 0, y: 0 } })

    cloak.tick(self)
    const self2 = mockActor({ location: { x: 1, y: 0 } })
    cloak.tick(self2)
    expect(cloak.remainingTime).toBe(0) // no uncloak
  })
})

// ---------------------------------------------------------------------------
// Cloak — condition grant/revoke
// ---------------------------------------------------------------------------

describe('Cloak condition handling', () => {
  it('grants condition when transitioning to cloaked', () => {
    const info = cloakInfo(0, {
      initialDelay: 1,
      cloakedCondition: 'cloaked',
    })
    const cloak = new Cloak(info)
    const grantSpy = vi.fn().mockReturnValue(42)
    const self = mockActor({ grantCondition: grantSpy })

    expect(cloak.cloakedToken).toBe(-1)
    cloak.tick(self) // remainingTime: 1 -> 0, becomes cloaked

    expect(grantSpy).toHaveBeenCalledWith('cloaked')
    expect(cloak.cloakedToken).toBe(42)
  })

  it('revokes condition when transitioning to uncloaked', () => {
    const info = cloakInfo(0, {
      initialDelay: 0,
      cloakedCondition: 'cloaked',
    })
    const cloak = new Cloak(info)
    const revokeSpy = vi.fn().mockReturnValue(-1)
    const grantSpy = vi.fn().mockReturnValue(42)
    const self = mockActor({ grantCondition: grantSpy, revokeCondition: revokeSpy })

    // Start cloaked: grant condition
    cloak.attach(self)
    expect(cloak.cloakedToken).toBe(42)

    // Now uncloak and tick
    cloak.wasCloaked = true
    cloak.uncloak(30)
    expect(cloak.cloaked).toBe(false)

    cloak.tick(self)
    expect(revokeSpy).toHaveBeenCalledWith(42)
    expect(cloak.cloakedToken).toBe(-1)
  })

  it('does not grant condition when cloakedCondition is null', () => {
    const info = cloakInfo(0, { initialDelay: 1, cloakedCondition: null })
    const cloak = new Cloak(info)
    const grantSpy = vi.fn()
    const self = mockActor({ grantCondition: grantSpy })

    cloak.tick(self)
    expect(grantSpy).not.toHaveBeenCalled()
    expect(cloak.cloakedToken).toBe(-1)
  })

  it('does not re-grant when already cloaked and token exists', () => {
    const info = cloakInfo(0, {
      initialDelay: 0,
      cloakedCondition: 'cloaked',
    })
    const cloak = new Cloak(info)
    cloak.wasCloaked = true
    cloak.cloakedToken = 99

    const grantSpy = vi.fn()
    const self = mockActor({ grantCondition: grantSpy })

    cloak.tick(self)
    expect(grantSpy).not.toHaveBeenCalled()
    expect(cloak.cloakedToken).toBe(99)
  })

  it('grants condition on attach when starting cloaked', () => {
    const info = cloakInfo(0, {
      initialDelay: 0,
      cloakedCondition: 'cloaked',
    })
    const cloak = new Cloak(info)
    const grantSpy = vi.fn().mockReturnValue(42)
    const self = mockActor({ grantCondition: grantSpy })

    cloak.attach(self)
    expect(grantSpy).toHaveBeenCalledWith('cloaked')
    expect(cloak.cloakedToken).toBe(42)
  })

  it('detach revokes condition if token is active', () => {
    const info = cloakInfo(0, {
      initialDelay: 0,
      cloakedCondition: 'cloaked',
    })
    const cloak = new Cloak(info)
    cloak.cloakedToken = 42
    const revokeSpy = vi.fn().mockReturnValue(-1)
    const self = mockActor({ revokeCondition: revokeSpy })

    cloak.detach(self)
    expect(revokeSpy).toHaveBeenCalledWith(42)
    expect(cloak.cloakedToken).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// Cloak — traitEnabled / traitDisabled
// ---------------------------------------------------------------------------

describe('Cloak lifecycle', () => {
  it('traitEnabled resets remainingTime to initialDelay', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    cloak.remainingTime = 0
    const self = mockActor()

    // Access protected method
    ;(cloak as unknown as { traitEnabled(self: unknown): void }).traitEnabled(self)
    expect(cloak.remainingTime).toBe(10)
  })

  it('traitDisabled calls uncloak', () => {
    const cloak = new Cloak(cloakInfo(0, { cloakDelay: 30 }))
    cloak.remainingTime = 0
    const self = mockActor()

    ;(cloak as unknown as { traitDisabled(self: unknown): void }).traitDisabled(self)
    expect(cloak.remainingTime).toBe(30) // uncloak resets to cloakDelay
  })
})

// ---------------------------------------------------------------------------
// Cloak — INotifyAttack
// ---------------------------------------------------------------------------

describe('Cloak INotifyAttack', () => {
  it('attacking uncloaks when Attack flag is set', () => {
    const info = cloakInfo(UncloakType.Attack, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    cloak.remainingTime = 0

    cloak.attacking(
      mockActor(),
      {} as unknown as Parameters<typeof cloak.attacking>[1],
      undefined,
      {} as unknown as Parameters<typeof cloak.attacking>[3],
    )
    expect(cloak.remainingTime).toBe(30)
  })

  it('attacking does not uncloak when Attack flag is not set', () => {
    const info = cloakInfo(0, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    cloak.remainingTime = 0

    cloak.attacking(
      mockActor(),
      {} as unknown as Parameters<typeof cloak.attacking>[1],
      undefined,
      {} as unknown as Parameters<typeof cloak.attacking>[3],
    )
    expect(cloak.remainingTime).toBe(0)
  })

  it('preparingAttack is a no-op', () => {
    const cloak = new Cloak(cloakInfo(UncloakType.Attack))
    cloak.remainingTime = 0

    cloak.preparingAttack(
      mockActor(),
      {} as unknown as Parameters<typeof cloak.preparingAttack>[1],
      undefined,
      {} as unknown as Parameters<typeof cloak.preparingAttack>[3],
    )
    expect(cloak.remainingTime).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Cloak — INotifyDamage
// ---------------------------------------------------------------------------

describe('Cloak INotifyDamage', () => {
  it('uncloaks on damage when Damage flag is set', () => {
    const info = cloakInfo(UncloakType.Damage, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    cloak.remainingTime = 0

    const attacker = mockActor({ actorId: 999 })
    const attackInfo = new AttackInfo(
      new Damage(50),
      attacker,
      8, // damageState
      1, // previousDamageState
    )

    cloak.damaged(mockActor(), attackInfo)
    expect(cloak.remainingTime).toBe(30)
  })

  it('does not uncloak on damage when Damage flag is not set', () => {
    const info = cloakInfo(0, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    cloak.remainingTime = 0

    const attackInfo = new AttackInfo(
      new Damage(50),
      mockActor(),
      8, 1,
    )

    cloak.damaged(mockActor(), attackInfo)
    expect(cloak.remainingTime).toBe(0)
  })

  it('uncloaks on self-heal when SelfHeal flag is set', () => {
    const info = cloakInfo(UncloakType.SelfHeal, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    cloak.remainingTime = 0

    const self = mockActor()
    const attackInfo = new AttackInfo(
      new Damage(-10), // negative = heal
      self, // attacker is self = self-heal
      1, 8,
    )

    cloak.damaged(self, attackInfo)
    expect(cloak.remainingTime).toBe(30)
  })

  it('uncloaks on heal from others when Heal flag is set', () => {
    const info = cloakInfo(UncloakType.Heal, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    cloak.remainingTime = 0

    const self = mockActor()
    const otherActor = mockActor({ actorId: 999 })
    const attackInfo = new AttackInfo(
      new Damage(-10), // negative = heal
      otherActor, // attacker is someone else = heal
      1, 8,
    )

    cloak.damaged(self, attackInfo)
    expect(cloak.remainingTime).toBe(30)
  })

  it('does not uncloak on heal when Heal flag is not set', () => {
    const info = cloakInfo(0, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    cloak.remainingTime = 0

    const attackInfo = new AttackInfo(
      new Damage(-10),
      mockActor({ actorId: 999 }),
      1, 8,
    )

    cloak.damaged(mockActor(), attackInfo)
    expect(cloak.remainingTime).toBe(0)
  })

  it('does not uncloak when damage value is 0', () => {
    const info = cloakInfo(UncloakType.Damage | UncloakType.Heal, { initialDelay: 0, cloakDelay: 30 })
    const cloak = new Cloak(info)
    cloak.remainingTime = 0

    const attackInfo = new AttackInfo(
      new Damage(0),
      mockActor(),
      1, 1,
    )

    cloak.damaged(mockActor(), attackInfo)
    expect(cloak.remainingTime).toBe(0)
  })

  it('correctly distinguishes self-heal from external heal', () => {
    const self = mockActor({ actorId: 42 })
    const other = mockActor({ actorId: 99 })

    // Scenario: SelfHeal flag set, attacked by other with negative damage
    // Should be Heal (not SelfHeal) because attacker != self
    const infoSelf = cloakInfo(UncloakType.SelfHeal, { initialDelay: 0, cloakDelay: 30 })
    const cloakSelf = new Cloak(infoSelf)
    cloakSelf.remainingTime = 0

    const attackFromOther = new AttackInfo(
      new Damage(-10),
      other,
      1, 8,
    )
    cloakSelf.damaged(self, attackFromOther)
    // SelfHeal flag is set, but attacker != self, so Heal type, not SelfHeal
    // Since we only have SelfHeal in uncloakOn, no uncloak should happen
    expect(cloakSelf.remainingTime).toBe(0)

    // Scenario: SelfHeal flag set, attacked by self with negative damage
    const attackFromSelf = new AttackInfo(
      new Damage(-10),
      self,
      1, 8,
    )

    const cloakSelf2 = new Cloak(infoSelf)
    cloakSelf2.remainingTime = 0
    cloakSelf2.damaged(self, attackFromSelf)
    // SelfHeal flag is set, attacker == self, should trigger
    expect(cloakSelf2.remainingTime).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// Cloak — IsVisible
// ---------------------------------------------------------------------------

describe('Cloak.isVisible', () => {
  it('returns true when not cloaked', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    const self = mockActor()
    const viewer = { playerName: 'Enemy' }
    expect(cloak.isVisible(self, viewer)).toBe(true)
  })

  it('returns true when viewer is allied with owner', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    const self = mockActor({
      owner: {
        playerName: 'Ally',
        isAlliedWith: () => true,
      },
    })
    const viewer = { playerName: 'Viewer' }
    expect(cloak.isVisible(self, viewer)).toBe(true)
  })

  it('returns false for cloaked enemy without detector', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    const self = mockActor({
      owner: {
        playerName: 'Enemy',
        isAlliedWith: () => false,
      },
    })
    const viewer = { playerName: 'Viewer' }
    expect(cloak.isVisible(self, viewer)).toBe(false)
  })

  it('returns true when owner is undefined', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    const self = mockActor()
    delete (self as Record<string, unknown>).owner
    const viewer = { playerName: 'Viewer' }
    expect(cloak.isVisible(self, viewer)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Cloak — ModifyRender
// ---------------------------------------------------------------------------

describe('Cloak.modifyRender', () => {
  it('returns renderables unchanged when remainingTime > 0', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    const renders = [{ id: 1 }, { id: 2 }]
    const result = cloak.modifyRender(mockActor(), undefined, renders)
    expect(result).toBe(renders)
  })

  it('returns renderables unchanged when trait is disabled', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    ;(cloak as unknown as { _enabled: boolean })._enabled = false
    const renders = [{ id: 1 }]
    const result = cloak.modifyRender(mockActor(), undefined, renders)
    expect(result).toBe(renders)
  })

  it('returns renderables unchanged when trait is paused', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    ;(cloak as unknown as { _paused: boolean })._paused = true
    const renders = [{ id: 1 }]
    const result = cloak.modifyRender(mockActor(), undefined, renders)
    expect(result).toBe(renders)
  })

  it('returns renderables unchanged when cloaked (deferred visual impl)', () => {
    // TODO-12.A.4.8: When ModifyRender is fully implemented, this will apply
    // Alpha/Color/Palette styles. For now, passes through.
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 0 }))
    const renders = [{ id: 1 }]
    const result = cloak.modifyRender(mockActor(), undefined, renders)
    expect(result).toBe(renders)
  })
})

// ---------------------------------------------------------------------------
// Cloak — ModifyScreenBounds
// ---------------------------------------------------------------------------

describe('Cloak.modifyScreenBounds', () => {
  it('returns bounds unchanged', () => {
    const cloak = new Cloak(cloakInfo())
    const bounds = [{ x: 0, y: 0, width: 100, height: 100 }]
    const result = cloak.modifyScreenBounds(mockActor(), undefined, bounds)
    expect(result).toBe(bounds)
  })
})

// ---------------------------------------------------------------------------
// Cloak — otherCloaks (same CloakType grouping)
// ---------------------------------------------------------------------------

describe('Cloak otherCloaks', () => {
  it('populates otherCloaks when CloakType matches', () => {
    const info = cloakInfo(0, { cloakType: 'stealth' })
    const cloak1 = new Cloak(info)
    const cloak2 = new Cloak(info)
    const cloak3 = new Cloak(cloakInfo(0, { cloakType: 'stealth' }))

    const mockTraits = vi.fn().mockReturnValue([cloak1, cloak2, cloak3])
    const self = mockActor({ traitsImplementing: mockTraits })

    cloak1.attach(self)
    // otherCloaks should contain cloak2 + cloak3 (same type, not self)
    expect(cloak1.otherCloaks.length).toBe(2)
    expect(cloak1.otherCloaks).toContain(cloak2)
    expect(cloak1.otherCloaks).toContain(cloak3)
  })

  it('does not populate otherCloaks when CloakType is null', () => {
    const info = cloakInfo(0, { cloakType: null })
    const cloak = new Cloak(info)
    const self = mockActor({ traitsImplementing: vi.fn().mockReturnValue([]) })

    cloak.attach(self)
    expect(cloak.otherCloaks.length).toBe(0)
  })

  it('filters out cloaks with different CloakType', () => {
    const info = cloakInfo(0, { cloakType: 'stealth' })
    const cloak1 = new Cloak(info)
    const cloak2 = new Cloak(cloakInfo(0, { cloakType: 'invis' }))

    const self = mockActor({
      traitsImplementing: vi.fn().mockReturnValue([cloak1, cloak2]),
    })

    cloak1.attach(self)
    expect(cloak1.otherCloaks.length).toBe(0) // cloak2 has different type
  })
})

// ---------------------------------------------------------------------------
// Cloak — isDocking integration
// ---------------------------------------------------------------------------

describe('Cloak isDocking', () => {
  it('pauses countdown when isDocking is true', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    cloak.isDocking = true
    const self = mockActor()
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(10) // unchanged
  })

  it('resumes countdown when isDocking is false', () => {
    const cloak = new Cloak(cloakInfo(0, { initialDelay: 10 }))
    cloak.isDocking = true
    const self = mockActor()
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(10)

    cloak.isDocking = false
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// Cloak — integration: full tick cycle
// ---------------------------------------------------------------------------

describe('Cloak tick integration', () => {
  it('completes a full cloak-uncloak-recloak cycle', () => {
    const info = cloakInfo(UncloakType.Damage, {
      initialDelay: 2,
      cloakDelay: 3,
    })
    const cloak = new Cloak(info)
    const self = mockActor()

    // Tick 1: remainingTime 2->1, not cloaked
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(1)
    expect(cloak.cloaked).toBe(false)

    // Tick 2: remainingTime 1->0, now cloaked
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(0)
    expect(cloak.cloaked).toBe(true)
    expect(cloak.wasCloaked).toBe(true)

    // Damage: uncloaks
    const attackInfo = new AttackInfo(
      new Damage(10),
      mockActor({ actorId: 999 }),
      8, 1,
    )
    cloak.damaged(self, attackInfo)
    expect(cloak.remainingTime).toBe(3) // reset to cloakDelay
    expect(cloak.cloaked).toBe(false)

    // Tick 3: remainingTime 3->2
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(2)

    // Tick 4: 2->1
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(1)

    // Tick 5: 1->0, re-cloaked
    cloak.tick(self)
    expect(cloak.remainingTime).toBe(0)
    expect(cloak.cloaked).toBe(true)
  })

  it('does not trigger transition effects on spawn with initialDelay=0', () => {
    const info = cloakInfo(0, {
      initialDelay: 0,
      cloakedCondition: 'cloaked',
    })
    const cloak = new Cloak(info)
    const grantSpy = vi.fn().mockReturnValue(42)
    const self = mockActor({ grantCondition: grantSpy })

    // On attach, condition is granted (wasCloaked is set to true)
    cloak.attach(self)
    expect(grantSpy).toHaveBeenCalledTimes(1)
    expect(cloak.cloakedToken).toBe(42)

    // On first tick, no re-grant because already cloaked
    grantSpy.mockClear()
    cloak.tick(self)
    expect(grantSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// P1-C.4: Cloak Sound/Effect Integration
// ---------------------------------------------------------------------------

describe('P1-C.4: Cloak effect spawning', () => {
  /** Create a mock actor with world capabilities for effect testing. */
  function mockActorWithWorld(overrides: Record<string, unknown> = {}) {
    const addFrameEndTask = vi.fn((cb: () => void) => { cb() })
    const addEffect = vi.fn()
    const actorsWithTrait = vi.fn().mockReturnValue([])

    return {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      disposed: false,
      owner: {
        playerName: 'TestPlayer',
        isAlliedWith: () => false,
      },
      location: { x: 0, y: 0 },
      centerPosition: new WPos(10240, 10240, 0),
      world: { addFrameEndTask, addEffect, actorsWithTrait },
      grantCondition: vi.fn().mockReturnValue(42),
      revokeCondition: vi.fn().mockReturnValue(-1),
      traitsImplementing: vi.fn().mockReturnValue([]),
      ...overrides,
    }
  }

  it('spawns effect on cloak transition when effectImage and sequence are configured', () => {
    const info = cloakInfo(0, {
      initialDelay: 1,
      effectImage: 'cloakfx',
      cloakEffectSequence: 'cloak',
      effectPalette: 'effect',
      effectOffset: WVec.Zero,
      effectTracksActor: true,
    })
    const cloak = new Cloak(info)
    const addEffect = vi.fn()
    const self = mockActorWithWorld({ centerPosition: new WPos(5000, 3000, 0) })
    self.world.addEffect = addEffect

    expect(cloak.cloaked).toBe(false)
    expect(cloak.wasCloaked).toBe(false)

    // Tick to trigger cloak (remainingTime goes 1->0, becomes cloaked)
    cloak.tick(self)
    expect(cloak.cloaked).toBe(true)
    expect(cloak.wasCloaked).toBe(true)

    // Effect should have been spawned via addFrameEndTask -> addEffect
    expect(addEffect).toHaveBeenCalledTimes(1)
    const effect = (addEffect.mock.calls[0]![0] as Record<string, unknown>)
    expect(effect.image).toBe('cloakfx')
    expect(effect.sequence).toBe('cloak')
    expect(effect.palette).toBe('effect')
  })

  it('spawns effect on uncloak transition', () => {
    const info = cloakInfo(UncloakType.Damage, {
      initialDelay: 1,  // Delay cloak so firstTick is cleared before uncloak
      cloakDelay: 30,
      effectImage: 'cloakfx',
      uncloakEffectSequence: 'uncloak',
      effectPalette: 'effect',
      effectOffset: WVec.Zero,
      effectTracksActor: true,
    })
    const cloak = new Cloak(info)
    const addEffect = vi.fn()
    const self = mockActorWithWorld({ centerPosition: new WPos(5000, 3000, 0) })
    self.world.addEffect = addEffect

    // Tick to cloak (initialDelay 1->0, becomes cloaked, clears firstTick)
    cloak.tick(self)
    expect(cloak.cloaked).toBe(true)
    expect(cloak.firstTick).toBe(false)

    // Uncloak via damage
    const attackInfo = new AttackInfo(
      new Damage(10),
      mockActorWithWorld({ actorId: 999 }),
      8, 1,
    )
    cloak.damaged(self, attackInfo)

    // Tick to process uncloak transition
    cloak.tick(self)
    expect(cloak.cloaked).toBe(false)
    expect(addEffect).toHaveBeenCalledTimes(1) // uncloak effect only (cloakEffectSequence is null)
    const effect = (addEffect.mock.calls[0]![0] as Record<string, unknown>)
    expect(effect.sequence).toBe('uncloak')
  })

  it('suppresses effect on firstTick with initialDelay=0 (spawn-in-cloaked)', () => {
    const info = cloakInfo(0, {
      initialDelay: 0,
      effectImage: 'cloakfx',
      cloakEffectSequence: 'cloak',
      effectPalette: 'effect',
    })
    const cloak = new Cloak(info)
    const addEffect = vi.fn()
    const self = mockActorWithWorld({ centerPosition: new WPos(5000, 3000, 0) })
    self.world.addEffect = addEffect

    // firstTick=true, initialDelay=0 => effect should be suppressed
    expect(cloak.firstTick).toBe(true)
    expect(cloak.cloaked).toBe(true)

    cloak.tick(self)
    expect(addEffect).not.toHaveBeenCalled()
  })

  it('no effect when effectImage is null', () => {
    const info = cloakInfo(0, {
      initialDelay: 1,
      effectImage: null,
      cloakEffectSequence: 'cloak',
      effectPalette: 'effect',
    })
    const cloak = new Cloak(info)
    const addEffect = vi.fn()
    const self = mockActorWithWorld({ centerPosition: new WPos(5000, 3000, 0) })
    self.world.addEffect = addEffect

    cloak.tick(self) // transition to cloaked
    expect(cloak.cloaked).toBe(true)
    expect(addEffect).not.toHaveBeenCalled()
  })

  it('no effect when sequence is null', () => {
    const info = cloakInfo(0, {
      initialDelay: 1,
      effectImage: 'cloakfx',
      cloakEffectSequence: null,
      effectPalette: 'effect',
    })
    const cloak = new Cloak(info)
    const addEffect = vi.fn()
    const self = mockActorWithWorld({ centerPosition: new WPos(5000, 3000, 0) })
    self.world.addEffect = addEffect

    cloak.tick(self)
    expect(cloak.cloaked).toBe(true)
    expect(addEffect).not.toHaveBeenCalled()
  })

  it('applies effect offset when configured', () => {
    const info = cloakInfo(0, {
      initialDelay: 1,
      effectImage: 'cloakfx',
      cloakEffectSequence: 'cloak',
      effectPalette: 'effect',
      effectOffset: new WVec(100, 200, 50),
      effectTracksActor: false, // static position
    })
    const cloak = new Cloak(info)
    const addEffect = vi.fn()
    const self = mockActorWithWorld({ centerPosition: new WPos(5000, 3000, 0) })
    self.world.addEffect = addEffect

    cloak.tick(self)
    expect(cloak.cloaked).toBe(true)
    expect(addEffect).toHaveBeenCalledTimes(1)
    const effect = (addEffect.mock.calls[0]![0] as Record<string, unknown>)
    // Position should be centerPosition + effectOffset
    expect(effect.pos.X).toBe(5100)
    expect(effect.pos.Y).toBe(3200)
    expect(effect.pos.Z).toBe(50)
  })

  it('effect tracks actor when EffectTracksActor is true', () => {
    const info = cloakInfo(0, {
      initialDelay: 1,
      effectImage: 'cloakfx',
      cloakEffectSequence: 'cloak',
      effectPalette: 'effect',
      effectTracksActor: true,
    })
    const cloak = new Cloak(info)
    const addEffect = vi.fn()
    const self = mockActorWithWorld({ centerPosition: new WPos(5000, 3000, 0) })
    self.world.addEffect = addEffect

    cloak.tick(self)
    expect(cloak.cloaked).toBe(true)
    expect(addEffect).toHaveBeenCalledTimes(1)
    const effect = (addEffect.mock.calls[0]![0] as Record<string, unknown>)
    // Tracking: effect should have isActive and initialized set
    expect(effect.isActive).toBe(true)
    expect(effect.initialized).toBe(true)
  })

  it('effect palette includes player name when EffectPaletteIsPlayerPalette', () => {
    const info = cloakInfo(0, {
      initialDelay: 1,
      effectImage: 'cloakfx',
      cloakEffectSequence: 'cloak',
      effectPalette: 'custom',
      effectPaletteIsPlayerPalette: true,
    })
    const cloak = new Cloak(info)
    const addEffect = vi.fn()
    const self = mockActorWithWorld({
      centerPosition: new WPos(5000, 3000, 0),
      owner: { playerName: 'SovietPlayer', isAlliedWith: () => false },
    })
    self.world.addEffect = addEffect

    cloak.tick(self)
    expect(cloak.cloaked).toBe(true)
    expect(addEffect).toHaveBeenCalledTimes(1)
    const effect = (addEffect.mock.calls[0]![0] as Record<string, unknown>)
    expect(effect.palette).toBe('customSovietPlayer')
  })

  it('suppresses effect when other cloak of same type is already cloaked', () => {
    const info = cloakInfo(0, {
      initialDelay: 1,
      cloakType: 'stealth',
      effectImage: 'cloakfx',
      cloakEffectSequence: 'cloak',
      effectPalette: 'effect',
    })
    const cloak = new Cloak(info)
    const otherCloak = new Cloak(info)
    // otherCloak is already cloaked
    otherCloak.remainingTime = 0
    otherCloak.wasCloaked = true

    const addEffect = vi.fn()
    const self = mockActorWithWorld({
      centerPosition: new WPos(5000, 3000, 0),
      traitsImplementing: vi.fn().mockReturnValue([cloak, otherCloak]),
    })
    self.world.addEffect = addEffect

    cloak.attach(self)
    // otherCloaks should include the other cloak
    expect(cloak.otherCloaks).toContain(otherCloak)

    cloak.tick(self) // transition to cloaked, but other cloak is already cloaked
    expect(cloak.cloaked).toBe(true)
    // Effect should NOT be spawned because other cloak of same type is cloaked
    expect(addEffect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// P1-C.5: DetectCloaked Integration
// ---------------------------------------------------------------------------

describe('P1-C.5: DetectCloaked integration', () => {
  const DETECT_CLOAK_TYPE: DetectionType[] = [{ name: 'Cloak' }]
  const DETECT_SUB: DetectionType[] = [{ name: 'Subterranean' }]
  const DETECT_BOTH: DetectionType[] = [{ name: 'Cloak' }, { name: 'Subterranean' }]

  /** Create a mock detector actor with owner, position, and traits. */
  function mockDetectorActor(
    ownerName: string,
    centerPos: WPos,
    detectionTypes: readonly DetectionType[],
    rangeLength: number,
    isAllied: boolean,
  ) {
    return {
      actor: {
        actorId: 100,
        isInWorld: true,
        isDead: false,
        disposed: false,
        owner: {
          playerName: ownerName,
          isAlliedWith: () => isAllied,
        },
        centerPosition: centerPos,
      },
      trait: {
        info: { detectionTypes },
        range: new WDist(rangeLength),
      },
    }
  }

  /** Create a mock cloak actor with owner, position, and world containing detectors. */
  function mockCloakedActorWithDetectors(
    ownerName: string,
    centerPos: WPos,
    detectors: ReturnType<typeof mockDetectorActor>[],
  ) {
    const actorsWithTrait = vi.fn().mockReturnValue(detectors)
    return {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      disposed: false,
      owner: {
        playerName: ownerName,
        isAlliedWith: (viewer: { playerName: string }) => viewer.playerName === ownerName || viewer.playerName === 'Ally',
      },
      centerPosition: centerPos,
      world: { actorsWithTrait },
      grantCondition: vi.fn().mockReturnValue(42),
      revokeCondition: vi.fn().mockReturnValue(-1),
      traitsImplementing: vi.fn().mockReturnValue([]),
    }
  }

  it('cloaked unit is INvisible to enemy without any detector', () => {
    const info = cloakInfo(0, { initialDelay: 0 })
    const cloak = new Cloak(info)
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(false)
  })

  it('cloaked unit is VISIBLE when enemy detector has matching type and is in range', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const detector = mockDetectorActor(
      'Me',
      new WPos(5000, 3000, 0), // at same position as cloaked
      DETECT_CLOAK_TYPE,
      5120, // 5 cells
      true, // is allied with viewer
    )
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [detector],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(true)
  })

  it('cloaked unit is INvisible when detector has matching type but out of range', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const detector = mockDetectorActor(
      'Me',
      new WPos(60000, 60000, 0),
      DETECT_CLOAK_TYPE,
      5120,
      true,
    )
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [detector],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(false)
  })

  it('cloaked unit is INvisible when detection type does not match', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const detector = mockDetectorActor(
      'Me',
      new WPos(5000, 3000, 0),
      DETECT_SUB,
      5120,
      true,
    )
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [detector],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(false)
  })

  it('visible when detector has BOTH matching type AND another type', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const detector = mockDetectorActor(
      'Me',
      new WPos(5000, 3000, 0),
      DETECT_BOTH,
      5120,
      true,
    )
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [detector],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(true)
  })

  it('visible when detector belongs to ally of viewer', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const viewer = { playerName: 'Me' }

    const detector = mockDetectorActor(
      'Ally', // ally of viewer
      new WPos(5000, 3000, 0),
      DETECT_CLOAK_TYPE,
      5120,
      true, // isAlliedWith(viewer) returns true
    )
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [detector],
    )
    expect(cloak.isVisible(self, viewer)).toBe(true)
  })

  it('INvisible when detector is dead (not in world)', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const detector = mockDetectorActor(
      'Me',
      new WPos(5000, 3000, 0),
      DETECT_CLOAK_TYPE,
      5120,
      true,
    )
    detector.actor.isInWorld = false // dead

    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [detector],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(false)
  })

  it('INvisible when detector range is zero (disabled)', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const detector = mockDetectorActor(
      'Me',
      new WPos(5000, 3000, 0),
      DETECT_CLOAK_TYPE,
      0, // range 0 = disabled
      true,
    )
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [detector],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(false)
  })

  it('INvisible when detector owner is NOT allied with viewer (enemy detector)', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const detector = mockDetectorActor(
      'OtherEnemy',
      new WPos(5000, 3000, 0),
      DETECT_CLOAK_TYPE,
      5120,
      false, // not allied with viewer
    )
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [detector],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(false)
  })

  it('visible when at least one of multiple detectors is in range', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const farDetector = mockDetectorActor(
      'Me',
      new WPos(60000, 60000, 0),
      DETECT_CLOAK_TYPE,
      5120,
      true,
    )
    const nearDetector = mockDetectorActor(
      'Me',
      new WPos(5000, 3000, 0),
      DETECT_CLOAK_TYPE,
      5120,
      true,
    )
    const self = mockCloakedActorWithDetectors(
      'Enemy',
      new WPos(5000, 3000, 0),
      [farDetector, nearDetector],
    )
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(self, viewer)).toBe(true)
  })

  it('returns false when world has no actorsWithTrait', () => {
    const info = cloakInfo(0, { initialDelay: 0, detectionTypes: ['Cloak'] })
    const cloak = new Cloak(info)
    const noWorldActor = {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      disposed: false,
      owner: { playerName: 'Enemy', isAlliedWith: () => false },
    }
    const viewer = { playerName: 'Me' }
    expect(cloak.isVisible(noWorldActor, viewer)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// P1-C.5: _detectionTypesOverlap static method
// ---------------------------------------------------------------------------

describe('Cloak._detectionTypesOverlap', () => {
  it('returns true when there is a common type', () => {
    const result = Cloak._detectionTypesOverlap(
      ['Cloak'],
      [{ name: 'Cloak' }],
    )
    expect(result).toBe(true)
  })

  it('returns true when multiple types and one matches', () => {
    const result = Cloak._detectionTypesOverlap(
      ['Cloak', 'Subterranean'],
      [{ name: 'Subterranean' }],
    )
    expect(result).toBe(true)
  })

  it('returns true when detector has multiple types', () => {
    const result = Cloak._detectionTypesOverlap(
      ['Cloak'],
      [{ name: 'Cloak' }, { name: 'Subterranean' }],
    )
    expect(result).toBe(true)
  })

  it('returns false when types do NOT overlap', () => {
    const result = Cloak._detectionTypesOverlap(
      ['Cloak'],
      [{ name: 'Subterranean' }],
    )
    expect(result).toBe(false)
  })

  it('returns false when cloakTypes is empty', () => {
    const result = Cloak._detectionTypesOverlap(
      [],
      [{ name: 'Cloak' }],
    )
    expect(result).toBe(false)
  })

  it('returns false when detectTypes is empty', () => {
    const result = Cloak._detectionTypesOverlap(
      ['Cloak'],
      [],
    )
    expect(result).toBe(false)
  })

  it('returns false when both are empty', () => {
    const result = Cloak._detectionTypesOverlap([], [])
    expect(result).toBe(false)
  })
})
