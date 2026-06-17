/**
 * GrantConditionOnJumpjetLayer.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import {
  GrantConditionOnJumpjetLayer,
  GrantConditionOnJumpjetLayerInfo,
} from './GrantConditionOnJumpjetLayer.js'

describe('GrantConditionOnJumpjetLayer', () => {
  it('should create with given condition', () => {
    const info = new GrantConditionOnJumpjetLayerInfo({ condition: 'jumpjetAir' })
    expect(info.condition).toBe('jumpjetAir')
  })

  it('should start with no condition granted', () => {
    const trait = new GrantConditionOnJumpjetLayer(new GrantConditionOnJumpjetLayerInfo())
    expect(trait.jumpjetInAir).toBe(false)
    expect(trait.conditionToken).toBe(-1)
  })

  it('should have Jumpjet layer type as validLayerType', () => {
    const trait = new GrantConditionOnJumpjetLayer(new GrantConditionOnJumpjetLayerInfo())
    expect(trait.validLayerType).toBe(1)
  })

  it('should handle finishedMoving when not in air', () => {
    const trait = new GrantConditionOnJumpjetLayer(new GrantConditionOnJumpjetLayerInfo())
    const actor = {
      grantCondition: () => 42,
    } as any
    // Enter jumpjet layer: oldLayer=0, newLayer=1
    ;(trait as any)._updateConditions(actor, 0, 1)
    expect(trait.jumpjetInAir).toBe(true)
    expect(trait.conditionToken).toBe(42)
  })

  it('should handle finishedMoving when leaving jumpjet layer', () => {
    const trait = new GrantConditionOnJumpjetLayer(new GrantConditionOnJumpjetLayerInfo())
    const revokeCalled: number[] = []
    const actor = {
      grantCondition: () => 42,
      revokeCondition: (t: number) => revokeCalled.push(t),
    } as any
    // Enter
    ;(trait as any)._updateConditions(actor, 0, 1)
    expect(trait.jumpjetInAir).toBe(true)
    // Leave: both old and new are 0 (not jumpjet)
    ;(trait as any)._updateConditions(actor, 0, 0)
    expect(trait.jumpjetInAir).toBe(false)
    expect(revokeCalled).toEqual([42])
  })

  it('should throw on invalid Mobile configuration', () => {
    const info = new GrantConditionOnJumpjetLayerInfo()
    expect(() => info.validate(null, null)).toThrow('JumpjetLocomotor')
  })
})
