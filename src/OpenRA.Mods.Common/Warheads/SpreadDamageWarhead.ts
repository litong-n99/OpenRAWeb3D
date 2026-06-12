/**
 * SpreadDamageWarhead.ts -- Area-of-effect damage with distance-based falloff
 * OpenRA 对照: OpenRA.Mods.Common/Warheads/SpreadDamageWarhead.cs
 *
 * 核心范式转换:
 * - C# World.FindActorsOnCircle(pos, range) → duck-typed world.findActorsOnCircle()
 * - C# Exts.MakeArray(effectiveRange) → precomputed effectiveRange from Falloff * Spread
 * - C# int2.Lerp for falloff interpolation → int2Lerp() from Warhead.ts
 * - C# EnabledTargetablePositions iteration → findClosestActiveShape()
 * - C# WAngle.Yaw / Util.GetVerticalAngle → getVerticalAngle() / WVec.Yaw
 * - C# WRot impactOrientation → impactOrientation in WarheadArgs
 * - WVec.subtract → WPos.subtract (returns WVec correctly)
 */

import type { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WPos as WPosValue } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import {
  DamageWarhead,
} from './DamageWarhead.js'
import {
  DamageCalculationType,
  int2Lerp,
  getVerticalAngle,
  type WarheadArgs,
  type WarheadEffect,
  type WarheadActorLike,
  type WarheadWorldLike,
} from './Warhead.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// SpreadDamageWarhead (对应 OpenRA SpreadDamageWarhead)
// ---------------------------------------------------------------------------

/**
 * Area-of-effect damage warhead with distance-based falloff.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Warheads.SpreadDamageWarhead
 *
 * Features:
 * - Spread radius (WDist) defines maximum AOE range
 * - Falloff array defines damage percentage at each range step
 * - Range array (optional) defines explicit distance thresholds
 * - Damage calculation type: HitShape, ClosestTargetablePosition, or CenterPosition
 * - Falloff interpolation between range steps using int2Lerp
 *
 * Precision requirement: damage at boundary must match C# within 1 su.
 */
export class SpreadDamageWarhead extends DamageWarhead {
  // -----------------------------------------------------------------------
  // Config properties
  // -----------------------------------------------------------------------

  /** Range between falloff steps (default: 43 sub-units).
   *
   * OpenRA 对照: SpreadDamageWarhead.Spread
   */
  spread: WDist = new WDist(43)

  /** Damage percentage at each range step.
   *
   * OpenRA 对照: SpreadDamageWarhead.Falloff (ImmutableArray<int>)
   */
  falloff: number[] = [100, 37, 14, 5, 0]

  /** Explicit range thresholds (overrides Spread-based calculation).
   *
   * OpenRA 对照: SpreadDamageWarhead.Range (ImmutableArray<WDist>)
   */
  range: WDist[] | null = null

  /** Controls how falloff distance is calculated.
   *
   * OpenRA 对照: SpreadDamageWarhead.DamageCalculationType
   */
  damageCalculationType: DamageCalculationType = DamageCalculationType.HitShape

  // -----------------------------------------------------------------------
  // Computed effective range (derived from Range or Spread * Falloff)
  // -----------------------------------------------------------------------

  private _effectiveRange: WDist[] = []

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor() {
    super()
    this._computeEffectiveRange()
  }

