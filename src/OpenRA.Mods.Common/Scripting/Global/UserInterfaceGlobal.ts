/**
 * UserInterfaceGlobal.ts — ScriptGlobal for UI text display
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/UserInterfaceGlobal.cs
 *
 * 核心范式转换:
 * - C# Ui.Root.Get("INGAME_ROOT").Get<LabelWidget>("MISSION_TEXT") → stub
 * - C# FluentProvider.GetMessage(key, args) → stub returning key
 * - C# LuaTable args → Record<string, unknown>
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { ScriptColor } from './ColorUtils.js'
import { colorToHexString } from './ColorUtils.js'

export class UserInterfaceGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'UserInterface')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'SetMissionText',
        description: 'Displays a text message at the top center of the screen.',
        returnType: 'nil',
        parameters: [
          { name: 'text', type: 'string', optional: false },
          { name: 'color', type: 'Color', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._setMissionText(args[0] as string, args[1] as ScriptColor | null),
      },
      {
        memberType: 'method',
        name: 'GetFluentMessage',
        description: 'Formats a language string for a given string key defined in the language files (*.ftl). Args can be passed to be substituted into the resulting message.',
        returnType: 'string',
        parameters: [
          { name: 'key', type: 'string', optional: false },
          { name: 'args', type: 'table', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._getFluentMessage(args[0] as string, args[1] as Record<string, unknown> | null),
      },
    ]
  }

  private _setMissionText(text: string, color: ScriptColor | null): void {
    // Stub: in full integration, get INGAME_ROOT > MISSION_TEXT LabelWidget
    // and set its text/color
    this.context.logDebug(`SetMissionText: "${text}"`)
    if (color !== null) {
      this.context.logDebug(`  color: ${colorToHexString(color)}`)
    }
  }

  private _getFluentMessage(key: string, args: Record<string, unknown> | null): string {
    // Stub: in full integration, call FluentProvider.GetMessage(key, args)
    // Phase C: return the key itself (so scripts see the key they requested)
    if (args) {
      this.context.logDebug(`GetFluentMessage: "${key}" with args: ${JSON.stringify(args)}`)
    }
    return key
  }
}

ScriptRegistry.registerGlobal('UserInterface', UserInterfaceGlobal, 'UI text display')
