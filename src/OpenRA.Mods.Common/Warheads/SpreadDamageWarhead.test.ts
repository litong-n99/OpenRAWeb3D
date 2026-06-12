/**
 * SpreadDamageWarhead.test.ts -- AOE falloff precision tests
 *
 * Tests: effectiveRange computation, falloff interpolation at boundary
 * thresholds, null spread handling.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  SpreadDamageWarhead,
} from './SpreadDamageWarhead.js'
import {
  DamageCalculationType,
  type WarheadArgs,
} from './Warhead.js'

/** Zero rotation for test args. */
const WRotZero = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpreadDamageWarhead', () => {
  let warhead: SpreadDamageWarhead

  beforeEach(() => {
    warhead = new SpreadDamageWarhead()
  })

  // -----------------------------------------------------------------------
  // Default config
  // -----------------------------------------------------------------------

  describe('default config', () => {
    it('spread defaults to 43', () => {
      expect(warhead.spread.length).toBe(43)
    })

    it('falloff defaults to [100, 37, 14, 5, 0]', () => {
      expect(warhead.falloff).toEqual([100, 37, 14, 5, 0])
    })

    it('effectiveRange defaults to spread * index', () => {
      expect(warhead.effectiveRange.length).toBe(5)
      expect(warhead.effectiveRange[0].length).toBe(0)   // 0 * 43
      expect(warhead.effectiveRange[1].length).toBe(43)  // 1 * 43
      expect(warhead.effectiveRange[2].length).toBe(86)  // 2 * 43
      expect(warhead.effectiveRange[3].length).toBe(129) // 3 * 43
      expect(warhead.effectiveRange[4].length).toBe(172) // 4 * 43
    })

    it('damageCalculationType defaults to HitShape', () => {
      expect(warhead.damageCalculationType).toBe(DamageCalculationType.HitShape)
    })
  })

  // -----------------------------------------------------------------------
  // loadFromJSON
  // -----------------------------------------------------------------------

  describe('loadFromJSON', () => {
    it('loads Spread', () => {
      warhead.loadFromJSON({ Spread: 100 })
      expect(warhead.spread.length).toBe(100)
      // effectiveRange updated: 0*100, 1*100, 2*100, 3*100, 4*100
      expect(warhead.effectiveRange[1].length).toBe(100)
    })

    it('loads Falloff array', () => {
      warhead.loadFromJSON({ Falloff: [100, 50, 0] })
      expect(warhead.falloff).toEqual([100, 50, 0])
      expect(warhead.effectiveRange.length).toBe(3)
    })

    it('loads explicit Range values', () => {
      warhead.loadFromJSON({
        Falloff: [100, 50, 25, 0],
        Range: [0, 100, 200, 300],
      })
      expect(warhead.effectiveRange.length).toBe(4)
      expect(warhead.effectiveRange[0].length).toBe(0)
      expect(warhead.effectiveRange[1].length).toBe(100)
      expect(warhead.effectiveRange[2].length).toBe(200)
      expect(warhead.effectiveRange[3].length).toBe(300)
    })

    it('expands single range to match falloff length', () => {
      warhead.loadFromJSON({
        Falloff: [100, 50, 25, 0],
        Range: [50],
      })
      expect(warhead.effectiveRange.length).toBe(4)
      expect(warhead.effectiveRange[0].length).toBe(0)
      expect(warhead.effectiveRange[1].length).toBe(50)
      expect(warhead.effectiveRange[2].length).toBe(100)
      expect(warhead.effectiveRange[3].length).toBe(150)
    })

    it('throws on range count mismatch', () => {
      expect(() => {
        warhead.loadFromJSON({
          Falloff: [100, 50, 0],
          Range: [0, 100],
        })
      }).toThrow('Number of range values must be 1 or equal')
    })

    it('throws on non-increasing range', () => {
      expect(() => {
        warhead.loadFromJSON({
          Falloff: [100, 50, 0],
          Range: [100, 0, 200],
        })
      }).toThrow('Range values must be specified')
    })

    it('loads DamageCalculationType', () => {
      warhead.loadFromJSON({ DamageCalculationType: 'ClosestTargetablePosition' })
      expect(warhead.damageCalculationType).toBe(DamageCalculationType.ClosestTargetablePosition)

      warhead.loadFromJSON({ DamageCalculationType: 'CenterPosition' })
      expect(warhead.damageCalculationType).toBe(DamageCalculationType.CenterPosition)
    })
  })

  // -----------------------------------------------------------------------
  // getDamageFalloff
  // -----------------------------------------------------------------------

  describe('getDamageFalloff', () => {
    beforeEach(() => {
      // Setup: spread=100, falloff=[100, 37, 14, 5, 0]
      warhead.loadFromJSON({
        Spread: 100,
        Falloff: [100, 37, 14, 5, 0],
      })
    })

    it('returns 100% at distance 0 (center of AOE)', () => {
      expect(warhead.getDamageFalloff(0)).toBe(100)
    })

    it('returns 37% at distance 100 (first range boundary)', () => {
      expect(warhead.getDamageFalloff(100)).toBe(37)
    })

    it('returns 14% at distance 200', () => {
      expect(warhead.getDamageFalloff(200)).toBe(14)
    })

    it('returns 5% at distance 300', () => {
      expect(warhead.getDamageFalloff(300)).toBe(5)
    })

    it('returns 0% at distance 400 (max range)', () => {
      expect(warhead.getDamageFalloff(400)).toBe(0)
    })

    it('returns 0% beyond max range', () => {
      expect(warhead.getDamageFalloff(500)).toBe(0)
      expect(warhead.getDamageFalloff(1000)).toBe(0)
    })

    it('interpolates linearly between range steps', () => {
      // Between 0 (100%) and 100 (37%): midpoint 50
      const mid = warhead.getDamageFalloff(50)
      // 100 + (37-100)*(50-0)/(100-0) = 100 + (-63)*50/100 = 100 - 31 = 68
      expect(mid).toBe(68)
    })

    it('precision at spread boundary: distance 399 vs 400', () => {
      // Between 300 (5%) and 400 (0%)
      // Fix B1: with correct int2Lerp params, distance=399 interpolates to 0
      const at399 = warhead.getDamageFalloff(399)
      const at400 = warhead.getDamageFalloff(400)
      expect(at399).toBe(0)
      expect(at400).toBe(0)
    })

    it('precision test: distance 301 gives interpolated value', () => {
      // Fix B1: at distance=301, correctly interpolated to 4 (was buggy=5)
      const result = warhead.getDamageFalloff(301)
      expect(result).toBe(4)
    })

    it('handles single-element falloff', () => {
      const wh = new SpreadDamageWarhead()
      wh.loadFromJSON({ Falloff: [100] })
      expect(wh.getDamageFalloff(0)).toBe(100)
      expect(wh.getDamageFalloff(100)).toBe(0)
    })

    it('handles empty effectiveRange', () => {
      const wh = new SpreadDamageWarhead()
      wh.loadFromJSON({ Falloff: [] })
      expect(wh.getDamageFalloff(0)).toBe(0)
    })

    it('int2Lerp param fix: distance=150 with non-zero inner range', () => {
      // Regression test for B1: getDamageFalloff() int2Lerp param mismatch
      // when inner range is non-zero. C# uses int2.Lerp(a, b, distance-inner, outer-inner).
      // With Spread as the step size and no explicit Range, effectiveRange = [0, 5120, 10240, 15360, 20480].
      // distance=150 falls between step 0 and step 1.
      const wh = new SpreadDamageWarhead()
      wh.loadFromJSON({
        Falloff: [100, 50, 25, 10, 0],
      })
      wh.spread = WDist.fromCells(5) // 5*1024 = 5120
      // Recompute after setting spread
      ;(wh as any)._computeEffectiveRange()
      // effectiveRange = [0, 5120, 10240, 15360, 20480]
      // inner=0, outer=5120. distance=150.
      // int2Lerp(100, 50, 150-0, 0, 5120-0) = Math.trunc(100 + (50-100)*150/5120)
      // = Math.trunc(100 + (-50)*150/5120) = Math.trunc(98.535...) = 98
      expect(wh.getDamageFalloff(150)).toBe(98)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('doImpactInWorld returns empty when no world on actor', () => {
      const firedBy = {
        actorId: 1, isInWorld: true, isDead: false, disposed: false, generation: 0,
      } as unknown as IGameActor
      const args: WarheadArgs = {
        sourceActor: firedBy,
        damageModifiers: [],
        impactOrientation: WRotZero,
        impactPosition: WPos.Zero,
      }
      const effects = warhead.doImpactInWorld(WPos.Zero, firedBy, args)
      expect(effects).toEqual([])
    })

    it('inherits damage from DamageWarhead parent', () => {
      warhead.loadFromJSON({ Damage: 250 })
      expect(warhead.damage).toBe(250)
    })

    it('inherits versus from DamageWarhead parent', () => {
      warhead.loadFromJSON({ Versus: { Heavy: 50 } })
      expect(warhead.versus.get('Heavy')).toBe(50)
    })
  })
})
