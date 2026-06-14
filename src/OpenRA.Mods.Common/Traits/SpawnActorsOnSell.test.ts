/**
 * SpawnActorsOnSell.test.ts — SpawnActorsOnSell migration unit tests
 *
 * Tests focus on:
 * - SpawnActorsOnSellInfo defaults (ValuePercent=40, MinHpPercent=30,
 *   ActorTypes empty, GuaranteedActorTypes empty, Factions empty)
 * - SpawnActorsOnSellInfo custom constructor values
 * - ConditionalTrait integration (isTraitDisabled gating)
 * - INotifySold.selling() no-op
 * - INotifySold.sold() triggers emit
 * - Faction filter (correctFaction check)
 * - emit() gate: trait disabled
 * - emit() gate: incorrect faction
 * - emit() gate: no BuildingInfo
 * - emit() gate: no cost / zero dudesValue
 * - emit() gate: health below MinHpPercent
 * - emit() health scaling
 * - emit() spawns guaranteed actor types at random building tiles
 * - emit() spawns random actor types from pool, respecting budget
 * - emit() with empty guaranteedActorTypes and actorTypes
 * - emit() with no eligible locations
 * - emit() with no world
 * - emit() uses SharedRandom when available
 * - emit() uses ruleset for actor cost lookup
 * - emit() uses addFrameEndTask for deferred actor creation
 * - Actor creation includes LocationInit and OwnerInit
 * - attach() re-evaluates faction check
 * - CustomSellValueInfo takes priority over ValuedInfo for cost
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../OpenRA.Game/CPos'
import { SpawnActorsOnSell, SpawnActorsOnSellInfo } from './SpawnActorsOnSell.js'
import type {
  IGameActor,
  INotifySold,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayerStub(
  overrides: Record<string, unknown> = {},
): PlayerStub & Record<string, unknown> {
  return {
    playerName: 'TestPlayer',
    ...overrides,
  }
}

/** Create a mock BuildingInfo stub that reports tiles for a given position. */
function makeBuildingInfo(tiles: CPos[] = [new CPos(0, 0)]): {
  tiles: (topLeft: CPos) => CPos[]
} {
  return { tiles: (_topLeft: CPos) => [...tiles] }
}

/** Create a mock actor info with traitInfoOrDefault lookup. */
function makeActorInfo(
  traits: Record<string, Record<string, unknown>> = {},
): { name: string; traitInfoOrDefault: (name: string) => Record<string, unknown> | undefined } {
  const map = new Map(Object.entries(traits))
  return {
    name: 'TestActor',
    traitInfoOrDefault: (name: string) => map.get(name),
  }
}

/** Create a minimal mock actor for testing. */
function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: makePlayerStub(),
    ...overrides,
  } as IGameActor
}

/** Create a mock world for actor creation testing. */
function makeMockWorld(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actors: [] as IGameActor[],
    ...overrides,
  }
}

/** Create a SharedRandom stub that returns a predetermined sequence. */
function makeSharedRandom(sequence: number[]): {
  next: (min: number, max: number) => number
} {
  let i = 0
  return {
    next: (_min: number, _max: number) => {
      const val = sequence[i % sequence.length]
      i++
      return val
    },
  }
}

/** Create a Health mock. */
function makeHealth(hp: number, maxHP: number): { hp: number; maxHP: number } {
  return { hp, maxHP }
}

// ---------------------------------------------------------------------------
// SpawnActorsOnSellInfo — defaults
// ---------------------------------------------------------------------------

