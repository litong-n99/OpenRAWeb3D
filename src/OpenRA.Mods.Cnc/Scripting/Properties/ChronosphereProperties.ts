/**
 * ChronosphereProperties.ts — Script-exposed Chronosphere support power
 * OpenRA 对照: OpenRA.Mods.Cnc/Scripting/Properties/ChronosphereProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("Support Powers")] attribute → static readonly category
 * - C# Requires<ChronoshiftPowerInfo> → requiredTraits: ['ChronoshiftPowerInfo']
 * - C# LuaTable[actor] = cpos iteration → Map<IGameActor, CPos> or Array<[actor, cpos]>
 * - C# FirstEnabledConditionalTraitOrDefault<Chronoshiftable>() → find first non-disabled Chronoshiftable
 * - C# cs.Teleport(actor, cell, duration, killCargo, Self) → trait.teleport(actor, cell, duration, killCargo, self)
 *
 * TODO-20.F.1
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

/**
 * A pair of actor and target cell for the chronoshift.
 * OpenRA 对照: LuaTable { [actor]: cpos }
 */
type ActorCellPair = [IGameActor, unknown]  // CPos compatible target cell

export class ChronosphereProperties extends ScriptActorProperties {
  static readonly category = 'Support Powers' as const
  static readonly requiredTraits = ['ChronoshiftPowerInfo'] as const
  static readonly exposedForDestroyedActors = false

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
  }

  /**
   * Chronoshift a group of actors.
   *
   * OpenRA 对照: ChronosphereProperties.Chronoshift(LuaTable unitLocationPairs, int duration = 0, bool killCargo = false)
   *
   * A duration of 0 will teleport the actors permanently.
   * If a given cell is unexplored for this power's owner, the closest valid cell will be used instead.
   *
   * @param unitLocationPairs — Array of [actor, cpos] pairs mapping actors to target cells
   * @param duration — teleport duration in ticks (0 = permanent)
   * @param killCargo — whether to kill any cargo in the teleported actors
   */
  Chronoshift(unitLocationPairs: ActorCellPair[], duration: number = 0, killCargo: boolean = false): void {
    for (const [actor, cell] of unitLocationPairs) {
      if (!actor || cell === undefined || cell === null) continue

      // OpenRA: var cs = actor.TraitsImplementing<Chronoshiftable>()
      //   .FirstEnabledConditionalTraitOrDefault();
      const chronoshiftables = ((actor as any).traitsImplementing?.('Chronoshiftable') ?? []) as any[]
      const cs = chronoshiftables.find((c: any) => !c.isTraitDisabled)

      if (cs && cs.canChronoshiftTo?.(actor, cell)) {
        cs.teleport?.(actor, cell, duration, killCargo, this.self)
      }
    }
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Chronoshift', returnType: 'nil',
        description:
          'Chronoshift a group of actors. A duration of 0 will teleport the actors permanently. ' +
          'If a given cell is unexplored for this power\'s owner, the closest valid cell will be used instead.',
        parameters: [
          { name: 'unitLocationPairs', type: 'table', optional: false },
          { name: 'duration', type: 'number', optional: true, defaultValue: 0 },
          { name: 'killCargo', type: 'boolean', optional: true, defaultValue: false },
        ],
        invoke: (_, args) => {
          this.Chronoshift(args[0] as ActorCellPair[], args[1] as number, args[2] as boolean)
        },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Support Powers',
  ctor: ChronosphereProperties,
  requiredTraits: ['ChronoshiftPowerInfo'],
  exposedForDestroyedActors: false,
  description: 'Chronosphere power: Chronoshift',
})
