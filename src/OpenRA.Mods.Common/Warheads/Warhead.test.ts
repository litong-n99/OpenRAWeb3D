/**
 * Warhead.test.ts -- Warhead base class unit tests
 *
 * Tests: config loading, target validation, relationship filtering,
 * utility functions, deferred effect collection.
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Imports under test (no Babylon.js dependencies to mock)
// ---------------------------------------------------------------------------

import {
  Warhead,
  ImpactActorType,
  DamageCalculationType,
  applyPercentageModifiers,
  int2Lerp,
  type WarheadArgs,
  type WarheadEffect,
} from './Warhead.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import {
  PlayerRelationship,
  type IGameActor,
  type PlayerStub,
  type FrozenActorStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

/** Zero rotation for test args. */
const WRotZero = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)

// ---------------------------------------------------------------------------
// Concrete subclass for testing the abstract Warhead base
// ---------------------------------------------------------------------------

class TestWarhead extends Warhead {
  override doImpactInWorld(): WarheadEffect[] {
    return []
  }
}

// ---------------------------------------------------------------------------
// Mock actor factory
// ---------------------------------------------------------------------------

function makeMockActor(overrides: Partial<{
  actorId: number; owner: PlayerStub; getEnabledTargetTypes: () => Set<string>;
  hasHealth: boolean;
}> = {}): IGameActor {
  const targetTypes = overrides.getEnabledTargetTypes?.()
  return {
    actorId: overrides.actorId ?? 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 0,
    owner: overrides.owner ?? makePlayer('PlayerA'),
    getEnabledTargetTypes: () => targetTypes ?? new Set(['Ground']),
    maxHP: overrides.hasHealth !== false ? 100 : undefined,
  } as unknown as IGameActor
}

function makePlayer(name: string, relationshipWith?: (o: PlayerStub) => PlayerRelationship): PlayerStub {
  const p: PlayerStub = {
    playerName: name,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  }
  if (relationshipWith) {
    ;(p as unknown as Record<string, unknown>)['relationshipWith'] = relationshipWith
  }
  return p
}

// ---------------------------------------------------------------------------
// applyPercentageModifiers
// ---------------------------------------------------------------------------

describe('applyPercentageModifiers', () => {
  it('returns base unchanged with no modifiers', () => {
    expect(applyPercentageModifiers(100, [])).toBe(100)
  })

  it('applies a single modifier', () => {
    expect(applyPercentageModifiers(100, [50])).toBe(50)
  })

  it('applies sequential modifiers multiplicatively', () => {
    expect(applyPercentageModifiers(100, [50, 75])).toBe(37)
  })

  it('truncates to integer', () => {
    expect(applyPercentageModifiers(100, [33, 33])).toBe(10)
  })

  it('handles zero modifier', () => {
    expect(applyPercentageModifiers(100, [0])).toBe(0)
  })

  it('handles 100% modifier', () => {
    expect(applyPercentageModifiers(100, [100])).toBe(100)
  })

  it('handles >100% modifier', () => {
    expect(applyPercentageModifiers(100, [150])).toBe(150)
  })
})

// ---------------------------------------------------------------------------
// int2Lerp
// ---------------------------------------------------------------------------

describe('int2Lerp', () => {
  it('returns low when d at dl', () => {
    expect(int2Lerp(10, 20, 0, 0, 100)).toBe(10)
  })

  it('returns high when d at dh', () => {
    expect(int2Lerp(10, 20, 100, 0, 100)).toBe(20)
  })

  it('returns midpoint', () => {
    expect(int2Lerp(10, 20, 50, 0, 100)).toBe(15)
  })

  it('returns low when dh <= dl', () => {
    expect(int2Lerp(10, 20, 50, 100, 100)).toBe(10)
    expect(int2Lerp(10, 20, 50, 100, 50)).toBe(10)
  })

  it('handles negative values', () => {
    expect(int2Lerp(-10, 10, 50, 0, 100)).toBe(0)
  })

  it('truncates to integer', () => {
    expect(int2Lerp(0, 100, 1, 0, 3)).toBe(33)
  })
})

// ---------------------------------------------------------------------------
// Warhead base class
// ---------------------------------------------------------------------------

