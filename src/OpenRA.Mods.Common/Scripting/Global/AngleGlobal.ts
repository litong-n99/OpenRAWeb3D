/**
 * AngleGlobal.ts — ScriptGlobal for WAngle constants and creation
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/AngleGlobal.cs
 *
 * 核心范式转换:
 * - C# [ScriptGlobal("Angle")] attribute → ScriptRegistry.registerGlobal('Angle', ...)
 * - C# WAngle constants (static readonly fields) → getMemberDescriptors() properties
 * - C# WAngle.New(int a) constructor → New(a: number) method
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'

export class AngleGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Angle')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'property',
        name: 'North',
        description: '0/1024 units = 0/360 degrees',
        returnType: 'WAngle',
        get: () => WAngle.Zero,
      },
      {
        memberType: 'property',
        name: 'NorthWest',
        description: '128 units = 315 degrees',
        returnType: 'WAngle',
        get: () => new WAngle(128),
      },
      {
        memberType: 'property',
        name: 'West',
        description: '256 units = 270 degrees',
        returnType: 'WAngle',
        get: () => new WAngle(256),
      },
      {
        memberType: 'property',
        name: 'SouthWest',
        description: '384 units = 225 degrees',
        returnType: 'WAngle',
        get: () => new WAngle(384),
      },
      {
        memberType: 'property',
        name: 'South',
        description: '512 units = 180 degrees',
        returnType: 'WAngle',
        get: () => new WAngle(512),
      },
      {
        memberType: 'property',
        name: 'SouthEast',
        description: '640 units = 135 degrees',
        returnType: 'WAngle',
        get: () => new WAngle(640),
      },
      {
        memberType: 'property',
        name: 'East',
        description: '768 units = 90 degrees',
        returnType: 'WAngle',
        get: () => new WAngle(768),
      },
      {
        memberType: 'property',
        name: 'NorthEast',
        description: '896 units = 45 degrees',
        returnType: 'WAngle',
        get: () => new WAngle(896),
      },
      {
        memberType: 'method',
        name: 'New',
        description: 'Create an arbitrary angle. 1024 units = 360 degrees. North is 0. Units increase *counter* clockwise.',
        returnType: 'WAngle',
        parameters: [
          { name: 'a', type: 'number', optional: false },
        ],
        invoke: (_t, args) => this._new(args[0] as number),
      },
    ]
  }

  private _new(a: number): WAngle {
    return new WAngle(a)
  }
}

ScriptRegistry.registerGlobal('Angle', AngleGlobal, 'Angle constants and creation')
