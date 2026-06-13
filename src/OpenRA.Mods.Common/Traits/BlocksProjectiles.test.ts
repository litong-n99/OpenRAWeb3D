/**
 * BlocksProjectiles.test.ts -- BlocksProjectiles migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed.
 * These tests focus on: config defaults, interface compliance, blocking height,
 * valid relationships, and static helper methods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  BlocksProjectiles,
  BlocksProjectilesInfo,
} from './BlocksProjectiles.js'
import { PlayerRelationship } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockActor(overrides: Record<string, unknown> = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
}

function makeWDist(len: number) {
  return { length: len, _brand: 'WDist' }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlocksProjectilesInfo', () => {
  it('has default height of 1 cell (1024 WDist)', () => {
    const info = new BlocksProjectilesInfo()
    expect(info.height.length).toBe(1024)
  })

  it('has default validRelationships of Ally|Neutral|Enemy', () => {
    const info = new BlocksProjectilesInfo()
    const expected = (PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship
    expect(info.validRelationships).toBe(expected)
  })

  it('accepts custom height', () => {
    const height = makeWDist(2048) as any
    const info = new BlocksProjectilesInfo({ height } as any)
    expect(info.height.length).toBe(2048)
  })

  it('accepts custom validRelationships', () => {
    const info = new BlocksProjectilesInfo({
      validRelationships: PlayerRelationship.Enemy,
    })
    expect(info.validRelationships).toBe(PlayerRelationship.Enemy)
  })

  it('accepts instanceName', () => {
    const info = new BlocksProjectilesInfo({ instanceName: 'wall' })
    expect(info.instanceName).toBe('wall')
  })

  it('accepts requiresCondition', () => {
    const info = new BlocksProjectilesInfo({ requiresCondition: '!disabled' })
    expect(info.requiresCondition).toBe('!disabled')
  })
})

describe('BlocksProjectiles', () => {
  let trait: BlocksProjectiles

  beforeEach(() => {
    const info = new BlocksProjectilesInfo()
    trait = new BlocksProjectiles(info)
  })

  afterEach(() => {
    trait.dispose()
  })

  it('returns blockingHeight from info.height', () => {
    expect(trait.blockingHeight.length).toBe(1024)
  })

  it('returns validRelationships from info.validRelationships', () => {
    const expected = (PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship
    expect(trait.validRelationships).toBe(expected)
  })

  it('starts enabled (not disabled)', () => {
    expect(trait.isTraitDisabled).toBe(false)
  })

  it('supports ConditionalTrait lifecycle', () => {
    const actor = makeMockActor({ actorId: 1 })
    trait.attach(actor as any)
    expect(trait.actor).toBe(actor)
  })

  describe('anyBlockingActorAt', () => {
    it('returns false when no actors at position', () => {
      const world = {
        map: {
          distanceAboveTerrain: () => makeWDist(0) as any,
          cellContaining: () => ({ x: 0, y: 0 }),
        },
        actorMap: {
          getActorsAt: () => [] as any[],
        },
      }
      expect(BlocksProjectiles.anyBlockingActorAt(world as any, { x: 0, y: 0 })).toBe(false)
    })

    it('returns true when a blocking actor with sufficient height is present', () => {
      const mockActor = makeMockActor({
        traitsImplementing: (_tag: string) => [{
          blockingHeight: makeWDist(5000) as any,
          isTraitDisabled: false,
        }],
      })
      const world = {
        map: {
          distanceAboveTerrain: () => makeWDist(100) as any,
          cellContaining: () => ({ x: 0, y: 0 }),
        },
        actorMap: {
          getActorsAt: () => [mockActor] as any[],
        },
      }
      expect(BlocksProjectiles.anyBlockingActorAt(world as any, { x: 0, y: 0 })).toBe(true)
    })

    it('returns false when blocking actor is disabled', () => {
      const mockActor = makeMockActor({
        traitsImplementing: (_tag: string) => [{
          blockingHeight: makeWDist(5000) as any,
          isTraitDisabled: true,
        }],
      })
      const world = {
        map: {
          distanceAboveTerrain: () => makeWDist(100) as any,
          cellContaining: () => ({ x: 0, y: 0 }),
        },
        actorMap: {
          getActorsAt: () => [mockActor] as any[],
        },
      }
      expect(BlocksProjectiles.anyBlockingActorAt(world as any, { x: 0, y: 0 })).toBe(false)
    })

    it('returns false when blocking height is insufficient', () => {
      const mockActor = makeMockActor({
        traitsImplementing: (_tag: string) => [{
          blockingHeight: makeWDist(50) as any,
          isTraitDisabled: false,
        }],
      })
      const world = {
        map: {
          distanceAboveTerrain: () => makeWDist(100) as any,
          cellContaining: () => ({ x: 0, y: 0 }),
        },
        actorMap: {
          getActorsAt: () => [mockActor] as any[],
        },
      }
      expect(BlocksProjectiles.anyBlockingActorAt(world as any, { x: 0, y: 0 })).toBe(false)
    })
  })

  describe('anyBlockingActorsBetween', () => {
    it('returns false when findBlockingActorsOnLine is not available', () => {
      const world = {
        map: {
          distanceAboveTerrain: () => makeWDist(100) as any,
        },
      }
      const owner = { relationshipWith: () => PlayerRelationship.None }
      const outHit = { hit: 'initial' }
      const result = BlocksProjectiles.anyBlockingActorsBetween(
        world as any, owner, { x: 0, y: 0 }, { x: 1, y: 1 },
        makeWDist(0) as any, outHit,
      )
      expect(result).toBe(false)
      expect(outHit.hit).toBeNull()
    })

    it('returns false when no blocking actors on line', () => {
      const world = {
        map: {
          distanceAboveTerrain: () => makeWDist(100) as any,
        },
        findBlockingActorsOnLine: () => [] as any[],
      }
      const owner = { relationshipWith: () => PlayerRelationship.None }
      const outHit = { hit: 'initial' }
      const result = BlocksProjectiles.anyBlockingActorsBetween(
        world as any, owner, { x: 0, y: 0 }, { x: 1, y: 1 },
        makeWDist(0) as any, outHit,
      )
      expect(result).toBe(false)
    })
  })
})
