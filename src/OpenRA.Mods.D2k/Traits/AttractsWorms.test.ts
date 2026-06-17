/**
 * AttractsWorms.test.ts — Unit tests for AttractsWorms migration
 *
 * Tests focus on: noise calculation, distance falloff, effective range
 * computation, trait disable state, zero-intensity edge case.
 */

import { describe, it, expect } from 'vitest'
import { AttractsWorms, AttractsWormsInfo } from './AttractsWorms'
import { WDist } from '../../OpenRA.Game/WDist'
import { WVec } from '../../OpenRA.Game/WVec'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock IGameActor with a centerPosition. */
function mockActor(centerPos?: WVec): IGameActor {
  return {
    actorId: 1,
    disposed: false,
    world: {},
    centerPosition: centerPos ?? WVec.Zero,
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AttractsWormsInfo', () => {
  it('has correct default values', () => {
    const info = new AttractsWormsInfo()
    expect(info.intensity).toBe(0)
    expect(info.falloff).toEqual([100, 100, 25, 11, 6, 4, 3, 2, 1, 0])
    expect(info.spread.length).toBe(3072)
    expect(info.range).toBeNull()
  })

  it('accepts custom values', () => {
    const info = new AttractsWormsInfo({
      intensity: 50,
      falloff: [100, 50, 0],
      spread: new WDist(1000),
    })
    expect(info.intensity).toBe(50)
    expect(info.falloff).toEqual([100, 50, 0])
    expect(info.spread.length).toBe(1000)
  })

  it('accepts explicit range instead of spread', () => {
    const explicitRange = [new WDist(0), new WDist(1000), new WDist(2000)]
    const info = new AttractsWormsInfo({ range: explicitRange })
    expect(info.range).toEqual(explicitRange)
  })
})

