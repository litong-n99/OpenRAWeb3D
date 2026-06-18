/**
 * SellableProperties.ts — Script-exposed sell command
 * OpenRA 对照: SellableProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class SellableProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits = ['SellableInfo'] as const
  static readonly exposedForDestroyedActors = false

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
  }

  Sell(): void {
    // PERF: No trait cache in constructor — trait lookup deferred to sell moment
    const sellable = (this.self as any).trait?.('Sellable')
    sellable?.sell?.(this.self)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Sell', returnType: 'nil',
        description: 'Start selling the actor.',
        parameters: [],
        invoke: () => { this.Sell() },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: SellableProperties,
  requiredTraits: ['SellableInfo'],
  exposedForDestroyedActors: false,
  description: 'Sell building: Sell',
})
