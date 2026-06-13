/**
 * FireWarheads.ts -- Periodic warhead detonation at actor position
 * OpenRA 对照: OpenRA.Mods.Common/Traits/FireWarheads.cs (86 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<FireWarheadsInfo>, ITick, ISync → TS ConditionalTrait + ITick + ISync
 * - C# WeaponInfo.Impact() → TS duck-typed weapon.impact()
 * - C# Game.Sound.Play() → TODO-8.E.SOUND-DEFER
 * - C# ImmutableArray<string> → TS readonly string[]
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ITick,
  type ISync,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// FireWarheadsInfo
// OpenRA 对照: FireWarheadsInfo (PausableConditionalTraitInfo, Requires<IOccupySpaceInfo>, IRulesetLoaded)
// ---------------------------------------------------------------------------

/** Configuration for FireWarheads trait.
 *
 *  OpenRA 对照: FireWarheadsInfo
 */
export class FireWarheadsInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Weapon names to fire at each interval.
   *
   *  OpenRA 对照: FireWarheadsInfo.Weapons
   */
  readonly weapons: readonly string[] = []

  /** How long (in ticks) to wait before the first detonation.
   *
   *  OpenRA 对照: FireWarheadsInfo.StartCooldown (default 0)
   */
  readonly startCooldown: number = 0

  /** How long (in ticks) to wait after a detonation.
   *
   *  OpenRA 对照: FireWarheadsInfo.Interval (default 1)
   */
  readonly interval: number = 1

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    weapons?: string[]
    startCooldown?: number
    interval?: number
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.weapons = params.weapons ?? []
    this.startCooldown = params.startCooldown ?? 0
    this.interval = params.interval ?? 1
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// FireWarheads
// OpenRA 对照: FireWarheads (PausableConditionalTrait<FireWarheadsInfo>, ITick, ISync)
// ---------------------------------------------------------------------------

/** Detonate defined warheads at the current location at a set interval.
 *
 *  OpenRA 对照: FireWarheads
 */
export class FireWarheads
  extends ConditionalTrait<FireWarheadsInfo>
  implements ITick, ISync
{
  /** Countdown timer until next detonation.
   *
   *  OpenRA 对照: FireWarheads.cooldown [VerifySync]
   */
  cooldown: number = 0

  /** Pre-resolved weapon info objects.
   *
   *  OpenRA 对照: FireWarheadsInfo.WeaponInfos
   */
  weaponInfos: unknown[] = []

  constructor(info: FireWarheadsInfo) {
    super(info)
    this.cooldown = info.startCooldown
  }

  /** Tick: decrement cooldown, fire all weapons when it reaches 0.
   *
   *  OpenRA 对照: ITick.Tick(Actor self)
   *
   *  @param self — the actor
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled) return
    // NOTE: C# uses PausableConditionalTrait.IsTraitPaused. In TS,
    //   _paused is inherited from ConditionalTrait for partial compatibility.
    if (this.isTraitPaused) return

    if (this.cooldown > 0) {
      this.cooldown--
    } else {
      this.cooldown = this.info.interval

      const centerPos = (self as unknown as { centerPosition?: unknown }).centerPosition
      if (!centerPos) return

      for (const wep of this.weaponInfos) {
        const weapon = wep as {
          impact?: (target: Target, attacker: IGameActor) => void
          report?: string | null
        }
        weapon.impact?.(
          Target.fromPos(centerPos as Parameters<typeof Target.fromPos>[0]),
          self,
        )

        // TODO-8.E.SOUND-DEFER: Game.Sound.Play(SoundType.World, wep.Report, self.World, self.CenterPosition)
      }
    }
  }

  /** Reset cooldown when trait is disabled.
   *
   *  OpenRA 对照: PausableConditionalTrait.TraitDisabled(Actor self)
   */
  protected traitDisabled(_self: IGameActor): void {
    this.cooldown = this.info.startCooldown
  }
}
