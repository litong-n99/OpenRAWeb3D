/**
 * StateBase.ts — abstract base class for squad state implementations
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/Squads/States/StateBase.cs
 *
 * 核心范式转换:
 * - C# abstract class StateBase → TypeScript abstract class StateBase
 * - C# static helper methods → TypeScript static methods
 * - C# LINQ (Where, Any, MinByOrDefault, etc.) → TypeScript for-loops (PERF: no LINQ)
 * - C# MersenneTwister → SimplePrng
 *
 * StateBase provides common utility functions used by concrete state implementations:
 * - GoToRandomOwnBuilding / RandomBuildingLocation — return to base
 * - BusyAttack / CanAttackTarget / ShouldFlee — combat assessment
 * - IsRearming / FullAmmo / HasAmmo / ReloadsAutomatically — ammo management
 *
 * NOTE: Concrete state implementations (GroundAttackState, AirIdleState, etc.)
 * are deferred to Phase E. Phase D includes this abstract base and stub states.
 */

import type { Squad } from '../Squad.js'

// ---------------------------------------------------------------------------
// ActorLike — minimal duck-type interface for all actor accesses
// ---------------------------------------------------------------------------

interface ActorLike {
  owner: unknown
  isIdle: boolean
  isDead: boolean
  isInWorld: boolean
  location: { x: number; y: number }
  centerPosition: { x: number; y: number; z: number }
  actorId: number
  currentActivity?: ActivityLike | null
  info?: { name: string; hasTraitInfo?: (name: string) => boolean }
  getEnabledTargetTypes?: () => { isEmpty: boolean; overlaps?: (other: unknown) => boolean }
  traitsImplementing?: (interfaceName: string) => unknown[]
  canBeViewedByPlayer?: (player: unknown) => boolean
}

interface ActivityLike {
  activitiesImplementing?: (interfaceName: string) => unknown[]
  nextActivity?: ActivityLike | null
  getType?: () => string
}

// ---------------------------------------------------------------------------
// StateBase
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all squad state implementations.
 *
 * OpenRA 对照: abstract class StateBase
 *
 * Provides static helper methods used by concrete states.
 * Concrete states override `tick()` to implement specific behavior.
 */
export abstract class StateBase {
  // -----------------------------------------------------------------------
  // Movement helpers (对应 OpenRA GoToRandomOwnBuilding / RandomBuildingLocation)
  // -----------------------------------------------------------------------

  /**
   * Order all units in the squad to move to a random friendly building.
   *
   * OpenRA 对照: StateBase.GoToRandomOwnBuilding(Squad)
   */
  protected static goToRandomOwnBuilding(squad: Squad): void {
    const loc = StateBase.randomBuildingLocation(squad)
    for (const _unit of squad.units) {
      squad.bot.queueOrder({
        orderName: 'Move',
        targetString: `${loc.x},${loc.y}`,
        extraData: 0,
      } as unknown as Parameters<typeof squad.bot.queueOrder>[0])
    }
  }

  /**
   * Pick a random friendly building location.
   *
   * OpenRA 对照: StateBase.RandomBuildingLocation(Squad)
   */
  protected static randomBuildingLocation(squad: Squad): { x: number; y: number } {
    const location = squad.squadManager.getRandomBaseCenter()
    // Access world through squadManager for building lookup
    const mgr = squad.squadManager as unknown as {
      world?: { getActorsHavingTrait?: (name: string) => ActorLike[] }
    }
    const buildings = mgr.world?.getActorsHavingTrait?.('Building') ?? []
    const ownBuildings = buildings.filter(
      (b: ActorLike) => b.owner === squad.bot.player,
    )

    if (ownBuildings.length > 0) {
      const idx = squad.random.nextIntRange(0, ownBuildings.length - 1)
      return ownBuildings[idx].location
    }

    return location
  }

  // -----------------------------------------------------------------------
  // Combat assessment helpers (对应 OpenRA BusyAttack / CanAttackTarget)
  // -----------------------------------------------------------------------

  /**
   * Check if an actor is currently busy attacking.
   *
   * OpenRA 对照: StateBase.BusyAttack(Actor)
   */
  protected static busyAttack(a: ActorLike): boolean {
    if (a.isIdle) return false

    const activity = a.currentActivity
    if (!activity) return false

    const type = activity.getType?.()
    if (type === 'Attack' || type === 'FlyAttack') return true

    const next = activity.nextActivity
    if (!next) return false

    const nextType = next.getType?.()
    return nextType === 'Attack' || nextType === 'FlyAttack'
  }

