/**
 * RideTransport.ts — 进入运输载具活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/RideTransport.cs
 *
 * 核心范式转换:
 * - C# sealed class RideTransport : Enter → TypeScript class RideTransport extends Enter
 * - C# self.Trait<Passenger>() → TypeScript duck-typed PassengerLike lookup
 * - C# targetActor.Trait<Cargo>() → TypeScript duck-typed CargoLike lookup
 * - C# targetActor.Trait<Aircraft>() → TypeScript duck-typed AircraftLike lookup
 * - C# self.World.AddFrameEndTask() → TypeScript world.queueFrameEndAction()
 * - C# w.Remove(self) → TypeScript world.removeActor(self)
 * - C# INotifyLoadCargo → TypeScript INotifyLoadCargo duck type
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Enter } from './Enter.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  PassengerLike,
  CargoLike,
  AircraftLike,
  INotifyLoadCargo,
} from './TransportActivityInterfaces.js'

// ---------------------------------------------------------------------------
// RideTransport
// ---------------------------------------------------------------------------

/**
 * 进入运输载具 — 乘客进入 Cargo actor 的活动。
 *
 * OpenRA 对照: RideTransport sealed class
 *
 * 继承 Enter 基类的 4 状态状态机，在 TryStartEnter 中检查 Cargo 可用性，
 * 在 OnEnterComplete 中执行实际的装载逻辑。
 */
export class RideTransport extends Enter {
  /** Passenger trait (鸭子类型)。 */
  private readonly passenger: PassengerLike

  /** 进入的目标 cargo trait。 */
  private enterCargo: CargoLike | null = null

  /** 进入的目标 actor (用于帧末验证)。 */
  private enterActor: GameActor | null = null

  /** 目标的 Aircraft trait (如果有)。 */
  private enterAircraft: AircraftLike | null = null

  constructor(self: GameActor, target: Target, targetLineColor: ColorStub | null = null) {
    super(self, target, targetLineColor)

    // Resolve Passenger trait
    this.passenger = RideTransport._resolvePassenger(self)
  }

  // ---------------------------------------------------------------------------
  // TryStartEnter override
  // ---------------------------------------------------------------------------

  protected override tryStartEnter(self: GameActor, targetActor: GameActor): boolean {
    this.enterActor = targetActor

    // Resolve Cargo trait
    this.enterCargo = RideTransport._resolveCargo(targetActor)

    // Resolve Aircraft trait (optional)
    this.enterAircraft = RideTransport._resolveAircraft(targetActor)

    // Make sure we can still enter the transport
    if (this.enterCargo === null || this.enterCargo.isTraitDisabled ||
        !this.passenger.reserve(self, this.enterCargo)) {
      this.cancel(self, true)
      return false
    }

    // If the transport is an aircraft, wait until it's at land altitude
    if (this.enterAircraft !== null && !this.enterAircraft.atLandAltitude) {
      return false
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // TickInner override
  // ---------------------------------------------------------------------------

  protected override tickInner(
    _self: GameActor,
    _target: Target,
    _targetIsDeadOrHiddenActor: boolean,
  ): void {
    if (this.enterCargo !== null && this.enterCargo.isTraitDisabled) {
      this.cancel(_self, true)
    }
  }

  // ---------------------------------------------------------------------------
  // OnEnterComplete override
  // ---------------------------------------------------------------------------

  protected override onEnterComplete(self: GameActor, targetActor: GameActor): void {
    const world = (self as unknown as { world?: WorldLike }).world
    if (world === undefined) return

    world.queueFrameEndAction(() => {
      if (self.isDead) return

      // Make sure the target hasn't changed while entering
      if (targetActor !== this.enterActor) return

      if (this.enterCargo === null || !this.enterCargo.canLoad(self)) return

      // Notify INotifyLoadCargo traits
      for (const inl of RideTransport._resolveNotifyLoadCargo(targetActor)) {
        inl.loading(self)
      }

      // Load passenger into cargo
      if (this.enterActor !== null) {
        this.enterCargo.load(this.enterActor, self)
      }

      // Remove passenger from world
      world.removeActor(self as unknown as { actorId: number })
    })
  }

  // ---------------------------------------------------------------------------
  // OnLastRun override
  // ---------------------------------------------------------------------------

  protected override onLastRun(self: GameActor): void {
    this.passenger.unreserve(self)
  }

  // ---------------------------------------------------------------------------
  // Cancel override
  // ---------------------------------------------------------------------------

  override cancel(self: GameActor, keepQueue: boolean = false): void {
    this.passenger.unreserve(self)
    super.cancel(self, keepQueue)
  }

  // ---------------------------------------------------------------------------
  // Static trait resolution helpers
  // ---------------------------------------------------------------------------

  private static _resolvePassenger(self: GameActor): PassengerLike {
    const traits = (self as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<PassengerLike>
      if (typeof t.reserve === 'function' && typeof t.unreserve === 'function') {
        return t as PassengerLike
      }
    }
    throw new Error('RideTransport requires a Passenger trait on the actor')
  }

  private static _resolveCargo(target: GameActor): CargoLike | null {
    const traits = (target as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<CargoLike>
      if (typeof t.load === 'function' && typeof t.unload === 'function') {
        return t as CargoLike
      }
    }
    return null
  }

  private static _resolveAircraft(target: GameActor): AircraftLike | null {
    const traits = (target as unknown as { traits?: Map<string, unknown> }).traits
    const aircraft = traits?.get('Aircraft') as AircraftLike | undefined
    if (aircraft && typeof (aircraft as { atLandAltitude?: unknown }).atLandAltitude !== 'undefined') {
      return aircraft
    }
    return null
  }

  private static _resolveNotifyLoadCargo(target: GameActor): INotifyLoadCargo[] {
    const result: INotifyLoadCargo[] = []
    const traits = (target as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<INotifyLoadCargo>
      if (typeof t.loading === 'function') {
        result.push(t as INotifyLoadCargo)
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// WorldLike — 世界最小接口
// ---------------------------------------------------------------------------

/** 世界最小接口 — 用于帧末操作。 */
interface WorldLike {
  queueFrameEndAction(action: () => void): void
  removeActor(actor: { actorId: number }): void
}
