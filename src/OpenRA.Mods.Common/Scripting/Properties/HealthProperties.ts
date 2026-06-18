/**
 * HealthProperties.ts — Script-exposed health properties for actors
 * OpenRA 对照: HealthProperties.cs
 *
 * 核心范式转换:
 * - C# IHealth trait → cached IHealth interface on actor
 * - C# Damage(damageTypes) from LuaTable → DamageTypesArg union type
 * - C# health.InflictDamage(Self, Self, damage, true) → this._health.inflictDamage(...)
 * - C# [ScriptPropertyGroup("General")] → category = 'General'
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

// ---------------------------------------------------------------------------
// DamageTypesArg — union of possible damage type specifications
// ---------------------------------------------------------------------------

type DamageTypesArg = string | string[] | undefined

// ===========================================================================
// HealthProperties
// ===========================================================================

/**
 * Health properties for actors.
 *
 * OpenRA 对照: HealthProperties (HealthProperties.cs:20-52)
 */
export class HealthProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits = ['IHealthInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _health: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._health = (self as any).trait?.('IHealth') ?? null
  }

  // ---- Properties ----

  /** Current health of the actor. */
  get Health(): number {
    if (!this._health) return 0
    return this._health.hp ?? this._health.HP ?? 0
  }

  set Health(value: number) {
    if (!this._health) return
    const current = this.Health
    const damage = current - value
    this._health.inflictDamage?.(this.self, this.self, { value: damage }, true)
  }

  /** Maximum health of the actor. */
  get MaxHealth(): number {
    if (!this._health) return 0
    return this._health.maxHp ?? this._health.MaxHP ?? 0
  }

  // ---- Methods ----

  /**
   * Kill the actor.
   * @param damageTypes — optional damage type(s) as string, string[], or omitted
   */
  Kill(damageTypes?: DamageTypesArg): void {
    if (!this._health) return
    const maxHp = this.MaxHealth

    let damage: any
    if (typeof damageTypes === 'string') {
      damage = { value: maxHp, damageTypes: [damageTypes] }
    } else if (Array.isArray(damageTypes)) {
      damage = { value: maxHp, damageTypes }
    } else {
      damage = { value: maxHp }
    }

    this._health.inflictDamage?.(this.self, this.self, damage, true)
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'Health', returnType: 'number',
        description: 'Current health of the actor.',
        get: () => this.Health,
        set: (_, v) => { this.Health = v as number },
      },
      {
        memberType: 'property', name: 'MaxHealth', returnType: 'number',
        description: 'Maximum health of the actor.',
        get: () => this.MaxHealth,
      },
      {
        memberType: 'method', name: 'Kill', returnType: 'nil',
        description: 'Kill the actor. damageTypes may be omitted, specified as a string, or as an array of strings.',
        parameters: [
          { name: 'damageTypes', type: 'string', optional: true, defaultValue: undefined },
        ],
        invoke: (_, args) => { this.Kill(args[0] as DamageTypesArg) },
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: HealthProperties,
  requiredTraits: ['IHealthInfo'],
  exposedForDestroyedActors: false,
  description: 'Actor health, max health, and kill',
})
