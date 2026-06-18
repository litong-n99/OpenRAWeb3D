/**
 * ScaredCatProperties.ts — Script-exposed panic behavior
 * OpenRA 对照: ScaredCatProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class ScaredCatProperties extends ScriptActorProperties {
  static readonly category = 'Movement' as const
  static readonly requiredTraits = ['ScaredyCatInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _scaredyCat: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._scaredyCat = (self as any).trait?.('ScaredyCat') ?? null
  }

  Panic(): void {
    this._scaredyCat?.panic?.()
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Panic', returnType: 'nil',
        description: 'Makes the unit automatically run around and become faster.',
        parameters: [],
        invoke: () => { this.Panic() },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Movement',
  ctor: ScaredCatProperties,
  requiredTraits: ['ScaredyCatInfo'],
  exposedForDestroyedActors: false,
  description: 'Panic behavior: Panic',
})
