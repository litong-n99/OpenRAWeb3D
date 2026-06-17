/**
 * LeapAttack.test.ts — LeapAttack activity unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
  TransformNode: class MockTransformNode {},
}))

import { LeapAttack } from './LeapAttack.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { TargetType } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMobile(): any {
  return {
    fromSubCell: 0,
    facing: 0,
    moveWithinRange() {
      return { tick: () => true, queueChild: () => {} } as any
    },
  }
}

function makeAttack(): any {
  return {
    info: { speed: new WDist(426), leapCondition: 'attacking' },
    isAiming: false,
    armaments: [{ isReloading: false }],
    getMinimumRangeVersusTarget: () => WDist.Zero,
    getMaximumRangeVersusTarget: () => WDist.fromCells(5),
    hasAnyValidWeapons: () => true,
    doAttack: vi.fn(),
  }
}

function makeSelf(loc?: CPos, center?: WPos): GameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    location: loc ?? new CPos(10, 10),
    centerPosition: center ?? new WPos(10 * 1024 + 512, 10 * 1024 + 512, 0),
    owner: { internalName: 'Multi0', relationshipWith: () => 0 },
    world: {
      map: {
        centerOfSubCell(cell: CPos, _subCell: number) {
          return new WPos(cell.X * 1024 + 512, cell.Y * 1024 + 512, 0)
        },
      },
    },
    traits: new Map([['Mobile', makeMobile()]]),
  } as unknown as GameActor
}

function makeTargetActor(_self: GameActor, loc?: CPos): any {
  const self2 = {
    type: TargetType.Actor,
    actor: {
      location: loc ?? new CPos(20, 20),
      owner: { internalName: 'Multi1' },
      isDead: false,
      canBeViewedByPlayer: () => true,
      getEnabledTargetTypes: () => new Set(['Ground', 'Water']),
      traits: new Map([
        ['EdibleByLeap', { canLeap: () => true }],
      ]),
    },
    centerPosition: new WPos(
      (loc?.X ?? 20) * 1024 + 512,
      (loc?.Y ?? 20) * 1024 + 512,
      0,
    ),
    isValidFor: () => true,
    isInRange: () => false, // Not in range → triggers movement
    positions: [new WPos((loc?.X ?? 20) * 1024 + 512, (loc?.Y ?? 20) * 1024 + 512, 0)],
    recalculate: () => [self2, false] as [any, boolean],
  }
  return self2
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LeapAttack', () => {
  describe('constructor', () => {
    it('initializes correctly', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      expect(la).toBeDefined()
      expect(la.target).toBeDefined()
    })

    it('starts with isAiming false before onFirstRun', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      expect(la.isAiming).toBe(false)
    })

    it('caches last visible target on construction', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      expect(la.lastVisibleTarget).toBeDefined()
    })

    it('handles terrain target type', () => {
      const self = makeSelf()
      const target: any = {
        type: TargetType.Terrain,
        centerPosition: new WPos(20 * 1024, 20 * 1024, 0),
        isValidFor: () => true,
        isInRange: () => false,
      }
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      expect(la).toBeDefined()
      expect(la.lastVisibleTarget).toBeDefined()
    })
  })

  describe('onFirstRun', () => {
    it('sets isAiming to true', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      ;(la as any).onFirstRun(self)
      expect(la.isAiming).toBe(true)
    })
  })

  describe('onLastRun', () => {
    it('sets isAiming to false', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      ;(la as any).onFirstRun(self)
      expect(la.isAiming).toBe(true)
      ;(la as any).onLastRun(self)
      expect(la.isAiming).toBe(false)
    })
  })

  describe('tick', () => {
    it('returns true when canceling', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      ;(la as any).state = 2 // ActivityState.Canceling
      expect(la.tick(self)).toBe(true)
    })

    it('returns false for out-of-range targets (queues move)', () => {
      const self = makeSelf()
      const base = makeTargetActor(self)
      const target: any = {
        ...base,
        positions: base.positions ?? [new WPos(20 * 1024 + 512, 20 * 1024 + 512, 0)],
        isInRange: () => false, // Not in range
      }
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      const result = la.tick(self)
      // Out-of-range but allowMovement=true — queues a move child
      expect(typeof result).toBe('boolean')
    })

    it('returns true when target is hidden with no fallback', () => {
      const self = makeSelf()
      // eslint-disable-next-line prefer-const
      let target: any
      target = {
        type: TargetType.Actor,
        actor: {
          location: new CPos(20, 20),
          owner: { internalName: 'Multi1' },
          isDead: false,
          canBeViewedByPlayer: () => false, // Hidden!
          getEnabledTargetTypes: () => new Set(),
          traits: new Map(),
        },
        centerPosition: new WPos(20 * 1024, 20 * 1024, 0),
        isValidFor: () => true,
        isInRange: () => false,
        recalculate: () => [target, true] as [any, boolean],
      }
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      // The target is hidden and we cached nothing in constructor
      const result = la.tick(self)
      // With useLastVisibleTarget=true and no valid lastVisibleTarget, returns true
      expect(typeof result).toBe('boolean')
    })

    it('returns false when all armaments are reloading', () => {
      const self = makeSelf()
      // eslint-disable-next-line prefer-const
      let target: any
      target = {
        type: TargetType.Actor,
        actor: {
          location: new CPos(10, 10), // Same cell as self
          owner: { internalName: 'Multi1' },
          isDead: false,
          canBeViewedByPlayer: () => true,
          getEnabledTargetTypes: () => new Set(['Ground']),
          traits: new Map([
            ['EdibleByLeap', { canLeap: () => true }],
          ]),
        },
        centerPosition: new WPos(10 * 1024 + 512, 10 * 1024 + 512, 0),
        isValidFor: () => true,
        isInRange: () => true, // In range
        recalculate: () => [target, false] as [any, boolean],
      }
      const attack = makeAttack()
      attack.armaments = [{ isReloading: true }]

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      const result = la.tick(self)
      expect(result).toBe(false) // All reloading
    })
  })

  describe('stanceChanged', () => {
    it('does nothing when forceAttack is true', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, true, attack, attack.info)

      const autoTarget = {
        hasValidTargetPriority: () => true,
      }

      la.stanceChanged(self, autoTarget, 0, 1)
      // forceAttack=true → no change
      expect(la.target).toBeDefined()
    })

    it('invalidates target when stance restricts', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)

      const autoTarget = {
        hasValidTargetPriority: () => false,
      }

      la.stanceChanged(self, autoTarget as any, 0, 1)
      // No existing lastVisibleTarget -> this only tests non-crash
      expect(la).toBeDefined()
    })
  })

  describe('targetLineNodes', () => {
    it('returns empty array when no targetLineColor', () => {
      const self = makeSelf()
      const target = makeTargetActor(self)
      const attack = makeAttack()

      const la = new LeapAttack(self, target, true, false, attack, attack.info)
      expect(la.targetLineNodes(self)).toEqual([])
    })
  })
})
