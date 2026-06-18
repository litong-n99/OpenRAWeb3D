/**
 * NukeProperties.ts — Script-exposed nuke power activation
 * OpenRA 对照: NukeProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class NukeProperties extends ScriptActorProperties {
  static readonly category = 'Support Powers' as const
  static readonly requiredTraits = ['NukePowerInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _np: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    const powers = (self as any).traitsImplementing?.('NukePower') ?? []
    this._np = powers.length > 0 ? powers[0] : null
  }

  ActivateNukePower(target: unknown): void {
    if (!this._np) return
    const world = (this.self as any).world
    const centerOfCell = world?.map?.centerOfCell?.(target)
    this._np.activate?.(this.self, centerOfCell ?? target)

    const notifies = (this.self as any).traitsImplementing?.('INotifySupportPower') ?? []
    for (const notify of notifies) {
      notify.activated?.(this.self)
    }
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'ActivateNukePower', returnType: 'nil',
        description: 'Activate the actor\'s NukePower.',
        parameters: [{ name: 'target', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.ActivateNukePower(args[0]) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Support Powers',
  ctor: NukeProperties,
  requiredTraits: ['NukePowerInfo'],
  exposedForDestroyedActors: false,
  description: 'Nuke power: ActivateNukePower',
})
