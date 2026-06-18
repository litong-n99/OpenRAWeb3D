/**
 * CameraGlobal.ts — ScriptGlobal for viewport camera control
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/CameraGlobal.cs
 *
 * 核心范式转换:
 * - C# Context.WorldRenderer.Viewport.CenterPosition → viewport.centerPosition
 * - C# Context.WorldRenderer.Viewport.Center(value) → viewport.center(value)
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { WPos } from '../../../OpenRA.Game/WPos.js'
import type { PhaseCViewportStub } from './GlobalTypes.js'

export class CameraGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Camera')
    this.bind([this])
  }

  private get _viewport(): PhaseCViewportStub {
    return (this.context.worldRenderer as unknown as { viewport: PhaseCViewportStub }).viewport
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'property',
        name: 'Position',
        description: 'The center of the visible viewport.',
        returnType: 'WPos',
        get: () => this._viewport.centerPosition,
        set: (_t, value) => this._viewport.center(value as WPos),
      },
    ]
  }
}

ScriptRegistry.registerGlobal('Camera', CameraGlobal, 'Viewport camera control')
