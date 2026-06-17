/**
 * DamagesConcreteWarhead.ts — D2K 混凝土损伤弹头
 * OpenRA 对照: OpenRA.Mods.D2k/Warheads/DamagesConcreteWarhead.cs (38 lines)
 *
 * 核心范式转换:
 * - C# Warhead.DoImpact(in Target, WarheadArgs) → TS doImpactInWorld()
 * - C# world.WorldActor.Trait<BuildableTerrainLayer>() → TS trait lookup
 * - C# layer.HitTile(cell, Damage) → TS method call (same signature)
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Warhead, type WarheadArgs, type WarheadEffect } from '../../OpenRA.Mods.Common/Warheads/Warhead.js'

// ---------------------------------------------------------------------------
// Forward interface: BuildableTerrainLayer (minimal, avoids circular deps)
// ---------------------------------------------------------------------------

/** Minimal interface for BuildableTerrainLayer used by DamagesConcreteWarhead.
 *
 * OpenRA 对照: BuildableTerrainLayer.HitTile(CPos, int)
 */
export interface IBuildableTerrainLayerAccess {
  hitTile(cell: { X: number; Y: number }, damage: number): void
}

// ---------------------------------------------------------------------------
// DamagesConcreteWarheadInfo
// ---------------------------------------------------------------------------

/** Configuration for DamagesConcreteWarhead.
 *
 * OpenRA 对照: DamagesConcreteWarhead class (extends Warhead)
 *
 * Note: In OpenRA C#, DamagesConcreteWarhead has no separate Info class.
 * It directly reads `Damage` from its own fields. In TS, config is read
 * from JSON via loadFromJSON().
 */
export class DamagesConcreteWarhead extends Warhead {
  /** How much damage to deal to the concrete layer.
   *
   * OpenRA 对照: DamagesConcreteWarhead.Damage (FieldLoader.Require)
   */
  damage: number = 0

  // -----------------------------------------------------------------------
  // doImpactInWorld (对应 OpenRA DamagesConcreteWarhead.DoImpact)
  // -----------------------------------------------------------------------

  /** Apply damage to the BuildableTerrainLayer at the impact position.
   *
   * OpenRA 对照: DamagesConcreteWarhead.DoImpact(in Target target, WarheadArgs args)
   *
   * @param pos — the world position of the impact
   * @param firedBy — the actor that fired the weapon
   * @param _args — warhead arguments (unused here)
   * @returns empty array (effect applied immediately to terrain layer)
   */
  doImpactInWorld(pos: WPos, firedBy: IGameActor, _args: WarheadArgs): WarheadEffect[] {
    // OpenRA 对照: if (target.Type == TargetType.Invalid) return
    // In the TS version, doImpactInWorld receives a pre-resolved WPos.
    // Guard against dead/disposed actors and invalid positions (which
    // correspond to TargetType.Invalid in the C# source).
    if (firedBy.isDead || firedBy.disposed) return []

    const world = firedBy.world as unknown as {
      worldActor?: { trait?: <T>(name: string) => T | undefined }
      map?: { cellContaining: (pos: WPos) => { X: number; Y: number } }
    }
    if (!world) return []

    const layer = world.worldActor?.trait?.<IBuildableTerrainLayerAccess>('BuildableTerrainLayer')
    if (!layer) return []

    const cell = world.map?.cellContaining(pos)
    if (!cell) return []

    layer.hitTile(cell, this.damage)
    return []
  }

  // -----------------------------------------------------------------------
  // loadFromJSON (对应 OpenRA FieldLoader.Load)
  // -----------------------------------------------------------------------

  /** Load warhead configuration from JSON.
   *
   * OpenRA 对照: FieldLoader.Load(DamagesConcreteWarhead, MiniYaml)
   *
   * @param json — the warhead config from weapons.yaml
   */
  override loadFromJSON(json: Record<string, unknown>): void {
    super.loadFromJSON(json)
    if (json.Damage !== undefined) {
      this.damage = json.Damage as number
    }
  }
}
