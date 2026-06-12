/**
 * WeaponInfo.test.ts — WeaponInfo migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, fromJSON parsing, target validation,
 * impact logic, burst delay computation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Quaternion: class {
    x = 0; y = 0; z = 0; w = 1
    constructor() { /* empty */ }
  },
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { WeaponInfo, type ProjectileArgs } from './WeaponInfo.js'
import { WPos } from '../WPos.js'
import { WAngle } from '../WAngle.js'
import { WRot } from '../WRot.js'
import { Target, TargetType } from '../Traits/Target.js'
import type { IGameActor } from '../Traits/TraitsInterfaces.js'
import type { IWarhead } from '../../OpenRA.Mods.Common/Warheads/Warhead.js'

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

/**
 * Minimal mock warhead that implements IWarhead interface.
 */
class MockWarhead implements IWarhead {
  delay: number = 0
  doImpact = vi.fn().mockReturnValue([])
  isValidAgainst = vi.fn().mockReturnValue(true)
  isValidAgainstFrozen = vi.fn().mockReturnValue(false)
  loadFromJSON = vi.fn()
}

/**
 * Create a simple warhead registry with a few mock types.
 * Each constructor returns a MockWarhead that implements IWarhead.
 */
function createWarheadRegistry(): Record<string, new () => IWarhead> {
  return {
    SpreadDamage: class extends MockWarhead { constructor() { super() } },
    TargetDamage: class extends MockWarhead { constructor() { super() } },
  }
}

/** Create a minimal IGameActor stub. */
function createActor(overrides: Partial<{
  actorId: number
  owner: unknown
  world: unknown
  isInWorld: boolean
  isDead: boolean
  disposed: boolean
}> = {}): IGameActor {
  return {
    actorId: overrides.actorId ?? 1,
    owner: overrides.owner as IGameActor['owner'],
    world: overrides.world as IGameActor['world'],
    isInWorld: overrides.isInWorld ?? true,
    isDead: overrides.isDead ?? false,
    disposed: overrides.disposed ?? false,
  }
}

/** Create a duck-typed actor with getEnabledTargetTypes(). */
function createActorWithTargetTypes(
  types: string[],
  actorId = 1,
): IGameActor {
  const actor = createActor({ actorId })
  ;(actor as unknown as Record<string, unknown>).getEnabledTargetTypes = () => new Set(types)
  return actor
}

/**
 * Create a duck-typed GameWorldManager for impact tests.
 * NOTE: This is a minimal stub, not the full GameWorldManager.
 */
function createMockWorld() {
  const self = {
    addFrameEndTask: vi.fn((fn: () => void) => {
      // Execute synchronously for test predictability
      fn()
    }),
    addEffect: vi.fn(),
    map: undefined as unknown,
  }
  return self
}

// ---------------------------------------------------------------------------
// fromJSON() tests
// ---------------------------------------------------------------------------

