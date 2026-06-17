/**
 * Cloneable.ts — 可克隆标记特质（标记可被ClonesProducedUnits克隆的单位类型）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Cloneable.cs (29 lines)
 *
 * 核心范式转换:
 * - C# BitSet<CloneableType> → TypeScript Set<string> (type tags)
 * - C# TraitInfo<Cloneable> → TypeScript ITraitInfo with create()
 * - C# empty Cloneable marker class → TypeScript empty marker class
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// CloneableInfo
// OpenRA 对照: CloneableInfo : TraitInfo<Cloneable>
// ---------------------------------------------------------------------------

/** Configuration for the Cloneable marker trait.
 *
 * OpenRA 对照: CloneableInfo
 *
 * Used by ClonesProducedUnits to identify which produced units should be cloned.
 * The Types bitfield determines which cloneable categories this unit falls into.
 */
export class CloneableInfo implements ITraitInfo {
  /** This unit's cloneable type tags.
   *
   * OpenRA 对照: CloneableInfo.Types (BitSet<CloneableType>)
   */
  readonly types: ReadonlySet<string>

  constructor(params?: { types?: ReadonlySet<string> }) {
    this.types = params?.types ?? new Set()
  }

  create(_init: IGameActor): Cloneable {
    return new Cloneable()
  }
}

// ---------------------------------------------------------------------------
// Cloneable — marker trait (no logic)
// OpenRA 对照: Cloneable { } (empty marker class)
// ---------------------------------------------------------------------------

/** Marker trait indicating this actor can be cloned by ClonesProducedUnits.
 *
 * OpenRA 对照: Cloneable
 *
 * This is a pure type-tag trait with no runtime logic. Its presence on an
 * actor combined with matching CloneableTypes enables the ClonesProducedUnits
 * trait to create a free duplicate when this unit is produced.
 */
export class Cloneable {
  // Intentionally empty — marker trait
}
