/**
 * BaseProvider.test.ts — BaseProvider migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: BaseProviderInfo configuration, default values, cooldown
 * mechanics (beginCooldown, ready, tick), ISelectionBar implementation,
 * range circle renderables, ConditionalTrait enable/disable behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { WDist } from '../../../OpenRA.Game/WDist.js'
import {
  BaseProviderInfo,
  BaseProvider,
} from './BaseProvider.js'
import { MapBuildRadiusInfo, MapBuildRadius } from '../World/MapBuildRadius.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 3000

function makeActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: nextId++,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// BaseProviderInfo
// ---------------------------------------------------------------------------

describe('BaseProviderInfo', () => {
  it('has correct default values', () => {
    const info = new BaseProviderInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.requiresCondition).toBeUndefined()
    expect(info.range).toEqual(WDist.fromCells(10))
    expect(info.range.length).toBe(10240)
    expect(info.cooldown).toBe(0)
    expect(info.initialDelay).toBe(0)
    expect(info.circleReadyColor).toEqual({ r: 255, g: 255, b: 255, a: 128 })
    expect(info.circleBlockedColor).toEqual({ r: 255, g: 0, b: 0, a: 128 })
    expect(info.circleWidth).toBe(1)
    expect(info.circleBorderColor).toEqual({ r: 0, g: 0, b: 0, a: 96 })
    expect(info.circleBorderWidth).toBe(3)
  })

  it('accepts custom range', () => {
    const range = WDist.fromCells(5)
    const info = new BaseProviderInfo({ range })
    expect(info.range).toBe(range)
    expect(info.range.length).toBe(5120)
  })

  it('accepts custom cooldown', () => {
    const info = new BaseProviderInfo({ cooldown: 100 })
    expect(info.cooldown).toBe(100)
  })

  it('accepts custom initialDelay', () => {
    const info = new BaseProviderInfo({ initialDelay: 50 })
    expect(info.initialDelay).toBe(50)
  })

  it('accepts custom circle colors', () => {
    const readyColor = { r: 0, g: 255, b: 0, a: 128 }
    const blockedColor = { r: 255, g: 255, b: 0, a: 200 }
    const info = new BaseProviderInfo({
      circleReadyColor: readyColor,
      circleBlockedColor: blockedColor,
    })
    expect(info.circleReadyColor).toEqual(readyColor)
    expect(info.circleBlockedColor).toEqual(blockedColor)
  })

  it('accepts custom circle width', () => {
    const info = new BaseProviderInfo({ circleWidth: 2.5 })
    expect(info.circleWidth).toBe(2.5)
  })

  it('accepts custom border color and width', () => {
    const info = new BaseProviderInfo({
      circleBorderColor: { r: 255, g: 255, b: 255, a: 128 },
      circleBorderWidth: 5,
    })
    expect(info.circleBorderColor).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 128,
    })
    expect(info.circleBorderWidth).toBe(5)
  })

  it('accepts requiresCondition', () => {
    const info = new BaseProviderInfo({ requiresCondition: 'powered' })
    expect(info.requiresCondition).toBe('powered')
  })

  it('accepts instanceName', () => {
    const info = new BaseProviderInfo({ instanceName: 'main-base' })
    expect(info.instanceName).toBe('main-base')
  })

  it('range uses WDist.fromCells multiplier (1024)', () => {
    const info = new BaseProviderInfo({ range: WDist.fromCells(3) })
    expect(info.range.length).toBe(3072)
  })
})

// ---------------------------------------------------------------------------
// BaseProvider
// ---------------------------------------------------------------------------

describe('BaseProvider', () => {
  let info: BaseProviderInfo

  beforeEach(() => {
    info = new BaseProviderInfo()
  })

  it('constructs with default values', () => {
    const bp = new BaseProvider(info)
    expect(bp.info).toBe(info)
    expect(bp.progress).toBe(0)
    expect(bp.total).toBe(0)
    expect(bp.ready()).toBe(true)
    expect(bp.displayWhenEmpty).toBe(false)
  })

  it('constructs with initialDelay', () => {
    const delayInfo = new BaseProviderInfo({ initialDelay: 100 })
    const bp = new BaseProvider(delayInfo)

    expect(bp.progress).toBe(100)
    expect(bp.total).toBe(100)
    expect(bp.ready()).toBe(false) // Not ready during initial delay
  })

  it('constructs with MapBuildRadius settings', () => {
    const mrInfo = new MapBuildRadiusInfo({
      allyBuildRadiusCheckboxEnabled: false,
      buildRadiusCheckboxEnabled: false,
    })
    const mr = new MapBuildRadius(mrInfo)

    const bp = new BaseProvider(info, mr)
    // BaseProvider reads from MapBuildRadius
    // The state is internal, tested via behavior
    expect(bp).toBeInstanceOf(BaseProvider)
  })

  it('constructs without MapBuildRadius (defaults to enabled)', () => {
    const bp = new BaseProvider(info, null)
    expect(bp).toBeInstanceOf(BaseProvider)
    // Without MapBuildRadius, defaults to true for both
  })

  it('constructs with undefined MapBuildRadius (defaults to enabled)', () => {
    const bp = new BaseProvider(info)
    expect(bp).toBeInstanceOf(BaseProvider)
  })
})

// ---------------------------------------------------------------------------
// Cooldown management
// ---------------------------------------------------------------------------

describe('BaseProvider cooldown', () => {
  it('beginCooldown sets progress to cooldown value', () => {
    const info = new BaseProviderInfo({ cooldown: 50 })
    const bp = new BaseProvider(info)

    expect(bp.progress).toBe(0)

    bp.beginCooldown()
    expect(bp.progress).toBe(50)
    expect(bp.total).toBe(50)
  })

  it('beginCooldown with zero cooldown', () => {
    const info = new BaseProviderInfo({ cooldown: 0 })
    const bp = new BaseProvider(info)

    bp.beginCooldown()
    expect(bp.progress).toBe(0)
    expect(bp.total).toBe(0)
  })

  it('tick decrements progress', () => {
    const info = new BaseProviderInfo({ cooldown: 10 })
    const bp = new BaseProvider(info)
    const self = makeActor()

    bp.beginCooldown()
    expect(bp.progress).toBe(10)

    bp.tick(self)
    expect(bp.progress).toBe(9)

    bp.tick(self)
    expect(bp.progress).toBe(8)
  })

  it('tick does not go below zero', () => {
    const info = new BaseProviderInfo({ cooldown: 1 })
    const bp = new BaseProvider(info)
    const self = makeActor()

    bp.beginCooldown()
    bp.tick(self)
    expect(bp.progress).toBe(0)

    // Extra tick should not go negative
    bp.tick(self)
    expect(bp.progress).toBe(0)
  })

  it('ready returns false during cooldown', () => {
    const info = new BaseProviderInfo({ cooldown: 5 })
    const bp = new BaseProvider(info)
    const self = makeActor()

    bp.beginCooldown()
    expect(bp.ready()).toBe(false)

    // Tick through cooldown
    for (let i = 0; i < 5; i++) {
      bp.tick(self)
    }

    expect(bp.ready()).toBe(true)
  })

  it('ready returns true immediately when cooldown is zero', () => {
    const info = new BaseProviderInfo({ cooldown: 0 })
    const bp = new BaseProvider(info)
    expect(bp.ready()).toBe(true)
  })

  it('ready returns false during initialDelay', () => {
    const info = new BaseProviderInfo({ initialDelay: 20 })
    const bp = new BaseProvider(info)

    expect(bp.ready()).toBe(false)
  })

  it('ready becomes true after initialDelay ticks', () => {
    const info = new BaseProviderInfo({ initialDelay: 3 })
    const bp = new BaseProvider(info)
    const self = makeActor()

    expect(bp.ready()).toBe(false)

    bp.tick(self)
    bp.tick(self)
    bp.tick(self)

    expect(bp.ready()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ConditionalTrait behavior
// ---------------------------------------------------------------------------

describe('BaseProvider ConditionalTrait', () => {
  it('ready returns false when trait is disabled', () => {
    const info = new BaseProviderInfo({ cooldown: 0 })
    const bp = new BaseProvider(info)

    // Simulate disabling the trait via Component.onEnabledChanged()
    bp.onEnabledChanged(false)

    expect(bp.isTraitDisabled).toBe(true)
    expect(bp.ready()).toBe(false)
  })

  it('ready returns false when trait is paused', () => {
    const info = new BaseProviderInfo({ cooldown: 0 })
    const bp = new BaseProvider(info)

    // Simulate pausing the trait (accesses protected _paused for testing)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(bp as any)._paused = true

    expect(bp.isTraitPaused).toBe(true)
    expect(bp.ready()).toBe(false)
  })

  it('rangeCircleRenderables returns empty when disabled', () => {
    const info = new BaseProviderInfo({ cooldown: 0 })
    const bp = new BaseProvider(info)

    bp.onEnabledChanged(false)

    expect(bp.rangeCircleRenderables()).toEqual([])
  })

  it('getValue returns 0 when disabled', () => {
    const info = new BaseProviderInfo({ cooldown: 50 })
    const bp = new BaseProvider(info)

    bp.beginCooldown()
    expect(bp.getValue()).toBeGreaterThan(0)

    bp.onEnabledChanged(false)
    expect(bp.getValue()).toBe(0)
  })

  it('ConditionalTrait info is accessible', () => {
    const info = new BaseProviderInfo()
    const bp = new BaseProvider(info)
    expect(bp.info).toBe(info)
  })
})

// ---------------------------------------------------------------------------
// ISelectionBar
// ---------------------------------------------------------------------------

describe('BaseProvider ISelectionBar', () => {
  it('getValue returns 0 when ready', () => {
    const info = new BaseProviderInfo()
    const bp = new BaseProvider(info)
    expect(bp.getValue()).toBe(0)
  })

  it('getValue returns progress fraction during cooldown', () => {
    const info = new BaseProviderInfo({ cooldown: 100 })
    const bp = new BaseProvider(info)
    const self = makeActor()

    bp.beginCooldown()
    expect(bp.getValue()).toBeCloseTo(1.0, 5)

    // Tick halfway
    for (let i = 0; i < 50; i++) {
      bp.tick(self)
    }
    expect(bp.getValue()).toBeCloseTo(0.5, 5)
  })

  it('getValue returns 0 when total is 0', () => {
    const info = new BaseProviderInfo({ cooldown: 0 })
    const bp = new BaseProvider(info)

    bp.beginCooldown()
    expect(bp.getValue()).toBe(0)
  })

  it('getColor returns purple', () => {
    const info = new BaseProviderInfo()
    const bp = new BaseProvider(info)
    expect(bp.getColor()).toEqual({ r: 128, g: 0, b: 128, a: 255 })
  })

  it('displayWhenEmpty is false', () => {
    const info = new BaseProviderInfo()
    const bp = new BaseProvider(info)
    expect(bp.displayWhenEmpty).toBe(false)
  })

  it('getValue fractional result is between 0 and 1', () => {
    const info = new BaseProviderInfo({ cooldown: 75 })
    const bp = new BaseProvider(info)

    bp.beginCooldown()
    const value = bp.getValue()
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(1)
  })

  it('getValue returns 0 after cooldown completes', () => {
    const info = new BaseProviderInfo({ cooldown: 3 })
    const bp = new BaseProvider(info)
    const self = makeActor()

    bp.beginCooldown()
    expect(bp.getValue()).toBeGreaterThan(0)

    for (let i = 0; i < 3; i++) {
      bp.tick(self)
    }

    expect(bp.progress).toBe(0)
    expect(bp.getValue()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Range circle renderables
// ---------------------------------------------------------------------------

describe('BaseProvider range circles', () => {
  it('rangeCircleRenderables returns empty array (stub)', () => {
    const info = new BaseProviderInfo()
    const bp = new BaseProvider(info)
    expect(bp.rangeCircleRenderables()).toEqual([])
  })

  it('renderAnnotations returns empty array (stub)', () => {
    const info = new BaseProviderInfo()
    const bp = new BaseProvider(info)
    const actor = makeActor()

    const result = bp.renderAnnotations(actor, {} as any)
    expect(result).toEqual([])
  })

  it('spatiallyPartitionable returns false', () => {
    const info = new BaseProviderInfo()
    const bp = new BaseProvider(info)
    expect(bp.spatiallyPartitionable).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration: lifecycle (create -> cooldown -> tick -> ready)
// ---------------------------------------------------------------------------

describe('BaseProvider integration', () => {
  it('full lifecycle: initialDelay -> tick -> ready', () => {
    const info = new BaseProviderInfo({
      initialDelay: 5,
      cooldown: 10,
    })
    const bp = new BaseProvider(info)
    const self = makeActor()

    // Not ready initially
    expect(bp.ready()).toBe(false)
    expect(bp.progress).toBe(5)

    // Tick through initial delay
    for (let i = 0; i < 5; i++) {
      bp.tick(self)
    }

    // Ready after initial delay
    expect(bp.ready()).toBe(true)

    // Start cooldown (building placed)
    bp.beginCooldown()

    // Not ready during cooldown
    expect(bp.ready()).toBe(false)
    expect(bp.progress).toBe(10)

    // Tick through cooldown
    for (let i = 0; i < 10; i++) {
      bp.tick(self)
    }

    // Ready again
    expect(bp.ready()).toBe(true)
  })

  it('beginCooldown resets total to info cooldown', () => {
    const info = new BaseProviderInfo({ initialDelay: 0, cooldown: 25 })
    const bp = new BaseProvider(info)

    expect(bp.total).toBe(0)

    bp.beginCooldown()
    expect(bp.total).toBe(25)
    expect(bp.progress).toBe(25)
  })

  it('ready with fastBuild (stubbed to false)', () => {
    const info = new BaseProviderInfo({ cooldown: 100 })
    const bp = new BaseProvider(info)

    bp.beginCooldown()
    expect(bp.ready()).toBe(false)
    // FastBuild is stubbed to false, so even at progress > 0, ready is false
  })

  it('readiness toggles correctly across multiple cooldown cycles', () => {
    const info = new BaseProviderInfo({ cooldown: 2 })
    const bp = new BaseProvider(info)
    const self = makeActor()

    // Cycle 1
    expect(bp.ready()).toBe(true)
    bp.beginCooldown()
    expect(bp.ready()).toBe(false)
    bp.tick(self)
    bp.tick(self)
    expect(bp.ready()).toBe(true)

    // Cycle 2
    bp.beginCooldown()
    expect(bp.ready()).toBe(false)
    bp.tick(self)
    expect(bp.getValue()).toBeCloseTo(0.5, 5)
    bp.tick(self)
    expect(bp.ready()).toBe(true)
  })
})
