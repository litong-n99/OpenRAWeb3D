/**
 * ClassicFacingBodyOrientation.ts — C&C经典朝向计算（8方向+非线性32方向映射）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/ClassicFacingBodyOrientation.cs
 *
 * 核心范式转换:
 * - C# Util.ClassicQuantizeFacing → TypeScript static exported function
 * - C# non-linear 32-facing sprite mapping → TypeScript const lookup arrays
 * - C# TraitInfo.Create(ActorInitializer) → TypeScript constructor-based creation
 *
 * C&C classic games (TD, RA) use a non-linear mapping between artwork frames
 * and unit facings for sprites with 32 directions. For 8-facing sprites,
 * the standard linear quantization is used instead.
 *
 * This trait defaults QuantizedFacings to 8 (C&C classic standard).
 */

import { WAngle } from '../../OpenRA.Game/WAngle.js'
import {
  BodyOrientationInfo,
  BodyOrientation,
} from '../../OpenRA.Mods.Common/Traits/BodyOrientation.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Classic facing mapping tables (对照 OpenRA.Mods.Cnc.Util)
// ---------------------------------------------------------------------------

/**
 * Non-linear sprite frame ranges for 32-direction sprites.
 *
 * OpenRA 对照: Util.SpriteRanges
 *
 * TD and RA used a nonlinear mapping between artwork frames and unit facings
 * for units with 32 facings. This table defines the exclusive maximum facing
 * for the i'th sprite frame.
 * i.e. sprite frame 1 is used for facings 20-55, sprite frame 2 for 56-87,
 * and so on. Sprite frame 0 is used for facings smaller than 20 or larger
 * than 999.
 */
const SPRITE_RANGES: readonly number[] = [
  20, 56, 88, 132, 156, 184, 212, 240,
  268, 296, 324, 352, 384, 416, 452, 488,
  532, 568, 604, 644, 668, 696, 724, 752,
  780, 808, 836, 864, 896, 928, 964, 1000,
]

/**
 * The actual facing associated with each sprite frame for 32-direction sprites.
 *
 * OpenRA 对照: Util.SpriteFacings
 */
const SPRITE_FACINGS: readonly WAngle[] = [
  WAngle.Zero, new WAngle(40), new WAngle(74), new WAngle(112),
  new WAngle(146), new WAngle(172), new WAngle(200), new WAngle(228),
  new WAngle(256), new WAngle(284), new WAngle(312), new WAngle(340),
  new WAngle(370), new WAngle(402), new WAngle(436), new WAngle(472),
  new WAngle(512), new WAngle(552), new WAngle(588), new WAngle(626),
  new WAngle(658), new WAngle(684), new WAngle(712), new WAngle(740),
  new WAngle(768), new WAngle(796), new WAngle(824), new WAngle(852),
  new WAngle(882), new WAngle(914), new WAngle(948), new WAngle(984),
]

// ---------------------------------------------------------------------------
// Classic facing quantization (对照 OpenRA.Mods.Cnc.Util)
// ---------------------------------------------------------------------------

/**
 * Calculate the frame index (0..numFrames-1) for the given facing value,
 * accounting for the non-linear facing mapping for sprites with 32 directions.
 *
 * OpenRA 对照: Util.ClassicIndexFacing(WAngle, int)
 *
 * For 32-frame sprites: linear scan through SPRITE_RANGES to find
 * the smallest index i where angle < SPRITE_RANGES[i]. Returns 0 if
 * angle is >= all ranges (wraps around).
 * For other frame counts: delegates to standard BodyOrientationInfo._indexFacing.
 *
 * @param facing — the facing angle to index
 * @param numFrames — number of sprite frames
 */
export function classicIndexFacing(facing: WAngle, numFrames: number): number {
  if (numFrames === 32) {
    const angle = facing.angle
    for (let i = 0; i < SPRITE_RANGES.length; i++) {
      if (angle < SPRITE_RANGES[i]) return i
    }
    return 0
  }

  return BodyOrientationInfo._indexFacing(facing, numFrames)
}

