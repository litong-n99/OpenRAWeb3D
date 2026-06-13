/**
 * Crushable.test.ts -- Crushable migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed.
 * Tests focus on: config defaults, crushableBy checks, player mask computation,
 * warn/crush callbacks, and trait enable/disable behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BitSet } from '../../OpenRA.Game/Primitives/BitSet.js'
import { LongBitSet } from '../../OpenRA.Game/Primitives/LongBitSet.js'
import {
  Crushable,
  CrushableInfo,
} from './Crushable.js'
import {
  CRUSH_CLASS_TYPENAME,
  type CrushClass,
} from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrushClasses(names: string[]): BitSet<CrushClass> {
  return new BitSet<CrushClass>(CRUSH_CLASS_TYPENAME, ...names)
}

function makePlayerMask(names: string[]): LongBitSet<{ _pm: true }> {
  return new LongBitSet<{ _pm: true }>('PlayerBitMask', ...names)
}

function makeActor(overrides: Record<string, unknown> = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrushableInfo', () => {
  beforeEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
  })

  afterEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
  })

  it('has default crushClasses containing infantry', () => {
    const info = new CrushableInfo()
    expect(info.crushClasses.contains('infantry')).toBe(true)
  })

  it('has default warnProbability of 75', () => {
    const info = new CrushableInfo()
    expect(info.warnProbability).toBe(75)
  })

  it('has default crushedByFriendlies as false', () => {
    const info = new CrushableInfo()
    expect(info.crushedByFriendlies).toBe(false)
  })

  it('has null crushSound by default', () => {
    const info = new CrushableInfo()
    expect(info.crushSound).toBeNull()
  })

  it('accepts custom crushClasses', () => {
    const info = new CrushableInfo({ crushClasses: ['vehicle', 'crusher'] })
    expect(info.crushClasses.contains('vehicle')).toBe(true)
    expect(info.crushClasses.contains('crusher')).toBe(true)
    expect(info.crushClasses.contains('infantry')).toBe(false)
  })

  it('accepts custom warnProbability', () => {
    const info = new CrushableInfo({ warnProbability: 50 })
    expect(info.warnProbability).toBe(50)
  })

  it('accepts crushedByFriendlies true', () => {
    const info = new CrushableInfo({ crushedByFriendlies: true })
    expect(info.crushedByFriendlies).toBe(true)
  })

  it('accepts custom crushSound', () => {
    const info = new CrushableInfo({ crushSound: 'squelch.aud' })
    expect(info.crushSound).toBe('squelch.aud')
  })
})

describe('Crushable', () => {
  let info: CrushableInfo
  let trait: Crushable
  let mockActor: ReturnType<typeof makeActor>

  beforeEach(() => {
    BitSet.reset(CRUSH_CLASS_TYPENAME)
    LongBitSet.reset('PlayerBitMask')
    info = new CrushableInfo({ crushClasses: ['infantry'] })
    trait = new Crushable(info)
    mockActor = makeActor()
    trait.attach(mockActor as any)
  })

  afterEach(() => {
    trait.dispose()
    BitSet.reset(CRUSH_CLASS_TYPENAME)
    LongBitSet.reset('PlayerBitMask')
  })

  it('starts enabled (not disabled)', () => {
    expect(trait.isTraitDisabled).toBe(false)
  })

  describe('crushableBy', () => {
    it('returns true when crusher can crush', () => {
      mockActor = makeActor({ owner: { isAlliedWith: () => false } })
      trait.attach(mockActor as any)
      const crusher = makeActor({ owner: { isAlliedWith: () => false } })
      const cc = makeCrushClasses(['infantry'])

      const result = trait.crushableBy(mockActor as any, crusher as any, cc as any)
      expect(result).toBe(true)
    })

    it('returns false when trait is disabled', () => {
      trait['_enabled'] = false
      mockActor = makeActor({ owner: { isAlliedWith: () => false } })
      trait.attach(mockActor as any)
      const crusher = makeActor({ owner: { isAlliedWith: () => false } })
      const cc = makeCrushClasses(['infantry'])

      const result = trait.crushableBy(mockActor as any, crusher as any, cc as any)
      expect(result).toBe(false)

      trait['_enabled'] = true
    })

    it('returns false when crusher is allied and crushedByFriendlies is false', () => {
      const info2 = new CrushableInfo({ crushClasses: ['infantry'], crushedByFriendlies: false })
      const trait2 = new Crushable(info2)
      const actor2 = makeActor({ owner: { isAlliedWith: () => true } })
      trait2.attach(actor2 as any)

      const crusher = makeActor({ owner: { isAlliedWith: () => true } })
      const cc = makeCrushClasses(['infantry'])

      const result = trait2.crushableBy(actor2 as any, crusher as any, cc as any)
      expect(result).toBe(false)
      trait2.dispose()
    })

    it('returns true when crusher is allied and crushedByFriendlies is true', () => {
      const info2 = new CrushableInfo({ crushClasses: ['infantry'], crushedByFriendlies: true })
      const trait2 = new Crushable(info2)
      const actor2 = makeActor({ owner: { isAlliedWith: () => true } })
      trait2.attach(actor2 as any)

      const crusher = makeActor({ owner: { isAlliedWith: () => true } })
      const cc = makeCrushClasses(['infantry'])

      const result = trait2.crushableBy(actor2 as any, crusher as any, cc as any)
      expect(result).toBe(true)
      trait2.dispose()
    })
  })

  describe('crushableByPlayerMask', () => {
    it('returns allPlayersMask for crushedByFriendlies', () => {
      const info2 = new CrushableInfo({ crushClasses: ['vehicle'], crushedByFriendlies: true })
      const trait2 = new Crushable(info2)

      const allPlayersMask = makePlayerMask(['P0', 'P1', 'P2'])
      const actor2 = makeActor({
        owner: {
          alliedPlayersMask: makePlayerMask(['P0']),
        },
        world: {
          allPlayersMask: allPlayersMask,
          noPlayersMask: makePlayerMask([]),
        },
      })
      trait2.attach(actor2 as any)
      const cc = makeCrushClasses(['vehicle'])

      const result = trait2.crushableByPlayerMask(actor2 as any, cc as any) as any
      // allPlayerMask is the actual LongBitSet behind the scenes
      expect(result.isEmpty).toBe(false)
      trait2.dispose()
    })

    it('returns empty mask when trait is disabled', () => {
      trait['_enabled'] = false

      const noPlayersMask = makePlayerMask([])
      const actor2 = makeActor({
        world: {
          allPlayersMask: makePlayerMask(['P0']),
          noPlayersMask: noPlayersMask,
        },
      })
      trait.attach(actor2 as any)
      const cc = makeCrushClasses(['infantry'])

      const result = trait.crushableByPlayerMask(actor2 as any, cc as any) as any
      expect(result.isEmpty).toBe(true)

      trait['_enabled'] = true
    })
  })

  describe('onCrush', () => {
    it('calls kill on actor when crushed', () => {
      let killCalled = false
      let killAttacker: any = null

      const actor2 = makeActor({
        owner: { isAlliedWith: () => false },
        kill: (attacker: any, _dmgTypes: any) => {
          killCalled = true
          killAttacker = attacker
        },
      })
      trait.attach(actor2 as any)
      const crusher = makeActor({
        actorId: 42,
        owner: { isAlliedWith: () => false },
        traitOrDefault: () => null,
      })
      const cc = makeCrushClasses(['infantry'])

      trait.onCrush(actor2 as any, crusher as any, cc as any)
      expect(killCalled).toBe(true)
      expect(killAttacker.actorId).toBe(42)
    })

    it('does not call kill when not crushable', () => {
      let killCalled = false

      const actor2 = makeActor({
        owner: { isAlliedWith: () => false },
        kill: () => { killCalled = true },
      })
      trait.attach(actor2 as any)
      const crusher = makeActor({
        owner: { isAlliedWith: () => false },
        traitOrDefault: () => null,
      })
      const cc = makeCrushClasses(['vehicle']) // Different from 'infantry'

      trait.onCrush(actor2 as any, crusher as any, cc as any)
      expect(killCalled).toBe(false)
    })
  })
})
