/**
 * DateTimeGlobal.ts — ScriptGlobal for game time and real-world clock access
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/DateTimeGlobal.cs
 *
 * 核心范式转换:
 * - C# DateTime.Today/Now → new Date() + getters
 * - C# TimeLimitManager trait → stub access via world.worldActor
 * - C# Game.ModData.GetOrCreate<GameSpeeds>() → hardcoded default (25 TPS)
 * - Class name is DateTimeGlobal (TS file) but script-visible name is "DateTime"
 *   (OpenRA class is DateGlobal but script name is "DateTime")
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { PhaseCWorldStub } from './GlobalTypes.js'

export class DateTimeGlobal extends ScriptGlobal {
  /** Cached ticks per second (hardcoded default: 25 TPS = 40ms timestep → 1000/40=25 tps) */
  private readonly _ticksPerSecond: number = 25

  /** Stub TimeLimitManager */
  private _timeLimit: number = 0
  private _timeLimitNotification: string | null = null

  constructor(context: IScriptContext) {
    super(context, 'DateTime')
    this.bind([this])

    // In full integration: get TimeLimitManager from world.worldActor
    // For now, stub it internally
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      // --- Properties ---
      {
        memberType: 'property',
        name: 'IsHalloween',
        description: 'True on the 31st of October.',
        returnType: 'boolean',
        get: () => {
          const now = new Date()
          return now.getMonth() === 9 && now.getDate() === 31
        },
      },
      {
        memberType: 'property',
        name: 'GameTime',
        description: 'Get the current game time (in ticks).',
        returnType: 'number',
        get: () => this._world.worldTick,
      },
      {
        memberType: 'property',
        name: 'CurrentYear',
        description: 'Get the current year (1-9999).',
        returnType: 'number',
        get: () => new Date().getFullYear(),
      },
      {
        memberType: 'property',
        name: 'CurrentMonth',
        description: 'Get the current month (1-12).',
        returnType: 'number',
        get: () => new Date().getMonth() + 1,
      },
      {
        memberType: 'property',
        name: 'CurrentDay',
        description: 'Get the current day (1-31).',
        returnType: 'number',
        get: () => new Date().getDate(),
      },
      {
        memberType: 'property',
        name: 'CurrentHour',
        description: 'Get the current hour (0-23).',
        returnType: 'number',
        get: () => new Date().getHours(),
      },
      {
        memberType: 'property',
        name: 'CurrentMinute',
        description: 'Get the current minute (0-59).',
        returnType: 'number',
        get: () => new Date().getMinutes(),
      },
      {
        memberType: 'property',
        name: 'CurrentSecond',
        description: 'Get the current second (0-59).',
        returnType: 'number',
        get: () => new Date().getSeconds(),
      },
      {
        memberType: 'property',
        name: 'TimeLimit',
        description: 'Return or set the time limit (in ticks). When setting, the time limit will count from now. Setting to 0 disables it.',
        returnType: 'number',
        get: () => this._timeLimit,
        set: (_t, value) => {
          const v = value as number
          if (v === 0) {
            this._timeLimit = 0
          } else {
            this._timeLimit = v + this._world.worldTick
          }
        },
      },
      {
        memberType: 'property',
        name: 'TimeLimitNotification',
        description: 'The notification string used for custom time limit warnings.',
        returnType: 'string',
        get: () => this._timeLimitNotification,
        set: (_t, value) => { this._timeLimitNotification = value as string },
      },
      // --- Methods ---
      {
        memberType: 'method',
        name: 'Seconds',
        description: 'Converts the number of seconds into game time (ticks).',
        returnType: 'number',
        parameters: [
          { name: 'seconds', type: 'number', optional: false },
        ],
        invoke: (_t, args) => (args[0] as number) * this._ticksPerSecond,
      },
      {
        memberType: 'method',
        name: 'Minutes',
        description: 'Converts the number of minutes into game time (ticks).',
        returnType: 'number',
        parameters: [
          { name: 'minutes', type: 'number', optional: false },
        ],
        invoke: (_t, args) => (args[0] as number) * 60 * this._ticksPerSecond,
      },
    ]
  }
}

ScriptRegistry.registerGlobal('DateTime', DateTimeGlobal, 'Game time and real-world clock')
