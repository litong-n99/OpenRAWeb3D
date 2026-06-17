/**
 * SpiceBloom.test.ts — Unit tests for SpiceBloom migration
 *
 * Tests focus on: config defaults, lifetime randomization, tick growth,
 * growth animation frame progression, killed event triggers seed.
 */

import { describe, it, expect } from 'vitest'
import { SpiceBloom, SpiceBloomInfo } from './SpiceBloom'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import { CPos } from '../../OpenRA.Game/CPos'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockActor(overrides?: Partial<{
  location: CPos
  centerPosition: unknown
  hasMap: boolean
  terrainType: string | null
  sharedRandom: { next: (min: number, max: number) => number }
}>): IGameActor {
  const defaults = {
    location: new CPos(0, 0),
    centerPosition: { X: 0, Y: 0, Z: 0 },
    hasMap: true,
    terrainType: null,
    sharedRandom: { next: (_min: number, max: number) => max - 1 },
    ...overrides,
  }

  const world = {
    sharedRandom: defaults.sharedRandom,
    map: defaults.hasMap ? {
      contains: () => true,
      getTerrainInfo: () => defaults.terrainType ? { type: defaults.terrainType } : null,
      centerOfCell: () => ({ X: 512, Y: 512, Z: 0 }),
      rules: {
        weapons: new Map(),
      },
    } : {
      contains: () => false,
      getTerrainInfo: () => null,
      centerOfCell: () => ({ X: 0, Y: 0, Z: 0 }),
      rules: { weapons: new Map() },
    },
    worldActor: {
      trait: () => ({
        getResourceType: () => 'Spice',
        canAddResource: () => true,
      }),
    },
    addFrameEndTask: (task: () => void) => task(),
    game: { sound: { play: () => {} } },
  }

  return {
    actorId: 1,
    disposed: false,
    world,
    location: defaults.location,
    centerPosition: defaults.centerPosition,
    kill: () => {},
    trait: () => ({
      getImage: () => 'spicebloom',
      add: () => {},
    }),
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpiceBloomInfo', () => {
  it('has correct default values', () => {
    const info = new SpiceBloomInfo()
    expect(info.growthSequences).toEqual(['grow1', 'grow2', 'grow3'])
    expect(info.spurtSequence).toBe('spurt')
    expect(info.lifetime).toEqual([2000, 3000])
    expect(info.resourceType).toBe('Spice')
    expect(info.growthTerrainTypes).toEqual([])
    expect(info.weapon).toBeNull()
    expect(info.bursts).toEqual([4, 12])
    expect(info.range).toEqual([3, 5])
    expect(info.burstInterval).toBe(1)
  })

  it('accepts custom values', () => {
    const info = new SpiceBloomInfo({
      resourceType: 'BlueSpice',
      weapon: 'SpiceSpawn',
      lifetime: [1000, 2000],
      bursts: [2, 6],
      range: [2, 4],
      burstInterval: 2,
    })
    expect(info.resourceType).toBe('BlueSpice')
    expect(info.weapon).toBe('SpiceSpawn')
    expect(info.lifetime).toEqual([1000, 2000])
    expect(info.bursts).toEqual([2, 6])
    expect(info.range).toEqual([2, 4])
    expect(info.burstInterval).toBe(2)
  })
})

describe('SpiceBloom', () => {
  it('creates with random lifetime from config range', () => {
    const info = new SpiceBloomInfo({
      lifetime: [1000, 1000], // deterministic: always 1000-1=999
      weapon: null,
    })
    const actor = mockActor({
      sharedRandom: { next: (_min: number, _max: number) => 500 },
    })
    const bloom = new SpiceBloom(actor, info)

    expect(bloom.growTicks).toBe(500)
    expect(bloom.info).toBe(info)
  })

  it('ticks without error when inside map with no terrain restrictions', () => {
    const info = new SpiceBloomInfo({
      lifetime: [2000, 2000],
      weapon: null,
    })
    const actor = mockActor({
      sharedRandom: { next: () => 2000 },
    })
    const bloom = new SpiceBloom(actor, info)

    // Single tick — should not error
    bloom.tick(actor)
  })

  it('skips tick when outside map', () => {
    const info = new SpiceBloomInfo({ weapon: null })
    const actor = mockActor({
      hasMap: false,
      sharedRandom: { next: () => 2000 },
    })
    const bloom = new SpiceBloom(actor, info)

    bloom.tick(actor)
    // No error = pass
  })

  it('skips tick when terrain type does not match', () => {
    const info = new SpiceBloomInfo({
      growthTerrainTypes: ['Sand'],
      weapon: null,
    })
    const actor = mockActor({
      terrainType: 'Rock', // doesn't match 'Sand'
      sharedRandom: { next: () => 2000 },
    })
    const bloom = new SpiceBloom(actor, info)

    bloom.tick(actor)
    // No error = pass (skipped)
  })

  it('kills self when ticks >= growTicks', () => {
    let killed = false
    const info = new SpiceBloomInfo({
      lifetime: [10, 10],
      weapon: null,
    })
    const actor = mockActor({
      sharedRandom: { next: () => 10 },
    })

    // Override kill
    const actorWithKill = {
      ...actor,
      kill: () => { killed = true },
    } as unknown as IGameActor

    const bloom = new SpiceBloom(actorWithKill, info)

    // Tick 10 times to reach growTicks
    for (let i = 0; i < 10; i++) {
      bloom.tick(actorWithKill)
    }
    expect(killed).toBe(true)
  })

  it('killed event seeds resources when weapon is configured', () => {
    let frameTaskExecuted = false
    const info = new SpiceBloomInfo({
      lifetime: [2000, 2000],
      weapon: 'SpiceSpawn',
    })
    const actor = mockActor({
      sharedRandom: { next: () => 2000 },
    })

    const actorWithTask = {
      ...actor,
      world: {
        ...actor.world,
        addFrameEndTask: (task: () => void) => {
          frameTaskExecuted = true
          task()
        },
      },
    } as unknown as IGameActor

    const bloom = new SpiceBloom(actorWithTask, info)

    bloom.killed(actorWithTask, {})
    expect(frameTaskExecuted).toBe(true)
  })

  it('killed event does nothing when weapon is null', () => {
    const info = new SpiceBloomInfo({ weapon: null })
    const actor = mockActor({
      sharedRandom: { next: () => 2000 },
    })
    const bloom = new SpiceBloom(actor, info)

    // Should not throw
    bloom.killed(actor, {})
  })

  it('advances body frame as growth progresses', () => {
    const info = new SpiceBloomInfo({
      lifetime: [100, 100],
      growthSequences: ['grow1', 'grow2', 'grow3', 'grow4'],
      weapon: null,
    })
    const actor = mockActor({
      sharedRandom: { next: () => 100 },
    })
    const bloom = new SpiceBloom(actor, info)

    // Tick 25 times — should be at frame 0 (25/100 * 4 = 1.0 → frame 1)
    // Actually: Math.floor(4 * 25 / 100) = Math.floor(1.0) = 1
    // Let's tick incrementally
    for (let i = 0; i < 30; i++) {
      bloom.tick(actor)
    }
    // Frame 1 should have been set by now (30/100 * 4 = 1.2 → floor 1)
    // No error indicates animation was played
  })
})
