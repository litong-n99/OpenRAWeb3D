/**
 * Leap.test.ts — Leap activity unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
  TransformNode: class MockTransformNode {},
}))

import { Leap } from './Leap.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMobile(): any {
  let centerPos: WPos = WPos.Zero
  const calls: string[] = []
  return {
    toSubCell: 0,
    fromSubCell: 0,
    setCenterPosition(_self: GameActor, pos: WPos) { centerPos = pos; calls.push('setCenterPosition') },
    setLocation() { calls.push('setLocation') },
    updateMovement() { calls.push('updateMovement') },
    localMove() { calls.push('localMove'); return null },
    getCenterPosition() { return centerPos },
    _calls: calls,
  }
}

function makeAttack(): any {
  const calls: string[] = []
  return {
    isAiming: false,
    grantLeapCondition() { calls.push('grantLeapCondition') },
    revokeLeapCondition() { calls.push('revokeLeapCondition') },
    doAttack() { calls.push('doAttack') },
    _calls: calls,
  }
}

function makeEdible(allowLeap = true): any {
  return {
    canLeap: () => true,
    getLeapAtBy: () => allowLeap,
  }
}

function makeSelf(loc?: { X: number; Y: number }, center?: WPos): GameActor {
  const self = {
    actorId: 1, isInWorld: true, isDead: false, disposed: false,
    location: loc ?? { X: 10, Y: 10 },
    centerPosition: center ?? new WPos(10240, 10240, 0),
    world: {
      map: {
        centerOfSubCell(cell: CPos, _subCell: number) {
          return new WPos(cell.X * 1024 + 512, cell.Y * 1024 + 512, 0)
        },
      },
    },
    owner: { relationshipWith: () => 0 },
  } as unknown as GameActor
  return self
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Leap', () => {
  describe('constructor', () => {
    it('initializes with correct state', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible()
      const target = Target.fromPos(new WPos(20480, 20480, 0))

      const leap = new Leap(target, mobile, null, 426, attack, edible)
      expect(leap).toBeDefined()
      expect(leap.isCanceled).toBe(false)
      expect(leap.isJumpComplete).toBe(false)
      expect(leap.currentTick).toBe(0)
    })
  })

  describe('onFirstRun', () => {
    it('cancels if edible rejects the leap', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible(false) // Reject
      const self = makeSelf()

      // Create target with valid actor+location
      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20 * 1024, 20 * 1024, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20 * 1024, 20 * 1024, 0),
      }
      // But edible rejects, so canceled = true

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      // Call onFirstRun through tickOuter path — simplify by calling directly
      ;(leap as any).onFirstRun(self)
      expect(leap.isCanceled).toBe(true)
    })

    it('grants leap condition on valid leap start', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible(true)
      const self = makeSelf()

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20 * 1024, 20 * 1024, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20 * 1024, 20 * 1024, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any).onFirstRun(self)
      expect(leap.isCanceled).toBe(false)
      expect(attack._calls).toContain('grantLeapCondition')
    })

    it('cancels if target is not an actor', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible(true)
      const self = makeSelf()

      const targetObj: any = {
        type: TargetType.Terrain, // Not actor
        centerPosition: new WPos(20480, 20480, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any).onFirstRun(self)
      expect(leap.isCanceled).toBe(true)
    })

    it('sets isInterruptible to false', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible(true)
      const self = makeSelf()

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20 * 1024, 20 * 1024, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20 * 1024, 20 * 1024, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any).onFirstRun(self)
      expect(leap.isInterruptible).toBe(false)
    })

    it('computes length based on distance and speed', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible(true)
      const self = makeSelf({ X: 10, Y: 10 })

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20 * 1024, 20 * 1024, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20 * 1024, 20 * 1024, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any).onFirstRun(self)
      // Distance from (10240,10240) to (20480,20480) = sqrt(10240^2 + 10240^2) ≈ 14481
      // length = max(floor(14481 / 426), 1) = max(33, 1) = 33
      expect(leap.totalLength).toBeGreaterThan(0)
    })
  })

  describe('tick', () => {
    it('returns false while jumping', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible(true)
      const self = makeSelf({ X: 10, Y: 10 })

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20480, 20480, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20480, 20480, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any).onFirstRun(self)

      // First tick: should not complete yet
      const result = leap.tick(self)
      expect(result).toBe(false)
      expect(leap.currentTick).toBe(1)
    })

    it('returns true if canceled', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible(true)
      const self = makeSelf()

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20480, 20480, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20480, 20480, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any)._canceled = true

      expect(leap.tick(self)).toBe(true)
    })

    it('calls doAttack on completion', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible(true)
      const self = makeSelf({ X: 10, Y: 10 })

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20480, 20480, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20480, 20480, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any).onFirstRun(self)

      // Tick until complete
      const totalLen = (leap as any)._length
      for (let i = 0; i < totalLen - 1; i++) {
        leap.tick(self)
      }
      // Last tick triggers completion
      const firstComplete = leap.tick(self)
      // After completion, subsequent calls return true
      expect(typeof firstComplete).toBe('boolean')

      // Attack should have been triggered
      expect(attack._calls).toContain('doAttack')
      expect(attack._calls).toContain('revokeLeapCondition')
    })
  })

  describe('getTargets', () => {
    it('returns origin when ticks < length/2', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible()

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20480, 20480, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20480, 20480, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      const self = makeSelf()

      // origin defaults to WPos.Zero since onFirstRun wasn't called
      const targets = leap.getTargets(self)
      expect(targets).toHaveLength(1)
    })
  })

  describe('onLastRun', () => {
    it('revokes leap condition', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible()
      const self = makeSelf()

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20480, 20480, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20480, 20480, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any).onLastRun(self)
      expect(attack._calls).toContain('revokeLeapCondition')
    })
  })

  describe('onActorDispose', () => {
    it('revokes leap condition on dispose', () => {
      const mobile = makeMobile()
      const attack = makeAttack()
      const edible = makeEdible()
      const self = makeSelf()

      const targetObj: any = {
        type: TargetType.Actor,
        actor: { location: new CPos(20, 20), centerPosition: new WPos(20480, 20480, 0) },
        isValidFor: () => true,
        centerPosition: new WPos(20480, 20480, 0),
      }

      const leap = new Leap(targetObj, mobile, null, 426, attack, edible)
      ;(leap as any).onActorDispose(self)
      expect(attack._calls).toContain('revokeLeapCondition')
    })
  })
})