  // -----------------------------------------------------------------------
  // Override: loadFromJSON
  // -----------------------------------------------------------------------

  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)

    if (json.Spread !== undefined) {
      this.spread = new WDist(json.Spread as number)
    }
    if (json.Falloff !== undefined) {
      this.falloff = json.Falloff as number[]
    }
    if (json.Range !== undefined) {
      const arr = json.Range as number[]
      this.range = arr.map(n => new WDist(n))
    }
    if (json.DamageCalculationType !== undefined) {
      const s = json.DamageCalculationType as string
      switch (s) {
        case 'HitShape': this.damageCalculationType = DamageCalculationType.HitShape; break
        case 'ClosestTargetablePosition': this.damageCalculationType = DamageCalculationType.ClosestTargetablePosition; break
        case 'CenterPosition': this.damageCalculationType = DamageCalculationType.CenterPosition; break
      }
    }

    // Compute effective range (matching OpenRA RulesetLoaded logic)
    this._computeEffectiveRange()
  }

  // -----------------------------------------------------------------------
  // Override: doImpactInWorld
  // -----------------------------------------------------------------------

  /**
   * Apply area-of-effect damage at a world position.
   *
   * OpenRA 对照: SpreadDamageWarhead.DoImpact(WPos pos, Actor firedBy, WarheadArgs args)
   *
   * For each actor within the spread radius, computes falloff distance
   * and applies damage proportional to the falloff curve.
   */
  override doImpactInWorld(
    pos: WPos,
    firedBy: IGameActor,
    args: WarheadArgs,
  ): WarheadEffect[] {
    const effects: WarheadEffect[] = []

    const actorLike = firedBy as unknown as WarheadActorLike
    const world: WarheadWorldLike | undefined = actorLike.world
    if (!world || !world.findActorsOnCircle) return effects

    // Find all actors within the maximum effective range
    const maxRange = this._effectiveRange[this._effectiveRange.length - 1]
    const victims = world.findActorsOnCircle(pos, maxRange)
    if (!victims || victims.length === 0) return effects

    for (const victim of victims) {
      const victimActor = victim as unknown as IGameActor
      if (!this.isValidAgainst(victimActor, firedBy)) continue

      // Find closest active HitShape
      const shapeResult = this.findClosestActiveShape(victim, pos)
      if (!shapeResult) continue

      // Compute falloff distance based on DamageCalculationType
      const falloffDistance = this._computeFalloffDistance(victim, pos)

      // Bail early if beyond max range (falloff will be 0)
      if (falloffDistance > maxRange.length) continue

      // Compute damage falloff multiplier
      const falloffPct = this.getDamageFalloff(falloffDistance)

      // Build local modifiers including falloff
      const localModifiers = [...args.damageModifiers, falloffPct]

      // Compute impact orientation: if warhead lands outside victim's HitShape,
      // calculate from impact position rather than last projectile facing
      let impactOrientation = args.impactOrientation
      if (falloffDistance > 0) {
        const victimCenter = victim.centerPosition
        const displacement = WPosValue.subtract(victimCenter, args.impactPosition)
        const towardsTargetYaw = displacement.yaw
        const impactAngle = getVerticalAngle(args.impactPosition, victimCenter)
        impactOrientation = new WRot(WAngle.Zero, impactAngle, towardsTargetYaw)
      }

      const updatedArgs: WarheadArgs = {
        ...args,
        damageModifiers: localModifiers,
        impactOrientation,
      }

      effects.push(
        ...this.inflictDamage(victimActor, firedBy, shapeResult.shape, updatedArgs),
      )
    }

    return effects
  }

  // -----------------------------------------------------------------------
  // Falloff calculation
  // -----------------------------------------------------------------------

  /**
   * Compute the falloff distance for a victim relative to the impact position.
   *
   * OpenRA 对照: falloffDistance computation in SpreadDamageWarhead.DoImpact()
   */
  private _computeFalloffDistance(victim: WarheadActorLike, pos: WPos): number {
    switch (this.damageCalculationType) {
      case DamageCalculationType.HitShape: {
        const shapeResult = this.findClosestActiveShape(victim, pos)
        return shapeResult ? shapeResult.distance : Number.MAX_SAFE_INTEGER
      }
      case DamageCalculationType.ClosestTargetablePosition: {
        const positions = victim.getTargetablePositions?.()
        if (!positions || positions.length === 0) return Number.MAX_SAFE_INTEGER
        let best = Number.MAX_SAFE_INTEGER
        for (const p of positions) {
          const d = WPosValue.subtract(p, pos).length
          if (d < best) best = d
        }
        return best
      }
      case DamageCalculationType.CenterPosition: {
        return WPosValue.subtract(victim.centerPosition, pos).length
      }
      default:
        return Number.MAX_SAFE_INTEGER
    }
  }

  /**
   * Get the damage falloff percentage for a given distance.
   *
   * OpenRA 对照: SpreadDamageWarhead.GetDamageFalloff(int distance)
   *
   * Uses linear interpolation (int2Lerp) between range steps.
   *
   * @param distance -- the distance from impact to target
   * @returns damage percentage (0-100)
   */
  getDamageFalloff(distance: number): number {
    const ranges = this._effectiveRange
    if (ranges.length === 0) return 0
    if (ranges.length === 1) {
      return distance <= ranges[0].length ? this.falloff[0] : 0
    }

    let inner = ranges[0].length
    for (let i = 1; i < ranges.length; i++) {
      const outer = ranges[i].length
      if (outer > distance) {
        return int2Lerp(
          this.falloff[i - 1],
          this.falloff[i],
          distance,
          inner,
          outer - inner,
        )
      }
      inner = outer
    }

    return 0
  }

  /**
   * Get the effective range thresholds.
   *
   * OpenRA 对照: SpreadDamageWarhead.effectiveRange
   */
  get effectiveRange(): readonly WDist[] {
    return this._effectiveRange
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Compute the effective range array from Range or Spread * Falloff.
   *
   * OpenRA 对照: IRulesetLoaded.RulesetLoaded() range computation
   */
  private _computeEffectiveRange(): void {
    if (this.range && this.range.length > 0) {
      if (this.range.length !== 1 && this.range.length !== this.falloff.length) {
        throw new Error('Number of range values must be 1 or equal to the number of Falloff values.')
      }

      // Validate increasing order
      for (let i = 0; i < this.range.length - 1; i++) {
        if (this.range[i].length > this.range[i + 1].length) {
          throw new Error('Range values must be specified in an increasing order.')
        }
      }

      if (this.range.length === 1 && this.falloff.length > 1) {
        // Single range value: expand to match falloff length
        this._effectiveRange = this.falloff.map((_, i) => new WDist(i * this.range![0].length))
      } else {
        this._effectiveRange = [...this.range]
      }
    } else {
      // Use Spread * index for each falloff step
      this._effectiveRange = this.falloff.map((_, i) => new WDist(i * this.spread.length))
    }
  }
}
