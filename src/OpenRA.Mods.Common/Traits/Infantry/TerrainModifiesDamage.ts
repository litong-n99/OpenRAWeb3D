/**
 * TerrainModifiesDamage.ts -- Damage modifier based on terrain type under the actor
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Infantry/TerrainModifiesDamage.cs (60 lines)
 *
 * 核心范式转换:
 * - C# TerrainModifiesDamageInfo : TraitInfo → TS plain class
 * - C# FrozenDictionary<string, int> → TS ReadonlyMap<string, number>
 * - C# TerrainModifiesDamage : IDamageModifier → TS IDamageModifier impl
 * - C# map.GetTerrainInfo(pos).Type → TS duck-typed map terrain query
 * - C# Damage.Value < 0 (healing) check → TS damage.value < 0
 */

import type { IGameActor, Damage } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IDamageModifier } from '../CombatInterfaces.js'

export type { IDamageModifier }

// ---------------------------------------------------------------------------
// TerrainModifiesDamageInfo
// OpenRA 对照: TerrainModifiesDamageInfo (TraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for TerrainModifiesDamage trait.
 *
 *  OpenRA 对照: TerrainModifiesDamageInfo
 */
export class TerrainModifiesDamageInfo {
  /** Damage percentage for specific terrain types. 120 = 120%, 80 = 80%, etc.
   *
   *  OpenRA 对照: TerrainModifiesDamageInfo.TerrainModifier (required)
   */
  readonly terrainModifier: ReadonlyMap<string, number>

  /** Modify healing damage? For example: A friendly medic.
   *
   *  OpenRA 对照: TerrainModifiesDamageInfo.ModifyHealing (default false)
   */
  readonly modifyHealing: boolean = false

  constructor(params: {
    terrainModifier?: ReadonlyMap<string, number> | Record<string, number>
    modifyHealing?: boolean
  } = {}) {
    if (params.terrainModifier instanceof Map) {
      this.terrainModifier = params.terrainModifier
    } else if (params.terrainModifier && typeof params.terrainModifier === 'object') {
      this.terrainModifier = new Map(Object.entries(params.terrainModifier))
    } else {
      this.terrainModifier = new Map()
    }
    this.modifyHealing = params.modifyHealing ?? false
  }
}

// ---------------------------------------------------------------------------
// TerrainModifiesDamage
// OpenRA 对照: TerrainModifiesDamage (IDamageModifier)
// ---------------------------------------------------------------------------

/** Modifies incoming damage based on the terrain type the actor is standing on.
 *
 *  OpenRA 对照: TerrainModifiesDamage
 */
export class TerrainModifiesDamage implements IDamageModifier {
  /** Constant for unmodified damage (100%). */
  static readonly FULL_DAMAGE = 100

  /** Configuration for this trait. */
  readonly info: TerrainModifiesDamageInfo

  /** Reference to the owning actor. */
  private readonly _self: IGameActor

  constructor(self: IGameActor, info: TerrainModifiesDamageInfo) {
    this.info = info
    this._self = self
  }

  // -----------------------------------------------------------------------
  // IDamageModifier — getDamageModifier
  // OpenRA 对照: IDamageModifier.GetDamageModifier(Actor, Damage)
  // -----------------------------------------------------------------------

  /**
   * Get the damage modifier based on the terrain type under this actor.
   *
   * OpenRA 对照: TerrainModifiesDamage.GetDamageModifier(Actor attacker, Damage damage)
   *
   * @param attacker — the actor performing the attack
   * @param damage — the damage being applied
   * @returns the damage multiplier (100 = 100%, 120 = 120%, etc.)
   */
  getDamageModifier(attacker: IGameActor, damage: Damage): number {
    // Check healing — don't modify friendly healing unless configured to
    if (!this.info.modifyHealing) {
      const selfOwner = (this._self as unknown as { owner?: { isAlliedWith(other: unknown): boolean } }).owner
      const attackerOwner = (attacker as unknown as { owner?: unknown }).owner
      if (selfOwner && attackerOwner && selfOwner.isAlliedWith(attackerOwner) && damage && damage.value < 0) {
        return TerrainModifiesDamage.FULL_DAMAGE
      }
    }

    // Get terrain type at actor position
    const world = (this._self as unknown as {
      world?: {
        map?: {
          cellContaining(pos: unknown): unknown
          getTerrainInfo(cell: unknown): { type: string }
        }
      }
    }).world

    if (!world?.map) return TerrainModifiesDamage.FULL_DAMAGE

    const centerPos = (this._self as unknown as { centerPosition?: unknown }).centerPosition
    if (!centerPos) return TerrainModifiesDamage.FULL_DAMAGE

    const pos = world.map.cellContaining(centerPos)
    const terrainInfo = world.map.getTerrainInfo(pos)
    const terrainType = terrainInfo.type

    const modifiedDamage = this.info.terrainModifier.get(terrainType)
    if (modifiedDamage === undefined) {
      return TerrainModifiesDamage.FULL_DAMAGE
    }

    return modifiedDamage
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /** Dispose this trait (no GPU resources to clean up). */
  dispose(): void {
    // No resources to clean up
  }
}
