/**
 * ParadropProperties.ts — Script-exposed paradrop ability
 * OpenRA 对照: ParadropProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

export class ParadropProperties extends ScriptActorProperties {
  static readonly category = 'Transports' as const
  static readonly requiredTraits = ['CargoInfo', 'ParaDropInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _paradrop: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._paradrop = (self as any).trait?.('ParaDrop') ?? null
  }

  Paradrop(cell: unknown): void {
    if (!this._paradrop) return
    // Notify support power listeners
    const notifies = (this.self as any).traitsImplementing?.('INotifySupportPower') ?? []
    for (const notify of notifies) {
      notify.activated?.(this.self)
    }

    this._paradrop.setLZ?.(cell, true)
    this.self.queueActivity?.(createActivity('Fly', { target: this.self, destination: cell }))
    this.self.queueActivity?.(createActivity('FlyOffMap', { target: this.self }))
    this.self.queueActivity?.(createActivity('RemoveSelf'))
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Paradrop', returnType: 'nil',
        description: 'Command transport to paradrop passengers near the target cell.',
        parameters: [{ name: 'cell', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.Paradrop(args[0]) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Transports',
  ctor: ParadropProperties,
  requiredTraits: ['CargoInfo', 'ParaDropInfo'],
  exposedForDestroyedActors: false,
  description: 'Paradrop transport: Paradrop',
})
