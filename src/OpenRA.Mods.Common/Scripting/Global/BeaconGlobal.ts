/**
 * BeaconGlobal.ts — ScriptGlobal for map beacon placement
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/BeaconGlobal.cs
 *
 * 核心范式转换:
 * - C# PlaceBeacon trait on PlayerActor → stub beaconInfo access
 * - C# new Beacon(owner, position, duration, ...) → stub Beacon creation
 * - C# world.AddFrameEndTask(w => w.Add(playerBeacon)) → addFrameEndTask stub
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import type { PhaseCWorldStub } from './GlobalTypes.js'

export class BeaconGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Beacon')
    this.bind([this])
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'New',
        description: 'Creates a new beacon that stays for the specified time at the specified WPos. Does not remove player set beacons, nor gets removed by placing them. Requires the PlaceBeacon trait on the player actor.',
        returnType: 'nil',
        parameters: [
          { name: 'owner', type: 'Player', optional: false },
          { name: 'position', type: 'WPos', optional: false },
          { name: 'duration', type: 'number', optional: true, defaultValue: 750 },
          { name: 'showRadarPings', type: 'boolean', optional: true, defaultValue: true },
        ],
        invoke: (_t, args) => this._new(
          args[0] as PlayerStub,
          args[1] as WPos,
          args[2] as number | undefined,
          args[3] as boolean | undefined,
        ),
      },
    ]
  }

  private _new(owner: PlayerStub, position: WPos, duration?: number, showRadarPings?: boolean): void {
    if (!owner) throw new Error('owner must not be null')

    const playerActor = (owner as unknown as { playerActor: { info: { traitInfoOrDefault: (name: string) => unknown } } }).playerActor
    const beaconInfo = playerActor?.info?.traitInfoOrDefault?.('PlaceBeacon')
    if (!beaconInfo) throw new Error("The player actor has no 'PlaceBeacon' trait.")

    this._world.addFrameEndTask(() => {
      this.context.logDebug(`Beacon created at (${position.X}, ${position.Y}, ${position.Z}) for ${duration ?? 750} ticks`)
    })

    if (showRadarPings !== false) {
      this.context.logDebug(`Radar ping for beacon at (${position.X}, ${position.Y}, ${position.Z})`)
    }
  }
}

ScriptRegistry.registerGlobal('Beacon', BeaconGlobal, 'Map beacon placement')
