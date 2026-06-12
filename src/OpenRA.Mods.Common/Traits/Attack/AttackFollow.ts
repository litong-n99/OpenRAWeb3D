/**
 * AttackFollow.ts -- Persistent pursuit with opportunity fire
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Attack/AttackFollow.cs (466 lines)
 *
 * 核心范式转换:
 * - C# AttackFollow : AttackBase, INotifyOwnerChanged, IOverrideAutoTarget, INotifyStanceChanged
 *   → TS AttackFollow extends AttackBase
 * - C# RequestedTarget/OpportunityTarget dual-target system → TS properties
 * - C# AttackActivity inner class → TS inner class (partial implementation)
 * - C# Mobile, RevealsShroud, Rearmable → TS duck-typed (deferred to Ch9)
 * - Movement integration deferred (TODO-8.D.DEFER-MOVE)
 * - Rearming deferred (TODO-8.D.DEFER-REARM)
 */

import { Target, TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import {
  type IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import {
  AttackBase,
  AttackSource,
  AttackBaseInfo,
} from './AttackBase.js'
import {
  type IOverrideAutoTarget,
  type INotifyStanceChanged,
  UnitStance,
  type UnitStance as UnitStanceType,
} from '../CombatInterfaces.js'

// ---------------------------------------------------------------------------
// AttackFollowInfo
// ---------------------------------------------------------------------------

/** Configuration for AttackFollow.
 *
 *  OpenRA 对照: AttackFollowInfo
 */
export class AttackFollowInfo extends AttackBaseInfo {
  /** Automatically acquire and fire on targets of opportunity.
   *
   *  OpenRA 对照: AttackFollowInfo.OpportunityFire
   */
  readonly opportunityFire: boolean = true

  /** Keep firing on targets even after attack order is cancelled.
   *
   *  OpenRA 对照: AttackFollowInfo.PersistentTargeting
   */
  readonly persistentTargeting: boolean = true

  /** Range margin to stay away from min/max ranges.
   *
   *  OpenRA 对照: AttackFollowInfo.RangeMargin
   */
  readonly rangeMargin: number = 1024 // WDist.FromCells(1)

  /** Cancel attack when needing to resupply.
   *
   *  OpenRA 对照: AttackFollowInfo.AbortOnResupply
   */
  readonly abortOnResupply: boolean = true

  constructor(params: {
    instanceName?: string
    armaments?: string[]
    opportunityFire?: boolean
    persistentTargeting?: boolean
    rangeMargin?: number
    abortOnResupply?: boolean
    facingTolerance?: import('../../../OpenRA.Game/WAngle.js').WAngle
  } = {}) {
    super(params)
    this.opportunityFire = params.opportunityFire ?? true
    this.persistentTargeting = params.persistentTargeting ?? true
    this.rangeMargin = params.rangeMargin ?? 1024
    this.abortOnResupply = params.abortOnResupply ?? true
  }
}

// ---------------------------------------------------------------------------
// AttackFollow
// OpenRA 对照: AttackFollow (AttackBase, INotifyOwnerChanged, IOverrideAutoTarget, INotifyStanceChanged)
// ---------------------------------------------------------------------------

/** Persistent pursuit with opportunity fire.
 *
 *  OpenRA 对照: AttackFollow
 *
 *  Manages a dual-target system: RequestedTarget (player-ordered) and
 *  OpportunityTarget (auto-acquired). Implements persistent targeting,
 *  opportunity fire, and stance change handling.
 */
export class AttackFollow
  extends AttackBase
  implements IOverrideAutoTarget, INotifyStanceChanged
{
  /** The player-ordered attack target.
   *
   *  OpenRA 对照: AttackFollow.RequestedTarget
   */
  requestedTarget: Target = Target.Invalid

  /** An auto-acquired target of opportunity.
   *
   *  OpenRA 对照: AttackFollow.OpportunityTarget
   */
  opportunityTarget: Target = Target.Invalid

  private requestedForceAttack: boolean = false
  private opportunityForceAttack: boolean = false
  private opportunityTargetIsPersistentTarget: boolean = false
  private requestedTargetPresetForActivity: unknown = null

  // Duck-typed traits
  private autoTarget: unknown | null = null

  constructor(info: AttackFollowInfo) {
    super(info)
  }

  /** Initialize after actor creation.
   *
   *  OpenRA 对照: AttackFollow.Created()
   */
  onCreated(self: IGameActor): void {
    super.onCreated(self)

    // Duck-typed AutoTarget
    this.autoTarget = null
  }

  // ---------------------------------------------------------------------------
  // Target management
  // ---------------------------------------------------------------------------

  /** Set the requested (player-ordered) target.
   *
   *  OpenRA 对照: AttackFollow.SetRequestedTarget()
   */
  setRequestedTarget(
    target: Target,
    isForceAttack: boolean = false,
    preset: unknown = null,
  ): void {
    this.requestedTarget = target
    this.requestedForceAttack = isForceAttack
    this.requestedTargetPresetForActivity = preset
  }

  /** Clear the requested target, optionally persisting it as opportunity target.
   *
   *  OpenRA 对照: AttackFollow.ClearRequestedTarget()
   */
  clearRequestedTarget(): void {
    if ((this.info as AttackFollowInfo).persistentTargeting) {
      this.opportunityTarget = this.requestedTarget
      this.opportunityForceAttack = this.requestedForceAttack
      this.opportunityTargetIsPersistentTarget = true
    }

    this.requestedTarget = Target.Invalid
    this.requestedTargetPresetForActivity = null
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /** Tick: manage requested/opportunity targets, opportunity fire.
   *
   *  OpenRA 对照: AttackFollow.Tick(Actor)
   */
  override tick(self: IGameActor): void {
    if (this.isTraitDisabled) {
      this.requestedTarget = Target.Invalid
      this.opportunityTarget = Target.Invalid
      this.opportunityTargetIsPersistentTarget = false
    }

    if (this.requestedTargetPresetForActivity !== null) {
      // RequestedTarget was set in preparation for a queued activity
      // Once the activity starts running, it calls UpdateRequestedTarget
      this.requestedTarget = Target.Invalid
      this.requestedTargetPresetForActivity = null
    }

    if (this.requestedTarget.isValidFor(self as unknown as never)) {
      this.isAiming = this.canAimAtTarget(self, this.requestedTarget, this.requestedForceAttack)
      if (this.isAiming) {
        this.doAttack(self, this.requestedTarget)
      }
    } else {
      this.isAiming = false

      if (this.opportunityTarget.isValidFor(self as unknown as never)) {
        this.isAiming = this.canAimAtTarget(self, this.opportunityTarget, this.opportunityForceAttack)
      }

      if (
        !this.isAiming &&
        (this.info as AttackFollowInfo).opportunityFire &&
        this.autoTarget
      ) {
        const at = this.autoTarget as {
          isTraitDisabled?: boolean
          stance?: UnitStanceType
          scanForTarget?: (
            self: IGameActor,
            allowMove: boolean,
            allowTurn: boolean,
          ) => Target
        }

        if (
          !at.isTraitDisabled &&
          (at.stance ?? UnitStance.HoldFire) >= UnitStance.Defend
        ) {
          this.opportunityTarget = at.scanForTarget?.(self, false, false) ?? Target.Invalid
          this.opportunityForceAttack = false
          this.opportunityTargetIsPersistentTarget = false

          if (this.opportunityTarget.isValidFor(self as unknown as never)) {
            this.isAiming = this.canAimAtTarget(self, this.opportunityTarget, this.opportunityForceAttack)
          }
        }
      }

      if (this.isAiming) {
        this.doAttack(self, this.opportunityTarget)
      }
    }

    super.tick(self)
  }

  // ---------------------------------------------------------------------------
  // IOverrideAutoTarget
  // ---------------------------------------------------------------------------

  /** Try to provide an auto-target override (RequestedTarget or persistent OpportunityTarget).
   *
   *  OpenRA 对照: IOverrideAutoTarget.TryGetAutoTargetOverride()
   */
  tryGetAutoTargetOverride(
    _self: IGameActor,
    out: { target: Target },
  ): boolean {
    if (this.requestedTarget.type !== TargetType.Invalid) {
      out.target = this.requestedTarget
      return true
    }

    if (
      this.opportunityTargetIsPersistentTarget &&
      this.opportunityTarget.type !== TargetType.Invalid
    ) {
      out.target = this.opportunityTarget
      return true
    }

    out.target = Target.Invalid
    return false
  }

  // ---------------------------------------------------------------------------
  // INotifyStanceChanged
  // ---------------------------------------------------------------------------

  /** Handle stance changes: cancel opportunity targets.
   *
   *  OpenRA 对照: INotifyStanceChanged.StanceChanged()
   */
  stanceChanged(
    self: IGameActor,
    autoTargetObj: unknown,
    oldStance: UnitStanceType,
    newStance: UnitStanceType,
  ): void {
    // Cancel opportunity targets when switching to more restrictive stance
    if (newStance > oldStance || this.opportunityForceAttack) return

    if (this.opportunityTarget.type === TargetType.Actor) {
      const a = this.opportunityTarget.actor
      if (a) {
        const atAny = autoTargetObj as {
          hasValidTargetPriority?: (
            self: IGameActor,
            owner: unknown,
            targetTypes: ReadonlySet<string>,
          ) => boolean
        }
        const owner = (a as unknown as { owner?: unknown }).owner
        const targetTypes = (a as unknown as {
          getEnabledTargetTypes?: () => ReadonlySet<string>
        }).getEnabledTargetTypes?.() ?? new Set()

        if (
          atAny.hasValidTargetPriority &&
          !atAny.hasValidTargetPriority(self, owner, targetTypes)
        ) {
          this.opportunityTarget = Target.Invalid
        }
      }
    } else if (this.opportunityTarget.type === TargetType.FrozenActor) {
      const fa = this.opportunityTarget.frozenActor
      if (fa) {
        const atAny = autoTargetObj as {
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
          this.opportunityTarget = Target.Invalid
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // OnResolveAttackOrder
  // ---------------------------------------------------------------------------

  /** Pre-set the requested target for responsiveness.
   *
   *  OpenRA 对照: AttackFollow.OnResolveAttackOrder()
   */
  override onResolveAttackOrder(
    _self: IGameActor,
    activity: unknown,
    target: Target,
    queued: boolean,
    forceAttack: boolean,
  ): void {
    if (!queued) {
      this.setRequestedTarget(target, forceAttack, activity)
    }
  }

  // ---------------------------------------------------------------------------
  // Attack activity
  // ---------------------------------------------------------------------------

  /** Create the attack activity for pursuit.
   *
   *  OpenRA 对照: AttackFollow.GetAttackActivity()
   */
  override getAttackActivity(
    self: IGameActor,
    source: AttackSource,
    target: Target,
    allowMove: boolean,
    forceAttack: boolean,
    targetLineColor?: string,
  ): unknown {
    // HACK: Manually force forceAttack if we persisted an opportunity target
    if (
      this.opportunityTargetIsPersistentTarget &&
      this.opportunityForceAttack &&
      Target.equals(target, this.opportunityTarget)
    ) {
      forceAttack = true
    }

    return new AttackFollowActivity(
      this,
      self,
      source,
      target,
      allowMove,
      forceAttack,
      targetLineColor,
    )
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Check if we can aim at a target (in range, in arc, valid weapons).
   *
   *  OpenRA 对照: AttackFollow.CanAimAtTarget()
   */
  private canAimAtTarget(
    self: IGameActor,
    target: Target,
    forceAttack: boolean,
  ): boolean {
    if (target.type === TargetType.Actor) {
      // Can't attack what we can't see
      // Duck-typed visibility check deferred
    }

    if (target.type === TargetType.FrozenActor && !target.frozenActor) {
      return false
    }

    const centerPos =
      (self as unknown as { centerPosition?: { X: number; Y: number; Z: number } })
        .centerPosition ?? { X: 0, Y: 0, Z: 0 }
    const pos = {
      X: centerPos.X,
      Y: centerPos.Y,
      Z: centerPos.Z,
    }

    const armaments = this.chooseArmamentsForTarget(target, forceAttack)
    for (const a of armaments) {
      if (
        target.isInRange(
          pos as unknown as import('../../../OpenRA.Game/WPos.js').WPos,
          a.maxRange(),
        ) &&
        (WDist.equals(a.weapon?.minRange ?? WDist.Zero, WDist.Zero) ||
          !target.isInRange(
            pos as unknown as import('../../../OpenRA.Game/WPos.js').WPos,
            a.weapon!.minRange,
          )) &&
        this.targetInFiringArc(self, target, this.info.facingTolerance)
      ) {
        return true
      }
    }

    return false
  }
}

// ---------------------------------------------------------------------------
// AttackActivity (inner class, partial implementation)
// ---------------------------------------------------------------------------

// Static inner class: AttackActivity
// Note: Use a standalone class instead of namespace due to erasableSyntaxOnly
export class AttackFollowActivity {
    private readonly attack: AttackFollow
    private readonly forceAttack: boolean
    private readonly allowMove: boolean

    private target: Target
    private isCanceling: boolean = false
    private hasTicked: boolean = false

    constructor(
      attack: AttackFollow,
      _self: IGameActor,
      _source: AttackSource,
      target: Target,
      allowMove: boolean,
      forceAttack: boolean,
      _targetLineColor?: string,
    ) {
      this.attack = attack
      this.target = target
      this.allowMove = allowMove
      this.forceAttack = forceAttack
    }

    /** Tick: check target validity, do attack if in range.
     *
     *  OpenRA 对照: AttackActivity.Tick(Actor)
     */
    tick(self: IGameActor): boolean {
      if (this.isCanceling) return true

      // Check that AttackFollow hasn't cancelled the target
      if (this.hasTicked && this.attack.requestedTarget.type === TargetType.Invalid) {
        return true
      }

      if (this.attack.isTraitDisabled) return false

      // Recalculate target
      // OpenRA 对照: target = target.Recalculate(self.Owner, out var targetIsHiddenActor)
      this.target = (this.target as unknown as {
        recalculate?: (owner: unknown, out: { targetIsHiddenActor: boolean }) => Target
      }).recalculate?.(
        (self as unknown as { owner?: unknown }).owner,
        { targetIsHiddenActor: false },
      ) ?? this.target
      this.attack.setRequestedTarget(this.target, this.forceAttack)
      this.hasTicked = true

      // Check reachability
      if (!this.target.isValidFor(self as unknown as never)) return true
      if (!this.attack.isReachableTarget(this.target, this.allowMove, self)) return true

      // Do attack
      this.attack.doAttack(self, this.target)
      return false
    }

    /** Cancel this activity. */
    cancel(): void {
      this.isCanceling = true
    }

    /** Called when this is the last activity in the chain.
     *
     *  OpenRA 对照: AttackActivity.OnLastRun(Actor)
     */
    onLastRun(_self: IGameActor): void {
      this.attack.clearRequestedTarget()
    }

    // Activity interface stubs
    queue(_activity: unknown): void { /* no-op */ }
    onActorDisposeOuter(_actor: IGameActor): void { /* no-op */ }
  }
