/**
 * Hovers.ts -- Visual Z-position oscillation (hover effect)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Render/Hovers.cs (121 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<HoversInfo>, IRenderModifier, ITick, ISync
 *   → TS ConditionalTrait<HoversInfo> implements IRenderModifier, ITick, ISync
 * - C# WAngle(phase).Sin() integer-scaled sine (range [-1024, 1024])
 *   → TS Math.sin() floating-point (range [-1, 1]), net result equivalent
 * - C# WVec WorldVisualOffset → TS WVec-based offset applied to renderables
 * - C# RiseTicks/FallTicks for smooth enable/disable transitions → same in TS
 * - Visual only — no gameplay effect; offset applied in render pipeline
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
  type ISync,
  type IRenderModifier,
  type IRenderable,
  type RectangleStub,
  type WorldRendererStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'

// ---------------------------------------------------------------------------
// HoversInfo
// OpenRA 对照: HoversInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for Hovers trait.
 *
 *  OpenRA 对照: HoversInfo
 */
export class HoversInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Maximum visual Z axis distance relative to actual position + InitialHeight.
   *
   *  OpenRA 对照: HoversInfo.BobDistance (default new WDist(-43))
   *
   *  Must be a negative value (checked in RulesetLoaded).
   */
  readonly bobDistance: WDist

  /** Actual altitude needed or higher to enable hover effect.
   *
   *  OpenRA 对照: HoversInfo.MinHoveringAltitude (default WDist.Zero)
   */
  readonly minHoveringAltitude: WDist

  /** Amount of ticks to complete one bob half-cycle.
   *
   *  OpenRA 对照: HoversInfo.Ticks (default 6)
   */
  readonly ticks: number

  /** Amount of ticks to fall to ground from highest point when disabled.
   *
   *  OpenRA 对照: HoversInfo.FallTicks (default 10)
   */
  readonly fallTicks: number

  /** Amount of ticks to rise from ground to InitialHeight.
   *
   *  OpenRA 对照: HoversInfo.RiseTicks (default 20)
   */
  readonly riseTicks: number

  /** Initial Z axis modifier relative to actual position.
   *
   *  OpenRA 对照: HoversInfo.InitialHeight (default new WDist(43))
   */
  readonly initialHeight: WDist

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    bobDistance?: WDist
    minHoveringAltitude?: WDist
    ticks?: number
    fallTicks?: number
    riseTicks?: number
    initialHeight?: WDist
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.bobDistance = params.bobDistance ?? new WDist(-43)
    this.minHoveringAltitude = params.minHoveringAltitude ?? WDist.Zero
    this.ticks = params.ticks ?? 6
    this.fallTicks = params.fallTicks ?? 10
    this.riseTicks = params.riseTicks ?? 20
    this.initialHeight = params.initialHeight ?? new WDist(43)
  }
}

// ---------------------------------------------------------------------------
// Hovers
// OpenRA 对照: Hovers (ConditionalTrait<HoversInfo>, IRenderModifier, ITick, ISync)
// ---------------------------------------------------------------------------

/**
 * Changes the visual Z position periodically (hover effect).
 *
 * OpenRA 对照: Hovers
 *
 * Uses a sine-wave oscillation to bob the actor up and down visually.
 * During disabled transitions, the actor smoothly rises or falls.
 */
