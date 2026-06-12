/**
 * Armor.ts -- Type tag for armor classification of an actor
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Armor.cs (30 lines)
 *
 * 核心范式转换:
 * - C# ArmorType marker class → string-based armor type identifier
 * - C# ConditionalTrait<ArmorInfo> → TS ConditionalTrait<ArmorInfo>
 *
 * Armor is purely a type tag -- the ArmorType string is in ArmorInfo.Type.
 * Warheads query armor types via actor traits to determine damage reduction.
 */

import { ConditionalTrait, type ConditionalTraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ArmorInfo
// OpenRA 对照: ArmorInfo
// ---------------------------------------------------------------------------

/** Configuration for the Armor trait.
 *
 *  OpenRA 对照: ArmorInfo (ConditionalTraitInfo)
 */
export class ArmorInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** The armor type identifier string (e.g., "None", "Light", "Heavy").
   *
   *  OpenRA 对照: ArmorInfo.Type
   */
  readonly type: string

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    type?: string
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.type = params.type ?? ''
  }
}

// ---------------------------------------------------------------------------
// Armor
// OpenRA 对照: Armor
// ---------------------------------------------------------------------------

/** Type tag trait for armor classification.
 *
 *  OpenRA 对照: Armor (ConditionalTrait<ArmorInfo>)
 *
 *  Purely a type tag -- the ArmorType string is in ArmorInfo.Type.
 *  No runtime logic. The armor type is queried by warheads.
 */
export class Armor extends ConditionalTrait<ArmorInfo> {
  constructor(info: ArmorInfo) {
    super(info)
  }
}
