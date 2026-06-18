/**
 * GuardProperties.ts — Script-exposed guard command
 * OpenRA 对照: GuardProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class GuardProperties extends ScriptActorProperties {
  static readonly category = 'Combat' as const
  static readonly requiredTraits = ['GuardInfo', 'IMoveInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _guard: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._guard = (self as any).trait?.('Guard') ?? null
  }

  Guard(targetActor: IGameActor): void {
    if (!this._guard) return
    const targetInfo = (targetActor as any).info
    if (targetInfo?.hasTraitInfo?.('GuardableInfo')) {
      this._guard.guardTarget?.(this.self, targetActor)
    }
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Guard', returnType: 'nil',
        description: 'Guard the target actor.',
        parameters: [{ name: 'targetActor', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.Guard(args[0] as IGameActor) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Combat',
  ctor: GuardProperties,
  requiredTraits: ['GuardInfo', 'IMoveInfo'],
  exposedForDestroyedActors: false,
  description: 'Guard command: Guard',
})
