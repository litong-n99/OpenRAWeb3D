/**
 * BodyOrientation.ts — Facing quantization for sprite rendering
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BodyOrientation.cs (127 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo { Create() } → TypeScript class with static methods
 * - C# Lazy<int> → TypeScript memoized getter (compute on first access)
 * - C# ISync marker interface → TypeScript ISync interface
 * - C# Util.QuantizeFacing → TypeScript static method within this module
 * - C# in parameter modifier → TypeScript readonly references
 */

import { WVec } from '../../OpenRA.Game/WVec.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type {
  ISync,
  ActorInfoStub,
  IGameActor,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IQuantizeBodyOrientationInfo (shared interface)
// 对照: OpenRA.Mods.Common/TraitsInterfaces.cs
// ---------------------------------------------------------------------------

/**
 * Interface for traits that can provide body facing quantization info.
 *
 * OpenRA 对照: IQuantizeBodyOrientationInfo : ITraitInfoInterface
 *
 * Implemented by QuantizeFacingsFromSequenceInfo (and potentially other traits)
 * to auto-detect the number of facings from sprite sequence data.
 */
export interface IQuantizeBodyOrientationInfo {
  /**
   * Determine the number of quantized body facings for an actor.
   *
   * OpenRA 对照: IQuantizeBodyOrientationInfo.QuantizedBodyFacings(ActorInfo, SequenceSet, string)
   *
   * @param ai — actor info (provides name, trait lookups)
   * @param sequences — sequence provider (type: unknown, pending SequenceSet migration)
   * @param faction — faction identifier string
   * @returns number of discrete facings (e.g. 8, 16, 32)
   * @throws Error if facings count is zero or sequence is missing
   */
  quantizedBodyFacings(
    ai: ActorInfoStub,
    sequences: unknown,
    faction: string,
  ): number
}

// ---------------------------------------------------------------------------
// BodyOrientationInfo — trait configuration
// 对照: OpenRA.Mods.Common/Traits/BodyOrientationInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for body orientation facing quantization.
 *
 * OpenRA 对照: BodyOrientationInfo : TraitInfo
 *
 * Controls how a sprite actor's continuous facing angle is snapped to
 * discrete sprite facings. The number of facings is either configured
 * explicitly or auto-detected from a IQuantizeBodyOrientationInfo trait.
 */
export class BodyOrientationInfo {
  /**
   * Number of facings for gameplay calculations.
   * -1 indicates auto-detection from another trait.
   * 0 disables quantization.
   *
   * OpenRA 对照: QuantizedFacings (default -1)
   */
  readonly quantizedFacings: number

  /**
   * Camera pitch for rotation calculations.
   *
   * OpenRA 对照: CameraPitch (default WAngle.FromDegrees(40))
   */
  readonly cameraPitch: WAngle

  /**
   * Fudge the coordinate system angles to simulate non-top-down perspective
   * in mods with square cells.
   *
   * OpenRA 对照: UseClassicPerspectiveFudge (default true)
   */
  readonly useClassicPerspectiveFudge: boolean

  constructor(
    quantizedFacings: number = -1,
    cameraPitch: WAngle = WAngle.fromDegrees(40),
    useClassicPerspectiveFudge: boolean = true,
  ) {
    this.quantizedFacings = quantizedFacings
    this.cameraPitch = cameraPitch
    this.useClassicPerspectiveFudge = useClassicPerspectiveFudge
  }

  // -----------------------------------------------------------------------
  // Coordinate system
  // -----------------------------------------------------------------------

  /**
   * Convert a local-space vector to world-space.
   *
   * OpenRA 对照: BodyOrientationInfo.LocalToWorld(in WVec)
   *
   * When UseClassicPerspectiveFudge is true, the Y axis is fudged to
   * simulate non-top-down perspective in mods with square cells.
   * When false, the vector is simply rotated by 90 degrees.
   *
   * @param vec — vector in local (actor-forward) space
   */
  localToWorld(vec: WVec): WVec {
    if (!this.useClassicPerspectiveFudge) {
      // Rotate by 90 degrees
      return new WVec(vec.Y, -vec.X, vec.Z)
    }

    // The 2d perspective of older games with square cells doesn't correspond
    // to an orthonormal 3D coordinate system, so fudge the y axis to make
    // things look good
    return new WVec(
      vec.Y,
      -Math.trunc((this.cameraPitch.sin() * vec.X) / 1024),
      vec.Z,
    )
  }

  // -----------------------------------------------------------------------
  // Facing quantization
  // -----------------------------------------------------------------------

