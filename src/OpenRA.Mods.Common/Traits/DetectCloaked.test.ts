/**
 * DetectCloaked.test.ts — DetectCloaked trait unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed here.
 * The DetectCloaked trait does not depend on Babylon.js directly.
 *
 * Tests focus on:
 * - DetectCloakedInfo defaults (detectionTypes = [{name: 'Cloak'}], range = WDist.fromCells(5))
 * - DetectCloaked range returns info.range when enabled
 * - DetectCloaked range returns WDist.Zero when disabled
 * - created() collects IDetectCloakedModifier traits
 * - range applies percentage modifiers via applyPercentageModifiers
 * - Edge cases (empty modifiers, null traitsImplementing)
 * - Dispose cleanup
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DetectCloaked, DetectCloakedInfo } from './DetectCloaked.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import {
  type IGameActor,
  type IDetectCloakedModifier,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test subclass — exposes isTraitDisabled override for test control
// ---------------------------------------------------------------------------

/** Test helper: allows controlling the disabled state for range getter tests. */
class TestDetectCloaked extends DetectCloaked {
  private _testDisabled: boolean = false

  /** Override to allow test-controlled disabled state. */
  override get isTraitDisabled(): boolean {
    return this._testDisabled
  }

  /** Set the disabled state for testing. */
  setDisabled(disabled: boolean): void {
    this._testDisabled = disabled
  }

  /** Expose _rangeModifiers for assertion. */
  get rangeModifiers(): readonly number[] {
    return this['_rangeModifiers'] as readonly number[]
  }
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockActor(
  modifiers?: IDetectCloakedModifier[],
): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traitsImplementing: (_interfaceId: string) => {
      if (_interfaceId === 'IDetectCloakedModifier') {
        return modifiers ?? []
      }
      return []
    },
  } as unknown as IGameActor
}

function createMockModifier(value: number): IDetectCloakedModifier {
  return {
    getDetectCloakedModifier: () => value,
  }
}

// ---------------------------------------------------------------------------
// Test: DetectCloakedInfo defaults
// ---------------------------------------------------------------------------

