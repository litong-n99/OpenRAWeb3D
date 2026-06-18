/**
 * DemolitionProperties.ts — Script-exposed demolition ability
 * OpenRA 对照: DemolitionProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

export class DemolitionProperties extends ScriptActorProperties {
  static readonly category = 'Combat' as const
  static readonly requiredTraits = ['IMoveInfo', 'DemolitionInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _demolitions: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._demolitions = (self as any).traitsImplementing?.('Demolition') ?? []
  }

  Demolish(target: IGameActor): void {
    const demolition = this._demolitions.find((d: any) => !d.isDisabled)
    if (demolition) {
      this.self.queueActivity?.(createActivity('Demolish', { target, source: this.self }))
    }
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Demolish', returnType: 'nil',
        description: 'Demolish the target actor.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.Demolish(args[0] as IGameActor) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Combat',
  ctor: DemolitionProperties,
  requiredTraits: ['IMoveInfo', 'DemolitionInfo'],
  exposedForDestroyedActors: false,
  description: 'Demolition ability: Demolish',
})
