/**
 * AttackOmni.ts -- Omnidirectional attack (no facing constraint)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Attack/AttackOmni.cs (92 lines)
 *
 * 核心范式转换:
 * - C# AttackOmni : AttackBase → TS AttackOmni extends AttackBase
 * - C# inner class SetTarget : Activity → TS inner class implementing activity
 * - C# TargetLineNodes → deferred TODO-8.D.ATTACKOMNI-TARGETLINES
 */

import { Target, TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackBase, AttackSource, AttackBaseInfo } from './AttackBase.js'
import type { IActivityNotifyStanceChanged } from '../CombatInterfaces.js'
import type { UnitStance as UnitStanceType } from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// AttackOmniInfo
// ---------------------------------------------------------------------------

/** Configuration for AttackOmni.
 *
 *  OpenRA 对照: AttackOmniInfo
 */
export class AttackOmniInfo extends AttackBaseInfo {
  constructor(params: ConstructorParameters<typeof AttackBaseInfo>[0] = {}) {
    super(params)
  }
}

// ---------------------------------------------------------------------------
// AttackOmni
// OpenRA 对照: AttackOmni (AttackBase)
// ---------------------------------------------------------------------------

/** Omnidirectional attack: can fire in any direction without facing constraints.
 *
 *  OpenRA 对照: AttackOmni
 */
export class AttackOmni extends AttackBase {
  constructor(info: AttackOmniInfo) {
    super(info)
  }

  /** Create the SetTarget activity for this attack.
   *
   *  OpenRA 对照: AttackOmni.GetAttackActivity()
   */
  override getAttackActivity(
    self: IGameActor,
    _source: AttackSource,
    target: Target,
    allowMove: boolean,
    forceAttack: boolean,
    targetLineColor?: string,
  ): unknown {
    return new AttackOmniSetTarget(
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
// AttackOmniSetTarget
// OpenRA 对照: AttackOmni.SetTarget : Activity, IActivityNotifyStanceChanged
// ---------------------------------------------------------------------------

/** SetTarget activity: continuously fires at the target while valid.
 *
 *  OpenRA 对照: AttackOmni.SetTarget
 */
export class AttackOmniSetTarget implements IActivityNotifyStanceChanged {
    private readonly attack: AttackOmni
    private readonly self: IGameActor
    private target: Target
    private readonly allowMove: boolean
    private readonly forceAttack: boolean
    private isCanceling: boolean = false

    constructor(
      attack: AttackOmni,
      self: IGameActor,
      target: Target,
      allowMove: boolean,
      forceAttack: boolean,
      _targetLineColor?: string,
    ) {
      this.attack = attack
      this.self = self
      this.target = target
      this.allowMove = allowMove
      this.forceAttack = forceAttack
    }

    /** Tick: recalculate target, check validity, do attack.
     *
     *  OpenRA 对照: SetTarget.Tick(Actor)
     */
    tick(_self: IGameActor): boolean {
      // Recalculate target (hidden targets invalidated)
      // OpenRA 对照: target = target.RecalculateInvalidatingHiddenTargets(self.Owner)
      this.target = (this.target as unknown as {
        recalculateInvalidatingHiddenTargets?: (owner: unknown) => Target
      }).recalculateInvalidatingHiddenTargets?.(
        (this.self as unknown as { owner?: unknown }).owner,
      ) ?? this.target

      if (this.isCanceling || !this.target.isValidFor(this.self as unknown as never)) {
        return true
      }

      const reachable = this.attack.isReachableTarget(this.target, this.allowMove, this.self)

      if (!reachable) return true

      this.attack.doAttack(this.self, this.target)
      return false
    }

    /** Cancel this activity. */
    cancel(): void {
      this.isCanceling = true
    }

    /** Handle stance change: cancel non-forced targets.
     *
     *  OpenRA 对照: IActivityNotifyStanceChanged.StanceChanged()
     */
    stanceChanged(
      self: IGameActor,
      autoTarget: unknown,
      oldStance: UnitStanceType,
      newStance: UnitStanceType,
    ): void {
      // Cancel non-forced targets when switching to more restrictive stance
      if (newStance > oldStance || this.forceAttack) return

      if (this.target.type === TargetType.Actor) {
        const targetActor = this.target.actor
        if (targetActor) {
          const atAny = autoTarget as {
            hasValidTargetPriority?: (
              self: IGameActor,
              owner: unknown,
              targetTypes: ReadonlySet<string>,
            ) => boolean
          }
          const owner = (targetActor as unknown as { owner?: unknown }).owner
          const targetTypes = (targetActor as unknown as {
            getEnabledTargetTypes?: () => ReadonlySet<string>
          }).getEnabledTargetTypes?.() ?? new Set()

          if (
            atAny.hasValidTargetPriority &&
            !atAny.hasValidTargetPriority(self, owner, targetTypes)
          ) {
            this.target = Target.Invalid
          }
        }
      } else if (this.target.type === TargetType.FrozenActor) {
        const fa = this.target.frozenActor
        if (fa) {
          const atAny = autoTarget as {
            hasValidTargetPriority?: (
              self: IGameActor,
              owner: unknown,
              targetTypes: ReadonlySet<string>,
            ) => boolean
          }
          const faAny = fa as unknown as {
            owner?: unknown
            targetTypes?: ReadonlySet<string>
          }
          if (
            atAny.hasValidTargetPriority &&
            faAny.owner &&
            faAny.targetTypes &&
            !atAny.hasValidTargetPriority(self, faAny.owner, faAny.targetTypes)
          ) {
            this.target = Target.Invalid
          }
        }
      }
    }

    // Activity interface method stubs
    queue(_activity: unknown): void { /* no-op for simple activity */ }
    onActorDisposeOuter(_actor: IGameActor): void { /* no-op */ }
  }
