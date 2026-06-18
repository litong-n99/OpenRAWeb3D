/**
 * TriggerGlobal.ts — ScriptGlobal for event triggers and timed callbacks
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/TriggerGlobal.cs (588 lines)
 *
 * 核心范式转换:
 * - C# GetScriptTriggers(actor) static helper → _getScriptTriggers(actor)
 * - C# LuaFunction func.CopyReference() + using(func) func.Call() → TriggerCallback
 * - C# world.AddFrameEndTask(w => w.Add(new DelayedAction(...)))
 *   → setTimeout for AfterDelay (stub)
 * - C# event Action<Actor> OnKilledInternal += handler
 *   → Set<ActorEventCallback>.add(handler)
 * - C# Enum.Parse<Trigger>(triggerName) → Trigger name lookup
 * - C# actor.ToLuaValue(Context) → toScriptValue(actor) wrapper
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { ScriptTypes } from '../../../OpenRA.Game/Scripting/ScriptTypes.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import type { PhaseCWorldStub } from './GlobalTypes.js'

import type { ScriptTriggers } from '../ScriptTriggers.js'
import { Trigger } from '../ScriptTriggers.js'
import type { TriggerCallback } from '../ScriptTriggers.js'
import type { Trigger as TriggerType } from '../ScriptTriggers.js'

export class TriggerGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Trigger')
    this.bind([this])
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  /**
   * Get the ScriptTriggers trait from an actor, throwing if absent.
   *
   * OpenRA 对照: TriggerGlobal.GetScriptTriggers(Actor)
   */
  private static _getScriptTriggers(actor: IGameActor): ScriptTriggers {
    const traits = (actor as unknown as { _traits?: Map<string, unknown> })._traits
    const st = traits?.get('ScriptTriggers') as ScriptTriggers | undefined
    if (!st) {
      throw new Error(`Actor requires the ScriptTriggers trait before attaching a trigger`)
    }
    return st
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      // --- AfterDelay ---
      {
        memberType: 'method',
        name: 'AfterDelay',
        description: 'Call a function after a specified delay. The callback function will be called as func().',
        returnType: 'nil',
        parameters: [
          { name: 'delay', type: 'number', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._afterDelay(args[0] as number, args[1] as TriggerCallback),
      },
      // --- Actor-specific triggers ---
      {
        memberType: 'method',
        name: 'OnPassengerEntered',
        description: 'Call a function for each passenger when it enters a transport. The callback function will be called as func(transport: actor, passenger: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnPassengerEntered, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnPassengerExited',
        description: 'Call a function for each passenger when it exits a transport. The callback function will be called as func(transport: actor, passenger: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnPassengerExited, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnIdle',
        description: 'Call a function each tick that the actor is idle. The callback function will be called as func(self: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnIdle, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnDamaged',
        description: 'Call a function when the actor is damaged. Repairs or other negative damage can activate this trigger. The callback function will be called as func(self: actor, attacker: actor, damage: integer).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnDamaged, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnKilled',
        description: 'Call a function when the actor is killed. The callback function will be called as func(self: actor, killer: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnKilled, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnAllKilled',
        description: 'Call a function when all of the actors in a group are killed. The callback function will be called as func().',
        returnType: 'nil',
        parameters: [
          { name: 'actors', type: 'Actor[]', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onAllKilled(args[0] as IGameActor[], args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnAnyKilled',
        description: 'Call a function when one of the actors in a group is killed. This trigger is only called once. The callback function will be called as func(killed: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actors', type: 'Actor[]', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onAnyKilled(args[0] as IGameActor[], args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnProduction',
        description: 'Call a function when this actor produces another actor. The callback function will be called as func(producer: actor, produced: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnProduction, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnAnyProduction',
        description: 'Call a function when any actor produces another actor. The callback function will be called as func(producer: actor, produced: actor, productionType: string).',
        returnType: 'nil',
        parameters: [
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onWorldActorTrigger(Trigger.OnOtherProduction, args[0] as TriggerCallback),
      },
      // --- Player-specific triggers ---
      {
        memberType: 'method',
        name: 'OnPlayerWon',
        description: 'Call a function when this player completes all primary objectives. The callback function will be called as func(p: player).',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onPlayerTrigger(args[0] as PlayerStub, Trigger.OnPlayerWon, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnPlayerLost',
        description: 'Call a function when this player fails any primary objective. The callback function will be called as func(p: player).',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onPlayerTrigger(args[0] as PlayerStub, Trigger.OnPlayerLost, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnObjectiveAdded',
        description: 'Call a function when this player is assigned a new objective. The callback function will be called as func(p: player, objectiveId: integer).',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onPlayerTrigger(args[0] as PlayerStub, Trigger.OnObjectiveAdded, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnObjectiveCompleted',
        description: 'Call a function when this player completes an objective. The callback function will be called as func(p: player, objectiveId: integer).',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onPlayerTrigger(args[0] as PlayerStub, Trigger.OnObjectiveCompleted, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnObjectiveFailed',
        description: 'Call a function when this player fails an objective. The callback function will be called as func(p: player, objectiveId: integer).',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onPlayerTrigger(args[0] as PlayerStub, Trigger.OnObjectiveFailed, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnBuildingPlaced',
        description: 'Call a function when this player places a building. The callback function will be called as func(p: player, placed: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onPlayerTrigger(args[0] as PlayerStub, Trigger.OnBuildingPlaced, args[1] as TriggerCallback),
      },
      // --- World lifecycle triggers ---
      {
        memberType: 'method',
        name: 'OnAddedToWorld',
        description: 'Call a function when this actor is added to the world. The callback function will be called as func(self: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnAddedToWorld, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnRemovedFromWorld',
        description: 'Call a function when this actor is removed from the world. The callback function will be called as func(self: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnRemovedFromWorld, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnAllRemovedFromWorld',
        description: 'Call a function when all of the actors in a group have been removed from the world. The callback function will be called as func().',
        returnType: 'nil',
        parameters: [
          { name: 'actors', type: 'Actor[]', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onAllRemovedFromWorld(args[0] as IGameActor[], args[1] as TriggerCallback),
      },
      // --- Capture / Kill-or-Capture ---
      {
        memberType: 'method',
        name: 'OnCapture',
        description: 'Call a function when this actor is captured. The callback function will be called as func(self: actor, captor: actor, oldOwner: player, newOwner: player).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnCapture, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnKilledOrCaptured',
        description: 'Call a function when this actor is killed or captured. This trigger is only called once. The callback function will be called as func().',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onKilledOrCaptured(args[0] as IGameActor, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnAllKilledOrCaptured',
        description: 'Call a function when all of the actors in a group have been killed or captured. This trigger is only called once. The callback function will be called as func().',
        returnType: 'nil',
        parameters: [
          { name: 'actors', type: 'Actor[]', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onAllKilledOrCaptured(args[0] as IGameActor[], args[1] as TriggerCallback),
      },
      // --- Footprint triggers ---
      {
        memberType: 'method',
        name: 'OnEnteredFootprint',
        description: 'Call a function when a ground-based actor enters this cell footprint. Returns the trigger ID for later removal using RemoveFootprintTrigger(id: integer). The callback function will be called as func(a: actor, id: integer).',
        returnType: 'number',
        parameters: [
          { name: 'cells', type: 'CPos[]', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onEnteredFootprint(args[0] as CPos[], args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnExitedFootprint',
        description: 'Call a function when a ground-based actor leaves this cell footprint. Returns the trigger ID for later removal using RemoveFootprintTrigger(id: integer). The callback function will be called as func(a: actor, id: integer).',
        returnType: 'number',
        parameters: [
          { name: 'cells', type: 'CPos[]', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onExitedFootprint(args[0] as CPos[], args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'RemoveFootprintTrigger',
        description: 'Removes a previously created footprint trigger.',
        returnType: 'nil',
        parameters: [
          { name: 'id', type: 'number', optional: false },
        ],
        invoke: (_t, args) => this._removeFootprintTrigger(args[0] as number),
      },
      // --- Proximity triggers ---
      {
        memberType: 'method',
        name: 'OnEnteredProximityTrigger',
        description: 'Call a function when an actor enters this range. Returns the trigger ID for later removal using RemoveProximityTrigger(id: integer). The callback function will be called as func(a: actor, id: integer).',
        returnType: 'number',
        parameters: [
          { name: 'pos', type: 'WPos', optional: false },
          { name: 'range', type: 'WDist', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onEnteredProximityTrigger(args[0] as WPos, args[1] as WDist, args[2] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnExitedProximityTrigger',
        description: 'Call a function when an actor leaves this range. Returns the trigger ID for later removal using RemoveProximityTrigger(id: integer). The callback function will be called as func(a: actor, id: integer).',
        returnType: 'number',
        parameters: [
          { name: 'pos', type: 'WPos', optional: false },
          { name: 'range', type: 'WDist', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onExitedProximityTrigger(args[0] as WPos, args[1] as WDist, args[2] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'RemoveProximityTrigger',
        description: 'Removes a previously created proximity trigger.',
        returnType: 'nil',
        parameters: [
          { name: 'id', type: 'number', optional: false },
        ],
        invoke: (_t, args) => this._removeProximityTrigger(args[0] as number),
      },
      // --- Other triggers ---
      {
        memberType: 'method',
        name: 'OnInfiltrated',
        description: 'Call a function when this actor is infiltrated. The callback function will be called as func(self: actor, infiltrator: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnInfiltrated, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnDiscovered',
        description: 'Call a function when this actor is discovered by an enemy or a player with a Neutral stance. The callback function will be called as func(discovered: actor, discoverer: player). The player actor needs the EnemyWatcher trait. The actors to discover need the AnnounceOnSeen trait.',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnDiscovered, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnPlayerDiscovered',
        description: 'Call a function when this player is discovered by an enemy or neutral player. The callback function will be called as func(discovered: player, discoverer: player, discoveredActor: actor). The player actor needs the EnemyWatcher trait. The actors to discover need the AnnounceOnSeen trait.',
        returnType: 'nil',
        parameters: [
          { name: 'player', type: 'Player', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onPlayerTrigger(args[0] as PlayerStub, Trigger.OnPlayerDiscovered, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnSold',
        description: 'Call a function when this actor is sold. The callback function will be called as func(self: actor).',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onActorTrigger(args[0] as IGameActor, Trigger.OnSold, args[1] as TriggerCallback),
      },
      {
        memberType: 'method',
        name: 'OnTimerExpired',
        description: 'Call a function when the game timer expires. The callback function will be called as func().',
        returnType: 'nil',
        parameters: [
          { name: 'func', type: 'function', optional: false },
        ],
        invoke: (_t, args) => this._onWorldActorTrigger(Trigger.OnTimerExpired, args[0] as TriggerCallback),
      },
      // --- Cleanup ---
      {
        memberType: 'method',
        name: 'ClearAll',
        description: 'Removes all triggers from this actor. Note that the removal will only take effect at the end of a tick, so you must not add new triggers at the same time that you are calling this function.',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
        ],
        invoke: (_t, args) => this._clearAll(args[0] as IGameActor),
      },
      {
        memberType: 'method',
        name: 'Clear',
        description: 'Removes the specified trigger from this actor. Note that the removal will only take effect at the end of a tick, so you must not add new triggers at the same time that you are calling this function.',
        returnType: 'nil',
        parameters: [
          { name: 'actor', type: 'Actor', optional: false },
          { name: 'triggerName', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._clear(args[0] as IGameActor, args[1] as string),
      },
    ]
  }

  // ---------------------------------------------------------------------------
  // Private implementations
  // ---------------------------------------------------------------------------

  private _afterDelay(delay: number, func: TriggerCallback): void {
    const ctx = this.context
    const doCall = () => {
      try {
        func(ctx)
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }

    // In full integration: context.world.addFrameEndTask(w => w.add(new DelayedAction(delay, doCall)))
    // Phase C stub: use setTimeout with 40ms per tick (25 TPS)
    setTimeout(doCall, delay * 40)
  }

  private _onActorTrigger(actor: IGameActor | null, trigger: TriggerType, func: TriggerCallback): void {
    if (!actor) throw new Error('actor must not be null')
    const st = TriggerGlobal._getScriptTriggers(actor)
    st.registerCallback(trigger, func, this.context)
  }

  private _onPlayerTrigger(player: PlayerStub | null, trigger: TriggerType, func: TriggerCallback): void {
    if (!player) throw new Error('player must not be null')
    const playerActor = (player as unknown as { playerActor: IGameActor }).playerActor
    const st = TriggerGlobal._getScriptTriggers(playerActor)
    st.registerCallback(trigger, func, this.context)
  }

  private _onWorldActorTrigger(trigger: TriggerType, func: TriggerCallback): void {
    const worldActor = this._world.worldActor
    const st = TriggerGlobal._getScriptTriggers(worldActor)
    st.registerCallback(trigger, func, this.context)
  }

  private _onAllKilled(actors: IGameActor[] | null, func: TriggerCallback): void {
    if (!actors) throw new Error('actors must not be null')
    const group = new Set(actors)
    const ctx = this.context
    const onMemberKilled = (m: IGameActor) => {
      try {
        group.delete(m)
        if (group.size === 0) {
          func(ctx)
        }
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    for (const a of actors) {
      const st = TriggerGlobal._getScriptTriggers(a)
      st.onKilledInternal.add(onMemberKilled)
    }
  }

  private _onAnyKilled(actors: IGameActor[] | null, func: TriggerCallback): void {
    if (!actors) throw new Error('actors must not be null')
    let called = false
    const ctx = this.context
    const onMemberKilled = (m: IGameActor) => {
      try {
        if (called) return
        called = true
        func(ctx, ScriptTypes.toScriptValue(m, ctx))
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    for (const a of actors) {
      const st = TriggerGlobal._getScriptTriggers(a)
      st.onKilledInternal.add(onMemberKilled)
    }
  }

  private _onAllRemovedFromWorld(actors: IGameActor[] | null, func: TriggerCallback): void {
    if (!actors) throw new Error('actors must not be null')
    const group = new Set(actors)
    const ctx = this.context
    const onMemberRemoved = (m: IGameActor) => {
      try {
        if (!group.delete(m)) return
        if (group.size === 0) {
          func(ctx)
        }
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    const onMemberAdded = (m: IGameActor) => {
      try {
        if (!actors.includes(m) || group.has(m)) return
        group.add(m)
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    for (const a of group) {
      const st = TriggerGlobal._getScriptTriggers(a)
      st.onRemovedInternal.add(onMemberRemoved)
      st.onAddedInternal.add(onMemberAdded)
    }
  }

  private _onKilledOrCaptured(actor: IGameActor | null, func: TriggerCallback): void {
    if (!actor) throw new Error('actor must not be null')
    let called = false
    const ctx = this.context
    const handler = (_m: IGameActor) => {
      try {
        if (called) return
        called = true
        func(ctx)
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    const st = TriggerGlobal._getScriptTriggers(actor)
    st.onCapturedInternal.add(handler)
    st.onKilledInternal.add(handler)
  }

  private _onAllKilledOrCaptured(actors: IGameActor[] | null, func: TriggerCallback): void {
    if (!actors) throw new Error('actors must not be null')
    const group = new Set(actors)
    const ctx = this.context
    const handler = (m: IGameActor) => {
      try {
        if (!group.delete(m)) return
        if (group.size === 0) {
          func(ctx)
        }
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    for (const a of group) {
      const st = TriggerGlobal._getScriptTriggers(a)
      st.onCapturedInternal.add(handler)
      st.onKilledInternal.add(handler)
    }
  }

  private _onEnteredFootprint(cells: CPos[], func: TriggerCallback): number {
    const ctx = this.context
    let triggerId = 0
    const invokeEntry = (a: IGameActor) => {
      try {
        func(ctx, ScriptTypes.toScriptValue(a, ctx), triggerId)
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    triggerId = this._world.actorMap.addCellTrigger(cells, invokeEntry, null)
    return triggerId
  }

  private _onExitedFootprint(cells: CPos[], func: TriggerCallback): number {
    const ctx = this.context
    let triggerId = 0
    const invokeExit = (a: IGameActor) => {
      try {
        func(ctx, ScriptTypes.toScriptValue(a, ctx), triggerId)
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    triggerId = this._world.actorMap.addCellTrigger(cells, null, invokeExit)
    return triggerId
  }

  private _removeFootprintTrigger(id: number): void {
    this._world.actorMap.removeCellTrigger(id)
  }

  private _onEnteredProximityTrigger(pos: WPos, range: WDist, func: TriggerCallback): number {
    const ctx = this.context
    let triggerId = 0
    const invokeEntry = (a: IGameActor) => {
      try {
        func(ctx, ScriptTypes.toScriptValue(a, ctx), triggerId)
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    triggerId = this._world.actorMap.addProximityTrigger(pos, range, WDist.Zero, invokeEntry, null)
    return triggerId
  }

  private _onExitedProximityTrigger(pos: WPos, range: WDist, func: TriggerCallback): number {
    const ctx = this.context
    let triggerId = 0
    const invokeExit = (a: IGameActor) => {
      try {
        func(ctx, ScriptTypes.toScriptValue(a, ctx), triggerId)
      } catch (e) {
        ctx.fatalError(e instanceof Error ? e : new Error(String(e)))
      }
    }
    triggerId = this._world.actorMap.addProximityTrigger(pos, range, WDist.Zero, null, invokeExit)
    return triggerId
  }

  private _removeProximityTrigger(id: number): void {
    this._world.actorMap.removeProximityTrigger(id)
  }

  private _clearAll(actor: IGameActor | null): void {
    if (!actor) throw new Error('actor must not be null')
    const st = TriggerGlobal._getScriptTriggers(actor)
    st.clearAll()
  }

  private _clear(actor: IGameActor | null, triggerName: string): void {
    if (!actor) throw new Error('actor must not be null')
    const triggerValue = Trigger[triggerName as keyof typeof Trigger]
    if (triggerValue === undefined) {
      throw new Error(`Invalid trigger name: '${triggerName}'`)
    }
    const st = TriggerGlobal._getScriptTriggers(actor)
    st.clear(triggerValue as TriggerType)
  }
}

ScriptRegistry.registerGlobal('Trigger', TriggerGlobal, 'Event triggers and timed callbacks')
