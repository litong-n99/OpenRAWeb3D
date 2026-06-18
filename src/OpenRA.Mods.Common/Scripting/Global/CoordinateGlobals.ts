/**
 * CoordinateGlobals.ts — ScriptGlobals for coordinate type creation
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/CoordinateGlobals.cs
 *
 * Contains 5 Global classes in one file (matching OpenRA structure):
 * - CPosGlobal (name: "CPos")  — cell position creation
 * - CVecGlobal (name: "CVec")  — cell vector creation
 * - WPosGlobal (name: "WPos")  — world position creation
 * - WVecGlobal (name: "WVec")  — world vector creation
 * - WDistGlobal (name: "WDist") — world distance creation
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'

// ---------------------------------------------------------------------------
// CPosGlobal (name: "CPos")
// ---------------------------------------------------------------------------

export class CPosGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'CPos')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'New',
        description: 'Create a new CPos with the specified coordinates on the ground (layer = 0).',
        returnType: 'CPos',
        parameters: [
          { name: 'x', type: 'number', optional: false },
          { name: 'y', type: 'number', optional: false },
        ],
        invoke: (_t, args) => new CPos(args[0] as number, args[1] as number),
      },
      {
        memberType: 'method',
        name: 'NewWithLayer',
        description: 'Create a new CPos with the specified coordinates on the specified layer. The ground is layer 0.',
        returnType: 'CPos',
        parameters: [
          { name: 'x', type: 'number', optional: false },
          { name: 'y', type: 'number', optional: false },
          { name: 'layer', type: 'number', optional: false },
        ],
        invoke: (_t, args) => new CPos(args[0] as number, args[1] as number, args[2] as number),
      },
      {
        memberType: 'property',
        name: 'Zero',
        description: 'The cell coordinate origin.',
        returnType: 'CPos',
        get: () => CPos.Zero,
      },
    ]
  }
}

// ---------------------------------------------------------------------------
// CVecGlobal (name: "CVec")
// ---------------------------------------------------------------------------

export class CVecGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'CVec')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'New',
        description: 'Create a new CVec with the specified coordinates.',
        returnType: 'CVec',
        parameters: [
          { name: 'x', type: 'number', optional: false },
          { name: 'y', type: 'number', optional: false },
        ],
        invoke: (_t, args) => new CVec(args[0] as number, args[1] as number),
      },
      {
        memberType: 'property',
        name: 'Zero',
        description: 'The cell zero-vector.',
        returnType: 'CVec',
        get: () => CVec.Zero,
      },
    ]
  }
}

// ---------------------------------------------------------------------------
// WPosGlobal (name: "WPos")
// ---------------------------------------------------------------------------

export class WPosGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'WPos')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'New',
        description: 'Create a new WPos with the specified coordinates.',
        returnType: 'WPos',
        parameters: [
          { name: 'x', type: 'number', optional: false },
          { name: 'y', type: 'number', optional: false },
          { name: 'z', type: 'number', optional: false },
        ],
        invoke: (_t, args) => new WPos(args[0] as number, args[1] as number, args[2] as number),
      },
      {
        memberType: 'property',
        name: 'Zero',
        description: 'The world coordinate origin.',
        returnType: 'WPos',
        get: () => WPos.Zero,
      },
    ]
  }
}

// ---------------------------------------------------------------------------
// WVecGlobal (name: "WVec")
// ---------------------------------------------------------------------------

export class WVecGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'WVec')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'New',
        description: 'Create a new WVec with the specified coordinates.',
        returnType: 'WVec',
        parameters: [
          { name: 'x', type: 'number', optional: false },
          { name: 'y', type: 'number', optional: false },
          { name: 'z', type: 'number', optional: false },
        ],
        invoke: (_t, args) => new WVec(args[0] as number, args[1] as number, args[2] as number),
      },
      {
        memberType: 'property',
        name: 'Zero',
        description: 'The world zero-vector.',
        returnType: 'WVec',
        get: () => WVec.Zero,
      },
    ]
  }
}

// ---------------------------------------------------------------------------
// WDistGlobal (name: "WDist")
// ---------------------------------------------------------------------------

export class WDistGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'WDist')
    this.bind([this])
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'New',
        description: 'Create a new WDist.',
        returnType: 'WDist',
        parameters: [
          { name: 'r', type: 'number', optional: false },
        ],
        invoke: (_t, args) => new WDist(args[0] as number),
      },
      {
        memberType: 'method',
        name: 'FromCells',
        description: 'Create a new WDist by cell distance.',
        returnType: 'WDist',
        parameters: [
          { name: 'numCells', type: 'number', optional: false },
        ],
        invoke: (_t, args) => WDist.fromCells(args[0] as number),
      },
    ]
  }
}

// ---------------------------------------------------------------------------
// Module-level registrations
// ---------------------------------------------------------------------------

ScriptRegistry.registerGlobal('CPos', CPosGlobal, 'Cell position creation')
ScriptRegistry.registerGlobal('CVec', CVecGlobal, 'Cell vector creation')
ScriptRegistry.registerGlobal('WPos', WPosGlobal, 'World position creation')
ScriptRegistry.registerGlobal('WVec', WVecGlobal, 'World vector creation')
ScriptRegistry.registerGlobal('WDist', WDistGlobal, 'World distance creation')
