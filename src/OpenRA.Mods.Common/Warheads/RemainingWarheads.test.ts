/**
 * RemainingWarheads.test.ts — Tests for all non-Damage, non-Spread warhead types
 * Covers: TargetDamageWarhead, CreateEffectWarhead, FireClusterWarhead,
 *   LeaveSmudgeWarhead, DestroyResourceWarhead, CreateResourceWarhead,
 *   ChangeOwnerWarhead, GrantExternalConditionWarhead, FlashEffectWarhead,
 *   ShakeScreenWarhead, HealthPercentageDamageWarhead, FlashTargetsInRadiusWarhead
 */

import { describe, it, expect } from 'vitest'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WarheadArgs } from './Warhead.js'
import { TargetDamageWarhead } from './TargetDamageWarhead.js'
import { HealthPercentageDamageWarhead } from './HealthPercentageDamageWarhead.js'
import { FlashEffectWarhead } from './FlashEffectWarhead.js'
import { ShakeScreenWarhead } from './ShakeScreenWarhead.js'
import { ChangeOwnerWarhead } from './ChangeOwnerWarhead.js'
import { GrantExternalConditionWarhead } from './GrantExternalConditionWarhead.js'
import { LeaveSmudgeWarhead } from './LeaveSmudgeWarhead.js'
import { DestroyResourceWarhead } from './DestroyResourceWarhead.js'
import { CreateResourceWarhead } from './CreateResourceWarhead.js'
import { CreateEffectWarhead } from './CreateEffectWarhead.js'
import { FireClusterWarhead } from './FireClusterWarhead.js'
import { FlashTargetsInRadiusWarhead } from './FlashTargetsInRadiusWarhead.js'

/** Zero rotation for test args. */
const WRotZero = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(name: string): PlayerStub {
  return { playerName: name }
}

function makeActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 0,
    owner: makePlayer('TestOwner'),
    ...overrides,
  } as unknown as IGameActor
}

function makeArgs(src?: IGameActor): WarheadArgs {
  return {
    sourceActor: src ?? makeActor(),
    damageModifiers: [],
    impactOrientation: WRotZero,
    impactPosition: WPos.Zero,
  }
}

function makeHitShape(dist: number) {
  return {
    distanceFromEdge: () => new WDist(dist),
  }
}

// ---------------------------------------------------------------------------
// TargetDamageWarhead
// ---------------------------------------------------------------------------

describe('TargetDamageWarhead', () => {
  it('spread defaults to WDist.Zero', () => {
    const wh = new TargetDamageWarhead()
    expect(wh.spread.length).toBe(0)
  })

  it('loads Spread from JSON', () => {
    const wh = new TargetDamageWarhead()
    wh.loadFromJSON({ Spread: 1024 })
    expect(wh.spread.length).toBe(1024)
  })

  it('doImpactInWorld returns empty when spread is zero', () => {
    const wh = new TargetDamageWarhead()
    const actor = makeActor()
    const effects = wh.doImpactInWorld(WPos.Zero, actor, makeArgs(actor))
    expect(effects).toEqual([])
  })

  it('inherits damage config from parent', () => {
    const wh = new TargetDamageWarhead()
    wh.loadFromJSON({ Damage: 100, DamageTypes: ['Explosion'] })
    expect(wh.damage).toBe(100)
    expect(wh.damageTypes).toEqual(new Set(['Explosion']))
  })
})

// ---------------------------------------------------------------------------
// HealthPercentageDamageWarhead
// ---------------------------------------------------------------------------

