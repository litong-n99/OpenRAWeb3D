/**
 * ClonesProducedUnits.ts — 克隆已生产的单位（免费复制）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Buildings/ClonesProducedUnits.cs (76 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<ClonesProducedUnitsInfo> → TypeScript ConditionalTrait
 * - C# INotifyOtherProduction.UnitProducedByOther() → TypeScript production notification
 * - C# BitSet<CloneableType>.Overlaps() → TypeScript Set intersection check
 * - C# TypeDictionary → TypeScript Map<string, unknown> for init values
 * - C# Production.Produce() → TypeScript production trait method call
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ConditionalTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ClonesProducedUnitsInfo
// OpenRA 对照: ClonesProducedUnitsInfo : ConditionalTraitInfo, Requires<ProductionInfo>, Requires<ExitInfo>
// ---------------------------------------------------------------------------

/** Configuration for cloning produced units.
 *
 * OpenRA 对照: ClonesProducedUnitsInfo
 */
export class ClonesProducedUnitsInfo implements ITraitInfo {
  /** Cloneable type tags that enable cloning.
   *
   * OpenRA 对照: ClonesProducedUnitsInfo.CloneableTypes (BitSet<CloneableType>)
   */
  readonly cloneableTypes: ReadonlySet<string>

  /** Production type category (e.g., Infantry, Vehicles, Aircraft, Buildings).
   *
   * OpenRA 对照: ClonesProducedUnitsInfo.ProductionType
   */
  readonly productionType: string

  constructor(params?: {
    cloneableTypes?: ReadonlySet<string>
    productionType?: string
  }) {
    this.cloneableTypes = params?.cloneableTypes ?? new Set()
    this.productionType = params?.productionType ?? ''
  }

  create(init: IGameActor): ClonesProducedUnits {
    return new ClonesProducedUnits(init, this)
  }
}

// ---------------------------------------------------------------------------
// ClonesProducedUnits
// OpenRA 对照: ClonesProducedUnits : ConditionalTrait<...>, INotifyOtherProduction
// ---------------------------------------------------------------------------

/** Creates a free duplicate of produced units.
 *
 * OpenRA 对照: ClonesProducedUnits
 *
 * When another production building produces a Cloneable unit, this trait
 * produces a free copy at its own exit point, using the same faction.
 */
export class ClonesProducedUnits extends ConditionalTrait<ClonesProducedUnitsInfo> {
  /** Array of Production traits on this actor.
   *
   * OpenRA 对照: ClonesProducedUnits.productionTraits (Production[])
   */
  private readonly _productionTraits: IGameActor[]

  constructor(self: IGameActor, info: ClonesProducedUnitsInfo) {
    super(info)
    // C#: productionTraits = init.Self.TraitsImplementing<Production>().ToArray()
    this._productionTraits =
      (self as any).traitsImplementing?.('Production') ?? []
  }

  // -------------------------------------------------------------------------
  // INotifyOtherProduction
  // -------------------------------------------------------------------------

  /** Called when another actor produces a unit.
   *
   * OpenRA 对照: INotifyOtherProduction.UnitProducedByOther(Actor, Actor, Actor, string, TypeDictionary)
   *
   * @param self — this actor
   * @param producer — the actor that produced the unit
   * @param produced — the newly produced actor
   * @param _productionType — type name of production (e.g., "Infantry")
   * @param init — initializer dictionary for the produced unit
   */
  unitProducedByOther(
    self: IGameActor,
    producer: IGameActor,
    produced: IGameActor,
    _productionType: string,
    init: Map<string, unknown>,
  ): void {
    if (this.isTraitDisabled) return

    // No recursive cloning
    if (
      (producer as any).owner?.id !== (self as any).owner?.id ||
      (producer as any).info?.hasTraitInfo?.('ClonesProducedUnits')
    ) {
      return
    }

    // Check if the produced unit has Cloneable with matching types
    const cloneableInfo = (produced as any).info?.getTraitInfo?.('Cloneable')
    if (!cloneableInfo) return

    const cloneableTypes = cloneableInfo.types as Set<string> | undefined
    if (!cloneableTypes) return

    // C#: !Info.CloneableTypes.Overlaps(ci.Types)
    const hasOverlap = [...this.info.cloneableTypes].some((t) =>
      cloneableTypes.has(t),
    )
    if (!hasOverlap) return

    // Try each production trait until one succeeds
    for (const p of this._productionTraits) {
      if (
        this.info.productionType &&
        !(p as any).info?.produces?.has?.(this.info.productionType)
      ) {
        continue
      }

      const factionInit = init.get('FactionInit')
      const cloneInits = new Map<string, unknown>()
      cloneInits.set('OwnerInit', (self as any).owner)
      if (factionInit !== undefined) {
        cloneInits.set('FactionInit', factionInit)
      }

      const produceFn = (p as any).produce as
        | ((
            self: IGameActor,
            info: unknown,
            type: string,
            inits: Map<string, unknown>,
            cost: number,
          ) => boolean)
        | undefined

      if (produceFn) {
        const producedInfo = (produced as any).info
        if (produceFn(self, producedInfo, this.info.productionType, cloneInits, 0)) {
          return
        }
      }
    }
  }
}
