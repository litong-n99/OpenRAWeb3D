/**
 * BuildingRepairBotModule.ts — AI building repair management (STUB)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/BuildingRepairBotModule.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<BuildingRepairBotModuleInfo> → TypeScript stub
 * - C# IBotRespondToAttack with periodic repair → deferred stub
 *
 * STUB — full migration deferred to Chapter 8 (Weapon/Health System).
 *
 * @todo Chapter 8: Implement repair logic when Health, RepairableBuilding,
 *       and DamageState are fully migrated.
 */

import type {
  IBotRespondToAttack,
  IBot,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// BuildingRepairBotModule (STUB)
// ---------------------------------------------------------------------------

/**
 * AI building repair manager — STUB.
 *
 * OpenRA 对照: BuildingRepairBotModule : ConditionalTrait<BuildingRepairBotModuleInfo>
 *
 * @todo Chapter 8: Full implementation with RepairableBuilding, Health, DamageState.
 */
export class BuildingRepairBotModule implements IBotRespondToAttack {
  /** Repair all buildings cooldown (ticks). -1 disables periodic repair. */
  readonly repairAllBuildingsCoolDown: number

  constructor(repairAllBuildingsCoolDown: number = 107) {
    this.repairAllBuildingsCoolDown = repairAllBuildingsCoolDown
  }

  // -----------------------------------------------------------------------
  // IBotRespondToAttack (STUB — no-op)
  // -----------------------------------------------------------------------

  /**
   * Respond to an attack on own units.
   *
   * OpenRA 对照: IBotRespondToAttack.RespondToAttack(IBot, Actor, AttackInfo)
   *
   * @todo Chapter 8: Queue repair orders for damaged buildings.
   */
  respondToAttack(_bot: IBot, _self: IGameActor, _e: unknown): void {
    // STUB: No-op. Full repair logic deferred to Chapter 8.
    // In OpenRA, this checks RepairableBuilding and orders repairs.
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  dispose(): void {
    // No GPU resources to clean up
  }
}