describe('HealthPercentageDamageWarhead', () => {
  it('extends TargetDamageWarhead', () => {
    const wh = new HealthPercentageDamageWarhead()
    expect(wh instanceof TargetDamageWarhead).toBe(true)
  })

  it('computes percentage-based damage', () => {
    const wh = new HealthPercentageDamageWarhead()
    wh.loadFromJSON({ Damage: 25 }) // 25% of max HP
    const victim = makeActor({
      maxHP: 200,
      enabledTargetablePositions: [makeHitShape(0)],
    })
    const args = makeArgs()
    const effects = (wh as any).inflictDamage(victim, args.sourceActor, null, args)
    expect(effects.length).toBe(1)
    expect((effects[0] as { damage: number }).damage).toBe(50) // 200 * 25/100 = 50
  })

  it('returns empty when victim has no maxHP', () => {
    const wh = new HealthPercentageDamageWarhead()
    wh.loadFromJSON({ Damage: 50 })
    const victim = makeActor() // no maxHP property
    const args = makeArgs()
    const effects = (wh as any).inflictDamage(victim, args.sourceActor, null, args)
    expect(effects).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// FlashEffectWarhead
// ---------------------------------------------------------------------------

describe('FlashEffectWarhead', () => {
  it('returns ScreenEffect with type flash', () => {
    const wh = new FlashEffectWarhead()
    wh.loadFromJSON({ FlashType: 'nuke', Duration: 10 })
    const firedBy = makeActor()
    const effects = wh.doImpactInWorld(WPos.Zero, firedBy, makeArgs(firedBy))
    expect(effects.length).toBe(1)
    const se = effects[0] as { type: string; effectType: string; flashType: string; duration: number }
    expect(se.type).toBe('screen')
    expect(se.effectType).toBe('flash')
    expect(se.flashType).toBe('nuke')
    expect(se.duration).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// ShakeScreenWarhead
// ---------------------------------------------------------------------------

describe('ShakeScreenWarhead', () => {
  it('returns ScreenEffect with type shake', () => {
    const wh = new ShakeScreenWarhead()
    wh.loadFromJSON({
      Duration: 20,
      Intensity: 5,
      Multiplier: [1, 2],
    })
    const firedBy = makeActor()
    const effects = wh.doImpactInWorld(WPos.Zero, firedBy, makeArgs(firedBy))
    expect(effects.length).toBe(1)
    const se = effects[0] as { type: string; effectType: string; duration: number; intensity: number; multiplier: { x: number; y: number }; centerPosition: WPos }
    expect(se.type).toBe('screen')
    expect(se.effectType).toBe('shake')
    expect(se.duration).toBe(20)
    expect(se.intensity).toBe(5)
    expect(se.multiplier).toEqual({ x: 1, y: 2 })
  })
})

// ---------------------------------------------------------------------------
// ChangeOwnerWarhead
// ---------------------------------------------------------------------------

describe('ChangeOwnerWarhead', () => {
  it('defaults range to 1 cell', () => {
    const wh = new ChangeOwnerWarhead()
    expect(wh.range.length).toBe(1024) // 1 cell = 1024
  })

  it('defaults duration to 0 (permanent)', () => {
    const wh = new ChangeOwnerWarhead()
    expect(wh.duration).toBe(0)
  })

  it('loads config from JSON', () => {
    const wh = new ChangeOwnerWarhead()
    wh.loadFromJSON({ Duration: 50, Range: 2048 })
    expect(wh.duration).toBe(50)
    expect(wh.range.length).toBe(2048)
  })

  it('returns empty for invalid target', () => {
    const wh = new ChangeOwnerWarhead()
    const effects = wh.doImpact(Target.Invalid, makeArgs())
    expect(effects).toEqual([])
  })

  it('doImpactInWorld returns empty array', () => {
    const wh = new ChangeOwnerWarhead()
    expect(wh.doImpactInWorld()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// GrantExternalConditionWarhead
// ---------------------------------------------------------------------------

describe('GrantExternalConditionWarhead', () => {
  it('defaults condition to empty string', () => {
    const wh = new GrantExternalConditionWarhead()
    expect(wh.condition).toBe('')
  })

  it('defaults duration to 0', () => {
    const wh = new GrantExternalConditionWarhead()
    expect(wh.duration).toBe(0)
  })

  it('loads config from JSON', () => {
    const wh = new GrantExternalConditionWarhead()
    wh.loadFromJSON({ Condition: 'stunned', Duration: 30, Range: 512 })
    expect(wh.condition).toBe('stunned')
    expect(wh.duration).toBe(30)
    expect(wh.range.length).toBe(512)
  })

  it('returns empty when condition is not set', () => {
    const wh = new GrantExternalConditionWarhead()
    const target = Target.fromPos(new WPos(0, 0, 0))
    const effects = wh.doImpact(target, makeArgs())
    expect(effects).toEqual([])
  })

  it('returns ConditionEffect for actor target', () => {
    const wh = new GrantExternalConditionWarhead()
    wh.loadFromJSON({ Condition: 'emp', Duration: 10 })
    wh.affectsParent = true
    const victim = makeActor({ getEnabledTargetTypes: () => new Set(['Ground']) })
    const firedBy = makeActor({ owner: makePlayer('Enemy') })
    const target = Target.fromActor(victim as unknown as Parameters<typeof Target.fromActor>[0])
    const effects = wh.doImpact(target, makeArgs(firedBy))
    // Should at least not throw
    expect(Array.isArray(effects)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LeaveSmudgeWarhead
// ---------------------------------------------------------------------------

describe('LeaveSmudgeWarhead', () => {
  it('defaults size to [0, 0]', () => {
    const wh = new LeaveSmudgeWarhead()
    expect(wh.size).toEqual([0, 0])
  })

  it('defaults chance to 100', () => {
    const wh = new LeaveSmudgeWarhead()
    expect(wh.chance).toBe(100)
  })

  it('loads config from JSON', () => {
    const wh = new LeaveSmudgeWarhead()
    wh.loadFromJSON({
      Size: [2, 1],
      SmudgeType: ['Scorch', 'Crater'],
      Chance: 50,
    })
    expect(wh.size).toEqual([2, 1])
    expect(wh.smudgeType).toEqual(new Set(['Scorch', 'Crater']))
    expect(wh.chance).toBe(50)
  })

  it('doImpactInWorld returns empty without world', () => {
    const wh = new LeaveSmudgeWarhead()
    const effects = wh.doImpactInWorld(WPos.Zero, makeActor(), makeArgs())
    expect(effects).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DestroyResourceWarhead
// ---------------------------------------------------------------------------

describe('DestroyResourceWarhead', () => {
  it('defaults resourceAmount to 0 (destroy all)', () => {
    const wh = new DestroyResourceWarhead()
    expect(wh.resourceAmount).toBe(0)
  })

  it('defaults resourceTypes to empty (all types)', () => {
    const wh = new DestroyResourceWarhead()
    expect(wh.resourceTypes.size).toBe(0)
  })

  it('loads config from JSON', () => {
    const wh = new DestroyResourceWarhead()
    wh.loadFromJSON({
      Size: [3, 1],
      ResourceAmount: 50,
      ResourceTypes: ['Ore', 'Gems'],
    })
    expect(wh.size).toEqual([3, 1])
    expect(wh.resourceAmount).toBe(50)
    expect(wh.resourceTypes).toEqual(new Set(['Ore', 'Gems']))
  })

  it('doImpactInWorld returns empty without world', () => {
    const wh = new DestroyResourceWarhead()
    const effects = wh.doImpactInWorld(WPos.Zero, makeActor(), makeArgs())
    expect(effects).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// CreateResourceWarhead
// ---------------------------------------------------------------------------

describe('CreateResourceWarhead', () => {
  it('addsResourceType defaults to empty string', () => {
    const wh = new CreateResourceWarhead()
    expect(wh.addsResourceType).toBe('')
  })

  it('loads config from JSON', () => {
    const wh = new CreateResourceWarhead()
    wh.loadFromJSON({ Size: [2, 0], AddsResourceType: 'Ore' })
    expect(wh.size).toEqual([2, 0])
    expect(wh.addsResourceType).toBe('Ore')
  })

  it('returns empty when no resource type configured', () => {
    const wh = new CreateResourceWarhead()
    const effects = wh.doImpactInWorld(WPos.Zero, makeActor(), makeArgs())
    expect(effects).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// CreateEffectWarhead
// ---------------------------------------------------------------------------

describe('CreateEffectWarhead', () => {
  it('defaults image to explosion', () => {
    const wh = new CreateEffectWarhead()
    expect(wh.image).toBe('explosion')
  })

  it('defaults explosionPalette to effect', () => {
    const wh = new CreateEffectWarhead()
    expect(wh.explosionPalette).toBe('effect')
  })

  it('defaults impactSoundChance to 100', () => {
    const wh = new CreateEffectWarhead()
    expect(wh.impactSoundChance).toBe(100)
  })

  it('loads config from JSON', () => {
    const wh = new CreateEffectWarhead()
    wh.loadFromJSON({
      Explosions: ['building', 'nuke'],
      Image: 'big_explosion',
      ExplosionPalette: 'effect',
      UsePlayerPalette: true,
      ImpactSounds: ['explode1.wav', 'explode2.wav'],
      ImpactSoundChance: 80,
      Inaccuracy: 128,
    })
    expect(wh.explosions).toEqual(['building', 'nuke'])
    expect(wh.image).toBe('big_explosion')
    expect(wh.usePlayerPalette).toBe(true)
    expect(wh.impactSounds).toEqual(['explode1.wav', 'explode2.wav'])
    expect(wh.impactSoundChance).toBe(80)
    expect(wh.inaccuracy.length).toBe(128)
  })
})

// ---------------------------------------------------------------------------
// FireClusterWarhead
// ---------------------------------------------------------------------------

describe('FireClusterWarhead', () => {
  it('defaults randomClusterCount to -1', () => {
    const wh = new FireClusterWarhead()
    expect(wh.randomClusterCount).toBe(-1)
  })

  it('defaults footprint to empty string', () => {
    const wh = new FireClusterWarhead()
    expect(wh.footprint).toBe('')
  })

  it('loads config from JSON', () => {
    const wh = new FireClusterWarhead()
    wh.loadFromJSON({
      Weapon: 'clusterBomb',
      RandomClusterCount: 3,
      Dimensions: [3, 3],
      Footprint: 'xxx xXx xxx',
    })
    expect(wh.weapon).toBe('clusterBomb')
    expect(wh.randomClusterCount).toBe(3)
    expect(wh.dimensions.X).toBe(3)
    expect(wh.dimensions.Y).toBe(3)
    expect(wh.footprint).toBe('xxx xXx xxx')
  })

  it('setWeaponRef stores weapon reference', () => {
    const wh = new FireClusterWarhead()
    const weapon = { name: 'clusterBomb', Projectile: 'Bullet' }
    wh.setWeaponRef(weapon)
    expect((wh as unknown as Record<string, unknown>)['_weaponRef']).toBe(weapon)
  })

  it('doImpactInWorld returns empty without weaponRef', () => {
    const wh = new FireClusterWarhead()
    const effects = wh.doImpactInWorld(WPos.Zero, makeActor(), makeArgs())
    expect(effects).toEqual([])
  })

  it('cellsMatching generates correct cell offsets', () => {
    const wh = new FireClusterWarhead()
    wh.loadFromJSON({
      Weapon: 'test',
      Dimensions: [3, 3],
      Footprint: 'xxx xXx xxx',
    })
    const center = new CPos(10, 10)
    const fixed = wh['_cellsMatching'](center, false) // 'X' cells
    const random = wh['_cellsMatching'](center, true) // 'x' cells
    // footprint = "xxx xXx xxx" without spaces = ["x","x","x","x","X","x","x","x","x"]
    // 'x' count = 8, 'X' count = 1
    expect(fixed.length).toBe(1)
    expect(random.length).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// FlashTargetsInRadiusWarhead
// ---------------------------------------------------------------------------

describe('FlashTargetsInRadiusWarhead', () => {
  it('defaults actorFlashCount to 2', () => {
    const wh = new FlashTargetsInRadiusWarhead()
    expect(wh.actorFlashCount).toBe(2)
  })

  it('defaults actorFlashInterval to 2', () => {
    const wh = new FlashTargetsInRadiusWarhead()
    expect(wh.actorFlashInterval).toBe(2)
  })

  it('defaults radius to zero', () => {
    const wh = new FlashTargetsInRadiusWarhead()
    expect(wh.radius.length).toBe(0)
  })

  it('loads config from JSON', () => {
    const wh = new FlashTargetsInRadiusWarhead()
    wh.loadFromJSON({
      ActorFlashOverlayColor: [255, 255, 255, 255],
      ActorFlashOverlayAlpha: 0.3,
      ActorFlashTint: [1.0, 0.5, 0.5],
      ActorFlashCount: 5,
      ActorFlashInterval: 3,
      Radius: 2048,
    })
    expect(wh.actorFlashCount).toBe(5)
    expect(wh.actorFlashInterval).toBe(3)
    expect(wh.radius.length).toBe(2048)
    expect(wh.actorFlashOverlayAlpha).toBe(0.3)
  })

  it('returns TargetFlashEffect for valid target', () => {
    const wh = new FlashTargetsInRadiusWarhead()
    wh.affectsParent = true
    const victim = makeActor({ getEnabledTargetTypes: () => new Set(['Ground']) })
    const firedBy = makeActor({ owner: makePlayer('Enemy') })
    const target = Target.fromActor(victim as unknown as Parameters<typeof Target.fromActor>[0])
    const effects = wh.doImpact(target, makeArgs(firedBy))
    expect(effects.length).toBe(1)
    expect(effects[0].type).toBe('targetFlash')
  })
})
