/**
 * DeathSounds.ts -- Death notification voice playback
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Sound/DeathSounds.cs (48 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<DeathSoundsInfo>, INotifyKilled → TS equivalent
 * - C# self.PlayVoiceLocal() → TS duck-typed playVoiceLocal on actor
 * - C# BitSet<DamageType> → TS BitSetStub<unknown>
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type AttackInfo,
  type BitSetStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// DeathSoundsInfo
// OpenRA 对照: DeathSoundsInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for DeathSounds trait.
 *
 *  OpenRA 对照: DeathSoundsInfo
 */
export class DeathSoundsInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Death notification voice phrase.
   *
   *  OpenRA 对照: DeathSoundsInfo.Voice (default "Die")
   */
  readonly voice: string = 'Die'

  /** Volume multiplier for the voice.
   *
   *  OpenRA 对照: DeathSoundsInfo.VolumeMultiplier (default 1.0)
   */
  readonly volumeMultiplier: number = 1.0

  /** Damage types that trigger this sound.
   *  If empty, plays for all death types.
   *
   *  OpenRA 对照: DeathSoundsInfo.DeathTypes
   */
  readonly deathTypes: BitSetStub<unknown> = {
    contains: () => false,
    isEmpty: () => true,
  }

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    voice?: string
    volumeMultiplier?: number
    deathTypes?: BitSetStub<unknown>
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.voice = params.voice ?? 'Die'
    this.volumeMultiplier = params.volumeMultiplier ?? 1.0
    this.deathTypes = params.deathTypes ?? { contains: () => false, isEmpty: () => true }
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// DeathSounds
// OpenRA 对照: DeathSounds (ConditionalTrait<DeathSoundsInfo>, INotifyKilled)
// ---------------------------------------------------------------------------

/** Plays a voice notification when the actor is killed.
 *
 *  OpenRA 对照: DeathSounds
 */
export class DeathSounds extends ConditionalTrait<DeathSoundsInfo> {
  constructor(info: DeathSoundsInfo) {
    super(info)
  }

  /** Handle killed event: play death voice if death types match.
   *
   *  OpenRA 对照: INotifyKilled.Killed(Actor self, AttackInfo e)
   *
   *  @param self — the killed actor
   *  @param e — attack information
   */
  killed(self: IGameActor, e: AttackInfo): void {
    if (this.isTraitDisabled) return

    const deathTypesRecord = this.info.deathTypes as unknown as Record<string, unknown>
    const dtEmpty = deathTypesRecord.isEmpty as (() => boolean) | undefined
    const dtContains = deathTypesRecord.contains as ((v: number) => boolean) | undefined

    const damageRecord = e.damage.damageTypes as unknown as Record<string, unknown>
    const dmgValue = damageRecord.value as number | undefined
    const dmgContains = damageRecord.contains as ((v: number) => boolean) | undefined

    if (
      (dtEmpty?.() ?? true) ||
      (dtContains && dmgContains && dmgValue !== undefined && dtContains(dmgValue))
    ) {
      // Duck-typed playVoiceLocal on the actor
      const selfAny = self as unknown as Record<string, (phrase: string, volume: number) => void>
      if (selfAny.playVoiceLocal) {
        selfAny.playVoiceLocal(this.info.voice, this.info.volumeMultiplier)
      }
    }
  }

  // NOTE: OpenRA C# uses `self.PlayVoiceLocal(info.Voice, info.VolumeMultiplier)`.
  //   This requires Voiced trait on the actor. In TS, we duck-type the call.
  //   If the actor doesn't have Voiced, the call is silently ignored.
}
