/**
 * PlayerConditionProperties.ts — Script-exposed external conditions on the player actor
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Properties/PlayerConditionProperties.cs
 *
 * 核心范式转换:
 * - C# TraitsImplementing<ExternalCondition>() on PlayerActor → playerActor.traitsImplementing('ExternalCondition')
 * - C# external.CanGrantCondition(this) → t.canGrantCondition(this)
 * - C# external.GrantCondition(Player.PlayerActor, this, duration) → t.grantCondition(playerActor, this, duration)
 */
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

// ===========================================================================
// PlayerConditionProperties
// ===========================================================================

/**
 * External condition management for the player actor.
 *
 * OpenRA 对照: PlayerConditionProperties (PlayerConditionProperties.cs:20-57)
 */
export class PlayerConditionProperties extends ScriptPlayerProperties {
  static readonly requiredTraits = ['ExternalConditionInfo'] as const

  private readonly _externalConditions: any[]
  private readonly _playerActor: any | null

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)
    this._playerActor = (player as any).playerActor ?? null
    this._externalConditions =
      this._playerActor?.traitsImplementing?.('ExternalCondition') ?? []
  }

  /**
   * Grant an external condition on the player actor and return the revocation token.
   * @param condition — the condition name to grant
   * @param duration — if > 0, condition will be auto-revoked after the specified ticks
   * @returns revocation token (pass to RevokeCondition)
   * @throws if the condition is not listed on an enabled ExternalCondition trait
   */
  GrantCondition(condition: string, duration: number = 0): number {
    const external = this._externalConditions.find(
      (t: any) => t.info?.condition === condition && t.canGrantCondition?.(this),
    )
    if (!external) {
      throw new Error(
        `Condition \`${condition}\` has not been listed on an enabled ExternalCondition trait`,
      )
    }
    return external.grantCondition?.(this._playerActor, this, duration) ?? 0
  }

  /**
   * Revoke a condition using the token returned by GrantCondition.
   * @param token — the revocation token from GrantCondition
   */
  RevokeCondition(token: number): void {
    for (const external of this._externalConditions) {
      if (external.tryRevokeCondition?.(this._playerActor, this, token)) break
    }
  }

  /**
   * Check whether this player actor accepts a specific external condition.
   * @param condition — the condition name to check
   */
  AcceptsCondition(condition: string): boolean {
    return this._externalConditions.some(
      (t: any) => t.info?.condition === condition && t.canGrantCondition?.(this),
    )
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'GrantCondition', returnType: 'number',
        description: 'Grant an external condition on the player actor and return the revocation token. If duration > 0 the condition will be automatically revoked after the defined number of ticks.',
        parameters: [
          { name: 'condition', type: 'string', optional: false },
          { name: 'duration', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_, args) => this.GrantCondition(args[0] as string, args[1] as number),
      },
      {
        memberType: 'method', name: 'RevokeCondition', returnType: 'nil',
        description: 'Revoke a condition using the token returned by GrantCondition.',
        parameters: [{ name: 'token', type: 'number', optional: false }],
        invoke: (_, args) => { this.RevokeCondition(args[0] as number) },
      },
      {
        memberType: 'method', name: 'AcceptsCondition', returnType: 'boolean',
        description: 'Check whether this player actor accepts a specific external condition.',
        parameters: [{ name: 'condition', type: 'string', optional: false }],
        invoke: (_, args) => this.AcceptsCondition(args[0] as string),
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerPlayerProperty({
  category: 'Player',
  ctor: PlayerConditionProperties,
  requiredTraits: ['ExternalConditionInfo'],
  description: 'Player external conditions: GrantCondition, RevokeCondition, AcceptsCondition',
})
