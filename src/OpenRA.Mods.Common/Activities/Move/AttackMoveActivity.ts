/**
 * AttackMoveActivity.ts — 攻击移动活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/AttackMoveActivity.cs
 *
 * 核心范式转换:
 * - C# Func<Activity> getMove → TypeScript () => Activity callback
 * - C# AutoTarget/AttackMove trait access → TypeScript type assertions
 * - C# Actor.GrantCondition/RevokeCondition → GameActor.grantCondition/revokeCondition
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// AttackMoveActivity
// ---------------------------------------------------------------------------

/**
 * Attack-move activity: move toward a destination while scanning for and
 * attacking enemies along the way.
 *
 * OpenRA 对照: AttackMoveActivity
 *
 * Interleaves movement with combat. When an enemy is spotted, the current
 * move is cancelled and attack activities are queued. After combat completes,
 * movement resumes.
 */
export class AttackMoveActivity extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  readonly getMove: () => Activity
  readonly isAssaultMove: boolean

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  private runningMoveActivity: boolean = false
  private token: number = -1
  private target: Target = Target.Invalid

  private readonly autoTarget: {
    scanForTarget: (self: GameActor, allowMove: boolean, allowAttack: boolean, immediate: boolean) => Target
    allowMove: boolean
    activeAttackBases: { getAttackActivity: (self: GameActor, source: number, target: Target, allowMove: boolean, forceAttack: boolean) => Activity }[]
  } | null

  private readonly attackMove: {
    info: { assaultMoveCondition: string; attackMoveCondition: string }
  } | null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(
    self: GameActor,
    getMove: () => Activity,
    assaultMoving: boolean = false,
  ) {
    super()
    this.getMove = getMove
    this.isAssaultMove = assaultMoving
    this.childHasPriority = false

    const traits = (self as unknown as { traits: Map<string, unknown> }).traits
    this.autoTarget = traits.get('AutoTarget') as {
      scanForTarget: (self: GameActor, allowMove: boolean, allowAttack: boolean, immediate: boolean) => Target
      allowMove: boolean
      activeAttackBases: { getAttackActivity: (self: GameActor, source: number, target: Target, allowMove: boolean, forceAttack: boolean) => Activity }[]
    } | null ?? null
    this.attackMove = traits.get('AttackMove') as {
      info: { assaultMoveCondition: string; attackMoveCondition: string }
    } | null ?? null
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  protected override onFirstRun(self: GameActor): void {
    if (this.attackMove === null || this.autoTarget === null) {
      this.queueChild(this.getMove())
      return
    }

    const condition = this.isAssaultMove
      ? this.attackMove.info.assaultMoveCondition
      : this.attackMove.info.attackMoveCondition

    const grant = (self as unknown as { grantCondition?: (c: string) => number }).grantCondition
    if (grant) {
      this.token = grant(condition)
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    if (this.isCanceling || this.attackMove === null || this.autoTarget === null)
      return this.tickChild(self)

    // Not attacking — scan for targets
    const ca = this.childActivity
    if (ca === null || this.runningMoveActivity) {
      // Scan for target (override rate limit if attack just finished)
      this.target = this.autoTarget.scanForTarget(
        self,
        this.autoTarget.allowMove,
        true,
        !this.runningMoveActivity,
      )

      // Found a target — cancel move and attack
      if (this.target.type !== 0) { // Invalid = 0
        this.runningMoveActivity = false
        if (ca !== null) ca.cancel(self)

        for (const ab of this.autoTarget.activeAttackBases) {
          this.queueChild(ab.getAttackActivity(self, 1, this.target, this.autoTarget.allowMove, false))
        }
      }

      // No targets — continue/queue move
      if (this.childActivity === null) {
        this.runningMoveActivity = true
        this.queueChild(this.getMove())
      }
    }

    // Move finished = destination reached, no more enemies
    return this.tickChild(self) && this.runningMoveActivity
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  protected override onLastRun(self: GameActor): void {
    if (this.token !== -1) {
      const revoke = (self as unknown as { revokeCondition?: (t: number) => number }).revokeCondition
      if (revoke) {
        this.token = revoke(this.token)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  override getTargets(_self: GameActor): Target[] {
    const ca = this.childActivity
    if (ca !== null) return ca.getTargets(_self)
    return []
  }

  override targetLineNodes(_self: GameActor): import('../../../OpenRA.Game/Activities/Activity.js').TargetLineNode[] {
    // Delegate to the move activity
    const move = this.getMove()
    return move.targetLineNodes(_self)
  }
}
