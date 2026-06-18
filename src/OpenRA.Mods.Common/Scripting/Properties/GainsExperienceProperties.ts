/**
 * GainsExperienceProperties.ts — Script-exposed experience and levels
 * OpenRA 对照: GainsExperienceProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class GainsExperienceProperties extends ScriptActorProperties {
  static readonly category = 'Experience' as const
  static readonly requiredTraits = ['GainsExperienceInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _exp: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._exp = (self as any).trait?.('GainsExperience') ?? null
  }

  get Experience(): number { return this._exp?.experience ?? 0 }
  get Level(): number { return this._exp?.level ?? 0 }
  get MaxLevel(): number { return this._exp?.maxLevel ?? 0 }
  get CanGainLevel(): boolean { return this._exp?.canGainLevel ?? false }

  GiveExperience(amount: number, silent: boolean = false): void {
    this._exp?.giveExperience?.(amount, silent)
  }

  GiveLevels(numLevels: number, silent: boolean = false): void {
    this._exp?.giveLevels?.(numLevels, silent)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'Experience', returnType: 'number',
        description: 'The actor\'s amount of experience.',
        get: () => this.Experience,
      },
      {
        memberType: 'property', name: 'Level', returnType: 'number',
        description: 'The actor\'s level.',
        get: () => this.Level,
      },
      {
        memberType: 'property', name: 'MaxLevel', returnType: 'number',
        description: 'The actor\'s maximum possible level.',
        get: () => this.MaxLevel,
      },
      {
        memberType: 'property', name: 'CanGainLevel', returnType: 'boolean',
        description: 'Returns true if the actor can gain a level.',
        get: () => this.CanGainLevel,
      },
      {
        memberType: 'method', name: 'GiveExperience', returnType: 'nil',
        description: 'Gives the actor experience. If silent is true, no animation or sound will be played if the actor levels up.',
        parameters: [
          { name: 'amount', type: 'number', optional: false },
          { name: 'silent', type: 'boolean', optional: true, defaultValue: false },
        ],
        invoke: (_, args) => { this.GiveExperience(args[0] as number, args[1] as boolean) },
      },
      {
        memberType: 'method', name: 'GiveLevels', returnType: 'nil',
        description: 'Gives the actor level(s). If silent is true, no animation or sound will be played.',
        parameters: [
          { name: 'numLevels', type: 'number', optional: false },
          { name: 'silent', type: 'boolean', optional: true, defaultValue: false },
        ],
        invoke: (_, args) => { this.GiveLevels(args[0] as number, args[1] as boolean) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Experience',
  ctor: GainsExperienceProperties,
  requiredTraits: ['GainsExperienceInfo'],
  exposedForDestroyedActors: false,
  description: 'Experience and levels: Experience, Level, MaxLevel, CanGainLevel, GiveExperience, GiveLevels',
})
