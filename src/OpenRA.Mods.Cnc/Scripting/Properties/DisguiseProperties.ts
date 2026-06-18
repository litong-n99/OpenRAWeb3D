/**
 * DisguiseProperties.ts — Script-exposed disguise ability
 * OpenRA 对照: OpenRA.Mods.Cnc/Scripting/Properties/DisguiseProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("Ability")] attribute → static readonly category
 * - C# Requires<DisguiseInfo> → requiredTraits: ['DisguiseInfo']
 * - C# Self.Trait<Disguise>() → self trait lookup via getTrait or traitsImplementing
 * - C# DisguiseAs(Actor target) → DisguiseAs(target: IGameActor)
 * - C# DisguiseAsType(string actorType, Player newOwner) → DisguiseAsType(actorType, newOwner)
 *
 * TODO-20.F.2
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class DisguiseProperties extends ScriptActorProperties {
  static readonly category = 'Ability' as const
  static readonly requiredTraits = ['DisguiseInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _disguise: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._disguise = (self as any).trait?.('Disguise') ?? null
  }

  /**
   * Disguises as the target actor.
   *
   * OpenRA 对照: DisguiseProperties.DisguiseAs(Actor target)
   * C# calls disguise.DisguiseAs(target)
   */
  DisguiseAs(target: IGameActor): void {
    if (!this._disguise) return
    this._disguise._disguiseAs?.(target)
  }

  /**
   * Disguises as the target type with the specified owner.
   *
   * OpenRA 对照: DisguiseProperties.DisguiseAsType(string actorType, Player newOwner)
   * C# gets ActorInfo from Self.World.Map.Rules.Actors[actorType]
   * then calls disguise.DisguiseAs(actorInfo, newOwner)
   */
  DisguiseAsType(actorType: string, newOwner: unknown): void {
    if (!this._disguise) return
    // OpenRA: var actorInfo = Self.World.Map.Rules.Actors[actorType];
    const world = (this.self as any).world
    const rules = world?.map?.rules ?? world?.rules
    const actorInfo = rules?.actors?.[actorType]
    if (!actorInfo) return
    this._disguise._disguiseFromFrozen?.(actorInfo, newOwner)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'DisguiseAs', returnType: 'nil',
        description: 'Disguises as the target actor.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.DisguiseAs(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'DisguiseAsType', returnType: 'nil',
        description: 'Disguises as the target type with the specified owner.',
        parameters: [
          { name: 'actorType', type: 'string', optional: false },
          { name: 'newOwner', type: 'Player', optional: false },
        ],
        invoke: (_, args) => { this.DisguiseAsType(args[0] as string, args[1]) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Ability',
  ctor: DisguiseProperties,
  requiredTraits: ['DisguiseInfo'],
  exposedForDestroyedActors: false,
  description: 'Disguise ability: DisguiseAs, DisguiseAsType',
})
