/**
 * CloakProperties.ts — Script-exposed cloak status
 * OpenRA 对照: CloakProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class CloakProperties extends ScriptActorProperties {
  static readonly category = 'Cloak' as const
  static readonly requiredTraits = ['CloakInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _cloaks: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._cloaks = (self as any).traitsImplementing?.('Cloak') ?? []
  }

  get IsCloaked(): boolean {
    return this._cloaks.some((c: any) => c.cloaked ?? c.Cloaked)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'IsCloaked', returnType: 'boolean',
        description: 'Returns true if the actor is cloaked.',
        get: () => this.IsCloaked,
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Cloak',
  ctor: CloakProperties,
  requiredTraits: ['CloakInfo'],
  exposedForDestroyedActors: false,
  description: 'Cloak status: IsCloaked',
})
