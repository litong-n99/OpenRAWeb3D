/**
 * PlayerGlobal.ts — ScriptGlobal for player lookup
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/PlayerGlobal.cs
 *
 * 核心范式转换:
 * - C# Context.World.Players.FirstOrDefault(p => p.InternalName == name)
 *   → Array iteration with find()
 * - C# FilteredObjects(players, filter) extension method
 *   → ScriptGlobal.filterObjects() with type-safe wrapper
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PhaseCWorldStub } from './GlobalTypes.js'

export class PlayerGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Player')
    this.bind([this])
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'GetPlayer',
        description: 'Returns the player with the specified internal name, or nil if a match is not found.',
        returnType: 'Player',
        parameters: [
          { name: 'name', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._getPlayer(args[0] as string),
      },
      {
        memberType: 'method',
        name: 'GetPlayers',
        description: 'Returns a table of players filtered by the specified function.',
        returnType: 'Player[]',
        parameters: [
          { name: 'filter', type: 'function', optional: true },
        ],
        invoke: (_t, args) => this._getPlayers(args[0] as ((p: unknown) => boolean) | undefined),
      },
    ]
  }

  private _getPlayer(name: string): PlayerStub | null {
    const players = [...this._world.players]
    return players.find(p => (p as unknown as { internalName: string }).internalName === name) ?? null
  }

  private _getPlayers(filter?: (p: unknown) => boolean): PlayerStub[] {
    const players = [...this._world.players]
    return this.filterObjects(players, filter)
  }
}

ScriptRegistry.registerGlobal('Player', PlayerGlobal, 'Player lookup')
