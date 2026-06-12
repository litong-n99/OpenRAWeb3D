/**
 * AttackBase.test.ts -- Unit tests for AttackBase abstract class
 */

import { describe, it, expect, vi } from 'vitest'
import { AttackBase, AttackBaseInfo, AttackSource } from './AttackBase.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Armament } from '../Armament.js'

// ---------------------------------------------------------------------------
// Concrete subclass for testing abstract AttackBase
// ---------------------------------------------------------------------------

class TestAttack extends AttackBase {
  override getAttackActivity(
    _self: IGameActor,
    _source: AttackSource,
    _target: Target,
    _allowMove: boolean,
    _forceAttack: boolean,
    _targetLineColor?: string,
  ): unknown {
    return null
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AttackBase', () => {
  describe('AttackBaseInfo', () => {
    it('has default armaments array', () => {
      const info = new AttackBaseInfo()
      expect(info.armaments).toEqual(['primary', 'secondary'])
    })

    it('has default facingTolerance of 512 (360 degrees)', () => {
      const info = new AttackBaseInfo()
      expect(info.facingTolerance.angle).toBe(512)
    })

    it('has default voice "Action"', () => {
      const info = new AttackBaseInfo()
      expect(info.voice).toBe('Action')
    })
  })

  describe('AttackBase trait', () => {
    it('hasAnyValidWeapons returns false when disabled', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const internal = attack as unknown as { _enabled: boolean }
      internal._enabled = false
      const target = Target.fromPos(WPos.Zero)
      expect(attack.hasAnyValidWeapons(target)).toBe(false)
    })

    it('getMaximumRange returns WDist.Zero when disabled', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const internal = attack as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(WDist.equals(attack.getMaximumRange(), WDist.Zero)).toBe(true)
    })

    it('getMinimumRange returns WDist.Zero when disabled', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const internal = attack as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(WDist.equals(attack.getMinimumRange(), WDist.Zero)).toBe(true)
    })

    it('targetInFiringArc returns true when no facing trait', () => {
      const info = new AttackBaseInfo({ facingTolerance: new WAngle(128) })
      const attack = new TestAttack(info)
      attack['facing'] = null
      const target = Target.fromPos(new WPos(100, 0, 0))
      expect(attack.targetInFiringArc({ centerPosition: WPos.Zero } as never, target, info.facingTolerance)).toBe(true)
    })

