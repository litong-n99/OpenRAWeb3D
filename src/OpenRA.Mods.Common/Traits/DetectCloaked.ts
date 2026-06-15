/**
 * DetectCloaked.ts — Actor can reveal Cloak actors in a specified range
 * OpenRA 对照: OpenRA.Mods.Common/Traits/DetectCloaked.cs (54 lines C#)
 *
 * 核心范式转换:
 * - C# BitSet<DetectionType> → TS readonly DetectionType[] (array of type tags)
 * - C# ConditionalTrait<DetectCloakedInfo> → TS ConditionalTrait<DetectCloakedInfo>
 * - C# self.TraitsImplementing<IDetectCloakedModifier>() → TS traitsImplementing('IDetectCloakedModifier')
 * - C# Util.ApplyPercentageModifiers → TS applyPercentageModifiers from MissileMath
 * - C# base.Created(self) in overridden Created → TS INotifyCreated.created()
 */

import { WDist } from '../../OpenRA.Game/WDist.js'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type INotifyCreated,
  type IDetectCloakedModifier,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { applyPercentageModifiers } from '../Projectiles/MissileMath.js'
import type { DetectionType } from './Cloak.js'

// ---------------------------------------------------------------------------
// DetectCloakedInfo (对应 OpenRA DetectCloakedInfo)
// ---------------------------------------------------------------------------

/** Configuration for the DetectCloaked trait.
 *
 * OpenRA 对照: DetectCloakedInfo : ConditionalTraitInfo
 *
 * Specifies which cloak classifications this actor can detect and at what range.
 */
export class DetectCloakedInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Specific cloak classifications I can reveal.
   *
   * OpenRA 对照: DetectCloakedInfo.DetectionTypes (BitSet<DetectionType>)
   *
   * Default: [{ name: 'Cloak' }]
   */
  readonly detectionTypes: readonly DetectionType[] = [{ name: 'Cloak' }]

  /** Maximum range at which cloaked actors can be detected.
   *
   * OpenRA 对照: DetectCloakedInfo.Range (WDist, default WDist.FromCells(5))
   */
  readonly range: WDist = WDist.fromCells(5)

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    detectionTypes?: readonly DetectionType[]
    range?: WDist
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.detectionTypes = params.detectionTypes ?? [{ name: 'Cloak' }]
    this.range = params.range ?? WDist.fromCells(5)
  }
}

// ---------------------------------------------------------------------------
// DetectCloaked (对应 OpenRA DetectCloaked)
// ---------------------------------------------------------------------------

/** Actor can reveal Cloak actors in a specified range.
 *
 * OpenRA 对照: DetectCloaked : ConditionalTrait<DetectCloakedInfo>
 *
 * When enabled, this trait detects cloaked actors within the configured
 * range. Detection range can be modified by IDetectCloakedModifier traits
 * on the same actor. When the trait is disabled, the effective range is
 * WDist.Zero (no detection).
 */
export class DetectCloaked
  extends ConditionalTrait<DetectCloakedInfo>
  implements INotifyCreated
{
  /** Trait dictionary registration keys.
   *
   * OpenRA 对照: N/A (C# uses reflection; TS uses explicit string registration)
   */
  static readonly interfaces: string[] = [
    'IDetectCloaked',
    'INotifyCreated',
    'DetectCloaked',
    'ConditionalTrait',
    'component',
  ]

  /** Collected range percentage modifiers from IDetectCloakedModifier traits.
   *
   * OpenRA 对照: DetectCloaked.rangeModifiers (IDetectCloakedModifier[])
   *
   * Populated in {@link created} after the actor is fully initialized.
   * Applied in the {@link range} getter via {@link applyPercentageModifiers}.
   */
  private _rangeModifiers: number[] = []

  constructor(info: DetectCloakedInfo) {
    super(info)
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated (对应 OpenRA Created)
  // ---------------------------------------------------------------------------

  /** Collect range modifiers after the actor is fully initialized.
   *
   * OpenRA 对照: DetectCloaked.Created(Actor self)
   *
   * Queries the actor's trait dictionary for IDetectCloakedModifier traits
   * and collects their percentage modifier values. These are applied in the
   * {@link range} getter via {@link applyPercentageModifiers}.
   */
  created(self: IGameActor): void {
    // Collect IDetectCloakedModifier range modifiers.
    // SAFETY: traitsImplementing is optional on IGameActor but exists at
    // runtime on all real actor implementations via the trait dictionary.
    const traitAny = self as any
    const modifierTraits = traitAny.traitsImplementing?.('IDetectCloakedModifier') ?? []
    this._rangeModifiers = (modifierTraits as IDetectCloakedModifier[]).map(
      (m) => m.getDetectCloakedModifier(),
    )
  }

  // ---------------------------------------------------------------------------
  // Range (对应 OpenRA Range property)
  // ---------------------------------------------------------------------------

  /** Effective detection range.
   *
   * OpenRA 对照: DetectCloaked.Range
   *
   * Returns WDist.Zero when the trait is disabled (condition not met).
   * Otherwise, applies IDetectCloakedModifier percentage modifiers to the
   * configured range via {@link applyPercentageModifiers}.
   */
  get range(): WDist {
    if (this.isTraitDisabled) return WDist.Zero

    if (this._rangeModifiers.length > 0) {
      const modified = applyPercentageModifiers(
        this.info.range.length,
        this._rangeModifiers,
      )
      return new WDist(modified)
    }

    return this.info.range
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  override dispose(): void {
    this._rangeModifiers = []
    super.dispose()
  }
}
