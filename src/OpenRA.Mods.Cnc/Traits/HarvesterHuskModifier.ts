/**
 * HarvesterHuskModifier.ts — 自定义矿车残骸外观
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/HarvesterHuskModifier.cs (39 lines)
 *
 * 核心范式转换:
 * - C# IHuskModifier.HuskActor() → TypeScript IHuskModifier interface
 * - C# Trait<Harvester>() lookup → TypeScript getComponent pattern
 * - C# Fullness > FullnessThreshold check → TypeScript same logic
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// HarvesterHuskModifierInfo
// OpenRA 对照: HarvesterHuskModifierInfo : TraitInfo, Requires<HarvesterInfo>
// ---------------------------------------------------------------------------

/** Configuration for custom harvester husk appearance.
 *
 * OpenRA 对照: HarvesterHuskModifierInfo
 */
export class HarvesterHuskModifierInfo implements ITraitInfo {
  /** Custom husk actor to spawn when harvester has high fullness.
   *
   * OpenRA 对照: HarvesterHuskModifierInfo.FullHuskActor
   */
  readonly fullHuskActor: string | null

  /** Resource fullness percentage threshold for custom husk.
   *
   * OpenRA 对照: HarvesterHuskModifierInfo.FullnessThreshold
   */
  readonly fullnessThreshold: number

  constructor(params?: {
    fullHuskActor?: string | null
    fullnessThreshold?: number
  }) {
    this.fullHuskActor = params?.fullHuskActor ?? null
    this.fullnessThreshold = params?.fullnessThreshold ?? 50
  }

  create(_init: IGameActor): HarvesterHuskModifier {
    return new HarvesterHuskModifier(this)
  }
}

// ---------------------------------------------------------------------------
// HarvesterHuskModifier
// OpenRA 对照: HarvesterHuskModifier : IHuskModifier
// ---------------------------------------------------------------------------

/** Overrides the default harvester husk actor based on resource fullness.
 *
 * OpenRA 对照: HarvesterHuskModifier
 *
 * When a harvester is destroyed, this trait can replace the default husk
 * with a different actor type if the harvester was carrying enough resources.
 */
export class HarvesterHuskModifier {
  readonly info: HarvesterHuskModifierInfo

  constructor(info: HarvesterHuskModifierInfo) {
    this.info = info
  }

  /** Get the husk actor type for the harvester.
   *
   * OpenRA 对照: IHuskModifier.HuskActor(Actor)
   *
   * @param self — the harvester actor being destroyed
   * @returns the full husk actor name if fullness exceeds threshold, null otherwise
   */
  huskActor(self: IGameActor): string | null {
    // NOTE: Harvester trait lookup. In C#: self.Trait<Harvester>()
    const harvester = (self as any)._harvester
    if (!harvester || typeof harvester.fullness !== 'number') {
      // Fallback: check if the actor has a fullness property
      const fullness = (self as any).fullness as number | undefined
      if (fullness !== undefined && fullness > this.info.fullnessThreshold) {
        return this.info.fullHuskActor
      }
      return null
    }

    return harvester.fullness > this.info.fullnessThreshold
      ? this.info.fullHuskActor
      : null
  }
}
