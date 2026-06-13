/**
 * AttackSounds.ts -- Attack audio feedback
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Sound/AttackSounds.cs (80 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<AttackSoundsInfo>, INotifyAttack, ITick → TS equivalent
 * - C# Game.Sound.Play(SoundType.World, ...) → TODO-8.E.SOUND-DEFER
 * - C# ImmutableArray<string> → readonly string[]
 * - AttackDelayType → const enum from CombatInterfaces.ts
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  AttackDelayType,
  type AttackDelayType as AttackDelayTypeEnum,
  type INotifyAttack,
  type Barrel,
} from '../CombatInterfaces.js'
import type { Target } from '../../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// AttackSoundsInfo
// OpenRA 对照: AttackSoundsInfo (ConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for AttackSounds trait.
 *
 *  OpenRA 对照: AttackSoundsInfo
 */
export class AttackSoundsInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Sound names to randomly select from when attacking.
   *
   *  OpenRA 对照: AttackSoundsInfo.Sounds
   */
  readonly sounds: readonly string[] = []

  /** Delay in ticks before sound starts.
   *
   *  OpenRA 对照: AttackSoundsInfo.Delay (default 0)
   */
  readonly delay: number = 0

  /** Should the sound be delayed relative to preparation or actual attack?
   *
   *  OpenRA 对照: AttackSoundsInfo.DelayRelativeTo (default AttackDelayType.Preparation)
   */
  readonly delayRelativeTo: AttackDelayTypeEnum = AttackDelayType.Preparation

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    sounds?: string[]
    delay?: number
    delayRelativeTo?: AttackDelayTypeEnum
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.sounds = params.sounds ?? []
    this.delay = params.delay ?? 0
    this.delayRelativeTo = params.delayRelativeTo ?? AttackDelayType.Preparation
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// AttackSounds
// OpenRA 对照: AttackSounds (ConditionalTrait<AttackSoundsInfo>, INotifyAttack, ITick)
// ---------------------------------------------------------------------------

/** Plays a randomly selected sound when the actor attacks.
 *
 *  OpenRA 对照: AttackSounds
 */
export class AttackSounds
  extends ConditionalTrait<AttackSoundsInfo>
  implements INotifyAttack, ITick
{
  /** Delay countdown timer.
   *
   *  OpenRA 对照: AttackSounds.tick
   */
  private tickCount: number = 0

  constructor(info: AttackSoundsInfo) {
    super(info)
  }

  // -----------------------------------------------------------------------
  // INotifyAttack
  // -----------------------------------------------------------------------

  /** Called before attack preparation.
   *
   *  OpenRA 对照: INotifyAttack.PreparingAttack()
   */
  preparingAttack(
    self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    if (this.info.delayRelativeTo === AttackDelayType.Preparation) {
      if (this.info.delay > 0) {
        this.tickCount = this.info.delay
      } else {
        this.playSound(self)
      }
    }
  }

  /** Called when the actual attack fires.
   *
   *  OpenRA 对照: INotifyAttack.Attacking()
   */
  attacking(
    self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    if (this.info.delayRelativeTo === AttackDelayType.Attack) {
      if (this.info.delay > 0) {
        this.tickCount = this.info.delay
      } else {
        this.playSound(self)
      }
    }
  }

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  /** Tick: countdown delay, play sound on expiry.
   *
   *  OpenRA 对照: ITick.Tick(Actor self)
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled) return

    if (this.info.delay > 0 && --this.tickCount === 0) {
      this.playSound(self)
    }
  }

  // -----------------------------------------------------------------------
  // Sound playback
  // -----------------------------------------------------------------------

  /** Play a random sound from the Sounds list at the actor's position.
   *
   *  OpenRA 对照: AttackSounds.PlaySound(Actor self)
   *
   *  TODO-8.E.SOUND-DEFER: Sound module integration deferred.
   *    Currently stubs the call. Full implementation requires Chapter 7
   *    Sound.Play(SoundType.World, sounds, world, centerPosition).
   */
  private playSound(self: IGameActor): void {
    if (this.info.sounds.length === 0) return

    // Pick a random sound
    const idx = Math.floor(Math.random() * this.info.sounds.length)
    const sound = this.info.sounds[idx]

    // TODO-8.E.SOUND-DEFER: Game.Sound.Play(SoundType.World, sound, world, centerPosition)
    // For now, duck-type access to world.sound
    const world = self.world as unknown as Record<string, unknown> | undefined
    const worldSound = world?.sound as unknown as Record<string, unknown> | undefined
    if (worldSound && typeof worldSound.play === 'function') {
      const centerPos = (self as unknown as Record<string, unknown>).centerPosition
      worldSound.play('World', sound, self.world, centerPos)
    }
  }
}
