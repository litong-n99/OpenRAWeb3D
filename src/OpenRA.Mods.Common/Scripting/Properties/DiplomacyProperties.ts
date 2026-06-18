/**
 * DiplomacyProperties.ts — Script-exposed diplomatic stance query
 * OpenRA 对照: DiplomacyProperties.cs (extends ScriptPlayerProperties)
 *
 * NOTE: This extends ScriptPlayerProperties (player-scoped), not ScriptActorProperties.
 */

import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class DiplomacyProperties extends ScriptPlayerProperties {
  static readonly requiredTraits: readonly string[] = []

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)
  }

  IsAlliedWith(targetPlayer: PlayerStub): boolean {
    return (this.player as any).isAlliedWith?.(targetPlayer) ?? false
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'IsAlliedWith', returnType: 'boolean',
        description: 'Returns true if the player is allied with the other player.',
        parameters: [{ name: 'targetPlayer', type: 'Player', optional: false }],
        invoke: (_, args) => this.IsAlliedWith(args[0] as PlayerStub),
      },
    ]
  }
}

ScriptRegistry.registerPlayerProperty({
  category: 'Diplomacy',
  ctor: DiplomacyProperties,
  requiredTraits: [],
  description: 'Diplomacy: IsAlliedWith',
})
