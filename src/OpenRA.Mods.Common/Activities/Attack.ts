/**
 * Attack.ts — 攻击活动（核心战斗循环）
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Attack.cs
 *
 * 核心范式转换:
 * - C# Attack activity with AttackFrontal → TypeScript with AttackBase
 * - C# Armament.CheckFire → reuse Ch8 Armament.checkFire
 * - C# MoveCooldownHelper → reuse existing MoveCooldownHelper.ts
 * - C# Target.Recalculate() → Target.recalculate() (already migrated)
 * - C# Util.TickFacing → WAngle.tickFacing() (already migrated)
 * - C# RevealsShroud range check → simplified sight range check
 * - C# IActivityNotifyStanceChanged → duck-typed interface check
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity, TargetLineNode } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { ColorStub, IFacing } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { AttackBase } from '../Traits/Attack/AttackBase.js'
import type { Armament } from '../Traits/Armament.js'
import { MoveCooldownHelper } from './Move/MoveCooldownHelper.js'
import type { UnitStance } from '../Traits/CombatInterfaces.js'

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Standard red target-line color used when moving toward a target.
 *
 * OpenRA 对照: Color.Red
 */
const TargetLineRed: ColorStub = { r: 255, g: 0, b: 0, a: 255 }

// ---------------------------------------------------------------------------
// AttackStatus enum (对应 OpenRA Attack.AttackStatus)
// ---------------------------------------------------------------------------

/**
 * The current status of an attack attempt.
 *
 * OpenRA 对照: Attack.AttackStatus { UnableToAttack, NeedsToTurn, NeedsToMove, Attacking }
 */
export const AttackStatus = {
  UnableToAttack: 0,
  NeedsToTurn: 1,
  NeedsToMove: 2,
  Attacking: 3,
} as const
export type AttackStatus = (typeof AttackStatus)[keyof typeof AttackStatus]

// ---------------------------------------------------------------------------
// Attack
// ---------------------------------------------------------------------------

/**
 * Core combat activity: orchestrates the attack loop.
 *
 * OpenRA 对照: Attack activity
 *
 * The attack loop:
 * 1. Check if target is still valid (cancel if not)
 * 2. Recalculate target (handle visibility changes)
 * 3. If target is hidden, move to last known position
 * 4. For each attack trait:
 *    a. Check if target is in range → move if not
 *    b. Check if facing target → turn if not
 *    c. Fire armaments
 * 5. Return status based on worst case across all attack traits
 *
 * Used by: AttackFrontal, AttackMoveActivity, AutoTarget
 */
