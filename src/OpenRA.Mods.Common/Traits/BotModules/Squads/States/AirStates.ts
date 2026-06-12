/**
 * AirStates.ts — air unit squad state implementations
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/Squads/States/AirStates.cs
 *
 * 核心范式转换:
 * - C# sealed class AirIdleState : AirStateBase, IState → TypeScript class implements IState
 * - C# LINQ → TypeScript for-loops (PERF)
 * - IState.tick() returns boolean: true = transition, false = keep running
 * - C# MersenneTwister → SimplePrng
 */

import { StateBase } from './StateBase.js'
import type { IState } from '../StateMachine.js'
import type { Squad } from '../Squad.js'
import type { SimplePrng } from '../Squad.js'

// ---------------------------------------------------------------------------
// ActorLike — duck-type for air states
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
  getEnabledTargetTypes?: () => { isEmpty: boolean; overlaps?: (other: unknown) => boolean }
  currentActivity?: ActivityLike | null
  canBeViewedByPlayer?: (player: unknown) => boolean
}

interface ActivityLike {
  activitiesImplementing?: (name: string) => unknown[]
  nextActivity?: ActivityLike | null
  getType?: () => string
}

// ---------------------------------------------------------------------------
// AirStateBase — shared helpers
// ---------------------------------------------------------------------------

abstract class AirStateBase extends StateBase {
  protected static readonly MISSILE_UNIT_MULTIPLIER = 3

  protected static countAntiAirUnits(owner: Squad, units: readonly ActorLike[]): number {
    if (units.length === 0) return 0
    let count = 0
    for (const unit of units) {
      if (!unit || unit.info?.hasTraitInfo?.('Aircraft')) continue
      const attackBases = unit.traitsImplementing?.('AttackBase') ?? []
      for (const ab of attackBases) {
        const attack = ab as { isTraitDisabled?: boolean; isTraitPaused?: boolean; armaments?: { weapon?: { isValidTarget?: (type: unknown) => boolean } }[] }
        if (attack.isTraitDisabled || attack.isTraitPaused) continue
        const armaments = attack.armaments ?? []
        for (const arm of armaments) {
          const mgrInfo = owner.squadManager as unknown as { info: { aircraftTargetType?: { contains: (v: number) => boolean } } }
          if (arm.weapon?.isValidTarget?.(mgrInfo.info.aircraftTargetType)) { count++; break }
        }
      }
    }
    return count
  }

  protected static nearToPosSafely(
    owner: Squad,
    loc: { x: number; y: number; z: number },
    outDetectedEnemy?: { target: ActorLike | null },
  ): boolean {
    if (outDetectedEnemy) outDetectedEnemy.target = null
    const mgr = owner.squadManager as unknown as {
      info: { dangerScanRadius: number }
      isPreferredEnemyUnit?: (a: ActorLike) => boolean
      world?: { findActorsInCircle?: (pos: unknown, radius: unknown) => ActorLike[] }
    }
    const dangerRadius = mgr.info.dangerScanRadius
    const unitsAround = mgr.world?.findActorsInCircle?.(loc, { length: dangerRadius * 1024 }) ?? []
    const enemyUnits: ActorLike[] = []
    for (const u of unitsAround) { if (mgr.isPreferredEnemyUnit?.(u)) enemyUnits.push(u) }
    if (enemyUnits.length === 0) return true
    if (AirStateBase.countAntiAirUnits(owner, enemyUnits) * AirStateBase.MISSILE_UNIT_MULTIPLIER < owner.units.size) {
      if (outDetectedEnemy && enemyUnits.length > 0) {
        outDetectedEnemy.target = enemyUnits[owner.random.nextIntRange(0, enemyUnits.length - 1)]
      }
      return true
    }
    return false
  }

  protected static shouldFleeAir(owner: Squad): boolean {
    if (!owner.isValid) return false
    const dangerRadius = (owner.squadManager as unknown as { info: { dangerScanRadius: number } }).info.dangerScanRadius
    const center = owner.centerPosition()
    const mgr = owner.squadManager as unknown as {
      world?: { findActorsInCircle?: (pos: unknown, radius: unknown) => ActorLike[] }
      isPreferredEnemyUnit?: (a: ActorLike) => boolean
    }
    const units = mgr.world?.findActorsInCircle?.(center, { length: dangerRadius * 1024 }) ?? []
    for (const u of units) {
      if (u.owner === (owner.bot.player as unknown) && u.info?.hasTraitInfo?.('Building')) return false
    }
    const enemyUnits: ActorLike[] = []
    for (const u of units) {
      if (mgr.isPreferredEnemyUnit?.(u) && u.info?.hasTraitInfo?.('AttackBase')) enemyUnits.push(u)
    }
    if (enemyUnits.length === 0) return false
    return AirStateBase.countAntiAirUnits(owner, enemyUnits) * AirStateBase.MISSILE_UNIT_MULTIPLIER > owner.units.size
  }
}