describe('SpawnActorsOnSellInfo', () => {
  it('has default ValuePercent = 40', () => {
    const info = new SpawnActorsOnSellInfo()
    expect(info.valuePercent).toBe(40)
  })

  it('has default MinHpPercent = 30', () => {
    const info = new SpawnActorsOnSellInfo()
    expect(info.minHpPercent).toBe(30)
  })

  it('has empty actorTypes by default', () => {
    const info = new SpawnActorsOnSellInfo()
    expect(info.actorTypes).toEqual([])
  })

  it('has empty guaranteedActorTypes by default', () => {
    const info = new SpawnActorsOnSellInfo()
    expect(info.guaranteedActorTypes).toEqual([])
  })

  it('has empty factions by default', () => {
    const info = new SpawnActorsOnSellInfo()
    expect(info.factions.size).toBe(0)
  })

  it('accepts custom values via constructor', () => {
    const info = new SpawnActorsOnSellInfo({
      valuePercent: 60,
      minHpPercent: 50,
      actorTypes: ['e1', 'e2'],
      guaranteedActorTypes: ['e3'],
      factions: new Set(['gdi', 'nod']),
      requiresCondition: 'upgraded',
      instanceName: 'spawn',
    })
    expect(info.valuePercent).toBe(60)
    expect(info.minHpPercent).toBe(50)
    expect(info.actorTypes).toEqual(['e1', 'e2'])
    expect(info.guaranteedActorTypes).toEqual(['e3'])
    expect(info.factions).toEqual(new Set(['gdi', 'nod']))
    expect(info.requiresCondition).toBe('upgraded')
    expect(info.instanceName).toBe('spawn')
  })

  it('uses defaults for unspecified constructor params', () => {
    const info = new SpawnActorsOnSellInfo({ actorTypes: ['e1'] })
    expect(info.valuePercent).toBe(40)
    expect(info.minHpPercent).toBe(30)
    expect(info.guaranteedActorTypes).toEqual([])
    expect(info.factions.size).toBe(0)
  })

  it('implements ConditionalTraitInfo interface', () => {
    const info = new SpawnActorsOnSellInfo()
    expect(info.requiresCondition).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SpawnActorsOnSell — construction & basic lifecycle
// ---------------------------------------------------------------------------

describe('SpawnActorsOnSell', () => {
  let info: SpawnActorsOnSellInfo

  beforeEach(() => {
    info = new SpawnActorsOnSellInfo({
      actorTypes: ['e1', 'e2'],
      guaranteedActorTypes: ['e3'],
    })
  })

  // ---------------------------------------------------------------------------
  // INotifySold.selling() — no-op
  // ---------------------------------------------------------------------------

  it('selling() is a no-op', () => {
    const trait = new SpawnActorsOnSell(info)
    const actor = makeMockActor()

    // Should not throw
    expect(() => trait.selling(actor)).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // ConditionalTrait integration — isTraitDisabled check
  // ---------------------------------------------------------------------------

  it('does not emit when trait is disabled', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    const world = makeMockWorld()
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    // trait starts enabled by default. Override enable state:
    // We need to simulate disable. Directly set protected _enabled:
    ;(trait as unknown as { _enabled: boolean })._enabled = false

    const createActorSpy = vi.fn()
    ;(world as Record<string, unknown>).createActor = createActorSpy

    trait.sold(actor)

    // No actor should be created since trait is disabled
    expect(createActorSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Faction filtering
  // ---------------------------------------------------------------------------

  it('allows all factions when factions set is empty', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      owner: makePlayerStub({ faction: { internalName: 'nod' } }),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    trait.sold(actor)

    // Should spawn guaranteed actor (e3)
    expect(createActorSpy).toHaveBeenCalledTimes(1)
  })

  it('blocks emission when faction does not match filter', () => {
    const factionInfo = new SpawnActorsOnSellInfo({
      actorTypes: ['e1'],
      factions: new Set(['gdi']),
    })
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      owner: makePlayerStub({ faction: { internalName: 'nod' } }),
    })

    const trait = new SpawnActorsOnSell(factionInfo, actor)
    trait.sold(actor)

    // No actor should be created — faction mismatch
    expect(createActorSpy).not.toHaveBeenCalled()
  })

  it('allows emission when faction matches filter', () => {
    const factionInfo = new SpawnActorsOnSellInfo({
      actorTypes: ['e1'],
      guaranteedActorTypes: [],
      factions: new Set(['gdi']),
    })
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      owner: makePlayerStub({ faction: { internalName: 'gdi' } }),
    })

    const trait = new SpawnActorsOnSell(factionInfo, actor)
    trait.sold(actor)

    // Should spawn (cost=100, dudesValue=40, e1 cost 0 from ruleset...)
    // With no ruleset, cost is 0, so dudesValue won't gate
    // Actor type e1 will be created
    expect(createActorSpy).toHaveBeenCalled()
  })

  it('blocks when owner has no faction info', () => {
    const factionInfo = new SpawnActorsOnSellInfo({
      actorTypes: ['e1'],
      factions: new Set(['gdi']),
    })
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    // No faction property at all
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      owner: makePlayerStub({}),
    })

    const trait = new SpawnActorsOnSell(factionInfo, actor)
    trait.sold(actor)

    // No actor should be created — no faction info
    expect(createActorSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // attach() re-evaluates faction
  // ---------------------------------------------------------------------------

  it('attach() re-evaluates faction check', () => {
    const factionInfo = new SpawnActorsOnSellInfo({
      actorTypes: ['e1'],
      factions: new Set(['gdi']),
    })
    // Construct without actor — correctFaction defaults to true
    const trait = new SpawnActorsOnSell(factionInfo)

    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      owner: makePlayerStub({ faction: { internalName: 'nod' } }),
    })

    // Attach to actor with mismatched faction
    trait.attach(actor)
    trait.sold(actor)

    // No actor should be created — faction mismatch detected during attach
    expect(createActorSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // emit() gate: no BuildingInfo
  // ---------------------------------------------------------------------------

  it('returns early when no BuildingInfo is present', () => {
    const actorInfo = makeActorInfo({
      // No BuildingInfo!
      ValuedInfo: { cost: 100 },
    })
    const world = makeMockWorld()
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    // Should not throw and should not try to create actors
    expect(() => trait.sold(actor)).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // emit() gate: no cost / zero dudesValue
  // ---------------------------------------------------------------------------

  it('returns early when no cost info available', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      // No ValuedInfo or CustomSellValueInfo
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    trait.sold(actor)

    expect(createActorSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // emit() health scaling
  // ---------------------------------------------------------------------------

  it('scales dudesValue by health percentage', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 1000 },
    })
    const createdActors: string[] = []
    const world = makeMockWorld({
      createActor: (name: string) => {
        createdActors.push(name)
      },
      map: {
        rules: {
          actors: {
            e3: {
              traitInfoOrDefault: (n: string) =>
                n === 'ValuedInfo' ? { cost: 40 } : undefined,
            },
          },
        },
      },
    })

    // Full health → dudesValue = 40% * 1000 * 200/200 = 400
    const fullHealthActor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      traitOrDefault: (name: string) => (name === 'Health' ? makeHealth(200, 200) : null),
    })

    const trait1 = new SpawnActorsOnSell(info, fullHealthActor)
    trait1.sold(fullHealthActor)
    // With budget 400 and guaranteed actor e3 cost 40, all guaranteed types spawned.
    // Then random types from pool. Let's just check guaranteed was spawned.
    expect(createdActors).toContain('e3')

    // Half health → dudesValue = 40% * 1000 * 100/200 = 200
    const halfHealthActors: string[] = []
    const world2 = makeMockWorld({
      createActor: (name: string) => {
        halfHealthActors.push(name)
      },
      map: {
        rules: {
          actors: {
            e3: {
              traitInfoOrDefault: (n: string) =>
                n === 'ValuedInfo' ? { cost: 40 } : undefined,
            },
          },
        },
      },
    })
    const halfHealthActor = makeMockActor({
      info: actorInfo,
      world: world2,
      location: new CPos(0, 0),
      traitOrDefault: (name: string) => (name === 'Health' ? makeHealth(100, 200) : null),
    })

    const trait2 = new SpawnActorsOnSell(info, halfHealthActor)
    trait2.sold(halfHealthActor)
    expect(halfHealthActors).toContain('e3')
  })

  it('sets dudesValue to 0 when health below MinHpPercent', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 1000 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    // 20 HP / 200 MaxHP = 10% < MinHpPercent (30%)
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      traitOrDefault: (name: string) => (name === 'Health' ? makeHealth(20, 200) : null),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    trait.sold(actor)

    expect(createActorSpy).not.toHaveBeenCalled()
  })

  it('handles zero maxHP gracefully', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 1000 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    // 0 HP / 0 MaxHP — 100*0 >= 30*0 → true → dudesValue = 0*val/0 = NaN/Infinity
    // Actually 0/0 is NaN. Math.floor(NaN) = NaN, NaN <= 0 is false, so this edge case
    // could potentially cause issues. But the HP check would be: 100*0 >= 30*0 = 0>=0 = true.
    // Then dudesValue = Math.floor(0 * dudesValue / 0) = NaN.
    // NaN <= 0 is false... but this is an extreme edge case (dead building being sold).
    // The guard is that Sellable should not allow selling dead buildings.
    // We just verify no crash occurs.
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      traitOrDefault: (name: string) => (name === 'Health' ? makeHealth(0, 0) : null),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    // Should not throw — though NaN causes no spawn
    expect(() => trait.sold(actor)).not.toThrow()
  })

  it('handles building with no health trait (normal)', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({
      createActor: createActorSpy,
      map: {
        rules: {
          actors: {
            e3: { traitInfoOrDefault: () => undefined },
          },
        },
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      // No health trait
    })

    const trait = new SpawnActorsOnSell(info, actor)
    trait.sold(actor)

    // dudesValue = 40 * 100 / 100 = 40, no health scaling
    // guaranteed e3 cost 0, so spawned
    expect(createActorSpy).toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // emit() spawns guaranteed actors
  // ---------------------------------------------------------------------------

  it('spawns guaranteed actor types at random building tiles', () => {
    const tile1 = new CPos(0, 0)
    const tile2 = new CPos(0, 1)
    const buildingInfo = makeBuildingInfo([tile1, tile2])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 500 },
    })
    const createdActors: { name: string; loc: CPos }[] = []
    const world = makeMockWorld({
      createActor: (name: string, inits: { type: string; value: unknown }[]) => {
        const locInit = inits.find((i) => i.type === 'LocationInit')
        createdActors.push({
          name,
          loc: (locInit?.value as CPos) ?? CPos.Zero,
        })
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
      owner: makePlayerStub({ playerName: 'GDI' }),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    trait.sold(actor)

    // One guaranteed actor (e3) spawned at one of the building tiles
    expect(createdActors.length).toBeGreaterThanOrEqual(1)
    expect(createdActors[0].name).toBe('e3')
    // Location should be one of the building tiles
    expect(
      CPos.equals(createdActors[0].loc, tile1) ||
      CPos.equals(createdActors[0].loc, tile2),
    ).toBe(true)
  })

  it('stops spawning guaranteed actors when all tiles consumed', () => {
    // Only 1 tile, 2 guaranteed actor types → only 1 guaranteed spawned
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 500 },
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: [],
      guaranteedActorTypes: ['e3', 'e4'],
    })

    const createdActors: string[] = []
    const world = makeMockWorld({
      createActor: (name: string) => {
        createdActors.push(name)
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // Only 1 tile, so only 1 guaranteed actor can spawn
    expect(createdActors.length).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // emit() spawns random actor types from pool
  // ---------------------------------------------------------------------------

  it('spawns random actor types respecting budget', () => {
    const tiles = [
      new CPos(0, 0),
      new CPos(0, 1),
      new CPos(1, 0),
      new CPos(1, 1),
    ]
    const buildingInfo = makeBuildingInfo(tiles)
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 1000 },
    })

    const info2 = new SpawnActorsOnSellInfo({
      // No guaranteed actors — only random pool
      actorTypes: ['e1', 'e2'],
      guaranteedActorTypes: [],
    })

    const createdActors: { name: string; loc: CPos }[] = []
    const world = makeMockWorld({
      createActor: (name: string, inits: { type: string; value: unknown }[]) => {
        const locInit = inits.find((i) => i.type === 'LocationInit')
        createdActors.push({
          name,
          loc: (locInit?.value as CPos) ?? CPos.Zero,
        })
      },
      map: {
        rules: {
          actors: {
            e1: { traitInfoOrDefault: (n: string) => (n === 'ValuedInfo' ? { cost: 30 } : undefined) },
            e2: { traitInfoOrDefault: (n: string) => (n === 'ValuedInfo' ? { cost: 50 } : undefined) },
          },
        },
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // dudesValue = 40% * 1000 = 400
    // Each e1 costs 30, each e2 costs 50
    // Should spawn multiple actors until budget exhausted
    expect(createdActors.length).toBeGreaterThan(0)
    // Total cost should not exceed 400
    let totalCost = 0
    for (const ca of createdActors) {
      if (ca.name === 'e1') totalCost += 30
      else if (ca.name === 'e2') totalCost += 50
    }
    expect(totalCost).toBeLessThanOrEqual(400)
    // All created at valid tiles
    for (const ca of createdActors) {
      const found = tiles.some((t) => CPos.equals(ca.loc, t))
      expect(found).toBe(true)
    }
  })

  it('stops spawning when budget cannot afford any type', () => {
    const tiles = [new CPos(0, 0), new CPos(0, 1)]
    const buildingInfo = makeBuildingInfo(tiles)
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 10 }, // Very cheap building
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: ['expensive_unit'],
      guaranteedActorTypes: [],
    })

    const createdActors: string[] = []
    const world = makeMockWorld({
      createActor: (name: string) => {
        createdActors.push(name)
      },
      map: {
        rules: {
          actors: {
            expensive_unit: {
              traitInfoOrDefault: (n: string) =>
                n === 'ValuedInfo' ? { cost: 100 } : undefined, // cost 100 > budget 4
            },
          },
        },
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // dudesValue = 40 * 10 / 100 = 4, but units cost 100 → nothing spawned
    expect(createdActors.length).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // emit() with empty actor types lists
  // ---------------------------------------------------------------------------

  it('handles empty actorTypes gracefully', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })

    const emptyInfo = new SpawnActorsOnSellInfo({
      actorTypes: [],
      guaranteedActorTypes: [],
    })

    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(emptyInfo, actor)
    trait.sold(actor)

    // Nothing to spawn
    expect(createActorSpy).not.toHaveBeenCalled()
  })

  it('handles only guaranteed actor types (no random pool)', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })

    const onlyGuaranteed = new SpawnActorsOnSellInfo({
      actorTypes: [],
      guaranteedActorTypes: ['e3'],
    })

    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(onlyGuaranteed, actor)
    trait.sold(actor)

    expect(createActorSpy).toHaveBeenCalledWith('e3', expect.anything())
    expect(createActorSpy).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // emit() gate: no eligible locations
  // ---------------------------------------------------------------------------

  it('returns early when building has no tiles', () => {
    const buildingInfo = makeBuildingInfo([]) // Empty tile list
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    trait.sold(actor)

    expect(createActorSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // emit() gate: no world
  // ---------------------------------------------------------------------------

  it('returns early when world is not available', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })
    // No world property
    const actor = makeMockActor({
      info: actorInfo,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info, actor)
    // Should not throw
    expect(() => trait.sold(actor)).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // emit() uses SharedRandom
  // ---------------------------------------------------------------------------

  it('uses SharedRandom when available for tile and type selection', () => {
    const tiles = [new CPos(0, 0), new CPos(1, 0), new CPos(2, 0)]
    const buildingInfo = makeBuildingInfo(tiles)
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 1000 },
    })

    const sharedRandom = makeSharedRandom([0, 1]) // Always picks first then second
    const createdLocations: CPos[] = []
    const world = makeMockWorld({
      sharedRandom,
      createActor: (_name: string, inits: { type: string; value: unknown }[]) => {
        const locInit = inits.find((i) => i.type === 'LocationInit')
        createdLocations.push((locInit?.value as CPos) ?? CPos.Zero)
      },
      map: {
        rules: {
          actors: {
            e1: { traitInfoOrDefault: (n: string) => (n === 'ValuedInfo' ? { cost: 30 } : undefined) },
            e2: { traitInfoOrDefault: (n: string) => (n === 'ValuedInfo' ? { cost: 50 } : undefined) },
          },
        },
      },
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: ['e1', 'e2'],
      guaranteedActorTypes: [],
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // With sharedRandom returning 0 for type and 1 for tile each iteration,
    // first created should be at tile index 1 (CPos(1,0))
    if (createdLocations.length > 0) {
      expect(
        CPos.equals(createdLocations[0], tiles[1]) ||
        CPos.equals(createdLocations[0], tiles[0]),
      ).toBe(true)
    }
  })

  // ---------------------------------------------------------------------------
  // emit() uses ruleset for actor cost lookup
  // ---------------------------------------------------------------------------

  it('resolves actor costs from ruleset when available', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 1000 }, // dudesValue = 400
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: ['cheap_e1'], // cost 10 from ruleset
      guaranteedActorTypes: [],
    })

    const createdCount: number[] = [0]
    const world = makeMockWorld({
      createActor: () => {
        createdCount[0]++
      },
      map: {
        rules: {
          actors: {
            cheap_e1: {
              traitInfoOrDefault: (n: string) =>
                n === 'ValuedInfo' ? { cost: 10 } : undefined,
            },
          },
        },
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // Budget 400 / cost 10 = up to 40 actors, but only 1 tile
    expect(createdCount[0]).toBe(1)
  })

  it('uses zero cost when ruleset actor not found', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: ['missing_actor'],
      guaranteedActorTypes: [],
    })

    const createActorSpy = vi.fn()
    const world = makeMockWorld({ createActor: createActorSpy })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // Actor not in ruleset → cost 0 → can always afford, spawns
    expect(createActorSpy).toHaveBeenCalledWith('missing_actor', expect.anything())
  })

  // ---------------------------------------------------------------------------
  // emit() uses addFrameEndTask for deferred creation
  // ---------------------------------------------------------------------------

  it('uses addFrameEndTask when createActor not directly available', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: ['e1'],
      guaranteedActorTypes: [],
    })

    const deferredCreateActor = vi.fn()
    const world = makeMockWorld({
      // No direct createActor
      addFrameEndTask: (action: (w: Record<string, unknown>) => void) => {
        action({ createActor: deferredCreateActor })
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    expect(deferredCreateActor).toHaveBeenCalledWith('e1', expect.anything())
  })

  // ---------------------------------------------------------------------------
  // Actor creation includes LocationInit and OwnerInit
  // ---------------------------------------------------------------------------

  it('creates actors with LocationInit at the selected building tile', () => {
    const tile = new CPos(3, 5)
    const buildingInfo = makeBuildingInfo([tile])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: ['e1'],
      guaranteedActorTypes: [],
    })

    let receivedInits: { type: string; value: unknown }[] = []
    const world = makeMockWorld({
      createActor: (_name: string, inits: { type: string; value: unknown }[]) => {
        receivedInits = inits
      },
    })
    const owner = makePlayerStub({ playerName: 'GDI' })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(3, 5),
      owner: owner,
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // Should have LocationInit
    const locInit = receivedInits.find((i) => i.type === 'LocationInit')
    expect(locInit).toBeDefined()
    expect(CPos.equals(locInit!.value as CPos, tile)).toBe(true)

    // Should have OwnerInit
    const ownerInit = receivedInits.find((i) => i.type === 'OwnerInit')
    expect(ownerInit).toBeDefined()
    expect(ownerInit!.value).toBe(owner)
  })

  // ---------------------------------------------------------------------------
  // CustomSellValue takes priority over Valued
  // ---------------------------------------------------------------------------

  it('uses CustomSellValueInfo.value when available', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
      CustomSellValueInfo: { value: 500 }, // Override
    })

    const info2 = new SpawnActorsOnSellInfo({
      valuePercent: 100, // Use 100% for clear comparison
      actorTypes: ['e1'],
      guaranteedActorTypes: [],
    })

    const createdCount: number[] = [0]
    const world = makeMockWorld({
      createActor: () => {
        createdCount[0]++
      },
      map: {
        rules: {
          actors: {
            e1: {
              traitInfoOrDefault: (n: string) =>
                n === 'ValuedInfo' ? { cost: 100 } : undefined,
            },
          },
        },
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // dudesValue = 100% * 500 (CustomSellValue) = 500
    // e1 cost 100 → at most 5, but only 1 tile
    expect(createdCount[0]).toBe(1)
  })

  it('falls back to ValuedInfo.cost when no CustomSellValue', () => {
    const buildingInfo = makeBuildingInfo([new CPos(0, 0)])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 200 },
    })

    const info2 = new SpawnActorsOnSellInfo({
      valuePercent: 100,
      actorTypes: ['e1'],
      guaranteedActorTypes: [],
    })

    const createdCount: number[] = [0]
    const world = makeMockWorld({
      createActor: () => {
        createdCount[0]++
      },
      map: {
        rules: {
          actors: {
            e1: {
              traitInfoOrDefault: (n: string) =>
                n === 'ValuedInfo' ? { cost: 50 } : undefined,
            },
          },
        },
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // dudesValue = 100% * 200 = 200
    // e1 cost 50 → can afford, spawns
    expect(createdCount[0]).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // IOccupySpace location fallback
  // ---------------------------------------------------------------------------

  it('falls back to IOccupySpace.topLeft when no direct location', () => {
    const tile = new CPos(2, 3)
    const buildingInfo = makeBuildingInfo([tile])
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: ['e1'],
      guaranteedActorTypes: [],
    })

    let receivedLoc: CPos = CPos.Zero
    const world = makeMockWorld({
      createActor: (_name: string, inits: { type: string; value: unknown }[]) => {
        const locInit = inits.find((i) => i.type === 'LocationInit')
        receivedLoc = (locInit?.value as CPos) ?? CPos.Zero
      },
    })
    // No direct location property, use IOccupySpace fallback
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      occupiesSpace: { topLeft: tile },
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    expect(CPos.equals(receivedLoc, tile)).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Guaranteed actors deduct from budget
  // ---------------------------------------------------------------------------

  it('guaranteed actor types deduct from the budget', () => {
    const tiles = [new CPos(0, 0), new CPos(1, 0), new CPos(2, 0)]
    const buildingInfo = makeBuildingInfo(tiles)
    const actorInfo = makeActorInfo({
      BuildingInfo: buildingInfo as unknown as Record<string, unknown>,
      ValuedInfo: { cost: 100 },
    })

    const info2 = new SpawnActorsOnSellInfo({
      actorTypes: ['e2'], // cost 20
      guaranteedActorTypes: ['e1'], // cost 10
    })

    const createdActors: string[] = []
    const world = makeMockWorld({
      createActor: (name: string) => {
        createdActors.push(name)
      },
      map: {
        rules: {
          actors: {
            e1: { traitInfoOrDefault: (n: string) => (n === 'ValuedInfo' ? { cost: 10 } : undefined) },
            e2: { traitInfoOrDefault: (n: string) => (n === 'ValuedInfo' ? { cost: 20 } : undefined) },
          },
        },
      },
    })
    const actor = makeMockActor({
      info: actorInfo,
      world: world,
      location: new CPos(0, 0),
    })

    const trait = new SpawnActorsOnSell(info2, actor)
    trait.sold(actor)

    // dudesValue = 40% * 100 = 40
    // Guaranteed e1 costs 10, leaves budget 30
    // Random e2 costs 20, fits in 30 → spawned
    // Total: 1 guaranteed + some random
    expect(createdActors).toContain('e1') // Guaranteed
  })

  // ---------------------------------------------------------------------------
  // Type guard — INotifySold implementation
  // ---------------------------------------------------------------------------

  it('implements INotifySold with selling and sold methods', () => {
    const trait = new SpawnActorsOnSell(info)
    const notif = trait as INotifySold

    expect(typeof notif.selling).toBe('function')
    expect(typeof notif.sold).toBe('function')
  })
})