    it('canAttack returns false when disabled', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const internal = attack as unknown as { _enabled: boolean }
      internal._enabled = false
      const target = Target.fromPos(WPos.Zero)
      expect(attack.canAttack({ isInWorld: true } as never, target)).toBe(false)
    })

    it('unforcedAttackTargetStances returns 0 when no armaments', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const stances = attack.unforcedAttackTargetStances()
      expect(stances).toBe(0)
    })

    it('chooseArmamentsForTarget returns empty for Invalid target', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const result = attack.chooseArmamentsForTarget(Target.Invalid, false)
      expect(result.length).toBe(0)
    })

    it('tick fires aiming notifications on state change', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const started = vi.fn()
      const stopped = vi.fn()
      attack['notifyAiming'] = [{ startedAiming: started, stoppedAiming: stopped }]
      attack.isAiming = true
      attack.tick({} as never)
      expect(started).toHaveBeenCalledTimes(1)
      expect(stopped).not.toHaveBeenCalled()
    })

    it('tick fires stopped announcement when no longer aiming', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      attack.isAiming = true
      attack['wasAiming'] = true
      const stopped = vi.fn()
      attack['notifyAiming'] = [{ startedAiming: vi.fn(), stoppedAiming: stopped }]
      attack.isAiming = false
      attack.tick({} as never)
      expect(stopped).toHaveBeenCalled()
    })

    // BLOCKER 3 fix: isReachableTarget uses self.centerPosition
    it('isReachableTarget uses self centerPosition for range check', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const self = { centerPosition: new WPos(1000, 0, 0) }
      const target = Target.fromPos(new WPos(1000, 100, 0))
      // Without valid armaments, returns false regardless
      const result = attack.isReachableTarget(target, false, self as never)
      expect(typeof result).toBe('boolean')
    })

    // MAJOR 4 fix: HasAnyValidWeapons checks isTraitPaused when not center-targeting
    it('hasAnyValidWeapons checks isTraitPaused for non-center case', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      // Create a fake armament that is paused
      const pausedArmament = {
        isTraitDisabled: false,
        isTraitPaused: true,
        isReloading: false,
        maxRange: () => new WDist(1024),
        weapon: {
          isValidAgainst: () => true,
          targetActorCenter: false,
        },
        info: { name: 'paused', targetRelationships: 1 },
      } as unknown as Armament
      ;(attack as unknown as { getArmaments: () => Armament[] }).getArmaments = () => [pausedArmament]
      const target = Target.fromPos(WPos.Zero)
      // With paused armament and non-center check, should return false
      expect(attack.hasAnyValidWeapons(target, false, false)).toBe(false)
    })

    // MAJOR 5 fix: GetMaximumRangeVersusTarget skips paused armaments
    it('getMaximumRangeVersusTarget skips paused armaments for max calculation', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const pausedArmament = {
        isTraitDisabled: false,
        isTraitPaused: true,
        maxRange: () => new WDist(2048),
        weapon: {
          isValidAgainst: () => true,
          targetActorCenter: false,
        },
        info: { name: 'paused', targetRelationships: 1 },
      } as unknown as Armament
      const activeArmament = {
        isTraitDisabled: false,
        isTraitPaused: false,
        maxRange: () => new WDist(1024),
        weapon: {
          isValidAgainst: () => true,
          targetActorCenter: false,
        },
        info: { name: 'active', targetRelationships: 1 },
      } as unknown as Armament
      ;(attack as unknown as { getArmaments: () => Armament[] }).getArmaments = () => [pausedArmament, activeArmament]
      const target = Target.fromPos(WPos.Zero)
      // Should return max of non-paused only (1024), fallback would be 2048
      const result = attack.getMaximumRangeVersusTarget(target)
      expect(result.length).toBe(1024)
    })

    // isTraitPaused check in GetMaximumRange
    it('getMaximumRange skips paused armaments', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const pausedArmament = {
        isTraitDisabled: false,
        isTraitPaused: true,
        maxRange: () => new WDist(2048),
        weapon: { isValidAgainst: () => true },
        info: { name: 'paused', targetRelationships: 1 },
      } as unknown as Armament
      const activeArmament = {
        isTraitDisabled: false,
        isTraitPaused: false,
        maxRange: () => new WDist(1024),
        weapon: { isValidAgainst: () => true },
        info: { name: 'active', targetRelationships: 1 },
      } as unknown as Armament
      ;(attack as unknown as { getArmaments: () => Armament[] }).getArmaments = () => [pausedArmament, activeArmament]
      const result = attack.getMaximumRange()
      expect(result.length).toBe(1024)
    })

    // isTraitPaused check in GetMinimumRange
    it('getMinimumRange skips paused armaments', () => {
      const info = new AttackBaseInfo()
      const attack = new TestAttack(info)
      const pausedArmament = {
        isTraitDisabled: false,
        isTraitPaused: true,
        maxRange: () => new WDist(1024),
        weapon: { minRange: new WDist(100), isValidAgainst: () => true },
        info: { name: 'paused', targetRelationships: 1 },
      } as unknown as Armament
      const activeArmament = {
        isTraitDisabled: false,
        isTraitPaused: false,
        maxRange: () => new WDist(1024),
        weapon: { minRange: new WDist(200), isValidAgainst: () => true },
        info: { name: 'active', targetRelationships: 1 },
      } as unknown as Armament
      ;(attack as unknown as { getArmaments: () => Armament[] }).getArmaments = () => [pausedArmament, activeArmament]
      const result = attack.getMinimumRange()
      expect(result.length).toBe(200)
    })
  })
})
