/**
 * ConditionProperties.ts — Script-exposed condition management for actors
 * OpenRA 对照: ConditionProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class ConditionProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits = ['ExternalConditionInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _externalConditions: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._externalConditions = (self as any).traitsImplementing?.('ExternalCondition') ?? []
  }

  GrantCondition(condition: string, duration: number = 0): number {
    const external = this._externalConditions.find(
      (t: any) => t.info?.condition === condition && t.canGrantCondition?.(this),
    )
    if (!external) {
      throw new Error(`Condition '${condition}' has not been listed on an enabled ExternalCondition trait`)
    }
    return external.grantCondition?.(this.self, this, duration) ?? 0
  }

  RevokeCondition(token: number): void {
    for (const external of this._externalConditions) {
      if (external.tryRevokeCondition?.(this.self, this, token)) break
    }
  }

  AcceptsCondition(condition: string): boolean {
    return this._externalConditions.some(
      (t: any) => t.info?.condition === condition && t.canGrantCondition?.(this),
    )
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'GrantCondition', returnType: 'number',
        description: 'Grant an external condition on this actor and return the revocation token.',
        parameters: [
          { name: 'condition', type: 'string', optional: false },
          { name: 'duration', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_, args) => this.GrantCondition(args[0] as string, args[1] as number),
      },
      {
        memberType: 'method', name: 'RevokeCondition', returnType: 'nil',
        description: 'Revoke a condition using the token returned by GrantCondition.',
        parameters: [{ name: 'token', type: 'number', optional: false }],
        invoke: (_, args) => { this.RevokeCondition(args[0] as number) },
      },
      {
        memberType: 'method', name: 'AcceptsCondition', returnType: 'boolean',
        description: 'Check whether this actor accepts a specific external condition.',
        parameters: [{ name: 'condition', type: 'string', optional: false }],
        invoke: (_, args) => this.AcceptsCondition(args[0] as string),
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: ConditionProperties,
  requiredTraits: ['ExternalConditionInfo'],
  exposedForDestroyedActors: false,
  description: 'External condition management: GrantCondition, RevokeCondition, AcceptsCondition',
})
