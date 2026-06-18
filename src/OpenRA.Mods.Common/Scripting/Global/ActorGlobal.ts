/**
 * ActorGlobal.ts — ScriptGlobal for actor creation and query
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Global/ActorGlobal.cs
 *
 * 核心范式转换:
 * - C# reflection-based ActorInit discovery → ScriptRegistry.getActorInit()
 * - C# TypeDictionary initDict → ReadonlyMap<string, unknown> initTable
 * - C# ActorInit construction via RuntimeHelpers.GetUninitializedObject + reflection
 *   → ScriptRegistry.ActorInitRegistration.factory(values)
 * - C# world.CreateActor(false, type, initDict) → world.createActor()
 */

import { ScriptGlobal } from '../../../OpenRA.Game/Scripting/ScriptObjectWrapper.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext, MemberDescriptor, ActorInitValue } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { PhaseCWorldStub, PhaseCActorInfoStub } from './GlobalTypes.js'

export class ActorGlobal extends ScriptGlobal {
  constructor(context: IScriptContext) {
    super(context, 'Actor')
    this.bind([this])

    // Register core ActorInit factories at construction time
    // In full OpenRA these are discovered via reflection; in TS they're explicit
    this._ensureCoreInitsRegistered()
  }

  private get _world(): PhaseCWorldStub {
    return this.context.world as unknown as PhaseCWorldStub
  }

  /**
   * Ensure core ActorInit factories are registered.
   * Called once per ActorGlobal construction (idempotent via registry).
   */
  private _ensureCoreInitsRegistered(): void {
    const required = ['Owner', 'Location', 'Facing', 'CenterPosition']
    for (const name of required) {
      if (!ScriptRegistry.getActorInit(name)) {
        ScriptRegistry.registerActorInit({
          name,
          parameters: new Map([['value', name === 'Owner' ? 'Player' as const : name === 'Facing' ? 'WAngle' as const : 'CPos' as const]]),
          factory: (values) => ({
            initName: name,
            value: values.get('value'),
          }),
        })
      }
    }
  }

  protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
    return [
      {
        memberType: 'method',
        name: 'Create',
        description: 'Create a new actor. initTable specifies a list of key-value pairs that defines the initial parameters for the actor\'s traits.',
        returnType: 'Actor',
        parameters: [
          { name: 'type', type: 'string', optional: false },
          { name: 'addToWorld', type: 'boolean', optional: false },
          { name: 'initTable', type: 'table', optional: false },
        ],
        invoke: (_t, args) => this._create(args[0] as string, args[1] as boolean, args[2] as ReadonlyMap<string, unknown>),
      },
      {
        memberType: 'method',
        name: 'BuildTime',
        description: 'Returns the build time (in ticks) of the requested unit type. An optional second value can be used to exactly specify the producing queue type.',
        returnType: 'number',
        parameters: [
          { name: 'type', type: 'string', optional: false },
          { name: 'queue', type: 'string', optional: true, defaultValue: null },
        ],
        invoke: (_t, args) => this._buildTime(args[0] as string, args[1] as string | undefined),
      },
      {
        memberType: 'method',
        name: 'CruiseAltitude',
        description: 'Returns the cruise altitude of the requested unit type (zero if it is ground-based).',
        returnType: 'number',
        parameters: [
          { name: 'type', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._cruiseAltitude(args[0] as string),
      },
      {
        memberType: 'method',
        name: 'Cost',
        description: 'Returns the cost of the requested unit given by the Valued trait.',
        returnType: 'number',
        parameters: [
          { name: 'type', type: 'string', optional: false },
        ],
        invoke: (_t, args) => this._cost(args[0] as string),
      },
    ]
  }

  // --- Private implementations ---

  private _create(type: string, addToWorld: boolean, initTable: ReadonlyMap<string, unknown>): IGameActor {
    const inits: ActorInitValue[] = []

    for (const [key, value] of initTable) {
      const initName = key.split('.')[0]
      const initReg = ScriptRegistry.getActorInit(initName)
      if (!initReg) {
        throw new Error(`Unknown initializer type '${initName}'`)
      }
      // Factory expects a Map of parameter values
      const valuesMap = new Map<string, unknown>([['value', value]])
      inits.push(initReg.factory(valuesMap))
    }

    const ownerInit = inits.find(i => i.initName === 'Owner')
    if (!ownerInit) {
      throw new Error(`Tried to create actor '${type}' with an invalid or no owner init!`)
    }

    const actor = this._world.createActor(false, type, inits)
    if (addToWorld) {
      this._world.addFrameEndTask(() => {
        this._world.addActor?.(actor)
      })
    }
    return actor
  }

  private _buildTime(type: string, _queue?: string): number {
    const ai = this._getActorInfo(type)
    if (!ai) throw new Error(`Unknown actor type '${type}'`)

    const bi = ai.getTraitInfo<{ buildDuration: number; buildDurationModifier: number; queue: string[] }>('BuildableInfo')
    if (!bi) return 0

    let time = bi.buildDuration
    if (time === -1) {
      const valued = ai.getTraitInfo<{ cost: number }>('ValuedInfo')
      if (!valued) return 0
      time = valued.cost
    }

    // Find production queue and apply modifiers
    // Stub: use default modifiers
    const pbi = 100 // default BuildDurationModifier
    const buildDurationModifier = bi.buildDurationModifier || 100

    time = Math.floor(time * buildDurationModifier * pbi / 10000)
    return time
  }

  private _cruiseAltitude(type: string): number {
    const ai = this._getActorInfo(type)
    if (!ai) throw new Error(`Unknown actor type '${type}'`)

    const pi = ai.getTraitInfo<{ getCruiseAltitude?: () => { length: number } }>('AircraftInfo')
    return pi?.getCruiseAltitude?.().length ?? 0
  }

  private _cost(type: string): number {
    const ai = this._getActorInfo(type)
    if (!ai) throw new Error(`Unknown actor type '${type}'`)

    const vi = ai.getTraitInfo<{ cost: number }>('ValuedInfo')
    if (!vi) throw new Error(`Actor type '${type}' does not have the Valued trait required to get the Cost.`)

    return vi.cost
  }

  private _getActorInfo(type: string): PhaseCActorInfoStub | undefined {
    return this._world.map.rules.actors.get(type)
  }
}

ScriptRegistry.registerGlobal('Actor', ActorGlobal, 'Actor creation and query')
