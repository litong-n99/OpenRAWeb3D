/**
 * PlayerExperienceProperties.ts — Script-exposed player experience level
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/Properties/PlayerExperienceProperties.cs
 *
 * 核心范式转换:
 * - C# PlayerExperience trait on PlayerActor → playerActor.trait('PlayerExperience')
 * - C# exp.GiveExperience(value - exp.Experience) → exp.giveExperience(delta)
 * - C# get/set Property → TypeScript get/set with loose coupling
 */
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptPlayerProperties } from '../../../OpenRA.Game/Scripting/ScriptPlayerInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'

// ===========================================================================
// PlayerExperienceProperties
// ===========================================================================

/**
 * Player experience level management.
 *
 * OpenRA 对照: PlayerExperienceProperties (PlayerExperienceProperties.cs:19-36)
 */
export class PlayerExperienceProperties extends ScriptPlayerProperties {
  static readonly requiredTraits = ['PlayerExperienceInfo'] as const

  private readonly _exp: any | null

  constructor(context: IScriptContext, player: PlayerStub) {
    super(context, player)
    const playerActor = (player as any).playerActor
    this._exp = playerActor?.trait?.('PlayerExperience') ?? null
  }

  /**
   * Get or set the current experience.
   *
   * OpenRA 对照: PlayerExperienceProperties.Experience (PlayerExperienceProperties.cs:30-35)
   */
  get Experience(): number {
    return this._exp?.experience ?? this._exp?.Experience ?? 0
  }

  set Experience(value: number) {
    if (!this._exp) return
    const current = this.Experience
    const delta = value - current
    if (this._exp.giveExperience) {
      this._exp.giveExperience(delta)
    } else if (this._exp.GiveExperience) {
      this._exp.GiveExperience(delta)
    }
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'Experience', returnType: 'number',
        description: 'Get or set the current experience.',
        get: () => this.Experience,
        set: (_, v) => { this.Experience = v as number },
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerPlayerProperty({
  category: 'Player',
  ctor: PlayerExperienceProperties,
  requiredTraits: ['PlayerExperienceInfo'],
  description: 'Player experience: Experience (get/set)',
})