// ---------------------------------------------------------------------------
// AirIdleState
// ---------------------------------------------------------------------------

export class AirIdleState extends AirStateBase implements IState {
  private static readonly MAX_CHECK_TIMES_PER_TICK = 2
  private _airStrikeCheckIndices: number[] | null = null
  private _checkedIndex: number = 0
  private _columnCount: number = 0

  activate(owner: Squad): void {
    const mgr = owner.squadManager as unknown as { info: { dangerScanRadius: number }; world?: { map?: { bounds?: { width: number; height: number } } } }
    const dangerRadius = mgr.info.dangerScanRadius
    const dangerSideLen = ((dangerRadius * 141) / 100) | 0
    const bounds = mgr.world?.map?.bounds ?? { width: 128, height: 128 }
    this._columnCount = ((bounds.width + dangerSideLen - 1) / dangerSideLen) | 0
    const rowCount = ((bounds.height + dangerSideLen - 1) / dangerSideLen) | 0
    if (!this._airStrikeCheckIndices) {
      const total = this._columnCount * rowCount
      this._airStrikeCheckIndices = AirIdleState.shuffleIndices(total, owner.random)
    }
  }

  private static shuffleIndices(n: number, prng: SimplePrng): number[] {
    const arr: number[] = []
    for (let i = 0; i < n; i++) arr.push(i)
    for (let i = n - 1; i > 0; i--) { const j = prng.nextIntRange(0, i); const t = arr[i]; arr[i] = arr[j]; arr[j] = t }
    return arr
  }

  private findDefenselessTarget(owner: Squad): ActorLike | null {
    if (!this._airStrikeCheckIndices || this._airStrikeCheckIndices.length === 0) return null
    const position = owner.centerPosition()
    const mgr = owner.squadManager as unknown as {
      info: { dangerScanRadius: number }
      world?: { map?: { bounds?: { x: number; y: number } }; centerOfCell?: (c: { x: number; y: number }) => { x: number; y: number; z: number }; findActorsOnLine?: (s: unknown, e: unknown, r: unknown) => ActorLike[] }
    }
    const dangerRadius = mgr.info.dangerScanRadius

    for (let ct = 0; ct <= AirIdleState.MAX_CHECK_TIMES_PER_TICK; ct++, this._checkedIndex++) {
      if (this._checkedIndex >= this._airStrikeCheckIndices.length) this._checkedIndex = 0
      const idx = this._airStrikeCheckIndices[this._checkedIndex]
      const mapBounds = mgr.world?.map?.bounds ?? { x: 0, y: 0 }
      const x = (idx % this._columnCount) * dangerRadius + (dangerRadius >> 1) + mapBounds.x
      const y = ((idx / this._columnCount) | 0) * dangerRadius + (dangerRadius >> 1) + mapBounds.y
      const wpos = mgr.world?.centerOfCell?.({ x, y }) ?? { x: x * 1024, y: y * 1024, z: 0 }
      const lineActors = mgr.world?.findActorsOnLine?.(position, wpos, { length: dangerRadius * 1024 }) ?? []
      if (AirStateBase.countAntiAirUnits(owner, lineActors) * AirStateBase.MISSILE_UNIT_MULTIPLIER >= owner.units.size) continue
      const detected = { target: null as ActorLike | null }
      if (AirStateBase.nearToPosSafely(owner, wpos, detected) && detected.target) {
        this._checkedIndex = owner.random.nextIntRange(0, this._airStrikeCheckIndices.length - 1)
        return detected.target
      }
    }
    return null
  }

  tick(owner: Squad): boolean {
    if (!owner.isValid) return false
    if (AirStateBase.shouldFleeAir(owner)) {
      owner.fuzzyStateMachine.changeState(owner, new AirFleeState())
      return false
    }
    const target = this.findDefenselessTarget(owner)
    if (!target) return false
    owner.setActorToTarget({ actor: target as unknown as Parameters<typeof owner.setActorToTarget>[0] extends { actor: infer A } ? A : never, offset: { x: 0, y: 0, z: 0 } })
    owner.fuzzyStateMachine.changeState(owner, new AirAttackState())
    return false
  }

  deactivate(_owner: Squad): void { }
}

// ---------------------------------------------------------------------------
// AirAttackState
// ---------------------------------------------------------------------------

export class AirAttackState extends AirStateBase implements IState {
  activate(_owner: Squad): void { }

