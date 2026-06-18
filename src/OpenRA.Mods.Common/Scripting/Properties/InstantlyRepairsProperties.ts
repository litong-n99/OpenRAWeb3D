/**
 * InstantlyRepairsProperties.ts — Script-exposed instant repair ability
 * OpenRA 对照: InstantlyRepairsProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

export class InstantlyRepairsProperties extends ScriptActorProperties {
  static readonly category = 'Ability' as const
  static readonly requiredTraits = ['IMoveInfo', 'InstantlyRepairsInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _repairs: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._repairs = (self as any).traitsImplementing?.('InstantlyRepairs') ?? []
  }

  InstantlyRepair(target: IGameActor): void {
    const repair = this._repairs.find((r: any) => !r.isDisabled)
    if (repair) {
      this.self.queueActivity?.(createActivity('InstantRepair', {
        target: this.self,
        repairTarget: target,
        info: repair.info,
      }))
    }
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'InstantlyRepair', returnType: 'nil',
        description: 'Enter the target actor to repair it instantly.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.InstantlyRepair(args[0] as IGameActor) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Ability',
  ctor: InstantlyRepairsProperties,
  requiredTraits: ['IMoveInfo', 'InstantlyRepairsInfo'],
  exposedForDestroyedActors: false,
  description: 'Instant repair: InstantlyRepair',
})
