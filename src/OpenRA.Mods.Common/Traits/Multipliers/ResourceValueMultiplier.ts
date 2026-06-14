/**
 * ResourceValueMultiplier.ts — Modifies the trade value of resources
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Multipliers/ResourceValueMultiplier.cs (31 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<ResourceValueMultiplierInfo>, IResourceValueModifier
 *   → TS ConditionalTrait<ResourceValueMultiplierInfo> implements IResourceValueModifier
 * - C# Modifier field default 100 → TS default 100
 * - When disabled (conditions not met), returns 100 (no modification)
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IResourceValueModifier,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ResourceValueMultiplierInfo
// OpenRA 对照: ResourceValueMultiplierInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for ResourceValueMultiplier trait.
 *
 *  OpenRA 对照: ResourceValueMultiplierInfo
 */
export class ResourceValueMultiplierInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Percentage modifier to apply (100 = normal, 200 = double value).
   *
   *  OpenRA 对照: ResourceValueMultiplierInfo.Modifier
   */
  readonly modifier: number = 100

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    modifier?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.modifier = params.modifier ?? 100
  }
}

// ---------------------------------------------------------------------------
// ResourceValueMultiplier
// OpenRA 对照: ResourceValueMultiplier (ConditionalTrait<ResourceValueMultiplierInfo>, IResourceValueModifier)
// ---------------------------------------------------------------------------

/** Modifies the value of resources delivered to this actor.
 *
 *  OpenRA 对照: ResourceValueMultiplier
 *
 *  When the trait is active, the resource value is multiplied by Modifier
 *  (percentage). When disabled (conditions not met), returns 100 (no change).
 *  Multiple IResourceValueModifier traits on the same actor multiply together.
 *
 *  Example: Modifier=200 doubles the cash value of resources delivered.
 */
export class ResourceValueMultiplier
  extends ConditionalTrait<ResourceValueMultiplierInfo>
  implements IResourceValueModifier
{
  constructor(info: ResourceValueMultiplierInfo) {
    super(info)
  }

  /** Get the current resource value modifier percentage.
   *
   *  OpenRA 对照: IResourceValueModifier.GetResourceValueModifier()
   *
   *  @returns percentage modifier (100 = normal value, 200 = double value),
   *           or 100 when the trait is disabled
   */
  getResourceValueModifier(): number {
    return this.isTraitDisabled ? 100 : this.info.modifier
  }
}
