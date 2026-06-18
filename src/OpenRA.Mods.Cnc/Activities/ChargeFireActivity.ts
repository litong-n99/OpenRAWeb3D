/**
 * ChargeFireActivity.ts — 特斯拉充能射击活动（单次射击+冷却循环）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Attack/AttackTesla.cs ChargeFire inner class (lines 148-172)
 *
 * 核心范式转换:
 * - C# ChargeFire : Activity → TS ChargeFireActivity extends Activity
 * - C# QueueChild(Wait(ChargeDelay)) → TS queueChild(new Wait(chargeDelay))
 * - C# AttackTesla.DoAttack → TS attack.doAttack()
 * - 3D: charge audio → TODO integration point (Game.Sound singleton)
 *
 * 活动状态:
 * - Firing: doAttack() → queue Wait(ChargeDelay) → Cooldown
 * - Cooldown: Wait child ticks down
 * - After cooldown: if charges remain, fire again; else complete
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Wait } from '../../OpenRA.Mods.Common/Activities/Wait.js'

// ---------------------------------------------------------------------------
// Duck-typed AttackTesla interface
// ---------------------------------------------------------------------------

interface AttackTeslaLike {
  canAttack(self: IGameActor, target: Target): boolean
  getCharges(): number
  getChargeDelay(): number
  doAttack(self: IGameActor, target: Target): void
}

// ---------------------------------------------------------------------------
// ChargeFireActivity
// OpenRA 对照: AttackTesla.ChargeFire : Activity
// ---------------------------------------------------------------------------

/**
 * Fires a single Tesla shot, then queues a Wait(ChargeDelay) cooldown.
 * After the cooldown and any repeat shots (for multi-charge units), completes.
 *
 * OpenRA 对照: AttackTesla.ChargeFire
 *
 * Each tick loop:
 * 1. Check cancel / canAttack / charges → complete if invalid
 * 2. Fire one shot via attack.doAttack()
 * 3. Queue Wait(ChargeDelay) child activity
 * 4. Return false (let Wait child tick); on re-entry after child done,
 *    repeat until charges exhausted or target invalid
 */
export class ChargeFireActivity extends Activity {
  private readonly attack: AttackTeslaLike
  private readonly target: Target

  constructor(attack: AttackTeslaLike, target: Target) {
    super()
    this.attack = attack
    this.target = target
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: ChargeFire.Tick(Actor)
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    // Cast GameActor to IGameActor. GameActor implements IGameActor but
    // the queueActivity method differs (Activity vs ActivityStub), so
    // TypeScript requires an explicit cast through unknown.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sa = self as unknown as IGameActor

    if (this.isCanceling || !this.attack.canAttack(sa, this.target))
      return true

    if (this.attack.getCharges() === 0)
      return true

    this.attack.doAttack(sa, this.target)

    const chargeDelay = this.attack.getChargeDelay()
    if (chargeDelay > 0) {
      this.queueChild(new Wait(chargeDelay))
    }

    return false
  }
}
