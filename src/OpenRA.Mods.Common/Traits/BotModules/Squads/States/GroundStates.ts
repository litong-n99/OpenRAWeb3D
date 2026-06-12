/**
 * GroundStates.ts — ground unit squad state implementations
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/Squads/States/GroundStates.cs
 *
 * 核心范式转换:
 * - C# sealed class GroundUnitsIdleState : GroundStateBase, IState
 *   → TypeScript class GroundUnitsIdleState extends GroundStateBase implements IState
 * - C# LINQ → TypeScript for-loops (PERF: no allocation)
 * - IState.tick() returns boolean: true = transition, false = keep running
 * - C# MersenneTwister → SimplePrng
 */

import { StateBase } from './StateBase.js'
import type { IState } from '../StateMachine.js'
import type { Squad } from '../Squad.js'
import { AttackOrFleeFuzzy, type ActorLike as FuzzyActorLike } from '../AttackOrFleeFuzzy.js'

// ---------------------------------------------------------------------------
// ActorLike — minimal duck-type for actors used in ground states
// ---------------------------------------------------------------------------

interface ActorLike {
  readonly actorId: number
  readonly isDead: boolean
  readonly isInWorld: boolean
  readonly isIdle: boolean
  readonly centerPosition: { x: number; y: number; z: number }
  readonly location: { x: number; y: number }
  readonly owner: unknown
  readonly info?: { readonly name: string; hasTraitInfo?: (name: string) => boolean }
  traitsImplementing?: <T>(name: string) => T[]
  getEnabledTargetTypes?: () => { isEmpty: boolean }
  currentActivity?: ActivityLike | null
  canBeViewedByPlayer?: (player: unknown) => boolean
  health?: { maxHP: number; hp: number }
  attackPower?: unknown
  speed?: number
  hasAttackBase?: boolean
}

interface ActivityLike {
  activitiesImplementing?: (name: string) => unknown[]
  nextActivity?: ActivityLike | null
  getType?: () => string
}

// ---------------------------------------------------------------------------
// GroundStateBase — shared helpers for ground states (对应 OpenRA GroundStateBase)
// ---------------------------------------------------------------------------

abstract class GroundStateBase extends StateBase {
  protected _leader: ActorLike | null = null

  protected leader(owner: Squad): ActorLike | null {
    if (this._leader) {
      for (const u of owner.units) {
        if ((u as unknown as ActorLike).actorId === this._leader.actorId) {
          return this._leader
        }
      }
    }
    this._leader = this.newLeader(owner)
    return this._leader
  }

  private newLeader(owner: Squad): ActorLike | null {
    const units: ActorLike[] = []
    for (const u of owner.units) units.push(u as unknown as ActorLike)
    if (units.length === 0) return null

    let minTerrainCount = 2147483647
    const candidates: ActorLike[] = []
    for (const a of units) {
      const mobile = a.traitsImplementing?.('Mobile')?.[0] as { locomotor?: { info?: { terrainSpeeds?: { size: number } } } } | undefined
      const tc = mobile?.locomotor?.info?.terrainSpeeds?.size ?? -1
      if (tc >= 0 && tc < minTerrainCount) {
        minTerrainCount = tc
        candidates.length = 0
        candidates.push(a)
      } else if (tc === minTerrainCount) {
        candidates.push(a)
      }
    }

    if (candidates.length === 0) return units[0]

    let sx = 0, sy = 0, sz = 0
    for (const a of candidates) { sx += a.centerPosition.x; sy += a.centerPosition.y; sz += a.centerPosition.z }
    const cx = (sx / candidates.length) | 0, cy = (sy / candidates.length) | 0, cz = (sz / candidates.length) | 0

    let best = candidates[0]
    let bestDistSq = 2147483647
    for (const a of candidates) {
      const dx = a.centerPosition.x - cx, dy = a.centerPosition.y - cy, dz = a.centerPosition.z - cz
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestDistSq) { bestDistSq = d; best = a }
    }
    return best
  }

  protected shouldFlee(owner: Squad): boolean {
    return StateBase.shouldFlee(owner, (enemies) =>
      !AttackOrFleeFuzzy.default.canAttack(this.squadUnitsAsFuzzy(owner), enemies as unknown as FuzzyActorLike[]))
  }

  protected newLeaderAndFindClosestEnemy(
    owner: Squad,
  ): { actor: ActorLike | null; offset: { x: number; y: number; z: number } } {
    this._leader = null
    const lead = this.leader(owner)
    if (!lead) return { actor: null, offset: { x: 0, y: 0, z: 0 } }
    const mgr = owner.squadManager as unknown as { findClosestEnemyForSquad?: (e: readonly ActorLike[], s: ActorLike) => { actor: ActorLike | null; offset: { x: number; y: number; z: number } } }
    return mgr.findClosestEnemyForSquad?.([], lead) ?? { actor: null, offset: { x: 0, y: 0, z: 0 } }
  }

  protected squadUnitsAsFuzzy(squad: Squad): FuzzyActorLike[] {
    const result: FuzzyActorLike[] = []
    for (const unit of squad.units) {
      const u = unit as unknown as ActorLike
      result.push({ health: u.health, attackPower: u.attackPower as FuzzyActorLike['attackPower'], speed: u.speed, hasAttackBase: u.hasAttackBase })
    }
    return result
  }

  protected actorsAsFuzzy(actors: readonly ActorLike[]): FuzzyActorLike[] {
    return actors.map(a => ({ health: a.health, attackPower: a.attackPower as FuzzyActorLike['attackPower'], speed: a.speed, hasAttackBase: a.hasAttackBase }))
  }

}

