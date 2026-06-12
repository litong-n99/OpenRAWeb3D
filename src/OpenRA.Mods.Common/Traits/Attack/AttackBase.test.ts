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
  })
})