describe('Warhead', () => {
  let warhead: TestWarhead

  beforeEach(() => {
    warhead = new TestWarhead()
  })

  // -----------------------------------------------------------------------
  // Config defaults
  // -----------------------------------------------------------------------

  describe('default config', () => {
    it('defaults validTargets to Ground, Water', () => {
      expect(warhead.validTargets).toEqual(new Set(['Ground', 'Water']))
    })

    it('defaults invalidTargets to empty', () => {
      expect(warhead.invalidTargets.size).toBe(0)
    })

    it('defaults validRelationships to Ally | Neutral | Enemy', () => {
      expect(warhead.validRelationships).toBe(
        PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy,
      )
    })

    it('defaults affectsParent to false', () => {
      expect(warhead.affectsParent).toBe(false)
    })

    it('defaults airThreshold to 128', () => {
      expect(warhead.airThreshold.length).toBe(128)
    })

    it('defaults delay to 0', () => {
      expect(warhead.delay).toBe(0)
    })

    it('defaults isAirburst to false', () => {
      expect(warhead.isAirburst).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // loadFromJSON
  // -----------------------------------------------------------------------

  describe('loadFromJSON', () => {
    it('loads validTargets from JSON array', () => {
      warhead.loadFromJSON({ ValidTargets: ['Ground', 'Air'] })
      expect(warhead.validTargets).toEqual(new Set(['Ground', 'Air']))
    })

    it('loads invalidTargets from JSON array', () => {
      warhead.loadFromJSON({ InvalidTargets: ['Water'] })
      expect(warhead.invalidTargets).toEqual(new Set(['Water']))
    })

    it('loads target simultaneously', () => {
      warhead.loadFromJSON({ ValidTargets: ['Ground'], InvalidTargets: ['Air'] })
      expect(warhead.validTargets).toEqual(new Set(['Ground']))
      expect(warhead.invalidTargets).toEqual(new Set(['Air']))
    })

    it('loads ValidRelationships', () => {
      warhead.loadFromJSON({ ValidRelationships: 'Ally,Enemy' })
      expect(warhead.validRelationships).toBe(
        PlayerRelationship.Ally | PlayerRelationship.Enemy,
      )
    })

    it('loads AffectsParent', () => {
      warhead.loadFromJSON({ AffectsParent: true })
      expect(warhead.affectsParent).toBe(true)
    })

    it('loads AirThreshold as number', () => {
      warhead.loadFromJSON({ AirThreshold: 256 })
      expect(warhead.airThreshold.length).toBe(256)
    })

    it('loads Delay', () => {
      warhead.loadFromJSON({ Delay: 10 })
      expect(warhead.delay).toBe(10)
    })
  })

  // -----------------------------------------------------------------------
  // isValidAgainst
  // -----------------------------------------------------------------------

  describe('isValidAgainst', () => {
    it('returns false when victim is firedBy and affectsParent is false', () => {
      const actor = makeMockActor()
      expect(warhead.isValidAgainst(actor, actor)).toBe(false)
    })

    it('returns true when victim is firedBy and affectsParent is true', () => {
      warhead.affectsParent = true
      const actor = makeMockActor()
      expect(warhead.isValidAgainst(actor, actor)).toBe(true)
    })

    it('returns false when relationship is none', () => {
      warhead.validRelationships = PlayerRelationship.Ally as PlayerRelationship
      const ownerA = makePlayer('A')
      const ownerB = makePlayer('B')
      const a = makeMockActor({ owner: ownerA })
      const b = makeMockActor({ owner: ownerB })
      // Default relationship between different players is Enemy
      expect(warhead.isValidAgainst(b, a)).toBe(false)
    })

    it('returns true when relationship matches', () => {
      warhead.validRelationships = PlayerRelationship.Enemy as PlayerRelationship
      const ownerA = makePlayer('A')
      const ownerB = makePlayer('B')
      const a = makeMockActor({ owner: ownerA })
      const b = makeMockActor({ owner: ownerB })
      expect(warhead.isValidAgainst(b, a)).toBe(true)
    })

    it('returns false when target types do not overlap validTargets', () => {
      const a = makeMockActor({ getEnabledTargetTypes: () => new Set(['Air']) })
      const b = makeMockActor({ owner: makePlayer('B') })
      expect(warhead.isValidAgainst(a, b)).toBe(false)
    })

    it('returns false when target types overlap invalidTargets', () => {
      warhead.invalidTargets = new Set(['Air'])
      const a = makeMockActor({ getEnabledTargetTypes: () => new Set(['Ground', 'Air']) })
      const b = makeMockActor({ owner: makePlayer('B') })
      expect(warhead.isValidAgainst(a, b)).toBe(false)
    })

    it('returns true when actor is valid (different owner, Ground type)', () => {
      const ownerA = makePlayer('A')
      const ownerB = makePlayer('B')
      const a = makeMockActor({ owner: ownerA })
      const b = makeMockActor({ owner: ownerB, getEnabledTargetTypes: () => new Set(['Ground']) })
      warhead.validRelationships = PlayerRelationship.Enemy as PlayerRelationship
      expect(warhead.isValidAgainst(b, a)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // isValidAgainstFrozen
  // -----------------------------------------------------------------------

  describe('isValidAgainstFrozen', () => {
    it('returns false when frozen actor is not valid', () => {
      const fa: FrozenActorStub = { isValid: false, visible: false, hidden: false, centerPosition: WPos.Zero }
      const a = makeMockActor()
      expect(warhead.isValidAgainstFrozen(fa, a)).toBe(false)
    })

    it('returns false when relationship is wrong', () => {
      warhead.validRelationships = PlayerRelationship.Ally as PlayerRelationship
      const ownerA = makePlayer('A')
      const ownerB = makePlayer('B')
      const fa: FrozenActorStub = {
        isValid: true, visible: true, hidden: false, centerPosition: WPos.Zero,
      }
      ;(fa as unknown as Record<string, unknown>)['owner'] = ownerB
      ;(fa as unknown as Record<string, unknown>)['targetTypes'] = new Set(['Ground'])
      const a = makeMockActor({ owner: ownerA })
      expect(warhead.isValidAgainstFrozen(fa, a)).toBe(false)
    })

    it('returns true when valid', () => {
      warhead.validRelationships = PlayerRelationship.Enemy as PlayerRelationship
      const ownerA = makePlayer('A')
      const ownerB = makePlayer('B')
      const fa: FrozenActorStub = {
        isValid: true, visible: true, hidden: false, centerPosition: WPos.Zero,
      }
      ;(fa as unknown as Record<string, unknown>)['owner'] = ownerB
      ;(fa as unknown as Record<string, unknown>)['targetTypes'] = new Set(['Ground'])
      const a = makeMockActor({ owner: ownerA })
      expect(warhead.isValidAgainstFrozen(fa, a)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // doImpact (base implementation)
  // -----------------------------------------------------------------------

  describe('doImpact', () => {
    it('returns empty for invalid target', () => {
      const actor = makeMockActor()
      const args: WarheadArgs = {
        sourceActor: actor,
        damageModifiers: [],
        impactOrientation: WRotZero,
        impactPosition: WPos.Zero,
      }
      expect(warhead.doImpact(Target.Invalid, args)).toEqual([])
    })

    it('returns empty for actor target when not valid', () => {
      const actor = makeMockActor()
      const target = Target.fromActor(actor as unknown as Parameters<typeof Target.fromActor>[0])
      const args: WarheadArgs = {
        sourceActor: actor,
        damageModifiers: [],
        impactOrientation: WRotZero,
        impactPosition: WPos.Zero,
      }
      // Same actor, affectsParent=false
      const result = warhead.doImpact(target, args)
      expect(result).toEqual([])
    })

    it('calls doImpactInWorld for terrain target', () => {
      const spy = vi.spyOn(warhead, 'doImpactInWorld')
      spy.mockReturnValue([])
      const actor = makeMockActor()
      const target = Target.fromPos(new WPos(512, 512, 0))
      const args: WarheadArgs = {
        sourceActor: actor,
        damageModifiers: [],
        impactOrientation: WRotZero,
        impactPosition: new WPos(512, 512, 0),
      }
      warhead.doImpact(target, args)
      expect(spy).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // isValidTarget
  // -----------------------------------------------------------------------

  describe('isValidTarget', () => {
    it('returns false for undefined', () => {
      expect(warhead['isValidTarget'](undefined)).toBe(false)
    })

    it('returns true for Set with valid targets only', () => {
      expect(warhead['isValidTarget'](new Set(['Ground']))).toBe(true)
    })

    it('returns false for Set with no overlap', () => {
      expect(warhead['isValidTarget'](new Set(['Air']))).toBe(false)
    })

    it('returns false for Set with invalid target', () => {
      warhead.invalidTargets = new Set(['Air'])
      expect(warhead['isValidTarget'](new Set(['Ground', 'Air']))).toBe(false)
    })

    it('handles object with overlaps method', () => {
      const bt = {
        overlaps: vi.fn((o: unknown) => o === 'Ground'),
        isEmpty: false,
      }
      expect(warhead['isValidTarget'](bt)).toBe(true)
    })

    it('handles object with overlaps returning false', () => {
      const bt = {
        overlaps: vi.fn(() => false),
        isEmpty: false,
      }
      expect(warhead['isValidTarget'](bt)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // warheadDelay getter
  // -----------------------------------------------------------------------

  describe('warheadDelay', () => {
    it('returns the delay value (IWarhead compliance)', () => {
      warhead.delay = 5
      expect(warhead.warheadDelay).toBe(5)
    })
  })
})

// ---------------------------------------------------------------------------
// Enum tests
// ---------------------------------------------------------------------------

describe('ImpactActorType', () => {
  it('has correct values', () => {
    expect(ImpactActorType.None).toBe(0)
    expect(ImpactActorType.Invalid).toBe(1)
    expect(ImpactActorType.Valid).toBe(2)
  })
})

describe('DamageCalculationType', () => {
  it('has correct values', () => {
    expect(DamageCalculationType.HitShape).toBe(0)
    expect(DamageCalculationType.ClosestTargetablePosition).toBe(1)
    expect(DamageCalculationType.CenterPosition).toBe(2)
  })
})
