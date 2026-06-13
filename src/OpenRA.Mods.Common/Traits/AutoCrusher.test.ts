/**
 * AutoCrusher.test.ts -- AutoCrusher migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed.
 * Tests focus on: config defaults, tickIdle scan behavior, valid target filtering,
 * trait enable/disable, scan cooldown management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BitSet } from '../../OpenRA.Game/Primitives/BitSet.js'
import {
  AutoCrusher,
  AutoCrusherInfo,
} from './AutoCrusher.js'
import {
  CRUSH_CLASS_TYPENAME,
} from './CombatInterfaces.js'
import {
  PlayerRelationship,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockActor(overrides: Record<string, unknown> = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traitsImplementing: (_tag: string) => [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutoCrusherInfo', () => {
  beforeEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
  })

  afterEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
  })

  it('has default scanRadius length of 5120 (5 cells)', () => {
    const info = new AutoCrusherInfo()
    expect(info.scanRadius.length).toBe(5120)
  })

  it('has default minimumScanTimeInterval of 10', () => {
    const info = new AutoCrusherInfo()
    expect(info.minimumScanTimeInterval).toBe(10)
  })

  it('has default maximumScanTimeInterval of 15', () => {
    const info = new AutoCrusherInfo()
    expect(info.maximumScanTimeInterval).toBe(15)
  })

  it('has empty default crushClasses', () => {
    const info = new AutoCrusherInfo()
    expect(info.crushClasses.isEmpty).toBe(true)
  })

  it('has default targetRelationships of Ally|Neutral|Enemy', () => {
    const info = new AutoCrusherInfo()
    const expected = (PlayerRelationship.Ally | PlayerRelationship.Neutral | PlayerRelationship.Enemy) as PlayerRelationship
    expect(info.targetRelationships).toBe(expected)
  })

  it('accepts custom crushClasses', () => {
    const info = new AutoCrusherInfo({ crushClasses: ['infantry', 'vehicle'] })
    expect(info.crushClasses.contains('infantry')).toBe(true)
    expect(info.crushClasses.contains('vehicle')).toBe(true)
  })
})

describe('AutoCrusher', () => {
  let info: AutoCrusherInfo
  let trait: AutoCrusher

  beforeEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
    info = new AutoCrusherInfo({ crushClasses: ['infantry'] })
    trait = new AutoCrusher(info)
  })

  afterEach(() => {
    trait.dispose()
    BitSet.reset(CRUSH_CLASS_TYPENAME)
  })

  it('starts enabled (not disabled)', () => {
    expect(trait.isTraitDisabled).toBe(false)
  })

  it('starts not paused', () => {
    expect(trait.isTraitPaused).toBe(false)
  })

  describe('tickIdle', () => {
    it('does nothing when trait is disabled', () => {
      trait['_enabled'] = false
      const actor = makeMockActor({
        world: {
          findActorsInCircle: () => [{ actorId: 2, isDead: false, isInWorld: true }],
          sharedRandom: { next: () => 10 },
        },
        centerPosition: { x: 0, y: 0 },
        trait: () => ({ moveTo: () => ({}) }),
        info: { traitInfo: () => ({ getTargetLineColor: () => ({ r: 0, g: 0, b: 0, a: 0 }) }) },
      })
      trait.tickIdle(actor as any)
      trait['_enabled'] = true
    })

    it('does nothing when trait is paused', () => {
      trait['_paused'] = true
      const actor = makeMockActor({
        world: {
          findActorsInCircle: () => [],
          sharedRandom: { next: () => 10 },
        },
        centerPosition: { x: 0, y: 0 },
      })
      trait.tickIdle(actor as any)
      trait['_paused'] = false
    })

    it('scans continuously when no valid targets (no cooldown reset)', () => {
      // When no targets are found, nextScanTime stays at -1 (or lower),
      // causing the actor to scan every idle tick. Matches OpenRA behavior:
      // cooldown only resets after finding a valid crush target.
      const world = {
        findActorsInCircle: () => [] as any[],
        sharedRandom: { next: (_min?: number, _max?: number) => 12 },
      }
      const actor = makeMockActor({
        world,
        centerPosition: { x: 0, y: 0 },
        trait: () => null,
      })

      trait['_nextScanTime'] = 0
      trait.tickIdle(actor as any)
      // After scanning with no targets: nextScanTime is -1 (post-decrement of 0)
      // OpenRA does NOT reset the timer when no target is found
      expect(trait['_nextScanTime']).toBe(-1)
    })

    it('resets scan cooldown when valid crush target found', () => {
      const world = {
        findActorsInCircle: () => [makeMockActor({
          actorId: 2,
          owner: {},
          crushables: [{
            crushableBy: (_a: any, _b: any, _c: any) => true,
          }],
          traitsImplementing: (_tag: string) => [] as any[],
        })],
        sharedRandom: { next: (_min?: number, _max?: number) => 12 },
      }
      const actor = makeMockActor({
        actorId: 1,
        world,
        centerPosition: { x: 0, y: 0 },
        owner: { relationshipWith: () => PlayerRelationship.Enemy },
        trait: () => ({
          moveTo: () => ({}) as any,
        }),
        info: { traitInfo: () => ({ getTargetLineColor: () => ({ r: 0, g: 0, b: 0, a: 0 }) }) },
      })

      trait['_nextScanTime'] = 0
      trait.tickIdle(actor as any)
      expect(trait['_nextScanTime']).toBe(12)
    })
  })

  describe('_isValidCrushTarget', () => {
    it('rejects self', () => {
      const self = makeMockActor({ actorId: 1 })
      const target = makeMockActor({ actorId: 1 })
      expect(trait['_isValidCrushTarget'](self as any, target as any)).toBe(false)
    })

    it('rejects dead actors', () => {
      const self = makeMockActor({ actorId: 1 })
      const target = makeMockActor({ actorId: 2, isDead: true })
      expect(trait['_isValidCrushTarget'](self as any, target as any)).toBe(false)
    })

    it('rejects actors not in world', () => {
      const self = makeMockActor({ actorId: 1 })
      const target = makeMockActor({ actorId: 2, isInWorld: false })
      expect(trait['_isValidCrushTarget'](self as any, target as any)).toBe(false)
    })

    it('rejects targets without crushables', () => {
      const self = makeMockActor({
        actorId: 1,
        owner: { relationshipWith: () => PlayerRelationship.Enemy },
      })
      const target = makeMockActor({
        actorId: 2,
        owner: {},
        crushables: [],
      })
      expect(trait['_isValidCrushTarget'](self as any, target as any)).toBe(false)
    })

    it('accepts valid crushable target', () => {
      const self = makeMockActor({
        actorId: 1,
        owner: { relationshipWith: () => PlayerRelationship.Enemy },
      })
      const target = makeMockActor({
        actorId: 2,
        owner: {},
        crushables: [{
          crushableBy: (_a: any, _b: any, _c: any) => true,
        }],
        traitsImplementing: (_tag: string) => [],
      })
      const result = trait['_isValidCrushTarget'](self as any, target as any)
      expect(result).toBe(true)
    })

    it('rejects targets with wrong relationship', () => {
      const info2 = new AutoCrusherInfo({
        crushClasses: ['infantry'],
        targetRelationships: PlayerRelationship.Enemy,
      })
      const trait2 = new AutoCrusher(info2)

      const self = makeMockActor({
        actorId: 1,
        owner: { relationshipWith: () => PlayerRelationship.Ally },
      })
      const target = makeMockActor({
        actorId: 2,
        owner: {},
        crushables: [{
          crushableBy: (_a: any, _b: any, _c: any) => true,
        }],
      })
      const result = trait2['_isValidCrushTarget'](self as any, target as any)
      expect(result).toBe(false)
      trait2.dispose()
    })
  })
})
