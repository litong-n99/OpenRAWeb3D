/**
 * AmmoPoolProperties.ts — Script-exposed ammo pool management
 * OpenRA 对照: AmmoPoolProperties.cs
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class AmmoPoolProperties extends ScriptActorProperties {
  static readonly category = 'AmmoPool' as const
  static readonly requiredTraits = ['AmmoPoolInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _ammoPools: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._ammoPools = (self as any).traitsImplementing?.('AmmoPool') ?? []
  }

  private _getPool(poolName: string): any {
    const pool = this._ammoPools.find((a: any) => a.info?.name === poolName)
    if (!pool) {
      throw new Error(`Invalid ammopool name ${poolName} queried on actor ${(this.self as any).info?.name ?? 'unknown'}.`)
    }
    return pool
  }

  AmmoCount(poolName: string = 'primary'): number {
    return this._getPool(poolName).currentAmmoCount ?? 0
  }

  MaximumAmmoCount(poolName: string = 'primary'): number {
    return this._getPool(poolName).info?.ammo ?? 0
  }

  Reload(poolName: string = 'primary', amount: number = 1): void {
    const pool = this._getPool(poolName)
    if (amount > 0) {
      pool.giveAmmo?.(this.self, amount)
    } else {
      pool.takeAmmo?.(this.self, -amount)
    }
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'AmmoCount', returnType: 'number',
        description: 'Returns the count of the actor\'s specified ammopool.',
        parameters: [
          { name: 'poolName', type: 'string', optional: true, defaultValue: 'primary' },
        ],
        invoke: (_, args) => this.AmmoCount(args[0] as string),
      },
      {
        memberType: 'method', name: 'MaximumAmmoCount', returnType: 'number',
        description: 'Returns the maximum count of ammo the actor can load.',
        parameters: [
          { name: 'poolName', type: 'string', optional: true, defaultValue: 'primary' },
        ],
        invoke: (_, args) => this.MaximumAmmoCount(args[0] as string),
      },
      {
        memberType: 'method', name: 'Reload', returnType: 'nil',
        description: 'Adds the specified amount of ammo to the specified ammopool. (Use a negative amount to remove ammo.)',
        parameters: [
          { name: 'poolName', type: 'string', optional: true, defaultValue: 'primary' },
          { name: 'amount', type: 'number', optional: true, defaultValue: 1 },
        ],
        invoke: (_, args) => { this.Reload(args[0] as string, args[1] as number) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'AmmoPool',
  ctor: AmmoPoolProperties,
  requiredTraits: ['AmmoPoolInfo'],
  exposedForDestroyedActors: false,
  description: 'Ammo pool management: AmmoCount, MaximumAmmoCount, Reload',
})
