/**
 * AttackFrontal.ts -- Frontal-only attack (must face target)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Attack/AttackFrontal.cs (48 lines)
 *
 * 核心范式转换:
 * - C# AttackFrontal : AttackBase → TS AttackFrontal extends AttackBase
 * - Requires IFacing → duck-typed facing check
 * - C# Attack activity → TS stub with TODO for movement (Ch9)
 */

import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackBase, AttackSource, AttackBaseInfo } from './AttackBase.js'

// ---------------------------------------------------------------------------
// AttackFrontalInfo
// ---------------------------------------------------------------------------

/** Configuration for AttackFrontal.
 *
 *  OpenRA 对照: AttackFrontalInfo : AttackBaseInfo, Requires<IFacingInfo>
 */
export class AttackFrontalInfo extends AttackBaseInfo {
  constructor(params: ConstructorParameters<typeof AttackBaseInfo>[0] = {}) {
    super(params)
  }
}

// ---------------------------------------------------------------------------
// AttackFrontal
// OpenRA 对照: AttackFrontal (AttackBase)
// ---------------------------------------------------------------------------

/** Frontal-only attack: unit must face the target to fire.
 *
 *  OpenRA 对照: AttackFrontal
 */
export class AttackFrontal extends AttackBase {
  constructor(info: AttackFrontalInfo) {
    super(info)
  }

  /** Check if the target is within the frontal firing arc.
   *
   *  OpenRA 对照: AttackFrontal.CanAttack(Actor, Target)
   */
  canAttack(self: IGameActor, target: Target): boolean {
    if (!super.canAttack(self, target)) return false

    return this.targetInFiringArc(self, target, this.info.facingTolerance)
  }

  /** Create the attack activity (turn-to-face, then fire).
   *
   *  OpenRA 对照: AttackFrontal.GetAttackActivity()
   *
   *  TODO-8.D.ATTACKFRONTAL-ACT: Full Attack activity (turning, movement)
   *  deferred to Chapter 9 (Movement & Physics). For now, returns a simple
   *  stub that does DoAttack() when facing.
   */
  override getAttackActivity(
    self: IGameActor,
    _source: AttackSource,
    target: Target,
    allowMove: boolean,
    forceAttack: boolean,
    targetLineColor?: string,
  ): unknown {
    // Stub activity: just try to do attack directly
    // Full Attack.cs activity (turn+move) TODO-8.D.ATTACKFRONTAL-ACT
    return new AttackFrontalActivity(
      this,
      self,
      target,
      allowMove,
      forceAttack,
      targetLineColor,
    )
  }
}

// ---------------------------------------------------------------------------
// AttackFrontalActivity (stub)
// ---------------------------------------------------------------------------

/** Simple attack activity stub.
 *
 *  OpenRA 对照: OpenRA.Mods.Common.Activities.Attack
 *
 *  TODO-8.D.ATTACKFRONTAL-ACT: Full implementation requires turning toward
 *  target and movement. For now, does DoAttack() directly.
 */
export class AttackFrontalActivity {
    private readonly attack: AttackFrontal
    private readonly self: IGameActor
    private readonly target: Target
    private isCanceling: boolean = false

    constructor(
      attack: AttackFrontal,
      self: IGameActor,
      target: Target,
      _allowMove: boolean,
      _forceAttack: boolean,
      _targetLineColor?: string,
    ) {
      this.attack = attack
      this.self = self
      this.target = target
    }

    tick(_self: IGameActor): boolean {
      if (this.isCanceling || !this.target.isValidFor(this.self as unknown as never)) {
        return true
      }

      this.attack.doAttack(this.self, this.target)
      return false
    }

    cancel(): void {
      this.isCanceling = true
    }

    queue(_activity: unknown): void { /* no-op */ }
    onActorDisposeOuter(_actor: IGameActor): void { /* no-op */ }
  }
