/**
 * ResourceProperties.ts — Script-exposed player resource management
 * OpenRA 对照: ResourceProperties.cs (extends ScriptPlayerProperties)
 *
 * NOTE: This extends ScriptPlayerProperties (player-scoped), not ScriptActorProperties.
 */

import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class ResourceProperties extends ScriptPlayerProperties {
  static readonly requiredTraits = ['PlayerResourcesInfo'] as const

  private readonly _pr: any | null

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)
    const playerActor = (player as any).playerActor
    this._pr = (playerActor as any)?.trait?.('PlayerResources') ?? null
  }

  get Resources(): number { return this._pr?.resources ?? this._pr?.Resources ?? 0 }
  set Resources(value: number) {
    if (!this._pr) return
    const cap = this.ResourceCapacity
    this._pr.resources = Math.max(0, Math.min(value, cap))
  }

  get ResourceCapacity(): number { return this._pr?.resourceCapacity ?? this._pr?.ResourceCapacity ?? 0 }

  get Cash(): number { return this._pr?.cash ?? this._pr?.Cash ?? 0 }
  set Cash(value: number) {
    if (!this._pr) return
    this._pr.cash = Math.max(0, value)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'Resources', returnType: 'number',
        description: 'The amount of harvestable resources held by the player.',
        get: () => this.Resources,
        set: (_, v) => { this.Resources = v as number },
      },
      {
        memberType: 'property', name: 'ResourceCapacity', returnType: 'number',
        description: 'The maximum resource storage of the player.',
        get: () => this.ResourceCapacity,
      },
      {
        memberType: 'property', name: 'Cash', returnType: 'number',
        description: 'The amount of cash held by the player.',
        get: () => this.Cash,
        set: (_, v) => { this.Cash = v as number },
      },
    ]
  }
}

ScriptRegistry.registerPlayerProperty({
  category: 'Resources',
  ctor: ResourceProperties,
  requiredTraits: ['PlayerResourcesInfo'],
  description: 'Player resources: Resources, ResourceCapacity, Cash',
})
