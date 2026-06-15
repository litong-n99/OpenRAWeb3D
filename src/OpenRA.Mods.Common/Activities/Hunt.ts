/**
 * Hunt.ts — 搜索并攻击最近敌人的活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Hunt.cs
 *
 * 核心范式转换:
 * - C# Hunt activity with LINQ queries → TypeScript array filter + reduce
 * - C# AttackBase.HasAnyValidWeapons → reuse Ch8 AttackBase trait
 * - C# IMove.MoveWithinRange → duck-typed IMove.moveWithinRange
 * - C# AttackMoveActivity → reuse existing AttackMoveActivity.ts
 * - C# Wait(25) → new Wait activity (TODO-14.F.1, stub inline for now)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import type { AttackBase } from '../Traits/Attack/AttackBase.js'
import { AttackMoveActivity } from './Move/AttackMoveActivity.js'

// ---------------------------------------------------------------------------
// Hunt
// ---------------------------------------------------------------------------

/**
 * Search for the nearest enemy and attack it.
 *
 * OpenRA 对照: Hunt activity
 *
 * Scans the world for actors that:
 * - Are not the hunter itself
 * - Are alive and in the world
 * - Appear hostile to the hunter
 * - Are targetable by the hunter
 * - Have valid weapons against them
 *
 * If a target is found, queues an AttackMoveActivity toward it.
 * If no targets are found, returns true (activity completes).
 *
 * NOTE: This is a simplified Phase B implementation. Full Hunt with
 * pathfinding-based "closest with path" is deferred to Phase E.
 */
export class Hunt extends Activity {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Duck-typed IMove trait reference. */
  private readonly move: {
    moveWithinRange(source: GameActor, target: Target, range: WDist, initialTarget?: Target): Activity
  } | null

  /** Duck-typed AttackBase trait reference. */
  private readonly attack: AttackBase | null

  /** Cached list of potential targets (evaluated once in constructor). */
  private readonly targets: unknown[]

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a Hunt activity.
   *
   * OpenRA 对照: Hunt(Actor)
   *
   * @param self — the actor hunting for enemies
   */
  constructor(self: GameActor) {
    super()

    const actorAny = self as unknown as {
      traits?: Map<string, unknown>
      world?: { actors?: Iterable<unknown> }
      actorId?: number
      isDead?: boolean
      isInWorld?: boolean
      appearsHostileTo?: (other: unknown) => boolean
      isTargetableBy?: (other: unknown) => boolean
    }

    // Resolve IMove trait
    this.move = (actorAny.traits?.get('Mobile') ?? actorAny.traits?.get('Aircraft') ?? null) as Hunt['move']

    // Resolve AttackBase trait
    this.attack = (actorAny.traits?.get('attackBase') ?? null) as AttackBase | null

    // Collect potential targets
    this.targets = []
    if (actorAny.world?.actors) {
      for (const a of actorAny.world.actors) {
        const other = a as typeof actorAny
        // Skip self
        if (other.actorId === actorAny.actorId) continue
        // Skip dead or not in world
        if (other.isDead || !other.isInWorld) continue
        // Skip non-hostile
        if (!actorAny.appearsHostileTo?.(a)) continue
        // Skip not targetable
        if (!other.isTargetableBy?.(self as unknown as never)) continue

        this.targets.push(a)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /**
   * Search for nearest enemy and queue attack.
   *
   * OpenRA 对照: Hunt.Tick(Actor)
   *
   * Returns true immediately if canceling.
   * Finds the closest valid enemy, queues AttackMoveActivity + Wait.
   * Returns false to let the child activities run.
   * Returns true if no enemies are found.
   *
   * @param self — the actor hunting for enemies
   * @returns true if complete (no targets), false to continue
   */
  override tick(self: GameActor): boolean {
    if (this.isCanceling) return true

    // Find the closest target
    const closest = this.findClosestTarget(self)
    if (closest === null) return true

    // Queue AttackMoveActivity to move within 2 cells of the target, followed
    // by a short wait to match OpenRA's Hunt.Tick behavior.
    if (this.move !== null) {
      const target = Target.fromActor(closest as never)
      const moveActivity = this.move.moveWithinRange(
        self,
        target,
        WDist.fromCells(2),
      )
      this.queueChild(new AttackMoveActivity(self, () => moveActivity))
      this.queueChild(new Wait(25))
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Find the closest valid target to the hunter.
   *
   * OpenRA 对照: targets.ClosestToWithPathFrom(self)
   *
   * Simplified: uses straight-line distance (no pathfinding).
   * Full implementation with path-based distance is deferred to Phase E
   * (TODO-14.E.2) when the full pathfinding integration is available.
   *
   * @param self — the actor performing the hunt
   * @returns the closest target, or null if none
   */
  private findClosestTarget(self: GameActor): unknown | null {
    if (this.targets.length === 0) return null
    if (this.attack === null) return null

    const selfPos = (self as unknown as { centerPosition?: { X: number; Y: number; Z: number } }).centerPosition
    if (!selfPos) return null

    let closest: unknown | null = null
    let closestDistSq = Infinity

    for (const target of this.targets) {
      const targetActor = target as { centerPosition?: { X: number; Y: number; Z: number } }
      const targetPos = targetActor.centerPosition
      if (!targetPos) continue

      // Check if we have any valid weapons against this target
      const targetObj = Target.fromActor(target as never)
      if (!this.attack.hasAnyValidWeapons(targetObj)) continue

      // Distance check (XZ plane only, like OpenRA)
      const dx = targetPos.X - selfPos.X
      const dy = targetPos.Y - selfPos.Y
      const distSq = dx * dx + dy * dy

      if (distSq < closestDistSq) {
        closestDistSq = distSq
        closest = target
      }
    }

    return closest
  }
}

// ---------------------------------------------------------------------------
// Wait helper (minimal inline stub until Phase F)
// ---------------------------------------------------------------------------

/**
 * Minimal wait activity that does nothing for a fixed number of ticks.
 *
 * OpenRA 对照: Wait(ticks)
 *
 * TODO-14.F.1: Replace with the full Wait activity when Phase F is migrated.
 */
class Wait extends Activity {
  private remainingTicks: number

  constructor(ticks: number) {
    super()
    this.remainingTicks = ticks
  }

  override tick(): boolean {
    if (this.remainingTicks <= 0) return true
    this.remainingTicks--
    return false
  }
}