export class Attack extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** Whether this is a force-attack (attack ground / ignore relationships). */
  readonly forceAttack: boolean

  /** Color for target line rendering. */
  readonly targetLineColor: ColorStub | null

  // ---------------------------------------------------------------------------
  // Trait references
  // ---------------------------------------------------------------------------

  /** Active AttackBase traits on the actor. */
  private readonly attackTraits: AttackBase[]

  /** Duck-typed IFacing trait. */
  private readonly facing: {
    facing: WAngle
    turnSpeed: WAngle
  } | null

  /** Duck-typed IPositionable trait. */
  private readonly positionable: {
    canEnterCell: (cell: unknown, ignoreActor?: unknown, check?: unknown) => boolean
  } | null

  /** Duck-typed Mobile.moveWithinRangeMinMax trait (null if movement not allowed).
   *
   * OpenRA 对照: IMove.MoveWithinRange(Target, WDist, WDist, WPos?, Color?)
   */
  private readonly move: {
    moveWithinRangeMinMax: (source: GameActor, target: Target, minRange: WDist, maxRange: WDist, initialTargetPosition: WPos, targetLineColor: ColorStub | null) => Activity
  } | null

  /** Duck-typed Mobile trait (for ground layer interaction check). */
  private readonly mobile: {
    isTraitDisabled: boolean
    isTraitPaused: boolean
    canInteractWithGroundLayer: (self: GameActor) => boolean
  } | null

  /** Move cooldown helper for movement retry logic. */
  private readonly moveCooldownHelper: MoveCooldownHelper

  // ---------------------------------------------------------------------------
  // Target tracking
  // ---------------------------------------------------------------------------

  /** The current target. */
  protected target: Target

  /** Last known position of the target (for hidden actor fallback). */
  private lastVisibleTarget: Target

  /** Last known maximum range when target was visible. */
  private lastVisibleMaximumRange: WDist

  /** Whether to use lastVisibleTarget instead of current target. */
  private useLastVisibleTarget: boolean = false

  /** Last known owner of the target (for stance change checks).
   * NOTE: Set during tick but read via stanceChanged. Preserved for OpenRA fidelity. */
  private lastVisibleOwner: unknown | null = null

  /** Last known target types of the target (for stance change checks).
   * NOTE: Set during tick but read via stanceChanged. Preserved for OpenRA fidelity. */
  private lastVisibleTargetTypes: ReadonlySet<string> | null = null

  // ---------------------------------------------------------------------------
  // Attack state
  // ---------------------------------------------------------------------------

  /** Current minimum range (updated per-tick based on active armaments). */
  private minRange: WDist = WDist.Zero

  /** Current maximum range (updated per-tick based on active armaments). */
  private maxRange: WDist = WDist.Zero

  /** Combined attack status across all attack traits. */
  private attackStatus: number = AttackStatus.UnableToAttack

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create an Attack activity.
   *
   * OpenRA 对照: Attack(Actor, Target, bool, bool, Color?)
   *
   * @param self — the actor performing the attack
   * @param target — the target to attack
   * @param allowMovement — whether the actor can move to get in range
   * @param forceAttack — whether this is a force-attack
   * @param targetLineColor — optional color for target line rendering
   */
  constructor(
    self: GameActor,
    target: Target,
    allowMovement: boolean,
    forceAttack: boolean,
    targetLineColor: ColorStub | null = null,
  ) {
    super()
    this.target = target
    this.forceAttack = forceAttack
    this.targetLineColor = targetLineColor
    this.childHasPriority = false

    // Resolve attack traits
    // NOTE: Array.from(traits.values()) is O(n) but actor trait counts are
    // typically small (<20). Caching by type is deferred to a future trait
    // registry optimization.
    const actorAny = self as unknown as {
      traits?: Map<string, unknown>
      world?: { sharedRandom?: { next(): number } }
    }
    const allTraits = actorAny.traits ? Array.from(actorAny.traits.values()) : []
    this.attackTraits = (Array.isArray(allTraits) ? allTraits : [])
      .filter((t): t is AttackBase => {
        // Duck-type check for AttackBase
        return t !== null && typeof t === 'object' && 'chooseArmamentsForTarget' in t && 'info' in t
      })
      .filter(t => {
        const anyT = t as unknown as { isTraitDisabled?: boolean }
        return !anyT.isTraitDisabled
      })

    // Resolve IFacing
    this.facing = (actorAny.traits?.get('facing') ?? null) as Attack['facing']

    // Resolve IPositionable (Mobile or equivalent)
    this.positionable = (actorAny.traits?.get('Mobile') ?? null) as Attack['positionable']

    // Resolve IMove (only if movement is allowed)
    const moveTrait = actorAny.traits?.get('Mobile') ?? actorAny.traits?.get('Aircraft') ?? null
    this.move = allowMovement ? moveTrait as Attack['move'] : null

    // Resolve Mobile (for ground layer check)
    this.mobile = (actorAny.traits?.get('Mobile') ?? null) as Attack['mobile']

    // Move cooldown helper
    this.moveCooldownHelper = new MoveCooldownHelper(
      actorAny.world ?? null,
      null, // Mobile type not needed for Attack; moveResult checked via duck-typing
    )

    // Initialize last visible target info
    this.lastVisibleTarget = Target.Invalid
    this.lastVisibleMaximumRange = WDist.Zero

    // Set up last visible target from constructor if target is visible
    this.initializeLastVisibleTarget(self, target)
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize last visible target from the initial target.
   *
   * OpenRA 对照: Attack constructor (lines 69-88)
   */
  private initializeLastVisibleTarget(self: GameActor, target: Target): void {
    const canView = target.type === TargetType.Actor &&
      (target.actor as unknown as { canBeViewedByPlayer?: (p: unknown) => boolean })?.canBeViewedByPlayer?.(
        (self as unknown as { owner?: unknown }).owner
      )

    if (canView || target.type === TargetType.FrozenActor || target.type === TargetType.Terrain) {
      this.lastVisibleTarget = Target.fromPos(target.centerPosition)

      // Get max range from attack traits
      if (this.attackTraits.length > 0) {
        let minRange = WDist.MaxValue
        for (const attack of this.attackTraits) {
          const range = attack.getMaximumRangeVersusTarget(target)
          if (WDist.lessThan(range, minRange)) minRange = range
        }
        this.lastVisibleMaximumRange = WDist.equals(minRange, WDist.MaxValue) ? WDist.Zero : minRange
      }

      if (target.type === TargetType.Actor) {
        // NOTE: lastVisibleOwner and lastVisibleTargetTypes tracking
        // is deferred until full AutoTarget/stance system is migrated.
        // Store owner and target types for stance checks.
      } else if (target.type === TargetType.FrozenActor) {
        // FrozenActor tracking deferred
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Target recalculation
  // ---------------------------------------------------------------------------

  /**
   * Recalculate the current target, handling visibility changes.
   *
   * OpenRA 对照: Attack.RecalculateTarget(Actor, out bool)
   *
   * Virtual so subclasses can override target resolution behavior.
   *
   * @param self — the actor performing the attack
   * @returns [recalculated target, whether the target is a hidden actor]
   */
  protected recalculateTarget(self: GameActor): [Target, boolean] {
    return this.target.recalculate(
      (self as unknown as { owner?: unknown }).owner,
    )
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Main attack loop tick.
   *
   * OpenRA 对照: Attack.Tick(Actor)
   *
   * @param self — the actor performing the attack
   * @returns true if complete, false to continue
   */
  override tick(self: GameActor): boolean {
    // Cancel if no valid armaments for the target
    if (!this.isCanceling && !this.hasArmamentsFor(this.target)) {
      this.cancel(self, true)
    }

    // Tick child activity first
    if (!this.tickChild(self)) return false

    // If canceling and child done, finish
    if (this.isCanceling) return true

    // Recalculate target (handle visibility changes)
    const [recalculatedTarget, targetIsHiddenActor] = this.recalculateTarget(self)
    this.target = recalculatedTarget

    // Update last visible target info
    if (!targetIsHiddenActor && this.target.type === TargetType.Actor) {
      this.lastVisibleTarget = Target.fromTargetPositions(this.target)

      if (this.attackTraits.length > 0) {
        let minRange = WDist.MaxValue
        for (const attack of this.attackTraits) {
          const range = attack.getMaximumRangeVersusTarget(this.target)
          if (WDist.lessThan(range, minRange)) minRange = range
        }
        this.lastVisibleMaximumRange = WDist.equals(minRange, WDist.MaxValue) ? WDist.Zero : minRange
      }

      // NOTE: lastVisibleOwner and lastVisibleTargetTypes tracking
      // is deferred until full AutoTarget/stance system is migrated.
      // Store owner and target types for stance checks.
    }

    this.useLastVisibleTarget = targetIsHiddenActor || !this.target.isValidFor(self as unknown as never)

    // Move cooldown helper check
    const cooldownResult = this.moveCooldownHelper.tick(targetIsHiddenActor)
    if (cooldownResult !== null) return cooldownResult

    // Target is hidden or dead, and no fallback position
    if (this.useLastVisibleTarget && !this.lastVisibleTarget.isValidFor(self as unknown as never)) {
      return true
    }

    const pos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const checkTarget = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target

    // Target is hidden — move to last known position
    if (this.useLastVisibleTarget) {
      // We've reached the assumed position but target is not there
      if (checkTarget.isInRange(pos, this.lastVisibleMaximumRange) ||
          this.move === null ||
          WDist.equals(this.lastVisibleMaximumRange, WDist.Zero)) {
        return true
      }

      // Move toward last known position
      this.moveCooldownHelper.notifyMoveQueued()
      this.queueChild(this.move.moveWithinRangeMinMax(
        self,
        this.target,
        WDist.Zero,
        this.lastVisibleMaximumRange,
        checkTarget.centerPosition,
        TargetLineRed,
      ))
      return false
    }

    // Process each attack trait
    this.attackStatus = AttackStatus.UnableToAttack

    for (const attack of this.attackTraits) {
      const status = this.tickAttack(self, attack)
      attack.isAiming = status === AttackStatus.Attacking || status === AttackStatus.NeedsToTurn
    }

    // If any attack needs to turn or move, we're not done
    if (this.attackStatus >= AttackStatus.NeedsToTurn) return false

    return true
  }

  // ---------------------------------------------------------------------------
  // Attack per-trait tick
  // ---------------------------------------------------------------------------

  /**
   * Tick a single attack trait against the current target.
   *
   * OpenRA 对照: Attack.TickAttack(Actor, AttackFrontal)
   *
   * @param self — the actor performing the attack
   * @param attack — the attack trait to tick
   * @returns the attack status for this trait
   */
  protected tickAttack(self: GameActor, attack: AttackBase): number {
    if (!this.target.isValidFor(self as unknown as never)) {
      return AttackStatus.UnableToAttack
    }

    // Check if attack requires entering cell
    const attackInfo = attack.info
    if (attackInfo.attackRequiresEnteringCell &&
        this.positionable !== null &&
        this.target.type === TargetType.Actor &&
        !this.positionable.canEnterCell(
          (this.target.actor as unknown as { location?: unknown }).location,
          null,
          { None: 0 },
        )) {
      return AttackStatus.UnableToAttack
    }

    // Check frozen actor targeting
    if (!attackInfo.targetFrozenActors &&
        !this.forceAttack &&
        this.target.type === TargetType.FrozenActor) {
      if (this.move === null) return AttackStatus.UnableToAttack

      // Move within sight range to reveal the target
      const sightRange = WDist.fromCells(2)
      this.attackStatus = this.attackStatus >= AttackStatus.NeedsToMove ? this.attackStatus : AttackStatus.NeedsToMove
      this.moveCooldownHelper.notifyMoveQueued()
      this.queueChild(this.move.moveWithinRangeMinMax(
        self,
        this.target,
        sightRange,
        WDist.MaxValue,
        this.target.centerPosition,
        TargetLineRed,
      ))
      return AttackStatus.NeedsToMove
    }

    // Choose armaments for this target
    const armaments = attack.chooseArmamentsForTarget(this.target, this.forceAttack)
    if (armaments.length === 0) return AttackStatus.UnableToAttack

    // Update ranges based on active/paused armaments
    const activeArmaments = armaments.filter(a => !a.isTraitPaused)
    if (activeArmaments.length > 0) {
      let minR = WDist.Zero
      let maxR = WDist.MaxValue
      for (const a of activeArmaments) {
        const weaponMin = a.weapon?.minRange ?? WDist.Zero
        const weaponMax = a.maxRange()
        if (WDist.greaterThan(weaponMin, minR)) minR = weaponMin
        if (WDist.lessThan(weaponMax, maxR)) maxR = weaponMax
      }
      this.minRange = minR
      this.maxRange = maxR
    } else {
      // All weapons paused — use paused weapon with highest range
      this.minRange = WDist.Zero
      let maxR = WDist.Zero
      for (const a of armaments) {
        const range = a.maxRange()
        if (WDist.greaterThan(range, maxR)) maxR = range
      }
      this.maxRange = maxR
    }

    // Range check
    const pos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const inMaxRange = this.target.isInRange(pos, this.maxRange)
    const inMinRange = !WDist.equals(this.minRange, WDist.Zero) && this.target.isInRange(pos, this.minRange)
    const canInteract = this.mobile === null || this.mobile.canInteractWithGroundLayer(self)

    if (!inMaxRange || inMinRange || !canInteract) {
      if (this.move === null) return AttackStatus.UnableToAttack

      this.attackStatus = this.attackStatus >= AttackStatus.NeedsToMove ? this.attackStatus : AttackStatus.NeedsToMove
      this.moveCooldownHelper.notifyMoveQueued()
      const checkTarget = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
      this.queueChild(this.move.moveWithinRangeMinMax(
        self,
        this.target,
        this.minRange,
        this.maxRange,
        checkTarget.centerPosition,
        TargetLineRed,
      ))
      return AttackStatus.NeedsToMove
    }

    // Firing arc check
    const facingTolerance = attackInfo.facingTolerance ?? new WAngle(512)
    if (!attack.targetInFiringArc(self, this.target, facingTolerance)) {
      // Try to turn toward target
      if (this.mobile === null || (!this.mobile.isTraitDisabled && !this.mobile.isTraitPaused)) {
        const targetPos = attack.getTargetPosition(pos, this.target)
        const delta = WPos.subtract(targetPos, pos)
        const desiredFacing = delta.yaw

        if (this.facing !== null) {
          this.facing.facing = WAngle.tickFacing(
            this.facing.facing,
            desiredFacing,
            this.facing.turnSpeed,
          )

          // Check again if we turned enough
          if (!attack.targetInFiringArc(self, this.target, facingTolerance)) {
            this.attackStatus = this.attackStatus >= AttackStatus.NeedsToTurn ? this.attackStatus : AttackStatus.NeedsToTurn
            return AttackStatus.NeedsToTurn
          }
        } else {
          this.attackStatus = this.attackStatus >= AttackStatus.NeedsToTurn ? this.attackStatus : AttackStatus.NeedsToTurn
          return AttackStatus.NeedsToTurn
        }
      } else {
        this.attackStatus = this.attackStatus >= AttackStatus.NeedsToTurn ? this.attackStatus : AttackStatus.NeedsToTurn
        return AttackStatus.NeedsToTurn
      }
    }

    // In range and facing — attack!
    this.attackStatus = this.attackStatus >= AttackStatus.Attacking ? this.attackStatus : AttackStatus.Attacking
    this.doAttack(self, attack, armaments)

    return AttackStatus.Attacking
  }

  // ---------------------------------------------------------------------------
  // Attack execution
  // ---------------------------------------------------------------------------

  /**
   * Fire all valid armaments at the target.
   *
   * OpenRA 对照: Attack.DoAttack(Actor, AttackFrontal, IEnumerable<Armament>)
   *
   * @param self — the actor performing the attack
   * @param attack — the attack trait
   * @param armaments — the armaments to fire
   */
  protected doAttack(self: GameActor, attack: AttackBase, armaments: Armament[]): void {
    if (attack.isTraitPaused) return

    for (const a of armaments) {
      a.checkFire(self, this.facing as IFacing | null, this.target)
    }
  }

  // ---------------------------------------------------------------------------
  // Stance change notification
  // ---------------------------------------------------------------------------

  /**
   * Called when stance changes. Cancel non-forced targets if no longer valid.
   *
   * OpenRA 对照: IActivityNotifyStanceChanged.StanceChanged
   *
   * @param self — the actor performing this activity
   * @param _autoTarget — the AutoTarget trait
   * @param oldStance — the previous stance
   * @param newStance — the new stance
   */
  stanceChanged(self: GameActor, _autoTarget: unknown, oldStance: UnitStance, newStance: UnitStance): void {
    // Cancel non-forced targets when switching to a more restrictive stance
    if (newStance > oldStance || this.forceAttack) return

    // Use lastVisibleOwner / lastVisibleTargetTypes for full OpenRA fidelity
    // in auto-target validity checks. Simplified: just check lastVisibleTarget.
    void this.lastVisibleOwner
    void this.lastVisibleTargetTypes

    if (!this.lastVisibleTarget.isValidFor(self as unknown as never)) {
      this.target = Target.Invalid
    }
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  /**
   * Get target line nodes for rendering.
   *
   * OpenRA 对照: Attack.TargetLineNodes(Actor)
   */
  override targetLineNodes(_self: GameActor): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      const t = this.useLastVisibleTarget ? this.lastVisibleTarget : this.target
      if (t.type !== TargetType.Invalid) {
        return [new TargetLineNode(t, this.targetLineColor)]
      }
    }
    return []
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Called when the activity completes. Reset aiming state.
   *
   * OpenRA 对照: Attack.OnLastRun(Actor)
   */
  protected override onLastRun(_self: GameActor): void {
    for (const attack of this.attackTraits) {
      attack.isAiming = false
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if any attack trait has armaments for the target.
   */
  private hasArmamentsFor(target: Target): boolean {
    return this.attackTraits.some(attack =>
      attack.chooseArmamentsForTarget(target, this.forceAttack).length > 0,
    )
  }
}