// ---------------------------------------------------------------------------
// GroundUnitsIdleState (对应 OpenRA GroundUnitsIdleState)
// ---------------------------------------------------------------------------

export class GroundUnitsIdleState extends GroundStateBase implements IState {
  activate(_owner: Squad): void { }

  tick(owner: Squad): boolean {
    if (!owner.isValid) return false

    const lead = this.leader(owner)
    if (!lead) return false

    if (!owner.isTargetValid(lead as unknown as Parameters<Squad['isTargetValid']>[0])) {
      const closestEnemy = owner.squadManager.findClosestEnemyForSquad?.(
        [], lead,
      ) ?? { actor: null, offset: { x: 0, y: 0, z: 0 } }
      if (closestEnemy.actor) {
        owner.setActorToTarget(closestEnemy as unknown as Parameters<typeof owner.setActorToTarget>[0])
      } else {
        const ce = this.newLeaderAndFindClosestEnemy(owner)
        if (ce.actor) owner.setActorToTarget(ce as unknown as Parameters<typeof owner.setActorToTarget>[0])
        if (!ce.actor) return false
      }
    }

    const scanRadius = (owner.squadManager as unknown as { info: { idleScanRadius: number } }).info.idleScanRadius
    const center = lead.centerPosition
    const w = (owner.squadManager as unknown as { world?: { findActorsInCircle?: (pos: unknown, radius: unknown) => ActorLike[] } }).world
    const nearby = w?.findActorsInCircle?.(center, { length: scanRadius * 1024 }) ?? []

    const enemyUnits: ActorLike[] = []
    const mgr = owner.squadManager as unknown as { isPreferredEnemyUnit?: (a: ActorLike) => boolean }
    for (const a of nearby) { if (mgr.isPreferredEnemyUnit?.(a)) enemyUnits.push(a) }
    if (enemyUnits.length === 0) return false

    const canAttack = AttackOrFleeFuzzy.default.canAttack(
      this.squadUnitsAsFuzzy(owner), this.actorsAsFuzzy(enemyUnits),
    )

    if (canAttack) {
      owner.fuzzyStateMachine.changeState(owner, new GroundUnitsAttackMoveState())
    } else {
      owner.fuzzyStateMachine.changeState(owner, new GroundUnitsFleeState())
    }
    return false
  }

  deactivate(_owner: Squad): void { }
}

// ---------------------------------------------------------------------------
// GroundUnitsAttackMoveState (对应 OpenRA GroundUnitsAttackMoveState)
// ---------------------------------------------------------------------------

export class GroundUnitsAttackMoveState extends GroundStateBase implements IState {
  private _lastUpdatedTick: number = 0
  private _lastLeaderLocation: { x: number; y: number } | null = null
  private _lastTarget: unknown = null

  activate(_owner: Squad): void { this._lastUpdatedTick = 0; this._lastLeaderLocation = null; this._lastTarget = null }

  tick(owner: Squad): boolean {
    if (!owner.isValid) return false

    const lead = this.leader(owner)
    if (!lead) return false

    if (!owner.isTargetValid(lead as unknown as Parameters<Squad['isTargetValid']>[0])) {
      const ce = this.newLeaderAndFindClosestEnemy(owner)
      if (!ce.actor) {
        owner.fuzzyStateMachine.changeState(owner, new GroundUnitsFleeState())
        return false
      }
      owner.setActorToTarget(ce as unknown as Parameters<typeof owner.setActorToTarget>[0])
    }

    const newLead = this.leader(owner)!
    if (this._lastLeaderLocation && (newLead.location.x !== this._lastLeaderLocation.x || newLead.location.y !== this._lastLeaderLocation.y)) {
      this._lastLeaderLocation = newLead.location
      this._lastUpdatedTick = this.getWorldTick2(owner)
    }
    if (!this._lastLeaderLocation) this._lastLeaderLocation = newLead.location

    if (owner.targetActor !== this._lastTarget) {
      this._lastTarget = owner.targetActor
      this._lastUpdatedTick = this.getWorldTick2(owner)
    }

    if (this.getWorldTick2(owner) > this._lastUpdatedTick + 63) {
      owner.fuzzyStateMachine.changeState(owner, new GroundUnitsIdleState())
      return false
    }

    const leadPos = lead.centerPosition
    const cohesionRadius = owner.units.size / 3
    const w = (owner.squadManager as unknown as { world?: { findActorsInCircle?: (pos: unknown, radius: number) => ActorLike[] } }).world
    const nearby = w?.findActorsInCircle?.(leadPos, cohesionRadius * 1024) ?? []
    const nearbyIds = new Set(nearby.map(a => a.actorId))

    let ownUnitsNearby = 0
    for (const u of owner.units) { if (nearbyIds.has((u as unknown as ActorLike).actorId)) ownUnitsNearby++ }

    const bot = owner.bot as unknown as { queueOrder: (order: unknown) => void }
    if (ownUnitsNearby < owner.units.size) {
      bot.queueOrder({ orderName: 'Stop', subjectActor: lead.actorId } as unknown as Parameters<typeof bot.queueOrder>[0])
    } else {
      const mgr2 = owner.squadManager as unknown as { findClosestEnemyForSquad?: (e: readonly ActorLike[], s: ActorLike) => { actor: ActorLike | null; offset: { x: number; y: number; z: number } }; info: { attackScanRadius: number } }
      const ce = mgr2.findClosestEnemyForSquad?.([], lead)
      if (ce?.actor) {
        owner.setActorToTarget(ce as unknown as Parameters<typeof owner.setActorToTarget>[0])
        owner.fuzzyStateMachine.changeState(owner, new GroundUnitsAttackState())
      }
    }

    if (this.shouldFlee(owner)) {
      owner.fuzzyStateMachine.changeState(owner, new GroundUnitsFleeState())
    }
    return false
  }

