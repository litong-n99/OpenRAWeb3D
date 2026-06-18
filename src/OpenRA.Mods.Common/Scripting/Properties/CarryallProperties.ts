/**
 * CarryallProperties.ts — Script-exposed carryall transport
 * OpenRA 对照: CarryallProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

export class CarryallProperties extends ScriptActorProperties {
  static readonly category = 'Ability' as const
  static readonly requiredTraits = ['CarryallInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _carryall: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._carryall = (self as any).trait?.('Carryall') ?? null
  }

  PickupCarryable(target: IGameActor): void {
    if (!this._carryall) return
    const carryable = (target as any).trait?.('Carryable')
    if (!carryable) {
      throw new Error(`Actor '${(this.self as any).info?.name ?? 'unknown'}' cannot carry actor '${(target as any).info?.name ?? 'unknown'}'!`)
    }
    this.self.queueActivity?.(createActivity('PickupUnit', {
      source: this.self,
      target,
      delay: this._carryall.info?.beforeLoadDelay ?? 0,
    }))
  }

  DeliverCarryable(target: unknown): void {
    this.self.queueActivity?.(createActivity('DeliverUnit', {
      source: this.self,
      target,
      range: this._carryall?.info?.dropRange ?? 0,
    }))
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'PickupCarryable', returnType: 'nil',
        description: 'Pick up the target actor.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.PickupCarryable(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'DeliverCarryable', returnType: 'nil',
        description: 'Drop the actor being carried at the target location.',
        parameters: [{ name: 'target', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.DeliverCarryable(args[0]) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Ability',
  ctor: CarryallProperties,
  requiredTraits: ['CarryallInfo'],
  exposedForDestroyedActors: false,
  description: 'Carryall transport: PickupCarryable, DeliverCarryable',
})