  /**
   * Snap a continuous facing to the nearest discrete facing step.
   *
   * OpenRA 对照: BodyOrientationInfo.QuantizeFacing(WAngle, int)
   *
   * Uses integer math in the WAngle 0-1024 space for determinism:
   * 1. Compute step = 1024 / facings
   * 2. Find nearest step index: indexFacing = (angle + step/2) & 1023 / step
   * 3. Result = new WAngle(indexFacing * (1024 / facings))
   *
   * @param facing — continuous facing angle to quantize
   * @param facings — number of discrete facing steps (0 = no quantization)
   * @returns quantized facing snapped to nearest step
   */
  quantizeFacing(facing: WAngle, facings: number): WAngle {
    // Quantization disabled
    if (facings === 0) return facing

    return BodyOrientationInfo._quantizeFacingRaw(facing, facings)
  }

  /**
   * Quantize a rotation: snap yaw to nearest discrete step,
   * zero out roll and pitch.
   *
   * OpenRA 对照: BodyOrientationInfo.QuantizeOrientation(in WRot, int)
   *
   * Quantized rotations have no roll or pitch — only yaw.
   *
   * @param orientation — rotation to quantize
   * @param facings — number of discrete facings (0 = no quantization)
   */
  quantizeOrientation(orientation: WRot, facings: number): WRot {
    // Quantization disabled
    if (facings === 0) return orientation

    // Map yaw to the closest facing
    const facing = this.quantizeFacing(orientation.yaw, facings)

    // Roll and pitch are always zero if yaw is quantized
    return WRot.fromYaw(facing)
  }

  // -----------------------------------------------------------------------
  // Internal — raw quantization (exposed for testing)
  // -----------------------------------------------------------------------

  /**
   * Raw quantize facing using integer math in the WAngle 0-1024 space.
   *
   * OpenRA 对照: Util.QuantizeFacing(WAngle, int) + Util.IndexFacing(WAngle, int)
   *
   * This is a pure function: given a facing and step count, returns the
   * nearest discrete facing without any config-dependent logic.
   *
   * @internal — exposed for unit testing
   */
  static _quantizeFacingRaw(facing: WAngle, facings: number): WAngle {
    const step = Math.floor(1024 / facings)
    const index = BodyOrientationInfo._indexFacing(facing, facings)
    return new WAngle(index * step)
  }

  /**
   * Compute the discrete step index for a facing angle.
   *
   * OpenRA 对照: Util.IndexFacing(WAngle, int)
   *
   * Uses integer math:
   * - step = 1024 / numFrames (integer division)
   * - a = (facing.angle + step / 2) & 1023 (add half-step offset, wrap)
   * - returns floor(a / step)
   *
   * @internal — exposed for unit testing
   */
  static _indexFacing(facing: WAngle, numFrames: number): number {
    const step = Math.floor(1024 / numFrames)
    const a = (facing.angle + Math.floor(step / 2)) & 1023
    return Math.floor(a / step)
  }
}

// ---------------------------------------------------------------------------
// BodyOrientation — runtime trait instance
// 对照: OpenRA.Mods.Common/Traits/BodyOrientation (class, ISync)
// ---------------------------------------------------------------------------

/**
 * Runtime body orientation trait for a sprite actor.
 *
 * OpenRA 对照: BodyOrientation : ISync
 *
 * Manages facing quantization at runtime. The quantizedFacings value is
 * lazily computed: either from the configured value in the info, or by
 * querying an IQuantizeBodyOrientationInfo trait on the actor.
 *
 * Implements ISync because quantized facing affects network sync hashes.
 */
export class BodyOrientation implements ISync {
  readonly info: BodyOrientationInfo

  /** Cached quantized facings count. Computed lazily on first access. */
  private _quantizedFacings: number | null = null

  /**
   * Actor info reference for trait lookups during lazy init.
   *
   * OpenRA 对照: self.Info (ActorInfo)
   */
  private readonly _actorInfo: ActorInfoStub | undefined

  /**
   * Optional IQuantizeBodyOrientationInfo provider.
   * If null and quantizedFacings < 0, the constructor will throw.
   */
  private readonly _qboi: IQuantizeBodyOrientationInfo | null

  /**
   * Optional sequences provider for auto-detection.
   */
  private readonly _sequences: unknown

  /**
   * Faction name for sprite sequence lookup.
   */
  private readonly _faction: string