export class Hovers
  extends ConditionalTrait<HoversInfo>
  implements IRenderModifier, ITick, ISync
{
  /** Current oscillation tick counter.
   *
   *  OpenRA 对照: int ticks
   */
  private _ticks: number = 0

  /** Steps per tick in WAngle units (256 = 360 degrees).
   *
   *  OpenRA 对照: readonly int stepPercentage (= 256 / Ticks)
   */
  private readonly _stepPercentage: number

  /** Fall distance per tick when disabled (must be at least 1).
   *
   *  OpenRA 对照: readonly int fallTickHeight
   */
  private readonly _fallTickHeight: number

  /** Current world visual offset from true position.
   *
   *  OpenRA 对照: WVec WorldVisualOffset
   */
  worldVisualOffset: WVec = WVec.Zero

  constructor(info: HoversInfo) {
    super(info)

    // -------------------------------------------------------------------------
    // Validation — OpenRA 对照: HoversInfo.RulesetLoaded()
    // -------------------------------------------------------------------------

    if (info.bobDistance.length > -1) {
      throw new Error(
        `Hovers.BobDistance must be a negative value, got ${info.bobDistance.length}.`,
      )
    }
    if (info.ticks < 1) {
      throw new Error(
        `Hovers.Ticks must be higher than zero, got ${info.ticks}.`,
      )
    }
    if (info.fallTicks < 1) {
      throw new Error(
        `Hovers.FallTicks must be higher than zero, got ${info.fallTicks}.`,
      )
    }
    if (info.riseTicks < 1) {
      throw new Error(
        `Hovers.RiseTicks must be higher than zero, got ${info.riseTicks}.`,
      )
    }
    if (info.initialHeight.length < info.riseTicks) {
      throw new Error(
        `Hovers.InitialHeight (${info.initialHeight.length}) must be at least as high as RiseTicks (${info.riseTicks}).`,
      )
    }

    this._stepPercentage = 256 / info.ticks

    // fallTickHeight must be at least 1 to avoid DivideByZeroException
    const totalHeight = info.initialHeight.length + info.bobDistance.length
    this._fallTickHeight = Math.max(
      Math.trunc(totalHeight / info.fallTicks),
      1,
    )
  }

  // ---------------------------------------------------------------------------
  // ITick
  // OpenRA 对照: ITick.Tick(Actor self)
  // ---------------------------------------------------------------------------

  /**
   * Advance the oscillation phase each tick.
   *
   * OpenRA 对照: ITick.Tick()
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled) {
      // Fall smoothly to ground
      if (this.worldVisualOffset.Z < 0) return

      const fallTicks = Math.trunc(this.worldVisualOffset.Z / this._fallTickHeight) - 1
      this.worldVisualOffset = new WVec(0, 0, this._fallTickHeight * fallTicks)
    } else {
      // OpenRA 对照: self.World.Map.DistanceAboveTerrain(self.CenterPosition) >= info.MinHoveringAltitude
      // Gate: only oscillate when the actor is at or above MinHoveringAltitude.
      // If terrain query is unavailable (!dat), treat as above threshold (always oscillate).
      const dat = (self as unknown as {
        world?: { map?: { distanceAboveTerrain?(pos: unknown): WDist } }
        centerPosition?: unknown
      }).world?.map?.distanceAboveTerrain?.(
        (self as unknown as { centerPosition?: unknown }).centerPosition,
      )
      const aboveThreshold = !dat || dat.length >= this.info.minHoveringAltitude.length

      // Calculate sine-wave oscillation
      // C#: WAngle(ticks % (Ticks * 4) * stepPercentage).Sin()
      // In C# WAngle.Sin() returns int in [-1024, 1024] representing sin*1024.
      // Equivalent TS: Math.sin(phaseRadians) in [-1, 1].
      const ticksPerCycle = this.info.ticks
      const rawPhase = (this._ticks % (ticksPerCycle * 4)) * this._stepPercentage
      // Convert WAngle units (0-256 = 0-360°) to radians for Math.sin
      const phaseRadians = (rawPhase / 256) * 2 * Math.PI
      const sinValue = Math.sin(phaseRadians)

      // C#: visualOffset = altitudeCheck ? angle.Sin() : 0
      const visualOffset = aboveThreshold ? sinValue : 0

      // C#: currentHeight = BobDistance.Length * visualOffset / 1024 + InitialHeight.Length
      let currentHeight = this.info.bobDistance.length * visualOffset +
        this.info.initialHeight.length

      // Rise smoothly from disabled state
      if (this.worldVisualOffset.Z < currentHeight) {
        const riseStep = Math.trunc(this.info.initialHeight.length / this.info.riseTicks)
        currentHeight = Math.min(
          this.worldVisualOffset.Z + riseStep,
          currentHeight,
        )
      }

      this.worldVisualOffset = new WVec(0, 0, Math.trunc(currentHeight))
      this._ticks++
    }
  }

  // ---------------------------------------------------------------------------
  // IRenderModifier
  // OpenRA 对照: IRenderModifier.ModifyRender / ModifyScreenBounds
  // ---------------------------------------------------------------------------

  /**
   * Offset all renderables by the current world visual offset.
   *
   * OpenRA 对照: IRenderModifier.ModifyRender()
   */
  modifyRender(
    _self: IGameActor,
    _wr: WorldRendererStub,
    r: readonly IRenderable[],
  ): readonly IRenderable[] {
    // Offset each renderable by the visual offset
    return r.map((renderable) => {
      // NOTE: In C#, Renderable.OffsetBy(WVec) returns a new Renderable.
      // We duck-type the offset application since IRenderable is a stub.
      const rAny = renderable as unknown as Record<string, unknown>
      if (typeof rAny['offsetBy'] === 'function') {
        return (rAny['offsetBy'] as (wvec: WVec) => IRenderable)(this.worldVisualOffset)
      }
      return renderable
    })
  }

  /**
   * Screen bounds are not modified by hover effect.
   *
   * OpenRA 对照: IRenderModifier.ModifyScreenBounds() — returns bounds unchanged
   */
  modifyScreenBounds(
    _self: IGameActor,
    _wr: WorldRendererStub,
    bounds: readonly RectangleStub[],
  ): readonly RectangleStub[] {
    return bounds
  }

}
