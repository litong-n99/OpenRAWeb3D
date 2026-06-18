/**
 * RepairableBuildingProperties.ts — Script-exposed building repair controls
 * OpenRA 对照: RepairableBuildingProperties.cs
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

export class RepairableBuildingProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits = ['RepairableBuildingInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _rb: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._rb = (self as any).trait?.('RepairableBuilding') ?? null
  }

  StartBuildingRepairs(repairer?: PlayerStub): void {
    if (!this._rb) return
    const player = repairer ?? this.self.owner!
    if (!this._rb.repairers?.includes?.(player)) {
      this._rb.repairBuilding?.(this.self, player)
    }
  }

  StopBuildingRepairs(repairer?: PlayerStub): void {
    if (!this._rb) return
    const player = repairer ?? this.self.owner!
    if (this._rb.repairActive && this._rb.repairers?.includes?.(player)) {
      this._rb.repairBuilding?.(this.self, player)
    }
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'StartBuildingRepairs', returnType: 'nil',
        description: 'Start repairs on this building. repairer can be an allied player.',
        parameters: [
          { name: 'repairer', type: 'Player', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => { this.StartBuildingRepairs(args[0] as PlayerStub | undefined) },
      },
      {
        memberType: 'method', name: 'StopBuildingRepairs', returnType: 'nil',
        description: 'Stop repairs on this building. repairer can be an allied player.',
        parameters: [
          { name: 'repairer', type: 'Player', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => { this.StopBuildingRepairs(args[0] as PlayerStub | undefined) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: RepairableBuildingProperties,
  requiredTraits: ['RepairableBuildingInfo'],
  exposedForDestroyedActors: false,
  description: 'Building repair: StartBuildingRepairs, StopBuildingRepairs',
})
