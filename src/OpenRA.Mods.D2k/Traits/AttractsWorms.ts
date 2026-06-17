/**
 * AttractsWorms.ts — 产生噪音吸引沙虫 (Sandworm) 的目标
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/AttractsWorms.cs (81 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<AttractsWormsInfo> → TS ConditionalTrait<AttractsWormsInfo>
 * - C# ImmutableArray<int> Falloff → readonly number[]
 * - C# ImmutableArray<WDist> Range → readonly WDist[] | null
 * - C# int2.Lerp → local lerpInt helper
 * - C# WVec multiplication via operator * → numeric multiply
 */

import { WDist } from '../../OpenRA.Game/WDist'
import { WVec } from '../../OpenRA.Game/WVec'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
} from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helper: integer linear interpolation
// OpenRA 对照: int2.Lerp(int, int, int, int)
// ---------------------------------------------------------------------------

/**
 * Integer linear interpolation: a + (b - a) * mul / div.
 *
 * OpenRA 对照: int2.Lerp(int a, int b, int mul, int div)
 */
function lerpInt(a: number, b: number, mul: number, div: number): number {
  if (div <= 0) return a
  return Math.round(a + (b - a) * mul / div)
}

// ---------------------------------------------------------------------------
// AttractsWormsInfo
// OpenRA 对照: AttractsWormsInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for the AttractsWorms trait.
 *
 * OpenRA 对照: AttractsWormsInfo (public class, ConditionalTraitInfo)
 *
 * Actors with this trait produce noise proportional to Intensity,
 * which Sandworms use to locate and prioritize targets.
 */
export class AttractsWormsInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** How much noise this actor produces.
   *
   * OpenRA 对照: AttractsWormsInfo.Intensity (default 0)
   */
  readonly intensity: number

  /** Noise percentage at Range step away from the actor.
   *
   * OpenRA 对照: AttractsWormsInfo.Falloff (default [100, 100, 25, 11, 6, 4, 3, 2, 1, 0])
   */
  readonly falloff: readonly number[]

  /** Range between falloff steps.
   *
   * OpenRA 对照: AttractsWormsInfo.Spread (default new WDist(3072))
   */
  readonly spread: WDist

  /** Ranges at which each Falloff step is defined. Overrides Spread.
   *
   * OpenRA 对照: AttractsWormsInfo.Range (default null)
   */
  readonly range: readonly WDist[] | null

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    intensity?: number
    falloff?: readonly number[]
    spread?: WDist
    range?: readonly WDist[] | null
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.intensity = params.intensity ?? 0
    this.falloff = params.falloff ?? [100, 100, 25, 11, 6, 4, 3, 2, 1, 0]
    this.spread = params.spread ?? new WDist(3072)
    this.range = params.range ?? null
  }
}

// ---------------------------------------------------------------------------
// AttractsWorms
// OpenRA 对照: AttractsWorms (ConditionalTrait<AttractsWormsInfo>)
// ---------------------------------------------------------------------------

/** Makes the actor produce noise that attracts Sandworm attention.
 *
 * OpenRA 对照: AttractsWorms (public class, ConditionalTrait<AttractsWormsInfo>)
 *
 * The intensity and distance-based falloff determine which actors
 * Sandworms prioritize as targets. Higher intensity = more attractive.
 *
 * Noise calculation: direction = 1024 * (distance vector / distance length),
 * then scaled by Intensity * (percentage at distance) / 100.
 */
export class AttractsWorms extends ConditionalTrait<AttractsWormsInfo> {
  /** Pre-computed effective range array (either explicit Range or derived from Falloff * Spread).
   *
   * OpenRA 对照: AttractsWorms.effectiveRange (ImmutableArray<WDist>)
   */
  private readonly effectiveRange: readonly WDist[]

