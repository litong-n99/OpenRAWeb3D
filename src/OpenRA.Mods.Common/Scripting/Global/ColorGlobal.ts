/**
 * ColorGlobal.ts — ScriptGlobal for color creation and named constants
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/ColorGlobal.cs
 *
 * 核心范式转换:
 * - C# System.Drawing.Color static properties → getMemberDescriptors() properties
 * - C# Color.FromAhsl(255, h/255f, s/255f, l/255f) → colorFromAhsl()
 * - C# Color.FromArgb(a, r, g, b) → colorFromArgb()
 * - C# Color.TryParse(value, out color) → colorTryParse()
 * - Global name is "HSLColor" (kept for backwards compatibility with OpenRA scripts)
 * - Color type is ScriptColor = number (ARGB uint32)
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import {
  colorFromAhsl,
  colorFromArgb,
  colorTryParse,
  Color_Aqua,
  Color_Black,
  Color_Blue,
  Color_Brown,
  Color_Cyan,
  Color_DarkBlue,
  Color_DarkCyan,
  Color_DarkGray,
  Color_DarkGreen,
  Color_DarkOrange,
  Color_DarkRed,
  Color_Fuchsia,
  Color_Gold,
  Color_Gray,
  Color_Green,
  Color_LawnGreen,
  Color_LightBlue,
  Color_LightCyan,
  Color_LightGray,
  Color_LightGreen,
  Color_LightYellow,
  Color_Lime,
  Color_LimeGreen,
  Color_Magenta,
  Color_Maroon,
  Color_Navy,
  Color_Olive,
  Color_Orange,
  Color_OrangeRed,
  Color_Purple,
  Color_Red,
  Color_Salmon,
  Color_SkyBlue,
  Color_Teal,
  Color_Yellow,
  Color_White,
} from './ColorUtils.js'
import type { ScriptColor } from './ColorUtils.js'

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export class ColorGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'HSLColor')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'New',
        description: 'Create a new color with the specified hue/saturation/luminosity.',
        returnType: 'Color',
        parameters: [
          { name: 'hue', type: 'number', optional: false },
          { name: 'saturation', type: 'number', optional: false },
          { name: 'luminosity', type: 'number', optional: false },
        ],
        invoke: (_t, args) => this._new(args[0] as number, args[1] as number, args[2] as number),
      },
      {
        memberType: 'method',
        name: 'FromRGB',
        description: 'Create a new color with the specified red/green/blue/[alpha] values.',
        returnType: 'Color',
        parameters: [
          { name: 'red', type: 'number', optional: false },
          { name: 'green', type: 'number', optional: false },
          { name: 'blue', type: 'number', optional: false },
          { name: 'alpha', type: 'number', optional: true, defaultValue: 255 },
        ],
        invoke: (_t, args) => this._fromRGB(args[0] as number, args[1] as number, args[2] as number, args[3] as number | undefined),
      },
      {
        memberType: 'method',
        name: 'FromHex',
        description: 'Create a new color with the specified red/green/blue/[alpha] hex string (rrggbb[aa]).',
        returnType: 'Color',
        parameters: [
          { name: 'value', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._fromHex(args[0] as string),
      },
      { memberType: 'property', name: 'Aqua', description: 'FromHex("00FFFF")', returnType: 'Color', get: () => Color_Aqua },
      { memberType: 'property', name: 'Black', description: 'FromHex("000000")', returnType: 'Color', get: () => Color_Black },
      { memberType: 'property', name: 'Blue', description: 'FromHex("0000FF")', returnType: 'Color', get: () => Color_Blue },
      { memberType: 'property', name: 'Brown', description: 'FromHex("A52A2A")', returnType: 'Color', get: () => Color_Brown },
      { memberType: 'property', name: 'Cyan', description: 'FromHex("00FFFF")', returnType: 'Color', get: () => Color_Cyan },
      { memberType: 'property', name: 'DarkBlue', description: 'FromHex("00008B")', returnType: 'Color', get: () => Color_DarkBlue },
      { memberType: 'property', name: 'DarkCyan', description: 'FromHex("008B8B")', returnType: 'Color', get: () => Color_DarkCyan },
      { memberType: 'property', name: 'DarkGray', description: 'FromHex("A9A9A9")', returnType: 'Color', get: () => Color_DarkGray },
      { memberType: 'property', name: 'DarkGreen', description: 'FromHex("006400")', returnType: 'Color', get: () => Color_DarkGreen },
      { memberType: 'property', name: 'DarkOrange', description: 'FromHex("FF8C00")', returnType: 'Color', get: () => Color_DarkOrange },
      { memberType: 'property', name: 'DarkRed', description: 'FromHex("8B0000")', returnType: 'Color', get: () => Color_DarkRed },
      { memberType: 'property', name: 'Fuchsia', description: 'FromHex("FF00FF")', returnType: 'Color', get: () => Color_Fuchsia },
      { memberType: 'property', name: 'Gold', description: 'FromHex("FFD700")', returnType: 'Color', get: () => Color_Gold },
      { memberType: 'property', name: 'Gray', description: 'FromHex("808080")', returnType: 'Color', get: () => Color_Gray },
      { memberType: 'property', name: 'Green', description: 'FromHex("008000")', returnType: 'Color', get: () => Color_Green },
      { memberType: 'property', name: 'LawnGreen', description: 'FromHex("7CFC00")', returnType: 'Color', get: () => Color_LawnGreen },
      { memberType: 'property', name: 'LightBlue', description: 'FromHex("ADD8E6")', returnType: 'Color', get: () => Color_LightBlue },
      { memberType: 'property', name: 'LightCyan', description: 'FromHex("E0FFFF")', returnType: 'Color', get: () => Color_LightCyan },
      { memberType: 'property', name: 'LightGray', description: 'FromHex("D3D3D3")', returnType: 'Color', get: () => Color_LightGray },
      { memberType: 'property', name: 'LightGreen', description: 'FromHex("90EE90")', returnType: 'Color', get: () => Color_LightGreen },
      { memberType: 'property', name: 'LightYellow', description: 'FromHex("FFFFE0")', returnType: 'Color', get: () => Color_LightYellow },
      { memberType: 'property', name: 'Lime', description: 'FromHex("00FF00")', returnType: 'Color', get: () => Color_Lime },
      { memberType: 'property', name: 'LimeGreen', description: 'FromHex("32CD32")', returnType: 'Color', get: () => Color_LimeGreen },
      { memberType: 'property', name: 'Magenta', description: 'FromHex("FF00FF")', returnType: 'Color', get: () => Color_Magenta },
      { memberType: 'property', name: 'Maroon', description: 'FromHex("800000")', returnType: 'Color', get: () => Color_Maroon },
      { memberType: 'property', name: 'Navy', description: 'FromHex("000080")', returnType: 'Color', get: () => Color_Navy },
      { memberType: 'property', name: 'Olive', description: 'FromHex("808000")', returnType: 'Color', get: () => Color_Olive },
      { memberType: 'property', name: 'Orange', description: 'FromHex("FFA500")', returnType: 'Color', get: () => Color_Orange },
      { memberType: 'property', name: 'OrangeRed', description: 'FromHex("FF4500")', returnType: 'Color', get: () => Color_OrangeRed },
      { memberType: 'property', name: 'Purple', description: 'FromHex("800080")', returnType: 'Color', get: () => Color_Purple },
      { memberType: 'property', name: 'Red', description: 'FromHex("FF0000")', returnType: 'Color', get: () => Color_Red },
      { memberType: 'property', name: 'Salmon', description: 'FromHex("FA8072")', returnType: 'Color', get: () => Color_Salmon },
      { memberType: 'property', name: 'SkyBlue', description: 'FromHex("87CEEB")', returnType: 'Color', get: () => Color_SkyBlue },
      { memberType: 'property', name: 'Teal', description: 'FromHex("008080")', returnType: 'Color', get: () => Color_Teal },
      { memberType: 'property', name: 'Yellow', description: 'FromHex("FFFF00")', returnType: 'Color', get: () => Color_Yellow },
      { memberType: 'property', name: 'White', description: 'FromHex("FFFFFF")', returnType: 'Color', get: () => Color_White },
    ]
  }

  private _new(hue: number, saturation: number, luminosity: number): ScriptColor {
    const h = clamp(hue, 0, 255)
    const s = clamp(saturation, 0, 255)
    const l = clamp(luminosity, 0, 255)
    return colorFromAhsl(255, h / 255, s / 255, l / 255)
  }

  private _fromRGB(red: number, green: number, blue: number, alpha?: number): ScriptColor {
    const a = clamp(alpha ?? 255, 0, 255)
    const r = clamp(red, 0, 255)
    const g = clamp(green, 0, 255)
    const b = clamp(blue, 0, 255)
    return colorFromArgb(a, r, g, b)
  }

  private _fromHex(value: string): ScriptColor {
    const color = colorTryParse(value)
    if (color === null) throw new Error('Invalid rrggbb[aa] hex string.')
    return color
  }
}

ScriptRegistry.registerGlobal('HSLColor', ColorGlobal, 'Color creation and constants')