describe('DetectCloakedInfo', () => {
  it('default detectionTypes is [{name: "Cloak"}]', () => {
    const info = new DetectCloakedInfo()
    expect(info.detectionTypes).toEqual([{ name: 'Cloak' }])
  })

  it('default range is WDist.fromCells(5)', () => {
    const info = new DetectCloakedInfo()
    expect(info.range.length).toBe(WDist.fromCells(5).length)
    // 5 cells * 1024 = 5120
    expect(info.range.length).toBe(5120)
  })

  it('accepts custom detectionTypes', () => {
    const customTypes = [{ name: 'Subterranean' }]
    const info = new DetectCloakedInfo({ detectionTypes: customTypes })
    expect(info.detectionTypes).toEqual(customTypes)
  })

  it('accepts custom range', () => {
    const customRange = WDist.fromCells(10)
    const info = new DetectCloakedInfo({ range: customRange })
    expect(info.range.length).toBe(10240)
  })

  it('accepts instanceName and requiresCondition (ConditionalTraitInfo)', () => {
    const info = new DetectCloakedInfo({
      instanceName: 'detector',
      requiresCondition: 'powered',
    })
    expect(info.instanceName).toBe('detector')
    expect(info.requiresCondition).toBe('powered')
  })

  it('default instanceName is undefined', () => {
    const info = new DetectCloakedInfo()
    expect(info.instanceName).toBeUndefined()
  })

  it('default requiresCondition is undefined', () => {
    const info = new DetectCloakedInfo()
    expect(info.requiresCondition).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Test: DetectCloaked
// ---------------------------------------------------------------------------

describe('DetectCloaked', () => {
  let trait: TestDetectCloaked
  let info: DetectCloakedInfo

  beforeEach(() => {
    info = new DetectCloakedInfo()
    trait = new TestDetectCloaked(info)
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it('constructs with info reference', () => {
    expect(trait.info).toBe(info)
  })

  it('is not disabled by default', () => {
    // TestDetectCloaked overrides isTraitDisabled to return _testDisabled (false)
    expect(trait.isTraitDisabled).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Range getter — enabled
  // -----------------------------------------------------------------------

  it('range returns info.range when enabled and no modifiers', () => {
    trait.setDisabled(false)
    expect(trait.range.length).toBe(info.range.length)
  })

  it('range returns WDist.Zero when disabled', () => {
    trait.setDisabled(true)
    expect(trait.range.length).toBe(0)
    // Verifying structural equality with WDist.Zero
    const range = trait.range
    expect(range.length).toBe(WDist.Zero.length)
    // It is a distinct WDist instance but equal to Zero
    expect(WDist.equals(range, WDist.Zero)).toBe(true)
  })

  it('range returns non-zero when re-enabled', () => {
    trait.setDisabled(true)
    expect(trait.range.length).toBe(0)

    trait.setDisabled(false)
    expect(trait.range.length).toBe(info.range.length)
  })

  // -----------------------------------------------------------------------
  // static interfaces
  // -----------------------------------------------------------------------

  it('static interfaces includes IDetectCloaked and other keys', () => {
    expect(DetectCloaked.interfaces).toContain('IDetectCloaked')
    expect(DetectCloaked.interfaces).toContain('INotifyCreated')
    expect(DetectCloaked.interfaces).toContain('DetectCloaked')
    expect(DetectCloaked.interfaces).toContain('ConditionalTrait')
    expect(DetectCloaked.interfaces).toContain('component')
  })

  // -----------------------------------------------------------------------
  // created() collects IDetectCloakedModifier traits
  // -----------------------------------------------------------------------

  it('created() collects IDetectCloakedModifier traits', () => {
    const modifier1 = createMockModifier(100)
    const modifier2 = createMockModifier(150)
    const actor = createMockActor([modifier1, modifier2])

    trait.created(actor)

    expect(trait.rangeModifiers).toEqual([100, 150])
  })

  it('created() handles empty modifiers array', () => {
    const actor = createMockActor([])

    trait.created(actor)

    expect(trait.rangeModifiers).toEqual([])
  })

  it('created() handles actor without traitsImplementing', () => {
    const actor = {
      actorId: 2,
      isInWorld: false,
      isDead: false,
      disposed: false,
      // No traitsImplementing
    } as unknown as IGameActor

    trait.created(actor)

    expect(trait.rangeModifiers).toEqual([])
  })

  // -----------------------------------------------------------------------
  // Range with modifiers
  // -----------------------------------------------------------------------

  it('range applies percentage modifiers', () => {
    // Set up modifiers: 150% and 200%
    trait.setDisabled(false)
    const actor = createMockActor([
      createMockModifier(150),
      createMockModifier(200),
    ])
    trait.created(actor)

    // Expected: 5120 * 150/100 = 7680, then 7680 * 200/100 = 15360
    const expected = Math.trunc((Math.trunc((5120 * 150) / 100) * 200) / 100)
    // 5120 * 150/100 = 7680. 7680 * 200/100 = 15360
    expect(trait.range.length).toBe(expected)
  })

  it('range with single modifier at 100% returns same range', () => {
    trait.setDisabled(false)
    const actor = createMockActor([createMockModifier(100)])
    trait.created(actor)

    expect(trait.range.length).toBe(info.range.length)
  })

  it('range with single modifier at 50% halves the range', () => {
    trait.setDisabled(false)
    const actor = createMockActor([createMockModifier(50)])
    trait.created(actor)

    // 5120 * 50/100 = 2560
    expect(trait.range.length).toBe(2560)
  })

  it('range with modifier at 0% returns zero', () => {
    trait.setDisabled(false)
    const actor = createMockActor([createMockModifier(0)])
    trait.created(actor)

    expect(trait.range.length).toBe(0)
  })

  it('range is always WDist.Zero when disabled regardless of modifiers', () => {
    trait.setDisabled(true)
    const actor = createMockActor([createMockModifier(200)])
    trait.created(actor)

    expect(trait.range.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  it('dispose clears range modifiers', () => {
    const actor = createMockActor([createMockModifier(150)])
    trait.created(actor)
    expect(trait.rangeModifiers.length).toBe(1)

    trait.dispose()

    expect(trait.rangeModifiers).toEqual([])
    expect(trait.disposed).toBe(true)
  })

  it('dispose is safe to call multiple times', () => {
    trait.dispose()
    trait.dispose()
    expect(trait.disposed).toBe(true)
    expect(trait.rangeModifiers).toEqual([])
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('created() using custom range from info', () => {
    const customInfo = new DetectCloakedInfo({ range: WDist.fromCells(3) })
    const customTrait = new TestDetectCloaked(customInfo)
    customTrait.setDisabled(false)

    const actor = createMockActor([createMockModifier(200)])
    customTrait.created(actor)

    // 3 * 1024 = 3072, * 200/100 = 6144
    expect(customTrait.range.length).toBe(6144)
  })

  it('created() with custom detectionTypes', () => {
    const customTypes = [{ name: 'Subterranean' }, { name: 'Cloak' }]
    const customInfo = new DetectCloakedInfo({ detectionTypes: customTypes })
    expect(customInfo.detectionTypes).toEqual(customTypes)
    expect(customInfo.detectionTypes.length).toBe(2)
  })
})
