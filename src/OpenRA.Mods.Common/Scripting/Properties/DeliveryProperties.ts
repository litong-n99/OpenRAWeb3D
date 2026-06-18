/**
 * DeliveryProperties.ts — Script-exposed cash/experience delivery
 * OpenRA 对照: DeliveryProperties.cs (DeliversCashProperties + DeliversExperienceProperties)
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

// ===========================================================================
// DeliversCashProperties
// ===========================================================================

export class DeliversCashProperties extends ScriptActorProperties {
  static readonly category = 'Ability' as const
  static readonly requiredTraits = ['IMoveInfo', 'DeliversCashInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _info: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._info = (self as any).info?.traitInfo?.('DeliversCashInfo') ?? null
  }

  DeliverCash(target: IGameActor): void {
    this.self.queueActivity?.(createActivity('DonateCash', {
      target: this.self,
      recipient: target,
      payload: this._info?.payload ?? 0,
      experience: this._info?.playerExperience ?? 0,
    }))
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'DeliverCash', returnType: 'nil',
        description: 'Deliver cash to the target actor.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.DeliverCash(args[0] as IGameActor) },
      },
    ]
  }
}

// ===========================================================================
// DeliversExperienceProperties
// ===========================================================================

export class DeliversExperienceProperties extends ScriptActorProperties {
  static readonly category = 'Ability' as const
  static readonly requiredTraits = ['IMoveInfo', 'DeliversExperienceInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _info: any | null
  private readonly _gainsExperience: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._info = (self as any).info?.traitInfo?.('DeliversExperienceInfo') ?? null
    this._gainsExperience = (self as any).trait?.('GainsExperience') ?? null
  }

  DeliverExperience(target: IGameActor): void {
    const targetExp = (target as any).trait?.('GainsExperience')
    if (!targetExp) {
      throw new Error(`Actor '${(target as any).info?.name ?? 'unknown'}' cannot gain experience!`)
    }
    if (targetExp.level === targetExp.maxLevel) return

    const level = this._gainsExperience?.level ?? 0
    this.self.queueActivity?.(createActivity('DonateExperience', {
      target: this.self,
      recipient: target,
      level,
      experience: this._info?.playerExperience ?? 0,
    }))
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'DeliverExperience', returnType: 'nil',
        description: 'Deliver experience to the target actor.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.DeliverExperience(args[0] as IGameActor) },
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerActorProperty({
  category: 'Ability',
  ctor: DeliversCashProperties,
  requiredTraits: ['IMoveInfo', 'DeliversCashInfo'],
  exposedForDestroyedActors: false,
  description: 'Cash delivery: DeliverCash',
})

ScriptRegistry.registerActorProperty({
  category: 'Ability',
  ctor: DeliversExperienceProperties,
  requiredTraits: ['IMoveInfo', 'DeliversExperienceInfo'],
  exposedForDestroyedActors: false,
  description: 'Experience delivery: DeliverExperience',
})
