/**
 * Sandworm.ts — 沙虫 (Sandworm) AI 单位，地下移动并吞噬敌方单位
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/Sandworm.cs (150 lines)
 *
 * 核心范式转换:
 * - C# SandwormInfo : WandersInfo → TS SandwormInfo with inlined Wanders config
 *   (Wanders trait is deferred — TODO-8.D.DEFER-WANDERS)
 * - C# Sandworm : Wanders, ITick, INotifyActorDisposing → TS Sandworm
 *   implements ITick, INotifyActorDisposing with inlined wander state machine
 * - C# FindActorsInCircle → duck-typed world.findActorsInCircle
 * - C# MoveWithinRange / MoveTo → duck-typed mobile methods
 * - 3D: underground = mesh below terrain, emerged = Y-axis lerp above ground
 */

import { CPos } from '../../OpenRA.Game/CPos'
import { WDist } from '../../OpenRA.Game/WDist'
import { WVec } from '../../OpenRA.Game/WVec'
import type {
  IGameActor,
  ITick,
  INotifyActorDisposing,
} from '../../OpenRA.Game/Traits/TraitsInterfaces'
import { Target } from '../../OpenRA.Game/Traits/Target'
import { AttackSource } from '../../OpenRA.Mods.Common/Traits/Attack/AttackBase'
import type { AttractsWorms } from './AttractsWorms'
import { Wanders, WandersInfo } from '../../OpenRA.Mods.Common/Traits/Wanders.js'

// ---------------------------------------------------------------------------
// SandwormInfo
// OpenRA 对照: SandwormInfo : WandersInfo, Requires<MobileInfo>, Requires<AttackBaseInfo>
// ---------------------------------------------------------------------------

/** Configuration for the Sandworm AI trait.
 *
 * OpenRA 对照: SandwormInfo (sealed class, extends WandersInfo)
 *
 * Extends WandersInfo for random patrol behavior with additional
 * Sandworm-specific hunting parameters.
 */
export class SandwormInfo extends WandersInfo {
  /** Time between rescanning for targets (in ticks).
   *
   * OpenRA 对照: SandwormInfo.TargetRescanInterval (default 125)
   */
  readonly targetRescanInterval: number

  /** The radius in which the worm "searches" for targets.
   *
   * OpenRA 对照: SandwormInfo.MaxSearchRadius (default WDist.FromCells(20))
   */
  readonly maxSearchRadius: WDist

  /** The range at which the worm attacks regardless of noise levels.
   *
   * OpenRA 对照: SandwormInfo.IgnoreNoiseAttackRange (default WDist.FromCells(3))
   */
  readonly ignoreNoiseAttackRange: WDist

  /** The chance this actor has of disappearing after it attacks (in %).
   *
   * OpenRA 对照: SandwormInfo.ChanceToDisappear (default 100)
   */
  readonly chanceToDisappear: number

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    wanderMoveRadius?: number
    reduceMoveRadiusDelay?: number
    minMoveDelay?: number
    maxMoveDelay?: number
    avoidTerrainTypes?: string[]
    targetRescanInterval?: number
    maxSearchRadius?: WDist
    ignoreNoiseAttackRange?: WDist
    chanceToDisappear?: number
  } = {}) {
    super(params)
    this.targetRescanInterval = params.targetRescanInterval ?? 125
    this.maxSearchRadius = params.maxSearchRadius ?? WDist.fromCells(20)
    this.ignoreNoiseAttackRange = params.ignoreNoiseAttackRange ?? WDist.fromCells(3)
    this.chanceToDisappear = params.chanceToDisappear ?? 100
  }
}

// ---------------------------------------------------------------------------
// Sandworm
// OpenRA 对照: Sandworm : Wanders, ITick, INotifyActorDisposing
// ---------------------------------------------------------------------------

