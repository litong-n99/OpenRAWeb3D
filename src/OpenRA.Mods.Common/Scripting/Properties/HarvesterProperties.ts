/**
 * HarvesterProperties.ts — Script-exposed harvester resource gathering
 * OpenRA 对照: HarvesterProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

export class HarvesterProperties extends ScriptActorProperties {
  static readonly category = 'Movement' as const
  static readonly requiredTraits = ['HarvesterInfo'] as const
  static readonly exposedForDestroyedActors = false

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
  }

  FindResources(): void {
    this.self.queueActivity?.(createActivity('FindAndDeliverResources', { target: this.self }))
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'FindResources', returnType: 'nil',
        description: 'Search for nearby resources and begin harvesting.',
        parameters: [],
        invoke: () => { this.FindResources() },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Movement',
  ctor: HarvesterProperties,
  requiredTraits: ['HarvesterInfo'],
  exposedForDestroyedActors: false,
  description: 'Harvester resource gathering: FindResources',
})