  /**
   * Construct a BodyOrientation trait.
   *
   * OpenRA 对照: BodyOrientation(ActorInitializer, BodyOrientationInfo)
   *
   * If info.quantizedFacings >= 0, that value is used directly.
   * Otherwise, the IQuantizeBodyOrientationInfo trait on the actor is queried.
   * If neither is available, an error is thrown.
   *
   * @param actor — the actor this trait belongs to
   * @param info — the trait configuration
   * @param qboi — optional IQuantizeBodyOrientationInfo provider (auto-detect)
   * @param sequences — optional sequences provider (for auto-detect)
   * @param faction — faction name (for auto-detect sequence lookup)
   */
  constructor(
    info: BodyOrientationInfo,
    actor: IGameActor,
    qboi: IQuantizeBodyOrientationInfo | null = null,
    sequences: unknown = null,
    faction: string = '',
  ) {
    this.info = info
    this._actorInfo = actor.info
    this._qboi = qboi
    this._sequences = sequences
    this._faction = faction
  }

  // -----------------------------------------------------------------------
  // Quantized facings (lazy init)
  // -----------------------------------------------------------------------

  /**
   * Number of quantized facings for this actor.
   *
   * OpenRA 对照: BodyOrientation.QuantizedFacings (lazy, [VerifySync])
   *
   * Computed lazily on first access:
   * - If info.quantizedFacings >= 0, use that
   * - Otherwise query IQuantizeBodyOrientationInfo trait
   * - Throw if no provider is available
   */
  get quantizedFacings(): number {
    if (this._quantizedFacings !== null) return this._quantizedFacings

    // Override value is set
    if (this.info.quantizedFacings >= 0) {
      this._quantizedFacings = this.info.quantizedFacings
      return this._quantizedFacings
    }

    const qboi = this._qboi

    // If a sprite actor has neither custom QuantizedFacings nor a trait
    // implementing IQuantizeBodyOrientationInfo, throw
    const actorName = this._actorInfo?.name ?? '(unknown)'

    if (qboi === null) {
      throw new Error(
        `Actor type '${actorName}' does not define a quantized body orientation. ` +
          'Either add the QuantizeFacingsFromSequence trait or set custom QuantizedFacings on BodyOrientation.',
      )
    }

    const facings = qboi.quantizedBodyFacings(
      this._actorInfo ?? { name: actorName },
      this._sequences,
      this._faction,
    )
    if (facings === 0) {
      throw new Error(
        `Actor ${actorName} defines a quantized body orientation from ` +
          `IQuantizeBodyOrientationInfo with zero facings.`,
      )
    }

    this._quantizedFacings = facings
    return this._quantizedFacings
  }

  // -----------------------------------------------------------------------
  // Camera pitch
  // -----------------------------------------------------------------------

  /**
   * Camera pitch angle for perspective correction.
   *
   * OpenRA 对照: BodyOrientation.CameraPitch
   */
  get cameraPitch(): WAngle {
    return this.info.cameraPitch
  }

  // -----------------------------------------------------------------------
  // Coordinate system conversion
  // -----------------------------------------------------------------------

  /**
   * Convert a local-space vector to world-space.
   *
   * OpenRA 对照: BodyOrientation.LocalToWorld(in WVec)
   *
   * @param vec — vector in local (actor-forward) space
   */
  localToWorld(vec: WVec): WVec {
    return this.info.localToWorld(vec)
  }

  // -----------------------------------------------------------------------
  // Facing quantization (delegates to info)
  // -----------------------------------------------------------------------

  /**
   * Quantize a rotation using this actor's facing count.
   *
   * OpenRA 对照: BodyOrientation.QuantizeOrientation(in WRot)
   *
   * @param orientation — rotation to quantize
   */
  quantizeOrientation(orientation: WRot): WRot {
    return this.info.quantizeOrientation(orientation, this.quantizedFacings)
  }

  /**
   * Quantize a facing using this actor's facing count.
   *
   * OpenRA 对照: BodyOrientation.QuantizeFacing(WAngle)
   *
   * @param facing — facing angle to quantize
   */
  quantizeFacing(facing: WAngle): WAngle
  /**
   * Quantize a facing using an explicit facing count.
   *
   * OpenRA 对照: BodyOrientation.QuantizeFacing(WAngle, int)
   *
   * @param facing — facing angle to quantize
   * @param facings — explicit number of discrete facings
   */
  quantizeFacing(facing: WAngle, facings: number): WAngle
  quantizeFacing(facing: WAngle, facings?: number): WAngle {
    if (facings !== undefined) {
      return this.info.quantizeFacing(facing, facings)
    }
    return this.info.quantizeFacing(facing, this.quantizedFacings)
  }
}
