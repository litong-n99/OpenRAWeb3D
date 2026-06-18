/**
 * ParatroopersProperties.ts — Script-exposed paratroopers power activation
 * OpenRA 对照: ParatroopersProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class ParatroopersProperties extends ScriptActorProperties {
  static readonly category = 'Support Powers' as const
  static readonly requiredTraits = ['ParatroopersPowerInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _pp: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    const powers = (self as any).traitsImplementing?.('ParatroopersPower') ?? []
    this._pp = powers.length > 0 ? powers[0] : null
  }

  TargetParatroopers(target: unknown, facing?: unknown): IGameActor[] {
    if (!this._pp) return []

    const notifies = (this.self as any).traitsImplementing?.('INotifySupportPower') ?? []
    for (const notify of notifies) {
      notify.activated?.(this.self)
    }

    const result = this._pp.sendParatroopers?.(this.self, target, facing)
    return result?.aircraft ?? result?.Aircraft ?? []
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'TargetParatroopers', returnType: 'Actor[]',
        description: 'Activate the actor\'s Paratroopers Power. Returns the aircraft that will drop the reinforcements.',
        parameters: [
          { name: 'target', type: 'WPos', optional: false },
          { name: 'facing', type: 'WAngle', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => this.TargetParatroopers(args[0], args[1]),
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Support Powers',
  ctor: ParatroopersProperties,
  requiredTraits: ['ParatroopersPowerInfo'],
  exposedForDestroyedActors: false,
  description: 'Paratroopers power: TargetParatroopers',
})
