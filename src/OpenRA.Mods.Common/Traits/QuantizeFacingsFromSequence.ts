/**
 * QuantizeFacingsFromSequence.ts — Auto-detect facing count from sprite sequences
 * OpenRA 对照: OpenRA.Mods.Common/Traits/QuantizeFacingsFromSequence.cs (48 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTraitInfo + IQuantizeBodyOrientationInfo + Requires<RenderSpritesInfo>
 *   → TypeScript class implementing ConditionalTraitInfo + IQuantizeBodyOrientationInfo
 * - C# SequenceReference attribute → TypeScript JSDoc annotation
 * - C# SequenceSet.GetSequence(image, sequence).Facings → TS: accessible via provider
 * - C# ConditionalTrait<TInfo> base → TS: ConditionalTrait<QuantizeFacingsFromSequenceInfo>
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type ITraitInfoInterface,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IQuantizeBodyOrientationInfo } from './BodyOrientation.js'
import type { ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Sequence stub types (pending full SequenceProvider migration from Ch2)
// ---------------------------------------------------------------------------

/**
 * Minimal sequence data needed for facing auto-detection.
 *
 * OpenRA 对照: Sequence (from OpenRA.Graphics.Sequence)
 */
export interface SequenceStub {
  /** Number of facings in this sequence (8, 16, 32, etc.). */
  readonly Facings: number
}

/**
 * Minimal sequence provider needed for facing auto-detection.
 *
 * OpenRA 对照: SequenceSet (from OpenRA.Graphics.SequenceSet)
 */
export interface SequenceSetStub {
  getSequence(image: string, sequenceName: string): SequenceStub
}

/**
 * Minimal RenderSpritesInfo needed for GetImage lookup.
 *
 * OpenRA 对照: RenderSpritesInfo
 */
export interface RenderSpritesInfoStub {
  getImage(ai: ActorInfoStub, faction: string): string
}

// ---------------------------------------------------------------------------
// QuantizeFacingsFromSequenceInfo — trait configuration
// 对照: OpenRA.Mods.Common/Traits/QuantizeFacingsFromSequenceInfo
// ---------------------------------------------------------------------------

/**
 * Auto-detect facing count from the number of facings in a named sprite
 * sequence. Implements IQuantizeBodyOrientationInfo so BodyOrientation
 * can discover the facing count at runtime.
 *
 * OpenRA 对照: QuantizeFacingsFromSequenceInfo : ConditionalTraitInfo,
 *             IQuantizeBodyOrientationInfo, Requires<RenderSpritesInfo>
 *
 * NOTE: In C#, this has Requires<RenderSpritesInfo> — the actor must also
 * have a RenderSprites trait for this to work. In TypeScript, this
 * constraint is enforced by the caller.
 */
export class QuantizeFacingsFromSequenceInfo
  implements ConditionalTraitInfo, IQuantizeBodyOrientationInfo, ITraitInfoInterface
{
  /**
   * Conditional trait — name of the boolean condition that enables/disables
   * this trait. Empty means always enabled.
   *
   * OpenRA 对照: ConditionalTraitInfo.RequiresCondition
   */
  readonly requiresCondition?: string

  /**
   * Optional instance name for disambiguation.
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /**
   * Name of the sprite sequence to derive facings from.
   *
   * OpenRA 对照: Sequence (default "idle")
   */
  readonly sequence: string

  constructor(
    sequence: string = 'idle',
    requiresCondition?: string,
    instanceName?: string,
  ) {
    this.sequence = sequence
    this.requiresCondition = requiresCondition
    this.instanceName = instanceName
  }

  // -----------------------------------------------------------------------
  // IQuantizeBodyOrientationInfo
  // -----------------------------------------------------------------------

  /**
   * Determine the number of facings by inspecting the named sprite sequence.
   *
   * OpenRA 对照: QuantizeFacingsFromSequenceInfo.QuantizedBodyFacings(
   *             ActorInfo, SequenceSet, string)
   *
   * Steps:
   * 1. Validate the sequence name is not empty
   * 2. Look up RenderSpritesInfo on the actor to get the sprite image name
   * 3. Look up the sequence in the sequence provider
   * 4. Return the sequence's Facings count
   *
   * @param ai — actor info (must have RenderSpritesInfo-like trait)
   * @param sequences — sequence provider (SequenceSetStub)
   * @param faction — faction identifier for image lookup
   * @returns number of facings in the sequence
   * @throws Error if sequence name is empty or facings count is zero
   */
  quantizedBodyFacings(
    ai: ActorInfoStub,
    sequences: unknown,
    faction: string,
  ): number {
    if (!this.sequence || this.sequence.length === 0) {
      throw new Error(
        `Actor ${ai.name} is missing sequence to quantize facings from.`,
      )
    }

    const seqSet = sequences as SequenceSetStub

    // Look up RenderSpritesInfo to get the image name.
    // In C#: ai.TraitInfo<RenderSpritesInfo>().GetImage(ai, faction)
    // For the TS stub, the actor info must provide access to a
    // RenderSpritesInfoStub via a known key or cast.
    const rsi = (ai as ActorInfoStub & { getRenderSpritesInfo?(): RenderSpritesInfoStub })
    const image = rsi.getRenderSpritesInfo
      ? rsi.getRenderSpritesInfo().getImage(ai, faction)
      : ''

    const facings = seqSet.getSequence(image, this.sequence).Facings
    if (facings === 0) {
      throw new Error(
        `Actor ${ai.name} defines a quantized body orientation with zero facings. ` +
          `Faction: ${faction} Image: ${image} Sequence: ${this.sequence}`,
      )
    }
    return facings
  }
}

// ---------------------------------------------------------------------------
// QuantizeFacingsFromSequence — runtime trait instance
// 对照: OpenRA.Mods.Common/Traits/QuantizeFacingsFromSequence
// ---------------------------------------------------------------------------

/**
 * Runtime trait for auto-detecting facings from a sprite sequence.
 *
 * OpenRA 对照: QuantizeFacingsFromSequence : ConditionalTrait<QuantizeFacingsFromSequenceInfo>
 *
 * This is a simple wrapper — all the logic is in QuantizeFacingsFromSequenceInfo.
 * The trait exists on the actor so BodyOrientation can discover it as an
 * IQuantizeBodyOrientationInfo provider.
 */
export class QuantizeFacingsFromSequence extends ConditionalTrait<QuantizeFacingsFromSequenceInfo> {
  /**
   * Construct the runtime trait.
   *
   * OpenRA 对照: QuantizeFacingsFromSequence(QuantizeFacingsFromSequenceInfo)
   *
   * @param info — the trait configuration
   */
  constructor(info: QuantizeFacingsFromSequenceInfo) {
    super(info)
  }
}
