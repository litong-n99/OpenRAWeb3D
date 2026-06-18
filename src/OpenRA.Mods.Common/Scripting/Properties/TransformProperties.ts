/**
 * TransformProperties.ts — Script-exposed unit transformation
 * OpenRA 对照: TransformProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class TransformProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits = ['TransformsInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _transforms: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._transforms = (self as any).trait?.('Transforms') ?? null
  }

  Deploy(): void {
    this._transforms?.deployTransform?.(true)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Deploy', returnType: 'nil',
        description: 'Queue a new transformation.',
        parameters: [],
        invoke: () => { this.Deploy() },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: TransformProperties,
  requiredTraits: ['TransformsInfo'],
  exposedForDestroyedActors: false,
  description: 'Unit transformation: Deploy',
})
