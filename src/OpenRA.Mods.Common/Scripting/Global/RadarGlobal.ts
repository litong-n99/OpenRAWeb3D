/**
 * RadarGlobal.ts — ScriptGlobal for radar widget control
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/RadarGlobal.cs
 *
 * 核心范式转换:
 * - C# RadarPings trait on WorldActor → stub radarPings access
 * - C# radarPings.Add(() => player.World.RenderPlayer == player, ...)
 *   → stub radarPings.add()
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import type { ScriptColor } from './ColorUtils.js'

export class RadarGlobal extends ScriptGlobal {
  /** Stub radar pings — in full integration, obtained from world.worldActor */
  private _radarPings: { add: (visible: () => boolean, pos: WPos, color: ScriptColor, duration: number) => void } | null = null

  constructor(context: IScriptContext) {
    super(context, 'Radar')
    this.bind([this])
    // In full integration: context.world.worldActor.TraitOrDefault<RadarPings>()
    this._radarPings = {
      add: (_visible: () => boolean, _pos: WPos, _color: ScriptColor, _duration: number) => {
        // Stub: radar ping creation
      },
    }
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'Ping',
        description: 'Creates a new radar ping that stays for the specified time at the specified WPos.',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'position', type: 'WPos', optional: false },
          { name: 'color', type: 'Color', optional: false },
          { name: 'duration', type: 'number', optional: true, defaultValue: 750 },
        ],
        invoke: (_t, args) => this._ping(
          args[0] as PlayerStub,
          args[1] as WPos,
          args[2] as ScriptColor,
          args[3] as number | undefined,
        ),
      },
    ]
  }

  private _ping(player: PlayerStub, position: WPos, color: ScriptColor, duration?: number): void {
    const dur = duration ?? 750
    this._radarPings?.add(
      () => (player as unknown as { world: { renderPlayer: PlayerStub } }).world?.renderPlayer === player,
      position,
      color,
      dur,
    )
  }
}

ScriptRegistry.registerGlobal('Radar', RadarGlobal, 'Radar widget control')