  deactivate(_owner: Squad): void { }

  private getWorldTick2(squad: Squad): number {
    return (squad.squadManager as unknown as { worldTick?: number }).worldTick ?? 0
  }
}

// ---------------------------------------------------------------------------
// GroundUnitsAttackState (对应 OpenRA GroundUnitsAttackState)
// ---------------------------------------------------------------------------

export class GroundUnitsAttackState extends GroundStateBase implements IState {
  private _lastUpdatedTick: number = 0
  private _lastLeaderLocation: { x: number; y: number } | null = null
  private _lastTarget: unknown = null

  activate(_owner: Squad): void { this._lastUpdatedTick = 0; this._lastLeaderLocation = null; this._lastTarget = null }

  tick(owner: Squad): boolean {
    if (!owner.isValid) return false

    const lead = this.leader(owner)
    if (!lead) return false

    if (!owner.isTargetValid(lead as unknown as Parameters<Squad['isTargetValid']>[0])) {
      const ce = this.newLeaderAndFindClosestEnemy(owner)
      if (!ce.actor) {
        owner.fuzzyStateMachine.changeState(owner, new GroundUnitsFleeState())
        return false
      }
      owner.setActorToTarget(ce as unknown as Parameters<typeof owner.setActorToTarget>[0])
    }

    const newLead = this.leader(owner)!
    if (this._lastLeaderLocation && (newLead.location.x !== this._lastLeaderLocation.x || newLead.location.y !== this._lastLeaderLocation.y)) {
      this._lastLeaderLocation = newLead.location
      this._lastUpdatedTick = this.getWorldTick3(owner)
    }
    if (!this._lastLeaderLocation) this._lastLeaderLocation = newLead.location

    if (owner.targetActor !== this._lastTarget) {
      this._lastTarget = owner.targetActor
      this._lastUpdatedTick = this.getWorldTick3(owner)
    }

    if (this.getWorldTick3(owner) > this._lastUpdatedTick + 63) {
      owner.fuzzyStateMachine.changeState(owner, new GroundUnitsIdleState())
      return false
    }

    const bot = owner.bot as unknown as { queueOrder: (order: unknown) => void }
    for (const unit of owner.units) {
      const u = unit as unknown as ActorLike
      if (StateBase.busyAttack(u)) continue
      bot.queueOrder({ orderName: 'AttackMove', subjectActor: u.actorId, targetPosition: owner.target.centerPosition } as unknown as Parameters<typeof bot.queueOrder>[0])
    }

    if (this.shouldFlee(owner)) {
      owner.fuzzyStateMachine.changeState(owner, new GroundUnitsFleeState())
    }
    return false
  }

  deactivate(_owner: Squad): void { }

  private getWorldTick3(squad: Squad): number {
    return (squad.squadManager as unknown as { worldTick?: number }).worldTick ?? 0
  }
}

// ---------------------------------------------------------------------------
// GroundUnitsFleeState (对应 OpenRA GroundUnitsFleeState)
// ---------------------------------------------------------------------------

export class GroundUnitsFleeState extends GroundStateBase implements IState {
  activate(_owner: Squad): void { }

  tick(owner: Squad): boolean {
    if (!owner.isValid) return false
    StateBase.goToRandomOwnBuilding(owner)
    owner.fuzzyStateMachine.changeState(owner, new GroundUnitsIdleState())
    return false
  }

  deactivate(owner: Squad): void {
    const mgr = owner.squadManager as unknown as { unregisterSquad?: (s: Squad) => void }
    mgr.unregisterSquad?.(owner)
  }
}
