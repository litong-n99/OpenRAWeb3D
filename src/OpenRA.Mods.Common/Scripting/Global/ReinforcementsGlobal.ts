/**
 * ReinforcementsGlobal.ts — ScriptGlobal for unit delivery and transport
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/ReinforcementsGlobal.cs
 *
 * 核心范式转换:
 * - C# TypeDictionary initDict → ActorInitValue[] array
 * - C# IMove trait via actor.TraitOrDefault<IMove>() → stub movement
 * - C# SpawnActorEffect(actor, delay, path, queuedActivity) → addFrameEndTask stub
 * - C# Cargo trait Load/Unload → stub
 * - C# LuaTable return with { [1]: transport, [2]: cargo[] } → [transport, cargo[]] tuple
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { PhaseCWorldStub } from './GlobalTypes.js'

type InitEntry = { initName: string; value: unknown }

export class ReinforcementsGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Reinforcements')
    this.bind([this])
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'Reinforce',
        description: 'Send reinforcements consisting of multiple units. Supports ground-based, naval and air units. Returns a table containing the deployed units.',
        returnType: 'Actor[]',
        parameters: [
          { name: 'owner', type: 'Player', optional: false },
          { name: 'actorTypes', type: 'string[]', optional: false },
          { name: 'entryPath', type: 'CPos[]', optional: false },
          { name: 'interval', type: 'number', optional: true, defaultValue: 25 },
          { name: 'actionFunc', type: 'function', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._reinforce(
          args[0] as PlayerStub,
          args[1] as string[],
          args[2] as CPos[],
          args[3] as number | undefined,
          args[4] as ((actor: unknown) => void) | undefined,
        ),
      },
      {
        memberType: 'method',
        name: 'ReinforceWithTransport',
        description: 'Send reinforcements in a transport. Returns a table: { [1]: transport, [2]: cargo[] }.',
        returnType: 'table',
        parameters: [
          { name: 'owner', type: 'Player', optional: false },
          { name: 'actorType', type: 'string', optional: false },
          { name: 'cargoTypes', type: 'string[]', optional: true, defaultValue: null },
          { name: 'entryPath', type: 'CPos[]', optional: false },
          { name: 'exitPath', type: 'CPos[]', optional: true, defaultValue: null },
          { name: 'actionFunc', type: 'function', optional: true, defaultValue: null },
          { name: 'exitFunc', type: 'function', optional: true, defaultValue: null },
          { name: 'dropRange', type: 'number', optional: true, defaultValue: 3 },
        ],
        invoke: (_t, args) => this._reinforceWithTransport(
          args[0] as PlayerStub,
          args[1] as string,
          args[2] as string[] | undefined,
          args[3] as CPos[],
          args[4] as CPos[] | undefined,
          args[5] as ((...a: unknown[]) => void) | undefined,
          args[6] as ((t: unknown) => void) | undefined,
          args[7] as number | undefined,
        ),
      },
    ]
  }

  // --- Private implementations ---

  /**
   * Create an actor with optional location and facing.
   *
   * OpenRA 对照: ReinforcementsGlobal.CreateActor()
   */
  private _createActor(
    owner: PlayerStub,
    actorType: string,
    addToWorld: boolean,
    entryLocation?: CPos,
    nextLocation?: CPos,
  ): IGameActor {
    const ai = this._world.map.rules.actors.get(actorType)
    if (!ai) throw new Error(`Unknown actor type '${actorType}'`)

    const inits: InitEntry[] = [
      { initName: 'Owner', value: owner },
    ]

    if (entryLocation) {
      inits.push({ initName: 'Location', value: entryLocation })

      const aircraftInfo = ai.getTraitInfo<{ cruiseAltitude?: { length: number } }>('AircraftInfo')
      if (aircraftInfo?.cruiseAltitude) {
        const center = this._world.map.centerOfCell(entryLocation)
        inits.push({ initName: 'CenterPosition', value: new WPos(center.X, center.Y, center.Z) })
      }
    }

    if (entryLocation && nextLocation) {
      const deltaX = nextLocation.X - entryLocation.X
      const deltaY = nextLocation.Y - entryLocation.Y
      const facing = this._world.map.facingBetween(
        CPos.Zero,
        new CPos(deltaX, deltaY),
        WAngle.Zero,
      )
      inits.push({ initName: 'Facing', value: facing })
    }

    const actor = this._world.createActor(false, actorType, inits)
    if (addToWorld) {
      this._world.addFrameEndTask(() => {
        this._world.addActor?.(actor)
      })
    }
    return actor
  }

  /**
   * Queue movement for an actor along a path.
   *
   * OpenRA 对照: ReinforcementsGlobal.Move()
   */
  private _move(_actor: IGameActor, _dest: CPos): void {
    // Stub: in full integration, queue Move activity via IMove trait
  }

  private _reinforce(
    owner: PlayerStub,
    actorTypes: string[],
    entryPath: CPos[],
    interval?: number,
    actionFunc?: (actor: unknown) => void,
  ): IGameActor[] {
    const actors: IGameActor[] = []
    const iv = interval ?? 25

    for (let i = 0; i < actorTypes.length; i++) {
      const actor = this._createActor(
        owner,
        actorTypes[i],
        false,
        entryPath[0],
        entryPath.length > 1 ? entryPath[1] : undefined,
      )
      actors.push(actor)

      // Add frame-end task for spawning with delay
      this._world.addFrameEndTask(() => {
        this.context.logDebug(`Reinforce: ${actorTypes[i]} at ${entryPath[0]}, delay=${i * iv}`)
        if (actionFunc) {
          try {
            actionFunc(actor)
          } catch (e) {
            this.context.fatalError(e instanceof Error ? e : new Error(String(e)))
          }
        }
      })
    }

    return actors
  }

  private _reinforceWithTransport(
    owner: PlayerStub,
    actorType: string,
    cargoTypes: string[] | undefined,
    entryPath: CPos[],
    exitPath: CPos[] | undefined,
    actionFunc: ((...a: unknown[]) => void) | undefined,
    exitFunc: ((t: unknown) => void) | undefined,
    _dropRange: number | undefined,
  ): [IGameActor, IGameActor[]] {
    const transport = this._createActor(
      owner,
      actorType,
      true,
      entryPath[0],
      entryPath.length > 1 ? entryPath[1] : undefined,
    )

    const passengers: IGameActor[] = []
    const transportWithCargo = transport as unknown as { cargo?: { load(transport: IGameActor, passenger: IGameActor): void } }

    if (transportWithCargo.cargo && cargoTypes && cargoTypes.length > 0) {
      for (const cargoType of cargoTypes) {
        const passenger = this._createActor(owner, cargoType, false, entryPath[0])
        passengers.push(passenger)
        transportWithCargo.cargo.load(transport, passenger)
      }
    }

    // Queue movement for entry path
    for (let i = 1; i < entryPath.length; i++) {
      this._move(transport, entryPath[i])
    }

    // Handle actionFunc or default unload behavior
    if (actionFunc) {
      try {
        actionFunc(transport, passengers)
      } catch (e) {
        this.context.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }

    // Handle exitFunc or exitPath
    if (exitFunc) {
      try {
        exitFunc(transport)
      } catch (e) {
        this.context.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    } else if (exitPath) {
      for (const wpt of exitPath) {
        this._move(transport, wpt)
      }
      this.context.logDebug('Transport removed after exit path')
    }

    return [transport, passengers]
  }
}

ScriptRegistry.registerGlobal('Reinforcements', ReinforcementsGlobal, 'Unit delivery and transport')
