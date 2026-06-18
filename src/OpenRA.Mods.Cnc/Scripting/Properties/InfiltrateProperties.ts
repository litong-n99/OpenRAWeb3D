/**
 * InfiltrateProperties.ts — Script-exposed infiltration ability
 * OpenRA 对照: OpenRA.Mods.Cnc/Scripting/Properties/InfiltrateProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("Ability")] attribute → static readonly category
 * - C# Requires<InfiltratesInfo> → requiredTraits: ['InfiltratesInfo']
 * - C# Self.TraitsImplementing<Infiltrates>().ToArray() → traitsImplementing('Infiltrates')
 * - C# FirstOrDefault + IsTraitDisabled + Types.Overlaps → TS filter + typesOverlap
 * - C# Self.QueueActivity(new Infiltrate(...)) → self.queueActivity(createActivity(...))
 * - C# Target.FromActor → TargetStub with actor
 *
 *
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

/**
 * Check if two string arrays share any element.
 * OpenRA 对照: HashSet.Overlaps()
 */
function typesOverlap(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const bSet = new Set(b)
  return a.some((t) => bSet.has(t))
}

export class InfiltrateProperties extends ScriptActorProperties {
  static readonly category = 'Ability' as const
  static readonly requiredTraits = ['InfiltratesInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _infiltrates: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._infiltrates = (self as any).traitsImplementing?.('Infiltrates') ?? []
  }

  /**
   * Infiltrate the target actor.
   *
   * OpenRA 对照: InfiltrateProperties.Infiltrate(Actor target)
   *
   * C# logic:
   * 1. Find first non-disabled Infiltrates trait whose Types overlap target's enabled target types
   * 2. If none found, throw LuaException
   * 3. Queue Infiltrate activity with target
   */
  /**
   * Infiltrate the target actor.
   *
   * OpenRA 对照: InfiltrateProperties.Infiltrate(Actor target)
   *
   * C# logic:
   * 1. Find first non-disabled Infiltrates trait whose Types overlap target's enabled target types
   * 2. If none found, throw LuaException
   * 3. Queue Infiltrate activity with target
   */
  Infiltrate(target: IGameActor): void {
    const infiltrates = this._infiltrates.find((x: any) => {
      if (x.isTraitDisabled) return false
      const targetTypes = (target as any).getEnabledTargetTypes?.() ?? []
      return x.info?.types && typesOverlap(x.info.types, targetTypes)
    })

    if (!infiltrates) {
      // OpenRA: throw new LuaException($"{Self} tried to infiltrate invalid target {target}!")
      // In TS scripting, we silently return (no LuaException class)
      return
    }

    // NB: Scripted actions get no visible targetlines (C#: infiltrates, null as last arg)
    (this.self as any).queueActivity?.(false, {
      __type: 'Infiltrate',
      infiltrates,
      target,
      targetLineColor: infiltrates.info?.targetLineColor ?? 'Crimson',
    })
  }

  // -------------------------------------------------------------------------
  // Convenience infiltration methods (P1-E.8)
  //
  // These are simple wrappers that find infiltrates traits matching a specific
  // type string, then queue the Infiltrate activity. They provide Lua scripts
  // with type-safe infiltration methods for common C&C spy/engineer effects.
  // Each silently no-ops if no matching infiltrates trait exists on self.
  // -------------------------------------------------------------------------

  /**
   * Infiltrate the target to steal resources (Cash).
   *
   * OpenRA 对照: Convenience wrapper for Infiltrate with type filter 'Cash'
   *
   * Finds the first non-disabled Infiltrates trait on self whose Types
   * includes 'Cash', and queues an Infiltrate activity against the target.
   */
  InfiltrateForCash(target: IGameActor): void {
    this._infiltrateByType(target, 'Cash')
  }

  /**
   * Infiltrate the target to steal shroud exploration.
   *
   * OpenRA 对照: Convenience wrapper for Infiltrate with type filter 'Exploration'
   *
   * Finds the first non-disabled Infiltrates trait on self whose Types
   * includes 'Exploration', and queues an Infiltrate activity against the target.
   */
  InfiltrateForExploration(target: IGameActor): void {
    this._infiltrateByType(target, 'Exploration')
  }

  /**
   * Infiltrate the target to trigger a power outage.
   *
   * OpenRA 对照: Convenience wrapper for Infiltrate with type filter 'PowerOutage'
   *
   * Finds the first non-disabled Infiltrates trait on self whose Types
   * includes 'PowerOutage', and queues an Infiltrate activity against the target.
   */
  InfiltrateForPowerOutage(target: IGameActor): void {
    this._infiltrateByType(target, 'PowerOutage')
  }

  /**
   * Infiltrate the target to reset support power timers.
   *
   * OpenRA 对照: Convenience wrapper for Infiltrate with type filter 'SupportPower'
   *
   * Finds the first non-disabled Infiltrates trait on self whose Types
   * includes 'SupportPower', and queues an Infiltrate activity against the target.
   */
  InfiltrateForSupportPower(target: IGameActor): void {
    this._infiltrateByType(target, 'SupportPower')
  }

  // -------------------------------------------------------------------------
  // Private helper — infiltrate by specific type
  // -------------------------------------------------------------------------

  /**
   * Queue an Infiltrate activity filtered by a specific infiltration type.
   *
   * Unlike the generic Infiltrate() which uses typesOverlap, this finds a
   * single infiltrates trait whose Types array includes the exact type string.
   */
  private _infiltrateByType(target: IGameActor, type: string): void {
    const infiltrates = this._infiltrates.find((x: any) => {
      if (x.isTraitDisabled) return false
      const targetTypes = (target as any).getEnabledTargetTypes?.() ?? []
      return x.info?.types?.includes(type) && targetTypes.includes(type)
    })

    if (!infiltrates) return

    (this.self as any).queueActivity?.(false, {
      __type: 'Infiltrate',
      infiltrates,
      target,
      targetLineColor: infiltrates.info?.targetLineColor ?? 'Crimson',
    })
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Infiltrate', returnType: 'nil',
        description: 'Infiltrate the target actor.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.Infiltrate(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'InfiltrateForCash', returnType: 'nil',
        description: 'Infiltrate the target to steal resources (Cash).',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.InfiltrateForCash(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'InfiltrateForExploration', returnType: 'nil',
        description: 'Infiltrate the target to steal shroud exploration.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.InfiltrateForExploration(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'InfiltrateForPowerOutage', returnType: 'nil',
        description: 'Infiltrate the target to trigger a power outage.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.InfiltrateForPowerOutage(args[0] as IGameActor) },
      },
      {
        memberType: 'method', name: 'InfiltrateForSupportPower', returnType: 'nil',
        description: 'Infiltrate the target to reset support power timers.',
        parameters: [{ name: 'target', type: 'Actor', optional: false }],
        invoke: (_, args) => { this.InfiltrateForSupportPower(args[0] as IGameActor) },
      },
    ]
  }
}

ScriptRegistry.registerActorProperty({
  category: 'Ability',
  ctor: InfiltrateProperties,
  requiredTraits: ['InfiltratesInfo'],
  exposedForDestroyedActors: false,
  description: 'Infiltration ability: Infiltrate',
})
