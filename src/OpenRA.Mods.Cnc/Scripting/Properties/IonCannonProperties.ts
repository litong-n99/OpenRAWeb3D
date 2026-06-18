/**
 * IonCannonProperties.ts — Script-exposed Ion Cannon power activation
 * OpenRA 对照: OpenRA.Mods.Cnc/Scripting/Properties/IonCannonProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("Support Powers")] attribute → static readonly category
 * - C# Requires<IonCannonPowerInfo> → requiredTraits: ['IonCannonPowerInfo']
 * - C# TraitsImplementing<IonCannonPower>().First() → traitsImplementing('IonCannonPower')[0]
 * - C# icp.Activate(Self, Target.FromCell(Self.World, target)) → trait.activate(self, target)
 *
 *
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class IonCannonProperties extends ScriptActorProperties {
  static readonly category = 'Support Powers' as const
  static readonly requiredTraits = ['IonCannonPowerInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _icp: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    const powers = (self as any).traitsImplementing?.('IonCannonPower') ?? []
    this._icp = powers.length > 0 ? powers[0] : null
  }

  /**
   * Activate the actor's IonCannonPower.
   *
   * OpenRA 对照: IonCannonProperties.ActivateIonCannon(CPos target)
   * C# calls icp.Activate(Self, Target.FromCell(Self.World, target))
   */
  ActivateIonCannon(target: unknown): void {
    if (!this._icp) return
    this._icp.activate?.(this.self, target)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'ActivateIonCannon', returnType: 'nil',
        description: 'Activate the actor\'s IonCannonPower.',
        parameters: [{ name: 'target', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.ActivateIonCannon(args[0]) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Support Powers',
  ctor: IonCannonProperties,
  requiredTraits: ['IonCannonPowerInfo'],
  exposedForDestroyedActors: false,
  description: 'Ion Cannon power: ActivateIonCannon',
})