describe('AttractsWorms', () => {
  it('returns zero attraction when intensity is zero', () => {
    const info = new AttractsWormsInfo({ intensity: 0 })
    const worm = new AttractsWorms(mockActor(), info)
    const pos = new WVec(0, 0, 0)

    const result = worm.attractionAtPosition(pos)
    expect(result.X).toBe(0)
    expect(result.Y).toBe(0)
    expect(result.Z).toBe(0)
  })

  it('returns zero attraction when trait is disabled', () => {
    const info = new AttractsWormsInfo({ intensity: 100 })
    const worm = new AttractsWorms(mockActor(), info)
    // Simulate disabled state via traitDisabled lifecycle method
    worm['traitDisabled']?.(worm['_self'] ?? mockActor())

    const pos = new WVec(0, 0, 0)
    const result = worm.attractionAtPosition(pos)
    expect(result.X).toBe(0)
    expect(result.Y).toBe(0)
    expect(result.Z).toBe(0)
  })

  it('returns non-zero attraction for close position with intensity', () => {
    const info = new AttractsWormsInfo({
      intensity: 100,
      falloff: [100, 100, 25, 11, 6, 4, 3, 2, 1, 0],
      spread: new WDist(3072),
    })
    // Actor at origin
    const worm = new AttractsWorms(mockActor(WVec.Zero), info)

    // Position 1000 units away (within first falloff range)
    const pos = new WVec(1000, 0, 0)
    const result = worm.attractionAtPosition(pos)
    // Should attract toward the actor (negative X direction)
    expect(result.X).toBeLessThan(0)
  })

  it('returns zero attraction beyond max range', () => {
    const info = new AttractsWormsInfo({
      intensity: 100,
      falloff: [100, 0],
      spread: new WDist(1000),
    })
    const worm = new AttractsWorms(mockActor(WVec.Zero), info)

    // Position 10000 units away (beyond range)
    const pos = new WVec(10000, 0, 0)
    const result = worm.attractionAtPosition(pos)
    expect(result.X).toBe(0)
    expect(result.Y).toBe(0)
    expect(result.Z).toBe(0)
  })

  it('uses explicit range when provided', () => {
    const explicitRange = [new WDist(0), new WDist(500), new WDist(1000)]
    const info = new AttractsWormsInfo({
      intensity: 100,
      range: explicitRange,
      falloff: [100, 50, 0],
    })
    const worm = new AttractsWorms(mockActor(WVec.Zero), info)

    // Position at 800 units (between 500 and 1000)
    const pos = new WVec(800, 0, 0)
    const result = worm.attractionAtPosition(pos)
    // Should still attract (interpolated falloff)
    expect(result.X).toBeLessThan(0)
  })

  it('computes effective range from spread when no explicit range', () => {
    const info = new AttractsWormsInfo({
      intensity: 100,
      falloff: [100, 50, 0],
      spread: new WDist(500),
    })
    const worm = new AttractsWorms(mockActor(WVec.Zero), info)

    // Position within spread*2 = 1000
    const pos = new WVec(900, 0, 0)
    const result = worm.attractionAtPosition(pos)
    expect(result.X).toBeLessThan(0)
  })

  it('returns zero when at same position as actor', () => {
    const info = new AttractsWormsInfo({ intensity: 100 })
    const worm = new AttractsWorms(mockActor(WVec.Zero), info)

    // Same position
    const result = worm.attractionAtPosition(WVec.Zero)
    // Should be zero (length = 0, division by zero would be NaN but
    // we guard against that)
    expect(result.X).toBe(0)
    expect(result.Y).toBe(0)
  })

  it('BLOCKER-2 regression: lerpInt uses distance-inner (not raw distance)', () => {
    // This test validates the BLOCKER-2 fix: C# uses `distance - inner` as
    // the interpolant, and `outer - inner` as the divisor.
    // With falloff=[100, 50, 0], range=[WDist(0), WDist(1000), WDist(2000)]:
    // At distance=500 (between inner=0 and outer=1000):
    //   percentage = 100 + (50-100) * (500-0) / (1000-0) = 100 - 25 = 75
    // At distance=1500 (between inner=1000 and outer=2000):
    //   percentage = 50 + (0-50) * (1500-1000) / (2000-1000) = 50 - 25 = 25
    const explicitRange = [new WDist(0), new WDist(1000), new WDist(2000)]
    const info = new AttractsWormsInfo({
      intensity: 100,
      range: explicitRange,
      falloff: [100, 50, 0],
    })
    const worm = new AttractsWorms(mockActor(WVec.Zero), info)

    // At distance=500: percentage = 75
    // direction = 1024 * <1000,0,0> / 500 = <1024*2*500/500,...> ≈ <2048,0,0>
    // Real: distance vec = <500,0,0>, length=500
    // direction = <500,0,0> * 1024/500 = <1024,0,0>
    // scale = 100 * 75 / 100 = 75
    // result = <1024 * 75, 0, 0> = <76800, 0, 0>
    const pos500 = new WVec(500, 0, 0)
    const result500 = worm.attractionAtPosition(pos500)
    expect(result500.X).toBeLessThan(0) // attraction points toward actor at origin

    // At distance=1500: percentage = 25
    const pos1500 = new WVec(1500, 0, 0)
    const result1500 = worm.attractionAtPosition(pos1500)
    expect(result1500.X).toBeLessThan(0) // still attracts

    // At distance=1500 the magnitude should be roughly 3x smaller than at 500
    // (75 vs 25 percentage at same distance ratio 1:3)
    const mag500 = Math.abs(result500.X)
    const mag1500 = Math.abs(result1500.X)
    // mag500/mag1500 should be roughly 3:1 (75/25 * 1500/500 = 3*3=9? No,
    // direction is different because distance affects direction separately)
    // Just verify both are non-zero and 500 is stronger
    expect(mag500).toBeGreaterThan(mag1500)
  })

  it('produces attraction direction pointing toward the actor', () => {
    const actorPos = new WVec(5000, 0, 0)
    const info = new AttractsWormsInfo({
      intensity: 100,
      falloff: [100, 100, 100, 100, 100],
      spread: new WDist(1500),
    })
    const worm = new AttractsWorms(mockActor(actorPos), info)

    // Position at origin — attraction should point toward actor (positive X)
    const result = worm.attractionAtPosition(WVec.Zero)
    expect(result.X).toBeGreaterThan(0)
  })
})
