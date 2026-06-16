/**
 * UnloadCargo.ts — 卸载乘客活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/UnloadCargo.cs
 *
 * 核心范式转换:
 * - C# self.Trait<Cargo>() → TypeScript duck-typed CargoLike lookup
 * - C# self.Trait<Aircraft>() / self.Trait<Mobile>() → TypeScript duck-typed trait lookup
 * - C# self.World.AddFrameEndTask() → TypeScript world.queueFrameEndAction()
 * - C# w.Add(actor) → TypeScript world.addActor(actor)
 * - C# passenger.Trait<IPositionable>().SetPosition() → TypeScript duck-typed positionable
 * - C# SubCell enum → TypeScript SubCellLike
 * - C# passenger.Trait<Passenger>().OnBeforeAddedToWorld() → TypeScript duck-typed passenger
 * - C# BlockedByActor enum → imported from BlockedByActor.ts
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Activity } from '../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { BlockedByActor } from '../Traits/BlockedByActor.js'
import { Wait } from './Wait.js'
import type {
  CargoLike,
  AircraftLike,
  IPositionableLike,
  PassengerLike,
  INotifyUnloadCargo,
  SubCellLike,
} from './TransportActivityInterfaces.js'

// ---------------------------------------------------------------------------
// UnloadCargo
// ---------------------------------------------------------------------------

/**
 * 从运输载具卸载乘客。
 *
 * OpenRA 对照: UnloadCargo activity
 *
 * 工作流程:
 * 1. onFirstRun: 移动到目标位置 (Land/Move)，排队 Wait (BeforeUnloadDelay)
 * 2. tick: 逐个卸载乘客
 * 3. 所有乘客卸载后: 排队 TakeOff (如果是飞机)，返回 true
 */
export class UnloadCargo extends Activity {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  private readonly cargo: CargoLike
  private readonly notifiers: INotifyUnloadCargo[]
  private readonly unloadAll: boolean
  private readonly aircraft: AircraftLike | null
  private readonly hasMobile: boolean
  private readonly assignTargetOnFirstRun: boolean
  private readonly unloadRange: WDist

  private destination: Target
  private takeOffAfterUnload: boolean = false
  private delayBetweenUnloads: number = 0

  // ---------------------------------------------------------------------------
  // Static factories for child activities (overridable for testing)
  // ---------------------------------------------------------------------------

  /** Factory for creating Land child activities. Overridable for testing. */
  static _landFactory: ((self: GameActor, dest: Target, range: WDist) => Activity) | null = null

  /** Factory for creating Move child activities. Overridable for testing. */
  static _moveFactory: ((self: GameActor, cell: CPos, range: WDist) => Activity) | null = null

  /** Factory for creating TakeOff child activities. Overridable for testing. */
  static _takeOffFactory: ((self: GameActor) => Activity) | null = null

  // ---------------------------------------------------------------------------
  // Constructors
  // ---------------------------------------------------------------------------

  /**
   * 创建 UnloadCargo 活动 (自动分配目标)。
   *
   * OpenRA 对照: UnloadCargo(Actor self, WDist unloadRange, bool unloadAll = true)
   */
  static createAtCurrentLocation(self: GameActor, unloadRange: WDist, unloadAll: boolean = true): UnloadCargo {
    return new UnloadCargo(self, Target.Invalid, unloadRange, unloadAll, true)
  }