  /** The actor that owns this trait.
   *
   * OpenRA 对照: AttractsWorms.self (from ActorInitializer.Self)
   */
  private readonly _self: IGameActor

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: AttractsWorms(ActorInitializer init, AttractsWormsInfo info)
  // ---------------------------------------------------------------------------

  /** Create a new AttractsWorms trait.
   *
   * OpenRA 对照: AttractsWorms(ActorInitializer init, AttractsWormsInfo info)
   *
   * If explicit range is provided, uses it. Otherwise computes effective range
   * from falloff.length * spread for each step.
   *
   * @param self — the actor that owns this trait
   * @param info — trait configuration
   */
  constructor(self: IGameActor, info: AttractsWormsInfo) {
    super(info)
    this._self = self

    if (info.range !== null) {
      this.effectiveRange = info.range
    } else {
      const ranges: WDist[] = []
      for (let i = 0; i < info.falloff.length; i++) {
        ranges.push(new WDist(i * info.spread.length))
      }
      this.effectiveRange = ranges
    }
  }

  // ---------------------------------------------------------------------------
  // GetNoisePercentageAtDistance
  // OpenRA 对照: AttractsWorms.GetNoisePercentageAtDistance(int distance)
  // ---------------------------------------------------------------------------

  /** Get the noise percentage at a given distance.
   *
   * OpenRA 对照: AttractsWorms.GetNoisePercentageAtDistance(int distance)
   *
   * Interpolates between falloff values at the effective range boundaries.
   * Returns 0 if distance is beyond the furthest range.
   *
   * @param distance — raw WDist.length value
   * @returns noise percentage [0-100]
   */
  private getNoisePercentageAtDistance(distance: number): number {
    let inner = this.effectiveRange[0]!.length
    for (let i = 1; i < this.effectiveRange.length; i++) {
      const outer = this.effectiveRange[i]!.length
      if (outer > distance)
        return lerpInt(
          this.info.falloff[i - 1]!,
          this.info.falloff[i]!,
          distance - inner,
          outer - inner,
        )

      inner = outer
    }

    return 0
  }

  // ---------------------------------------------------------------------------
  // AttractionAtPosition
  // OpenRA 对照: AttractsWorms.AttractionAtPosition(WPos pos)
  // ---------------------------------------------------------------------------

  /** Calculate the attraction vector toward this actor from a given position.
   *
   * OpenRA 对照: AttractsWorms.AttractionAtPosition(WPos pos)
   *
   * If the trait is disabled, returns zero.
   * If the position is beyond the furthest effective range, returns zero.
   * Otherwise: direction = 1024 * (distance vector / distance length),
   * scaled by Intensity * (percentage at distance) / 100.
   *
   * @param pos — the position to calculate attraction from
   * @returns the attraction vector (0,0,0 if no attraction)
   */
  attractionAtPosition(pos: WVec): WVec {
    if (this.isTraitDisabled)
      return WVec.Zero

    const centerPos = this.getActorCenterPosition()
    const distance = WVec.subtract(centerPos, pos)
    const length = distance.length

    // Actor is too far to hear anything.
    if (length > this.effectiveRange[this.effectiveRange.length - 1]!.length)
      return WVec.Zero

    const direction = WVec.multiply(distance, 1024 / Math.max(length, 1))
    const percentage = this.getNoisePercentageAtDistance(length)

    const scale = (this.info.intensity * percentage) / 100
    return new WVec(
      Math.round(direction.X * scale),
      Math.round(direction.Y * scale),
      Math.round(direction.Z * scale),
    )
  }

  // ---------------------------------------------------------------------------
  // Private: get actor center position
  // ---------------------------------------------------------------------------

  /** Get the actor's center position for noise calculations.
   *
   * Uses duck-typing since centerPosition may come from different trait sources.
   */
  private getActorCenterPosition(): WVec {
    const selfAny = this._self as unknown as { centerPosition?: WVec }
    if (selfAny.centerPosition instanceof WVec) {
      return selfAny.centerPosition
    }
    return WVec.Zero
  }
}