  /**
   * Check if an actor can attack a target.
   *
   * OpenRA 对照: StateBase.CanAttackTarget(Actor, Actor)
   */
  protected static canAttackTarget(a: ActorLike, target: ActorLike): boolean {
    if (!a.info?.hasTraitInfo?.('AttackBase')) return false

    const targetTypes = target.getEnabledTargetTypes?.()
    if (!targetTypes || targetTypes.isEmpty) return false

    const arms = a.traitsImplementing?.('Armament') ?? []
    for (const arm of arms) {
      const armLike = arm as { isTraitDisabled?: boolean; weapon?: { isValidTarget?: (types: unknown) => boolean } }
      if (armLike.isTraitDisabled) continue
      if (armLike.weapon?.isValidTarget?.(targetTypes)) return true
    }

    return false
  }

  // -----------------------------------------------------------------------
  // Flee decision (对应 OpenRA StateBase.ShouldFlee)
  // -----------------------------------------------------------------------

  /**
   * Determine if the squad should flee based on nearby threats.
   *
   * OpenRA 对照: StateBase.ShouldFlee(Squad, Func<List<Actor>, bool>)
   */
  protected static shouldFlee(
    squad: Squad,
    fleePredicate: (enemies: ActorLike[]) => boolean,
  ): boolean {
    if (!squad.isValid) return false

    const dangerRadius = squad.squadManager.info.dangerScanRadius
    const centerPos = squad.centerPosition()

    // Access world through squadManager
    const mgr = squad.squadManager as unknown as {
      world?: { findActorsInCircle?: (pos: unknown, radius: unknown) => ActorLike[] }
    }
    const units = mgr.world?.findActorsInCircle?.(
      centerPos,
      { length: dangerRadius * 1024 },
    ) ?? []

    // If any own buildings within DangerRadius, don't flee
    for (const u of units) {
      if (u.owner === squad.bot.player && u.info?.hasTraitInfo?.('Building')) {
        return false
      }
    }

    // Collect nearby enemies with AttackBase
    const enemyAroundUnit: ActorLike[] = []
    for (const unit of units) {
      if (
        squad.squadManager.isPreferredEnemyUnit(unit) &&
        unit.info?.hasTraitInfo?.('AttackBase')
      ) {
        enemyAroundUnit.push(unit)
      }
    }

    if (enemyAroundUnit.length === 0) return false

    return fleePredicate(enemyAroundUnit)
  }

  // -----------------------------------------------------------------------
  // Ammo management helpers (对应 OpenRA IsRearming / FullAmmo / HasAmmo /
  //                                     ReloadsAutomatically)
  // -----------------------------------------------------------------------

  /**
   * Check if an actor is currently rearming.
   *
   * OpenRA 对照: StateBase.IsRearming(Actor)
   */
  protected static isRearming(a: ActorLike): boolean {
    if (a.isIdle) return false
    const activity = a.currentActivity
    if (!activity) return false

    const resupply = activity.activitiesImplementing?.('Resupply') ?? []
    const returnToBase = activity.activitiesImplementing?.('ReturnToBase') ?? []
    return resupply.length > 0 || returnToBase.length > 0
  }

  /**
   * Check if all ammo pools are full.
   *
   * OpenRA 对照: StateBase.FullAmmo(IEnumerable<AmmoPool>)
   */
  protected static fullAmmo(ammoPools: { hasFullAmmo: boolean }[]): boolean {
    for (const ap of ammoPools) {
      if (!ap.hasFullAmmo) return false
    }
    return true
  }

  /**
   * Check if all ammo pools have ammo.
   *
   * OpenRA 对照: StateBase.HasAmmo(IEnumerable<AmmoPool>)
   */
  protected static hasAmmo(ammoPools: { hasAmmo: boolean }[]): boolean {
    for (const ap of ammoPools) {
      if (!ap.hasAmmo) return false
    }
    return true
  }

  /**
   * Check if ammo pools reload automatically (without needing a rearm actor).
   *
   * OpenRA 对照: StateBase.ReloadsAutomatically(IEnumerable<AmmoPool>, Rearmable)
   */
  protected static reloadsAutomatically(
    ammoPools: { info: { name: string } }[],
    rearmable: { info: { ammoPools: string[] } } | null,
  ): boolean {
    if (!rearmable) return true

    for (const ap of ammoPools) {
      if (!rearmable.info.ammoPools.includes(ap.info.name)) return false
    }
    return true
  }
}
