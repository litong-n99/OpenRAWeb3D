/**
 * PowerProperties.ts — Script-exposed power management
 * OpenRA 对照: PowerProperties.cs
 * Contains: PlayerPowerProperties (ScriptPlayerProperties) + ActorPowerProperties (ScriptActorProperties)
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

// ===========================================================================
// PlayerPowerProperties — PLAYER-scoped
// ===========================================================================

export class PlayerPowerProperties extends ScriptPlayerProperties {
  static readonly requiredTraits = ['PowerManagerInfo'] as const

  private readonly _pm: any | null

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)
    const playerActor = (player as any).playerActor
    this._pm = (playerActor as any)?.trait?.('PowerManager') ?? null
  }

  get PowerProvided(): number { return this._pm?.powerProvided ?? this._pm?.PowerProvided ?? 0 }
  get PowerDrained(): number { return this._pm?.powerDrained ?? this._pm?.PowerDrained ?? 0 }
  get PowerState(): string { return this._pm?.powerState?.toString() ?? this._pm?.PowerState ?? 'Normal' }

  get PlayLowPowerNotification(): boolean {
    return this._pm?.playLowPowerNotification ?? this._pm?.PlayLowPowerNotification ?? false
  }
  set PlayLowPowerNotification(value: boolean) {
    if (!this._pm) return
    if ('playLowPowerNotification' in this._pm) {
      this._pm.playLowPowerNotification = value
    } else {
      this._pm.PlayLowPowerNotification = value
    }
  }

  TriggerPowerOutage(ticks: number): void {
    this._pm?.triggerPowerOutage?.(ticks)
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'PowerProvided', returnType: 'number',
        description: 'Returns the total of the power the player has.',
        get: () => this.PowerProvided,
      },
      {
        memberType: 'property', name: 'PowerDrained', returnType: 'number',
        description: 'Returns the power used by the player.',
        get: () => this.PowerDrained,
      },
      {
        memberType: 'property', name: 'PowerState', returnType: 'string',
        description: 'Returns the player\'s power state ("Normal", "Low" or "Critical").',
        get: () => this.PowerState,
      },
      {
        memberType: 'method', name: 'TriggerPowerOutage', returnType: 'nil',
        description: 'Triggers an outage for the chosen amount of ticks.',
        parameters: [{ name: 'ticks', type: 'number', optional: false }],
        invoke: (_, args) => { this.TriggerPowerOutage(args[0] as number) },
      },
      {
        memberType: 'property', name: 'PlayLowPowerNotification', returnType: 'boolean',
        description: 'Whether the player should receive a notification when low on power.',
        get: () => this.PlayLowPowerNotification,
        set: (_, v) => { this.PlayLowPowerNotification = v as boolean },
      },
    ]
  }
}

// ===========================================================================
// ActorPowerProperties — ACTOR-scoped
// ===========================================================================

export class ActorPowerProperties extends ScriptActorProperties {
  static readonly category = 'Power' as const
  static readonly requiredTraits = ['PowerInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _power: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._power = (self as any).traitsImplementing?.('Power') ?? []
  }

  get Power(): number {
    let total = 0
    for (const p of this._power) {
      total += p.getEnabledPower?.() ?? 0
    }
    return total
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'Power', returnType: 'number',
        description: 'Returns the power drained/provided by this actor.',
        get: () => this.Power,
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerPlayerProperty({
  category: 'Power',
  ctor: PlayerPowerProperties,
  requiredTraits: ['PowerManagerInfo'],
  description: 'Player power: PowerProvided, PowerDrained, PowerState, TriggerPowerOutage, PlayLowPowerNotification',
})

ScriptRegistry.registerActorProperty({
  category: 'Power',
  ctor: ActorPowerProperties,
  requiredTraits: ['PowerInfo'],
  exposedForDestroyedActors: false,
  description: 'Actor power: Power (sum of GetEnabledPower)',
})