  /**
   * 创建 UnloadCargo 活动 (指定目标)。
   *
   * OpenRA 对照: UnloadCargo(Actor self, in Target destination, WDist unloadRange, bool unloadAll = true)
   */
  constructor(
    self: GameActor,
    destination: Target,
    unloadRange: WDist,
    unloadAll: boolean = true,
    assignTargetOnFirstRun: boolean = false,
  ) {
    super()
    this.destination = destination
    this.unloadRange = unloadRange
    this.unloadAll = unloadAll
    this.assignTargetOnFirstRun = assignTargetOnFirstRun

    // Resolve traits
    this.cargo = UnloadCargo._resolveCargo(self)
    this.notifiers = UnloadCargo._resolveNotifiers(self)
    this.aircraft = UnloadCargo._resolveAircraft(self)
    this.hasMobile = UnloadCargo._hasMobile(self)
  }

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  protected override onFirstRun(self: GameActor): void {
    if (this.assignTargetOnFirstRun) {
      const location = (self as unknown as { location: CPos }).location
      this.destination = Target.fromCell(location)
    }

    // Move to the target destination
    if (this.aircraft !== null) {
      // Queue Land even if already landed in case self.Location != destination
      const landFactory = UnloadCargo._landFactory
      if (landFactory !== null) {
        this.queueChild(landFactory(self, this.destination, this.unloadRange))
      }
      this.takeOffAfterUnload = !this.aircraft.atLandAltitude
    } else if (this.hasMobile) {
      const world = (self as unknown as { world?: { map?: { clamp: (c: CPos) => CPos; cellContaining: (p: WPos) => CPos } } }).world
      const cell = world?.map?.clamp(world.map.cellContaining(this.destination.centerPosition)) ??
        new CPos(0, 0)
      const moveFactory = UnloadCargo._moveFactory
      if (moveFactory !== null) {
        this.queueChild(moveFactory(self, cell, this.unloadRange))
      }
    }

    // Queue Wait for before-unload delay
    const delay = this.cargo.info.beforeUnloadDelay
    if (delay > 0) {
      this.queueChild(new Wait(delay))
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  override tick(self: GameActor): boolean {
    if (this.isCanceling || this.cargo.isEmpty()) {
      return true
    }

    if (this.cargo.canUnload()) {
      if (this.delayBetweenUnloads > 0) {
        this.delayBetweenUnloads--
        return false
      }

      this.delayBetweenUnloads = this.cargo.info.betweenUnloadDelay

      // Notify INotifyUnloadCargo
      for (const inu of this.notifiers) {
        inu.unloading(self)
      }

      const actor = this.cargo.peek()
      const spawn = (self as unknown as { centerPosition: WPos }).centerPosition

      const exitSubCell = this.chooseExitSubCell(actor as unknown as GameActor)
      if (exitSubCell === null) {
        // Notify blockers
        const world = (self as unknown as { world?: { notifyBlocker?: (cells: CPos[]) => void } }).world
        if (world?.notifyBlocker) {
          const blocked = this.blockedExitCells(actor as unknown as GameActor)
          world.notifyBlocker(blocked)
        }
        this.queueChild(new Wait(10))
        return false
      }

      this.cargo.unload(self)

      const world = (self as unknown as { world?: WorldLike }).world
      if (world !== undefined) {
        world.queueFrameEndAction(() => {
          const a = actor as unknown as {
            disposed?: boolean
            centerPosition: WPos
            location: CPos
          }
          if (a.disposed) return

          const pos = UnloadCargo._resolvePositionable(actor as unknown as GameActor)
          const passenger = UnloadCargo._resolvePassenger(actor as unknown as GameActor)

          if (pos !== null) {
            pos.setPosition(actor as unknown as GameActor, exitSubCell.cell)
            pos.setCenterPosition(actor as unknown as GameActor, spawn)
          }

          if (passenger !== null) {
            passenger.onBeforeAddedToWorld(actor as unknown as GameActor)
          }

          world.addActor(actor as unknown as { actorId: number; isInWorld: boolean })
        })
      }
    }

    if (!this.unloadAll || !this.cargo.canUnload()) {
      if (this.cargo.info.afterUnloadDelay > 0) {
        this.queueChild(new Wait(this.cargo.info.afterUnloadDelay))
      }

      if (this.takeOffAfterUnload) {
        const takeOffFactory = UnloadCargo._takeOffFactory
        if (takeOffFactory !== null) {
          this.queueChild(takeOffFactory(self))
        }
      }

      return true
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // ChooseExitSubCell
  // ---------------------------------------------------------------------------

  /**
   * 为乘客选择出口 SubCell。
   *
   * OpenRA 对照: UnloadCargo.ChooseExitSubCell(Actor passenger)
   */
  private chooseExitSubCell(passenger: GameActor): { cell: CPos; subCell: SubCellLike } | null {
    const pos = UnloadCargo._resolvePositionable(passenger)
    if (pos === null) return null

    const adjacentCells = this.cargo.currentAdjacentCells() as CPos[]
    const shuffled = this._shuffle(adjacentCells)

    for (const c of shuffled) {
      const subCell = pos.getAvailableSubCell(c)
      if (subCell !== -1) { // SubCell.Invalid = -1
        return { cell: c, subCell }
      }
    }

    return null
  }

  /**
   * 获取被阻塞的退出单元格列表。
   *
   * OpenRA 对照: UnloadCargo.BlockedExitCells(Actor passenger)
   */
  private blockedExitCells(passenger: GameActor): CPos[] {
    const pos = UnloadCargo._resolvePositionable(passenger)
    if (pos === null) return []

    const adjacentCells = this.cargo.currentAdjacentCells() as CPos[]
    return adjacentCells.filter(c =>
      pos.canEnterCell(c, null, BlockedByActor.All) !==
      pos.canEnterCell(c, null, BlockedByActor.None),
    )
  }

  /**
   * 随机打乱数组 (简单实现)。
   */
  private _shuffle<T>(arr: T[]): T[] {
    const result = [...arr]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j]!, result[i]!]
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  private static _resolveCargo(self: GameActor): CargoLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<CargoLike>
      if (typeof t.load === 'function' && typeof t.unload === 'function') {
        return t as CargoLike
      }
    }
    throw new Error('UnloadCargo requires a Cargo trait on the actor')
  }

  private static _resolveNotifiers(self: GameActor): INotifyUnloadCargo[] {
    const result: INotifyUnloadCargo[] = []
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifyUnloadCargo>
      if (typeof t.unloading === 'function') {
        result.push(t as INotifyUnloadCargo)
      }
    }
    return result
  }

  private static _resolveAircraft(self: GameActor): AircraftLike | null {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    const a = traits?.get('Aircraft') as AircraftLike | undefined
    return a ?? null
  }

  private static _hasMobile(self: GameActor): boolean {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    return traits?.has('Mobile') ?? false
  }

  private static _resolvePassenger(actor: GameActor): PassengerLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<PassengerLike>
      if (typeof t.onBeforeAddedToWorld === 'function') {
        return t as PassengerLike
      }
    }
    return null
  }

  private static _resolvePositionable(actor: GameActor): IPositionableLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<IPositionableLike>
      if (typeof t.setPosition === 'function' && typeof t.setCenterPosition === 'function') {
        return t as IPositionableLike
      }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// WorldLike — 世界最小接口
// ---------------------------------------------------------------------------

interface WorldLike {
  queueFrameEndAction(action: () => void): void
  addActor(actor: { actorId: number; isInWorld: boolean }): void
}