/** Sandworm AI: underground mobile unit that emerges to attack.
 *
 * OpenRA 对照: Sandworm (sealed class, extends Wanders, ITick, INotifyActorDisposing)
 *
 * The Sandworm moves underground (cell-based pathfinding), scanning for
 * targets to attack. It uses noise-based attraction (AttractsWorms trait
 * on other actors) to find prey, and can auto-target actors within close
 * range regardless of noise.
 *
 * After attacking, there is a chance the worm disappears from the map.
 *
 * Extends Wanders for autonomous patrol behavior when no targets are in
 * range. Overrides DoAction to integrate noise-seeking behavior.
 */
export class Sandworm
  extends Wanders
  implements ITick, INotifyActorDisposing
{
  /** Sandworm-specific config shortcut.
   *
   * OpenRA 对照: Sandworm.WormInfo
   */
  declare readonly info: SandwormInfo

  /** Sandworm-specific config shortcut (alias for info).
   *
   * OpenRA 对照: Sandworm.WormInfo
   */
  get wormInfo(): SandwormInfo { return this.info }

  /** Whether the worm is currently moving toward a noise-attracted target.
   *
   * OpenRA 对照: Sandworm.IsMovingTowardTarget
   */
  isMovingTowardTarget: boolean = false

  /** Whether the worm is currently in an attack sequence.
   *
   * OpenRA 对照: Sandworm.IsAttacking
   */
  isAttacking: boolean = false

  // Sandworm state fields
  /** Target rescan countdown.
   *
   * OpenRA 对照: Sandworm.targetCountdown (int)
   */
  private _targetCountdown: number

  /** Cached reference to the owning actor (alias for Wanders.self).
   *
   * OpenRA 对照: Wanders self (from constructor)
   */
  private _self: IGameActor

  /** ActorSpawnManager reference (manager that tracks spawned actor count).
   *
   * OpenRA 对照: Sandworm.manager (ActorSpawnManager)
   */
  private _manager: unknown | null = null

  /** Cached Mobile trait for movement checks.
   *
   * OpenRA 对照: Sandworm.mobile (Mobile, from constructor)
   */
  private readonly _mobile: MobileStub

  /** Cached AttackBase trait for attack operations.
   *
   * OpenRA 对照: Sandworm.attackTrait (AttackBase, from constructor)
   */
  private readonly _attackTrait: AttackBaseStub | null

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: Sandworm(Actor self, SandwormInfo info) : base(self, info)
  // ---------------------------------------------------------------------------

  /** Create a new Sandworm trait.
   *
   * OpenRA 对照: Sandworm(Actor self, SandwormInfo info)
   *
   * Caches mobile and attack traits from the actor, and resolves the
   * ActorSpawnManager from the world actor. The Wanders base class
   * handles wander state initialization (countdown, effectiveMoveRadius).
   *
   * @param self — the actor that owns this trait
   * @param info — trait configuration
   */
  constructor(self: IGameActor, info: SandwormInfo) {
    super(self, info)
    this._self = self

    // Initialize target rescan countdown
    this._targetCountdown = info.targetRescanInterval

    // Cache traits (matching C# pattern)
    this._mobile = this.resolveMobile(self)
    this._attackTrait = this.resolveAttackTrait(self)

    // Resolve ActorSpawnManager from world actor
    this._manager = this.resolveSpawnManager(self)
  }

  // ---------------------------------------------------------------------------
  // DoAction (override of Wanders.DoAction)
  // OpenRA 对照: Sandworm.DoAction(Actor, CPos) [override]
  // ---------------------------------------------------------------------------

  /** Perform the wander action: scan for targets first, then move.
   *
   * OpenRA 对照: Sandworm.DoAction(Actor self, CPos targetCell) [override]
   *
   * 1. Reset IsMovingTowardTarget
   * 2. Rescan for noise-attracted targets
   * 3. If still moving toward a target, return
   * 4. Otherwise, queue a MoveWithinRange to the target cell
   *
   * @param self — the actor
   * @param targetCell — the wander target cell
   */
  doAction(self: IGameActor, targetCell: CPos): void {
    this.isMovingTowardTarget = false

    this.rescanForTargets(self)

    if (this.isMovingTowardTarget) return

    const targetPos = Target.fromCell(targetCell)
    this.queueMoveWithinRange(self, targetPos, WDist.fromCells(1))
  }

  // ---------------------------------------------------------------------------
  // ITick.Tick
  // OpenRA 对照: Sandworm.ITick.Tick(Actor self)
  // ---------------------------------------------------------------------------

  /** Periodic target rescan: decrements countdown, rescans when it reaches 0.
   *
   * OpenRA 对照: Sandworm.ITick.Tick(Actor self)
   *
   * Skips rescan if: countdown not expired, currently attacking, or not in world.
   *
   * @param self — the actor
   */
  tick(self: IGameActor): void {
    if (--this._targetCountdown > 0 || this.isAttacking || !this.isActorInWorld(self))
      return

    this.rescanForTargets(self)
  }

  // ---------------------------------------------------------------------------
  // RescanForTargets
  // OpenRA 对照: Sandworm.RescanForTargets(Actor self)
  // ---------------------------------------------------------------------------

  /** Scan for targets: close-range auto-attack first, then noise-based search.
   *
   * OpenRA 对照: Sandworm.RescanForTargets(Actor self)
   *
   * Algorithm:
   * 1. Reset target countdown
   * 2. Check close-range (IgnoreNoiseAttackRange) for any valid targets
   * 3. If found, attack immediately
   * 4. Otherwise, aggregate noise directions from all AttractsWorms actors
   * 5. Move toward the combined noise direction
   *
   * @param self — the actor
   */
  private rescanForTargets(self: IGameActor): void {
    this._targetCountdown = this.wormInfo.targetRescanInterval

    // If close enough, we don't care about other actors.
    const closeTarget = this.findCloseAutoTarget(self)

    if (closeTarget !== null) {
      this.attackTarget(self, closeTarget)
      return
    }

    // Aggregate noise from all AttractsWorms actors in range
    let noiseDirection = this.aggregateNoise(self)

    // No target was found
    if (noiseDirection === null || WVec.equals(noiseDirection, WVec.Zero))
      return

    const centerPos = this.getActorCenterPosition()
    const map = this.getWorldMap()
    if (!map) return

    let moveTo = map.cellContaining(WVec.add(centerPos, noiseDirection))

    while (!map.contains(moveTo) || !this.canEnterCell(this._mobile, moveTo)) {
      // Without this check, this while can be an infinite loop
      if (CPos.equals(moveTo, this.getActorLocation())) {
        this.cancelActivity(self)
        return
      }

      noiseDirection = WVec.divide(noiseDirection, 2)
      moveTo = map.cellContaining(WVec.add(centerPos, noiseDirection))
    }

    // Don't get stuck when the noise is distributed evenly
    if (CPos.equals(moveTo, this.getActorLocation())) {
      this.cancelActivity(self)
      return
    }

    this.queueMoveTo(self, moveTo, 3)
    this.isMovingTowardTarget = true
  }

  // ---------------------------------------------------------------------------
  // INotifyActorDisposing
  // OpenRA 对照: Sandworm.INotifyActorDisposing.Disposing(Actor self)
  // ---------------------------------------------------------------------------

  /** Decrease spawn manager count when the worm is disposed.
   *
   * OpenRA 对照: Sandworm.INotifyActorDisposing.Disposing(Actor self)
   *
   * @param self — the actor being disposed
   */
  disposing(_self: IGameActor): void {
    if (this._disposed) return

    const manager = this._manager as { decreaseActorCount?: () => void } | null
    if (manager?.decreaseActorCount) {
      manager.decreaseActorCount()
    }
    this._disposed = true
  }

  // ---------------------------------------------------------------------------
  // Private: close-range auto-target
  // ---------------------------------------------------------------------------

  /** Find a valid attack target within the ignore-noise attack range.
   *
   * OpenRA 对照: self.World.FindActorsInCircle(...IgnoreNoiseAttackRange)
   *
   * @param self — the actor
   * @returns the target, or null if none found
   */
  private findCloseAutoTarget(self: IGameActor): Target | null {
    const centerPos = this.getActorCenterPosition()
    const actors = this.findActorsInCircle(
      self,
      centerPos,
      this.wormInfo.ignoreNoiseAttackRange,
    )

    for (const actor of actors) {
      const target = Target.fromActor(actor as unknown as import('../../OpenRA.Game/Traits/IActorRef').IActorRef)
      if (this._attackTrait && this._attackTrait.hasAnyValidWeapons(target)) {
        return target
      }
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // Private: noise aggregation
  // ---------------------------------------------------------------------------

  /** Aggregate noise directions from all AttractsWorms actors in range.
   *
   * OpenRA 对照: actorsInRange.Aggregate(WVec.Zero, (a, b) => a + b.AttractionAtPosition(...))
   *
   * @param self — the actor
   * @returns the combined noise direction, or null if no noise sources
   */
  private aggregateNoise(self: IGameActor): WVec | null {
    const centerPos = this.getActorCenterPosition()
    const actors = this.findActorsInCircle(
      self,
      centerPos,
      this.wormInfo.maxSearchRadius,
    )

    const attractsWormsList: AttractsWorms[] = []

    for (const actor of actors) {
      // Check if actor has AttractsWormsInfo (via actor config)
      const actorInfo = this.getActorInfo(actor)
      if (!actorInfo?.hasTraitInfo?.('AttractsWorms')) {
        continue
      }

      const loc = this.getActorLocationOf(actor)
      if (!this.canEnterCell(this._mobile, loc)) continue

      // Get the AttractsWorms trait instances
      const traits = this.getActorTraits<AttractsWorms>(actor, 'AttractsWorms')
      for (const t of traits) {
        attractsWormsList.push(t)
      }
    }

    if (attractsWormsList.length === 0) return null

    let noiseDirection = WVec.Zero
    for (const aw of attractsWormsList) {
      noiseDirection = WVec.add(
        noiseDirection,
        aw.attractionAtPosition(centerPos),
      )
    }

    return noiseDirection
  }

  // ---------------------------------------------------------------------------
  // Private: attack target via AttackBase
  // ---------------------------------------------------------------------------

  /** Launch an attack on a target.
   *
   * OpenRA 对照: attackTrait.AttackTarget(target, AttackSource.AutoTarget, false, true, false)
   *
   * @param self — the actor
   * @param target — the target to attack
   */
  private attackTarget(self: IGameActor, target: Target): void {
    if (this._attackTrait) {
      this._attackTrait.attackTarget(
        self,
        target,
        AttackSource.AutoTarget,
        false,
        true,
        false,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Duck-typing helpers — access properties from the actor/world graph
  // ---------------------------------------------------------------------------

  /** Check if the actor is in the world. */
  private isActorInWorld(self: IGameActor): boolean {
    const a = self as unknown as { isInWorld?: boolean }
    return a.isInWorld ?? false
  }

  /** Get the actor's center position (alias for Wanders.getCenterPosition). */
  private getActorCenterPosition(): WVec {
    return this.getCenterPosition(this._self)
  }

  /** Get the actor's cell location. */
  private getActorLocation(): CPos {
    const a = this._self as unknown as { location?: CPos }
    return a.location ?? CPos.Zero
  }

  /** Get the location of a different actor. */
  private getActorLocationOf(actor: IGameActor): CPos {
    const a = actor as unknown as { location?: CPos }
    return a.location ?? CPos.Zero
  }

  /** Resolve the Mobile trait from the actor (called once in constructor).
   *
   * OpenRA 对照: self.Trait<Mobile>()
   */
  private resolveMobile(self: IGameActor): MobileStub {
    const selfAny = self as unknown as {
      trait?: <T>(name: string) => T | undefined
    }
    if (typeof selfAny.trait === 'function') {
      const m = selfAny.trait<MobileStub>('Mobile')
      if (m) return m
    }
    return defaultMobileStub
  }

  /** Resolve the AttackBase trait from the actor (called once in constructor).
   *
   * OpenRA 对照: self.Trait<AttackBase>()
   */
  private resolveAttackTrait(self: IGameActor): AttackBaseStub | null {
    const selfAny = self as unknown as {
      trait?: <T>(name: string) => T | undefined
    }
    if (typeof selfAny.trait === 'function') {
      return selfAny.trait<AttackBaseStub>('AttackBase') ?? null
    }
    return null
  }

  /** Get the actor's info/config. */
  private getActorInfo(actor: IGameActor): ActorInfoStub | null {
    const a = actor as unknown as { info?: ActorInfoStub }
    return a.info ?? null
  }

  /** Get traits by name from an actor. */
  private getActorTraits<T>(actor: IGameActor, name: string): T[] {
    const a = actor as unknown as {
      traitsImplementing?: <T>(name: string) => T[]
    }
    if (typeof a.traitsImplementing === 'function') {
      return a.traitsImplementing<T>(name)
    }
    return []
  }

  /** Check if a mobile can enter the given cell. */
  private canEnterCell(mobile: MobileStub, cell: CPos): boolean {
    if (typeof mobile.canEnterCell === 'function') {
      return mobile.canEnterCell(cell, null, 0 /* BlockedByActor.None */)
    }
    return true
  }

  /** Find actors in a circle around a position. */
  private findActorsInCircle(
    _self: IGameActor,
    center: WVec,
    range: WDist,
  ): IGameActor[] {
    const world = this._self.world as Record<string, unknown> | undefined
    const faic = world?.findActorsInCircle as
      | ((center: WVec, range: WDist) => IGameActor[])
      | undefined
    if (faic) {
      return faic(center, range)
    }
    return []
  }

  /** Resolve ActorSpawnManager from the world actor. */
  private resolveSpawnManager(self: IGameActor): unknown | null {
    const world = self.world as Record<string, unknown> | undefined
    const worldActor = world?.worldActor as Record<string, unknown> | undefined
    if (worldActor?.trait) {
      return (worldActor.trait as (name: string) => unknown)('ActorSpawnManager') ?? null
    }
    return null
  }

  /** Queue a MoveWithinRange activity. */
  private queueMoveWithinRange(
    self: IGameActor,
    target: Target,
    range: WDist,
  ): void {
    const a = self as unknown as {
      queueActivity?: (activity: unknown, queued?: boolean) => void
    }
    if (a.queueActivity && this._mobile.moveWithinRange) {
      const activity = this._mobile.moveWithinRange(target, range)
      a.queueActivity(activity, false)
    }
  }

  /** Queue a MoveTo activity. */
  private queueMoveTo(
    self: IGameActor,
    cell: CPos,
    nearEnough: number,
  ): void {
    const a = self as unknown as {
      queueActivity?: (activity: unknown, queued?: boolean) => void
    }
    if (a.queueActivity && this._mobile.moveTo) {
      const activity = this._mobile.moveTo(cell, nearEnough)
      a.queueActivity(activity, false)
    }
  }

  /** Cancel the current activity. */
  private cancelActivity(self: IGameActor): void {
    const a = self as unknown as {
      cancelActivity?: () => void
    }
    a.cancelActivity?.()
  }

  /* Activity queuing is handled via the actor's queueActivity method directly.
   * The _queueActivity wrapper is not needed since queue activities always
   * go through the actor interface. */
}

// ---------------------------------------------------------------------------
// Stub interfaces for duck-typing
// ---------------------------------------------------------------------------

/** Stub interface for Mobile trait. */
interface MobileStub {
  canEnterCell?(
    cell: CPos,
    actor: unknown,
    blockedByActor: number,
  ): boolean
  moveTo?(cell: CPos, nearEnough: number): unknown
  moveWithinRange?(target: Target, range: WDist): unknown
}

const defaultMobileStub: MobileStub = {
  canEnterCell: () => true,
  moveTo: () => null,
  moveWithinRange: () => null,
}

/** Stub interface for AttackBase trait. */
interface AttackBaseStub {
  hasAnyValidWeapons(target: Target): boolean
  attackTarget(
    self: IGameActor,
    target: Target,
    source: number,
    queued: boolean,
    allowMove: boolean,
    forceAttack: boolean,
  ): void
}

/** Stub interface for actor info. */
interface ActorInfoStub {
  hasTraitInfo?(name: string): boolean
}