describe('WeaponInfo.fromJSON', () => {
  let registry: Record<string, new () => IWarhead>

  beforeEach(() => {
    registry = createWarheadRegistry()
  })

  it('parses a minimal weapon with defaults', () => {
    const json = { name: 'TestWeapon' }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.range.length).toBe(0) // WDist.Zero
    expect(info.burst).toBe(1)
    expect(info.reloadDelay).toBe(1)
    expect(info.canTargetSelf).toBe(false)
    expect(info.validTargets.has('Ground')).toBe(true)
    expect(info.validTargets.has('Water')).toBe(true)
    expect(info.invalidTargets.size).toBe(0)
    expect(info.airThreshold.length).toBe(128)
    expect(info.burstDelays).toEqual([5])
    expect(info.minRange.length).toBe(0)
    expect(info.projectileType).toBeNull()
    expect(info.warheads.length).toBe(0)
    expect(info.report).toEqual([])
    expect(info.startBurstReport).toEqual([])
    expect(info.afterFireSound).toEqual([])
    expect(info.afterFireSoundDelay).toBe(0)
  })

  it('parses scalar numeric fields', () => {
    const json = {
      name: 'HeavyWeapon',
      Range: 5120,
      Burst: 3,
      ReloadDelay: 15,
      AfterFireSoundDelay: 10,
      CanTargetSelf: true,
      AirThreshold: 256,
      MinRange: 100,
      TargetActorCenter: true,
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.range.length).toBe(5120)
    expect(info.burst).toBe(3)
    expect(info.reloadDelay).toBe(15)
    expect(info.afterFireSoundDelay).toBe(10)
    expect(info.canTargetSelf).toBe(true)
    expect(info.airThreshold.length).toBe(256)
    expect(info.minRange.length).toBe(100)
    expect(info.targetActorCenter).toBe(true)
  })

  it('parses WVec fields (FirstBurstTargetOffset, FollowingBurstTargetOffset)', () => {
    const json = {
      name: 'OffsetWeapon',
      FirstBurstTargetOffset: { x: 10, y: 20, z: 5 },
      FollowingBurstTargetOffset: [30, 40, 15],
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.firstBurstTargetOffset.X).toBe(10)
    expect(info.firstBurstTargetOffset.Y).toBe(20)
    expect(info.firstBurstTargetOffset.Z).toBe(5)

    expect(info.followingBurstTargetOffset.X).toBe(30)
    expect(info.followingBurstTargetOffset.Y).toBe(40)
    expect(info.followingBurstTargetOffset.Z).toBe(15)
  })

  it('parses sound-related arrays', () => {
    const json = {
      name: 'LoudWeapon',
      Report: ['bang.aud', 'pow.aud'],
      StartBurstReport: ['start.aud'],
      AfterFireSound: ['click.aud'],
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.report).toEqual(['bang.aud', 'pow.aud'])
    expect(info.startBurstReport).toEqual(['start.aud'])
    expect(info.afterFireSound).toEqual(['click.aud'])
  })

  it('parses ValidTargets and InvalidTargets', () => {
    const json = {
      name: 'AntiAir',
      ValidTargets: ['Air'],
      InvalidTargets: ['Ground'],
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.validTargets.has('Air')).toBe(true)
    expect(info.validTargets.has('Ground')).toBe(false)
    expect(info.invalidTargets.has('Ground')).toBe(true)
  })

  it('parses BurstDelays as array', () => {
    const json = {
      name: 'BurstWeapon',
      BurstDelays: [3, 5, 8],
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.burstDelays).toEqual([3, 5, 8])
  })

  it('uses default BurstDelays when not provided', () => {
    const info = WeaponInfo.fromJSON({ name: 'DefaultBurst' }, registry)

    expect(info.burstDelays).toEqual([5])
  })

  it('extracts projectile type and config', () => {
    const json = {
      name: 'ProjWeapon',
      Projectile: {
        type: 'Bullet',
        Speed: 682,
        Image: 'bullet',
        Inaccuracy: 128,
      },
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.projectileType).toBe('Bullet')
    expect(info.projectileConfig).toEqual({
      Speed: 682,
      Image: 'bullet',
      Inaccuracy: 128,
    })
  })

  it('sets projectileType to null when type field is missing', () => {
    const json = {
      name: 'BadProj',
      Projectile: {
        NotType: 'Something',
      },
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.projectileType).toBeNull()
  })

  it('sets projectileType and config to null when no Projectile key', () => {
    const info = WeaponInfo.fromJSON({ name: 'NoProj' }, registry)

    expect(info.projectileType).toBeNull()
    expect(info.projectileConfig).toBeNull()
  })

  it('resolves a single warhead from JSON', () => {
    const json = {
      name: 'SingleWarhead',
      'Warhead@1': {
        type: 'SpreadDamage',
        Damage: 15,
        Spread: 128,
      },
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.warheads.length).toBe(1)
    const wh = info.warheads[0]! as unknown as MockWarhead
    expect(wh.loadFromJSON).toHaveBeenCalledWith({
      type: 'SpreadDamage',
      Damage: 15,
      Spread: 128,
    })
  })

  it('resolves multiple warheads in key order', () => {
    const json = {
      name: 'MultiWarhead',
      'Warhead@1': { type: 'SpreadDamage', Damage: 10 },
      'Warhead@2': { type: 'TargetDamage', Damage: 20 },
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.warheads.length).toBe(2)
  })

  it('throws for unknown warhead type', () => {
    const json = {
      name: 'BadWarhead',
      'Warhead@1': {
        type: 'NonExistentWarhead',
      },
    }
    expect(() => WeaponInfo.fromJSON(json, registry)).toThrow(
      /Unknown warhead type.*NonExistentWarhead/,
    )
  })

  it('skips warhead entries with no type field', () => {
    const json = {
      name: 'SkippedWarhead',
      'Warhead@1': { Damage: 10 },
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.warheads.length).toBe(0)
  })

  it('skips non-object warhead entries', () => {
    const json = {
      name: 'BadEntry',
      'Warhead@1': 'just a string',
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.warheads.length).toBe(0)
  })

  it('only processes keys starting with "Warhead"', () => {
    const json = {
      name: 'Mixed',
      'SomeOtherKey': { type: 'Damage' },
      'Warhead@1': { type: 'SpreadDamage', Damage: 10 },
    }
    const info = WeaponInfo.fromJSON(json, registry)

    expect(info.warheads.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// isValidTarget() tests
// ---------------------------------------------------------------------------

describe('WeaponInfo.isValidTarget', () => {
  let info: WeaponInfo

  beforeEach(() => {
    const registry = createWarheadRegistry()
    info = WeaponInfo.fromJSON({
      name: 'TestWeapon',
      ValidTargets: ['Ground', 'Water'],
      InvalidTargets: [],
    }, registry)
  })

  it('returns true when a valid target type matches', () => {
    expect(info.isValidTarget(new Set(['Ground']))).toBe(true)
  })

  it('returns true when any valid target type matches', () => {
    expect(info.isValidTarget(new Set(['Air', 'Ground']))).toBe(true)
  })

  it('returns false when no valid target type matches', () => {
    expect(info.isValidTarget(new Set(['Air']))).toBe(false)
  })

  it('returns false when an invalid target type is present', () => {
    const restricted = WeaponInfo.fromJSON({
      name: 'Restricted',
      ValidTargets: ['Ground', 'Water', 'Air'],
      InvalidTargets: ['Water'],
    }, createWarheadRegistry())

    expect(restricted.isValidTarget(new Set(['Water']))).toBe(false)
  })

  it('returns false when both valid and invalid overlap (invalid takes precedence)', () => {
    const restricted = WeaponInfo.fromJSON({
      name: 'Restricted',
      ValidTargets: ['Ground', 'Water'],
      InvalidTargets: ['Water'],
    }, createWarheadRegistry())

    // Has Ground (valid) but also Water (invalid) — invalid check fails first
    expect(restricted.isValidTarget(new Set(['Ground', 'Water']))).toBe(false)
  })

  it('returns false for empty target types', () => {
    expect(info.isValidTarget(new Set())).toBe(false)
  })

  it('returns true for valid target with non-overlapping invalid', () => {
    const restricted = WeaponInfo.fromJSON({
      name: 'Restricted',
      ValidTargets: ['Ground', 'Air'],
      InvalidTargets: ['Water'],
    }, createWarheadRegistry())

    expect(restricted.isValidTarget(new Set(['Ground']))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isValidAgainstActor() tests
// ---------------------------------------------------------------------------

describe('WeaponInfo.isValidAgainstActor', () => {
  let info: WeaponInfo
  let firedBy: IGameActor

  beforeEach(() => {
    const registry = createWarheadRegistry()
    info = WeaponInfo.fromJSON({
      name: 'TestWeapon',
      ValidTargets: ['Ground', 'Water'],
      CanTargetSelf: false,
    }, registry)
    firedBy = createActor({ actorId: 1 })
  })

  it('returns false when victim === firedBy and CanTargetSelf is false', () => {
    expect(info.isValidAgainstActor(firedBy, firedBy)).toBe(false)
  })

  it('returns true when victim === firedBy and CanTargetSelf is true', () => {
    const selfWeapon = WeaponInfo.fromJSON({
      name: 'SelfWeapon',
      ValidTargets: ['Ground'],
      CanTargetSelf: true,
    }, createWarheadRegistry())

    // The firedBy needs target types to pass the target type check
    const actor = createActorWithTargetTypes(['Ground'], 1)
    expect(selfWeapon.isValidAgainstActor(actor, actor)).toBe(true)
  })

  it('returns true when victim has matching target types', () => {
    const victim = createActorWithTargetTypes(['Ground'], 2)
    expect(info.isValidAgainstActor(victim, firedBy)).toBe(true)
  })

  it('returns false when victim has no matching target types', () => {
    const victim = createActorWithTargetTypes(['Air'], 2)
    expect(info.isValidAgainstActor(victim, firedBy)).toBe(false)
  })

  it('returns false when victim has no getEnabledTargetTypes', () => {
    const victim = createActor({ actorId: 2 })
    expect(info.isValidAgainstActor(victim, firedBy)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isValidAgainst() tests (router)
// ---------------------------------------------------------------------------

describe('WeaponInfo.isValidAgainst', () => {
  let info: WeaponInfo
  let firedBy: IGameActor

  beforeEach(() => {
    const registry = createWarheadRegistry()
    info = WeaponInfo.fromJSON({
      name: 'TestWeapon',
      ValidTargets: ['Ground', 'Water'],
    }, registry)
    firedBy = createActor({ actorId: 1 })
  })

  it('routes to Actor validator when target type is Actor', () => {
    const victim = createActorWithTargetTypes(['Ground'], 2)
    // Use a duck-typed target since Target constructor is private
    const targetAny = {
      type: TargetType.Actor as number,
      centerPosition: WPos.Zero,
      actor: victim,
      positions: [WPos.Zero],
    } as unknown as Target

    expect(info.isValidAgainst(targetAny, null, firedBy)).toBe(true)
  })

  it('returns false when target type is Invalid', () => {
    const targetAny = { type: TargetType.Invalid, centerPosition: WPos.Zero } as unknown as Target

    expect(info.isValidAgainst(targetAny, null, firedBy)).toBe(false)
  })

  it('throws NOT_IMPLEMENTED for FrozenActor target type', () => {
    const targetAny = { type: TargetType.FrozenActor, centerPosition: WPos.Zero } as unknown as Target

    expect(() => info.isValidAgainst(targetAny, null, firedBy)).toThrow(
      /Not yet implemented.*FrozenActor/,
    )
  })

  it('returns true for Terrain target when no world provided (permissive)', () => {
    const target = Target.fromPos(new WPos(100, 200, 0))

    expect(info.isValidAgainst(target, null, firedBy)).toBe(true)
  })

  it('returns true for Terrain target when world has no map (permissive)', () => {
    const target = Target.fromPos(new WPos(100, 200, 0))
    const world = createMockWorld()
    world.map = undefined as unknown as typeof world.map

    expect(info.isValidAgainst(target, world as unknown as Parameters<typeof info.isValidAgainst>[1], firedBy)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// impact() tests
// ---------------------------------------------------------------------------

describe('WeaponInfo.impact', () => {
  let info: WeaponInfo
  let firedBy: IGameActor
  let world: ReturnType<typeof createMockWorld>

  function createWarheadWithDelay(delay: number): MockWarhead {
    const wh = new MockWarhead()
    wh.delay = delay
    wh.doImpact = vi.fn().mockReturnValue([])
    wh.loadFromJSON = vi.fn()
    return wh
  }

  beforeEach(() => {
    const wh1 = createWarheadWithDelay(0)
    const wh2 = createWarheadWithDelay(0)

    // Create registry with factory that returns our pre-built warheads
    const registry = {
      Immediate: class extends MockWarhead {
        delay = 0
        doImpact = wh1.doImpact
        loadFromJSON = wh1.loadFromJSON
        constructor() { super() }
      },
      Delayed: class extends MockWarhead {
        delay = 5
        doImpact = wh2.doImpact
        loadFromJSON = wh2.loadFromJSON
        isValidAgainst = wh2.isValidAgainst
        isValidAgainstFrozen = wh2.isValidAgainstFrozen
        constructor() { super() }
      },
    }

    info = WeaponInfo.fromJSON({
      name: 'ImpactTest',
      'Warhead@1': { type: 'Immediate', Data: 1 },
      'Warhead@2': { type: 'Delayed', Data: 2 },
    }, registry)

    firedBy = createActor({ actorId: 1 })
    world = createMockWorld()
    // Wire world into firedBy actor
    ;(firedBy as unknown as Record<string, unknown>).world = world
  })

  it('calls doImpact directly for warheads with delay=0 (no world)', () => {
    const target = Target.fromPos(WPos.Zero)
    const args = {
      weapon: info,
      sourceActor: createActor(),
      damageModifiers: [],
      source: null,
      impactOrientation: WRot.None,
      impactPosition: WPos.Zero,
      weaponTarget: Target.fromPos(WPos.Zero),
    }

    // Remove world to trigger no-world path
    const noWorldFiredBy = { ...firedBy, world: undefined }

    info.impact(target, {
      ...args,
      sourceActor: noWorldFiredBy,
    })

    // Both warheads should have been called
    const whs = info.warheads as unknown as MockWarhead[]
    expect(whs[0]!.doImpact).toHaveBeenCalled()
    expect(whs[1]!.doImpact).toHaveBeenCalled()
  })

  it('calls doImpact directly for delay=0 warheads with world', () => {
    const target = Target.fromPos(WPos.Zero)
    const args = {
      weapon: info,
      sourceActor: firedBy,
      damageModifiers: [],
      source: null,
      impactOrientation: WRot.None,
      impactPosition: WPos.Zero,
      weaponTarget: Target.fromPos(WPos.Zero),
    }

    info.impact(target, args)

    const whs = info.warheads as unknown as MockWarhead[]
    // First warhead has delay=0, should be called directly
    expect(whs[0]!.doImpact).toHaveBeenCalled()
    // Second warhead has delay=5, should NOT be called; DelayedImpact should be created
    expect(whs[1]!.doImpact).not.toHaveBeenCalled()
  })

  it('schedules DelayedImpact for warheads with delay > 0', () => {
    const target = Target.fromPos(WPos.Zero)
    const args = {
      weapon: info,
      sourceActor: firedBy,
      damageModifiers: [],
      source: null,
      impactOrientation: WRot.None,
      impactPosition: WPos.Zero,
      weaponTarget: Target.fromPos(WPos.Zero),
    }

    info.impact(target, args)

    // Frame-end task should have been registered
    expect(world.addFrameEndTask).toHaveBeenCalled()
    // Effect should have been added to world
    expect(world.addEffect).toHaveBeenCalled()
  })

  it('applies warheads directly when no world is available', () => {
    const noWorldActor = createActor({ actorId: 99 })
    const target = Target.fromPos(WPos.Zero)
    const args = {
      weapon: info,
      sourceActor: noWorldActor,
      damageModifiers: [],
      source: null,
      impactOrientation: WRot.None,
      impactPosition: WPos.Zero,
      weaponTarget: Target.fromPos(WPos.Zero),
    }

    info.impact(target, args)

    const whs = info.warheads as unknown as MockWarhead[]
    expect(whs[0]!.doImpact).toHaveBeenCalled()
    expect(whs[1]!.doImpact).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// impactDirect() tests
// ---------------------------------------------------------------------------

describe('WeaponInfo.impactDirect', () => {
  let info: WeaponInfo

  beforeEach(() => {
    const registry = createWarheadRegistry()
    info = WeaponInfo.fromJSON({
      name: 'DirectImpact',
      'Warhead@1': { type: 'SpreadDamage', Damage: 10 },
    }, registry)
  })

  it('creates WarheadArgs from firedBy and calls impact', () => {
    const target = Target.fromPos(new WPos(100, 200, 0))
    const firedBy = createActorWithTargetTypes(['Ground'], 10)

    // No world — warheads should be called directly
    info.impactDirect(target, firedBy)

    const whs = info.warheads as unknown as MockWarhead[]
    expect(whs[0]!.doImpact).toHaveBeenCalled()
    const call = (whs[0]!.doImpact as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    expect(call[0]).toBe(target)
    const args = call[1] as Record<string, unknown>
    expect(args.weapon).toBe(info)
    expect(args.sourceActor).toBe(firedBy)
    expect(args.weaponTarget).toBe(target)
    expect(args.impactPosition).toEqual(target.centerPosition)
    expect(args.impactOrientation).toEqual(WRot.None)
  })

  it('sets source from OccupiesSpace when available', () => {
    const target = Target.fromPos(WPos.Zero)
    const centerPos = new WPos(42, 0, 10)
    const firedBy = createActor()
    ;(firedBy as unknown as Record<string, unknown>).occupiesSpace = {
      centerPosition: centerPos,
    }

    info.impactDirect(target, firedBy)

    const whs = info.warheads as unknown as MockWarhead[]
    const call = (whs[0]!.doImpact as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    const args = call[1] as Record<string, unknown>
    expect(args.source).toEqual(centerPos)
  })

  it('sets source to null when no OccupiesSpace', () => {
    const target = Target.fromPos(WPos.Zero)
    const firedBy = createActor()

    info.impactDirect(target, firedBy)

    const whs = info.warheads as unknown as MockWarhead[]
    const call = (whs[0]!.doImpact as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    const args = call[1] as Record<string, unknown>
    expect(args.source).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getBurstDelay() tests
// ---------------------------------------------------------------------------

describe('WeaponInfo.getBurstDelay', () => {
  it('returns the single delay when only one entry', () => {
    const info = WeaponInfo.fromJSON({
      name: 'Single',
      BurstDelays: [7],
    }, createWarheadRegistry())

    expect(info.getBurstDelay(0)).toBe(7)
    expect(info.getBurstDelay(1)).toBe(7)
    expect(info.getBurstDelay(99)).toBe(7)
  })

  it('returns index-specific delay when multiple entries', () => {
    const info = WeaponInfo.fromJSON({
      name: 'Multi',
      BurstDelays: [3, 5, 8],
    }, createWarheadRegistry())

    expect(info.getBurstDelay(0)).toBe(3)
    expect(info.getBurstDelay(1)).toBe(5)
    expect(info.getBurstDelay(2)).toBe(8)
  })

  it('falls back to last entry when index is out of bounds', () => {
    const info = WeaponInfo.fromJSON({
      name: 'Multi',
      BurstDelays: [2, 4, 6],
    }, createWarheadRegistry())

    // Index 5 is out of bounds — should return last entry
    expect(info.getBurstDelay(5)).toBe(6)
  })

  it('uses default burst delay array when not specified', () => {
    const info = WeaponInfo.fromJSON({ name: 'Default' }, createWarheadRegistry())

    expect(info.getBurstDelay(0)).toBe(5)
    expect(info.getBurstDelay(10)).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Static constants
// ---------------------------------------------------------------------------

describe('WeaponInfo static constants', () => {
  it('TARGET_TYPE_AIR is "Air"', () => {
    expect(WeaponInfo.TARGET_TYPE_AIR).toBe('Air')
  })

  it('DEFAULT_VALID_TARGETS contains Ground and Water', () => {
    expect(WeaponInfo.DEFAULT_VALID_TARGETS.has('Ground')).toBe(true)
    expect(WeaponInfo.DEFAULT_VALID_TARGETS.has('Water')).toBe(true)
    expect(WeaponInfo.DEFAULT_VALID_TARGETS.size).toBe(2)
  })

  it('DEFAULT_BURST_DELAYS is [5]', () => {
    expect(WeaponInfo.DEFAULT_BURST_DELAYS).toEqual([5])
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('WeaponInfo edge cases', () => {
  it('handles zero burst', () => {
    const info = WeaponInfo.fromJSON({
      name: 'ZeroBurst',
      Burst: 0,
    }, createWarheadRegistry())

    expect(info.burst).toBe(0)
  })

  it('handles empty ValidTargets (no valid targets)', () => {
    const info = WeaponInfo.fromJSON({
      name: 'NoTargets',
      ValidTargets: [],
    }, createWarheadRegistry())

    expect(info.validTargets.size).toBe(0)
    expect(info.isValidTarget(new Set(['Ground']))).toBe(false)
  })

  it('handles large WDist values', () => {
    const info = WeaponInfo.fromJSON({
      name: 'LongRange',
      Range: 2147483647, // WDist.MaxValue
    }, createWarheadRegistry())

    expect(info.range.length).toBe(2147483647)
  })

  it('handles string-targets converted to strings', () => {
    const info = WeaponInfo.fromJSON({
      name: 'StringTargets',
      ValidTargets: ['Ground', 42],
    }, createWarheadRegistry())

    expect(info.validTargets.has('Ground')).toBe(true)
    expect(info.validTargets.has('42')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ProjectileArgs type tests
// ---------------------------------------------------------------------------

describe('ProjectileArgs type', () => {
  it('conforms to the expected shape (compile-time check)', () => {
    const args: ProjectileArgs = {
      weapon: {} as WeaponInfo,
      damageModifiers: [100, 120],
      inaccuracyModifiers: [100],
      rangeModifiers: [100],
      facing: WAngle.Zero,
      currentMuzzleFacing: null,
      source: WPos.Zero,
      currentSource: null,
      sourceActor: createActor(),
      passiveTarget: WPos.Zero,
      guidedTarget: Target.Invalid,
    }

    expect(args.weapon).toBeDefined()
    expect(args.facing).toBe(WAngle.Zero)
    expect(args.currentMuzzleFacing).toBeNull()
  })
})
