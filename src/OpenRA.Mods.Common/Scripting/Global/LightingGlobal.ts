/**
 * LightingGlobal.ts — ScriptGlobal for post-process lighting effects
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/LightingGlobal.cs
 *
 * 核心范式转换:
 * - C# FlashPostProcessEffect trait → stub flashEffects array
 * - C# TintPostProcessEffect trait → stub tintEffect with RGBA properties
 * - C# TraitsImplementing<FlashPostProcessEffect>() → stub iteration
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'

export class LightingGlobal extends ScriptGlobal {
  /** Stub tint values (0-1 range) */
  private _red = 1
  private _green = 1
  private _blue = 1
  private _ambient = 1

  constructor(context: IScriptContext) {
    super(context, 'Lighting')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'Flash',
        description: 'Controls the FlashPostProcessEffect trait.',
        returnType: 'nil',
        parameters: [
          { name: 'type', type: 'string', optional: true, defaultValue: null },
          { name: 'ticks', type: 'number', optional: true, defaultValue: -1 },
        ],
        invoke: (_t, args) => this._flash(args[0] as string | null, args[1] as number),
      },
      {
        memberType: 'property',
        name: 'Red',
        description: 'Red component (0-1).',
        returnType: 'number',
        get: () => this._red,
        set: (_t, value) => { this._red = value as number },
      },
      {
        memberType: 'property',
        name: 'Green',
        description: 'Green component (0-1).',
        returnType: 'number',
        get: () => this._green,
        set: (_t, value) => { this._green = value as number },
      },
      {
        memberType: 'property',
        name: 'Blue',
        description: 'Blue component (0-1).',
        returnType: 'number',
        get: () => this._blue,
        set: (_t, value) => { this._blue = value as number },
      },
      {
        memberType: 'property',
        name: 'Ambient',
        description: 'Strength of the lighting (0-1).',
        returnType: 'number',
        get: () => this._ambient,
        set: (_t, value) => { this._ambient = value as number },
      },
    ]
  }

  private _flash(type: string | null, ticks: number): void {
    // Stub: in full integration, iterate world.worldActor flashEffects
    this.context.logDebug(`Lighting.Flash(type=${type}, ticks=${ticks})`)
  }
}

ScriptRegistry.registerGlobal('Lighting', LightingGlobal, 'Post-process lighting effects')
