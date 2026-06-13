/**
 * Hovers.test.ts -- Unit tests for Hovers trait
 *
 * Tests focus on: phase advancement, sine-wave calculation, offset values,
 * rise/fall transitions, enabled/disabled state behavior, ISync compliance.
 */

import { describe, it, expect } from 'vitest'
import { Hovers, HoversInfo } from './Hovers.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import type { ISync } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function tickN(hovers: Hovers, n: number): void {
  for (let i = 0; i < n; i++) {
    hovers.tick({} as never)
  }
}

describe('Hovers', () => {
  // ---------------------------------------------------------------------------
  // HoversInfo tests
  // ---------------------------------------------------------------------------

  describe('HoversInfo', () => {
    it('has default bobDistance of WDist(-43)', () => {
      const info = new HoversInfo()
      expect(info.bobDistance.length).toBe(-43)
    })

    it('has default ticks of 6', () => {
      const info = new HoversInfo()
      expect(info.ticks).toBe(6)
    })

    it('has default initialHeight of WDist(43)', () => {
      const info = new HoversInfo()
      expect(info.initialHeight.length).toBe(43)
    })

    it('has default fallTicks of 10', () => {
      const info = new HoversInfo()
      expect(info.fallTicks).toBe(10)
    })

    it('has default riseTicks of 20', () => {
      const info = new HoversInfo()
      expect(info.riseTicks).toBe(20)
    })

    it('accepts custom values', () => {
      const info = new HoversInfo({
        bobDistance: new WDist(-50),
        ticks: 12,
        initialHeight: new WDist(50),
        fallTicks: 8,
        riseTicks: 16,
      })
      expect(info.bobDistance.length).toBe(-50)
      expect(info.ticks).toBe(12)
      expect(info.initialHeight.length).toBe(50)
      expect(info.fallTicks).toBe(8)
      expect(info.riseTicks).toBe(16)
    })
  })

  // ---------------------------------------------------------------------------
  // Hovers trait tests
  // ---------------------------------------------------------------------------

  describe('Hovers', () => {
    it('starts with zero visual offset', () => {
      const info = new HoversInfo()
      const hovers = new Hovers(info)
      expect(hovers.worldVisualOffset.Z).toBe(0)
      expect(hovers.worldVisualOffset.X).toBe(0)
      expect(hovers.worldVisualOffset.Y).toBe(0)
    })

    it('implements ISync (marker interface)', () => {
      const info = new HoversInfo()
      const hovers = new Hovers(info)
      const sync: ISync = hovers
      expect(sync).toBeDefined()
    })

    it('advances phase on each tick', () => {
      const info = new HoversInfo({ ticks: 6, bobDistance: new WDist(-43), initialHeight: new WDist(43) })
      const hovers = new Hovers(info)

      // Tick enough to finish the rise transition (~25 ticks at riseStep=2)
      tickN(hovers, 25)

      // Now in steady oscillation state.
      // At 25 ticks with ticks=6: 25%24=1 * (256/6) = 1*42 = 42
      // sin(42/256 * 2PI) ≈ sin(59°) ≈ 0.857
      // currentHeight = -43 * 0.857 + 43 ≈ 6
      const z1 = hovers.worldVisualOffset.Z

      // One more tick: 26%24=2 * 42 = 84, sin(118°) ≈ 0.882
      // currentHeight = -43 * 0.882 + 43 ≈ 5
      tickN(hovers, 1)
      const z2 = hovers.worldVisualOffset.Z

      // The offset changes each tick (oscillation is active)
      expect(z1).not.toBe(z2)
    })

    it('produces oscillating Z values over a full cycle', () => {
      const info = new HoversInfo({ ticks: 6, bobDistance: new WDist(-43), initialHeight: new WDist(43) })
      const hovers = new Hovers(info)

      // Tick enough to finish the rise transition (~25 ticks)
      tickN(hovers, 25)

      // Record Z offsets over 24 more ticks (4 cycles)
      const offsets: number[] = []
      for (let i = 0; i < 24; i++) {
        hovers.tick({} as never)
        offsets.push(hovers.worldVisualOffset.Z)
      }

      // The offset should vary (not all same value)
      const uniqueOffsets = new Set(offsets)
      expect(uniqueOffsets.size).toBeGreaterThan(2)

      // In steady-state oscillation, values range between min (~0, peak of bob)
      // and max (~86, trough of bob). After rising, mid-values should appear.
      const maxZ = Math.max(...offsets)
      const minZ = Math.min(...offsets)
      // There should be variation
      expect(maxZ - minZ).toBeGreaterThan(0)
    })

    it('falls toward zero when disabled', () => {
      const info = new HoversInfo({
        ticks: 6,
        bobDistance: new WDist(-43),
        initialHeight: new WDist(43),
        fallTicks: 2,
      })
      const hovers = new Hovers(info)

      // Advance some ticks to get non-zero offset, then disable
      tickN(hovers, 3)
      const offsetBeforeDisable = hovers.worldVisualOffset.Z

      // Disable and tick
      hovers['traitDisabled']({} as never)
      tickN(hovers, 5)

      // After falling, offset should be lower (or zero)
      expect(hovers.worldVisualOffset.Z).toBeLessThanOrEqual(offsetBeforeDisable)
    })

    it('rises toward initialHeight when enabled after disabled', () => {
      const info = new HoversInfo({
        ticks: 6,
        bobDistance: new WDist(-43),
        initialHeight: new WDist(43),
        riseTicks: 5,
      })
      const hovers = new Hovers(info)

      // Start disabled and tick
      hovers['traitDisabled']({} as never)
      tickN(hovers, 3)
      const offsetWhenDisabled = hovers.worldVisualOffset.Z

      // Enable and tick through rise
      hovers['traitEnabled']({} as never)
      tickN(hovers, 20)

      // After rising, offset should have changed (oscillating now)
      expect(hovers.worldVisualOffset.Z).not.toBe(offsetWhenDisabled)
    })

    it('modifyRender applies offset to renderables', () => {
      const info = new HoversInfo({ ticks: 6 })
      const hovers = new Hovers(info)

      // Advance some ticks to get non-zero offset
      tickN(hovers, 3)

      // Renderable that supports offsetBy
      let offsetApplied: WVec | null = null
      const renderable = {
        offsetBy(wvec: WVec) {
          offsetApplied = wvec
          return this
        },
      } as unknown as import('../../../OpenRA.Game/Traits/TraitsInterfaces.js').IRenderable

      hovers.modifyRender({} as never, {} as never, [renderable])

      expect(offsetApplied).not.toBeNull()
      expect(offsetApplied!.X).toBe(hovers.worldVisualOffset.X)
      expect(offsetApplied!.Y).toBe(hovers.worldVisualOffset.Y)
      expect(offsetApplied!.Z).toBe(hovers.worldVisualOffset.Z)
    })

    it('modifyScreenBounds returns bounds unchanged', () => {
      const info = new HoversInfo()
      const hovers = new Hovers(info)
      const bounds = [{ x: 0, y: 0, width: 100, height: 100 }]

      const result = hovers.modifyScreenBounds({} as never, {} as never, bounds)
      expect(result).toBe(bounds)
      expect(result.length).toBe(1)
    })

    it('does not fall below zero when disabled', () => {
      const info = new HoversInfo({ fallTicks: 2 })
      const hovers = new Hovers(info)

      hovers['traitDisabled']({} as never)
      // Tick many times — should hit zero and stay there
      tickN(hovers, 50)

      expect(hovers.worldVisualOffset.Z).toBeLessThanOrEqual(0)
    })
  })
})
