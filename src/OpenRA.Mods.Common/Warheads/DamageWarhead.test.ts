/**
 * DamageWarhead.test.ts -- DamageWarhead unit tests
 *
 * Tests: versus multipliers, effective damage, armor lookup,
 * hit shape distance, Health trait check.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

/** Zero rotation constant for test args. */
const WRotZero = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)
import {
  DamageWarhead,
} from './DamageWarhead.js'
import {
  type WarheadArgs,
  type WarheadEffect,
  type WarheadActorLike,
  type HitShapeLike,
} from './Warhead.js'

// ---------------------------------------------------------------------------
// Concrete DamageWarhead for testing
// ---------------------------------------------------------------------------

class TestDamageWarhead extends DamageWarhead {
  lastPos: WPos | null = null
  lastFiredBy: IGameActor | null = null

  override doImpactInWorld(pos: WPos, firedBy: IGameActor, args: WarheadArgs): WarheadEffect[] {
    this.lastPos = pos
    this.lastFiredBy = firedBy
    return this._collectAllDamageEffects(pos, firedBy, args)
  }

  /** Test helper: collect damage effects for all actors in range. */
  _collectAllDamageEffects(pos: WPos, firedBy: IGameActor, args: WarheadArgs): WarheadEffect[] {
    const effects: WarheadEffect[] = []
    const actorLike = firedBy as unknown as WarheadActorLike
    const world = actorLike.world
    if (!world?.findActorsOnCircle) return effects

    const victims = world.findActorsOnCircle(pos, new WDist(1000))
    if (!victims) return effects

    for (const victim of victims) {
      const victimActor = victim as unknown as IGameActor
      if (!this.isValidAgainst(victimActor, firedBy)) continue
      const shapeResult = this.findClosestActiveShape(victim, pos)
      effects.push(
        ...this.inflictDamage(
          victimActor,
          firedBy,
          shapeResult?.shape ?? null,
          args,
        ),
      )
    }
    return effects
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer(name: string): PlayerStub {
  return { playerName: name }
}

function makeMockActor(overrides: Partial<{
  actorId: number; owner: PlayerStub; maxHP: number | null; hp: number | null;
  _armor: { type: string; isTraitDisabled: boolean }[];
  enabledTargetablePositions: HitShapeLike[];
  world: { findActorsOnCircle?: () => WarheadActorLike[] };
  includeHealth: boolean;
}> = {}): IGameActor {
  const includeHealth = overrides.includeHealth !== false

  const actor: Record<string, unknown> = {
    actorId: overrides.actorId ?? 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 0,
    owner: overrides.owner ?? makePlayer('TestOwner'),
    _armor: overrides._armor,
    getEnabledTargetTypes: () => new Set(['Ground']),
    enabledTargetablePositions: overrides.enabledTargetablePositions,
    world: overrides.world,
  }

  if (includeHealth) {
    actor['maxHP'] = overrides.maxHP ?? 100
    actor['hp'] = overrides.hp ?? 100
  }

  return actor as unknown as IGameActor
}

function makeHitShape(distanceFromEdge?: number): HitShapeLike {
  return {
    distanceFromEdge: distanceFromEdge !== undefined
      ? () => new WDist(distanceFromEdge)
      : () => WDist.Zero,
    info: undefined,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DamageWarhead', () => {
  let warhead: TestDamageWarhead
  let firedBy: IGameActor

  beforeEach(() => {
    warhead = new TestDamageWarhead()
    firedBy = makeMockActor({ actorId: 100 })
  })

  // -----------------------------------------------------------------------
  // Default config
  // -----------------------------------------------------------------------

  describe('default config', () => {
    it('damage defaults to 0', () => {
      expect(warhead.damage).toBe(0)
    })

    it('damageTypes defaults to empty', () => {
      expect(warhead.damageTypes.size).toBe(0)
    })

    it('versus defaults to empty map', () => {
      expect(warhead.versus.size).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // loadFromJSON
  // -----------------------------------------------------------------------

  describe('loadFromJSON', () => {
    it('loads Damage', () => {
      warhead.loadFromJSON({ Damage: 500 })
      expect(warhead.damage).toBe(500)
    })

    it('loads DamageTypes', () => {
      warhead.loadFromJSON({ DamageTypes: ['Explosion', 'Fire'] })
      expect(warhead.damageTypes).toEqual(new Set(['Explosion', 'Fire']))
    })

    it('loads Versus from object', () => {
      warhead.loadFromJSON({ Versus: { Heavy: 50, Light: 150 } })
      expect(warhead.versus.get('Heavy')).toBe(50)
      expect(warhead.versus.get('Light')).toBe(150)
    })
  })

  // -----------------------------------------------------------------------
  // isValidAgainst (Health check)
  // -----------------------------------------------------------------------

  describe('isValidAgainst', () => {
    it('returns false for actors without Health', () => {
      const victim = makeMockActor({ includeHealth: false })
      expect(warhead.isValidAgainst(victim, firedBy)).toBe(false)
    })

    it('returns true for actors with Health', () => {
      const victim = makeMockActor({ maxHP: 100 })
      expect(warhead.isValidAgainst(victim, firedBy)).toBe(true)
    })

    it('returns false for same actor when affectsParent is false', () => {
      // Use firedBy as the victim (same object reference)
      expect(warhead.isValidAgainst(firedBy, firedBy)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // damageVersus
  // -----------------------------------------------------------------------

  describe('damageVersus', () => {
    it('returns 100 when no versus configured', () => {
      const victim = makeMockActor()
      const args = makeArgs()
      expect(warhead['damageVersus'](victim, null, args)).toBe(100)
    })

    it('returns versus multiplier for matching armor type', () => {
      warhead.versus.set('Heavy', 50)
      const victim = makeMockActor({
        _armor: [{ type: 'Heavy', isTraitDisabled: false }],
      })
      const args = makeArgs()
      expect(warhead['damageVersus'](victim, null, args)).toBe(50)
    })

    it('returns 100 for non-matching armor type', () => {
      warhead.versus.set('Heavy', 50)
      const victim = makeMockActor({
        _armor: [{ type: 'Light', isTraitDisabled: false }],
      })
      const args = makeArgs()
      expect(warhead['damageVersus'](victim, null, args)).toBe(100)
    })

    it('skips disabled armor traits', () => {
      warhead.versus.set('Heavy', 50)
      const victim = makeMockActor({
        _armor: [{ type: 'Heavy', isTraitDisabled: true }],
      })
      const args = makeArgs()
      expect(warhead['damageVersus'](victim, null, args)).toBe(100)
    })
  })

  // -----------------------------------------------------------------------
  // getEffectiveDamage
  // -----------------------------------------------------------------------

  describe('getEffectiveDamage', () => {
    it('returns 0 when base damage is 0', () => {
      const victim = makeMockActor()
      const args = makeArgs()
      expect(warhead.getEffectiveDamage(victim, null, args)).toBe(0)
    })

    it('applies damage modifiers', () => {
      warhead.damage = 100
      const victim = makeMockActor()
      const args: WarheadArgs = {
        sourceActor: firedBy,
        damageModifiers: [50], // 50% damage
        impactOrientation: WRotZero,
        impactPosition: WPos.Zero,
      }
      expect(warhead.getEffectiveDamage(victim, null, args)).toBe(50)
    })

    it('applies versus multiplier', () => {
      warhead.damage = 100
      warhead.versus.set('Heavy', 50)
      const victim = makeMockActor({
        _armor: [{ type: 'Heavy', isTraitDisabled: false }],
      })
      const args = makeArgs()
      // 100 * 100/100 (modifiers) * 50/100 (versus) = 50
      expect(warhead.getEffectiveDamage(victim, null, args)).toBe(50)
    })

    it('combines modifiers and versus', () => {
      warhead.damage = 200
      warhead.versus.set('Heavy', 25)
      const victim = makeMockActor({
        _armor: [{ type: 'Heavy', isTraitDisabled: false }],
      })
      const args: WarheadArgs = {
        sourceActor: firedBy,
        damageModifiers: [80], // 80% damage
        impactOrientation: WRotZero,
        impactPosition: WPos.Zero,
      }
      // 200 * 80/100 = 160, 160 * 25/100 = 40
      expect(warhead.getEffectiveDamage(victim, null, args)).toBe(40)
    })
  })

  // -----------------------------------------------------------------------
  // inflictDamage (deferred effects)
  // -----------------------------------------------------------------------

  describe('inflictDamage', () => {
    it('returns empty when effective damage is 0', () => {
      const victim = makeMockActor()
      const args = makeArgs()
      const effects = warhead['inflictDamage'](victim, firedBy, null, args)
      expect(effects).toEqual([])
    })

    it('returns DamageEffect for positive damage', () => {
      warhead.damage = 100
      const victim = makeMockActor()
      const args = makeArgs()
      const effects = warhead['inflictDamage'](victim, firedBy, null, args)
      expect(effects.length).toBe(1)
      expect(effects[0].type).toBe('damage')
      const dmg = effects[0] as { type: string; damage: number; damageTypes: Set<string> }
      expect(dmg.damage).toBe(100)
      expect(dmg.damageTypes).toEqual(new Set())
    })
  })

  // -----------------------------------------------------------------------
  // findClosestActiveShape
  // -----------------------------------------------------------------------

  describe('findClosestActiveShape', () => {
    it('returns null for actor with no positions', () => {
      const victim = makeMockActor({
        enabledTargetablePositions: [],
      })
      expect((warhead as any).findClosestActiveShape(victim as unknown as WarheadActorLike, WPos.Zero)).toBeNull()
    })

    it('finds closest shape by distance', () => {
      const victim = makeMockActor({
        enabledTargetablePositions: [
          makeHitShape(500),
          makeHitShape(100),
          makeHitShape(300),
        ],
      })
      const result = (warhead as any).findClosestActiveShape(
        victim as unknown as WarheadActorLike,
        WPos.Zero,
      )
      expect(result).not.toBeNull()
      expect(result.distance).toBe(100)
    })

    it('returns null when no shapes have distanceFromEdge', () => {
      const victim = makeMockActor({
        enabledTargetablePositions: [
          {} as HitShapeLike,
        ],
      })
      expect((warhead as any).findClosestActiveShape(victim as unknown as WarheadActorLike, WPos.Zero)).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Integration: doImpact produces damage effects
  // -----------------------------------------------------------------------

  describe('doImpact integration', () => {
    it('produces damage effects for valid victims in range', () => {
      warhead.damage = 50
      warhead.affectsParent = true

      const victim = makeMockActor({
        actorId: 200,
        maxHP: 100,
        owner: makePlayer('EnemyPlayer'),
        enabledTargetablePositions: [makeHitShape(10)],
      })

      // Set up world on firedBy (not victim) since the warhead queries
      // from firedBy.world.findActorsOnCircle
      const firedByWithWorld = makeMockActor({
        actorId: 100,
        world: {
          findActorsOnCircle: () => [victim] as unknown as WarheadActorLike[],
        },
      })

      const args = makeArgs(firedByWithWorld)
      const effects = warhead.doImpactInWorld(WPos.Zero, firedByWithWorld, args)

      expect(effects.length).toBe(1)
      expect(effects[0].type).toBe('damage')
      const dmg = effects[0] as { type: string; damage: number }
      expect(dmg.damage).toBe(50)
    })
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArgs(sourceActor?: IGameActor): WarheadArgs {
  return {
    sourceActor: sourceActor ?? ({} as unknown as IGameActor),
    damageModifiers: [],
    impactOrientation: WRotZero,
    impactPosition: WPos.Zero,
  }
}
