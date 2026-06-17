/**
 * AttackLeap.ts — 跳跃攻击（移动到目标位置后执行攻击）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Attack/AttackLeap.cs (72 lines)
 *
 * 核心范式转换:
 * - C# AttackLeap : AttackFrontal → TS AttackLeap extends AttackFrontal
 * - C# GrantCondition/RevokeCondition → TS duck-typed condition system
 * - C# LeapAttack activity → TS stub activity reference
 * - C# Actor.InvalidConditionToken → TS -1 sentinel
 * - C# Requires<MobileInfo> → TS duck-typed requirement (documented)
 */

import { TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import type { Target as TargetType_ } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  AttackFrontal,
  AttackFrontalInfo,
} from '../../../OpenRA.Mods.Common/Traits/Attack/AttackFrontal.js'
import { AttackSource } from '../../../OpenRA.Mods.Common/Traits/Attack/AttackBase.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'

// ---------------------------------------------------------------------------
// AttackLeapInfo
// OpenRA 对照: AttackLeapInfo : AttackFrontalInfo, Requires<MobileInfo>
// ---------------------------------------------------------------------------

export class AttackLeapInfo extends AttackFrontalInfo {
  /** Leap speed in WDist units/tick. */
  readonly speed: WDist = new WDist(426)

  /** Condition granted from start of leap until the attack lands. */
  readonly leapCondition: string = 'attacking'

  constructor(
    params: Partial<AttackLeapInfo> &
      ConstructorParameters<typeof AttackFrontalInfo>[0] = {},
  ) {
    super(params)
    this.speed =
      params.speed instanceof WDist ? params.speed : new WDist(426)
    this.leapCondition = params.leapCondition ?? 'attacking'
  }
}

// ---------------------------------------------------------------------------
// AttackLeap
// OpenRA 对照: AttackLeap : AttackFrontal
// ---------------------------------------------------------------------------

/**
 * Leaps (parabolic arc) toward the target and attacks on landing.
 * Can attack if already on the target's cell (melee range).
 *
 * Requires: Mobile trait (duck-typed)
 *
 * OpenRA 对照: AttackLeap
 */
export class AttackLeap extends AttackFrontal {
  readonly info: AttackLeapInfo

  /** Token for the leap condition grant. -1 = InvalidConditionToken. */
  private leapToken: number = -1

  constructor(info: AttackLeapInfo) {
    super(info)
    this.info = info
  }

  // ---------------------------------------------------------------------------
  // CanAttack — allow melee attack from same cell
  // ---------------------------------------------------------------------------

  /**
   * Check if we can attack the target. Allows attack when on the same cell
   * (melee/adjacent range) in addition to the standard frontal check.
   *
   * OpenRA 对照: AttackLeap.CanAttack()
   */
  override canAttack(self: IGameActor, target: TargetType_): boolean {
    if (target.type !== TargetType.Actor) return false

    // Melee-range: same cell
    const selfPos = (self as unknown as { location?: { X: number; Y: number } }).location
    const targetActor = (target as unknown as { actor?: { location?: { X: number; Y: number } } }).actor
    const targetPos = targetActor?.location

    if (
      selfPos &&
      targetPos &&
      selfPos.X === targetPos.X &&
      selfPos.Y === targetPos.Y &&
      this.hasAnyValidWeapons(target)
    ) {
      return true
    }

    return super.canAttack(self, target)
  }

  // ---------------------------------------------------------------------------
  // Condition management
  // ---------------------------------------------------------------------------

  /**
   * Grant the leap condition (called at the start of the leap).
   *
   * OpenRA 对照: AttackLeap.GrantLeapCondition()
   */
  grantLeapCondition(self: IGameActor): void {
    const selfAny = self as unknown as {
      grantCondition?: (condition: string) => number
    }
    this.leapToken = selfAny.grantCondition?.(this.info.leapCondition) ?? -1
  }

  /**
   * Revoke the leap condition (called when the leap completes).
   *
   * OpenRA 对照: AttackLeap.RevokeLeapCondition()
   */
  revokeLeapCondition(self: IGameActor): void {
    if (this.leapToken !== -1) {
      const selfAny = self as unknown as {
        revokeCondition?: (token: number) => number
      }
      this.leapToken = selfAny.revokeCondition?.(this.leapToken) ?? -1
    }
  }

  // ---------------------------------------------------------------------------
  // getAttackActivity — create LeapAttack activity
  // ---------------------------------------------------------------------------

  /**
   * Returns a LeapAttack activity.
   *
   * OpenRA 对照: AttackLeap.GetAttackActivity()
   *
   * TODO-19.A.19-LEAP-ACT: Full LeapAttack activity (parabolic arc, landing).
   * Currently returns a stub that provides the config for the activity.
   */
  override getAttackActivity(
    self: IGameActor,
    _source: AttackSource,
    target: TargetType_,
    allowMove: boolean,
    forceAttack: boolean,
    targetLineColor?: string,
  ): unknown {
    return {
      __type: 'LeapAttack',
      self,
      target,
      allowMove,
      forceAttack,
      attackTrait: this,
      info: this.info,
      targetLineColor: targetLineColor ?? null,
    }
  }
}