  tick(owner: Squad): boolean {
    if (!owner.isValid) return false
    const leader = owner.centerUnit()
    if (!leader) return false

    if (!owner.isTargetValid(leader as unknown as Parameters<Squad['isTargetValid']>[0])) {
      const mgr = owner.squadManager as unknown as { findClosestEnemyForSquad?: (e: readonly ActorLike[], s: ActorLike) => { actor: ActorLike | null; offset: { x: number; y: number; z: number } } }
      const ce = mgr.findClosestEnemyForSquad?.([], leader as unknown as ActorLike)
      if (ce?.actor) {
        owner.setActorToTarget(ce as unknown as Parameters<typeof owner.setActorToTarget>[0])
      } else {
        owner.fuzzyStateMachine.changeState(owner, new AirFleeState())
        return false
      }
    }

    const targetActor = owner.targetActor as unknown as ActorLike | null
    if (!targetActor) { owner.fuzzyStateMachine.changeState(owner, new AirFleeState()); return false }

    let closestUnit: ActorLike | null = null
    let closestDistSq = 2147483647
    for (const unit of owner.units) {
      const u = unit as unknown as ActorLike
      const dx = u.centerPosition.x - targetActor.centerPosition.x
      const dy = u.centerPosition.y - targetActor.centerPosition.y
      const dz = u.centerPosition.z - targetActor.centerPosition.z
      const d = dx * dx + dy * dy + dz * dz
      if (d < closestDistSq) { closestDistSq = d; closestUnit = u }
    }

    if (closestUnit && !AirStateBase.nearToPosSafely(owner, closestUnit.centerPosition)) {
      owner.fuzzyStateMachine.changeState(owner, new AirFleeState())
      return false
    }

    const bot = owner.bot as unknown as { queueOrder: (order: unknown) => void }
    for (const unit of owner.units) {
      const a = unit as unknown as ActorLike
      if (StateBase.busyAttack(a) || StateBase.isRearming(a)) continue

      const ammoPools = (a.traitsImplementing?.('AmmoPool') ?? []) as { hasFullAmmo?: boolean; hasAmmo?: boolean; info?: { name: string } }[]
      const rearmable = a.traitsImplementing?.('Rearmable')?.[0] as { info?: { ammoPools?: string[] } } | undefined

      if (!StateBase.reloadsAutomatically(ammoPools as { info: { name: string } }[], rearmable ? { info: { ammoPools: rearmable.info?.ammoPools ?? [] } } : null)
        && !StateBase.hasAmmo(ammoPools as { hasAmmo: boolean }[])) {
        bot.queueOrder({ orderName: 'ReturnToBase', subjectActor: a.actorId } as unknown as Parameters<typeof bot.queueOrder>[0])
        continue
      }
      if (StateBase.canAttackTarget(a, targetActor)) {
        bot.queueOrder({ orderName: 'Attack', subjectActor: a.actorId, targetActorId: targetActor.actorId } as unknown as Parameters<typeof bot.queueOrder>[0])
      }
    }
    return false
  }

  deactivate(_owner: Squad): void { }
}

// ---------------------------------------------------------------------------
// AirFleeState
// ---------------------------------------------------------------------------

export class AirFleeState extends AirStateBase implements IState {
  activate(_owner: Squad): void { }

  tick(owner: Squad): boolean {
    if (!owner.isValid) return false
    const bot = owner.bot as unknown as { queueOrder: (order: unknown) => void }

    for (const unit of owner.units) {
      const a = unit as unknown as ActorLike
      if (StateBase.isRearming(a)) continue

      const ammoPools = (a.traitsImplementing?.('AmmoPool') ?? []) as { hasFullAmmo?: boolean; info?: { name: string } }[]
      const rearmable = a.traitsImplementing?.('Rearmable')?.[0] as { info?: { ammoPools?: string[] } } | undefined

      if (!StateBase.reloadsAutomatically(ammoPools as { info: { name: string } }[], rearmable ? { info: { ammoPools: rearmable.info?.ammoPools ?? [] } } : null)
        && !StateBase.fullAmmo(ammoPools as { hasFullAmmo: boolean }[])) {
        bot.queueOrder({ orderName: 'ReturnToBase', subjectActor: a.actorId } as unknown as Parameters<typeof bot.queueOrder>[0])
        continue
      }
      const loc = StateBase.randomBuildingLocation(owner)
      bot.queueOrder({ orderName: 'Move', subjectActor: a.actorId, targetString: `${loc.x},${loc.y}` } as unknown as Parameters<typeof bot.queueOrder>[0])
    }
    owner.fuzzyStateMachine.changeState(owner, new AirIdleState())
    return false
  }

  deactivate(_owner: Squad): void { }
}
