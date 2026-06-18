/**
 * MapGlobal.ts — ScriptGlobal for map spatial queries and actor lookup
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/MapGlobal.cs
 *
 * 核心范式转换:
 * - C# SpawnMapActors trait → context.registerMapActor() calls
 * - C# world.FindActorsInCircle() → world.findActorsInCircle()
 * - C# world.ActorMap.ActorsInBox() → world.actorMap.actorsInBox()
 * - C# Obsolete TopLeft/BottomRight → marked with @deprecated JSDoc
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { WDist } from '../../../OpenRA.Game/WDist.js'
import { WorldType } from './GlobalTypes.js'
import type { PhaseCWorldStub } from './GlobalTypes.js'

export class MapGlobal extends ScriptGlobal {
  private _namedActorsList: IGameActor[] = []
  private _lastMapActorID = 0

  constructor(context: IScriptContext) {
    super(context, 'Map')
    this.bind([this])

    // Register named map actors from SpawnMapActors trait (stub)
    // In full integration: context.world.worldActor.Trait<SpawnMapActors>().Actors
    // Phase C: empty stub — named actors registered by ScriptComponent
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  private get _map() {
    return this._world.map
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      // --- Methods ---
      {
        memberType: 'method',
        name: 'ActorsInCircle',
        description: 'Returns a table of all actors within the requested region, filtered using the specified function.',
        returnType: 'Actor[]',
        parameters: [
          { name: 'location', type: 'WPos', optional: false },
          { name: 'radius', type: 'WDist', optional: false },
          { name: 'filter', type: 'function', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._actorsInCircle(args[0] as WPos, args[1] as WDist, args[2] as ((a: unknown) => boolean) | undefined),
      },
      {
        memberType: 'method',
        name: 'ActorsInBox',
        description: 'Returns a table of all actors within the requested rectangle, filtered using the specified function.',
        returnType: 'Actor[]',
        parameters: [
          { name: 'topLeft', type: 'WPos', optional: false },
          { name: 'bottomRight', type: 'WPos', optional: false },
          { name: 'filter', type: 'function', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._actorsInBox(args[0] as WPos, args[1] as WPos, args[2] as ((a: unknown) => boolean) | undefined),
      },
      {
        memberType: 'method',
        name: 'RandomCell',
        description: 'Returns a random cell inside the visible region of the map.',
        returnType: 'CPos',
        parameters: [],
        invoke: () => this._map.chooseRandomCell(this._world.sharedRandom),
      },
      {
        memberType: 'method',
        name: 'RandomEdgeCell',
        description: 'Returns a random cell on the visible border of the map.',
        returnType: 'CPos',
        parameters: [],
        invoke: () => this._map.chooseRandomEdgeCell(this._world.sharedRandom),
      },
      {
        memberType: 'method',
        name: 'ClosestEdgeCell',
        description: 'Returns the closest cell on the visible border of the map from the given cell.',
        returnType: 'CPos',
        parameters: [
          { name: 'givenCell', type: 'CPos', optional: false },
        ],
        invoke: (_t, args) => this._map.chooseClosestEdgeCell(args[0] as CPos),
      },
      {
        memberType: 'method',
        name: 'ClosestMatchingEdgeCell',
        description: 'Returns the first cell on the visible border of the map from the given cell, matching the filter function called as function(cell: cpos):boolean.',
        returnType: 'CPos',
        parameters: [
          { name: 'givenCell', type: 'CPos', optional: false },
          { name: 'filter', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._closestMatchingEdgeCell(args[0] as CPos, args[1] as (c: unknown) => boolean),
      },
      {
        memberType: 'method',
        name: 'CenterOfCell',
        description: 'Returns the center of a cell in world coordinates.',
        returnType: 'WPos',
        parameters: [
          { name: 'cell', type: 'CPos', optional: false },
        ],
        invoke: (_t, args) => this._map.centerOfCell(args[0] as CPos),
      },
      {
        memberType: 'method',
        name: 'TerrainType',
        description: 'Returns the type of the terrain at the target cell.',
        returnType: 'string',
        parameters: [
          { name: 'cell', type: 'CPos', optional: false },
        ],
        invoke: (_t, args) => this._map.getTerrainInfo(args[0] as CPos).type,
      },
      {
        memberType: 'method',
        name: 'LobbyOption',
        description: 'Returns the value of a ScriptLobbyDropdown selected in the game lobby.',
        returnType: 'string',
        parameters: [
          { name: 'id', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._lobbyOption(args[0] as string),
      },
      {
        memberType: 'method',
        name: 'LobbyOptionOrDefault',
        description: 'Returns the value of a ScriptLobbyDropdown selected in the game lobby or fallback to a default value.',
        returnType: 'string',
        parameters: [
          { name: 'id', type: 'string', optional: false },
          { name: 'fallback', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._lobbyOptionOrDefault(args[0] as string, args[1] as string),
      },
      {
        memberType: 'method',
        name: 'NamedActor',
        description: 'Returns the actor that was specified with a given name in the map file (or nil, if the actor is dead or not found).',
        returnType: 'Actor',
        parameters: [
          { name: 'actorName', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._namedActor(args[0] as string),
      },
      {
        memberType: 'method',
        name: 'IsNamedActor',
        description: 'Returns true if actor was originally specified in the map file.',
        returnType: 'boolean',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
        ],
        invoke: (_t, args) => this._isNamedActor(args[0] as IGameActor),
      },
      {
        memberType: 'method',
        name: 'ActorsWithTag',
        description: 'Returns a table of all actors tagged with the given string.',
        returnType: 'Actor[]',
        parameters: [
          { name: 'tag', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._actorsWithTag(args[0] as string),
      },
      // --- Properties ---
      {
        memberType: 'property',
        name: 'TopLeft',
        description: 'Returns the location of the top-left corner of the map (assuming zero terrain height). @deprecated Use Map.ActorsInWorld instead.',
        returnType: 'WPos',
        get: () => this._map.projectedTopLeft,
      },
      {
        memberType: 'property',
        name: 'BottomRight',
        description: 'Returns the location of the bottom-right corner of the map (assuming zero terrain height). @deprecated Use Map.ActorsInWorld instead.',
        returnType: 'WPos',
        get: () => this._map.projectedBottomRight,
      },
      {
        memberType: 'property',
        name: 'IsSinglePlayer',
        description: 'Returns true if there is only one human player.',
        returnType: 'boolean',
        get: () => [...this._world.lobbyInfo.nonBotPlayers].length === 1,
      },
      {
        memberType: 'property',
        name: 'IsPausedShellmap',
        description: 'Returns true if this is a shellmap and the player has paused animations.',
        returnType: 'boolean',
        get: () => this._world.type === WorldType.Shellmap,
      },
      {
        memberType: 'property',
        name: 'NamedActors',
        description: 'Returns a table of all the actors that were specified in the map file.',
        returnType: 'Actor[]',
        get: () => [...this._namedActorsList],
      },
      {
        memberType: 'property',
        name: 'ActorsInWorld',
        description: 'Returns a table of all the actors that are currently on the map/in the world.',
        returnType: 'Actor[]',
        get: () => [...this._world.actors],
      },
    ]
  }

  // --- Private implementations ---

  private _actorsInCircle(location: WPos, radius: WDist, filter?: (a: unknown) => boolean): IGameActor[] {
    const actors = this._world.findActorsInCircle(location, radius)
    return this.filterObjects(actors, filter)
  }

  private _actorsInBox(topLeft: WPos, bottomRight: WPos, filter?: (a: unknown) => boolean): IGameActor[] {
    const actors = this._world.actorMap.actorsInBox(topLeft, bottomRight)
    return this.filterObjects(actors, filter)
  }

  private _closestMatchingEdgeCell(givenCell: CPos, filter: (c: unknown) => boolean): CPos | null {
    // Sort edge cells by distance to givenCell, then find first matching filter
    const edgeCells = [...this._map.allEdgeCells]
    const sorted = edgeCells.sort((a, b) => {
      // Use CPos distance heuristic
      return (givenCell.X - a.X) ** 2 + (givenCell.Y - a.Y) ** 2
        - (givenCell.X - b.X) ** 2 - (givenCell.Y - b.Y) ** 2
    })
    for (const cell of sorted) {
      if (filter(cell)) return cell
    }
    return null
  }

  private _lobbyOption(id: string): string | null {
    // Stub: in full integration, query worldActor for ScriptLobbyDropdown traits
    this.context.logDebug(`LobbyOption: '${id}' (no lobby options registered — returning null)`)
    return null
  }

  private _lobbyOptionOrDefault(id: string, fallback: string): string {
    return this._lobbyOption(id) ?? fallback
  }

  private _namedActor(actorName: string): IGameActor | null {
    // Check named actors registered via context.registerMapActor()
    const namedActors = this.context.namedActors
    if (namedActors) {
      const actor = namedActors.get(actorName)
      if (actor && !(actor as unknown as { disposed: boolean }).disposed) {
        return actor
      }
    }
    return null
  }

  private _isNamedActor(actor: IGameActor): boolean {
    const actorId = (actor as unknown as { actorId: number }).actorId
    return (
      actorId <= this._lastMapActorID &&
      actorId > this._lastMapActorID - this._namedActorsList.length
    )
  }

  private _actorsWithTag(_tag: string): IGameActor[] {
    // Stub: in full integration, query actors having ScriptTags trait
    // Phase C: return empty array
    return []
  }
}

ScriptRegistry.registerGlobal('Map', MapGlobal, 'Map spatial queries and actor lookup')
