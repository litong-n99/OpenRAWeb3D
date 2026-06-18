/**
 * PlayerStatsProperties.ts — Script-exposed player combat statistics
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Properties/PlayerStatsProperties.cs
 *
 * 核心范式转换:
 * - C# PlayerStatistics trait on PlayerActor → playerActor.trait('PlayerStatistics')
 * - C# stats.KillsCost / stats.UnitsKilled / etc. → property access with fallback
 */
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

// ===========================================================================
// PlayerStatsProperties
// ===========================================================================

/**
 * Player combat statistics.
 *
 * OpenRA 对照: PlayerStatsProperties (PlayerStatsProperties.cs:19-46)
 */
export class PlayerStatsProperties extends ScriptPlayerProperties {
  static readonly requiredTraits = ['PlayerStatisticsInfo'] as const

  private readonly _stats: any | null

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)
    const playerActor = (player as any).playerActor
    this._stats = playerActor?.trait?.('PlayerStatistics') ?? null
  }

  /** The combined value of units killed by this player. */
  get KillsCost(): number {
    return this._stats?.killsCost ?? this._stats?.KillsCost ?? 0
  }

  /** The combined value of all units lost by this player. */
  get DeathsCost(): number {
    return this._stats?.deathsCost ?? this._stats?.DeathsCost ?? 0
  }

  /** The total number of units killed by this player. */
  get UnitsKilled(): number {
    return this._stats?.unitsKilled ?? this._stats?.UnitsKilled ?? 0
  }

  /** The total number of units lost by this player. */
  get UnitsLost(): number {
    return this._stats?.unitsDead ?? this._stats?.UnitsDead ?? 0
  }

  /** The total number of buildings killed by this player. */
  get BuildingsKilled(): number {
    return this._stats?.buildingsKilled ?? this._stats?.BuildingsKilled ?? 0
  }

  /** The total number of buildings lost by this player. */
  get BuildingsLost(): number {
    return this._stats?.buildingsDead ?? this._stats?.BuildingsDead ?? 0
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      { memberType: 'property', name: 'KillsCost', returnType: 'number', description: 'The combined value of units killed by this player.', get: () => this.KillsCost },
      { memberType: 'property', name: 'DeathsCost', returnType: 'number', description: 'The combined value of all units lost by this player.', get: () => this.DeathsCost },
      { memberType: 'property', name: 'UnitsKilled', returnType: 'number', description: 'The total number of units killed by this player.', get: () => this.UnitsKilled },
      { memberType: 'property', name: 'UnitsLost', returnType: 'number', description: 'The total number of units lost by this player.', get: () => this.UnitsLost },
      { memberType: 'property', name: 'BuildingsKilled', returnType: 'number', description: 'The total number of buildings killed by this player.', get: () => this.BuildingsKilled },
      { memberType: 'property', name: 'BuildingsLost', returnType: 'number', description: 'The total number of buildings lost by this player.', get: () => this.BuildingsLost },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerPlayerProperty({
  category: 'Player',
  ctor: PlayerStatsProperties,
  requiredTraits: ['PlayerStatisticsInfo'],
  description: 'Player combat statistics: KillsCost, DeathsCost, UnitsKilled, UnitsLost, BuildingsKilled, BuildingsLost',
})
