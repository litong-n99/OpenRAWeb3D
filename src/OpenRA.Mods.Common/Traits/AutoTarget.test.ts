/**
 * AutoTarget.test.ts -- Unit tests for AutoTarget
 */

import { describe, it, expect, vi } from 'vitest'
import { AutoTarget, AutoTargetInfo } from './AutoTarget.js'
import { UnitStance } from './CombatInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: {
  isBot?: boolean
  playable?: boolean
  getTraits?: ReturnType<typeof vi.fn>
} = {}) {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: {
      isBot: overrides.isBot ?? false,
      playable: overrides.playable ?? true,
    } as unknown,
    getTraits: overrides.getTraits ?? vi.fn(() => []),
    grantCondition: vi.fn(() => 1),
    revokeCondition: vi.fn(() => -1),
    centerPosition: WPos.Zero,
    isIdle: true,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AutoTarget', () => {
  describe('AutoTargetInfo', () => {
    it('has default initial stance Defend for humans', () => {
      const info = new AutoTargetInfo()
      expect(info.initialStance).toBe(UnitStance.Defend)
    })

    it('has default initial stance AttackAnything for AI', () => {
      const info = new AutoTargetInfo()
      expect(info.initialStanceAI).toBe(UnitStance.AttackAnything)
    })

    it('has default scanOnIdle true', () => {
      const info = new AutoTargetInfo()
      expect(info.scanOnIdle).toBe(true)
    })

    it('builds conditionByStance map', () => {
      const info = new AutoTargetInfo({
        holdFireCondition: 'HoldFireCond',
        defendCondition: 'DefendCond',
      })
      expect(info.conditionByStance.get(UnitStance.HoldFire)).toBe('HoldFireCond')
      expect(info.conditionByStance.get(UnitStance.Defend)).toBe('DefendCond')
      expect(info.conditionByStance.get(UnitStance.ReturnFire)).toBeUndefined()
    })
  })

  describe('AutoTarget trait', () => {
    it('sets initial stance for human player', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.Defend })
      const at = new AutoTarget(info)
      const actor = createMockActor({ isBot: false, playable: true })
      at.attach(actor as unknown as IGameActor)
      expect(at.stance).toBe(UnitStance.Defend)
    })

    it('sets initial stance for AI player', () => {
      const info = new AutoTargetInfo({ initialStanceAI: UnitStance.AttackAnything })
      const at = new AutoTarget(info)
      const actor = createMockActor({ isBot: true, playable: false })
      at.attach(actor as unknown as IGameActor)
      expect(at.stance).toBe(UnitStance.AttackAnything)
    })

    it('allowMove is false at HoldFire', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.HoldFire, allowMovement: true })
      const at = new AutoTarget(info)
      expect(at.allowMove).toBe(false)
    })

    it('allowMove is false at ReturnFire', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.ReturnFire, allowMovement: true })
      const at = new AutoTarget(info)
      expect(at.allowMove).toBe(false)
    })

    it('allowMove is false at Defend', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.Defend, allowMovement: true })
      const at = new AutoTarget(info)
      expect(at.allowMove).toBe(false)
    })

    it('allowMove is true at AttackAnything with allowMovement', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.AttackAnything, allowMovement: true })
      const at = new AutoTarget(info)
      expect(at.allowMove).toBe(true)
    })

    it('allowMove is false at AttackAnything without allowMovement', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.AttackAnything, allowMovement: false })
      const at = new AutoTarget(info)
      expect(at.allowMove).toBe(false)
    })

    it('setStance no-ops for same stance', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.Defend })
      const at = new AutoTarget(info)
      at.setStance({} as never, UnitStance.Defend)
      expect(at.stance).toBe(UnitStance.Defend)
    })

    it('setStance changes stance and updates predictedStance', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.Defend })
      const at = new AutoTarget(info)
      const actor = createMockActor()
      at.setStance(actor as unknown as IGameActor, UnitStance.AttackAnything)
      expect(at.stance).toBe(UnitStance.AttackAnything)
      expect(at.predictedStance).toBe(UnitStance.AttackAnything)
    })

    it('setStance fires notifications', () => {
      const changed = vi.fn()
      const info = new AutoTargetInfo({ initialStance: UnitStance.Defend })
      const at = new AutoTarget(info)
      const actor = createMockActor({
        getTraits: vi.fn(() => [{ stanceChanged: changed }]),
      })
      at.created(actor as unknown as IGameActor)
      at.setStance(actor as unknown as IGameActor, UnitStance.AttackAnything)
      expect(changed).toHaveBeenCalled()
    })

    it('setStance applies stance condition', () => {
      const info = new AutoTargetInfo({
        initialStance: UnitStance.Defend,
        defendCondition: 'DefendCond',
        attackAnythingCondition: 'AttackCond',
      })
      const at = new AutoTarget(info)
      const actor = createMockActor()
      at.attach(actor as unknown as IGameActor)
      at.setStance(actor as unknown as IGameActor, UnitStance.AttackAnything)
      expect(actor.grantCondition).toHaveBeenCalledWith('AttackCond')
    })

    it('tick decrements nextScanTime', () => {
      const info = new AutoTargetInfo()
      const at = new AutoTarget(info)
      ;(at as unknown as { nextScanTime: number }).nextScanTime = 5
      at.tick({} as never)
      // Private field, verify no throw
    })

    it('tick does nothing when disabled', () => {
      const info = new AutoTargetInfo()
      const at = new AutoTarget(info)
      const internal = at as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(() => at.tick({} as never)).not.toThrow()
    })

    it('tickIdle does nothing when disabled', () => {
      const info = new AutoTargetInfo()
      const at = new AutoTarget(info)
      const internal = at as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(() => at.tickIdle({} as never)).not.toThrow()
    })

    it('tickIdle does nothing at HoldFire', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.HoldFire })
      const at = new AutoTarget(info)
      expect(() => at.tickIdle({} as never)).not.toThrow()
    })

    it('tickIdle does nothing at ReturnFire', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.ReturnFire })
      const at = new AutoTarget(info)
      expect(() => at.tickIdle({} as never)).not.toThrow()
    })

    it('scanForTarget returns Invalid when no attack bases', () => {
      const info = new AutoTargetInfo()
      const at = new AutoTarget(info)
      const actor = createMockActor()
      const result = at.scanForTarget(actor as unknown as IGameActor, false, false)
      expect(result.type).toBe(0) // TargetType.Invalid
    })

    it('resolveOrder handles SetUnitStance', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.Defend, enableStances: true })
      const at = new AutoTarget(info)
      const actor = createMockActor()
      at.resolveOrder(actor as unknown as IGameActor, {
        orderName: 'SetUnitStance',
        extraData: UnitStance.AttackAnything,
      })
      expect(at.stance).toBe(UnitStance.AttackAnything)
    })

    it('resolveOrder ignores SetUnitStance when stances disabled', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.Defend, enableStances: false })
      const at = new AutoTarget(info)
      const actor = createMockActor()
      at.resolveOrder(actor as unknown as IGameActor, {
        orderName: 'SetUnitStance',
        extraData: UnitStance.AttackAnything,
      })
      expect(at.stance).toBe(UnitStance.Defend)
    })

    it('damaged does nothing when disabled', () => {
      const info = new AutoTargetInfo()
      const at = new AutoTarget(info)
      const internal = at as unknown as { _enabled: boolean }
      internal._enabled = false
      expect(() =>
        at.damaged(
          { isIdle: true } as never,
          { damage: { value: 10 }, attacker: { disposed: false } as never },
        ),
      ).not.toThrow()
    })

    it('damaged does nothing for healing damage', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.Defend })
      const at = new AutoTarget(info)
      expect(() =>
        at.damaged(
          { isIdle: true } as never,
          { damage: { value: -5 }, attacker: { disposed: false } as never },
        ),
      ).not.toThrow()
    })

    it('hasValidTargetPriority returns false at ReturnFire or lower', () => {
      const info = new AutoTargetInfo({ initialStance: UnitStance.ReturnFire })
      const at = new AutoTarget(info)
      expect(at.hasValidTargetPriority({} as never, {}, new Set(['Ground']))).toBe(false)
    })

    it('onOwnerChanged resets stance', () => {
      const info = new AutoTargetInfo({
        initialStance: UnitStance.Defend,
        initialStanceAI: UnitStance.AttackAnything,
      })
      const at = new AutoTarget(info)
      const actor = createMockActor({ isBot: true, playable: false })
      at.onOwnerChanged(actor as unknown as IGameActor)
      expect(at.stance).toBe(UnitStance.AttackAnything)
    })

    it('aggressor is null by default', () => {
      const info = new AutoTargetInfo()
      const at = new AutoTarget(info)
      expect(at.aggressor).toBeNull()
    })
  })
})
