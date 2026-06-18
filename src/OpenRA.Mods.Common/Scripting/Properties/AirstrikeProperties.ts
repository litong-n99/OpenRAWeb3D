/**
 * AirstrikeProperties.ts — Script-exposed airstrike power activation
 * OpenRA 对照: AirstrikeProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class AirstrikeProperties extends ScriptActorProperties {
  static readonly category = 'Support Powers' as const
  static readonly requiredTraits = ['AirstrikePowerInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _ap: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    const powers = (self as any).traitsImplementing?.('AirstrikePower') ?? []
    this._ap = powers.length > 0 ? powers[0] : null
  }

  TargetAirstrike(target: unknown, facing?: unknown): IGameActor[] {
    if (!this._ap) return []

    const notifies = (this.self as any).traitsImplementing?.('INotifySupportPower') ?? []
    for (const notify of notifies) {
      notify.activated?.(this.self)
    }

    return this._ap.sendAirstrike?.(this.self, target, facing) ?? []
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'TargetAirstrike', returnType: 'Actor[]',
        description: 'Activate the actor\'s Airstrike Power. Returns the aircraft that will attack.',
        parameters: [
          { name: 'target', type: 'WPos', optional: false },
          { name: 'facing', type: 'WAngle', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => this.TargetAirstrike(args[0], args[1]),
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Support Powers',
  ctor: AirstrikeProperties,
  requiredTraits: ['AirstrikePowerInfo'],
  exposedForDestroyedActors: false,
  description: 'Airstrike power: TargetAirstrike',
})