/**
 * Round the given facing value to the nearest quantized step,
 * accounting for the non-linear facing mapping for sprites with 32 directions.
 *
 * OpenRA 对照: Util.ClassicQuantizeFacing(WAngle, int)
 *
 * For 32 steps: look up the sprite frame index via classicIndexFacing,
 * then return the corresponding SPRITE_FACINGS value.
 * For other step counts: delegates to standard BodyOrientationInfo._quantizeFacingRaw.
 *
 * @param facing — the facing angle to quantize
 * @param steps — number of discrete facing steps
 */
export function classicQuantizeFacing(facing: WAngle, steps: number): WAngle {
  if (steps === 32) {
    return SPRITE_FACINGS[classicIndexFacing(facing, steps)]
  }

  return BodyOrientationInfo._quantizeFacingRaw(facing, steps)
}

// ---------------------------------------------------------------------------
// ClassicFacingBodyOrientationInfo — C&C trait configuration
// 对照: OpenRA.Mods.Cnc/Traits/ClassicFacingBodyOrientationInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for classic C&C facing quantization.
 *
 * OpenRA 对照: ClassicFacingBodyOrientationInfo : BodyOrientationInfo
 *
 * Overrides quantizeFacing to use the classic non-linear 32-facing mapping
 * for sprites with 32 directions. For 8-facing sprites (the C&C classic
 * standard), uses linear quantization like the base class.
 *
 * Defaults QuantizedFacings to 8 since C&C classic games use 8-directional
 * sprites for all units.
 */
export class ClassicFacingBodyOrientationInfo extends BodyOrientationInfo {
  /**
   * Create a ClassicFacingBodyOrientationInfo.
   *
   * OpenRA 对照: ClassicFacingBodyOrientationInfo (inherits BodyOrientationInfo)
   *
   * @param quantizedFacings — number of facings (default 8 for C&C classic)
   * @param cameraPitch — camera pitch angle for perspective correction
   * @param useClassicPerspectiveFudge — whether to apply perspective fudge
   */
  constructor(
    quantizedFacings: number = 8,
    cameraPitch: WAngle = WAngle.fromDegrees(40),
    useClassicPerspectiveFudge: boolean = true,
  ) {
    super(quantizedFacings, cameraPitch, useClassicPerspectiveFudge)
  }

  // -----------------------------------------------------------------------
  // Facing quantization override
  // -----------------------------------------------------------------------

  /**
   * Snap a continuous facing to the nearest discrete facing step using
   * classic C&C quantization.
   *
   * OpenRA 对照: ClassicFacingBodyOrientationInfo.QuantizeFacing(WAngle, int)
   *
   * For 32 facings (0 excluded per OpenRA convention), uses the non-linear
   * SPRITE_FACINGS lookup table from TD/RA. For all other facing counts,
   * uses standard linear quantization.
   *
   * @param facing — continuous facing angle to quantize
   * @param facings — number of discrete facing steps (0 = no quantization)
   * @returns quantized facing snapped to nearest step
   */
  quantizeFacing(facing: WAngle, facings: number): WAngle {
    // Quantization disabled
    if (facings === 0) return facing

    return classicQuantizeFacing(facing, facings)
  }
}

// ---------------------------------------------------------------------------
// ClassicFacingBodyOrientation — C&C runtime trait
// 对照: OpenRA.Mods.Cnc/Traits/ClassicFacingBodyOrientation
// ---------------------------------------------------------------------------

/**
 * Runtime trait for C&C classic body orientation.
 *
 * OpenRA 对照: ClassicFacingBodyOrientation : BodyOrientation
 *
 * Thin wrapper — all logic is in ClassicFacingBodyOrientationInfo.
 * Exists as a distinct type so the game can differentiate between
 * classic (C&C TD/RA) and standard body orientation behavior.
 *
 * Because ClassicFacingBodyOrientationInfo defaults QuantizedFacings to 8,
 * this trait does not need an IQuantizeBodyOrientationInfo provider.
 */
export class ClassicFacingBodyOrientation extends BodyOrientation {
  /**
   * Construct a ClassicFacingBodyOrientation.
   *
   * OpenRA 对照: ClassicFacingBodyOrientation(ActorInitializer, ClassicFacingBodyOrientationInfo)
   *
   * @param info — the C&C classic body orientation configuration
   * @param actor — the actor this trait belongs to
   */
  constructor(info: ClassicFacingBodyOrientationInfo, actor: IGameActor) {
    super(info, actor)
  }
}
